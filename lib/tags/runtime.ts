/**
 * Tag runtime — derives all execution machinery from TAG_SPECS.
 *
 * Functions here are pure (besides handler invocation). The chat route
 * passes in a context object; the runtime returns the cleaned reply text
 * + a list of audit rows to insert.
 *
 * KEEP the public API stable: scripts/check-tags-sync.ts and the prompt
 * builder both depend on the exported names below.
 */

import type {
  HandlerMatch,
  TagChannel,
  TagHandlerResult,
  TagMode,
  TagSpec,
  WiredTag,
} from "./types";
import { TAG_SPECS } from "./specs";

// ─────────────────────────────────────────────────────────────────────────
// Pattern derivation — single regex per tag, built from spec
// ─────────────────────────────────────────────────────────────────────────

/**
 * All accepted names for a tag (canonical + aliases). Used both for
 * matching and for the strip regex.
 */
function namesOf(spec: TagSpec): string[] {
  return [spec.name, ...(spec.aliases ?? [])];
}

/** Build the matcher regex for a single tag. Cached on first call. */
const patternCache = new Map<string, RegExp>();
export function patternFor(spec: TagSpec): RegExp {
  const key = spec.name;
  const cached = patternCache.get(key);
  if (cached) return cached;
  const names = namesOf(spec).map(escapeRe).join("|");
  const re =
    spec.shape === "flag"
      ? new RegExp(`\\[(?:${names})\\]`)
      : new RegExp(`\\[(?:${names}):([^\\]]+)\\]`);
  patternCache.set(key, re);
  return re;
}

/**
 * One mega-regex that matches ANY known tag — used to strip them from the
 * cleaned reply before display. Built once per process.
 *
 * IMPORTANT: includes a special case for [FORWARD:...] which uses a lookahead
 * so the body can contain `]` (e.g. markdown links). All other tags use the
 * simple `[^\]]+` match.
 */
let stripCache: RegExp | null = null;
export function stripPattern(): RegExp {
  if (stripCache) return stripCache;
  const parts: string[] = [];
  for (const spec of TAG_SPECS) {
    if (spec.name === "FORWARD") {
      parts.push(`\\[FORWARD:[\\s\\S]*?\\](?=\\s*\\[NOTIFY|\\s*\\[MEMORY|\\s*$)`);
      continue;
    }
    for (const n of namesOf(spec)) {
      parts.push(spec.shape === "flag" ? `\\[${escapeRe(n)}\\]` : `\\[${escapeRe(n)}:[^\\]]+\\]`);
    }
  }
  stripCache = new RegExp(parts.join("|"), "gi");
  return stripCache;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─────────────────────────────────────────────────────────────────────────
// Prompt generation — derived from specs, never hand-edited
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build the prompt block describing all tags wired for `channel`. Mode
 * filtering applied if the spec lists modes.
 *
 * The output has TWO sections:
 *   1. CAPABILITIES whitelist (one-liner — what the AI is allowed to claim)
 *   2. DETAILED USAGE (per-tag trigger + format + example)
 *
 * Both sections are generated together → impossible for them to drift.
 */
export function buildPromptBlock(channel: TagChannel, mode: TagMode): string {
  const tags = TAG_SPECS.filter(
    (s) => s.channels.includes(channel) && (s.modes ? s.modes.includes(mode) : true)
  );

  const wlist = tags
    .map((t) => {
      const sample =
        t.shape === "flag" ? `[${t.name}]` : `[${t.name}:${t.shape === "pipe" ? "a|b|c" : "value"}]`;
      return `${sample} — ${t.description}`;
    })
    .join("\n  • ");

  const sections = tags
    .map((t) => {
      const aliasNote = t.aliases?.length ? ` (also accepts: ${t.aliases.join(", ")})` : "";
      const reqNote = t.requires?.length ? ` Requires: ${t.requires.join(", ")}.` : "";
      const exampleLine = t.example ? `\n  Example: ${t.example}` : "";
      return `### ${t.name}${aliasNote}${reqNote}\n  Trigger: ${t.trigger}\n  Usage: ${t.usage}${exampleLine}`;
    })
    .join("\n\n");

  return `
WIRED CAPABILITIES — these tags are LIVE. The dispatcher will execute them
and append results to your reply. NEVER claim a capability that isn't listed
here. NEVER refuse a capability that IS listed here.

  • ${wlist}

DETAILED USAGE:

${sections}
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────
// Dispatcher — runs handlers, collects results, returns cleaned reply
// ─────────────────────────────────────────────────────────────────────────

export type DispatchOutcome = {
  /**
   * Reply text with tags stripped + handler appendices joined onto the end
   * (each separated by `\n\n---\n`). Use this for callers that want the
   * "everything baked in" result — most web-side callers.
   */
  cleanContent: string;
  /**
   * Just the stripped-but-not-appended body. Use this when you want to
   * compose the appendices into your own reply structure (e.g. WhatsApp's
   * `extraResultLines`).
   */
  strippedBody: string;
  /**
   * Per-handler reply additions, in the order they fired. Each is the raw
   * `appendToReply` string returned by a handler. Callers can join these
   * however they like.
   */
  appendices: string[];
  /** Audit rows to insert into `tool_invocations`. */
  audits: NonNullable<TagHandlerResult["audit"]>[];
  /** Side-effect tags that fired (for observability). Markers are in `markers`. */
  firedTags: string[];
  /** Tags that matched but were skipped due to perm/mode/requires gate. */
  skippedTags: { name: string; reason: string }[];
  /**
   * Marker tags (kind='marker') keyed by canonical name. The value is:
   *  - `true` for `flag` shape (presence-only markers like DIRECTOR-ONLY)
   *  - the matched payload string for `value`/`pipe` shape (e.g. MEMORY: 'personal')
   * Aliases collapse onto the canonical name (so [CONFIDENTIAL] ends up as
   * `markers["DIRECTOR-ONLY"] = true`).
   */
  markers: Record<string, string | true>;
};

export type DispatchOptions<Ctx> = {
  aiContent: string;
  channel: TagChannel;
  mode: TagMode;
  ctx: Ctx;
  /** Per-context capability check — return null if available, else a reason string. */
  checkRequires?: (spec: TagSpec, ctx: Ctx) => string | null;
};

/**
 * Run all wired tags against the AI output. Each handler runs sequentially
 * (some tags depend on the order — e.g. NOTIFY consumes FORWARD).
 *
 * Errors in one handler do NOT abort others — they're logged and noted
 * in the audit list with status='error'.
 */
export async function dispatchTags<Ctx>(
  wired: WiredTag<Ctx>[],
  opts: DispatchOptions<Ctx>
): Promise<DispatchOutcome> {
  const strippedBody = opts.aiContent.replace(stripPattern(), "").trim();
  const outcome: DispatchOutcome = {
    strippedBody,
    cleanContent: strippedBody,
    appendices: [],
    audits: [],
    firedTags: [],
    skippedTags: [],
    markers: {},
  };

  // Markers come from ALL specs (whether or not they're in the wired list)
  // because markers don't need handlers — the dispatcher records them
  // unconditionally for the route to consume. Pull markers from TAG_SPECS,
  // not just from `wired`.
  for (const spec of TAG_SPECS) {
    if (spec.kind !== "marker") continue;
    if (!spec.channels.includes(opts.channel)) continue;
    if (spec.modes && !spec.modes.includes(opts.mode)) continue;
    const m = opts.aiContent.match(patternFor(spec));
    if (!m) continue;
    if (spec.shape === "flag") {
      outcome.markers[spec.name] = true;
    } else {
      outcome.markers[spec.name] = (m[1] ?? "").trim();
    }
    outcome.firedTags.push(spec.name);
  }

  const recordAppend = (text: string) => {
    outcome.appendices.push(text);
    outcome.cleanContent += `\n\n---\n${text}`;
  };

  for (const tag of wired) {
    // Markers are handled above — skip in the side-effect loop.
    if (tag.kind === "marker") continue;
    if (!tag.channels.includes(opts.channel)) continue;
    if (tag.modes && !tag.modes.includes(opts.mode)) continue;

    const m = opts.aiContent.match(patternFor(tag));
    if (!m) continue;

    const gate = opts.checkRequires?.(tag, opts.ctx);
    if (gate) {
      outcome.skippedTags.push({ name: tag.name, reason: gate });
      recordAppend(`⚠️ ${tag.name}: ${gate}`);
      continue;
    }

    const match = parseMatch(tag, m);
    const started = Date.now();
    try {
      const result = await tag.handler(match, opts.ctx);
      if (!result) continue;
      outcome.firedTags.push(tag.name);
      if (result.appendToReply) recordAppend(result.appendToReply);
      if (result.audit) outcome.audits.push(result.audit);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[tags] ${tag.name} handler threw:`, msg);
      recordAppend(`⚠️ ${tag.name} failed: ${msg}`);
      outcome.audits.push({
        toolName: tag.name.toLowerCase(),
        provider: tag.requires?.includes("lark")
          ? "lark"
          : tag.requires?.includes("google")
            ? "google"
            : "internal",
        input: { matched: m[0] },
        output: null,
        status: "error",
        error: msg,
        durationMs: Date.now() - started,
      });
    }
  }

  return outcome;
}

function parseMatch(spec: TagSpec, m: RegExpMatchArray): HandlerMatch {
  if (spec.shape === "flag") return { shape: "flag" };
  const value = (m[1] ?? "").trim();
  if (spec.shape === "value") return { shape: "value", value };
  return { shape: "pipe", fields: value.split("|").map((s) => s.trim()) };
}

/**
 * Synchronously extract markers from raw AI content without running any
 * side-effect handlers. Useful when the route needs to consume markers
 * (e.g. MEMORY routing for memory storage) BEFORE it's ready to call
 * the full async dispatcher.
 *
 * Returns the same shape as `dispatchOutcome.markers` — aliases collapse
 * onto canonical names.
 */
export function extractMarkers(
  aiContent: string,
  channel: TagChannel,
  mode: TagMode
): Record<string, string | true> {
  const markers: Record<string, string | true> = {};
  for (const spec of TAG_SPECS) {
    if (spec.kind !== "marker") continue;
    if (!spec.channels.includes(channel)) continue;
    if (spec.modes && !spec.modes.includes(mode)) continue;
    const m = aiContent.match(patternFor(spec));
    if (!m) continue;
    if (spec.shape === "flag") {
      markers[spec.name] = true;
    } else {
      markers[spec.name] = (m[1] ?? "").trim();
    }
  }
  return markers;
}

// ─────────────────────────────────────────────────────────────────────────
// Audit — verifies handlers cover all wired tags for a channel
// ─────────────────────────────────────────────────────────────────────────

/**
 * Throws if the wired-tag table is missing handlers for any spec listed
 * for the given channel. Call this in tests or at module-init time so
 * a missing handler is a HARD ERROR, not a silent gap.
 */
export function assertCoverage<Ctx>(wired: WiredTag<Ctx>[], channel: TagChannel): void {
  const wiredNames = new Set(wired.map((w) => w.name));
  // Markers don't need handlers — they're populated by the dispatcher directly
  // from TAG_SPECS. Only side-effect tags require coverage.
  const expected = TAG_SPECS.filter(
    (s) => s.channels.includes(channel) && s.kind !== "marker"
  ).map((s) => s.name);
  const missing = expected.filter((n) => !wiredNames.has(n));
  if (missing.length > 0) {
    throw new Error(
      `[tags] channel="${channel}" missing handlers for: ${missing.join(", ")}. ` +
        `Either add the handler to handlers.ts or remove "${channel}" from the spec's channels array.`
    );
  }
}

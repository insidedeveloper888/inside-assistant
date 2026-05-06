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
  /** Reply text with tags stripped + handler appendices added. */
  cleanContent: string;
  /** Audit rows to insert into `tool_invocations`. */
  audits: NonNullable<TagHandlerResult["audit"]>[];
  /** Tags that fired (for observability — count + name). */
  firedTags: string[];
  /** Tags that matched but were skipped due to perm/mode/requires gate. */
  skippedTags: { name: string; reason: string }[];
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
  const outcome: DispatchOutcome = {
    cleanContent: opts.aiContent.replace(stripPattern(), "").trim(),
    audits: [],
    firedTags: [],
    skippedTags: [],
  };

  for (const tag of wired) {
    if (!tag.channels.includes(opts.channel)) continue;
    if (tag.modes && !tag.modes.includes(opts.mode)) continue;

    const m = opts.aiContent.match(patternFor(tag));
    if (!m) continue;

    const gate = opts.checkRequires?.(tag, opts.ctx);
    if (gate) {
      outcome.skippedTags.push({ name: tag.name, reason: gate });
      outcome.cleanContent += `\n\n---\n⚠️ ${tag.name}: ${gate}`;
      continue;
    }

    const match = parseMatch(tag, m);
    const started = Date.now();
    try {
      const result = await tag.handler(match, opts.ctx);
      if (!result) continue;
      outcome.firedTags.push(tag.name);
      if (result.appendToReply) outcome.cleanContent += `\n\n---\n${result.appendToReply}`;
      if (result.audit) outcome.audits.push(result.audit);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[tags] ${tag.name} handler threw:`, msg);
      outcome.cleanContent += `\n\n---\n⚠️ ${tag.name} failed: ${msg}`;
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
  const expected = TAG_SPECS.filter((s) => s.channels.includes(channel)).map((s) => s.name);
  const missing = expected.filter((n) => !wiredNames.has(n));
  if (missing.length > 0) {
    throw new Error(
      `[tags] channel="${channel}" missing handlers for: ${missing.join(", ")}. ` +
        `Either add the handler to handlers.ts or remove "${channel}" from the spec's channels array.`
    );
  }
}

/**
 * Tag system shared types.
 *
 * A "tag" is an inline directive the AI emits in its reply (e.g. `[LARK_DOC:My Title]`)
 * that triggers a server-side side effect — analogous to OpenAI tool calls but
 * inline so we don't need a separate model API.
 *
 * The TagSpec is the source of truth: prompt sections, capability whitelists,
 * regex matchers, and strip patterns are ALL derived from it. Adding a new
 * capability = adding one entry to the registry. There is no second place to
 * touch.
 *
 * KEEP THIS FILE BYTE-IDENTICAL BETWEEN inside-assistant and whatsappanalysis
 * (services/webhook-receiver). CI fails on any diff — see scripts/check-tags-sync.ts.
 */

export type TagChannel = "web" | "whatsapp";
export type TagMode = "personal" | "company";

/**
 * Three tag shapes — discriminated for handler arg narrowing.
 *
 * - `flag`:  `[TAG]`                 — no payload, presence is the signal
 * - `value`: `[TAG:single value]`    — one opaque string after the colon
 * - `pipe`:  `[TAG:a|b|c]`           — multiple pipe-delimited fields
 */
export type TagShape = "flag" | "value" | "pipe";

/** What the dispatcher passes to a handler. Shape-narrowed via the union. */
export type HandlerMatch =
  | { shape: "flag" }
  | { shape: "value"; value: string }
  | { shape: "pipe"; fields: string[] };

/**
 * Metadata-only spec (no handler). KEEP IDENTICAL across repos.
 *
 * A spec describes WHAT a tag does and WHEN to emit it. The HOW (handler)
 * is repo-local because each repo calls into different lib code (web uses
 * inside-assistant lib/lark-tools, WA uses webhook-receiver fetch helpers).
 */
export type TagSpec = {
  /** Canonical name as it appears in the AI's output. UPPER_SNAKE only. */
  name: string;

  /**
   * Alternate names accepted by the matcher. Use for cross-channel parity
   * (e.g. WA emits `LARK_TASK_DONE`, web emits `LARK_TASK_COMPLETE`, both
   * dispatch the same handler). Don't add aliases for typos — fix the prompt.
   */
  aliases?: string[];

  shape: TagShape;

  /** Channels where the AI is allowed to emit this tag. Filters the prompt. */
  channels: TagChannel[];

  /**
   * Modes where the tag is allowed (defaults to ['personal'] for tags that
   * touch user-scoped Lark/Google accounts). 'company' mode covers shared
   * Inside-wide knowledge ops.
   */
  modes?: TagMode[];

  /** One-line summary used in the truth-discipline capability whitelist. */
  description: string;

  /** Plain-language trigger heuristics. Multi-language welcome (EN + ZH). */
  trigger: string;

  /**
   * Detailed usage text included in the prompt's "DETAILED USAGE" section.
   * Should explain when to confirm vs fire-immediately, expected formatting,
   * what the system appends to the reply on success.
   */
  usage: string;

  /** A canonical example, included verbatim in the prompt. */
  example?: string;

  /** External capability deps. Dispatcher checks these before invoking. */
  requires?: ("lark" | "google")[];

  /**
   * Granular Google permission this tag depends on, if any. Read against
   * the user's `user_integrations.config.permissions` JSON. Ignored for
   * non-Google tags.
   */
  googlePermission?: "calendar" | "gmail" | "drive" | "docs" | "sheets" | "tasks" | "meet";
};

/**
 * Per-repo handler signature. Receives the dispatcher context + the parsed
 * match. Returns text to append to the reply (after `\n\n---\n`), or null
 * for tags that act silently. May throw — dispatcher catches and logs.
 */
export type TagHandler<Ctx> = (
  match: HandlerMatch,
  ctx: Ctx
) => Promise<TagHandlerResult | null>;

export type TagHandlerResult = {
  /** Markdown text appended to the AI's cleaned reply. */
  appendToReply?: string;
  /** Optional audit row for `tool_invocations`. */
  audit?: {
    toolName: string;
    provider: "lark" | "google" | "internal";
    input: unknown;
    output: unknown;
    status: "success" | "error";
    error: string | null;
    durationMs: number;
  };
};

/** Bound spec + handler — what the dispatcher consumes. */
export type WiredTag<Ctx> = TagSpec & { handler: TagHandler<Ctx> };

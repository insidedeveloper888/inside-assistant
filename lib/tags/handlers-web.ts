/**
 * Web-side tag handlers for the chat route.
 *
 * One handler per spec from `./specs.ts` whose `channels` includes "web".
 * Handlers are pure async functions over a `WebTagContext`. The dispatcher
 * in `./runtime.ts` invokes them, collects audit rows, and appends results
 * to the cleaned reply.
 *
 * Migration status:
 *   - LARK_TASK_LIST / LARK_TASK / LARK_TASK_COMPLETE: ✅ migrated
 *   - LARK_DOC / LARK_BOARD / LARK_EVENT / LARK_EVENT_DELETE / LARK_CAL_LIST: TODO
 *   - GOOGLE_*: TODO
 *   - NOTIFY / FORWARD / MEMORY / DIRECTOR-ONLY: TODO (special — multi-tag coupling)
 *
 * Until all are migrated, the chat route runs the registry dispatcher first
 * (for migrated tags) and the legacy if-blocks afterwards (for unmigrated tags).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TagHandler, WiredTag } from "./types";
import { TAG_SPECS } from "./specs";

export type WebTagContext = {
  supabase: SupabaseClient;
  userId: string;
  sessionId: string;
  /** Already resolved by getFreshLarkToken upstream — null if user not connected. */
  larkToken: string | null;
  /** Already resolved by getFreshGoogleToken upstream. */
  googleToken: string | null;
  googleEmail: string | null;
  googlePerms: Record<string, boolean | undefined>;
  /** The cleaned (tags stripped) reply body — for tags that materialise it (LARK_DOC/GOOGLE_DOC). */
  cleanedReplyBody: string;
  /** Raw AI output — for tags that need to coordinate with sibling tags (NOTIFY+FORWARD). */
  aiContent: string;
};

// ─────────────────────────────────────────────────────────────────────────
// LARK TASKS
// ─────────────────────────────────────────────────────────────────────────

const handleLarkTaskList: TagHandler<WebTagContext> = async (_match, ctx) => {
  if (!ctx.larkToken) {
    return { appendToReply: "⚠️ Lark not connected — connect at /settings/integrations" };
  }
  const { larkListTasks } = await import("@/lib/lark-tools");
  const started = Date.now();
  const result = await larkListTasks({ token: ctx.larkToken, limit: 30 });
  const audit = {
    toolName: "lark_list_tasks",
    provider: "lark" as const,
    input: { source: "auto_tag" },
    output: result.ok ? { count: result.tasks.length } : null,
    status: result.ok ? ("success" as const) : ("error" as const),
    error: result.ok ? null : result.error,
    durationMs: Date.now() - started,
  };
  if (!result.ok) {
    return { appendToReply: `⚠️ Lark tasks fetch failed: ${result.error}`, audit };
  }
  const open = result.tasks.filter((t) => !t.completed);
  if (open.length === 0) {
    return { appendToReply: "✅ No open Lark tasks.", audit };
  }
  const lines = open.slice(0, 30).map((t) => {
    const due = t.due
      ? ` · due ${new Date(t.due).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
      : "";
    return `- ${t.summary}${due}\n  _guid: ${t.guid}_`;
  });
  return {
    appendToReply: `📋 **Your Lark tasks (${open.length} open):**\n${lines.join("\n")}`,
    audit,
  };
};

const handleLarkTaskCreate: TagHandler<WebTagContext> = async (match, ctx) => {
  if (match.shape !== "value") return null;
  if (!ctx.larkToken) {
    return { appendToReply: "⚠️ Lark not connected — connect at /settings/integrations" };
  }
  // value shape, but we still split on `|` for the optional due date.
  // Specs.ts marks LARK_TASK as `value` (not `pipe`) because the title may
  // contain pipes; the optional due date is parsed defensively here.
  const parts = match.value.split("|").map((s) => s.trim());
  const summary = parts[0];
  if (!summary) return null;
  const dueIso = parts[1];
  const dueDate = dueIso ? new Date(dueIso) : undefined;
  const validDue = dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : undefined;

  const { larkCreateTask } = await import("@/lib/lark-tools");
  const started = Date.now();
  const result = await larkCreateTask({ token: ctx.larkToken, summary, dueDate: validDue });
  const audit = {
    toolName: "lark_create_task",
    provider: "lark" as const,
    input: { summary, dueIso: dueIso ?? null, source: "auto_tag" },
    output: result.ok ? { taskGuid: result.taskGuid } : null,
    status: result.ok ? ("success" as const) : ("error" as const),
    error: result.ok ? null : result.error,
    durationMs: Date.now() - started,
  };
  if (!result.ok) {
    return { appendToReply: `⚠️ Lark task failed: ${result.error}`, audit };
  }
  const dueText = validDue
    ? ` (due ${validDue.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })})`
    : "";
  return {
    appendToReply: `📋 Task added to Lark: **${summary}**${dueText}\n_guid: ${result.taskGuid}_`,
    audit,
  };
};

const handleLarkTaskComplete: TagHandler<WebTagContext> = async (match, ctx) => {
  if (match.shape !== "value") return null;
  if (!ctx.larkToken) {
    return { appendToReply: "⚠️ Lark not connected — connect at /settings/integrations" };
  }
  const taskGuid = match.value;
  const { larkCompleteTask } = await import("@/lib/lark-tools");
  const started = Date.now();
  const result = await larkCompleteTask({ token: ctx.larkToken, taskGuid });
  const audit = {
    toolName: "lark_complete_task",
    provider: "lark" as const,
    input: { taskGuid, source: "auto_tag" },
    output: result.ok ? { ok: true } : null,
    status: result.ok ? ("success" as const) : ("error" as const),
    error: result.ok ? null : result.error,
    durationMs: Date.now() - started,
  };
  if (!result.ok) {
    return { appendToReply: `⚠️ Complete failed: ${result.error}`, audit };
  }
  return { appendToReply: "✅ Task marked complete in Lark.", audit };
};

// ─────────────────────────────────────────────────────────────────────────
// Wiring — pair specs with handlers. Every spec listed for "web" channel
// must appear here OR the migration explicitly opts out for now.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Tags currently migrated to the registry-based dispatcher. Other web tags
 * still flow through legacy if-blocks in app/api/chat/route.ts and will
 * be migrated incrementally.
 *
 * To migrate a new tag:
 *   1. Add its handler above.
 *   2. Append `{ ...specByName('TAG'), handler: handleTag }` here.
 *   3. Delete the corresponding legacy if-block in route.ts.
 */
function specByName(name: string) {
  const spec = TAG_SPECS.find((s) => s.name === name);
  if (!spec) throw new Error(`[tags] no spec for ${name} — registry out of sync`);
  return spec;
}

export const WEB_WIRED_TAGS: WiredTag<WebTagContext>[] = [
  { ...specByName("LARK_TASK_LIST"), handler: handleLarkTaskList },
  { ...specByName("LARK_TASK"), handler: handleLarkTaskCreate },
  { ...specByName("LARK_TASK_COMPLETE"), handler: handleLarkTaskComplete },
];

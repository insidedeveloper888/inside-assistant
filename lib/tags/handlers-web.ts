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

// ─────────────────────────────────────────────────────────────────────────
// LARK CALENDAR
// ─────────────────────────────────────────────────────────────────────────

const handleLarkEvent: TagHandler<WebTagContext> = async (match, ctx) => {
  if (match.shape !== "pipe") return null;
  if (!ctx.larkToken) {
    return { appendToReply: "⚠️ Lark not connected — connect at /settings/integrations" };
  }
  const [summary, startIso, endIso, attendeesCsv] = match.fields;
  const startTime = new Date(startIso ?? "");
  const endTime = new Date(endIso ?? "");
  if (!summary || Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
    return { appendToReply: "⚠️ LARK_EVENT: invalid summary or dates" };
  }
  const attendeeOpenIds = attendeesCsv
    ? attendeesCsv.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const { larkCreateEvent } = await import("@/lib/lark-tools");
  const started = Date.now();
  const result = await larkCreateEvent({
    token: ctx.larkToken,
    summary,
    startTime,
    endTime,
    attendeeOpenIds,
    needVcMeeting: true,
  });
  const audit = {
    toolName: "lark_create_event",
    provider: "lark" as const,
    input: { summary, startTime: startIso, endTime: endIso, attendeeOpenIds },
    output: result.ok ? { eventId: result.eventId, url: result.url } : null,
    status: result.ok ? ("success" as const) : ("error" as const),
    error: result.ok ? null : result.error,
    durationMs: Date.now() - started,
  };
  if (!result.ok) return { appendToReply: `⚠️ Lark event failed: ${result.error}`, audit };
  return {
    appendToReply: `📅 Event added to your Lark calendar — open Lark to view.\n_event_id: ${result.eventId}_`,
    audit,
  };
};

const handleLarkCalList: TagHandler<WebTagContext> = async (match, ctx) => {
  if (match.shape !== "pipe") return null;
  if (!ctx.larkToken) {
    return { appendToReply: "⚠️ Lark not connected — connect at /settings/integrations" };
  }
  const [startIso, endIso] = match.fields;
  const startTime = new Date(startIso ?? "");
  const endTime = new Date(endIso ?? "");
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
    return { appendToReply: "⚠️ LARK_CAL_LIST: invalid date range" };
  }
  const { larkListMyEvents } = await import("@/lib/lark-tools");
  const started = Date.now();
  const result = await larkListMyEvents({ token: ctx.larkToken, startTime, endTime });
  const audit = {
    toolName: "lark_list_events",
    provider: "lark" as const,
    input: { startIso, endIso, source: "auto_tag" },
    output: result.ok ? { count: result.events.length } : null,
    status: result.ok ? ("success" as const) : ("error" as const),
    error: result.ok ? null : result.error,
    durationMs: Date.now() - started,
  };
  if (!result.ok) return { appendToReply: `⚠️ Calendar fetch failed: ${result.error}`, audit };
  if (result.events.length === 0) return { appendToReply: "📅 No events in that range.", audit };
  const lines = result.events.slice(0, 30).map((e) => {
    const start = e.start_time.timestamp ? new Date(Number(e.start_time.timestamp) * 1000) : null;
    const end = e.end_time.timestamp ? new Date(Number(e.end_time.timestamp) * 1000) : null;
    const timeStr =
      start && end
        ? `${start.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} → ${end.toLocaleString([], { hour: "2-digit", minute: "2-digit" })}`
        : "(no time)";
    const attendees = e.attendees?.map((a) => a.display_name).filter(Boolean).join(", ") ?? "";
    return `- **${e.summary}** — ${timeStr}${attendees ? ` · with ${attendees}` : ""}${e.vchat?.meeting_url ? ` · [Meet](${e.vchat.meeting_url})` : ""}`;
  });
  return { appendToReply: `📅 **Your schedule:**\n${lines.join("\n")}`, audit };
};

const handleLarkEventDelete: TagHandler<WebTagContext> = async (match, ctx) => {
  if (match.shape !== "value") return null;
  if (!ctx.larkToken) {
    return { appendToReply: "⚠️ Lark not connected — connect at /settings/integrations" };
  }
  const eventId = match.value;
  const { larkDeleteEvent } = await import("@/lib/lark-tools");
  const started = Date.now();
  const result = await larkDeleteEvent({ token: ctx.larkToken, eventId });
  const audit = {
    toolName: "lark_delete_event",
    provider: "lark" as const,
    input: { eventId, source: "auto_tag" },
    output: result.ok ? { ok: true } : null,
    status: result.ok ? ("success" as const) : ("error" as const),
    error: result.ok ? null : result.error,
    durationMs: Date.now() - started,
  };
  if (!result.ok) return { appendToReply: `⚠️ Cancel failed: ${result.error}`, audit };
  return { appendToReply: "🗑 Event canceled (attendees notified).", audit };
};

// ─────────────────────────────────────────────────────────────────────────
// LARK DOCS / WHITEBOARD
// ─────────────────────────────────────────────────────────────────────────

const handleLarkDoc: TagHandler<WebTagContext> = async (match, ctx) => {
  if (match.shape !== "value") return null;
  if (!ctx.larkToken) {
    return { appendToReply: "⚠️ Lark not connected — connect at /settings/integrations" };
  }
  const title = match.value.slice(0, 80) || "Untitled note";
  const content = ctx.cleanedReplyBody;
  const { larkCreateDoc } = await import("@/lib/lark-tools");
  const started = Date.now();
  const result = await larkCreateDoc({ token: ctx.larkToken, title, content });
  const audit = {
    toolName: "lark_create_doc",
    provider: "lark" as const,
    input: { title, content_preview: content.slice(0, 500), source: "auto_tag" },
    output: result.ok ? { url: result.url, documentId: result.documentId } : null,
    status: result.ok ? ("success" as const) : ("error" as const),
    error: result.ok ? null : result.error,
    durationMs: Date.now() - started,
  };
  if (!result.ok) return { appendToReply: `⚠️ Lark save failed: ${result.error}`, audit };
  return { appendToReply: `📝 Saved to Lark: [${title}](${result.url})`, audit };
};

const handleLarkBoard: TagHandler<WebTagContext> = async (match, ctx) => {
  if (match.shape !== "value") return null;
  if (!ctx.larkToken) {
    return { appendToReply: "⚠️ Lark not connected — connect at /settings/integrations" };
  }
  const title = match.value.slice(0, 80) || "Untitled board";
  const started = Date.now();
  const res = await fetch("https://open.larksuite.com/open-apis/drive/v1/files/create_file", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.larkToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file_type: "board", name: title }),
  });
  const body = (await res.json()) as { code?: number; msg?: string; data?: { token?: string; url?: string } };
  const audit = {
    toolName: "lark_create_whiteboard",
    provider: "lark" as const,
    input: { title, source: "auto_tag" },
    output: body.code === 0 ? { token: body.data?.token, url: body.data?.url } : null,
    status: body.code === 0 ? ("success" as const) : ("error" as const),
    error: body.code === 0 ? null : body.msg ?? "unknown",
    durationMs: Date.now() - started,
  };
  if (body.code !== 0) return { appendToReply: `⚠️ Whiteboard creation failed: ${body.msg}`, audit };
  const url = body.data?.url ?? `https://inside.sg.larksuite.com/wiki/${body.data?.token ?? ""}`;
  return {
    appendToReply: `🎨 Whiteboard created: [${title}](${url}) — open in Lark to draw`,
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
  { ...specByName("LARK_EVENT"), handler: handleLarkEvent },
  { ...specByName("LARK_EVENT_DELETE"), handler: handleLarkEventDelete },
  { ...specByName("LARK_CAL_LIST"), handler: handleLarkCalList },
  { ...specByName("LARK_DOC"), handler: handleLarkDoc },
  { ...specByName("LARK_BOARD"), handler: handleLarkBoard },
  { ...specByName("LARK_TASK_LIST"), handler: handleLarkTaskList },
  { ...specByName("LARK_TASK"), handler: handleLarkTaskCreate },
  { ...specByName("LARK_TASK_COMPLETE"), handler: handleLarkTaskComplete },
];

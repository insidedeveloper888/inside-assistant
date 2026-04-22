/**
 * Lark user-scoped tools — the full surface.
 *
 * Every exported function takes the authenticated user's own token. Callers MUST
 * pass the token fetched server-side from user_integrations keyed by the session
 * user_id. Never accept a user_id from a request body and use it to look up a
 * token — that'd let one user act as another.
 *
 * Host: open.larksuite.com (Lark international). Swap to open.feishu.cn for Feishu.
 */

import { markdownToLarkBlocks } from "./lark-markdown";

const API = "https://open.larksuite.com";

type LarkResponse<T> = { code: number; msg: string; data?: T };

async function lark<T>(
  path: string,
  init: RequestInit & { token: string }
): Promise<{ ok: true; data: T } | { ok: false; error: string; code?: number }> {
  const { token, headers, ...rest } = init;
  const res = await fetch(`${API}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(headers as Record<string, string> | undefined),
    },
  });
  const body = (await res.json()) as LarkResponse<T>;
  if (body.code !== 0) {
    return { ok: false, error: body.msg ?? `code ${body.code}`, code: body.code };
  }
  return { ok: true, data: body.data as T };
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCS (docx) — create / append / read
// ─────────────────────────────────────────────────────────────────────────────

export async function larkCreateDoc(args: {
  token: string;
  title: string;
  content: string;
  folderToken?: string;
}): Promise<{ ok: true; documentId: string; url: string } | { ok: false; error: string }> {
  const createRes = await lark<{ document: { document_id: string } }>(
    "/open-apis/docx/v1/documents",
    {
      token: args.token,
      method: "POST",
      body: JSON.stringify({
        title: args.title.slice(0, 80),
        ...(args.folderToken ? { folder_token: args.folderToken } : {}),
      }),
    }
  );
  if (!createRes.ok) return { ok: false, error: `create failed: ${createRes.error}` };
  const documentId = createRes.data.document.document_id;

  const blocks = markdownToLarkBlocks(args.content.slice(0, 100000));
  if (blocks.length === 0) {
    blocks.push({ block_type: 2, text: { elements: [{ text_run: { content: "" } }], style: {} } });
  }
  const CHUNK = 50;
  let writtenIndex = 0;
  const skipped: number[] = [];
  for (let offset = 0; offset < blocks.length; offset += CHUNK) {
    const chunk = blocks.slice(offset, offset + CHUNK);
    const appendRes = await lark<unknown>(
      `/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/children?document_revision_id=-1`,
      {
        token: args.token,
        method: "POST",
        body: JSON.stringify({ index: writtenIndex, children: chunk }),
      }
    );
    if (appendRes.ok) {
      writtenIndex += chunk.length;
      continue;
    }
    // Chunk failed — retry block-by-block, skip ones Lark rejects so we don't
    // lose the whole doc over one unsupported block type (e.g. divider).
    for (const block of chunk) {
      const singleRes = await lark<unknown>(
        `/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/children?document_revision_id=-1`,
        {
          token: args.token,
          method: "POST",
          body: JSON.stringify({ index: writtenIndex, children: [block] }),
        }
      );
      if (singleRes.ok) {
        writtenIndex += 1;
      } else {
        skipped.push(block.block_type);
      }
    }
  }
  const note = skipped.length
    ? ` (${skipped.length} unsupported block(s) skipped: types ${[...new Set(skipped)].join(",")})`
    : "";
  return { ok: true, documentId, url: `https://inside.sg.larksuite.com/docx/${documentId}${note ? "" : ""}` };
}

export async function larkAppendDoc(args: {
  token: string;
  documentId: string;
  content: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const blocks = markdownToLarkBlocks(args.content.slice(0, 100000));
  if (blocks.length === 0) return { ok: true };
  const CHUNK = 50;
  for (let offset = 0; offset < blocks.length; offset += CHUNK) {
    const chunk = blocks.slice(offset, offset + CHUNK);
    const res = await lark<unknown>(
      `/open-apis/docx/v1/documents/${args.documentId}/blocks/${args.documentId}/children?document_revision_id=-1`,
      { token: args.token, method: "POST", body: JSON.stringify({ children: chunk }) }
    );
    if (!res.ok) return { ok: false, error: res.error };
  }
  return { ok: true };
}

export async function larkReadDoc(args: {
  token: string;
  documentId: string;
}): Promise<{ ok: true; title: string; content: string } | { ok: false; error: string }> {
  const metaRes = await lark<{ document: { title: string } }>(
    `/open-apis/docx/v1/documents/${args.documentId}`,
    { token: args.token, method: "GET" }
  );
  if (!metaRes.ok) return { ok: false, error: metaRes.error };

  const blocksRes = await lark<{ items: { block_type: number; text?: { elements: { text_run?: { content: string } }[] } }[] }>(
    `/open-apis/docx/v1/documents/${args.documentId}/blocks?page_size=500`,
    { token: args.token, method: "GET" }
  );
  if (!blocksRes.ok) return { ok: false, error: blocksRes.error };

  const content = blocksRes.data.items
    .filter((b) => b.block_type === 2 && b.text?.elements)
    .map((b) => b.text!.elements.map((e) => e.text_run?.content ?? "").join(""))
    .join("\n\n");
  return { ok: true, title: metaRes.data.document.title, content };
}

// ─────────────────────────────────────────────────────────────────────────────
// CALENDAR — list events, freebusy, create event
// Required scopes: calendar:calendar.read, calendar:calendar.event:create,
//                  calendar:freebusy (or calendar:calendar.event:read for own cal)
// ─────────────────────────────────────────────────────────────────────────────

type CalendarEvent = {
  event_id: string;
  summary: string;
  description?: string;
  start_time: { timestamp?: string; timezone?: string };
  end_time: { timestamp?: string; timezone?: string };
  attendees?: { user_id?: string; display_name?: string }[];
  vchat?: { vc_type?: string; meeting_url?: string };
};

/** Find the user's primary calendar id. Lark users have a "primary" calendar. */
async function findPrimaryCalendarId(token: string): Promise<string | null> {
  const res = await lark<{ calendar_list: { calendar_id: string; type: string }[] }>(
    "/open-apis/calendar/v4/calendars",
    { token, method: "GET" }
  );
  if (!res.ok) return null;
  const primary = res.data.calendar_list.find((c) => c.type === "primary");
  return primary?.calendar_id ?? res.data.calendar_list[0]?.calendar_id ?? null;
}

export async function larkListMyEvents(args: {
  token: string;
  startTime: Date;
  endTime: Date;
}): Promise<{ ok: true; events: CalendarEvent[] } | { ok: false; error: string }> {
  const calendarId = await findPrimaryCalendarId(args.token);
  if (!calendarId) return { ok: false, error: "no primary calendar" };

  // Lark v4 events list prefers anchor_time + page_size over strict start/end;
  // strict ranges return 99992402 on empty calendars. Anchor returns events
  // "around" the anchor timestamp within a sliding window.
  const params = new URLSearchParams({
    anchor_time: String(Math.floor(args.startTime.getTime() / 1000)),
    page_size: "50",
  });
  const res = await lark<{ items: CalendarEvent[] }>(
    `/open-apis/calendar/v4/calendars/${calendarId}/events?${params}`,
    { token: args.token, method: "GET" }
  );
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, events: res.data.items ?? [] };
}

/**
 * Check freebusy for one or more user open_ids. Returns busy intervals only
 * (event titles are NOT included — respects Lark's default privacy).
 */
export async function larkCheckFreebusy(args: {
  token: string;
  userIds: string[]; // open_id list
  startTime: Date;
  endTime: Date;
}): Promise<
  | { ok: true; busy: Record<string, { start_time: string; end_time: string }[]> }
  | { ok: false; error: string }
> {
  const toLarkTime = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const res = await lark<{ freebusy_list: { user_id: string; start_time: string; end_time: string }[] }>(
    "/open-apis/calendar/v4/freebusy/list?user_id_type=open_id",
    {
      token: args.token,
      method: "POST",
      body: JSON.stringify({
        time_min: toLarkTime(args.startTime),
        time_max: toLarkTime(args.endTime),
        user_id_list: args.userIds,
        include_external_calendar: true,
        only_busy: true,
      }),
    }
  );
  if (!res.ok) return { ok: false, error: res.error };

  const busy: Record<string, { start_time: string; end_time: string }[]> = {};
  for (const entry of res.data.freebusy_list ?? []) {
    if (!busy[entry.user_id]) busy[entry.user_id] = [];
    busy[entry.user_id].push({ start_time: entry.start_time, end_time: entry.end_time });
  }
  return { ok: true, busy };
}

export async function larkCreateEvent(args: {
  token: string;
  summary: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  timezone?: string;
  attendeeOpenIds?: string[];
  needVcMeeting?: boolean;
}): Promise<{ ok: true; eventId: string; url: string } | { ok: false; error: string }> {
  const calendarId = await findPrimaryCalendarId(args.token);
  if (!calendarId) return { ok: false, error: "no primary calendar" };

  const tz = args.timezone ?? "Asia/Kuala_Lumpur";
  const body: Record<string, unknown> = {
    summary: args.summary.slice(0, 500),
    description: args.description?.slice(0, 5000),
    start_time: { timestamp: String(Math.floor(args.startTime.getTime() / 1000)), timezone: tz },
    end_time: { timestamp: String(Math.floor(args.endTime.getTime() / 1000)), timezone: tz },
    need_notification: true,
  };
  if (args.needVcMeeting) {
    body.vchat = { vc_type: "vc" };
  }

  const createRes = await lark<{ event: { event_id: string } }>(
    `/open-apis/calendar/v4/calendars/${calendarId}/events`,
    { token: args.token, method: "POST", body: JSON.stringify(body) }
  );
  if (!createRes.ok) return { ok: false, error: createRes.error };
  const eventId = createRes.data.event.event_id;

  // Attendees are added in a separate call
  if (args.attendeeOpenIds?.length) {
    await lark<unknown>(
      `/open-apis/calendar/v4/calendars/${calendarId}/events/${eventId}/attendees?user_id_type=open_id`,
      {
        token: args.token,
        method: "POST",
        body: JSON.stringify({
          attendees: args.attendeeOpenIds.map((id) => ({ type: "user", user_id: id })),
          need_notification: true,
        }),
      }
    );
  }

  return {
    ok: true,
    eventId,
    url: `https://inside.sg.larksuite.com/calendar/event/${eventId}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DRIVE — upload files / list folders
// Required scopes: drive:drive, drive:file:upload
// ─────────────────────────────────────────────────────────────────────────────

export async function larkDriveUpload(args: {
  token: string;
  fileName: string;
  fileBytes: Buffer | Uint8Array;
  parentFolderToken?: string;
}): Promise<{ ok: true; fileToken: string; url: string } | { ok: false; error: string }> {
  // For files <20MB use upload_all. Larger files need resumable upload (upload_prepare/part/finish).
  const size = (args.fileBytes as Buffer).length;
  if (size > 20 * 1024 * 1024) {
    return { ok: false, error: "files >20MB need resumable upload — not yet implemented" };
  }

  const formData = new FormData();
  formData.append("file_name", args.fileName);
  formData.append("parent_type", "explorer");
  formData.append("parent_node", args.parentFolderToken ?? ""); // empty = root
  formData.append("size", String(size));
  formData.append(
    "file",
    new Blob([new Uint8Array(args.fileBytes)]),
    args.fileName
  );

  const res = await fetch(`${API}/open-apis/drive/v1/files/upload_all`, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.token}` },
    body: formData,
  });
  const body = (await res.json()) as LarkResponse<{ file_token: string }>;
  if (body.code !== 0 || !body.data?.file_token) {
    return { ok: false, error: body.msg ?? `code ${body.code}` };
  }
  return {
    ok: true,
    fileToken: body.data.file_token,
    url: `https://inside.sg.larksuite.com/file/${body.data.file_token}`,
  };
}

export async function larkDriveListFolder(args: {
  token: string;
  folderToken?: string; // omit for root
}): Promise<
  | { ok: true; files: { token: string; name: string; type: string; url: string }[] }
  | { ok: false; error: string }
> {
  const path = args.folderToken
    ? `/open-apis/drive/v1/files?folder_token=${args.folderToken}&page_size=50`
    : "/open-apis/drive/v1/files?page_size=50";
  const res = await lark<{ files: { token: string; name: string; type: string; url: string }[] }>(
    path,
    { token: args.token, method: "GET" }
  );
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, files: res.data.files ?? [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// IM — read recent messages from a chat
// Required scopes: im:message, im:message:readonly
// ─────────────────────────────────────────────────────────────────────────────

export async function larkListImHistory(args: {
  token: string;
  chatId: string; // oc_... for groups, or open_id for p2p (via container_id_type)
  limit?: number;
}): Promise<
  | { ok: true; messages: { id: string; sender_id: string; create_time: string; text: string }[] }
  | { ok: false; error: string }
> {
  const limit = Math.min(args.limit ?? 20, 50);
  const res = await lark<{ items: { message_id: string; sender: { id: string }; create_time: string; body: { content: string } }[] }>(
    `/open-apis/im/v1/messages?container_id_type=chat&container_id=${args.chatId}&page_size=${limit}`,
    { token: args.token, method: "GET" }
  );
  if (!res.ok) return { ok: false, error: res.error };
  const messages = (res.data.items ?? []).map((m) => {
    let text = "";
    try {
      text = JSON.parse(m.body.content).text ?? "";
    } catch {}
    return { id: m.message_id, sender_id: m.sender.id, create_time: m.create_time, text };
  });
  return { ok: true, messages };
}

// ─────────────────────────────────────────────────────────────────────────────
// BITABLE — add/list records from a multi-dim table
// Required scopes: bitable:app
// ─────────────────────────────────────────────────────────────────────────────

export async function larkBitableAddRecord(args: {
  token: string;
  appToken: string; // the bitable app's token (from URL)
  tableId: string; // the specific table id within the app
  fields: Record<string, unknown>;
}): Promise<{ ok: true; recordId: string } | { ok: false; error: string }> {
  const res = await lark<{ record: { record_id: string } }>(
    `/open-apis/bitable/v1/apps/${args.appToken}/tables/${args.tableId}/records`,
    { token: args.token, method: "POST", body: JSON.stringify({ fields: args.fields }) }
  );
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, recordId: res.data.record.record_id };
}

export async function larkBitableListRecords(args: {
  token: string;
  appToken: string;
  tableId: string;
  filter?: string; // Lark filter expression (OR/AND of field conditions) — optional
  pageSize?: number;
}): Promise<
  | { ok: true; records: { record_id: string; fields: Record<string, unknown> }[] }
  | { ok: false; error: string }
> {
  const qs = new URLSearchParams({ page_size: String(args.pageSize ?? 50) });
  if (args.filter) qs.set("filter", args.filter);
  const res = await lark<{ items: { record_id: string; fields: Record<string, unknown> }[] }>(
    `/open-apis/bitable/v1/apps/${args.appToken}/tables/${args.tableId}/records?${qs}`,
    { token: args.token, method: "GET" }
  );
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, records: res.data.items ?? [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// SHEETS — write a range / append rows
// Required scopes: sheets:spreadsheet
// ─────────────────────────────────────────────────────────────────────────────

export async function larkSheetsAppendRow(args: {
  token: string;
  spreadsheetToken: string;
  sheetId: string;
  values: (string | number | boolean)[][]; // rows of cell values
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await lark<unknown>(
    `/open-apis/sheets/v2/spreadsheets/${args.spreadsheetToken}/values_append?insertDataOption=INSERT_ROWS`,
    {
      token: args.token,
      method: "POST",
      body: JSON.stringify({
        valueRange: { range: `${args.sheetId}!A:A`, values: args.values },
      }),
    }
  );
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// WIKI — list nodes / create page under a space
// Required scopes: wiki:wiki
// ─────────────────────────────────────────────────────────────────────────────

export async function larkWikiListSpaces(args: {
  token: string;
}): Promise<
  | { ok: true; spaces: { space_id: string; name: string }[] }
  | { ok: false; error: string }
> {
  const res = await lark<{ items: { space_id: string; name: string }[] }>(
    "/open-apis/wiki/v2/spaces?page_size=50",
    { token: args.token, method: "GET" }
  );
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, spaces: res.data.items ?? [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// MINUTES (妙记) — fetch a meeting summary by minute_token
// Required scopes: vc:minute / minutes:minutes
// ─────────────────────────────────────────────────────────────────────────────

export async function larkFetchMinutes(args: {
  token: string;
  minuteToken: string;
}): Promise<
  | { ok: true; title: string; summary: string; todos: string[] }
  | { ok: false; error: string }
> {
  const metaRes = await lark<{ minute: { title: string; summary?: string } }>(
    `/open-apis/minutes/v1/minutes/${args.minuteToken}`,
    { token: args.token, method: "GET" }
  );
  if (!metaRes.ok) return { ok: false, error: metaRes.error };

  const todosRes = await lark<{ items: { content: string }[] }>(
    `/open-apis/minutes/v1/minutes/${args.minuteToken}/todos`,
    { token: args.token, method: "GET" }
  );
  const todos = todosRes.ok ? (todosRes.data.items ?? []).map((t) => t.content) : [];

  return {
    ok: true,
    title: metaRes.data.minute.title,
    summary: metaRes.data.minute.summary ?? "",
    todos,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCOPES REQUIRED (updated list — add in Lark App Console → Permissions & Scopes)
// ─────────────────────────────────────────────────────────────────────────────
// docx:document
// drive:drive
// drive:file:upload
// contact:user.base:readonly
// calendar:calendar.read
// calendar:calendar.event
// calendar:freebusy (or the user-facing equivalent depending on app type)
// im:message
// im:message:readonly
// bitable:app
// sheets:spreadsheet
// wiki:wiki
// vc:minute (if available for your app type)
//
// After adding scopes: bump and RELEASE a new version, then users must
// disconnect and reconnect Lark in /settings/integrations to grant the
// expanded consent.

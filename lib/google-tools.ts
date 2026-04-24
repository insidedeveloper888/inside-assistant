/**
 * Google Workspace user-scoped tools.
 *
 * Every exported function takes the authenticated user's own access token.
 * Callers MUST pass the token fetched server-side via getFreshGoogleToken().
 */

type Result<T> = { ok: true } & T | { ok: false; error: string };

async function gfetch<T>(url: string, token: string, init?: RequestInit): Promise<Result<{ data: T }>> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  }
  const data = await res.json();
  return { ok: true, data };
}

// ─────────────────────────────────────────────────────────────────────────────
// CALENDAR
// ─────────────────────────────────────────────────────────────────────────────

export async function googleListEvents(args: {
  token: string;
  startTime: Date;
  endTime: Date;
  maxResults?: number;
}): Promise<Result<{ events: Array<{ id: string; summary: string; start: string; end: string; htmlLink: string }> }>> {
  const params = new URLSearchParams({
    timeMin: args.startTime.toISOString(),
    timeMax: args.endTime.toISOString(),
    maxResults: String(args.maxResults ?? 25),
    singleEvents: "true",
    orderBy: "startTime",
  });
  const r = await gfetch<{ items?: Array<{ id: string; summary: string; start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string }; htmlLink: string }> }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    args.token
  );
  if (!r.ok) return r;
  const events = (r.data.items ?? []).map((e) => ({
    id: e.id,
    summary: e.summary ?? "(no title)",
    start: e.start.dateTime ?? e.start.date ?? "",
    end: e.end.dateTime ?? e.end.date ?? "",
    htmlLink: e.htmlLink,
  }));
  return { ok: true, events };
}

export async function googleCreateEvent(args: {
  token: string;
  summary: string;
  startTime: Date;
  endTime: Date;
  attendeeEmails?: string[];
  addMeetLink?: boolean;
}): Promise<Result<{ eventId: string; htmlLink: string }>> {
  const body: Record<string, unknown> = {
    summary: args.summary,
    start: { dateTime: args.startTime.toISOString(), timeZone: "Asia/Kuala_Lumpur" },
    end: { dateTime: args.endTime.toISOString(), timeZone: "Asia/Kuala_Lumpur" },
  };
  if (args.attendeeEmails?.length) {
    body.attendees = args.attendeeEmails.map((email) => ({ email }));
  }
  if (args.addMeetLink !== false) {
    body.conferenceData = {
      createRequest: { requestId: `meet-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } },
    };
  }
  const params = args.addMeetLink !== false ? "?conferenceDataVersion=1" : "";
  const r = await gfetch<{ id: string; htmlLink: string }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events${params}`,
    args.token,
    { method: "POST", body: JSON.stringify(body) }
  );
  if (!r.ok) return r;
  return { ok: true, eventId: r.data.id, htmlLink: r.data.htmlLink };
}

export async function googleDeleteEvent(args: {
  token: string;
  eventId: string;
}): Promise<Result<{ deleted: true }>> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${args.eventId}?sendUpdates=all`,
    { method: "DELETE", headers: { Authorization: `Bearer ${args.token}` } }
  );
  if (!res.ok && res.status !== 204) {
    return { ok: false, error: `HTTP ${res.status}` };
  }
  return { ok: true, deleted: true };
}

export async function googleCheckFreebusy(args: {
  token: string;
  emails: string[];
  startTime: Date;
  endTime: Date;
}): Promise<Result<{ busy: Record<string, Array<{ start: string; end: string }>> }>> {
  const r = await gfetch<{ calendars: Record<string, { busy: Array<{ start: string; end: string }> }> }>(
    "https://www.googleapis.com/calendar/v3/freeBusy",
    args.token,
    {
      method: "POST",
      body: JSON.stringify({
        timeMin: args.startTime.toISOString(),
        timeMax: args.endTime.toISOString(),
        items: args.emails.map((id) => ({ id })),
      }),
    }
  );
  if (!r.ok) return r;
  const busy: Record<string, Array<{ start: string; end: string }>> = {};
  for (const [email, cal] of Object.entries(r.data.calendars ?? {})) {
    if (cal.busy?.length) busy[email] = cal.busy;
  }
  return { ok: true, busy };
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCS
// ─────────────────────────────────────────────────────────────────────────────

export async function googleCreateDoc(args: {
  token: string;
  title: string;
  content?: string;
}): Promise<Result<{ documentId: string; url: string }>> {
  const r = await gfetch<{ documentId: string }>(
    "https://docs.googleapis.com/v1/documents",
    args.token,
    { method: "POST", body: JSON.stringify({ title: args.title }) }
  );
  if (!r.ok) return r;
  const documentId = r.data.documentId;

  if (args.content) {
    await fetch(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{ insertText: { location: { index: 1 }, text: args.content } }],
      }),
    });
  }

  return { ok: true, documentId, url: `https://docs.google.com/document/d/${documentId}/edit` };
}

// ─────────────────────────────────────────────────────────────────────────────
// SHEETS
// ─────────────────────────────────────────────────────────────────────────────

export async function googleCreateSheet(args: {
  token: string;
  title: string;
  headers?: string[];
  rows?: string[][];
}): Promise<Result<{ spreadsheetId: string; url: string }>> {
  const r = await gfetch<{ spreadsheetId: string }>(
    "https://sheets.googleapis.com/v4/spreadsheets",
    args.token,
    {
      method: "POST",
      body: JSON.stringify({ properties: { title: args.title } }),
    }
  );
  if (!r.ok) return r;
  const spreadsheetId = r.data.spreadsheetId;

  const allRows: string[][] = [];
  if (args.headers) allRows.push(args.headers);
  if (args.rows) allRows.push(...args.rows);

  if (allRows.length > 0) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:append?valueInputOption=USER_ENTERED`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${args.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: allRows }),
      }
    );
  }

  return { ok: true, spreadsheetId, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` };
}

export async function googleReadSheet(args: {
  token: string;
  spreadsheetId: string;
  range?: string;
}): Promise<Result<{ values: string[][] }>> {
  const range = args.range ?? "Sheet1";
  const r = await gfetch<{ values?: string[][] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${args.spreadsheetId}/values/${encodeURIComponent(range)}`,
    args.token
  );
  if (!r.ok) return r;
  return { ok: true, values: r.data.values ?? [] };
}

export async function googleAppendSheetRows(args: {
  token: string;
  spreadsheetId: string;
  rows: string[][];
  range?: string;
}): Promise<Result<{ updatedRows: number }>> {
  const range = args.range ?? "Sheet1!A1";
  const r = await gfetch<{ updates?: { updatedRows?: number } }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${args.spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`,
    args.token,
    { method: "POST", body: JSON.stringify({ values: args.rows }) }
  );
  if (!r.ok) return r;
  return { ok: true, updatedRows: r.data.updates?.updatedRows ?? 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// DRIVE
// ─────────────────────────────────────────────────────────────────────────────

export async function googleDriveUpload(args: {
  token: string;
  fileName: string;
  mimeType: string;
  fileBytes: ArrayBuffer;
  folderId?: string;
}): Promise<Result<{ fileId: string; url: string }>> {
  const metadata: Record<string, unknown> = { name: args.fileName, mimeType: args.mimeType };
  if (args.folderId) metadata.parents = [args.folderId];

  const boundary = "----GoogleDriveBoundary" + Date.now();
  const metaPart = JSON.stringify(metadata);
  const body = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaPart}\r\n`,
    `--${boundary}\r\nContent-Type: ${args.mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n`,
  ].join("");

  const base64 = Buffer.from(args.fileBytes).toString("base64");
  const fullBody = body + base64 + `\r\n--${boundary}--`;

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: fullBody,
    }
  );
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  const data = await res.json();
  return { ok: true, fileId: data.id, url: `https://drive.google.com/file/d/${data.id}/view` };
}

export async function googleDriveList(args: {
  token: string;
  query?: string;
  maxResults?: number;
}): Promise<Result<{ files: Array<{ id: string; name: string; mimeType: string; webViewLink: string }> }>> {
  const params = new URLSearchParams({
    pageSize: String(args.maxResults ?? 20),
    fields: "files(id,name,mimeType,webViewLink)",
    orderBy: "modifiedTime desc",
  });
  if (args.query) params.set("q", args.query);
  const r = await gfetch<{ files?: Array<{ id: string; name: string; mimeType: string; webViewLink: string }> }>(
    `https://www.googleapis.com/drive/v3/files?${params}`,
    args.token
  );
  if (!r.ok) return r;
  return { ok: true, files: r.data.files ?? [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// GMAIL
// ─────────────────────────────────────────────────────────────────────────────

export async function googleSendEmail(args: {
  token: string;
  to: string;
  subject: string;
  body: string;
  cc?: string;
}): Promise<Result<{ messageId: string }>> {
  const lines = [
    `To: ${args.to}`,
    args.cc ? `Cc: ${args.cc}` : "",
    `Subject: ${args.subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    args.body,
  ].filter(Boolean).join("\r\n");

  const raw = Buffer.from(lines).toString("base64url");
  const r = await gfetch<{ id: string }>(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    args.token,
    { method: "POST", body: JSON.stringify({ raw }) }
  );
  if (!r.ok) return r;
  return { ok: true, messageId: r.data.id };
}

export async function googleReadEmails(args: {
  token: string;
  query?: string;
  maxResults?: number;
}): Promise<Result<{ messages: Array<{ id: string; snippet: string; from: string; subject: string; date: string }> }>> {
  const params = new URLSearchParams({
    maxResults: String(args.maxResults ?? 10),
  });
  if (args.query) params.set("q", args.query);

  const listR = await gfetch<{ messages?: Array<{ id: string }> }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
    args.token
  );
  if (!listR.ok) return listR;

  const messages: Array<{ id: string; snippet: string; from: string; subject: string; date: string }> = [];
  for (const m of (listR.data.messages ?? []).slice(0, args.maxResults ?? 10)) {
    const detailR = await gfetch<{
      id: string;
      snippet: string;
      payload: { headers: Array<{ name: string; value: string }> };
    }>(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      args.token
    );
    if (!detailR.ok) continue;
    const hdrs = detailR.data.payload.headers;
    messages.push({
      id: detailR.data.id,
      snippet: detailR.data.snippet,
      from: hdrs.find((h) => h.name === "From")?.value ?? "",
      subject: hdrs.find((h) => h.name === "Subject")?.value ?? "",
      date: hdrs.find((h) => h.name === "Date")?.value ?? "",
    });
  }
  return { ok: true, messages };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTACTS
// ─────────────────────────────────────────────────────────────────────────────

export async function googleListContacts(args: {
  token: string;
  query?: string;
  maxResults?: number;
}): Promise<Result<{ contacts: Array<{ name: string; email: string; phone: string }> }>> {
  const pageSize = args.maxResults ?? 20;
  let url: string;
  if (args.query) {
    url = `https://people.googleapis.com/v1/people:searchContacts?query=${encodeURIComponent(args.query)}&readMask=names,emailAddresses,phoneNumbers&pageSize=${pageSize}`;
  } else {
    url = `https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers&pageSize=${pageSize}&sortOrder=LAST_MODIFIED_DESCENDING`;
  }
  const r = await gfetch<{
    connections?: Array<{ names?: Array<{ displayName: string }>; emailAddresses?: Array<{ value: string }>; phoneNumbers?: Array<{ value: string }> }>;
    results?: Array<{ person: { names?: Array<{ displayName: string }>; emailAddresses?: Array<{ value: string }>; phoneNumbers?: Array<{ value: string }> } }>;
  }>(url, args.token);
  if (!r.ok) return r;

  const people = args.query
    ? (r.data.results ?? []).map((p) => p.person)
    : (r.data.connections ?? []);

  const contacts = people.map((p) => ({
    name: p.names?.[0]?.displayName ?? "",
    email: p.emailAddresses?.[0]?.value ?? "",
    phone: p.phoneNumbers?.[0]?.value ?? "",
  }));
  return { ok: true, contacts };
}

// ─────────────────────────────────────────────────────────────────────────────
// TASKS
// ─────────────────────────────────────────────────────────────────────────────

export async function googleCreateTask(args: {
  token: string;
  title: string;
  notes?: string;
  dueDate?: Date;
}): Promise<Result<{ taskId: string }>> {
  // Get default task list
  const listsR = await gfetch<{ items?: Array<{ id: string }> }>(
    "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
    args.token
  );
  if (!listsR.ok) return listsR;
  const listId = listsR.data.items?.[0]?.id;
  if (!listId) return { ok: false, error: "No task list found" };

  const body: Record<string, unknown> = { title: args.title };
  if (args.notes) body.notes = args.notes;
  if (args.dueDate) body.due = args.dueDate.toISOString();

  const r = await gfetch<{ id: string }>(
    `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`,
    args.token,
    { method: "POST", body: JSON.stringify(body) }
  );
  if (!r.ok) return r;
  return { ok: true, taskId: r.data.id };
}

export async function googleListTasks(args: {
  token: string;
  maxResults?: number;
}): Promise<Result<{ tasks: Array<{ id: string; title: string; status: string; due: string | null }> }>> {
  const listsR = await gfetch<{ items?: Array<{ id: string }> }>(
    "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
    args.token
  );
  if (!listsR.ok) return listsR;
  const listId = listsR.data.items?.[0]?.id;
  if (!listId) return { ok: true, tasks: [] };

  const r = await gfetch<{ items?: Array<{ id: string; title: string; status: string; due?: string }> }>(
    `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks?maxResults=${args.maxResults ?? 20}&showCompleted=false`,
    args.token
  );
  if (!r.ok) return r;
  const tasks = (r.data.items ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    due: t.due ?? null,
  }));
  return { ok: true, tasks };
}

// ─────────────────────────────────────────────────────────────────────────────
// MEET
// ─────────────────────────────────────────────────────────────────────────────

export async function googleCreateMeetLink(args: {
  token: string;
}): Promise<Result<{ meetLink: string }>> {
  // Create a Meet space via the Meet REST API
  const r = await gfetch<{ meetingUri: string }>(
    "https://meet.googleapis.com/v2/spaces",
    args.token,
    { method: "POST", body: JSON.stringify({}) }
  );
  if (!r.ok) {
    // Fallback: create a calendar event with Meet link
    const now = new Date();
    const later = new Date(Date.now() + 30 * 60_000);
    const eventR = await googleCreateEvent({
      token: args.token,
      summary: "Quick Meeting",
      startTime: now,
      endTime: later,
      addMeetLink: true,
    });
    if (!eventR.ok) return eventR;
    return { ok: true, meetLink: eventR.htmlLink };
  }
  return { ok: true, meetLink: r.data.meetingUri };
}

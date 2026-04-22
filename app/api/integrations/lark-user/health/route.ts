import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getFreshLarkToken } from "@/lib/lark-token";

export const runtime = "nodejs";
export const maxDuration = 30;

type CheckResult = {
  ok: boolean;
  detail: string;
  requiredScope: string;
};

/**
 * End-to-end Lark health check for the current user's token.
 * Runs one lightweight call per capability. No writes except a doc-create
 * test (the test doc is left in Drive root; user can delete it manually).
 *
 * Returns a map of capability → {ok, detail, requiredScope} so the UI can
 * show per-feature pass/fail with the exact scope to re-add if anything
 * fails with 99991672 / 1254302 "permission denied".
 */
export async function GET() {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const fresh = await getFreshLarkToken(admin, user.id);
  if (!fresh) {
    return NextResponse.json({
      error: "Lark token expired or not refreshable — please Disconnect and Connect Lark again",
    }, { status: 400 });
  }
  const token = fresh.token;
  const integration = { external_id: fresh.openId };
  const API = "https://open.larksuite.com";
  const headers = { Authorization: `Bearer ${token}` };
  const jsonHeaders = { ...headers, "Content-Type": "application/json" };

  const results: Record<string, CheckResult> = {};

  // 1. Token validity + basic profile
  try {
    const r = await fetch(`${API}/open-apis/authen/v1/user_info`, { headers });
    const b = await r.json();
    results.token_valid = {
      ok: b.code === 0,
      detail: b.code === 0 ? `user: ${b.data?.name ?? "?"}` : `${b.code}: ${b.msg}`,
      requiredScope: "contact:user.base:readonly",
    };
  } catch (e) {
    results.token_valid = { ok: false, detail: String(e), requiredScope: "contact:user.base:readonly" };
  }

  // 2. Drive list (read)
  try {
    const r = await fetch(`${API}/open-apis/drive/v1/files?page_size=1`, { headers });
    const b = await r.json();
    results.drive_list = {
      ok: b.code === 0,
      detail: b.code === 0 ? `files: ${(b.data?.files?.length ?? 0)}` : `${b.code}: ${b.msg}`,
      requiredScope: "drive:drive",
    };
  } catch (e) {
    results.drive_list = { ok: false, detail: String(e), requiredScope: "drive:drive" };
  }

  // 3. Drive upload (tiny text file — proves drive:file:upload is granted)
  try {
    const formData = new FormData();
    const payload = new Uint8Array(new TextEncoder().encode(`Inside Assistant health check — ${new Date().toISOString()}\n`));
    formData.append("file_name", `inside-health-${Date.now()}.txt`);
    formData.append("parent_type", "explorer");
    formData.append("parent_node", "");
    formData.append("size", String(payload.length));
    formData.append("file", new Blob([payload], { type: "text/plain" }), `inside-health-${Date.now()}.txt`);
    const r = await fetch(`${API}/open-apis/drive/v1/files/upload_all`, {
      method: "POST",
      headers,
      body: formData,
    });
    const b = await r.json();
    results.drive_upload = {
      ok: b.code === 0,
      detail: b.code === 0 ? `file: ${b.data?.file_token?.slice(0, 10)}…` : `${b.code}: ${b.msg}`,
      requiredScope: "drive:file:upload",
    };
  } catch (e) {
    results.drive_upload = { ok: false, detail: String(e), requiredScope: "drive:file:upload" };
  }

  // 4. Doc create — create one test doc (left in Drive root; user can delete)
  let testDocUrl: string | null = null;
  try {
    const r = await fetch(`${API}/open-apis/docx/v1/documents`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ title: `Inside Assistant Health Check — ${new Date().toISOString().slice(0, 16)}` }),
    });
    const b = await r.json();
    if (b.code === 0 && b.data?.document?.document_id) {
      testDocUrl = `https://inside.sg.larksuite.com/docx/${b.data.document.document_id}`;
    }
    results.doc_create = {
      ok: b.code === 0,
      detail: b.code === 0 ? `doc created: ${b.data?.document?.document_id?.slice(0, 10)}…` : `${b.code}: ${b.msg}`,
      requiredScope: "docx:document",
    };
  } catch (e) {
    results.doc_create = { ok: false, detail: String(e), requiredScope: "docx:document" };
  }

  // 5. Calendar list
  let calendarId: string | null = null;
  try {
    const r = await fetch(`${API}/open-apis/calendar/v4/calendars`, { headers });
    const b = await r.json();
    if (b.code === 0) {
      const primary = b.data?.calendar_list?.find((c: { type: string }) => c.type === "primary") ?? b.data?.calendar_list?.[0];
      calendarId = primary?.calendar_id ?? null;
    }
    results.calendar_list = {
      ok: b.code === 0,
      detail: b.code === 0 ? `calendars: ${(b.data?.calendar_list?.length ?? 0)}` : `${b.code}: ${b.msg}`,
      requiredScope: "calendar:calendar.read",
    };
  } catch (e) {
    results.calendar_list = { ok: false, detail: String(e), requiredScope: "calendar:calendar.read" };
  }

  // 6. Freebusy self-check. Lark requires time with explicit +HH:MM timezone
  //    (not 'Z'), and rejects unknown fields. Use user_id (singular, self) form.
  try {
    const selfOpenId = (integration.external_id as string) ?? null;
    if (selfOpenId) {
      const toLarkTime = (d: Date) => {
        const iso = d.toISOString(); // 2026-04-22T11:00:00.000Z
        return iso.replace(/\.\d{3}Z$/, "+00:00");
      };
      const r = await fetch(`${API}/open-apis/calendar/v4/freebusy/list?user_id_type=open_id`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          time_min: toLarkTime(new Date()),
          time_max: toLarkTime(new Date(Date.now() + 24 * 3600_000)),
          user_id: selfOpenId,
        }),
      });
      const b = await r.json();
      results.calendar_freebusy = {
        ok: b.code === 0,
        detail: b.code === 0 ? `checked self next 24h` : `${b.code}: ${b.msg}`,
        requiredScope: "calendar:calendar.free_busy:read",
      };
    } else {
      results.calendar_freebusy = { ok: false, detail: "no self open_id", requiredScope: "calendar:calendar.free_busy:read" };
    }
  } catch (e) {
    results.calendar_freebusy = { ok: false, detail: String(e), requiredScope: "calendar:calendar.free_busy:read" };
  }

  // 7. Calendar events list — use anchor_time (now) without start/end range,
  //    which Lark accepts as "events near anchor". start_time/end_time are
  //    strict and return 99992402 when the calendar is empty.
  if (calendarId) {
    // Lark events list requires EITHER (start_time + end_time) OR (sync_token/
    // page_token). Times must be epoch seconds as strings. page_size optional.
    try {
      const params = new URLSearchParams({
        start_time: String(Math.floor(Date.now() / 1000)),
        end_time: String(Math.floor((Date.now() + 7 * 24 * 3600_000) / 1000)),
      });
      const r = await fetch(`${API}/open-apis/calendar/v4/calendars/${calendarId}/events?${params}`, { headers });
      const b = await r.json();
      results.calendar_events = {
        ok: b.code === 0,
        detail: b.code === 0 ? `events next 7d: ${(b.data?.items?.length ?? 0)}` : `${b.code}: ${b.msg}`,
        requiredScope: "calendar:calendar.event:read",
      };
    } catch (e) {
      results.calendar_events = { ok: false, detail: String(e), requiredScope: "calendar:calendar.event:read" };
    }
  }

  // 8. IM — list messages from a fake chat id (we expect permission-level check,
  //    even though the chat id won't exist the error tells us if the scope exists)
  try {
    const r = await fetch(`${API}/open-apis/im/v1/messages?container_id_type=chat&container_id=oc_fake_probe&page_size=1`, { headers });
    const b = await r.json();
    const scopeOk = b.code !== 99991672 && b.code !== 99991679; // permission errors
    results.im_read = {
      ok: scopeOk,
      detail: scopeOk ? `scope granted (chat-not-found is expected for probe)` : `${b.code}: ${b.msg}`,
      requiredScope: "im:message:readonly",
    };
  } catch (e) {
    results.im_read = { ok: false, detail: String(e), requiredScope: "im:message:readonly" };
  }

  const passed = Object.values(results).filter((r) => r.ok).length;
  const total = Object.keys(results).length;

  return NextResponse.json({
    summary: { passed, total, ok: passed === total },
    results,
    test_doc_url: testDocUrl,
    note: "Test artifacts created: 1 Drive file + 1 Lark doc (both safe to delete manually).",
  });
}

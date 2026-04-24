import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getFreshGoogleToken } from "@/lib/google-token";

export const runtime = "nodejs";

type CheckResult = { ok: boolean; detail: string; scope: string };

async function check(
  name: string,
  scope: string,
  fn: () => Promise<{ ok: boolean; detail: string }>
): Promise<[string, CheckResult]> {
  try {
    const result = await fn();
    return [name, { ...result, scope }];
  } catch (err) {
    return [name, { ok: false, detail: err instanceof Error ? err.message : String(err), scope }];
  }
}

export async function GET() {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const fresh = await getFreshGoogleToken(admin, user.id);
  if (!fresh) {
    return NextResponse.json({ error: "Google not connected or token expired" }, { status: 404 });
  }

  const { token } = fresh;
  const h = { Authorization: `Bearer ${token}` };

  const checks = await Promise.all([
    check("profile", "userinfo.profile", async () => {
      const r = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: h });
      if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
      const d = await r.json();
      return { ok: true, detail: `${d.name} (${d.email})` };
    }),

    check("calendar_list", "calendar.events", async () => {
      const r = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary", { headers: h });
      if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
      const d = await r.json();
      return { ok: true, detail: `primary: ${d.summary}` };
    }),

    check("calendar_freebusy", "calendar.freebusy", async () => {
      const now = new Date();
      const later = new Date(Date.now() + 24 * 60 * 60_000);
      const r = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
        method: "POST",
        headers: { ...h, "Content-Type": "application/json" },
        body: JSON.stringify({
          timeMin: now.toISOString(),
          timeMax: later.toISOString(),
          items: [{ id: "primary" }],
        }),
      });
      if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
      return { ok: true, detail: "freebusy query OK" };
    }),

    check("gmail", "gmail.modify", async () => {
      const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: h });
      if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
      const d = await r.json();
      return { ok: true, detail: `${d.emailAddress}, ${d.messagesTotal} messages` };
    }),

    check("drive", "drive", async () => {
      const r = await fetch("https://www.googleapis.com/drive/v3/about?fields=user", { headers: h });
      if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
      const d = await r.json();
      return { ok: true, detail: `drive user: ${d.user?.displayName}` };
    }),

    check("docs", "documents", async () => {
      const r = await fetch("https://docs.googleapis.com/v1/documents", {
        method: "POST",
        headers: { ...h, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "[Health Check] Test Doc — safe to delete" }),
      });
      if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
      const d = await r.json();
      return { ok: true, detail: `created doc: ${d.documentId}` };
    }),

    check("sheets", "spreadsheets", async () => {
      const r = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
        method: "POST",
        headers: { ...h, "Content-Type": "application/json" },
        body: JSON.stringify({ properties: { title: "[Health Check] Test Sheet — safe to delete" } }),
      });
      if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
      const d = await r.json();
      return { ok: true, detail: `created sheet: ${d.spreadsheetId}` };
    }),

    check("contacts", "contacts.readonly", async () => {
      const r = await fetch("https://people.googleapis.com/v1/people/me?personFields=names,emailAddresses", { headers: h });
      if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
      return { ok: true, detail: "contacts access OK" };
    }),

    check("tasks", "tasks", async () => {
      const r = await fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists", { headers: h });
      if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
      const d = await r.json();
      return { ok: true, detail: `${(d.items ?? []).length} task lists` };
    }),
  ]);

  const results = Object.fromEntries(checks);
  const passed = checks.filter(([, r]) => r.ok).length;

  return NextResponse.json({
    summary: { passed, total: checks.length, ok: passed === checks.length },
    results,
  });
}

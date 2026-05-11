import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

/**
 * One-time backfill for users who connected Lark via OAuth BEFORE the
 * callback was patched to propagate lark_open_id to assistant_user_settings
 * and ai_reply_whitelist (commit fixing Tong Xin's "not connected" bug).
 *
 * For each user that has a user_integrations(provider=lark_user) row but
 * an empty lark_open_id in their assistant_user_settings, copy the value
 * across. Same for the matching ai_reply_whitelist row (matched by phone).
 *
 * Director-only. POST /api/admin/lark-link-sync (no body needed).
 *
 * Idempotent — safe to re-run.
 */

export const runtime = "nodejs";

async function requireDirector() {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("assistant_user_settings").select("role").eq("user_id", user.id).single();
  if (!settings || settings.role !== "director") {
    return { error: NextResponse.json({ error: "Directors only" }, { status: 403 }) };
  }
  return { admin };
}

export async function POST() {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  // Pull every Lark integration with a valid open_id.
  const { data: integrations, error: intErr } = await admin
    .from("user_integrations")
    .select("user_id, external_id, config")
    .eq("provider", "lark_user")
    .not("external_id", "is", null);
  if (intErr) return NextResponse.json({ error: intErr.message }, { status: 500 });
  if (!integrations || integrations.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, settings_updated: 0, whitelist_updated: 0 });
  }

  let settingsUpdated = 0;
  let whitelistUpdated = 0;
  const details: Array<{ user_id: string; status: string; phone?: string | null }> = [];

  for (const integ of integrations) {
    const userId = integ.user_id as string;
    const openId = integ.external_id as string;
    const cfg = (integ.config ?? {}) as Record<string, unknown>;
    const larkName = typeof cfg.name === "string" ? cfg.name : null;

    // 1. Update assistant_user_settings — read current state first to avoid
    //    overwriting a manually-set lark_name that differs from OAuth.
    const { data: cur } = await admin
      .from("assistant_user_settings")
      .select("phone, lark_open_id, lark_verified, lark_name")
      .eq("user_id", userId)
      .maybeSingle();

    if (!cur) {
      details.push({ user_id: userId, status: "no-settings-row" });
      continue;
    }

    if (cur.lark_open_id !== openId || !cur.lark_verified) {
      await admin
        .from("assistant_user_settings")
        .update({
          lark_open_id: openId,
          lark_verified: true,
          lark_name: cur.lark_name ?? larkName, // don't clobber manual edits
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
      settingsUpdated++;
    }

    // 2. Update ai_reply_whitelist via phone.
    if (cur.phone) {
      const { data: wlRows } = await admin
        .from("ai_reply_whitelist")
        .select("id, lark_open_id")
        .eq("phone", cur.phone);
      const stale = (wlRows ?? []).filter((r) => r.lark_open_id !== openId);
      if (stale.length > 0) {
        await admin
          .from("ai_reply_whitelist")
          .update({ lark_open_id: openId, updated_at: new Date().toISOString() })
          .in("id", stale.map((r) => r.id));
        whitelistUpdated += stale.length;
      }
      details.push({ user_id: userId, status: "synced", phone: cur.phone });
    } else {
      details.push({ user_id: userId, status: "no-phone-set" });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: integrations.length,
    settings_updated: settingsUpdated,
    whitelist_updated: whitelistUpdated,
    details,
  });
}

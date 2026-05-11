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

  // Collect (user_id → open_id) from BOTH sources:
  //   a. user_integrations.lark_user   — OAuth-linked (verified)
  //   b. assistant_user_settings       — admin-linked via /admin Members
  //                                       (Tong Xin's case: admin picked her
  //                                       from the Lark directory, no OAuth)
  // OAuth wins on conflict since it's the verified channel.
  const { data: integrations } = await admin
    .from("user_integrations")
    .select("user_id, external_id, config")
    .eq("provider", "lark_user")
    .not("external_id", "is", null);

  const { data: settingsRows } = await admin
    .from("assistant_user_settings")
    .select("user_id, phone, lark_open_id, lark_name")
    .not("lark_open_id", "is", null);

  type Mapping = {
    user_id: string;
    open_id: string;
    lark_name: string | null;
    phone: string | null;
    source: "oauth" | "admin-set";
  };
  const mappings = new Map<string, Mapping>();

  for (const row of settingsRows ?? []) {
    if (!row.lark_open_id) continue;
    mappings.set(row.user_id as string, {
      user_id: row.user_id as string,
      open_id: row.lark_open_id as string,
      lark_name: (row.lark_name as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
      source: "admin-set",
    });
  }
  for (const integ of integrations ?? []) {
    const cfg = (integ.config ?? {}) as Record<string, unknown>;
    const existing = mappings.get(integ.user_id as string);
    mappings.set(integ.user_id as string, {
      user_id: integ.user_id as string,
      open_id: integ.external_id as string,
      lark_name: typeof cfg.name === "string" ? cfg.name : existing?.lark_name ?? null,
      phone: existing?.phone ?? null,
      source: "oauth",
    });
  }

  if (mappings.size === 0) {
    return NextResponse.json({ ok: true, processed: 0, settings_updated: 0, whitelist_updated: 0, details: [] });
  }

  let settingsUpdated = 0;
  let whitelistUpdated = 0;
  const details: Array<{ user_id: string; status: string; phone?: string | null; source?: string }> = [];

  for (const m of mappings.values()) {
    const { data: cur } = await admin
      .from("assistant_user_settings")
      .select("phone, lark_open_id, lark_verified, lark_name")
      .eq("user_id", m.user_id)
      .maybeSingle();

    if (!cur) {
      details.push({ user_id: m.user_id, status: "no-settings-row", source: m.source });
      continue;
    }

    if (cur.lark_open_id !== m.open_id || !cur.lark_verified) {
      await admin
        .from("assistant_user_settings")
        .update({
          lark_open_id: m.open_id,
          lark_verified: true,
          lark_name: cur.lark_name ?? m.lark_name,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", m.user_id);
      settingsUpdated++;
    }

    const phone = cur.phone ?? m.phone;
    if (phone) {
      const { data: wlRows } = await admin
        .from("ai_reply_whitelist")
        .select("id, lark_open_id")
        .eq("phone", phone);
      const stale = (wlRows ?? []).filter((r) => r.lark_open_id !== m.open_id);
      if (stale.length > 0) {
        await admin
          .from("ai_reply_whitelist")
          .update({ lark_open_id: m.open_id, updated_at: new Date().toISOString() })
          .in("id", stale.map((r) => r.id));
        whitelistUpdated += stale.length;
      }
      details.push({ user_id: m.user_id, status: "synced", phone, source: m.source });
    } else {
      details.push({ user_id: m.user_id, status: "no-phone-set", source: m.source });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: mappings.size,
    settings_updated: settingsUpdated,
    whitelist_updated: whitelistUpdated,
    details,
  });
}

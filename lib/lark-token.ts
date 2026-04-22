import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Get a fresh Lark user access token. Checks expires_at; if within 60s of
 * expiry (or already expired), uses the stored refresh_token to mint a new
 * access token and writes it back. Returns null if refresh itself fails —
 * caller should surface "please reconnect Lark" to the user.
 *
 * Lark user access tokens live ~2 hours. Refresh tokens live ~30 days.
 * After 30 days the user must go through OAuth again; there's no longer-
 * lived option on Lark's side.
 */
export async function getFreshLarkToken(
  admin: SupabaseClient,
  userId: string
): Promise<{ token: string; openId: string | null } | null> {
  const { data: row } = await admin
    .from("user_integrations")
    .select("access_token, refresh_token, expires_at, external_id")
    .eq("user_id", userId)
    .eq("provider", "lark_user")
    .single();

  if (!row?.access_token) return null;

  const expiresAt = row.expires_at ? new Date(row.expires_at as string).getTime() : 0;
  const soon = Date.now() + 60_000;
  if (expiresAt > soon) {
    return { token: row.access_token as string, openId: (row.external_id as string) ?? null };
  }

  if (!row.refresh_token) {
    return null;
  }

  const appId = (process.env.LARK_APP_ID || "").trim();
  const appSecret = (process.env.LARK_APP_SECRET || "").trim();
  if (!appId || !appSecret) return null;

  const appTokRes = await fetch(
    "https://open.larksuite.com/open-apis/auth/v3/app_access_token/internal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    }
  );
  const appTok = await appTokRes.json();
  if (appTok.code !== 0 || !appTok.app_access_token) return null;

  const refreshRes = await fetch(
    "https://open.larksuite.com/open-apis/authen/v1/refresh_access_token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${appTok.app_access_token}`,
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: row.refresh_token,
      }),
    }
  );
  const refreshBody = await refreshRes.json();

  if (refreshBody.code !== 0 || !refreshBody.data?.access_token) {
    console.warn(`[lark-token] refresh failed for user ${userId}:`, refreshBody.code, refreshBody.msg);
    return null;
  }

  const d = refreshBody.data;
  const newExpiresAt = new Date(Date.now() + (d.expires_in ?? 7200) * 1000).toISOString();

  await admin.from("user_integrations").update({
    access_token: d.access_token,
    refresh_token: d.refresh_token ?? row.refresh_token,
    expires_at: newExpiresAt,
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId).eq("provider", "lark_user");

  return { token: d.access_token, openId: (row.external_id as string) ?? null };
}

import type { SupabaseClient } from "@supabase/supabase-js";

const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || "").trim();
const GOOGLE_CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || "").trim();

/**
 * Get a fresh Google access token. Checks expires_at; if within 60s of
 * expiry, uses the stored refresh_token to mint a new access token.
 * Returns null if refresh fails — caller should surface "please reconnect Google".
 *
 * Google access tokens live ~1 hour. Refresh tokens are long-lived and reusable
 * (unlike Lark's single-use refresh tokens, no race condition concern).
 */
export async function getFreshGoogleToken(
  admin: SupabaseClient,
  userId: string
): Promise<{ token: string; email: string | null } | null> {
  const { data: row } = await admin
    .from("user_integrations")
    .select("access_token, refresh_token, expires_at, external_id")
    .eq("user_id", userId)
    .eq("provider", "google")
    .single();

  if (!row?.access_token) return null;

  const expiresAt = row.expires_at ? new Date(row.expires_at as string).getTime() : 0;
  const soon = Date.now() + 60_000;
  if (expiresAt > soon) {
    return { token: row.access_token as string, email: (row.external_id as string) ?? null };
  }

  if (!row.refresh_token) return null;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return null;

  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: row.refresh_token as string,
      grant_type: "refresh_token",
    }),
  });

  const refreshData = await refreshRes.json();
  if (!refreshRes.ok || !refreshData.access_token) {
    console.warn(`[google-token] refresh failed for user ${userId}:`, refreshData.error);
    return null;
  }

  const newExpiresAt = new Date(Date.now() + (refreshData.expires_in ?? 3600) * 1000).toISOString();

  await admin.from("user_integrations").update({
    access_token: refreshData.access_token,
    expires_at: newExpiresAt,
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId).eq("provider", "google");

  return { token: refreshData.access_token, email: (row.external_id as string) ?? null };
}

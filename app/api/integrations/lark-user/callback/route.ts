import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const LARK_APP_ID = (process.env.LARK_APP_ID || "").trim();
const LARK_APP_SECRET = (process.env.LARK_APP_SECRET || "").trim();
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://inside-assistant.vercel.app";

/**
 * Lark OAuth callback — exchange authorization code for user access token.
 *
 * Security: verify `state` matches the current session user before storing the
 * token. Lark's code is single-use and short-lived (~60s) so replay attacks are
 * limited, but we still bind it to the session that initiated the flow.
 */
export async function GET(request: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${APP_URL}/settings/integrations?lark_error=not_logged_in`);
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code) {
    return NextResponse.redirect(`${APP_URL}/settings/integrations?lark_error=no_code`);
  }
  if (state !== user.id) {
    return NextResponse.redirect(`${APP_URL}/settings/integrations?lark_error=state_mismatch`);
  }

  // Step 1: get app access token (tenant-level) so we can call the user token endpoint
  const appTokRes = await fetch(
    "https://open.larksuite.com/open-apis/auth/v3/app_access_token/internal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET }),
    }
  );
  const appTokData = await appTokRes.json();
  if (appTokData.code !== 0 || !appTokData.app_access_token) {
    return NextResponse.redirect(
      `${APP_URL}/settings/integrations?lark_error=app_token_${appTokData.code ?? "unknown"}`
    );
  }

  // Step 2: exchange auth code for user_access_token + refresh_token
  const userTokRes = await fetch(
    "https://open.larksuite.com/open-apis/authen/v1/access_token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${appTokData.app_access_token}`,
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
      }),
    }
  );
  const userTokData = await userTokRes.json();
  if (userTokData.code !== 0 || !userTokData.data?.access_token) {
    return NextResponse.redirect(
      `${APP_URL}/settings/integrations?lark_error=exchange_${userTokData.code ?? "unknown"}`
    );
  }

  const d = userTokData.data;
  const expiresAt = new Date(Date.now() + (d.expires_in ?? 7200) * 1000).toISOString();

  // Step 3: persist per-user. Keyed by the session user_id — never the body.
  const admin = createAdminClient();
  await admin.from("user_integrations").upsert(
    {
      user_id: user.id,
      provider: "lark_user",
      access_token: d.access_token,
      refresh_token: d.refresh_token ?? null,
      scopes: (d.scope ?? "").split(" ").filter(Boolean),
      expires_at: expiresAt,
      external_id: d.open_id ?? null,
      config: { name: d.name ?? null, avatar_url: d.avatar_url ?? null, tenant_key: d.tenant_key ?? null },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" }
  );

  return NextResponse.redirect(`${APP_URL}/settings/integrations?lark_connected=1`);
}

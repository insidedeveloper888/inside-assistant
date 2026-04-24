import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || "").trim();
const GOOGLE_CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://inside-assistant.vercel.app").trim();

export async function GET(request: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${APP_URL}/settings/integrations?google_error=not_logged_in`);
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(`${APP_URL}/settings/integrations?google_error=${error}`);
  }
  if (!code) {
    return NextResponse.redirect(`${APP_URL}/settings/integrations?google_error=no_code`);
  }
  if (state !== user.id) {
    return NextResponse.redirect(`${APP_URL}/settings/integrations?google_error=state_mismatch`);
  }

  const redirectUri = `${APP_URL}/api/integrations/google/callback`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    return NextResponse.redirect(
      `${APP_URL}/settings/integrations?google_error=token_exchange_failed`
    );
  }

  const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = profileRes.ok ? await profileRes.json() : {};

  const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000).toISOString();
  const scopes = (tokenData.scope ?? "").split(" ").filter(Boolean);

  const admin = createAdminClient();
  await admin.from("user_integrations").upsert(
    {
      user_id: user.id,
      provider: "google",
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token ?? null,
      scopes,
      expires_at: expiresAt,
      external_id: profile.email ?? null,
      config: {
        name: profile.name ?? null,
        avatar_url: profile.picture ?? null,
        permissions: {
          calendar: true,
          freebusy: true,
          gmail: true,
          drive: true,
          docs: true,
          sheets: true,
          contacts: true,
          tasks: true,
          meet: true,
        },
        defaults: {},
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" }
  );

  return NextResponse.redirect(`${APP_URL}/settings/integrations?google_connected=1`);
}

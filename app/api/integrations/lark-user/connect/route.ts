import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

/**
 * Connect a Lark user access token for the current user.
 * POST body: { token: string }
 *
 * MVP approach: paste the user_access_token from Lark Open Platform
 * (https://open.larksuite.com/app → your app → Development Config → Issue user token).
 * Proper OAuth flow (start/callback) comes in a later phase — this MVP lets us
 * prove tool-calling against real Lark APIs without the OAuth redirect plumbing.
 *
 * Scope we expect on the token: docx:document, drive:drive, contact:user.base:readonly.
 */
export async function POST(request: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { token } = await request.json();
  if (!token || typeof token !== "string" || token.length < 20) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  // Verify by calling /open-apis/authen/v1/user_info which returns basic profile
  const verifyRes = await fetch("https://open.larksuite.com/open-apis/authen/v1/user_info", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!verifyRes.ok) {
    return NextResponse.json({ error: `Lark rejected token (${verifyRes.status})` }, { status: 400 });
  }
  const body = await verifyRes.json();
  if (body.code !== 0) {
    return NextResponse.json({ error: `Lark code ${body.code}: ${body.msg}` }, { status: 400 });
  }

  const profile = body.data ?? {};
  const admin = createAdminClient();
  await admin.from("user_integrations").upsert({
    user_id: user.id,
    provider: "lark_user",
    access_token: token,
    external_id: profile.open_id ?? null,
    scopes: ["docx:document", "drive:drive", "contact:user.base:readonly"],
    config: { name: profile.name ?? null, avatar_url: profile.avatar_url ?? null },
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,provider" });

  return NextResponse.json({ success: true, name: profile.name ?? null });
}

export async function DELETE() {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  await admin.from("user_integrations").delete()
    .eq("user_id", user.id)
    .eq("provider", "lark_user");

  return NextResponse.json({ success: true });
}

export async function GET() {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: integration } = await admin
    .from("user_integrations")
    .select("external_id, config, created_at")
    .eq("user_id", user.id)
    .eq("provider", "lark_user")
    .single();

  if (!integration) return NextResponse.json({ connected: false });
  return NextResponse.json({
    connected: true,
    name: (integration.config as { name?: string } | null)?.name ?? null,
    open_id: integration.external_id,
    connected_at: integration.created_at,
  });
}

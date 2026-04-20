import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

/**
 * Connect a GitHub Personal Access Token for the current user.
 * POST body: { token: string }
 *
 * Using PAT instead of OAuth for MVP:
 * - no OAuth app setup required
 * - user controls scopes directly on github.com
 * - simpler revocation (delete the PAT)
 * When we need GitHub App features (webhooks, installation) we'll add OAuth later.
 */
export async function POST(request: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { token } = await request.json();
  if (!token || typeof token !== "string" || token.length < 20) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  // Verify the token works by calling /user
  const verifyRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!verifyRes.ok) {
    return NextResponse.json({ error: `GitHub rejected token (${verifyRes.status})` }, { status: 400 });
  }
  const ghUser = await verifyRes.json();

  const admin = createAdminClient();
  await admin.from("user_integrations").upsert({
    user_id: user.id,
    provider: "github",
    access_token: token, // TODO: encrypt at rest via MASTER_KEY
    external_id: ghUser.login,
    scopes: ["repo", "read:user"],
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,provider" });

  return NextResponse.json({ success: true, github_login: ghUser.login });
}

/**
 * Disconnect: deletes the integration row.
 */
export async function DELETE() {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  await admin.from("user_integrations").delete()
    .eq("user_id", user.id)
    .eq("provider", "github");

  return NextResponse.json({ success: true });
}

/**
 * GET — return current integration status + user's accessible repos.
 */
export async function GET() {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: integration } = await admin
    .from("user_integrations")
    .select("access_token, external_id, created_at")
    .eq("user_id", user.id)
    .eq("provider", "github")
    .single();

  if (!integration) return NextResponse.json({ connected: false });

  // Fetch user's repos (first 100 owned + collaborator)
  const reposRes = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", {
    headers: { Authorization: `Bearer ${integration.access_token}`, Accept: "application/vnd.github+json" },
  });
  const repos = reposRes.ok
    ? ((await reposRes.json()) as { full_name: string; private: boolean }[]).map((r) => ({
        full_name: r.full_name,
        private: r.private,
      }))
    : [];

  return NextResponse.json({
    connected: true,
    github_login: integration.external_id,
    connected_at: integration.created_at,
    repos,
  });
}

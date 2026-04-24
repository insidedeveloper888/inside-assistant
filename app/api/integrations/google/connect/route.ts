import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function GET() {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: integration } = await admin
    .from("user_integrations")
    .select("external_id, config, created_at")
    .eq("user_id", user.id)
    .eq("provider", "google")
    .single();

  if (!integration) return NextResponse.json({ connected: false });

  const config = integration.config as Record<string, unknown> | null;
  return NextResponse.json({
    connected: true,
    email: integration.external_id,
    name: (config?.name as string) ?? null,
    connected_at: integration.created_at,
  });
}

export async function DELETE() {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  await admin.from("user_integrations").delete()
    .eq("user_id", user.id)
    .eq("provider", "google");

  return NextResponse.json({ success: true });
}

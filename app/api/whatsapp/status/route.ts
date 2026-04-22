import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { WA_TENANT_ID } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: settings } = await admin
    .from("assistant_user_settings")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (!settings || settings.role !== "director") {
    return NextResponse.json({ error: "Directors only" }, { status: 403 });
  }

  const { data: session } = await admin
    .from("wa_sessions")
    .select("status, phone_number, updated_at")
    .eq("tenant_id", WA_TENANT_ID)
    .single();

  if (!session) {
    return NextResponse.json({ status: "not_configured" });
  }

  return NextResponse.json({
    status: session.status,
    phoneNumber: session.phone_number,
    updatedAt: session.updated_at,
  });
}

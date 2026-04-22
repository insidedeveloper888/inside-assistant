import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const SHARED_INSTANCE_NAME = "tenant-61c2f8b0-97b0-4311-8302-3dc683ac9a26";

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
    .select("status, phone_number, qr_code_base64, updated_at")
    .eq("instance_name", SHARED_INSTANCE_NAME)
    .single();

  if (!session) {
    return NextResponse.json({ status: "not_configured" });
  }

  return NextResponse.json({
    status: session.status,
    phoneNumber: session.phone_number,
    qrCode: session.qr_code_base64,
    updatedAt: session.updated_at,
  });
}

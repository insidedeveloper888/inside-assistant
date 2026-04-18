import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export async function GET() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("assistant_company_settings")
    .select("claude_md")
    .eq("id", "default")
    .single();

  return NextResponse.json({ claudeMd: data?.claude_md || "" });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check if user is director/manager
  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("assistant_user_settings")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (!settings || (settings.role !== "director" && settings.role !== "manager")) {
    return NextResponse.json({ error: "Only directors and managers can edit company instructions" }, { status: 403 });
  }

  const { claudeMd } = await request.json();

  await admin
    .from("assistant_company_settings")
    .update({
      claude_md: claudeMd,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", "default");

  return NextResponse.json({ success: true });
}

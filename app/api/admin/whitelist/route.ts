import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { findAllLarkUsers } from "@/lib/lark";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  // Check if director
  const { data: settings } = await admin
    .from("assistant_user_settings")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (!settings || settings.role !== "director") {
    return NextResponse.json({ error: "Directors only" }, { status: 403 });
  }

  // Fetch whitelist
  const { data: whitelist } = await admin
    .from("ai_reply_whitelist")
    .select("*")
    .eq("tenant_id", "61c2f8b0-97b0-4311-8302-3dc683ac9a26")
    .order("created_at", { ascending: true });

  // Fetch all Lark users for linking
  const larkUsers = await findAllLarkUsers();

  // Fetch all Inside Assistant users
  const { data: assistantUsers } = await admin
    .from("assistant_user_settings")
    .select("user_id, display_name, lark_name, lark_open_id, lark_verified, role")
    .order("display_name");

  return NextResponse.json({
    whitelist: whitelist ?? [],
    larkUsers,
    assistantUsers: assistantUsers ?? [],
  });
}

export async function POST(request: NextRequest) {
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

  const body = await request.json();
  const { action } = body;

  if (action === "add") {
    const { phone, name, larkOpenId } = body;
    if (!phone || !name) {
      return NextResponse.json({ error: "phone and name required" }, { status: 400 });
    }
    const { error } = await admin.from("ai_reply_whitelist").upsert({
      tenant_id: "61c2f8b0-97b0-4311-8302-3dc683ac9a26",
      phone: phone.replace(/\D/g, ""),
      name,
      lark_open_id: larkOpenId || null,
      mode: "personal",
      is_enabled: true,
    }, { onConflict: "tenant_id,phone" });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (action === "toggle") {
    const { id, isEnabled } = body;
    await admin.from("ai_reply_whitelist").update({ is_enabled: isEnabled }).eq("id", id);
    return NextResponse.json({ success: true });
  }

  if (action === "delete") {
    const { id } = body;
    await admin.from("ai_reply_whitelist").delete().eq("id", id);
    return NextResponse.json({ success: true });
  }

  if (action === "update") {
    const { id, name, larkOpenId, mode, claudeMd } = body;
    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (larkOpenId !== undefined) updateData.lark_open_id = larkOpenId;
    if (mode !== undefined) updateData.mode = mode;
    if (claudeMd !== undefined) updateData.claude_md = claudeMd;
    await admin.from("ai_reply_whitelist").update(updateData).eq("id", id);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

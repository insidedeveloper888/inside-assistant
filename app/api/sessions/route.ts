import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { mode } = await request.json();
  const admin = createAdminClient();

  // Ensure user settings exist
  const { data: existingSettings } = await admin
    .from("assistant_user_settings")
    .select("user_id, email")
    .eq("user_id", user.id)
    .single();

  if (!existingSettings) {
    await admin.from("assistant_user_settings").insert({
      user_id: user.id,
      display_name: user.email?.split("@")[0] ?? "",
      email: user.email ?? "",
      role: "member",
    });
  } else if (!existingSettings.email && user.email) {
    await admin.from("assistant_user_settings")
      .update({ email: user.email })
      .eq("user_id", user.id);
  }

  const { data, error } = await admin
    .from("assistant_sessions")
    .insert({
      user_id: user.id,
      title: mode === "company" ? "Company Brain" : "New Chat",
      mode: mode || "personal",
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

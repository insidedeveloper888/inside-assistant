import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { findLarkUserByEmail } from "@/lib/lark";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Look up user's email in Lark
  const larkUser = await findLarkUserByEmail(user.email);

  const admin = createAdminClient();

  if (larkUser) {
    // Found in Lark — link and set verified identity
    await admin
      .from("assistant_user_settings")
      .upsert({
        user_id: user.id,
        display_name: larkUser.name || larkUser.enName,
        lark_open_id: larkUser.openId,
        lark_name: larkUser.name || larkUser.enName,
        lark_verified: true,
        role: larkUser.role,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });

    return NextResponse.json({
      linked: true,
      name: larkUser.name,
      tier: larkUser.tier,
      role: larkUser.role,
    });
  } else {
    // Not found in Lark — create as unverified member
    const { data: existing } = await admin
      .from("assistant_user_settings")
      .select("user_id")
      .eq("user_id", user.id)
      .single();

    if (!existing) {
      await admin.from("assistant_user_settings").insert({
        user_id: user.id,
        display_name: user.email.split("@")[0],
        role: "member",
        lark_verified: false,
      });
    }

    return NextResponse.json({
      linked: false,
      message: "Email not found in Lark. Registered as unverified member.",
    });
  }
}

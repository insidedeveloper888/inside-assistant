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
    // Found in Lark — link and set verified identity.
    //
    // IMPORTANT: role is set ONLY when creating the row for the first time.
    // On subsequent calls (every login triggers this endpoint) we must NOT
    // overwrite role — otherwise admin promotions via /admin/team get
    // reverted to whatever lib/lark.ts HIERARCHY says, which was the
    // "Tong Xin promoted to director, reverts to member on next login" bug.
    const { data: existing } = await admin
      .from("assistant_user_settings")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing) {
      // Existing row — update identity fields only, leave role alone.
      await admin
        .from("assistant_user_settings")
        .update({
          display_name: larkUser.name || larkUser.enName,
          lark_open_id: larkUser.openId,
          lark_name: larkUser.name || larkUser.enName,
          lark_verified: true,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);
    } else {
      // First-time insert — seed with HIERARCHY-derived role as the
      // default. Admin can change it via /admin/team afterwards and
      // it'll persist (since the existing-row branch above doesn't
      // touch role).
      await admin.from("assistant_user_settings").insert({
        user_id: user.id,
        display_name: larkUser.name || larkUser.enName,
        lark_open_id: larkUser.openId,
        lark_name: larkUser.name || larkUser.enName,
        lark_verified: true,
        role: larkUser.role,
      });
    }

    return NextResponse.json({
      linked: true,
      name: larkUser.name,
      tier: larkUser.tier,
      // Return the EFFECTIVE role (DB-stored, possibly admin-overridden),
      // not the HIERARCHY-default, so the client sees what's actually
      // enforced. existing?.role wins when present.
      role: existing?.role ?? larkUser.role,
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

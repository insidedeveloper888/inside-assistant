import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

/**
 * Returns the current user's integration capabilities — the canonical answer
 * the web UI uses for "Connected ✓" badges and the WhatsApp handler uses for
 * prompt building. Reads from the v_user_capabilities Postgres view
 * (migration 20260511_user_capabilities_view.sql).
 *
 * Both consumers go through this same shape so they cannot disagree.
 *
 * GET /api/me/capabilities
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("v_user_capabilities")
    .select("user_id, phone, email, display_name, role, lark_open_id, lark_name, lark_verified, has_google, has_lark, has_github, lark_identity_known")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    user_id: user.id,
    phone: data?.phone ?? null,
    email: data?.email ?? null,
    display_name: data?.display_name ?? null,
    role: data?.role ?? null,
    lark_open_id: data?.lark_open_id ?? null,
    lark_name: data?.lark_name ?? null,
    lark_verified: !!data?.lark_verified,
    has_google: !!data?.has_google,
    has_lark: !!data?.has_lark,
    has_github: !!data?.has_github,
    lark_identity_known: !!data?.lark_identity_known,
  });
}

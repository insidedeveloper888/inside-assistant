import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
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

  const params = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(params.get("page") || "1"));
  const limit = Math.min(100, Math.max(10, parseInt(params.get("limit") || "50")));
  const decision = params.get("decision");
  const phone = params.get("phone");
  const search = params.get("search");

  let query = admin
    .from("wa_audit_log")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (decision) query = query.eq("decision", decision);
  if (phone) query = query.eq("phone", phone);
  if (search) query = query.ilike("content_preview", `%${search}%`);

  const { data: logs, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const distinctDecisions = await admin
    .from("wa_audit_log")
    .select("decision")
    .limit(1000);

  const decisions = [...new Set((distinctDecisions.data ?? []).map((r: { decision: string }) => r.decision))].sort();

  return NextResponse.json({
    logs: logs ?? [],
    total: count ?? 0,
    page,
    limit,
    decisions,
  });
}

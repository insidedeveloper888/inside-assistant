import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

/**
 * GET — list the current user's scheduled jobs.
 */
export async function GET() {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: jobs } = await admin
    .from("scheduled_jobs")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return NextResponse.json({ jobs: jobs ?? [] });
}

/**
 * POST — create, update, delete, or toggle a scheduled job.
 * body: { action: "create" | "update" | "delete" | "toggle", ...fields }
 */
export async function POST(request: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const body = await request.json();
  const { action } = body;

  if (action === "create") {
    const { job_type, name, cron, timezone, config } = body;
    if (!job_type || !cron) {
      return NextResponse.json({ error: "job_type and cron required" }, { status: 400 });
    }
    const { data, error } = await admin.from("scheduled_jobs").insert({
      user_id: user.id,
      job_type,
      name: name ?? null,
      cron,
      timezone: timezone ?? "Asia/Kuala_Lumpur",
      config: config ?? {},
      is_enabled: true,
    }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ job: data });
  }

  if (action === "update") {
    const { id, name, cron, timezone, config } = body;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name;
    if (cron !== undefined) updateData.cron = cron;
    if (timezone !== undefined) updateData.timezone = timezone;
    if (config !== undefined) updateData.config = config;
    const { error } = await admin
      .from("scheduled_jobs")
      .update(updateData)
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ success: true });
  }

  if (action === "toggle") {
    const { id, is_enabled } = body;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const { error } = await admin
      .from("scheduled_jobs")
      .update({ is_enabled, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ success: true });
  }

  if (action === "delete") {
    const { id } = body;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const { error } = await admin
      .from("scheduled_jobs")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

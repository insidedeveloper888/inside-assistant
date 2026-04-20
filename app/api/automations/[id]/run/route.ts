import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { runGithubDigest } from "@/lib/job-handlers/github-digest";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Trigger a scheduled job to run immediately, bypassing the cron.
 * Only the job owner can trigger their own jobs. Returns the handler's
 * output string on success; logs a run row to scheduled_job_runs.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const admin = createAdminClient();

  const { data: job } = await admin
    .from("scheduled_jobs")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const started = Date.now();
  const { data: runRow } = await admin
    .from("scheduled_job_runs")
    .insert({ job_id: job.id, started_at: new Date().toISOString() })
    .select("id")
    .single();

  try {
    let output = "";
    if (job.job_type === "github-digest") {
      output = await runGithubDigest(job, admin);
    } else {
      throw new Error(`Unknown job_type: ${job.job_type}`);
    }

    const duration = Date.now() - started;
    await admin.from("scheduled_job_runs").update({
      finished_at: new Date().toISOString(),
      status: "success",
      output: output.slice(0, 5000),
      duration_ms: duration,
    }).eq("id", runRow!.id);

    await admin.from("scheduled_jobs").update({
      last_run_at: new Date().toISOString(),
      last_status: "success",
      last_error: null,
    }).eq("id", job.id);

    return NextResponse.json({ success: true, output });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const duration = Date.now() - started;
    await admin.from("scheduled_job_runs").update({
      finished_at: new Date().toISOString(),
      status: "error",
      error: msg.slice(0, 2000),
      duration_ms: duration,
    }).eq("id", runRow!.id);

    await admin.from("scheduled_jobs").update({
      last_run_at: new Date().toISOString(),
      last_status: "error",
      last_error: msg.slice(0, 500),
    }).eq("id", job.id);

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

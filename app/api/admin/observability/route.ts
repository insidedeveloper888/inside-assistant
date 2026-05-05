import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const TABLE_CONFIG: Record<string, { columns: string; orderBy: string }> = {
  memory_access_log: {
    columns: "id, user_id, tenant_id, scope, query, source, result_count, top_similarity, top_keyword_rank, duration_ms, session_id, context, retrieved_ids, created_at",
    orderBy: "created_at",
  },
  verifier_log: {
    columns: "id, tenant_id, contact_phone, user_name, attempt, failures, original_reply, fix_instructions, outcome, created_at",
    orderBy: "created_at",
  },
  wa_audit_log: {
    columns: "id, tenant_id, phone, contact_name, wa_message_id, direction, decision, content_preview, metadata, created_at",
    orderBy: "created_at",
  },
  webhook_raw_logs: {
    columns: "id, instance_name, event_type, contact_jid, direction, message_type, lead_source, lead_source_id, created_at",
    orderBy: "created_at",
  },
  tool_invocations: {
    columns: "id, user_id, session_id, tool_name, provider, status, error, duration_ms, created_at, input, output",
    orderBy: "created_at",
  },
  proxy_usage_logs: {
    columns: "*",
    orderBy: "created_at",
  },
  score_history: {
    columns: "id, tenant_id, contact_id, conversation_id, overall_score, intent_score, engagement_score, urgency_score, sentiment_score, buying_stage, reasoning, created_at",
    orderBy: "created_at",
  },
  wa_lark_mirror_log: {
    columns: "*",
    orderBy: "created_at",
  },
};

export async function GET(request: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
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
  const table = params.get("table") ?? "wa_audit_log";
  const config = TABLE_CONFIG[table];
  if (!config) return NextResponse.json({ error: "Unknown table" }, { status: 400 });

  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10));
  const limit = Math.min(200, Math.max(10, parseInt(params.get("limit") ?? "50", 10)));
  const search = params.get("q")?.trim();

  let query = admin
    .from(table)
    .select(config.columns, { count: "exact" })
    .order(config.orderBy, { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  // Per-table search
  if (search) {
    if (table === "memory_access_log") query = query.ilike("query", `%${search}%`);
    else if (table === "verifier_log") query = query.ilike("user_name", `%${search}%`);
    else if (table === "wa_audit_log") query = query.or(`phone.ilike.%${search}%,contact_name.ilike.%${search}%,decision.ilike.%${search}%`);
    else if (table === "webhook_raw_logs") query = query.or(`event_type.ilike.%${search}%,contact_jid.ilike.%${search}%`);
    else if (table === "tool_invocations") query = query.or(`tool_name.ilike.%${search}%,status.ilike.%${search}%`);
    else if (table === "score_history") query = query.ilike("buying_stage", `%${search}%`);
  }

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ logs: data ?? [], total: count ?? 0, page, limit });
}

// Daily Claude proxy cost rollup
export async function POST(request: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
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
  const action = body.action;

  if (action === "proxy-stats") {
    // Daily totals for last 30 days
    const since = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
    const { data } = await admin
      .from("proxy_usage_logs")
      .select("*")
      .gte("created_at", since);

    type Row = Record<string, unknown> & { created_at: string };
    const days = new Map<string, { count: number; tokens: number; users: Set<string> }>();
    for (const r of (data ?? []) as Row[]) {
      const day = (r.created_at as string).slice(0, 10);
      if (!days.has(day)) days.set(day, { count: 0, tokens: 0, users: new Set() });
      const d = days.get(day)!;
      d.count++;
      d.tokens += Number((r.total_tokens as number) ?? (r.tokens as number) ?? 0);
      const u = (r.user_id as string) ?? (r.session_id as string);
      if (u) d.users.add(u);
    }
    const series = [...days.entries()]
      .map(([date, v]) => ({ date, requests: v.count, tokens: v.tokens, users: v.users.size }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({ series });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

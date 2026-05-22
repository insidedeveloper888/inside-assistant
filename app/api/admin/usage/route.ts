import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

/**
 * Usage rollup across all three AI surfaces:
 *   - Scoring engine (score_history.ai_provider/model_used)
 *   - WhatsApp AI reply (wa_audit_log.metadata.provider/model on reply_sent)
 *   - Inside Assistant /chat (assistant_messages.metadata.provider/model on role=assistant)
 *
 * Director-only. Returns counts at 24h / 7d / 30d windows and a per-provider
 * breakdown. Cost numbers are rough — derived from token-per-call assumptions
 * since the providers don't all return usage uniformly.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("assistant_user_settings")
    .select("role").eq("user_id", user.id).single();
  if (!settings || settings.role !== "director") {
    return NextResponse.json({ error: "Directors only" }, { status: 403 });
  }

  const now = new Date();
  const day = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const week = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const month = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Scoring engine
  const [scoringDay, scoringWeek, scoringMonth] = await Promise.all([
    admin.from("score_history").select("*", { count: "exact", head: true }).gte("scored_at", day),
    admin.from("score_history").select("*", { count: "exact", head: true }).gte("scored_at", week),
    admin.from("score_history").select("*", { count: "exact", head: true }).gte("scored_at", month),
  ]);
  const { data: scoringByProvider } = await admin
    .from("score_history")
    .select("ai_provider, model_used")
    .gte("scored_at", month)
    .not("ai_provider", "is", null);
  const scoringBreakdown = rollupProvider(scoringByProvider ?? [], (r) => `${r.ai_provider}/${r.model_used}`);

  // WhatsApp AI reply
  const [waDay, waWeek, waMonth] = await Promise.all([
    admin.from("wa_audit_log").select("*", { count: "exact", head: true }).eq("decision", "reply_sent").gte("created_at", day),
    admin.from("wa_audit_log").select("*", { count: "exact", head: true }).eq("decision", "reply_sent").gte("created_at", week),
    admin.from("wa_audit_log").select("*", { count: "exact", head: true }).eq("decision", "reply_sent").gte("created_at", month),
  ]);
  const { data: waByProvider } = await admin
    .from("wa_audit_log")
    .select("metadata")
    .eq("decision", "reply_sent")
    .gte("created_at", month);
  const waBreakdown = rollupProvider(waByProvider ?? [], (r) => {
    const m = (r.metadata ?? {}) as Record<string, string>;
    return m.provider ? `${m.provider}/${m.model ?? "?"}` : "(pre-tracking)";
  });

  // Inside Assistant /chat
  const [chatDay, chatWeek, chatMonth] = await Promise.all([
    admin.from("assistant_messages").select("*", { count: "exact", head: true }).eq("role", "assistant").gte("created_at", day),
    admin.from("assistant_messages").select("*", { count: "exact", head: true }).eq("role", "assistant").gte("created_at", week),
    admin.from("assistant_messages").select("*", { count: "exact", head: true }).eq("role", "assistant").gte("created_at", month),
  ]);
  const { data: chatByProvider } = await admin
    .from("assistant_messages")
    .select("metadata")
    .eq("role", "assistant")
    .gte("created_at", month);
  const chatBreakdown = rollupProvider(chatByProvider ?? [], (r) => {
    const m = (r.metadata ?? {}) as Record<string, string>;
    return m.provider ? `${m.provider}/${m.model ?? "?"}` : "(pre-tracking)";
  });

  // Throttle observability (WA scoring skips)
  const { data: skippedRows } = await admin
    .from("wa_audit_log")
    .select("metadata")
    .eq("decision", "scoring_skipped")
    .gte("created_at", week);
  const skipBreakdown = rollupProvider(skippedRows ?? [], (r) => {
    const m = (r.metadata ?? {}) as Record<string, string>;
    return m.skip_reason ?? "unknown";
  });

  return NextResponse.json({
    generated_at: now.toISOString(),
    scoring: {
      day: scoringDay.count ?? 0,
      week: scoringWeek.count ?? 0,
      month: scoringMonth.count ?? 0,
      by_provider: scoringBreakdown,
    },
    wa_reply: {
      day: waDay.count ?? 0,
      week: waWeek.count ?? 0,
      month: waMonth.count ?? 0,
      by_provider: waBreakdown,
    },
    web_chat: {
      day: chatDay.count ?? 0,
      week: chatWeek.count ?? 0,
      month: chatMonth.count ?? 0,
      by_provider: chatBreakdown,
    },
    throttle_skips_7d: skipBreakdown,
  });
}

function rollupProvider<T>(rows: T[], keyFn: (r: T) => string): Array<{ key: string; count: number }> {
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = keyFn(r);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

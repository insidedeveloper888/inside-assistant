"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Tab = "memory_access_log" | "verifier_log" | "wa_audit_log" | "webhook_raw_logs" | "tool_invocations" | "score_history" | "wa_lark_mirror_log" | "cost";

const TABS: Array<{ id: Tab; label: string; description: string }> = [
  { id: "memory_access_log", label: "Memory Access", description: "Which memories were retrieved for which questions" },
  { id: "wa_audit_log", label: "WhatsApp AI Audit", description: "Every AI reply decision (whitelist, send, notify, errors)" },
  { id: "verifier_log", label: "Verifier Failures", description: "Caught AI hallucinations before they were sent" },
  { id: "tool_invocations", label: "Tool Invocations", description: "Every Lark/Google tool call with result" },
  { id: "score_history", label: "Score History", description: "Lead scoring decisions with reasoning" },
  { id: "webhook_raw_logs", label: "Webhook Logs", description: "Raw Evolution API webhook payloads" },
  { id: "wa_lark_mirror_log", label: "Lark Mirror", description: "Media files mirrored to Lark Drive" },
  { id: "cost", label: "Cost Dashboard", description: "Claude proxy usage & token spend" },
];

interface LogRow {
  id: string;
  created_at: string;
  [k: string]: unknown;
}

export default function ObservabilityPage() {
  const [tab, setTab] = useState<Tab>("memory_access_log");
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [costSeries, setCostSeries] = useState<Array<{ date: string; requests: number; tokens: number; users: number }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setExpandedId(null);
    try {
      if (tab === "cost") {
        const res = await fetch("/api/admin/observability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "proxy-stats" }),
        });
        if (!res.ok) {
          setError(res.status === 403 ? "Directors only" : "Failed to load");
          setLoading(false);
          return;
        }
        const data = await res.json();
        setCostSeries(data.series ?? []);
        setLoading(false);
        return;
      }

      const params = new URLSearchParams({ table: tab, page: String(page), limit: String(limit) });
      if (appliedSearch) params.set("q", appliedSearch);
      const res = await fetch(`/api/admin/observability?${params}`);
      if (!res.ok) {
        setError(res.status === 403 ? "Directors only" : "Failed to load");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setLogs(data.logs ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [tab, page, limit, appliedSearch]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / limit);
  const totalRequests = costSeries.reduce((s, d) => s + d.requests, 0);
  const totalTokens = costSeries.reduce((s, d) => s + d.tokens, 0);
  const estCost = totalTokens * 0.000003; // rough estimate $3 per 1M tokens (Sonnet input avg)
  const maxRequests = Math.max(1, ...costSeries.map((d) => d.requests));

  return (
    <div className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
      <div className="mx-auto max-w-[1400px] space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Observability & Audit</h1>
            <p className="mt-0.5 text-xs text-zinc-500">Director-only · all logs across the system</p>
          </div>
          <Link href="/chat" className="text-xs text-zinc-500 hover:text-zinc-300">← Back to Chat</Link>
        </div>

        {/* Tabs */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-1 flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setPage(1); setAppliedSearch(""); setSearch(""); }}
              className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                tab === t.id
                  ? "bg-indigo-600 text-white"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
              title={t.description}
            >
              {t.label}
            </button>
          ))}
        </div>

        <p className="text-xs text-zinc-500">{TABS.find((t) => t.id === tab)?.description}</p>

        {/* Cost dashboard */}
        {tab === "cost" && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="text-xs text-zinc-500">Requests (30d)</div>
                <div className="mt-1 text-2xl font-semibold">{totalRequests.toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="text-xs text-zinc-500">Tokens (30d)</div>
                <div className="mt-1 text-2xl font-semibold">{totalTokens.toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="text-xs text-zinc-500">Est. Cost (USD, rough)</div>
                <div className="mt-1 text-2xl font-semibold">${estCost.toFixed(3)}</div>
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="mb-3 text-sm font-medium">Daily Requests</div>
              {costSeries.length === 0 ? (
                <p className="text-xs text-zinc-500">No usage data yet.</p>
              ) : (
                <div className="space-y-1">
                  {costSeries.map((d) => (
                    <div key={d.date} className="flex items-center gap-3 text-xs">
                      <span className="w-20 font-mono text-zinc-500">{d.date}</span>
                      <div className="flex-1 h-4 rounded bg-zinc-800 overflow-hidden">
                        <div
                          className="h-full bg-indigo-500"
                          style={{ width: `${(d.requests / maxRequests) * 100}%` }}
                        />
                      </div>
                      <span className="w-16 text-right font-mono text-zinc-300">{d.requests}</span>
                      <span className="w-24 text-right font-mono text-zinc-500">{d.tokens.toLocaleString()} tok</span>
                      <span className="w-12 text-right text-zinc-500">{d.users}u</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Search bar (not for cost) */}
        {tab !== "cost" && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { setAppliedSearch(search); setPage(1); } }}
              placeholder="Search…"
              className="h-8 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            />
            <button
              onClick={() => { setAppliedSearch(search); setPage(1); }}
              className="h-8 rounded-md bg-indigo-600 px-3 text-xs text-white hover:bg-indigo-500"
            >
              Search
            </button>
            <button
              onClick={() => load()}
              className="h-8 rounded-md border border-zinc-700 px-3 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              ↻ Refresh
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Log list */}
        {tab !== "cost" && (
          <>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden">
              {loading ? (
                <div className="p-8 text-center text-xs text-zinc-500">Loading…</div>
              ) : logs.length === 0 ? (
                <div className="p-8 text-center text-xs text-zinc-500">No entries</div>
              ) : (
                <div className="divide-y divide-zinc-800">
                  {logs.map((log) => (
                    <LogEntry
                      key={log.id}
                      tab={tab}
                      log={log}
                      expanded={expandedId === log.id}
                      onToggle={() => setExpandedId(expandedId === log.id ? null : log.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500">Page {page} of {totalPages} · {total} total</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="rounded border border-zinc-700 px-3 py-1 text-zinc-300 disabled:opacity-50 hover:bg-zinc-800"
                  >
                    Prev
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="rounded border border-zinc-700 px-3 py-1 text-zinc-300 disabled:opacity-50 hover:bg-zinc-800"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function LogEntry({ tab, log, expanded, onToggle }: { tab: Tab; log: LogRow; expanded: boolean; onToggle: () => void }) {
  const time = new Date(log.created_at).toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full px-4 py-2.5 text-left hover:bg-zinc-800/50 flex items-start gap-3"
      >
        <span className="font-mono text-[10px] text-zinc-500 shrink-0 w-32 pt-0.5">{time}</span>
        <div className="flex-1 min-w-0">
          <Summary tab={tab} log={log} />
        </div>
        <span className="text-zinc-500 text-xs shrink-0">{expanded ? "▼" : "▶"}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-3 pt-1 bg-zinc-900/60">
          <pre className="whitespace-pre-wrap text-[10px] leading-relaxed text-zinc-400 font-mono max-h-96 overflow-auto bg-zinc-950 rounded p-3 border border-zinc-800">
            {JSON.stringify(log, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function Summary({ tab, log }: { tab: Tab; log: LogRow }) {
  if (tab === "memory_access_log") {
    const sim = (log.top_similarity as number) ?? 0;
    const kw = (log.top_keyword_rank as number) ?? 0;
    return (
      <div className="text-xs">
        <span className={`mr-2 inline-block rounded px-1.5 py-0.5 text-[10px] ${(log.scope === "company") ? "bg-blue-500/15 text-blue-300" : "bg-purple-500/15 text-purple-300"}`}>
          {log.scope as string}
        </span>
        <span className="text-zinc-500">[{log.source as string}] </span>
        <span className="text-zinc-200">"{(log.query as string).slice(0, 100)}"</span>
        <span className="ml-2 text-zinc-500">→ {log.result_count as number} results · sim={sim.toFixed(2)} kw={kw.toFixed(2)} · {log.duration_ms as number}ms</span>
      </div>
    );
  }

  if (tab === "verifier_log") {
    return (
      <div className="text-xs">
        <span className={`mr-2 inline-block rounded px-1.5 py-0.5 text-[10px] ${(log.outcome === "fallback") ? "bg-red-500/15 text-red-300" : "bg-amber-500/15 text-amber-300"}`}>
          {log.outcome as string} (attempt {log.attempt as number})
        </span>
        <span className="text-zinc-200">{log.user_name as string}</span>
        <span className="ml-2 text-zinc-500">{(log.failures as string[])?.join(", ")}</span>
      </div>
    );
  }

  if (tab === "wa_audit_log") {
    return (
      <div className="text-xs">
        <span className="mr-2 inline-block rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300 font-mono">{log.decision as string}</span>
        <span className="text-zinc-200">{(log.contact_name as string) ?? log.phone as string}</span>
        {!!log.content_preview && <span className="ml-2 text-zinc-500 truncate">{(log.content_preview as string).slice(0, 80)}</span>}
      </div>
    );
  }

  if (tab === "webhook_raw_logs") {
    return (
      <div className="text-xs">
        <span className="mr-2 inline-block rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono">{log.event_type as string}</span>
        <span className="text-zinc-200 font-mono">{(log.contact_jid as string)?.split("@")[0] ?? "—"}</span>
        {!!log.lead_source && <span className="ml-2 inline-block rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">{log.lead_source as string}</span>}
      </div>
    );
  }

  if (tab === "tool_invocations") {
    return (
      <div className="text-xs">
        <span className={`mr-2 inline-block rounded px-1.5 py-0.5 text-[10px] ${(log.status === "success") ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>
          {log.status as string}
        </span>
        <span className="font-mono text-zinc-200">{log.tool_name as string}</span>
        <span className="ml-2 text-zinc-500">{log.provider as string} · {log.duration_ms as number}ms</span>
        {!!log.error && <span className="ml-2 text-red-400">{(log.error as string).slice(0, 60)}</span>}
      </div>
    );
  }

  if (tab === "score_history") {
    return (
      <div className="text-xs">
        <span className="mr-2 inline-block rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-300 font-mono">
          {Math.round(log.overall_score as number)}%
        </span>
        <span className="text-zinc-200">{log.buying_stage as string}</span>
        {!!log.reasoning && <span className="ml-2 text-zinc-500 truncate">{(log.reasoning as string).slice(0, 80)}</span>}
      </div>
    );
  }

  if (tab === "wa_lark_mirror_log") {
    return (
      <div className="text-xs">
        <span className="text-zinc-200 font-mono">{log.file_name as string ?? "(no name)"}</span>
        <span className="ml-2 text-zinc-500">{(log.status as string) ?? "—"}</span>
      </div>
    );
  }

  return <div className="text-xs text-zinc-500">{log.id as string}</div>;
}

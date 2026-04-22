"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface AuditEntry {
  id: string;
  tenant_id: string;
  phone: string;
  contact_name: string | null;
  wa_message_id: string | null;
  direction: string;
  decision: string;
  content_preview: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const DECISION_COLORS: Record<string, string> = {
  whitelisted_ai_reply_start: "bg-blue-500/15 text-blue-400",
  reply_sent: "bg-emerald-500/15 text-emerald-300",
  notify_fired: "bg-amber-500/15 text-amber-300",
  not_whitelisted_skipped: "bg-zinc-700 text-zinc-400",
  doc_created: "bg-purple-500/15 text-purple-300",
  event_booked: "bg-indigo-500/15 text-indigo-300",
  event_deleted: "bg-red-500/15 text-red-300",
  claude_failed_queued_for_retry: "bg-red-500/20 text-red-400",
};

const DECISION_LABELS: Record<string, string> = {
  whitelisted_ai_reply_start: "AI Start",
  reply_sent: "Reply Sent",
  notify_fired: "Notify",
  not_whitelisted_skipped: "Skipped",
  doc_created: "Doc Created",
  event_booked: "Event Booked",
  event_deleted: "Event Deleted",
  claude_failed_queued_for_retry: "Claude Failed",
};

const DIRECTION_ICON: Record<string, string> = {
  inbound: "\u2b07",
  outbound: "\u2b06",
};

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [decisions, setDecisions] = useState<string[]>([]);
  const [filterDecision, setFilterDecision] = useState("");
  const [filterPhone, setFilterPhone] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastSync, setLastSync] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    if (filterDecision) params.set("decision", filterDecision);
    if (filterPhone) params.set("phone", filterPhone);
    if (search) params.set("search", search);

    const res = await fetch(`/api/admin/audit-log?${params}`);
    if (res.ok) {
      const data = await res.json();
      setLogs(data.logs);
      setTotal(data.total);
      setDecisions(data.decisions);
      setError("");
    } else {
      setError("Access denied \u2014 directors only");
    }
    setLastSync(new Date().toLocaleTimeString());
    setLoading(false);
  }, [page, limit, filterDecision, filterPhone, search]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, load]);

  const totalPages = Math.ceil(total / limit);

  function formatTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString("en-MY", {
      timeZone: "Asia/Kuala_Lumpur",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-red-400">
        <div className="text-center">
          <p className="text-lg font-medium">{error}</p>
          <Link href="/chat" className="mt-4 inline-block text-sm text-zinc-500 hover:text-zinc-300">
            Back to chat
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-7xl px-4 py-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <Link href="/admin" className="text-zinc-500 hover:text-zinc-300 text-sm">
                &larr; Admin
              </Link>
              <h1 className="text-xl font-semibold">WhatsApp Audit Log</h1>
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              {total} total events &middot; Last sync: {lastSync}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded border-zinc-600"
              />
              Auto-refresh
            </label>
            <button
              onClick={() => { setLoading(true); load(); }}
              className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <select
            value={filterDecision}
            onChange={(e) => { setFilterDecision(e.target.value); setPage(1); }}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white"
          >
            <option value="">All decisions</option>
            {decisions.map((d) => (
              <option key={d} value={d}>{DECISION_LABELS[d] || d}</option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Filter by phone..."
            value={filterPhone}
            onChange={(e) => { setFilterPhone(e.target.value); setPage(1); }}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 w-40"
          />

          <form
            onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); setPage(1); }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              placeholder="Search content..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 w-48"
            />
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-500"
            >
              Search
            </button>
          </form>

          {(filterDecision || filterPhone || search) && (
            <button
              onClick={() => { setFilterDecision(""); setFilterPhone(""); setSearch(""); setSearchInput(""); setPage(1); }}
              className="text-sm text-zinc-500 hover:text-zinc-300"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Table */}
        {loading && logs.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/50 text-left text-xs text-zinc-500 uppercase tracking-wider">
                  <th className="px-4 py-3">Time (MYT)</th>
                  <th className="px-4 py-3">Dir</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Decision</th>
                  <th className="px-4 py-3">Content</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-zinc-800/50 hover:bg-zinc-900/40 cursor-pointer transition-colors"
                    onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-400 font-mono text-xs">
                      {formatTime(log.created_at)}
                    </td>
                    <td className="px-4 py-3 text-center" title={log.direction}>
                      {DIRECTION_ICON[log.direction] || log.direction}
                    </td>
                    <td className="px-4 py-3 text-zinc-200 max-w-[140px] truncate">
                      {log.contact_name || "\u2014"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                      {log.phone}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${DECISION_COLORS[log.decision] || "bg-zinc-700 text-zinc-400"}`}>
                        {DECISION_LABELS[log.decision] || log.decision}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-400 max-w-[300px] truncate">
                      {log.content_preview?.slice(0, 80) || "\u2014"}
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-zinc-600">
                      No audit log entries found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* Expanded detail */}
            {expandedId && (() => {
              const log = logs.find((l) => l.id === expandedId);
              if (!log) return null;
              return (
                <div className="border-t border-zinc-800 bg-zinc-900/60 px-6 py-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <h4 className="text-xs uppercase text-zinc-500 mb-1">Full Content</h4>
                      <pre className="whitespace-pre-wrap text-zinc-300 text-xs leading-relaxed max-h-60 overflow-y-auto bg-zinc-800/50 rounded-lg p-3">
                        {log.content_preview || "(empty)"}
                      </pre>
                    </div>
                    <div>
                      <h4 className="text-xs uppercase text-zinc-500 mb-1">Metadata</h4>
                      <pre className="whitespace-pre-wrap text-zinc-300 text-xs leading-relaxed max-h-60 overflow-y-auto bg-zinc-800/50 rounded-lg p-3">
                        {log.metadata ? JSON.stringify(log.metadata, null, 2) : "(none)"}
                      </pre>
                      <div className="mt-3 space-y-1 text-xs text-zinc-500">
                        <p>Tenant: <span className="font-mono text-zinc-400">{log.tenant_id}</span></p>
                        <p>Message ID: <span className="font-mono text-zinc-400">{log.wa_message_id || "\u2014"}</span></p>
                        <p>Event ID: <span className="font-mono text-zinc-400">{log.id}</span></p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <p className="text-zinc-500">
              Page {page} of {totalPages} ({total} entries)
            </p>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="rounded-lg bg-zinc-800 px-3 py-1.5 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                className="rounded-lg bg-zinc-800 px-3 py-1.5 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

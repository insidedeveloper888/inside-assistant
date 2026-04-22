"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface WebhookLog {
  id: string;
  instance_name: string;
  event_type: string;
  contact_jid: string | null;
  direction: string | null;
  message_type: string | null;
  lead_source: string | null;
  lead_source_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

const SOURCE_COLORS: Record<string, string> = {
  facebook_ad: "bg-blue-500/15 text-blue-400",
  instagram_ad: "bg-pink-500/15 text-pink-400",
  ctwa_ad: "bg-amber-500/15 text-amber-300",
};

export default function WebhookLogsPage() {
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterEvent, setFilterEvent] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterDirection, setFilterDirection] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastSync, setLastSync] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (filterEvent) params.set("event_type", filterEvent);
    if (filterSource) params.set("lead_source", filterSource);
    if (filterDirection) params.set("direction", filterDirection);

    const res = await fetch(`/api/admin/webhook-logs?${params}`);
    if (res.ok) {
      const data = await res.json();
      setLogs(data.logs);
      setTotal(data.total);
      setError("");
    } else {
      setError("Access denied \u2014 directors only");
    }
    setLastSync(new Date().toLocaleTimeString());
    setLoading(false);
  }, [page, limit, filterEvent, filterSource, filterDirection]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, load]);

  const totalPages = Math.ceil(total / limit);

  function formatTime(iso: string) {
    return new Date(iso).toLocaleString("en-MY", {
      timeZone: "Asia/Kuala_Lumpur",
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
  }

  function extractPreview(payload: Record<string, unknown>): string {
    const msg = payload as { message?: Record<string, unknown>; pushName?: string };
    if (msg.message?.conversation) return String(msg.message.conversation).slice(0, 60);
    if (msg.message?.extendedTextMessage) {
      const ext = msg.message.extendedTextMessage as { text?: string };
      return (ext.text ?? "").slice(0, 60);
    }
    if (msg.pushName) return `[${msg.pushName}]`;
    return "\u2014";
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-red-400">
        <div className="text-center">
          <p className="text-lg font-medium">{error}</p>
          <Link href="/admin" className="mt-4 inline-block text-sm text-zinc-500 hover:text-zinc-300">Back to Admin</Link>
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
              <Link href="/admin" className="text-zinc-500 hover:text-zinc-300 text-sm">&larr; Admin</Link>
              <h1 className="text-xl font-semibold">Raw Webhook Logs</h1>
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              {total} total events &middot; Last sync: {lastSync}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="rounded border-zinc-600" />
              Live
            </label>
            <button onClick={() => { setLoading(true); load(); }} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700">
              Refresh
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <select value={filterEvent} onChange={(e) => { setFilterEvent(e.target.value); setPage(1); }}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white">
            <option value="">All events</option>
            <option value="messages.upsert">messages.upsert</option>
            <option value="send.message">send.message</option>
            <option value="connection.update">connection.update</option>
            <option value="qrcode.updated">qrcode.updated</option>
          </select>

          <select value={filterDirection} onChange={(e) => { setFilterDirection(e.target.value); setPage(1); }}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white">
            <option value="">All directions</option>
            <option value="inbound">Inbound</option>
            <option value="outbound">Outbound</option>
          </select>

          <select value={filterSource} onChange={(e) => { setFilterSource(e.target.value); setPage(1); }}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white">
            <option value="">All sources</option>
            <option value="facebook_ad">Facebook Ad</option>
            <option value="instagram_ad">Instagram Ad</option>
            <option value="ctwa_ad">CTWA Ad</option>
          </select>

          {(filterEvent || filterSource || filterDirection) && (
            <button onClick={() => { setFilterEvent(""); setFilterSource(""); setFilterDirection(""); setPage(1); }}
              className="text-sm text-zinc-500 hover:text-zinc-300">Clear filters</button>
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
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Dir</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Preview</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}
                    className={`border-b border-zinc-800/50 hover:bg-zinc-900/40 cursor-pointer transition-colors ${log.lead_source ? "bg-emerald-500/5" : ""}`}
                    onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}>
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-400 font-mono text-xs">{formatTime(log.created_at)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-300">{log.event_type}</td>
                    <td className="px-4 py-3 text-center">{log.direction === "inbound" ? "\u2b07" : log.direction === "outbound" ? "\u2b06" : "\u2014"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500 max-w-[140px] truncate">{log.contact_jid?.split("@")[0] || "\u2014"}</td>
                    <td className="px-4 py-3 text-xs text-zinc-400">{log.message_type || "\u2014"}</td>
                    <td className="px-4 py-3">
                      {log.lead_source ? (
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${SOURCE_COLORS[log.lead_source] || "bg-zinc-700 text-zinc-400"}`}>
                          {log.lead_source}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-600">\u2014</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-400 max-w-[200px] truncate text-xs">{extractPreview(log.payload)}</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-zinc-600">No webhook logs yet — send a WhatsApp message to start logging</td></tr>
                )}
              </tbody>
            </table>

            {/* Expanded JSON */}
            {expandedId && (() => {
              const log = logs.find((l) => l.id === expandedId);
              if (!log) return null;
              return (
                <div className="border-t border-zinc-800 bg-zinc-900/60 px-6 py-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs uppercase text-zinc-500">Full Webhook Payload</h4>
                    <div className="flex items-center gap-3 text-xs text-zinc-500">
                      {log.lead_source && (
                        <span>Source: <span className="text-emerald-400 font-medium">{log.lead_source}</span> (ID: {log.lead_source_id || "none"})</span>
                      )}
                      <span>Instance: {log.instance_name}</span>
                    </div>
                  </div>
                  <pre className="whitespace-pre-wrap text-zinc-300 text-xs leading-relaxed max-h-[500px] overflow-y-auto bg-zinc-800/50 rounded-lg p-4 font-mono">
                    {JSON.stringify(log.payload, null, 2)}
                  </pre>
                </div>
              );
            })()}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <p className="text-zinc-500">Page {page} of {totalPages} ({total} entries)</p>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)}
                className="rounded-lg bg-zinc-800 px-3 py-1.5 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed">Previous</button>
              <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}
                className="rounded-lg bg-zinc-800 px-3 py-1.5 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

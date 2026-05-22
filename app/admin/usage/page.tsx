"use client";

import { useEffect, useState } from "react";

type Bucket = { key: string; count: number };

interface Usage {
  generated_at: string;
  scoring: { day: number; week: number; month: number; by_provider: Bucket[] };
  wa_reply: { day: number; week: number; month: number; by_provider: Bucket[] };
  web_chat: { day: number; week: number; month: number; by_provider: Bucket[] };
  throttle_skips_7d: Bucket[];
}

// Rough per-call cost (USD) for the providers we use. Reality varies with
// token counts — these are eyeball numbers good enough to spot anomalies,
// not for billing. Update when prices change.
const COST_PER_CALL: Record<string, number> = {
  "byteplus/deepseek-v3-2-251201": 0.0003, // ~500 in / 200 out * V3.2 pricing
  "claude_proxy/claude-proxy": 0.0015,
  "openai/gpt-4o-mini": 0.0002,
};

function estCost(buckets: Bucket[]): number {
  return buckets.reduce((sum, b) => sum + b.count * (COST_PER_CALL[b.key] ?? 0.0005), 0);
}

export default function UsagePage() {
  const [data, setData] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/usage");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading && !data) {
    return <div className="flex h-full items-center justify-center"><p className="text-sm text-muted-foreground">Loading usage…</p></div>;
  }
  if (error) {
    return <div className="flex h-full items-center justify-center"><p className="text-sm text-red-400">⚠ {error}</p></div>;
  }
  if (!data) return null;

  const totalDay = data.scoring.day + data.wa_reply.day + data.web_chat.day;
  const totalMonth = data.scoring.month + data.wa_reply.month + data.web_chat.month;
  const monthlyCostEst =
    estCost(data.scoring.by_provider) +
    estCost(data.wa_reply.by_provider) +
    estCost(data.web_chat.by_provider);

  return (
    <div className="p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">AI Usage</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Calls across scoring, WhatsApp AI, and web chat — updated when you click Refresh.
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground/70">
              Snapshot: {new Date(data.generated_at).toLocaleString()}
            </p>
          </div>
          <button
            onClick={load}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            ↻ Refresh
          </button>
        </div>

        {/* Top summary */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <SummaryCard label="Calls today" value={totalDay} />
          <SummaryCard label="Calls past 30 days" value={totalMonth} />
          <SummaryCard label="Est. cost (30d, USD)" value={`$${monthlyCostEst.toFixed(2)}`} />
        </div>

        {/* Per-surface */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SurfaceCard title="Scoring engine" surface={data.scoring} />
          <SurfaceCard title="WhatsApp AI reply" surface={data.wa_reply} />
          <SurfaceCard title="Inside Assistant /chat" surface={data.web_chat} />
        </div>

        {/* Throttle */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold">Scoring throttle (last 7 days)</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            How many inbound messages were silently skipped instead of triggering a score, and why.
            Higher = more savings.
          </p>
          {data.throttle_skips_7d.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground/70">
              No skips recorded. Either nothing was throttled, or the throttle code hasn&apos;t been deployed yet
              (check Zeabur → webhook-receiver redeploy).
            </p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2">Reason</th>
                  <th className="pb-2 text-right">Count</th>
                </tr>
              </thead>
              <tbody>
                {data.throttle_skips_7d.map((b) => (
                  <tr key={b.key} className="border-b border-border/50 last:border-0">
                    <td className="py-2 font-mono text-xs">{b.key}</td>
                    <td className="py-2 text-right font-mono text-sm">{b.count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 font-mono text-3xl font-semibold" data-numeric>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
    </div>
  );
}

function SurfaceCard({
  title,
  surface,
}: {
  title: string;
  surface: { day: number; week: number; month: number; by_provider: Bucket[] };
}) {
  const cost = estCost(surface.by_provider);
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="text-base font-semibold">{title}</h2>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Counter label="24h" value={surface.day} />
        <Counter label="7d" value={surface.week} />
        <Counter label="30d" value={surface.month} />
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Est. 30d cost: <span className="font-mono text-foreground">${cost.toFixed(3)}</span>
      </p>

      <div className="mt-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Provider / model (30d)
        </p>
        {surface.by_provider.length === 0 ? (
          <p className="mt-1.5 text-xs text-muted-foreground/70">No tracked calls yet.</p>
        ) : (
          <ul className="mt-1.5 space-y-1 text-xs">
            {surface.by_provider.map((b) => (
              <li key={b.key} className="flex items-center justify-between">
                <span className="truncate font-mono">{b.key}</span>
                <span className="font-mono">{b.count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-base font-semibold" data-numeric>
        {value.toLocaleString()}
      </p>
    </div>
  );
}

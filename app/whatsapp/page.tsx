"use client";

import { useEffect, useState } from "react";

interface WhitelistEntry {
  id: string;
  phone: string;
  name: string;
  lark_open_id: string | null;
  mode: string;
  is_enabled: boolean;
  claude_md?: string | null;
}

interface LarkUser {
  name: string;
  enName: string;
  openId: string;
  email: string;
}

export default function WhatsAppWhitelistPage() {
  const [entries, setEntries] = useState<WhitelistEntry[]>([]);
  const [larkUsers, setLarkUsers] = useState<LarkUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newEntry, setNewEntry] = useState({ phone: "", name: "", larkOpenId: "" });
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch("/api/admin/whitelist");
    if (!res.ok) {
      setError(res.status === 403 ? "Directors only" : "Failed to load");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setEntries(data.whitelist ?? []);
    setLarkUsers(data.larkUsers ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function addEntry() {
    if (!newEntry.phone || !newEntry.name) return;
    setSaving(true);
    const res = await fetch("/api/admin/whitelist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", ...newEntry }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json();
      alert(d.error || "Failed");
      return;
    }
    setShowAdd(false);
    setNewEntry({ phone: "", name: "", larkOpenId: "" });
    load();
  }

  async function toggle(id: string, isEnabled: boolean) {
    await fetch("/api/admin/whitelist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle", id, isEnabled }),
    });
    load();
  }

  async function remove(entry: WhitelistEntry) {
    if (!confirm(`Remove ${entry.name} (${entry.phone}) from WhatsApp AI whitelist?`)) return;
    await fetch("/api/admin/whitelist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id: entry.id }),
    });
    load();
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center"><p className="text-sm text-muted-foreground">Loading…</p></div>;
  }
  if (error) {
    return <div className="flex h-full items-center justify-center"><p className="text-sm text-red-400">{error}</p></div>;
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">WhatsApp AI Whitelist</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Phone numbers allowed to trigger AI replies. Toggle to pause without removing.
            </p>
          </div>
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            {showAdd ? "Cancel" : "+ Add Number"}
          </button>
        </div>

        {showAdd && (
          <div className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <input
                value={newEntry.phone}
                onChange={(e) => setNewEntry({ ...newEntry, phone: e.target.value })}
                placeholder="Phone (e.g. 60162193255)"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <input
                value={newEntry.name}
                onChange={(e) => setNewEntry({ ...newEntry, name: e.target.value })}
                placeholder="Name"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <select
                value={newEntry.larkOpenId}
                onChange={(e) => setNewEntry({ ...newEntry, larkOpenId: e.target.value })}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="">Link Lark account (optional)</option>
                {larkUsers.map((u) => (
                  <option key={u.openId} value={u.openId}>{u.name} ({u.email || u.enName})</option>
                ))}
              </select>
            </div>
            <button
              onClick={addEntry}
              disabled={saving || !newEntry.phone || !newEntry.name}
              className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add"}
            </button>
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Phone</th>
                <th className="px-4 py-2.5 font-medium">Mode</th>
                <th className="px-4 py-2.5 font-medium">Lark</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-xs text-muted-foreground">
                    No whitelist entries yet.
                  </td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium">{e.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{e.phone}</td>
                    <td className="px-4 py-3 text-xs">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {e.mode}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {e.lark_open_id ? (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-500">linked</span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggle(e.id, !e.is_enabled)}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          e.is_enabled
                            ? "bg-emerald-500/15 text-emerald-500"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {e.is_enabled ? "✓ Active" : "Paused"}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => remove(e)}
                        className="rounded px-2 py-1 text-[10px] text-red-500/70 hover:bg-red-500/10 hover:text-red-500"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Member {
  user_id: string;
  display_name: string;
  phone: string | null;
  email: string | null;
  lark_open_id: string | null;
  lark_name: string | null;
  lark_verified: boolean;
  role: string;
}

interface WhitelistEntry {
  id: string;
  phone: string;
  name: string;
  lark_open_id: string | null;
  is_enabled: boolean;
  mode: string;
}

interface LarkUser {
  name: string;
  enName: string;
  openId: string;
  email: string;
  tier: string;
  role: string;
}

export default function AdminPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [whitelist, setWhitelist] = useState<WhitelistEntry[]>([]);
  const [larkUsers, setLarkUsers] = useState<LarkUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Member>>({});
  const [saving, setSaving] = useState(false);
  const [lastSync, setLastSync] = useState<string>("");

  // Add member form
  const [showAdd, setShowAdd] = useState(false);
  const [newMember, setNewMember] = useState({ displayName: "", phone: "", email: "", larkOpenId: "", larkName: "", role: "member" });

  async function load() {
    const res = await fetch("/api/admin/team");
    if (res.ok) {
      const data = await res.json();
      setMembers(data.members);
      setWhitelist(data.whitelist);
      setLarkUsers(data.larkUsers);
    } else {
      setError("Access denied — directors only");
    }
    setLastSync(new Date().toLocaleTimeString());
    setLoading(false);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000); // Auto-refresh every 5s
    return () => clearInterval(interval);
  }, []);

  async function saveMember(userId: string) {
    setSaving(true);
    await fetch("/api/admin/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update-member", userId, ...editData }),
    });
    setSaving(false);
    setEditingId(null);
    load();
  }

  async function addMember() {
    setSaving(true);
    await fetch("/api/admin/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add-member", ...newMember }),
    });
    setSaving(false);
    setShowAdd(false);
    setNewMember({ displayName: "", phone: "", email: "", larkOpenId: "", larkName: "", role: "member" });
    load();
  }

  async function toggleWhatsApp(phone: string, isEnabled: boolean) {
    await fetch("/api/admin/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle-whatsapp", phone, isEnabled }),
    });
    load();
  }

  function getWhitelistEntry(phone: string | null) {
    if (!phone) return null;
    return whitelist.find((w) => w.phone === phone.replace(/\D/g, ""));
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-zinc-950"><p className="text-sm text-zinc-500">Loading...</p></div>;
  }
  if (error) {
    return <div className="flex min-h-screen items-center justify-center bg-zinc-950"><div className="text-center"><p className="text-sm text-red-400">{error}</p><Link href="/chat" className="mt-2 text-xs text-zinc-500 hover:text-zinc-300">← Back to Chat</Link></div></div>;
  }

  return (
    <div className="min-h-screen bg-zinc-950 p-6">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-200">🔧 Team Management</h1>
            <p className="text-xs text-zinc-500 mt-1">Manage identities across Inside Assistant, WhatsApp AI, and Lark</p>
            {lastSync && <p className="text-[10px] text-zinc-600 mt-0.5">🔄 Live · Last synced {lastSync}</p>}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={load} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200">↻ Refresh</button>
            <Link href="/chat" className="text-xs text-zinc-500 hover:text-zinc-300">← Back to Chat</Link>
          </div>
        </div>

        {/* Team Members */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-200">👥 Team Members <span className="text-[10px] text-zinc-600 font-normal">({members.length} members, {larkUsers.length} Lark users loaded)</span></h2>
            <button
              onClick={() => setShowAdd(!showAdd)}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
            >
              {showAdd ? "Cancel" : "+ Add Member"}
            </button>
          </div>

          {/* Add member form */}
          {showAdd && (
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <input value={newMember.displayName} onChange={(e) => setNewMember({ ...newMember, displayName: e.target.value })} placeholder="Name *" className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-white placeholder-zinc-600 outline-none focus:border-indigo-500" />
                <input value={newMember.email} onChange={(e) => setNewMember({ ...newMember, email: e.target.value })} placeholder="Email (for web login)" className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-white placeholder-zinc-600 outline-none focus:border-indigo-500" />
                <input value={newMember.phone} onChange={(e) => setNewMember({ ...newMember, phone: e.target.value })} placeholder="Phone (for WhatsApp AI)" className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-white placeholder-zinc-600 outline-none focus:border-indigo-500" />
                <select value={newMember.larkOpenId} onChange={(e) => { const u = larkUsers.find(l => l.openId === e.target.value); setNewMember({ ...newMember, larkOpenId: e.target.value, larkName: u?.name || "" }); }} className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-white outline-none focus:border-indigo-500">
                  <option value="">Link Lark account</option>
                  {larkUsers.map((u) => <option key={u.openId} value={u.openId}>{u.name} ({u.email || u.enName})</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <select value={newMember.role} onChange={(e) => setNewMember({ ...newMember, role: e.target.value })} className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-white outline-none">
                  <option value="member">Member</option>
                  <option value="manager">Manager</option>
                  <option value="director">Director</option>
                </select>
                <button onClick={addMember} disabled={saving || !newMember.displayName} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
                  {saving ? "Adding..." : "Add Member"}
                </button>
              </div>
            </div>
          )}

          {/* Members table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-zinc-500">
                  <th className="pb-2 pr-4 font-medium">Name</th>
                  <th className="pb-2 pr-4 font-medium">Email (Web)</th>
                  <th className="pb-2 pr-4 font-medium">Phone (WhatsApp)</th>
                  <th className="pb-2 pr-4 font-medium">Lark</th>
                  <th className="pb-2 pr-4 font-medium">Role</th>
                  <th className="pb-2 pr-4 font-medium">WhatsApp AI</th>
                  <th className="pb-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const isEditing = editingId === m.user_id;
                  const waEntry = getWhitelistEntry(m.phone);

                  if (isEditing) {
                    return (
                      <tr key={m.user_id} className="border-b border-zinc-800/50">
                        <td className="py-2 pr-2"><input value={editData.display_name ?? m.display_name ?? ""} onChange={(e) => setEditData({ ...editData, display_name: e.target.value })} className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-white outline-none" /></td>
                        <td className="py-2 pr-2"><input value={editData.email ?? m.email ?? ""} onChange={(e) => setEditData({ ...editData, email: e.target.value })} className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-white outline-none" /></td>
                        <td className="py-2 pr-2"><input value={editData.phone ?? m.phone ?? ""} onChange={(e) => setEditData({ ...editData, phone: e.target.value })} placeholder="60162193255" className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-white outline-none" /></td>
                        <td className="py-2 pr-2">
                          <select value={editData.lark_open_id ?? m.lark_open_id ?? ""} onChange={(e) => { const u = larkUsers.find(l => l.openId === e.target.value); setEditData({ ...editData, lark_open_id: e.target.value || null, lark_name: u?.name || null }); }} className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-white outline-none">
                            <option value="">Not linked</option>
                            {larkUsers.length === 0 && <option disabled>Loading Lark users...</option>}
                            {larkUsers.map((u) => <option key={u.openId} value={u.openId}>{u.name} — {u.email || u.enName}</option>)}
                          </select>
                        </td>
                        <td className="py-2 pr-2">
                          <select value={editData.role ?? m.role} onChange={(e) => setEditData({ ...editData, role: e.target.value })} className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-white outline-none">
                            <option value="member">Member</option>
                            <option value="manager">Manager</option>
                            <option value="director">Director</option>
                          </select>
                        </td>
                        <td className="py-2 pr-2 text-[10px] text-zinc-500">Save first</td>
                        <td className="py-2">
                          <div className="flex gap-1">
                            <button onClick={async () => { await saveMember(m.user_id); }} disabled={saving} className="rounded bg-indigo-600 px-2 py-1 text-[10px] text-white hover:bg-indigo-500 disabled:opacity-50">{saving ? "Saving..." : "Save"}</button>
                            <button onClick={() => setEditingId(null)} className="rounded bg-zinc-700 px-2 py-1 text-[10px] text-zinc-300">Cancel</button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={m.user_id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="py-2.5 pr-4">
                        <span className="font-medium text-zinc-200">{m.lark_name || m.display_name}</span>
                      </td>
                      <td className="py-2.5 pr-4 text-zinc-400">{m.email || <span className="text-zinc-600">—</span>}</td>
                      <td className="py-2.5 pr-4 font-mono text-zinc-400">{m.phone || <span className="text-zinc-600">—</span>}</td>
                      <td className="py-2.5 pr-4">
                        {m.lark_verified ? (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-400">✓ {m.lark_name}</span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          m.role === "director" ? "bg-indigo-500/15 text-indigo-400" :
                          m.role === "manager" ? "bg-amber-500/15 text-amber-400" :
                          "bg-zinc-700 text-zinc-400"
                        }`}>{m.role}</span>
                      </td>
                      <td className="py-2.5 pr-4">
                        {waEntry ? (
                          <button
                            onClick={() => toggleWhatsApp(m.phone!, !waEntry.is_enabled)}
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              waEntry.is_enabled
                                ? "bg-emerald-500/15 text-emerald-400"
                                : "bg-zinc-700 text-zinc-500"
                            }`}
                          >
                            {waEntry.is_enabled ? "✓ Active" : "Paused"}
                          </button>
                        ) : (
                          <span className="text-[10px] text-zinc-600">{m.phone ? "Not enabled" : "No phone"}</span>
                        )}
                      </td>
                      <td className="py-2.5">
                        <button
                          onClick={() => { setEditingId(m.user_id); setEditData({}); }}
                          className="rounded px-2 py-1 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Identity Mapping and Lark Users hidden — managed via Edit inline */}
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";

export default function SettingsPage() {
  const [claudeMd, setClaudeMd] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("member");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("assistant_user_settings")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (data) {
        setClaudeMd(data.claude_md || "");
        setDisplayName(data.display_name || "");
        setRole(data.role || "member");
      }
      setLoading(false);
    }
    load();
  }, [supabase]);

  async function handleSave() {
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from("assistant_user_settings")
      .update({
        claude_md: claudeMd,
        display_name: displayName,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <p className="text-sm text-zinc-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-zinc-200">Settings</h1>
          <Link
            href="/chat"
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            ← Back to Chat
          </Link>
        </div>

        {/* Display Name */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
          <label className="text-sm font-medium text-zinc-300">Display Name</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-indigo-500"
          />
          <p className="text-[11px] text-zinc-500">
            This is how the AI will address you. Role: <span className="text-zinc-400 font-medium">{role}</span>
          </p>
        </div>

        {/* Claude.md */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
          <label className="text-sm font-medium text-zinc-300">
            Claude.md — Personal AI Instructions
          </label>
          <textarea
            value={claudeMd}
            onChange={(e) => setClaudeMd(e.target.value)}
            rows={12}
            placeholder={`# My Instructions\n\n- I prefer concise answers\n- I work in sales, focus on that context\n- Always respond in English\n- When I ask about clients, check company brain first`}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-indigo-500 font-mono"
          />
          <p className="text-[11px] text-zinc-500">
            These instructions are injected into every AI conversation. Use markdown. They persist across all your sessions.
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? "Saving..." : saved ? "✓ Saved" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}

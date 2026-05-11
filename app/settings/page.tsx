"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase-browser";

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
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Personalize how the AI addresses you and what context it carries between conversations.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 space-y-3 shadow-sm">
          <label className="text-sm font-medium">Display Name</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <p className="text-[11px] text-muted-foreground">
            This is how the AI will address you. Role: <span className="font-medium text-foreground/80">{role}</span>
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 space-y-3 shadow-sm">
          <label className="text-sm font-medium">Claude.md — Personal AI Instructions</label>
          <textarea
            value={claudeMd}
            onChange={(e) => setClaudeMd(e.target.value)}
            rows={12}
            placeholder={`# My Instructions\n\n- I prefer concise answers\n- I work in sales, focus on that context\n- Always respond in English\n- When I ask about clients, check company brain first`}
            className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm font-mono outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <p className="text-[11px] text-muted-foreground">
            These instructions are injected into every AI conversation. Use markdown. They persist across all your sessions.
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md disabled:opacity-50"
        >
          {saving ? "Saving…" : saved ? "✓ Saved" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search, MessageCircle, Plus, Database, ExternalLink, Users,
  Phone, Activity, ScrollText, Plug, User2, Sun, Moon, LogOut,
  Shield, Command,
} from "lucide-react";
import { useTheme } from "next-themes";
import { createClient } from "@/lib/supabase-browser";
import type { ChatSession, SidebarUser } from "./sidebar";
import { cn } from "@/lib/utils";

type CommandItem = {
  id: string;
  label: string;
  hint?: string;
  icon: typeof MessageCircle;
  group: "Navigation" | "Chats" | "Actions";
  action: () => void;
  keywords?: string;
};

/**
 * App-wide command palette. Triggered by:
 *   - Cmd+K / Ctrl+K
 *   - The `ia:openCommandPalette` window event (dispatched by the sidebar
 *     hint button)
 *
 * Items: every nav link in the sidebar + the 15 most-recent chats + a few
 * common actions (new chat, sign out, toggle theme).
 */
export function CommandPalette({
  user,
  sessions,
}: {
  user: SidebarUser;
  sessions: ChatSession[];
}) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isDirector = user.role === "director";

  // Global open/close: Cmd+K, Ctrl+K, or the custom event
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    const onCustom = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("ia:openCommandPalette", onCustom);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("ia:openCommandPalette", onCustom);
    };
  }, [open]);

  // Reset query + focus the input each time we open
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.assign("/login");
  }

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  const items = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = [
      { id: "new-chat", label: "New chat", icon: Plus, group: "Actions", action: () => go("/chat"), keywords: "create start" },
      { id: "nav-chat", label: "Chat", hint: "/chat", icon: MessageCircle, group: "Navigation", action: () => go("/chat") },
      { id: "nav-memories", label: "Memories", hint: "/admin/memories", icon: Database, group: "Navigation", action: () => go("/admin/memories"), keywords: "knowledge pgvector" },
      { id: "nav-vault", label: "Obsidian Vault", hint: "GitHub", icon: ExternalLink, group: "Navigation", action: () => { setOpen(false); window.open("https://github.com/insidedeveloper888/wa-vault", "_blank"); }, keywords: "knowledge notes" },
      { id: "nav-settings", label: "Profile / Settings", hint: "/settings", icon: User2, group: "Navigation", action: () => go("/settings") },
      { id: "nav-integrations", label: "Integrations", hint: "/settings/integrations", icon: Plug, group: "Navigation", action: () => go("/settings/integrations"), keywords: "github lark google whatsapp automations" },
    ];

    if (isDirector) {
      list.push(
        { id: "nav-team", label: "Team Members", hint: "/admin", icon: Users, group: "Navigation", action: () => go("/admin"), keywords: "directors managers staff" },
        { id: "nav-whatsapp", label: "WhatsApp Whitelist", hint: "/whatsapp", icon: Phone, group: "Navigation", action: () => go("/whatsapp") },
        { id: "nav-observability", label: "Observability", hint: "/admin/observability", icon: Activity, group: "Navigation", action: () => go("/admin/observability"), keywords: "logs metrics cost" },
        { id: "nav-audit", label: "Audit Log", hint: "/admin/audit-log", icon: ScrollText, group: "Navigation", action: () => go("/admin/audit-log") },
      );
    }

    for (const s of sessions.slice(0, 15)) {
      list.push({
        id: `session-${s.id}`,
        label: s.title || "Untitled chat",
        hint: s.mode === "company" ? "🏢 Company" : "💬 Personal",
        icon: MessageCircle,
        group: "Chats",
        action: () => go(`/chat/${s.id}`),
        keywords: s.mode,
      });
    }

    list.push(
      { id: "toggle-theme", label: theme === "dark" ? "Switch to light mode" : "Switch to dark mode", icon: theme === "dark" ? Sun : Moon, group: "Actions", action: () => { setTheme(theme === "dark" ? "light" : "dark"); setOpen(false); } },
      { id: "sign-out", label: "Sign out", icon: LogOut, group: "Actions", action: handleSignOut },
    );

    return list;
  }, [sessions, isDirector, theme, setTheme]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const hay = `${it.label} ${it.hint ?? ""} ${it.keywords ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, query]);

  // Keyboard navigation within results
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && filtered[activeIdx]) {
        e.preventDefault();
        filtered[activeIdx].action();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, activeIdx]);

  // Reset highlight when results shrink
  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(Math.max(0, filtered.length - 1));
  }, [filtered.length, activeIdx]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  if (!open) return null;

  // Group items by their group for rendering
  const groups: Record<string, CommandItem[]> = {};
  filtered.forEach((it) => {
    (groups[it.group] = groups[it.group] || []).push(it);
  });
  const groupOrder = ["Actions", "Navigation", "Chats"].filter((g) => groups[g]?.length);

  return (
    <div
      role="dialog"
      aria-label="Command palette"
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl"
        style={{ animation: "fade-in 180ms cubic-bezier(0.16,1,0.3,1) both" }}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
            placeholder="Search pages, chats, actions…"
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">No matches.</p>
          ) : (
            groupOrder.map((g) => (
              <div key={g} className="py-1">
                <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {g}
                </p>
                {groups[g].map((it) => {
                  const Icon = it.icon;
                  const idx = filtered.indexOf(it);
                  return (
                    <button
                      key={it.id}
                      data-idx={idx}
                      onClick={it.action}
                      onMouseEnter={() => setActiveIdx(idx)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                        idx === activeIdx
                          ? "bg-accent text-accent-foreground"
                          : "text-foreground hover:bg-muted"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0 opacity-80" />
                      <span className="min-w-0 flex-1 truncate">{it.label}</span>
                      {it.hint && (
                        <span className="text-[10px] text-muted-foreground">{it.hint}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-background px-1 py-0.5 font-mono">↑</kbd>
              <kbd className="rounded bg-background px-1 py-0.5 font-mono">↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-background px-1 py-0.5 font-mono">↵</kbd>
              open
            </span>
          </span>
          <span className="flex items-center gap-1">
            <Command className="h-3 w-3" />K to toggle
          </span>
        </div>
      </div>
    </div>
  );
}

// Re-export Shield in case it's needed via icons map (otherwise tree-shaken)
export { Shield };

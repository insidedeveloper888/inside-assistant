"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageCircle, Plus, BookOpen, Users, Shield, Settings as SettingsIcon,
  LogOut, Sun, Moon, Search,
  Database, ScrollText, Activity, Phone, User2, Plug,
  ChevronDown, ChevronRight,
  ExternalLink, Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase-browser";
import { useTheme } from "next-themes";

/**
 * Persistent app navigation. Rendered on every authed page (NOT login).
 *
 * Structure:
 *   - Top: IA brand mark + workspace name
 *   - Middle: collapsible sections (Chat, Knowledge, Team, Observability, Settings)
 *   - Bottom: user card + theme toggle + sign out
 *
 * The "Chat" section, when expanded, shows the session list (replaces the
 * old `ChatSidebar` component). Other sections show their sub-links.
 *
 * Mobile: this whole component is rendered inside a slide-in drawer
 * controlled by a hamburger in MobileTopBar. Desktop: fixed-position rail.
 */

export type ChatSession = { id: string; title: string; mode: "personal" | "company"; updated_at: string };

export type SidebarUser = {
  email: string;
  displayName: string;
  role: "director" | "manager" | "member";
  larkVerified: boolean;
};

export function Sidebar({
  user,
  sessions,
  onCloseMobile,
}: {
  user: SidebarUser;
  sessions: ChatSession[];
  /** Set when rendered inside a mobile drawer — called on link clicks to close it */
  onCloseMobile?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isDirector = user.role === "director";
  const { theme, setTheme } = useTheme();
  const [localSessions, setLocalSessions] = useState(sessions);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    setLocalSessions(sessions);
  }, [sessions]);

  async function handleDeleteSession(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this chat? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const res = await fetch("/api/sessions/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
      });
      if (!res.ok) throw new Error(await res.text());
      setLocalSessions((prev) => prev.filter((s) => s.id !== id));
      // If the user was on the deleted chat, send them back to /chat
      if (pathname === `/chat/${id}`) router.push("/chat");
      else router.refresh();
    } catch (err) {
      alert(`Could not delete: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setDeletingId(null);
    }
  }

  // Section open-state — persisted to localStorage so users don't have
  // to re-expand on every reload.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return { chat: true, knowledge: false, team: false, observability: false, settings: false };
    try {
      return JSON.parse(localStorage.getItem("ia:sidebar:sections") ?? "") || { chat: true };
    } catch {
      return { chat: true };
    }
  });
  const toggleSection = (key: string) => {
    setOpenSections((s) => {
      const next = { ...s, [key]: !s[key] };
      try { localStorage.setItem("ia:sidebar:sections", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.assign("/login");
  }

  // Leaf-link active check. We use exact match (not prefix) so that
  // /settings doesn't also light up when the user is on /settings/integrations,
  // and /admin doesn't light up alongside /admin/memories. Sub-route
  // highlighting is handled per-section explicitly where needed.
  const isActive = (href: string) => pathname === href;

  return (
    <aside
      className="flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar"
      aria-label="Main navigation"
    >
      {/* Brand header */}
      <div className="flex items-center gap-3 px-4 py-4">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-xl text-xs font-extrabold tracking-tight text-white"
          style={{
            background: "linear-gradient(135deg, #FB923C 0%, #F97316 50%, #EA580C 100%)",
            letterSpacing: "-0.04em",
            boxShadow: "0 4px 12px rgb(249 115 22 / 0.25)",
          }}
        >
          IA
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight text-sidebar-foreground">Inside Assistant</p>
          <p className="text-xs text-muted-foreground">Inside Advisory</p>
        </div>
      </div>

      {/* Command palette hint */}
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={() => {
            // Command palette wired in a later step. For now, focus chat-input search.
            window.dispatchEvent(new CustomEvent("ia:openCommandPalette"));
          }}
          className="flex w-full items-center gap-2 rounded-lg border border-sidebar-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Quick jump</span>
          <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">⌘K</kbd>
        </button>
      </div>

      {/* Scrollable nav body */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {/* ───── CHAT ───── */}
        <NavSection
          label="Chat"
          icon={MessageCircle}
          open={openSections.chat}
          onToggle={() => toggleSection("chat")}
        >
          <Link
            href="/chat"
            onClick={onCloseMobile}
            prefetch
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              "bg-primary/10 text-primary hover:bg-primary/15"
            )}
          >
            <Plus className="h-3.5 w-3.5" /> New chat
          </Link>
          {localSessions.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">No chats yet</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {localSessions.slice(0, 25).map((s) => {
                const active = isActive(`/chat/${s.id}`);
                return (
                  <li key={s.id} className="group/session relative">
                    <Link
                      href={`/chat/${s.id}`}
                      onClick={onCloseMobile}
                      prefetch
                      className={cn(
                        "flex items-center gap-2 rounded-md px-3 py-1.5 pr-8 text-xs transition-colors",
                        active
                          ? "bg-accent text-accent-foreground font-medium"
                          : "text-foreground/75 hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <span className="text-[10px]" aria-label={s.mode}>
                        {s.mode === "company" ? "🏢" : "💬"}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    </Link>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteSession(e, s.id)}
                      disabled={deletingId === s.id}
                      aria-label={`Delete chat ${s.title}`}
                      className={cn(
                        "absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus:opacity-100 group-hover/session:opacity-100",
                        deletingId === s.id && "opacity-100"
                      )}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                );
              })}
              {localSessions.length > 25 && (
                <li className="px-3 py-1 text-[10px] text-muted-foreground/70">
                  + {localSessions.length - 25} older
                </li>
              )}
            </ul>
          )}
        </NavSection>

        {/* ───── KNOWLEDGE ───── */}
        <NavSection
          label="Knowledge"
          icon={BookOpen}
          open={openSections.knowledge}
          onToggle={() => toggleSection("knowledge")}
        >
          <NavLink href="/admin/memories" icon={Database} label="Memories" isActive={isActive} onClick={onCloseMobile} />
          <NavExternal
            href="https://github.com/insidedeveloper888/wa-vault"
            icon={ExternalLink}
            label="Obsidian Vault"
          />
        </NavSection>

        {/* ───── TEAM (directors only) ───── */}
        {isDirector && (
          <NavSection
            label="Team"
            icon={Users}
            open={openSections.team}
            onToggle={() => toggleSection("team")}
          >
            <NavLink href="/admin" icon={Users} label="Members" isActive={isActive} onClick={onCloseMobile} />
            <NavLink href="/whatsapp" icon={Phone} label="WhatsApp Whitelist" isActive={isActive} onClick={onCloseMobile} />
          </NavSection>
        )}

        {/* ───── OBSERVABILITY (directors only) ───── */}
        {isDirector && (
          <NavSection
            label="Observability"
            icon={Shield}
            open={openSections.observability}
            onToggle={() => toggleSection("observability")}
          >
            <NavLink href="/admin/observability" icon={Activity} label="Activity" isActive={isActive} onClick={onCloseMobile} />
            <NavLink href="/admin/audit-log" icon={ScrollText} label="Audit Log" isActive={isActive} onClick={onCloseMobile} />
          </NavSection>
        )}

        {/* ───── SETTINGS ───── */}
        <NavSection
          label="Settings"
          icon={SettingsIcon}
          open={openSections.settings}
          onToggle={() => toggleSection("settings")}
        >
          <NavLink href="/settings/integrations" icon={Plug} label="Integrations" isActive={isActive} onClick={onCloseMobile} />
          <NavLink href="/settings" icon={User2} label="Profile" isActive={isActive} onClick={onCloseMobile} />
        </NavSection>
      </div>

      {/* Footer: user + theme + sign out */}
      <div className="border-t border-sidebar-border p-3 space-y-2">
        <button
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Sun className="h-4 w-4 dark:hidden" />
          <Moon className="hidden h-4 w-4 dark:block" />
          <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
        </button>

        <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
            {user.displayName.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-foreground">
              {user.displayName}
              {user.larkVerified && (
                <span className="ml-1 text-success" title="Lark verified">✓</span>
              )}
            </p>
            <p className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
              {user.role}
            </p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            aria-label="Sign out"
            title="Sign out"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}

/** Collapsible section heading with chevron rotation. */
function NavSection({
  label,
  icon: Icon,
  open,
  onToggle,
  children,
}: {
  label: string;
  icon: typeof MessageCircle;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="py-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-expanded={open}
      >
        <Icon className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">{label}</span>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>
      {open && <div className="mt-0.5 space-y-0.5">{children}</div>}
    </div>
  );
}

function NavLink({
  href,
  icon: Icon,
  label,
  isActive,
  onClick,
}: {
  href: string;
  icon: typeof MessageCircle;
  label: string;
  isActive: (h: string) => boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      prefetch
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors",
        isActive(href)
          ? "bg-accent text-accent-foreground font-medium"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </Link>
  );
}

function NavExternal({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: typeof MessageCircle;
  label: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="flex-1">{label}</span>
      <ExternalLink className="h-3 w-3 opacity-60" />
    </a>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Sidebar, type ChatSession, type SidebarUser } from "./sidebar";

/**
 * Two-pane shell. Desktop: fixed sidebar (w-64) + main content.
 * Mobile (< lg): hamburger top bar + slide-in drawer + main content.
 *
 * Why a client component: we own the mobile drawer state. The Sidebar
 * itself reads usePathname + manages localStorage, so it has to be
 * client too — keeping the shell client-side avoids prop drilling
 * through nested suspense boundaries.
 */

export function AppShell({
  user,
  sessions,
  children,
}: {
  user: SidebarUser;
  sessions: ChatSession[];
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile drawer on route change (Cmd+K / sidebar link click).
  // pathname changes trigger re-render anyway; this useEffect catches
  // the drawer-closing case without prop drilling.
  useEffect(() => {
    if (!mobileOpen) return;
    const close = () => setMobileOpen(false);
    window.addEventListener("popstate", close);
    return () => window.removeEventListener("popstate", close);
  }, [mobileOpen]);

  // ESC to close drawer (mobile only).
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* ───── Desktop sidebar (always visible at lg+) ───── */}
      <div className="hidden lg:flex">
        <Sidebar user={user} sessions={sessions} />
      </div>

      {/* ───── Mobile drawer + overlay ───── */}
      {mobileOpen && (
        <>
          <button
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden animate-fade-in"
          />
          <div
            className="fixed inset-y-0 left-0 z-50 lg:hidden animate-fade-in"
            style={{ animation: "fade-in 240ms cubic-bezier(0.16,1,0.3,1) both" }}
          >
            <Sidebar
              user={user}
              sessions={sessions}
              onCloseMobile={() => setMobileOpen(false)}
            />
          </div>
        </>
      )}

      {/* ───── Main area ───── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile top bar with hamburger + brand */}
        <div className="flex h-14 items-center gap-3 border-b border-border bg-surface-raised px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-extrabold tracking-tight text-white"
            style={{
              background: "linear-gradient(135deg, #FB923C 0%, #F97316 50%, #EA580C 100%)",
              letterSpacing: "-0.04em",
            }}
          >
            IA
          </span>
          <span className="text-sm font-semibold text-foreground">Inside Assistant</span>
        </div>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}

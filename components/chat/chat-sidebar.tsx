"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { useSessions } from "./session-context";

export function ChatSidebar({
  userEmail,
  displayName,
  userRole,
}: {
  userEmail: string;
  displayName: string;
  userRole: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { sessions, addSession } = useSessions();
  const [creatingPersonal, setCreatingPersonal] = useState(false);
  const [creatingCompany, setCreatingCompany] = useState(false);

  async function createSession(mode: "personal" | "company") {
    if (creatingPersonal || creatingCompany) return;
    if (mode === "personal") setCreatingPersonal(true);
    else setCreatingCompany(true);

    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (res.ok) {
        const data = await res.json();
        addSession({
          id: data.id,
          title: mode === "company" ? "Company Brain" : "New Chat",
          mode,
          updated_at: new Date().toISOString(),
        });
        router.push(`/chat/${data.id}`);
      }
    } finally {
      setCreatingPersonal(false);
      setCreatingCompany(false);
    }
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex w-64 flex-col border-r border-zinc-800 bg-zinc-900">
      {/* Header */}
      <div className="border-b border-zinc-800 p-4">
        <h1 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
          <span>🧠</span> Inside Assistant
        </h1>
      </div>

      {/* New chat buttons */}
      <div className="space-y-1.5 p-3">
        <button
          onClick={() => createSession("personal")}
          disabled={creatingPersonal || creatingCompany}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
        >
          {creatingPersonal ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Creating...
            </>
          ) : (
            "+ Personal Chat"
          )}
        </button>
        <button
          onClick={() => createSession("company")}
          disabled={creatingPersonal || creatingCompany}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-50"
        >
          {creatingCompany ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-400/30 border-t-zinc-400" />
              Creating...
            </>
          ) : (
            "+ Company Brain"
          )}
        </button>
      </div>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {sessions.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-zinc-600">
            No sessions yet
          </p>
        ) : (
          <div className="space-y-0.5">
            {sessions.map((s) => {
              const isActive = pathname === `/chat/${s.id}`;
              return (
                <Link
                  key={s.id}
                  href={`/chat/${s.id}`}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${
                    isActive
                      ? "bg-zinc-800 text-white"
                      : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                  }`}
                >
                  <span className="text-[10px]">
                    {s.mode === "company" ? "🏢" : "💬"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom: user + settings */}
      <div className="border-t border-zinc-800 p-3 space-y-2">
        <Link
          href="/settings"
          className="block w-full rounded-lg px-3 py-2 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          ⚙ Settings & Claude.md
        </Link>
        <div className="flex items-center justify-between px-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-zinc-300">{displayName}</p>
            <p className="truncate text-[10px] text-zinc-600">{userRole}</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-[10px] text-zinc-600 hover:text-zinc-400"
          >
            Logout
          </button>
        </div>
      </div>
    </aside>
  );
}

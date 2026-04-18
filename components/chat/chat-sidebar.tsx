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
  const { sessions, addSession, removeSession } = useSessions();
  const [creatingPersonal, setCreatingPersonal] = useState(false);
  const [creatingCompany, setCreatingCompany] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  async function handleDelete(id: string) {
    if (deleting) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/sessions/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
      });
      if (res.ok) {
        removeSession(id);
        if (pathname === `/chat/${id}`) {
          router.push("/chat");
        }
      }
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900 overflow-hidden">
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
              const isConfirming = confirmDelete === s.id;

              if (isConfirming) {
                return (
                  <div
                    key={s.id}
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 space-y-1.5"
                  >
                    <p className="text-[10px] text-red-400 font-medium">
                      Delete &quot;{s.title}&quot;? All messages will be permanently removed from database.
                    </p>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleDelete(s.id)}
                        disabled={deleting}
                        className="flex-1 rounded bg-red-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-red-500 disabled:opacity-50"
                      >
                        {deleting ? "Deleting..." : "Delete Forever"}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="flex-1 rounded bg-zinc-700 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div key={s.id} className="group relative">
                  <Link
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
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      setConfirmDelete(s.id);
                    }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-600 opacity-0 transition-opacity hover:bg-zinc-700 hover:text-red-400 group-hover:opacity-100"
                    title="Delete session"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                  </button>
                </div>
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

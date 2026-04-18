"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSessions } from "./session-context";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

interface Session {
  id: string;
  title: string;
  mode: string;
  claude_md: string;
}

export function ChatWindow({
  session,
  initialMessages,
  userId,
  displayName,
  claudeMd,
  userRole,
  companyClaude,
}: {
  session: Session;
  initialMessages: Message[];
  userId: string;
  displayName: string;
  claudeMd: string;
  userRole: string;
  companyClaude: string;
}) {
  const router = useRouter();
  const { updateSessionTitle } = useSessions();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sessionTitle, setSessionTitle] = useState(session.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [sessionClaudeMd, setSessionClaudeMd] = useState(session.claude_md || "");
  const [companyClaudeMd, setCompanyClaudeMd] = useState(companyClaude);
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);
  useEffect(() => { inputRef.current?.focus(); }, [session.id]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput("");

    setMessages((prev) => [...prev, {
      id: crypto.randomUUID(),
      role: "user",
      content: userMsg,
      created_at: new Date().toISOString(),
    }]);
    setLoading(true);

    try {
      // Use per-session claude.md for personal, company claude.md for company mode
      const effectiveClaudeMd = session.mode === "company"
        ? companyClaudeMd
        : sessionClaudeMd || claudeMd; // session-level overrides global

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          message: userMsg,
          mode: session.mode,
          userId,
          displayName,
          claudeMd: effectiveClaudeMd,
          userRole,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.content,
          created_at: new Date().toISOString(),
        }]);

        // Auto-title from first message (sync sidebar immediately)
        if (messages.length === 0) {
          const autoTitle = userMsg.slice(0, 50) + (userMsg.length > 50 ? "..." : "");
          setSessionTitle(autoTitle);
          updateSessionTitle(session.id, autoTitle);
        }
      }
    } catch {
      console.error("Failed to send message");
    } finally {
      setLoading(false);
    }
  }

  async function saveTitle() {
    setEditingTitle(false);
    updateSessionTitle(session.id, sessionTitle);
    await fetch("/api/sessions/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.id, title: sessionTitle }),
    });
  }

  async function saveSessionSettings() {
    setSaving(true);
    if (session.mode === "company") {
      await fetch("/api/company-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claudeMd: companyClaudeMd }),
      });
    } else {
      await fetch("/api/sessions/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, claudeMd: sessionClaudeMd }),
      });
    }
    setSaving(false);
    setShowSettings(false);
    router.refresh();
  }

  const isDirector = userRole === "director" || userRole === "manager";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between border-b border-zinc-800 px-5 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm">{session.mode === "company" ? "🏢" : "💬"}</span>
          <div className="min-w-0">
            {editingTitle ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={sessionTitle}
                  onChange={(e) => setSessionTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setEditingTitle(false); }}
                  onBlur={saveTitle}
                  className="h-6 w-48 rounded border border-zinc-700 bg-zinc-800 px-2 text-sm text-white outline-none focus:border-indigo-500"
                />
              </div>
            ) : (
              <button
                onClick={() => setEditingTitle(true)}
                className="group flex items-center gap-1.5"
              >
                <h2 className="truncate text-sm font-semibold text-zinc-200">{sessionTitle}</h2>
                <span className="text-[10px] text-zinc-600 opacity-0 group-hover:opacity-100">✏️</span>
              </button>
            )}
            <p className="text-[10px] text-zinc-500">
              {session.mode === "company" ? "Company Brain — shared knowledge" : "Personal session — private memory"}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
            showSettings
              ? "bg-indigo-600 text-white"
              : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          }`}
        >
          {showSettings ? "Close" : "⚙ Instructions"}
        </button>
      </div>

      {/* Settings panel (collapsible) */}
      {showSettings && (
        <div className="shrink-0 max-h-64 overflow-y-auto border-b border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
          {session.mode === "company" ? (
            <>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-zinc-300">
                  🏢 Company Brain Instructions
                </label>
                {!isDirector && (
                  <span className="text-[10px] text-zinc-600">View only — directors can edit</span>
                )}
              </div>
              <textarea
                value={companyClaudeMd}
                onChange={(e) => setCompanyClaudeMd(e.target.value)}
                disabled={!isDirector}
                rows={6}
                placeholder="Instructions for the company AI brain. Only directors can edit this."
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-white placeholder-zinc-600 outline-none focus:border-indigo-500 font-mono disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {isDirector && (
                <p className="text-[10px] text-zinc-500">
                  These instructions apply to ALL company brain sessions for ALL users. Use this to control what the AI can/cannot share based on user roles.
                </p>
              )}
            </>
          ) : (
            <>
              <label className="text-xs font-medium text-zinc-300">
                💬 Session Instructions (claude.md)
              </label>
              <textarea
                value={sessionClaudeMd}
                onChange={(e) => setSessionClaudeMd(e.target.value)}
                rows={6}
                placeholder={`Custom instructions for this chat session.\n\nExample:\n- Focus on sales strategy\n- Respond in Bahasa Malaysia\n- Always check memory for client info first`}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-white placeholder-zinc-600 outline-none focus:border-indigo-500 font-mono"
              />
              <p className="text-[10px] text-zinc-500">
                These instructions apply only to this session. Your global claude.md from Settings is used as a fallback.
              </p>
            </>
          )}
          <button
            onClick={saveSessionSettings}
            disabled={saving || (session.mode === "company" && !isDirector)}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <span className="text-4xl mb-3">{session.mode === "company" ? "🏢" : "🧠"}</span>
            <p className="text-sm text-zinc-400">
              {session.mode === "company"
                ? "Ask anything about the company. Memories are shared."
                : "Your personal AI assistant. Memories are private to you."}
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-indigo-600 text-white rounded-tr-sm"
                  : "bg-zinc-800 text-zinc-200 rounded-tl-sm"
              }`}
            >
              {msg.role === "assistant" ? (
                <div className="prose prose-sm prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-strong:text-inherit prose-table:my-2 prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1 prose-th:border prose-td:border prose-th:border-zinc-600 prose-td:border-zinc-700">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
              <p className={`mt-1 text-[10px] ${msg.role === "user" ? "text-indigo-300" : "text-zinc-500"}`}>
                {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-tl-sm bg-zinc-800 px-4 py-3">
              <div className="flex gap-1.5">
                <span className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce [animation-delay:0ms]" />
                <span className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce [animation-delay:150ms]" />
                <span className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-zinc-800 p-4">
        <form onSubmit={handleSend} className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            disabled={loading}
            className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

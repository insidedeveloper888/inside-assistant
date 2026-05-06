"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface Memory {
  id: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  source?: string;
  scope?: string;
  created_at: string;
  updated_at?: string;
  similarity?: number;
  keyword_rank?: number;
}

export default function MemoriesPage() {
  const [scope, setScope] = useState<"company" | "personal">("company");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(30);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editTags, setEditTags] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [newTags, setNewTags] = useState("");
  const [searchMode, setSearchMode] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ scope, page: String(page), limit: String(limit) });
      if (appliedSearch) params.set("q", appliedSearch);
      if (tagFilter) params.set("tag", tagFilter);
      const res = await fetch(`/api/admin/memories?${params}`);
      if (!res.ok) {
        setError(res.status === 403 ? "Directors only" : "Failed to load");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setMemories(data.memories ?? []);
      setTotal(data.total ?? 0);
      setSearchMode(data.mode === "search");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [scope, page, limit, appliedSearch, tagFilter]);

  useEffect(() => { load(); }, [load]);

  const handleSearch = () => {
    setAppliedSearch(search);
    setPage(1);
  };

  const handleEdit = (m: Memory) => {
    setEditingId(m.id);
    setEditContent(m.content);
    setEditTags(m.tags.join(", "));
  };

  const saveEdit = async (id: string) => {
    const tags = editTags.split(",").map((t) => t.trim()).filter(Boolean);
    const res = await fetch("/api/admin/memories", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, content: editContent, tags }),
    });
    if (res.ok) {
      setEditingId(null);
      load();
    } else {
      alert("Save failed");
    }
  };

  const deleteMemory = async (id: string) => {
    if (!confirm("Delete this memory? This cannot be undone.")) return;
    const res = await fetch(`/api/admin/memories?id=${id}`, { method: "DELETE" });
    if (res.ok) load();
  };

  const createMemory = async () => {
    if (newContent.length < 5) return;
    const tags = newTags.split(",").map((t) => t.trim()).filter(Boolean);
    const res = await fetch("/api/admin/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, content: newContent, tags }),
    });
    if (res.ok) {
      setShowCreate(false);
      setNewContent("");
      setNewTags("");
      load();
    } else {
      alert("Create failed");
    }
  };

  const totalPages = searchMode ? 1 : Math.ceil(total / limit);

  return (
    <div className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
      <div className="mx-auto max-w-[1400px] space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Memory Browser</h1>
            <p className="mt-0.5 text-xs text-zinc-500">View, edit, and manage memories in pgvector</p>
          </div>
          <Link href="/admin" className="text-xs text-zinc-500 hover:text-zinc-300">← Back to Admin</Link>
        </div>

        {/* Scope toggle + actions */}
        <div className="flex items-center justify-between gap-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-1 flex gap-1">
            <button
              onClick={() => { setScope("company"); setPage(1); }}
              className={`rounded-md px-3 py-1.5 text-xs ${scope === "company" ? "bg-blue-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              🏢 Company ({scope === "company" ? total : "?"})
            </button>
            <button
              onClick={() => { setScope("personal"); setPage(1); }}
              className={`rounded-md px-3 py-1.5 text-xs ${scope === "personal" ? "bg-purple-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              💬 Personal ({scope === "personal" ? total : "?"})
            </button>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500"
          >
            {showCreate ? "Cancel" : "+ New Memory"}
          </button>
        </div>

        {/* Create form */}
        {showCreate && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Memory content (markdown supported)…"
              rows={6}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
            />
            <input
              type="text"
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
              placeholder="tags, comma, separated"
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300">Cancel</button>
              <button
                onClick={createMemory}
                disabled={newContent.length < 5}
                className="rounded bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                Create in {scope}
              </button>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
            placeholder="Hybrid search (semantic + keyword)…"
            className="h-9 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-indigo-500"
          />
          <input
            type="text"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            placeholder="filter by tag"
            className="h-9 w-40 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-indigo-500"
          />
          <button onClick={handleSearch} className="h-9 rounded-md bg-indigo-600 px-3 text-xs text-white hover:bg-indigo-500">
            Search
          </button>
          {(appliedSearch || tagFilter) && (
            <button
              onClick={() => { setSearch(""); setAppliedSearch(""); setTagFilter(""); setPage(1); }}
              className="h-9 rounded-md border border-zinc-700 px-3 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              Clear
            </button>
          )}
        </div>

        {searchMode && (
          <p className="text-xs text-zinc-500">
            🔎 Showing search results ranked by hybrid score (70% semantic + 30% keyword). Pagination disabled.
          </p>
        )}

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
        )}

        {/* List */}
        <div className="space-y-2">
          {loading ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-8 text-center text-xs text-zinc-500">Loading…</div>
          ) : memories.length === 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-8 text-center text-xs text-zinc-500">No memories</div>
          ) : (
            memories.map((m) => (
              <div key={m.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                {editingId === m.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={Math.min(20, Math.max(4, editContent.split("\n").length))}
                      className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500 font-mono"
                    />
                    <input
                      type="text"
                      value={editTags}
                      onChange={(e) => setEditTags(e.target.value)}
                      className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100"
                    />
                    <p className="text-[10px] text-amber-400">⚠️ Editing content will re-embed (uses OpenAI API)</p>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditingId(null)} className="rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300">Cancel</button>
                      <button onClick={() => saveEdit(m.id)} className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-500">Save</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                        <span className="font-mono">{new Date(m.created_at).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur", month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                        {m.source && <span className="rounded bg-zinc-800 px-1.5 py-0.5">{m.source}</span>}
                        {m.similarity !== undefined && (
                          <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-indigo-300">
                            sim {m.similarity.toFixed(2)} · kw {m.keyword_rank?.toFixed(2)}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => handleEdit(m)} className="rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700">Edit</button>
                        <button onClick={() => deleteMemory(m.id)} className="rounded bg-red-900/40 px-2 py-1 text-[10px] text-red-300 hover:bg-red-900/60">Delete</button>
                      </div>
                    </div>
                    <pre className="whitespace-pre-wrap text-xs text-zinc-200 font-sans max-h-60 overflow-y-auto">{m.content}</pre>
                    {m.tags && m.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {m.tags.map((t) => (
                          <button
                            key={t}
                            onClick={() => { setTagFilter(t); setPage(1); }}
                            className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700"
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))
          )}
        </div>

        {/* Pagination */}
        {!searchMode && totalPages > 1 && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">Page {page} of {totalPages} · {total} memories</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded border border-zinc-700 px-3 py-1 text-zinc-300 disabled:opacity-50 hover:bg-zinc-800"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded border border-zinc-700 px-3 py-1 text-zinc-300 disabled:opacity-50 hover:bg-zinc-800"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

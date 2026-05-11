"use client";

import { useState, useEffect, useCallback } from "react";

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
    <div className="p-6 lg:p-8">
      <div className="mx-auto max-w-[1400px] space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Memory Browser</h1>
          <p className="mt-1 text-sm text-muted-foreground">View, edit, and manage memories in pgvector.</p>
        </div>

        {/* Scope toggle + actions */}
        <div className="flex items-center justify-between gap-3">
          <div className="rounded-lg border border-border bg-card p-1 flex gap-1">
            <button
              onClick={() => { setScope("company"); setPage(1); }}
              className={`rounded-md px-3 py-1.5 text-xs transition-colors ${scope === "company" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              🏢 Company ({scope === "company" ? total : "?"})
            </button>
            <button
              onClick={() => { setScope("personal"); setPage(1); }}
              className={`rounded-md px-3 py-1.5 text-xs ${scope === "personal" ? "bg-purple-600 text-white" : "text-muted-foreground hover:text-foreground"}`}
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
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-emerald-500"
            />
            <input
              type="text"
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
              placeholder="tags, comma, separated"
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-emerald-500"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="rounded bg-muted px-3 py-1.5 text-xs text-foreground/80">Cancel</button>
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
            className="h-9 flex-1 rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary"
          />
          <input
            type="text"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            placeholder="filter by tag"
            className="h-9 w-40 rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary"
          />
          <button onClick={handleSearch} className="h-9 rounded-md bg-primary px-3 text-xs text-white hover:bg-primary/90">
            Search
          </button>
          {(appliedSearch || tagFilter) && (
            <button
              onClick={() => { setSearch(""); setAppliedSearch(""); setTagFilter(""); setPage(1); }}
              className="h-9 rounded-md border border-border px-3 text-xs text-foreground/80 hover:bg-muted"
            >
              Clear
            </button>
          )}
        </div>

        {searchMode && (
          <p className="text-xs text-muted-foreground">
            🔎 Showing search results ranked by hybrid score (70% semantic + 30% keyword). Pagination disabled.
          </p>
        )}

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
        )}

        {/* List */}
        <div className="space-y-2">
          {loading ? (
            <div className="rounded-lg border border-border bg-card p-8 text-center text-xs text-muted-foreground">Loading…</div>
          ) : memories.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-8 text-center text-xs text-muted-foreground">No memories</div>
          ) : (
            memories.map((m) => (
              <div key={m.id} className="rounded-lg border border-border bg-card p-4">
                {editingId === m.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={Math.min(20, Math.max(4, editContent.split("\n").length))}
                      className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary font-mono"
                    />
                    <input
                      type="text"
                      value={editTags}
                      onChange={(e) => setEditTags(e.target.value)}
                      className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground"
                    />
                    <p className="text-[10px] text-amber-400">⚠️ Editing content will re-embed (uses OpenAI API)</p>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditingId(null)} className="rounded bg-muted px-3 py-1.5 text-xs text-foreground/80">Cancel</button>
                      <button onClick={() => saveEdit(m.id)} className="rounded bg-primary px-3 py-1.5 text-xs text-white hover:bg-primary/90">Save</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="font-mono">{new Date(m.created_at).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur", month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                        {m.source && <span className="rounded bg-muted px-1.5 py-0.5">{m.source}</span>}
                        {m.similarity !== undefined && (
                          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-primary">
                            sim {m.similarity.toFixed(2)} · kw {m.keyword_rank?.toFixed(2)}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => handleEdit(m)} className="rounded bg-muted px-2 py-1 text-[10px] text-foreground/80 hover:bg-muted/70">Edit</button>
                        <button onClick={() => deleteMemory(m.id)} className="rounded bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-600 hover:bg-red-500/20 dark:text-red-400">Delete</button>
                      </div>
                    </div>
                    <pre className="whitespace-pre-wrap text-xs text-foreground font-sans max-h-60 overflow-y-auto">{m.content}</pre>
                    {m.tags && m.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {m.tags.map((t) => (
                          <button
                            key={t}
                            onClick={() => { setTagFilter(t); setPage(1); }}
                            className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/70"
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
            <span className="text-muted-foreground">Page {page} of {totalPages} · {total} memories</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded border border-border px-3 py-1 text-foreground/80 disabled:opacity-50 hover:bg-muted"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded border border-border px-3 py-1 text-foreground/80 disabled:opacity-50 hover:bg-muted"
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

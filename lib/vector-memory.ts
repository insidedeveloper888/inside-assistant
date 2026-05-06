import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

export type MemoryScope = "personal" | "company";

export interface VectorMemory {
  id: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  similarity?: number;
  keyword_rank?: number;
}

/**
 * Generate an embedding for text via OpenAI.
 * text-embedding-3-small: 1536 dim, $0.02 per 1M tokens (extremely cheap).
 */
async function embed(text: string): Promise<number[] | null> {
  if (!OPENAI_API_KEY) return null;
  const trimmed = text.slice(0, 8000); // model max ~8K tokens
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: trimmed }),
  });
  if (!res.ok) {
    console.warn(`[embed] OpenAI returned ${res.status}`);
    return null;
  }
  const data = await res.json();
  return data?.data?.[0]?.embedding ?? null;
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Store a memory with its embedding.
 * Returns null if embedding generation fails.
 */
export async function storeVectorMemory(
  admin: SupabaseClient,
  args: {
    scope: MemoryScope;
    content: string;
    userId?: string | null;
    tenantId?: string | null;
    tags?: string[];
    metadata?: Record<string, unknown>;
    source?: string;
  }
): Promise<string | null> {
  const embedding = await embed(args.content);
  if (!embedding) return null;

  const contentHash = hashContent(args.content);

  // Upsert: if same content already exists, just update timestamp
  const { data, error } = await admin
    .from("memory_vectors")
    .upsert(
      {
        scope: args.scope,
        user_id: args.userId ?? null,
        tenant_id: args.tenantId ?? null,
        content: args.content,
        content_hash: contentHash,
        tags: args.tags ?? [],
        metadata: args.metadata ?? {},
        embedding: `[${embedding.join(",")}]`,
        source: args.source ?? "manual",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "content_hash" }
    )
    .select("id")
    .single();

  if (error) {
    console.error("[vector-memory] store failed:", error.message);
    return null;
  }
  const id = data?.id ?? null;

  // Fire-and-forget mirror to GitHub vault (Obsidian source of truth for
  // human reading). No-op when GITHUB_VAULT_TOKEN/REPO env vars unset.
  // Awaiting would block chat replies on a network call to GitHub —
  // not worth the latency for a read-only mirror.
  if (id) {
    void (async () => {
      const { syncToVault } = await import("./vault-sync");
      const md = (args.metadata ?? {}) as Record<string, unknown>;
      await syncToVault({
        id,
        content: args.content,
        source: args.source ?? "web-chat",
        route: args.scope === "company" ? "company" : "personal",
        directorOnly: (args.tags ?? []).includes("director-only"),
        sessionId: typeof md.session_id === "string" ? md.session_id : null,
        user: typeof md.user === "string" ? md.user : null,
        tags: args.tags,
        createdAt: new Date().toISOString(),
      });
    })();
  }

  return id;
}

/**
 * Hybrid search: combines semantic (embedding) + keyword (full-text) ranking.
 * Filters by scope/user/tenant/tags before similarity search.
 */
export async function searchVectorMemories(
  admin: SupabaseClient,
  args: {
    query: string;
    scope: MemoryScope;
    userId?: string | null;
    tenantId?: string | null;
    tags?: string[];
    limit?: number;
    sessionId?: string | null;
    accessSource?: string;
    accessContext?: string;
  }
): Promise<VectorMemory[]> {
  const start = Date.now();
  const queryEmbedding = await embed(args.query);
  if (!queryEmbedding) return [];

  const { data, error } = await admin.rpc("search_memory_vectors", {
    query_embedding: `[${queryEmbedding.join(",")}]`,
    query_text: args.query,
    scope_filter: args.scope,
    user_id_filter: args.userId ?? null,
    tenant_id_filter: args.tenantId ?? null,
    tags_filter: args.tags && args.tags.length > 0 ? args.tags : null,
    match_count: args.limit ?? 10,
  });

  if (error) {
    console.error("[vector-memory] search failed:", error.message);
    return [];
  }

  const results = (data ?? []) as VectorMemory[];

  // Fire-and-forget access log
  admin.from("memory_access_log").insert({
    user_id: args.userId ?? null,
    tenant_id: args.tenantId ?? null,
    scope: args.scope,
    query: args.query.slice(0, 500),
    source: args.accessSource ?? "chat",
    result_count: results.length,
    top_similarity: results[0]?.similarity ?? null,
    top_keyword_rank: results[0]?.keyword_rank ?? null,
    retrieved_ids: results.map((r) => r.id),
    duration_ms: Date.now() - start,
    session_id: args.sessionId ?? null,
    context: args.accessContext ?? null,
  }).then(() => {}, () => {});

  return results;
}

/**
 * Get recent memories without semantic search (chronological).
 */
export async function recentVectorMemories(
  admin: SupabaseClient,
  args: {
    scope: MemoryScope;
    userId?: string | null;
    tenantId?: string | null;
    limit?: number;
  }
): Promise<VectorMemory[]> {
  let q = admin
    .from("memory_vectors")
    .select("id, content, tags, metadata, created_at")
    .eq("scope", args.scope)
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 10);

  if (args.userId) q = q.eq("user_id", args.userId);
  if (args.tenantId) q = q.eq("tenant_id", args.tenantId);

  const { data, error } = await q;
  if (error) {
    console.error("[vector-memory] recent failed:", error.message);
    return [];
  }
  return (data ?? []) as VectorMemory[];
}

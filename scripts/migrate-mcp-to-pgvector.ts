/**
 * One-time migration: MCP Memory Service → pgvector in Supabase.
 *
 * Run with:
 *   tsx scripts/migrate-mcp-to-pgvector.ts personal
 *   tsx scripts/migrate-mcp-to-pgvector.ts company
 *
 * Required env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   OPENAI_API_KEY
 *   COMPANY_MEMORY_URL (default https://inside-assistant.zeabur.app)
 *   COMPANY_MEMORY_API_KEY (default inside-memory-2026)
 *   PERSONAL_MEMORY_URL (default https://mcp-memory-service.zeabur.app)
 */

import { createClient } from "@supabase/supabase-js";
import { storeVectorMemory } from "../lib/vector-memory.js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const COMPANY_URL = process.env.COMPANY_MEMORY_URL ?? "https://inside-assistant.zeabur.app";
const COMPANY_KEY = process.env.COMPANY_MEMORY_API_KEY ?? "inside-memory-2026";
const PERSONAL_URL = process.env.PERSONAL_MEMORY_URL ?? "https://mcp-memory-service.zeabur.app";

const PAGE_SIZE = 50;
const BATCH_DELAY_MS = 200; // gentle on OpenAI rate limits

interface McpMemory {
  content: string;
  content_hash?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  created_at_iso?: string;
}

async function fetchAll(url: string, apiKey: string | null): Promise<McpMemory[]> {
  const all: McpMemory[] = [];
  let page = 1;
  while (true) {
    const headers: Record<string, string> = {};
    if (apiKey) headers["X-API-Key"] = apiKey;
    const res = await fetch(`${url}/api/memories?page=${page}&limit=${PAGE_SIZE}`, { headers });
    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status}`);
    }
    const data = await res.json();
    const memories: McpMemory[] = data.memories ?? [];
    all.push(...memories);
    console.log(`  Page ${page}: fetched ${memories.length} (total so far: ${all.length} / ${data.total ?? "?"})`);
    if (!data.has_more) break;
    page++;
  }
  return all;
}

async function migrate(scope: "personal" | "company") {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const url = scope === "company" ? COMPANY_URL : PERSONAL_URL;
  const apiKey = scope === "company" ? COMPANY_KEY : null;

  console.log(`\n=== Migrating ${scope.toUpperCase()} memories from ${url} ===\n`);
  console.log("Step 1: Fetching all memories from MCP...");
  const memories = await fetchAll(url, apiKey);
  console.log(`Total fetched: ${memories.length}\n`);

  console.log("Step 2: Embedding + inserting into pgvector...");
  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < memories.length; i++) {
    const m = memories[i];
    if (!m.content || m.content.length < 5) {
      skipped++;
      continue;
    }

    try {
      const id = await storeVectorMemory(admin, {
        scope,
        content: m.content,
        tags: m.tags ?? [],
        metadata: { ...(m.metadata ?? {}), migrated_from: "mcp", original_created: m.created_at_iso },
        source: "migration",
      });
      if (id) {
        success++;
      } else {
        failed++;
      }
    } catch (err) {
      console.error(`  [${i + 1}/${memories.length}] failed:`, err instanceof Error ? err.message : err);
      failed++;
    }

    if ((i + 1) % 20 === 0) {
      console.log(`  Progress: ${i + 1}/${memories.length} (success=${success}, failed=${failed}, skipped=${skipped})`);
    }
    if (BATCH_DELAY_MS > 0) await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }

  console.log(`\n✓ Done. success=${success}, failed=${failed}, skipped=${skipped}\n`);
}

const scope = process.argv[2] as "personal" | "company";
if (scope !== "personal" && scope !== "company") {
  console.error("Usage: tsx migrate-mcp-to-pgvector.ts [personal|company]");
  process.exit(1);
}

migrate(scope).catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

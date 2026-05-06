#!/usr/bin/env tsx
/**
 * One-time (or repeatable) backfill: push every existing pgvector memory
 * row into the GitHub vault repo. Idempotent — GitHub's Contents API
 * returns 422 on duplicate paths and the syncer silently swallows that.
 *
 * Use:
 *   tsx scripts/backfill-vault.ts                # all rows
 *   tsx scripts/backfill-vault.ts --scope=company  # company memories only
 *   tsx scripts/backfill-vault.ts --since=2026-01-01
 *   tsx scripts/backfill-vault.ts --limit=100      # for testing
 *
 * Requires the same env vars as the live sync:
 *   GITHUB_VAULT_TOKEN, GITHUB_VAULT_REPO, NEXT_PUBLIC_SUPABASE_URL,
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Throttles to ~1 request/sec to stay well under GitHub's 5000/hr limit.
 */

import { createClient } from "@supabase/supabase-js";
import { syncToVault } from "../lib/vault-sync";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [k, v] = arg.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!process.env.GITHUB_VAULT_TOKEN || !process.env.GITHUB_VAULT_REPO) {
  console.error("Missing GITHUB_VAULT_TOKEN or GITHUB_VAULT_REPO");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  let query = supabase
    .from("memory_vectors")
    .select("id, content, scope, source, tags, metadata, created_at")
    .order("created_at", { ascending: true });

  if (args.scope === "personal" || args.scope === "company") {
    query = query.eq("scope", args.scope);
  }
  if (args.since) {
    query = query.gte("created_at", args.since);
  }
  if (args.limit) {
    query = query.limit(Number(args.limit));
  }

  const { data: rows, error } = await query;
  if (error) {
    console.error("[backfill] query failed:", error.message);
    process.exit(1);
  }
  if (!rows || rows.length === 0) {
    console.log("[backfill] no rows to sync");
    return;
  }

  console.log(`[backfill] syncing ${rows.length} memories...`);
  let ok = 0;
  let fail = 0;
  for (const [i, row] of rows.entries()) {
    try {
      const md = (row.metadata ?? {}) as Record<string, unknown>;
      await syncToVault({
        id: row.id as string,
        content: row.content as string,
        source: (row.source as string) ?? "backfill",
        route: row.scope === "company" ? "company" : "personal",
        directorOnly: ((row.tags as string[]) ?? []).includes("director-only"),
        sessionId: typeof md.session_id === "string" ? md.session_id : null,
        user: typeof md.user === "string" ? md.user : null,
        tags: row.tags as string[],
        createdAt: row.created_at as string,
      });
      ok++;
      // Throttle: 1 req/sec keeps us at <0.4% of GitHub's 5K/hr limit.
      await new Promise((r) => setTimeout(r, 1000));
      if ((i + 1) % 10 === 0) {
        console.log(`  ${i + 1}/${rows.length} (${ok} ok, ${fail} fail)`);
      }
    } catch (err) {
      fail++;
      console.error(`[backfill] row ${row.id} failed:`, err);
    }
  }
  console.log(`[backfill] done — ${ok} synced, ${fail} failed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

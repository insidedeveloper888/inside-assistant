import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { syncToVault } from "@/lib/vault-sync";

/**
 * One-time admin endpoint: pull existing pgvector memories and push each
 * to the GitHub vault repo. Idempotent — GitHub Contents API returns 422
 * on duplicate paths, which syncToVault silently swallows.
 *
 * Run from a director-only browser session via fetch:
 *   POST /api/admin/vault-backfill?limit=50&offset=0
 *   POST /api/admin/vault-backfill?limit=50&offset=50
 *   ... (loop until processed < limit)
 *
 * Or all at once with a query param if your Vercel plan allows >60s:
 *   POST /api/admin/vault-backfill?limit=1000
 *
 * Why an endpoint instead of running the script locally:
 *   - The backfill needs SUPABASE_SERVICE_ROLE_KEY + GITHUB_VAULT_TOKEN.
 *     Those are set on Vercel, not in the user's local .env.local.
 *   - Running on Vercel avoids leaking secrets to the user's terminal.
 *   - Auto-throttled per call by GitHub's per-request rate.
 */

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel hobby plan max — chunked calls handle larger backfills

async function requireDirector() {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("assistant_user_settings")
    .select("role")
    .eq("user_id", user.id)
    .single();
  if (!settings || settings.role !== "director") {
    return { error: NextResponse.json({ error: "Directors only" }, { status: 403 }) };
  }
  return { user, admin };
}

export async function POST(request: NextRequest) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10) || 0;
  const scope = url.searchParams.get("scope"); // "personal" | "company" | null
  const since = url.searchParams.get("since"); // ISO date

  // Count for progress tracking — gives the caller something to display.
  let countQuery = admin
    .from("memory_vectors")
    .select("id", { count: "exact", head: true });
  if (scope === "personal" || scope === "company") countQuery = countQuery.eq("scope", scope);
  if (since) countQuery = countQuery.gte("created_at", since);
  const { count: total } = await countQuery;

  // Fetch the page of rows to process.
  let rowsQuery = admin
    .from("memory_vectors")
    .select("id, content, scope, source, tags, metadata, created_at")
    .order("created_at", { ascending: true })
    .range(offset, offset + limit - 1);
  if (scope === "personal" || scope === "company") rowsQuery = rowsQuery.eq("scope", scope);
  if (since) rowsQuery = rowsQuery.gte("created_at", since);

  const { data: rows, error } = await rowsQuery;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({
      processed: 0,
      total: total ?? 0,
      offset,
      done: true,
      ok: 0,
      fail: 0,
    });
  }

  // Sync sequentially — GitHub Contents API rate limit is 5K/hr per token.
  // We're under that, but sequential keeps GitHub happy and avoids races on
  // commits to the same branch (each PUT creates a commit).
  const stats = {
    synced: 0,
    "skipped-no-config": 0,
    "skipped-empty": 0,
    "skipped-personal": 0,
    "skipped-duplicate": 0,
    failed: 0,
  };
  for (const row of rows) {
    try {
      const md = (row.metadata ?? {}) as Record<string, unknown>;
      const status = await syncToVault({
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
      stats[status]++;
      // Tiny throttle — well under GitHub's 5K/hr limit but smooths out
      // the abuse-detection heuristics. 100ms × 50 = 5s overhead per chunk.
      await new Promise((r) => setTimeout(r, 100));
    } catch (err) {
      stats.failed++;
      console.warn(`[vault-backfill] row ${row.id} threw:`, err);
    }
  }

  // Surface env-var presence in the response so the client knows whether
  // the backfill is actually doing anything. Helpful when debugging
  // "reported success but nothing in GitHub" — which is the no-config
  // skip path.
  const env = {
    GITHUB_VAULT_TOKEN: !!process.env.GITHUB_VAULT_TOKEN,
    GITHUB_VAULT_REPO: process.env.GITHUB_VAULT_REPO ?? null,
  };

  const nextOffset = offset + rows.length;
  return NextResponse.json({
    processed: rows.length,
    stats,
    env,
    offset,
    nextOffset,
    total: total ?? 0,
    done: rows.length < limit,
  });
}

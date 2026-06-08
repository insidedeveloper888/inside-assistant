/**
 * Standalone retrieval eval — talks to Postgres directly (via psql) and
 * embeds queries with OpenAI. Needs ONLY: OPENAI_API_KEY + PG* env vars.
 * (The npm-script version uses the Supabase JS client which needs the
 *  service-role key; this one avoids that.)
 *
 * Run:
 *   OPENAI_API_KEY=sk-... PGPASSWORD=... PGHOST=... PGUSER=... PGDATABASE=postgres \
 *     node evals/run-retrieval-standalone.mjs
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TOP_K = Number(process.env.EVAL_TOP_K ?? 10);
if (!OPENAI_API_KEY) { console.error("Set OPENAI_API_KEY"); process.exit(1); }

const golden = readFileSync(join(__dirname, "golden.jsonl"), "utf8")
  .split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l))
  .filter((g) => Array.isArray(g.expected_memory_ids) && g.expected_memory_ids.length > 0);

async function embed(text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text.replace(/\s+/g, " ").trim() }),
  });
  if (!res.ok) throw new Error(`embed ${res.status}: ${await res.text()}`);
  return (await res.json()).data[0].embedding;
}

function searchRpc(embedding, queryText, scope) {
  // Call the production search_memory_vectors RPC directly via psql.
  const vec = `[${embedding.join(",")}]`;
  const sql = `select id::text from search_memory_vectors(
      query_embedding := '${vec}',
      query_text := $q$${queryText.replace(/\$/g, "")}$q$,
      scope_filter := '${scope}',
      user_id_filter := null, tenant_id_filter := null, tags_filter := null,
      match_count := ${TOP_K});`;
  const out = execFileSync("psql", [
    "-h", process.env.PGHOST, "-p", process.env.PGPORT ?? "5432",
    "-U", process.env.PGUSER, "-d", process.env.PGDATABASE ?? "postgres",
    "-t", "-A", "-c", sql,
  ], { env: process.env, encoding: "utf8" });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

const idMatch = (returned, expected) => expected.some((e) => returned.startsWith(e));

let hitSum = 0, mrrSum = 0;
console.log(`\n  RETRIEVAL EVAL (full hybrid) — top-${TOP_K}, ${golden.length} questions\n  ${"─".repeat(74)}`);
for (const g of golden) {
  let rank = 0;
  try {
    const emb = await embed(g.question);
    const ids = searchRpc(emb, g.question, g.scope ?? "company");
    ids.forEach((id, i) => { if (rank === 0 && idMatch(id, g.expected_memory_ids)) rank = i + 1; });
  } catch (e) { console.log(`  ⚠️  ${g.id}: ${String(e).slice(0, 70)}`); continue; }
  const hit = rank > 0 ? 1 : 0;
  hitSum += hit; mrrSum += hit ? 1 / rank : 0;
  console.log(`  ${hit ? "✅" : "❌"}  ${g.id.padEnd(12)} ${(rank > 0 ? "rank " + rank : "MISS").padEnd(8)} ${g.question.slice(0, 48)}`);
}
const n = golden.length;
console.log(`  ${"─".repeat(74)}\n\n  SCORECARD`);
console.log(`    Hit@${TOP_K} : ${(100 * hitSum / n).toFixed(1)}%  (${hitSum}/${n})`);
console.log(`    MRR     : ${(mrrSum / n).toFixed(3)}\n`);

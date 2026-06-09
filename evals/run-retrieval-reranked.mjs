/**
 * Retrieval eval WITH a reranking stage — measures the MRR lift.
 *
 * Pipeline:
 *   1. embed query (OpenAI text-embedding-3-small)
 *   2. hybrid search (search_memory_vectors) → top-15 candidates
 *   3. RERANK those 15 with a cross-pass LLM (gpt-4o-mini, listwise) that
 *      scores each (query, passage) pair far more precisely than the cheap
 *      hybrid score, then reorders.
 *
 * Reports MRR BEFORE rerank (hybrid order) vs AFTER rerank — the whole point
 * is to show the buried-but-correct facts (e.g. q002 at rank 4) move toward
 * rank 1.
 *
 * Run:
 *   OPENAI_API_KEY=sk-... PGHOST=... PGUSER=... PGPASSWORD=... PGDATABASE=postgres \
 *     node evals/run-retrieval-reranked.mjs
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RETRIEVE_K = Number(process.env.EVAL_RETRIEVE_K ?? 15); // wide net for reranking
const RERANK_MODEL = process.env.RERANK_MODEL ?? "gpt-4o-mini";
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
  if (!res.ok) throw new Error(`embed ${res.status}`);
  return (await res.json()).data[0].embedding;
}

function hybridSearch(embedding, queryText, scope) {
  const vec = `[${embedding.join(",")}]`;
  // Return id + content so the reranker can read the passage text.
  const sql = `select id::text || E'\\t' || regexp_replace(content, E'[\\n\\r\\t]+', ' ', 'g')
    from search_memory_vectors(
      query_embedding := '${vec}', query_text := $q$${queryText.replace(/\$/g, "")}$q$,
      scope_filter := '${scope}', user_id_filter := null, tenant_id_filter := null,
      tags_filter := null, match_count := ${RETRIEVE_K});`;
  const out = execFileSync("psql", [
    "-h", process.env.PGHOST, "-p", process.env.PGPORT ?? "5432",
    "-U", process.env.PGUSER, "-d", process.env.PGDATABASE ?? "postgres",
    "-t", "-A", "-c", sql,
  ], { env: process.env, encoding: "utf8" });
  return out.split("\n").map((s) => s.trim()).filter(Boolean).map((line) => {
    const tab = line.indexOf("\t");
    return { id: line.slice(0, tab), content: line.slice(tab + 1) };
  });
}

/**
 * Listwise LLM reranker — one call, reorders the candidates by true relevance.
 * Returns the reordered candidate array. On any failure, returns input order
 * (so rerank can only help, never break retrieval).
 */
async function rerank(query, candidates) {
  if (candidates.length <= 1) return candidates;
  const passages = candidates.map((c, i) => `[${i + 1}] ${c.content.slice(0, 400)}`).join("\n");
  const prompt = `You are a search reranker. Rank the passages from MOST to LEAST relevant for answering the query.

QUERY: "${query}"

PASSAGES:
${passages}

Respond with ONLY a comma-separated list of passage numbers, best first. Example: 3,1,7,2`;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: RERANK_MODEL, temperature: 0, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) return candidates;
    const txt = (await res.json()).choices[0].message.content;
    const order = (txt.match(/\d+/g) ?? []).map(Number).filter((n) => n >= 1 && n <= candidates.length);
    const seen = new Set();
    const reordered = [];
    for (const n of order) { if (!seen.has(n)) { seen.add(n); reordered.push(candidates[n - 1]); } }
    // append any the model omitted, preserving original order
    candidates.forEach((c, i) => { if (!seen.has(i + 1)) reordered.push(c); });
    return reordered;
  } catch { return candidates; }
}

const rankOf = (list, expected) => {
  for (let i = 0; i < list.length; i++) if (expected.some((e) => list[i].id.startsWith(e))) return i + 1;
  return 0;
};

let mrrBefore = 0, mrrAfter = 0, n = 0;
console.log(`\n  RERANK EVAL — retrieve top-${RETRIEVE_K}, rerank with ${RERANK_MODEL}\n  ${"─".repeat(76)}`);
console.log(`  ${"id".padEnd(12)} ${"hybrid".padEnd(8)} ${"reranked".padEnd(9)} question`);
console.log("  " + "─".repeat(76));
for (const g of golden) {
  let rBefore = 0, rAfter = 0;
  try {
    const emb = await embed(g.question);
    const cands = hybridSearch(emb, g.question, g.scope ?? "company");
    rBefore = rankOf(cands, g.expected_memory_ids);
    const reranked = await rerank(g.question, cands);
    rAfter = rankOf(reranked, g.expected_memory_ids);
  } catch (e) { console.log(`  ⚠️  ${g.id}: ${String(e).slice(0, 60)}`); continue; }
  n++;
  mrrBefore += rBefore ? 1 / rBefore : 0;
  mrrAfter += rAfter ? 1 / rAfter : 0;
  const arrow = rAfter && rBefore && rAfter < rBefore ? "⬆" : rAfter === rBefore ? "=" : rAfter && !rBefore ? "✨" : " ";
  console.log(`  ${g.id.padEnd(12)} ${(rBefore || "MISS").toString().padEnd(8)} ${(rAfter || "MISS").toString().padEnd(7)} ${arrow}  ${g.question.slice(0, 40)}`);
}
console.log("  " + "─".repeat(76));
console.log(`\n  MRR BEFORE rerank : ${(mrrBefore / n).toFixed(3)}`);
console.log(`  MRR AFTER  rerank : ${(mrrAfter / n).toFixed(3)}   ${mrrAfter > mrrBefore ? "⬆ improved" : ""}\n`);

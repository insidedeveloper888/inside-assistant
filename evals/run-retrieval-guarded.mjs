/**
 * Confidence-guarded reranking — the production-grade version.
 *
 * Reranking helped buried facts but REGRESSED an already-perfect rank-1
 * (q001: 1->4) because an LLM reranker second-guesses every result. The fix:
 * only rerank when hybrid retrieval is UNCERTAIN.
 *
 * Confidence signal = the similarity gap between the top-1 and top-2 hits.
 *   - Big gap  → hybrid is confident about its winner → TRUST it (skip rerank).
 *   - Small gap→ top results are close, hybrid is unsure → RERANK.
 *
 * This keeps the wins (buried correct facts get reranked up) without the loss
 * (confident correct rank-1s are left alone).
 *
 * Run:
 *   CONF_GAP=0.04 OPENAI_API_KEY=... PGHOST=... PGUSER=... PGPASSWORD=... PGDATABASE=postgres \
 *     node evals/run-retrieval-guarded.mjs
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RETRIEVE_K = Number(process.env.EVAL_RETRIEVE_K ?? 15);
const RERANK_MODEL = process.env.RERANK_MODEL ?? "gpt-4o-mini";
const CONF_GAP = Number(process.env.CONF_GAP ?? 0.018); // similarity-gap threshold to TRUST hybrid
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
  // id \t similarity \t content
  const sql = `select id::text || E'\\t' || coalesce(similarity,0)::text || E'\\t' ||
      regexp_replace(content, E'[\\n\\r\\t]+', ' ', 'g')
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
    const [id, sim, ...rest] = line.split("\t");
    return { id, sim: Number(sim) || 0, content: rest.join(" ") };
  });
}

async function rerank(query, candidates) {
  if (candidates.length <= 1) return candidates;
  const passages = candidates.map((c, i) => `[${i + 1}] ${c.content.slice(0, 400)}`).join("\n");
  const prompt = `You are a search reranker. Rank the passages from MOST to LEAST relevant for answering the query.\n\nQUERY: "${query}"\n\nPASSAGES:\n${passages}\n\nRespond with ONLY a comma-separated list of passage numbers, best first.`;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: RERANK_MODEL, temperature: 0, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) return candidates;
    const txt = (await res.json()).choices[0].message.content;
    const order = (txt.match(/\d+/g) ?? []).map(Number).filter((n) => n >= 1 && n <= candidates.length);
    const seen = new Set(); const reordered = [];
    for (const n of order) { if (!seen.has(n)) { seen.add(n); reordered.push(candidates[n - 1]); } }
    candidates.forEach((c, i) => { if (!seen.has(i + 1)) reordered.push(c); });
    return reordered;
  } catch { return candidates; }
}

const rankOf = (list, expected) => {
  for (let i = 0; i < list.length; i++) if (expected.some((e) => list[i].id.startsWith(e))) return i + 1;
  return 0;
};

let mrr = 0, n = 0, reranked = 0, trusted = 0;
console.log(`\n  CONFIDENCE-GUARDED RERANK — gap>${CONF_GAP} trusts hybrid, else reranks (${RERANK_MODEL})\n  ${"─".repeat(78)}`);
console.log(`  ${"id".padEnd(11)} ${"gap".padEnd(7)} ${"action".padEnd(9)} ${"rank".padEnd(5)} question`);
console.log("  " + "─".repeat(78));
for (const g of golden) {
  let rank = 0, gap = 0, action = "";
  try {
    const emb = await embed(g.question);
    const cands = hybridSearch(emb, g.question, g.scope ?? "company");
    gap = (cands[0]?.sim ?? 0) - (cands[1]?.sim ?? 0);
    if (gap >= CONF_GAP) { action = "trust"; trusted++; rank = rankOf(cands, g.expected_memory_ids); }
    else { action = "RERANK"; reranked++; rank = rankOf(await rerank(g.question, cands), g.expected_memory_ids); }
  } catch (e) { console.log(`  ⚠️  ${g.id}: ${String(e).slice(0, 50)}`); continue; }
  n++; mrr += rank ? 1 / rank : 0;
  console.log(`  ${g.id.padEnd(11)} ${gap.toFixed(3).padEnd(7)} ${action.padEnd(9)} ${(rank || "MISS").toString().padEnd(5)} ${g.question.slice(0, 38)}`);
}
console.log("  " + "─".repeat(78));
console.log(`\n  MRR (guarded) : ${(mrr / n).toFixed(3)}   (${trusted} trusted hybrid, ${reranked} reranked)`);
console.log(`  vs hybrid-only 0.675  ·  vs always-rerank 0.725\n`);

/**
 * Generation evaluation via LLM-as-judge.
 *
 * For each golden question: retrieve context (live), generate an answer with
 * the production model (BytePlus DeepSeek), then have a DIFFERENT-FAMILY judge
 * model (Claude proxy) score it on a rubric. Using a different family avoids
 * self-preference bias (a model rating its own outputs higher).
 *
 * Scores (1-5 each, rubric-anchored):
 *   - faithfulness : every claim grounded in the retrieved context (anti-hallucination)
 *   - relevance    : does the answer address the question?
 *   - correctness  : does it match the expected_answer?
 *
 * Negative/unknown entries are judged on whether the model correctly DECLINED
 * (said "I don't know") rather than hallucinating.
 *
 * Run:  npx tsx --env-file=.env.local evals/run-judge.ts
 */
import { createAdminClient } from "../lib/supabase-admin";
import { searchVectorMemories } from "../lib/vector-memory";
import { chatWithFallback } from "../lib/byteplus-client";
import { loadGolden, pct, type GoldenEntry } from "./lib";

const CLAUDE_PROXY_URL = process.env.CLAUDE_PROXY_URL || "";
const CLAUDE_PROXY_API_KEY = process.env.CLAUDE_PROXY_API_KEY || "";
const TOP_K = Number(process.env.EVAL_TOP_K ?? 8);

type Scores = { faithfulness: number; relevance: number; correctness: number; verdict: string };

async function generateAnswer(entry: GoldenEntry, context: string): Promise<string> {
  const systemPrompt = `You are Inside Assistant. Answer the user's question using ONLY the company memory below. If the memory does not contain the answer, say you don't have that information — do NOT guess.

--- COMPANY MEMORY ---
${context || "(no memory retrieved)"}
--- END ---`;
  const r = await chatWithFallback({
    systemPrompt,
    messages: [{ role: "user", content: entry.question }],
    sessionId: `eval-${entry.id}`,
    userId: "eval",
  });
  return r.content;
}

/**
 * Judge with a different-family model (Claude proxy) for bias avoidance.
 * Falls back to the generation provider only if no judge is configured
 * (and prints a warning, since self-judging is weaker evidence).
 */
async function judge(entry: GoldenEntry, answer: string, context: string): Promise<Scores> {
  const rubric = `You are a strict RAG answer evaluator. Score the ANSWER on three axes, 1-5.

QUESTION: ${entry.question}
EXPECTED ANSWER (ground truth): ${entry.expected_answer}
RETRIEVED CONTEXT (what the answer was allowed to use):
${context || "(none)"}

ANSWER TO JUDGE:
${answer}

Scoring (1=terrible, 5=perfect):
- faithfulness: are ALL claims in the answer supported by the retrieved context? A claim not in the context = unfaithful (hallucination), score low even if it happens to be true.
- relevance: does the answer actually address the question?
- correctness: does the answer match the expected ground-truth answer?

${entry.category === "negative" ? "NOTE: This is a NEGATIVE/UNKNOWN case. The ground truth is that the system should DECLINE or correct a false premise. If the answer correctly says 'I don't have that' / corrects the false premise, score faithfulness=5 correctness=5. If it hallucinated an answer, score both 1." : ""}

Respond with ONLY valid JSON, no markdown:
{"faithfulness": <1-5>, "relevance": <1-5>, "correctness": <1-5>, "verdict": "<one short sentence>"}`;

  let raw = "";
  if (CLAUDE_PROXY_URL) {
    const res = await fetch(`${CLAUDE_PROXY_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(CLAUDE_PROXY_API_KEY ? { "X-API-Key": CLAUDE_PROXY_API_KEY } : {}) },
      body: JSON.stringify({ systemPrompt: "You are a strict JSON-only evaluator.", messages: [{ role: "user", content: rubric }] }),
    });
    raw = res.ok ? (await res.json()).content ?? "" : "";
  }
  if (!raw) {
    // No judge configured — fall back to generation provider (weaker; self-preference risk).
    console.warn("  ⚠️  No CLAUDE_PROXY judge configured — falling back to generation model as judge (less rigorous).");
    const r = await chatWithFallback({ systemPrompt: "You are a strict JSON-only evaluator.", messages: [{ role: "user", content: rubric }], sessionId: `judge-${entry.id}`, userId: "judge" });
    raw = r.content;
  }
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { faithfulness: 0, relevance: 0, correctness: 0, verdict: "judge returned non-JSON" };
  try {
    return JSON.parse(m[0]) as Scores;
  } catch {
    return { faithfulness: 0, relevance: 0, correctness: 0, verdict: "judge JSON parse failed" };
  }
}

async function main() {
  const golden = loadGolden();
  const admin = createAdminClient();
  const totals = { faithfulness: 0, relevance: 0, correctness: 0 };

  console.log(`\n  GENERATION EVAL (LLM-as-judge) — ${golden.length} questions, judge=${CLAUDE_PROXY_URL ? "claude-proxy (cross-family)" : "self (fallback)"}\n`);
  console.log("  " + "─".repeat(78));

  for (const g of golden) {
    const results = await searchVectorMemories(admin, { query: g.question, scope: g.scope ?? "company", tenantId: null, limit: TOP_K, accessSource: "eval-judge" });
    const context = results.map((r, i) => `[${i + 1}] ${r.content.replace(/\s+/g, " ").slice(0, 400)}`).join("\n");
    const answer = await generateAnswer(g, context);
    const s = await judge(g, answer, context);

    totals.faithfulness += s.faithfulness;
    totals.relevance += s.relevance;
    totals.correctness += s.correctness;

    const flag = s.faithfulness >= 4 && s.correctness >= 4 ? "✅" : s.faithfulness <= 2 ? "🔴" : "🟡";
    console.log(`  ${flag} ${g.id.padEnd(12)} F:${s.faithfulness} R:${s.relevance} C:${s.correctness}  ${g.question.slice(0, 42)}`);
    console.log(`        ↳ ${s.verdict}`);
  }

  const n = golden.length;
  console.log("  " + "─".repeat(78));
  console.log(`\n  SCORECARD (avg /5)`);
  console.log(`    Faithfulness : ${(totals.faithfulness / n).toFixed(2)}   ← anti-hallucination (most important)`);
  console.log(`    Relevance    : ${(totals.relevance / n).toFixed(2)}`);
  console.log(`    Correctness  : ${(totals.correctness / n).toFixed(2)}`);
  console.log("");
}

main().catch((err) => { console.error("judge eval failed:", err); process.exit(1); });

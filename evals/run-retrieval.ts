/**
 * Retrieval evaluation — runs each golden question through the LIVE
 * search_memory_vectors RPC and scores whether the expected memories were
 * retrieved. No LLM involved (fast, cheap, deterministic-ish).
 *
 * Metrics:
 *   - Hit@K       : did at least one expected memory appear in top-K?
 *   - MRR         : 1 / rank of the first relevant result (averaged)
 *   - Precision@K : fraction of top-K that were expected (low by nature
 *                   when there are few expected ids — reported for context)
 *
 * Only entries WITH expected_memory_ids are scored (negative/unknown cases
 * have none — those are for the generation/faithfulness eval).
 *
 * Run:  npx tsx --env-file=.env.local evals/run-retrieval.ts
 */
import { createAdminClient } from "../lib/supabase-admin";
import { searchVectorMemories } from "../lib/vector-memory";
import { loadGolden, idMatches, pct } from "./lib";

const TOP_K = Number(process.env.EVAL_TOP_K ?? 10);

async function main() {
  const golden = loadGolden().filter((g) => g.expected_memory_ids.length > 0);
  if (golden.length === 0) {
    console.log("No golden entries with expected_memory_ids to score.");
    return;
  }

  const admin = createAdminClient();
  let hitSum = 0;
  let mrrSum = 0;
  let precSum = 0;

  console.log(`\n  RETRIEVAL EVAL — top-${TOP_K}, ${golden.length} scored questions\n`);
  console.log("  " + "─".repeat(76));

  for (const g of golden) {
    const results = await searchVectorMemories(admin, {
      query: g.question,
      scope: g.scope ?? "company",
      tenantId: null,
      limit: TOP_K,
      accessSource: "eval",
    });

    // Rank (1-based) of the first retrieved id that matches an expected one.
    let firstRelevantRank = 0;
    let relevantCount = 0;
    results.forEach((r, i) => {
      if (idMatches(r.id, g.expected_memory_ids)) {
        relevantCount++;
        if (firstRelevantRank === 0) firstRelevantRank = i + 1;
      }
    });

    const hit = firstRelevantRank > 0 ? 1 : 0;
    const mrr = firstRelevantRank > 0 ? 1 / firstRelevantRank : 0;
    const prec = results.length > 0 ? relevantCount / results.length : 0;

    hitSum += hit;
    mrrSum += mrr;
    precSum += prec;

    const mark = hit ? "✅" : "❌";
    const rankStr = firstRelevantRank > 0 ? `rank ${firstRelevantRank}` : "MISS";
    console.log(`  ${mark}  ${g.id.padEnd(12)} ${rankStr.padEnd(8)} ${g.question.slice(0, 50)}`);
    if (!hit) {
      const top = results[0];
      console.log(`        ↳ top result instead: ${top ? top.content.replace(/\s+/g, " ").slice(0, 60) : "(none)"}`);
    }
  }

  const n = golden.length;
  console.log("  " + "─".repeat(76));
  console.log(`\n  SCORECARD`);
  console.log(`    Hit@${TOP_K}     : ${pct(hitSum / n)}   (${hitSum}/${n} questions retrieved a relevant memory)`);
  console.log(`    MRR        : ${(mrrSum / n).toFixed(3)}   (1.0 = always rank 1; 0.5 = avg rank 2)`);
  console.log(`    Precision@${TOP_K}: ${pct(precSum / n)}   (signal-to-noise; low is normal with few expected ids)`);
  console.log("");

  // Non-zero exit if hit rate is below a regression threshold — lets CI gate on it.
  const HIT_FLOOR = Number(process.env.EVAL_HIT_FLOOR ?? 0.8);
  if (hitSum / n < HIT_FLOOR) {
    console.error(`  ⚠️  Hit@${TOP_K} ${pct(hitSum / n)} is below floor ${pct(HIT_FLOOR)} — retrieval regression.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("eval failed:", err);
  process.exit(1);
});

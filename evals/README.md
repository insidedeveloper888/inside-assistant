# Inside Assistant — RAG Evaluation

Industry-grade evaluation harness for the Inside Assistant retrieval-augmented
generation (RAG) system. Proves the RAG is accurate, measures it continuously,
and catches regressions as the memory corpus grows.

## Why this exists

Anyone can wire pgvector + an LLM. The hard part — and what separates a demo
from a production system — is **proving it's accurate and keeping it accurate
as facts accumulate**. This harness does that.

RAG fails in two independent places, so we evaluate both separately, then
end-to-end:

1. **Retrieval** — did it pull the right memories?
2. **Generation** — given those memories, is the answer faithful, relevant, correct?

## The golden dataset (`golden.jsonl`)

The foundation. Each line is one test case:

```json
{
  "id": "q002",
  "question": "What's the GitHub repo for the e-ticketing system?",
  "expected_answer": "https://github.com/insidedeveloper888/Internal-Eticketing",
  "expected_memory_ids": ["be99b0ae"],   // retrieval must surface these
  "category": "company_knowledge",
  "difficulty": "conflicting_facts",
  "must_cite": true,
  "notes": "Corpus has 2 conflicting repos; must return the corrected one."
}
```

### Sources (in priority order)
1. **Real chat logs** — actual questions staff asked (mined from `assistant_messages`). Gold standard: real distribution.
2. **Synthetic from memories** — take a memory chunk → generate a question it answers. Cheap coverage for un-queried facts.
3. **Hand-crafted edge cases** — conflicting, time-sensitive, and "should say I don't know".

### Categories
| Category | Tests |
|----------|-------|
| `company_knowledge` | Core RAG (retrieval + generation) |
| `person_project` | Entity recall (keyword half of hybrid search) |
| `capability_howto` | Self-knowledge ("how to connect Lark") |
| `action_routing` | Capability routing (book event, notify) |
| `negative` | Hallucination resistance — **must say "I don't know"** when corpus lacks the fact |

> The `negative` category is the most important. The #1 production RAG failure
> is confidently answering questions the corpus can't support. ~20% of the
> golden set should be unanswerable-by-design.

## Metrics

### Retrieval (need `expected_memory_ids`)
- **Recall@K** — did a relevant memory land in top-K?
- **Context Precision** — signal-to-noise of retrieved chunks
- **MRR** — how high the first relevant chunk ranked

### Generation (LLM-as-judge)
- **Faithfulness** ⭐ — every claim grounded in retrieved context (anti-hallucination)
- **Answer Relevance** — does it address the question?
- **Answer Correctness** — vs `expected_answer`

### LLM-as-judge — bias mitigation (what makes it credible)
- **Different model family as judge** than the one judged (judge DeepSeek with a Claude/GPT-4-class model) — avoids self-preference bias.
- **Rubric-based pointwise scoring** (1–5 with anchors), not vague "rate this".
- **Calibrated** against a hand-labeled subset — report judge↔human agreement (Cohen's κ). An uncalibrated judge is just a vibe.

## Staying accurate as the corpus grows
- **Recency weighting** — newer facts rank higher on conflict (see q002: corpus had 2 repos).
- **Dedup/merge** near-identical memories on write.
- **Conflict detection** — flag when top-K chunks contradict.
- **Weekly golden-set run** — track metrics over time; alert on regression.

## Real findings already surfaced (before any test ran)
Building this dataset already exposed production issues:
- **Conflicting facts**: corpus recorded two different E-ticketing repos.
- **A logged retrieval miss**: the assistant once said "I don't have that info"
  then "I missed it on the first pass" (memories `853dcb73`, `6523ddb6`) — now
  a regression test (`q002`).

This is the point: eval work pays off before the eval even runs.

## Run (planned)
```
npm run eval            # full suite → scorecard
npm run eval:retrieval  # recall@K / MRR only (fast, no LLM)
npm run eval:judge      # generation faithfulness/relevance (LLM judge)
```

## Status
- [x] Golden dataset scaffold + first real cluster (E-ticketing)
- [ ] Retrieval scorer (recall@K / MRR against `search_memory_vectors`)
- [ ] LLM-judge harness (faithfulness/relevance, calibrated)
- [ ] Inline citations in `/chat` output
- [ ] CI integration + metrics dashboard

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type GoldenEntry = {
  id: string;
  question: string;
  expected_answer: string;
  expected_memory_ids: string[]; // may be short (8-char) prefixes
  category: string;
  difficulty: string;
  must_cite?: boolean;
  scope?: "company" | "personal";
  notes?: string;
};

/** Load and parse golden.jsonl. */
export function loadGolden(): GoldenEntry[] {
  const path = join(__dirname, "golden.jsonl");
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as GoldenEntry);
}

/**
 * Match a returned full UUID against an expected id, which may be a short
 * 8-char prefix (we keep golden ids short for readability). A returned id
 * counts as a hit if it starts with any expected prefix.
 */
export function idMatches(returnedId: string, expectedIds: string[]): boolean {
  return expectedIds.some((e) => returnedId.startsWith(e));
}

/** Pretty percentage. */
export const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

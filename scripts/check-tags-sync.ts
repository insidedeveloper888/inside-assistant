#!/usr/bin/env tsx
/**
 * CI sync guard for the tag registry.
 *
 * Verifies that `lib/tags/specs.ts` in this repo (inside-assistant) and the
 * mirror in `whatsappanalysis/services/webhook-receiver/src/lib/tags/specs.ts`
 * are byte-for-byte identical (after normalising trailing whitespace).
 *
 * Run locally:    tsx scripts/check-tags-sync.ts /path/to/whatsappanalysis
 * Run in CI:      same, with the path provided via env or PR-local clone
 *
 * Exit codes:
 *   0 — files match
 *   1 — files differ (drift detected — prints a diff)
 *   2 — usage / file not found
 *
 * The two files are intentionally independent copies because the repos are
 * separate. Any change to a shared spec MUST land in both repos in the same
 * PR, or this guard fails and the build is blocked.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const LOCAL = resolve(__dirname, "..", "lib", "tags", "specs.ts");
const REMOTE_SUBPATH = "services/webhook-receiver/src/lib/tags/specs.ts";

function fail(code: number, msg: string): never {
  console.error(`[check-tags-sync] ${msg}`);
  process.exit(code);
}

function normalize(src: string): string {
  // Strip trailing whitespace per line + collapse Windows line endings.
  // The actual import paths/types are identical between repos so no other
  // normalization should be needed.
  return src.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

const remoteRoot = process.argv[2] ?? process.env.WA_REPO_PATH;
if (!remoteRoot) {
  fail(
    2,
    "Usage: tsx scripts/check-tags-sync.ts <path-to-whatsappanalysis-repo>\n" +
      "       OR set WA_REPO_PATH env var.",
  );
}

const remote = resolve(remoteRoot, REMOTE_SUBPATH);

if (!existsSync(LOCAL)) fail(2, `local specs not found: ${LOCAL}`);
if (!existsSync(remote)) fail(2, `remote specs not found: ${remote}`);

const a = normalize(readFileSync(LOCAL, "utf8"));
const b = normalize(readFileSync(remote, "utf8"));

if (a === b) {
  console.log(`[check-tags-sync] ✅ specs match (${a.length} bytes normalised)`);
  process.exit(0);
}

// Pretty-print the first divergence so the failure is actionable.
const linesA = a.split("\n");
const linesB = b.split("\n");
const max = Math.max(linesA.length, linesB.length);

console.error(`[check-tags-sync] ❌ DRIFT DETECTED between:`);
console.error(`  local : ${LOCAL}`);
console.error(`  remote: ${remote}`);
console.error("");

let firstDiff = -1;
for (let i = 0; i < max; i++) {
  if (linesA[i] !== linesB[i]) {
    firstDiff = i;
    break;
  }
}

if (firstDiff >= 0) {
  const ctxStart = Math.max(0, firstDiff - 3);
  const ctxEnd = Math.min(max, firstDiff + 6);
  console.error(`First divergence at line ${firstDiff + 1}:`);
  console.error("");
  for (let i = ctxStart; i < ctxEnd; i++) {
    const marker = i === firstDiff ? ">>" : "  ";
    console.error(`${marker} ${String(i + 1).padStart(4)} | local : ${linesA[i] ?? "(eof)"}`);
    console.error(`${marker}      | remote: ${linesB[i] ?? "(eof)"}`);
  }
}

console.error("");
console.error("Fix: edit BOTH files to match in the same PR. The spec file is");
console.error("the contract — drift means the AI's prompt and the runtime are");
console.error("out of sync between web and WhatsApp.");
fail(1, "specs differ");

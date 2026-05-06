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

/**
 * Files that MUST be byte-identical (after normalising whitespace) between
 * the two repos. Add new entries here as you extract more shared modules.
 *
 * Repo-specific files (handlers-web.ts vs handlers-wa.ts) are intentionally
 * NOT in this list — they call different lib code per repo.
 */
const SYNC_FILES: Array<{ local: string; remoteSubpath: string }> = [
  {
    local: resolve(__dirname, "..", "lib", "tags", "types.ts"),
    remoteSubpath: "services/webhook-receiver/src/lib/tags/types.ts",
  },
  {
    local: resolve(__dirname, "..", "lib", "tags", "specs.ts"),
    remoteSubpath: "services/webhook-receiver/src/lib/tags/specs.ts",
  },
  {
    local: resolve(__dirname, "..", "lib", "tags", "runtime.ts"),
    remoteSubpath: "services/webhook-receiver/src/lib/tags/runtime.ts",
  },
];

function fail(code: number, msg: string): never {
  console.error(`[check-tags-sync] ${msg}`);
  process.exit(code);
}

function normalize(src: string): string {
  // Strip trailing whitespace per line + collapse Windows line endings.
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

let totalBytes = 0;
let driftDetected = false;

for (const { local, remoteSubpath } of SYNC_FILES) {
  const remote = resolve(remoteRoot, remoteSubpath);
  if (!existsSync(local)) fail(2, `local file not found: ${local}`);
  if (!existsSync(remote)) fail(2, `remote file not found: ${remote}`);

  const a = normalize(readFileSync(local, "utf8"));
  const b = normalize(readFileSync(remote, "utf8"));

  if (a === b) {
    totalBytes += a.length;
    console.log(`[check-tags-sync] ✅ ${remoteSubpath} (${a.length}b)`);
    continue;
  }

  driftDetected = true;
  const linesA = a.split("\n");
  const linesB = b.split("\n");
  const max = Math.max(linesA.length, linesB.length);

  console.error(`[check-tags-sync] ❌ DRIFT in ${remoteSubpath}`);
  console.error(`  local : ${local}`);
  console.error(`  remote: ${remote}`);

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
    console.error(`  first divergence at line ${firstDiff + 1}:`);
    for (let i = ctxStart; i < ctxEnd; i++) {
      const marker = i === firstDiff ? ">>" : "  ";
      console.error(`  ${marker} ${String(i + 1).padStart(4)} | local : ${linesA[i] ?? "(eof)"}`);
      console.error(`  ${marker}      | remote: ${linesB[i] ?? "(eof)"}`);
    }
  }
  console.error("");
}

if (driftDetected) {
  console.error("Fix: edit BOTH files to match in the same PR. These files");
  console.error("are the cross-repo contract — drift means the AI's prompt and");
  console.error("the runtime are out of sync between web and WhatsApp.");
  fail(1, "drift detected");
}

console.log(`[check-tags-sync] ✅ all ${SYNC_FILES.length} files match (${totalBytes}b total)`);

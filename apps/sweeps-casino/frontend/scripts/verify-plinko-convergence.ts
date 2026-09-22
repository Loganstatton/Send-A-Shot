// Standalone verification script (no frontend test runner is configured in
// this workspace — see package.json). Run manually with:
//   node --experimental-strip-types scripts/verify-plinko-convergence.ts
// from apps/sweeps-casino/frontend.
//
// For every row count in the valid backend range (8-16) and every possible
// target bucket (0..rows, including the rarest edge buckets), runs the real
// headless simulateUntilMatch() and asserts:
//   1. it converges to the correct bucket (finalBucket === target), always
//   2. it does so within a bounded attempt count / time budget
// This is the hard invariant from the product spec: the server's bucket and
// the visual landing bucket must always match, with zero exceptions.

import { computePlinkoLayout, simulateUntilMatch } from "../components/casino/originals/plinkoPhysics.ts";

const ROW_RANGE = [8, 9, 10, 11, 12, 13, 14, 15, 16];
const MAX_ACCEPTABLE_ATTEMPTS = 4750; // matches the staged spawn-jitter search budget (SEARCH_BUDGET)
const MAX_ACCEPTABLE_MS_PER_CASE = 4000; // generous per-bucket wall-clock budget

let totalCases = 0;
let totalAttempts = 0;
let maxAttempts = 0;
let fallbackCount = 0;
const allAttemptCounts: number[] = [];
const edgeAttemptCounts: number[] = [];
const interiorAttemptCounts: number[] = [];
let failures: string[] = [];
const startAll = Date.now();

for (const rows of ROW_RANGE) {
  const layout = computePlinkoLayout(rows);
  const bucketCount = rows + 1;
  for (let bucket = 0; bucket < bucketCount; bucket++) {
    totalCases++;
    const t0 = Date.now();
    const result = simulateUntilMatch(rows, bucket, layout);
    const elapsedMs = Date.now() - t0;

    if (result.finalBucket !== bucket) {
      failures.push(`rows=${rows} target=${bucket} -> got bucket ${result.finalBucket} (attempts=${result.attempts})`);
    }
    if (result.attempts > MAX_ACCEPTABLE_ATTEMPTS) {
      failures.push(`rows=${rows} target=${bucket} -> exceeded attempt budget (${result.attempts})`);
    }
    if (elapsedMs > MAX_ACCEPTABLE_MS_PER_CASE) {
      failures.push(`rows=${rows} target=${bucket} -> exceeded time budget (${elapsedMs}ms)`);
    }
    if (result.usedFallback) fallbackCount++;

    totalAttempts += result.attempts;
    maxAttempts = Math.max(maxAttempts, result.attempts);
    allAttemptCounts.push(result.attempts);
    const isEdge = bucket === 0 || bucket === bucketCount - 1;
    (isEdge ? edgeAttemptCounts : interiorAttemptCounts).push(result.attempts);

    const tag = isEdge ? " (edge bucket)" : "";
    console.log(
      `rows=${String(rows).padStart(2)} bucket=${String(bucket).padStart(2)}/${bucketCount - 1}${tag}  ` +
        `attempts=${String(result.attempts).padStart(3)}  frames=${String(result.frames.length).padStart(3)}  ` +
        `settled=${result.settled}  fallback=${result.usedFallback}  ${elapsedMs}ms`
    );
  }
}

const totalElapsed = Date.now() - startAll;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}
function stats(label: string, counts: number[]) {
  if (counts.length === 0) return;
  const sorted = [...counts].sort((a, b) => a - b);
  const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
  console.log(
    `${label}: n=${counts.length} avg=${avg.toFixed(1)} median=${percentile(sorted, 0.5)} ` +
      `p90=${percentile(sorted, 0.9)} p99=${percentile(sorted, 0.99)} max=${sorted[sorted.length - 1]}`
  );
}

console.log("\n=== SUMMARY ===");
console.log(`cases: ${totalCases}`);
console.log(`avg attempts: ${(totalAttempts / totalCases).toFixed(2)}`);
console.log(`max attempts: ${maxAttempts}`);
console.log(`fallback uses: ${fallbackCount}`);
console.log(`total wall time: ${totalElapsed}ms (avg ${(totalElapsed / totalCases).toFixed(1)}ms/case)`);
stats("all buckets      ", allAttemptCounts);
stats("interior buckets ", interiorAttemptCounts);
stats("edge buckets     ", edgeAttemptCounts);

if (failures.length > 0) {
  console.error(`\nFAIL: ${failures.length} case(s) violated the invariant:`);
  for (const f of failures) console.error(" - " + f);
  process.exit(1);
} else {
  console.log(`\nPASS: all ${totalCases} (rows x bucket) cases converged to the correct bucket within budget.`);
}

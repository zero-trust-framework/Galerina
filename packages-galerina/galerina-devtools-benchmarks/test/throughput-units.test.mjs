// throughput-units.test.mjs — guards the unit-normalization logic that keeps the
// benchmark comparison HONEST. Synthetic (no benchmark execution), so it's fast and
// deterministic. Run via `npm test`. Exits non-zero on any failure (CI gate).
//
// This is the regression test for the 2026-06-17 unit bug: compare.mjs used to pit
// Galerina's inner-ops/sec against the other languages' whole-call/sec, producing false
// "Galerina wins". These cases lock in the fix.
import { normalizeThroughput, assertBenchmarkUnits, benchmarkSpec, isComparable } from "../src/throughput-units.mjs";

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };
const approx = (a, b, tol = 0.01) => Math.abs(a - b) / b <= tol;

// ── nbody: the headline inflation case (was 32768×) ─────────────────────────
const nbody = {
  nodejs:         { iterationsPerSecond: 3700, forceEvalsPerSecond: 3700 * 32768 },
  galerinaManifest: { execMs: 522.6 },
};
const nNode = normalizeThroughput("nodejs", nbody.nodejs, "nbody").ops;
const nMan  = normalizeThroughput("galerinaManifest", nbody.galerinaManifest, "nbody").ops;
ok(nNode === 3700 * 32768, `nbody node → force-evals/s (${nNode})`);
ok(approx(nMan, 62700, 0.02), `nbody galerina-manifest → force-evals/s (${nMan})`);
ok(nNode > nMan * 1000, "nbody: Node is >1000× the tree-walker — no false win");
ok(assertBenchmarkUnits("nbody", nbody).status === "PASS", "nbody unit assertion PASS");

// ── collection-pipeline: whole-pass/sec must be scaled by size (was 10000×) ──
const cp = { nodejs: { iterationsPerSecond: 1000, size: 10000 }, galerinaManifest: { execMs: 50 } };
ok(normalizeThroughput("nodejs", cp.nodejs, "collection-pipeline").ops === 10_000_000, "collection-pipeline node → elements/s (×size)");
ok(normalizeThroughput("galerinaManifest", cp.galerinaManifest, "collection-pipeline").ops === 200_000, "collection-pipeline galerina → elements/s");

// ── json-parse: nested rate must be de-nested (was a silent dropout) ─────────
const jp = { nodejs: { records: 500, results: { splitScan: { operationsPerSecond: 800 } } } };
ok(normalizeThroughput("nodejs", jp.nodejs, "json-parse").ops === 400_000, "json-parse node de-nested → records/s");
ok(assertBenchmarkUnits("json-parse", jp).status === "PASS", "json-parse unit assertion PASS (no dropout)");

// ── dropout detection: a runtime with rate data that fails to normalize → FAIL ──
const drop = { nodejs: { iterationsPerSecond: 3700 } }; // nbody needs forceEvalsPerSecond
ok(assertBenchmarkUnits("nbody", drop).status === "FAIL", "dropout (nbody node w/o forceEvalsPerSecond) → FAIL");

// ── non-comparable benchmarks must be excluded, never silently compared ──────
for (const b of ["tri-logic", "data-query"]) {
  ok(isComparable(b) === false, `${b} is non-comparable (excluded)`);
  ok(assertBenchmarkUnits(b, { nodejs: { iterationsPerSecond: 1 } }).status === "FLAGGED", `${b} → FLAGGED`);
  ok(normalizeThroughput("nodejs", { iterationsPerSecond: 1 }, b).ops === null, `${b} produces no comparable number`);
}

// ── matrix-multiply: un-excluded 2026-06-23 → mul-adds/s (= matmuls/s × n³, n per runtime) ──
ok(isComparable("matrix-multiply") === true, "matrix-multiply is now comparable (mul-adds/s)");
ok(normalizeThroughput("nodejs", { iterationsPerSecond: 1 }, "matrix-multiply").ops === 64 ** 3,
  "matrix-multiply node: 1 matmul/s × 64³ = mul-adds/s");
ok(normalizeThroughput("denoWebGpu", { iterationsPerSecond: 1 }, "matrix-multiply").ops === 128 ** 3,
  "matrix-multiply deno: 1 matmul/s × 128³ = mul-adds/s");
ok(normalizeThroughput("wasm", { callsPerSecond: 1 }, "matrix-multiply").ops === 32 ** 3,
  "matrix-multiply WASM: 1 call/s × 32³ (Galerina n=32) = mul-adds/s");

// ── every registered benchmark declares a single unit ───────────────────────
const EXPECT_UNITS = {
  "compute-mix": "mix-ops/s", "record-allocation": "records/s", "collection-pipeline": "elements/s",
  "low-memory": "items/s", "gpu-compute": "kernel-evals/s", "call-chain": "chains/s",
  "nbody": "force-evals/s", "json-parse": "records/s", "tmf-container": "containers/s",
  "framework-pipeline": "requests/s", "mandelbrot": "pixels/s", "spectral-norm": "A-evals/s",
  "binary-trees": "nodes/s", "matrix-multiply": "mul-adds/s",
};
for (const [b, u] of Object.entries(EXPECT_UNITS)) {
  ok(benchmarkSpec(b)?.unit === u, `${b} unit = ${u}`);
}

console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILED"}`);
process.exit(fails === 0 ? 0 : 1);

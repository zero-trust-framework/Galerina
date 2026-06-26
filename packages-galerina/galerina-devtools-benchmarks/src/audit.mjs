/**
 * audit.mjs — TRUTH AUDIT for the benchmark suite. Reads results/latest.json and
 * verifies the invariants that keep the comparison honest. Exits non-zero on any
 * violation, so it can gate CI (`npm run audit`, or part of `npm test`).
 *
 * It checks FOUR things:
 *   1. Cross-language checksum identity — every runtime that ran a checksum-bearing
 *      benchmark computed the SAME result. A runner doing different work (the deepest
 *      way a benchmark can lie) is caught here.
 *   2. Unit alignment — each comparable benchmark's `units.status` is not FAIL
 *      (i.e. all runtimes report one unit, none silently dropped out).
 *   3. Exclusions intact — the known non-comparable benchmarks stay flagged
 *      (comparable === false), so they can't sneak back into "winner" claims.
 *   4. Anti-inflation regression — on numeric-loop benchmarks the Galerina tree-walker
 *      does NOT "beat" Node.js (the original 2026-06-17 bug). Guards against a
 *      reintroduced unit mismatch flipping the result.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const dataPath  = join(__dirname, "..", "results", "latest.json");

let data;
try { data = JSON.parse(readFileSync(dataPath, "utf8")); }
catch { console.error("audit: no results/latest.json — run `npm run run` first."); process.exit(2); }

const byId = new Map(data.map(b => [b.benchmark, b]));
let fails = 0;
const fail = (msg) => { console.log(`  ❌ ${msg}`); fails++; };
const pass = (msg) => console.log(`  ✅ ${msg}`);

// Throughput as the report sees it (the normalized canonical field).
const tput = (r) => (r && !r.error && r.normThroughput !== undefined) ? r.normThroughput : null;

// ── 1. Cross-language checksum identity ─────────────────────────────────────
// benchmark → the field holding its deterministic, FIXED-WORK checksum. Galerina rows
// carry it in `result.value`. Excluded on purpose:
//   • matrix-multiply / tri-logic / data-query — different workload sizes/shapes (non-comparable).
//   • compute-mix — TIME-BASED: each runtime processes a different op count in the time
//     window, so its running checksum is not a cross-runtime invariant (throughput still is).
const CHECKSUM_FIELD = {
  "nbody": "checksum", "json-parse": "checksum",
  "mandelbrot": "checksum", "binary-trees": "checksum", "spectral-norm": "checksum",
  "tmf-container": "integrityRoot",
};
console.log("\n1. Cross-language checksum identity");
for (const [id, field] of Object.entries(CHECKSUM_FIELD)) {
  const bench = byId.get(id);
  if (!bench) { console.log(`  – ${id}: not in results (skipped)`); continue; }
  const seen = new Map();
  for (const [rt, r] of Object.entries(bench.results)) {
    if (!r || r.error) continue;
    const v = rt.startsWith("galerina")
      ? (r.result && typeof r.result === "object" ? r.result.value : r.result)
      : r[field];
    if (v !== undefined && v !== null) seen.set(rt, v);
  }
  const distinct = new Set([...seen.values()].map(String));
  if (seen.size === 0) console.log(`  – ${id}: no checksum reported (skipped)`);
  else if (distinct.size === 1) pass(`${id}: all ${seen.size} runtimes agree (${[...distinct][0]})`);
  else fail(`${id}: DIVERGENT checksums — ${[...seen].map(([k, v]) => `${k}=${v}`).join(", ")}`);
}

// ── 2. Unit alignment (no FAIL) + 3. exclusions intact ──────────────────────
console.log("\n2. Unit alignment + 3. exclusions");
// matrix-multiply un-excluded 2026-06-23 (normalized to mul-adds/s — a size-invariant GEMM metric).
// tri-logic & data-query stay excluded: their workload SHAPES (not just sizes) differ across runtimes.
const MUST_BE_NONCOMPARABLE = new Set(["tri-logic", "data-query"]);
for (const bench of data) {
  const u = bench.units;
  if (!u) continue;
  if (u.status === "FAIL") fail(`${bench.benchmark}: unit check FAILED — ${(u.problems || []).join("; ")}`);
  if (MUST_BE_NONCOMPARABLE.has(bench.benchmark) && u.comparable !== false)
    fail(`${bench.benchmark}: expected non-comparable (excluded) but comparable=${u.comparable}`);
}
for (const id of MUST_BE_NONCOMPARABLE) {
  const u = byId.get(id)?.units;
  if (u && u.comparable === false) pass(`${id}: correctly flagged & excluded`);
}
{
  const aligned = data.filter(b => b.units?.status === "PASS").map(b => b.benchmark);
  if (aligned.length) pass(`${aligned.length} comparable benchmarks unit-aligned (PASS)`);
}

// ── 4. Anti-inflation regression: tree-walker must NOT beat Node on numeric loops ──
console.log("\n4. Anti-inflation regression (Galerina governed must not beat Node.js)");
for (const id of ["nbody", "collection-pipeline", "low-memory", "compute-mix", "mandelbrot"]) {
  const bench = byId.get(id);
  if (!bench) continue;
  const gov = tput(bench.results.galerinaGoverned);
  const node = tput(bench.results.nodejs);
  if (gov == null || node == null) { console.log(`  – ${id}: missing gov/node throughput (skipped)`); continue; }
  if (gov < node) pass(`${id}: Node ${(node / gov).toFixed(0)}× the tree-walker (honest)`);
  else fail(`${id}: tree-walker (${gov}) ≥ Node (${node}) — unit inflation may have returned!`);
}

console.log(`\n${fails === 0 ? "✅ TRUTH AUDIT PASSED" : `❌ TRUTH AUDIT FAILED — ${fails} violation(s)`}`);
process.exit(fails === 0 ? 0 : 1);

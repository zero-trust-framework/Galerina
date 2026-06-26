/**
 * throughput-units.mjs — single source of truth for cross-language throughput
 * UNIT normalization, plus a per-benchmark assertion that every runtime reports
 * the SAME unit.
 *
 * ── The bug this fixes ──────────────────────────────────────────────────────
 * compare.mjs historically read Galerina's `galerinaOpsPerSecond` (INNER-ops/sec —
 * e.g. nbody = 32768 force-evals per main() call) while reading the other
 * languages' `iterationsPerSecond` (WHOLE-CALL/sec — one simulate() call). It then
 * compared inner-ops/sec against whole-calls/sec, producing false "Galerina wins":
 *   nbody showed Galerina 62.7K/s "beating" Node 3.7K/s — but Node does
 *   3.7K × 32768 = ~121M force-evals/s, i.e. Node is ~1,900× FASTER.
 *
 * ── The fix ─────────────────────────────────────────────────────────────────
 * Normalize EVERY runtime to ONE canonical unit (inner-ops/sec) per benchmark,
 * here, in one place. `runner.mjs` stamps `normThroughput` + `throughputUnit` on
 * each result; `compare.mjs` reads only `normThroughput`. `assertBenchmarkUnits`
 * guards that all runtimes share one unit and that none silently drop out.
 *
 * ── Three benchmarks are NON-COMPARABLE (flagged & excluded) ────────────────
 * matrix-multiply, tri-logic and data-query run different-sized / different-shaped
 * workloads per language, so no unit makes them apples-to-apples without first
 * realigning the workloads. They are marked `comparable: false` with a reason and
 * excluded from winner / Python-floor claims (see each spec's `reason`).
 *
 * NOTE: the canonical inner-ops-per-call (`N`) values here mirror
 * `BENCHMARKS[].galerinaOpsPerRun` in runner.mjs; THIS file is authoritative for
 * throughput. Out-of-scope benchmarks (galerinaOpsPerRun null/1 — arithmetic-threshold,
 * six-digit-guess, fibonacci-recursive, hardware-targets, governance-cost,
 * crypto-ops, text-html) are intentionally absent here and keep their legacy path.
 */

// ── small helpers ────────────────────────────────────────────────────────────
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const scale = (rate, factor) => {
  const a = num(rate), b = num(factor);
  return a != null && b != null ? Math.round(a * b) : null;
};

// Native (non-Galerina, non-WASM) runtime keys handled by each spec's `native()`.
const GALERINA_INTERP = new Set(["galerinaGoverned", "galerinaManifest"]);

// The flat per-second rate fields a runner might report at the TOP level.
// Used only for (a) display of non-comparable rows and (b) dropout detection.
function flatRate(r) {
  if (!r || r.error) return null;
  return num(r.operationsPerSecond) ?? num(r.additionsPerSecond) ?? num(r.attemptsPerSecond)
      ?? num(r.iterationsPerSecond) ?? num(r.callsPerSecond) ?? num(r.runsPerSecond);
}

// Does this runtime clearly have throughput data somewhere (flat OR nested under
// results.*)? Used by the assertion to catch a runtime that ran but failed to
// normalize (the silent-dropout class — e.g. json-parse nesting its rate).
function anyReportedRate(r) {
  if (!r || r.error) return false;
  if (flatRate(r) != null) return true;
  if (r.results && typeof r.results === "object") {
    for (const k of Object.keys(r.results)) {
      const sub = r.results[k];
      if (sub && (num(sub.operationsPerSecond) != null || num(sub.iterationsPerSecond) != null)) return true;
    }
  }
  if (num(r.warmCallsPerSecond) != null) return true;   // Galerina passive
  return false;
}

// ── per-benchmark unit specs ─────────────────────────────────────────────────
// N           = inner ops one whole call / one Galerina main() performs (canonical).
// unit        = the shared unit label all runtimes are normalized to.
// comparable  = false → workloads differ across runtimes; excluded from claims.
// native(rt,r)= inner-ops/sec for a non-Galerina, non-WASM runtime (node/python/
//               rust/cpp/deno), or null if absent. Galerina tiers + WASM are handled
//               generically from N (one call = N inner ops).
// crossCheck  = optional data-driven guard: when a runner reports BOTH its
//               whole-call rate and its inner-op rate, their ratio must ≈ N.
const SPECS = {
  // ── already aligned: native runners count inner ops directly ──────────────
  "compute-mix": {
    N: 50000, unit: "mix-ops/s", comparable: true,
    native: (_rt, r) => num(r.operationsPerSecond),          // counter = inner LCG ops
  },
  "record-allocation": {
    N: 10000, unit: "records/s", comparable: true,
    native: (_rt, r) => num(r.iterationsPerSecond),          // 1 iteration = 1 record
  },
  "gpu-compute": {
    N: 100000, unit: "kernel-evals/s", comparable: true,
    native: (_rt, r) => num(r.operationsPerSecond),          // total per-element kernel evals/sec
    crossCheck: (r) => ratioCheck(r.operationsPerSecond, r.iterationsPerSecond, num(r.elements)),
  },
  "call-chain": {
    N: 50000, unit: "chains/s", comparable: true,
    native: (_rt, r) => num(r.iterationsPerSecond),          // 1 iteration = 1 chain
  },

  // ── misaligned (fixed here): native runners report WHOLE-CALL/sec ─────────
  "collection-pipeline": {
    N: 10000, unit: "elements/s", comparable: true,
    // one "iteration" = one full filter→map→reduce pass over `size` elements
    native: (_rt, r) => scale(r.iterationsPerSecond, num(r.size) ?? 10000),
  },
  "low-memory": {
    N: 10000, unit: "items/s", comparable: true,
    // one "iteration" = one processStream(streamSize) call
    native: (_rt, r) => scale(r.iterationsPerSecond, num(r.streamSize) ?? 10000),
  },
  "nbody": {
    N: 32768, unit: "force-evals/s", comparable: true,
    // node/python already emit forceEvalsPerSecond (was computed but unused)
    native: (_rt, r) => num(r.forceEvalsPerSecond),
    crossCheck: (r) => ratioCheck(r.forceEvalsPerSecond, r.iterationsPerSecond, 32768),
  },
  "json-parse": {
    N: 500, unit: "records/s", comparable: true,
    // node/python nest the rate: results.splitScan does scanRecords(records) per call
    native: (_rt, r) => {
      const ss = r.results?.splitScan;
      return ss ? scale(ss.operationsPerSecond, num(r.records) ?? 500) : null;
    },
  },

  // ── new (2026-06-17): one op = one whole unit, already inner-ops/sec ─────────
  // .tmf creation — Node column = the @galerina/ext-tmf engine; python/rust = byte-exact
  // reference writers (all assert the same golden root). Fair SHAKE256+packing race.
  "tmf-container": {
    N: 1, unit: "containers/s", comparable: true,
    native: (_rt, r) => num(r.operationsPerSecond),
  },
  // native framework vs middleware — Node column = Galerina App Kernel; python = sync
  // gate chain. One op = one full successful request through the same gates.
  "framework-pipeline": {
    N: 1, unit: "requests/s", comparable: true,
    native: (_rt, r) => num(r.operationsPerSecond),
  },

  // ── real-world cross-language (CLBG): all report operationsPerSecond = inner-ops/sec ──
  "mandelbrot": {     // one op = one pixel (escape-time)
    N: 16384, unit: "pixels/s", comparable: true,
    native: (_rt, r) => num(r.operationsPerSecond),
  },
  "spectral-norm": {  // one op = one A(i,j) evaluation
    N: 200000, unit: "A-evals/s", comparable: true,
    native: (_rt, r) => num(r.operationsPerSecond),
  },
  "binary-trees": {   // one op = one allocated tree node (the memory benchmark)
    N: 135854, unit: "nodes/s", comparable: true,
    native: (_rt, r) => num(r.operationsPerSecond),
  },

  // ── NON-COMPARABLE: flag & exclude (workload shape/size differs) ──────────
  "matrix-multiply": {
    // FIXED 2026-06-23: normalize to MUL-ADDS/s (= matmuls/s × n³), the standard size-invariant GEMM
    // throughput metric (GFLOPS-style), so the different n become comparable in ONE unit. n still differs
    // per runtime (Galerina/WASM 32, node/python/rust 64, Deno 128), so this measures mul-add THROUGHPUT —
    // a real result that includes cache-hierarchy effects at larger n — not same-size wall-clock timing.
    // Galerina/WASM (one main() = one 32³ matmul) normalize generically from N = 32³.
    N: 32 * 32 * 32, unit: "mul-adds/s", comparable: true,
    native: (rt, r) => {
      const n = rt === "denoWebGpu" ? 128 : 64;        // node/python/rust/rustAvx2 = 64; Deno WebGPU = 128
      return scale(r.iterationsPerSecond, n * n * n);  // matmuls/s × n³ mul-adds = mul-adds/s
    },
  },
  "tri-logic": {
    N: 27000, unit: "trit-ops/s", comparable: false,
    reason: "incomparable workloads — Galerina main()=runBulkTri(100000) (100k triples / 300k trit-ops); " +
            "node/python/rust run nested 9-element truth-table micro-benches plus a separate 10M bulk; " +
            "galerinaOpsPerRun=27000 (≈27 truth-table combos ×1000) corresponds to none of these. " +
            "Needs a common bulk-N trit-op path on every runtime.",
    native: () => null,
  },
  "data-query": {
    N: 1000, unit: "records/s", comparable: false,
    reason: "incomparable — Galerina main()=filterAndCount(1000)+groupByCategory(1000)=2000 record-scans " +
            "(but galerinaOpsPerRun=1000 undercounts); node/python run 7 separate query micro-benches " +
            "nested under results.* with no single representative. Needs a main() recount + a chosen " +
            "representative query before the numbers compare.",
    native: () => null,
  },
};

// ratio of an inner-op rate to a whole-call rate must ≈ expected inner-ops-per-call.
function ratioCheck(innerRate, callRate, expected) {
  const a = num(innerRate), b = num(callRate), e = num(expected);
  if (a == null || b == null || e == null || b === 0) return null;
  const r = a / b;
  const off = Math.abs(r - e) / e;
  return off <= 0.02 ? null
    : `inner/call ratio ${r.toFixed(1)} ≠ expected ${e} (off ${(off * 100).toFixed(1)}%)`;
}

// ── public API ───────────────────────────────────────────────────────────────

/** The spec for a benchmark id, or undefined if it's not throughput-normalized here. */
export function benchmarkSpec(benchId) {
  return SPECS[benchId];
}

/** True if a benchmark's runtimes are unit-comparable (defaults true for unknown ids). */
export function isComparable(benchId) {
  const s = SPECS[benchId];
  return s ? s.comparable : true;
}

/**
 * Normalize ONE runtime result to inner-ops/sec for its benchmark.
 * Returns { speced, comparable, ops, unit, reason?, raw? }.
 *   speced=false  → not handled here; caller should use its legacy path.
 *   ops=null      → no data, or benchmark is non-comparable (excluded).
 *   raw           → best-effort native rate, for display of non-comparable rows.
 */
export function normalizeThroughput(rtKey, r, benchId) {
  const spec = SPECS[benchId];
  if (!spec) return { speced: false };

  const base = { speced: true, comparable: spec.comparable, unit: spec.unit, reason: spec.reason };
  if (!r || r.error) return { ...base, ops: null };

  if (!spec.comparable) {
    // Excluded from comparison; keep a raw number purely for transparent display.
    return { ...base, ops: null, raw: flatRate(r) };
  }

  let ops = null;
  if (GALERINA_INTERP.has(rtKey)) {
    ops = num(r.execMs) != null && r.execMs > 0 ? Math.round((spec.N / r.execMs) * 1000) : null;
  } else if (rtKey === "galerinaPassive") {
    ops = scale(r.warmCallsPerSecond, spec.N);               // warm = LRU-cache steady state
  } else if (rtKey === "wasm") {
    ops = scale(r.callsPerSecond, spec.N);                   // one WASM call = one main() = N inner ops
  } else {
    ops = spec.native(rtKey, r);                             // node/python/rust/cpp/deno
  }
  return { ...base, ops };
}

/**
 * Assert that every runtime in a benchmark reports the SAME unit (and that none
 * with real data silently fail to normalize). `resultsByRt` is the `results`
 * object ({ nodejs, python, wasm, galerinaGoverned, ... }).
 *
 * Returns { benchId, skipped?, comparable, unit, status, reason?, problems[] }.
 *   status: "PASS" | "FAIL" (comparable) or "FLAGGED" (non-comparable, expected).
 */
export function assertBenchmarkUnits(benchId, resultsByRt) {
  const spec = SPECS[benchId];
  if (!spec) return { benchId, skipped: true };

  if (!spec.comparable) {
    return { benchId, comparable: false, unit: spec.unit, status: "FLAGGED",
             reason: spec.reason, problems: [] };
  }

  const problems = [];
  const units = new Set();
  let normalized = 0;
  for (const rt of Object.keys(resultsByRt)) {
    const r = resultsByRt[rt];
    if (!r || typeof r !== "object" || r.error) continue;
    const n = normalizeThroughput(rt, r, benchId);
    if (n.ops != null) { units.add(n.unit); normalized++; }
    else if (anyReportedRate(r)) {
      problems.push(`${rt}: ran (has rate data) but did not normalize — would drop out or use a different unit`);
    }
    if (typeof spec.crossCheck === "function") {
      const cc = spec.crossCheck(r);
      if (cc) problems.push(`${rt}: ${cc}`);
    }
  }
  if (units.size > 1) problems.push(`mixed units: ${[...units].join(", ")}`);

  return {
    benchId, comparable: true, unit: spec.unit,
    status: problems.length ? "FAIL" : "PASS",
    normalized, problems,
  };
}

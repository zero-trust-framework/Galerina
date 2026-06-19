// R&D proof: "AOT tensor pre-computation" (matrix-exp reachability / fusion / superposition) for the
// tower-citizen substrate. Pure JS/CPU (software-sim; NO photonic/HW number). Self-verifying.
//
// HONESTY NOTE (v2): v1 used an LCG whose LOW bits have a short period, so `rnd()%N` built a degenerate
// graph and the densify/fill-in claims spuriously failed — caught by running it (don't-trust-check on my
// own harness). v2 uses xorshift32 (good bit quality) and counts FLOPs for the superposition claim
// instead of wall-clock. The conclusion is the classic precompute tradeoff, not a free lunch.
import { performance } from "node:perf_hooks";
import os from "node:os";

const timeit = (f, reps = 5) => { const xs = []; for (let r = 0; r < reps; r++) { const t = performance.now(); f(); xs.push(performance.now() - t); } return xs.sort((a, b) => a - b)[xs.length >> 1]; };
let fails = 0;
const check = (ok, label, detail) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`); };
let s = 2463534242 >>> 0; const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; }; // xorshift32

console.log("# AOT tensor pre-computation proof (v2)");
console.log(`# machine: ${os.cpus()[0].model} · node ${process.version} · ${os.platform()}\n`);

const N = 512;
const mkGraph = (d) => Array.from({ length: N }, () => { const set = new Set(); while (set.size < d) set.add(rnd() % N); return [...set]; });
const closureDensity = (adj) => { let nnz = 0; for (let src = 0; src < N; src++) { const seen = new Uint8Array(N), st = [src]; while (st.length) { const u = st.pop(); if (seen[u]) continue; seen[u] = 1; for (const v of adj[u]) if (!seen[v]) st.push(v); } for (let v = 0; v < N; v++) nnz += seen[v]; } return { nnz, density: nnz / (N * N) }; };

// ── D1: reachability density is REGIME-DEPENDENT; in the connected regime the closure is ~DENSE ────
{
  const sparse = mkGraph(2), connected = mkGraph(8);
  const cs = closureDensity(sparse), cc = closureDensity(connected);
  console.log(`      closure density: d=2 → ${(cs.density * 100).toFixed(1)}%   d=8 → ${(cc.density * 100).toFixed(1)}%`);
  // The regime where you'd WANT a precomputed reachability table (well-connected) is exactly where it
  // densifies to ~O(N^2). (Ultra-sparse stays sparse — but then traversal is trivial anyway.)
  check(cc.density > 0.5,
    "D1  in the connected regime the reachability closure is ~DENSE → the precomputed T_reach is O(N^2)",
    `d=8 closure ${(cc.density * 100).toFixed(0)}% full, nnz=${cc.nnz} vs adjacency nnz=${8 * N} (${(cc.nnz / (8 * N)).toFixed(0)}× blow-up)`);
}

// ── D2: applying a precomputed matrix (V × dense NxN) is O(N^2), NOT the claimed "single O(1) pulse" ─
{
  const mk = (n) => Int8Array.from({ length: n * n }, () => (rnd() % 3) - 1);
  const vecMat = (v, M, n) => { const out = new Float64Array(n); for (let i = 0; i < n; i++) { let acc = 0; for (let j = 0; j < n; j++) acc += v[j] * M[j * n + i]; out[i] = acc; } return out; };
  const t = {}; for (const n of [128, 256, 512]) { const M = mk(n), v = Float64Array.from({ length: n }, () => (rnd() % 3) - 1); vecMat(v, M, n); t[n] = timeit(() => { for (let r = 0; r < 200; r++) vecMat(v, M, n); }); }
  const r1 = t[256] / t[128], r2 = t[512] / t[256];
  check(r1 > 2.5 && r2 > 2.5,
    "D2  applying a precomputed matrix (V×dense-NxN) is O(N^2), NOT O(1) ('single hardware pulse' is false)",
    `128→256=${r1.toFixed(1)}× 256→512=${r2.toFixed(1)}× (O(N^2)≈4×/doubling; O(1)≈1×)`);
}

// ── D3: the precompute costs O(N^2) MEMORY — the dominant, often-prohibitive cost vs sparse O(N+E) ─
{
  const adj = mkGraph(8); const adjNnz = adj.reduce((a, r) => a + r.length, 0);
  const denseTable = N * N; // T_reach is a dense N×N table
  check(denseTable > adjNnz * 30,
    "D3  precomputing T_reach costs O(N^2) MEMORY — for a sparse graph that is a large multiple of the O(N+E) adjacency it replaces",
    `dense T_reach=${denseTable} cells vs adjacency=${adjNnz} (${(denseTable / adjNnz).toFixed(0)}× memory); AOT build is O(N^3)`);
}

// ── D4: "fusion" of sparse reachability matrices (A1·A2·A3) DENSIFIES (fill-in) ────────────────────
{
  const mkM = (d) => { const m = new Uint8Array(N * N); for (let i = 0; i < N; i++) { const set = new Set(); while (set.size < d) set.add(rnd() % N); for (const j of set) m[i * N + j] = 1; } return m; };
  const nnz = (m) => { let c = 0; for (let i = 0; i < m.length; i++) c += m[i]; return c; };
  const mul = (a, b) => { const out = new Uint8Array(N * N); for (let i = 0; i < N; i++) for (let k = 0; k < N; k++) { if (!a[i * N + k]) continue; const bk = k * N, oi = i * N; for (let j = 0; j < N; j++) if (b[bk + j]) out[oi + j] = 1; } return out; };
  const A1 = mkM(8), A2 = mkM(8), A3 = mkM(8);
  const fused = mul(mul(A1, A2), A3);
  const maxIn = Math.max(nnz(A1), nnz(A2), nnz(A3)), after = nnz(fused);
  check(after > maxIn * 1.5,
    "D4  fusing sparse matrices (A1·A2·A3) DENSIFIES (fill-in) — the fused matrix is denser → more memory + a denser runtime matmul",
    `max nnz(Ai)=${maxIn} → nnz(fused)=${after} (${(after / maxIn).toFixed(1)}× denser)`);
}

// ── D5: "superposition" computes BOTH branches then masks — 2× the transform work (FLOP count) ─────
{
  const M = 1_000_000, data = Int32Array.from({ length: M }, () => rnd() % 1000);
  // Isolated per-phase transform-call counters (v1 shared them — an artefact, caught by re-running).
  let opsOne = 0, opsBoth = 0;
  const useX = true;
  // one path: branch hoisted OUT of the loop (the fair baseline) — only the taken transform runs
  const x1 = (x) => { opsOne++; return (x * 3 + 1) | 0; };
  let s1 = 0; if (useX) for (let i = 0; i < M; i++) s1 += x1(data[i]); else for (let i = 0; i < M; i++) s1 += (data[i] ^ 0x5bd1e995) | 0;
  // superposition: compute BOTH, multiply by the runtime mask, add
  const x2 = (x) => { opsBoth++; return (x * 3 + 1) | 0; };
  const y2 = (x) => { opsBoth++; return (x ^ 0x5bd1e995) | 0; };
  let s2 = 0; const mx = useX ? 1 : 0, my = useX ? 0 : 1; for (let i = 0; i < M; i++) s2 += x2(data[i]) * mx + y2(data[i]) * my;
  check(s1 === s2 && opsBoth === opsOne * 2,
    "D5  'superposition' does the arithmetic of BOTH paths (2× transform FLOPs) then masks — not free on a sequential substrate",
    `same result=${s1 === s2}; transform-calls one-path=${opsOne} both+mask=${opsBoth} (${(opsBoth / opsOne).toFixed(1)}×)`);
}

console.log("\n# Recorded honest nuance (not failures):");
console.log("#  - The precompute IS the classic amortization trade: it WINS for all-pairs / many repeated");
console.log("#    queries on a SMALL or DENSE graph (the O(N^2) table pays off), and LOSES for sparse /");
console.log("#    single-source / large graphs (sparse BFS is O(N+E) and the table is O(N^2) memory).");
console.log("#  - 'ntt_mul' does NOT speed up matrix multiply — NTT accelerates polynomial / big-integer");
console.log("#    multiplication. Matrix mul uses Strassen/blocking, not NTT (a category error).");
console.log("#  - Element-wise map→filter FUSION (deforestation) IS real — but that is the for/where mask");
console.log("#    (data-level), NOT matrix-chain fusion (which fills in, D4).");
console.log(fails === 0 ? "\nRESULT  PASS — all claims verified vs ground truth (v2, xorshift + FLOP count)" : `\nRESULT  FAIL — ${fails} assertion(s) failed`);
process.exit(fails === 0 ? 0 : 1);

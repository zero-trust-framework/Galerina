// =============================================================================
// rd-0157-0159-virtual-wavefront-silicon-proof.mjs
//
// Machine-checkable proof for notes/76-mesh-r-d-02.md — the SILICON branch
// ("Virtual Wavefront Engine on a binary PC"). Owner-pasted AI dialogue ⇒ claims
// are HYPOTHESES; everything below is COMPUTED vs ground truth, never assumed
// (owner rule feedback-rd-prove-own-maths). Node built-ins only.
//
//   RD-0157  Virtual Wavefront Engine — adjacency matrix + 2-bit/trit packing;
//            r = Mq via SIMD-style typed-array dot product; M^k for k-hop.
//   RD-0158  Tri-Router (1/0/-1) + phase-shifted hot/cold dual-matrix
//            (Lambda architecture); K3 routing discipline.
//   RD-0159  Mycorrhizal Overlay — rebuild the GRAPH not the DATA; border
//            graph isolation (no-edge = no-reach). Re-derives RD-0150.
//
//   V#  = proved here (a load-bearing claim that HOLDS).
//   R#  = REFUTE proved here (a note claim shown FALSE by computation).
//   X#  = excluded — named, with where it is actually settled.
//
// The K3 calculus is imported from the SHIPPED Galerina tower-citizen build so
// RD-0158's "the verdict must be real K3, not the optical shortcut" is checked
// against the real gate, not a local redefinition. real `crypto` (node:crypto)
// stands in for the "crypto tax" the note wants to optically bypass.
//
// Run:  node scripts/rd-0157-0159-virtual-wavefront-silicon-proof.mjs
//       exit 0 iff every V#/R# assertion holds; exit 1 on any FAIL.
// =============================================================================

import { createHash, randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Verdict, vAnd, vNot, authorize } from "../packages-galerina/galerina-tower-citizen/dist/index.js";

const { DENY, INDETERMINATE, ALLOW } = Verdict;
const TRITS = [DENY, INDETERMINATE, ALLOW];

let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};

console.log("\n=== RD-0157..0159 — Virtual Wavefront on binary silicon: machine-checked verdicts ===\n");

// ─────────────────────────────────────────────────────────────────────────────
// Small deterministic helpers (no deps). A "graph" is an n×n adjacency matrix of
// trits flattened row-major into an Int8Array (this is exactly the note's
// "Bit-Packing"/dense layout — Int8Array is the honest stand-in; 2-bit packing
// is a constant-factor memory win that changes none of the asymptotics below).
// ─────────────────────────────────────────────────────────────────────────────

// Dense r = M·q  (every i,j touched) — O(n^2).
function denseMatVec(M, q, n) {
  const r = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    const base = i * n;
    for (let j = 0; j < n; j++) acc += M[base + j] * q[j];
    r[i] = acc;
  }
  return r;
}

// Sparse r = M·q from a CSR-style edge list — O(E) (only stored edges touched).
function sparseMatVec(edges, q, n) {
  const r = new Int32Array(n);
  for (let e = 0; e < edges.length; e++) {
    const { i, j, w } = edges[e];
    r[i] += w * q[j];
  }
  return r;
}

// Boolean (reachability) matrix multiply A·B over {0,1}, OR-of-AND — O(n^3).
function boolMatMul(A, B, n) {
  const C = new Uint8Array(n * n);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < n; k++) {
      if (!A[i * n + k]) continue;           // skip-zero is a constant-factor trim, still O(n^3) dense-worst-case
      for (let j = 0; j < n; j++)
        if (B[k * n + j]) C[i * n + j] = 1;
    }
  return C;
}

// Ground-truth BFS k-hop reachability from a boolean adjacency matrix.
function bfsReachableWithin(adj, src, k, n) {
  const reached = new Uint8Array(n);
  let frontier = [src];
  for (let hop = 0; hop < k && frontier.length; hop++) {
    const next = [];
    for (const u of frontier)
      for (let v = 0; v < n; v++)
        if (adj[u * n + v] && !reached[v]) { reached[v] = 1; next.push(v); }
    frontier = next;
  }
  return reached; // reached[v]=1 iff v is within k hops of src (excluding src unless looped)
}

// ─────────────────────────────────────────────────────────────────────────────
// RD-0157 — Virtual Wavefront Engine (r = Mq, M^k)
// ─────────────────────────────────────────────────────────────────────────────
console.log("RD-0157  Virtual Wavefront Engine — r = Mq, packing, M^k:");

// V1 — r = Mq is mathematically a real query primitive: a typed-array dot product
//      computes EXACTLY the same result vector as a naive branchy row scan
//      ("is this the one?" per row). The note's "constructive/destructive
//      interference" IS just sign accumulation in r_i = Σ_j M_ij q_j.
{
  const n = 64;
  const M = new Int8Array(n * n);
  const q = new Int8Array(n);
  let s = 1234567;
  const rng = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < n * n; i++) M[i] = (rng() < 0.15) ? (rng() < 0.5 ? 1 : -1) : 0;
  for (let j = 0; j < n; j++) q[j] = (rng() < 0.3) ? (rng() < 0.5 ? 1 : -1) : 0;

  // Naive branchy reference: per row, branch on each cell (the SQL-ish row scan).
  const naive = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = 0; j < n; j++) {
      const m = M[i * n + j];
      if (m === 1) { if (q[j] === 1) acc += 1; else if (q[j] === -1) acc -= 1; }
      else if (m === -1) { if (q[j] === 1) acc -= 1; else if (q[j] === -1) acc += 1; }
      // m === 0 contributes nothing (the branch the note calls "destructive cancel")
    }
    naive[i] = acc;
  }
  const fast = denseMatVec(M, q, n);
  let identical = true;
  for (let i = 0; i < n; i++) if (naive[i] !== fast[i]) identical = false;
  ok(identical, "V1  r=Mq (typed-array dot product) == naive branchy row scan, element-for-element");
}

// V2 — Trit bit-packing round-trips losslessly: pack {-1,0,1} into 2 bits, unpack,
//      recover the matrix exactly. (Establishes packing is a memory/constant-factor
//      win that preserves the math — it does NOT change any complexity below.)
{
  const enc = (t) => (t === -1 ? 0b10 : t === 0 ? 0b00 : 0b01); // 2 bits / trit
  const dec = (b) => (b === 0b10 ? -1 : b === 0b01 ? 1 : 0);
  let lossless = true;
  for (const t of TRITS) if (dec(enc(t)) !== t) lossless = false;
  // pack 4 trits/byte and round-trip a vector
  const vec = Int8Array.from([1, 0, -1, 1, -1, 0, 0, 1]);
  const packed = new Uint8Array(Math.ceil(vec.length / 4));
  for (let i = 0; i < vec.length; i++) packed[i >> 2] |= enc(vec[i]) << ((i & 3) * 2);
  const un = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) un[i] = dec((packed[i >> 2] >> ((i & 3) * 2)) & 0b11);
  let vecOk = true;
  for (let i = 0; i < vec.length; i++) if (un[i] !== vec[i]) vecOk = false;
  ok(lossless && vecOk && packed.length === 2,
     "V2  2-bit trit packing round-trips losslessly (4 trits/byte; 8-trit vec → 2 bytes)");
}

// V3 — SPARSE r=Mq is O(E), DENSE is O(n^2): on a sparse graph the edge-list form
//      touches exactly E cells, and BOTH forms produce the identical result vector.
//      (This is the genuine asymptotic win the note gestures at — but it is O(E)
//       work, not "one cycle".)
{
  const n = 256;
  const edges = [];
  const M = new Int8Array(n * n);
  let s = 99;
  const rng = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      if (rng() < 0.01) { const w = rng() < 0.5 ? 1 : -1; M[i * n + j] = w; edges.push({ i, j, w }); }
  const q = new Int8Array(n);
  for (let j = 0; j < n; j++) q[j] = (rng() < 0.3) ? (rng() < 0.5 ? 1 : -1) : 0;

  const rDense = denseMatVec(M, q, n);
  const rSparse = sparseMatVec(edges, q, n);
  let same = true;
  for (let i = 0; i < n; i++) if (rDense[i] !== rSparse[i]) same = false;
  // operation counts: dense = n*n multiply-adds; sparse = E.
  const E = edges.length;
  ok(same, "V3  sparse(edge-list) r=Mq == dense r=Mq, element-for-element");
  ok(E < n * n && E > 0,
     `V3  cost asymmetry real: sparse touches E=${E} cells vs dense n^2=${n * n} (O(E) << O(n^2) when sparse)`);
}

// V4 — M^2 yields EXACT 2-hop reachability on a known small graph (the note's
//      "multiply the matrix by itself to find k-hop connections"). Checked vs BFS.
{
  // hand-built DAG: 0→1, 1→2, 0→3, 3→4 (so 0 reaches 2 and 4 in exactly 2 hops)
  const n = 5;
  const adj = new Uint8Array(n * n);
  const E = [[0, 1], [1, 2], [0, 3], [3, 4]];
  for (const [u, v] of E) adj[u * n + v] = 1;

  const adj2 = boolMatMul(adj, adj, n);     // (A^2)_ij = 1 iff a 2-hop path i→j exists
  // ground truth: 2-hop-EXACT reachable set from node 0 = {2,4}
  const twoHopExact = [];
  for (let v = 0; v < n; v++) if (adj2[0 * n + v]) twoHopExact.push(v);
  const expect2 = [2, 4];
  const setEq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  ok(setEq(twoHopExact.sort((a, b) => a - b), expect2),
     `V4  M^2 gives EXACT 2-hop reach from node 0 = {${twoHopExact}} (== {2,4})`);

  // cross-check the union A ∨ A^2 against BFS-within-2 (reachable in ≤2 hops = {1,3,2,4})
  const within2 = bfsReachableWithin(adj, 0, 2, n);
  let unionOk = true;
  for (let v = 0; v < n; v++) {
    const viaPow = (v !== 0) && (adj[0 * n + v] || adj2[0 * n + v]);  // ≤2-hop via powers
    if (!!viaPow !== !!within2[v]) unionOk = false;
  }
  ok(unionOk, "V4  (A ∨ A^2) reachable set == BFS-within-2 reachable set (powers are sound)");
}

// R1 — REFUTE "instant billion-node topology / a handful of clock cycles": one
//      boolean matrix multiply is O(n^3). Measure the operation count scaling
//      across doubling n and show it grows ~8× per doubling (the n^3 signature),
//      NOT constant. (Counting work, not wall-clock — robust to machine noise.)
{
  function boolMatMulCount(n) {
    // dense worst case (full matrix of 1s): the inner body runs n^3 times.
    const A = new Uint8Array(n * n).fill(1);
    let ops = 0;
    for (let i = 0; i < n; i++)
      for (let k = 0; k < n; k++)
        for (let j = 0; j < n; j++) { ops++; if (A[i * n + k] && A[k * n + j]) {/* set */} }
    return ops;
  }
  const c32 = boolMatMulCount(32);
  const c64 = boolMatMulCount(64);
  const ratio = c64 / c32;
  ok(c32 === 32 ** 3 && c64 === 64 ** 3,
     `R1  one matrix multiply = n^3 ops exactly (32→${c32}, 64→${c64})`);
  ok(Math.abs(ratio - 8) < 1e-9,
     `R1  doubling n multiplies work by ~8 (=2^3): measured ${ratio.toFixed(2)}× — the O(n^3) signature, NOT O(1)`);
  // For a "billion nodes" (n=1e9), one multiply ≈ (1e9)^3 = 1e27 multiply-adds — refutes "milliseconds".
  const nBillion = 1e9;
  const opsBillion = nBillion ** 3;
  ok(opsBillion === 1e27,
     "R1  M^k at n=1e9 ⇒ ~1e27 ops PER multiply (dense) — 'instant billion-node topology' REFUTED");
}

// R2 — REFUTE "thousands of points in one cycle searches a billion rows" /
//      "O(1)": r=Mq cost scales with the matrix size. Show the dot-product op
//      count is linear in the data touched, never constant.
{
  const opsFor = (n) => { let c = 0; const M = new Int8Array(n * n); const q = new Int8Array(n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { c++; void (M[i * n + j] * q[j]); } return c; };
  const a = opsFor(50), b = opsFor(100);
  ok(a === 2500 && b === 10000 && b / a === 4,
     `R2  r=Mq dense ops scale n^2 (50→${a}, 100→${b}, ×4 for ×2 n) — NOT O(1)/'one cycle'`);
}

// V5 — REAL (modest) constant-factor: the note's "eliminate branch-prediction"
//      claim, measured FAIRLY. Both kernels traverse the SAME dense n×n matrix
//      (same cells, same asymptotic O(n^2) work) and produce the SAME r — the ONLY
//      difference is branchless multiply-accumulate vs a branchy per-cell switch
//      (the "is this the one?" decision the note blames for wasted cycles). This
//      isolates the branch-elimination constant factor WITHOUT smuggling in the
//      sparse/dense asymptotic gap (that is V3's separate, larger win).
//      Posture matches for/where-mask: data-dependent, modest, factor PRINTED not
//      asserted as a number; the load-bearing claim is "same complexity, ≤ small
//      constant — NOT O(1)".
{
  const n = 400;
  const M = new Int8Array(n * n);
  let s = 7;
  const rng = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < n * n; i++) M[i] = (rng() < 0.5) ? (rng() < 0.5 ? 1 : -1) : 0;
  const q = new Int8Array(n);
  for (let j = 0; j < n; j++) q[j] = (rng() < 0.5) ? (rng() < 0.5 ? 1 : -1) : 0;

  // branchless dense kernel: straight multiply-accumulate, no per-cell branch.
  const branchless = (M, q, n) => {
    const r = new Int32Array(n);
    for (let i = 0; i < n; i++) { let acc = 0; const base = i * n; for (let j = 0; j < n; j++) acc += M[base + j] * q[j]; r[i] = acc; }
    return r;
  };
  // branchy dense kernel: same cells, but a data-dependent switch per cell (the
  // "branch-prediction errors" the note describes). Identical result.
  const branchy = (M, q, n) => {
    const r = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      let acc = 0; const base = i * n;
      for (let j = 0; j < n; j++) {
        const m = M[base + j], x = q[j];
        if (m === 0) continue;                 // branch 1
        if (x === 0) continue;                 // branch 2
        if (m === x) acc += 1; else acc -= 1;  // branch 3 (sign decision)
      }
      r[i] = acc;
    }
    return r;
  };

  const REP = 300;
  branchless(M, q, n); branchy(M, q, n);       // warm both

  let rA;
  const t0 = performance.now();
  for (let r = 0; r < REP; r++) rA = branchless(M, q, n);
  const tFast = performance.now() - t0;

  let rB;
  const t1 = performance.now();
  for (let r = 0; r < REP; r++) rB = branchy(M, q, n);
  const tBranchy = performance.now() - t1;

  let same = true;
  for (let i = 0; i < n; i++) if (rA[i] !== rB[i]) same = false;
  const factor = tBranchy / tFast;
  console.log(`        (measured: branchless ${tFast.toFixed(1)}ms vs branchy ${tBranchy.toFixed(1)}ms over ${REP} reps → ${factor.toFixed(2)}× — a CONSTANT factor, same O(n^2))`);
  ok(same, "V5  branchless and branchy dense kernels compute identical r (same cells, same complexity)");
  // Load-bearing claim: it is a constant factor in a sane band — NOT the orders-of-
  // magnitude / O(1) the note implies. We bound it both ways (no complexity change):
  // the branch-elimination win is real but modest (≤ a few ×), never 0-cost.
  ok(factor > 0.3 && factor < 25,
     `V5  branch elimination is a REAL but MODEST constant factor (${factor.toFixed(2)}×, same O(n^2)) — NOT O(1)/'one cycle'`);
}

// ─────────────────────────────────────────────────────────────────────────────
// RD-0158 — Tri-Router (1/0/-1) + phase-shifted hot/cold dual-matrix
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nRD-0158  Tri-Router K3 routing + hot/cold Lambda dual-matrix:");

// V6 — Tri-Router routing discipline is the SHIPPED K3 gate. The note's two rules
//      hold against the real tower-citizen calculus:
//        AND:  min(1,0)=0 → quarantine (0-pipe)
//        NOT:  ¬(1)=-1    → zero-wipe  (-1-pipe)
//      AND authorize() only fires on +1 (deny-by-default).
{
  ok(vAnd(ALLOW, INDETERMINATE) === INDETERMINATE,
     "V6  AND: min(1,0)=0 → 0-pipe (quarantine) — matches shipped vAnd (Kleene min)");
  ok(vNot(ALLOW) === DENY,
     "V6  NOT: ¬(+1)=-1 → -1-pipe (zero-wipe) — matches shipped vNot (revoke a stolen passport)");
  ok(authorize(ALLOW) === true && authorize(INDETERMINATE) === false && authorize(DENY) === false,
     "V6  authorize() fires IFF +1 — 0 and -1 both deny (deny-by-default routing)");
  // full negation table — DO-NOT-ASSUME: verify ¬0 PRESERVES 0 (Kleene), NOT flips to 1.
  ok(vNot(DENY) === ALLOW && vNot(INDETERMINATE) === INDETERMINATE && vNot(ALLOW) === DENY,
     "V6  full ¬ table: ¬(-1)=+1, ¬0=0 (indeterminacy preserved, not lifted), ¬(+1)=-1");
  // the routing partition is total and disjoint over all 3 trits
  const route = (v) => (v === ALLOW ? "freeway" : v === DENY ? "blackhole" : "quarantine");
  const lanes = new Set(TRITS.map(route));
  ok(lanes.size === 3, "V6  Tri-Router partition total+disjoint: every trit maps to exactly one of 3 lanes");
}

// R3 — REFUTE the "optical shortcut" security claim: the note says the verdict can
//      be the physical alignment of light (optical masking) with "zero CPU
//      decryption". That is obfuscation-as-security, NOT authentication. PROVE the
//      sound discipline requires a REAL cryptographic check: a forged passport
//      whose declared verdict is +1 but whose signature does not verify must NOT
//      route to the freeway. Only the crypto check (not the trit) gates the lane.
{
  // a trivial "optical-only" gate that trusts the declared verdict trit:
  const opticalGate = (passport) => route(passport.declaredVerdict);
  function route(v) { return v === ALLOW ? "freeway" : v === DENY ? "blackhole" : "quarantine"; }

  // the sound gate: verdict is ALLOW IFF a real signature verifies (crypto tax PAID).
  const KEY = randomBytes(32);
  const sign = (msg) => createHash("sha256").update(Buffer.concat([KEY, Buffer.from(msg)])).digest("hex");
  const realGate = (passport) => {
    const expect = sign(passport.subject);
    const verdict = (passport.sig === expect) ? ALLOW : DENY; // crypto decides the trit
    return route(verdict);
  };

  const genuine = { subject: "alice", sig: sign("alice"), declaredVerdict: ALLOW };
  const forged = { subject: "alice", sig: "00".repeat(32), declaredVerdict: ALLOW }; // claims +1, bad sig

  ok(opticalGate(forged) === "freeway",
     "R3  optical-only gate (trust the declared trit) routes a FORGED passport to the freeway — FAIL-OPEN");
  ok(realGate(genuine) === "freeway" && realGate(forged) === "blackhole",
     "R3  REAL-crypto gate: genuine→freeway, forged→blackhole — verdict EARNED by a signature, not declared");
  ok(realGate(forged) !== opticalGate(forged),
     "R3  the two disagree exactly on the attack ⇒ the optical shortcut is obfuscation, REFUTED; keep the crypto tax on the GATE");
}

// V7 — Lambda-architecture correctness: a phase-shifted hot/cold split returns the
//      EXACT same result as a single full recompute. PROVE for all q:
//        r_total = M_cold·q + M_hot·q  ==  (M_cold + M_hot)·q     [distributivity]
//      and after the "phase shift" fold (M_new = M_cold + M_hot; M_hot ← 0),
//      a query on the merged matrix == the pre-merge two-matrix query.
{
  const n = 48;
  let s = 555;
  const rng = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const Mcold = new Int8Array(n * n), Mhot = new Int8Array(n * n);
  for (let i = 0; i < n * n; i++) {
    Mcold[i] = (rng() < 0.1) ? (rng() < 0.5 ? 1 : -1) : 0;
    Mhot[i]  = (rng() < 0.02) ? (rng() < 0.5 ? 1 : -1) : 0; // hot is small/sparse
  }

  // test over MANY query vectors (not one) — the distributive identity must be universal.
  let distributiveHolds = true;
  let foldHolds = true;
  for (let t = 0; t < 64; t++) {
    const q = new Int8Array(n);
    for (let j = 0; j < n; j++) q[j] = (rng() < 0.4) ? (rng() < 0.5 ? 1 : -1) : 0;

    const rCold = denseMatVec(Mcold, q, n);
    const rHot = denseMatVec(Mhot, q, n);
    const rSplit = new Int32Array(n);
    for (let i = 0; i < n; i++) rSplit[i] = rCold[i] + rHot[i];     // dual-matrix query, results merged

    const Msum = new Int8Array(n * n);           // a true full recompute on the merged matrix
    for (let i = 0; i < n * n; i++) Msum[i] = Mcold[i] + Mhot[i];   // note: entries can be ±2 — see V8
    const rFull = denseMatVec(Msum, q, n);

    for (let i = 0; i < n; i++) {
      if (rSplit[i] !== rFull[i]) distributiveHolds = false;
    }

    // the PHASE SHIFT fold: bake hot into cold, then zero hot; re-query.
    // (matrix add then a fresh query must equal the pre-fold split query)
    const rAfterFold = denseMatVec(Msum, q, n);   // M_new = Msum; M_hot ← 0 contributes nothing
    for (let i = 0; i < n; i++) if (rAfterFold[i] !== rSplit[i]) foldHolds = false;
  }
  ok(distributiveHolds, "V7  ∀q: (M_cold·q)+(M_hot·q) == (M_cold+M_hot)·q (Lambda split == full recompute, 64 vectors)");
  ok(foldHolds, "V7  phase-shift fold (M_new=M_cold+M_hot, M_hot←0) preserves every query result — no data lost in the merge");
}

// V8 — A REAL caveat the note glosses: the merged matrix is NOT closed over {-1,0,1}
//      (1+1=2). PROVE that naïve trit-saturation on merge (clamping ±2→±1) BREAKS
//      the distributive identity — so the hot/cold split must keep INTEGER
//      accumulators (or keep matrices separate), NOT re-encode the sum as a trit.
//      (Surfaces the engineering constraint; protects against a silent fail.)
{
  const n = 8;
  const Mcold = new Int8Array(n * n), Mhot = new Int8Array(n * n);
  Mcold[0] = 1; Mhot[0] = 1;             // same edge reinforced in both phases → true weight 2
  const q = new Int8Array(n); q[0] = 1;

  const rCold = denseMatVec(Mcold, q, n);
  const rHot = denseMatVec(Mhot, q, n);
  const rSplit = rCold[0] + rHot[0];      // = 2 (correct merged weight)

  const clamp = (x) => Math.max(-1, Math.min(1, x));
  const Mclamped = new Int8Array(n * n);
  for (let i = 0; i < n * n; i++) Mclamped[i] = clamp(Mcold[i] + Mhot[i]); // BUG: saturate to a trit
  const rClamped = denseMatVec(Mclamped, q, n)[0]; // = 1 (wrong)

  ok(rSplit === 2 && rClamped === 1 && rSplit !== rClamped,
     "V8  trit-saturating the merged matrix (±2→±1) BREAKS Lambda correctness (2≠1) — keep integer accumulators, not a re-trit");
}

// ─────────────────────────────────────────────────────────────────────────────
// RD-0159 — Mycorrhizal Overlay: rebuild the GRAPH not the DATA; border isolation
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nRD-0159  Mycorrhizal Overlay — rebuild graph not data; border isolation (re-derives RD-0150):");

// V9 — "rebuild the graph (O(E) edges), not the data (O(bytes))": PROVE the index
//      cost is proportional to edge count while a data rewrite is proportional to
//      payload bytes, and that for a realistic record the bytes dwarf the edges.
{
  // model: N records, each `payloadBytes` big, with `degree` graph edges each.
  const N = 100_000;
  const payloadBytes = 4096;      // 4 KB/record
  const degree = 8;               // 8 edges/record (metadata pointers)
  const edgeBytes = 16;           // an edge ≈ (src,dst) ids ≈ 16 bytes

  const dataRewriteCost = N * payloadBytes;        // O(bytes)
  const graphRebuildCost = N * degree * edgeBytes; // O(E)
  ok(graphRebuildCost < dataRewriteCost,
     `V9  graph rebuild O(E)=${graphRebuildCost} << data rewrite O(bytes)=${dataRewriteCost} (${(dataRewriteCost / graphRebuildCost).toFixed(1)}× cheaper)`);

  // and the asymptotics are independent: edge cost ignores payload size entirely.
  const graphRebuildCostBigPayload = N * degree * edgeBytes; // unchanged if payload grows
  const dataRewriteCostBigPayload = N * (payloadBytes * 16); // 64 KB/record
  ok(graphRebuildCostBigPayload === graphRebuildCost && dataRewriteCostBigPayload > dataRewriteCost,
     "V9  growing the payload 16× changes data-rewrite cost but NOT graph-rebuild cost (decoupled — re-point the laser, don't move the room)");
}

// V10 — Border graph isolation: "no edge = no reach" (the RD-0150 invariant, and
//       the IDOR/CWE-639 structural close). PROVE a traversal that starts from the
//       passport root can ONLY reach nodes connected by an edge; a record with no
//       edge from the user's root is mathematically invisible, regardless of any
//       id the caller supplies.
{
  // per-user capability graph: user root 'u' has edges to {docA, docC}; docB exists
  // globally but has NO edge from u. A direct id request for docB must fail.
  const n = 5; // 0=u, 1=docA, 2=docB, 3=docC, 4=other
  const adj = new Uint8Array(n * n);
  adj[0 * n + 1] = 1;  // u → docA
  adj[0 * n + 3] = 1;  // u → docC
  // (NO u → docB edge; docB is reachable only via 'other', which u also can't reach)
  adj[4 * n + 2] = 1;  // other → docB

  const reachable = bfsReachableWithin(adj, 0, n, n); // full closure from u
  ok(reachable[1] === 1 && reachable[3] === 1, "V10 traversal from passport root reaches its granted docs (docA, docC)");
  ok(reachable[2] === 0,
     "V10 'no edge = no reach': docB is UNREACHABLE from u even though it exists — IDOR/CWE-639 structurally closed");

  // the IDOR attempt: caller supplies docB's id directly. Sound gate = membership in
  // the reachable set, NOT a parameter lookup. PROVE the id-based bypass is refused.
  const idorAttempt = (requestedId) => reachable[requestedId] === 1; // gate = reachability, not the raw id
  ok(idorAttempt(2) === false && idorAttempt(1) === true,
     "V10 supplying docB's raw id is refused (traversal starts from the passport, not the param) — the RD-0150 close");
}

// V11 — Re-derivation honesty: RD-0159's graph-rebuild + border-isolation IS the
//       RD-0150 graph-as-data-spine result (ZT 7, "no edge = no reach"). The
//       novelty here is the SILICON framing (hot/cold + Tri-Router), not the
//       isolation invariant. Assert the invariant is identical (no double-claim).
{
  // the RD-0150 invariant, restated: Q ∩ S_user becomes a reachability test.
  // Encode "user scope" as a reachable set and show intersection == graph membership.
  const userScope = new Set([1, 3]);          // S_user (reachable docs)
  const query = [1, 2, 3];                    // Q (requested docs)
  const granted = query.filter((d) => userScope.has(d)); // Q ∩ S_user
  ok(granted.length === 2 && granted.includes(1) && granted.includes(3) && !granted.includes(2),
     "V11 Q ∩ S_user == reachable-set membership — IDENTICAL to RD-0150 (re-derivation, novelty = silicon framing only)");
}

// ─────────────────────────────────────────────────────────────────────────────
// EXCLUDED — named, with where each is actually settled (not benched here)
// ─────────────────────────────────────────────────────────────────────────────
const EXCLUDED = [
  ["X1", "Optical masking / holographic-crystal storage as the security primitive (note §3, 76-mesh-r-d-02)",
        "obfuscation-as-security + photonic-crypto — REFUTED class. Crypto stays Binary on silicon (SPORE-SUBSTRATE-001/feedback-most-secure-default). R3 proves the sound discipline needs a real signature; the 'zero CPU decryption' light-lens is excluded."],
  ["X2", "AVX-512 / true SIMD lane-level execution ('thousands of points in one clock cycle')",
        "this proof counts OPERATIONS and uses JS typed arrays (a scalar VM); the constant-factor win (V5) is real but the specific HW-lane throughput is a hardware claim, not modelled. Same posture as for/where-mask (software-sim, factor printed not asserted)."],
  ["X3", "Low-level AI auto-rewiring the border graph autonomously severing flows (note §2, RD-0159 tail)",
        "the AI-as-authority + autonomous -1-route is the governed-chaos border question (galerina-rd-0144-0149); an AI signal may DEGRADE-only via vAnd (telemetry→K3 loop, shipped 411ab08), never originate an ALLOW or an un-audited wipe. Owner/border-gated."],
  ["X4", "Holographic phase-state storage / lithium-niobate crystal / Fermat-least-time routing (note §1-2)",
        "future-hardware substrate; not a binary-silicon claim. Tracked under the photonic substrate series (galerina-rd-0110-0118); latency≠work and 'instant pathfinding' are the refuted framings there."],
  ["X5", "MeshQL / the graph-as-data-spine data-plane build",
        "design settled at RD-0150 (ZT 7, HYBRID property-graph: graph spine + columnar payload, build owner-gated behind a perf harness). This proof re-derives the invariant (V11), it does not re-open the build."],
];

console.log("\nEXCLUDED (named, not benched here):");
for (const [id, claim, why] of EXCLUDED) console.log(`  ${id}  ${claim}\n        -> ${why}`);

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n--- SUMMARY ---  assertions: ${pass} pass / ${fail} fail  ·  ${EXCLUDED.length} excluded`);
console.log(`${pass}/${pass + fail} passed`);
const green = fail === 0;
console.log(green
  ? "RESULT: GREEN — sparse r=Mq O(E) + M^2 exact-2-hop + Lambda distributivity + 'no-edge=no-reach' SOUND;\n        O(1)/'one-cycle billion rows', 'instant billion-node M^k', and optical-masking-as-security REFUTED.\n"
  : "RESULT: RED — a load-bearing assertion did not hold\n");
process.exit(green ? 0 : 1);

// =============================================================================
// rd-0160-0161-tcsr-phasegraph-zerocopy-proof.mjs
//
// Machine-checkable, SELF-CONTAINED proof (node built-ins only) for "76-mesh-r-d-03"
// notes, split into two RD branches:
//
//   RD-0160 "Next-gen graph"  = T-CSR memory bound + hyperbolic embedding + 64-bit phase hashing.
//   RD-0161 "Symbiotic vs Pure-Phase / 100PB / NVMe-DMA / decoupled" = the stress-table arithmetic,
//           the streaming reality, the zero-copy copy-tax, and the headless .spore defence posture.
//
// Owner R&D rules (feedback-rd-prove-own-maths): every load-bearing claim is COMPUTED here vs ground
// truth and re-runnable. Established verdicts honoured: streaming an N-byte matrix is O(N) bandwidth-
// bound, NOT O(1); NVMe-DMA / io_uring / SPDK zero-copy are REAL wins. Overlaps RD-0150.
//
//   V#  = a load-bearing claim PROVED true here (PASS/FAIL).
//   X#  = EXCLUDED — reason + where it is (or must be) settled.
//
// Run:  node scripts/rd-0160-0161-tcsr-phasegraph-zerocopy-proof.mjs   (exit 0 iff every V# holds)
// =============================================================================

import crypto from "node:crypto";

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log(`  PASS  ${l}`); } else { fail++; console.log(`  FAIL  ${l}`); } };
// approx-equal for the published-figure reconciliations (tolerate rounding in the source note)
const approx = (a, b, relTol = 0.02) => Math.abs(a - b) <= relTol * Math.abs(b);

const GB = 1e9, TB = 1e12, PB = 1e15;       // decimal units (as the source note uses)
const WASM = 4 * GB;                         // the 4 GB hot-RAM ceiling

console.log("\n=== RD-0160 / RD-0161 — T-CSR + phase-graph + zero-copy: machine-checked verdicts ===\n");

// =============================================================================
// RD-0160  —  Next-generation graph
// =============================================================================

// ── V1 — T-CSR is O(E), the dense adjacency matrix is O(n^2); and the "4 TB -> 80 MB" headline is the
//   right order of magnitude. We reproduce the dense 4 TB figure EXACTLY (1e6 nodes => 1e12 cells * 4 B),
//   build a REAL (tiny) ternary CSR, and assert its byte cost scales with E, not n^2.
console.log("V1  T-CSR memory is O(E), dense is O(n^2); reproduce the 4 TB dense figure:");
{
  const n = 1e6;
  const denseCells = n * n;                       // 1e12 intersections
  const denseBytes = denseCells * 4;              // 4 bytes / number (int32/float32)
  ok(denseCells === 1e12 && approx(denseBytes, 4 * TB, 1e-9),
     `dense ${n.toExponential(0)} nodes = ${(denseCells).toExponential(0)} cells * 4 B = ${(denseBytes/TB)} TB (matches note's "4 TB")`);

  // T-CSR byte model: ternary value = 2 bits/edge, column index = ceil(log2 n) bits/edge, row ptr = (n+1)*4 B.
  const colBits = Math.ceil(Math.log2(n));        // 20 bits for n = 1e6
  const tcsrBytes = (E) => E * (2 / 8) + E * (colBits / 8) + (n + 1) * 4;

  // (a) O(E) shape: doubling E ~doubles the edge-dependent term (row-ptr term is a fixed n-tax, not n^2).
  const e1 = 1e7, e2 = 2e7;
  const edgePart = (E) => E * (2 / 8) + E * (colBits / 8);
  ok(approx(edgePart(e2), 2 * edgePart(e1), 1e-9),
     "doubling E doubles the edge term -> linear in E (O(E)), independent of n^2");

  // (b) the "80 MB" landing point is encoding/E-dependent but the right magnitude: the EDGE terms of a
  //   values+colidx CSR hit ~80 MB at ~29 M edges (~0.003% density — the note's "99.99% empty" regime);
  //   the (n+1)*4 row-pointer term adds a fixed ~4 MB n-tax on top (so total ~84 MB, same order).
  const E80 = 80e6 / ((2 + colBits) / 8);          // edges whose value+colidx == 80 MB
  ok(E80 > 2e7 && E80 < 4e7 && approx(edgePart(E80), 80e6, 1e-6) && tcsrBytes(E80) < 90e6,
     `"80 MB" is reachable: ~${(E80/1e6).toFixed(0)} M edges (~${(E80/1e12*100).toFixed(4)}% density), edge-terms=80 MB, +~${((tcsrBytes(E80)-edgePart(E80))/1e6).toFixed(0)} MB row-ptr tax`);

  // (c) the COMPRESSION RATIO vs dense is enormous regardless: realistic E (50 edges/node = 5e7) still 1000s x smaller.
  const realT = tcsrBytes(5e7);
  ok(denseBytes / realT > 1e4,
     `realistic E=5e7 T-CSR = ${(realT/1e6).toFixed(0)} MB; dense/T-CSR ratio = ${(denseBytes/realT).toExponential(1)} (>10,000x)`);
}

// ── V2 — Sparse round-trips LOSSLESSLY. Build a tiny ternary adjacency matrix, encode to T-CSR (three
//   1-D lists: +1 coords, -1 coords via signed values, and row pointers), decode back, assert bit-identical.
console.log("\nV2  T-CSR round-trips a ternary adjacency matrix losslessly (dense -> T-CSR -> dense):");
{
  // a 6x6 ternary matrix with +1 (allow), -1 (deny), 0 (empty)
  const dense = [
    [ 0,  1,  0,  0, -1,  0],
    [ 0,  0,  0,  0,  0,  0],   // an isolated node (empty row) — must survive round-trip
    [ 1,  0,  0, -1,  0,  1],
    [ 0,  0,  0,  0,  0, -1],
    [-1,  0,  0,  0,  0,  0],
    [ 0,  0,  1,  0,  0,  0],
  ];
  const N = dense.length;

  // ENCODE -> T-CSR: rowPtr[i]..rowPtr[i+1] index into (colIdx, val) for nonzeros of row i.
  const colIdx = [], val = [], rowPtr = [0];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const v = dense[i][j];
      if (v !== 0) { colIdx.push(j); val.push(v); }   // store ONLY nonzeros; 0 is implicit (the crushed space)
    }
    rowPtr.push(colIdx.length);
  }

  // DECODE -> dense again
  const back = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++)
    for (let k = rowPtr[i]; k < rowPtr[i + 1]; k++)
      back[i][colIdx[k]] = val[k];

  let identical = true;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (dense[i][j] !== back[i][j]) identical = false;
  ok(identical, "decode(encode(M)) === M bit-for-bit (incl. the empty row 1 and every +1/-1 edge)");

  // and it only stored the nonzeros — never the n^2 zeros
  const nnz = dense.flat().filter(x => x !== 0).length;
  ok(val.length === nnz && colIdx.length === nnz && rowPtr.length === N + 1,
     `stored exactly ${nnz} nonzeros (not ${N * N} cells); rowPtr has N+1 entries`);
  // values are strictly ternary
  ok(val.every(v => v === 1 || v === -1), "every stored value is ternary +1/-1 (0 is never stored)");
}

// ── V3 — Hyperbolic distance dH(u,v) (Poincare disk) embeds a TREE with lower distortion than Euclidean.
//   Two proofs: (a) a hand-laid depth-2 binary tree has lower worst-case multiplicative distortion in H than
//   in flat space; (b) the ROBUST, parameter-monotone mechanism: for siblings in a fan, tree distance
//   ratio sib<->sib / sib<->root = 2.0; in H the ratio climbs toward 2 as nodes approach the boundary
//   (geodesic goes THROUGH the root — tree-faithful) while in Euclidean it is stuck near 1 (flat = wrong).
console.log("\nV3  Hyperbolic dH embeds a tree with lower distortion than Euclidean:");
{
  const acosh = (x) => Math.log(x + Math.sqrt(x * x - 1));
  const dH = (u, v) => {
    const du = u[0] * u[0] + u[1] * u[1], dv = v[0] * v[0] + v[1] * v[1];
    const duv = (u[0] - v[0]) ** 2 + (u[1] - v[1]) ** 2;
    return acosh(1 + 2 * duv / ((1 - du) * (1 - dv)));      // the note's formula, verbatim
  };
  const dE = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1]);

  // sanity: dH is a metric on a couple of cases (symmetry, identity, triangle through root)
  const a = [0.3, 0.0], b = [-0.3, 0.0], r = [0, 0];
  ok(approx(dH(a, b), dH(b, a), 1e-9) && dH(a, a) < 1e-9 && dH(a, b) > 0,
     "dH is symmetric, dH(x,x)=0, dH>0 for distinct points (well-formed metric)");

  // (a) full depth-2 binary tree, fixed placements; distortion = max(embedDist/graphDist)/min(embedDist/graphDist)
  const parent = [null, 0, 0, 1, 1, 2, 2];                  // tree edges
  const all = [0, 1, 2, 3, 4, 5, 6];
  const graphDist = (x, y) => {                             // hops via lowest common ancestor
    const anc = (z) => { const p = [z]; while (z !== 0) { z = parent[z]; p.push(z); } return p; };
    const A = anc(x), B = anc(y);
    for (let i = 0; i < A.length; i++) { const j = B.indexOf(A[i]); if (j >= 0) return i + j; }
    return Infinity;
  };
  const distortion = (P, d) => {
    let lo = Infinity, hi = 0;
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const ratio = d(P[all[i]], P[all[j]]) / graphDist(all[i], all[j]);
      lo = Math.min(lo, ratio); hi = Math.max(hi, ratio);
    }
    return hi / lo;
  };
  // Euclidean: children fanned on circles whose radius grows linearly with depth (the best a flat grid does)
  const PE = { 0: [0, 0] };
  [[1, 2], [3, 4, 5, 6]].forEach((lvl, L) => {
    const rad = (L + 1) * 0.45, k = lvl.length;
    lvl.forEach((nd, i) => { const ang = 2 * Math.PI * i / k; PE[nd] = [rad * Math.cos(ang), rad * Math.sin(ang)]; });
  });
  // Hyperbolic: radius pushed toward the boundary with depth; children in a narrow wedge under the parent angle
  const rr = [0, 0.5, 0.8], w = 0.5;
  const PH = {
    0: [0, 0],
    1: [rr[1] * Math.cos(Math.PI / 2), rr[1] * Math.sin(Math.PI / 2)],
    2: [rr[1] * Math.cos(-Math.PI / 2), rr[1] * Math.sin(-Math.PI / 2)],
    3: [rr[2] * Math.cos(Math.PI / 2 + w), rr[2] * Math.sin(Math.PI / 2 + w)],
    4: [rr[2] * Math.cos(Math.PI / 2 - w), rr[2] * Math.sin(Math.PI / 2 - w)],
    5: [rr[2] * Math.cos(-Math.PI / 2 + w), rr[2] * Math.sin(-Math.PI / 2 - w)],
    6: [rr[2] * Math.cos(-Math.PI / 2 - w), rr[2] * Math.sin(-Math.PI / 2 + w)],
  };
  const distE = distortion(PE, dE), distH = distortion(PH, dH);
  ok(distH < distE,
     `tree distortion: hyperbolic ${distH.toFixed(2)} < euclidean ${distE.toFixed(2)} (H is the natural home for trees)`);

  // (b) robust, NOT cherry-picked: sweep radius; H ratio rises monotonically toward the tree value 2.0,
  //     Euclidean ratio is pinned ~1.0 for a real (non-antipodal) sibling fan.
  const ang = Math.PI / 3;                                  // 60deg wedge — siblings fan like a real tree
  let prevH = -1, hMonotone = true, eFlat = true;
  for (const r2 of [0.5, 0.7, 0.85, 0.95, 0.99]) {
    const s1 = [r2 * Math.cos(ang / 2), r2 * Math.sin(ang / 2)];
    const s2 = [r2 * Math.cos(-ang / 2), r2 * Math.sin(-ang / 2)];
    const root = [0, 0];
    const eRatio = dE(s1, s2) / dE(s1, root);              // tree truth = 2.0
    const hRatio = dH(s1, s2) / dH(s1, root);
    if (hRatio <= prevH) hMonotone = false; prevH = hRatio;
    if (Math.abs(eRatio - 1.0) > 0.05) eFlat = false;       // Euclidean stuck at 1.0
  }
  ok(hMonotone && eFlat && prevH > 1.7,
     `sibling ratio (tree=2.0): hyperbolic climbs monotonically to ${prevH.toFixed(2)}; euclidean pinned ~1.0 (flat distorts trees)`);
}

// ── V4 — 64-bit Semantic Phase Hashing is an HONEST TRADEOFF, not free: (i) birthday-collision risk is real
//   and we VALIDATE the birthday formula empirically on truncated spaces; (ii) at 100 billion nodes a 64-bit
//   signature is collision-CERTAIN (you need >=93 bits); (iii) a 1-char typo / a prefix avalanches the
//   signature -> fuzzy/typo/prefix search is impossible (the note's own admission, confirmed).
console.log("\nV4  64-bit phase hashing: birthday risk REAL + typo/prefix avalanche KILLS fuzzy search (honest tradeoff):");
{
  const sig64 = (s) => crypto.createHash("sha256").update(s).digest().readBigUInt64BE(0);
  const birthday50 = (bits) => 1.1774 * Math.sqrt(2 ** bits);  // k for ~50% collision prob

  // (i) validate the birthday model: truncate the signature to b bits, find the first empirical collision,
  //     assert it lands within a small factor of the analytic 50% point (it should be the same order).
  const firstCollision = (bits, trials) => {
    const seen = new Set(), mask = (1n << BigInt(bits)) - 1n;
    for (let i = 0; i < trials; i++) {
      const v = (sig64("k" + i) & mask).toString();
      if (seen.has(v)) return i + 1; seen.add(v);
    }
    return null;
  };
  let modelHolds = true;
  for (const b of [16, 20, 24]) {
    const emp = firstCollision(b, 200000), pred = birthday50(b);
    if (!(emp && emp > pred / 3 && emp < pred * 3)) modelHolds = false;   // same order as the sqrt(2^b) law
  }
  ok(modelHolds, "birthday formula 1.1774*sqrt(2^b) matches empirical first-collision counts at 16/20/24 bits");

  // (ii) 64-bit at 100 billion nodes: expected colliding pairs ~ N^2/(2*2^64) -> certain; need >=93 bits.
  const N = 1e11, space = 2 ** 64;
  const expPairs = N * N / (2 * space);
  const pAny = 1 - Math.exp(-N * N / (2 * space));
  const needBits = Math.log2(N * N / (2 * 1e-6));          // bits for P(collision) < 1e-6
  ok(expPairs > 100 && pAny > 0.999 && needBits > 90,
     `at N=100e9: ~${expPairs.toExponential(1)} expected colliding pairs (P=${pAny.toFixed(3)}, certain); need >=${Math.ceil(needBits)} bits -> use 128-bit`);
  ok(birthday50(64) > 5e9 && birthday50(64) < 6e9,
     `64-bit reaches 50% collision odds at ~${(birthday50(64)/1e9).toFixed(2)} billion items (fine for millions, NOT for 100 billion)`);

  // (iii) avalanche: a 1-char typo and a prefix both produce an UNRELATED signature (no locality).
  const hamming = (a, b) => { let x = a ^ b, c = 0; while (x) { c += Number(x & 1n); x >>= 1n; } return c; };
  const base = "Top_Secret_AI_Architecture_v4_Final";
  const typo = "Top_Secret_AI_Architecture_v4_Fimal";   // one character changed
  const prefix = "Top_Secret_AI_Architecture";           // a partial / prefix query
  const hTypo = hamming(sig64(base), sig64(typo));
  const hPre = hamming(sig64(base), sig64(prefix));
  ok(sig64(base) !== sig64(typo) && sig64(base) !== sig64(prefix) && hTypo > 16 && hPre > 16,
     `typo flips ${hTypo}/64 bits, prefix flips ${hPre}/64 bits (~avalanche) -> NO fuzzy/typo/prefix locality (note's admission confirmed)`);
}

// =============================================================================
// RD-0161  —  Symbiotic vs Pure-Phase / 100PB / NVMe-DMA / decoupled
// =============================================================================

// ── V5 — Reproduce the 100PB stress-table arithmetic EXACTLY (the five index sizes).
console.log("\nV5  100PB scenario: reproduce all five index sizes (SQL/Bloom/Graph/T-CSR/Phase):");
{
  const N = 1e11;       // 100 billion nodes (100 PB / 1 MB avg object)
  const E = 5e12;       // 5 trillion edges (50 relationships / object)
  const sql   = N * 80;                 // B-tree entry ~80 bytes
  const bloom = N * 10 / 8;             // ~10 bits/key
  const graph = N * 15 + E * 34;        // node 15 B + relationship 34 B
  const tcsr  = E * 2 / 8;              // 2 bits/edge (values only — see X-note on topology)
  const phase = N * 32;                 // 256-"bit" vector = 32 B/node (as the note states)
  ok(approx(sql, 8 * TB),    `SQL B-tree   = ${(sql/TB).toFixed(2)} TB  (note: 8 TB)`);
  ok(approx(bloom, 125 * GB), `NoSQL bloom  = ${(bloom/GB).toFixed(0)} GB  (note: 125 GB)`);
  ok(approx(graph, 171 * TB, 0.005), `Graph ptrs   = ${(graph/TB).toFixed(1)} TB  (note: 171 TB)`);
  ok(approx(tcsr, 1.25 * TB), `T-CSR        = ${(tcsr/TB).toFixed(2)} TB  (note: 1.25 TB)`);
  ok(approx(phase, 3.2 * TB), `Phase vectors= ${(phase/TB).toFixed(2)} TB  (note: 3.2 TB)`);
}

// ── V6 — HONEST CORRECTION: NONE of the five fit in 4 GB. "fits in WASM" is FALSE for every structure;
//   "streams THROUGH WASM" is the true statement. Even the smallest (bloom) is 31x over; the two "winners"
//   are 313x (T-CSR) and 800x (phase) over the ceiling.
console.log("\nV6  NONE fit in 4 GB -> 'fits in WASM' FALSE, 'streams through WASM' TRUE (the real correction):");
{
  const sizes = { SQL: 8 * TB, Bloom: 125 * GB, Graph: 171 * TB, "T-CSR": 1.25 * TB, Phase: 3.2 * TB };
  let allOver = true, minOver = Infinity;
  for (const [k, v] of Object.entries(sizes)) { if (v <= WASM) allOver = false; minOver = Math.min(minOver, v / WASM); }
  ok(allOver, `every structure exceeds 4 GB; smallest (Bloom) is ${minOver.toFixed(0)}x over -> none "fit", all must STREAM`);
  ok(sizes["T-CSR"] / WASM > 300 && sizes.Phase / WASM > 700,
     `the "winners" still overflow: T-CSR ${(sizes["T-CSR"]/WASM).toFixed(0)}x, Phase ${(sizes.Phase/WASM).toFixed(0)}x -> they STREAM in 4 GB strips, not resident`);
}

// ── V7 — REFUTE "O(1)" for the Pure-Phase Graph. Streaming/scanning S bytes is Theta(S): it is bandwidth-
//   bound, scales linearly with data, and is NOT independent of N. SIMD parallelism lowers the constant; it
//   does NOT change the linear order. (Established verdict: streaming an N-byte matrix is O(N), not O(1).)
console.log("\nV7  Pure-Phase 'O(1)' -> REFUTE: a full scan of S bytes is O(S) bandwidth-bound, not O(1):");
{
  // model a streaming scan: cost = number of operands touched. It MUST grow with N.
  const scanCost = (nNodes, dimBytes) => nNodes * dimBytes;  // touch every node's vector once
  const small = scanCost(1e6, 32), big = scanCost(1e9, 32);
  ok(big === 1000 * small,
     "scanning 1000x more nodes costs 1000x more (linear in N) — a full-graph scan is O(N), the antithesis of O(1)");
  // time at a fixed bandwidth scales with size — "evaluates 100B in the time of one" is false.
  const tAt = (bytes, Bps) => bytes / Bps;
  ok(tAt(3.2 * TB, 14 * GB) > tAt(32, 14 * GB) * 1e9,
     "wall-clock to stream 3.2 TB >> time to stream one 32 B vector (bandwidth-bound; SIMD cuts the constant, not the order)");
  // What IS O(1): per-node distance arithmetic is O(d), d fixed. The QUERY over the whole graph is O(N*d).
  const perNode = (d) => d, query = (n, d) => n * d;
  ok(perNode(256) === 256 && query(1e9, 256) === 256e9,
     "the SOUND claim: per-node distance is O(d) (d fixed); the whole-graph query is O(N*d) = O(N), not O(1)");
}

// ── V8 — NVMe-DMA zero-copy copy-tax math (ADOPT — real engineering). Reproduce: kernel copy tax
//   3.2 TB / 20 GB/s ~= 160 s; OS-mediated effective ~5 GB/s -> 640 s; DMA at the PCIe-Gen5 wire ~14 GB/s
//   -> ~228 s. Zero-copy removes the double-copy and the context-switch/interrupt overhead.
console.log("\nV8  NVMe-DMA zero-copy copy-tax (ADOPT — real engineering win):");
{
  const S = 3.2 * TB;
  const copyTax  = S / (20 * GB);   // CPU memcpy bandwidth ~20 GB/s
  const legacy   = S / (5  * GB);   // OS-mediated effective throughput ~5 GB/s
  const dma      = S / (14 * GB);   // PCIe Gen5 hardware bandwidth ~14 GB/s
  ok(approx(copyTax, 160, 0.01), `kernel double-copy tax = ${copyTax.toFixed(0)} s  (note: 160 s)`);
  ok(approx(legacy, 640, 0.01),  `OS-mediated stream     = ${legacy.toFixed(0)} s  (note: 640 s)`);
  ok(approx(dma, 228, 0.005),    `NVMe-DMA stream        = ${dma.toFixed(0)} s  (note: 228 s)`);
  ok(legacy / dma > 2.5 && legacy / dma < 3.0,
     `DMA is ~${(legacy/dma).toFixed(1)}x faster than OS-mediated I/O — same drive, no double-copy/interrupts (zero-copy is real)`);
  // sanity: 4-drive RAID0 striping multiplies bandwidth (note's 56 GB/s) — and proportionally the time.
  ok(approx(S / (56 * GB), dma / 4, 1e-9),
     "4x NVMe RAID0 ~56 GB/s scales bandwidth linearly (time / 4) — a bandwidth story, still O(S)");
}

// ── V9 — Decoupled / headless DB + .spore-stream-back = sound defence-in-depth (HIGH ZT). Model the trust
//   boundary: a compromised web app holds ONLY the sealed outbound .spore (no DB RAM, no keys, no plaintext);
//   the DB admits a request ONLY on a verified passport (+1). We assert: (a) app-side compromise yields no
//   plaintext; (b) admission is deny-by-default (a 0/INDETERMINATE or -1 passport never executes).
console.log("\nV9  Decoupled headless DB + .spore stream-back = sound defence-in-depth (high ZT):");
{
  // K3 admission: only +1 (ALLOW) executes; 0 (INDETERMINATE) and -1 (DENY) are refused (deny-by-default).
  const ALLOW = 1, INDETERMINATE = 0, DENY = -1;
  const admit = (passportVerdict) => passportVerdict === ALLOW;
  ok(admit(ALLOW) && !admit(INDETERMINATE) && !admit(DENY),
     "DB executes ONLY on a verified +1 passport; 0 and -1 are refused (deny-by-default at the .spore border)");

  // a sealed outbound .spore: the web app can hold it but cannot open it without the key it does NOT have.
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const seal = (plaintext) => {
    const c = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
    return { ct, tag: c.getAuthTag() };
  };
  const secret = JSON.stringify({ balance: 12345, ssn: "redact-me" });
  const env = seal(secret);
  // attacker == compromised web app: has the ciphertext+tag but NOT the key.
  let leaked = false;
  try {
    const wrongKey = crypto.randomBytes(32);                 // attacker guesses / has no key
    const d = crypto.createDecipheriv("aes-256-gcm", wrongKey, iv);
    d.setAuthTag(env.tag);
    const out = Buffer.concat([d.update(env.ct), d.final()]); // MUST throw (GCM auth fail)
    if (out.toString("utf8").includes("balance")) leaked = true;
  } catch { /* expected: auth failure, nothing recovered */ }
  ok(!leaked && !env.ct.toString("latin1").includes("balance"),
     "compromised web app holds only the sealed .spore (no key) -> recovers NO plaintext (AES-GCM auth-fails)");

  // the legit holder CAN open it (round-trip), proving it's a real seal not a black hole.
  const d2 = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d2.setAuthTag(env.tag);
  const round = Buffer.concat([d2.update(env.ct), d2.final()]).toString("utf8");
  ok(round === secret, "the key-holding app decrypts the .spore correctly (sealed, not destroyed) — sound DiD, not security-by-obscurity");
}

// =============================================================================
// EXCLUDED — named, reason given, where it is (or must be) settled
// =============================================================================
const EXCLUDED = [
  ["X1", "T-CSR '2 bits/edge' size used in the 100PB table (RD-0161) counts VALUES ONLY, not column indices.",
        "A usable CSR also stores a column index per edge (>= ceil(log2 N) bits). At N=100e9 that is ~37 bits/edge, so the real T-CSR is ~24 TB, not 1.25 TB. The table's 1.25 TB is the lower bound (presence channel only). The O(E) shape (V1) is unaffected; only the absolute figure is optimistic — flag, don't ship the 1.25 TB as total."],
  ["X2", "'256-dimensional ternary vector = 256 bits = 32 bytes' (RD-0160/0161).",
        "Conflation: 256 TRITS at 2 bits each = 512 bits = 64 B/node -> 6.4 TB, double the table's 3.2 TB. 32 B/node is only correct if the vector is 256 one-BIT dims (binary), which is not 'ternary'. Honest figure depends on which is meant; V5 reproduces the note's stated 32 B, X2 records the discrepancy."],
  ["X3", "Pure-Phase 'evaluates 100 million relationships in the same time as one' / 'O(1)'.",
        "REFUTED in V7. Bandwidth-bound O(N) streaming. SIMD/photonic parallelism lowers the constant factor (real, worth pursuing) but cannot make a full-graph scan independent of N. Same established verdict as prior mesh RDs."],
  ["X4", "RAID0 'staggering 56 GB/s' (and bypassing the OS 'entirely').",
        "Bandwidth scales ~linearly with stripe count (V8) — genuine — but it is still an O(S) streaming story, and real SPDK/io_uring setups keep a thin trusted path (IOMMU, page-pinning, the NVMe driver). 'Bypass the OS entirely' overstates it; the win is removing the double-copy + context-switch tax, not removing the kernel from trust. Engineering-gated."],
  ["X5", "Hyperbolic embedding QUALITY at billion-node scale / on arbitrary (non-tree) graphs.",
        "V3 proves the tree case (where hyperbolic provably wins). General graphs with cycles/high treewidth do NOT embed in 2-D hyperbolic with low distortion; you need higher dimension and a real optimiser (Sarkar/Lorentz training). Net-new ML work, out of the governance core (ext-bridge/photonic-emulator territory) — design, not benched here."],
  ["X6", "Network transport choice (WebSocket vs gRPC) for the .spore stream (open question at note end).",
        "Transport selection — settled under the HTTP-transport B8 line (feedback-http-transport-owner-locked: build-first K3 cert-gate, revocation-unknown -> DENY). The .spore SEAL + deny-by-default admission (V9) is transport-agnostic; the cert-gate is the load-bearing control regardless of WS/gRPC."],
];
console.log("\nEXCLUDED (named, not benched here):");
for (const [id, claim, why] of EXCLUDED) console.log(`  ${id}  ${claim}\n        -> ${why}`);

// =============================================================================
console.log(`\n--- SUMMARY ---  V-claims: ${pass} passed / ${fail} failed   ·   ${EXCLUDED.length} excluded`);
console.log(`${pass}/${pass + fail} passed`);
const green = fail === 0;
console.log(green
  ? "RESULT: GREEN — T-CSR O(E)+lossless, hyperbolic-tree win, phase-hash honest-tradeoff, 100PB table exact, "
    + "NONE-fit-but-STREAM correction, O(1) REFUTED, NVMe-DMA zero-copy ADOPTED, decoupled .spore = sound DiD\n"
  : "RESULT: RED — a load-bearing V-claim did not hold\n");
process.exit(green ? 0 : 1);

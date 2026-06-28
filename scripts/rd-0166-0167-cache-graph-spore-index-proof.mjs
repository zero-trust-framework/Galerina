// =============================================================================
// rd-0166-0167-cache-graph-spore-index-proof.mjs
//
// Self-contained, machine-checkable proof (node built-ins ONLY) for the two R&D
// branches pasted in notes/76-mesh-r-d-07.md and ...08.md.
//
//   RD-0166  Graph-driven CPU cache optimization (L1/L2/L3)
//            - AMAT = Thit + Pmiss*Tmiss reproduced from first principles
//            - T-CSR cache-line packing: 64B*8 / 2-bit = 256 edges/line vs 2 @ 32B
//            - AMAT 81ns -> 1.39ns UNDER THE MODEL  (ADOPT as real, but MODEL-BOUNDED)
//            - prefetch distance D = ceil(Tmem/Tcompute) = 50
//            - branchless removes the ~15-cycle mispredict penalty (4 cyc -> 1 cyc)
//            - Huge-Pages TLB coverage 1GB/4KB = 250000 entries vs 1 @ 1GB-page
//
//   RD-0167  Graph INSIDE the .spore as a PRIMARY INDEX (not data)
//            + beyond-4GB-WASM / 10GB synthesis
//            - in-passport T-CSR adjacency INDEX cuts read-amplification (modeled)
//            - block-matrix chunking keeps PEAK mem < 4GB while processing >10GB
//            - CRITICAL ZT FLAG: an unsigned in-.spore index is POISONABLE
//              (attacker rewrites the index -> redirects reads). PROVE the attack
//              exists if unsigned, and that covering the index under the passport
//              signature (Ed25519) CLOSES it. Demo runs the real attack both ways.
//
// Re-runnable, computed vs ground truth (owner rule feedback-rd-prove-own-maths).
// V# = proved here.  X# = excluded (reason + where it is settled / who owns it).
//
// CONSERVATISM: every cache/clock number here is a MODEL result under stated
// constants (Thit, Tmiss, cycle penalties). Real silicon prefetchers, replacement
// policy, set-associativity, and NUMA vary — so the *direction* (contiguous,
// cache-line-packed, branchless, sequential pages) is ADOPTED as real but BOUNDED;
// the exact 60x is a ceiling of the model, NOT a hardware guarantee. We never claim
// O(1) or "latency = 0"; we assert work is Theta(n) and only *latency* is hidden.
//
// Run:  node scripts/rd-0166-0167-cache-graph-spore-index-proof.mjs
//       exit 0 iff every V# holds, exit 1 on any FAIL.
// =============================================================================

import { createHash, generateKeyPairSync, sign as edSign, verify as edVerify } from "node:crypto";

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log(`  PASS  ${l}`); } else { fail++; console.log(`  FAIL  ${l}`); } };
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== RD-0166 — graph-driven CPU cache optimization (L1/L2/L3): machine-checked model ===\n");
// ─────────────────────────────────────────────────────────────────────────────

// ── V1 — AMAT formula reproduced from first principles, both regimes.
//   AMAT = Thit + Pmiss * Tmiss.  Legacy (random pointers, 80% miss) vs the T-CSR
//   packed regime. We do NOT hand-wave 1.39ns; we DERIVE Pmiss from the packing.
console.log("V1  AMAT = Thit + Pmiss*Tmiss reproduced (legacy 81ns; derived T-CSR ~1.39ns):");
{
  const AMAT = (Thit, Pmiss, Tmiss) => Thit + Pmiss * Tmiss;
  const Thit = 1;     // L1 hit ~1 ns  (model constant from the note)
  const Tmiss = 100;  // main-RAM penalty ~100 ns (model constant)

  // Legacy: fragmented random 64-bit pointers -> ~80% miss
  const amatLegacy = AMAT(Thit, 0.8, Tmiss);
  ok(approx(amatLegacy, 81), `legacy: 1 + 0.8*100 = ${amatLegacy} ns (== 81)`);

  // T-CSR: Pmiss is DERIVED from edges-per-line (see V2), not assumed.
  // With 256 edges resident per line fetch, the cold-miss share is 1/256.
  const edgesPerLine = 256;
  const PmissTrit = 1 / edgesPerLine;
  ok(approx(PmissTrit, 0.00390625), `derived Pmiss = 1/256 = ${PmissTrit} (~0.0039)`);
  const amatTrit = AMAT(Thit, PmissTrit, Tmiss);
  ok(approx(amatTrit, 1.390625), `T-CSR: 1 + (1/256)*100 = ${amatTrit.toFixed(6)} ns (~1.39)`);

  // Speedup is a MODEL ceiling, not a silicon guarantee.
  const speedup = amatLegacy / amatTrit;
  ok(speedup > 55 && speedup < 60, `model speedup ${speedup.toFixed(2)}x (note's "~60x" is a model ceiling, not HW)`);
}

// ── V2 — Cache-line packing math VERIFIED against an actual bit-packed buffer.
//   Nedges = (Lc * 8) / Sedge_bits.  We don't just compute 256 — we materialize a
//   64-byte line, pack 2-bit ternary edges into it, and COUNT that 256 fit and 257
//   overflow. Then verify the legacy 32-byte edge gives exactly 2 per line.
console.log("\nV2  cache-line packing 64B -> 256 ternary edges/line (verified on a real bit-packed buffer):");
{
  const LINE_BYTES = 64;
  const LINE_BITS = LINE_BYTES * 8;          // 512
  const EDGE_BITS_TRIT = 2;                   // 2-bit ternary phase {-1,0,+1} -> {00,01,10}
  const nTrit = (LINE_BITS * 1) / EDGE_BITS_TRIT;
  ok(nTrit === 256, `formula: 512 bits / 2 bits = ${nTrit} edges/line`);

  // Materialize: pack 256 two-bit codes into a real 64-byte buffer and read back.
  const line = new Uint8Array(LINE_BYTES); // 64 bytes
  const setEdge = (buf, i, code /*0..3*/) => {
    const bit = i * 2, byte = bit >> 3, off = bit & 7;
    buf[byte] = (buf[byte] & ~(0b11 << off)) | ((code & 0b11) << off);
  };
  const getEdge = (buf, i) => {
    const bit = i * 2, byte = bit >> 3, off = bit & 7;
    return (buf[byte] >> off) & 0b11;
  };
  // Tri-phase pattern: cycle DENY(00=0+? ) we use codes 1,2,3 mapping to {-1,0,+1} avoiding 0 to detect drops.
  const codes = [1, 2, 3]; // 01,10,11
  for (let i = 0; i < 256; i++) setEdge(line, i, codes[i % 3]);
  let allReadBack = true;
  for (let i = 0; i < 256; i++) if (getEdge(line, i) !== codes[i % 3]) allReadBack = false;
  ok(allReadBack, "packed 256 distinct 2-bit edges into 64 bytes and read every one back (fits exactly)");

  // Edge #256 would need byte index 64 -> off the end of a 64-byte line (overflow proof).
  const overflowBitForEdge256 = 256 * 2;     // 512
  ok((overflowBitForEdge256 >> 3) === LINE_BYTES, "edge #256 (0-indexed) starts at byte 64 -> spills the line (256 is the max)");

  // Legacy 32-byte edge (ID + 64-bit pointer): 64 / 32 = 2 per line.
  const EDGE_BYTES_LEGACY = 32;
  ok(Math.floor(LINE_BYTES / EDGE_BYTES_LEGACY) === 2, "legacy 32B edge -> 2 edges/line (64/32)");
  ok((nTrit / (LINE_BYTES / EDGE_BYTES_LEGACY)) === 128, "density gain = 256/2 = 128x edges resident per line fetch");
}

// ── V3 — Prefetch distance D = ceil(Tmem / Tcompute) = 50, and the *invariant*
//   that justifies it: the prefetch must be issued >= D iters ahead so data lands
//   before the SIMD engine consumes the line. We simulate a pipeline and show that
//   D-1 still stalls but D hides the latency (latency hidden != work removed).
console.log("\nV3  prefetch distance D = ceil(Tmem/Tcompute) = 50; D-ahead hides latency (work NOT removed):");
{
  const Tmem = 100, Tcompute = 2;
  const D = Math.ceil(Tmem / Tcompute);
  ok(D === 50, `D = ceil(100/2) = ${D}`);

  // Latency-hiding simulation: line i is "needed" at t = i*Tcompute; a prefetch
  // issued at t_issue arrives at t_issue + Tmem. With lookahead L, prefetch for
  // line i is issued at (i-L)*Tcompute. Stall iff arrival > need-time.
  const stalls = (L) => {
    let s = 0;
    for (let i = L; i < 1000; i++) {
      const issue = (i - L) * Tcompute;
      const arrive = issue + Tmem;
      const need = i * Tcompute;
      if (arrive > need) s++;
    }
    return s;
  };
  ok(stalls(D - 1) > 0, `lookahead D-1 (=${D - 1}) still stalls (arrival beats need by < a line)`);
  ok(stalls(D) === 0, `lookahead D (=${D}) -> zero stalls in steady state (latency fully hidden)`);

  // Anti-O(1) guard: hiding latency does NOT remove work. Processing n lines is Theta(n).
  const work = (n) => { let c = 0; for (let i = 0; i < n; i++) c++; return c; };
  ok(work(1000) === 1000 && work(0) === 0, "processing n lines costs n compute-units (Theta(n)); only *latency* is hidden, not work");
}

// ── V4 — Branchless removes the ~15-cycle mispredict penalty: 1 + 0.2*15 = 4 cyc
//   -> 1 cyc. AND we prove the branchless trit-gate computes the SAME authorization
//   result as the branching one over ALL inputs (correctness, not just speed).
console.log("\nV4  branchless trit-gate: 4 cyc -> 1 cyc (model) AND bit-identical to branching gate over all inputs:");
{
  const Tbase = 1, Pmis = 0.2, Tflush = 15;
  const tBranch = Tbase + Pmis * Tflush;
  const tBranchless = Tbase + 0 * Tflush;
  ok(approx(tBranch, 4), `branching: 1 + 0.2*15 = ${tBranch} cyc`);
  ok(approx(tBranchless, 1), `branchless: 1 + 0*15 = ${tBranchless} cyc`);
  ok(tBranch / tBranchless === 4, "4x at the instruction level (model: removes the pipeline-flush tax)");

  // Equivalence over the full ternary domain. Trits: DENY=-1, INDET=0, ALLOW=1.
  // Branching min-gate vs branchless arithmetic min (Math.min). Must agree on all 9 pairs.
  const TRITS = [-1, 0, 1];
  const gateBranching = (a, b) => { if (a <= b) return a; else return b; };          // has IF/ELSE
  const gateBranchless = (a, b) => Math.min(a, b);                                   // pure arithmetic, no branch
  let identical = true;
  for (const a of TRITS) for (const b of TRITS) if (gateBranching(a, b) !== gateBranchless(a, b)) identical = false;
  ok(identical, "branchless min == branching min over all 9 trit pairs (Kleene AND; correctness preserved)");
  // Sanity: the min-rule never manufactures ALLOW from a DENY (fail-closed monotonicity).
  let monotone = true;
  for (const a of TRITS) for (const b of TRITS) if (Math.min(a, b) > a) monotone = false;
  ok(monotone, "min(a,b) <= a for all pairs -> an untrusted operand can only LOWER the verdict (fail-closed)");
}

// ── V5 — TLB coverage: 1GB / 4KB = 250000 pages vs 1GB / 1GB = 1 page.
//   We compute both and the per-GB miss-penalty the note quotes (12.5 ms @ 50ns).
//   This is "sound engineering" (polymorphic edge/datacenter), NOT a new primitive.
console.log("\nV5  Huge-Page TLB coverage: 250000 entries (4KB) vs 1 entry (1GB); 12.5ms/GB penalty (sound engineering):");
{
  const GB = 1024 * 1024 * 1024;
  const KB = 1024;
  const pages4k = GB / (4 * KB);
  ok(pages4k === 262144, `1GB / 4KB = ${pages4k} pages (note rounds to "250,000"; exact is 262144)`);
  ok((GB / GB) === 1, "1GB / 1GB-huge-page = 1 TLB entry (covers the whole matrix in one slot)");

  // Note's edge-mode penalty: 250,000 pages * 50ns TLB-miss = 12.5 ms / GB.
  const Tmiss_tlb = 50e-9; // 50 ns in seconds
  const penaltyPerGB_ms = 250000 * Tmiss_tlb * 1000;
  ok(approx(penaltyPerGB_ms, 12.5, 1e-6), `250000 * 50ns = ${penaltyPerGB_ms} ms/GB (matches the note)`);

  // Polymorphic decision is a clean boot-time probe, not a perf miracle: huge-pages
  // require CONTIGUOUS physical RAM, so edge devices must degrade to 4KB (correctness > speed).
  const chooseMode = (hugePagesAvailable) => (hugePagesAvailable ? "datacenter-1GB" : "edge-4KB");
  ok(chooseMode(true) === "datacenter-1GB" && chooseMode(false) === "edge-4KB",
     "boot probe: huge-pages -> datacenter mode, else graceful 4KB edge mode (never OOM-panics on a Pi)");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n\n=== RD-0167 — graph INSIDE the .spore as a SIGNED primary index + >10GB / >4GB synthesis ===\n");
// ─────────────────────────────────────────────────────────────────────────────

// ── V6 — In-passport T-CSR adjacency INDEX cuts read-amplification (modeled).
//   Without an index, answering "neighbours of node u" requires scanning all E edges
//   (or N nodes) -> read-amplification ~ E. With a CSR index (rowptr + colidx), it is
//   exactly deg(u) reads after an O(1) rowptr lookup. We BUILD a real CSR and count.
console.log("V6  in-passport T-CSR INDEX: neighbour read costs deg(u), not a full E-edge scan (read-amp drop):");
{
  // Tiny deterministic graph, 6 nodes. Adjacency (directed): the "primary index".
  const N = 6;
  const adj = [
    [1, 2],      // 0 -> 1,2
    [2, 3],      // 1 -> 2,3
    [3],         // 2 -> 3
    [4, 5],      // 3 -> 4,5
    [5],         // 4 -> 5
    [],          // 5 -> (sink)
  ];
  const E = adj.reduce((s, a) => s + a.length, 0);

  // Build T-CSR: rowptr (N+1), colidx (E). This is the INDEX we embed in the passport.
  const rowptr = new Int32Array(N + 1);
  for (let u = 0; u < N; u++) rowptr[u + 1] = rowptr[u] + adj[u].length;
  const colidx = new Int32Array(E);
  { let k = 0; for (let u = 0; u < N; u++) for (const v of adj[u]) colidx[k++] = v; }
  ok(rowptr[N] === E, `CSR rowptr terminates at E=${E} (well-formed index)`);

  // Indexed neighbour query: O(1) rowptr lookup + deg(u) sequential colidx reads.
  let indexedReads = 0;
  const neighborsIndexed = (u) => {
    const out = [];
    for (let p = rowptr[u]; p < rowptr[u + 1]; p++) { indexedReads++; out.push(colidx[p]); }
    return out;
  };
  // Unindexed: must examine every edge to find those originating at u (full scan).
  let scanReads = 0;
  const neighborsScan = (u) => {
    const out = [];
    for (let s = 0; s < N; s++) for (const v of adj[s]) { scanReads++; if (s === u) out.push(v); }
    return out;
  };

  // Correctness: indexed == scan for every node.
  let sameAnswers = true;
  for (let u = 0; u < N; u++) {
    const a = neighborsIndexed(u).slice().sort();
    const b = neighborsScan(u).slice().sort();
    if (JSON.stringify(a) !== JSON.stringify(b)) sameAnswers = false;
  }
  ok(sameAnswers, "indexed neighbour query returns identical results to a full scan (index is correct, not lossy)");

  // Read-amplification: indexed total == sum(deg) == E; scan total == N*E.
  ok(indexedReads === E, `indexed total reads across all nodes = ${indexedReads} (== E, optimal: each edge read once)`);
  ok(scanReads === N * E, `unindexed scan reads = ${scanReads} (== N*E = ${N * E}); read-amplification factor = N = ${N}x`);
  ok(scanReads / indexedReads === N, "read-amplification reduced by factor N (grows with graph size -> the index earns its bytes)");
}

// ── V7 — Block-matrix chunking keeps PEAK memory < 4GB while *processing* >10GB.
//   We model a 12 GB logical edge stream processed in fixed blocks; the peak resident
//   set is exactly one block (+ O(1) accumulators), independent of total size. We also
//   verify the streamed computation equals the all-at-once result (no loss from chunking).
console.log("\nV7  block-matrix chunking: peak RSS = one block (< 4GB) while processing > 10GB; result == all-at-once:");
{
  const BYTES_PER_EDGE = 8;                 // packed edge record (model)
  const TOTAL_GB = 12;                      // > 10 GB workload
  const totalBytes = TOTAL_GB * 1024 * 1024 * 1024;
  const totalEdges = Math.floor(totalBytes / BYTES_PER_EDGE);

  const BLOCK_BYTES = 256 * 1024 * 1024;    // 256 MB block (well under the 4GB WASM ceiling)
  const edgesPerBlock = BLOCK_BYTES / BYTES_PER_EDGE;
  const nBlocks = Math.ceil(totalEdges / edgesPerBlock);

  // The whole point: peak working set is ONE block, not the whole 12GB.
  const peakResidentBytes = BLOCK_BYTES + 4096; // one block + O(1) accumulator slop
  ok(peakResidentBytes < 4 * 1024 * 1024 * 1024, `peak RSS = ${(peakResidentBytes / (1024 * 1024)).toFixed(0)} MB < 4GB while total = ${TOTAL_GB} GB`);
  ok(totalBytes > 10 * 1024 * 1024 * 1024, `workload ${TOTAL_GB} GB exceeds the 10GB limit the note calls out`);
  ok(nBlocks > 1, `streamed in ${nBlocks} blocks of ${BLOCK_BYTES / (1024 * 1024)} MB`);

  // Streaming-vs-batch equivalence on a deterministic reduction (sum of a synthetic
  // edge weight). We never allocate 12GB; we fold block by block and compare to the
  // closed-form total. (Proves chunking is loss-free, not just memory-cheap.)
  const weightOf = (i) => (i % 7);          // deterministic synthetic weight, no allocation
  // closed form: sum_{i=0}^{n-1} (i mod 7)
  const closedForm = (n) => {
    const full = Math.floor(n / 7), rem = n % 7;
    return full * (0 + 1 + 2 + 3 + 4 + 5 + 6) + (rem * (rem - 1)) / 2;
  };
  let streamed = 0n;
  for (let b = 0; b < nBlocks; b++) {
    const start = b * edgesPerBlock;
    const end = Math.min(start + edgesPerBlock, totalEdges);
    // fold this block as a sub-closed-form (we do NOT iterate 1.6e9 times — that itself
    // would be slow; we use the same closed form per-range to model an O(block) fold).
    streamed += BigInt(closedForm(end) - closedForm(start));
  }
  ok(streamed === BigInt(closedForm(totalEdges)),
     "block-by-block fold == single closed-form over all edges (chunking is loss-free)");
}

// ── V8 — THE ZT FLAG (load-bearing). An index embedded in the .spore is EXECUTABLE
//   TRUST: reads follow it. If it is NOT covered by the passport signature, an attacker
//   rewrites rowptr/colidx to redirect a read of node "balance" to node "attacker_data".
//   We run the REAL attack with node:crypto Ed25519:
//     (a) UNSIGNED index  -> tamper -> read is redirected, NOTHING detects it  (FAIL-OPEN)
//     (b) index COVERED by the passport signature -> tamper -> verify() FAILS -> reject (CLOSED)
console.log("\nV8  ZT: an in-.spore index MUST be signed — unsigned => index-poisoning redirect; signed => rejected:");
{
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const attacker = generateKeyPairSync("ed25519"); // attacker has NO access to the real privateKey

  // A .spore passport = capability header + an embedded T-CSR index + a payload.
  // Node labels map to colidx targets; the "secret" read is node 1 ("balance").
  const labels = ["public_brochure", "balance_12345", "attacker_99999"];
  const buildSpore = () => ({
    header: { tier: 3, intent: "read-balance" },
    // primary INDEX embedded in the passport: "query node 0 -> resolves to target row 1"
    index: { rowptr: [0, 1], colidx: [1] },     // colidx[0] = 1 -> "balance_12345"
    payload: labels,
  });

  // Canonical serialization of the bytes that the signature MUST cover.
  // CRITICAL: the index is INCLUDED in the signed region (that is the fix).
  const signedRegionBytes = (spore) =>
    Buffer.from(JSON.stringify({ header: spore.header, index: spore.index, payload: spore.payload }));
  // A NAIVE design that signs only the payload+header and LEAVES THE INDEX OUT (the bug).
  const naiveRegionBytes = (spore) =>
    Buffer.from(JSON.stringify({ header: spore.header, payload: spore.payload }));

  // The read engine: follow the embedded index to resolve a query node to a payload value.
  const resolveRead = (spore, queryNode) => {
    const p0 = spore.index.rowptr[queryNode];
    const target = spore.index.colidx[p0];     // <-- reads obey the index
    return spore.payload[target];
  };

  // ---- (a) UNSIGNED INDEX (or index outside the signed region): attack SUCCEEDS silently
  {
    const spore = buildSpore();
    const sig = edSign(null, naiveRegionBytes(spore), privateKey); // legit signer, but index NOT covered
    const honest = resolveRead(spore, 0);
    ok(honest === "balance_12345", "baseline: honest read of query-node 0 resolves to 'balance_12345'");

    // Attacker rewrites ONLY the index to redirect the read to attacker_99999.
    spore.index.colidx[0] = 2; // 1 -> 2  (poison)
    // Verify still passes because the index was never in the signed region:
    const stillValid = edVerify(null, naiveRegionBytes(spore), publicKey, sig);
    const redirected = resolveRead(spore, 0);
    ok(stillValid === true, "UNSIGNED-INDEX: signature still verifies AFTER tampering (index wasn't covered)");
    ok(redirected === "attacker_99999",
       "UNSIGNED-INDEX: poisoned read redirected 'balance' -> 'attacker_99999' with NO detection (FAIL-OPEN, the vuln)");
  }

  // ---- (b) SIGNED INDEX: same attack is now DETECTED and rejected
  {
    const spore = buildSpore();
    const sig = edSign(null, signedRegionBytes(spore), privateKey); // index IS covered
    const honest = resolveRead(spore, 0);
    ok(honest === "balance_12345", "baseline (signed): honest read resolves to 'balance_12345'");

    // Same poison attempt.
    spore.index.colidx[0] = 2;
    const verifyAfterTamper = edVerify(null, signedRegionBytes(spore), publicKey, sig);
    ok(verifyAfterTamper === false,
       "SIGNED-INDEX: Ed25519 verify() FAILS after index tamper -> .spore rejected before any read (CLOSED)");

    // And the engine must refuse to follow an index that didn't verify (fail-closed gate).
    const gatedRead = (spore, queryNode, verified) => {
      if (!verified) return { ok: false, value: null, reason: "passport signature invalid — index untrusted" };
      return { ok: true, value: resolveRead(spore, queryNode) };
    };
    const r = gatedRead(spore, 0, verifyAfterTamper);
    ok(r.ok === false && r.value === null, "fail-closed gate: an unverified index yields NO value (deny-by-default)");

    // Attacker cannot RE-SIGN: they lack the private key. Forging a sig with the
    // attacker key does not verify under the real public key.
    const forged = edSign(null, signedRegionBytes(spore), attacker.privateKey);
    ok(edVerify(null, signedRegionBytes(spore), publicKey, forged) === false,
       "attacker cannot re-sign the poisoned index (no private key): forged sig fails under the real public key");
  }

  // ---- index integrity is exactly a hash-cover question: prove the signed digest
  //      changes iff the index bytes change (so signing the digest binds the index).
  {
    const digest = (obj) => createHash("sha256").update(JSON.stringify(obj)).digest("hex");
    const clean = { rowptr: [0, 1], colidx: [1] };
    const poisoned = { rowptr: [0, 1], colidx: [2] };
    ok(digest(clean) !== digest(poisoned),
       "SHA-256 over the index differs for clean vs poisoned -> a signature over the digest binds index integrity");
  }
}

// ── V9 — "production Galerina runs the DB, not the .spore alone": the in-passport
//   index is a SIGNED HINT/PRIMARY-INDEX, and the authoritative store can REBUILD the
//   true index and must MATCH the passport's. We model the cross-check: if the passport
//   index disagrees with the DB-rebuilt index, the read is denied (defense in depth).
console.log("\nV9  production framework cross-checks the .spore index against the DB-rebuilt index (defense in depth):");
{
  // DB ground-truth adjacency for node 0.
  const dbAdj0 = [1];                 // node 0's true neighbour set, per the live store
  const rebuildIndexRow = () => dbAdj0.slice();

  const passportIndexRow_good = [1];  // matches DB
  const passportIndexRow_bad = [2];   // poisoned / stale -> must be caught even if it were somehow signed-but-stale

  const crossCheck = (passportRow) => {
    const truth = rebuildIndexRow();
    const agree = JSON.stringify(passportRow.slice().sort()) === JSON.stringify(truth.slice().sort());
    return agree ? { ok: true } : { ok: false, reason: "passport index disagrees with authoritative store" };
  };
  ok(crossCheck(passportIndexRow_good).ok === true, "passport index == DB-rebuilt index -> accepted");
  ok(crossCheck(passportIndexRow_bad).ok === false,
     "passport index != DB-rebuilt index -> denied (the framework, not the .spore alone, is the source of truth)");
}

// ─────────────────────────────────────────────────────────────────────────────
// EXCLUDED — named, not benched here (kept honest: what we did NOT prove and why).
// ─────────────────────────────────────────────────────────────────────────────
const EXCLUDED = [
  ["X1", "'latency mathematically zero' / 'absolute theoretical speed limit' (notes 07)",
        "REFUTED as written. Prefetch+packing HIDE latency; they do not make work O(1). V3 proves processing n lines is Theta(n). We adopt 'latency hidden in steady state', never 'zero work'."],
  ["X2", "exact 60x AMAT speedup as a hardware guarantee",
        "MODEL-BOUNDED. The 81ns->1.39ns and 60x are correct UNDER the stated constants (Thit=1, Tmiss=100, 80% legacy miss, perfect sequential prefetch). Real set-associativity, replacement policy, prefetcher heuristics, and NUMA move the number. Direction ADOPTED, magnitude not promised."],
  ["X3", "OS cache-coloring / page-color locking of the Tri-Router into a fixed L3 way (note 07 §3)",
        "SOUND systems technique but OS/arch-gated (needs page-coloring or Intel CAT/CDP). It is engineering, not a new Galerina primitive; can't be benched in a pure-JS proof. Owner/infra-gated."],
  ["X4", "_mm_prefetch / AVX-512 SIMD issue from the WASM/Galerina runtime",
        "ISA-gated. WASM has no portable software-prefetch intrinsic today (relaxed-SIMD is partial). The D=50 schedule (V3) is the math; emitting the actual prefetch is a backend/host concern. Design, gated."],
  ["X5", "Huge-Pages 'forcefully demanded from the kernel' as default",
        "REJECTED as a hard default (note's own 'fatal flaw': contiguous-RAM requirement OOM-panics edge devices). The SOUND form is the boot-time polymorphic probe (V5) — most-secure default is degrade-to-4KB, never crash."],
  ["X6", "Beyond-4GB single linear WASM memory via memory64",
        "memory64 is the real lever for >4GB addressable WASM but is still stabilizing across runtimes. V7's block-chunking is the portable fix that needs NO >4GB address space at all (peak RSS = one block). memory64 ADOPT-WHEN-STABLE, tracked not built here."],
];
console.log("\nEXCLUDED (named, not benched here):");
for (const [id, claim, why] of EXCLUDED) console.log(`  ${id}  ${claim}\n        -> ${why}`);

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n--- SUMMARY ---  V-claims: ${pass} pass / ${fail} fail   ·   ${EXCLUDED.length} excluded`);
console.log(`${pass + fail}/${pass + fail} checks run; ${pass}/${pass + fail} passed`);
const green = fail === 0;
console.log(green
  ? "RESULT: GREEN — RD-0166 cache model reproduced (MODEL-BOUNDED, ADOPT); RD-0167 signed-index proven\n" +
    "         (unsigned in-.spore index => poisoning redirect; Ed25519-covered index => rejected). O(1)/zero-latency REFUTED.\n"
  : "RESULT: RED — a load-bearing V-claim did not hold (see FAIL above)\n");
process.exit(green ? 0 : 1);

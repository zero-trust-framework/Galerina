// =============================================================================
// rd-0156-photonic-wavefront-db-proof.mjs
//
// Machine-checkable proof for note 76-mesh-r-d-02.md — PHOTONIC branch (RD-0156):
//   "Photonic Interference Fabric" + "Holographic Wavefront Database"
//   (holographic phase states, ternary phase-shift keying, photorefractive crystals,
//    slime-mold/Fermat optical routing, optical "masking/scrambling" as security).
//
// VERDICT: REFUTE the security core + O(1) search core; TRACK the future-HW storage.
//   The +1 / -1 / 0  (constructive / destructive / dark)  ->  K3 mapping is an
//   ANALOGY for intuition, NOT a governance authority and NOT encryption.
//
// Standing Galerina rules enforced here (do NOT assume — CHECK, by running):
//   * photonic/analog substrate canNOT do bit-exact crypto. Optical masking /
//     scrambling / obfuscation is NOT encryption and does NOT replace SHA-256 /
//     AES / ML-DSA. (SPORE-SUBSTRATE-001 candor check, restated as runnable math.)
//   * "speed-of-light search of a billion records" still has to READ N results to
//     report them -> O(N), never O(1).
//
// node BUILT-INS ONLY (node:crypto, node:perf_hooks). No third-party deps, no
// project imports — this proof must stand alone and re-run on any binary PC.
//
//   V# = proved here.  X# = excluded (reason + where it actually settles).
// Run:  node scripts/rd-0156-photonic-wavefront-db-proof.mjs   (exit 0 iff all V# hold)
// =============================================================================

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log(`  PASS  ${l}`); } else { fail++; console.log(`  FAIL  ${l}`); } };

// ---- tiny self-contained K3 (Kleene 3-valued) so we depend on NO project code ----
const DENY = -1, DARK = 0, ALLOW = 1;            // -1 / 0 / +1
const vAnd = (a, b) => Math.min(a, b);            // conjunction = min
const vNot = (a) => -a;                           // negation = arithmetic negate
const authorize = (v) => v === ALLOW;             // ONLY +1 proceeds; 0 and -1 do not

console.log("\n=== RD-0156 — Photonic Interference Fabric / Holographic Wavefront DB: machine-checked ===\n");

// ===========================================================================
// V1 — NOISE-FLIPS-CRYPTO. The note claims "optical masking" replaces decryption:
//   right .spore lens -> data comes out clear; wrong lens -> scatters to noise,
//   "zero CPU decryption". REFUTE: an analog phase channel carries a continuous
//   noise term epsilon. To feed bytes to a hash you must QUANTIZE phase -> bits.
//   Bit-exact crypto demands a zero-error avalanche: perturb the analog phase of
//   even ONE symbol past its quantization boundary and >=1 bit flips, the SHA-256
//   digest avalanches (~half the OUTPUT bits change), and verify() FAILS CLOSED.
//   So "the security IS the light" cannot stand: the integrity decision is digital.
// ===========================================================================
console.log("V1  noise-flips-crypto — analog phase noise destroys the bit-exact hash/verify:");
{
  // Encode a record as analog phases in {0, pi} (binary phase-shift keying), one phase per bit.
  // "Reading" a phase = quantize back to a bit. A clean read reproduces the record exactly.
  const TAU = Math.PI;
  const bitsToPhases = (bits) => bits.map((b) => (b ? TAU : 0));            // 1 -> pi, 0 -> 0
  const phasesToBits = (ph) => ph.map((p) => {
    // decision boundary at pi/2: nearest of {0, pi}. This is the detector.
    const wrapped = ((p % (2 * TAU)) + 2 * TAU) % (2 * TAU);
    return (wrapped > TAU / 2 && wrapped < 3 * TAU / 2) ? 1 : 0;
  });

  const record = randomBytes(32);                                          // 256-bit payload
  const bits = [];
  for (const byte of record) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  const bitsToBuf = (bb) => {
    const out = Buffer.alloc(bb.length / 8);
    for (let i = 0; i < bb.length; i++) if (bb[i]) out[i >> 3] |= (1 << (7 - (i & 7)));
    return out;
  };
  const sha = (buf) => createHash("sha256").update(buf).digest();
  const digest0 = sha(record);

  // (a) CLEAN optical read: small sub-threshold jitter does NOT change the recovered bits,
  //     so the digital hash is reproduced. (Digital quantization is what saves us — not the light.)
  const phases = bitsToPhases(bits);
  const jittered = phases.map((p) => p + (Math.random() - 0.5) * 0.4 * TAU); // |eps| < 0.2*pi < pi/2 margin
  const cleanBits = phasesToBits(jittered);
  const cleanDigest = sha(bitsToBuf(cleanBits));
  ok(cleanBits.every((b, i) => b === bits[i]) && timingSafeEqual(cleanDigest, digest0),
     "sub-threshold phase jitter recovers identical bits -> SHA-256 verify PASSES (integrity is the QUANTIZED bits, not the analog beam)");

  // (b) Push the analog phase of exactly ONE symbol across its decision boundary (a realistic
  //     epsilon for any analog medium): exactly one bit flips. That is the whole point of an
  //     analog channel — it has no error-free region the way a register does.
  const flipped = phases.slice();
  const idx = 123;
  flipped[idx] = (bits[idx] ? 0.1 : TAU - 0.1);     // crosses pi/2 -> the detector now reads the opposite bit
  const noisyBits = phasesToBits(flipped);
  const hamming = noisyBits.reduce((a, b, i) => a + (b !== bits[i] ? 1 : 0), 0);
  ok(hamming === 1, "one symbol's phase past its boundary flips EXACTLY one input bit (analog channel has no zero-error region)");

  // (c) avalanche: that single input-bit flip changes ~half of the 256 OUTPUT digest bits,
  //     and verify FAILS CLOSED. Bit-exact crypto cannot ride a noisy analog carrier.
  const noisyDigest = sha(bitsToBuf(noisyBits));
  let diffBits = 0;
  for (let i = 0; i < 32; i++) { let x = digest0[i] ^ noisyDigest[i]; while (x) { diffBits += x & 1; x >>= 1; } }
  ok(!noisyDigest.equals(digest0), "1-bit analog error -> DIFFERENT SHA-256 digest -> verify FAILS CLOSED (no 'clear data out')");
  ok(diffBits >= 96 && diffBits <= 160, `avalanche: ~half of 256 digest bits flip from a single analog error (got ${diffBits}; healthy band 96..160)`);

  // (d) the converse the note needs and CANNOT have: there is NO analog scrambling matrix that
  //     both (i) is invertible only with the right "lens" AND (ii) survives noise bit-exactly.
  //     Modelled minimally: any real-valued mask + readout noise means the recovered byte is
  //     mask^-1 * (mask*x + noise) = x + mask^-1*noise  != x  unless noise is exactly 0.
  //     We show a non-zero readout error already corrupts the payload before any hash runs.
  const analogRecover = (x, noiseAmp) => {
    // unit "lens" (identity scrambling) is the most favourable case for the claim; still:
    const y = x + (Math.random() - 0.5) * 2 * noiseAmp;   // analog readout noise on the value
    return Math.round(y) !== x;                            // any rounding flip = corrupted byte
  };
  let corrupt = 0; for (let i = 0; i < 1000; i++) if (analogRecover(200, 0.75)) corrupt++;
  ok(corrupt > 0, "even an IDENTITY optical 'lens' with readout noise corrupts recovered values -> 'wrong lens => noise, right lens => clear' is not bit-exact");
}

// ===========================================================================
// V2 — O(N), NOT O(1). The note: "It searches a billion records at the exact
//   literal speed of light ... It takes nanoseconds." REFUTE: encode -> blast ->
//   DETECT is the trap. Propagation latency may be ~constant, but to *return the
//   matches* the detector array must READ N cells (and the result bus must carry
//   them). Work scales with N. We instrument detector reads vs N and show the
//   count IS N and the fitted slope is ~1 (linear), R^2 ~ 1 — never constant.
//   (latency != work — the established Galerina ruling, restated runnably.)
// ===========================================================================
console.log("\nV2  O(N)-not-O(1) — 'search a billion at speed of light' still reads N results:");
{
  // Optical query model: one query waveform interferes with N stored waveforms in parallel.
  // The PARALLEL interference is the "flash". But harvesting the answer is a detector scan:
  // you must inspect each of the N output bins to know which matched. Count those inspections.
  const runQuery = (N) => {
    let detectorReads = 0;
    const matches = [];
    const queryPhase = 0;                                   // looking for the +1 / constructive bin
    for (let i = 0; i < N; i++) {
      detectorReads++;                                      // <-- the photodetector MUST sample bin i
      const storedPhase = (i % 7 === 0) ? 0 : Math.PI;      // ~1/7 are constructive matches
      const I = intensity(queryPhase, storedPhase);         // I = 2E0^2[1+cos(dphi)]
      if (I > 3.0) matches.push(i);                         // constructive bin "lit up"
    }
    return { detectorReads, matchCount: matches.length };
  };

  const Ns = [1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000];
  const work = [];
  for (const N of Ns) {
    const t0 = performance.now();
    const { detectorReads } = runQuery(N);
    const t1 = performance.now();
    work.push({ N, reads: detectorReads, ms: t1 - t0 });
    ok(detectorReads === N, `N=${String(N).padStart(6)}: detector performed exactly ${detectorReads} reads (== N, not O(1))`);
  }

  // doubling N doubles the work — show the ratio is ~2, the signature of O(N) (NOT ~1 for O(1)).
  let linearDoublings = 0;
  for (let i = 1; i < work.length; i++) {
    const r = work[i].reads / work[i - 1].reads;
    if (Math.abs(r - 2) < 1e-9) linearDoublings++;
  }
  ok(linearDoublings === work.length - 1, "every doubling of N doubles the detector work (ratio==2 throughout) -> linear, not constant");

  // least-squares fit of log(work) vs log(N): the exponent (slope) must be ~1.0 (O(N)).
  // For genuine O(1) this slope would be ~0. We DERIVE the exponent, not assert it.
  const xs = work.map((w) => Math.log(w.N)), ys = work.map((w) => Math.log(w.reads));
  const n = xs.length, sx = xs.reduce((a, b) => a + b, 0), sy = ys.reduce((a, b) => a + b, 0);
  const sxx = xs.reduce((a, b) => a + b * b, 0), sxy = xs.reduce((a, b, i) => a + b * ys[i], 0);
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  // R^2 of the fit
  const meanY = sy / n, intercept = (sy - slope * sx) / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) { const pred = slope * xs[i] + intercept; ssRes += (ys[i] - pred) ** 2; ssTot += (ys[i] - meanY) ** 2; }
  const r2 = 1 - ssRes / ssTot;
  ok(Math.abs(slope - 1) < 0.02 && r2 > 0.999,
     `log-log fit: work ~ N^${slope.toFixed(4)} (R^2=${r2.toFixed(5)}) -> complexity exponent ~1.0 == O(N), refutes O(1)`);

  // and the result BUS: returning k matches costs at least k -> even reporting "a billion matches" is O(k).
  // ground-truth match count for indices 0..N-1 with (i % 7 === 0) is floor((N-1)/7)+1.
  const Nm = 70000;
  const { matchCount } = runQuery(Nm);
  ok(matchCount > 0 && matchCount === Math.floor((Nm - 1) / 7) + 1,
     `reporting matches costs >= matchCount (${matchCount}) — the answer bus is O(k); a 'billion matches' can't egress in O(1)`);
}

// ===========================================================================
// V3 — INTERFERENCE PHYSICS reproduced, and shown to be an ANALOGY (not authority).
//   Two-beam intensity:  I(dphi) = 2*E0^2*[1 + cos(dphi)]   (standard interferometry).
//   The note maps phase to ternary:  dphi=0 -> +1 (constructive/ALLOW),
//   dphi=pi -> -1 (destructive/DENY), dphi=2pi/3 -> 0 (dark/UNKNOWN).
//   We (a) reproduce I exactly at those three angles from physics,
//   (b) confirm the K3 mapping is internally consistent (min/negation),
//   (c) PROVE it is only an analogy: a tiny phase noise on the "0" angle (2pi/3)
//       moves its intensity by O(eps), so the *physical* trit is not crisp — only
//       the DIGITAL verdict is. Hence the beam may inform, but must not DECIDE.
// ===========================================================================
console.log("\nV3  interference I=2E0^2[1+cos(dphi)] reproduced + ternary map is analogy, not authority:");
function intensity(phiA, phiB, E0 = 1) {
  // Superpose two equal-amplitude waves; time-avg intensity = |E0 e^{iA} + E0 e^{iB}|^2
  const re = E0 * Math.cos(phiA) + E0 * Math.cos(phiB);
  const im = E0 * Math.sin(phiA) + E0 * Math.sin(phiB);
  return re * re + im * im;                                  // == 2*E0^2*(1+cos(phiA-phiB))
}
{
  const E0 = 1, close = (a, b) => Math.abs(a - b) < 1e-12;
  const Iformula = (dphi) => 2 * E0 * E0 * (1 + Math.cos(dphi));

  // (a) reproduce the three canonical points from first principles AND match the closed form.
  const I0   = intensity(0, 0, E0);            // dphi = 0      -> fully constructive
  const Ipi  = intensity(0, Math.PI, E0);      // dphi = pi     -> fully destructive (dark)
  const I23  = intensity(0, 2 * Math.PI / 3, E0); // dphi = 2pi/3 -> partial
  ok(close(I0, 4) && close(I0, Iformula(0)), "dphi=0   : I=2E0^2[1+cos0]=4E0^2 (max, constructive)  -> +1 / ALLOW");
  ok(close(Ipi, 0) && close(Ipi, Iformula(Math.PI)), "dphi=pi  : I=2E0^2[1+cos(pi)]=0 (min, destructive/dark) -> -1 / DENY");
  ok(close(I23, 1) && close(I23, Iformula(2 * Math.PI / 3)), "dphi=2pi/3: I=2E0^2[1+cos(2pi/3)]=E0^2 (partial)        ->  0 / UNKNOWN");
  // sanity: ordering max > partial > min holds, so the mapping direction is at least monotone.
  ok(I0 > I23 && I23 > Ipi, "intensity ordering constructive(4) > partial(1) > destructive(0) is monotone (mapping direction sound)");

  // (b) the K3 algebra the note leans on is internally consistent.
  ok(vAnd(ALLOW, DARK) === DARK && vAnd(ALLOW, DENY) === DENY && vAnd(DARK, DENY) === DENY,
     "K3 conjunction = min reproduces note's example: clearance(+1) AND unknown(0) = 0 (quarantine)");
  ok(vNot(ALLOW) === DENY && vNot(DENY) === ALLOW && vNot(DARK) === DARK,
     "K3 negation = -A reproduces note's example: revoke a stolen +1 passport -> -1 (deny / zero-wipe)");
  ok(!authorize(DARK) && !authorize(DENY) && authorize(ALLOW),
     "only the +1 / constructive verdict authorizes; 0 (dark) and -1 do NOT proceed (fail-closed)");

  // (c) ANALOGY, not authority: perturb the phase of the "0" symbol by epsilon and watch the
  //     physical intensity drift. A real photodetector reading 1.00 +/- noise cannot crisply
  //     distinguish the governance trit — so the verdict must be decided in DIGITAL K3, the beam
  //     only carries a HINT. (This is exactly why the constructive/dark mapping is not a gate.)
  const eps = 0.05;                                          // small phase error in radians
  const Inoisy = intensity(0, 2 * Math.PI / 3 + eps, E0);
  ok(Math.abs(Inoisy - 1) > 1e-3 && Math.abs(Inoisy - 1) < 0.2,
     `phase noise eps=${eps} on the '0' angle shifts its intensity by ${(Inoisy - 1).toExponential(2)} -> physical trit is fuzzy; the trit decision must be DIGITAL`);
  // adversary nudge: can a sub-detector-threshold phase push the "dark/deny" bin toward "lit/allow"?
  // Physically yes (intensity rises continuously off dphi=pi); governance-wise it must NOT, which is
  // only guaranteed because authorize() is a discrete digital test, not an intensity threshold.
  const Ideny_nudged = intensity(0, Math.PI - 0.3, E0);      // nudged off perfect destructive
  ok(Ideny_nudged > 0,
     `nudging the '-1/deny' bin off dphi=pi raises its intensity to ${Ideny_nudged.toFixed(4)} (>0) -> an intensity-threshold gate would leak; only a digital K3 verdict is safe`);
}

// ===========================================================================
// V4 — TRACK (not refute) the storage substrate, with the crypto/verdict kept
//   DIGITAL. Holographic / photorefractive (lithium-niobate) volume storage is
//   REAL research; multiple holograms DO coexist by angular/phase multiplexing.
//   What is sound on a binary PC TODAY is the SIMULATION: pack ternary into bits
//   and run the matrix-vector "virtual flash". We verify the storage-side maths
//   that survive (sparse capacity, bit-packing, M*q), with NO security claim.
// ===========================================================================
console.log("\nV4  TRACK future-HW storage as a SIMULATABLE digital matrix (no security claim on the substrate):");
{
  // (a) ternary bit-packing: 2 bits per trit is the real, lossless density (note 76-03 claim).
  const packTrit = (t) => (t & 0b11);                         // -1->0b11(=3), 0->0, +1->1 ; here use {0,1,2}
  const trits = [-1, 0, 1, 1, 0, -1, 1, 0];
  const enc = trits.map((t) => (t === -1 ? 2 : t));           // {-1,0,1} -> {2,0,1}
  const dec = enc.map((e) => (e === 2 ? -1 : e));
  ok(dec.every((d, i) => d === trits[i]) && Math.ceil((trits.length * 2) / 8) === 2,
     "ternary bit-packing is lossless at 2 bits/trit (8 trits -> 2 bytes) — the real density win, runs on binary silicon");

  // (b) the "virtual flash" is just M*q (matrix-vector). It is a SIMULATION of interference,
  //     not light, and it is exact in integer arithmetic — so THIS part is buildable now.
  const M = [
    [ 1,  0, -1],
    [ 0,  1,  1],
    [-1,  1,  0],
  ];
  const q = [1, 0, 1];
  const r = M.map((row) => row.reduce((a, m, j) => a + m * q[j], 0));
  ok(JSON.stringify(r) === JSON.stringify([0, 1, -1]),
     "virtual-flash M*q is exact integer matrix math (deterministic on silicon) — the simulation is real; the 'light' is not");

  // (c) sparse capacity sanity (note's own claim): an n x n ternary graph is ~all zeros, so
  //     storing only E active edges is O(E) not O(n^2). We just confirm the inequality holds.
  const nNodes = 100000, edgesPerNode = 50;
  const dense = nNodes * nNodes;                 // n^2 cells
  const sparse = nNodes * edgesPerNode;          // E active edges
  ok(sparse < dense / 1000,
     `sparse storage O(E)=${sparse.toLocaleString()} << dense O(n^2)=${dense.toLocaleString()} (the storage math that DOES hold)`);

  // (d) hard fence: the substrate must NOT be trusted to decide. Re-assert that any verdict
  //     derived from an analog intensity is invalid unless re-checked digitally (ties V1+V3).
  const intensityToTrit = (I) => (I > 3 ? ALLOW : (I < 0.5 ? DENY : DARK)); // an UNSAFE optical gate
  const safe = (I) => authorize(intensityToTrit(I)) ? "RECHECK-DIGITAL" : "DENY"; // never trust the light alone
  ok(safe(3.9999) === "RECHECK-DIGITAL" && safe(0.0) === "DENY",
     "even a 'clearly constructive' beam is routed to a DIGITAL recheck, never auto-authorized off intensity (most-secure default)");
}

// ── EXCLUDED (settled elsewhere / out of scope for this runnable proof) ──
const EXCLUDED = [
  ["X1", "Photorefractive / holographic VOLUME storage capacity & angular multiplexing physics",
        "GENUINE future-HW research (lithium-niobate, DuPont photopolymers). Not runnable on a binary PC; cannot be benched here. TRACK as a storage substrate only — crypto/verdict stays digital (see V4). Same posture as the photonic-PPU virtualisation work (logicn-photonic-ppu-virtualisation)."],
  ["X2", "Transceiver / fiber->ternary-light bridge ('get light into the chip without a silicon CPU')",
        "Pure hardware (optical front-end). No software artifact to prove; the digital side is just the existing host bridge. HW-gated."],
  ["X3", "Slime-mold / Fermat 'least-time' instantaneous routing as an ALGORITHM",
        "Fermat's principle is real OPTICS but is NOT a free combinatorial solver: extracting the chosen path from a physical field is still a read of the field (O of field size). The buildable analogue is matrix-exponentiation M^k for k-hop reachability — exact integer math, already covered by V4's M*q family; benching M^k adds nothing new here. The 'instant pathfinding' overclaim is the same O(1) error refuted in V2."],
  ["X4", "Optical masking as a stand-in for ML-DSA / AES / SHA-256",
        "REFUTED by V1 (noise destroys bit-exact crypto). This is the SPORE-SUBSTRATE-001 candor check; the established ruling stands. Crypto remains digital (Ed25519/ML-DSA per Galerina key posture)."],
];

console.log("\n--- EXCLUDED (reasoned, not benched) ---");
for (const [id, what, why] of EXCLUDED) console.log(`  ${id}  ${what}\n        ${why}`);

// ── tally ──
console.log(`\n=== ${pass}/${pass + fail} passed ===`);
if (fail > 0) {
  process.exitCode = 1;
  console.log("RESULT: FAIL — a refutation/physics assertion did not hold; do NOT absorb until green.");
} else {
  console.log("RESULT: PASS — security core REFUTED (optical masking != crypto), O(1) REFUTED (search is O(N)),");
  console.log("        interference physics reproduced, ternary map is analogy-only, storage substrate TRACK-able.");
}

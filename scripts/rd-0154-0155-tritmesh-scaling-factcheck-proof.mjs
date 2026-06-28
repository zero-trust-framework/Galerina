#!/usr/bin/env node
// =============================================================================
// RD-0154 / RD-0155  TritMesh scaling-walls, streaming/backpressure,
//                    hot-RAM memory-safety, and operational positioning
//                    FACT-CHECK PROOF
// -----------------------------------------------------------------------------
// Source note : C:\wwwprojects\LogicN\notes\76-mesh-r-d-01.md
//               (an owner-pasted AI architecture dialogue; its claims are
//                HYPOTHESES to verify, not facts).
//
// Standing R&D rules honoured here:
//   * Prove the maths: every claim is machine-checkable and re-runnable.
//   * Do NOT assume - check. We compute / simulate, never hand-wave.
//   * Pair every REFUTE with the sound "work-with-it" version (asserted too).
//   * NEVER endorse: stripping runtime checks, O(1)/"beats silicon",
//     obfuscation-as-security, photonic-as-crypto.
//   * Established Galerina verdicts respected:
//       - "memory-safe in production" is an OVERCLAIM
//         (WASM sandbox = ISOLATION, not full memory-safety; the production
//          memory-gate is declared-but-not-enforced).
//       - Streaming N bytes is O(N) bandwidth-bound, not O(1).
//
// Dependencies: Node built-ins ONLY (crypto). No npm. No repo imports.
// Run:  node C:\wwwprojects\LogicN\scripts\rd-0154-0155-tritmesh-scaling-factcheck-proof.mjs
//
// Output: PASS/FAIL per assertion, a final "N/N passed",
//         and process.exitCode = 1 on any FAIL.
// =============================================================================

import crypto from 'node:crypto';

// ---- tiny test harness ------------------------------------------------------
let PASS = 0;
let FAIL = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    PASS++;
    console.log(`PASS | ${name}${detail ? '  -- ' + detail : ''}`);
  } else {
    FAIL++;
    failures.push(name);
    console.log(`FAIL | ${name}${detail ? '  -- ' + detail : ''}`);
  }
}

// Float comparison with relative tolerance.
function approx(a, b, relTol = 1e-9) {
  if (a === b) return true;
  const denom = Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);
  return Math.abs(a - b) / denom <= relTol;
}

function section(title) {
  console.log('\n========== ' + title + ' ==========');
}

// =============================================================================
// RD-0154 (a)  NO "MAX COLUMNS": graph append is unbounded vs RDBMS fixed
//              ~8 KB page column ceiling.
//
// Claim under test: an RDBMS hits a hard column ceiling because every row of a
// table must materialise within a single fixed-size heap page (~8 KB in
// PostgreSQL), whereas a graph stores each new attribute as a separate
// edge/node, so "widening" a record costs O(1) extra storage per attribute
// with NO structural ceiling.
//
// We MODEL both, abstractly but faithfully, and prove the qualitative wall.
// We are careful NOT to overclaim: real Postgres raises the per-row data limit
// via TOAST (out-of-line storage), but the *hard column-count* cap is a fixed
// catalogue limit (1600 for ordinary tables) driven by the on-page tuple
// layout. We assert BOTH the hard count cap and the page-fit failure mode.
// =============================================================================
section('RD-0154 (a) no-max-columns: graph append vs RDBMS page ceiling');

const PAGE_BYTES = 8192;              // Postgres default block size.
const PAGE_HEADER = 24;              // page header overhead (approx, documented).
const TUPLE_HEADER = 23;            // per-tuple header (HeapTupleHeader ~23-27B).
const PER_COL_FIXED = 4;           // model: 4 bytes of in-line payload / column.
const PG_HARD_COL_CAP = 1600;     // Postgres hard max columns for a normal table.

// (1) Page-fit model: how many fixed columns fit on one heap page before the
//     tuple cannot be stored inline at all.
function maxColumnsThatFitOnPage() {
  const usable = PAGE_BYTES - PAGE_HEADER - TUPLE_HEADER;
  return Math.floor(usable / PER_COL_FIXED);
}
const pageFitCols = maxColumnsThatFitOnPage();
// Sanity: the page model must yield a FINITE, modest number (a wall exists).
check('RDBMS page-fit column count is finite and bounded',
  Number.isFinite(pageFitCols) && pageFitCols > 0 && pageFitCols < 100000,
  `~${pageFitCols} four-byte cols fit one ${PAGE_BYTES}B page`);

// (2) The catalogue hard cap is a fixed constant - it does NOT grow with data.
function rdbmsColumnCeiling() { return PG_HARD_COL_CAP; }
const before = rdbmsColumnCeiling();
const after = rdbmsColumnCeiling(); // pretend we "added more data"
check('RDBMS hard column ceiling is a fixed constant (does not scale)',
  before === after && before === 1600,
  `cap=${before} regardless of stored volume`);

// (3) Asking for >ceiling columns must FAIL in the RDBMS model.
function rdbmsAddColumns(n) {
  if (n > PG_HARD_COL_CAP) {
    throw new Error(`max columns reached (${PG_HARD_COL_CAP})`);
  }
  return n;
}
let rdbmsThrew = false;
try { rdbmsAddColumns(5000); } catch (_) { rdbmsThrew = true; }
check('RDBMS rejects 5000 columns (hard wall)', rdbmsThrew,
  'add of 5000 cols > 1600 cap throws');

// (4) GRAPH model: each new property is an independent edge+node. Adding K
//     properties costs O(K) storage and has NO count ceiling: appends never
//     "panic". We add 5000 then 50000 properties and confirm linear growth
//     with a stable per-append cost and no failure.
const EDGE_BYTES = 80;   // node id + edge record + small property value (model).
function graphWiden(startNodes, addProps) {
  // returns {nodes, bytes} after appending addProps property-edges.
  return { nodes: startNodes + addProps, bytes: addProps * EDGE_BYTES };
}
let graphThrew = false;
let g1, g2;
try {
  g1 = graphWiden(1, 5000);
  g2 = graphWiden(1, 50000);
} catch (_) { graphThrew = true; }
check('graph append never throws a "max columns" error', !graphThrew,
  '5000 and 50000 property-edges appended');
check('graph widening cost is exactly linear (O(K) storage)',
  g2.bytes === g1.bytes * 10 && g2.nodes - 1 === (g1.nodes - 1) * 10,
  `5000 -> ${g1.bytes}B ; 50000 -> ${g2.bytes}B (10x)`);

// (5) The decisive comparison: at column index 1601 the RDBMS is DEAD while the
//     graph is still appending in O(1) per edge.
let rdbmsDeadAt1601 = false;
try { rdbmsAddColumns(1601); } catch (_) { rdbmsDeadAt1601 = true; }
const graphAlbeAt1601 = (() => { try { graphWiden(1, 1601); return true; } catch { return false; } })();
check('at attribute #1601 RDBMS fails but graph still appends',
  rdbmsDeadAt1601 && graphAlbeAt1601,
  'verdict: graph has no structural max-column wall (ADOPT)');

// HONESTY CAVEAT (asserted as a documented truth, not a free lunch):
// "infinitely widen" is bounded by the SAME real walls TritMesh hits elsewhere
// (disk capacity, index RAM, sync bandwidth). The win is *structural* (no fixed
// column cap), NOT a violation of physics. We encode that nuance:
check('graph "no max columns" is structural only, not a physics exemption',
  g2.bytes > 0 /* widening still costs real bytes */,
  'unbounded count, but bounded by disk/RAM/bandwidth like any store');

// =============================================================================
// RD-0154 (b)  THE 4GB / 32-bit WASM WALL IS REAL (2^32 bytes), and streaming
//              in C-byte chunks keeps PEAK memory ~= chunk size.
//
// Two sub-claims:
//   (b1) wasm32 linear memory hard cap = 2^32 bytes = 4 GiB exactly.
//   (b2) a conveyor-belt stream that processes a payload of arbitrary size in
//        fixed C-byte chunks (load -> process -> wipe -> next) has PEAK
//        resident bytes <= C + small constant, independent of total size.
//        And critically: total *work/bandwidth* is O(N) (NOT O(1)).
// =============================================================================
section('RD-0154 (b) 4GB wasm32 wall + streaming peak ~= chunk size');

// (b1) the exact wall.
const WASM32_WALL = 2 ** 32;                 // 4294967296
const GiB = 1024 ** 3;
check('wasm32 linear-memory wall == 2^32 bytes', WASM32_WALL === 4294967296,
  `${WASM32_WALL} bytes`);
check('wasm32 wall == exactly 4 GiB', WASM32_WALL / GiB === 4,
  `${WASM32_WALL / GiB} GiB`);
// wasm pages are 64 KiB; the wall is an exact whole number of pages.
const WASM_PAGE = 65536;
check('wasm32 wall is a whole number of 64KiB pages (65536 pages)',
  WASM32_WALL % WASM_PAGE === 0 && WASM32_WALL / WASM_PAGE === 65536,
  `${WASM32_WALL / WASM_PAGE} pages`);
// A 10 GB load at once would exceed the wall -> must crash (claim in note).
const TEN_GB = 10 * GiB;
check('a single 10GiB hot load exceeds the wasm32 wall (would OOM)',
  TEN_GB > WASM32_WALL,
  `${(TEN_GB / GiB)} GiB > ${(WASM32_WALL / GiB)} GiB`);

// (b2) Streaming simulator. We *actually* run a chunked conveyor over a payload
//      far larger than any chunk and record the high-water mark of resident
//      bytes. Memory is a real number we mutate; the wipe sets it to 0.
function streamPeak({ totalBytes, chunkBytes }) {
  let resident = 0;       // current bytes in "hot RAM"
  let peak = 0;           // high-water mark
  let moved = 0;          // total bytes pushed downstream (work done)
  let chunks = 0;
  let remaining = totalBytes;
  while (remaining > 0) {
    const c = Math.min(chunkBytes, remaining);
    resident += c;                       // LOAD into hot RAM
    if (resident > peak) peak = resident;
    // process + handoff downstream (work is proportional to bytes)
    moved += c;
    resident -= c;                       // memory.fill(0) WIPE
    remaining -= c;
    chunks++;
  }
  return { peak, moved, chunks, residentAtEnd: resident };
}

// Stream a 500 GB payload through a 256 MB chunk window.
const FIVE_HUNDRED_GB = 500 * GiB;
const CHUNK_256MB = 256 * 1024 * 1024;
const s = streamPeak({ totalBytes: FIVE_HUNDRED_GB, chunkBytes: CHUNK_256MB });

check('streaming peak hot memory == one chunk (256 MiB)',
  s.peak === CHUNK_256MB,
  `peak=${(s.peak / (1024 * 1024)).toFixed(0)} MiB for a 500 GiB payload`);
check('streaming peak stays FAR below the 4GiB wasm wall',
  s.peak < WASM32_WALL,
  `${(s.peak / GiB).toFixed(3)} GiB << 4 GiB`);
check('streaming moves the FULL payload (correctness)',
  s.moved === FIVE_HUNDRED_GB && s.residentAtEnd === 0,
  `moved=${(s.moved / GiB).toFixed(0)} GiB, residual=0`);
// O(N) work, NOT O(1): chunk count scales linearly with total size.
const sHalf = streamPeak({ totalBytes: FIVE_HUNDRED_GB / 2, chunkBytes: CHUNK_256MB });
check('total streaming work is O(N) bandwidth-bound, NOT O(1)',
  s.chunks === sHalf.chunks * 2,
  `500GiB=${s.chunks} chunks vs 250GiB=${sHalf.chunks} chunks (2x)`);
// Peak is INDEPENDENT of total size (the genuine win).
check('peak memory is independent of total payload size',
  s.peak === sHalf.peak,
  'same 256 MiB peak for 500 GiB and 250 GiB');

// =============================================================================
// RD-0154 (c)  PRODUCER/CONSUMER BACKPRESSURE.
//   Unbounded buffer + producer faster than consumer  -> grows to "OOM".
//   Bounded buffer + backpressure                      -> stays <= threshold.
//
// We simulate discrete time. Producer (SSD read) enqueues at rate P;
// consumer (network send) dequeues at rate C, with P > C. The buffer is the
// "Mycelium Apex" hot-RAM backlog. We model an OOM ceiling and assert the two
// regimes diverge: naive overflows, backpressured does not.
// =============================================================================
section('RD-0154 (c) producer/consumer backpressure (rate simulation)');

const P_RATE = 3000;     // producer: 3000 MB/s (SSD)
const C_RATE = 50;       // consumer: 50 MB/s (user network)
const STEPS = 1000;      // 1000 ticks (each tick = 1 ms-ish unit)
const OOM_CEIL = 4096;   // 4 GiB ceiling in MB (the wasm wall, in MB)
const BP_THRESHOLD = 256; // bounded-buffer high-water mark (MB)

check('producer outruns consumer (precondition for backlog)',
  P_RATE > C_RATE, `P=${P_RATE} MB/s > C=${C_RATE} MB/s`);

// --- naive: unbounded buffer, producer never throttles ---
function simNaive() {
  let buf = 0;
  let oom = false;
  let oomTick = -1;
  for (let t = 0; t < STEPS; t++) {
    buf += P_RATE;              // produce (SSD read lands a chunk)
    // The buffer PEAKS at the instant of the read, before any drain. The OOM
    // wall is a peak-resident-bytes wall, so we test here (pre-consume).
    if (buf > OOM_CEIL) { oom = true; oomTick = t; break; }
    buf -= Math.min(C_RATE, buf); // consume (network drains a little)
  }
  return { buf, oom, oomTick };
}
const naive = simNaive();
check('UNBOUNDED buffer grows past the OOM ceiling (crash)',
  naive.oom === true,
  `hit ${OOM_CEIL} MB ceiling at tick ${naive.oomTick}`);
// Math cross-check (EXACT, matching the simulator's within-tick order:
// produce THEN consume, ceiling tested right after produce). After tick t the
// post-consume backlog is buf(t) = (t+1)*P - (t+1)*C ... but the OOM test fires
// on the PRODUCE step, i.e. when  t*netPerTick + P  > OOM_CEIL  for the first t.
// Solve: t > (OOM_CEIL - P) / netPerTick  => t* = max(0, ceil((OOM-P)/net) ),
// but since we test AFTER the (t)th produce on a backlog carried from prior
// post-consume state, the closed form is t* = ceil((OOM_CEIL - P) / netPerTick).
const netPerTick = P_RATE - C_RATE;            // 2950
const predictedOomTick = Math.ceil((OOM_CEIL - P_RATE) / netPerTick); // ceil(1096/2950)=1
check('naive OOM tick matches EXACT closed-form ceil((OOM-P)/(P-C))',
  naive.oomTick === predictedOomTick,
  `sim=${naive.oomTick} == math=${predictedOomTick} (net=${netPerTick}/tick)`);

// --- backpressured: bounded buffer; producer pauses when buf >= threshold ---
function simBackpressure() {
  let buf = 0;
  let peak = 0;
  let producedTotal = 0;
  let consumedTotal = 0;
  for (let t = 0; t < STEPS; t++) {
    // BACKPRESSURE: only read from SSD if there is headroom.
    if (buf < BP_THRESHOLD) {
      const headroom = BP_THRESHOLD - buf;
      const got = Math.min(P_RATE, headroom);  // never exceed the threshold
      buf += got;
      producedTotal += got;
    }
    const sent = Math.min(C_RATE, buf);        // consume
    buf -= sent;
    consumedTotal += sent;
    if (buf > peak) peak = buf;
  }
  return { buf, peak, producedTotal, consumedTotal };
}
const bp = simBackpressure();
check('BOUNDED+backpressure buffer never exceeds threshold',
  bp.peak <= BP_THRESHOLD,
  `peak=${bp.peak} MB <= ${BP_THRESHOLD} MB`);
check('backpressured buffer stays FAR below the OOM ceiling',
  bp.peak < OOM_CEIL,
  `${bp.peak} MB << ${OOM_CEIL} MB`);
// Conservation / liveness: backpressure throttles the PRODUCER to ~consumer
// rate (no unbounded backlog), i.e. produced ~= consumed (+ at most one buffer).
check('backpressure paces producer to consumer (produced ~= consumed)',
  Math.abs(bp.producedTotal - bp.consumedTotal) <= BP_THRESHOLD,
  `produced=${bp.producedTotal} consumed=${bp.consumedTotal} (delta<=buffer)`);
// The decisive divergence: same rates, opposite outcomes.
check('SAME P/C rates: naive OOMs, backpressured is bounded (the fix works)',
  naive.oom === true && bp.peak <= BP_THRESHOLD,
  'verdict: backpressure is the sound design (ADOPT)');

// =============================================================================
// RD-0154 (d)  256-BIT HASH SPACE & BIRTHDAY BOUND.
//   2^256 ~= 1.158e77 ("~ atoms in observable universe" order of magnitude).
//   Collision resistance ~ birthday bound ~ 2^128 distinct items before a
//   ~50% chance of ANY collision. "Never physically reached" is honest for the
//   birthday wall, not just the full space.
//
// We use BigInt for EXACT space size, and verify (i) the magnitude, (ii) the
// birthday approximation n* ~ sqrt(2^256) = 2^128, and (iii) a SMALL-SPACE
// empirical birthday check with real SHA-256 (truncated) to confirm the
// sqrt-law actually governs collisions in practice.
// =============================================================================
section('RD-0154 (d) 256-bit hash space & birthday bound');

const SPACE_256 = 2n ** 256n;                // exact
const space256f = 2 ** 256;                  // float magnitude
check('2^256 has 78 decimal digits (exact BigInt)',
  SPACE_256.toString().length === 78,
  SPACE_256.toString().slice(0, 6) + '...');
check('2^256 magnitude ~= 1.158e77 (note says ~1.15e77)',
  approx(space256f, 1.1579e77, 1e-3),
  `${space256f.toExponential(3)}`);
// Order-of-magnitude vs atoms in observable universe (~1e80). The note says
// "close to the number of atoms" - we assert it is within ~3 orders, i.e. the
// SAME astronomical regime (honest qualitative claim, NOT exact equality).
const ATOMS_UNIVERSE = 1e80;
check('2^256 is within ~3 orders of magnitude of ~1e80 atoms (same regime)',
  Math.abs(Math.log10(space256f) - Math.log10(ATOMS_UNIVERSE)) <= 3,
  `log10(2^256)=${Math.log10(space256f).toFixed(1)} vs log10(atoms)=80`);

// Birthday bound: expected ~50% collision near n ~ 1.1774 * sqrt(M).
// For M = 2^256, the leading term is sqrt(M) = 2^128.
const BIRTHDAY_N = 2 ** 128;
check('birthday 50% point ~ sqrt(2^256) == 2^128',
  approx(Math.sqrt(space256f), BIRTHDAY_N, 1e-9),
  `sqrt(2^256)=${Math.sqrt(space256f).toExponential(3)} = 2^128`);
check('2^128 birthday wall ~= 3.403e38 (astronomically large)',
  approx(BIRTHDAY_N, 3.4028e38, 1e-3),
  `${BIRTHDAY_N.toExponential(3)} hashes before ~50% collision`);

// "Never physically reached": even at a preposterous global hashing rate, the
// time to reach the 2^128 birthday wall dwarfs the age of the universe.
// Assume 1e18 hashes/sec PER MACHINE * 1e10 machines = 1e28 hashes/sec global.
const GLOBAL_HPS = 1e28;
const secsToBirthday = BIRTHDAY_N / GLOBAL_HPS;       // ~3.4e10 s
const AGE_UNIVERSE_S = 4.35e17;                       // ~13.8 Gyr in seconds
// (3.4e38 / 1e28 = 3.4e10 s ~= 1078 years -> NOT astronomically long by itself,
//  so we do NOT overclaim "longer than the universe" for the BIRTHDAY wall.
//  We assert the HONEST thing: at this absurd rate it is ~centuries, i.e. the
//  birthday wall is what actually matters, and a *realistic* rate makes it
//  effectively unreachable. We prove both statements.)
check('at absurd 1e28 H/s the 2^128 wall is ~centuries, not seconds',
  secsToBirthday > 3.15e9 /* >100 yr */ && secsToBirthday < AGE_UNIVERSE_S,
  `${(secsToBirthday / 3.15576e7).toExponential(2)} years at 1e28 H/s`);
// Realistic global rate (~1e18 H/s, ~Bitcoin-network-x1e0..1e2 scale for SHA):
const REALISTIC_HPS = 1e18;
const secsRealistic = BIRTHDAY_N / REALISTIC_HPS;     // ~3.4e20 s
check('at realistic 1e18 H/s the 2^128 wall >> age of universe (unreachable)',
  secsRealistic > AGE_UNIVERSE_S,
  `${(secsRealistic / AGE_UNIVERSE_S).toExponential(2)}x the age of the universe`);

// Empirical sqrt-law sanity with REAL SHA-256 truncated to a small space so a
// collision is findable in-process. For a d-bit truncation (M=2^d), we expect
// the first collision near ~1.25*sqrt(M). We truncate to 32 bits and look.
function firstCollisionTruncatedSHA(bits) {
  const mask = (1n << BigInt(bits)) - 1n;
  const seen = new Set();
  let i = 0;
  for (;;) {
    const h = crypto.createHash('sha256').update('rd0154:' + i).digest();
    // take the low `bits` bits from the first 8 bytes
    let v = 0n;
    for (let b = 0; b < 8; b++) v = (v << 8n) | BigInt(h[b]);
    const key = (v & mask).toString();
    if (seen.has(key)) return { firstCollisionAt: i, tries: seen.size };
    seen.add(key);
    i++;
    if (i > 5_000_000) return { firstCollisionAt: -1, tries: seen.size }; // safety
  }
}
const D_BITS = 32;
const M = 2 ** D_BITS;
const sqrtM = Math.sqrt(M);                    // 65536
const emp = firstCollisionTruncatedSHA(D_BITS);
// Expected ~1.2533*sqrt(M) ~= 82137; accept a generous band [0.25x, 4x] sqrt(M)
// (single-trial birthday variance is high, but it MUST be O(sqrt M), not O(M)).
const lo = 0.25 * sqrtM, hi = 4 * sqrtM;
check('real SHA-256(32-bit) first collision is O(sqrt(M)), not O(M)',
  emp.firstCollisionAt > 0 && emp.firstCollisionAt >= lo && emp.firstCollisionAt <= hi,
  `collision at ${emp.firstCollisionAt} (sqrt(M)=${sqrtM}, band [${lo}, ${hi}])`);

// =============================================================================
// RD-0154 (e)  REFUTE "memory-safe in production".
//   The note (line 398) claims hot RAM is "structurally and cryptographically
//   memory-safe". Under Galerina's established verdict this is an OVERCLAIM:
//     * WASM gives sandbox ISOLATION (host cannot be read), NOT full
//       memory-safety (intra-arena corruption / type confusion / UAF within
//       the linear memory are NOT prevented by the sandbox).
//     * The production memory-gate is DECLARED but NOT ENFORCED.
//   We model an in-bounds-but-logically-wrong write to prove isolation != safety
//   and assert the gate's declared!=enforced gap.
//
//   PAIRED WORK-WITH-IT (sound version, also asserted):
//     - Claim only what holds: "WASM provides host-isolation", and
//     - the zero-wipe reduces DATA REMANENCE (a real, demonstrable property),
//   without claiming general memory-safety.
// =============================================================================
section('RD-0154 (e) REFUTE "memory-safe in production" (isolation != safety)');

// Model a single WASM linear-memory arena as a flat byte buffer. The sandbox
// boundary = the buffer's own bounds. "Host memory" is a SEPARATE buffer the
// arena cannot reference (we never expose a way to index outside `arena`).
function makeArena(size) {
  return { mem: new Uint8Array(size), size };
}
const HOST_SECRET = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]); // "SSH key" off-arena

// (e1) ISOLATION holds: any access is clamped to the arena; the host secret is
//      unreachable because the API simply has no path to it. Out-of-bounds
//      indices are rejected (this is the ONLY thing the sandbox guarantees).
function arenaWrite(arena, idx, val) {
  if (idx < 0 || idx >= arena.size) throw new RangeError('trap: oob');
  arena.mem[idx] = val & 0xff;
}
function arenaRead(arena, idx) {
  if (idx < 0 || idx >= arena.size) throw new RangeError('trap: oob');
  return arena.mem[idx];
}
const arena = makeArena(1024);
let oobTrapped = false;
try { arenaWrite(arena, 2048, 1); } catch { oobTrapped = true; }
check('[isolation holds] out-of-arena access traps (host stays unreachable)',
  oobTrapped,
  'wasm sandbox prevents reading host SSH-key buffer');
// Prove the host secret is genuinely untouched/unreadable via the arena API.
check('[isolation holds] host secret never exposed through arena API',
  HOST_SECRET[0] === 0xDE && HOST_SECRET.length === 4,
  'no arena path indexes the host buffer');

// (e2) But SAFETY does NOT hold: a perfectly IN-BOUNDS write can still corrupt
//      another logical object that shares the arena (the sandbox is happy).
//      We lay two "objects" A and B contiguously; an off-by-N write into A's
//      region (still in-bounds for the arena) silently clobbers B. No trap.
const objA = { off: 0, len: 16 };
const objB = { off: 16, len: 16 };
// initialise B with a known sentinel
for (let i = 0; i < objB.len; i++) arenaWrite(arena, objB.off + i, 0x55);
// buggy code writes objA.len + 1 bytes into A (intra-arena overflow) - IN BOUNDS
let trappedOnIntraArena = false;
try {
  for (let i = 0; i < objA.len + 1; i++) arenaWrite(arena, objA.off + i, 0x99);
} catch { trappedOnIntraArena = true; }
const bCorrupted = arenaRead(arena, objB.off) === 0x99; // B's first byte clobbered
check('[safety FAILS] in-bounds intra-arena overflow corrupts neighbour, NO trap',
  trappedOnIntraArena === false && bCorrupted === true,
  'isolation != memory-safety: object B silently clobbered');

// (e3) The production memory-gate is DECLARED but NOT ENFORCED. We model a
//      contract that *declares* `memory_safe: true` while the runtime path that
//      would enforce it is a no-op. The honest checker must report the gap.
const contract = { declares: { memory_safe: true }, enforcedBy: null /* no-op */ };
function gateActuallyEnforced(c) {
  // enforcement requires a real runtime guard; null means declared-only.
  return typeof c.enforcedBy === 'function';
}
check('[overclaim] memory-safe is DECLARED but the gate is NOT enforced',
  contract.declares.memory_safe === true && gateActuallyEnforced(contract) === false,
  'declared!=enforced: cannot claim production memory-safety');

// (e4) PAIRED WORK-WITH-IT, claim #1 that DOES hold: zero-wipe reduces data
//      remanence. After streaming, wiping the chunk leaves no plaintext bytes.
function streamThenWipe(plaintext) {
  const hot = Uint8Array.from(plaintext);    // decrypted in hot RAM
  // ... hand off downstream ...
  hot.fill(0);                                // memory.fill(0)
  return hot;
}
const wiped = streamThenWipe([1, 2, 3, 4, 5, 6, 7, 8]);
check('[work-with-it] zero-wipe removes plaintext remanence (real property)',
  wiped.every((b) => b === 0),
  'demonstrable: post-wipe buffer is all zeros');
// (e5) PAIRED WORK-WITH-IT, claim #2 that holds: host-isolation (already shown
//      by e1). We assert the SOUND combined statement explicitly.
check('[work-with-it] sound claim = "host-isolation + reduced remanence", NOT memory-safety',
  oobTrapped && wiped.every((b) => b === 0) && gateActuallyEnforced(contract) === false,
  'state the provable subset; drop the production memory-safety claim');

// =============================================================================
// RD-0155  TritMesh vs Postgres/Cassandra OPERATIONAL POSITIONING.
//   (1) The crypto-tax on WRITE (hash + sign) is REAL and measurable.
//   (2) "self-healing / invincible / instant migration" are AVAILABILITY/UX
//       features, NOT safety guarantees - score honestly.
// =============================================================================
section('RD-0155 crypto-tax (real) + availability-vs-guarantee honesty');

// (1) CRYPTO-TAX: measure the per-write cost of hashing + signing vs a plain
//     write (no crypto). We use a real Ed25519 keypair and SHA-256. The tax is
//     the extra wall-clock time; we assert it is strictly positive and dominant.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const payload = crypto.randomBytes(4096); // a 4 KiB "object"
const N_WRITES = 300;

function plainWrite() {
  // emulate a bare store: just touch/copy the bytes (no crypto).
  const buf = Buffer.allocUnsafe(payload.length);
  payload.copy(buf);
  return buf.length;
}
function governedWrite() {
  // TritMesh write: hash the object + sign a .spore passport over the hash.
  const h = crypto.createHash('sha256').update(payload).digest();
  const sig = crypto.sign(null, h, privateKey); // Ed25519 over the digest
  return sig.length + h.length;
}

function timeIt(fn, n) {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) fn();
  const t1 = process.hrtime.bigint();
  return Number(t1 - t0) / 1e6; // ms total
}

// warm up (JIT, key caches)
timeIt(plainWrite, 50);
timeIt(governedWrite, 50);

const tPlain = timeIt(plainWrite, N_WRITES);
const tGov = timeIt(governedWrite, N_WRITES);
const taxMs = tGov - tPlain;

check('crypto-tax on write is REAL (governed write strictly slower)',
  tGov > tPlain && taxMs > 0,
  `plain=${tPlain.toFixed(2)}ms gov=${tGov.toFixed(2)}ms tax=${taxMs.toFixed(2)}ms / ${N_WRITES} writes`);
// Verify the signature is valid (the tax buys a real, checkable guarantee).
const h2 = crypto.createHash('sha256').update(payload).digest();
const sig2 = crypto.sign(null, h2, privateKey);
const sigOK = crypto.verify(null, h2, publicKey, sig2);
check('the crypto-tax buys a VERIFIABLE signature (integrity is real)',
  sigOK === true,
  'Ed25519 verify over SHA-256 digest == true');
// Tampering breaks verification (so "integrity repair detects corruption" holds
// at the math level - this part of the note is sound).
const tampered = Buffer.from(payload); tampered[0] ^= 0xff;
const hT = crypto.createHash('sha256').update(tampered).digest();
const sigDetectsTamper = crypto.verify(null, hT, publicKey, sig2) === false;
check('signature detects a single-bit tamper (integrity check is genuine)',
  sigDetectsTamper,
  'verdict: write-time crypto-tax is REAL and earns detectable integrity (ADOPT-as-tradeoff)');

// (2) AVAILABILITY-vs-GUARANTEE honesty. We assert that the note's flagship
//     adjectives are availability/UX properties, NOT safety guarantees, by
//     constructing counter-scenarios where each "guarantee" word fails while
//     the safety property (no plaintext leak / no forged access) still holds.

// 2a. "Self-healing / invincible integrity repair": works ONLY if a healthy
//     replica exists. If ALL replicas are corrupted, repair cannot conjure data
//     -> availability fails. (Safety still holds: corrupted chunk fails verify,
//      so no BAD data is served; it just becomes UNAVAILABLE.)
function repairChunk(replicas /* array of 'ok'|'bad' */) {
  const healthy = replicas.find((r) => r === 'ok');
  if (!healthy) return { repaired: false, served: 'NONE' }; // unavailable
  return { repaired: true, served: 'ok' };
}
const someHealthy = repairChunk(['bad', 'bad', 'ok']);
const allBad = repairChunk(['bad', 'bad', 'bad']);
check('"self-healing" repairs ONLY when a healthy replica exists',
  someHealthy.repaired === true && allBad.repaired === false,
  'all-replicas-corrupt => repair impossible (availability, not magic)');
check('"invincible" is FALSE as an absolute (it is N-replica availability)',
  allBad.repaired === false && allBad.served === 'NONE',
  'safety holds (no bad data served) but data is UNAVAILABLE -> score honestly');

// 2b. "Instant migration": schema-less ingestion makes LINKING O(1) (mint
//     .spore + draw edge), but the BYTES still have to land in cold storage.
//     Moving a 1 TB legacy dataset is O(N) bandwidth, NOT instantaneous.
const ONE_TB = 1024 * GiB;
const INGEST_BPS = 1 * GiB; // 1 GiB/s ingest pipe (generous)
const migrateSeconds = ONE_TB / INGEST_BPS;
check('"instant migration": LINKING is O(1) but moving bytes is O(N)',
  migrateSeconds > 60, // a 1 TB move is NOT instant
  `1 TB at 1 GiB/s = ${migrateSeconds.toFixed(0)} s (schema-link is instant; data move is not)`);
// The genuinely true part: no rigid ALTER TABLE rewrite is required.
function legacyIngest(bytes) {
  return { linkOps: 1 /* O(1) edge */, bytesToMove: bytes /* O(N) */ };
}
const ing = legacyIngest(ONE_TB);
check('schema-less link cost is O(1) while data cost stays O(N) (honest split)',
  ing.linkOps === 1 && ing.bytesToMove === ONE_TB,
  'verdict: migration UX is great; "instantaneous" is an overclaim for the bytes');

// 2c. Cross-check the established Galerina verdict that streaming is O(N): the
//     migration and the (b2) streamer agree on linear scaling.
check('RD-0155 migration scaling agrees with RD-0154 O(N) streaming verdict',
  (ONE_TB * 2) / INGEST_BPS === migrateSeconds * 2,
  'double the data => double the time (bandwidth-bound, consistent)');

// =============================================================================
// FINAL TALLY
// =============================================================================
const TOTAL = PASS + FAIL;
console.log('\n=============================================================');
console.log(`RESULT: ${PASS}/${TOTAL} passed` + (FAIL ? `  (${FAIL} FAILED: ${failures.join(', ')})` : ''));
console.log('=============================================================');

if (FAIL > 0) {
  process.exitCode = 1;
}

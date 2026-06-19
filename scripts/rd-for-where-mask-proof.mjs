// R&D proof: `for...where` → ternary tensor-mask (predicated execution) — measure the REAL tradeoffs.
// Pure JS / CPU (the tree-walker's own substrate). NO photonic/HW claims (software-simulated).
// Machine: filled in by the runner output line. Self-verifying: computes shipped-vs-ground-truth.
import { performance } from "node:perf_hooks";
import os from "node:os";

const NS = (f) => { const t = performance.now(); f(); return performance.now() - t; };
const median = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
const timeit = (f, reps = 7) => median(Array.from({ length: reps }, () => NS(f)));
let fails = 0;
const check = (ok, label, detail) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`); };

console.log("# for...where tensor-mask proof");
console.log(`# machine: ${os.cpus()[0].model} · node ${process.version} · ${os.platform()}`);
console.log("");

// A cheap pure transform f(x) and a where-predicate. Data is RANDOM (unpredictable branch) — the
// regime where predication is supposed to help. (Deterministic LCG so the run is reproducible.)
let seed = 123456789;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
const N = 1_000_000;
const data = new Int32Array(N).map(() => rnd() % 1000);          // values 0..999
const cheapF = (x) => (x * 3 + 1) | 0;
const expensiveF = (x) => { let r = x; for (let k = 0; k < 40; k++) r = (r * 1103515245 + 12345) & 0x7fffffff; return r | 0; };
const where = (x) => (x & 1) === 0;                              // ~50% pass, unpredictable

// ── M1: refute "same cycles for 10 vs 10,000" — a mask multiply is O(n), not O(1) ───────────────
{
  const mk = (n) => Int32Array.from({ length: n }, () => rnd() % 1000);
  const maskSum = (arr) => { let s = 0; for (let i = 0; i < arr.length; i++) s += cheapF(arr[i]) * (where(arr[i]) ? 1 : 0); return s; };
  const a10 = mk(10), a10k = mk(10_000), a1m = mk(1_000_000);
  // warm
  maskSum(a10); maskSum(a10k); maskSum(a1m);
  const t10 = timeit(() => { for (let r = 0; r < 100000; r++) maskSum(a10); });
  const t10k = timeit(() => { for (let r = 0; r < 100; r++) maskSum(a10k); });
  const per10 = t10 / 100000, per10k = t10k / 100;
  const ratio = per10k / per10;
  // ground truth: O(n) ⇒ 10k/10 work ratio ≈ 1000×. O(1) (the claim) ⇒ ratio ≈ 1.
  check(ratio > 100, "M1  mask-multiply is O(n), NOT O(1) ('same cycles for 10 vs 10,000' is FALSE)",
    `per-item-call 10=${per10.toExponential(2)}ms 10k=${per10k.toExponential(2)}ms ratio=${ratio.toFixed(0)}× (O(1) would be ~1×)`);
}

// ── M2: branchless masked vs branchy filter — the win is DATA-DEPENDENT, not universal ──────────
{
  // branchy: compute f only for matches (skips work on filtered-out elements)
  const branchy = (F) => { let s = 0; for (let i = 0; i < N; i++) { if (where(data[i])) s += F(data[i]); } return s; };
  // branchless: compute f for ALL elements, multiply by the mask (does the filtered work too)
  const branchless = (F) => { let s = 0; for (let i = 0; i < N; i++) { const m = where(data[i]) ? 1 : 0; s += F(data[i]) * m; } return s; };
  // equivalence (ground truth: same answer)
  check(branchy(cheapF) === branchless(cheapF), "M2a branchless mask == branchy filter (same result)",
    `branchy=${branchy(cheapF)} branchless=${branchless(cheapF)}`);
  branchy(cheapF); branchless(cheapF); // warm
  const bCheap = timeit(() => branchy(cheapF)), mCheap = timeit(() => branchless(cheapF));
  const bExp = timeit(() => branchy(expensiveF)), mExp = timeit(() => branchless(expensiveF));
  console.log(`      cheap-f : branchy=${bCheap.toFixed(2)}ms  branchless=${mCheap.toFixed(2)}ms  (branchless ${(bCheap / mCheap).toFixed(2)}×)`);
  console.log(`      exp-f   : branchy=${bExp.toFixed(2)}ms  branchless=${mExp.toFixed(2)}ms  (branchless ${(bExp / mExp).toFixed(2)}×)`);
  // The honest claim: branchless does the filtered-out work too, so the EXPENSIVE-f case must show
  // branchless paying for elements it discards (its speed-up shrinks or inverts vs the cheap case).
  check((bCheap / mCheap) > (bExp / mExp), "M2b predication is NOT a universal win — it computes f for filtered-out items, so it loses ground as f gets expensive",
    `branchless advantage cheap=${(bCheap / mCheap).toFixed(2)}× → exp=${(bExp / mExp).toFixed(2)}× (shrinks/inverts)`);
}

// ── M3: the K3 correctness flaw — mask-to-0 ALIASES the trit 0 = INDETERMINATE ───────────────────
{
  // Verdict trits: -1 DENY, 0 INDETERMINATE, +1 ALLOW. Two distinct meanings collapse onto 0 if the
  // `where` mask uses 0 for "filtered out": an element that is GENUINELY indeterminate is now
  // indistinguishable from one that was filtered. That is information loss = a fail-OPEN/READ bug.
  const verdicts = [+1, 0, -1, +1];        // element 1 (index) is genuinely INDETERMINATE
  const whereMask = [1, 1, 0, 1];          // element 2 is filtered-out (mask 0)
  const masked = verdicts.map((v, i) => v * whereMask[i]); // [+1, 0, 0, +1]
  const genuinelyIndet = masked[1], filteredOut = masked[2];
  check(genuinelyIndet === filteredOut, "M3  mask-to-0 ALIASES 0=INDETERMINATE — 'filtered' and 'genuinely indeterminate' become indistinguishable (correctness bug)",
    `verdict[1](INDET)=${genuinelyIndet} masked-out[2]=${filteredOut} — both 0, cannot tell apart`);
  // The fix the harness asserts: a filter needs a SEPARATE presence channel (boolean/bit), not the trit.
  const present = whereMask;               // distinct channel
  const recoverable = verdicts.map((v, i) => ({ verdict: v, present: present[i] === 1 }));
  check(recoverable[1].verdict === 0 && recoverable[1].present && !recoverable[2].present,
    "M3-fix a SEPARATE presence bit keeps 0=INDETERMINATE distinct from filtered-out",
    `idx1={v:0,present:true} idx2={present:false} — distinguishable`);
}

// ── M4: compaction is not free — squeezing 0s out costs an extra O(n) pass + a scatter/alloc ─────
{
  const vals = Int32Array.from(data, (x) => cheapF(x) * (where(x) ? 1 : 0)); // dense masked vector (0s in place)
  const denseConsume = () => { let s = 0; for (let i = 0; i < vals.length; i++) s += vals[i]; return s; };       // O(n), no compaction
  const compactThenConsume = () => {                                                                              // O(n) scan + scatter
    const out = new Int32Array(vals.length); let j = 0;
    for (let i = 0; i < vals.length; i++) { if (vals[i] !== 0) out[j++] = vals[i]; }
    let s = 0; for (let i = 0; i < j; i++) s += out[i]; return s;
  };
  denseConsume(); compactThenConsume();
  const tDense = timeit(() => { for (let r = 0; r < 50; r++) denseConsume(); });
  const tComp = timeit(() => { for (let r = 0; r < 50; r++) compactThenConsume(); });
  check(tComp > tDense, "M4  compaction (squeeze 0s) costs MORE than leaving 0s in place (extra scan + scatter + alloc)",
    `dense=${tDense.toFixed(2)}ms compact=${tComp.toFixed(2)}ms (+${((tComp / tDense - 1) * 100).toFixed(0)}%)`);
}

console.log("");
console.log(fails === 0 ? "RESULT  PASS — all claims verified (computed vs ground truth)" : `RESULT  FAIL — ${fails} assertion(s) failed`);
process.exit(fails === 0 ? 0 : 1);

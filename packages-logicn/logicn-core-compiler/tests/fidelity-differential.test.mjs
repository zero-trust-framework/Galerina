/**
 * 0014 Fidelity Differential Harness — slices 1-2: tree-walker ≡ bytecode-VM ≡ WASM, BYTE-EXACT.
 *
 * Owner decision (2026-06-18): WASM i32 is the semantic reference tier; all execution tiers must be
 * byte-identical. This is the foundational slice of the 0014 harness: it drives the same flow + input
 * through (a) the reference async tree-walker (executeFlow with NO pureFastPath) and (b) the fast
 * tier (executeFlow with { pureFastPath: true } → bytecode VM / sync fast-path), and asserts the
 * result is byte-identical — return value via Object.is (so a JS `-0` that diverges from `+0` is
 * CAUGHT) and traps by message. The corpus targets exactly the i32 edges hardened this cycle
 * (overflow / div0 / mod0 / the mul sqrt-boundary / INT32_MIN÷-1 / the -0 case).
 *
 * It doubles as the conformance lock for slices 1/3 (cfb72f9) + 2/3 (6542bae): if any future change
 * makes a tier diverge on these edges, this fails. Slice-2 (below) extends the differential to the
 * REAL WASM tier (.lln → WAT → wabt → #105 admission → instantiate), proving the same i32 conformance
 * end-to-end against the semantic reference. The full 6-component tuple (effect trace, taint/seal,
 * audit record, diagnostics) remains the next harness slice.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProgram, executeFlow, clearBytecodeCache } from "../dist/index.js";
import * as L from "../dist/index.js"; // WASM-tier path (assembleWAT / admitAndInstantiate / …) for slice-2
import { resolveGovernanceMode } from "../dist/governance-mode.js"; // slice-3 (not re-exported from the index barrel)

const MIN = -2147483648;
const MAX = 2147483647;
const int = (v) => ({ __tag: "int", value: v });
const argMap = (names, vals) => new Map(names.map((n, i) => [n, int(vals[i])]));

// Reference tier = tree-walker (no pureFastPath). Candidate tier = bytecode/sync fast-path.
const reference = (prog, flow, args) => executeFlow(flow, args, prog.ast, prog.flows);
const candidate = (prog, flow, args) =>
  executeFlow(flow, args, prog.ast, prog.flows, undefined, undefined, { pureFastPath: true });

const show = (v) =>
  v.__tag === "runtimeError" ? `trap:${v.message}` : v.__tag === "int" ? `int:${v.value}` : v.__tag;

// ── Deterministic fuzz (slice-5): a seeded xorshift32 PRNG so the for-all-inputs gate is
// reproducible + CI-stable (no Math.random). ~30% of samples are drawn from the i32 edge set
// (so overflow / div0 / mod0 / sqrt-boundary / INT32_MIN÷-1 are exercised), the rest uniform i32.
const EDGE = [0, 1, -1, 2, -2, MIN, MAX, MIN + 1, MAX - 1, 46340, 46341, -46340, -46341, 65536, -65536];
function makePRNG(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s; // u32
  };
}
function makeSampler(seed) {
  const rng = makePRNG(seed);
  return () => {
    const r = rng();
    if ((r & 7) < 3) return EDGE[rng() % EDGE.length]; // ~30% edge values
    return r | 0; // uniform i32 (u32 → signed)
  };
}

// [source, flowName, paramNames, [ [args…] … ]] — pure i32 flows over the hardened edge set.
// NOTE: each flow has a UNIQUE name. On the harness's first run a shared name ("f") exposed that the
// GLOBAL bytecode cache keys on flow name, so the fast tier reused the first "f"'s bytecode across
// later same-named flows from SEPARATE compilations (walker=7 vs fast=13 on a sub flow). Real programs
// can't trigger it (the symbol resolver forbids duplicate names), but the persistent cross-compilation
// cache is a real hygiene hazard — the 0014 design's `sourceTag` scoping is the fix. We use unique
// names + clearBytecodeCache() per entry so the differential tests the TIERS, not the cache.
const CORPUS = [
  ["pure flow fAdd(a: Int, b: Int) -> Int contract { effects {} } { return a + b }", "fAdd", ["a", "b"], [[2, 3], [MAX, 1], [MIN, -1]]],
  ["pure flow fSub(a: Int, b: Int) -> Int contract { effects {} } { return a - b }", "fSub", ["a", "b"], [[10, 3], [MIN, 1], [MAX, -1]]],
  ["pure flow fMul(a: Int, b: Int) -> Int contract { effects {} } { return a * b }", "fMul", ["a", "b"], [[6, 7], [46340, 46340], [46341, 46341], [MIN, -1]]],
  ["pure flow fDiv(a: Int, b: Int) -> Int contract { effects {} } { return a / b }", "fDiv", ["a", "b"], [[7, 2], [-1, 2], [10, 0], [MIN, -1]]],
  ["pure flow fMod(a: Int, b: Int) -> Int contract { effects {} } { return a % b }", "fMod", ["a", "b"], [[10, 3], [10, 0], [MIN, -1]]],
  ["pure flow fNeg(a: Int) -> Int contract { effects {} } { return 0 - a }", "fNeg", ["a"], [[5], [MIN]]],
  // #0021: the UNARY-minus operator `-a` (distinct from binary `0 - a`) — the corpus blind spot.
  // -INT32_MIN must TRAP (overflow) on the walker exactly as the VM/WASM do; -0 -> +0.
  ["pure flow fUNeg(a: Int) -> Int contract { effects {} } { return -a }", "fUNeg", ["a"], [[5], [MIN], [MAX], [0]]],
];

test("0014 slice-1: tree-walker ≡ bytecode/fast tier, byte-exact (value + trap) over the i32 edges", async () => {
  for (const [src, flow, params, caseList] of CORPUS) {
    clearBytecodeCache(); // isolate each entry — see the NOTE above (cross-compilation cache hygiene)
    const prog = parseProgram(src, "fid.lln");
    const errs = (prog.diagnostics ?? []).filter((d) => d.severity === "error");
    assert.equal(errs.length, 0, `parse error in "${src}": ${errs.map((d) => d.message).join("; ")}`);
    for (const vals of caseList) {
      const args = argMap(params, vals);
      const ref = (await reference(prog, flow, args)).value;
      const cand = (await candidate(prog, flow, args)).value;
      const ctx = `flow=${flow} args=[${vals}] : walker=${show(ref)} fast=${show(cand)}`;
      // 1. same tag (a value-vs-trap divergence is a fidelity failure)
      assert.equal(ref.__tag, cand.__tag, `tier TAG divergence — ${ctx}`);
      // 2. byte-exact value via Object.is (catches a `-0` that === would hide)
      if (ref.__tag === "int") {
        assert.ok(Object.is(ref.value, cand.value), `tier VALUE divergence (incl. -0) — ${ctx}`);
      }
      // 3. identical trap kind
      if (ref.__tag === "runtimeError") {
        assert.equal(ref.message, cand.message, `tier TRAP divergence — ${ctx}`);
      }
    }
  }
});

// ── Slice 2: WASM tier ≡ reference walker (byte-exact value; trap ⟺ trap) ─────────────────────────
// Owner decision (2026-06-18): WASM i32 is the SEMANTIC REFERENCE tier. Slices 1/3 (cfb72f9) + 2/3
// (6542bae) made the walker + bytecode + WASM emitter conform on the i32 edges (checked add/sub/mul →
// trap on overflow; native i32.div_s/rem_s trap on /0 and INT32_MIN÷-1; INT32_MIN%-1 = 0, no trap).
// This slice PROVES that conformance end-to-end: it drives the SAME pure-i32 flows through the reference
// async tree-walker AND through real WASM (.lln → WAT → real-wabt → #105 Ed25519-attested admission →
// instantiate), asserting the WASM result is byte-identical to the walker. Trap MESSAGES legitimately
// differ across runtimes (walker "integer overflow" vs a WASM `unreachable`/`div_s` trap), so traps are
// compared by KIND (both trapped) and values by Object.is (catches a -0 that === would hide). This
// closes the WASM half of the cross-tier i32 conformance (X1 for these ops) at the artifact level.
const WASM_SRC = CORPUS.map(([src]) => src).join("\n");

test("0014 slice-2: WASM tier ≡ reference walker, byte-exact (value; trap⟺trap) over the i32 edges", async () => {
  const prog = parseProgram(WASM_SRC, "fid-wasm.lln");
  const errs = (prog.diagnostics ?? []).filter((d) => d.severity === "error");
  assert.equal(errs.length, 0, `parse error: ${errs.map((d) => d.message).join("; ")}`);

  // .lln → WAT → real wabt module → #105 Ed25519-attested admission gate → instantiate (once, all flows).
  const fx = L.checkEffects(prog.flows, prog.ast);
  const { gir } = L.emitGIR(prog.ast, prog.flows, fx);
  const wat = L.renderWAT(L.buildWATModuleFromGIR(gir, undefined, "fid", prog.ast, true));
  const asm = await L.assembleWAT(wat);
  assert.ok(asm.valid && asm.diagnostics.length === 0, `module assembles: ${JSON.stringify(asm.diagnostics)}`);
  const kp = L.generateRunnerKeypair();
  const att = L.signWasm(asm.wasm, kp.privateKeyPem, "dev");
  const { instance } = await L.admitAndInstantiate({
    wasm: asm.wasm, attestation: att,
    policy: { requireSigned: true, publicKeyPem: kp.publicKeyPem },
    host: L.createHostRuntime(),
  });

  for (const [, flow, params, caseList] of CORPUS) {
    assert.equal(typeof instance.exports[flow], "function", `WASM exports pure flow ${flow}`);
    for (const vals of caseList) {
      // reference tier = governed async tree-walker (the semantic conformance target)
      const ref = (await executeFlow(flow, argMap(params, vals), prog.ast, prog.flows)).value;
      const refTrap = ref.__tag === "runtimeError";
      // candidate tier = real WASM; an overflow / div0 / mod0 trap surfaces as a thrown RuntimeError on invoke
      let wasmTrap = false, wasmVal;
      try { wasmVal = instance.exports[flow](...vals); } catch { wasmTrap = true; }
      const ctx = `flow=${flow} args=[${vals}] : walker=${refTrap ? "trap" : "int:" + ref.value} wasm=${wasmTrap ? "trap" : "int:" + wasmVal}`;
      // 1. trap ⟺ trap (a value-vs-trap split is a fidelity failure)
      assert.equal(refTrap, wasmTrap, `tier TRAP/VALUE divergence — ${ctx}`);
      // 2. when both produce a value, byte-exact via Object.is (catches a -0 that === would hide)
      if (!refTrap) {
        assert.equal(ref.__tag, "int", `reference produced a non-int value — ${ctx}`);
        assert.ok(Object.is(ref.value, wasmVal), `WASM value divergence (incl. -0) — ${ctx}`);
      }
    }
  }
});

// ── Slice 3: NEGATIVE corpus — floor-bearing flows are REFUSED lowering (0021 hub deliverable) ─────
// `lean` is the *erasure of enforcement compiler-proved unnecessary*, never a relaxation of an
// enforcement that exists. The monotone-safety invariant in governance-mode.ts proves
// resolveGovernanceMode(...).tier === "lean" ⟹ (effectFree ∧ taintClean). This is the negative half of
// the harness: flows that DECLARE an effect or TOUCH a governed sink must be FORCED to tier `full` —
// never admitted to the faster `lean`/WASM tier. We drive the REAL shipped effect-checker
// (L.checkEffects → EffectCheckerFlags.EffectFree, set only for a pure flow with no declared AND no
// inferred effects) and feed its EffectFree fact to the REAL resolver (resolveGovernanceMode). Each
// effectful flow → effectFree=false → tier `full` under `auto`, AND a safety-override to `full`
// (+ LLN-CONFIG-GOV-002) even when `lean` is explicitly requested. taintClean is pinned true to isolate
// the EFFECT floor (the easiest path to lean): proving these still refuse lowering shows the effect floor
// alone suffices. A pure no-effect CONTROL flow is asserted lean-eligible so the test can't pass trivially.
const NEG_GOV_CORPUS = [
  ["secure flow negNet(u: Text) -> Text contract { effects [network.outbound] } { return u }", "negNet", "declared network.outbound effect"],
  ["secure flow negFs(p: Text) -> Text contract { effects [filesystem.read] } { return p }", "negFs", "declared filesystem.read effect"],
  ["secure flow negSink(u: Text) -> Text contract { effects [network.outbound] } { return http.get(u) }", "negSink", "touches governed sink http.get → inferred network.outbound"],
  ["guarded flow negAudit(m: Text) -> Text contract { effects [audit.write] } { return m }", "negAudit", "declared audit.write effect"],
];
// Positive control: a pure, effect-free flow that IS lean-eligible — guards against a trivially-passing test.
const POS_GOV_CONTROL = ["pure flow posPure(a: Int) -> Int contract { effects {} } { return a + 1 }", "posPure"];

// EffectCheckerFlags.EffectFree for one parsed flow, via the shipped effect-checker.
const effectFreeOf = (prog, flowName) => {
  const r = L.checkEffects(prog.flows, prog.ast).find((x) => x.flowName === flowName);
  assert.ok(r, `effect-checker produced no result for flow ${flowName}`);
  return (r.checkerFlags & L.EffectCheckerFlags.EffectFree) !== 0;
};

test("0014 slice-3: floor-bearing flows are refused lowering — governance resolver forces full (never lean)", () => {
  // Control: a pure effect-free flow MUST be lean-eligible — proves the corpus below isn't trivially `full`.
  {
    const [src, flow] = POS_GOV_CONTROL;
    const prog = parseProgram(src, "fid-gov-ctrl.lln");
    const errs = (prog.diagnostics ?? []).filter((d) => d.severity === "error");
    assert.equal(errs.length, 0, `control parse error: ${errs.map((d) => d.message).join("; ")}`);
    const ef = effectFreeOf(prog, flow);
    assert.equal(ef, true, `control pure flow ${flow} must be EffectFree`);
    const res = resolveGovernanceMode({ projectDefault: "auto", flowRequest: "auto", effectFree: ef, taintClean: true });
    assert.equal(res.tier, "lean", `control: an EffectFree+taint-clean flow under auto must reach lean — ${res.reason}`);
  }

  // Negative corpus: every effectful / sink-touching flow is forced to full and refused lowering.
  for (const [src, flow, why] of NEG_GOV_CORPUS) {
    const prog = parseProgram(src, "fid-gov.lln");
    const errs = (prog.diagnostics ?? []).filter((d) => d.severity === "error");
    assert.equal(errs.length, 0, `parse error for ${flow} (${why}): ${errs.map((d) => d.message).join("; ")}`);

    // 1. The shipped effect-checker proves this flow is NOT effect-free (the governance floor).
    const ef = effectFreeOf(prog, flow);
    assert.equal(ef, false, `floor: ${flow} (${why}) must NOT be EffectFree`);

    // 2. Under `auto`, a non-effect-free flow resolves to full — not admitted to the faster tier.
    const auto = resolveGovernanceMode({ projectDefault: "auto", flowRequest: "auto", effectFree: ef, taintClean: true });
    assert.equal(auto.tier, "full", `auto: ${flow} (${why}) must resolve full, got ${auto.tier} — ${auto.reason}`);

    // 3. Even an EXPLICIT `lean` request is overridden to full (lean cannot relax an enforcement that exists),
    //    and the resolver must surface the LLN-CONFIG-GOV-002 safety-override diagnostic.
    const lean = resolveGovernanceMode({ projectDefault: "lean", flowRequest: "lean", effectFree: ef, taintClean: true });
    assert.equal(lean.tier, "full", `lean-override: ${flow} (${why}) must safety-override to full, got ${lean.tier} — ${lean.reason}`);
    assert.ok(
      lean.diagnostics.some((d) => d.includes("LLN-CONFIG-GOV-002")),
      `lean-override: ${flow} (${why}) must emit LLN-CONFIG-GOV-002 — got [${lean.diagnostics.join(" | ")}]`,
    );
  }
});

// ── Slice 4: liveness FAIL-CLOSED — runaway loop + deep recursion TRAP (0032 hazard fix, owner Go 2026-06-18) ──
// The two confirmed stability hazards are now fail-closed, locked here: (1) a non-terminating loop TRAPS at the
// iteration cap (was fail-OPEN — truncate at 100k + return SUCCESS with partial state); (2) unbounded recursion
// TRAPS at the depth cap (was an UNCATCHABLE host heap-OOM ~5000 deep, violating Goal C "no system crash").
// Verified with LOW caps via runtimeOptions so the test is fast — the caps default to 100_000 / 2000 in production.
test("0014 slice-4: liveness fail-closed — runaway loop + deep recursion TRAP (not truncate-succeed, not crash)", async () => {
  // (1) infinite while → runtimeError at maxIterations, NOT a successful partial result.
  {
    const prog = parseProgram("guarded flow loopForever() -> Int contract { effects {} } { mut i = 0 while true { i = i + 1 } return i }", "fid-live.lln");
    const errs = (prog.diagnostics ?? []).filter((d) => d.severity === "error");
    assert.equal(errs.length, 0, `parse error: ${errs.map((d) => d.message).join("; ")}`);
    const res = await executeFlow("loopForever", new Map(), prog.ast, prog.flows, undefined, undefined, { maxIterations: 5 });
    assert.equal(res.value.__tag, "runtimeError", "runaway while must fail closed (runtimeError), not succeed with partial state");
    assert.ok(/Loop exceeded/.test(res.value.message ?? ""), `expected a 'Loop exceeded' trap — got ${res.value.message ?? res.value.__tag}`);
  }
  // (2) unbounded self-recursion → runtimeError at maxCallDepth, NOT an uncatchable host crash.
  {
    const prog = parseProgram("guarded flow recur(n: Int) -> Int contract { effects {} } { return recur(n + 1) }", "fid-rec.lln");
    const errs = (prog.diagnostics ?? []).filter((d) => d.severity === "error");
    assert.equal(errs.length, 0, `parse error: ${errs.map((d) => d.message).join("; ")}`);
    const res = await executeFlow("recur", new Map([["n", { __tag: "int", value: 0 }]]), prog.ast, prog.flows, undefined, undefined, { maxCallDepth: 50 });
    assert.equal(res.value.__tag, "runtimeError", "unbounded recursion must fail closed (runtimeError), not crash the host");
    assert.ok(/Recursion depth exceeded/.test(res.value.message ?? ""), `expected a 'Recursion depth exceeded' trap — got ${res.value.message ?? res.value.__tag}`);
  }
});

// ── Slice 5: FUZZ / for-all-inputs gate (0014 + 0048 deliverable) ──────────────────────────────────
// The fixed corpus above proves the KNOWN i32 edges; this slice is the structural guarantee the harness
// was missing — a deterministic property gate that drives MANY random i32 inputs through every tier and
// asserts byte-exact agreement, so a future change that fails-open on some non-hand-picked input is
// caught here (the cross-tier fail-open family memory flags as structurally under-covered). Seeded →
// reproducible; a failure prints the exact seed-derived args so it is debuggable.
test("0014 slice-5a: FUZZ tree-walker ≡ bytecode/fast tier, byte-exact over random i32 inputs", async () => {
  const N = 400;
  const sample = makeSampler(0x9e3779b1);
  for (const [src, flow, params] of CORPUS) {
    clearBytecodeCache(); // isolate each entry from the cross-compilation cache (see the NOTE above)
    const prog = parseProgram(src, "fid-fuzz.lln");
    const errs = (prog.diagnostics ?? []).filter((d) => d.severity === "error");
    assert.equal(errs.length, 0, `parse error in "${src}": ${errs.map((d) => d.message).join("; ")}`);
    for (let i = 0; i < N; i++) {
      const vals = params.map(() => sample());
      const args = argMap(params, vals);
      const ref = (await reference(prog, flow, args)).value;
      const cand = (await candidate(prog, flow, args)).value;
      const ctx = `flow=${flow} args=[${vals}] : walker=${show(ref)} fast=${show(cand)}`;
      assert.equal(ref.__tag, cand.__tag, `FUZZ tier TAG divergence — ${ctx}`);
      if (ref.__tag === "int") assert.ok(Object.is(ref.value, cand.value), `FUZZ tier VALUE divergence (incl. -0) — ${ctx}`);
      if (ref.__tag === "runtimeError") assert.equal(ref.message, cand.message, `FUZZ tier TRAP divergence — ${ctx}`);
    }
  }
});

test("0014 slice-5b: FUZZ WASM tier ≡ reference walker, byte-exact (value; trap⟺trap) over random i32 inputs", async () => {
  const N = 200;
  const prog = parseProgram(WASM_SRC, "fid-fuzz-wasm.lln");
  const errs = (prog.diagnostics ?? []).filter((d) => d.severity === "error");
  assert.equal(errs.length, 0, `parse error: ${errs.map((d) => d.message).join("; ")}`);

  // One assemble + #105-admit + instantiate for all flows (same path as slice-2).
  const fx = L.checkEffects(prog.flows, prog.ast);
  const { gir } = L.emitGIR(prog.ast, prog.flows, fx);
  const wat = L.renderWAT(L.buildWATModuleFromGIR(gir, undefined, "fidfuzz", prog.ast, true));
  const asm = await L.assembleWAT(wat);
  assert.ok(asm.valid && asm.diagnostics.length === 0, `module assembles: ${JSON.stringify(asm.diagnostics)}`);
  const kp = L.generateRunnerKeypair();
  const att = L.signWasm(asm.wasm, kp.privateKeyPem, "dev");
  const { instance } = await L.admitAndInstantiate({
    wasm: asm.wasm, attestation: att,
    policy: { requireSigned: true, publicKeyPem: kp.publicKeyPem },
    host: L.createHostRuntime(),
  });

  const sample = makeSampler(0x12345677);
  for (const [, flow, params] of CORPUS) {
    assert.equal(typeof instance.exports[flow], "function", `WASM exports pure flow ${flow}`);
    for (let i = 0; i < N; i++) {
      const vals = params.map(() => sample());
      const ref = (await executeFlow(flow, argMap(params, vals), prog.ast, prog.flows)).value;
      const refTrap = ref.__tag === "runtimeError";
      let wasmTrap = false, wasmVal;
      try { wasmVal = instance.exports[flow](...vals); } catch { wasmTrap = true; }
      const ctx = `flow=${flow} args=[${vals}] : walker=${refTrap ? "trap" : "int:" + ref.value} wasm=${wasmTrap ? "trap" : "int:" + wasmVal}`;
      assert.equal(refTrap, wasmTrap, `FUZZ WASM TRAP/VALUE divergence — ${ctx}`);
      if (!refTrap) assert.ok(Object.is(ref.value, wasmVal), `FUZZ WASM value divergence (incl. -0) — ${ctx}`);
    }
  }
});

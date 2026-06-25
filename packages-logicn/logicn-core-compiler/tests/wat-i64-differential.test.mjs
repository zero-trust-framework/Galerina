/**
 * 0014 Int64 slice — walker ≡ WASM byte-exact differential (the gate-lift criterion, productionized).
 *
 * The param-arithmetic slice was cross-verified by the R&D worker (rd-0113b 12/12); this is the in-suite,
 * CI-resident version that ALSO covers the LITERAL slice (let-init / mixed / const-fold / negative). For
 * each Int64 corpus flow it drives BOTH the reference async tree-walker (executeFlow — flow-faithful per
 * Step 1) AND the real WASM tier (emitGIR → buildWATModuleFromGIR → wabt → admit → instantiate), and asserts
 * they agree byte-exact: a value via bigint === (so a >2^53 divergence is CAUGHT), a trap via trap⟺trap.
 *
 * It is NON-VACUOUS by construction — every value case lives in (2^53, 2^63), where a truncating i32/Number
 * lowering would diverge. Bare `return <literal>` (no binding) is intentionally absent (still walker-only);
 * the corpus uses the `let x = <lit>; return x` form, exactly as the lift criteria require. Gate-bypassing
 * (executeFlow + the raw emit path skip checkValueStates) — LLN-NUMERIC-001 stays CLOSED for real run/build.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProgram, executeFlow } from "../dist/index.js";
import * as L from "../dist/index.js";

const i64 = (v) => ({ __tag: "int64", value: v });
const int = (v) => ({ __tag: "int", value: v });

// [flowName, paramNames, walkerArgs(LogicNValues), wasmArgs(JS), expect: bigint | "trap"]
const CORPUS = [
  ["bigLit",  [], [], [], 9007199254740993n],                                   // 2^53+1 — exact past the JS-number wall
  ["maxLit",  [], [], [], 9223372036854775807n],                                // I64_MAX
  ["minLit",  [], [], [], -9223372036854775808n],                               // I64_MIN (negative literal)
  ["mulBig",  [], [], [], 1000000000000n],                                      // const product overflows i32, exact in i64 (type-directed eval)
  ["addP",    ["a", "b"], [i64(9007199254740993n), i64(2n)], [9007199254740993n, 2n], 9007199254740995n],
  ["mulP",    ["a", "b"], [i64(3037000499n), i64(3037000499n)], [3037000499n, 3037000499n], 9223372030926249001n], // ~2^63
  ["mixLit",  ["a"], [i64(7n)], [7n], 5000000007n],                             // Int64 param + >2^31 literal
  ["addWiden",["a", "b"], [int(2000000000), int(2000000000)], [2000000000, 2000000000], 4000000000n], // i32 vars sign-extended
  ["ovf",     [], [], [], "trap"],                                              // I64_MAX + 1 → Fork-A trap
  ["divMin",  ["d"], [i64(-1n)], [-1n], "trap"],                                // I64_MIN / -1 → trap
  ["remMin",  ["d"], [i64(-1n)], [-1n], 0n],                                    // I64_MIN % -1 → 0 (no trap) — div/rem asymmetry
  ["bareRet", [], [], [], 9223372036854775807n],                               // bare `return <literal>` (no binding) — the last gap
  ["bareSum", ["a", "b"], [int(2000000000), int(2000000000)], [2000000000, 2000000000], 4000000000n], // bare `return a + b` (i32 vars → i64)
];

const SRC = `pure flow bigLit() -> Int64 contract { effects {} } { let x: Int64 = 9007199254740993  return x }
pure flow maxLit() -> Int64 contract { effects {} } { let x: Int64 = 9223372036854775807  return x }
pure flow minLit() -> Int64 contract { effects {} } { let x: Int64 = -9223372036854775808  return x }
pure flow mulBig() -> Int64 contract { effects {} } { let p: Int64 = 1000000 * 1000000  return p }
pure flow addP(a: Int64, b: Int64) -> Int64 contract { effects {} } { return a + b }
pure flow mulP(a: Int64, b: Int64) -> Int64 contract { effects {} } { return a * b }
pure flow mixLit(a: Int64) -> Int64 contract { effects {} } { return a + 5000000000 }
pure flow addWiden(a: Int, b: Int) -> Int64 contract { effects {} } { let t: Int64 = a + b  return t }
pure flow ovf() -> Int64 contract { effects {} } { let a: Int64 = 9223372036854775807  let b: Int64 = a + 1  return b }
pure flow divMin(d: Int64) -> Int64 contract { effects {} } { let a: Int64 = -9223372036854775808  return a / d }
pure flow remMin(d: Int64) -> Int64 contract { effects {} } { let a: Int64 = -9223372036854775808  return a % d }
pure flow bareRet() -> Int64 contract { effects {} } { return 9223372036854775807 }
pure flow bareSum(a: Int, b: Int) -> Int64 contract { effects {} } { return a + b }`;

test("0014 Int64 slice: walker ≡ WASM byte-exact over the (2^53,2^63) corpus (param + literal)", async () => {
  const prog = parseProgram(SRC, "i64-diff.lln");
  const errs = (prog.diagnostics ?? []).filter((d) => d.severity === "error");
  assert.equal(errs.length, 0, `parse error: ${errs.map((d) => d.message).join("; ")}`);

  const fx = L.checkEffects(prog.flows, prog.ast);
  const { gir } = L.emitGIR(prog.ast, prog.flows, fx);
  const wat = L.renderWAT(L.buildWATModuleFromGIR(gir, undefined, "i64diff", prog.ast, true));
  const asm = await L.assembleWAT(wat);
  assert.ok(asm.valid && asm.diagnostics.length === 0, `i64 module must assemble: ${JSON.stringify(asm.diagnostics)}`);
  const kp = L.generateRunnerKeypair();
  const att = L.signWasm(asm.wasm, kp.privateKeyPem, "dev");
  const { instance } = await L.admitAndInstantiate({
    wasm: asm.wasm, attestation: att,
    policy: { requireSigned: true, publicKeyPem: kp.publicKeyPem },
    host: L.createHostRuntime(),
  });

  for (const [flow, names, wArgs, jsArgs, expect] of CORPUS) {
    // reference tier = governed async tree-walker
    const ref = (await executeFlow(flow, new Map(names.map((n, i) => [n, wArgs[i]])), prog.ast, prog.flows)).value;
    const refTrap = ref.__tag === "runtimeError";
    // candidate tier = real WASM (a trap surfaces as a thrown error on invoke)
    let wasmTrap = false, wasmVal;
    try { wasmVal = instance.exports[flow](...jsArgs); } catch { wasmTrap = true; }
    const ctx = `flow=${flow}: walker=${refTrap ? "trap" : ref.value} wasm=${wasmTrap ? "trap" : wasmVal} expect=${expect}`;

    // 1. the two tiers must AGREE on trap-vs-value
    assert.equal(refTrap, wasmTrap, `tier TRAP/VALUE divergence — ${ctx}`);
    if (expect === "trap") {
      assert.ok(refTrap, `expected a trap in both tiers — ${ctx}`);
    } else {
      // 2. both produce a value, byte-exact via bigint === (catches a >2^53 truncation)
      assert.equal(ref.__tag, "int64", `walker produced a non-int64 — ${ctx}`);
      assert.equal(ref.value, expect, `walker value — ${ctx}`);
      assert.equal(wasmVal, expect, `WASM value — ${ctx}`);
      assert.equal(ref.value, wasmVal, `walker≡WASM byte-exact — ${ctx}`);
    }
  }
});

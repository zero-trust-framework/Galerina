/**
 * Faithful Int64 — cross-flow argument passing (the 0115 lift-blocker, productionized).
 *
 * The single-flow Int64 differential (wat-i64-differential) is thorough for scalar Int64 WITHIN one flow,
 * but never exercised an Int64 *literal passed as a call argument across flows*. The worker's cross-flow
 * spot-check (rd-0113c §B) found that `callee(x, 1000000000000)` lowered the literal arg at the call site
 * as `(i32.const 1000000000000)` — out of i32 range → wabt REJECTS → the assembleWAT minimal-encoder STUB
 * (valid=true BUT diagnostics≠0). That stub is the RD-0093 fail-open class: a `valid`-only check would run a
 * WRONG module. This test pins the fix (thread the callee's Int64 param type as the arg's expectedType) and
 * guards the regression with the STRICT gate `valid && diagnostics.length === 0`.
 *
 * Bypasses LLN-NUMERIC-001 (the raw WASM-emit path does not run checkValueStates) — the gate stays closed
 * for real `run`/build; this proves the *lowering* is faithful so the owner-gated lift has no cross-flow hole.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProgram } from "../dist/index.js";
import * as L from "../dist/index.js";

// callee takes two Int64 params. The callers pass Int64 LITERALS / const-expressions / negations as args —
// the exact shape the single-flow differential could not see.
const SRC = `pure flow callee(a: Int64, b: Int64) -> Int64 contract { effects {} } { return a + b }
pure flow callerParamLit(x: Int64) -> Int64 contract { effects {} } { return callee(x, 1000000000000) }
pure flow callerBothLit() -> Int64 contract { effects {} } { return callee(1000000000000, 2000000000000) }
pure flow callerConstExpr(x: Int64) -> Int64 contract { effects {} } { return callee(x, 1000000 * 1000000) }
pure flow callerNegLit(x: Int64) -> Int64 contract { effects {} } { return callee(x, -5000000000) }`;

test("0115: cross-flow Int64 literal/const/neg args lower to i64 — module validates strictly + runs exact", async () => {
  const prog = parseProgram(SRC, "i64-crossflow.lln");
  const errs = (prog.diagnostics ?? []).filter((d) => d.severity === "error");
  assert.equal(errs.length, 0, `parse error: ${errs.map((d) => d.message).join("; ")}`);

  const fx = L.checkEffects(prog.flows, prog.ast);
  const { gir } = L.emitGIR(prog.ast, prog.flows, fx);
  const wat = L.renderWAT(L.buildWATModuleFromGIR(gir, undefined, "i64xflow", prog.ast, true));

  // DECISIVE (RD-0093 stub-fallback lesson): a >i32 literal arg lowered as i32.const makes wabt reject →
  // assembleWAT returns the STUB with valid=true but diagnostics≠0. The strict gate is the ONLY thing that
  // catches it — a `valid`-only assertion here would pass on the wrong (stub) module.
  const asm = await L.assembleWAT(wat);
  assert.ok(
    asm.valid && asm.diagnostics.length === 0,
    `cross-flow Int64-arg module must assemble strictly (valid && 0 diagnostics): ${JSON.stringify(asm.diagnostics)}\n--- WAT ---\n${wat}`,
  );

  const kp = L.generateRunnerKeypair();
  const att = L.signWasm(asm.wasm, kp.privateKeyPem, "dev");
  const { instance } = await L.admitAndInstantiate({
    wasm: asm.wasm, attestation: att,
    policy: { requireSigned: true, publicKeyPem: kp.publicKeyPem },
    host: L.createHostRuntime(),
  });

  // Exact above 2^53 — a truncating i32 arg would round / wrap these.
  assert.equal(instance.exports.callerParamLit(5n), 1000000000005n);          // 5 + 1e12
  assert.equal(instance.exports.callerBothLit(), 3000000000000n);             // 1e12 + 2e12 (both literal args)
  assert.equal(instance.exports.callerConstExpr(7n), 1000000000007n);         // 7 + (1e6*1e6), const-fold NOT in i32 space
  assert.equal(instance.exports.callerNegLit(9000000000n), 4000000000n);      // 9e9 + (-5e9), negative literal arg
});

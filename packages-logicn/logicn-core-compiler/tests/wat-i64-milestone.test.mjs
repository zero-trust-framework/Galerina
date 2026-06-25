/**
 * Faithful Int64 — emitter 2b first milestone: a fused Int64 module VALIDATES under wat2wasm + runs exact.
 *
 * Drives `pure flow f(a: Int64, b: Int64) -> Int64 { return a OP b }` through the REAL WASM tier
 * (.lln → checkEffects → emitGIR → buildWATModuleFromGIR → renderWAT → wabt assemble → #105 admission →
 * instantiate), the same path as the 0014 slice-2 fidelity harness. The DECISIVE assertion is
 * `asm.valid` — wabt actually compiles the i64 module (a green tree-walker would otherwise mask a
 * permanently-declining WASM tier). i64 params/results marshal as JS BigInt. Exactness above 2^53 + the
 * Fork-A overflow traps prove the lowering is faithful, not truncating. This bypasses the LLN-NUMERIC-001
 * gate (the raw WASM-emit path does not run checkValueStates) — the gate stays closed for real `run`/build.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProgram } from "../dist/index.js";
import * as L from "../dist/index.js";

const I64_MAX = 9223372036854775807n;
const I64_MIN = -9223372036854775808n;

const SRC = `pure flow add64(a: Int64, b: Int64) -> Int64 contract { effects {} } { return a + b }
pure flow sub64(a: Int64, b: Int64) -> Int64 contract { effects {} } { return a - b }
pure flow mul64(a: Int64, b: Int64) -> Int64 contract { effects {} } { return a * b }
pure flow bigLit() -> Int64 contract { effects {} } { let x: Int64 = 9223372036854775807  return x }
pure flow foldSafe() -> Int64 contract { effects {} } { let p: Int64 = 1000000 * 1000  return p }
pure flow mixLit(a: Int64) -> Int64 contract { effects {} } { return a + 5000000000 }`;

test("emitter 2b milestone: a fused Int64 module assembles under wabt + runs exact (i64, not truncated)", async () => {
  const prog = parseProgram(SRC, "i64-milestone.lln");
  const errs = (prog.diagnostics ?? []).filter((d) => d.severity === "error");
  assert.equal(errs.length, 0, `parse error: ${errs.map((d) => d.message).join("; ")}`);

  const fx = L.checkEffects(prog.flows, prog.ast);
  const { gir } = L.emitGIR(prog.ast, prog.flows, fx);
  const wat = L.renderWAT(L.buildWATModuleFromGIR(gir, undefined, "i64mile", prog.ast, true));

  // DECISIVE: the i64 module actually validates under wabt (not a walker-masked declined tier).
  const asm = await L.assembleWAT(wat);
  assert.ok(asm.valid && asm.diagnostics.length === 0, `i64 module must assemble under wabt: ${JSON.stringify(asm.diagnostics)}\n--- WAT ---\n${wat}`);

  const kp = L.generateRunnerKeypair();
  const att = L.signWasm(asm.wasm, kp.privateKeyPem, "dev");
  const { instance } = await L.admitAndInstantiate({
    wasm: asm.wasm, attestation: att,
    policy: { requireSigned: true, publicKeyPem: kp.publicKeyPem },
    host: L.createHostRuntime(),
  });

  for (const f of ["add64", "sub64", "mul64"]) {
    assert.equal(typeof instance.exports[f], "function", `WASM exports ${f}`);
  }

  // Exact above 2^53 — a JS-number (truncating) lowering would round these.
  assert.equal(instance.exports.add64(9007199254740993n, 2n), 9007199254740995n);
  assert.equal(instance.exports.add64(5n, 10n), 15n);
  assert.equal(instance.exports.sub64(0n, 5000000000n), -5000000000n);
  assert.equal(instance.exports.mul64(3037000499n, 3037000499n), 9223372030926249001n); // ≈2^63, exact in i64

  // Fork A = TRAP: signed overflow is `unreachable`, never a silent wrap.
  assert.throws(() => instance.exports.add64(I64_MAX, 1n), "I64_MAX + 1 must trap, not wrap");
  assert.throws(() => instance.exports.sub64(I64_MIN, 1n), "I64_MIN - 1 must trap");
  assert.throws(() => instance.exports.mul64(I64_MAX, 2n), "I64_MAX * 2 must trap");

  // Step 3g: literal origination in the emitter.
  // bare >2^31 Int64 literal init → i64.const (an i32.const would be an invalid module).
  assert.equal(instance.exports.bigLit(), I64_MAX);
  // const-fold must NOT happen in 32-bit space for an Int64 binding (R2): 1000000*1000 fits i64, and the
  // result is exact — had foldToInt run, it would have emitted an i32.const (1000000000 fits i32 here, but
  // the local is i64 → a type mismatch / the larger sibling case truncates).
  assert.equal(instance.exports.foldSafe(), 1000000000n);
  // mixed Int64 param + a >2^31 literal: the literal takes the i64 context (i64.const), not an invalid i32.const.
  assert.equal(instance.exports.mixLit(7n), 5000000007n);
});

// =============================================================================
// LLN-NUMERIC-001 — backend numeric-lowering safety gate (fail-closed)
//
// A scalar 64-bit width the WASM emitter cannot lower faithfully would be SILENTLY TRUNCATED
// 64→32 bit (a fail-open correctness hazard). checkValueStates rejects it fail-closed (always,
// not mode-gated) so the governed runtime and the production build — both of which run
// checkValueStates — refuse to emit a truncating module.
//
// Int64 was LIFTED 2026-06-25; UInt64 has now ALSO been LIFTED (owner-authorized, #52): the tree-walker
// carries it as a NON-NEGATIVE bigint via the exact-trapping u64-arith layer (overflow/underflow/÷0 TRAP,
// no silent 2^64 wrap), and the WASM emitter DECLINES it so it stays walker-only (no signed-i64 divergence).
// So BOTH 64-bit scalars are now ADMITTED and the BACKEND_UNLOWERABLE_SCALAR gate set is EMPTY (the gate
// machinery is dormant-but-intact — it fires again if any width is ever re-gated). Int8/Int16 widen to i32
// and Float32 widens to f64 (no value loss); a generic position like Tensor<Int64,…> (base "Tensor") is fine.
// =============================================================================

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseProgram, checkValueStates } from "../../dist/index.js";

const numericDiags = (src) => {
  const parsed = parseProgram(src, "numeric-gate-test.lln");
  const result = checkValueStates(parsed.ast);
  return (result.diagnostics ?? []).filter((d) => d.code === "LLN-NUMERIC-001");
};

describe("LLN-NUMERIC-001: UInt64 is LIFTED — admitted faithfully (the gate set is now empty)", () => {
  it("does NOT flag a scalar UInt64 RETURN type (#52 unlock)", () => {
    const diags = numericDiags(`pure flow widePay() -> UInt64 {\n  let amount: Int = 5\n  return amount\n}\n`);
    assert.equal(diags.length, 0, `UInt64 is unlocked — no LLN-NUMERIC-001 expected, got ${diags.length}`);
  });

  it("does NOT flag a scalar UInt64 PARAMETER or LOCAL (#52 unlock)", () => {
    const diags = numericDiags(`pure flow handle(n: UInt64) -> Int {\n  let big: UInt64 = 1\n  return 0\n}\n`);
    assert.equal(diags.length, 0, `UInt64 param + local are admitted, got ${diags.length}`);
  });
});

describe("LLN-NUMERIC-001: no false positives", () => {
  it("does NOT flag a scalar Int64 (LIFTED — emitter lowers it faithfully to i64)", () => {
    // Return, param, and local Int64 are all admitted post-lift.
    assert.equal(numericDiags(`pure flow widePay() -> Int64 {\n  let amount: Int = 5\n  return amount\n}\n`).length, 0);
    assert.equal(numericDiags(`pure flow handle(n: Int64) -> Int {\n  let big: Int64 = 1\n  return 0\n}\n`).length, 0);
  });

  it("does NOT flag a scalar Float return (faithfully lowered to f64)", () => {
    assert.equal(numericDiags(`pure flow addF() -> Float {\n  let a: Float = 0.5\n  return a\n}\n`).length, 0);
  });

  it("does NOT flag plain Int (i32)", () => {
    assert.equal(numericDiags(`pure flow plain(n: Int) -> Int {\n  let x: Int = n\n  return x\n}\n`).length, 0);
  });

  it("does NOT flag Int64 in a GENERIC position (Tensor<Int64,…> — base is 'Tensor', an opaque handle)", () => {
    assert.equal(numericDiags(`pure flow tensorOk(t: Tensor<Int64, [4]>) -> Int {\n  return 0\n}\n`).length, 0);
  });

  it("does NOT flag Int8/Int16/Float32 scalars (they widen, no value loss)", () => {
    assert.equal(numericDiags(`pure flow widen(a: Int8, b: Int16) -> Int {\n  let c: Float32 = 1.0\n  return 0\n}\n`).length, 0);
  });
});

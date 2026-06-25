// =============================================================================
// LLN-NUMERIC-001 — backend numeric-lowering safety gate (fail-closed)
//
// A scalar 64-bit width the WASM emitter cannot lower faithfully would be SILENTLY TRUNCATED
// 64→32 bit (a fail-open correctness hazard). checkValueStates rejects it fail-closed (always,
// not mode-gated) so the governed runtime and the production build — both of which run
// checkValueStates — refuse to emit a truncating module.
//
// Int64 has been LIFTED (owner-gated, 2026-06-25): the emitter now lowers it faithfully (i64,
// checked traps, walker ≡ WASM byte-exact), so a scalar Int64 is ADMITTED. Only UInt64 remains
// gated, until a faithful unsigned-64 arithmetic layer lands. Int8/Int16 widen to i32 and
// Float32 widens to f64 (no value loss); a generic position like Tensor<Int64,…> (base "Tensor")
// must NOT be flagged.
// =============================================================================

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseProgram, checkValueStates } from "../../dist/index.js";

const numericDiags = (src) => {
  const parsed = parseProgram(src, "numeric-gate-test.lln");
  const result = checkValueStates(parsed.ast);
  return (result.diagnostics ?? []).filter((d) => d.code === "LLN-NUMERIC-001");
};

describe("LLN-NUMERIC-001: still-gated 64-bit width (UInt64) fails closed", () => {
  it("flags a scalar UInt64 RETURN type", () => {
    const diags = numericDiags(`pure flow widePay() -> UInt64 {\n  let amount: Int = 5\n  return amount\n}\n`);
    assert.equal(diags.length, 1, "expected exactly one LLN-NUMERIC-001 for the UInt64 return");
    assert.equal(diags[0].severity, "error", "the gate must be fail-closed (severity error)");
    assert.equal(diags[0].name, "UnsupportedNumericWidth");
    assert.match(diags[0].message, /UInt64/);
  });

  it("flags a scalar UInt64 PARAMETER and a scalar UInt64 LOCAL (two diagnostics)", () => {
    const diags = numericDiags(`pure flow handle(n: UInt64) -> Int {\n  let big: UInt64 = 1\n  return 0\n}\n`);
    assert.equal(diags.length, 2, "expected one for the UInt64 param and one for the UInt64 local");
    assert.ok(diags.every((d) => d.severity === "error"));
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

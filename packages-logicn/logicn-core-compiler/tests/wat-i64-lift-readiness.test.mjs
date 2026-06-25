/**
 * Int64 gate-lift REGRESSION GUARD — pins the POST-lift state (owner-gated, 2026-06-25).
 *
 * The Int64 WASM lowering is faithful + proven byte-exact (see wat-i64-differential.test.mjs: walker ≡ WASM
 * over the full (2^53,2^63) corpus), so the `LLN-NUMERIC-001` gate has been LIFTED for Int64: declaring a
 * scalar Int64 in a real check/build/run now SUCCEEDS. UInt64 stays gated (no faithful unsigned-64 arith).
 *
 * The crux of the lift is a DELIBERATE SET SPLIT that this guard pins:
 *   • BACKEND_UNLOWERABLE_SCALAR  (the LLN-NUMERIC-001 GATE)        = { UInt64 }          — Int64 admitted
 *   • FAST_TIER_UNLOWERABLE_SCALAR (the bytecode-VM / sync bail)    = { Int64, UInt64 }   — Int64 STILL bails
 * Int64 is admitted by the gate (the WASM emitter + tree-walker carry it faithfully) yet MUST still route
 * off the i32-only fast tiers, which would silently truncate it. Folding the two back together would either
 * re-gate Int64 or let a fast tier truncate it — both fail-open. This test FAILS LOUDLY if either invariant
 * regresses (Int64 silently re-gated, UInt64 accidentally lifted, or the fast-tier bail dropped for Int64).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProgram, checkValueStates } from "../dist/index.js";
import { BACKEND_UNLOWERABLE_SCALAR, FAST_TIER_UNLOWERABLE_SCALAR, flowDeclaresUnlowerable64 } from "../dist/numeric-lowering.js";

const gateDiags = (src) => {
  const p = parseProgram(src, "lift.lln");
  return (checkValueStates(p.ast).diagnostics ?? []).filter((d) => d.code === "LLN-NUMERIC-001");
};
const firstFlow = (src) => parseProgram(src, "b.lln").ast.children.find((c) => c.kind === "pureFlowDecl");

test("Int64 is LIFTED: a scalar Int64 flow is ADMITTED by the gate (return / param / local all clean)", () => {
  assert.equal(gateDiags("pure flow f(n: Int) -> Int64 contract { effects {} } { return n }").length, 0, "Int64 RETURN must be admitted");
  assert.equal(gateDiags("pure flow f(a: Int64) -> Int contract { effects {} } { return 1 }").length, 0, "Int64 PARAM must be admitted");
  assert.equal(gateDiags("pure flow f() -> Int contract { effects {} } { let x: Int64 = 1  return 0 }").length, 0, "Int64 LOCAL must be admitted");
});

test("UInt64 STAYS gated: a scalar UInt64 flow still fails closed (return / param / local)", () => {
  const ret = gateDiags("pure flow f(n: Int) -> UInt64 contract { effects {} } { return n }");
  assert.ok(ret.length >= 1 && ret.every((d) => d.severity === "error"), "UInt64 RETURN must fail closed");
  const par = gateDiags("pure flow f(a: UInt64) -> Int contract { effects {} } { return 1 }");
  assert.ok(par.length >= 1 && par.every((d) => d.severity === "error"), "UInt64 PARAM must fail closed");
  const loc = gateDiags("pure flow f() -> Int contract { effects {} } { let x: UInt64 = 1  return 0 }");
  assert.ok(loc.length >= 1 && loc.every((d) => d.severity === "error"), "UInt64 LOCAL must fail closed");
});

test("set split is intact: gate set = {UInt64}; fast-tier bail set = {Int64, UInt64} (a superset)", () => {
  // The GATE no longer rejects Int64; only UInt64 (needs u64-arith). If this re-adds Int64, the lift regressed.
  assert.ok(!BACKEND_UNLOWERABLE_SCALAR.has("Int64"), "Int64 must be LIFTED from the gate set");
  assert.ok(BACKEND_UNLOWERABLE_SCALAR.has("UInt64"), "UInt64 stays gated (needs u64-arith)");
  // The FAST-TIER bail must keep BOTH — the i32-only tiers truncate Int64 even though the gate now admits it.
  assert.ok(FAST_TIER_UNLOWERABLE_SCALAR.has("Int64"), "Int64 must STILL bail off the i32-only fast tiers");
  assert.ok(FAST_TIER_UNLOWERABLE_SCALAR.has("UInt64"), "UInt64 must bail off the fast tiers");
  // The bail set is a strict superset of the gate set: everything gated is also fast-tier-unsafe.
  for (const w of BACKEND_UNLOWERABLE_SCALAR) assert.ok(FAST_TIER_UNLOWERABLE_SCALAR.has(w), `${w} must be in the bail set too`);
});

test("no false positive: a pure i32/f64 flow is NOT gated (the gate is precise)", () => {
  assert.equal(gateDiags("pure flow f(a: Int, b: Int) -> Int contract { effects {} } { return a + b }").length, 0);
  assert.equal(gateDiags("pure flow f(x: Float) -> Float contract { effects {} } { return x }").length, 0);
  // Int64/UInt64 in a GENERIC position is an opaque handle (base "Tensor"/"Array"), NOT a gated scalar.
  assert.equal(gateDiags("pure flow f(t: Tensor<Int64,[4]>) -> Int contract { effects {} } { return 1 }").length, 0);
  assert.equal(gateDiags("pure flow f(t: Array<UInt64>) -> Int contract { effects {} } { return 1 }").length, 0);
});

test("fast-tier bail SURVIVES the lift: flowDeclaresUnlowerable64 still catches Int64 (param/return/INTERNAL) + UInt64", () => {
  // Int64 must keep bailing to the faithful tree-walker even though the GATE now admits it — else the
  // i32-only bytecode VM / sync fast-path would silently truncate it (the fail-open the split prevents).
  assert.equal(flowDeclaresUnlowerable64(firstFlow("pure flow f(a: Int64) -> Int contract { effects {} } { return 1 }")), true, "param Int64");
  assert.equal(flowDeclaresUnlowerable64(firstFlow("pure flow f() -> Int64 contract { effects {} } { return 1 }")), true, "return Int64");
  assert.equal(flowDeclaresUnlowerable64(firstFlow("pure flow f(a: Int) -> Int contract { effects {} } { let y: Int64 = 1  return a }")), true, "INTERNAL Int64 (R1) — the bytecode per-param check misses this");
  assert.equal(flowDeclaresUnlowerable64(firstFlow("pure flow f(a: UInt64) -> Int contract { effects {} } { return 1 }")), true, "param UInt64");
  assert.equal(flowDeclaresUnlowerable64(firstFlow("pure flow f(a: Int) -> Int contract { effects {} } { return a + 1 }")), false, "no 64-bit scalar → runs on the fast tiers");
});

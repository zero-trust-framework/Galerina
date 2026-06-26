/**
 * Int64 gate-lift REGRESSION GUARD — pins the POST-lift state (owner-gated, 2026-06-25).
 *
 * The Int64 WASM lowering is faithful + proven byte-exact (see wat-i64-differential.test.mjs: walker ≡ WASM
 * over the full (2^53,2^63) corpus), so the `LLN-NUMERIC-001` gate was LIFTED for Int64. UInt64 has now ALSO
 * been lifted (#52): the tree-walker carries it as a NON-NEGATIVE bigint via the exact-trapping u64-arith
 * layer, and the WASM emitter DECLINES it (walker-only — unsigned ≠ signed i64). So both 64-bit scalars now
 * compile/build/run faithfully.
 *
 * The crux is a DELIBERATE SET SPLIT that this guard pins:
 *   • BACKEND_UNLOWERABLE_SCALAR  (the LLN-NUMERIC-001 GATE)        = { }                          — empty (both lifted)
 *   • FAST_TIER_UNLOWERABLE_SCALAR (the bytecode-VM / sync bail)    = { Int64, UInt64, Decimal }   — all STILL bail
 * The 64-bit widths are admitted by the gate (walker + WASM/u64-walker carry them) yet MUST still route off
 * the i32-only fast tiers, which would silently truncate them. Folding the two sets together would either
 * re-gate a working width or let a fast tier truncate one — both fail-open. This test FAILS LOUDLY if either
 * invariant regresses (a 64-bit width silently re-gated, or the fast-tier bail dropped).
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

test("UInt64 is LIFTED: a scalar UInt64 flow is ADMITTED by the gate (return / param / local all clean) (#52)", () => {
  assert.equal(gateDiags("pure flow f() -> UInt64 contract { effects {} } { let x: UInt64 = 1  return x }").length, 0, "UInt64 RETURN must be admitted");
  assert.equal(gateDiags("pure flow f(a: UInt64) -> Int contract { effects {} } { return 1 }").length, 0, "UInt64 PARAM must be admitted");
  assert.equal(gateDiags("pure flow f() -> Int contract { effects {} } { let x: UInt64 = 1  return 0 }").length, 0, "UInt64 LOCAL must be admitted");
});

test("set split: gate set is now EMPTY (UInt64 lifted); fast-tier bail set still pins {Int64, UInt64, Decimal}", () => {
  // The GATE rejects nothing now — Int64 (0cb6190) AND UInt64 (#52) are both lifted. If this re-adds either,
  // the lift regressed (a silent re-gate of a working width).
  assert.ok(!BACKEND_UNLOWERABLE_SCALAR.has("Int64"), "Int64 must be LIFTED from the gate set");
  assert.ok(!BACKEND_UNLOWERABLE_SCALAR.has("UInt64"), "UInt64 must be LIFTED from the gate set (#52)");
  assert.equal(BACKEND_UNLOWERABLE_SCALAR.size, 0, "the gate set is empty post-lift (dormant but intact)");
  // The FAST-TIER bail must keep BOTH 64-bit widths — the i32-only tiers truncate them even though the gate admits.
  assert.ok(FAST_TIER_UNLOWERABLE_SCALAR.has("Int64"), "Int64 must STILL bail off the i32-only fast tiers");
  assert.ok(FAST_TIER_UNLOWERABLE_SCALAR.has("UInt64"), "UInt64 must STILL bail off the fast tiers (walker-only)");
  // Invariant: the bail set is a superset of the gate set (everything gated is also fast-tier-unsafe) — vacuous now.
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

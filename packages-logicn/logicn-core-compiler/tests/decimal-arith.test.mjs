// decimal-arith — EXACT base-10 fixed-point for the Decimal type (the foundation for the "wrong VAT" fix).
// Decimal arithmetic must be exact (never IEEE-754): 0.1 + 0.2 = "0.3", not 0.30000000000000004.
// Computed on BigInt unscaled integers; malformed input fails closed; division stays unsupported.
//
// NOTE: this is the proven arithmetic LAYER only. Wiring it into the interpreter is deferred until the WASM
// tier is made consistent — the wat-emitter currently lowers `Decimal` to f64, so wiring the exact tree-walker
// path alone would make the tiers DIVERGE (tree-walker "0.3" vs WASM 0.30000000000000004). The complete fix
// (wire tree-walker + make the fast tiers bail on Decimal arithmetic, never the f64 path) is the follow-up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decAdd, decSub, decMul, decCompare, isDecTrap } from "../dist/decimal-arith.js";

// ── the exactness oracle (vs the f64 trap) ──
test("0.1 + 0.2 = 0.3 EXACTLY (the classic f64 failure, fixed)", () => {
  assert.equal(decAdd("0.1", "0.2"), "0.3");
  assert.notEqual(0.1 + 0.2, 0.3); // sanity: native f64 really does get this wrong
});

test("add/sub align scales and preserve the larger scale", () => {
  assert.equal(decAdd("0.10", "0.20"), "0.30");   // scale 2 preserved
  assert.equal(decAdd("1", "2.5"), "3.5");
  assert.equal(decSub("0.3", "0.1"), "0.2");
  assert.equal(decSub("5", "5.00"), "0.00");
  assert.equal(decSub("1.00", "3"), "-2.00");      // negative, scale preserved
});

test("multiply adds scales (exact)", () => {
  assert.equal(decMul("0.1", "0.1"), "0.01");
  assert.equal(decMul("1.5", "2"), "3.0");
  assert.equal(decMul("0.20", "100"), "20.00");    // a VAT-style scaling: 100 * 20% = 20.00
  assert.equal(decMul("-0.5", "0.5"), "-0.25");
});

test("exact across magnitudes a float would lose (>2^53)", () => {
  assert.equal(decAdd("9999999999999999", "1"), "10000000000000000");
  assert.equal(decAdd("0.0000000001", "0.0000000002"), "0.0000000003");
});

test("comparison is by VALUE not string ('0.1' == '0.10')", () => {
  assert.equal(decCompare("0.1", "0.10"), 0);
  assert.equal(decCompare("0.1", "0.2"), -1);
  assert.equal(decCompare("2.5", "2.50001"), -1);
  assert.equal(decCompare("-1", "-2"), 1);
});

test("malformed input fails closed (never a guessed value)", () => {
  assert.ok(isDecTrap(decAdd("abc", "1")));
  assert.ok(isDecTrap(decAdd("1", "")));
  assert.ok(isDecTrap(decMul("1.2.3", "1")));
  assert.ok(isDecTrap(decCompare("1", "x")));
});

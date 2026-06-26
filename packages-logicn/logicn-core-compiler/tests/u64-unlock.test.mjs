// UInt64 unlock (#52): the owner-authorized lift of UInt64 from the LLN-NUMERIC-001 gate. The exact-trapping
// u64-arith layer (overflow/underflow/÷0 TRAP, no silent 2^64 wrap) is now wired into the tree-walker as a
// NON-NEGATIVE bigint. UInt64 stays WALKER-ONLY (FAST_TIER_UNLOWERABLE) — the fast tiers bail and the WASM
// emitter DECLINES it (unsigned ≠ signed i64), so there is no silent tier divergence.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../dist/index.js";

async function run(body, ret = "UInt64") {
  const src = `pure flow probe() -> ${ret} {\n${body}\n}`;
  const p = L.parseProgram(src, "p.lln");
  assert.equal(p.diagnostics.filter((d) => d.severity === "error").length, 0, "parse");
  try { L.resolveSymbols(p.ast); L.checkTypes(p.ast); } catch {}
  const r = await L.executeFlow("probe", new Map(), p.ast);
  return r.value;
}
function tcDiags(src) {
  const p = L.parseProgram(src, "p.lln");
  L.resolveSymbols(p.ast);
  const tc = L.checkTypes(p.ast);
  return [...(p.diagnostics ?? []), ...(tc?.diagnostics ?? [])];
}

test("the LLN-NUMERIC-001 gate is LIFTED — a UInt64 declaration compiles clean", () => {
  const ds = tcDiags(`pure flow f() -> UInt64 {\n  let x: UInt64 = 42\n  return x\n}`);
  assert.ok(!ds.some((d) => d.code === "LLN-NUMERIC-001"), `UInt64 should be unlocked, got: ${ds.map((d) => d.code).join(",")}`);
});

test("UInt64 arithmetic is EXACT beyond 2^53 (where i32 would overflow)", async () => {
  const sum = await run("  let a: UInt64 = 3000000000\n  let b: UInt64 = 3000000000\n  return a + b");
  assert.equal(sum.__tag, "uint64"); assert.equal(sum.value, 6000000000n);
  const prod = await run("  let a: UInt64 = 4000000000\n  return a * a");
  assert.equal(prod.value, 16000000000000000000n); // 1.6e19 < 2^64, exact
});

test("UInt64 unsigned div/mod", async () => {
  assert.equal((await run("  let a: UInt64 = 10\n  let b: UInt64 = 3\n  return a / b")).value, 3n);
  assert.equal((await run("  let a: UInt64 = 10\n  let b: UInt64 = 3\n  return a % b")).value, 1n);
});

test("overflow TRAPS — no silent 2^64 wrap (the fail-open this gate guards)", async () => {
  const r = await run("  let m: UInt64 = 18446744073709551615\n  let one: UInt64 = 1\n  return m + one");
  assert.equal(r.__tag, "runtimeError");
  assert.equal(r.message, "IntegerOverflow");
});

test("unsigned underflow (0 - 1) TRAPS — never wraps to U64_MAX", async () => {
  const r = await run("  let z: UInt64 = 0\n  let one: UInt64 = 1\n  return z - one");
  assert.equal(r.__tag, "runtimeError");
  assert.equal(r.message, "IntegerOverflow");
});

test("divide-by-zero fails closed", async () => {
  const r = await run("  let a: UInt64 = 5\n  let z: UInt64 = 0\n  return a / z");
  assert.equal(r.message, "DivisionByZero");
});

test("a negative literal in a UInt64 slot is out-of-range (fail-closed)", async () => {
  const r = await run("  let n: UInt64 = -1\n  return n");
  assert.equal(r.__tag, "runtimeError");
  assert.equal(r.message, "IntegerOverflow");
});

test("UInt64 comparison", async () => {
  const r = await run("  let a: UInt64 = 10000000000\n  let b: UInt64 = 5\n  return a > b", "Bool");
  assert.equal(r.__tag, "bool"); assert.equal(r.value, true);
});

test("WASM tier DECLINES a UInt64 op (walker-only; no silent signed-i64 lowering)", () => {
  const src = `pure flow add(a: UInt64, b: UInt64) -> UInt64\ncontract { effects {} }\n{ return a + b }`;
  const p = L.parseProgram(src, "p.lln");
  assert.equal(p.diagnostics.filter((d) => d.severity === "error").length, 0);
  const fx = L.checkEffects(p.flows, p.ast);
  const { gir } = L.emitGIR(p.ast, p.flows, fx);
  const wat = L.renderWAT(L.buildWATModuleFromGIR(gir, undefined, "p", p.ast, true));
  // the UInt64 '+' must NOT lower to a faithful signed i64 add; it declines (unreachable) → bail to walker.
  assert.match(wat, /UInt64 .* not yet u64-faithful|unreachable/, "WASM must decline UInt64, not silently lower it");
  assert.ok(!/lln_checked_add_i64/.test(wat) || /unreachable/.test(wat), "must not emit a signed-i64 add for UInt64");
});

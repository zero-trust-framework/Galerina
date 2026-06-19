// =============================================================================
// 0040 / #70 — Output post-conditions (Design-by-Contract `invariant { ensure result … }`)
//
// A flow may declare an OUTPUT post-condition over its return value using the magic
// `result` symbol inside `invariant {}`. It is enforced FAIL-CLOSED at the single flow
// exit by the governed interpreter: a return value violating the post-condition becomes a
// runtimeError (LLN-INV-002) and never escapes — the same fail-closed posture as the i32
// trap (Fork-A) / 0038. `result`-referencing flows decline to the interpreter on the WASM
// tier until single-exit lowering lands; this file pins the interpreter enforcement.
//
// Pre-build state (verified): `ensure result …` was hard-REJECTED at compile time
// (LLN-NAME-001 symbol resolver + LLN-INV-004 governance verifier) — a fail-SAFE capability
// gap, not a leak. This adds the capability + enforces it fail-closed.
// =============================================================================

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  run, parseProgram, executeFlow, clearBytecodeCache, clearPureFlowCache,
} from "../dist/index.js";

const I = (value) => ({ __tag: "int", value });
const errCodes = (r) => r.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
const hasInv002 = (r) => (r.execution?.diagnostics ?? []).some((d) => d.code === "LLN-INV-002");

const CLAMP = `
pure flow clamp(a: Int) -> Int
contract {
  intent { "Output must stay within [0, 100]." }
  invariant {
    ensure result >= 0;
    ensure result <= 100;
  }
}
{ return a }
`;

describe("0040 output post-conditions — fail-closed enforcement at flow exit", () => {
  it("a return value violating `ensure result <= 100` FAILS CLOSED (does not leak)", async () => {
    const r = await run(CLAMP, "t.lln", "clamp", new Map([["a", I(200)]]));
    assert.equal(r.ok, false, "violation must fail closed");
    assert.equal(r.value?.__tag, "runtimeError", "violating result must NOT be returned as a value");
    assert.match(r.value?.message ?? "", /output post-condition/, "message names the violated post-condition");
    assert.match(r.value?.message ?? "", /result <= 100/, "message names the specific ensure");
    assert.ok(hasInv002(r), "LLN-INV-002 diagnostic emitted");
    assert.equal(r.execution?.audit?.result, "error", "audit records error (fail-closed)");
  });

  it("a return value violating `ensure result >= 0` FAILS CLOSED", async () => {
    const r = await run(CLAMP, "t.lln", "clamp", new Map([["a", I(-5)]]));
    assert.equal(r.ok, false);
    assert.equal(r.value?.__tag, "runtimeError");
    assert.match(r.value?.message ?? "", /result >= 0/);
  });

  it("a satisfying return value passes every post-condition and returns normally", async () => {
    const r = await run(CLAMP, "t.lln", "clamp", new Map([["a", I(50)]]));
    assert.equal(r.ok, true, "satisfying result returns ok");
    assert.equal(r.value?.__tag, "int");
    assert.equal(r.value?.value, 50);
    assert.ok(!hasInv002(r), "no post-condition diagnostic when all hold");
  });

  it("the boundary value (== the bound) satisfies a <= / >= post-condition", async () => {
    const hi = await run(CLAMP, "t.lln", "clamp", new Map([["a", I(100)]]));
    const lo = await run(CLAMP, "t.lln", "clamp", new Map([["a", I(0)]]));
    assert.equal(hi.ok, true, "result == upper bound holds");
    assert.equal(lo.ok, true, "result == lower bound holds");
  });

  it("a post-condition may reference a parameter as well as `result` (mixed predicate)", async () => {
    const src = `
pure flow atLeast(a: Int, floor: Int) -> Int
contract {
  intent { "Output must be at least the floor." }
  invariant { ensure result >= floor; }
}
{ return a }
`;
    const below = await run(src, "t.lln", "atLeast", new Map([["a", I(3)], ["floor", I(5)]]));
    const ok = await run(src, "t.lln", "atLeast", new Map([["a", I(10)], ["floor", I(5)]]));
    assert.equal(below.ok, false, "result below the floor fails closed");
    assert.equal(below.value?.__tag, "runtimeError");
    assert.equal(ok.ok, true, "result at/above the floor passes");
    assert.equal(ok.value?.value, 10);
  });
});

describe("0040 output post-conditions — compile-time acceptance / rejection", () => {
  it("`ensure result …` is ACCEPTED (no LLN-NAME-001 / LLN-INV-004) — the capability exists", async () => {
    const r = await run(CLAMP, "t.lln", "clamp", new Map([["a", I(50)]]));
    assert.ok(!errCodes(r).includes("LLN-NAME-001"), "`result` is in scope inside invariant ensure");
    assert.ok(!errCodes(r).includes("LLN-INV-004"), "`result` is not an unresolved symbol");
  });

  it("a genuine typo in an ensure is STILL rejected (LLN-NAME-001) — fail-safe preserved", async () => {
    const src = `
pure flow clamp(a: Int) -> Int
contract { intent { "x" } invariant { ensure bogus <= 100; } }
{ return a }
`;
    const r = await run(src, "t.lln", "clamp", new Map([["a", I(50)]]));
    assert.equal(r.ok, false);
    assert.ok(errCodes(r).includes("LLN-NAME-001"), "unknown symbol in ensure is still an error");
  });

  it("a parameter-only invariant is unaffected (no `result` → existing pre-condition behaviour)", async () => {
    const src = `
pure flow pos(a: Int) -> Int
contract { intent { "x" } invariant { ensure a > 0; } }
{ return a }
`;
    const r = await run(src, "t.lln", "pos", new Map([["a", I(7)]]));
    assert.equal(r.ok, true, "param pre-condition flow runs unchanged");
    assert.equal(r.value?.value, 7);
  });
});

// =============================================================================
// Three-tier fidelity: a `result`-post-condition flow is an integer pure flow that would
// otherwise run on the bytecode VM (the fastest tier) and BYPASS the exit gate. The fast
// tiers must DECLINE it so the post-condition is enforced on EVERY tier (no fail-open).
// =============================================================================

const POST_SRC = `
pure flow clampInt(a: Int) -> Int
contract { intent { "Output bounded by 100." } invariant { ensure result <= 100; } }
{ return a }
`;

describe("0040 output post-conditions — three-tier fidelity (no fast-path fail-open)", () => {
  it("a post-condition flow run with pureFastPath declines the bytecode tier → governed exit", async () => {
    clearBytecodeCache?.();
    clearPureFlowCache?.();
    const p = parseProgram(POST_SRC, "fast.lln");

    // pureFastPath + integer args → this flow is bytecode-eligible; the post-condition guard must
    // route it to the governed tree-walker exit gate instead, where the violation fails closed.
    const bad = await executeFlow(
      "clampInt", new Map([["a", I(200)]]), p.ast, p.flows, undefined, undefined,
      { pureFastPath: true }, undefined, undefined,
    );
    assert.notEqual(bad.executionTier, "bytecode", "must NOT run on the bytecode tier (would bypass the gate)");
    assert.notEqual(bad.executionTier, "sync", "must NOT run on the sync fast-path tier");
    assert.notEqual(bad.executionTier, "cache", "must NOT be served from the pure-flow cache");
    assert.equal(bad.value.__tag, "runtimeError", "violation fails closed even with pureFastPath: true");
    assert.match(bad.value.message ?? "", /output post-condition/);

    // a satisfying value returns normally, also via the governed tier (byte-identical to the reference)
    const good = await executeFlow(
      "clampInt", new Map([["a", I(50)]]), p.ast, p.flows, undefined, undefined,
      { pureFastPath: true }, undefined, undefined,
    );
    assert.equal(good.value.__tag, "int");
    assert.equal(good.value.value, 50);

    const ref = await executeFlow(
      "clampInt", new Map([["a", I(200)]]), p.ast, p.flows, undefined, undefined,
      {}, undefined, undefined,
    );
    assert.equal(ref.value.__tag, "runtimeError", "reference tree-walker also fails closed");
    assert.equal(bad.value.message, ref.value.message, "fast-path-declined + reference traps are byte-identical");
  });
});

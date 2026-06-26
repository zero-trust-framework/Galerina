import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseProgram, checkEffects } from "../dist/index.js";

// SPORE-TIER-001 — flow-kind tier floor (landing B, production-gated / default-off).
// These tests drive checkEffects with the explicit 4th arg enforceTierFloor.

function check(source, enforceTierFloor) {
  const parsed = parseProgram(source, "test.spore");
  // mode "production" + explicit floor flag (or default false when omitted).
  return enforceTierFloor === undefined
    ? checkEffects(parsed.flows, parsed.ast ?? { kind: "program" })
    : checkEffects(parsed.flows, parsed.ast ?? { kind: "program" }, "production", enforceTierFloor);
}

function hasDiag(results, code) {
  return results.flatMap((r) => r.diagnostics).some((d) => d.code === code);
}

// A guarded flow that performs an outbound HTTP POST (→ network.outbound, a secure-required effect)
// and declares the effect honestly. Under-tiered: it should be `secure`, not `guarded`.
const GUARDED_HTTP = `
guarded flow pushOrder(order: Order) -> Result<Unit, Error>
  contract { effects { network.outbound } }
{
  let r = http.post("https://api.example.com/orders", order)?
  return Ok(unit)
}
`;

// Same effect, but correctly declared `secure` — the floor must NOT fire.
const SECURE_HTTP = `
secure flow pushOrder(order: Order) -> Result<Unit, Error>
  contract { effects { network.outbound } }
{
  let r = http.post("https://api.example.com/orders", order)?
  return Ok(unit)
}
`;

// Pure flow + the same effect — already a hard SPORE-EFFECT-003 above; SPORE-TIER-001 must NOT fire here.
const PURE_HTTP = `
pure flow pushOrder(order: Order) -> Result<Unit, Error> {
  let r = http.post("https://api.example.com/orders", order)?
  return Ok(unit)
}
`;

// A benign guarded flow — database.read only. database.read is deliberately NOT in the
// secure-required set, so the conservative floor must NOT fire.
const GUARDED_BENIGN = `
guarded flow lookup(id: Id) -> Result<Order, Error>
  contract { effects { database.read } }
{
  let o = OrdersDB.find(id)?
  return Ok(o)
}
`;

describe("SPORE-TIER-001 — flow-kind tier floor (enforceTierFloor=true)", () => {
  it("(a) guarded flow + network.outbound → SPORE-TIER-001", () => {
    const results = check(GUARDED_HTTP, true);
    assert.ok(hasDiag(results, "SPORE-TIER-001"));
    const diag = results.flatMap((r) => r.diagnostics).find((d) => d.code === "SPORE-TIER-001");
    assert.equal(diag.name, "UNDER_DECLARED_FLOW_TIER");
    assert.equal(diag.severity, "error");
    assert.equal(diag.suggestedCode, "secure flow pushOrder");
  });

  it("(b) secure flow + network.outbound → NO SPORE-TIER-001", () => {
    const results = check(SECURE_HTTP, true);
    assert.ok(!hasDiag(results, "SPORE-TIER-001"));
  });

  it("(c) pure flow + network.outbound → still SPORE-EFFECT-003, NOT SPORE-TIER-001", () => {
    const results = check(PURE_HTTP, true);
    assert.ok(hasDiag(results, "SPORE-EFFECT-003"));
    assert.ok(!hasDiag(results, "SPORE-TIER-001"));
  });

  it("(d) guarded flow + database.read (benign) → NO SPORE-TIER-001 (conservative set holds)", () => {
    const results = check(GUARDED_BENIGN, true);
    assert.ok(!hasDiag(results, "SPORE-TIER-001"));
  });
});

describe("SPORE-TIER-001 — dev/check emits a WARNING (landing A, default-off escalation)", () => {
  function tierDiag(results) {
    return results.flatMap((r) => r.diagnostics).find((d) => d.code === "SPORE-TIER-001");
  }

  it("default 2-arg call: guarded flow + network.outbound emits SPORE-TIER-001 as a WARNING", () => {
    const diag = tierDiag(check(GUARDED_HTTP, undefined));
    assert.ok(diag, "expected SPORE-TIER-001 to fire in dev/check");
    assert.equal(diag.severity, "warning");
  });

  it("explicit enforceTierFloor=false: guarded flow + network.outbound emits SPORE-TIER-001 as a WARNING", () => {
    const diag = tierDiag(check(GUARDED_HTTP, false));
    assert.ok(diag, "expected SPORE-TIER-001 to fire in dev/check");
    assert.equal(diag.severity, "warning");
  });

  it("production (enforceTierFloor=true) escalates the SAME flow to an error", () => {
    const diag = tierDiag(check(GUARDED_HTTP, true));
    assert.ok(diag);
    assert.equal(diag.severity, "error");
  });

  it("secure flow under dev/check: still NO SPORE-TIER-001 (no false positive)", () => {
    assert.ok(!hasDiag(check(SECURE_HTTP, false), "SPORE-TIER-001"));
  });
});

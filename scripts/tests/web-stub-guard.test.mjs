// =============================================================================
// audit-web-stub-guard.mjs — RD-0100 web-* fail-closed contract enforcer tests.
//
// Locks the deny-by-default logicn-web-* posture BEFORE code exists: a stub is inert (passes),
// but an implemented web-* package must ship its LLN-WEB-* fail-closed acceptance tests in the
// same change (else the prose "deny-by-default" fails OPEN the moment impl lands).
// =============================================================================

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyPackage, scan } from "../audit-web-stub-guard.mjs";

describe("web-stub-guard: classifyPackage (pure detector)", () => {
  it("a STUB (no impl) is inert → no violation", () => {
    const r = classifyPackage("logicn-web-render", { exists: true, hasImpl: false, hasAcceptanceTest: false });
    assert.equal(r.violation, false);
    assert.equal(r.status, "STUB");
  });

  it("an IMPL without fail-closed acceptance tests → VIOLATION (born fail-open)", () => {
    const r = classifyPackage("logicn-web-render", { exists: true, hasImpl: true, hasAcceptanceTest: false });
    assert.equal(r.violation, true);
    assert.equal(r.status, "IMPL_NO_TESTS");
  });

  it("an IMPL WITH fail-closed acceptance tests → no violation (born fail-closed)", () => {
    const r = classifyPackage("logicn-web-render", { exists: true, hasImpl: true, hasAcceptanceTest: true });
    assert.equal(r.violation, false);
    assert.equal(r.status, "IMPL_GUARDED");
  });

  it("a contract package MISSING on disk → VIOLATION (drift)", () => {
    const r = classifyPackage("logicn-web-ghost", { exists: false, hasImpl: false, hasAcceptanceTest: false });
    assert.equal(r.violation, true);
    assert.equal(r.status, "MISSING");
  });
});

describe("web-stub-guard: live scan (current repo state)", () => {
  const results = scan();

  it("governs all 6 web-* packages and they are all currently inert stubs", () => {
    const stubs = results.filter((r) => r.status === "STUB").map((r) => r.pkg);
    for (const p of ["logicn-web", "logicn-web-render", "logicn-web-state", "logicn-web-router", "logicn-web-events", "logicn-web-components"]) {
      assert.ok(stubs.includes(p), `${p} should be a governed inert stub`);
    }
  });

  it("has zero violations today (zero-baseline — enforceable in CI)", () => {
    assert.equal(results.filter((r) => r.violation).length, 0);
  });
});

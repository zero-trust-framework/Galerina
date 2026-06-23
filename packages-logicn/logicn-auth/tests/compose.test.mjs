// compose.ts — conjunctive fold of factors + the (preview-only) boundary interpretation.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Verdict, composeAuthVerdict, previewAdmission } from "../dist/index.js";

test("all factors ALLOW → ALLOW (+1)", () => {
  assert.equal(composeAuthVerdict([Verdict.ALLOW, Verdict.ALLOW, Verdict.ALLOW]), Verdict.ALLOW);
});

test("any INDETERMINATE pulls the composite to INDETERMINATE (0)", () => {
  assert.equal(composeAuthVerdict([Verdict.ALLOW, Verdict.INDETERMINATE, Verdict.ALLOW]), Verdict.INDETERMINATE);
});

test("any DENY annihilates → DENY (−1)", () => {
  assert.equal(composeAuthVerdict([Verdict.ALLOW, Verdict.DENY, Verdict.INDETERMINATE]), Verdict.DENY);
});

test("empty factor set → INDETERMINATE (0) — deny-by-default, not vacuous ALLOW", () => {
  assert.equal(composeAuthVerdict([]), Verdict.INDETERMINATE);
});

test("a single ALLOW factor is preserved", () => {
  assert.equal(composeAuthVerdict([Verdict.ALLOW]), Verdict.ALLOW);
});

// previewAdmission is interpretation only — it mirrors what the kernel WILL decide.
test("previewAdmission(ALLOW) → authorized, decision allow, no diagnostic", () => {
  const d = previewAdmission(Verdict.ALLOW);
  assert.equal(d.authorized, true);
  assert.equal(d.decision, "allow");
  assert.equal(d.diagnostic, null);
});

test("previewAdmission(INDETERMINATE) → deny + LLN-GOV-3VL-001 diagnostic", () => {
  const seen = [];
  const d = previewAdmission(Verdict.INDETERMINATE, (x) => seen.push(x));
  assert.equal(d.authorized, false);
  assert.equal(d.decision, "deny");
  assert.equal(d.diagnostic?.code, "LLN-GOV-3VL-001");
  assert.equal(seen.length, 1);
});

test("previewAdmission(DENY) → deny, no diagnostic (ordinary policy denial)", () => {
  const d = previewAdmission(Verdict.DENY);
  assert.equal(d.authorized, false);
  assert.equal(d.decision, "deny");
  assert.equal(d.diagnostic, null);
});

// authorization.ts — the scope authorization factor (request-time RBAC).
import assert from "node:assert/strict";
import { test } from "node:test";
import { Verdict, scopeVerdict } from "../dist/index.js";

test("every required scope granted → ALLOW (+1)", () => {
  assert.equal(scopeVerdict(["orders.read", "orders.create"], ["orders.read", "orders.create", "extra"]), Verdict.ALLOW);
});

test("a missing required scope → DENY (−1)", () => {
  assert.equal(scopeVerdict(["orders.read", "admin"], ["orders.read"]), Verdict.DENY);
});

test("empty required → INDETERMINATE (0) — deny-by-default, not vacuous ALLOW", () => {
  assert.equal(scopeVerdict([], ["anything"]), Verdict.INDETERMINATE);
});

test("required but granted is empty → DENY (−1)", () => {
  assert.equal(scopeVerdict(["orders.read"], []), Verdict.DENY);
});

test("scope match is EXACT / case-sensitive — no implicit broadening", () => {
  assert.equal(scopeVerdict(["Orders.Read"], ["orders.read"]), Verdict.DENY);
  assert.equal(scopeVerdict(["orders"], ["orders.read"]), Verdict.DENY); // no prefix expansion
});

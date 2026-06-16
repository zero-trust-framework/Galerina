import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProgram } from "../dist/index.js";

// DX regression (tri-encryption dogfooding finding #1): a reserved LogicN keyword (e.g. `governance`,
// a V1 active keyword for the `governance {}` block) in PARAMETER position previously raised the bare
// generic "Expected parameter name" without saying WHY. The reservation is correct/intentional; the
// diagnostic should explain it. (parser.ts param-name parse.)
test("a reserved keyword as a parameter name EXPLAINS the reservation (not the bare generic error)", () => {
  const parsed = parseProgram(`pure flow f(governance: Int) -> Int { return 1 }`, "reserved-param.lln");
  const errs = (parsed.diagnostics ?? []).filter((d) => d.severity === "error");
  assert.ok(errs.length > 0, "must produce a diagnostic");
  const msg = errs.map((d) => d.message).join("\n");
  assert.match(msg, /reserved LogicN keyword/, "message must say it is a reserved keyword");
  assert.match(msg, /governance/, "message must name the offending keyword");
});

test("a non-keyword unexpected parameter token keeps the original generic message (no regression)", () => {
  const parsed = parseProgram(`pure flow f(123: Int) -> Int { return 1 }`, "bad-param.lln");
  const errs = (parsed.diagnostics ?? []).filter((d) => d.severity === "error");
  assert.ok(errs.length > 0);
  assert.match(errs.map((d) => d.message).join("\n"), /Expected parameter name/);
});

// =============================================================================
// LLN-VALUESTATE-006 — redact() discharge inside a record literal (docs-review)
//
// AuditLog.write({ email: redact(email) }) is THE canonical PII-redaction pattern
// in .lln. The check used to look up the record FIELD NAME ("email") as a binding
// and ignore the field VALUE, which produced:
//   • a FALSE POSITIVE — the redact()-wrapped field was rejected (broke ~35 example
//     files using the recommended pattern), and
//   • a FALSE NEGATIVE — a protected value in a non-name-matching field
//     ({ other: email }) escaped unchecked (a real PII leak).
// The fix recurses into the field VALUE: a redact()-wrapped field discharges; a
// bare protected value in ANY field still fails closed.
// =============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProgram, checkValueStates } from "../../dist/index.js";

const v6count = (body) => {
  const src = `secure flow f(email: protected String) -> Result<Int, ApiError> contract { effects { audit.write } } { ${body}  return Ok(1) }`;
  const p = parseProgram(src, "v6.lln");
  return (checkValueStates(p.ast).diagnostics ?? []).filter((d) => d.code === "LLN-VALUESTATE-006").length;
};

test("redact() inside a record-literal field discharges (canonical pattern admitted)", () => {
  assert.equal(v6count('AuditLog.write({ event: "x", email: redact(email) })'), 0);
});

test("redact() as a direct argument still discharges", () => {
  assert.equal(v6count("AuditLog.write(redact(email))"), 0);
});

test("an UNREDACTED protected value in a record field is still rejected (not weakened)", () => {
  assert.ok(v6count('AuditLog.write({ event: "x", email: email })') >= 1);
});

test("a bare protected value is still rejected", () => {
  assert.ok(v6count("AuditLog.write(email)") >= 1);
});

test("a protected value in a NON-name-matching field is now caught (false-negative closed)", () => {
  assert.ok(v6count('AuditLog.write({ event: "x", other: email })') >= 1);
});

// Unit test for the shared diagnostic-code regex (scripts/lib/codes.mjs). Locks the review wn8v30euh
// fixes: trailing-letter suffix, multi-segment codes, doc-range rejection, ERR_ wildcard handling.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCodes, CODE_TEST, familyOf, nsOf } from "../lib/codes.mjs";

test("trailing-letter suffix is preserved (005B not truncated to 005)", () => {
  assert.deepEqual(extractCodes("code: LLN-PROFILE-005B"), ["LLN-PROFILE-005B"]);
  assert.deepEqual(extractCodes("code: LLN-PROFILE-005"), ["LLN-PROFILE-005"]);
  assert.deepEqual(extractCodes("LLN-PROFILE-005 and LLN-PROFILE-005B"), ["LLN-PROFILE-005", "LLN-PROFILE-005B"]);
});

test("multi-segment codes match whole", () => {
  for (const c of ["LLN-GOV-3VL-001", "LLN-CRYPTO-PQ-001", "LLN-SYNTAX-LEGACY-003", "LLN-BOOL-BOUNDARY-001"]) {
    assert.deepEqual(extractCodes("x " + c + " y"), [c]);
    assert.ok(CODE_TEST.test(c), c + " must satisfy CODE_TEST");
  }
});

test("doc range tokens are dropped (not phantom single codes)", () => {
  assert.deepEqual(extractCodes("see LLN-ACCESS-001-002 for the range"), []);
  assert.deepEqual(extractCodes("LLN-ACCESS-001-002 LLN-GOV-001"), ["LLN-GOV-001"]);
});

test("ERR_ codes match; trailing-underscore wildcard does not capture the underscore", () => {
  assert.deepEqual(extractCodes("code: ERR_REGISTRY_PACKAGE_UNKNOWN"), ["ERR_REGISTRY_PACKAGE_UNKNOWN"]);
  assert.deepEqual(extractCodes("the ERR_AI_* family"), ["ERR_AI"]);
});

test("extractCodes de-dupes in order", () => {
  assert.deepEqual(extractCodes("LLN-GOV-001 LLN-GOV-001 LLN-GOV-002"), ["LLN-GOV-001", "LLN-GOV-002"]);
});

test("CODE_TEST is anchored (whole token only)", () => {
  assert.ok(CODE_TEST.test("LLN-GOV-001"));
  assert.ok(!CODE_TEST.test("see LLN-GOV-001 here"));
  assert.ok(CODE_TEST.test("ERR_X_Y"));
  assert.ok(!CODE_TEST.test("ERR_AI_"));
});

test("familyOf / nsOf", () => {
  assert.equal(familyOf("LLN-GOV-3VL-001"), "GOV");
  assert.equal(familyOf("ERR_X_Y"), "ERR_*");
  assert.equal(nsOf("LLN-GOV-001"), "LLN");
  assert.equal(nsOf("ERR_X"), "ERR");
});

// credential.ts — the required-auth posture factor: "presence is NOT authentication".
import assert from "node:assert/strict";
import { test } from "node:test";
import { Verdict, headerPresenceVerdict } from "../dist/index.js";

// ── Tightened default: header presence can NEVER authorize ──
test("default: header PRESENT → INDETERMINATE (presence is not authentication)", () => {
  assert.equal(headerPresenceVerdict({ authorization: "Bearer tok" }), Verdict.INDETERMINATE);
});

test("default: header ABSENT → INDETERMINATE", () => {
  assert.equal(headerPresenceVerdict({}), Verdict.INDETERMINATE);
});

// ── Legacy opt-in: presence-as-proof, but still fail-closed on absence/emptiness ──
test("opt-in: non-empty header → ALLOW (legacy presence-only admission)", () => {
  assert.equal(
    headerPresenceVerdict({ authorization: "Bearer tok" }, { allowHeaderPresenceFallback: true }),
    Verdict.ALLOW,
  );
});

test("opt-in: header ABSENT → INDETERMINATE (fail-closed)", () => {
  assert.equal(headerPresenceVerdict({}, { allowHeaderPresenceFallback: true }), Verdict.INDETERMINATE);
});

test("opt-in: EMPTY header value → INDETERMINATE (stricter than the kernel's key-presence branch)", () => {
  assert.equal(
    headerPresenceVerdict({ authorization: "" }, { allowHeaderPresenceFallback: true }),
    Verdict.INDETERMINATE,
  );
  assert.equal(
    headerPresenceVerdict({ authorization: "   " }, { allowHeaderPresenceFallback: true }),
    Verdict.INDETERMINATE,
  );
});

test("opt-in: header name matched case-insensitively", () => {
  assert.equal(
    headerPresenceVerdict({ Authorization: "Bearer tok" }, { allowHeaderPresenceFallback: true }),
    Verdict.ALLOW,
  );
});

test("opt-in: a custom header name can be inspected", () => {
  assert.equal(
    headerPresenceVerdict({ "x-api-key": "abc" }, { allowHeaderPresenceFallback: true, header: "x-api-key" }),
    Verdict.ALLOW,
  );
  // The default `authorization` header is now irrelevant → absent → INDETERMINATE.
  assert.equal(
    headerPresenceVerdict({ authorization: "Bearer tok" }, { allowHeaderPresenceFallback: true, header: "x-api-key" }),
    Verdict.INDETERMINATE,
  );
});

// channel.ts — the TLSTP S1 channel/identity factor. Delegates to the shipped
// certGate; here we assert the factor surfaces its fail-closed K3 verdict.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Verdict, channelIdentityVerdict } from "../dist/index.js";

const NOW = 1_000_000;
function goodInput(over = {}) {
  return {
    pinnedDigests: ["sha256:abc"],
    presentedDigest: "sha256:abc",
    chainOutcome: "valid",
    notBefore: NOW - 1000,
    notAfter: NOW + 1000,
    now: NOW,
    revocation: "good",
    revocationProducedAt: NOW - 100,
    revocationFreshnessMs: 300_000,
    ...over,
  };
}

test("all factors proven → ALLOW (+1)", () => {
  assert.equal(channelIdentityVerdict(goodInput()), Verdict.ALLOW);
});

test("revocation UNKNOWN → INDETERMINATE (0) — the headline soft-fail closure", () => {
  assert.equal(channelIdentityVerdict(goodInput({ revocation: "unknown" })), Verdict.INDETERMINATE);
});

test("revocation absent → INDETERMINATE (0), never +1 (fail-closed seam)", () => {
  assert.equal(channelIdentityVerdict(goodInput({ revocation: undefined })), Verdict.INDETERMINATE);
});

test("revoked → DENY (−1)", () => {
  assert.equal(channelIdentityVerdict(goodInput({ revocation: "revoked" })), Verdict.DENY);
});

test("chain invalid → DENY (−1)", () => {
  assert.equal(channelIdentityVerdict(goodInput({ chainOutcome: "invalid" })), Verdict.DENY);
});

test("pin mismatch → DENY (−1) — the MITM-with-valid-cert case", () => {
  assert.equal(channelIdentityVerdict(goodInput({ presentedDigest: "sha256:zzz" })), Verdict.DENY);
});

test("expired (now > notAfter) → DENY (−1)", () => {
  assert.equal(channelIdentityVerdict(goodInput({ now: NOW + 5000 })), Verdict.DENY);
});

test("empty input → INDETERMINATE (0), nothing proven", () => {
  assert.equal(channelIdentityVerdict({}), Verdict.INDETERMINATE);
});

test("degrade-only side-signal can only LOWER, never lift (No-Coercion)", () => {
  // A 0 side-signal pulls a proven +1 channel down to 0; it can never raise a verdict.
  assert.equal(channelIdentityVerdict(goodInput({ sideSignals: [Verdict.INDETERMINATE] })), Verdict.INDETERMINATE);
  // A +1 side-signal does not change an already-+1 verdict and cannot lift a 0.
  assert.equal(channelIdentityVerdict(goodInput({ sideSignals: [Verdict.ALLOW] })), Verdict.ALLOW);
  assert.equal(
    channelIdentityVerdict(goodInput({ revocation: "unknown", sideSignals: [Verdict.ALLOW] })),
    Verdict.INDETERMINATE,
  );
});

test("onDiagnostic fires LLN-GOV-3VL-001 when the verdict is INDETERMINATE", () => {
  const seen = [];
  channelIdentityVerdict(goodInput({ revocation: "unknown" }), (d) => seen.push(d));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].code, "LLN-GOV-3VL-001");
});

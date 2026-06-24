/**
 * @logicn/devtools-pci — 0084-pci-unknown fail-closed regression tests.
 *
 * Proves: unknown -> not-pass (parse failure => indeterminate; requireFullAttestation
 * surfaces the unmodelled families as a deny), while a clean fully-modelled input
 * still passes (no false-positive regression).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  runPciAudit,
  PCI_UNMODELLED_FAMILIES,
} from "../dist/index.js";

// ---------------------------------------------------------------------------
// 1. Unmodelled families are ALWAYS surfaced as not-attested (never silently passed)
// ---------------------------------------------------------------------------
describe("0084-pci-unknown: unmodelled families reported as not-attested", () => {
  it("a clean source lists families 1,2,5,9,11 in notAttested", () => {
    const source = "pure flow f() -> Int contract { effects {} } { return 1 }";
    const report = runPciAudit(source, "clean.lln");

    assert.deepEqual(
      [...report.notAttested].sort(),
      [...PCI_UNMODELLED_FAMILIES].sort(),
      "notAttested must list exactly the unmodelled PCI families (1,2,5,9,11)",
    );
    for (const fam of PCI_UNMODELLED_FAMILIES) {
      assert.ok(
        !report.passedRequirements.includes(fam),
        `unmodelled family ${fam} must NOT appear in passedRequirements`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Parse failure => verdict "indeterminate", passed=false (blind oracle denies)
// ---------------------------------------------------------------------------
describe("0084-pci-unknown: blind audit is indeterminate, not pass", () => {
  it("an unparseable source is verdict=indeterminate and passed=false", () => {
    const report = runPciAudit("@@@ this is not valid logicn %%% {{{", "broken.lln");
    assert.equal(report.passed, false, "blind audit must not pass");
    assert.ok(
      report.verdict === "indeterminate" || report.verdict === "fail",
      `blind audit must be indeterminate/fail, got '${report.verdict}'`,
    );
    assert.ok(
      report.findings.some(f => f.code === "LLN-PCI-000"),
      "a LLN-PCI-000 ParseFailure finding must be present",
    );
  });
});

// ---------------------------------------------------------------------------
// 3. requireFullAttestation flips an otherwise-clean source to indeterminate
//    (the unmodelled infra families cannot be attested from source alone)
// ---------------------------------------------------------------------------
describe("0084-pci-unknown: requireFullAttestation denies on incomplete attestation", () => {
  it("clean source + requireFullAttestation => indeterminate, passed=false", () => {
    const source = "pure flow f() -> Int contract { effects {} } { return 1 }";
    const report = runPciAudit(source, { fileName: "clean.lln", requireFullAttestation: true });
    assert.equal(report.verdict, "indeterminate",
      "full-attestation mode must report indeterminate when infra families are unmodelled");
    assert.equal(report.passed, false, "full-attestation mode must not pass an unattestable source");
    assert.ok(report.notAttested.length > 0, "notAttested must be non-empty");
  });
});

// ---------------------------------------------------------------------------
// 4. NO FALSE POSITIVE: a clean fully-modelled input still passes by default
// ---------------------------------------------------------------------------
describe("0084-pci-unknown: clean modelled input still passes (no regression)", () => {
  it("a fully-compliant payment flow passes with verdict=pass by default", () => {
    const source = [
      "secure flow processPayment(req: Request) -> Result<PaymentId, PaymentError>",
      "contract {",
      "  intent { \"Process a payment securely with full audit trail and access control.\" }",
      "  effects { database.write  audit.write }",
      "  privacy { mask cardNumber  mask cvv }",
      "  target { tls: \"1.3\" }",
      "}",
      "authority { requires role: \"payment-processor\"  sharing protected CardData to \"payment-gateway\"  approved_by \"security-board\" }",
      "{",
      "  let validCard = validate.cardData(req.body.cardNumber)?",
      "  let txn = PaymentDB.insert({ card: validCard })?",
      "  AuditLog.write({ event: \"PaymentProcessed\", txnId: txn.id, card: redact(validCard) })",
      "  return Ok(txn.id)",
      "}",
    ].join("\n");

    const report = runPciAudit(source, "compliant-payment.lln");
    const severe = report.findings.filter(f => f.severity === "critical" || f.severity === "high");
    assert.equal(severe.length, 0, `expected 0 severe findings, got: [${severe.map(f => f.code).join(", ")}]`);
    assert.equal(report.verdict, "pass", "fully-compliant flow must have verdict=pass");
    assert.equal(report.passed, true, "fully-compliant flow must pass by default");
  });

  it("bare-string second arg (back-compat) still works", () => {
    const report = runPciAudit("pure flow g() -> Int contract { effects {} } { return 2 }", "compat.lln");
    assert.equal(report.passed, true, "clean source passes with legacy string fileName arg");
    assert.equal(report.verdict, "pass");
  });
});

/**
 * @logicn/devtools-security — 0084-secaudit-unknown fail-closed regression tests.
 *
 * Proves: a blind/partial audit (parse failure) is verdict="indeterminate" /
 * passed=false (unknown -> deny), while a genuinely clean program where every
 * checker ran still passes (no false-positive regression). Also guards the
 * rd-0098 invariant (parse-fail must never report passed=true).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runSecurityAudit } from "../dist/index.js";

// ---------------------------------------------------------------------------
// 1. Parse failure => indeterminate, passed=false (blind oracle denies)
// ---------------------------------------------------------------------------
describe("0084-secaudit-unknown: blind audit denies-by-default", () => {
  it("an unparseable source is verdict=indeterminate and passed=false", async () => {
    const report = await runSecurityAudit("@@@ not valid logicn %%% {{{ unterminated", { fileName: "x.lln" });
    assert.equal(report.passed, false, "blind audit must not pass");
    assert.equal(report.verdict, "indeterminate", `expected indeterminate, got '${report.verdict}'`);
    // No checker ran on an unparseable program => all four are not-attested.
    assert.ok(report.indeterminate.length > 0, "indeterminate[] must list the not-attested checkers");
    assert.ok(report.summary.includes("LLN-GOV-3VL-001"), "summary must cite the undecided-collapse code");
  });

  it("unterminated block also denies (no passed=true on partial parse)", async () => {
    const report = await runSecurityAudit("secure flow Pay { effects { audit.write ", { fileName: "x.lln" });
    assert.notEqual(report.passed, true, "a source that fails to parse must never report passed=true");
  });
});

// ---------------------------------------------------------------------------
// 2. NO FALSE POSITIVE: a clean program where all four checkers ran still passes
// ---------------------------------------------------------------------------
describe("0084-secaudit-unknown: clean modelled input still passes (no regression)", () => {
  it("a clean pure flow passes with verdict=pass and no not-attested checkers", async () => {
    const report = await runSecurityAudit(
      "pure flow add(a: Int, b: Int) -> Int contract { effects {} } { return a + b }",
      { profiles: ["strict"] },
    );
    assert.equal(report.passed, true, `expected pass, got: ${report.summary}`);
    assert.equal(report.verdict, "pass", "clean program where all checkers ran must be verdict=pass");
    assert.equal(report.indeterminate.length, 0, "all four checkers ran => nothing not-attested");
  });
});

// ---------------------------------------------------------------------------
// 3. A real finding => verdict=fail (DENY beats INDETERMINATE)
// ---------------------------------------------------------------------------
describe("0084-secaudit-unknown: a gate finding fails (not indeterminate)", () => {
  it("SQL injection is verdict=fail, passed=false", async () => {
    const report = await runSecurityAudit([
      "secure flow q(req: Request) -> Response contract { effects { database.read } }",
      "{ let r: String = Database.query(req.body)  return r }",
    ].join("\n"), { profiles: ["strict"] });
    assert.ok(report.findings.some(f => f.code === "LLN-TAINT-001"), `expected LLN-TAINT-001, got: ${report.summary}`);
    assert.equal(report.verdict, "fail", "a gate finding must produce verdict=fail");
    assert.equal(report.passed, false, "should fail when injection is detected");
  });
});

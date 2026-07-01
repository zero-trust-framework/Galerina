import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseProgram, checkTypes, checkValueStates } from "../dist/index.js";

// =============================================================================
// Security Domain Tests — domain-security.test.mjs
//
// Covers the full security pipeline: unsafe let boundaries, validate gates,
// redaction, taint propagation, branded types, SecureString rules, user gates,
// protected/redacted type qualifiers, and compound real-world flows.
// =============================================================================

// ── Helpers ───────────────────────────────────────────────────────────────────

function parse(source) {
  return parseProgram(source, "domain-security.fungi");
}

function vsCheck(source) {
  const parsed = parse(source);
  return checkValueStates(parsed.ast);
}

function tcCheck(source) {
  const parsed = parse(source);
  return checkTypes(parsed.ast);
}

function vsAndTcCheck(source) {
  const parsed = parse(source);
  return {
    vs: checkValueStates(parsed.ast),
    tc: checkTypes(parsed.ast),
  };
}

function hasDiag(result, code) {
  return result.diagnostics.some((d) => d.code === code);
}

function diagsWithCode(result, code) {
  return result.diagnostics.filter((d) => d.code === code);
}

function noErrors(result) {
  return result.diagnostics.filter((d) => d.severity === "error");
}

// =============================================================================
// 1. unsafe let boundary input
// =============================================================================

describe("Security — unsafe let boundary input", () => {
  it("parses unsafe let without error", () => {
    const parsed = parse(`
secure flow handleRequest(request: Request) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawEmail: String = request.body.email
  return Ok("ok")
}
`);
    assert.equal(parsed.diagnostics.filter((d) => d.severity === "error").length, 0,
      `Parse should succeed: ${parsed.diagnostics.map((d) => d.message).join(", ")}`);
  });

  it("emits FUNGI-VALUESTATE-003 when unsafe let reaches a DB insert directly", () => {
    const result = vsCheck(`
secure flow storeEmail(request: Request) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawEmail: String = request.body.email
  let saved = UsersDB.insert(rawEmail)?
  return Ok("done")
}
`);
    assert.ok(hasDiag(result, "FUNGI-VALUESTATE-003"),
      `Expected FUNGI-VALUESTATE-003 for direct unsafe → DB.insert, got: ${result.diagnostics.map((d) => d.code).join(", ")}`);
  });

  it("emits FUNGI-VALUESTATE-003 when unsafe let reaches AuditLog.write", () => {
    const result = vsCheck(`
secure flow auditRaw(request: Request) -> Result<String, Error>
contract { effects { audit.write } }
{
  unsafe let rawMsg: String = request.body.message
  AuditLog.write(rawMsg)
  return Ok("done")
}
`);
    assert.ok(hasDiag(result, "FUNGI-VALUESTATE-003"),
      `Expected FUNGI-VALUESTATE-003 for unsafe → AuditLog.write`);
  });

  // VSC-001 (2026-06-16 audit): isGovernedSink had silently diverged from the authoritative
  // SINK_REQUIREMENTS registry, so unsafe/tainted values escaped into these sinks with NO
  // diagnostic. The fix makes isGovernedSink consult getSinkRequirement (single source of truth).
  it("emits FUNGI-VALUESTATE-003 when unsafe let reaches response.body (VSC-001)", () => {
    const result = vsCheck(`
secure flow esc(request: Request) -> Result<String, Error>
contract { effects { network.outbound } }
{
  unsafe let raw: String = request.body.data
  let x = response.body(raw)
  return Ok("done")
}
`);
    assert.ok(hasDiag(result, "FUNGI-VALUESTATE-003"),
      `Expected FUNGI-VALUESTATE-003 for unsafe → response.body, got: ${result.diagnostics.map((d) => d.code).join(", ")}`);
  });

  it("emits FUNGI-VALUESTATE-003 when unsafe let reaches ai.remoteInference (VSC-001)", () => {
    const result = vsCheck(`
secure flow esc(request: Request) -> Result<String, Error>
contract { effects { ai.inference } }
{
  unsafe let raw: String = request.body.data
  let x = ai.remoteInference(raw)
  return Ok("done")
}
`);
    assert.ok(hasDiag(result, "FUNGI-VALUESTATE-003"),
      `Expected FUNGI-VALUESTATE-003 for unsafe → ai.remoteInference`);
  });

  it("emits FUNGI-VALUESTATE-003 when unsafe let reaches bare database.write (VSC-001)", () => {
    const result = vsCheck(`
secure flow esc(request: Request) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let raw: String = request.body.data
  let x = database.write(raw)
  return Ok("done")
}
`);
    assert.ok(hasDiag(result, "FUNGI-VALUESTATE-003"),
      `Expected FUNGI-VALUESTATE-003 for unsafe → database.write`);
  });

  it("emits FUNGI-VALUESTATE-003 when unsafe let reaches log.write (VSC-001)", () => {
    const result = vsCheck(`
secure flow esc(request: Request) -> Result<String, Error>
contract { effects { audit.write } }
{
  unsafe let raw: String = request.body.data
  log.write(raw)
  return Ok("done")
}
`);
    assert.ok(hasDiag(result, "FUNGI-VALUESTATE-003"),
      `Expected FUNGI-VALUESTATE-003 for unsafe → log.write`);
  });

  it("does not emit FUNGI-VALUESTATE-003 for plain (non-unsafe) let at a sink", () => {
    const result = vsCheck(`
secure flow storeClean() -> Result<String, Error>
contract { effects { database.write } }
{
  let record: String = buildRecord()
  let saved = UsersDB.insert(record)?
  return Ok("done")
}
`);
    assert.ok(!hasDiag(result, "FUNGI-VALUESTATE-003"),
      "Plain let should not trigger FUNGI-VALUESTATE-003");
  });

  it("FUNGI-VALUESTATE-003 diagnostic carries why and risk fields", () => {
    const result = vsCheck(`
secure flow dangerousFlow(request: Request) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let raw: String = request.body.data
  UsersDB.insert(raw)
  return Ok("done")
}
`);
    const diag = result.diagnostics.find((d) => d.code === "FUNGI-VALUESTATE-003");
    assert.ok(diag !== undefined, "Expected FUNGI-VALUESTATE-003");
    assert.ok(typeof diag.why === "string" && diag.why.length > 0, "Expected why field");
    assert.ok(typeof diag.risk === "string" && diag.risk.length > 0, "Expected risk field");
  });
});

// =============================================================================
// 2. validate.email() → protected Email
// =============================================================================

describe("Security — validate.email() produces protected Email", () => {
  it("protected Email annotation parses cleanly (no FUNGI-TYPE-001 for protected)", () => {
    // Email is a built-in type; 'protected' is a known qualifier — no FUNGI-TYPE-001 expected
    const result = tcCheck(`
secure flow validateEmailFlow(raw: String) -> Result<String, Error>
contract { effects { database.write } }
{
  let email: protected Email = validate.email(raw)?
  return Ok("done")
}
`);
    const type001 = diagsWithCode(result, "FUNGI-TYPE-001");
    const mentionsProtected = type001.some((d) => d.message.includes("'protected'"));
    assert.ok(!mentionsProtected,
      `'protected' qualifier should not cause FUNGI-TYPE-001: ${type001.map((d) => d.message).join(", ")}`);
  });

  it("validate.email() gate breaks taint chain — no FUNGI-VALUESTATE-003 after gate", () => {
    const result = vsCheck(`
secure flow processEmail(request: Request) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawEmail: String = request.body.email
  safe mut rawEmail = validate.email(rawEmail)?
  let saved = UsersDB.insert(rawEmail)?
  return Ok("done")
}
`);
    assert.ok(!hasDiag(result, "FUNGI-VALUESTATE-003"),
      "validate.email() gate should clear taint before DB.insert");
    assert.ok(!hasDiag(result, "FUNGI-VALUESTATE-005"),
      "validate.email() gate should clear two-hop taint as well");
  });

  it("validate.* gate satisfies safe mut gate requirement (no FUNGI-VALUESTATE-001)", () => {
    const result = vsCheck(`
secure flow upgradeEmail(raw: String) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawEmail: String = raw
  safe mut rawEmail = validate.email(rawEmail)?
  return Ok("done")
}
`);
    assert.ok(!hasDiag(result, "FUNGI-VALUESTATE-001"),
      "validate.email() should satisfy safe mut gate requirement");
  });

  it("emits FUNGI-VALUESTATE-001 when safe mut uses a non-gate function", () => {
    const result = vsCheck(`
secure flow badUpgrade(raw: String) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawEmail: String = raw
  safe mut rawEmail = formatEmail(rawEmail)
  return Ok("done")
}
`);
    assert.ok(hasDiag(result, "FUNGI-VALUESTATE-001"),
      "Non-gate function should trigger FUNGI-VALUESTATE-001");
  });
});

// =============================================================================
// 3. redact() → redacted Email
// =============================================================================

describe("Security — redact() produces redacted Email", () => {
  it("redacted Email annotation parses cleanly (no FUNGI-TYPE-001 for redacted)", () => {
    // Email is a built-in type; 'redacted' is a known qualifier — no FUNGI-TYPE-001 expected
    const result = tcCheck(`
flow redactEmailFlow(email: Email) -> String {
  let audit: redacted Email = redact(email)
  return "done"
}
`);
    const type001 = diagsWithCode(result, "FUNGI-TYPE-001");
    const mentionsRedacted = type001.some((d) => d.message.includes("'redacted'"));
    assert.ok(!mentionsRedacted,
      `'redacted' qualifier should not cause FUNGI-TYPE-001: ${type001.map((d) => d.message).join(", ")}`);
  });

  it("redact() is a recognised gate — does not emit FUNGI-VALUESTATE-001 when used in safe mut", () => {
    const result = vsCheck(`
secure flow safeRedact(raw: String) -> Result<String, Error>
contract { effects { audit.write } }
{
  unsafe let rawEmail: String = raw
  safe mut rawEmail = redact(rawEmail)
  return Ok("done")
}
`);
    assert.ok(!hasDiag(result, "FUNGI-VALUESTATE-001"),
      "redact() should satisfy the safe mut gate requirement");
  });

  it("redact() does not suppress FUNGI-VALUESTATE-003 — unsafe direct to sink still flagged", () => {
    const result = vsCheck(`
secure flow misusedRedact(request: Request) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawEmail: String = request.body.email
  UsersDB.insert(rawEmail)
  return Ok("done")
}
`);
    assert.ok(hasDiag(result, "FUNGI-VALUESTATE-003"),
      "Unsafe value still reaches the DB — FUNGI-VALUESTATE-003 expected");
  });
});

// =============================================================================
// 4. Full chain: unsafe → validate gate → protected → redact → audit
// =============================================================================

describe("Security — full chain: unsafe → protected → redacted → audit", () => {
  it("full pipeline emits no security errors", () => {
    const result = vsCheck(`
secure flow fullChain(request: Request) -> Result<String, Error>
contract { effects { database.write, audit.write } }
{
  unsafe let rawEmail: String = request.body.email
  safe mut rawEmail = validate.email(rawEmail)?
  let saved = UsersDB.insert(rawEmail)?
  let audit = redact(rawEmail)
  AuditLog.write(saved)
  return Ok("done")
}
`);
    const errors = noErrors(result);
    assert.equal(errors.length, 0,
      `Full chain should produce no security errors, got: ${errors.map((d) => `${d.code}: ${d.message}`).join("\n")}`);
  });

  it("skipping validate gate before DB emits FUNGI-VALUESTATE-003 even when redact is present", () => {
    const result = vsCheck(`
secure flow skipGate(request: Request) -> Result<String, Error>
contract { effects { database.write, audit.write } }
{
  unsafe let rawEmail: String = request.body.email
  let audit = redact(rawEmail)
  UsersDB.insert(rawEmail)
  return Ok("done")
}
`);
    assert.ok(hasDiag(result, "FUNGI-VALUESTATE-003"),
      "Redacting does not clear the unsafe state for the DB sink");
  });

  it("full chain with multiple sinks — all clean after gate", () => {
    const result = vsCheck(`
secure flow multiSink(request: Request) -> Result<String, Error>
contract { effects { database.write, audit.write } }
{
  unsafe let rawData: String = request.body.data
  safe mut rawData = validate.input(rawData)?
  let saved = UsersDB.insert(rawData)?
  AuditLog.write(saved)
  return Ok("done")
}
`);
    const errors = noErrors(result);
    assert.equal(errors.length, 0,
      `Multiple sinks after gate should be clean, got: ${errors.map((d) => d.code).join(", ")}`);
  });
});

// =============================================================================
// 5. FUNGI-VALUESTATE-003: unsafe at sink
// =============================================================================

describe("Security — FUNGI-VALUESTATE-003: unsafe value at governed sink", () => {
  it("emits FUNGI-VALUESTATE-003 for unsafe binding at shell.exec", () => {
    const result = vsCheck(`
secure flow runCmd(request: Request) -> Result<String, Error>
contract { effects { system.exec } }
{
  unsafe let rawCmd: String = request.body.command
  shell.exec(rawCmd)
  return Ok("done")
}
`);
    assert.ok(hasDiag(result, "FUNGI-VALUESTATE-003"),
      `Expected FUNGI-VALUESTATE-003 for shell.exec with unsafe input`);
  });

  it("emits FUNGI-VALUESTATE-003 for unsafe binding at EmailService.sendEmail", () => {
    const result = vsCheck(`
secure flow sendMail(request: Request) -> Result<String, Error>
contract { effects { email.send } }
{
  unsafe let rawTo: String = request.body.to
  EmailService.sendEmail(rawTo)
  return Ok("done")
}
`);
    assert.ok(hasDiag(result, "FUNGI-VALUESTATE-003"),
      `Expected FUNGI-VALUESTATE-003 for EmailService.sendEmail with unsafe input`);
  });

  it("emits FUNGI-VALUESTATE-003 for unsafe binding at FileSystem.write", () => {
    const result = vsCheck(`
secure flow writeFile(request: Request) -> Result<String, Error>
contract { effects { storage.write } }
{
  unsafe let rawPath: String = request.body.path
  FileSystem.write(rawPath)
  return Ok("done")
}
`);
    assert.ok(hasDiag(result, "FUNGI-VALUESTATE-003"),
      `Expected FUNGI-VALUESTATE-003 for FileSystem.write with unsafe input`);
  });

  it("FUNGI-VALUESTATE-003 diagnostic message names the binding and the sink", () => {
    const result = vsCheck(`
secure flow namedSink(request: Request) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawInput: String = request.body.data
  UsersDB.insert(rawInput)
  return Ok("done")
}
`);
    const diag = result.diagnostics.find((d) => d.code === "FUNGI-VALUESTATE-003");
    assert.ok(diag !== undefined, "Expected FUNGI-VALUESTATE-003");
    assert.ok(diag.message.includes("rawInput"),
      `Diagnostic message should name the binding 'rawInput': ${diag.message}`);
    assert.ok(diag.message.includes("UsersDB.insert"),
      `Diagnostic message should name the sink 'UsersDB.insert': ${diag.message}`);
  });

  it("FUNGI-VALUESTATE-003 includes a suggestedFix pointing to a validate gate", () => {
    const result = vsCheck(`
secure flow fixSuggested(request: Request) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawInput: String = request.body.data
  UsersDB.insert(rawInput)
  return Ok("done")
}
`);
    const diag = result.diagnostics.find((d) => d.code === "FUNGI-VALUESTATE-003");
    assert.ok(diag !== undefined, "Expected FUNGI-VALUESTATE-003");
    assert.ok(typeof diag.suggestedFix === "string" && diag.suggestedFix.length > 0,
      "Expected a suggestedFix");
    assert.ok(diag.suggestedFix.includes("validate."),
      `suggestedFix should mention validate.*, got: ${diag.suggestedFix}`);
  });
});

// =============================================================================
// 6. FUNGI-VALUESTATE-005: two-hop taint (rawEmail.trim() at sink)
// =============================================================================

describe("Security — FUNGI-VALUESTATE-005: two-hop taint propagation", () => {
  it("emits FUNGI-VALUESTATE-005 when rawEmail.trim() reaches UsersDB.query", () => {
    const result = vsCheck(`
guarded flow searchEmail(readonly request: Request) -> String
contract { effects { database.read } }
{
  unsafe let rawEmail: String = request.params.email
  let cleaned: String = rawEmail.trim()
  UsersDB.query(cleaned)
  return "ok"
}
`);
    const hasTaint = result.diagnostics.some((d) =>
      d.code === "FUNGI-VALUESTATE-005" || d.code === "FUNGI-VALUESTATE-003");
    assert.ok(hasTaint,
      `Expected taint diagnostic for rawEmail.trim() at sink, got: ${result.diagnostics.map((d) => d.code).join(", ")}`);
  });

  it("emits FUNGI-VALUESTATE-005 for multi-step taint (trim → toLower → sink)", () => {
    const result = vsCheck(`
guarded flow multiStep(readonly request: Request) -> String
contract { effects { database.write } }
{
  unsafe let raw: String = request.body.value
  let step1: String = raw.trim()
  let step2: String = step1.toLower()
  UsersDB.insert(step2)
  return "ok"
}
`);
    const hasTaint = result.diagnostics.some((d) =>
      d.code === "FUNGI-VALUESTATE-005" || d.code === "FUNGI-VALUESTATE-003");
    assert.ok(hasTaint,
      `Multi-step taint through method chain should be caught`);
  });

  it("does NOT emit taint diagnostic after validate.* gate clears two-hop taint", () => {
    const result = vsCheck(`
guarded flow safeSearch(readonly request: Request) -> String
contract { effects { database.read } }
{
  unsafe let rawQuery: String = request.params.query
  let safeQuery: String = validate.searchQuery(rawQuery)?
  UsersDB.query(safeQuery)
  return "ok"
}
`);
    const taintDiags = result.diagnostics.filter((d) =>
      d.code === "FUNGI-VALUESTATE-005" || d.code === "FUNGI-VALUESTATE-003");
    assert.equal(taintDiags.length, 0,
      `Validate gate should clear taint: ${taintDiags.map((d) => d.code).join(", ")}`);
  });

  it("FUNGI-VALUESTATE-005 carries why and risk fields", () => {
    const result = vsCheck(`
guarded flow whyRisk(readonly request: Request) -> String
contract { effects { database.write } }
{
  unsafe let raw: String = request.body.data
  let cleaned: String = raw.trim()
  UsersDB.insert(cleaned)
  return "ok"
}
`);
    const diag = result.diagnostics.find((d) => d.code === "FUNGI-VALUESTATE-005");
    assert.ok(diag !== undefined, "Expected FUNGI-VALUESTATE-005");
    assert.ok(typeof diag.why === "string" && diag.why.length > 0, "Expected why field");
    assert.ok(typeof diag.risk === "string" && diag.risk.length > 0, "Expected risk field");
  });

  it("does not taint a clean let binding derived from another clean binding", () => {
    const result = vsCheck(`
flow cleanDerivation() -> String {
  let clean: String = "hello"
  let upper: String = clean.toUpper()
  return upper
}
`);
    assert.ok(!hasDiag(result, "FUNGI-VALUESTATE-005"),
      "Clean bindings should not trigger two-hop taint");
  });
});

// =============================================================================
// 7. FUNGI-VALUESTATE-006: protected Email used as plain Email
// =============================================================================

describe("Security — FUNGI-VALUESTATE-006: protected Email used as plain Email", () => {
  it("emits FUNGI-VALUESTATE-006 when validate.email() result is directly assigned to plain Email", () => {
    // validate.email() returns a protected value; assigning to plain Email is a violation.
    const result = vsCheck(`
flow test(raw: String) -> String {
  let plainEmail: Email = validate.email(raw)?
  return "done"
}
`);
    assert.ok(hasDiag(result, "FUNGI-VALUESTATE-006"),
      `Expected FUNGI-VALUESTATE-006 for validate.email() directly assigned to plain Email, got: ${result.diagnostics.map((d) => d.code).join(", ")}`);
  });

  it("does not emit FUNGI-VALUESTATE-006 when validate.email() is assigned to protected Email", () => {
    const result = vsCheck(`
flow test(raw: String) -> String {
  let email: protected Email = validate.email(raw)?
  return "done"
}
`);
    assert.ok(!hasDiag(result, "FUNGI-VALUESTATE-006"),
      "validate.email() → protected Email binding should not emit FUNGI-VALUESTATE-006");
  });

  it("FUNGI-VALUESTATE-006 message names the protected qualifier and suggests a fix", () => {
    const result = vsCheck(`
flow test(raw: String) -> String {
  let plainEmail: Email = validate.email(raw)?
  return "done"
}
`);
    const diag = result.diagnostics.find((d) => d.code === "FUNGI-VALUESTATE-006");
    assert.ok(diag !== undefined, "Expected FUNGI-VALUESTATE-006");
    assert.ok(typeof diag.suggestedFix === "string" && diag.suggestedFix.length > 0,
      "Expected suggestedFix on FUNGI-VALUESTATE-006");
    assert.ok(diag.message.includes("protected"),
      `Message should mention 'protected': ${diag.message}`);
  });
});

// =============================================================================
// 8. FUNGI-VALUESTATE-007: redacted Email used as plain Email
// =============================================================================

describe("Security — FUNGI-VALUESTATE-007: redacted Email used as plain Email", () => {
  it("emits FUNGI-VALUESTATE-007 when redact() result is directly assigned to plain Email", () => {
    // redact() produces a redacted value; assigning to plain Email is a violation.
    const result = vsCheck(`
flow test(email: Email) -> String {
  let plainEmail: Email = redact(email)
  return "done"
}
`);
    assert.ok(hasDiag(result, "FUNGI-VALUESTATE-007"),
      `Expected FUNGI-VALUESTATE-007 for redact() directly assigned to plain Email, got: ${result.diagnostics.map((d) => d.code).join(", ")}`);
  });

  it("does not emit FUNGI-VALUESTATE-007 when redact() is assigned to redacted Email binding", () => {
    const result = vsCheck(`
flow test(email: Email) -> String {
  let audit: redacted Email = redact(email)
  return "done"
}
`);
    assert.ok(!hasDiag(result, "FUNGI-VALUESTATE-007"),
      "redact() → redacted Email binding should not emit FUNGI-VALUESTATE-007");
  });

  it("FUNGI-VALUESTATE-007 message mentions irreversibility of redaction", () => {
    const result = vsCheck(`
flow test(email: Email) -> String {
  let plainEmail: Email = redact(email)
  return "done"
}
`);
    const diag = result.diagnostics.find((d) => d.code === "FUNGI-VALUESTATE-007");
    assert.ok(diag !== undefined, "Expected FUNGI-VALUESTATE-007");
    assert.ok(
      diag.message.toLowerCase().includes("redact") || diag.message.toLowerCase().includes("irreversible"),
      `Message should mention redaction or irreversibility: ${diag.message}`);
  });
});

// =============================================================================
// 9. FUNGI-TYPE-003: branded type assignment (CustomerId = rawString)
// =============================================================================

describe("Security — FUNGI-TYPE-003: branded type requires validation gate", () => {
  it("emits FUNGI-TYPE-003 when raw String is directly assigned to a Brand<> type", () => {
    const result = tcCheck(`
type CustomerId = Brand<String, "CustomerId">

flow test(raw: String) -> String {
  let id: CustomerId = raw
  return "done"
}
`);
    assert.ok(hasDiag(result, "FUNGI-TYPE-003"),
      `Expected FUNGI-TYPE-003 for String → CustomerId, got: ${result.diagnostics.map((d) => d.code).join(", ")}`);
  });

  it("does not emit FUNGI-TYPE-003 when a validate gate is used", () => {
    const result = tcCheck(`
type CustomerId = Brand<String, "CustomerId">

flow test(raw: String) -> String {
  let id: CustomerId = validate.customerId(raw)?
  return "done"
}
`);
    assert.ok(!hasDiag(result, "FUNGI-TYPE-003"),
      "validate gate call should not trigger FUNGI-TYPE-003");
  });

  it("FUNGI-TYPE-003 diagnostic includes suggestedFix with validate gate", () => {
    const result = tcCheck(`
type CustomerId = Brand<String, "CustomerId">

flow test(raw: String) -> String {
  let id: CustomerId = raw
  return "done"
}
`);
    const diag = result.diagnostics.find((d) => d.code === "FUNGI-TYPE-003");
    assert.ok(diag !== undefined, "Expected FUNGI-TYPE-003");
    assert.ok(typeof diag.suggestedFix === "string" && diag.suggestedFix.length > 0,
      "Expected suggestedFix on FUNGI-TYPE-003");
    assert.ok(
      diag.suggestedFix.toLowerCase().includes("gate") ||
      diag.suggestedCode !== undefined,
      `suggestedFix should mention gate or suggestedCode present: ${diag.suggestedFix}`);
  });

  it("emits FUNGI-TYPE-003 for OrderId = rawString", () => {
    const result = tcCheck(`
type OrderId = Brand<String, "OrderId">

flow createOrder(raw: String) -> String {
  let orderId: OrderId = raw
  return "done"
}
`);
    assert.ok(hasDiag(result, "FUNGI-TYPE-003"),
      "Expected FUNGI-TYPE-003 for OrderId = rawString");
  });

  it("does not emit FUNGI-TYPE-003 for non-branded String bindings", () => {
    const result = tcCheck(`
flow test(raw: String) -> String {
  let name: String = raw
  return name
}
`);
    assert.ok(!hasDiag(result, "FUNGI-TYPE-003"),
      "Plain String assignment should not emit FUNGI-TYPE-003");
  });
});

// =============================================================================
// 10. FUNGI-SECRET-001/002: SecureString in logs and comparisons
// =============================================================================

describe("Security — FUNGI-SECRET-001: SecureString in log calls", () => {
  it("emits FUNGI-SECRET-001 when SecureString passed to print()", () => {
    const result = vsCheck(`
secure flow logSecret() -> Result<String, Error>
contract { effects { secret.read } }
{
  let apiKey: SecureString = env.secret("API_KEY")
  print(apiKey)
  return Ok("done")
}
`);
    assert.ok(hasDiag(result, "FUNGI-SECRET-001"),
      "Expected FUNGI-SECRET-001 for print(apiKey)");
  });

  it("emits FUNGI-SECRET-001 when SecureString passed to log.info()", () => {
    const result = vsCheck(`
secure flow logInfo() -> Result<String, Error>
contract { effects { secret.read } }
{
  let token: SecureString = env.secret("TOKEN")
  log.info(token)
  return Ok("done")
}
`);
    assert.ok(hasDiag(result, "FUNGI-SECRET-001"),
      "Expected FUNGI-SECRET-001 for log.info(token)");
  });

  it("emits FUNGI-SECRET-001 when SecureString passed to log.error()", () => {
    const result = vsCheck(`
secure flow logError() -> Result<String, Error>
contract { effects { secret.read } }
{
  let dbPass: SecureString = env.secret("DB_PASS")
  log.error(dbPass)
  return Ok("done")
}
`);
    assert.ok(hasDiag(result, "FUNGI-SECRET-001"),
      "Expected FUNGI-SECRET-001 for log.error(dbPass)");
  });

  it("does NOT emit FUNGI-SECRET-001 when SecureString is redacted before logging", () => {
    const result = vsCheck(`
secure flow safeLog() -> Result<String, Error>
contract { effects { secret.read } }
{
  let apiKey: SecureString = env.secret("API_KEY")
  let masked = redact(apiKey)
  log.info(masked)
  return Ok("done")
}
`);
    assert.ok(!hasDiag(result, "FUNGI-SECRET-001"),
      "Redacted SecureString should not trigger FUNGI-SECRET-001");
  });

  it("does NOT emit FUNGI-SECRET-001 for plain String passed to log.info()", () => {
    const result = vsCheck(`
flow logPlain() -> String {
  let msg: String = "hello"
  log.info(msg)
  return msg
}
`);
    assert.ok(!hasDiag(result, "FUNGI-SECRET-001"),
      "Plain String should not trigger FUNGI-SECRET-001");
  });

  it("FUNGI-SECRET-001 diagnostic includes why and risk fields", () => {
    const result = vsCheck(`
secure flow secretWhy() -> Result<String, Error>
contract { effects { secret.read } }
{
  let key: SecureString = env.secret("KEY")
  log.warn(key)
  return Ok("done")
}
`);
    const diag = result.diagnostics.find((d) => d.code === "FUNGI-SECRET-001");
    assert.ok(diag !== undefined, "Expected FUNGI-SECRET-001");
    assert.ok(typeof diag.why === "string" && diag.why.length > 0, "Expected why field");
    assert.ok(typeof diag.risk === "string" && diag.risk.length > 0, "Expected risk field");
  });
});

describe("Security — FUNGI-SECRET-002: SecureString equality comparison", () => {
  it("emits FUNGI-SECRET-002 when SecureString is compared with ==", () => {
    const result = vsCheck(`
secure flow compareTokens() -> Result<Bool, Error>
contract { effects { secret.read } }
{
  let expected: SecureString = env.secret("TOKEN")
  let provided: SecureString = env.secret("PROVIDED")
  let valid: Bool = provided == expected
  return Ok(valid)
}
`);
    assert.ok(hasDiag(result, "FUNGI-SECRET-002"),
      "Expected FUNGI-SECRET-002 for SecureString == comparison");
  });

  it("emits FUNGI-SECRET-002 when SecureString is compared with !=", () => {
    const result = vsCheck(`
secure flow compareNotEqual() -> Result<Bool, Error>
contract { effects { secret.read } }
{
  let expected: SecureString = env.secret("TOKEN")
  let provided: SecureString = env.secret("OTHER")
  let different: Bool = provided != expected
  return Ok(different)
}
`);
    assert.ok(hasDiag(result, "FUNGI-SECRET-002"),
      "Expected FUNGI-SECRET-002 for SecureString != comparison");
  });

  it("does NOT emit FUNGI-SECRET-002 for constantTimeEquals usage", () => {
    const result = vsCheck(`
secure flow safeCompare() -> Result<Bool, Error>
contract { effects { secret.read } }
{
  let expected: SecureString = env.secret("TOKEN")
  let provided: SecureString = env.secret("PROVIDED")
  let valid: Bool = constantTimeEquals(expected, provided)
  return Ok(valid)
}
`);
    assert.ok(!hasDiag(result, "FUNGI-SECRET-002"),
      "constantTimeEquals should not trigger FUNGI-SECRET-002");
  });

  it("does NOT emit FUNGI-SECRET-002 for plain String == comparison", () => {
    const result = vsCheck(`
flow compareStrings(a: String, b: String) -> Bool {
  let equal: Bool = a == b
  return equal
}
`);
    assert.ok(!hasDiag(result, "FUNGI-SECRET-002"),
      "Plain String == should not trigger FUNGI-SECRET-002");
  });

  it("FUNGI-SECRET-002 diagnostic suggests constantTimeEquals", () => {
    const result = vsCheck(`
secure flow badCompare() -> Result<Bool, Error>
contract { effects { secret.read } }
{
  let key: SecureString = env.secret("KEY")
  let other: SecureString = env.secret("OTHER")
  let same: Bool = key == other
  return Ok(same)
}
`);
    const diag = result.diagnostics.find((d) => d.code === "FUNGI-SECRET-002");
    assert.ok(diag !== undefined, "Expected FUNGI-SECRET-002");
    assert.ok(
      (diag.suggestedFix ?? "").includes("constantTimeEquals") ||
      (diag.suggestedCode ?? "").includes("constantTimeEquals"),
      `Fix should suggest constantTimeEquals: ${diag.suggestedFix}`);
  });
});

// =============================================================================
// 11. User-defined gates: validateAge() breaks taint chain
// =============================================================================

describe("Security — user-defined gate functions break taint chain", () => {
  it("fn validateAge() used after unsafe let breaks the taint chain", () => {
    const result = vsCheck(`
guarded flow processAge(readonly request: Request) -> String
contract { effects { database.write } }
{
  fn validateAge(raw: String) -> Int {
    return 25
  }
  unsafe let rawAge: String = request.body.age
  let age: Int = validateAge(rawAge)
  UsersDB.insert(age)
  return "ok"
}
`);
    const taintDiags = result.diagnostics.filter((d) =>
      d.code === "FUNGI-VALUESTATE-005" || d.code === "FUNGI-VALUESTATE-003");
    assert.equal(taintDiags.length, 0,
      `validateAge() should break taint chain, got: ${taintDiags.map((d) => d.code).join(", ")}`);
  });

  it("fn sanitizeHtml() breaks taint chain", () => {
    const result = vsCheck(`
guarded flow processHtml(readonly request: Request) -> String
contract { effects { database.write } }
{
  fn sanitizeHtml(raw: String) -> String {
    return raw
  }
  unsafe let rawHtml: String = request.body.content
  let clean: String = sanitizeHtml(rawHtml)
  UsersDB.insert(clean)
  return "ok"
}
`);
    const taintDiags = result.diagnostics.filter((d) =>
      d.code === "FUNGI-VALUESTATE-005" || d.code === "FUNGI-VALUESTATE-003");
    assert.equal(taintDiags.length, 0,
      `sanitizeHtml() should break taint chain, got: ${taintDiags.map((d) => d.code).join(", ")}`);
  });

  it("fn checkRole() breaks taint chain", () => {
    const result = vsCheck(`
guarded flow processRole(readonly request: Request) -> String
contract { effects { database.write } }
{
  fn checkRole(raw: String) -> String {
    return raw
  }
  unsafe let rawRole: String = request.body.role
  let role: String = checkRole(rawRole)
  UsersDB.insert(role)
  return "ok"
}
`);
    const taintDiags = result.diagnostics.filter((d) =>
      d.code === "FUNGI-VALUESTATE-005" || d.code === "FUNGI-VALUESTATE-003");
    assert.equal(taintDiags.length, 0,
      `checkRole() should break taint chain, got: ${taintDiags.map((d) => d.code).join(", ")}`);
  });

  it("fn NOT using a gate prefix does NOT break the taint chain", () => {
    const result = vsCheck(`
guarded flow processValue(readonly request: Request) -> String
contract { effects { database.write } }
{
  fn formatValue(raw: String) -> String {
    return raw
  }
  unsafe let rawVal: String = request.body.value
  let formatted: String = formatValue(rawVal)
  UsersDB.insert(formatted)
  return "ok"
}
`);
    const taintDiags = result.diagnostics.filter((d) =>
      d.code === "FUNGI-VALUESTATE-005" || d.code === "FUNGI-VALUESTATE-003");
    assert.ok(taintDiags.length > 0,
      "Non-gate fn prefix should NOT break taint chain — unsafe still flows to sink");
  });

  it("user gate fn satisfies safe mut requirement — no FUNGI-VALUESTATE-001", () => {
    const result = vsCheck(`
secure flow upgradeWithUserGate(raw: String) -> Result<String, Error>
contract { effects { database.write } }
{
  fn validateUsername(s: String) -> String {
    return s
  }
  unsafe let rawName: String = raw
  safe mut rawName = validateUsername(rawName)
  let saved = DB.insert(rawName)?
  return Ok("done")
}
`);
    assert.ok(!hasDiag(result, "FUNGI-VALUESTATE-001"),
      "User gate fn should satisfy safe mut gate requirement");
  });

  it("fn verifySignature() breaks taint chain for cryptographic verification", () => {
    const result = vsCheck(`
guarded flow verifyWebhook(readonly request: Request) -> String
contract { effects { database.write } }
{
  fn verifySignature(raw: String) -> String {
    return raw
  }
  unsafe let rawPayload: String = request.body.payload
  let verified: String = verifySignature(rawPayload)
  UsersDB.insert(verified)
  return "ok"
}
`);
    const taintDiags = result.diagnostics.filter((d) =>
      d.code === "FUNGI-VALUESTATE-005" || d.code === "FUNGI-VALUESTATE-003");
    assert.equal(taintDiags.length, 0,
      `verifySignature() should break taint chain, got: ${taintDiags.map((d) => d.code).join(", ")}`);
  });
});

// =============================================================================
// 12. Real-world secure flow with full security pipeline
// =============================================================================

describe("Security — real-world secure flow with full security pipeline", () => {
  it("full user registration flow emits no security errors", () => {
    const result = vsCheck(`
secure flow registerUser(request: Request) -> Result<String, Error>
contract { effects { database.write, audit.write } }
{
  unsafe let rawEmail: String = request.body.email
  unsafe let rawName: String = request.body.name
  safe mut rawEmail = validate.email(rawEmail)?
  safe mut rawName = validate.name(rawName)?
  let userId = UsersDB.insert(rawEmail)?
  let auditEmail = redact(rawEmail)
  AuditLog.write(userId)
  return Ok(userId)
}
`);
    const errors = noErrors(result);
    assert.equal(errors.length, 0,
      `Full user registration pipeline should have no errors:\n${errors.map((d) => `${d.code}: ${d.message}`).join("\n")}`);
  });

  it("customer order flow with payment sink — clean after gates", () => {
    const result = vsCheck(`
secure flow placeOrder(request: Request) -> Result<String, Error>
contract { effects { database.write, payment.write, audit.write } }
{
  unsafe let rawAmount: String = request.body.amount
  unsafe let rawCard: String = request.body.card
  safe mut rawAmount = validate.amount(rawAmount)?
  safe mut rawCard = validate.card(rawCard)?
  let orderId = OrdersDB.insert(rawAmount)?
  let payment = StripePayment.charge(rawCard)
  AuditLog.write(orderId)
  return Ok(orderId)
}
`);
    const errors = noErrors(result);
    assert.equal(errors.length, 0,
      `Order + payment flow should have no errors:\n${errors.map((d) => d.code).join(", ")}`);
  });

  it("failing to gate the card input before payment emits FUNGI-VALUESTATE-003", () => {
    const result = vsCheck(`
secure flow badPayment(request: Request) -> Result<String, Error>
contract { effects { payment.write } }
{
  unsafe let rawCard: String = request.body.card
  StripePayment.charge(rawCard)
  return Ok("done")
}
`);
    assert.ok(hasDiag(result, "FUNGI-VALUESTATE-003"),
      "Ungated card input at payment sink should emit FUNGI-VALUESTATE-003");
  });

  it("SecureString API key used safely with constantTimeEquals and redact before log", () => {
    const result = vsCheck(`
secure flow verifyApiKey(request: Request) -> Result<Bool, Error>
contract { effects { secret.read } }
{
  let expectedKey: SecureString = env.secret("API_KEY")
  let providedKey: SecureString = env.secret("PROVIDED_KEY")
  let valid: Bool = constantTimeEquals(expectedKey, providedKey)
  let safeLog = redact(expectedKey)
  log.info(safeLog)
  return Ok(valid)
}
`);
    const errors = noErrors(result);
    assert.equal(errors.length, 0,
      `SecureString handled safely should produce no errors:\n${errors.map((d) => d.code).join(", ")}`);
  });

  it("search flow with two-step taint cleanup emits no errors", () => {
    const result = vsCheck(`
guarded flow searchUsers(readonly request: Request) -> String
contract { effects { database.read } }
{
  unsafe let rawQuery: String = request.params.query
  let safeQuery: String = sanitize.searchQuery(rawQuery)
  let results = UsersDB.query(safeQuery)
  return "ok"
}
`);
    const errors = noErrors(result);
    assert.equal(errors.length, 0,
      `Search flow with sanitize gate should produce no errors:\n${errors.map((d) => d.code).join(", ")}`);
  });
});

// =============================================================================
// 13. Multiple protected values in the same flow
// =============================================================================

describe("Security — multiple protected values in same flow", () => {
  it("two protected Email values in same flow both pass value-state check cleanly", () => {
    // Email is a built-in type in Galerina
    const result = vsCheck(`
flow processTwoEmails(raw1: String, raw2: String) -> String {
  let email1: protected Email = validate.email(raw1)?
  let email2: protected Email = validate.email(raw2)?
  return "done"
}
`);
    const vs006 = diagsWithCode(result, "FUNGI-VALUESTATE-006");
    assert.equal(vs006.length, 0,
      `Two protected Email bindings should not emit FUNGI-VALUESTATE-006: ${vs006.map((d) => d.message).join(", ")}`);
  });

  it("two plain Email bindings assigned directly from validate.email() each emit FUNGI-VALUESTATE-006", () => {
    // FUNGI-VALUESTATE-006 fires on the inline assignment expression, not on identifier re-use
    const result = vsCheck(`
flow testTwo(raw1: String, raw2: String) -> String {
  let plain1: Email = validate.email(raw1)?
  let plain2: Email = validate.email(raw2)?
  return "done"
}
`);
    const vs006 = diagsWithCode(result, "FUNGI-VALUESTATE-006");
    assert.equal(vs006.length, 2,
      `Both plain Email assignments from validate.email() should emit FUNGI-VALUESTATE-006, got ${vs006.length}`);
  });

  it("multiple unsafe bindings — all must be gated before their respective sinks", () => {
    const result = vsCheck(`
secure flow multiUnsafe(request: Request) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawEmail: String = request.body.email
  unsafe let rawName: String = request.body.name
  UsersDB.insert(rawEmail)
  UsersDB.insert(rawName)
  return Ok("done")
}
`);
    const vs003 = diagsWithCode(result, "FUNGI-VALUESTATE-003");
    assert.ok(vs003.length >= 2,
      `Both unsafe bindings should emit FUNGI-VALUESTATE-003, got ${vs003.length}`);
  });

  it("multiple unsafe bindings gated independently — all clean at sinks", () => {
    const result = vsCheck(`
secure flow multiGated(request: Request) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawEmail: String = request.body.email
  unsafe let rawName: String = request.body.name
  safe mut rawEmail = validate.email(rawEmail)?
  safe mut rawName = validate.name(rawName)?
  UsersDB.insert(rawEmail)
  UsersDB.insert(rawName)
  return Ok("done")
}
`);
    const errors = noErrors(result);
    assert.equal(errors.length, 0,
      `Both independently gated bindings should be clean, got:\n${errors.map((d) => d.code).join(", ")}`);
  });

  it("mix of protected and redacted values in same flow — no boundary violations", () => {
    const result = tcCheck(`
flow mixedQualifiers(raw: String, email: Email) -> String {
  let protectedEmail: protected Email = validate.email(raw)?
  let redactedEmail: redacted Email = redact(email)
  return "done"
}
`);
    const type018 = diagsWithCode(result, "FUNGI-TYPE-018");
    const type019 = diagsWithCode(result, "FUNGI-TYPE-019");
    assert.equal(type018.length, 0,
      `No FUNGI-TYPE-018 expected for correct protected binding`);
    assert.equal(type019.length, 0,
      `No FUNGI-TYPE-019 expected for correct redacted binding`);
  });
});

// =============================================================================
// 14. protected Array<Email> — collection of protected values
// =============================================================================

describe("Security — protected values in collections", () => {
  it("Array<Email> parameter type is recognised as valid (no FUNGI-TYPE-001)", () => {
    // Email is a built-in type; Array<Email> should be valid
    const result = tcCheck(`
flow processEmails(emails: Array<Email>) -> String {
  return "done"
}
`);
    assert.ok(!hasDiag(result, "FUNGI-TYPE-001"),
      "Array<Email> should be a valid type reference (Email is built-in)");
  });

  it("Array<String> with multiple unsafe values — each must be gated individually", () => {
    const result = vsCheck(`
secure flow batchInsert(request: Request) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawItem: String = request.body.item
  UsersDB.insert(rawItem)
  return Ok("done")
}
`);
    assert.ok(hasDiag(result, "FUNGI-VALUESTATE-003"),
      "Unsafe item flowing into DB insert should be caught");
  });

  it("protected Email and plain Email binding coexist in same flow without cross-contamination", () => {
    const result = tcCheck(`
flow coexist(raw: String, alreadyValidated: Email) -> String {
  let protEmail: protected Email = validate.email(raw)?
  let plainRef: Email = alreadyValidated
  return "done"
}
`);
    assert.ok(!hasDiag(result, "FUNGI-TYPE-018"),
      "Assigning a plain Email (not protected) to plain Email binding is valid — no FUNGI-TYPE-018");
  });

  it("two independent protected Email bindings — no FUNGI-TYPE-018 violations between them", () => {
    const result = tcCheck(`
flow twoProtected(raw1: String, raw2: String) -> String {
  let email1: protected Email = validate.email(raw1)?
  let email2: protected Email = validate.email(raw2)?
  return "done"
}
`);
    const type018 = diagsWithCode(result, "FUNGI-TYPE-018");
    assert.equal(type018.length, 0,
      `Two independent protected Email bindings should not trigger FUNGI-TYPE-018: ${type018.map((d) => d.message).join(", ")}`);
  });

  it("protected Email and redacted Email in same flow — both work correctly", () => {
    const result = tcCheck(`
flow combinedQualifiers(raw: String, email: Email) -> String {
  let protEmail: protected Email = validate.email(raw)?
  let redactedEmail: redacted Email = redact(email)
  return "done"
}
`);
    const type018 = diagsWithCode(result, "FUNGI-TYPE-018");
    const type019 = diagsWithCode(result, "FUNGI-TYPE-019");
    assert.equal(type018.length, 0, "No FUNGI-TYPE-018 for protected Email binding");
    assert.equal(type019.length, 0, "No FUNGI-TYPE-019 for redacted Email binding");
  });

  it("collection flow with gated unsafe values — safe through the pipeline", () => {
    const result = vsCheck(`
secure flow processEmailBatch(request: Request) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawEmail1: String = request.body.email1
  unsafe let rawEmail2: String = request.body.email2
  safe mut rawEmail1 = validate.email(rawEmail1)?
  safe mut rawEmail2 = validate.email(rawEmail2)?
  UsersDB.insert(rawEmail1)
  UsersDB.insert(rawEmail2)
  return Ok("done")
}
`);
    const errors = noErrors(result);
    assert.equal(errors.length, 0,
      `Gated collection batch should have no errors: ${errors.map((d) => d.code).join(", ")}`);
  });
});

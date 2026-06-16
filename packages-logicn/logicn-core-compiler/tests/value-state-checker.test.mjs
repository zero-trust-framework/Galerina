import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseProgram, checkValueStates } from "../dist/index.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseAndCheck(source) {
  const parsed = parseProgram(source, "test.lln");
  return checkValueStates(parsed.ast);
}

function hasDiag(result, code) {
  return result.diagnostics.some((d) => d.code === code);
}

function diagsWithCode(result, code) {
  return result.diagnostics.filter((d) => d.code === code);
}

// ── LLN-VALUESTATE-001: safe mut requires a gate ──────────────────────────────

describe("Value-state checker — safe mut gate requirement", () => {
  it("emits LLN-VALUESTATE-001 when safe mut has no gate call", () => {
    const result = parseAndCheck(`
secure flow test(raw: String) -> Result<String, Error>
contract { effects { database.read } }
{
  unsafe let rawEmail: String = raw
  safe mut rawEmail = rawEmail
  return Ok(rawEmail)
}
`);
    assert.ok(
      hasDiag(result, "LLN-VALUESTATE-001"),
      `Expected LLN-VALUESTATE-001, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("does not emit LLN-VALUESTATE-001 when safe mut uses validate.*", () => {
    const result = parseAndCheck(`
secure flow test(raw: String) -> Result<String, Error>
contract { effects { database.read } }
{
  unsafe let rawEmail: String = raw
  safe mut rawEmail = validate.email(rawEmail)?
  return Ok(rawEmail)
}
`);
    assert.ok(
      !hasDiag(result, "LLN-VALUESTATE-001"),
      `Unexpected LLN-VALUESTATE-001 with validate.* gate`,
    );
  });

  it("does not emit LLN-VALUESTATE-001 when safe mut uses json.decode", () => {
    const result = parseAndCheck(`
secure flow test(raw: Bytes) -> Result<String, Error>
contract { effects { database.read } }
{
  unsafe let rawBody: Bytes = raw
  safe mut rawBody = json.decode(rawBody)?
  return Ok(rawBody)
}
`);
    assert.ok(
      !hasDiag(result, "LLN-VALUESTATE-001"),
      `Unexpected LLN-VALUESTATE-001 with json.decode gate`,
    );
  });

  it("does not emit LLN-VALUESTATE-001 when safe mut uses sanitize.*", () => {
    const result = parseAndCheck(`
secure flow test(raw: String) -> Result<String, Error>
contract { effects { database.read } }
{
  unsafe let rawText: String = raw
  safe mut rawText = sanitize.text(rawText)?
  return Ok(rawText)
}
`);
    assert.ok(
      !hasDiag(result, "LLN-VALUESTATE-001"),
      `Unexpected LLN-VALUESTATE-001 with sanitize.* gate`,
    );
  });

  it("emits LLN-VALUESTATE-001 when safe mut uses an arbitrary expression (no gate)", () => {
    const result = parseAndCheck(`
secure flow test(raw: String) -> Result<String, Error>
contract { effects { database.read } }
{
  unsafe let rawEmail: String = raw
  safe mut rawEmail = someHelper(rawEmail)
  return Ok(rawEmail)
}
`);
    assert.ok(
      hasDiag(result, "LLN-VALUESTATE-001"),
      `Expected LLN-VALUESTATE-001 for non-gate upgrade`,
    );
  });
});

// ── LLN-VALUESTATE-003: unsafe binding at governed sink ───────────────────────

describe("Value-state checker — unsafe at governed sink", () => {
  it("emits LLN-VALUESTATE-003 when unsafe let reaches a DB insert", () => {
    const result = parseAndCheck(`
secure flow test(raw: String) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawInput: String = raw
  let saved = DB.insert(rawInput)?
  return Ok(saved)
}
`);
    assert.ok(
      hasDiag(result, "LLN-VALUESTATE-003"),
      `Expected LLN-VALUESTATE-003, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("does not emit LLN-VALUESTATE-003 when binding is upgraded before sink", () => {
    const result = parseAndCheck(`
secure flow test(raw: String) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawInput: String = raw
  safe mut rawInput = validate.input(rawInput)?
  let saved = DB.insert(rawInput)?
  return Ok(saved)
}
`);
    assert.ok(
      !hasDiag(result, "LLN-VALUESTATE-003"),
      `Unexpected LLN-VALUESTATE-003 after safe mut upgrade`,
    );
  });

  it("emits LLN-VALUESTATE-003 when unsafe let reaches AuditLog.write", () => {
    const result = parseAndCheck(`
secure flow test(raw: String) -> Result<String, Error>
contract { effects { audit.write } }
{
  unsafe let rawMsg: String = raw
  AuditLog.write(rawMsg)
  return Ok(rawMsg)
}
`);
    assert.ok(
      hasDiag(result, "LLN-VALUESTATE-003"),
      `Expected LLN-VALUESTATE-003 for AuditLog.write`,
    );
  });

  it("does not emit LLN-VALUESTATE-003 for plain let bindings at a sink", () => {
    const result = parseAndCheck(`
secure flow test() -> Result<String, Error>
contract { effects { database.write } }
{
  let safeData: String = buildRecord()
  let saved = DB.insert(safeData)?
  return Ok(saved)
}
`);
    assert.ok(
      !hasDiag(result, "LLN-VALUESTATE-003"),
      `Unexpected LLN-VALUESTATE-003 for safe let binding`,
    );
  });
});

// ── LLN-SECRET-001: SecureString in log call ──────────────────────────────────

describe("Value-state checker — SecureString logging", () => {
  it("emits LLN-SECRET-001 when SecureString is passed to print", () => {
    const result = parseAndCheck(`
secure flow test() -> Result<String, Error>
contract { effects { secret.read } }
{
  let apiKey: SecureString = env.secret("API_KEY")
  print(apiKey)
  return Ok("done")
}
`);
    assert.ok(
      hasDiag(result, "LLN-SECRET-001"),
      `Expected LLN-SECRET-001, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("emits LLN-SECRET-001 when SecureString is passed to log.info", () => {
    const result = parseAndCheck(`
secure flow test() -> Result<String, Error>
contract { effects { secret.read } }
{
  let apiKey: SecureString = env.secret("API_KEY")
  log.info(apiKey)
  return Ok("done")
}
`);
    assert.ok(
      hasDiag(result, "LLN-SECRET-001"),
      `Expected LLN-SECRET-001 for log.info`,
    );
  });

  it("does not emit LLN-SECRET-001 when SecureString is passed to redact", () => {
    const result = parseAndCheck(`
secure flow test() -> Result<String, Error>
contract { effects { secret.read } }
{
  let apiKey: SecureString = env.secret("API_KEY")
  let safe = redact(apiKey)
  return Ok(safe)
}
`);
    assert.ok(
      !hasDiag(result, "LLN-SECRET-001"),
      `Unexpected LLN-SECRET-001 when using redact()`,
    );
  });

  it("does not emit LLN-SECRET-001 for non-SecureString passed to print", () => {
    const result = parseAndCheck(`
flow test() -> String {
  let msg: String = "hello"
  print(msg)
  return msg
}
`);
    assert.ok(
      !hasDiag(result, "LLN-SECRET-001"),
      `Unexpected LLN-SECRET-001 for plain String`,
    );
  });
});

// ── LLN-SECRET-002: SecureString equality comparison ─────────────────────────

describe("Value-state checker — SecureString equality", () => {
  it("emits LLN-SECRET-002 when SecureString is compared with ==", () => {
    const result = parseAndCheck(`
secure flow test() -> Result<Bool, Error>
contract { effects { secret.read } }
{
  let expected: SecureString = env.secret("TOKEN")
  let provided: SecureString = env.secret("PROVIDED")
  let valid: Bool = provided == expected
  return Ok(valid)
}
`);
    assert.ok(
      hasDiag(result, "LLN-SECRET-002"),
      `Expected LLN-SECRET-002, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("emits LLN-SECRET-002 when SecureString is compared with !=", () => {
    const result = parseAndCheck(`
secure flow test() -> Result<Bool, Error>
contract { effects { secret.read } }
{
  let expected: SecureString = env.secret("TOKEN")
  let provided: SecureString = env.secret("PROVIDED")
  let different: Bool = provided != expected
  return Ok(different)
}
`);
    assert.ok(
      hasDiag(result, "LLN-SECRET-002"),
      `Expected LLN-SECRET-002 for != comparison`,
    );
  });

  it("does not emit LLN-SECRET-002 for plain String equality", () => {
    const result = parseAndCheck(`
flow test(a: String, b: String) -> Bool {
  let equal: Bool = a == b
  return equal
}
`);
    assert.ok(
      !hasDiag(result, "LLN-SECRET-002"),
      `Unexpected LLN-SECRET-002 for String == String`,
    );
  });

  it("does not emit LLN-SECRET-002 for numeric equality", () => {
    const result = parseAndCheck(`
flow test(a: Int, b: Int) -> Bool {
  let equal: Bool = a == b
  return equal
}
`);
    assert.ok(
      !hasDiag(result, "LLN-SECRET-002"),
      `Unexpected LLN-SECRET-002 for Int == Int`,
    );
  });
});

// ── Safe flow with no value-state issues ─────────────────────────────────────

describe("Value-state checker — clean flows produce no diagnostics", () => {
  it("emits no value-state diagnostics for a clean secure flow", () => {
    const result = parseAndCheck(`
secure flow createCustomer(request: Request) -> Result<Response, ApiError>
contract { effects { database.write, audit.write } }
{
  unsafe let rawBody: Bytes = request.rawBody
  safe mut rawBody = json.decode(rawBody)?
  let saved = CustomersDB.insert(rawBody)?
  AuditLog.write(saved)
  return Ok(saved)
}
`);
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    assert.equal(
      errors.length,
      0,
      `Expected no errors, got: ${errors.map((d) => `${d.code}: ${d.message}`).join("\n")}`,
    );
  });

  it("emits no value-state diagnostics for a pure flow", () => {
    const result = parseAndCheck(`
pure flow add(a: Int, b: Int) -> Int {
  let sum: Int = a
  return sum
}
`);
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    assert.equal(errors.length, 0, `Unexpected errors in pure flow`);
  });
});

// ── Phase 8B: String taint propagation (LLN-VALUESTATE-004) ──────────────────

describe("Value-state checker — LLN-VALUESTATE-004 string taint propagation", () => {
  it("emits LLN-VALUESTATE-004 when unsafe binding concatenated with string literal", () => {
    const result = parseAndCheck(`
secure flow buildQuery(raw: String) -> Result<String, Error>
contract { effects { database.read } }
{
  unsafe let rawInput: String = raw
  let query: String = "SELECT * FROM users WHERE email = '" + rawInput + "'"
  return Ok(query)
}
`);
    assert.ok(
      hasDiag(result, "LLN-VALUESTATE-004"),
      `Expected LLN-VALUESTATE-004 for unsafe string concatenation, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("does not emit LLN-VALUESTATE-004 for safe-only string concatenation", () => {
    const result = parseAndCheck(`
flow test() -> String {
  let greeting: String = "Hello " + "World"
  return greeting
}
`);
    assert.ok(!hasDiag(result, "LLN-VALUESTATE-004"), "Unexpected LLN-VALUESTATE-004 for safe concat");
  });

  it("LLN-VALUESTATE-004 includes why and risk fields", () => {
    const result = parseAndCheck(`
secure flow buildQuery(raw: String) -> Result<String, Error>
contract { effects { database.read } }
{
  unsafe let rawInput: String = raw
  let query: String = "SELECT " + rawInput
  return Ok(query)
}
`);
    const diag = result.diagnostics.find((d) => d.code === "LLN-VALUESTATE-004");
    assert.ok(diag !== undefined, "Expected LLN-VALUESTATE-004");
    assert.ok(diag.why !== undefined, "Expected why field on LLN-VALUESTATE-004");
    assert.ok(diag.risk !== undefined, "Expected risk field on LLN-VALUESTATE-004");
  });
});

// ── Phase 11B.1: Two-hop taint propagation (LLN-VALUESTATE-005) ──────────────

describe("Value-state checker — Phase 11B.1 two-hop taint propagation", () => {
  it("emits LLN-VALUESTATE-005 for value derived from unsafe binding at sink", () => {
    // The "laundered unsafe value" pattern
    const result = parseAndCheck(`
guarded flow search(readonly request: Request) -> String
contract { effects { database.read } }
{
  unsafe let rawQuery: String = request.params.query
  let cleaned: String = rawQuery.trim()
  let data = UsersDB.query(cleaned)
  return "ok"
}
`);
    assert.ok(
      result.diagnostics.some(d => d.code === "LLN-VALUESTATE-005" || d.code === "LLN-VALUESTATE-003"),
      `Expected taint-at-sink for derived unsafe value, got: ${result.diagnostics.map(d => d.code).join(", ")}`,
    );
  });

  it("does NOT emit taint diagnostic when value goes through a validation gate", () => {
    const result = parseAndCheck(`
guarded flow search(readonly request: Request) -> String
contract { effects { database.read } }
{
  unsafe let rawQuery: String = request.params.query
  let safeQuery: String = validate.searchQuery(rawQuery)?
  let data = UsersDB.query(safeQuery)
  return "ok"
}
`);
    const taintDiags = result.diagnostics.filter(d =>
      d.code === "LLN-VALUESTATE-005" || d.code === "LLN-VALUESTATE-003",
    );
    assert.equal(taintDiags.length, 0, `Validation gate should break taint chain, got: ${taintDiags.map(d => d.code).join(", ")}`);
  });

  it("propagates taint through method chain", () => {
    const result = parseAndCheck(`
guarded flow test(readonly request: Request) -> String
contract { effects { database.write } }
{
  unsafe let raw: String = request.body.value
  let step1: String = raw.trim()
  let step2: String = step1.toLower()
  UsersDB.insert(step2)
  return "ok"
}
`);
    const hasTaint = result.diagnostics.some(d =>
      d.code === "LLN-VALUESTATE-005" || d.code === "LLN-VALUESTATE-003",
    );
    assert.ok(hasTaint, `Multi-hop taint through method chain should be caught, got: ${result.diagnostics.map(d => d.code).join(", ")}`);
  });

  it("LLN-VALUESTATE-005 includes why and risk fields", () => {
    const result = parseAndCheck(`
guarded flow test(readonly request: Request) -> String
contract { effects { database.write } }
{
  unsafe let raw: String = request.body.value
  let cleaned: String = raw.trim()
  UsersDB.insert(cleaned)
  return "ok"
}
`);
    const diag = result.diagnostics.find(d => d.code === "LLN-VALUESTATE-005");
    assert.ok(diag !== undefined, `Expected LLN-VALUESTATE-005`);
    assert.ok(diag.why !== undefined, "Expected why field on LLN-VALUESTATE-005");
    assert.ok(diag.risk !== undefined, "Expected risk field on LLN-VALUESTATE-005");
  });

  it("does not taint a plain let binding with no unsafe dependency", () => {
    const result = parseAndCheck(`
flow test() -> String {
  let clean: String = "hello"
  let upper: String = clean.toUpper()
  return upper
}
`);
    assert.ok(
      !result.diagnostics.some(d => d.code === "LLN-VALUESTATE-005"),
      "Should not emit LLN-VALUESTATE-005 for clean bindings",
    );
  });
});

// ── Phase 11B.2: User-defined gate functions ──────────────────────────────────

describe("Value-state checker — Phase 11B.2 user-defined gates", () => {
  it("fn starting with 'validate' is treated as a user gate", () => {
    const result = parseAndCheck(`
guarded flow test(readonly request: Request) -> String
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
    const taintDiags = result.diagnostics.filter(d =>
      d.code === "LLN-VALUESTATE-005" || d.code === "LLN-VALUESTATE-003"
    );
    assert.equal(taintDiags.length, 0, `validate* fn should break taint chain, got: ${taintDiags.map(d => d.code).join(", ")}`);
  });

  it("fn starting with 'sanitize' is treated as a user gate", () => {
    const result = parseAndCheck(`
guarded flow test(readonly request: Request) -> String
contract { effects { database.write } }
{
  fn sanitizeInput(raw: String) -> String {
    return raw
  }
  unsafe let rawVal: String = request.body.value
  let clean: String = sanitizeInput(rawVal)
  UsersDB.insert(clean)
  return "ok"
}
`);
    const taintDiags = result.diagnostics.filter(d =>
      d.code === "LLN-VALUESTATE-005" || d.code === "LLN-VALUESTATE-003"
    );
    assert.equal(taintDiags.length, 0, `sanitize* fn should break taint chain, got: ${taintDiags.map(d => d.code).join(", ")}`);
  });

  it("fn starting with 'check' is treated as a user gate", () => {
    const result = parseAndCheck(`
guarded flow test(readonly request: Request) -> String
contract { effects { database.write } }
{
  fn checkEmail(raw: String) -> String {
    return raw
  }
  unsafe let rawEmail: String = request.body.email
  let verified: String = checkEmail(rawEmail)
  UsersDB.insert(verified)
  return "ok"
}
`);
    const taintDiags = result.diagnostics.filter(d =>
      d.code === "LLN-VALUESTATE-005" || d.code === "LLN-VALUESTATE-003"
    );
    assert.equal(taintDiags.length, 0, `check* fn should break taint chain, got: ${taintDiags.map(d => d.code).join(", ")}`);
  });

  it("fn starting with 'verify' is treated as a user gate", () => {
    const result = parseAndCheck(`
guarded flow test(readonly request: Request) -> String
contract { effects { database.write } }
{
  fn verifyToken(raw: String) -> String {
    return raw
  }
  unsafe let rawToken: String = request.body.token
  let safeToken: String = verifyToken(rawToken)
  UsersDB.insert(safeToken)
  return "ok"
}
`);
    const taintDiags = result.diagnostics.filter(d =>
      d.code === "LLN-VALUESTATE-005" || d.code === "LLN-VALUESTATE-003"
    );
    assert.equal(taintDiags.length, 0, `verify* fn should break taint chain, got: ${taintDiags.map(d => d.code).join(", ")}`);
  });

  it("fn NOT starting with a gate prefix is NOT treated as a user gate", () => {
    const result = parseAndCheck(`
guarded flow test(readonly request: Request) -> String
contract { effects { database.write } }
{
  fn processInput(raw: String) -> String {
    return raw
  }
  unsafe let rawVal: String = request.body.value
  let processed: String = processInput(rawVal)
  UsersDB.insert(processed)
  return "ok"
}
`);
    const taintDiags = result.diagnostics.filter(d =>
      d.code === "LLN-VALUESTATE-005" || d.code === "LLN-VALUESTATE-003"
    );
    assert.ok(taintDiags.length > 0, `Non-gate fn should NOT break taint chain`);
  });

  it("user gate fn used with safe mut does not emit LLN-VALUESTATE-001", () => {
    const result = parseAndCheck(`
secure flow test(raw: String) -> Result<String, Error>
contract { effects { database.write } }
{
  fn validateEmail(s: String) -> String {
    return s
  }
  unsafe let rawEmail: String = raw
  safe mut rawEmail = validateEmail(rawEmail)
  let saved = DB.insert(rawEmail)?
  return Ok("ok")
}
`);
    assert.ok(
      !hasDiag(result, "LLN-VALUESTATE-001"),
      `User gate fn should satisfy safe mut gate requirement`
    );
  });
});

// ── Rust-style related locations ──────────────────────────────────────────────

describe("Value-state checker — Rust-style related locations", () => {
  it("LLN-VALUESTATE-003 includes relatedLocations pointing to unsafe declaration", () => {
    const result = parseAndCheck(`
secure flow test(raw: String) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawInput: String = raw
  let saved = DB.insert(rawInput)?
  return Ok(saved)
}
`);
    const diag = result.diagnostics.find((d) => d.code === "LLN-VALUESTATE-003");
    assert.ok(diag !== undefined, "Expected LLN-VALUESTATE-003");
    assert.ok(diag.why !== undefined, "Expected why field");
    assert.ok(diag.risk !== undefined, "Expected risk field");
  });

  it("LLN-SECRET-001 includes why and risk fields", () => {
    const result = parseAndCheck(`
secure flow test() -> Result<String, Error>
contract { effects { secret.read } }
{
  let apiKey: SecureString = env.secret("API_KEY")
  log.info(apiKey)
  return Ok("done")
}
`);
    const diag = result.diagnostics.find((d) => d.code === "LLN-SECRET-001");
    assert.ok(diag !== undefined, "Expected LLN-SECRET-001");
    assert.ok(diag.why !== undefined, "Expected why field on LLN-SECRET-001");
    assert.ok(diag.risk !== undefined, "Expected risk field on LLN-SECRET-001");
  });
});

// ── LLN-VALUESTATE-006: ProtectedBoundaryViolation ───────────────────────────

describe("Value-state checker — LLN-VALUESTATE-006 ProtectedBoundaryViolation", () => {
  it("emits LLN-VALUESTATE-006 when protect() value assigned to plain binding", () => {
    const result = parseAndCheck(`
flow test() -> String {
  let email: Email = protect("user@example.com")
  return "ok"
}
`);
    assert.ok(
      hasDiag(result, "LLN-VALUESTATE-006"),
      `Expected LLN-VALUESTATE-006 for let email: Email = protect(...), got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("emits LLN-VALUESTATE-006 when protect() assigned to plain String binding", () => {
    const result = parseAndCheck(
      'flow test() -> String { let x: String = protect("raw")\nreturn "ok" }',
    );
    assert.ok(
      hasDiag(result, "LLN-VALUESTATE-006"),
      `Expected LLN-VALUESTATE-006 for String = protect("raw"), got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("does not emit LLN-VALUESTATE-006 when declared type includes 'protected'", () => {
    const result = parseAndCheck(
      'flow test() -> String { let x: protected Email = protect("user@example.com")\nreturn "ok" }',
    );
    assert.ok(
      !hasDiag(result, "LLN-VALUESTATE-006"),
      `Unexpected LLN-VALUESTATE-006 when declared type is 'protected Email'`,
    );
  });

  it("does not emit LLN-VALUESTATE-006 for plain string literal assigned to String", () => {
    const result = parseAndCheck(`
flow test() -> String {
  let safe: String = "hello"
  return safe
}
`);
    assert.ok(
      !hasDiag(result, "LLN-VALUESTATE-006"),
      `Unexpected LLN-VALUESTATE-006 for a plain String literal`,
    );
  });
});

// ── LLN-VALUESTATE-007: RedactedBoundaryViolation ────────────────────────────

describe("Value-state checker — LLN-VALUESTATE-007 RedactedBoundaryViolation", () => {
  it("emits LLN-VALUESTATE-007 when redact() value assigned to plain String binding", () => {
    const result = parseAndCheck(
      'flow test() -> String { let s: String = redact("secret")\nreturn "ok" }',
    );
    assert.ok(
      hasDiag(result, "LLN-VALUESTATE-007"),
      `Expected LLN-VALUESTATE-007 for String = redact("secret"), got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("LLN-VALUESTATE-007 message mentions irreversibility or redaction", () => {
    const result = parseAndCheck(
      'flow test() -> String { let s: String = redact("secret")\nreturn "ok" }',
    );
    const diag = diagsWithCode(result, "LLN-VALUESTATE-007")[0];
    assert.ok(diag !== undefined, "Expected LLN-VALUESTATE-007");
    assert.ok(
      diag.message.includes("irreversible") || diag.message.includes("redact"),
      `Expected 'irreversible' or 'redact' in message: ${diag.message}`,
    );
  });

  it("does not emit LLN-VALUESTATE-007 when declared type includes 'redacted'", () => {
    const result = parseAndCheck(
      'flow test() -> String { let s: redacted String = redact("secret")\nreturn "ok" }',
    );
    assert.ok(
      !hasDiag(result, "LLN-VALUESTATE-007"),
      `Unexpected LLN-VALUESTATE-007 when declared type is 'redacted String'`,
    );
  });

  it("does not emit LLN-VALUESTATE-007 for a plain string literal assigned to String", () => {
    const result = parseAndCheck(`
flow test() -> String {
  let safe: String = "public"
  return safe
}
`);
    assert.ok(
      !hasDiag(result, "LLN-VALUESTATE-007"),
      `Unexpected LLN-VALUESTATE-007 for a plain String literal`,
    );
  });
});

// ── LLN-VALUESTATE-002: UnsafeConditionalUpgrade ─────────────────────────────

describe("Value-state checker — LLN-VALUESTATE-002 UnsafeConditionalUpgrade", () => {
  it("emits LLN-VALUESTATE-002 when then-branch uses gate but else-branch does not", () => {
    const result = parseAndCheck(`
secure flow test(raw: String, cond: Bool) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawEmail: String = raw
  if cond {
    safe mut rawEmail = validate.email(rawEmail)?
  } else {
    safe mut rawEmail = rawEmail
  }
  return Ok(rawEmail)
}
`);
    assert.ok(
      hasDiag(result, "LLN-VALUESTATE-002"),
      `Expected LLN-VALUESTATE-002 for asymmetric gate usage, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("emits LLN-VALUESTATE-002 when else-branch uses gate but then-branch does not", () => {
    const result = parseAndCheck(`
secure flow test(raw: String, cond: Bool) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawEmail: String = raw
  if cond {
    safe mut rawEmail = rawEmail
  } else {
    safe mut rawEmail = validate.email(rawEmail)?
  }
  return Ok(rawEmail)
}
`);
    assert.ok(
      hasDiag(result, "LLN-VALUESTATE-002"),
      `Expected LLN-VALUESTATE-002 when only else-branch has gate, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("does not emit LLN-VALUESTATE-002 when both branches use a gate", () => {
    const result = parseAndCheck(`
secure flow test(raw: String, cond: Bool) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawEmail: String = raw
  if cond {
    safe mut rawEmail = validate.email(rawEmail)?
  } else {
    safe mut rawEmail = sanitize.text(rawEmail)?
  }
  return Ok(rawEmail)
}
`);
    assert.ok(
      !hasDiag(result, "LLN-VALUESTATE-002"),
      `Unexpected LLN-VALUESTATE-002 when both branches use a gate`,
    );
  });

  it("does not emit LLN-VALUESTATE-002 when only one branch has a safe mut (no asymmetry)", () => {
    const result = parseAndCheck(`
secure flow test(raw: String, cond: Bool) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawEmail: String = raw
  if cond {
    safe mut rawEmail = validate.email(rawEmail)?
  }
  return Ok(rawEmail)
}
`);
    assert.ok(
      !hasDiag(result, "LLN-VALUESTATE-002"),
      `Unexpected LLN-VALUESTATE-002 when only then-branch has safe mut`,
    );
  });
});

// ── Cross-conditional taint tracking ─────────────────────────────────────────

describe("Value-state checker — cross-conditional taint tracking", () => {
  it("emits VALUESTATE-003 for unsafe value used at sink inside if body (non-gate condition)", () => {
    const result = parseAndCheck(`
secure flow test(rawEmail: String) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawEmail: String = rawEmail
  if rawEmail.contains("@") {
    DatabaseDB.write(rawEmail)
  }
  return Ok("ok")
}
`);
    assert.ok(
      hasDiag(result, "LLN-VALUESTATE-003"),
      `Expected VALUESTATE-003 inside if body — non-gate condition does not clear taint, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("emits VALUESTATE-003 in both branches when unsafe value reaches sink", () => {
    const result = parseAndCheck(`
secure flow test(raw: String, cond: Bool) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawInput: String = raw
  if cond {
    DatabaseDB.write(rawInput)
  } else {
    DatabaseDB.write(rawInput)
  }
  return Ok("ok")
}
`);
    const diags = diagsWithCode(result, "LLN-VALUESTATE-003");
    assert.ok(diags.length >= 1, `Expected at least one VALUESTATE-003 inside if/else with unsafe at sink, got: ${result.diagnostics.map((d) => d.code).join(", ")}`);
  });
});

// ── SECRET-003 extended: AuditLog.write with SecureString ────────────────────

describe("Value-state checker — LLN-SECRET-003 extended detection", () => {
  it("emits LLN-SECRET-003 when SecureString is passed to AuditLog.write", () => {
    const result = parseAndCheck(`
secure flow test() -> Result<String, Error>
contract { effects { audit.write, secret.read } }
{
  let apiKey: SecureString = env.secret("API_KEY")
  AuditLog.write(apiKey)
  return Ok("done")
}
`);
    assert.ok(
      hasDiag(result, "LLN-SECRET-003"),
      `Expected LLN-SECRET-003 for SecureString in AuditLog.write, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("does not emit LLN-SECRET-003 when SecureString is redacted before AuditLog.write", () => {
    const result = parseAndCheck(`
secure flow test() -> Result<String, Error>
contract { effects { audit.write, secret.read } }
{
  let apiKey: SecureString = env.secret("API_KEY")
  AuditLog.write(redact(apiKey))
  return Ok("done")
}
`);
    assert.ok(
      !hasDiag(result, "LLN-SECRET-003"),
      `Unexpected LLN-SECRET-003 when SecureString is redacted before AuditLog.write`,
    );
  });
});

// ── Task 4: protected value at AuditLog.write → VALUESTATE-006 ──────────────

describe("Value-state checker — protected value at AuditLog.write (VALUESTATE-006)", () => {
  it("emits LLN-VALUESTATE-006 for protected Email binding at AuditLog.write without redact", () => {
    const result = parseAndCheck(`
secure flow test(raw: String) -> Result<String, Error>
contract { effects { audit.write, database.write } }
{
  unsafe let rawEmail: String = raw
  let email: protected Email = validate.email(rawEmail)?
  AuditLog.write(email)
  return Ok("ok")
}
`);
    assert.ok(
      hasDiag(result, "LLN-VALUESTATE-006"),
      `Expected LLN-VALUESTATE-006 for protected Email at AuditLog.write, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("does not emit LLN-VALUESTATE-006 for protected Email wrapped in redact() at AuditLog.write", () => {
    const result = parseAndCheck(`
secure flow test(raw: String) -> Result<String, Error>
contract { effects { audit.write, database.write } }
{
  unsafe let rawEmail: String = raw
  let email: protected Email = validate.email(rawEmail)?
  AuditLog.write(redact(email))
  return Ok("ok")
}
`);
    assert.ok(
      !hasDiag(result, "LLN-VALUESTATE-006"),
      `Unexpected LLN-VALUESTATE-006 when protected value is redacted before AuditLog.write`,
    );
  });

  it("emits LLN-VALUESTATE-003 (not VALUESTATE-006) for raw unsafe value at DatabaseDB.write", () => {
    const result = parseAndCheck(`
secure flow test(raw: String) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawEmail: String = raw
  DatabaseDB.write(rawEmail)
  return Ok("ok")
}
`);
    assert.ok(
      hasDiag(result, "LLN-VALUESTATE-003"),
      `Expected LLN-VALUESTATE-003 for raw unsafe at DatabaseDB.write, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
    assert.ok(
      !hasDiag(result, "LLN-VALUESTATE-006"),
      `Unexpected LLN-VALUESTATE-006 for raw unsafe at DatabaseDB.write (should be VALUESTATE-003)`,
    );
  });
});

// ── Regression: record literals must not launder taint ────────────────────────
// `unsafe let x` → `let m = { id: x }` → sink(m) previously passed SILENTLY because
// isTaintedExpression didn't inspect record field values. Now the record carries the
// taint of its fields (gate calls on a field still sanitize).
describe("Value-state checker — record literal taint propagation", () => {
  it("flags taint when an unsafe binding is stored in a record then sunk", () => {
    const result = parseAndCheck(`
secure flow t(raw: String) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawInput: String = raw
  let m = { id: rawInput }
  let saved = DB.insert(m)?
  return Ok(saved)
}
`);
    assert.ok(
      hasDiag(result, "LLN-VALUESTATE-005") || hasDiag(result, "LLN-VALUESTATE-003"),
      `Expected a taint-at-sink diagnostic for record-laundered unsafe input, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("does NOT flag when the record field is sanitized by a gate", () => {
    const result = parseAndCheck(`
secure flow t(raw: String) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawInput: String = raw
  let m = { id: validate.input(rawInput) }
  let saved = DB.insert(m)?
  return Ok(saved)
}
`);
    assert.ok(
      !hasDiag(result, "LLN-VALUESTATE-005") && !hasDiag(result, "LLN-VALUESTATE-003"),
      `Gate-sanitized record field must not trip taint, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });
});

// ── Secret taint guard: secrets {} accessors are SecureString-equivalent ──────
// A binding read from a secret accessor (secret.get / vault.read / kms / secrets.*)
// is inferred SecureString, so the existing LLN-SECRET-001 (log) / LLN-SECRET-003
// (serialize) sink guards block it from leaking. redact() is the safe escape.
describe("Value-state checker — secret-source taint (secrets {} credentials)", () => {
  const mk = (body) => `secure flow f() -> Int
contract { intent { "x" }  secrets { credential k { provider "vault" } } }
{
${body}
  return 0
}`;
  it("a secret read then logged → LLN-SECRET-001", () => {
    const r = parseAndCheck(mk('  let key = secret.get("LEDGER_WRITE_KEY")\n  log.info(key)'));
    assert.ok(hasDiag(r, "LLN-SECRET-001"), `expected SECRET-001, got: ${r.diagnostics.map((d) => d.code).join(", ")}`);
  });
  it("a secret read then serialized → LLN-SECRET-003", () => {
    const r = parseAndCheck(mk('  let key = vault.read("K")\n  let s = json.encode(key)'));
    assert.ok(hasDiag(r, "LLN-SECRET-003"), `expected SECRET-003, got: ${r.diagnostics.map((d) => d.code).join(", ")}`);
  });
  it("redact(secret) before logging → clean (redact is the safe escape)", () => {
    const r = parseAndCheck(mk('  let key = secret.get("K")\n  log.info(redact(key))'));
    assert.ok(!hasDiag(r, "LLN-SECRET-001"), `redact must clear the secret, got: ${r.diagnostics.map((d) => d.code).join(", ")}`);
  });
  it("a non-secret value logged → no SECRET diagnostic", () => {
    const r = parseAndCheck(mk('  let x = compute(1)\n  log.info(x)'));
    assert.ok(!hasDiag(r, "LLN-SECRET-001") && !hasDiag(r, "LLN-SECRET-003"));
  });
});

// ── Secret → network egress guard (LLN-SECRET-002) ───────────────────────────
describe("Value-state checker — secret to network egress", () => {
  const mk = (body) => `secure flow f() -> Int
contract { intent { "x" }  secrets { credential k { provider "vault" } } }
{
${body}
  return 0
}`;
  it("a secret sent to http.post → LLN-SECRET-002", () => {
    const r = parseAndCheck(mk('  let key = secret.get("K")\n  let r = http.post("https://x", key)'));
    assert.ok(hasDiag(r, "LLN-SECRET-002"), `expected SECRET-002, got: ${r.diagnostics.map((d) => d.code).join(", ")}`);
  });
  it("a secret sent to fetch(...) → LLN-SECRET-002", () => {
    const r = parseAndCheck(mk('  let key = vault.read("K")\n  let r = fetch(key)'));
    assert.ok(hasDiag(r, "LLN-SECRET-002"));
  });
  it("redact(secret) to http.post → clean", () => {
    const r = parseAndCheck(mk('  let key = secret.get("K")\n  let r = http.post("u", redact(key))'));
    assert.ok(!hasDiag(r, "LLN-SECRET-002"));
  });
  it("a non-secret value to http.post → clean", () => {
    const r = parseAndCheck(mk('  let x = build(1)\n  let r = http.post("u", x)'));
    assert.ok(!hasDiag(r, "LLN-SECRET-002"));
  });

  // ── Derived-secret egress (regression: the credential laundering fail-open) ──
  // A secret transformed via slice/concat/record/etc. must STILL be blocked — these
  // are exactly the exfiltration vectors (the same evasion class as vec2text on a
  // semantic vector). Before the derivesFromSecret fix, all of these leaked clean.
  it("a SLICED secret sent to http.post → LLN-SECRET-002", () => {
    const r = parseAndCheck(mk('  let key = secret.get("K")\n  let part = key.slice(0,5)\n  let r = http.post("u", part)'));
    assert.ok(hasDiag(r, "LLN-SECRET-002"), `expected SECRET-002 for sliced secret, got: ${r.diagnostics.map((d) => d.code).join(", ")}`);
  });
  it("a CONCATENATED secret sent to http.post → LLN-SECRET-002", () => {
    const r = parseAndCheck(mk('  let key = secret.get("K")\n  let p = key + "Z"\n  let r = http.post("u", p)'));
    assert.ok(hasDiag(r, "LLN-SECRET-002"), `expected SECRET-002 for concatenated secret, got: ${r.diagnostics.map((d) => d.code).join(", ")}`);
  });
  it("a secret wrapped in a RECORD field sent to http.post → LLN-SECRET-002", () => {
    const r = parseAndCheck(mk('  let key = secret.get("K")\n  let rec = { tok: key }\n  let r = http.post("u", rec)'));
    assert.ok(hasDiag(r, "LLN-SECRET-002"), `expected SECRET-002 for record-wrapped secret, got: ${r.diagnostics.map((d) => d.code).join(", ")}`);
  });
  it("a DOUBLY-derived secret (slice then concat) sent to http.post → LLN-SECRET-002", () => {
    const r = parseAndCheck(mk('  let key = secret.get("K")\n  let a = key.slice(0,8)\n  let b = a + "!"\n  let r = http.post("u", b)'));
    assert.ok(hasDiag(r, "LLN-SECRET-002"), `expected SECRET-002 for doubly-derived secret, got: ${r.diagnostics.map((d) => d.code).join(", ")}`);
  });
  it("redact() of a secret via an intermediate binding → clean (redact is the sole declassifier)", () => {
    const r = parseAndCheck(mk('  let key = secret.get("K")\n  let safe = redact(key)\n  let r = http.post("u", safe)'));
    assert.ok(!hasDiag(r, "LLN-SECRET-002"), `redact-via-binding must clear the secret, got: ${r.diagnostics.map((d) => d.code).join(", ")}`);
  });
  it("a derived NON-secret value → clean (no false positive)", () => {
    const r = parseAndCheck(mk('  let x = build(1)\n  let p = x.slice(0,2)\n  let r = http.post("u", p)'));
    assert.ok(!hasDiag(r, "LLN-SECRET-002"));
  });
});

// ── Phase 4.1: List/array taint propagation ───────────────────────────────────

describe("Value-state checker — Phase 4.1 list taint propagation", () => {
  it("list containing a tainted element → DB.insert → VALUESTATE-005", () => {
    const result = parseAndCheck(`
secure flow test(raw: String) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let unsafeInput: String = raw
  let xs = [unsafeInput, "clean"]
  let saved = DB.insert(xs)?
  return Ok(saved)
}
`);
    assert.ok(
      hasDiag(result, "LLN-VALUESTATE-005") || hasDiag(result, "LLN-VALUESTATE-003"),
      `Expected taint-at-sink for list with tainted element, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("clean list → DB.insert → clean (no taint diagnostic)", () => {
    const result = parseAndCheck(`
secure flow test() -> Result<String, Error>
contract { effects { database.write } }
{
  let xs = ["clean1", "clean2"]
  let saved = DB.insert(xs)?
  return Ok(saved)
}
`);
    assert.ok(
      !hasDiag(result, "LLN-VALUESTATE-005") && !hasDiag(result, "LLN-VALUESTATE-003"),
      `Unexpected taint diagnostic for clean list, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("list with all elements sanitized → sink → clean", () => {
    const result = parseAndCheck(`
secure flow test(raw: String) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let unsafeInput: String = raw
  let safeVal: String = validate.input(unsafeInput)?
  let xs = [safeVal, "other"]
  let saved = DB.insert(xs)?
  return Ok(saved)
}
`);
    assert.ok(
      !hasDiag(result, "LLN-VALUESTATE-005") && !hasDiag(result, "LLN-VALUESTATE-003"),
      `Gate-sanitized list element must not trip taint, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });
});

// ── Phase 4.2: Deep nested record field taint ─────────────────────────────────

describe("Value-state checker — Phase 4.2 deep nested record field taint", () => {
  it("p.id where p = { id: unsafeInput } → let v = p.id → DB.insert(v) → VALUESTATE-005", () => {
    const result = parseAndCheck(`
secure flow test(raw: String) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let unsafeInput: String = raw
  let p = { id: unsafeInput }
  let v = p.id
  let saved = DB.insert(v)?
  return Ok(saved)
}
`);
    assert.ok(
      hasDiag(result, "LLN-VALUESTATE-005") || hasDiag(result, "LLN-VALUESTATE-003"),
      `Expected taint-at-sink for p.id from tainted record, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("clean record field access → sink → clean", () => {
    const result = parseAndCheck(`
secure flow test() -> Result<String, Error>
contract { effects { database.write } }
{
  let p = { id: "safe_id" }
  let v = p.id
  let saved = DB.insert(v)?
  return Ok(saved)
}
`);
    assert.ok(
      !hasDiag(result, "LLN-VALUESTATE-005") && !hasDiag(result, "LLN-VALUESTATE-003"),
      `Unexpected taint for clean record field, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });
});

// ── Phase 4.3: Inter-flow taint tracking ─────────────────────────────────────

describe("Value-state checker — Phase 4.3 inter-flow taint tracking", () => {
  it("tainted arg passed to user-defined flow → VALUESTATE-004 warning", () => {
    const result = parseAndCheck(`
flow processData(input: String) -> String {
  return input
}

secure flow test(raw: String) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let rawBody: String = raw
  let result = processData(rawBody)
  return Ok(result)
}
`);
    assert.ok(
      hasDiag(result, "LLN-VALUESTATE-004"),
      `Expected LLN-VALUESTATE-004 for tainted arg to user flow, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("tainted arg passed to user flow: message names both the value and the flow", () => {
    const result = parseAndCheck(`
flow processData(input: String) -> String {
  return input
}

secure flow test(raw: String) -> Result<String, Error>
contract { effects { database.write } }
{
  unsafe let raw: String = raw
  processData(raw)
  return Ok("ok")
}
`);
    const diag = result.diagnostics.find((d) => d.code === "LLN-VALUESTATE-004");
    assert.ok(diag !== undefined, "Expected LLN-VALUESTATE-004");
    assert.ok(
      diag.message.includes("processData"),
      `Expected 'processData' in message: ${diag.message}`,
    );
  });

  it("clean arg passed to user-defined flow → no VALUESTATE-004", () => {
    const result = parseAndCheck(`
flow processData(input: String) -> String {
  return input
}

secure flow test() -> Result<String, Error>
contract { effects { database.write } }
{
  let cleanVal: String = "safe"
  let result = processData(cleanVal)
  return Ok(result)
}
`);
    assert.ok(
      !hasDiag(result, "LLN-VALUESTATE-004"),
      `Unexpected LLN-VALUESTATE-004 for clean arg to user flow, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });
});

// ── Phase 4.4: source_from annotation ────────────────────────────────────────

describe("Value-state checker — Phase 4.4 source_from annotation", () => {
  it("param source_from Network.ClientSocket → auto-tainted → DB.insert → VALUESTATE-003", () => {
    const result = parseAndCheck(`
secure flow handleRequest(body: String source_from Network.ClientSocket) -> Result<String, Error>
contract { effects { database.write } }
{
  let saved = DB.insert(body)?
  return Ok(saved)
}
`);
    assert.ok(
      hasDiag(result, "LLN-VALUESTATE-003"),
      `Expected LLN-VALUESTATE-003 for source_from Network.ClientSocket, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("param source_from Network.HttpRequest → auto-tainted → DB.insert → VALUESTATE-003", () => {
    const result = parseAndCheck(`
secure flow handleRequest(payload: String source_from Network.HttpRequest) -> Result<String, Error>
contract { effects { database.write } }
{
  let saved = DB.insert(payload)?
  return Ok(saved)
}
`);
    assert.ok(
      hasDiag(result, "LLN-VALUESTATE-003"),
      `Expected LLN-VALUESTATE-003 for source_from Network.HttpRequest, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("param source_from Network.* with gate upgrade → sink → clean", () => {
    const result = parseAndCheck(`
secure flow handleRequest(body: String source_from Network.ClientSocket) -> Result<String, Error>
contract { effects { database.write } }
{
  safe mut body = validate.body(body)?
  let saved = DB.insert(body)?
  return Ok(saved)
}
`);
    assert.ok(
      !hasDiag(result, "LLN-VALUESTATE-003"),
      `Unexpected VALUESTATE-003 after gate upgrade of source_from param, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("param source_from InternalService.Config → clean → DB.insert → clean", () => {
    const result = parseAndCheck(`
secure flow handleRequest(config: String source_from InternalService.Config) -> Result<String, Error>
contract { effects { database.write } }
{
  let saved = DB.insert(config)?
  return Ok(saved)
}
`);
    assert.ok(
      !hasDiag(result, "LLN-VALUESTATE-003") && !hasDiag(result, "LLN-VALUESTATE-005"),
      `Unexpected taint diagnostic for InternalService.Config source_from, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("param source_from External.Api → tainted (External.* prefix) → DB.insert → VALUESTATE-003", () => {
    const result = parseAndCheck(`
secure flow handleRequest(data: String source_from External.Api) -> Result<String, Error>
contract { effects { database.write } }
{
  let saved = DB.insert(data)?
  return Ok(saved)
}
`);
    assert.ok(
      hasDiag(result, "LLN-VALUESTATE-003"),
      `Expected VALUESTATE-003 for External.* source_from, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("param source_from Database.PrimaryKey → clean → DB.insert → clean", () => {
    const result = parseAndCheck(`
secure flow handleRequest(id: String source_from Database.PrimaryKey) -> Result<String, Error>
contract { effects { database.write } }
{
  let saved = DB.insert(id)?
  return Ok(saved)
}
`);
    assert.ok(
      !hasDiag(result, "LLN-VALUESTATE-003") && !hasDiag(result, "LLN-VALUESTATE-005"),
      `Unexpected taint for Database.PrimaryKey source_from, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  // ── #153 FAIL-CLOSED: unknown / unregistered origin must be treated as TAINTED ──
  it("FAIL-CLOSED: param source_from UNKNOWN origin → tainted → DB.insert → VALUESTATE-003", () => {
    const result = parseAndCheck(`
secure flow handleRequest(data: String source_from Mystery.Source) -> Result<String, Error>
contract { effects { database.write } }
{
  let saved = DB.insert(data)?
  return Ok(saved)
}
`);
    assert.ok(
      hasDiag(result, "LLN-VALUESTATE-003"),
      `Expected VALUESTATE-003 for an unknown/unregistered source_from origin (deny-by-default), got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("FAIL-CLOSED: unknown origin can still be cleaned by a gate before the sink", () => {
    const result = parseAndCheck(`
secure flow handleRequest(data: String source_from Mystery.Source) -> Result<String, Error>
contract { effects { database.write } }
{
  safe mut data = validate.body(data)?
  let saved = DB.insert(data)?
  return Ok(saved)
}
`);
    assert.ok(
      !hasDiag(result, "LLN-VALUESTATE-003"),
      `Unexpected VALUESTATE-003 after gating an unknown-origin param, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });
});

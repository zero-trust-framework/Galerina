// GOV-003 broadening (audit 2026-06-16): a field listed in contract.response.denies must not leak
// via a BARE MEMBER ACCESS (return user.email) or a POSITIONAL value (return Ok(email)) — not only
// via a named-argument label (the old detection). redact()/seal() discharge. Exact field-name match,
// so a non-denied field is never falsely flagged.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseProgram, checkEffects, verifyGovernance } from "../../dist/index.js";

function gov(source, profile = "dev") {
  const parsed = parseProgram(source, "test.lln");
  const effects = checkEffects(parsed.flows, parsed.ast);
  return verifyGovernance(parsed.ast, parsed.flows, effects, profile);
}
const has = (g, code) => g.diagnostics.some((d) => d.code === code);
const codes = (g) => g.diagnostics.map((d) => d.code).join(", ");
const flow = (body) => `secure flow getUser(id: String) -> Result<String, String>
contract {
  intent { "Return user data." }
  effects { database.read }
  response {
    returns UserDto
    denies { email }
  }
}
{
${body}
}`;

describe("GOV-003: a denied response field cannot leak via member/positional returns", () => {
  it("denied field via member access (return Ok(user.email)) emits LLN-GOV-003", () => {
    const g = gov(flow("  let user = UsersDB.read(id)?\n  return Ok(user.email)"));
    assert.ok(has(g, "LLN-GOV-003"), codes(g));
  });

  it("redact(user.email) discharges the denied field — no LLN-GOV-003", () => {
    const g = gov(flow("  let user = UsersDB.read(id)?\n  return Ok(redact(user.email))"));
    assert.ok(!has(g, "LLN-GOV-003"), codes(g));
  });

  it("positional return of a denied field name (return Ok(email)) emits LLN-GOV-003", () => {
    const g = gov(flow("  let email = UsersDB.read(id)?\n  return Ok(email)"));
    assert.ok(has(g, "LLN-GOV-003"), codes(g));
  });

  it("a non-denied field (user.name) is clean — no false positive", () => {
    const g = gov(flow("  let user = UsersDB.read(id)?\n  return Ok(user.name)"));
    assert.ok(!has(g, "LLN-GOV-003"), codes(g));
  });

  // GOV-003 residual fix (2026-06-20): a denied field laundered through an intermediate binding RENAME.
  it("denied field via an intermediate binding rename (let e = user.email; return e) emits LLN-GOV-003", () => {
    const g = gov(flow("  let user = UsersDB.read(id)?\n  let e = user.email\n  return Ok(e)"));
    assert.ok(has(g, "LLN-GOV-003"), codes(g));
  });

  it("rename of a redacted denied field (let e = redact(user.email); return e) — no LLN-GOV-003", () => {
    const g = gov(flow("  let user = UsersDB.read(id)?\n  let e = redact(user.email)\n  return Ok(e)"));
    assert.ok(!has(g, "LLN-GOV-003"), codes(g));
  });

  it("alias-of-alias rename (let e = user.email; let f = e; return f) emits LLN-GOV-003", () => {
    const g = gov(flow("  let user = UsersDB.read(id)?\n  let e = user.email\n  let f = e\n  return Ok(f)"));
    assert.ok(has(g, "LLN-GOV-003"), codes(g));
  });

  it("rename of a non-denied field (let n = user.name; return n) stays clean — no false positive", () => {
    const g = gov(flow("  let user = UsersDB.read(id)?\n  let n = user.name\n  return Ok(n)"));
    assert.ok(!has(g, "LLN-GOV-003"), codes(g));
  });
});

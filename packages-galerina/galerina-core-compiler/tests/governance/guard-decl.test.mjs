// =============================================================================
// Governance Verifier — guard Name {} Domain Ceiling Declaration Tests
//
// Tests for the `guard Name { permitted_effects { ... } }` syntax (task #56/#72)
// which is the canonical v2.2 form of policyDecl.
//
// Covers:
//   - guardDecl parses as AST node kind "guardDecl"
//   - parent_policy: annotation + subset verification (FUNGI-INHERIT-001/002, task #72)
//   - contract [conforms_to: GuardName] validates effects against the guard ceiling
//   - FUNGI-GOV-004 for effects outside the guard's permitted set
// =============================================================================

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseProgram,
  checkEffects,
  verifyGovernance,
} from "../../dist/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseAndVerify(source, profile = "dev") {
  const parsed = parseProgram(source, "test.fungi");
  const effects = checkEffects(parsed.flows, parsed.ast);
  return verifyGovernance(parsed.ast, parsed.flows, effects, profile);
}

function hasDiag(result, code) {
  return result.diagnostics.some((d) => d.code === code);
}

function findNode(ast, kind, name) {
  for (const child of ast.children ?? []) {
    if (child.kind === kind && (name === undefined || child.value === name)) {
      return child;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// guardDecl AST shape
// ---------------------------------------------------------------------------

describe("guard Name {}: AST node kind", () => {
  it("guard PaymentGuard { permitted_effects { database.write } } parses as guardDecl", () => {
    const source = `
guard PaymentGuard {
  permitted_effects {
    database.write
  }
}
`;
    const { ast, diagnostics } = parseProgram(source, "test.fungi");
    const errors = diagnostics.filter((d) => d.severity === "error");
    assert.equal(
      errors.length,
      0,
      `Expected 0 errors, got: ${errors.map((e) => e.message).join(", ")}`,
    );

    // The guard must be stored as a guardDecl node at program level
    const guardNode = findNode(ast, "guardDecl", "PaymentGuard");
    assert.ok(guardNode !== undefined, "guardDecl node must exist for PaymentGuard");
    assert.equal(guardNode.kind, "guardDecl", "Node kind must be guardDecl");
    assert.equal(guardNode.value, "PaymentGuard", "Node value must be PaymentGuard");
  });

  it("guard with permitted_effects has sub-block children", () => {
    const source = `
guard BillingGuard {
  permitted_effects {
    gateway.charge,
    audit.write
  }
}
`;
    const { ast } = parseProgram(source, "test.fungi");
    const guardNode = findNode(ast, "guardDecl", "BillingGuard");
    assert.ok(guardNode !== undefined, "guardDecl node must exist for BillingGuard");
    // The permitted_effects sub-block should appear as an identifier child
    const permEffects = (guardNode.children ?? []).find(
      (c) => c.kind === "identifier" && c.value === "permitted_effects",
    );
    assert.ok(permEffects !== undefined, "permitted_effects sub-block must exist as child");
    const effectNames = (permEffects.children ?? []).map((c) => c.value);
    assert.ok(
      effectNames.includes("gateway.charge"),
      `Expected gateway.charge in permitted_effects, got: ${effectNames.join(", ")}`,
    );
    assert.ok(
      effectNames.includes("audit.write"),
      `Expected audit.write in permitted_effects, got: ${effectNames.join(", ")}`,
    );
  });

  it("guard without enforced_limits still parses cleanly", () => {
    const source = `
guard SimpleGuard {
  permitted_effects {
    database.read
  }
}
`;
    const { diagnostics } = parseProgram(source, "test.fungi");
    const errors = diagnostics.filter((d) => d.severity === "error");
    assert.equal(
      errors.length,
      0,
      `Expected 0 errors for guard without enforced_limits, got: ${errors.map((e) => e.message).join(", ")}`,
    );
  });
});

// ---------------------------------------------------------------------------
// parent_policy: annotation (task #72) — FUNGI-INHERIT-001/002
// ---------------------------------------------------------------------------

describe("guard parent_policy: subset verification (FUNGI-INHERIT-001/002)", () => {
  it("child guard with effects subset of parent passes cleanly — 0 FUNGI-INHERIT errors", () => {
    const source = `
guard FinanceFullAccess {
  permitted_effects {
    gateway.charge,
    database.write,
    audit.write,
    network.outbound
  }
}

guard InvoicingSubset {
  parent_policy: FinanceFullAccess
  permitted_effects {
    gateway.charge,
    audit.write
  }
}
`;
    const result = parseAndVerify(source);
    const inheritErrors = result.diagnostics.filter(
      (d) => d.code === "FUNGI-INHERIT-001" || d.code === "FUNGI-INHERIT-002",
    );
    assert.equal(
      inheritErrors.length,
      0,
      `Expected 0 FUNGI-INHERIT errors for valid subset, got: ${inheritErrors.map((e) => `${e.code}: ${e.message}`).join("; ")}`,
    );
  });

  it("FUNGI-INHERIT-001: parent policy name not found emits error", () => {
    const source = `
guard ChildGuard {
  parent_policy: NonExistentParent
  permitted_effects {
    database.read
  }
}
`;
    const result = parseAndVerify(source);
    assert.ok(
      hasDiag(result, "FUNGI-INHERIT-001"),
      `Expected FUNGI-INHERIT-001 for unknown parent policy, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("FUNGI-INHERIT-002: child guard with effect not in parent emits error", () => {
    const source = `
guard ParentGuard {
  permitted_effects {
    database.read,
    audit.write
  }
}

guard ChildGuard {
  parent_policy: ParentGuard
  permitted_effects {
    database.read,
    network.outbound
  }
}
`;
    const result = parseAndVerify(source);
    assert.ok(
      hasDiag(result, "FUNGI-INHERIT-002"),
      `Expected FUNGI-INHERIT-002 when child adds network.outbound (not in parent), got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
    const diag = result.diagnostics.find((d) => d.code === "FUNGI-INHERIT-002");
    assert.ok(
      diag?.message.includes("network.outbound") || diag?.message.includes("ChildGuard"),
      `FUNGI-INHERIT-002 message should mention the violation, got: ${diag?.message}`,
    );
  });
});

// ---------------------------------------------------------------------------
// contract [conforms_to: GuardName] — FUNGI-GOV-004
// ---------------------------------------------------------------------------

describe("contract [conforms_to: GuardName]: effect subset validation (FUNGI-GOV-004)", () => {
  it("[conforms_to: GuardName] with effects within ceiling — 0 FUNGI-GOV-004", () => {
    const source = `
guard PaymentGuard {
  permitted_effects {
    gateway.charge,
    audit.write
  }
}

secure flow processPayment(id: String) -> Result<String, String>
contract [conforms_to: PaymentGuard] {
  intent { "Process a payment transaction." }
  effects { gateway.charge, audit.write }
}
{ return Ok(id) }
`;
    const result = parseAndVerify(source);
    const gov004 = result.diagnostics.filter((d) => d.code === "FUNGI-GOV-004");
    assert.equal(
      gov004.length,
      0,
      `Expected 0 FUNGI-GOV-004 errors when effects subset of guard, got: ${gov004.map((e) => e.message).join("; ")}`,
    );
  });

  it("[conforms_to: GuardName] with forbidden effect emits FUNGI-GOV-004", () => {
    const source = `
guard RestrictedGuard {
  permitted_effects {
    database.read
  }
}

secure flow leak(id: String) -> Result<String, String>
contract [conforms_to: RestrictedGuard] {
  intent { "Violates the guard ceiling." }
  effects { database.read, network.outbound }
}
{ return Ok(id) }
`;
    const result = parseAndVerify(source);
    assert.ok(
      hasDiag(result, "FUNGI-GOV-004"),
      `Expected FUNGI-GOV-004 for network.outbound outside guard ceiling, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
    const diag = result.diagnostics.find((d) => d.code === "FUNGI-GOV-004");
    assert.ok(
      diag?.message.includes("network.outbound"),
      `FUNGI-GOV-004 message must mention the violating effect, got: ${diag?.message}`,
    );
  });

  it("contract without conforms_to is not checked — no FUNGI-GOV-004 for any effect", () => {
    const source = `
guard TightGuard {
  permitted_effects {
    database.read
  }
}

secure flow unchecked(id: String) -> Result<String, String>
contract {
  intent { "No conforms_to annotation." }
  effects { network.outbound, storage.write }
}
{ return Ok(id) }
`;
    const result = parseAndVerify(source);
    const gov004 = result.diagnostics.filter((d) => d.code === "FUNGI-GOV-004");
    assert.equal(
      gov004.length,
      0,
      `Expected no FUNGI-GOV-004 for unbound contract (no conforms_to), got: ${gov004.map((e) => e.message).join("; ")}`,
    );
  });
});

// ---------------------------------------------------------------------------
// GOV-001 (ratified 2026-06-16): permitted_effects K3 state machine + strict conforms_to
//   omitted block = 0 neutral (auto-inherit) · empty {} = -1 deny-all · populated = +1 allow-listed
//   unresolvable conforms_to = warning (dev) / fatal error (production · deterministic)
// ---------------------------------------------------------------------------

describe("GOV-001: permitted_effects state machine + strict conforms_to", () => {
  it("OMITTED permitted_effects (limits-only guard) is NEUTRAL — no FUNGI-GOV-004", () => {
    const source = `
guard LimitsOnly {
  enforced_limits {
    max_memory_ceiling: 16MB
  }
}

secure flow worker(id: String) -> Result<String, String>
contract [conforms_to: LimitsOnly] {
  intent { "A limits-only guard makes no claim on effects." }
  effects { database.write, network.outbound }
}
{ return Ok(id) }
`;
    const result = parseAndVerify(source);
    assert.ok(
      !hasDiag(result, "FUNGI-GOV-004"),
      `omitted permitted_effects must be neutral (auto-inherit), got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("EXPLICITLY EMPTY permitted_effects {} is DENY-ALL — every declared effect emits FUNGI-GOV-004", () => {
    const source = `
guard DenyAll {
  permitted_effects {
  }
}

secure flow worker(id: String) -> Result<String, String>
contract [conforms_to: DenyAll] {
  intent { "Empty permitted_effects revokes all effects." }
  effects { database.read }
}
{ return Ok(id) }
`;
    const result = parseAndVerify(source);
    assert.ok(
      hasDiag(result, "FUNGI-GOV-004"),
      `empty permitted_effects {} must deny all effects, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  });

  it("unresolvable conforms_to is a WARNING in dev", () => {
    const source = `
secure flow worker(id: String) -> Result<String, String>
contract [conforms_to: MissingPolicy] {
  intent { "Broken chain — dev profile." }
  effects { database.read }
}
{ return Ok(id) }
`;
    const result = parseAndVerify(source, "dev");
    const d = result.diagnostics.find((x) => x.code === "FUNGI-GOV-004" && x.name === "DOMAIN_GUARD_NOT_FOUND");
    assert.ok(d !== undefined && d.severity === "warning", `dev: expected a warning, got: ${d?.severity}`);
  });

  it("unresolvable conforms_to is a FATAL ERROR in production (fail-closed)", () => {
    const source = `
secure flow worker(id: String) -> Result<String, String>
contract [conforms_to: MissingPolicy] {
  intent { "Broken chain — production profile." }
  effects { database.read }
}
{ return Ok(id) }
`;
    const result = parseAndVerify(source, "production");
    const d = result.diagnostics.find((x) => x.code === "FUNGI-GOV-004" && x.name === "DOMAIN_GUARD_NOT_FOUND");
    assert.ok(d !== undefined && d.severity === "error", `production: expected a fatal error, got: ${d?.severity}`);
  });
});

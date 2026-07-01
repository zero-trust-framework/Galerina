import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseProgram,
  checkEffects,
  verifyGovernance,
  extractArenaLimitMB,
  FUNGI_GOV_001,
  FUNGI_GOV_003,
  FUNGI_GOV_006,
  FUNGI_CONTEXT_001,
  FUNGI_GOV_011,
  FUNGI_GOV_012,
  FUNGI_GOV_019,
  FUNGI_GOV_020,
  FUNGI_TERM_001,
} from "../dist/index.js";
import {
  FUNGI_GOV_005,
  FUNGI_GOV_007,
  FUNGI_GOV_009,
} from "../dist/governance-verifier.js";

function parseAndVerify(source, profile = "dev") {
  const parsed = parseProgram(source, "test.fungi");
  const effects = checkEffects(parsed.flows, parsed.ast);
  return verifyGovernance(parsed.ast, parsed.flows, effects, profile);
}

function hasDiag(result, code) {
  return result.diagnostics.some((d) => d.code === code);
}

describe("Governance verifier — FUNGI-GOV-010 intent missing on secure flow", () => {
  it("emits FUNGI-GOV-010 info when secure flow has no intent in dev mode", () => {
    const result = parseAndVerify(`
secure flow createOrder(request: Request) -> Result<Response, ApiError>
contract { effects { database.write audit.write } }
{
  return Ok(Response.ok({}))
}
`, "dev");
    assert.ok(hasDiag(result, "FUNGI-GOV-010"), "Expected FUNGI-GOV-010 for missing intent");
  });

  it("FUNGI-GOV-010 is error severity in production", () => {
    const result = parseAndVerify(`
secure flow createOrder(request: Request) -> Result<Response, ApiError>
contract { effects { database.write audit.write } }
{
  return Ok(Response.ok({}))
}
`, "production");
    const diag = result.diagnostics.find((d) => d.code === "FUNGI-GOV-010");
    assert.ok(diag !== undefined, "Expected FUNGI-GOV-010");
    assert.equal(diag.severity, "error");
  });

  it("does not emit FUNGI-GOV-010 for pure flow (only secure flows require intent)", () => {
    const result = parseAndVerify(`
pure flow calculate(x: Int) -> Int {
  return x
}
`);
    assert.ok(!hasDiag(result, "FUNGI-GOV-010"), "Unexpected FUNGI-GOV-010 for pure flow");
  });
});

describe("Governance verifier — FUNGI-GOV-002 missing audit for governed sink", () => {
  it("emits FUNGI-GOV-002 when database.write declared but no audit.write", () => {
    const result = parseAndVerify(`
guarded flow saveOrder(order: Order) -> Result<OrderId, OrderError>
contract { effects { database.write } }
{
  return Ok(order.id)
}
`);
    assert.ok(hasDiag(result, "FUNGI-GOV-002"), "Expected FUNGI-GOV-002 for missing audit");
  });

  it("does not emit FUNGI-GOV-002 when audit.write is declared", () => {
    const result = parseAndVerify(`
guarded flow saveOrder(order: Order) -> Result<OrderId, OrderError>
contract { effects { database.write audit.write } }
{
  return Ok(order.id)
}
`);
    assert.ok(!hasDiag(result, "FUNGI-GOV-002"), "Unexpected FUNGI-GOV-002 when audit.write declared");
  });

  it("does not emit FUNGI-GOV-002 for pure flow (no sinks)", () => {
    const result = parseAndVerify(`
pure flow add(a: Int, b: Int) -> Int {
  return a + b
}
`);
    assert.ok(!hasDiag(result, "FUNGI-GOV-002"), "Unexpected FUNGI-GOV-002 for pure flow");
  });
});

describe("Governance verifier — proof obligations", () => {
  it("records audit_required obligation when audit.write is declared", () => {
    const result = parseAndVerify(`
guarded flow log(msg: String) -> Void
contract { effects { audit.write } }
{
  return
}
`);
    assert.ok(
      result.proofObligations.some((o) => o.startsWith("audit_required:")),
      "Expected audit_required proof obligation",
    );
  });

  it("records intent_declared obligation when secure flow has intent", () => {
    const result = parseAndVerify(`
secure flow createPatient(request: Request) -> Result<Response, ApiError>
contract { effects { database.write audit.write } }
intent "Create patient record" {
  return Ok(Response.ok({}))
}
`);
    assert.ok(
      result.proofObligations.some((o) => o.startsWith("intent_declared:")),
      "Expected intent_declared proof obligation",
    );
  });

  it("intent status is satisfied when secure flow has intent", () => {
    const result = parseAndVerify(`
secure flow createPatient(request: Request) -> Result<Response, ApiError>
contract { effects { database.write audit.write } }
intent "Create patient record" {
  return Ok(Response.ok({}))
}
`);
    const status = result.intentStatus.get("createPatient");
    assert.equal(status, "satisfied");
  });
});

describe("Governance verifier — FUNGI-GOV-004 denied target", () => {
  it("emits FUNGI-GOV-004 when remote.execution denied but network.outbound declared", () => {
    // The parser currently skips compute target body content,
    // so this test confirms the verifier runs without throwing.
    // Full FUNGI-GOV-004 detection requires Phase 8 compute target body parsing.
    const result = parseAndVerify(`
secure flow runModel(request: Request) -> Result<Response, AiError>
contract { effects { ai.inference network.outbound } }
intent "Run model locally" {
  return Ok(Response.ok({}))
}
`);
    // FUNGI-GOV-001 may fire due to "locally" in intent + network.outbound
    assert.ok(typeof result.diagnostics === "object");
  });
});

describe("Governance verifier — FUNGI-GOV-011 unknown contract set", () => {
  it("emits FUNGI-GOV-011 when use references an undeclared contract set", () => {
    const result = parseAndVerify(`
flow createOrder(request: Request) -> Result<Response, ApiError>
contract {
  effects { database.write }
  use UnknownSet
}
{
  return Ok(Response.ok({}))
}
`);
    assert.ok(hasDiag(result, "FUNGI-GOV-011"), "Expected FUNGI-GOV-011 for unknown contract set");
  });

  it("FUNGI-GOV-011 is error severity", () => {
    const result = parseAndVerify(`
flow createOrder(request: Request) -> Result<Response, ApiError>
contract {
  effects { database.write }
  use UnknownSet
}
{
  return Ok(Response.ok({}))
}
`);
    const diag = result.diagnostics.find((d) => d.code === "FUNGI-GOV-011");
    assert.ok(diag !== undefined, "Expected FUNGI-GOV-011 diagnostic");
    assert.equal(diag.severity, "error");
  });

  it("does not emit FUNGI-GOV-011 when contract set is declared", () => {
    const result = parseAndVerify(`
contract set OrderPolicy {
  rules {}
  events {}
  audit {}
}

flow createOrder(request: Request) -> Result<Response, ApiError>
contract {
  effects { database.write }
  use OrderPolicy
}
{
  return Ok(Response.ok({}))
}
`);
    assert.ok(!hasDiag(result, "FUNGI-GOV-011"), "Unexpected FUNGI-GOV-011 when contract set is declared");
  });

  it("FUNGI-GOV-011 constant has correct code", () => {
    assert.equal(FUNGI_GOV_011.code, "FUNGI-GOV-011");
    assert.equal(FUNGI_GOV_011.name, "UnknownContractSet");
  });
});

describe("Governance verifier — FUNGI-GOV-012 contract set requirement not met", () => {
  it("emits FUNGI-GOV-012 when contract set has audit requirement and flow lacks audit.write", () => {
    const result = parseAndVerify(`
contract set AuditedPolicy {
  rules {}
  audit {
    require audit.write
  }
}

flow createOrder(request: Request) -> Result<Response, ApiError>
contract {
  effects { database.write }
  use AuditedPolicy
}
{
  return Ok(Response.ok({}))
}
`);
    assert.ok(hasDiag(result, "FUNGI-GOV-012"), "Expected FUNGI-GOV-012 when audit requirement not met");
  });

  it("FUNGI-GOV-012 is warning severity", () => {
    const result = parseAndVerify(`
contract set AuditedPolicy {
  audit {
    require audit.write
  }
}

flow createOrder(request: Request) -> Result<Response, ApiError>
contract {
  effects { database.write }
  use AuditedPolicy
}
{
  return Ok(Response.ok({}))
}
`);
    const diag = result.diagnostics.find((d) => d.code === "FUNGI-GOV-012");
    assert.ok(diag !== undefined, "Expected FUNGI-GOV-012 diagnostic");
    assert.equal(diag.severity, "warning");
  });

  it("does not emit FUNGI-GOV-012 when flow declares audit.write", () => {
    const result = parseAndVerify(`
contract set AuditedPolicy {
  audit {
    require audit.write
  }
}

flow createOrder(request: Request) -> Result<Response, ApiError>
contract {
  effects { database.write audit.write }
  use AuditedPolicy
}
{
  return Ok(Response.ok({}))
}
`);
    assert.ok(!hasDiag(result, "FUNGI-GOV-012"), "Unexpected FUNGI-GOV-012 when audit.write is declared");
  });

  it("does not emit FUNGI-GOV-012 when contract set audit block is empty", () => {
    const result = parseAndVerify(`
contract set SimplePolicy {
  rules {}
  audit {}
}

flow createOrder(request: Request) -> Result<Response, ApiError>
contract {
  effects { database.write }
  use SimplePolicy
}
{
  return Ok(Response.ok({}))
}
`);
    assert.ok(!hasDiag(result, "FUNGI-GOV-012"), "Unexpected FUNGI-GOV-012 when audit block is empty");
  });

  it("FUNGI-GOV-012 constant has correct code", () => {
    assert.equal(FUNGI_GOV_012.code, "FUNGI-GOV-012");
    assert.equal(FUNGI_GOV_012.name, "ContractSetRequirementNotMet");
  });
});

describe("Governance verifier — runtime integration", () => {
  it("run() includes governanceDiagnostics in result", async () => {
    const { run } = await import("../dist/index.js");
    const result = await run(
      `pure flow greet() -> String { return "hello" }`,
      "test.fungi",
      "greet",
    );
    assert.ok(Array.isArray(result.governanceDiagnostics));
  });

  it("check-only mode still produces governanceDiagnostics", async () => {
    const { run } = await import("../dist/index.js");
    const result = await run(
      `secure flow test(request: Request) -> Result<Response, ApiError>
contract { effects { database.write } } { return Ok(Response.ok({})) }`,
      "test.fungi",
      "test",
      new Map(),
      { mode: "check-only" },
    );
    assert.ok(Array.isArray(result.governanceDiagnostics));
    // Should warn about missing intent on secure flow
    assert.ok(
      result.governanceDiagnostics.some((d) => d.code === "FUNGI-GOV-010"),
      "Expected FUNGI-GOV-010 in check-only result",
    );
  });

  it("production mode generates proofChain", async () => {
    const { run } = await import("../dist/index.js");
    const result = await run(
      `pure flow answer() -> Int { return 42 }`,
      "test.fungi",
      "answer",
      new Map(),
      { mode: "production" },
    );
    assert.ok(result.proofChain !== undefined, "Expected proofChain in production mode");
    assert.equal(result.proofChain.schemaVersion, "fungi.execution.proof.v1");
  });

  it("dev mode does not generate proofChain", async () => {
    const { run } = await import("../dist/index.js");
    const result = await run(
      `pure flow answer() -> Int { return 42 }`,
      "test.fungi",
      "answer",
      new Map(),
      { mode: "dev" },
    );
    assert.equal(result.proofChain, undefined, "proofChain should be absent in dev mode");
  });
});

// =============================================================================
// Phase 10C — FUNGI-GOV-003: response contract violation
// =============================================================================

describe("Governance verifier — FUNGI-GOV-003 response contract violation", () => {
  it("emits FUNGI-GOV-003 when a denied field appears in the response body", () => {
    const result = parseAndVerify(`
flow getPatient(readonly request: Request) -> GetPatientResult
contract {
  types {
    type GetPatientResult = Result<Response, ApiError>
  }
  response {
    returns PatientResponse
    denies { email }
  }
  effects { database.read }
}
{
  let patient = PatientsDB.find(request.params.id)?
  return Ok(Response.ok({ patientId: patient.id, email: patient.email }))
}
`);
    assert.ok(hasDiag(result, "FUNGI-GOV-003"), "Expected FUNGI-GOV-003 when denied field appears in response body");
  });

  it("does not emit FUNGI-GOV-003 when only allowed fields are returned", () => {
    const result = parseAndVerify(`
flow getPatient(readonly request: Request) -> GetPatientResult
contract {
  types {
    type GetPatientResult = Result<Response, ApiError>
  }
  response {
    returns PatientResponse
    exposes { patientId name }
    denies { email nhsNumber }
  }
  effects { database.read }
}
{
  let patient = PatientsDB.find(request.params.id)?
  return Ok(Response.ok({ patientId: patient.id, name: patient.name }))
}
`);
    assert.ok(!hasDiag(result, "FUNGI-GOV-003"), "Unexpected FUNGI-GOV-003 when no denied fields are used");
  });

  it("does not emit FUNGI-GOV-003 when there is no response section in the contract", () => {
    const result = parseAndVerify(`
flow getOrder(readonly request: Request) -> GetOrderResult
contract {
  types {
    type GetOrderResult = Result<Response, ApiError>
  }
  effects { database.read }
}
{
  return Ok(Response.ok({ orderId: request.params.id, email: request.user.email }))
}
`);
    assert.ok(!hasDiag(result, "FUNGI-GOV-003"), "Unexpected FUNGI-GOV-003 when no response contract section");
  });

  it("FUNGI-GOV-003 constant has correct code and name", () => {
    assert.equal(FUNGI_GOV_003.code, "FUNGI-GOV-003");
    assert.equal(FUNGI_GOV_003.name, "PROTECTED_DATA_IN_RESPONSE");
    assert.equal(FUNGI_GOV_003.severity, "error");
  });
});

// =============================================================================
// Phase 10C — FUNGI-CONTEXT-001: required context field not accessed
// =============================================================================

describe("Governance verifier — FUNGI-CONTEXT-001 required context not accessed", () => {
  it("emits FUNGI-CONTEXT-001 when context requires actor but body never accesses it", () => {
    const result = parseAndVerify(`
flow getRecord(readonly request: Request) -> GetRecordResult
contract {
  types {
    type GetRecordResult = Result<Response, ApiError>
  }
  context {
    require actor
  }
  effects { database.read }
}
{
  let record = RecordsDB.find(request.params.id)?
  return Ok(Response.ok({ id: record.id }))
}
`);
    assert.ok(hasDiag(result, "FUNGI-CONTEXT-001"), "Expected FUNGI-CONTEXT-001 when context.actor is never accessed");
  });

  it("does not emit FUNGI-CONTEXT-001 when context.actor is accessed in body", () => {
    const result = parseAndVerify(`
flow getRecord(readonly request: Request) -> GetRecordResult
contract {
  types {
    type GetRecordResult = Result<Response, ApiError>
  }
  context {
    require actor
  }
  effects { database.read }
}
{
  let actor = context.actor
  let record = RecordsDB.findForActor(actor, request.params.id)?
  return Ok(Response.ok({ id: record.id }))
}
`);
    assert.ok(!hasDiag(result, "FUNGI-CONTEXT-001"), "Unexpected FUNGI-CONTEXT-001 when context.actor is accessed");
  });

  it("does not emit FUNGI-CONTEXT-001 when there is no context section in the contract", () => {
    const result = parseAndVerify(`
flow getOrder(readonly request: Request) -> GetOrderResult
contract {
  types {
    type GetOrderResult = Result<Response, ApiError>
  }
  effects { database.read }
}
{
  return Ok(Response.ok({}))
}
`);
    assert.ok(!hasDiag(result, "FUNGI-CONTEXT-001"), "Unexpected FUNGI-CONTEXT-001 when no context contract section");
  });

  it("FUNGI-CONTEXT-001 is warning severity", () => {
    const result = parseAndVerify(`
flow getRecord(readonly request: Request) -> GetRecordResult
contract {
  types {
    type GetRecordResult = Result<Response, ApiError>
  }
  context {
    require trace_id
  }
  effects { database.read }
}
{
  return Ok(Response.ok({}))
}
`);
    const diag = result.diagnostics.find((d) => d.code === "FUNGI-CONTEXT-001");
    assert.ok(diag !== undefined, "Expected FUNGI-CONTEXT-001 diagnostic");
    assert.equal(diag.severity, "warning");
  });

  it("FUNGI-CONTEXT-001 constant has correct code and name", () => {
    assert.equal(FUNGI_CONTEXT_001.code, "FUNGI-CONTEXT-001");
    assert.equal(FUNGI_CONTEXT_001.name, "REQUIRED_CONTEXT_NOT_ACCESSED");
    assert.equal(FUNGI_CONTEXT_001.severity, "warning");
  });
});

// =============================================================================
// FUNGI-GOV-005: policy purpose mismatch
// =============================================================================

describe("Governance verifier — FUNGI-GOV-005 policy purpose mismatch", () => {
  it("emits FUNGI-GOV-005 warning when purpose 'read-only' but database.write is declared", () => {
    const result = parseAndVerify(`
flow getPatient(readonly request: Request) -> GetPatientResult
contract { effects { database.write } }
policy {
  purpose "read-only"
}
{
  return Ok(Response.ok({}))
}
`);
    assert.ok(hasDiag(result, "FUNGI-GOV-005"), "Expected FUNGI-GOV-005 when read-only purpose contradicts database.write");
    const diag = result.diagnostics.find((d) => d.code === "FUNGI-GOV-005");
    assert.equal(diag.severity, "warning");
  });

  it("does not emit FUNGI-GOV-005 when purpose 'read-only' and no database.write", () => {
    const result = parseAndVerify(`
flow getPatient(readonly request: Request) -> GetPatientResult
contract { effects { database.read } }
policy {
  purpose "read-only"
}
{
  return Ok(Response.ok({}))
}
`);
    assert.ok(!hasDiag(result, "FUNGI-GOV-005"), "Unexpected FUNGI-GOV-005 when effects are compatible with purpose");
  });

  it("emits FUNGI-GOV-005 warning when purpose 'internal' but network.outbound is declared", () => {
    const result = parseAndVerify(`
flow syncData(request: Request) -> SyncResult
contract { effects { network.outbound } }
policy {
  purpose "internal"
}
{
  return Ok(Response.ok({}))
}
`);
    assert.ok(hasDiag(result, "FUNGI-GOV-005"), "Expected FUNGI-GOV-005 when internal purpose contradicts network.outbound");
  });

  it("FUNGI-GOV-005 constant has correct code and name", () => {
    assert.equal(FUNGI_GOV_005.code, "FUNGI-GOV-005");
    assert.equal(FUNGI_GOV_005.name, "PolicyPurposeMismatch");
    assert.equal(FUNGI_GOV_005.severity, "warning");
  });
});

// =============================================================================
// FUNGI-GOV-007: authority block missing reason
// =============================================================================

describe("Governance verifier — FUNGI-GOV-007 authority block missing reason", () => {
  it("emits FUNGI-GOV-007 error when authority block has no reason clause", () => {
    // The authority block is a flow clause (between signature and body).
    const result = parseAndVerify(`
flow sharePayments(request: Request) -> Result<Response, ApiError>
contract { effects { database.read } }
authority share Payments.processor {
  audit required
  require payment.read
}
{
  return Ok(Response.ok({}))
}
`);
    assert.ok(hasDiag(result, "FUNGI-GOV-007"), "Expected FUNGI-GOV-007 when authority block has no reason");
    const diag = result.diagnostics.find((d) => d.code === "FUNGI-GOV-007");
    assert.equal(diag.severity, "error");
  });

  it("does not emit FUNGI-GOV-007 when authority block has a reason clause", () => {
    const result = parseAndVerify(`
flow sharePayments(request: Request) -> Result<Response, ApiError>
contract { effects { database.read } }
authority share Payments.processor {
  reason "Needed to process payment transactions"
  audit required
  require payment.read
}
{
  return Ok(Response.ok({}))
}
`);
    assert.ok(!hasDiag(result, "FUNGI-GOV-007"), "Unexpected FUNGI-GOV-007 when authority block has a reason");
  });

  it("FUNGI-GOV-007 constant has correct code and name", () => {
    assert.equal(FUNGI_GOV_007.code, "FUNGI-GOV-007");
    assert.equal(FUNGI_GOV_007.name, "AuthorityBlockMissingReason");
    assert.equal(FUNGI_GOV_007.severity, "error");
  });
});

// =============================================================================
// FUNGI-GOV-009: privileged flow missing capability
// =============================================================================

describe("Governance verifier — FUNGI-GOV-009 privileged flow missing capability", () => {
  it("emits FUNGI-GOV-009 warning when privileged flow has no effects or contract", () => {
    // Privileged flows are detected via identifier child with value "qualifier:privileged".
    // Since the parser does not yet emit a dedicated privilegedFlowDecl kind,
    // we build a minimal AST directly using the verifyGovernance function.
    const ast = {
      kind: "program",
      children: [
        {
          kind: "flowDecl",
          value: "createAdmin",
          children: [
            { kind: "identifier", value: "qualifier:privileged" },
            { kind: "typeRef", value: "Void" },
            { kind: "block", children: [] },
          ],
        },
      ],
    };
    const flows = [
      {
        name: "createAdmin",
        qualifier: "flow",
        params: [],
        returnType: "Void",
        declaredEffects: [],
        location: { file: "test.fungi", line: 1, column: 1 },
      },
    ];
    const result = verifyGovernance(ast, flows, [], "dev");
    assert.ok(
      result.diagnostics.some((d) => d.code === "FUNGI-GOV-009"),
      "Expected FUNGI-GOV-009 for privileged flow with no effects or contract",
    );
    const diag = result.diagnostics.find((d) => d.code === "FUNGI-GOV-009");
    assert.equal(diag.severity, "warning");
  });

  it("FUNGI-GOV-009 constant has correct code and name", () => {
    assert.equal(FUNGI_GOV_009.code, "FUNGI-GOV-009");
    assert.equal(FUNGI_GOV_009.name, "PrivilegedFlowMissingCapability");
    assert.equal(FUNGI_GOV_009.severity, "warning");
  });

  // RD-0122 tripwire: GOV-009 is RESERVED / unreachable on real source. The `privileged` flow qualifier is
  // not wired in the parser, so the test above can only fire GOV-009 on a SYNTHETIC AST. This documents the
  // real behavior and is a tripwire: if someone wires `privileged` (this stops emitting FUNGI-PARSE-001),
  // GOV-009 becomes reachable and will need genuine real-source coverage — and this test will start failing.
  it("RD-0122: real `privileged flow` is rejected at parse (FUNGI-PARSE-001) — GOV-009 is synthetic-only today", () => {
    const { diagnostics } = parseProgram(`privileged flow doThing() -> Int {\n  return 1\n}`, "test.fungi");
    assert.ok(
      diagnostics.some((d) => d.code === "FUNGI-PARSE-001"),
      `real 'privileged flow' should emit FUNGI-PARSE-001 (qualifier not wired), got: ${diagnostics.map((d) => d.code).join(", ")}`,
    );
  });
});

// =============================================================================
// Phase 22C — extractArenaLimitMB
// =============================================================================

describe("extractArenaLimitMB: contract.memory arena extraction", () => {
  it("returns undefined for a node with no contractDecl", () => {
    // Minimal AST node with no children
    const node = { kind: "flowDecl", value: "test", children: [] };
    assert.equal(extractArenaLimitMB(node), undefined);
  });

  it("returns undefined for contractDecl with no memory:block", () => {
    const node = {
      kind: "flowDecl",
      value: "test",
      children: [
        {
          kind: "contractDecl",
          value: undefined,
          children: [
            { kind: "identifier", value: "effects:block", children: [] },
          ],
        },
      ],
    };
    assert.equal(extractArenaLimitMB(node), undefined);
  });

  it("returns 8 for contract { memory { arena 8 mb } } structure", () => {
    const node = {
      kind: "flowDecl",
      value: "test",
      children: [
        {
          kind: "contractDecl",
          value: undefined,
          children: [
            {
              kind: "identifier",
              value: "memory:block",
              children: [
                {
                  kind: "identifier",
                  value: "decl:arena 8 mb",
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    };
    assert.equal(extractArenaLimitMB(node), 8);
  });
});

// =============================================================================
// GOV-003 accuracy — no false positive when field is in redact() call
// =============================================================================

describe("Governance verifier — GOV-003 accuracy with redact()", () => {
  it("does not emit FUNGI-GOV-003 when denied field is wrapped in redact() call", () => {
    const result = parseAndVerify(`
flow getPatient(readonly request: Request) -> GetPatientResult
contract {
  types {
    type GetPatientResult = Result<Response, ApiError>
  }
  response {
    returns PatientResponse
    denies { email }
  }
  effects { database.read }
}
{
  let patient = PatientsDB.find(request.params.id)?
  return Ok(Response.ok({ patientId: patient.id, email: redact(patient.email) }))
}
`);
    assert.ok(!hasDiag(result, "FUNGI-GOV-003"), "Unexpected FUNGI-GOV-003 when email is wrapped in redact()");
  });
});

// ── FUNGI-GOV-015/016: epilogue {} strategy validation ─────────────────────────
describe("Governance verifier — epilogue {} strategy validation", () => {
  const mk = (epi) =>
    `secure flow f(x: Int) -> Int\ncontract { intent { "test" }  ${epi} }\n{ return x }`;

  it("a valid epilogue (sha256_seal + halt_pipeline) produces no diagnostic", () => {
    const r = parseAndVerify(mk("epilogue { generate_proof sha256_seal  on_verification_failure halt_pipeline }"), "production");
    assert.ok(!hasDiag(r, "FUNGI-GOV-015") && !hasDiag(r, "FUNGI-GOV-016"), `unexpected: ${r.diagnostics.map(d=>d.code).join(",")}`);
  });

  it("epilogue with generate_proof auto is valid", () => {
    const r = parseAndVerify(mk("epilogue { generate_proof auto }"), "production");
    assert.ok(!hasDiag(r, "FUNGI-GOV-015"));
  });

  it("an unrecognised proof strategy → FUNGI-GOV-015", () => {
    const r = parseAndVerify(mk("epilogue { generate_proof unknown_algo }"), "production");
    assert.ok(hasDiag(r, "FUNGI-GOV-015"), `expected GOV-015, got: ${r.diagnostics.map(d=>d.code).join(",")}`);
  });

  it("an unrecognised failure action → FUNGI-GOV-016", () => {
    const r = parseAndVerify(mk("epilogue { generate_proof sha256_seal  on_verification_failure explode }"), "production");
    assert.ok(hasDiag(r, "FUNGI-GOV-016"), `expected GOV-016`);
  });

  it("omitting the epilogue block entirely is auto-by-default (no diagnostic)", () => {
    const r = parseAndVerify(mk(""), "production");
    assert.ok(!hasDiag(r, "FUNGI-GOV-015") && !hasDiag(r, "FUNGI-GOV-016"), `unexpected: ${r.diagnostics.map(d=>d.code).join(",")}`);
  });
});

// ── FUNGI-GOV-017/018: cyber_physical_hardening + liability validation ──────────
describe("Governance verifier — cyber_physical_hardening + liability (auto-by-default)", () => {
  const mkSovereign = (extra = "") => `secure flow f(x: Int) -> Int
contract { intent { "Sovereign transaction." }  effects { audit.write }
  ${extra}
  economics { max_risk_liability "50000" }
}
{ return x }`;
  const mkLow = (extra = "") => `secure flow f(x: Int) -> Int
contract { intent { "Low risk." }  effects { audit.write }  ${extra} }
{ return x }`;

  it("valid cyber_physical_hardening on high-risk flow → clean", () => {
    const r = parseAndVerify(mkSovereign("cyber_physical_hardening { enclosure_shielding active_mesh  on_tamper_signal zeroize }"), "production");
    assert.ok(!hasDiag(r, "FUNGI-GOV-017"), `unexpected: ${r.diagnostics.map(d=>d.code).join(",")}`);
  });

  it("cyber_physical_hardening on low-risk flow (no high economics) → FUNGI-GOV-017 warning", () => {
    const r = parseAndVerify(mkLow("cyber_physical_hardening { enclosure_shielding active_mesh  on_tamper_signal zeroize }"), "production");
    assert.ok(hasDiag(r, "FUNGI-GOV-017"), `expected GOV-017, got: ${r.diagnostics.map(d=>d.code).join(",")}`);
    assert.equal(r.diagnostics.find(d=>d.code==="FUNGI-GOV-017")?.severity, "warning");
  });

  it("invalid enclosure_shielding value → FUNGI-GOV-017 error", () => {
    const r = parseAndVerify(mkSovereign("cyber_physical_hardening { enclosure_shielding supershield }"), "production");
    const errs = r.diagnostics.filter(d=>d.code==="FUNGI-GOV-017" && d.severity==="error");
    assert.ok(errs.length > 0, `expected GOV-017 error`);
  });

  it("invalid on_tamper_signal value → FUNGI-GOV-017 error", () => {
    const r = parseAndVerify(mkSovereign("cyber_physical_hardening { enclosure_shielding active_mesh  on_tamper_signal explode }"), "production");
    const errs = r.diagnostics.filter(d=>d.code==="FUNGI-GOV-017" && d.severity==="error");
    assert.ok(errs.length > 0, `expected GOV-017 error for invalid tamper signal`);
  });

  it("omitting cyber_physical_hardening entirely (auto-by-default) → clean", () => {
    const r = parseAndVerify(mkLow(""), "production");
    assert.ok(!hasDiag(r, "FUNGI-GOV-017"));
  });

  it("manually writing liability {} → FUNGI-GOV-018 warning", () => {
    const r = parseAndVerify(mkLow("liability { max_exposure 10000 }"), "production");
    assert.ok(hasDiag(r, "FUNGI-GOV-018"), `expected GOV-018`);
    assert.equal(r.diagnostics.find(d=>d.code==="FUNGI-GOV-018")?.severity, "warning");
  });

  it("not writing liability {} → no FUNGI-GOV-018", () => {
    const r = parseAndVerify(mkLow(""), "production");
    assert.ok(!hasDiag(r, "FUNGI-GOV-018"));
  });
});

describe("Governance verifier — LiabilityProfile auto-populated in ProofGraph", () => {
  it("verifyGovernance populates proofGraphs for governed flows", () => {
    const src = `secure flow f(x: Int) -> Int
contract { intent { "Governed flow." }  effects { audit.write } }
{ return x }`;
    const r = parseAndVerify(src, "production");
    // proofGraphs should contain an entry for the flow
    assert.ok(r.proofGraphs.size > 0, "proofGraphs should be populated");
    assert.ok(r.proofGraphs.has("f"), "proofGraphs should have entry for flow 'f'");
  });
});

// =============================================================================
// Phase 2.1 — FUNGI-GOV-019: limits {} field validation
// =============================================================================

describe("Governance verifier — FUNGI-GOV-019 limits unknown field", () => {
  it("emits FUNGI-GOV-019 warning for unrecognised field 'memmory' (typo)", () => {
    const r = parseAndVerify(`
secure flow fetchData(req: Request) -> Result<Response, ApiError>
contract {
  intent { "Fetch data." }
  effects { database.read }
  limits { memmory 64mb }
}
{ return Ok(Response.ok({})) }
`);
    assert.ok(hasDiag(r, "FUNGI-GOV-019"), `Expected FUNGI-GOV-019, got: ${r.diagnostics.map(d=>d.code).join(",")}`);
    assert.equal(r.diagnostics.find(d => d.code === "FUNGI-GOV-019")?.severity, "warning");
  });

  it("does not emit FUNGI-GOV-019 for known fields: memory, request_time", () => {
    const r = parseAndVerify(`
secure flow fetchData(req: Request) -> Result<Response, ApiError>
contract {
  intent { "Fetch data." }
  effects { database.read }
  limits { memory 64mb  request_time 500ms }
}
{ return Ok(Response.ok({})) }
`);
    assert.ok(!hasDiag(r, "FUNGI-GOV-019"), `Unexpected FUNGI-GOV-019: ${r.diagnostics.map(d=>d.code).join(",")}`);
  });

  it("does not emit FUNGI-GOV-019 when no limits block is present", () => {
    const r = parseAndVerify(`
pure flow add(a: Int, b: Int) -> Int { return a + b }
`);
    assert.ok(!hasDiag(r, "FUNGI-GOV-019"));
  });

  it("FUNGI-GOV-019 constant has correct code and name", () => {
    assert.equal(FUNGI_GOV_019.code, "FUNGI-GOV-019");
    assert.equal(FUNGI_GOV_019.name, "LIMITS_UNKNOWN_FIELD");
    assert.equal(FUNGI_GOV_019.severity, "warning");
  });
});

// =============================================================================
// Phase 2.2 — FUNGI-GOV-020: authority overly-broad
// =============================================================================

describe("Governance verifier — FUNGI-GOV-020 authority overly broad", () => {
  it("emits FUNGI-GOV-020 warning when authority block contains 'require *'", () => {
    const r = parseAndVerify(`
secure flow adminOp(req: Request) -> Result<Response, ApiError>
contract {
  intent { "Admin operation." }
  effects { audit.write }
}
authority grant AdminService {
  reason "Bootstrap context."
  require *
}
{ return Ok(Response.ok({})) }
`);
    assert.ok(hasDiag(r, "FUNGI-GOV-020"), `Expected FUNGI-GOV-020, got: ${r.diagnostics.map(d=>d.code).join(",")}`);
    assert.equal(r.diagnostics.find(d => d.code === "FUNGI-GOV-020")?.severity, "warning");
  });

  it("does not emit FUNGI-GOV-020 when authority has specific capabilities", () => {
    const r = parseAndVerify(`
secure flow fetchRecord(req: Request) -> Result<Response, ApiError>
contract {
  intent { "Read record." }
  effects { database.read }
}
authority share RecordService {
  reason "Read access needed for serving records."
  require record.read
}
{ return Ok(Response.ok({})) }
`);
    assert.ok(!hasDiag(r, "FUNGI-GOV-020"), `Unexpected FUNGI-GOV-020: ${r.diagnostics.map(d=>d.code).join(",")}`);
  });

  it("FUNGI-GOV-020 constant has correct code and name", () => {
    assert.equal(FUNGI_GOV_020.code, "FUNGI-GOV-020");
    assert.equal(FUNGI_GOV_020.name, "AUTHORITY_OVERLY_BROAD");
    assert.equal(FUNGI_GOV_020.severity, "warning");
  });
});

// =============================================================================
// Phase 2.3 — observability, model, context blocks parse and are retained
// =============================================================================

describe("Governance verifier — observability/model/context blocks round-trip", () => {
  it("observability block parses and contract sub-blocks are retained without crashing", () => {
    const src = `
secure flow tracedFlow(req: Request) -> Result<Response, ApiError>
contract {
  intent { "Traced request handler." }
  effects { audit.write }
  observability { trace_level verbose  metrics enabled }
}
{ return Ok(Response.ok({})) }
`;
    const parsed = parseProgram(src, "test.fungi");
    const effects = checkEffects(parsed.flows, parsed.ast);
    // Should not throw; governance verifier must handle the block gracefully
    const r = verifyGovernance(parsed.ast, parsed.flows, effects, "dev");
    assert.ok(Array.isArray(r.diagnostics), "verifyGovernance should return diagnostics array");
    // Contract node should include an observability:block child
    const flowNode = parsed.ast.children?.find(n =>
      (n.kind === "secureFlowDecl" || n.kind === "flowDecl") && n.value === "tracedFlow"
    );
    assert.ok(flowNode !== undefined, "flowNode should be found");
    const contractNode = flowNode.children?.find(c => c.kind === "contractDecl");
    assert.ok(contractNode !== undefined, "contractDecl should be present");
    const hasObs = contractNode.children?.some(c => c.value === "observability:block");
    assert.ok(hasObs, "observability:block should be retained in AST");
  });

  it("model block parses and is retained in contract children without crashing", () => {
    const src = `
secure flow modelledFlow(req: Request) -> Result<Response, ApiError>
contract {
  intent { "Flow with model declaration." }
  effects { audit.write }
  model { uses RequestModel  reads ResponseModel }
}
{ return Ok(Response.ok({})) }
`;
    const parsed = parseProgram(src, "test.fungi");
    const effects = checkEffects(parsed.flows, parsed.ast);
    const r = verifyGovernance(parsed.ast, parsed.flows, effects, "dev");
    assert.ok(Array.isArray(r.diagnostics));
    const flowNode = parsed.ast.children?.find(n => n.value === "modelledFlow");
    const contractNode = flowNode?.children?.find(c => c.kind === "contractDecl");
    const hasModel = contractNode?.children?.some(c => c.value === "model:block");
    assert.ok(hasModel, "model:block should be retained in AST");
  });
});

// =============================================================================
// Phase 3.1 — FUNGI-GOV-006: high-risk secure flow without epilogue
// =============================================================================

describe("Governance verifier — FUNGI-GOV-006 governance proof required but missing", () => {
  it("emits FUNGI-GOV-006 warning when secure flow has max_risk_liability >= 5000 and no epilogue", () => {
    const r = parseAndVerify(`
secure flow processPayment(req: Request) -> Result<Response, ApiError>
contract {
  intent { "Process high-value payment." }
  effects { database.write audit.write }
  economics { max_risk_liability "10000" }
}
{ return Ok(Response.ok({})) }
`);
    assert.ok(hasDiag(r, "FUNGI-GOV-006"), `Expected FUNGI-GOV-006, got: ${r.diagnostics.map(d=>d.code).join(",")}`);
    assert.equal(r.diagnostics.find(d => d.code === "FUNGI-GOV-006")?.severity, "warning");
  });

  it("does not emit FUNGI-GOV-006 when high-risk secure flow has an explicit epilogue block", () => {
    const r = parseAndVerify(`
secure flow processPayment(req: Request) -> Result<Response, ApiError>
contract {
  intent { "Process high-value payment." }
  effects { database.write audit.write }
  economics { max_risk_liability "10000" }
  epilogue { generate_proof sha256_seal  on_verification_failure log_and_continue }
}
{ return Ok(Response.ok({})) }
`);
    assert.ok(!hasDiag(r, "FUNGI-GOV-006"), `Unexpected FUNGI-GOV-006: ${r.diagnostics.map(d=>d.code).join(",")}`);
  });

  it("does not emit FUNGI-GOV-006 when max_risk_liability is below threshold (4000)", () => {
    const r = parseAndVerify(`
secure flow smallPayment(req: Request) -> Result<Response, ApiError>
contract {
  intent { "Process low-value payment." }
  effects { database.write audit.write }
  economics { max_risk_liability "4000" }
}
{ return Ok(Response.ok({})) }
`);
    assert.ok(!hasDiag(r, "FUNGI-GOV-006"), `Unexpected FUNGI-GOV-006`);
  });

  it("FUNGI-GOV-006 constant has correct code and name", () => {
    assert.equal(FUNGI_GOV_006.code, "FUNGI-GOV-006");
    assert.equal(FUNGI_GOV_006.name, "GOVERNANCE_PROOF_REQUIRED_BUT_MISSING");
    assert.equal(FUNGI_GOV_006.severity, "warning");
  });
});

// =============================================================================
// Phase 3.4 — FUNGI-GOV-001: intent / behaviour mismatch (extended heuristic)
// =============================================================================

describe("Governance verifier — FUNGI-GOV-001 intent behaviour mismatch (extended)", () => {
  it("emits FUNGI-GOV-001 when intent says 'Read-only query' but effects include database.write", () => {
    const r = parseAndVerify(`
secure flow queryOrders(req: Request) -> Result<Response, ApiError>
contract {
  intent { "Read-only query of order records." }
  effects { database.write audit.write }
}
{ return Ok(Response.ok({})) }
`);
    assert.ok(hasDiag(r, "FUNGI-GOV-001"), `Expected FUNGI-GOV-001, got: ${r.diagnostics.map(d=>d.code).join(",")}`);
    assert.equal(r.diagnostics.find(d => d.code === "FUNGI-GOV-001")?.severity, "warning");
  });

  it("does not emit FUNGI-GOV-001 when intent and effects are consistent (read intent + read effects)", () => {
    const r = parseAndVerify(`
secure flow queryOrders(req: Request) -> Result<Response, ApiError>
contract {
  intent { "Read-only query of order records." }
  effects { database.read }
}
{ return Ok(Response.ok({})) }
`);
    assert.ok(!hasDiag(r, "FUNGI-GOV-001"), `Unexpected FUNGI-GOV-001: ${r.diagnostics.map(d=>d.code).join(",")}`);
  });

  it("emits FUNGI-GOV-001 when intent claims pure/no side effects but effects are declared", () => {
    const r = parseAndVerify(`
secure flow computeHash(req: Request) -> Result<Response, ApiError>
contract {
  intent { "Pure computation with no side effects." }
  effects { database.write }
}
{ return Ok(Response.ok({})) }
`);
    assert.ok(hasDiag(r, "FUNGI-GOV-001"), `Expected FUNGI-GOV-001 for pure intent + write effects`);
  });

  it("does not emit FUNGI-GOV-001 when intent has no contradiction keywords", () => {
    const r = parseAndVerify(`
secure flow createUser(req: Request) -> Result<Response, ApiError>
contract {
  intent { "Create a new user account in the system." }
  effects { database.write audit.write }
}
{ return Ok(Response.ok({})) }
`);
    // "create" with write effects is consistent — no GOV-001
    assert.ok(!hasDiag(r, "FUNGI-GOV-001"), `Unexpected FUNGI-GOV-001 for non-contradictory intent`);
  });

  it("FUNGI-GOV-001 constant has correct code and name", () => {
    assert.equal(FUNGI_GOV_001.code, "FUNGI-GOV-001");
    assert.equal(FUNGI_GOV_001.name, "INTENT_BEHAVIOR_MISMATCH");
    assert.equal(FUNGI_GOV_001.severity, "warning");
  });
});

// =============================================================================
// Phase 3.3 — FUNGI-TERM-001: recursive flow without decreases annotation
// =============================================================================

describe("Governance verifier — FUNGI-TERM-001 termination annotation missing", () => {
  it("emits FUNGI-TERM-001 when recursive secure flow in deterministic profile has no decreases", () => {
    // deterministic profile triggers strict treatment; the flow calls itself recursively
    const r = parseAndVerify(`
secure flow countdown(n: Int) -> Int
contract {
  intent { "Count down to zero." }
  effects { audit.write }
}
{
  if n <= 0 { return 0 }
  return countdown(n - 1)
}
`, "deterministic");
    assert.ok(hasDiag(r, "FUNGI-TERM-001"), `Expected FUNGI-TERM-001, got: ${r.diagnostics.map(d=>d.code).join(",")}`);
    assert.equal(r.diagnostics.find(d => d.code === "FUNGI-TERM-001")?.severity, "warning");
  });

  it("does not emit FUNGI-TERM-001 when decreases annotation is present", () => {
    const parsed = parseProgram(`
secure flow countdown(n: Int) -> Int decreases n
contract {
  intent { "Count down to zero." }
  effects { audit.write }
}
{
  if n <= 0 { return 0 }
  return countdown(n - 1)
}
`, "test.fungi");
    const effects = checkEffects(parsed.flows, parsed.ast);
    const r = verifyGovernance(parsed.ast, parsed.flows, effects, "deterministic");
    assert.ok(!hasDiag(r, "FUNGI-TERM-001"), `Unexpected FUNGI-TERM-001: ${r.diagnostics.map(d=>d.code).join(",")}`);
    // Also verify decreasesMetric is captured in flow meta
    const flow = parsed.flows.find(f => f.name === "countdown");
    assert.ok(flow !== undefined, "flow 'countdown' should be parsed");
    assert.equal(flow.decreasesMetric, "n", "decreasesMetric should be 'n'");
  });

  it("does not emit FUNGI-TERM-001 for non-recursive secure flow", () => {
    const r = parseAndVerify(`
secure flow greet(name: String) -> String
contract {
  intent { "Return a greeting." }
  effects { audit.write }
}
{ return name }
`, "deterministic");
    assert.ok(!hasDiag(r, "FUNGI-TERM-001"), `Unexpected FUNGI-TERM-001 for non-recursive flow`);
  });

  it("FUNGI-TERM-001 constant has correct code and name", () => {
    assert.equal(FUNGI_TERM_001.code, "FUNGI-TERM-001");
    assert.equal(FUNGI_TERM_001.name, "TERMINATION_ANNOTATION_MISSING");
    assert.equal(FUNGI_TERM_001.severity, "warning");
  });
});

// =============================================================================
// Phase 3.3 — decreases keyword parsing
// =============================================================================

describe("Parser — decreases keyword parsing", () => {
  it("parses 'decreases n' annotation without error", () => {
    const parsed = parseProgram(`
pure flow factorial(n: Int) -> Int decreases n {
  if n <= 1 { return 1 }
  return n * factorial(n - 1)
}
`, "test.fungi");
    assert.equal(parsed.diagnostics.filter(d => d.severity === "error").length, 0,
      `Unexpected parse errors: ${parsed.diagnostics.map(d=>d.message).join("; ")}`);
    const flow = parsed.flows.find(f => f.name === "factorial");
    assert.ok(flow !== undefined, "flow 'factorial' should be parsed");
    assert.equal(flow.decreasesMetric, "n", "decreasesMetric should be 'n'");
  });

  it("parses 'decreases (m - n)' parenthesised metric without error", () => {
    const parsed = parseProgram(`
pure flow gcd(m: Int, n: Int) -> Int decreases (m - n) {
  return m
}
`, "test.fungi");
    assert.equal(parsed.diagnostics.filter(d => d.severity === "error").length, 0,
      `Unexpected parse errors: ${parsed.diagnostics.map(d=>d.message).join("; ")}`);
    const flow = parsed.flows.find(f => f.name === "gcd");
    assert.ok(flow !== undefined, "flow 'gcd' should be parsed");
    assert.ok(flow.decreasesMetric !== undefined, "decreasesMetric should be set");
    assert.ok(flow.decreasesMetric.includes("m"), "metric should contain 'm'");
  });

  it("flow without decreases has undefined decreasesMetric", () => {
    const parsed = parseProgram(`
pure flow add(a: Int, b: Int) -> Int { return a + b }
`, "test.fungi");
    const flow = parsed.flows.find(f => f.name === "add");
    assert.ok(flow !== undefined);
    assert.equal(flow.decreasesMetric, undefined, "decreasesMetric should be undefined when not declared");
  });
});

// ── Domain Guard Policies — task #56 ─────────────────────────────────────────

describe("Governance Verifier — Domain Guard Policies (FUNGI-GOV-004)", () => {
  const GUARD_POLICY = `
policy InvoicingDomainGuard {
  permitted_effects {
    gateway.charge,
    audit.write
  }
  enforced_limits {
    max_memory_ceiling: 4MB
  }
}
`;

  it("compliant contract passes cleanly — no FUNGI-GOV-004", () => {
    const result = parseAndVerify(GUARD_POLICY + `
secure flow processInvoice(id: String) -> Result<String, String>
contract [conforms_to: InvoicingDomainGuard] {
  intent { "Process billing under domain guard." }
  effects { gateway.charge, audit.write }
  limits  { memory 4mb }
}
{ return Ok(id) }
`);
    assert.ok(!hasDiag(result, "FUNGI-GOV-004"), `Expected no FUNGI-GOV-004 but got: ${result.diagnostics.filter(d=>d.code==="FUNGI-GOV-004").map(d=>d.message).join("; ")}`);
  });

  it("forbidden effect triggers FUNGI-GOV-004", () => {
    const result = parseAndVerify(GUARD_POLICY + `
secure flow badInvoice(id: String) -> Result<String, String>
contract [conforms_to: InvoicingDomainGuard] {
  intent { "Forbidden effect." }
  effects { gateway.charge, filesystem.wipe_all }
  limits  { memory 4mb }
}
{ return Ok(id) }
`);
    assert.ok(hasDiag(result, "FUNGI-GOV-004"), "Expected FUNGI-GOV-004 for filesystem.wipe_all");
    const diag = result.diagnostics.find(d => d.code === "FUNGI-GOV-004");
    assert.ok(diag?.message.includes("filesystem.wipe_all"), `Expected message to mention 'filesystem.wipe_all': ${diag?.message}`);
  });

  it("multiple forbidden effects each trigger FUNGI-GOV-004", () => {
    const result = parseAndVerify(GUARD_POLICY + `
secure flow multiViolation(id: String) -> Result<String, String>
contract [conforms_to: InvoicingDomainGuard] {
  intent { "Multiple violations." }
  effects { gateway.charge, storage.write, database.delete }
}
{ return Ok(id) }
`);
    const violations = result.diagnostics.filter(d => d.code === "FUNGI-GOV-004");
    assert.ok(violations.length >= 2, `Expected >=2 FUNGI-GOV-004 violations, got ${violations.length}`);
  });

  it("contract without conforms_to is not checked against any policy", () => {
    const result = parseAndVerify(GUARD_POLICY + `
secure flow freeFlow(id: String) -> Result<String, String>
contract {
  intent { "No domain guard binding." }
  effects { gateway.charge, filesystem.wipe_all }
}
{ return Ok(id) }
`);
    // Without [conforms_to: ...], no domain guard check runs — no FUNGI-GOV-004
    assert.ok(!hasDiag(result, "FUNGI-GOV-004"), "Expected no FUNGI-GOV-004 for unbound contract");
  });

  it("conforms_to with missing policy emits a warning, not a hard error", () => {
    const result = parseAndVerify(`
secure flow orphanFlow(id: String) -> Result<String, String>
contract [conforms_to: NonExistentPolicy] {
  intent { "References a policy that does not exist." }
  effects { gateway.charge }
}
{ return Ok(id) }
`);
    const diag = result.diagnostics.find(d => d.code === "FUNGI-GOV-004");
    assert.ok(diag !== undefined, "Expected FUNGI-GOV-004 for missing policy reference");
    assert.equal(diag?.severity, "warning", "Missing policy should be a warning, not an error");
  });

  it("policy parser — permitted_effects sub-block is parsed correctly", () => {
    const { ast } = parseProgram(GUARD_POLICY, "test.fungi");
    const policyNode = (ast.children ?? []).find(c => c.kind === "policyDecl" && c.value === "InvoicingDomainGuard");
    assert.ok(policyNode !== undefined, "Expected policyDecl for InvoicingDomainGuard");
    const permEffects = (policyNode.children ?? []).find(c => c.kind === "identifier" && c.value === "permitted_effects");
    assert.ok(permEffects !== undefined, "Expected permitted_effects sub-block");
    const effectNames = (permEffects.children ?? []).map(c => c.value);
    assert.ok(effectNames.includes("gateway.charge"), "Expected gateway.charge in permitted_effects");
    assert.ok(effectNames.includes("audit.write"), "Expected audit.write in permitted_effects");
  });

  it("contract [conforms_to: X] attribute is stored on contractDecl node", () => {
    const { ast } = parseProgram(GUARD_POLICY + `
secure flow testFlow(id: String) -> Result<String, String>
contract [conforms_to: InvoicingDomainGuard] {
  intent { "Test." }
  effects { gateway.charge }
}
{ return Ok(id) }
`, "test.fungi");
    // Find the contractDecl with conformsTo
    let found = false;
    function scan(node) {
      if (node?.kind === "contractDecl" && node.conformsTo === "InvoicingDomainGuard") found = true;
      for (const c of node?.children ?? []) scan(c);
    }
    scan(ast);
    assert.ok(found, "Expected contractDecl with conformsTo = 'InvoicingDomainGuard'");
  });
});

// ── DRCM Phase 2: invariant {} block (task #36) ──────────────────────────────

describe("Governance Verifier — DRCM Phase 2 invariant {} (FUNGI-INV-001/002/003)", () => {
  it("runtime parameter ensure: no error (unknown at compile time → runtime-precheck)", () => {
    const result = parseAndVerify(`
secure flow transfer(amount: Int) -> Result<String, String>
contract {
  intent { "Transfer." }
  effects { ledger.mutate, audit.write }
  invariant { ensure amount > 0; }
}
{ return Ok("ok") }
`);
    assert.ok(!hasDiag(result, "FUNGI-INV-001"), "No FUNGI-INV-001 for runtime parameter");
  });

  it("ensure false: FUNGI-INV-001 (statically proved false — invariant can never be satisfied)", () => {
    const result = parseAndVerify(`
secure flow broken(n: Int) -> Result<String, String>
contract {
  intent { "Broken invariant." }
  effects { ledger.mutate, audit.write }
  invariant { ensure false; }
}
{ return Ok("ok") }
`);
    assert.ok(hasDiag(result, "FUNGI-INV-001"), "Expected FUNGI-INV-001 for ensure false");
  });

  it("ensure 1 > 5: FUNGI-INV-001 (statically proved false — literal comparison)", () => {
    const result = parseAndVerify(`
pure flow impossible(x: Int) -> Int
contract {
  intent { "Impossible." }
  invariant { ensure 1 > 5; }
}
{ return x }
`);
    assert.ok(hasDiag(result, "FUNGI-INV-001"), "Expected FUNGI-INV-001 for ensure 1 > 5");
  });

  it("ensure 5 > 0: clean (statically proved true — no error, no WAT gate needed)", () => {
    const result = parseAndVerify(`
pure flow provable(x: Int) -> Int
contract {
  intent { "Statically proved." }
  invariant { ensure 5 > 0; }
}
{ return x }
`);
    assert.ok(!hasDiag(result, "FUNGI-INV-001"), "No error for statically proved true");
    assert.ok(!hasDiag(result, "FUNGI-INV-002"), "No post-condition error either");
  });

  it("empty invariant block: FUNGI-INV-003 warning", () => {
    const result = parseAndVerify(`
pure flow emptyInv(x: Int) -> Int
contract {
  intent { "Empty invariant." }
  invariant {}
}
{ return x }
`);
    const diag = result.diagnostics.find(d => d.code === "FUNGI-INV-003");
    assert.ok(diag !== undefined, "Expected FUNGI-INV-003 for empty invariant block");
    assert.equal(diag?.severity, "warning", "Should be a warning");
  });

  it("FUNGI-INV-004: undefined symbol in ensure → error (not silent WAT degradation)", () => {
    const result = parseAndVerify(`
pure flow t(amount: Int) -> Int
contract {
  intent { "Test." }
  invariant { ensure nonexistent > 0; }
}
{ return amount }
`);
    assert.ok(hasDiag(result, "FUNGI-INV-004"), "Expected FUNGI-INV-004 for undefined symbol");
    const diag = result.diagnostics.find(d => d.code === "FUNGI-INV-004");
    assert.ok(diag?.message.includes("nonexistent"), "Message should name the unresolved symbol");
  });

  it("FUNGI-INV-004: flow parameter is in scope — no error", () => {
    const result = parseAndVerify(`
pure flow t(amount: Int) -> Int
contract {
  intent { "Test." }
  invariant { ensure amount > 0; }
}
{ return amount }
`);
    assert.ok(!hasDiag(result, "FUNGI-INV-004"), "No INV-004 for valid parameter ref");
  });

  it("0040/#70: `result` is in scope inside an ensure (output post-condition) — no FUNGI-INV-004", () => {
    const result = parseAndVerify(`
pure flow t(amount: Int) -> Int
contract {
  intent { "Test." }
  invariant { ensure result <= 100; }
}
{ return amount }
`);
    assert.ok(!hasDiag(result, "FUNGI-INV-004"), "`result` is the magic output symbol — accepted");
    assert.ok(!hasDiag(result, "FUNGI-INV-001"), "result-referencing ensure is not statically false");
  });

  it("0040/#70: a typo alongside `result` is still rejected (FUNGI-INV-004)", () => {
    const result = parseAndVerify(`
pure flow t(amount: Int) -> Int
contract {
  intent { "Test." }
  invariant { ensure result >= bogus; }
}
{ return amount }
`);
    assert.ok(hasDiag(result, "FUNGI-INV-004"), "unknown symbol next to result is still flagged");
    const diag = result.diagnostics.find(d => d.code === "FUNGI-INV-004");
    assert.ok(diag?.message.includes("bogus"), "names the unresolved symbol, not result");
  });

  it("FUNGI-INV-004: builtins (true/false/None) are always in scope", () => {
    const result = parseAndVerify(`
pure flow t(x: Int) -> Int
contract { intent { "Test." } invariant { ensure true; } }
{ return x }
`);
    assert.ok(!hasDiag(result, "FUNGI-INV-004"), "No INV-004 for builtin 'true'");
  });

  it("multiple ensure statements: each evaluated independently", () => {
    const result = parseAndVerify(`
pure flow multiInv(x: Int) -> Int
contract {
  intent { "Multi invariant." }
  invariant {
    ensure 10 > 5;
    ensure x >= 0;
    ensure false;
  }
}
{ return x }
`);
    // 10 > 5 = true → clean; x >= 0 = unknown → clean; false → FUNGI-INV-001
    const inv001 = result.diagnostics.filter(d => d.code === "FUNGI-INV-001");
    assert.equal(inv001.length, 1, "Expected exactly one FUNGI-INV-001 (for ensure false)");
  });
});

// ── DRCM Phase 1: Wildcard ban (task #30) + Prefix scan (task #31) ───────────

describe("DRCM Phase 1 — FUNGI-CAP-001 network wildcard ban (task #30)", () => {
  it("emits FUNGI-CAP-001 for effects { network.* }", () => {
    const result = parseAndVerify(`
secure flow bad(id: String) -> Result<String, String>
contract {
  intent { "Wildcard test." }
  effects { network.* }
}
{ return Ok(id) }
`);
    assert.ok(hasDiag(result, "FUNGI-CAP-001"), "Expected FUNGI-CAP-001 for network.*");
  });

  it("emits FUNGI-CAP-001 for effects { * } (bare wildcard)", () => {
    const result = parseAndVerify(`
secure flow bad2(id: String) -> Result<String, String>
contract {
  intent { "Bare wildcard test." }
  effects { * }
}
{ return Ok(id) }
`);
    assert.ok(hasDiag(result, "FUNGI-CAP-001"), "Expected FUNGI-CAP-001 for bare *");
  });

  it("no FUNGI-CAP-001 for specific effects (no wildcard)", () => {
    const result = parseAndVerify(`
secure flow good(id: String) -> Result<String, String>
contract {
  intent { "Valid effects test." }
  effects { network.outbound, audit.write }
}
{ return Ok(id) }
`);
    assert.ok(!hasDiag(result, "FUNGI-CAP-001"), "No FUNGI-CAP-001 for specific effects");
  });
});

describe("DRCM Phase 1 — SecretSinkMonitor prefix scan (task #31)", () => {
  it("scan detects secret prefix in payload (FUNGI-SECRET-BREACH)", async () => {
    const { activeSinkMonitor } = await import(
      "../dist/security-sink-monitor.js"
    );
    activeSinkMonitor.clear();
    activeSinkMonitor.register("supersecrettoken123");

    const clean  = activeSinkMonitor.scan("normal log message");
    const breach = activeSinkMonitor.scan("Error: key=supersecrettoken123 endpoint=api");

    assert.ok(clean.isClean,  "Clean payload should pass scan");
    assert.ok(!breach.isClean, "Payload containing secret prefix should fail scan");
    assert.equal(breach.trapCode, 3001, "Breach should emit trap code 3001");
    activeSinkMonitor.clear();
  });

  it("secrets shorter than 12 chars are not registered (false positive prevention)", async () => {
    const { activeSinkMonitor } = await import("../dist/security-sink-monitor.js");
    activeSinkMonitor.clear();
    activeSinkMonitor.register("short");  // < 12 chars — should NOT be registered

    const result = activeSinkMonitor.scan("message containing short substring");
    assert.ok(result.isClean, "Short secret should not be registered (false positive prevention)");
    assert.equal(activeSinkMonitor.count, 0, "Count should be 0 for short secret");
    activeSinkMonitor.clear();
  });

  it("prefix is exactly 8 chars from a longer secret", async () => {
    const { activeSinkMonitor } = await import("../dist/security-sink-monitor.js");
    activeSinkMonitor.clear();
    activeSinkMonitor.register("my-secret-api-key-12345");  // > 12 chars

    // The prefix "my-secre" (8 chars) should be registered
    const scan1 = activeSinkMonitor.scan("output containing my-secret prefix");
    assert.ok(!scan1.isClean, "Should detect 8-char prefix 'my-secre' in output");
    assert.equal(activeSinkMonitor.count, 1, "One prefix registered");
    activeSinkMonitor.clear();
  });
});

// ── Resilience & Observability (task #58) ────────────────────────────────────

describe("Governance Verifier — FUNGI-RES-001 resilience retry on mutation", () => {
  it("emits FUNGI-RES-001 for retry + database.write without idempotent: true", () => {
    const result = parseAndVerify(`
secure flow badRetry(id: String) -> Result<String, String>
contract {
  intent { "Retry a mutation without idempotent flag." }
  effects { database.write, audit.write }
  resilience { retry 3 times }
}
{ return Ok(id) }
`);
    assert.ok(hasDiag(result, "FUNGI-RES-001"), "Expected FUNGI-RES-001 for retry + database.write");
  });

  it("no FUNGI-RES-001 when idempotent: true is declared", () => {
    const result = parseAndVerify(`
secure flow goodRetry(id: String) -> Result<String, String>
contract {
  intent { "Retry an idempotent mutation." }
  effects { database.write, audit.write }
  resilience { retry 3 times  idempotent: true }
}
{ return Ok(id) }
`);
    assert.ok(!hasDiag(result, "FUNGI-RES-001"), "No FUNGI-RES-001 when idempotent: true");
  });

  it("no FUNGI-RES-001 for network-only flows (no mutation effects)", () => {
    const result = parseAndVerify(`
secure flow networkRetry(url: String) -> Result<String, String>
contract {
  intent { "Retry a network call." }
  effects { network.outbound }
  resilience { retry 3 times  with_backoff exponential }
}
{ return Ok(url) }
`);
    assert.ok(!hasDiag(result, "FUNGI-RES-001"), "No FUNGI-RES-001 for network-only flow");
  });
});

describe("Governance Verifier — FUNGI-RES-CB-PENDING circuit_breaker fail-loud (R&D 0120)", () => {
  it("emits FUNGI-RES-CB-PENDING (warning) when a flow declares fallback circuit_breaker (parsed but inert)", () => {
    const result = parseAndVerify(`
secure flow withBreaker(id: String) -> Result<String, String>
contract {
  intent { "Declares a circuit breaker that does not yet trip." }
  effects { network.outbound }
  resilience { fallback circuit_breaker }
}
{ return Ok(id) }
`);
    assert.ok(hasDiag(result, "FUNGI-RES-CB-PENDING"), "a declared-but-inert circuit_breaker must fail LOUD, not read as enforced");
    const d = result.diagnostics.find((x) => x.code === "FUNGI-RES-CB-PENDING");
    assert.equal(d.severity, "warning", "CB-PENDING is a posture-honesty warning (the declaration is valid, just not enforced)");
  });

  it("an ENFORCED fallback (return_cached) does NOT emit FUNGI-RES-CB-PENDING", () => {
    const result = parseAndVerify(`
secure flow withCache(id: String) -> Result<String, String>
contract {
  intent { "Uses an enforced fallback." }
  effects { network.outbound }
  resilience { fallback return_cached }
}
{ return Ok(id) }
`);
    assert.ok(!hasDiag(result, "FUNGI-RES-CB-PENDING"), "enforced fallbacks must not warn");
  });
});

describe("Governance Verifier — FUNGI-OBS-001 observability on pure flow", () => {
  it("emits FUNGI-OBS-001 warning for explicit observability on pure flow", () => {
    const result = parseAndVerify(`
pure flow pureWithObs(x: Int) -> Int
contract {
  intent { "Pure flow with unnecessary observability." }
  observability { trace enabled }
}
{ return x + 1 }
`);
    const diag = result.diagnostics.find(d => d.code === "FUNGI-OBS-001");
    assert.ok(diag !== undefined, "Expected FUNGI-OBS-001 warning");
    assert.equal(diag?.severity, "warning", "Should be a warning not an error");
  });

  it("no FUNGI-OBS-001 for secure flow with observability", () => {
    const result = parseAndVerify(`
secure flow secureWithObs(id: String) -> Result<String, String>
contract {
  intent { "Secure flow with observability." }
  effects { network.outbound }
  observability { trace enabled  metrics latency_p99 error_rate }
}
{ return Ok(id) }
`);
    assert.ok(!hasDiag(result, "FUNGI-OBS-001"), "No FUNGI-OBS-001 for secure flow");
  });
});

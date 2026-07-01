import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseProgram, checkEffects, checkFlowEffects, effectResultsToDiagnostics } from "../dist/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseAndCheck(source) {
  const parsed = parseProgram(source, "test.fungi");
  const effectResults = checkEffects(parsed.flows, parsed.ast ?? { kind: "program" });
  const allDiagnostics = [
    ...parsed.diagnostics,
    ...effectResultsToDiagnostics(effectResults),
  ];
  return { parsed, effectResults, allDiagnostics };
}

function effectErrors(results) {
  return results.flatMap((r) => r.diagnostics.filter((d) => d.severity === "error"));
}

function effectWarnings(results) {
  return results.flatMap((r) => r.diagnostics.filter((d) => d.severity === "warning"));
}

function hasEffectDiag(results, code) {
  return results.flatMap((r) => r.diagnostics).some((d) => d.code === code);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Effect Checker — pure flow rules", () => {
  it("accepts a pure flow with no effects", () => {
    const { effectResults } = parseAndCheck(`
pure flow calculateVat(amount: Money<GBP>) -> Money<GBP> {
  let vat: Money<GBP> = amount
  return vat
}
`);
    assert.equal(effectErrors(effectResults).length, 0);
  });

  it("emits FUNGI-EFFECT-003 when pure flow declares effects", () => {
    const { effectResults } = parseAndCheck(`
pure flow badFlow(x: Int) -> Int
effects [database.read] {
  return x
}
`);
    const errors = effectErrors(effectResults);
    assert.ok(errors.length > 0, "Expected FUNGI-EFFECT-003 error");
    assert.ok(errors.some((d) => d.code === "FUNGI-EFFECT-003"));
  });

  it("includes a suggested fix for pure flow with effects", () => {
    const { effectResults } = parseAndCheck(`
pure flow bad(x: Int) -> Int
effects [database.write] {
  return x
}
`);
    const err = effectResults.flatMap((r) => r.diagnostics).find((d) => d.code === "FUNGI-EFFECT-003");
    assert.ok(err?.suggestedFix !== undefined, "Expected suggestedFix on FUNGI-EFFECT-003");
  });
});

describe("Effect Checker — secure flow rules", () => {
  it("accepts a secure flow with correctly declared effects", () => {
    const { effectResults } = parseAndCheck(`
secure flow getOrder(request: GetOrderRequest) -> Result<Order, Error>
effects [database.read, audit.write] {
  return Ok(order)
}
`);
    assert.equal(effectErrors(effectResults).length, 0);
  });

  it("returns metadata for each flow", () => {
    const { effectResults } = parseAndCheck(`
secure flow saveForm(request: FormRequest) -> Result<FormResponse, Error>
effects [database.write, audit.write] {
  return Ok(response)
}
`);
    assert.equal(effectResults.length, 1);
    assert.equal(effectResults[0]?.flowName, "saveForm");
    assert.equal(effectResults[0]?.qualifier, "secure");
    assert.deepEqual(effectResults[0]?.declaredEffects, ["database.write", "audit.write"]);
  });

  it("reports no errors for empty secure flow body", () => {
    const { effectResults } = parseAndCheck(`
secure flow emptyFlow(request: Request) -> Result<Response, Error>
effects [database.read] {
  return Ok(response)
}
`);
    assert.equal(effectErrors(effectResults).length, 0);
  });
});

describe("Effect Checker — plain flow rules", () => {
  it("accepts a plain flow with no effects", () => {
    const { effectResults } = parseAndCheck(`
flow add(a: Int, b: Int) -> Int {
  return a
}
`);
    assert.equal(effectErrors(effectResults).length, 0);
  });

  it("warns when plain flow declares privileged effect", () => {
    const { effectResults } = parseAndCheck(`
flow chargeCustomer(payment: PaymentRequest) -> Result<Receipt, Error>
effects [payment.charge] {
  return Ok(receipt)
}
`);
    const warnings = effectWarnings(effectResults);
    assert.ok(warnings.some((d) => d.code === "FUNGI-EFFECT-001"),
      "Expected FUNGI-EFFECT-001 warning for privileged effect on plain flow");
  });

  // ── FO-DISPATCH-MISSING-CASE regression (galerina-fail-open-taxonomy.md) ────────
  // A plain `flow` is governed ("defaults to governed behavior", intent-safety-effects.md:43),
  // so its contract MUST honour declared effects exactly like guarded/secure. The undeclared-
  // effect pass previously enumerated only secure/guarded, so a plain flow performing an
  // undeclared effect on a user-named receiver (OrdersDB.find → database.read — neither a
  // secure-tier nor a registered stdlib effect) emitted ZERO diagnostics and signed a manifest
  // attesting effects [none]. These tests pin the closed hole.
  it("emits FUNGI-EFFECT-001 for a plain flow with an undeclared database.read", () => {
    const { effectResults } = parseAndCheck(`
flow loadOrder(order: Order) -> Result<Order, OrderError>
  contract { effects {  } }
{
  return Ok(OrdersDB.find(order.id)?)
}
`);
    assert.ok(
      hasEffectDiag(effectResults, "FUNGI-EFFECT-001"),
      "Expected FUNGI-EFFECT-001: plain flow performs undeclared database.read (OrdersDB.find)",
    );
  });

  it("accepts a plain flow when the database.read effect is correctly declared", () => {
    const { effectResults } = parseAndCheck(`
flow loadOrder(order: Order) -> Result<Order, OrderError>
  contract { effects { database.read } }
{
  return Ok(OrdersDB.find(order.id)?)
}
`);
    assert.equal(
      effectErrors(effectResults).length, 0,
      "A plain flow that declares database.read for its OrdersDB.find must pass cleanly",
    );
  });

  it("emits FUNGI-EFFECT-002 for a plain flow fn helper with an undeclared effect", () => {
    const { effectResults } = parseAndCheck(`
flow processOrder(order: Order) -> Result<Unit, Error>
  contract { effects {  } }
{
  fn save(o: Order) -> Result<Unit, Error> {
    let _ = OrdersDB.insert(o)?
    return Ok(unit)
  }
  return save(order)
}
`);
    assert.ok(
      hasEffectDiag(effectResults, "FUNGI-EFFECT-002"),
      "Expected FUNGI-EFFECT-002: plain flow fn helper uses database.write not declared on the parent",
    );
  });
});

// ── FO-DISPATCH-MISSING-CASE: the undeclared-effect pass must enumerate EVERY effectful
// flow kind. This is the meta-test for the class: dropping any non-pure qualifier from the
// EFFECT-001 gate (as `flow` once was) makes it go RED. `pure` is intentionally excluded —
// pure + an effect is a stricter EFFECT-003 boundary error, not EFFECT-001.
describe("Effect checker — EFFECT-001 covers every effectful flow kind", () => {
  // The canonical non-pure flow kinds. Mirrors FlowMeta.qualifier minus "pure".
  const EFFECTFUL_FLOW_KINDS = ["flow", "guarded", "secure"];

  for (const kind of EFFECTFUL_FLOW_KINDS) {
    it(`${kind} flow with an undeclared effect emits FUNGI-EFFECT-001`, () => {
      const { effectResults } = parseAndCheck(`
${kind} flow loadOrder(order: Order) -> Result<Order, OrderError>
  contract { effects {  } }
{
  return Ok(OrdersDB.find(order.id)?)
}
`);
      assert.ok(
        hasEffectDiag(effectResults, "FUNGI-EFFECT-001"),
        `Expected FUNGI-EFFECT-001 for an undeclared effect on a "${kind}" flow — the undeclared-effect pass must not skip any effectful flow kind`,
      );
    });
  }
});

describe("Effect Checker — effectResultsToDiagnostics", () => {
  it("converts effect results to flat diagnostic array", () => {
    const { effectResults } = parseAndCheck(`
pure flow bad(x: Int) -> Int
effects [database.write] {
  return x
}
`);
    const diags = effectResultsToDiagnostics(effectResults);
    assert.ok(Array.isArray(diags));
    assert.ok(diags.length > 0);
    assert.ok(diags.every((d) => typeof d.code === "string"));
    assert.ok(diags.every((d) => typeof d.message === "string"));
  });

  it("returns empty array when no effects violations", () => {
    const { effectResults } = parseAndCheck(`
pure flow calculate(amount: Int) -> Int {
  return amount
}
`);
    const diags = effectResultsToDiagnostics(effectResults);
    assert.equal(diags.length, 0);
  });
});

describe("Effect Checker — multiple flows", () => {
  it("checks each flow independently", () => {
    const { effectResults } = parseAndCheck(`
pure flow goodFlow(x: Int) -> Int {
  return x
}

pure flow badFlow(x: Int) -> Int
effects [database.read] {
  return x
}
`);
    assert.equal(effectResults.length, 2);
    assert.equal(effectErrors([effectResults[0]]).length, 0);
    assert.ok(effectErrors([effectResults[1]]).length > 0);
  });
});

// intentional: guarded flow uses "with effects [...]" as its canonical inline declaration syntax
describe("Effect checker - guarded flow", () => {
  it("accepts guarded flow with declared effects", () => {
    const { effectResults } = parseAndCheck(`
guarded flow saveOrder(order: Order) -> Result<OrderId, OrderError>
  contract { effects { database.write } }
{
  let orderId = OrdersDB.insert(order)?
  return Ok(orderId)
}
`);
    assert.equal(effectErrors(effectResults).length, 0);
  });

  it("emits FUNGI-EFFECT-001 for guarded flow missing a declared effect", () => {
    const { effectResults } = parseAndCheck(`
guarded flow saveOrder(order: Order) -> Result<OrderId, OrderError>
  contract { effects {  } }
{
  let orderId = OrdersDB.insert(order)?
  return Ok(orderId)
}
`);
    assert.ok(hasEffectDiag(effectResults, "FUNGI-EFFECT-001"));
  });

  it("warns for a guarded flow with an overdeclared effect", () => {
    const { effectResults } = parseAndCheck(`
guarded flow noOp(order: Order) -> Result<OrderId, OrderError>
  contract { effects { database.write } }
{
  return Ok(order.id)
}
`);
    assert.ok(effectWarnings(effectResults).some((d) => d.name === "OVERDECLARED_EFFECT"));
  });
});

// intentional: guarded flows in source strings use "with effects [...]" canonical syntax
describe("Effect checker - pure flow calls effectful flow", () => {
  it("emits FUNGI-EFFECT-003 when pure flow calls a guarded flow", () => {
    const { effectResults } = parseAndCheck(`
guarded flow saveOrder(order: Order) -> Result<OrderId, OrderError>
  contract { effects { database.write } }
{
  return Ok(OrdersDB.insert(order)?)
}

pure flow calculate(order: Order) -> Result<OrderId, OrderError> {
  return saveOrder(order)
}
`);
    assert.ok(hasEffectDiag(effectResults, "FUNGI-EFFECT-003"));
  });

  it("allows pure flow calling another pure flow", () => {
    const { effectResults } = parseAndCheck(`
pure flow add(a: Int, b: Int) -> Int {
  return a + b
}

pure flow calculate(a: Int, b: Int) -> Int {
  return add(a, b)
}
`);
    assert.equal(effectErrors(effectResults).length, 0);
  });

  it("allows guarded flow calling guarded flow when same effects are declared", () => {
    const { effectResults } = parseAndCheck(`
guarded flow saveOrder(order: Order) -> Result<OrderId, OrderError>
  contract { effects { database.write } }
{
  return Ok(OrdersDB.insert(order)?)
}

guarded flow processOrder(order: Order) -> Result<OrderId, ProcessError>
  contract { effects { database.write } }
{
  let orderId = saveOrder(order)?
  return Ok(orderId)
}
`);
    assert.equal(effectErrors(effectResults).length, 0);
  });
});

// intentional: guarded flows in source strings use "with effects [...]" canonical syntax
describe("Effect checker - canonical effect names", () => {
  it("effects [network] emits FUNGI-EFFECT-005 (BroadAliasUsed) with suggestion network.outbound", () => {
    // 'network' is a broad alias — now emits FUNGI-EFFECT-005 (warning), not FUNGI-EFFECT-004 (error)
    const { effectResults } = parseAndCheck(`
guarded flow fetchRate(currency: String) -> Result<Decimal, RateError>
  contract { effects { network } }
{
  unsafe let rawResponse = http.get("https://rates.example.com/" + currency)?
  return json.decode(rawResponse)
}
`);
    const diag = effectResults.flatMap((r) => r.diagnostics).find((d) => d.code === "FUNGI-EFFECT-005");
    assert.equal(diag?.suggestedCode, "network.outbound");
  });

  it("effects [database] emits FUNGI-EFFECT-005 (BroadAliasUsed) with suggestion database.read", () => {
    // 'database' is a broad alias — now emits FUNGI-EFFECT-005 (warning), not FUNGI-EFFECT-004 (error)
    const { effectResults } = parseAndCheck(`
guarded flow loadOrder(order: Order) -> Result<Order, OrderError>
  contract { effects { database } }
{
  return Ok(OrdersDB.find(order.id)?)
}
`);
    const diag = effectResults.flatMap((r) => r.diagnostics).find((d) => d.code === "FUNGI-EFFECT-005");
    assert.equal(diag?.suggestedCode, "database.read");
  });

  it("effects [network.outbound] has no canonical-name diagnostic", () => {
    const { effectResults } = parseAndCheck(`
guarded flow fetchRate(currency: String) -> Result<Decimal, RateError>
  contract { effects { network.outbound } }
{
  unsafe let rawResponse = http.get("https://rates.example.com/" + currency)?
  return json.decode(rawResponse)
}
`);
    assert.ok(!effectResults.flatMap((r) => r.diagnostics).some((d) => d.code === "FUNGI-EFFECT-004"));
  });
});

// intentional: guarded flows in source strings use "with effects [...]" canonical syntax
describe("Effect checker - inter-flow propagation", () => {
  it("flow A calls flow B and declares B's effect: no diagnostics", () => {
    const { effectResults } = parseAndCheck(`
guarded flow saveOrder(order: Order) -> Result<OrderId, OrderError>
  contract { effects { database.write } }
{
  return Ok(OrdersDB.insert(order)?)
}

guarded flow processOrder(order: Order) -> Result<OrderId, ProcessError>
  contract { effects { database.write } }
{
  let orderId = saveOrder(order)?
  return Ok(orderId)
}
`);
    assert.equal(effectErrors(effectResults).length, 0);
  });

  it("flow A calls flow B and misses B's effect: FUNGI-EFFECT-002", () => {
    const { effectResults } = parseAndCheck(`
guarded flow saveOrder(order: Order) -> Result<OrderId, OrderError>
  contract { effects { database.write } }
{
  return Ok(OrdersDB.insert(order)?)
}

guarded flow processOrder(order: Order) -> Result<OrderId, ProcessError>
  contract { effects {  } }
{
  let orderId = saveOrder(order)?
  return Ok(orderId)
}
`);
    assert.ok(hasEffectDiag(effectResults, "FUNGI-EFFECT-002"));
  });

  it("two-hop propagation requires the root caller to declare inherited effects", () => {
    const { effectResults } = parseAndCheck(`
guarded flow writeOrder(order: Order) -> Result<OrderId, OrderError>
  contract { effects { database.write } }
{
  return Ok(OrdersDB.insert(order)?)
}

guarded flow saveOrder(order: Order) -> Result<OrderId, OrderError>
  contract { effects { database.write } }
{
  return writeOrder(order)
}

guarded flow processOrder(order: Order) -> Result<OrderId, ProcessError>
  contract { effects {  } }
{
  return saveOrder(order)
}
`);
    assert.ok(hasEffectDiag(effectResults, "FUNGI-EFFECT-002"));
  });
});

// intentional: guarded flows in source strings use "with effects [...]" canonical syntax
describe("Effect checker - extended call patterns", () => {
  it("http.get in pure flow body emits FUNGI-EFFECT-003", () => {
    const { effectResults } = parseAndCheck(`
pure flow fetchRate(currency: String) -> Result<Decimal, RateError> {
  unsafe let rawResponse = http.get("https://rates.example.com/" + currency)?
  return json.decode(rawResponse)
}
`);
    assert.ok(hasEffectDiag(effectResults, "FUNGI-EFFECT-003"));
  });

  it("http.post in guarded flow with network.outbound declared has no diagnostics", () => {
    const { effectResults } = parseAndCheck(`
guarded flow syncOrder(order: Order) -> Result<Unit, SyncError>
  contract { effects { network.outbound } }
{
  let _ = http.post("https://sync.example.com/orders", order)?
  return Ok(unit)
}
`);
    assert.equal(effectErrors(effectResults).length, 0);
  });

  it("fs.readText in pure flow emits FUNGI-EFFECT-003", () => {
    const { effectResults } = parseAndCheck(`
pure flow readFile(path: String) -> Result<String, FileError> {
  return fs.readText(path)
}
`);
    assert.ok(hasEffectDiag(effectResults, "FUNGI-EFFECT-003"));
  });

  it("Env.get in guarded flow without secret.read emits FUNGI-EFFECT-001", () => {
    const { effectResults } = parseAndCheck(`
guarded flow loadSecret(name: String) -> Result<String, Error>
  contract { effects {  } }
{
  return Env.get(name)
}
`);
    assert.ok(hasEffectDiag(effectResults, "FUNGI-EFFECT-001"));
  });
});

// ── Effect checker — devtools-graph buildCallGraph integration ─────────────────
// intentional: guarded flows in source strings use "with effects [...]" canonical syntax

describe("Effect checker — devtools-graph buildCallGraph integration", () => {
  it("still propagates transitive effects correctly after graph refactor", () => {
    // Verify that the graph-based call graph produces the same transitive propagation
    // as the previous hand-rolled map did.
    const { effectResults } = parseAndCheck(`
guarded flow writeAudit() -> Result<Unit, Error>
  contract { effects { audit.write } }
{
  AuditLog.write("test")
  return Ok(unit)
}

guarded flow createRecord() -> Result<Unit, Error>
  contract { effects { database.write audit.write } }
{
  OrdersDB.insert("record")
  writeAudit()
  return Ok(unit)
}

guarded flow processRequest() -> Result<Unit, Error>
  contract { effects { database.write audit.write } }
{
  return createRecord()
}
`);
    assert.equal(effectErrors(effectResults).length, 0,
      "No errors expected: all transitive effects are declared");
  });

  it("reports FUNGI-EFFECT-002 when a caller misses transitive effect after graph refactor", () => {
    const { effectResults } = parseAndCheck(`
guarded flow innerWrite() -> Result<Unit, Error>
  contract { effects { database.write } }
{
  OrdersDB.insert("x")
  return Ok(unit)
}

guarded flow outerCall() -> Result<Unit, Error>
  contract { effects {  } }
{
  return innerWrite()
}
`);
    assert.ok(hasEffectDiag(effectResults, "FUNGI-EFFECT-002"),
      "Expected FUNGI-EFFECT-002: outerCall misses database.write from innerWrite");
  });

  it("handles circular flow references gracefully without hanging", () => {
    // Two flows mutually calling each other — the checker must not hang
    // and must complete (guarded by the `seen` set in collectTransitiveCalledEffects).
    const { effectResults } = parseAndCheck(`
guarded flow flowA(x: Int) -> Result<Int, Error>
  contract { effects { database.read } }
{
  return flowB(x)
}

guarded flow flowB(x: Int) -> Result<Int, Error>
  contract { effects { database.read } }
{
  return flowA(x)
}
`);
    // Just verify the checker completes without throwing
    assert.ok(Array.isArray(effectResults), "Checker must not throw on circular flow calls");
    assert.equal(effectResults.length, 2, "Expected results for both flows");
  });
});

// ── Task 1: EFFECT-001 suggestedCode — complete contract.effects block ─────────
describe("Effect checker — EFFECT-001 suggestedCode is a complete contract block", () => {
  it("suggestedCode contains a complete contract.effects block for missing effects", () => {
    const { effectResults } = parseAndCheck(`
guarded flow saveRecord(record: Record) -> Result<Unit, Error>
  contract { effects {  } }
{
  let _ = OrdersDB.insert(record)?
  AuditLog.write("saved")
  return Ok(unit)
}
`);
    const diag = effectResults.flatMap((r) => r.diagnostics).find((d) => d.code === "FUNGI-EFFECT-001");
    assert.ok(diag !== undefined, "Expected FUNGI-EFFECT-001 diagnostic");
    assert.ok(diag.suggestedCode !== undefined, "Expected suggestedCode on EFFECT-001");
    assert.ok(diag.suggestedCode.includes("contract {"), "suggestedCode must contain 'contract {'");
    assert.ok(diag.suggestedCode.includes("effects {"), "suggestedCode must contain 'effects {'");
  });

  it("suggestedCode lists all missing effect names inside the contract block", () => {
    const { effectResults } = parseAndCheck(`
guarded flow writeAndAudit(data: Data) -> Result<Unit, Error>
  contract { effects {  } }
{
  let _ = OrdersDB.insert(data)?
  return Ok(unit)
}
`);
    const diag = effectResults.flatMap((r) => r.diagnostics).find(
      (d) => d.code === "FUNGI-EFFECT-001" && d.suggestedCode?.includes("contract {")
    );
    assert.ok(diag !== undefined, "Expected EFFECT-001 with contract suggestedCode");
    assert.ok(diag.suggestedCode.includes("database.write"), "suggestedCode must list database.write");
  });
});

// ── Task 2: EFFECT-004 with canonical alias suggestions ───────────────────────
describe("Effect checker — EFFECT-004 canonical effect alias suggestions", () => {
  it("pii.write emits EFFECT-004 suggesting database.write", () => {
    const { effectResults } = parseAndCheck(`
guarded flow storePersonal(data: PII) -> Result<Unit, Error>
  contract { effects { pii.write } }
{
  return Ok(unit)
}
`);
    const diag = effectResults.flatMap((r) => r.diagnostics).find((d) => d.code === "FUNGI-EFFECT-004");
    assert.ok(diag !== undefined, "Expected FUNGI-EFFECT-004 for pii.write");
    assert.equal(diag.suggestedCode, "database.write",
      "pii.write should suggest database.write");
  });

  it("http.post emits EFFECT-004 suggesting network.outbound", () => {
    const { effectResults } = parseAndCheck(`
guarded flow sendRequest(payload: Payload) -> Result<Unit, Error>
  contract { effects { http.post } }
{
  return Ok(unit)
}
`);
    const diag = effectResults.flatMap((r) => r.diagnostics).find((d) => d.code === "FUNGI-EFFECT-004");
    assert.ok(diag !== undefined, "Expected FUNGI-EFFECT-004 for http.post");
    assert.equal(diag.suggestedCode, "network.outbound",
      "http.post should suggest network.outbound");
  });

  it("http.get emits EFFECT-004 suggesting network.outbound", () => {
    const { effectResults } = parseAndCheck(`
guarded flow fetchData(url: String) -> Result<String, Error>
  contract { effects { http.get } }
{
  return Ok(unit)
}
`);
    const diag = effectResults.flatMap((r) => r.diagnostics).find((d) => d.code === "FUNGI-EFFECT-004");
    assert.ok(diag !== undefined, "Expected FUNGI-EFFECT-004 for http.get");
    assert.equal(diag.suggestedCode, "network.outbound",
      "http.get should suggest network.outbound");
  });

  it("file.read emits EFFECT-004 suggesting storage.read", () => {
    const { effectResults } = parseAndCheck(`
guarded flow loadFile(path: String) -> Result<String, Error>
  contract { effects { file.read } }
{
  return Ok(unit)
}
`);
    const diag = effectResults.flatMap((r) => r.diagnostics).find((d) => d.code === "FUNGI-EFFECT-004");
    assert.ok(diag !== undefined, "Expected FUNGI-EFFECT-004 for file.read");
    assert.equal(diag.suggestedCode, "storage.read",
      "file.read should suggest storage.read");
  });

  it("email.send is canonical and does NOT emit EFFECT-004", () => {
    const { effectResults } = parseAndCheck(`
guarded flow sendEmail(msg: EmailMessage) -> Result<Unit, Error>
  contract { effects { email.send } }
{
  return Ok(unit)
}
`);
    assert.ok(
      !effectResults.flatMap((r) => r.diagnostics).some((d) => d.code === "FUNGI-EFFECT-004"),
      "email.send is canonical — should not emit EFFECT-004"
    );
  });
});

// ── Task 3: fn helper effect propagation → EFFECT-002 on parent flow ──────────
describe("Effect checker — fn helper effect propagation", () => {
  it("emits EFFECT-002 when fn helper inside guarded flow makes a database call not declared", () => {
    const { effectResults } = parseAndCheck(`
guarded flow processOrder(order: Order) -> Result<Unit, Error>
  contract { effects {  } }
{
  fn save(o: Order) -> Result<Unit, Error> {
    let _ = OrdersDB.insert(o)?
    return Ok(unit)
  }
  return save(order)
}
`);
    assert.ok(
      hasEffectDiag(effectResults, "FUNGI-EFFECT-002"),
      "Expected FUNGI-EFFECT-002: fn helper uses database.write not declared on parent"
    );
  });

  it("no EFFECT-002 when fn helper effect is declared on the parent flow", () => {
    const { effectResults } = parseAndCheck(`
guarded flow processOrder(order: Order) -> Result<Unit, Error>
  contract { effects { database.write } }
{
  fn save(o: Order) -> Result<Unit, Error> {
    let _ = OrdersDB.insert(o)?
    return Ok(unit)
  }
  return save(order)
}
`);
    const errors = effectErrors(effectResults);
    assert.ok(
      !errors.some((d) => d.code === "FUNGI-EFFECT-002"),
      "No EFFECT-002 expected when parent declares the fn helper's effect"
    );
  });
});

// ── Task 4: EFFECT-001 location points to the specific call, not the flow decl ─
describe("Effect checker — EFFECT-001 location points to specific call", () => {
  it("EFFECT-001 location is on the call expression, not the flow declaration line", () => {
    const { effectResults } = parseAndCheck(`
guarded flow storeOrder(order: Order) -> Result<Unit, Error>
  contract { effects {  } }
{
  let _ = OrdersDB.insert(order)?
  return Ok(unit)
}
`);
    const diag = effectResults.flatMap((r) => r.diagnostics).find((d) => d.code === "FUNGI-EFFECT-001");
    assert.ok(diag !== undefined, "Expected FUNGI-EFFECT-001");
    // The flow declaration is on line 2, OrdersDB.insert is on a later line.
    // Location line should be greater than 2 if pointing at the call.
    if (diag.location !== undefined) {
      assert.ok(diag.location.line > 2,
        `EFFECT-001 location.line (${diag.location.line}) should point past the flow declaration header (line 2)`);
    }
  });
});

// ── #153 FAIL-CLOSED: unregistered method on a known-effectful module ──────────
describe("Effect checker — #153 fail-closed unknown effectful stdlib call", () => {
  function diagCodes(src) {
    const { effectResults } = parseAndCheck(src);
    return effectResults.flatMap((r) => r.diagnostics).map((d) => d.code);
  }

  it("FUNGI-STDLIB-002: unregistered method on effectful Database module is DENIED when no effect declared", () => {
    const codes = diagCodes(`
secure flow doIt(x: Int) -> Int contract { effects { } } {
  let r = Database.zonkify(x)
  return x
}
`);
    assert.ok(
      codes.includes("FUNGI-STDLIB-002"),
      `Expected FUNGI-STDLIB-002 for an unrecognised method on an effectful module, got: ${codes.join(", ")}`,
    );
  });

  it("FUNGI-STDLIB-002: unregistered effectful method is allowed once the broad effect is declared", () => {
    const codes = diagCodes(`
secure flow doIt(x: Int) -> Int contract { effects { database.read } } {
  let r = Database.zonkify(x)
  return x
}
`);
    assert.ok(
      !codes.includes("FUNGI-STDLIB-002"),
      `Did not expect FUNGI-STDLIB-002 once database.read is declared, got: ${codes.join(", ")}`,
    );
  });

  it("unregistered method on a PURE module (String) is NOT flagged — pure modules are effect-free", () => {
    const codes = diagCodes(`
secure flow doIt(x: String) -> String contract { effects { } } {
  let r = String.zonkify(x)
  return r
}
`);
    assert.ok(
      !codes.includes("FUNGI-STDLIB-002"),
      `Did not expect FUNGI-STDLIB-002 for a pure stdlib module, got: ${codes.join(", ")}`,
    );
  });

  it("unknown user-defined module is NOT flagged — only known stdlib modules are governed here", () => {
    const codes = diagCodes(`
secure flow doIt(x: Int) -> Int contract { effects { } } {
  let r = MyHelpers.compute(x)
  return x
}
`);
    assert.ok(
      !codes.includes("FUNGI-STDLIB-002"),
      `Did not expect FUNGI-STDLIB-002 for an unknown user module, got: ${codes.join(", ")}`,
    );
  });

  it("FUNGI-STDLIB-002 covers Http (network.outbound) too", () => {
    const codes = diagCodes(`
secure flow doIt(x: String) -> String contract { effects { } } {
  let r = Http.exfiltrate(x)
  return r
}
`);
    assert.ok(
      codes.includes("FUNGI-STDLIB-002"),
      `Expected FUNGI-STDLIB-002 for an unrecognised method on Http, got: ${codes.join(", ")}`,
    );
  });
});

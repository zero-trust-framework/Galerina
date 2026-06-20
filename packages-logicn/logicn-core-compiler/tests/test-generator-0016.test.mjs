// 0016 — contract-driven test generation, fault-injection dimension. Consumes the 0017
// GIRFlow.faultHandlers matrix and emits one fail-closed test obligation per fault class.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseProgram, checkEffects, emitGIR,
  generateFaultInjectionTests, generateFaultInjectionSuite, renderFaultInjectionTAP,
  generateEffectEgressTests, generateContractTestSuite, generateCapabilityDenialTests,
  generateBoundaryTests, generateSubstrateViolationTests,
} from "../dist/index.js";

function girFlows(source) {
  const parsed = parseProgram(source, "test.lln");
  const effects = checkEffects(parsed.flows, parsed.ast);
  return emitGIR(parsed.ast, parsed.flows, effects).gir.flows;
}

const withResilience = (body) => `flow fetchOrder(id: String) -> Result<String, String>
contract {
  intent { "Fetch an order with declared fault handling." }
  effects { network.outbound }
  resilience {
${body}
  }
}
{
  let r = OrdersDB.read(id)?
  return Ok(r)
}`;

const noResilience = `flow plainFetch(id: String) -> Result<String, String>
contract {
  intent { "Fetch with no resilience block." }
  effects { network.outbound }
}
{
  let r = OrdersDB.read(id)?
  return Ok(r)
}`;

describe("0016: fault-injection test generation from GIRFlow.faultHandlers", () => {
  it("emits one obligation per fault class (4), with declared + inferred-default actions", () => {
    const flow = girFlows(withResilience("    on_timeout_fault quarantine\n    on_substrate_fault fallback degraded_read_flow"))[0];
    const cases = generateFaultInjectionTests(flow);
    assert.equal(cases.length, 4, "one fault-injection case per fault class");

    const bySignal = Object.fromEntries(cases.map((c) => [c.signal, c]));
    assert.equal(bySignal.on_timeout_fault.expectedAction, "quarantine");
    assert.equal(bySignal.on_timeout_fault.source, "declared");
    assert.equal(bySignal.on_substrate_fault.expectedAction, "fallback");
    assert.equal(bySignal.on_substrate_fault.fallbackTarget, "degraded_read_flow");
    // the undeclared classes carry the fail-closed secure default
    assert.equal(bySignal.on_denial_fault.expectedAction, "halt");
    assert.equal(bySignal.on_denial_fault.source, "inferred-default");
    assert.equal(bySignal.on_rotation_fault.expectedAction, "halt");

    // every case has a stable id, an injection stimulus, and a fail-closed assertion
    for (const c of cases) {
      assert.equal(c.id, `fetchOrder::${c.signal}`);
      assert.ok(c.injectedFault.length > 0, "an injection stimulus is described");
      assert.ok(c.assertion.length > 0, "a fail-closed assertion is described");
    }
  });

  it("halt obligations assert no downstream effect after the fault (fail-closed)", () => {
    const flow = girFlows(withResilience("    on_timeout_fault halt"))[0];
    const c = generateFaultInjectionTests(flow).find((x) => x.signal === "on_timeout_fault");
    assert.equal(c.expectedAction, "halt");
    assert.match(c.assertion, /NO downstream effect|fail-closed/);
    assert.equal(c.failOpen, false);
  });

  it("flags the one fail-OPEN exception (on_rotation_fault log)", () => {
    const flow = girFlows(withResilience("    on_rotation_fault log"))[0];
    const c = generateFaultInjectionTests(flow).find((x) => x.signal === "on_rotation_fault");
    assert.equal(c.expectedAction, "log");
    assert.equal(c.failOpen, true, "log on on_rotation_fault is the fail-open exception — flagged for review");
  });

  it("a flow with no declared handlers generates no fault-injection cases", () => {
    const flow = girFlows(noResilience)[0];
    assert.deepEqual(generateFaultInjectionTests(flow), []);
  });

  it("generateFaultInjectionSuite spans every flow in the program", () => {
    const flows = girFlows(withResilience("    on_timeout_fault quarantine"));
    const suite = generateFaultInjectionSuite(flows);
    assert.equal(suite.length, 4); // single flow with declared handlers → 4 classes
  });

  it("renderFaultInjectionTAP produces a valid TAP plan with one point per case", () => {
    const flow = girFlows(withResilience("    on_timeout_fault halt"))[0];
    const cases = generateFaultInjectionTests(flow);
    const tap = renderFaultInjectionTAP(cases);
    assert.match(tap, /^TAP version 13/);
    assert.match(tap, /\n1\.\.4\n/);
    assert.equal((tap.match(/^not ok /gm) ?? []).length, 4, "one TODO obligation per case");
    assert.match(tap, /fetchOrder::on_timeout_fault/);
  });
});

const twoSinks = `flow saveOrder(id: String) -> Result<String, String>
contract {
  intent { "Persist an order and notify downstream." }
  effects {
    database.write
    network.outbound
  }
}
{
  let w = OrdersDB.write(id)?
  return Ok(id)
}`;

const pureFlow = `pure flow addOne(n: Int) -> Int
contract { intent { "Add one." } }
{
  return n + 1
}`;

describe("0016: effect-egress test generation from governed sinks", () => {
  it("emits one 'no unsafe egress' obligation per governed-sink effect", () => {
    const flow = girFlows(twoSinks)[0];
    const cases = generateEffectEgressTests(flow);
    const bySink = Object.fromEntries(cases.map((c) => [c.sink, c]));
    // both declared effects are governed sinks requiring validated data
    assert.ok(bySink["database.write"], "database.write is a governed sink");
    assert.ok(bySink["network.outbound"], "network.outbound is a governed sink");
    assert.equal(bySink["database.write"].requiredState, "validated");
    assert.equal(bySink["network.outbound"].requiredState, "validated");
    for (const c of cases) {
      assert.equal(c.id, `saveOrder::egress::${c.sink}`);
      assert.match(c.assertion, /must be REJECTED \(no unsafe egress\) — fail-closed/);
      assert.ok(c.violatingInput.length > 0 && c.policyNote.length > 0);
    }
  });

  it("a flow with no governed-sink effect generates no egress obligations", () => {
    const flow = girFlows(pureFlow)[0];
    assert.deepEqual(generateEffectEgressTests(flow), []);
  });

  it("generateContractTestSuite returns all implemented dimensions over the program", () => {
    const flows = girFlows(twoSinks);
    const suite = generateContractTestSuite(flows);
    assert.equal(suite.effectEgress.length, 2, "two governed sinks → two egress obligations");
    assert.equal(suite.capabilityDenial.length, 2, "two effects → two capability-denial obligations");
    assert.equal(suite.boundary.length, 3, "one String param → three boundary obligations");
    assert.equal(suite.substrateViolation.length, 0, "no crypto effect → no substrate obligations");
    // saveOrder declares no resilience handlers → no fault-injection cases
    assert.equal(suite.faultInjection.length, 0);
  });
});

const intFlow = `pure flow incInt(n: Int) -> Int
contract { intent { "Increment an Int." } }
{
  return n + 1
}`;

const cryptoFlow = `flow signDoc(doc: String) -> Result<String, String>
contract {
  intent { "Sign a document." }
  effects { crypto.sign }
}
{
  let s = Crypto.sign(doc)?
  return Ok(s)
}`;

describe("0016: boundary/fuzz test generation", () => {
  it("emits the i32 edge set for an Int parameter, asserting fail-closed overflow traps", () => {
    const flow = girFlows(intFlow)[0];
    const cases = generateBoundaryTests(flow);
    const values = cases.map((c) => c.value).sort();
    assert.deepEqual(values, ["-1", "-2147483648", "0", "2147483647"].sort());
    for (const c of cases) {
      assert.equal(c.paramType, "Int");
      assert.match(c.id, /^incInt::boundary::p0::/);
    }
    const maxCase = cases.find((c) => c.value === "2147483647");
    assert.match(maxCase.assertion, /TRAPS fail-closed.*never wraps|no UB/);
  });

  it("emits String edge values (empty / NUL / oversized)", () => {
    const flow = girFlows(twoSinks)[0]; // saveOrder(id: String)
    const labels = generateBoundaryTests(flow).map((c) => c.value);
    assert.ok(labels.includes('""'), "empty string edge present");
    assert.ok(labels.includes('"\\u0000"'), "NUL edge present");
  });
});

describe("0016: substrate-violation test generation", () => {
  it("emits a crypto-on-core obligation per crypto effect (LLN-SUBSTRATE-001)", () => {
    const flow = girFlows(cryptoFlow)[0];
    const cases = generateSubstrateViolationTests(flow);
    assert.equal(cases.length, 1);
    assert.equal(cases[0].cryptoEffect, "crypto.sign");
    assert.equal(cases[0].id, "signDoc::substrate::crypto.sign");
    assert.match(cases[0].assertion, /noisy\/photonic substrate lane.*LLN-SUBSTRATE-001.*fail-closed/);
  });

  it("a flow with no crypto effect generates no substrate obligations", () => {
    const flow = girFlows(twoSinks)[0];
    assert.deepEqual(generateSubstrateViolationTests(flow), []);
  });
});

describe("0016: capability-denial test generation", () => {
  it("emits one fail-closed denial obligation per required capability", () => {
    const flow = girFlows(twoSinks)[0];
    const cases = generateCapabilityDenialTests(flow);
    assert.equal(cases.length, 2, "two declared effects → two required capabilities");
    const effects = cases.map((c) => c.effect).sort();
    assert.deepEqual(effects, ["database.write", "network.outbound"]);
    for (const c of cases) {
      assert.equal(c.id, `saveOrder::cap-deny::${c.capability}`);
      assert.ok(c.capability.length > 0, "a capability name is resolved");
      assert.match(c.assertion, /must be DENIED before any effect runs.*fail-closed/);
    }
  });

  it("a flow that requires no capability (pure) generates no denial obligations", () => {
    const flow = girFlows(pureFlow)[0];
    assert.deepEqual(generateCapabilityDenialTests(flow), []);
  });
});

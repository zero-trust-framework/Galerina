// 0016 — contract-driven test generation, fault-injection dimension. Consumes the 0017
// GIRFlow.faultHandlers matrix and emits one fail-closed test obligation per fault class.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseProgram, checkEffects, emitGIR,
  generateFaultInjectionTests, generateFaultInjectionSuite, renderFaultInjectionTAP,
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

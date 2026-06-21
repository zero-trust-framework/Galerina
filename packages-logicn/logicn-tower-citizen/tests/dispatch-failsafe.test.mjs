// dispatch-failsafe.test.mjs — Tri-Pipe fault-tolerance R&D (BUILD FIRST):
// dispatchPlan must be TOTAL over exceptions so the engine upholds
// "fail-safe-to-Binary / no system crash" (Goal C).
//
//   • a photonic-port throw (kernel build OR route) DECLINES to the digital floor —
//     it must NEVER escape infer() as an ungoverned exception; and
//   • a binary bridge fault / ternary-drift trap becomes a GOVERNED trapFired receipt,
//     not an escaping exception.
//
// Before the fix, a throw from the per-decision loop re-threw through the infer() catch
// and escaped as an uncaught exception (the documented production weight-handle seam).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHybridEngine, StubTernaryBridge, AuditLogger } from "../dist/index.js";

const bigKernel = () => ({ n: 1024, lane: "photonic", tolerance: 0.05 });

test("a photonic port whose route() THROWS declines to the digital floor (fail-safe, no escape)", async () => {
  const throwingPort = { route: () => { throw new Error("corrupt trit 0b11 / native-handle fault"); } };
  const eng = createHybridEngine({ auditInMemory: true, photonic: { router: throwingPort, kernelFor: bigKernel } });
  // Resolving (not rejecting) is itself the proof the throw did not escape infer().
  const r = await eng.infer({ prompt: "hi", correlationId: "fs1" });
  assert.deepEqual(r.bridgesUsed, ["stub-ternary"], "a throwing photonic port must fall through to the digital dispatch");
  assert.equal(r.trapFired, false, "declining to digital is the fail-safe floor, not a trap");
  await eng.shutdown();
});

test("a photonic port whose kernelFor() THROWS also declines to digital (whole port interaction guarded)", async () => {
  const port = { route: () => ({ value: 1, bridgeId: "p" }) };
  const eng = createHybridEngine({
    auditInMemory: true,
    photonic: { router: port, kernelFor: () => { throw new Error("kernel build fault"); } },
  });
  const r = await eng.infer({ prompt: "hi", correlationId: "fs2" });
  assert.deepEqual(r.bridgesUsed, ["stub-ternary"]);
  assert.equal(r.trapFired, false);
  await eng.shutdown();
});

test("a binary bridge fault becomes a GOVERNED trapFired receipt, never an escaping exception", async () => {
  class ThrowingBridge extends StubTernaryBridge {
    execute() { throw new Error("simulated ternary bridge fault"); }
  }
  const eng = createHybridEngine({
    auditInMemory: true,
    bridges: new Map([["ternary", new ThrowingBridge(new AuditLogger(null))]]),
  });
  // Must RESOLVE (not reject) — the fault is governed into a receipt, not thrown.
  const r = await eng.infer({ prompt: "hi", correlationId: "bf1" });
  assert.equal(r.trapFired, true, "a bridge fault must surface as a governed trap, not an uncaught exception");
  assert.equal(r.trapCode, "ERR_BRIDGE_DISPATCH_FAULT");
  await eng.shutdown();
});

test("the engine is still usable after a governed dispatch fault (no corrupted state)", async () => {
  const eng = createHybridEngine({ auditInMemory: true });
  const ok = await eng.infer({ prompt: "ok", correlationId: "bf2" });
  assert.equal(ok.trapFired, false, "a clean call still succeeds (the fault path did not poison the engine)");
  await eng.shutdown();
});

// #199 Phase 1.5 — the Tower LOAD→TRAP→ERASE audit trail wired into the ffsim backend.
// An over-budget job traps (LOAD→TRAP→ERASE, no EXEC — nothing ran); an admitted job in Phase 1
// is LOAD→ERASE (EXEC arrives in Phase 2 with real execution). No AuditLogger → no emission.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FfsimBackend } from "../dist/index.js";
import { AuditLogger } from "../../logicn-tower-citizen/dist/index.js";

const LIMITS = {
  maxOrbitals: 26, maxSubspaceDim: 134217728, maxMemoryMB: 2048, maxWallMs: 60000,
  maxTrotterSteps: 50, maxShots: 1024, rayonThreads: 4, tolerance: 1e-8,
};
const job = (over = {}) => ({ op: "expectation_energy", correlationId: "c1", norb: 4, nelec: [2, 2], seed: 0, params: {}, ...over });
const phases = (audit, cid) => audit.query({ correlationId: cid }).map((e) => e.phase);

test("over-budget job → LOAD then TRAP then ERASE(false), no EXEC", async () => {
  const audit = new AuditLogger(null);
  const r = await new FfsimBackend({ available: true, ffsimVersion: "0.0.81" }, audit)
    .run(job({ correlationId: "trap1", norb: 26, nelec: [13, 13] }), LIMITS);
  assert.equal(r.trapFired, true);
  const ev = phases(audit, "trap1");
  assert.ok(ev.includes("LOAD") && ev.includes("TRAP") && ev.includes("ERASE"), `got ${ev}`);
  assert.ok(!ev.includes("EXEC"), "a trapped job never executes");
});

test("admitted job → LOAD then ERASE(true), no TRAP (Phase 1: no EXEC yet)", async () => {
  const audit = new AuditLogger(null);
  const r = await new FfsimBackend({ available: true, ffsimVersion: "0.0.81" }, audit)
    .run(job({ correlationId: "ok1" }), LIMITS);
  assert.equal(r.trapFired, false);
  const ev = phases(audit, "ok1");
  assert.ok(ev.includes("LOAD") && ev.includes("ERASE"), `got ${ev}`);
  assert.ok(!ev.includes("TRAP"), "an admitted job does not trap");
});

test("no AuditLogger injected → no emission, behaviour unchanged (backward compatible)", async () => {
  const r = await new FfsimBackend({ available: true, ffsimVersion: "0.0.81" })
    .run(job({ correlationId: "noaudit" }), LIMITS);
  assert.equal(r.trapFired, false);
});

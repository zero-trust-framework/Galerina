import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TPLSimulator,
  TritState,
  SecurityTrap,
  TPLIntegrityFault,
  GovernanceEnforcer,
  AuditLogger,
} from "../dist/index.js";

function makeSim(sizeInTrits = 64) {
  const logger = new AuditLogger();
  const gov = new GovernanceEnforcer();
  return { sim: new TPLSimulator(logger, gov, sizeInTrits), logger, gov };
}

// ── Test A: Ternary Identity Verification (TPL Standard §4 Test A) ────────────

test("Test A: ternary identity — [-1, 0, 1] round-trips exactly", () => {
  const { sim } = makeSim();
  sim.setTrit(0, -1);
  sim.setTrit(1, 0);
  sim.setTrit(2, 1);
  assert.equal(sim.getTrit(0), -1);
  assert.equal(sim.getTrit(1), 0);
  assert.equal(sim.getTrit(2), 1);
});

test("Test A: packing survives across word + byte boundaries (all 64 trits)", () => {
  const { sim } = makeSim(64);
  const pattern = [];
  for (let i = 0; i < 64; i++) {
    const v = (i % 3) - 1; // cycles -1, 0, 1
    pattern.push(v);
    sim.setTrit(i, v);
  }
  assert.deepEqual(sim.snapshot(), pattern);
});

// ── RD-0112 R2: erase-on-trap — a trapped mutator leaves no secret residue ────
test("RD-0112 R2: a SecurityTrap during a mutator ERASES all trit state (no secret residue survives)", () => {
  const { sim } = makeSim(16);
  sim.setTrit(5, TritState.COMMIT); // a secret capability resident in the buffer
  assert.equal(sim.getTrit(5), TritState.COMMIT);
  // setTrit(toxic) throws a SecurityTrap (encodeTrit rejects out-of-set input); the eraseOnTrap wrapper
  // wipes ALL state before re-throwing, so the trapped secret leaves no COMMIT residue in the buffer.
  assert.throws(() => sim.setTrit(2, 7), (e) => e instanceof SecurityTrap);
  assert.notEqual(sim.getTrit(5), TritState.COMMIT, "the secret COMMIT must NOT survive the trap — erase-on-trap wiped it to the REJECT pole");
});

test("RD-0112 R2: a loadWeights overflow trap also erases before unwinding (no residue)", () => {
  const { sim } = makeSim(16);
  sim.setTrit(9, TritState.COMMIT); // resident secret
  // loadWeights past the buffer end throws a SecurityTrap; the wrapper erases before re-throwing.
  assert.throws(() => sim.loadWeights([1, -1, 0], 15), (e) => e instanceof SecurityTrap);
  assert.notEqual(sim.getTrit(9), TritState.COMMIT, "a trapped loadWeights leaves no COMMIT residue either");
});

test("BitNet-faithful: 16 trits pack into one i32 (4 bytes for 16 trits)", () => {
  const { sim } = makeSim(16);
  assert.equal(sim.packedByteLength(), 4); // 16 trits × 2 bits = 32 bits = 4 bytes
});

// ── Test C: Toxic Photonic Injection (TPL Standard §4 Test C) ─────────────────

test("Test C: injecting 2 triggers a SecurityTrap (value outside ternary set)", () => {
  const { sim } = makeSim();
  assert.throws(() => sim.setTrit(0, 2), SecurityTrap);
});

test("Test C: injecting 0.5 triggers a SecurityTrap", () => {
  const { sim } = makeSim();
  assert.throws(() => sim.setTrit(0, 0.5), SecurityTrap);
});

test("Test C: out-of-bounds trit index triggers a SecurityTrap", () => {
  const { sim } = makeSim(16);
  assert.throws(() => sim.setTrit(99, 1), SecurityTrap);
});

// ── Test B: BitNet T-MAC (ternary multiply-accumulate, add/sub/skip) ──────────

test("Test B: T-MAC computes ternary dot product via add/subtract/skip", () => {
  const { sim } = makeSim(8);
  // weights: [+1, -1, 0, +1]  activations: [10, 20, 30, 40]
  // expected: +10 -20 +0 +40 = 30
  sim.loadWeights([1, -1, 0, 1]);
  const acts = Int32Array.from([10, 20, 30, 40]);
  const result = sim.tmacVector(acts, 0, 4, "TMAC-TEST-1");
  assert.equal(result, 30);
});

test("Test B: T-MAC applies the per-tensor scale (BitNet i2_scale)", () => {
  const { sim } = makeSim(8);
  sim.loadWeights([1, 1, 1]);
  sim.setScale(2);
  const acts = Int32Array.from([5, 5, 5]); // sum 15 × scale 2 = 30
  assert.equal(sim.tmacVector(acts, 0, 3, "TMAC-TEST-2"), 30);
});

test("Test B: T-MAC zero weights are skipped (no contribution)", () => {
  const { sim } = makeSim(8);
  sim.loadWeights([0, 0, 0, 0]);
  const acts = Int32Array.from([100, 200, 300, 400]);
  assert.equal(sim.tmacVector(acts, 0, 4, "TMAC-TEST-3"), 0);
});

// ── Epistemic Hold governance (TPL Standard §3) ───────────────────────────────

test("Epistemic Hold: 0 -> +1 gate without audit signature is trapped", () => {
  const { sim } = makeSim(8);
  sim.setTrit(0, 0);  // input = HOLD
  sim.setTrit(1, 0);  // weight (0×0=0, won't trigger — set up commit below)
  // Force a 0 -> +1 by making input HOLD and result COMMIT via direct gate path:
  // gate computes input×weight; to get result=+1 from input=0 is impossible by
  // multiplication, so we verify the governance check directly instead.
  const check = sim.gate ? null : null;
  // Direct governance check: HOLD -> COMMIT must be denied without signature
  const { gov } = makeSim();
  const verdict = gov.checkTransition(TritState.HOLD, TritState.COMMIT);
  assert.equal(verdict.allowed, false);
});

test("Epistemic Hold: 0 -> +1 permitted after audit signature + schema validation", () => {
  const gov = new GovernanceEnforcer();
  gov.signAudit("CORR-1", "sha256:input");
  gov.markSchemaValidated();
  const verdict = gov.checkTransition(TritState.HOLD, TritState.COMMIT);
  assert.equal(verdict.allowed, true);
});

test("Epistemic Hold: unrestricted transitions always allowed", () => {
  const gov = new GovernanceEnforcer();
  assert.equal(gov.checkTransition(TritState.REJECT, TritState.HOLD).allowed, true);
  assert.equal(gov.checkTransition(TritState.COMMIT, TritState.REJECT).allowed, true);
});

// ── Guard pages / Hardened Border ─────────────────────────────────────────────

test("guard pages: verifyIntegrity passes on a clean buffer", () => {
  const { sim } = makeSim();
  sim.loadWeights([1, -1, 0, 1]);
  assert.doesNotThrow(() => sim.verifyIntegrity());
});

test("guard pages (RD-0112 R2): a DETECTED canary corruption erases secret state before throwing", () => {
  const { sim } = makeSim(16);
  sim.setTrit(5, 1); // a secret COMMIT
  assert.equal(sim.getTrit(5), TritState.COMMIT);
  // Model a buffer overflow that strays past the trit region and corrupts the trailing guard page.
  // (TS `private` is compile-time only; the runtime field is reachable — this stands in for the
  // memory corruption a real overflow would cause, which is exactly what verifyIntegrity detects.)
  sim.mem[sim.canaryTailIdx] = 0;
  assert.throws(() => sim.verifyIntegrity(), /trailing guard page corrupted/);
  // The detected corruption wiped the secret to the REJECT pole BEFORE unwinding — no COMMIT residue
  // survives in the (exported) buffer — and the canary was re-stamped so the simulator stays usable.
  assert.notEqual(sim.getTrit(5), TritState.COMMIT, "secret COMMIT must NOT survive a detected integrity fault");
  assert.equal(sim.getTrit(5), -1, "wiped to the REJECT pole");
  assert.doesNotThrow(() => sim.verifyIntegrity(), "canary re-stamped by the erase");
});

test("hard erasure: wipes state but preserves guard pages", () => {
  const { sim } = makeSim(16);
  sim.loadWeights([1, 1, 1, 1, 1]);
  sim.erase();
  // After erase, all trits decode to -1 (0b00 = REJECT, the wiped state)
  assert.equal(sim.getTrit(0), -1);
  assert.doesNotThrow(() => sim.verifyIntegrity()); // canaries re-stamped
});

test("gate: input×weight stores correct ternary result", () => {
  const { sim } = makeSim(8);
  sim.setTrit(0, 1);   // input = COMMIT
  sim.setTrit(1, -1);  // weight = REJECT
  const result = sim.gate(0, 1, 2, "GATE-TEST");
  assert.equal(result, -1);  // 1 × -1 = -1
  assert.equal(sim.getTrit(2), -1);
});

// ── Audit trail ───────────────────────────────────────────────────────────────

test("audit: T-MAC emits one vector-level transition (not per-trit)", () => {
  const { sim, logger } = makeSim(8);
  // Unique correlation ID per run — the audit log is append-only and persists
  // across runs (immutable ledger), so a fixed ID would accumulate entries.
  const corr = `AUDIT-TMAC-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  sim.loadWeights([1, -1, 1]);
  sim.tmacVector(Int32Array.from([1, 2, 3]), 0, 3, corr);
  const events = logger.query({ correlationId: corr });
  const tmacEvents = events.filter(e => e.details?.operation === "TMAC");
  assert.equal(tmacEvents.length, 1); // exactly one — vector-level audit
});

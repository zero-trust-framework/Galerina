// full-sentinel-flight.test.mjs — ALL SIX Sentinels composed into one governed flight.
//
// Proves every Sentinel plugin is actually exercised in a single end-to-end pass:
//   LSIO   — integrity-verify the weights (HMAC/SHA-256 gate)
//   LSM    — stage trits in an aligned, segmented pool, then flight-lock it
//   LSP    — read the thermal envelope, pick the kernel tier (down-tier if hot)
//   LST    — stamp every audit event with a deterministic LogicalTick
//   Egress — route the audit ledger through the governed, HMAC-chained sink
//   LSS    — checkpoint the flight state and prove cold-boot recovery
//
// This is the "Triple-Lock" extended to the full aerospace stack.

import { test } from "node:test";
import assert from "node:assert/strict";
import { StubTernaryBridge, AuditLogger } from "../dist/index.js";
import { StaticMemoryPool, TPLStateBuffer, SegmentationController } from "../../logicn-core-sentinel-memory/dist/index.js";
import { buildManifest, IntegrityMonitor, ZeroCopyMapper } from "../../logicn-core-sentinel-io/dist/index.js";
import { LogicalClock } from "../../logicn-core-sentinel-time/dist/index.js";
import { PowerGovernor, AEROSPACE_ENVELOPE } from "../../logicn-core-sentinel-power/dist/index.js";
import { AuditEgress, readEgressLedger } from "../../logicn-core-sentinel-egress/dist/index.js";
import { StateSerializer, AtomicWriter, ColdBootOrchestrator } from "../../logicn-core-sentinel-state/dist/index.js";

const TRITS = 256;
let counter = 0;
const dir = () => `build/full-flight-${process.pid}-${++counter}`;
function makeTrits(n) { const o = []; let r = 0x9e3779b9 >>> 0; for (let i = 0; i < n; i++) { r ^= (r << 13); r >>>= 0; r ^= (r >>> 17); r ^= (r << 5); r >>>= 0; o.push((r % 3) - 1); } return o; }

test("all six sentinels compose into one governed, recoverable flight", () => {
  const trits = makeTrits(TRITS);
  const acts = Int32Array.from({ length: TRITS }, (_, i) => ((i * 5) % 7) - 3);

  // ── LST + Egress: governed, cycle-indexed audit channel ──
  const clock = new LogicalClock(0);
  const egDir = dir();
  const egress = new AuditEgress({ dir: egDir, batchSize: 8 });
  const logger = new AuditLogger(null, { tickSource: () => clock.tick(), egress });

  // ── PREFLIGHT (fail-fast): LSM stage + LSIO integrity gate + lock ──
  const pool = new StaticMemoryPool({ totalBytes: 4096, blockBytes: 64 });
  const seg = new SegmentationController(pool);
  const tpl = new TPLStateBuffer(pool, TRITS);
  tpl.loadTrits(trits);
  seg.assertAccess(tpl.block.ptr, "compute");
  const packed = pool.u8(tpl.block).slice(0, Math.ceil(TRITS / 16) * 4);
  const manifest = buildManifest("weights", [{ id: "w0", bytes: packed }]);
  const verified = new ZeroCopyMapper().map(manifest, packed, new IntegrityMonitor())[0].i32(); // LSIO gate
  pool.lockFlight();
  logger.append({ phase: "LOAD", correlationId: "flt", artifactHash: "h", engineId: "uhie", severity: "INFO", category: "LIFECYCLE", details: { action: "preflight_complete" }, governancePass: true });

  // ── LSP: thermal envelope decides the kernel tier ──
  const power = new PowerGovernor(AEROSPACE_ENVELOPE, { sensor: () => 55 }); // nominal temperature
  const decision = power.evaluate();
  assert.equal(decision.kernel, "native", "nominal temp → full native kernel");
  power.assertWithinEnvelope(); // not in TERMINAL
  logger.append({ phase: "EXEC", correlationId: "flt", artifactHash: "h", engineId: "uhie", severity: "INFO", category: "AUDIT_TRAIL", details: { action: "kernel_selected", kernel: decision.kernel, tempC: decision.tempC }, governancePass: true });

  // ── FLIGHT: Brawn T-MAC on verified weights; bridge audit ALSO goes via egress ──
  const bridge = new StubTernaryBridge(logger);
  const r = bridge.execute({ opClass: "feedforward", precision: "ternary", correlationId: "flt", weights: verified, activations: acts, count: TRITS, scale: 1, offset: 0 });
  assert.equal(r.deterministic, true);

  // ── LSS: checkpoint the flight state, then prove cold-boot recovery ──
  const serializer = new StateSerializer();
  const writer = new AtomicWriter(dir());
  const coldBoot = new ColdBootOrchestrator(serializer, writer);
  coldBoot.checkpoint("flight", { resultChecksum: r.value, kernel: decision.kernel, tick: clock.now() }, clock.now());
  const restored = coldBoot.restore("flight");
  assert.equal(restored.payload.resultChecksum, r.value, "cold-boot recovers the exact flight result");
  assert.equal(restored.logicalTick, clock.now(), "cold-boot recovers the logical tick");

  logger.flush();

  // ── Verify the governed audit border held ──
  const events = logger.query({ correlationId: "flt" });
  assert.ok(events.length >= 3, "LOAD + kernel + T-MAC audited");
  assert.ok(events.every((e) => typeof e.logicalTick === "number"), "every event carries an LST LogicalTick");
  const batches = readEgressLedger(egDir);
  assert.ok(batches.reduce((n, b) => n + b.count, 0) >= 3, "all audit records reached the governed egress ledger");
  assert.equal(AuditEgress.verifyChain(batches), true, "egress HMAC chain verifies (dev/zero key — chain integrity, not a secret-keyed MAC)");
  // PROVE tamper-evidence: corrupting a batch's records must FAIL verifyChain (the recomputed
  // batchHash no longer matches the stored one). NB: under a public/zero key a key-knowing attacker
  // could re-forge — this proves CORRUPTION-DETECTION, not secrecy (a real deployment sets a secret hmacKey).
  const tampered = JSON.parse(JSON.stringify(batches));
  const victim = tampered.find((b) => Array.isArray(b.records) && b.records.length > 0) ?? tampered[0];
  if (victim && Array.isArray(victim.records) && victim.records.length > 0) {
    victim.records[0] = `${String(victim.records[0])}::FORGED`;
  } else if (victim) {
    victim.batchHash = "0".repeat(64);
  }
  assert.equal(AuditEgress.verifyChain(tampered), false, "a tampered batch FAILS verifyChain (corruption is detected)");
});

test("LSP down-tiers the kernel when the thermal envelope is breached", () => {
  const hot = new PowerGovernor(AEROSPACE_ENVELOPE, { sensor: () => 90 }); // > safeC (85)
  const d = hot.evaluate();
  assert.equal(d.state, "SAFETY");
  assert.equal(d.kernel, "shadow", "hot → shadow kernel (graceful degradation)");
  assert.equal(hot.requestAdjustment("native").granted, false, "cannot run native while hot");
});

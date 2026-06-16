// certified-profile.test.mjs — the P9 Certified Runtime Profile fails CLOSED.
//
// Converts scattered optional governance into one mandatory mode. In certified
// mode the engine refuses to run unless every safety invariant is satisfied.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHybridEngine, AuditLogger, generateHybridAttestationKeypair, attestBridgeHybrid, StubTernaryBridge } from "../dist/index.js";
import { AuditEgress } from "../../logicn-core-sentinel-egress/dist/index.js";

let c = 0;
const dir = () => `build/cert-${process.pid}-${++c}`;
const realKey = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const fullGov = { approvedModels: ["bitnet_b1_58_2b"], maxNewTokens: 256, maxTokenCost: "GBP0.05", denyHostNativeFallback: true };

// Certified mode now mandates signed-bridge attestation AND the post-quantum half
// (hybrid Ed25519+ML-DSA-65 — no PQ downgrade, audit CRYPTO-001). One hybrid keypair for
// the file; a hybrid-signed ternary registry + the matching policy satisfy the construction gate.
const { publicKeyPem, privateKeyPem, mlDsaPublicKey, mlDsaPrivateKey } = await generateHybridAttestationKeypair();
const attPolicy = { requireSigned: true, publicKeyPem, mlDsaPublicKey };
async function signedTernaryRegistry() {
  const b = await attestBridgeHybrid(new StubTernaryBridge(), privateKeyPem, mlDsaPrivateKey);
  return new Map([[b.technique, b]]);
}

function caught(fn) { try { fn(); return null; } catch (e) { return e; } }

test("certified profile fails CLOSED at construction without a governed egress sink", () => {
  const err = caught(() => createHybridEngine({ certified: true, governance: fullGov, attestation: attPolicy }));
  assert.ok(err, "certified mode must refuse direct-fs audit");
  assert.match(String(err.message), /ERR_CERTIFIED_NO_EGRESS/);
});

test("certified profile fails CLOSED at construction without a signed-bridge attestation policy", () => {
  const egress = new AuditEgress({ dir: dir(), batchSize: 8, hmacKey: realKey });
  // egress present, but no attestation → the bridge registry would be trusted.
  const err = caught(() => createHybridEngine({ certified: true, auditEgress: egress, governance: fullGov }));
  assert.ok(err, "certified mode must refuse an unattested bridge registry");
  assert.match(String(err.message), /ERR_CERTIFIED_NO_ATTESTATION/);
  // an attestation policy that does not actually verify signatures is also refused
  const err2 = caught(() => createHybridEngine({ certified: true, auditEgress: egress, governance: fullGov, attestation: { allowedHashes: ["a".repeat(64)] } }));
  assert.match(String(err2.message), /ERR_CERTIFIED_NO_ATTESTATION/);
});

test("certified profile fails CLOSED without the post-quantum (ML-DSA) public key — no PQ downgrade (CRYPTO-001)", () => {
  const egress = new AuditEgress({ dir: dir(), batchSize: 8, hmacKey: realKey });
  // requireSigned + Ed25519 publicKeyPem present, but NO mlDsaPublicKey: certified mode would
  // otherwise dispatch to the classical Ed25519-only verifier and silently drop the PQ guarantee.
  const err = caught(() => createHybridEngine({ certified: true, auditEgress: egress, governance: fullGov, attestation: { requireSigned: true, publicKeyPem } }));
  assert.ok(err, "certified mode must refuse an Ed25519-only attestation policy");
  assert.match(String(err.message), /ERR_CERTIFIED_NO_PQ_KEY/);
});

test("certified profile traps a call missing the model (allow-list mandatory)", async () => {
  const egress = new AuditEgress({ dir: dir(), batchSize: 8, hmacKey: realKey });
  const eng = createHybridEngine({ certified: true, auditEgress: egress, governance: fullGov, bridges: await signedTernaryRegistry(), attestation: attPolicy });
  const r = await eng.infer({ prompt: "x", correlationId: "c1", maxNewTokens: 10 }); // no model
  assert.equal(r.trapFired, true);
  assert.equal(r.trapCode, "ERR_AI_MODEL_REQUIRED");
});

test("certified profile traps when max_tokens is absent from governance", async () => {
  const egress = new AuditEgress({ dir: dir(), batchSize: 8, hmacKey: realKey });
  const eng = createHybridEngine({ certified: true, auditEgress: egress, governance: { approvedModels: ["m"], maxTokenCost: "GBP0.05", denyHostNativeFallback: true }, bridges: await signedTernaryRegistry(), attestation: attPolicy });
  const r = await eng.infer({ prompt: "x", correlationId: "c2", model: "m" });
  assert.equal(r.trapFired, true);
  assert.equal(r.trapCode, "ERR_CERTIFIED_NO_TOKEN_BUDGET");
});

test("certified profile: a fully-specified ternary-only call is permitted", async () => {
  const egress = new AuditEgress({ dir: dir(), batchSize: 8, hmacKey: realKey });
  const eng = createHybridEngine({ certified: true, auditEgress: egress, governance: fullGov, bridges: await signedTernaryRegistry(), attestation: attPolicy });
  // Only ternary-routed ops (a bridge exists for them) — no host-native needed.
  const r = await eng.infer({ prompt: "x", correlationId: "c3", model: "bitnet_b1_58_2b", maxNewTokens: 128, opClasses: ["embedding", "feedforward"] });
  assert.equal(r.trapFired, false);
  assert.ok(r.bridgesUsed.includes("stub-ternary"));
});

test("certified profile traps an UNATTESTED bridge in the registry (ERR_BRIDGE_UNATTESTED)", async () => {
  const egress = new AuditEgress({ dir: dir(), batchSize: 8, hmacKey: realKey });
  // default stub registry — bridges carry a manifest but no signature.
  const eng = createHybridEngine({ certified: true, auditEgress: egress, governance: fullGov, attestation: attPolicy });
  const r = await eng.infer({ prompt: "x", correlationId: "c3u", model: "bitnet_b1_58_2b", maxNewTokens: 128, opClasses: ["embedding", "feedforward"] });
  assert.equal(r.trapFired, true);
  assert.equal(r.trapCode, "ERR_BRIDGE_UNATTESTED");
});

test("certified profile: the STANDARD plan correctly traps (fp8/fp16 ops have no bridge)", async () => {
  const egress = new AuditEgress({ dir: dir(), batchSize: 8, hmacKey: realKey });
  const eng = createHybridEngine({ certified: true, auditEgress: egress, governance: fullGov, bridges: await signedTernaryRegistry(), attestation: attPolicy });
  // Standard transformer plan routes normalization/output_head → fp16/fp8 (no bridge).
  const r = await eng.infer({ prompt: "x", correlationId: "c3b", model: "bitnet_b1_58_2b", maxNewTokens: 128 });
  assert.equal(r.trapFired, true);
  assert.equal(r.trapCode, "ERR_HOST_NATIVE_DENIED", "certified deployment must supply a bridge for every routed precision");
});

test("max_tokens budget is enforced (over-budget request traps)", async () => {
  const eng = createHybridEngine({ governance: { maxNewTokens: 100 } });
  const r = await eng.infer({ prompt: "x", correlationId: "c4", maxNewTokens: 500 });
  assert.equal(r.trapFired, true);
  assert.equal(r.trapCode, "ERR_AI_TOKEN_BUDGET");
});

test("AuditEgress strictKey rejects the all-zero development key", () => {
  const err = caught(() => new AuditEgress({ dir: dir(), batchSize: 4, strictKey: true })); // no key → zero
  assert.ok(err);
  assert.match(String(err.code ?? err.message), /EGR-KEY-001/);
  // a real key is accepted
  assert.doesNotThrow(() => new AuditEgress({ dir: dir(), batchSize: 4, strictKey: true, hmacKey: realKey }));
});

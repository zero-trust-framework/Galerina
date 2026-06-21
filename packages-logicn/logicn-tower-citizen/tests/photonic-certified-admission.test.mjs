// Certified-mode PHOTONIC admission. Certified mode normally bars the photonic lane (the dev emulator is an
// unattested tolerance backend). It is admitted in certified mode ONLY when a VERIFIED certified attestation
// is supplied (attested ∧ certificationProfile="certified" ∧ toleranceWitnessed). Fail-closed otherwise.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createHybridEngine, generateHybridAttestationKeypair, attestBridgeHybrid, StubTernaryBridge,
} from "../dist/index.js";
import { createPhotonicRouterPort } from "../../logicn-ext-photonic-emulator/dist/index.js";
import { AuditEgress } from "../../logicn-core-sentinel-egress/dist/index.js";

let c = 0;
const dir = () => `build/cert-photonic-${process.pid}-${++c}`;
const realKey = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const fullGov = { approvedModels: ["bitnet_b1_58_2b"], maxNewTokens: 256, maxTokenCost: "GBP0.05", denyHostNativeFallback: true };
const { publicKeyPem, privateKeyPem, mlDsaPublicKey, mlDsaPrivateKey } = await generateHybridAttestationKeypair();
const attPolicy = { requireSigned: true, publicKeyPem, mlDsaPublicKey };
async function signedTernaryRegistry() {
  const b = await attestBridgeHybrid(new StubTernaryBridge(), privateKeyPem, mlDsaPrivateKey);
  return new Map([[b.technique, b]]);
}
const bigKernel = () => ({ n: 1024, lane: "photonic", tolerance: 0.05 });
const CALL = { prompt: "x", correlationId: "cp", model: "bitnet_b1_58_2b", maxNewTokens: 128, opClasses: ["embedding", "feedforward"] };
const GOOD_ATTESTATION = { attested: true, certificationProfile: "certified", toleranceWitnessed: true };

async function certifiedEngine(photonic) {
  return createHybridEngine({
    certified: true, auditEgress: new AuditEgress({ dir: dir(), batchSize: 8, hmacKey: realKey }),
    governance: fullGov, bridges: await signedTernaryRegistry(), attestation: attPolicy, photonic,
  });
}

test("certified + a VERIFIED attestation admits the photonic lane", async () => {
  const eng = await certifiedEngine({ router: createPhotonicRouterPort(), kernelFor: bigKernel, certifiedAttestation: GOOD_ATTESTATION });
  const r = await eng.infer(CALL);
  assert.equal(r.trapFired, false);
  assert.ok(r.bridgesUsed.some((b) => b.startsWith("photonic:")), `expected a photonic: bridge, got ${JSON.stringify(r.bridgesUsed)}`);
});

test("certified + NO attestation keeps the photonic lane OFF (the safe default, unchanged)", async () => {
  const eng = await certifiedEngine({ router: createPhotonicRouterPort(), kernelFor: bigKernel }); // no certifiedAttestation
  const r = await eng.infer(CALL);
  assert.equal(r.trapFired, false);
  assert.ok(!r.bridgesUsed.some((b) => b.startsWith("photonic:")), `photonic must stay off; got ${JSON.stringify(r.bridgesUsed)}`);
  assert.ok(r.bridgesUsed.includes("stub-ternary"));
});

test("certified + an INVALID attestation fails closed (each of: unattested / wrong-profile / not-witnessed)", async () => {
  const invalids = [
    { attested: false, certificationProfile: "certified", toleranceWitnessed: true },   // not attested
    { attested: true, certificationProfile: "dev", toleranceWitnessed: true },           // dev profile
    { attested: true, certificationProfile: "certified", toleranceWitnessed: false },    // band not witnessed
  ];
  for (const certifiedAttestation of invalids) {
    const eng = await certifiedEngine({ router: createPhotonicRouterPort(), kernelFor: bigKernel, certifiedAttestation });
    const r = await eng.infer(CALL);
    assert.ok(!r.bridgesUsed.some((b) => b.startsWith("photonic:")),
      `invalid attestation ${JSON.stringify(certifiedAttestation)} must keep photonic OFF; got ${JSON.stringify(r.bridgesUsed)}`);
  }
});

test("control: NON-certified mode runs photonic without any attestation (existing behaviour unchanged)", async () => {
  const eng = createHybridEngine({ auditInMemory: true, photonic: { router: createPhotonicRouterPort(), kernelFor: bigKernel } });
  const r = await eng.infer({ ...CALL, correlationId: "np" });
  assert.ok(r.bridgesUsed.some((b) => b.startsWith("photonic:")), `non-certified photonic should run; got ${JSON.stringify(r.bridgesUsed)}`);
});

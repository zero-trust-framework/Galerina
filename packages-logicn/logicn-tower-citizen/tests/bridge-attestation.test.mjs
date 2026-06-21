// bridge-attestation.test.mjs — CF-3 / CF-7: the bridge registry is no longer
// trusted input. A bridge must present a valid signed/pinned manifest or it is
// denied (ERR_BRIDGE_UNATTESTED) before any compute.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createHybridEngine, StubTernaryBridge, AuditLogger,
  signManifest, verifyAttestation, generateAttestationKeypair, attestBridge, attestationHash,
} from "../dist/index.js";

const cid = (s) => `ATT-${s}-${process.pid}-${Math.random().toString(36).slice(2, 7)}`;
const inMem = () => new AuditLogger(null);

test("verifyAttestation: signed manifest verifies; tampered fails", () => {
  const { publicKeyPem, privateKeyPem } = generateAttestationKeypair();
  const bridge = new StubTernaryBridge(inMem());
  const att = signManifest(bridge.manifest, privateKeyPem);

  assert.equal(verifyAttestation(att, { requireSigned: true, publicKeyPem }).ok, true);
  // tamper the manifest after signing → signature no longer matches
  const forged = { manifest: { ...att.manifest, hardwareIdentity: "evil-kernel" }, signature: att.signature };
  assert.equal(verifyAttestation(forged, { requireSigned: true, publicKeyPem }).ok, false);
  // missing attestation → denied
  assert.equal(verifyAttestation(undefined, { requireSigned: true, publicKeyPem }).ok, false);
  // a different key cannot verify
  const other = generateAttestationKeypair();
  assert.equal(verifyAttestation(att, { requireSigned: true, publicKeyPem: other.publicKeyPem }).ok, false);
});

test("verifyAttestation: a validly-signed but REVOKED signing key is refused (fail-closed)", () => {
  const { publicKeyPem, privateKeyPem } = generateAttestationKeypair();
  const att = signManifest(new StubTernaryBridge(inMem()).manifest, privateKeyPem);
  const REVOKED = "8eecf4187ebc9341";

  // Valid signature, but the asserted signer keyId is revoked → DENY (mirrors the fuse gate).
  const denied = verifyAttestation(att, {
    requireSigned: true, publicKeyPem, signerKeyId: REVOKED, revocationCheck: (k) => k === REVOKED,
  });
  assert.equal(denied.ok, false);
  assert.match(denied.reason, /REVOKED/);

  // A non-revoked signer still verifies.
  assert.equal(
    verifyAttestation(att, { requireSigned: true, publicKeyPem, signerKeyId: "ab46f4c7e2797b9b", revocationCheck: (k) => k === REVOKED }).ok,
    true,
  );

  // A THROWING revocation check (untrustworthy/tampered registry) is itself fail-closed.
  const failClosed = verifyAttestation(att, {
    requireSigned: true, publicKeyPem, signerKeyId: REVOKED, revocationCheck: () => { throw new Error("registry untrusted"); },
  });
  assert.equal(failClosed.ok, false);
  assert.match(failClosed.reason, /could not be determined/);

  // Absent revocation fields ⇒ no revocation gate (backward-compatible).
  assert.equal(verifyAttestation(att, { requireSigned: true, publicKeyPem }).ok, true);
});

test("hash pinning: only a pinned manifest hash passes", () => {
  const bridge = new StubTernaryBridge(inMem());
  const att = { manifest: bridge.manifest };
  const good = attestationHash(bridge.manifest);
  assert.equal(verifyAttestation(att, { allowedHashes: [good] }).ok, true);
  assert.equal(verifyAttestation(att, { allowedHashes: ["b".repeat(64)] }).ok, false);
});

test("engine DENIES an unattested bridge under an attestation policy", async () => {
  const { publicKeyPem } = generateAttestationKeypair();
  // default stub registry — bridges have a manifest but NO signature.
  const eng = createHybridEngine({ airGapped: true, governanceTier: 1, attestation: { requireSigned: true, publicKeyPem } });
  const r = await eng.infer({ prompt: "x", correlationId: cid("deny"), opClasses: ["feedforward"] });
  assert.equal(r.trapFired, true);
  assert.equal(r.trapCode, "ERR_BRIDGE_UNATTESTED");
});

test("engine PERMITS an attested (signed) bridge registry", async () => {
  const { publicKeyPem, privateKeyPem } = generateAttestationKeypair();
  const signed = attestBridge(new StubTernaryBridge(inMem()), privateKeyPem);
  const registry = new Map([[signed.technique, signed]]);
  const eng = createHybridEngine({
    airGapped: true, governanceTier: 1, bridges: registry,
    attestation: { requireSigned: true, publicKeyPem },
  });
  const r = await eng.infer({ prompt: "x", correlationId: cid("ok"), opClasses: ["feedforward"] });
  assert.equal(r.trapFired, false);
  assert.ok(r.bridgesUsed.includes("stub-ternary"));
});

test("no attestation policy ⇒ unchanged behaviour (back-compat)", async () => {
  const eng = createHybridEngine({ airGapped: true, governanceTier: 1 });
  const r = await eng.infer({ prompt: "x", correlationId: cid("compat"), opClasses: ["feedforward"] });
  assert.equal(r.trapFired, false);
});

test("verifyAttestation ENFORCES the #201 manifest checks end-to-end (fail-closed via validateManifestShape)", () => {
  // Proves the #201 calibration-as-attestation checks are wired into the Tower's admission gate
  // (verifyAttestation calls validateManifestShape first), not just unit-tested in the contract pkg.
  const base = new StubTernaryBridge(inMem()).manifest;
  const H64 = "a".repeat(64);
  assert.equal(verifyAttestation({ manifest: base }, {}).ok, true, "valid base manifest is admitted");
  // injectivity: a non-finite tolerance is rejected at admission (attestation hash safety)
  assert.equal(verifyAttestation({ manifest: { ...base, tolerance: Infinity } }, {}).ok, false, "non-finite tolerance denied");
  // fidelity floor: measured below the declared floor is denied
  assert.equal(verifyAttestation({ manifest: { ...base, minFidelity: 0.9, measuredFidelity: 0.5 } }, {}).ok, false, "measured below fidelity floor denied");
  // witness invariant: a declared tolerance tighter than the measured epsilon is denied
  const tighter = { ...base, determinismMode: "tolerance", tolerance: 1e-7, pinnedEnvHash: H64, backendArtifactHash: H64,
    toleranceWitness: { redundancyN: 8, epsilonMeasured: 1e-6, stdDev: 1e-7, noiseModelId: "m" } };
  assert.equal(verifyAttestation({ manifest: tighter }, {}).ok, false, "tolerance tighter than measured epsilon denied");
});

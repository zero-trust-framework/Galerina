// bridge-attestation-hybrid.test.mjs — #34: hybrid Ed25519 + ML-DSA-65 bridge attestation.
// Both signatures over the canonical manifest pre-image; verification requires BOTH (no
// downgrade). The ML-DSA half is bound to a per-surface FIPS-204 domain-separation context.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  StubTernaryBridge, AuditLogger,
  signManifest, verifyAttestation,
  signManifestHybrid, verifyAttestationHybrid, generateHybridAttestationKeypair, generateAttestationKeypair,
} from "../dist/index.js";

const inMem = () => new AuditLogger(null);

test("hybrid: signs both halves and verifies both", async () => {
  const k = await generateHybridAttestationKeypair();
  const att = await signManifestHybrid(new StubTernaryBridge(inMem()).manifest, k.privateKeyPem, k.mlDsaPrivateKey);
  assert.ok(typeof att.signature === "string" && typeof att.mlDsaSignature === "string", "carries both signatures");
  assert.equal((await verifyAttestationHybrid(att, { publicKeyPem: k.publicKeyPem }, k.mlDsaPublicKey)).ok, true);
});

test("hybrid: tampered manifest fails closed", async () => {
  const k = await generateHybridAttestationKeypair();
  const att = await signManifestHybrid(new StubTernaryBridge(inMem()).manifest, k.privateKeyPem, k.mlDsaPrivateKey);
  const forged = { ...att, manifest: { ...att.manifest, hardwareIdentity: "evil-kernel" } };
  assert.equal((await verifyAttestationHybrid(forged, { publicKeyPem: k.publicKeyPem }, k.mlDsaPublicKey)).ok, false);
});

test("hybrid: wrong ML-DSA key fails (both signatures required)", async () => {
  const k = await generateHybridAttestationKeypair();
  const other = await generateHybridAttestationKeypair();
  const att = await signManifestHybrid(new StubTernaryBridge(inMem()).manifest, k.privateKeyPem, k.mlDsaPrivateKey);
  assert.equal((await verifyAttestationHybrid(att, { publicKeyPem: k.publicKeyPem }, other.mlDsaPublicKey)).ok, false);
});

test("hybrid: wrong Ed25519 key fails", async () => {
  const k = await generateHybridAttestationKeypair();
  const other = await generateHybridAttestationKeypair();
  const att = await signManifestHybrid(new StubTernaryBridge(inMem()).manifest, k.privateKeyPem, k.mlDsaPrivateKey);
  assert.equal((await verifyAttestationHybrid(att, { publicKeyPem: other.publicKeyPem }, k.mlDsaPublicKey)).ok, false);
});

test("hybrid: an Ed25519-only attestation is rejected by the hybrid verifier (no downgrade)", async () => {
  const ed = generateAttestationKeypair();
  const k = await generateHybridAttestationKeypair();
  const edOnly = signManifest(new StubTernaryBridge(inMem()).manifest, ed.privateKeyPem); // no mlDsaSignature
  assert.equal((await verifyAttestationHybrid(edOnly, { publicKeyPem: ed.publicKeyPem }, k.mlDsaPublicKey)).ok, false);
});

test("classical verifyAttestation still accepts the Ed25519 half of a hybrid attestation (backward compat)", async () => {
  const k = await generateHybridAttestationKeypair();
  const att = await signManifestHybrid(new StubTernaryBridge(inMem()).manifest, k.privateKeyPem, k.mlDsaPrivateKey);
  assert.equal(verifyAttestation(att, { requireSigned: true, publicKeyPem: k.publicKeyPem }).ok, true);
});

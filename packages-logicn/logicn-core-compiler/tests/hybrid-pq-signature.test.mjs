/**
 * Phase 55 — Hybrid Ed25519 + ML-DSA-65 governance signatures.
 *
 * Closes a coverage gap: signProofGraphHybrid / verifyGovernanceSignatureHybrid /
 * generateHybridGovernanceKeyPair shipped with ZERO tests. The post-quantum signing
 * path is the backbone of the quantum-resistance posture (R2: "migrate to
 * post-quantum, prefer hybrid Ed25519 + ML-DSA-65"), so it must be exercised.
 *
 * This proves the path round-trips, fails CLOSED, and — critically — that BOTH
 * signatures are required (neither the classical Ed25519 nor the PQ ML-DSA-65 half
 * alone suffices). That AND-property is exactly the defense-in-depth the posture
 * promises: the artifact stays secure if EITHER scheme survives a break.
 *
 * Note: ML-DSA-65 signing is randomized (FIPS 204 hedged default), so we assert
 * round-trip VERIFICATION rather than signature byte-equality. Keygen is
 * deterministic from a seed and is covered by @noble/post-quantum's own KATs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildProofGraph, computeExecutionSignature,
  signProofGraph, signProofGraphHybrid,
  verifyGovernanceSignature, verifyGovernanceSignatureHybrid,
  generateGovernanceKeyPair, generateHybridGovernanceKeyPair,
} from "../dist/index.js";

const mkPg = (name) =>
  buildProofGraph(
    name,
    computeExecutionSignature(1, 2, 3, 4, 5, 1, 0, false),
    [],
    [],
    "2026-01-01T00:00:00Z",
  );

describe("Phase 55: hybrid Ed25519 + ML-DSA-65 governance signature", () => {
  it("generateHybridGovernanceKeyPair yields both Ed25519 and ML-DSA-65 material", async () => {
    const kp = await generateHybridGovernanceKeyPair("hk1");
    assert.equal(kp.algorithm, "hybrid-ed25519-mldsa65");
    assert.equal(kp.keyId, "hk1");
    assert.ok(kp.privateKey instanceof Uint8Array && kp.privateKey.length > 0);
    assert.ok(kp.publicKey instanceof Uint8Array && kp.publicKey.length > 0);
    assert.ok(kp.mlDsaPrivateKey instanceof Uint8Array && kp.mlDsaPrivateKey.length > 0);
    assert.ok(kp.mlDsaPublicKey instanceof Uint8Array && kp.mlDsaPublicKey.length > 0);
  });

  it("signProofGraphHybrid produces a v2 (hybrid) signature carrying both parts", async () => {
    const kp = await generateHybridGovernanceKeyPair("hk2");
    const signed = await signProofGraphHybrid(mkPg("flow"), kp);
    assert.equal(signed.governanceSignature?.algorithm, "lln.gov.sig.v2");
    assert.equal(signed.governanceSignature?.signerKeyId, "hk2");
    const parts = (signed.governanceSignature?.signature ?? "").split("|");
    assert.equal(parts.length, 2, "signature carries both Ed25519 and ML-DSA-65 parts");
    assert.ok(parts[0].length > 0 && parts[1].length > 0);
  });

  it("verifyGovernanceSignatureHybrid round-trips when both signatures are valid", async () => {
    const kp = await generateHybridGovernanceKeyPair("hk3");
    const signed = await signProofGraphHybrid(mkPg("roundtrip"), kp);
    assert.equal(
      await verifyGovernanceSignatureHybrid(signed, kp.publicKey, kp.mlDsaPublicKey),
      true,
    );
  });

  it("fails closed on a tampered flowName", async () => {
    const kp = await generateHybridGovernanceKeyPair("hk4");
    const signed = await signProofGraphHybrid(mkPg("legit"), kp);
    const tampered = { ...signed, flowName: "evil" };
    assert.equal(
      await verifyGovernanceSignatureHybrid(tampered, kp.publicKey, kp.mlDsaPublicKey),
      false,
    );
  });

  it("fails closed on a wrong Ed25519 public key", async () => {
    const kp = await generateHybridGovernanceKeyPair("hk5");
    const other = await generateHybridGovernanceKeyPair("hk5-other");
    const signed = await signProofGraphHybrid(mkPg("flow"), kp);
    assert.equal(
      await verifyGovernanceSignatureHybrid(signed, other.publicKey, kp.mlDsaPublicKey),
      false,
    );
  });

  it("fails closed on a wrong ML-DSA-65 public key (the PQ half is actually checked)", async () => {
    const kp = await generateHybridGovernanceKeyPair("hk6");
    const other = await generateHybridGovernanceKeyPair("hk6-other");
    const signed = await signProofGraphHybrid(mkPg("flow"), kp);
    // Correct Ed25519 key, WRONG ML-DSA key — must still fail: both are required.
    assert.equal(
      await verifyGovernanceSignatureHybrid(signed, kp.publicKey, other.mlDsaPublicKey),
      false,
    );
  });

  it("both signatures are required — a valid Ed25519 half spliced onto a foreign ML-DSA half is rejected", async () => {
    const kp = await generateHybridGovernanceKeyPair("hk7");
    const signed = await signProofGraphHybrid(mkPg("flow"), kp);
    const edPart = signed.governanceSignature.signature.split("|")[0];
    // Another signer's valid ML-DSA signature over the *same* payload.
    const other = await generateHybridGovernanceKeyPair("hk7-other");
    const otherSigned = await signProofGraphHybrid(mkPg("flow"), other);
    const otherMlPart = otherSigned.governanceSignature.signature.split("|")[1];
    const spliced = {
      ...signed,
      governanceSignature: {
        ...signed.governanceSignature,
        signature: `${edPart}|${otherMlPart}`,
      },
    };
    assert.equal(
      await verifyGovernanceSignatureHybrid(spliced, kp.publicKey, kp.mlDsaPublicKey),
      false,
    );
  });

  it("rejects a v1 (Ed25519-only) signature presented to the hybrid verifier", async () => {
    const edKp = generateGovernanceKeyPair("v1key");
    const signedV1 = signProofGraph(mkPg("flow"), edKp);
    const hk = await generateHybridGovernanceKeyPair("hk8");
    // v1 carries no "|" separator and declares lln.gov.sig.v1 — the hybrid verifier
    // must refuse it rather than silently accept a non-PQ signature.
    assert.equal(
      await verifyGovernanceSignatureHybrid(signedV1, edKp.publicKey, hk.mlDsaPublicKey),
      false,
    );
  });

  it("signProofGraphHybrid falls back to v1 for a non-hybrid (Ed25519-only) key", async () => {
    const edKp = generateGovernanceKeyPair("v1fallback");
    const signed = await signProofGraphHybrid(mkPg("flow"), edKp);
    // Documented fallback: a plain Ed25519 key yields an Ed25519-only v1 signature.
    assert.equal(signed.governanceSignature?.algorithm, "lln.gov.sig.v1");
    assert.equal(verifyGovernanceSignature(signed, edKp.publicKey), true);
  });

  it("sync verifyGovernanceSignature REJECTS a v2 signature (no silent PQ downgrade)", async () => {
    // No-downgrade hardening: the sync path can only check the classical Ed25519 half of a
    // v2 signature, which would silently drop the post-quantum guarantee. So it now REFUSES
    // v2 outright — callers must use the async verifyGovernanceSignatureHybrid for hybrid sigs.
    const kp = await generateHybridGovernanceKeyPair("hk9");
    const signed = await signProofGraphHybrid(mkPg("flow"), kp);
    assert.equal(verifyGovernanceSignature(signed, kp.publicKey), false);
  });
});

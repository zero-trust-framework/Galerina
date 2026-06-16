/**
 * #34 — audit attestation hybrid Ed25519 + ML-DSA-65 (FIPS 204, @noble/post-quantum).
 *
 * Mirrors the ProofGraph governance-signature hybrid: sign the SAME canonical pre-image with
 * BOTH primitives, encode "<ed25519-b64>|<ml-dsa-65-b64>", verification requires BOTH (no
 * downgrade). The ML-DSA half is bound to a per-surface FIPS-204 domain-separation context.
 * (Signing is randomized — assert round-trip verification, not signature byte-equality.)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildAttestation, signAttestation, verifyAttestation, generateAttestationKey,
  signAttestationHybrid, verifyAttestationHybrid, generateHybridAttestationKey,
} from "../dist/index.js";

const mkAtt = () => buildAttestation({ flowName: "f", sourceText: "let x = 1", contractSource: "contract {}" });

describe("audit attestation — hybrid Ed25519 + ML-DSA-65 (#34)", () => {
  it("generateHybridAttestationKey yields both Ed25519 (PEM) and ML-DSA-65 material", async () => {
    const k = await generateHybridAttestationKey("ak1");
    assert.equal(k.keyId, "ak1");
    assert.ok(k.privateKey.includes("PRIVATE KEY") && k.publicKey.includes("PUBLIC KEY"));
    assert.ok(k.mlDsaPrivateKey instanceof Uint8Array && k.mlDsaPrivateKey.length > 0);
    assert.ok(k.mlDsaPublicKey instanceof Uint8Array && k.mlDsaPublicKey.length > 0);
  });

  it("signAttestationHybrid → algorithm 'Ed25519+ML-DSA-65' with a two-part value", async () => {
    const signed = await signAttestationHybrid(await mkAtt(), await generateHybridAttestationKey("ak2"));
    assert.equal(signed.signature?.algorithm, "Ed25519+ML-DSA-65");
    assert.equal(signed.signature?.value.split("|").length, 2);
  });

  it("verifyAttestationHybrid round-trips when both signatures are valid", async () => {
    const k = await generateHybridAttestationKey("ak3");
    const signed = await signAttestationHybrid(await mkAtt(), k);
    assert.equal(await verifyAttestationHybrid(signed, k.publicKey, k.mlDsaPublicKey), true);
  });

  it("fails closed on a tampered hash", async () => {
    const k = await generateHybridAttestationKey("ak4");
    const signed = await signAttestationHybrid(await mkAtt(), k);
    const tampered = { ...signed, hashes: { ...signed.hashes, source: "sha256:deadbeef" } };
    assert.equal(await verifyAttestationHybrid(tampered, k.publicKey, k.mlDsaPublicKey), false);
  });

  it("fails closed on a wrong Ed25519 key", async () => {
    const k = await generateHybridAttestationKey("ak5");
    const other = await generateHybridAttestationKey("ak5-other");
    const signed = await signAttestationHybrid(await mkAtt(), k);
    assert.equal(await verifyAttestationHybrid(signed, other.publicKey, k.mlDsaPublicKey), false);
  });

  it("fails closed on a wrong ML-DSA key (both signatures required)", async () => {
    const k = await generateHybridAttestationKey("ak6");
    const other = await generateHybridAttestationKey("ak6-other");
    const signed = await signAttestationHybrid(await mkAtt(), k);
    assert.equal(await verifyAttestationHybrid(signed, k.publicKey, other.mlDsaPublicKey), false);
  });

  it("rejects a v1 (Ed25519-only) attestation in the hybrid verifier (no downgrade)", async () => {
    const edK = generateAttestationKey("v1");
    const signedV1 = signAttestation(await mkAtt(), edK);
    const hk = await generateHybridAttestationKey("ak7");
    assert.equal(await verifyAttestationHybrid(signedV1, edK.publicKey, hk.mlDsaPublicKey), false);
  });

  it("existing Ed25519-only sign/verify still works (backward compatible)", async () => {
    const edK = generateAttestationKey("v1b");
    const signed = signAttestation(await mkAtt(), edK);
    assert.equal(signed.signature?.algorithm, "Ed25519");
    assert.equal(verifyAttestation(signed, edK.publicKey), true);
  });
});

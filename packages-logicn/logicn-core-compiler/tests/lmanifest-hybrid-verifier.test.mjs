// #49 production hybrid (Ed25519+ML-DSA-65) .lmanifest verifier — round-trip + fail-closed (no PQ downgrade).
// Signs a manifest envelope with the SHIPPED signer (generateHybridGovernanceKeyPair + signProofGraphHybrid),
// writes the public keys in the production file convention, and verifies via makeLmanifestHybridVerifier —
// proving the loader-side verifier (reusing makeManifestEnvelope + verifyGovernanceSignatureHybrid) accepts a
// genuine signature and fails CLOSED on tamper / missing-or-malformed PQ key (RD-0119/0120).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, createPublicKey } from "node:crypto";
import {
  generateHybridGovernanceKeyPair, makeManifestEnvelope, signProofGraphHybrid, makeLmanifestHybridVerifier,
} from "../dist/index.js";

const sha256hex = (buf) => createHash("sha256").update(buf).digest("hex");

async function fixture(keyId = "testkeyid0000001") {
  const kp = await generateHybridGovernanceKeyPair(keyId);
  const body = Buffer.from(`{"schema":"lln.manifest.v2","name":"demo","wasmSha256":"deadbeef"}`, "utf8");
  const bodyHash = sha256hex(body);
  // Sign the SAME envelope shape the loader-side verifier rebuilds (generatedAt is excluded from the payload).
  const env = makeManifestEnvelope(bodyHash, "2026-01-01T00:00:00.000Z");
  const signed = await signProofGraphHybrid(env, kp);
  const signature = signed.governanceSignature.signature;

  const root = mkdtempSync(join(tmpdir(), "lln-hv-"));
  const gov = join(root, "governance");
  mkdirSync(gov, { recursive: true });
  const edPem = createPublicKey({ key: kp.publicKey, format: "der", type: "spki" }).export({ type: "spki", format: "pem" });
  writeFileSync(join(gov, `signing-key-${keyId}.pub.pem`), edPem);
  writeFileSync(join(gov, `signing-key-${keyId}.mldsa.pub.b64`), Buffer.from(kp.mlDsaPublicKey).toString("base64") + "\n");
  return { root, gov, keyId, body, signature, kp };
}

const callInput = (f, over = {}) => ({
  keyId: f.keyId, algorithm: "Ed25519+ML-DSA-65", signingInput: f.body, signature: f.signature,
  governanceDir: f.gov, packageDir: f.root, ...over,
});

test("a genuine hybrid-signed .lmanifest VERIFIES (both halves, proofgraph context)", async () => {
  const f = await fixture();
  try {
    const verify = makeLmanifestHybridVerifier();
    assert.equal(await verify(callInput(f)), "verified");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("FAIL-CLOSED: a tampered body (different signingInput) is INVALID", async () => {
  const f = await fixture();
  try {
    const verify = makeLmanifestHybridVerifier();
    const tampered = Buffer.from(f.body.toString("utf8").replace("deadbeef", "cafebabe"), "utf8");
    assert.equal(await verify(callInput(f, { signingInput: tampered })), "invalid");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("NO PQ DOWNGRADE: a missing .mldsa.pub.b64 for a v2 manifest THROWS (hard deny)", async () => {
  const f = await fixture();
  try {
    rmSync(join(f.gov, `signing-key-${f.keyId}.mldsa.pub.b64`));
    const verify = makeLmanifestHybridVerifier();
    await assert.rejects(() => verify(callInput(f)), /LLN-FUSE-HYBRID-PQ-KEY-MISSING/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("FAIL-CLOSED: a malformed (wrong-length) ML-DSA key THROWS", async () => {
  const f = await fixture();
  try {
    writeFileSync(join(f.gov, `signing-key-${f.keyId}.mldsa.pub.b64`), Buffer.from("too-short").toString("base64"));
    const verify = makeLmanifestHybridVerifier();
    await assert.rejects(() => verify(callInput(f)), /LLN-FUSE-HYBRID-PQ-KEY-MALFORMED/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("no Ed25519 public key for the signer ⇒ UNVERIFIABLE (treated as unsigned by the loader)", async () => {
  const f = await fixture();
  try {
    const verify = makeLmanifestHybridVerifier();
    assert.equal(await verify(callInput(f, { keyId: "unknownkey00", signature: f.signature })), "unverifiable");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

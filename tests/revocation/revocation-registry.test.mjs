/**
 * Gap B — enforced signing-key revocation registry.
 * The compromised key 8eecf4187ebc9341 must evaluate to Deny (revoked), so a
 * manifest it signs is rejected at the verify gate even with a valid signature.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import {
  isKeyRevoked,
  loadRevokedKeyIds,
  signRegistryObject,
  verifyRegistryObject,
} from "../../governance/revocation-registry.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function ephemeralKey() {
  return generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

test("the compromised key 8eecf4187ebc9341 is revoked (→ Deny)", () => {
  assert.equal(isKeyRevoked("8eecf4187ebc9341", ROOT), true);
});

test("the active key ab46f4c7e2797b9b is NOT revoked", () => {
  assert.equal(isKeyRevoked("ab46f4c7e2797b9b", ROOT), false);
});

test("an unknown key id is not revoked", () => {
  assert.equal(isKeyRevoked("deadbeefdeadbeef", ROOT), false);
});

test("registry loads as a Set containing the revoked id", () => {
  const revoked = loadRevokedKeyIds(ROOT);
  assert.ok(revoked instanceof Set, "returns a Set");
  assert.ok(revoked.has("8eecf4187ebc9341"), "contains the compromised key");
});

// ── Tamper-evidence (self-signature) ──────────────────────────────────────
test("a signed registry verifies valid", () => {
  const { publicKey, privateKey } = ephemeralKey();
  const reg = { schemaVersion: 1, revoked: [{ keyId: "8eecf4187ebc9341" }] };
  const signed = signRegistryObject(reg, privateKey, "testkey");
  assert.equal(verifyRegistryObject(signed, publicKey).valid, true);
});

test("tampering the registry after signing INVALIDATES it (un-revoke is detected)", () => {
  const { publicKey, privateKey } = ephemeralKey();
  const reg = { schemaVersion: 1, revoked: [{ keyId: "8eecf4187ebc9341" }] };
  const signed = signRegistryObject(reg, privateKey, "testkey");
  // Attacker removes the revocation but keeps the old signature:
  const tampered = { ...signed, revoked: [] };
  assert.equal(verifyRegistryObject(tampered, publicKey).valid, false);
});

test("a different key cannot validate the signature", () => {
  const a = ephemeralKey();
  const b = ephemeralKey();
  const signed = signRegistryObject({ schemaVersion: 1, revoked: [] }, a.privateKey, "k");
  assert.equal(verifyRegistryObject(signed, b.publicKey).valid, false);
});

test("an unsigned registry reports signed:false (graceful, not a hard fail)", () => {
  assert.equal(verifyRegistryObject({ schemaVersion: 1, revoked: [] }, "").signed, false);
});

// ── v2 trust-anchor pinning (rogue-signer defense, revocation-registry-v0 §5) ──
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { assertRegistryTrustworthy, signRegistryObject as signReg } from "../../governance/revocation-registry.mjs";

function pinnedRoot(rootKeyId) {
  const d = mkdtempSync(join(tmpdir(), "lln-anchor-"));
  mkdirSync(join(d, "governance"), { recursive: true });
  writeFileSync(join(d, "governance", "trust-anchor.json"),
    JSON.stringify({ schemaVersion: 1, registrySigningRootKeyId: rootKeyId }));
  return d;
}
function writeSignedRegistry(d, signerKeyId, privatePem, publicPem) {
  writeFileSync(join(d, "governance", `signing-key-${signerKeyId}.pub.pem`), publicPem);
  const signed = signReg({ schemaVersion: 1, revoked: [{ keyId: "8eecf4187ebc9341" }] }, privatePem, signerKeyId);
  writeFileSync(join(d, "governance", "revocations.json"), JSON.stringify(signed, null, 2) + "\n");
}

test("v2: registry signed by the PINNED root → trusted", () => {
  const { publicKey, privateKey } = ephemeralKey();
  const d = pinnedRoot("rootkey");
  writeSignedRegistry(d, "rootkey", privateKey, publicKey);
  const t = assertRegistryTrustworthy(d);
  assert.equal(t.valid, true);
  assert.equal(t.pinned, true);
});

test("v2: ROGUE signer (valid sig, wrong key) is REJECTED when a root is pinned", () => {
  const rogue = ephemeralKey();
  const d = pinnedRoot("rootkey");               // pin = "rootkey"
  writeSignedRegistry(d, "roguekey", rogue.privateKey, rogue.publicKey); // signed by "roguekey"
  assert.throws(() => assertRegistryTrustworthy(d), /rogue-signer rejected|pinned trust anchor/);
});

test("v2: pinned root + UNSIGNED registry → fail closed", () => {
  const d = pinnedRoot("rootkey");
  writeFileSync(join(d, "governance", "revocations.json"),
    JSON.stringify({ schemaVersion: 1, revoked: [] }, null, 2));
  assert.throws(() => assertRegistryTrustworthy(d), /UNSIGNED.*pinned|pinned.*requires a signed/i);
});

test("v2: malformed trust-anchor.json → fail closed (does not silently drop pinning)", () => {
  const d = mkdtempSync(join(tmpdir(), "lln-anchor-bad-"));
  mkdirSync(join(d, "governance"), { recursive: true });
  writeFileSync(join(d, "governance", "trust-anchor.json"), "{ not json");
  writeFileSync(join(d, "governance", "revocations.json"),
    JSON.stringify({ schemaVersion: 1, revoked: [] }, null, 2));
  assert.throws(() => assertRegistryTrustworthy(d));
});

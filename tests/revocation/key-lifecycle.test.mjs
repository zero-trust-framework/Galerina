/**
 * Zero-touch key lifecycle — fail-safes, warning codes, and remediation.
 * A developer never handles keys; the assessor stays silent when healthy and surfaces a
 * coded diagnostic only when action is needed (stale=warn, revoked/tampered=fail-closed).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessSigningKey, provisionDevKey } from "../../governance/key-lifecycle.mjs";

function freshRoot() {
  const d = mkdtempSync(join(tmpdir(), "lln-key-"));
  mkdirSync(join(d, "governance"), { recursive: true });
  // Unsigned registry (graceful trust) listing one known-revoked key.
  writeFileSync(
    join(d, "governance", "revocations.json"),
    JSON.stringify({ schemaVersion: 1, revoked: [{ keyId: "revokedkey00000" }] }, null, 2)
  );
  return d;
}
function writeEnv(d, vars) {
  writeFileSync(
    join(d, ".env.logicn-signing"),
    Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n") + "\n",
    { mode: 0o600 }
  );
}
function writePub(d, keyId) {
  writeFileSync(join(d, "governance", `signing-key-${keyId}.pub.pem`),
    "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----\n");
}
const has = (r, code, sev) => r.diagnostics.some((x) => x.code === code && (!sev || x.severity === sev));

test("no key + dev → auto-provision (LLN-KEY-001 notice, not fatal)", () => {
  const r = assessSigningKey({ rootDir: freshRoot(), profile: "dev" });
  assert.equal(r.action, "auto-provision");
  assert.equal(r.fatal, false);
  assert.ok(has(r, "LLN-KEY-001", "notice"));
});

test("no key + production → fail-closed (LLN-KEY-001 error)", () => {
  const r = assessSigningKey({ rootDir: freshRoot(), profile: "production" });
  assert.equal(r.fatal, true);
  assert.equal(r.action, "fail-closed");
  assert.ok(has(r, "LLN-KEY-001", "error"));
});

test("revoked key → fail-closed (LLN-KEY-004), every diagnostic carries remediation", () => {
  const d = freshRoot();
  writeEnv(d, { LOGICN_SIGNING_KEY_ID: "revokedkey00000", LOGICN_SIGNING_PRIVATE_KEY_B64: "x" });
  writePub(d, "revokedkey00000");
  const r = assessSigningKey({ rootDir: d });
  assert.equal(r.fatal, true);
  assert.ok(has(r, "LLN-KEY-004"));
  assert.ok(r.diagnostics.every((x) => typeof x.fix === "string" && x.fix.length > 0));
});

test("fresh valid key → ok, silent (no diagnostics)", () => {
  const d = freshRoot();
  writeEnv(d, {
    LOGICN_SIGNING_KEY_ID: "freshkey0000001",
    LOGICN_SIGNING_KEY_CREATED: new Date().toISOString(),
    LOGICN_SIGNING_PRIVATE_KEY_B64: "x",
  });
  writePub(d, "freshkey0000001");
  const r = assessSigningKey({ rootDir: d });
  assert.equal(r.action, "ok");
  assert.equal(r.fatal, false);
  assert.equal(r.diagnostics.length, 0);
});

test("stale key → warning (LLN-KEY-002), NOT fatal (still usable while rotating)", () => {
  const d = freshRoot();
  const old = new Date(Date.now() - 200 * 86_400_000).toISOString();
  writeEnv(d, {
    LOGICN_SIGNING_KEY_ID: "stalekey0000001",
    LOGICN_SIGNING_KEY_CREATED: old,
    LOGICN_SIGNING_PRIVATE_KEY_B64: "x",
  });
  writePub(d, "stalekey0000001");
  const r = assessSigningKey({ rootDir: d, staleDays: 90 });
  assert.equal(r.fatal, false);
  assert.ok(has(r, "LLN-KEY-002", "warning"));
});

test("provisionDevKey is zero-touch: creates a key the assessor then accepts", () => {
  const d = freshRoot();
  const keyId = provisionDevKey(d);
  assert.ok(existsSync(join(d, ".env.logicn-signing")));
  assert.ok(existsSync(join(d, "governance", `signing-key-${keyId}.pub.pem`)));
  const r = assessSigningKey({ rootDir: d });
  assert.equal(r.action, "ok");
  assert.equal(r.keyId, keyId);
  assert.equal(r.diagnostics.length, 0);
});

/**
 * #34 — `logicn keygen --hybrid` operationalizes post-quantum signing.
 *
 * The CLI keygen was Ed25519-ONLY ("Stage B: ML-DSA-65 — upgrade once…"). This wires the shipped, tested
 * generateHybridGovernanceKeyPair into the offline ceremony. This test runs the REAL CLI in a temp dir,
 * reads the keys it wrote, reconstructs the keypair (exactly as a `sign` step would), and proves the
 * round-trip: keygen output → a usable v2 (hybrid Ed25519 + ML-DSA-65) signature that verifies, and
 * fails CLOSED on tamper. That proves the serialization (DER→PEM→b64 / raw→b64) is lossless.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicKey, createPrivateKey } from "node:crypto";

import {
  buildProofGraph, computeExecutionSignature,
  signProofGraphHybrid, verifyGovernanceSignatureHybrid,
} from "../dist/index.js";

const REPO = join(import.meta.dirname, "..", "..", "..");
const CLI = join(REPO, "logicn.mjs");

const mkPg = (name) =>
  buildProofGraph(name, computeExecutionSignature(1, 2, 3, 4, 5, 1, 0, false), [], [], "2026-01-01T00:00:00Z");

function envVal(env, key) {
  const m = env.match(new RegExp("^" + key + "=(.*)$", "m"));
  return m ? m[1].trim() : undefined;
}

test("logicn keygen --hybrid writes a usable hybrid (PQ) keypair that round-trips a v2 signature", async () => {
  const dir = mkdtempSync(join(tmpdir(), "logicn-keygen-hybrid-"));
  try {
    const r = spawnSync("node", [CLI, "keygen", "--hybrid"], { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0, `keygen --hybrid exited ${r.status}: ${r.stderr}`);

    // ── what the CLI wrote ──
    const gov = join(dir, "governance");
    const pubPemFile = readdirSync(gov).find((f) => f.endsWith(".pub.pem"));
    const mldsaPubFile = readdirSync(gov).find((f) => f.endsWith(".mldsa.pub.b64"));
    assert.ok(pubPemFile && mldsaPubFile, "both Ed25519 + ML-DSA public keys written");
    const env = readFileSync(join(dir, ".env.logicn-signing"), "utf8");
    assert.equal(envVal(env, "LOGICN_SIGNING_ALGORITHM"), "hybrid-ed25519-mldsa65");

    // ── reconstruct the keypair from the written files (exactly as a `sign` step would) ──
    const ed25519PrivPem = Buffer.from(envVal(env, "LOGICN_SIGNING_PRIVATE_KEY_B64"), "base64").toString("utf8");
    const kp = {
      keyId: envVal(env, "LOGICN_SIGNING_KEY_ID"),
      algorithm: "hybrid-ed25519-mldsa65",
      privateKey: new Uint8Array(createPrivateKey(ed25519PrivPem).export({ type: "pkcs8", format: "der" })),
      publicKey: new Uint8Array(createPublicKey(readFileSync(join(gov, pubPemFile), "utf8")).export({ type: "spki", format: "der" })),
      mlDsaPrivateKey: new Uint8Array(Buffer.from(envVal(env, "LOGICN_SIGNING_MLDSA_PRIVATE_KEY_B64"), "base64")),
      mlDsaPublicKey: new Uint8Array(Buffer.from(readFileSync(join(gov, mldsaPubFile), "utf8").trim(), "base64")),
    };

    // ── round-trip: the reconstructed key signs + verifies (proves lossless serialization) ──
    const signed = await signProofGraphHybrid(mkPg("ceremony"), kp);
    assert.equal(signed.governanceSignature?.algorithm, "lln.gov.sig.v2", "produces a v2 hybrid signature");
    assert.equal(await verifyGovernanceSignatureHybrid(signed, kp.publicKey, kp.mlDsaPublicKey), true,
      "the reconstructed-from-disk hybrid key verifies its own signature");

    // ── fail-closed on tamper ──
    const tampered = { ...signed, flowName: "evil" };
    assert.equal(await verifyGovernanceSignatureHybrid(tampered, kp.publicKey, kp.mlDsaPublicKey), false,
      "a tampered flow fails verification (fail-closed)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * #34 / 0102 — HYBRID manifest signing, full CLI round-trip through the REAL logicn.mjs.
 *
 * The keygen-hybrid sibling test proves the keypair serialization round-trips at the LIBRARY layer
 * (signProofGraphHybrid / verifyGovernanceSignatureHybrid). THIS test proves the WIRING through the
 * user-facing CLI end to end, so a regression in the build→sign→persist→verify plumbing is caught:
 *
 *   (1) keygen --hybrid                       mint a hybrid Ed25519+ML-DSA-65 key in a temp dir
 *   (2) write a PURE .lln flow returning Int  (no effects → fuses clean, signs over governance facts)
 *   (3) build under LOGICN_MANIFEST_PROFILE=certified (MANDATES hybrid; a classical-only key fail-closes)
 *         → the emitted build/<name>.lmanifest.json must be a both-half v2 hybrid signature
 *   (4) verify <flow>.lln                      exit 0 + output naming BOTH halves (Ed25519 AND ML-DSA-65)
 *   (5) flip a byte of the manifest body       verify FAILS CLOSED (exit 1, LLN-MANIFEST-TAMPER)
 *
 * Uses the EXISTING dist (no rebuild) — same posture as cli-keygen-hybrid.test.mjs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..", "..", "..");
const CLI = join(REPO, "logicn.mjs");

const run = (args, env, dir) =>
  spawnSync("node", [CLI, ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
const out = (r) => (r.stdout ?? "") + (r.stderr ?? "");

// A PURE flow: returns an Int, declares no effects → the compute body fuses cleanly and the manifest
// signs over the governance facts (no `unreachable` effect stubs needed). Keeps the round-trip about
// the SIGNATURE, not about compute lowering.
const PURE_FLOW = `flow answer() -> Int {
  return 42
}
`;

test("hybrid CLI round-trip: certified build emits a v2 both-half manifest, verify passes, tamper fails closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "logicn-hybrid-rt-"));
  try {
    // ── (1) keygen --hybrid — mints the hybrid keypair + .env.logicn-signing into the temp cwd. ──
    const kg = run(["keygen", "--hybrid"], {}, dir);
    assert.equal(kg.status, 0, `keygen --hybrid should exit 0: ${out(kg)}`);

    // ── (2) write the PURE Int flow. ──
    const lln = join(dir, "answer.lln");
    writeFileSync(lln, PURE_FLOW);

    // ── (3) build under certified — MANDATES the hybrid signature (no PQ downgrade). ──
    const build = run(["build", "answer.lln"], { LOGICN_MANIFEST_PROFILE: "certified" }, dir);
    assert.equal(build.status, 0, `certified build should succeed: ${out(build)}`);

    const jsonPath = join(dir, "build", "answer.lmanifest.json");
    const manifest = JSON.parse(readFileSync(jsonPath, "utf8"));

    // The persisted manifest is a v2 hybrid: a durable on-disk PQ signature fact.
    assert.equal(manifest.schemaVersion, "lln.manifest.v2", "certified hybrid manifest bumps to schema v2");
    const sig = manifest.governanceSignature;
    assert.ok(sig && typeof sig === "object", "manifest carries a governanceSignature");
    assert.equal(sig.algorithm, "Ed25519+ML-DSA-65", "both-half hybrid algorithm");
    assert.equal(sig.sigAlgorithm, "lln.gov.sig.v2", "v2 envelope signature version");
    assert.ok(typeof sig.signature === "string" && sig.signature.includes("|"),
      "the signature concatenates BOTH halves as '<ed25519>|<mldsa>'");

    // ── (4) verify — exit 0, output names BOTH crypto halves. ──
    const verify = run(["verify", "answer.lln"], {}, dir);
    assert.equal(verify.status, 0, `verify of a clean hybrid manifest should exit 0: ${out(verify)}`);
    const vout = out(verify);
    assert.match(vout, /Ed25519/, "verify output names the classical (Ed25519) half");
    assert.match(vout, /ML-DSA-65/, "verify output names the post-quantum (ML-DSA-65) half");
    assert.match(vout, /both halves/, "verify confirms both halves were checked");

    // ── (5) flip a byte of the manifest BODY (a signed field) and re-verify → FAIL CLOSED. ──
    // The signature is left intact; mutating any signed body field breaks the re-derived bodyHash, so
    // the verifier must reject (exit 1, LLN-MANIFEST-TAMPER) rather than admit a tampered manifest.
    const tampered = JSON.parse(readFileSync(jsonPath, "utf8"));
    tampered.flowCount = (tampered.flowCount ?? 0) + 1; // a one-field flip = "one byte" of the body
    writeFileSync(jsonPath, JSON.stringify(tampered, null, 2));

    const verifyTampered = run(["verify", "answer.lln"], {}, dir);
    assert.equal(verifyTampered.status, 1, `tampered manifest must fail closed (exit 1): ${out(verifyTampered)}`);
    assert.match(out(verifyTampered), /LLN-MANIFEST-TAMPER/,
      "tamper is reported as LLN-MANIFEST-TAMPER (fail-closed)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

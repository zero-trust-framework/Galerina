// sbom.test.mjs — CycloneDX SBOM emitter, fail-closed on missing integrity (R&D 0120-F3, LLN-SBOM-001).
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateCycloneDxSbom } from "../dist/index.js";

const HASH = "sha256:" + "a".repeat(64);
const pkg = (name, extra = {}) => ({ name, version: "1.0.0", exports: {}, hash: HASH, ...extra });

test("emits a well-formed CycloneDX 1.5 BOM with SHA-256 hashes for verified components", () => {
  const r = generateCycloneDxSbom([pkg("@logicn/core"), pkg("@logicn/cli")]);
  assert.equal(r.bom.bomFormat, "CycloneDX");
  assert.equal(r.bom.specVersion, "1.5");
  assert.equal(r.bom.components.length, 2);
  assert.deepEqual(r.bom.components[0].hashes, [{ alg: "SHA-256", content: "a".repeat(64) }]);
  assert.equal(r.complete, true);
  assert.equal(r.diagnostics.length, 0);
  assert.ok(r.bom.metadata.properties.some((p) => p.name === "logicn:complete" && p.value === "true"));
});

test("FAIL-CLOSED: a component without a valid sha256 is UNVERIFIED + LLN-SBOM-001 + complete:false", () => {
  const r = generateCycloneDxSbom([pkg("@logicn/core"), pkg("@logicn/bad", { hash: undefined })]);
  assert.equal(r.complete, false, "an unverifiable component must make the BOM incomplete");
  assert.equal(r.diagnostics.length, 1);
  assert.equal(r.diagnostics[0].code, "LLN-SBOM-001");
  assert.equal(r.diagnostics[0].component, "@logicn/bad@1.0.0");
  const bad = r.bom.components.find((c) => c.name === "@logicn/bad");
  assert.equal(bad.hashes, undefined, "no hashes entry for an unverifiable component (never fake integrity)");
  assert.ok(bad.properties.some((p) => p.name === "logicn:integrity" && p.value === "UNVERIFIED"));
  assert.ok(r.bom.metadata.properties.some((p) => p.name === "logicn:complete" && p.value === "false"));
});

test("FAIL-CLOSED: a malformed hash (sha256:pending / wrong length) is rejected, not trusted", () => {
  for (const bad of ["sha256:pending", "sha256:abc", "deadbeef", "sha256:" + "z".repeat(64)]) {
    const r = generateCycloneDxSbom([pkg("@logicn/x", { hash: bad })]);
    assert.equal(r.complete, false, `'${bad}' must be rejected`);
    assert.equal(r.diagnostics[0].code, "LLN-SBOM-001");
  }
});

test("carries the GOVERNANCE footprint as CycloneDX properties (registry/signer/effects/capabilities)", () => {
  const r = generateCycloneDxSbom([pkg("@logicn/pay", {
    registry: "https://reg.logicn.dev", signerKeyId: "k1", signature: "sig",
    effects: ["network.outbound", "audit.write"], capabilities: ["payment.charge"], installScript: "deny",
  })]);
  const p = r.bom.components[0].properties;
  const get = (n) => p.find((x) => x.name === n)?.value;
  assert.equal(get("logicn:registry"), "https://reg.logicn.dev");
  assert.equal(get("logicn:signerKeyId"), "k1");
  assert.equal(get("logicn:signed"), "true");
  assert.equal(get("logicn:effects"), "audit.write,network.outbound"); // sorted, deterministic
  assert.equal(get("logicn:capabilities"), "payment.charge");
  assert.equal(get("logicn:installScript"), "deny");
});

test("DETERMINISTIC: no wall-clock unless a timestamp is supplied; identical input → identical BOM", () => {
  const a = generateCycloneDxSbom([pkg("@logicn/core")]);
  const b = generateCycloneDxSbom([pkg("@logicn/core")]);
  assert.equal(JSON.stringify(a.bom), JSON.stringify(b.bom), "default emission must be byte-identical");
  assert.equal(a.bom.metadata.timestamp, undefined, "no timestamp by default (reproducible)");
  const t = generateCycloneDxSbom([pkg("@logicn/core")], { timestamp: "2026-06-24T00:00:00Z", rootName: "app" });
  assert.equal(t.bom.metadata.timestamp, "2026-06-24T00:00:00Z");
  assert.equal(t.bom.metadata.component.name, "app");
});

test("empty component set → an empty-but-valid, complete BOM", () => {
  const r = generateCycloneDxSbom([]);
  assert.equal(r.complete, true);
  assert.equal(r.bom.components.length, 0);
});

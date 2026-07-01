/**
 * Phases 42-51 — Service Integration Tests
 *
 * Tests all governed services from Phase 42 (capability host) through
 * Phase 51 (manifest verification / v1.0 RC). Each service is a .fungi file
 * that executes as a live HTTP endpoint.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseProgram, startServer } from "../dist/index.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const SVC_DIR = join(__dir, "..", "..", "..", "examples", "auth-service");

function loadService(filename) {
  const src = readFileSync(join(SVC_DIR, filename), "utf8");
  return parseProgram(src, filename);
}

// ── Phase 42: Capability Host ───────────────────────────────────────────────

describe("Phase 42: capabilityHostService.fungi", () => {
  let server;
  const PORT = 3930;
  before(async () => { server = await startServer(loadService("capabilityHostService.fungi").ast, loadService("capabilityHostService.fungi").flows, { port: PORT }); });
  after(async () => server?.close());
  const post = async (body) => { const r = await fetch(`http://127.0.0.1:${PORT}/capability/check`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}); return {status:r.status,json:JSON.parse(await r.text())}; };

  it("network.outbound denied in production context", async () => {
    const r = await post({ effect: "network.outbound", context: "production" });
    assert.equal(r.json.allowed, false);
  });

  it("audit.write always allowed", async () => {
    const r = await post({ effect: "audit.write", context: "production" });
    assert.equal(r.json.allowed, true);
  });

  it("crypto.verify allowed in deterministic context", async () => {
    const r = await post({ effect: "crypto.verify", context: "deterministic" });
    assert.equal(r.json.allowed, true);
    assert.equal(r.json.governanceClass, 3);
  });

  it("storage.write denied in deterministic context", async () => {
    const r = await post({ effect: "storage.write", context: "deterministic" });
    assert.equal(r.json.allowed, false);
  });
});

// ── Phase 47: Routing Policy ─────────────────────────────────────────────────

describe("Phase 47: routingPolicyService.fungi", () => {
  let server;
  const PORT = 3931;
  const prog = loadService("routingPolicyService.fungi");
  before(async () => { server = await startServer(prog.ast, prog.flows, { port: PORT }); });
  after(async () => server?.close());
  const post = async (body) => { const r = await fetch(`http://127.0.0.1:${PORT}/routing/resolve`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}); return JSON.parse(await r.text()); };

  it("pure flow (no effects) → wasm tier", async () => {
    const r = await post({ effectCount: 0, hasAI: false, isSafetyCritical: false });
    assert.equal(r.tier, "wasm");
    assert.equal(r.governanceClass, 2);
  });

  it("AI flow → gpu tier", async () => {
    const r = await post({ effectCount: 1, hasAI: true, isSafetyCritical: false });
    assert.equal(r.tier, "gpu");
    assert.equal(r.governanceClass, 3);
  });

  it("safety critical → enclave tier", async () => {
    const r = await post({ effectCount: 2, hasAI: false, isSafetyCritical: true });
    assert.equal(r.tier, "enclave");
    assert.equal(r.governanceClass, 4);
  });
});

// ── Phase 48: Economics ───────────────────────────────────────────────────────

describe("Phase 48: economicsService.fungi", () => {
  let server;
  const PORT = 3932;
  const prog = loadService("economicsService.fungi");
  before(async () => { server = await startServer(prog.ast, prog.flows, { port: PORT }); });
  after(async () => server?.close());
  const post = async (body) => { const r = await fetch(`http://127.0.0.1:${PORT}/economics/estimate`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}); return JSON.parse(await r.text()); };

  it("returns all cost components", async () => {
    const r = await post({ opCount: 100, targetClass: 2, recordCount: 10, classificationLevel: 2 });
    assert.ok(r.computeCost !== undefined);
    assert.ok(r.riskCost !== undefined);
    assert.ok(r.totalCost !== undefined);
    assert.equal(r.totalCost, r.computeCost + r.riskCost + r.auditCost);
  });

  it("enclave (targetClass=4) costs 10× per op", async () => {
    const r = await post({ opCount: 10, targetClass: 4, recordCount: 0, classificationLevel: 0 });
    assert.equal(r.computeCost, 100);
  });
});

// ── Phase 49: Value Classification ───────────────────────────────────────────

describe("Phase 49: valueClassificationService.fungi", () => {
  let server;
  const PORT = 3933;
  const prog = loadService("valueClassificationService.fungi");
  before(async () => { server = await startServer(prog.ast, prog.flows, { port: PORT }); });
  after(async () => server?.close());
  const post = async (body) => { const r = await fetch(`http://127.0.0.1:${PORT}/value/classify`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}); return JSON.parse(await r.text()); };

  it("medical data → classification 4, requires redaction", async () => {
    const r = await post({ typeName: "medical_record" });
    assert.equal(r.classification, 4);
    assert.equal(r.requiresRedaction, true);
    assert.equal(r.requiresEncryption, true);
  });

  it("public data → classification 0, no redaction needed", async () => {
    const r = await post({ typeName: "public_announcement" });
    assert.equal(r.classification, 0);
    assert.equal(r.requiresRedaction, false);
  });
});

// ── Phase 50: Runtime Profile ─────────────────────────────────────────────────

describe("Phase 50: runtimeProfileService.fungi", () => {
  let server;
  const PORT = 3934;
  const prog = loadService("runtimeProfileService.fungi");
  before(async () => { server = await startServer(prog.ast, prog.flows, { port: PORT }); });
  after(async () => server?.close());
  const post = async (body) => { const r = await fetch(`http://127.0.0.1:${PORT}/profile/check`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}); return JSON.parse(await r.text()); };

  it("strict profile denies recursion and unbounded loops", async () => {
    const r = await post({ profile: "strict" });
    assert.equal(r.allowsRecursion, false);
    assert.equal(r.allowsUnboundedLoop, false);
    assert.equal(r.securityLevel, 3);
  });

  it("deterministic profile requires budget", async () => {
    const r = await post({ profile: "deterministic" });
    assert.equal(r.requiresBudget, true);
    assert.equal(r.securityLevel, 4);
  });

  it("dev profile allows most things", async () => {
    const r = await post({ profile: "dev" });
    assert.equal(r.allowsRecursion, true);
    assert.equal(r.requiresBudget, false);
    assert.equal(r.securityLevel, 1);
  });
});

// ── Phase 51: Manifest Verification (v1.0 RC) ────────────────────────────────

describe("Phase 51: manifestVerificationService.fungi", () => {
  let server;
  const PORT = 3935;
  const prog = loadService("manifestVerificationService.fungi");
  before(async () => { server = await startServer(prog.ast, prog.flows, { port: PORT }); });
  after(async () => server?.close());
  const post = async (body) => { const r = await fetch(`http://127.0.0.1:${PORT}/manifest/verify`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}); return JSON.parse(await r.text()); };

  it("valid signed manifest with flags → accepted, trustLevel=4", async () => {
    const r = await post({ schemaVersion: "fungi.runtime.v1", verified: true, hasSignature: true, governanceFlagsMask: 7 });
    assert.equal(r.versionValid, true);
    assert.equal(r.flagsValid, true);
    assert.equal(r.trustLevel, 4);
    assert.equal(r.accepted, true);
  });

  it("valid unsigned manifest → trustLevel=3, accepted", async () => {
    const r = await post({ schemaVersion: "fungi.runtime.v1", verified: true, hasSignature: false, governanceFlagsMask: 3 });
    assert.equal(r.trustLevel, 3);
    assert.equal(r.accepted, true);
  });

  it("unverified manifest → trustLevel=0, rejected", async () => {
    const r = await post({ schemaVersion: "fungi.runtime.v1", verified: false, hasSignature: false, governanceFlagsMask: 0 });
    assert.equal(r.trustLevel, 0);
    assert.equal(r.accepted, false);
  });

  it("all .fungi service files from Phase 42-51 parse with zero errors", () => {
    const services = [
      "capabilityHostService.fungi",
      "routingPolicyService.fungi",
      "economicsService.fungi",
      "valueClassificationService.fungi",
      "runtimeProfileService.fungi",
      "manifestVerificationService.fungi",
    ];
    for (const svc of services) {
      const p = loadService(svc);
      const errs = (p.diagnostics ?? []).filter(d => d.severity === "error");
      assert.equal(errs.length, 0, `${svc}: ${errs.map(e=>e.message).join(", ")}`);
    }
  });
});

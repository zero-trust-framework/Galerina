// =============================================================================
// Package Resolver — Governed Resolver Tests (Phase 18B)
//
// Tests for:
//   - PackageManifest extended schema (hash, signature, registry, installScript,
//     targets, compute)
//   - checkPackageCapabilityExpansion() → LLN-PKG-001
//   - checkInstallScript() → LLN-PKG-004
//   - checkPackageProvenance() → LLN-PKG-003, LLN-PKG-005
//   - getResolverReport() → ResolverReport
//   - LLN-PKG-001..005 constant shapes
//
// R3: Package type injection tests
//   - resolveImportedTypes() returns correct types per package
//   - KNOWN_PACKAGE_TYPES has the expected number of packages
//   - parseProgram + import + type usage → 0 LLN-TYPE-001 for Email
// =============================================================================

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkPackageCapabilityExpansion,
  checkInstallScript,
  checkPackageProvenance,
  getResolverReport,
  LLN_PKG_001,
  LLN_PKG_002,
  LLN_PKG_003,
  LLN_PKG_004,
  LLN_PKG_005,
  LLN_PKG_006,
  KNOWN_PACKAGE_TYPES,
  resolveImportedTypes,
  parseProgram,
  checkTypes,
} from "../../dist/index.js";

// ---------------------------------------------------------------------------
// LLN-PKG constant shapes
// ---------------------------------------------------------------------------

describe("LLN-PKG constants: shape conformance", () => {
  it("LLN_PKG_001 (CapabilityExpanded) has correct shape", () => {
    assert.equal(LLN_PKG_001.code, "LLN-PKG-001");
    assert.equal(LLN_PKG_001.name, "CapabilityExpanded");
    assert.equal(LLN_PKG_001.severity, "error");
    assert.ok(typeof LLN_PKG_001.message === "string");
    assert.ok(typeof LLN_PKG_001.why === "string");
    assert.ok(typeof LLN_PKG_001.suggestedFix === "string");
  });

  it("LLN_PKG_002 (UntrustedRegistry) has correct shape", () => {
    assert.equal(LLN_PKG_002.code, "LLN-PKG-002");
    assert.equal(LLN_PKG_002.severity, "error");
  });

  it("LLN_PKG_003 (MissingHash) has correct shape", () => {
    assert.equal(LLN_PKG_003.code, "LLN-PKG-003");
    assert.equal(LLN_PKG_003.severity, "warning");
    assert.ok(typeof LLN_PKG_003.why === "string");
  });

  it("LLN_PKG_004 (InstallScriptDenied) has correct shape", () => {
    assert.equal(LLN_PKG_004.code, "LLN-PKG-004");
    assert.equal(LLN_PKG_004.severity, "error");
    assert.ok(typeof LLN_PKG_004.why === "string");
  });

  it("LLN_PKG_005 (MissingSignature) has correct shape", () => {
    assert.equal(LLN_PKG_005.code, "LLN-PKG-005");
    assert.equal(LLN_PKG_005.severity, "warning");
  });
});

// ---------------------------------------------------------------------------
// checkPackageCapabilityExpansion — LLN-PKG-001
// ---------------------------------------------------------------------------

describe("checkPackageCapabilityExpansion: LLN-PKG-001", () => {
  const BASE_MANIFEST = {
    name: "@logicn/auth",
    version: "1.3.0",
    exports: { types: [], flows: [], events: [] },
    capabilities: ["crypto.password.verify"],
    hash: "sha256:abc123",
    signature: "sig:ed25519:xyz",
  };

  it("no new capabilities → no expansion, no diagnostics", () => {
    const result = checkPackageCapabilityExpansion(
      BASE_MANIFEST,
      ["crypto.password.verify"],
    );
    assert.equal(result.expanded, false);
    assert.equal(result.addedCapabilities.length, 0);
    assert.equal(result.diagnostics.length, 0);
  });

  it("additional capability added → LLN-PKG-001 fired", () => {
    const result = checkPackageCapabilityExpansion(
      { ...BASE_MANIFEST, capabilities: ["crypto.password.verify", "network.outbound"] },
      ["crypto.password.verify"],
    );
    assert.equal(result.expanded, true);
    assert.deepEqual(result.addedCapabilities, ["network.outbound"]);
    assert.ok(result.diagnostics.length > 0, "Must emit at least one diagnostic");
    assert.equal(result.diagnostics[0].code, "LLN-PKG-001");
    assert.equal(result.diagnostics[0].severity, "error");
    assert.ok(result.diagnostics[0].message.includes("network.outbound"));
  });

  it("capabilities that ARE in lockfile → not flagged", () => {
    const result = checkPackageCapabilityExpansion(
      { ...BASE_MANIFEST, capabilities: ["crypto.password.verify", "audit.write"] },
      ["crypto.password.verify", "audit.write"],
    );
    assert.equal(result.expanded, false);
    assert.equal(result.diagnostics.length, 0);
  });

  it("empty lockfile + any capability → all are 'added'", () => {
    const result = checkPackageCapabilityExpansion(
      BASE_MANIFEST,
      [],
    );
    assert.equal(result.expanded, true);
    assert.ok(result.addedCapabilities.includes("crypto.password.verify"));
    assert.equal(result.diagnostics[0].code, "LLN-PKG-001");
  });
});

// ---------------------------------------------------------------------------
// checkInstallScript — LLN-PKG-004
// ---------------------------------------------------------------------------

describe("checkInstallScript: LLN-PKG-004", () => {
  const BASE = {
    name: "@bad/pkg",
    version: "1.0.0",
    exports: { types: [], flows: [], events: [] },
  };

  it("no installScript field → no diagnostic (default deny = safe)", () => {
    const result = checkInstallScript(BASE);
    assert.equal(result.length, 0, "No diagnostic when installScript is absent");
  });

  it("installScript: 'deny' → no diagnostic", () => {
    const result = checkInstallScript({ ...BASE, installScript: "deny" });
    assert.equal(result.length, 0, "No diagnostic when installScript is explicitly deny");
  });

  it("installScript: 'allow' → LLN-PKG-004 fired", () => {
    const result = checkInstallScript({ ...BASE, installScript: "allow" });
    assert.ok(result.length > 0, "Must emit LLN-PKG-004");
    assert.equal(result[0].code, "LLN-PKG-004");
    assert.equal(result[0].severity, "error");
    assert.ok(result[0].message.includes("install script"));
  });
});

// ---------------------------------------------------------------------------
// checkPackageProvenance — LLN-PKG-003 + LLN-PKG-005
// ---------------------------------------------------------------------------

describe("checkPackageProvenance: LLN-PKG-003 and LLN-PKG-005", () => {
  const FULL_MANIFEST = {
    name: "@logicn/auth",
    version: "1.2.0",
    exports: { types: [], flows: [], events: [] },
    hash: "sha256:3f7c4abcdef",
    signature: "sig:ed25519:abc123",
  };

  it("manifest with hash + signature → no provenance warnings", () => {
    const result = checkPackageProvenance(FULL_MANIFEST);
    assert.equal(result.length, 0, "No diagnostics when hash and signature are present");
  });

  it("missing hash → LLN-PKG-003 warning", () => {
    const { hash: _, ...noHash } = FULL_MANIFEST;
    const result = checkPackageProvenance(noHash);
    assert.ok(result.some((d) => d.code === "LLN-PKG-003"), "LLN-PKG-003 must fire");
    assert.equal(result.find((d) => d.code === "LLN-PKG-003").severity, "warning");
  });

  it("wrong hash format (no sha256: prefix) → LLN-PKG-003 warning", () => {
    const result = checkPackageProvenance({ ...FULL_MANIFEST, hash: "abc123noprefix" });
    assert.ok(result.some((d) => d.code === "LLN-PKG-003"), "LLN-PKG-003 must fire for non-prefixed hash");
  });

  it("missing signature → LLN-PKG-005 warning", () => {
    const { signature: _, ...noSig } = FULL_MANIFEST;
    const result = checkPackageProvenance(noSig);
    assert.ok(result.some((d) => d.code === "LLN-PKG-005"), "LLN-PKG-005 must fire");
    assert.equal(result.find((d) => d.code === "LLN-PKG-005").severity, "warning");
  });

  it("missing both hash and signature → both LLN-PKG-003 and LLN-PKG-005", () => {
    const { hash: _h, signature: _s, ...bare } = FULL_MANIFEST;
    const result = checkPackageProvenance(bare);
    assert.ok(result.some((d) => d.code === "LLN-PKG-003"), "LLN-PKG-003 must fire");
    assert.ok(result.some((d) => d.code === "LLN-PKG-005"), "LLN-PKG-005 must fire");
  });
});

describe("checkPackageProvenance: LLN-PKG-006 signing-key revocation (defense-in-depth)", () => {
  const REVOKED = "8eecf4187ebc9341";
  const signed = (overrides) => ({
    name: "@logicn/pkg", version: "1.0.0", exports: { types: [], flows: [], events: [] },
    hash: "sha256:" + "a".repeat(8), signature: "sig:ed25519:abc", ...overrides,
  });

  it("a package signed by a REVOKED key → LLN-PKG-006 error", () => {
    const result = checkPackageProvenance(signed({ signerKeyId: REVOKED }), { isRevoked: (k) => k === REVOKED });
    const d = result.find((x) => x.code === "LLN-PKG-006");
    assert.ok(d, "LLN-PKG-006 must fire for a revoked signer");
    assert.equal(d.severity, "error");
  });

  it("a non-revoked signer → no revocation diagnostic", () => {
    const result = checkPackageProvenance(signed({ signerKeyId: "ab46f4c7e2797b9b" }), { isRevoked: (k) => k === REVOKED });
    assert.ok(!result.some((x) => x.code === "LLN-PKG-006"));
  });

  it("a THROWING revocation check is fail-closed (treated as revoked → LLN-PKG-006)", () => {
    const result = checkPackageProvenance(signed({ signerKeyId: "x" }), { isRevoked: () => { throw new Error("untrusted"); } });
    assert.ok(result.some((x) => x.code === "LLN-PKG-006"), "a throwing check must fail closed");
  });

  it("no revocation predicate ⇒ no revocation diagnostic (backward-compatible)", () => {
    const result = checkPackageProvenance(signed({ signerKeyId: REVOKED }));
    assert.ok(!result.some((x) => x.code === "LLN-PKG-006"));
  });

  it("getResolverReport threads the revocation predicate", () => {
    const report = getResolverReport([signed({ signerKeyId: REVOKED })], "2026-06-21T00:00:00Z", { isRevoked: () => true });
    assert.ok(report.diagnostics.some((x) => x.code === "LLN-PKG-006"));
  });

  it("LLN_PKG_006 constant has the correct shape", () => {
    assert.equal(LLN_PKG_006.code, "LLN-PKG-006");
    assert.equal(LLN_PKG_006.name, "RevokedSigner");
    assert.equal(LLN_PKG_006.severity, "error");
    assert.ok(typeof LLN_PKG_006.why === "string");
    assert.ok(typeof LLN_PKG_006.suggestedFix === "string");
  });
});

// ---------------------------------------------------------------------------
// getResolverReport — ResolverReport structure
// ---------------------------------------------------------------------------

describe("getResolverReport: resolver output report", () => {
  const AUTH_MANIFEST = {
    name: "@logicn/auth",
    version: "1.2.0",
    exports: { types: ["UserId"], flows: ["verifyPassword"], events: [] },
    effects: ["audit.write"],
    capabilities: ["crypto.password.verify"],
    hash: "sha256:abc",
    signature: "sig:ed25519:xyz",
    targets: { cpu: "dist/cpu.logicn", wasm: "dist/wasm.logicn" },
    compute: { supports: ["cpu", "wasm-simd"], photonic_compatible: false },
  };

  const AI_MANIFEST = {
    name: "@logicn/ai",
    version: "0.5.0",
    exports: { types: ["EmbeddingVector"], flows: ["embed"], events: [] },
    effects: [],
    capabilities: ["model.inference"],
    hash: "sha256:def",
    signature: "sig:ed25519:uvw",
    targets: { cpu: "dist/cpu.logicn", npu: "dist/npu.logicn", gpu: "dist/gpu.logicn" },
    compute: { tensor_shapes: ["Tensor<Float32, [768]>"], supports: ["npu", "gpu", "cpu"], photonic_compatible: false },
  };

  it("report has correct schemaVersion", () => {
    const report = getResolverReport([AUTH_MANIFEST], "2026-05-31T00:00:00.000Z");
    assert.equal(report.schemaVersion, "lln.resolver.report.v1");
  });

  it("report lists all resolved packages", () => {
    const report = getResolverReport([AUTH_MANIFEST, AI_MANIFEST], "2026-05-31T00:00:00.000Z");
    assert.equal(report.packages.length, 2);
    const names = report.packages.map((p) => p.name);
    assert.ok(names.includes("@logicn/auth"), "auth must be in report");
    assert.ok(names.includes("@logicn/ai"), "ai must be in report");
  });

  it("trusted package (hash + signature) → trusted=true", () => {
    const report = getResolverReport([AUTH_MANIFEST], "2026-05-31T00:00:00.000Z");
    const pkg = report.packages[0];
    assert.equal(pkg.trusted, true, "Package with hash+signature must be trusted");
  });

  it("package without hash → trusted=false", () => {
    const { hash: _, ...noHash } = AUTH_MANIFEST;
    const report = getResolverReport([noHash], "2026-05-31T00:00:00.000Z");
    const pkg = report.packages[0];
    assert.equal(pkg.trusted, false, "Package without hash must not be trusted");
  });

  it("aggregates all capabilities across packages", () => {
    const report = getResolverReport([AUTH_MANIFEST, AI_MANIFEST], "2026-05-31T00:00:00.000Z");
    assert.ok(report.capabilities.includes("crypto.password.verify"), "auth capability must be in report");
    assert.ok(report.capabilities.includes("model.inference"), "ai capability must be in report");
    assert.ok([...report.capabilities].every((c, i) => i === 0 || c >= report.capabilities[i - 1]), "Capabilities must be sorted");
  });

  it("aggregates all compute targets", () => {
    const report = getResolverReport([AUTH_MANIFEST, AI_MANIFEST], "2026-05-31T00:00:00.000Z");
    assert.ok(report.targets.includes("cpu"), "cpu must be in targets");
    assert.ok(report.targets.includes("npu"), "npu must be in targets");
    assert.ok(report.targets.includes("gpu"), "gpu must be in targets");
    assert.ok(report.targets.includes("wasm"), "wasm must be in targets");
  });

  it("report includes provenance diagnostics for unsigned packages", () => {
    const { hash: _, signature: __, ...bare } = AUTH_MANIFEST;
    const report = getResolverReport([bare], "2026-05-31T00:00:00.000Z");
    const codes = report.diagnostics.map((d) => d.code);
    assert.ok(codes.includes("LLN-PKG-003"), "LLN-PKG-003 must appear in report diagnostics");
    assert.ok(codes.includes("LLN-PKG-005"), "LLN-PKG-005 must appear in report diagnostics");
  });

  it("report includes LLN-PKG-004 for package with install script", () => {
    const withInstall = { ...AUTH_MANIFEST, installScript: /** @type {"allow"} */ ("allow") };
    const report = getResolverReport([withInstall], "2026-05-31T00:00:00.000Z");
    assert.ok(report.diagnostics.some((d) => d.code === "LLN-PKG-004"), "LLN-PKG-004 must appear for install-script package");
  });
});

// ---------------------------------------------------------------------------
// R3: Package type injection
// ---------------------------------------------------------------------------

describe("R3: Package type injection", () => {
  it("resolveImportedTypes('@logicn/healthcare-types') includes 'Email'", () => {
    const types = resolveImportedTypes("@logicn/healthcare-types");
    assert.ok(
      types.includes("Email"),
      `Expected 'Email' in @logicn/healthcare-types exports, got: ${types.join(", ")}`,
    );
  });

  it("KNOWN_PACKAGE_TYPES has >= 5 packages", () => {
    assert.ok(
      KNOWN_PACKAGE_TYPES.size >= 5,
      `Expected at least 5 packages in KNOWN_PACKAGE_TYPES, got: ${KNOWN_PACKAGE_TYPES.size}`,
    );
  });

  it("parseProgram with import Email from '@logicn/healthcare-types' + type usage → 0 LLN-TYPE-001 for Email", () => {
    const source = `import Email from "@logicn/healthcare-types"

flow sendWelcome(address: Email) -> String {
  return "ok"
}
`;
    const { ast } = parseProgram(source, "test.lln");
    // Inject the types exported by the package into the type checker
    const injectedTypes = resolveImportedTypes("@logicn/healthcare-types");
    const result = checkTypes(ast, injectedTypes);
    const type001Diags = result.diagnostics.filter((d) => d.code === "LLN-TYPE-001" && d.message.includes("Email"));
    assert.equal(
      type001Diags.length,
      0,
      `Expected 0 LLN-TYPE-001 for Email, got: ${type001Diags.map((d) => d.message).join("; ")}`,
    );
  });
});

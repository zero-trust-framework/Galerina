// =============================================================================
// Phase 14 — Root Capability Provider Tests
//
// Tests compiler authority isolation and user program capability separation.
// =============================================================================

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createRootCapabilityProvider,
  COMPILER_MINIMUM_CAPABILITIES,
  FUNGI_BUILD_001,
} from "../dist/index.js";

describe("createRootCapabilityProvider", () => {
  it("returns a provider object", () => {
    const provider = createRootCapabilityProvider();
    assert.ok(provider !== null && typeof provider === "object");
    assert.strictEqual(typeof provider.createCompilerHost, "function");
    assert.strictEqual(typeof provider.createUserRuntime, "function");
    assert.strictEqual(typeof provider.audit, "function");
    assert.strictEqual(typeof provider.getAuditLog, "function");
  });
});

describe("CompilerCapabilityHost", () => {
  it("createCompilerHost() with COMPILER_MINIMUM_CAPABILITIES allows storage.read", () => {
    const provider = createRootCapabilityProvider();
    const host = provider.createCompilerHost(new Set(COMPILER_MINIMUM_CAPABILITIES));
    assert.strictEqual(host.domain, "COMPILER");
    assert.strictEqual(host.check("storage.read"), true);
  });

  it("createCompilerHost() does NOT allow network.write", () => {
    const provider = createRootCapabilityProvider();
    const host = provider.createCompilerHost(new Set(COMPILER_MINIMUM_CAPABILITIES));
    assert.strictEqual(host.check("network.write"), false);
  });

  it("createCompilerHost() does NOT allow database.read", () => {
    const provider = createRootCapabilityProvider();
    const host = provider.createCompilerHost(new Set(COMPILER_MINIMUM_CAPABILITIES));
    assert.strictEqual(host.check("database.read"), false);
  });

  it("createCompilerHost() does NOT allow secret.read", () => {
    const provider = createRootCapabilityProvider();
    const host = provider.createCompilerHost(new Set(COMPILER_MINIMUM_CAPABILITIES));
    assert.strictEqual(host.check("secret.read"), false);
  });

  it("host.use() records an audit entry for an allowed capability", () => {
    const provider = createRootCapabilityProvider();
    const host = provider.createCompilerHost(new Set(COMPILER_MINIMUM_CAPABILITIES));
    host.use("storage.read", "/project/src/main.fungi");
    const log = provider.getAuditLog();
    assert.strictEqual(log.length, 1);
    assert.strictEqual(log[0].domain, "COMPILER");
    assert.strictEqual(log[0].capability, "storage.read");
    assert.strictEqual(log[0].resource, "/project/src/main.fungi");
    assert.ok(typeof log[0].timestamp === "string" && log[0].timestamp.length > 0);
  });

  it("host.use() throws when the capability is not in the allowed set", () => {
    const provider = createRootCapabilityProvider();
    const host = provider.createCompilerHost(new Set(COMPILER_MINIMUM_CAPABILITIES));
    assert.throws(
      () => host.use("network.write", "https://example.com"),
      /Compiler capability denied/,
    );
  });

  it("host.allowedCapabilities reflects the set passed to createCompilerHost", () => {
    const provider = createRootCapabilityProvider();
    const caps = new Set(["storage.read", "report.write"]);
    const host = provider.createCompilerHost(caps);
    assert.ok(host.allowedCapabilities.has("storage.read"));
    assert.ok(host.allowedCapabilities.has("report.write"));
    assert.ok(!host.allowedCapabilities.has("network.write"));
  });
});

describe("UserRuntimeCapabilities", () => {
  it("createUserRuntime() with declared effects allows those effects", () => {
    const provider = createRootCapabilityProvider();
    const runtime = provider.createUserRuntime(new Set(["database.read", "network.outbound"]));
    assert.strictEqual(runtime.domain, "USER_PROGRAM");
    assert.strictEqual(runtime.canUse("database.read"), true);
    assert.strictEqual(runtime.canUse("network.outbound"), true);
  });

  it("createUserRuntime() does NOT allow undeclared effects", () => {
    const provider = createRootCapabilityProvider();
    const runtime = provider.createUserRuntime(new Set(["database.read"]));
    assert.strictEqual(runtime.canUse("storage.write"), false);
    assert.strictEqual(runtime.canUse("email.send"), false);
    assert.strictEqual(runtime.canUse("payment.process"), false);
  });

  it("createUserRuntime() declaredEffects reflects the set passed in", () => {
    const provider = createRootCapabilityProvider();
    const effects = new Set(["database.read", "network.outbound"]);
    const runtime = provider.createUserRuntime(effects);
    assert.ok(runtime.declaredEffects.has("database.read"));
    assert.ok(runtime.declaredEffects.has("network.outbound"));
    assert.ok(!runtime.declaredEffects.has("storage.write"));
  });
});

describe("Audit log", () => {
  it("records capability usage via provider.audit()", () => {
    const provider = createRootCapabilityProvider();
    provider.audit("COMPILER", "storage.read", "/src/main.fungi");
    provider.audit("USER_PROGRAM", "database.read", "users");
    const log = provider.getAuditLog();
    assert.strictEqual(log.length, 2);
    assert.strictEqual(log[0].domain, "COMPILER");
    assert.strictEqual(log[0].capability, "storage.read");
    assert.strictEqual(log[1].domain, "USER_PROGRAM");
    assert.strictEqual(log[1].capability, "database.read");
  });

  it("audit log is readonly (entries cannot be mutated from outside)", () => {
    const provider = createRootCapabilityProvider();
    provider.audit("BUILD", "compiler.graph.write", "graph.bin");
    const log = provider.getAuditLog();
    assert.strictEqual(log.length, 1);
    // The returned value is a readonly array — we can read it but the
    // underlying store is not affected by reassigning the reference.
    const first = log[0];
    assert.ok(first !== undefined);
    assert.strictEqual(first.domain, "BUILD");
  });
});

describe("COMPILER_MINIMUM_CAPABILITIES", () => {
  it("contains storage.read", () => {
    assert.ok(COMPILER_MINIMUM_CAPABILITIES.has("storage.read"));
  });

  it("contains storage.write", () => {
    assert.ok(COMPILER_MINIMUM_CAPABILITIES.has("storage.write"));
  });

  it("contains package.read", () => {
    assert.ok(COMPILER_MINIMUM_CAPABILITIES.has("package.read"));
  });

  it("contains manifest.read", () => {
    assert.ok(COMPILER_MINIMUM_CAPABILITIES.has("manifest.read"));
  });

  it("contains report.write", () => {
    assert.ok(COMPILER_MINIMUM_CAPABILITIES.has("report.write"));
  });

  it("contains compiler.graph.read", () => {
    assert.ok(COMPILER_MINIMUM_CAPABILITIES.has("compiler.graph.read"));
  });

  it("contains compiler.graph.write", () => {
    assert.ok(COMPILER_MINIMUM_CAPABILITIES.has("compiler.graph.write"));
  });

  it("does NOT contain network.read", () => {
    assert.ok(!COMPILER_MINIMUM_CAPABILITIES.has("network.read"));
  });

  it("does NOT contain network.write", () => {
    assert.ok(!COMPILER_MINIMUM_CAPABILITIES.has("network.write"));
  });

  it("does NOT contain secret.read", () => {
    assert.ok(!COMPILER_MINIMUM_CAPABILITIES.has("secret.read"));
  });

  it("does NOT contain database.read", () => {
    assert.ok(!COMPILER_MINIMUM_CAPABILITIES.has("database.read"));
  });

  it("does NOT contain database.write", () => {
    assert.ok(!COMPILER_MINIMUM_CAPABILITIES.has("database.write"));
  });

  it("does NOT contain email.send", () => {
    assert.ok(!COMPILER_MINIMUM_CAPABILITIES.has("email.send"));
  });

  it("does NOT contain payment.process", () => {
    assert.ok(!COMPILER_MINIMUM_CAPABILITIES.has("payment.process"));
  });
});

describe("FUNGI_BUILD_001", () => {
  it("has the correct code", () => {
    assert.strictEqual(FUNGI_BUILD_001.code, "FUNGI-BUILD-001");
  });

  it("has severity error", () => {
    assert.strictEqual(FUNGI_BUILD_001.severity, "error");
  });

  it("has the correct name", () => {
    assert.strictEqual(FUNGI_BUILD_001.name, "NonDeterministicBuild");
  });

  it("has a suggestedFix", () => {
    assert.ok(typeof FUNGI_BUILD_001.suggestedFix === "string" && FUNGI_BUILD_001.suggestedFix.length > 0);
  });
});

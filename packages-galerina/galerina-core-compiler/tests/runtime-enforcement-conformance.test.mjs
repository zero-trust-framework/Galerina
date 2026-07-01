// =============================================================================
// Runtime Enforcement Conformance Tests
//
// Verifies that the contract enforcer, capability host, and runtime run()
// function enforce Galerina's governance contracts at execution time.
// =============================================================================

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createContractEnforcer,
  createCapabilityHost,
  COMPILER_MINIMUM_CAPABILITIES,
  run,
  FUNGI_VOID,
} from "../dist/index.js";

// ---------------------------------------------------------------------------
// Shared context fixture used in capability-host tests
// ---------------------------------------------------------------------------

const DUMMY_CONTEXT = {
  flowName: "testFlow",
  startedAt: Date.now(),
};

// =============================================================================
// createContractEnforcer
// =============================================================================

describe("Runtime enforcement — createContractEnforcer", () => {
  it("createContractEnforcer(undefined, 'test') returns a valid enforcer object", () => {
    const enforcer = createContractEnforcer(undefined, "test");
    assert.ok(enforcer !== null && typeof enforcer === "object");
    assert.equal(enforcer.context.flowName, "test");
  });

  it("enforcer exposes checkDeadline as a function", () => {
    const enforcer = createContractEnforcer(undefined, "test");
    assert.equal(typeof enforcer.checkDeadline, "function");
  });

  it("enforcer exposes checkRequestSize as a function", () => {
    const enforcer = createContractEnforcer(undefined, "test");
    assert.equal(typeof enforcer.checkRequestSize, "function");
  });

  it("enforcer.checkRequestSize(1000) does not throw (under any default limit)", () => {
    const enforcer = createContractEnforcer(undefined, "test");
    // Without a contract node specifying limits, no limit is configured.
    // 1000 bytes is well within any reasonable default.
    assert.doesNotThrow(() => enforcer.checkRequestSize(1000));
  });

  it("enforcer.checkRequestSize(20 * 1024 * 1024) does not throw when no limit is configured", () => {
    // Without a contract AST node, there is no size limit.
    // The enforcer must not impose an arbitrary limit from thin air.
    const enforcer = createContractEnforcer(undefined, "test");
    assert.doesNotThrow(() => enforcer.checkRequestSize(20 * 1024 * 1024));
  });
});

// =============================================================================
// createCapabilityHost — allow / deny
// =============================================================================

describe("Runtime enforcement — createCapabilityHost", () => {
  it("createCapabilityHost with database.read allows database.read", () => {
    const enforcer = createContractEnforcer(undefined, "testFlow");
    const host = createCapabilityHost({
      declaredEffects: new Set(["database.read"]),
      enforcer,
    });

    const result = host.check({
      capabilityId: "host.database.read",
      effect: "database.read",
      args: [],
      context: DUMMY_CONTEXT,
    });

    assert.equal(result.allowed, true);
  });

  it("createCapabilityHost with database.read denies network.outbound", () => {
    const enforcer = createContractEnforcer(undefined, "testFlow");
    const host = createCapabilityHost({
      declaredEffects: new Set(["database.read"]),
      enforcer,
    });

    const result = host.check({
      capabilityId: "host.network.outbound",
      effect: "network.outbound",
      args: [],
      context: DUMMY_CONTEXT,
    });

    assert.equal(result.allowed, false);
    assert.ok(typeof result.reason === "string", "denied result must include a reason string");
    assert.ok(
      result.reason.includes("network.outbound"),
      `Reason should name the denied effect; got: "${result.reason}"`,
    );
  });
});

// =============================================================================
// COMPILER_MINIMUM_CAPABILITIES
// =============================================================================

describe("Runtime enforcement — COMPILER_MINIMUM_CAPABILITIES", () => {
  it("is a Set", () => {
    assert.ok(COMPILER_MINIMUM_CAPABILITIES instanceof Set, "COMPILER_MINIMUM_CAPABILITIES should be a Set");
  });

  it("includes storage.read", () => {
    assert.ok(
      COMPILER_MINIMUM_CAPABILITIES.has("storage.read"),
      "COMPILER_MINIMUM_CAPABILITIES must include storage.read",
    );
  });

  it("includes storage.write", () => {
    assert.ok(
      COMPILER_MINIMUM_CAPABILITIES.has("storage.write"),
      "COMPILER_MINIMUM_CAPABILITIES must include storage.write",
    );
  });

  it("does NOT include network.read", () => {
    assert.ok(
      !COMPILER_MINIMUM_CAPABILITIES.has("network.read"),
      "COMPILER_MINIMUM_CAPABILITIES must not include network.read (compiler does not make network requests)",
    );
  });
});

// =============================================================================
// run() — basic execution
// =============================================================================

describe("Runtime enforcement — run()", () => {
  it("run() on a pure greeting flow returns a value without throwing", async () => {
    const source = `pure flow greet() -> String { return "hi" }`;
    let result;
    await assert.doesNotReject(async () => {
      result = await run(source, "test.fungi", "greet", new Map());
    });
    assert.ok(result !== undefined, "run() must return a result");
    assert.equal(result.ok, true, "pure flow should succeed");
    assert.equal(result.value?.__tag, "string");
    assert.equal(result.value?.value, "hi");
  });

  it("run() result always carries an enforcementRecord", async () => {
    const source = `pure flow greet() -> String { return "hi" }`;
    const result = await run(source, "test.fungi", "greet", new Map());
    assert.ok(result.enforcementRecord !== undefined, "enforcementRecord should always be present");
    assert.equal(result.enforcementRecord.flowName, "greet");
  });
});

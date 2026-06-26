// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GraphBuilder,
  buildEffectGraph, propagateEffects, validateEffects, allEffectsFor,
  buildBoundaryGraph, validateBoundaries,
  buildProjectGraph, queryGraph, explainNode, findPath,
  buildDependencyGraph, resolveDependencies,
  buildResourceLifecycleGraph, advanceState, validateTransition,
  buildCapabilityGraph, resolveCapabilities, validateCapabilities,
} from "../dist/index.js";

// ---------------------------------------------------------------------------
// EffectGraph
// ---------------------------------------------------------------------------

describe("EffectGraph — buildEffectGraph", () => {
  it("creates nodes for each flow entry", () => {
    const g = buildEffectGraph([
      { flowName: "getUser", safetyLevel: "guarded", declaredEffects: ["database.read"], inferredEffects: ["database.read"], calls: [] },
      { flowName: "listUsers", safetyLevel: "guarded", declaredEffects: ["database.read"], inferredEffects: ["database.read"], calls: ["getUser"] },
    ]);
    assert.equal(g.nodeCount, 2);
    assert.ok(g.hasNode("getUser"));
    assert.ok(g.hasNode("listUsers"));
  });

  it("creates call edges", () => {
    const g = buildEffectGraph([
      { flowName: "a", safetyLevel: "safe", declaredEffects: [], inferredEffects: [], calls: [] },
      { flowName: "b", safetyLevel: "safe", declaredEffects: [], inferredEffects: [], calls: ["a"] },
    ]);
    assert.equal(g.outEdges("b")[0]?.to, "a");
  });
});

describe("EffectGraph — propagateEffects", () => {
  it("propagates inferred effects upward through callers", () => {
    const g = buildEffectGraph([
      { flowName: "dbQuery", safetyLevel: "guarded", declaredEffects: ["database.read"], inferredEffects: ["database.read"], calls: [] },
      { flowName: "getUser", safetyLevel: "guarded", declaredEffects: ["database.read"], inferredEffects: [], calls: ["dbQuery"] },
    ]);
    const propagated = propagateEffects(g);
    const transitiveEffects = propagated.node("getUser")?.data.transitiveEffects ?? [];
    assert.ok(transitiveEffects.includes("database.read"));
  });

  it("does not duplicate effects already declared", () => {
    const g = buildEffectGraph([
      { flowName: "child", safetyLevel: "guarded", declaredEffects: ["network.call"], inferredEffects: ["network.call"], calls: [] },
      { flowName: "parent", safetyLevel: "guarded", declaredEffects: ["network.call"], inferredEffects: ["network.call"], calls: ["child"] },
    ]);
    const propagated = propagateEffects(g);
    const node = propagated.node("parent");
    assert.ok(node !== undefined);
    assert.equal(node.data.transitiveEffects.includes("network.call"), false, "declared effect should not appear in transitiveEffects");
  });
});

describe("EffectGraph — validateEffects", () => {
  it("returns no diagnostics for a correct graph", () => {
    const g = buildEffectGraph([
      { flowName: "ok", safetyLevel: "safe", declaredEffects: [], inferredEffects: [], calls: [] },
    ]);
    assert.deepEqual(validateEffects(g), []);
  });

  it("emits LLN-PGRAPH-010 for undeclared inferred effect", () => {
    const g = buildEffectGraph([
      { flowName: "bad", safetyLevel: "guarded", declaredEffects: [], inferredEffects: ["database.write"], calls: [] },
    ]);
    const diags = validateEffects(g);
    assert.ok(diags.some((d) => d.code === "LLN-PGRAPH-010"));
  });

  it("emits LLN-PGRAPH-012 for safe flow with effects", () => {
    const g = buildEffectGraph([
      { flowName: "oops", safetyLevel: "safe", declaredEffects: ["network.call"], inferredEffects: ["network.call"], calls: [] },
    ]);
    const diags = validateEffects(g);
    assert.ok(diags.some((d) => d.code === "LLN-PGRAPH-012"));
  });
});

describe("allEffectsFor", () => {
  it("returns empty array for unknown flow", () => {
    const g = buildEffectGraph([]);
    assert.deepEqual(allEffectsFor(g, "unknown"), []);
  });
});

// ---------------------------------------------------------------------------
// BoundaryGraph
// ---------------------------------------------------------------------------

describe("BoundaryGraph — validateBoundaries", () => {
  it("returns no diagnostics for valid crossings", () => {
    const g = buildBoundaryGraph(
      [
        { boundaryId: "api", boundaryType: "api", trustLevel: "validated", allowedEffects: ["network.call"], deniedEffects: [] },
        { boundaryId: "db", boundaryType: "database", trustLevel: "internal", allowedEffects: ["database.read"], deniedEffects: [] },
      ],
      [{ from: "api", to: "db", transferredEffects: ["database.read"], transferredSecrets: [], requiresValidation: true }],
    );
    assert.deepEqual(validateBoundaries(g), []);
  });

  it("emits LLN-PGRAPH-020 when denied effect crosses boundary", () => {
    const g = buildBoundaryGraph(
      [
        { boundaryId: "src", boundaryType: "api", trustLevel: "validated", allowedEffects: [], deniedEffects: [] },
        { boundaryId: "dst", boundaryType: "filesystem", trustLevel: "internal", allowedEffects: [], deniedEffects: ["filesystem.write"] },
      ],
      [{ from: "src", to: "dst", transferredEffects: ["filesystem.write"], transferredSecrets: [], requiresValidation: true }],
    );
    const diags = validateBoundaries(g);
    assert.ok(diags.some((d) => d.code === "LLN-PGRAPH-020"));
  });

  it("emits LLN-PGRAPH-021 when secret crosses non-secret boundary", () => {
    const g = buildBoundaryGraph(
      [
        { boundaryId: "src", boundaryType: "api", trustLevel: "validated", allowedEffects: [], deniedEffects: [] },
        { boundaryId: "dst", boundaryType: "network", trustLevel: "internal", allowedEffects: [], deniedEffects: [] },
      ],
      [{ from: "src", to: "dst", transferredEffects: [], transferredSecrets: ["API_KEY"], requiresValidation: true }],
    );
    const diags = validateBoundaries(g);
    assert.ok(diags.some((d) => d.code === "LLN-PGRAPH-021"));
  });
});

// ---------------------------------------------------------------------------
// ProjectGraph
// ---------------------------------------------------------------------------

describe("ProjectGraph", () => {
  function sampleGraph() {
    return buildProjectGraph(
      [
        { id: "pkg-core", kind: "Package", label: "logicn-core" },
        { id: "pkg-compiler", kind: "Package", label: "logicn-core-compiler" },
        { id: "doc-arch", kind: "Document", label: "ARCHITECTURE.md" },
      ],
      [
        { from: "pkg-compiler", to: "pkg-core", kind: "depends_on" },
        { from: "pkg-core", to: "doc-arch", kind: "documents" },
      ],
    );
  }

  it("builds with correct node/edge count", () => {
    const g = sampleGraph();
    assert.equal(g.nodeCount, 3);
    assert.equal(g.edgeCount, 2);
  });

  it("queryGraph filters by label", () => {
    const g = sampleGraph();
    const filtered = queryGraph(g, "core");
    assert.ok(filtered.hasNode("pkg-core"));
    assert.ok(filtered.hasNode("pkg-compiler")); // label contains "core" via "compiler"? no — but "logicn-core-compiler" contains "core"
  });

  it("explainNode returns node info string", () => {
    const g = sampleGraph();
    const explanation = explainNode(g, "pkg-core");
    assert.ok(explanation.includes("pkg-core"));
    assert.ok(explanation.includes("Package"));
  });

  it("explainNode returns not-found message for missing node", () => {
    const g = sampleGraph();
    const msg = explainNode(g, "MISSING");
    assert.ok(msg.includes("not found"));
  });

  it("findPath returns path between connected nodes", () => {
    const g = sampleGraph();
    const path = findPath(g, "pkg-compiler", "doc-arch");
    assert.ok(path !== null && path.includes("pkg-compiler") && path.includes("doc-arch"));
  });

  it("findPath returns null for disconnected nodes", () => {
    const g = sampleGraph();
    const path = findPath(g, "doc-arch", "pkg-compiler");
    assert.equal(path, null);
  });
});

// ---------------------------------------------------------------------------
// DependencyGraph
// ---------------------------------------------------------------------------

describe("DependencyGraph — buildDependencyGraph", () => {
  it("produces LLN-PGRAPH-003 for missing dependency", () => {
    const { diagnostics } = buildDependencyGraph([
      { name: "task-a", depends: ["MISSING"] },
    ]);
    assert.ok(diagnostics.some((d) => d.code === "LLN-PGRAPH-003"));
  });

  it("creates no diagnostics when all dependencies exist", () => {
    const { diagnostics } = buildDependencyGraph([
      { name: "task-a" },
      { name: "task-b", depends: ["task-a"] },
    ]);
    assert.deepEqual(diagnostics, []);
  });
});

describe("resolveDependencies", () => {
  it("resolves a valid chain in correct order", () => {
    const { graph } = buildDependencyGraph([
      { name: "install" },
      { name: "build", depends: ["install"] },
      { name: "test", depends: ["build"] },
    ]);
    const result = resolveDependencies(graph);
    assert.equal(result.ok, true);
    assert.deepEqual(result.order, ["install", "build", "test"]);
  });

  it("returns ok:false and LLN-PGRAPH-001 for circular dependency", () => {
    // Build the graph manually to create a cycle (buildDependencyGraph skips unknown deps
    // since it can't add edges for nodes that don't exist — we use GraphBuilder directly).
    // GraphBuilder is already imported at the top of this file.
    const b = new GraphBuilder();
    b.addNode("a", { taskName: "a" });
    b.addNode("b", { taskName: "b" });
    b.addEdge("a", "b", { required: true });
    b.addEdge("b", "a", { required: true });
    const g = b.build();
    const result = resolveDependencies(g);
    assert.equal(result.ok, false);
    assert.equal(result.diagnostic?.code, "LLN-PGRAPH-001");
  });
});

// ---------------------------------------------------------------------------
// ResourceLifecycleGraph
// ---------------------------------------------------------------------------

describe("ResourceLifecycleGraph", () => {
  it("builds with declared initial state", () => {
    const g = buildResourceLifecycleGraph([
      { resourceName: "Database", scope: "runtime" },
    ]);
    assert.equal(g.node("Database")?.data.state, "declared");
  });

  it("validates allowed transitions", () => {
    assert.ok(validateTransition("declared", "planned"));
    assert.ok(validateTransition("initializing", "ready"));
    assert.ok(validateTransition("ready", "shutting_down"));
  });

  it("rejects invalid transitions", () => {
    assert.equal(validateTransition("closed", "ready"), false);
    assert.equal(validateTransition("ready", "declared"), false);
  });

  it("advanceState returns updated graph on valid transition", () => {
    const g = buildResourceLifecycleGraph([
      { resourceName: "Cache", scope: "runtime" },
    ]);
    const result = advanceState(g, "Cache", "planned", { trigger: "plan_complete" });
    assert.equal(result.ok, true);
    assert.equal(result.graph.node("Cache")?.data.state, "planned");
  });

  it("advanceState returns diagnostic for invalid transition", () => {
    const g = buildResourceLifecycleGraph([
      { resourceName: "Cache", scope: "runtime" },
    ]);
    const result = advanceState(g, "Cache", "closed", { trigger: "skip" });
    assert.equal(result.ok, false);
    assert.equal(result.diagnostic.code, "LLN-PGRAPH-005");
  });

  it("advanceState returns diagnostic for unknown resource", () => {
    const g = buildResourceLifecycleGraph([]);
    const result = advanceState(g, "MISSING", "ready", { trigger: "x" });
    assert.equal(result.ok, false);
    assert.equal(result.diagnostic.code, "LLN-PGRAPH-002");
  });
});

// ---------------------------------------------------------------------------
// CapabilityGraph
// ---------------------------------------------------------------------------

describe("CapabilityGraph", () => {
  function sampleCapabilityGraph() {
    return buildCapabilityGraph(
      [
        { name: "DatabaseAccess", kind: "capability" },
        { name: "NetworkRequest", kind: "capability" },
        { name: "getUser", kind: "flow" },
      ],
      [
        { from: "getUser", to: "DatabaseAccess", kind: "requires" },
        { from: "getUser", to: "DatabaseAccess", kind: "grants" },
      ],
    );
  }

  it("resolves granted capabilities for a flow", () => {
    const g = sampleCapabilityGraph();
    const granted = resolveCapabilities(g, "getUser");
    assert.ok(granted.includes("DatabaseAccess"));
  });

  it("validateCapabilities returns LLN-PGRAPH-030 for missing grant", () => {
    const g = buildCapabilityGraph(
      [
        { name: "SecretAccess", kind: "capability" },
        { name: "dangerousFlow", kind: "flow" },
      ],
      [{ from: "dangerousFlow", to: "SecretAccess", kind: "requires" }],
      // No "grants" edge — SecretAccess is required but not reachable via grants
    );
    const diags = validateCapabilities(g);
    assert.ok(diags.some((d) => d.code === "LLN-PGRAPH-030"));
  });
});

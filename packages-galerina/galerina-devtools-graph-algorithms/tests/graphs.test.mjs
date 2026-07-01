import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { buildEffectGraph } = await import("../dist/graphs/effect-graph.js");
const { buildCallGraph } = await import("../dist/graphs/call-graph.js");
const {
  buildCapabilityGraph,
  getCapabilitiesRequiredByFlow,
  getFlowsRequiringCapability,
  getWASMImportsForFlow,
} = await import("../dist/graphs/capability-graph.js");
const { topoSort } = await import("../dist/algorithms/topo.js");
const { detectCycle } = await import("../dist/algorithms/dfs.js");

const { SemanticGraphBuilder } = await import("../dist/semantic/SemanticGraph.js");
const {
  NodeFlagQuery,
  GovernanceFlagQuery,
  EffectFlagQuery,
  NativeCapabilityQuery,
  findFlowsByNodeFlags,
  findFlowsByGovernanceFlags,
  findFlowsByEffectFlags,
  findFlowsByNativeCapability,
  getGraphFlagSummary,
  findFlowsWithNetworkPolicy,
  findFlowsWithProcessSpawn,
  findFlowsWithSecretAccess,
  getAntiAbuseReport,
  getPerformanceSummary,
  getGraphReadiness,
} = await import("../dist/semantic/flag-queries.js");

// ─── EffectGraph ───────────────────────────────────────────────────────────

describe("buildEffectGraph", () => {
  const flows = [
    { name: "fetchUser", declaredEffects: ["io.read"], calls: ["logAccess"] },
    { name: "logAccess", declaredEffects: ["io.write"], calls: [] },
    { name: "computeScore", declaredEffects: [], calls: ["fetchUser"] },
  ];

  it("creates a node for every named flow", () => {
    const g = buildEffectGraph(flows);
    assert.ok(g.hasNode("fetchUser"));
    assert.ok(g.hasNode("logAccess"));
    assert.ok(g.hasNode("computeScore"));
  });

  it("node data carries declared effects", () => {
    const g = buildEffectGraph(flows);
    assert.deepEqual(g.node("fetchUser")?.data.declaredEffects, ["io.read"]);
    assert.deepEqual(g.node("logAccess")?.data.declaredEffects, ["io.write"]);
  });

  it("edges reflect the call relationships", () => {
    const g = buildEffectGraph(flows);
    const fetcherOuts = g.outEdges("fetchUser").map((e) => e.to);
    assert.deepEqual(fetcherOuts, ["logAccess"]);

    const scoreOuts = g.outEdges("computeScore").map((e) => e.to);
    assert.deepEqual(scoreOuts, ["fetchUser"]);
  });

  it("edge data has callType 'direct'", () => {
    const g = buildEffectGraph(flows);
    const edge = g.outEdges("fetchUser")[0];
    assert.equal(edge?.data.callType, "direct");
  });

  it("implicitly-referenced callees are added as stub nodes", () => {
    const g = buildEffectGraph([
      { name: "alpha", declaredEffects: [], calls: ["beta"] },
    ]);
    assert.ok(g.hasNode("beta"));
    assert.deepEqual(g.node("beta")?.data.declaredEffects, []);
  });

  it("empty flow list produces an empty graph", () => {
    const g = buildEffectGraph([]);
    assert.equal(g.nodeCount, 0);
    assert.equal(g.edgeCount, 0);
  });
});

// ─── CallGraph ─────────────────────────────────────────────────────────────

describe("buildCallGraph", () => {
  const flows = [
    { name: "main", qualifier: "app", calledFlows: ["authCheck", "renderPage"] },
    { name: "authCheck", qualifier: "auth", calledFlows: ["fetchSession"] },
    { name: "renderPage", qualifier: "ui", calledFlows: [] },
    { name: "fetchSession", qualifier: "auth", calledFlows: [] },
  ];

  it("creates a node for every named flow", () => {
    const g = buildCallGraph(flows);
    assert.equal(g.nodeCount, 4);
    assert.ok(g.hasNode("main"));
    assert.ok(g.hasNode("authCheck"));
  });

  it("node data carries flowName and qualifier", () => {
    const g = buildCallGraph(flows);
    assert.equal(g.node("authCheck")?.data.qualifier, "auth");
    assert.equal(g.node("renderPage")?.data.flowName, "renderPage");
  });

  it("edges represent direct call relationships", () => {
    const g = buildCallGraph(flows);
    const mainOuts = g.outEdges("main").map((e) => e.to).sort();
    assert.deepEqual(mainOuts, ["authCheck", "renderPage"]);
  });

  it("topoSort on CallGraph gives a valid execution order (DAG)", () => {
    // Edges go caller→callee (main→authCheck etc.), so Kahn's places callers
    // before their callees: main < authCheck < fetchSession.
    const g = buildCallGraph(flows);
    const { order, cycle } = topoSort(g);
    assert.equal(cycle, undefined);
    assert.equal(order.length, 4);
    const pos = (id) => order.indexOf(id);
    assert.ok(pos("main") < pos("authCheck"), "main should precede authCheck");
    assert.ok(pos("main") < pos("renderPage"), "main should precede renderPage");
    assert.ok(pos("authCheck") < pos("fetchSession"), "authCheck should precede fetchSession");
  });

  it("detectCycle on a circular call graph returns hasCycle true", () => {
    const circular = [
      { name: "a", qualifier: "m", calledFlows: ["b"] },
      { name: "b", qualifier: "m", calledFlows: ["c"] },
      { name: "c", qualifier: "m", calledFlows: ["a"] },
    ];
    const g = buildCallGraph(circular);
    const result = detectCycle(g);
    assert.equal(result.hasCycle, true);
  });

  it("edge callSite encodes the caller→callee string", () => {
    const g = buildCallGraph(flows);
    const edge = g.outEdges("main").find((e) => e.to === "authCheck");
    assert.equal(edge?.data.callSite, "main->authCheck");
  });
});

// ─── Flag Queries ──────────────────────────────────────────────────────────

// Shared graph used across flag-query tests.
// 5 flow/fn nodes + 2 non-flow nodes (type, module).
function buildFlagTestGraph() {
  const b = new SemanticGraphBuilder();
  b.addNode({ id: "pureFlow",   kind: "flow",   name: "pureFlow" });
  b.addNode({ id: "secureFlow", kind: "flow",   name: "secureFlow" });
  b.addNode({ id: "tensorFlow", kind: "flow",   name: "tensorFlow" });
  b.addNode({ id: "mixedFlow",  kind: "flow",   name: "mixedFlow" });
  b.addNode({ id: "helperFn",   kind: "fn",     name: "helperFn" });
  b.addNode({ id: "MyType",     kind: "type",   name: "MyType" });
  b.addNode({ id: "myModule",   kind: "module", name: "myModule" });
  return b.build();
}

describe("findFlowsByNodeFlags", () => {
  it("returns only flows that match the IsPure flag", () => {
    const graph = buildFlagTestGraph();
    const nodeFlagsMap = new Map([
      ["pureFlow",   NodeFlagQuery.IsPure | NodeFlagQuery.HasContract],
      ["secureFlow", NodeFlagQuery.IsSecure],
      ["tensorFlow", NodeFlagQuery.TensorCandidate],
      ["mixedFlow",  NodeFlagQuery.IsPure | NodeFlagQuery.IsSecure],
      ["helperFn",   0],
    ]);
    const results = findFlowsByNodeFlags(graph, nodeFlagsMap, NodeFlagQuery.IsPure);
    const ids = results.map((n) => n.id).sort();
    assert.deepEqual(ids, ["mixedFlow", "pureFlow"]);
  });

  it("returns flows matching a combined flag mask (IsPure AND IsSecure)", () => {
    const graph = buildFlagTestGraph();
    const nodeFlagsMap = new Map([
      ["pureFlow",   NodeFlagQuery.IsPure],
      ["secureFlow", NodeFlagQuery.IsSecure],
      ["mixedFlow",  NodeFlagQuery.IsPure | NodeFlagQuery.IsSecure],
    ]);
    const mask = NodeFlagQuery.IsPure | NodeFlagQuery.IsSecure;
    const results = findFlowsByNodeFlags(graph, nodeFlagsMap, mask);
    const ids = results.map((n) => n.id);
    assert.deepEqual(ids, ["mixedFlow"]);
  });

  it("returns an empty array when no flows match", () => {
    const graph = buildFlagTestGraph();
    const results = findFlowsByNodeFlags(graph, new Map(), NodeFlagQuery.HasPrivacy);
    assert.deepEqual(results, []);
  });

  it("includes fn-kind nodes as well as flow-kind nodes", () => {
    const graph = buildFlagTestGraph();
    const nodeFlagsMap = new Map([
      ["helperFn",  NodeFlagQuery.IsPure],
      ["pureFlow",  NodeFlagQuery.IsPure],
    ]);
    const results = findFlowsByNodeFlags(graph, nodeFlagsMap, NodeFlagQuery.IsPure);
    const ids = results.map((n) => n.id).sort();
    assert.deepEqual(ids, ["helperFn", "pureFlow"]);
  });

  it("does NOT include non-flow/non-fn nodes (type, module, etc.)", () => {
    const graph = buildFlagTestGraph();
    // Give every node the IsPure flag — type/module must still be excluded
    const nodeFlagsMap = new Map(
      graph.nodes.map((n) => [n.id, NodeFlagQuery.IsPure])
    );
    const results = findFlowsByNodeFlags(graph, nodeFlagsMap, NodeFlagQuery.IsPure);
    const nonFlow = results.filter((n) => n.kind !== "flow" && n.kind !== "fn");
    assert.equal(nonFlow.length, 0);
  });
});

describe("findFlowsByGovernanceFlags", () => {
  it("returns flows that require audit", () => {
    const graph = buildFlagTestGraph();
    const govFlagsMap = new Map([
      ["pureFlow",   GovernanceFlagQuery.RequiresAudit],
      ["secureFlow", GovernanceFlagQuery.DenyRemote],
      ["mixedFlow",  GovernanceFlagQuery.RequiresAudit | GovernanceFlagQuery.ContainsPII],
    ]);
    const results = findFlowsByGovernanceFlags(graph, govFlagsMap, GovernanceFlagQuery.RequiresAudit);
    const ids = results.map((n) => n.id).sort();
    assert.deepEqual(ids, ["mixedFlow", "pureFlow"]);
  });

  it("returns flows matching a combined governance mask", () => {
    const graph = buildFlagTestGraph();
    const govFlagsMap = new Map([
      ["pureFlow",  GovernanceFlagQuery.RequiresAudit],
      ["mixedFlow", GovernanceFlagQuery.RequiresAudit | GovernanceFlagQuery.ContainsPII],
    ]);
    const mask = GovernanceFlagQuery.RequiresAudit | GovernanceFlagQuery.ContainsPII;
    const results = findFlowsByGovernanceFlags(graph, govFlagsMap, mask);
    const ids = results.map((n) => n.id);
    assert.deepEqual(ids, ["mixedFlow"]);
  });

  it("returns empty array when governance map is empty", () => {
    const graph = buildFlagTestGraph();
    const results = findFlowsByGovernanceFlags(graph, new Map(), GovernanceFlagQuery.DenyRemote);
    assert.deepEqual(results, []);
  });
});

describe("findFlowsByEffectFlags", () => {
  it("returns flows that have DatabaseWrite effect", () => {
    const graph = buildFlagTestGraph();
    const effectFlagsMap = new Map([
      ["pureFlow",   EffectFlagQuery.DatabaseRead],
      ["secureFlow", EffectFlagQuery.DatabaseWrite | EffectFlagQuery.AuditWrite],
      ["mixedFlow",  EffectFlagQuery.DatabaseWrite],
    ]);
    const results = findFlowsByEffectFlags(graph, effectFlagsMap, EffectFlagQuery.DatabaseWrite);
    const ids = results.map((n) => n.id).sort();
    assert.deepEqual(ids, ["mixedFlow", "secureFlow"]);
  });

  it("returns flows that write database AND write audit", () => {
    const graph = buildFlagTestGraph();
    const effectFlagsMap = new Map([
      ["secureFlow", EffectFlagQuery.DatabaseWrite | EffectFlagQuery.AuditWrite],
      ["mixedFlow",  EffectFlagQuery.DatabaseWrite],
    ]);
    const mask = EffectFlagQuery.DatabaseWrite | EffectFlagQuery.AuditWrite;
    const results = findFlowsByEffectFlags(graph, effectFlagsMap, mask);
    const ids = results.map((n) => n.id);
    assert.deepEqual(ids, ["secureFlow"]);
  });
});

// ─── CapabilityGraph ────────────────────────────────────────────────────────

describe("buildCapabilityGraph", () => {
  const flows = [
    {
      name: "readUserFile",
      requiredCapabilities: [
        {
          functionName: "File.readText",
          requiredEffects: ["storage.read"],
          wasmImport: "host:fs.readText",
        },
      ],
    },
    {
      name: "writeLog",
      requiredCapabilities: [
        {
          functionName: "File.writeText",
          requiredEffects: ["storage.write"],
          wasmImport: "host:fs.writeText",
        },
      ],
    },
    {
      name: "readAndLog",
      requiredCapabilities: [
        {
          functionName: "File.readText",
          requiredEffects: ["storage.read"],
          wasmImport: "host:fs.readText",
        },
        {
          functionName: "Console.log",
          requiredEffects: ["io.stdout"],
        },
      ],
    },
  ];

  it("getCapabilitiesRequiredByFlow returns correct capabilities for a flow", () => {
    const g = buildCapabilityGraph(flows);
    const caps = getCapabilitiesRequiredByFlow(g, "readAndLog");
    const fnNames = caps.map((c) => c.functionName).sort();
    assert.deepEqual(fnNames, ["Console.log", "File.readText"]);
    const fileReadCap = caps.find((c) => c.functionName === "File.readText");
    assert.deepEqual(fileReadCap?.requiredEffects, ["storage.read"]);
    assert.equal(fileReadCap?.wasmImport, "host:fs.readText");
  });

  it("getFlowsRequiringCapability returns all flows that use a stdlib function", () => {
    const g = buildCapabilityGraph(flows);
    const usersOfReadText = getFlowsRequiringCapability(g, "File.readText").slice().sort();
    assert.deepEqual(usersOfReadText, ["readAndLog", "readUserFile"]);

    const usersOfWriteText = getFlowsRequiringCapability(g, "File.writeText");
    assert.deepEqual(usersOfWriteText, ["writeLog"]);
  });

  it("getWASMImportsForFlow returns transitively required WASM imports", () => {
    const g = buildCapabilityGraph(flows);
    const imports = getWASMImportsForFlow(g, "readAndLog").slice().sort();
    // readAndLog needs File.readText (→ host:fs.readText) and Console.log (no wasm import)
    assert.deepEqual(imports, ["host:fs.readText"]);

    // A capability with no wasmImport produces no wasm entries
    const consoleImports = getWASMImportsForFlow(g, "writeLog");
    assert.deepEqual(consoleImports, ["host:fs.writeText"]);

    // Flow not in graph returns empty
    assert.deepEqual(getWASMImportsForFlow(g, "nonExistentFlow"), []);
  });
});

describe("getGraphFlagSummary", () => {
  it("counts pure, secure, tensor flows correctly", () => {
    const graph = buildFlagTestGraph();
    const nodeFlagsMap = new Map([
      ["pureFlow",   NodeFlagQuery.IsPure],
      ["secureFlow", NodeFlagQuery.IsSecure],
      ["tensorFlow", NodeFlagQuery.TensorCandidate],
      ["mixedFlow",  NodeFlagQuery.IsPure | NodeFlagQuery.IsSecure | NodeFlagQuery.TensorCandidate],
    ]);
    const summary = getGraphFlagSummary(graph, nodeFlagsMap, new Map());
    // 5 flow/fn nodes: pureFlow, secureFlow, tensorFlow, mixedFlow, helperFn
    assert.equal(summary.totalFlows, 5);
    assert.equal(summary.pureFlows, 2);        // pureFlow + mixedFlow
    assert.equal(summary.secureFlows, 2);      // secureFlow + mixedFlow
    assert.equal(summary.tensorCandidates, 2); // tensorFlow + mixedFlow
  });

  it("counts governance flags correctly", () => {
    const graph = buildFlagTestGraph();
    const govFlagsMap = new Map([
      ["pureFlow",   GovernanceFlagQuery.RequiresAudit | GovernanceFlagQuery.ContainsPII],
      ["secureFlow", GovernanceFlagQuery.DenyRemote | GovernanceFlagQuery.AllowsNetwork],
      ["mixedFlow",  GovernanceFlagQuery.RequiresAudit],
    ]);
    const summary = getGraphFlagSummary(graph, new Map(), govFlagsMap);
    assert.equal(summary.requiresAudit, 2); // pureFlow + mixedFlow
    assert.equal(summary.containsPII, 1);   // pureFlow
    assert.equal(summary.denyRemote, 1);    // secureFlow
    assert.equal(summary.allowsNetwork, 1); // secureFlow
  });

  it("returns zeros for empty flag maps", () => {
    const graph = buildFlagTestGraph();
    const summary = getGraphFlagSummary(graph, new Map(), new Map());
    assert.equal(summary.pureFlows, 0);
    assert.equal(summary.secureFlows, 0);
    assert.equal(summary.tensorCandidates, 0);
    assert.equal(summary.requiresAudit, 0);
    assert.equal(summary.containsPII, 0);
    assert.equal(summary.allowsNetwork, 0);
    assert.equal(summary.denyRemote, 0);
  });

  it("totalFlows reflects only flow/fn nodes, not type/module nodes", () => {
    const graph = buildFlagTestGraph();
    // buildFlagTestGraph has 5 flow/fn nodes and 2 non-flow nodes
    const summary = getGraphFlagSummary(graph, new Map(), new Map());
    assert.equal(summary.totalFlows, 5);
  });
});

describe("findFlowsByNativeCapability", () => {
  it("returns flows that use the specified native capability", () => {
    const graph = buildFlagTestGraph();
    const capabilityUsageByFlow = new Map([
      ["pureFlow",   [NativeCapabilityQuery.NpuInference, NativeCapabilityQuery.GpuCompute]],
      ["secureFlow", [NativeCapabilityQuery.PhotonicBridge]],
      ["tensorFlow", [NativeCapabilityQuery.GpuCompute, NativeCapabilityQuery.GpuMatmul]],
      ["mixedFlow",  []],
      ["helperFn",   [NativeCapabilityQuery.WasmSimd]],
    ]);
    const results = findFlowsByNativeCapability(graph, capabilityUsageByFlow, NativeCapabilityQuery.GpuCompute);
    const ids = results.map((n) => n.id).sort();
    assert.deepEqual(ids, ["pureFlow", "tensorFlow"]);
  });

  it("returns an empty array when no flows use the required capability", () => {
    const graph = buildFlagTestGraph();
    const capabilityUsageByFlow = new Map([
      ["pureFlow",   [NativeCapabilityQuery.NpuInference]],
      ["secureFlow", [NativeCapabilityQuery.WasmSimd]],
    ]);
    const results = findFlowsByNativeCapability(graph, capabilityUsageByFlow, NativeCapabilityQuery.ApuSharedMemory);
    assert.deepEqual(results, []);
  });
});

// ─── Anti-abuse graph queries ──────────────────────────────────────────────

describe("Anti-abuse graph queries", () => {
  it("getAntiAbuseReport with empty graph returns all zeros", () => {
    const b = new SemanticGraphBuilder();
    const graph = b.build();
    const report = getAntiAbuseReport(graph, new Map(), new Map());
    assert.equal(report.networkFlows, 0);
    assert.equal(report.auditedFlows, 0);
    assert.equal(report.unauditedNetworkFlows, 0);
    assert.equal(report.processSpawnFlows, 0);
    assert.equal(report.piiFlows, 0);
  });

  it("findFlowsWithNetworkPolicy returns correct flows", () => {
    const graph = buildFlagTestGraph();
    const effectFlagsMap = new Map([
      ["pureFlow",   EffectFlagQuery.NetworkOutbound],
      ["secureFlow", EffectFlagQuery.DatabaseRead],
      ["tensorFlow", EffectFlagQuery.NetworkOutbound | EffectFlagQuery.AuditWrite],
      ["mixedFlow",  0],
      ["helperFn",   0],
    ]);
    const results = findFlowsWithNetworkPolicy(graph, effectFlagsMap);
    const ids = results.map((n) => n.id).sort();
    assert.deepEqual(ids, ["pureFlow", "tensorFlow"]);
  });

  it("unauditedNetworkFlows detected correctly", () => {
    const graph = buildFlagTestGraph();
    // pureFlow: network only (no audit) — risk
    // tensorFlow: network + audit — safe
    // secureFlow: audit only — not a network flow
    const effectFlagsMap = new Map([
      ["pureFlow",   EffectFlagQuery.NetworkOutbound],
      ["tensorFlow", EffectFlagQuery.NetworkOutbound | EffectFlagQuery.AuditWrite],
      ["secureFlow", EffectFlagQuery.AuditWrite],
    ]);
    const report = getAntiAbuseReport(graph, effectFlagsMap, new Map());
    assert.equal(report.networkFlows, 2);
    assert.equal(report.auditedFlows, 2);
    assert.equal(report.unauditedNetworkFlows, 1); // only pureFlow
  });

  it("EffectFlagQuery.ProcessSpawn is a power of 2", () => {
    const v = EffectFlagQuery.ProcessSpawn;
    assert.ok(v > 0 && (v & (v - 1)) === 0, `ProcessSpawn (${v}) must be a power of 2`);
  });
});

// ─── Performance queries ───────────────────────────────────────────────────

describe("Performance queries: getPerformanceSummary and getGraphReadiness", () => {
  it("getPerformanceSummary counts pure and hotDispatchable flows correctly", () => {
    const graph = buildFlagTestGraph();
    // pureFlow: IsPure + HasCompute (effect-free) → pure + hotDispatchable
    // mixedFlow: IsPure + HasEffects → pure but NOT hotDispatchable
    // tensorFlow: TensorCandidate only → neither pure nor hotDispatchable; no compute → opportunity
    // secureFlow: IsSecure only → none
    // helperFn: no flags → fallback
    const nodeFlagsMap = new Map([
      ["pureFlow",   NodeFlagQuery.IsPure | NodeFlagQuery.HasCompute],
      ["mixedFlow",  NodeFlagQuery.IsPure | NodeFlagQuery.HasEffects],
      ["tensorFlow", NodeFlagQuery.TensorCandidate],
      ["secureFlow", NodeFlagQuery.IsSecure],
      ["helperFn",   0],
    ]);
    const summary = getPerformanceSummary(graph, nodeFlagsMap, new Map());
    assert.equal(summary.totalFlows, 5);
    assert.equal(summary.pureFlows, 2);          // pureFlow + mixedFlow
    assert.equal(summary.hotDispatchable, 1);    // only pureFlow (pure + effect-free + compute)
    assert.equal(summary.cachedFlows, 0);
    assert.equal(summary.cacheHitRate, 0);
    // tensorFlow has TensorCandidate but no compute → should note opportunity
    const hasTensorNote = summary.optimisationOpportunities.some((o) =>
      o.includes("TensorCandidate") && o.includes("no compute block")
    );
    assert.ok(hasTensorNote, "should flag TensorCandidate without compute block");
  });

  it("getPerformanceSummary includes low-cache-hit-rate advisory when below 50%", () => {
    const graph = buildFlagTestGraph();
    const nodeFlagsMap = new Map([
      ["pureFlow", NodeFlagQuery.IsPure | NodeFlagQuery.HasCompute],
    ]);
    const cacheStats = { hits: 1, misses: 9, size: 1 };
    const summary = getPerformanceSummary(graph, nodeFlagsMap, new Map(), cacheStats);
    assert.equal(summary.cacheHitRate, 0.1);
    const hasHitRateNote = summary.optimisationOpportunities.some((o) =>
      o.includes("below 50%")
    );
    assert.ok(hasHitRateNote, "should warn about low cache hit rate");
  });

  it("getGraphReadiness classifies flows into ready / partial / fallback", () => {
    const graph = buildFlagTestGraph();
    // pureFlow: IsPure, no HasEffects → ready
    // mixedFlow: IsPure + HasEffects → partial
    // secureFlow: IsSecure only (not IsPure) → fallback
    // tensorFlow: TensorCandidate only → fallback
    // helperFn: no flags → fallback
    const nodeFlagsMap = new Map([
      ["pureFlow",   NodeFlagQuery.IsPure],
      ["mixedFlow",  NodeFlagQuery.IsPure | NodeFlagQuery.HasEffects],
      ["secureFlow", NodeFlagQuery.IsSecure],
      ["tensorFlow", NodeFlagQuery.TensorCandidate],
      ["helperFn",   0],
    ]);
    const readiness = getGraphReadiness(graph, nodeFlagsMap);
    assert.equal(readiness.get("pureFlow"),   "ready");
    assert.equal(readiness.get("mixedFlow"),  "partial");
    assert.equal(readiness.get("secureFlow"), "fallback");
    assert.equal(readiness.get("tensorFlow"), "fallback");
    assert.equal(readiness.get("helperFn"),   "fallback");
  });

  it("getGraphReadiness returns an empty map for an empty graph", () => {
    const b = new SemanticGraphBuilder();
    const graph = b.build();
    const readiness = getGraphReadiness(graph, new Map());
    assert.equal(readiness.size, 0);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  buildWASMModuleGraph,
  getExports,
  getImports,
  getImportsForFlow,
} = await import("../dist/graphs/wasm-module-graph.js");

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const capabilityEntries = [
  {
    functionName: "File.readText",
    wasmImport: "host:fs.readText",
    requiredEffects: ["filesystem.read"],
  },
  {
    functionName: "Console.log",
    wasmImport: "host:io.log",
    requiredEffects: ["io.stdout"],
  },
  {
    functionName: "Http.fetch",
    wasmImport: "host:net.fetch",
    requiredEffects: ["network.outbound"],
  },
];

const girFlows = [
  {
    name: "handleRequest",
    qualifier: "api",
    entryPoints: ["handleRequest"],
    allowedEffectsMask: 0b111,
    effects: { declared: ["network.outbound"] },
  },
  {
    name: "parseBody",
    qualifier: "api",
    entryPoints: [],
    allowedEffectsMask: 0,
    effects: { declared: [] },
  },
  {
    name: "logRequest",
    qualifier: "api",
    entryPoints: [],
    allowedEffectsMask: 0b010,
    effects: { declared: ["io.stdout"] },
  },
];

const entryPoints = ["handleRequest"];

// ─── Test 1: getExports returns correct flow names ───────────────────────────

describe("getExports", () => {
  it("returns galerinaName of all export nodes", () => {
    const graph = buildWASMModuleGraph(girFlows, entryPoints, capabilityEntries);
    const exports = getExports(graph);
    assert.deepEqual(exports, ["handleRequest"]);
  });

  it("returns empty array when no entry points are marked as exports", () => {
    const graph = buildWASMModuleGraph(girFlows, [], capabilityEntries);
    const exports = getExports(graph);
    assert.deepEqual(exports, []);
  });

  it("returns multiple exports when multiple entry points are given", () => {
    const multiFlows = [
      ...girFlows,
      {
        name: "healthCheck",
        qualifier: "api",
        entryPoints: ["healthCheck"],
        allowedEffectsMask: 0,
        effects: { declared: [] },
      },
    ];
    const graph = buildWASMModuleGraph(
      multiFlows,
      ["handleRequest", "healthCheck"],
      capabilityEntries,
    );
    const exports = getExports(graph).sort();
    assert.deepEqual(exports, ["handleRequest", "healthCheck"]);
  });
});

// ─── Test 2: getImports returns all host imports ─────────────────────────────

describe("getImports", () => {
  it("returns one import node per distinct declared effect", () => {
    const graph = buildWASMModuleGraph(girFlows, entryPoints, capabilityEntries);
    const imports = getImports(graph);
    // girFlows declare "network.outbound" (handleRequest) and "io.stdout" (logRequest)
    const effects = imports.map((i) => i.effect).sort();
    assert.deepEqual(effects, ["io.stdout", "network.outbound"]);
  });

  it("all import nodes have kind 'import'", () => {
    const graph = buildWASMModuleGraph(girFlows, entryPoints, capabilityEntries);
    const imports = getImports(graph);
    assert.ok(imports.length > 0, "expected at least one import node");
    for (const imp of imports) {
      assert.equal(imp.kind, "import");
    }
  });

  it("import node wasmName reflects the matching capabilityEntry wasmImport", () => {
    const graph = buildWASMModuleGraph(girFlows, entryPoints, capabilityEntries);
    const netImport = getImports(graph).find((i) => i.effect === "network.outbound");
    assert.ok(netImport !== undefined);
    assert.equal(netImport.wasmName, "host:net.fetch");
    assert.equal(netImport.galerinaName, "Http.fetch");
  });

  it("returns empty array when no flows have declared effects", () => {
    const pureFlows = [
      {
        name: "pure",
        qualifier: "app",
        entryPoints: ["pure"],
        allowedEffectsMask: 0,
        effects: { declared: [] },
      },
    ];
    const graph = buildWASMModuleGraph(pureFlows, ["pure"], capabilityEntries);
    assert.deepEqual(getImports(graph), []);
  });
});

// ─── Test 3: getImportsForFlow returns per-flow imports ──────────────────────

describe("getImportsForFlow", () => {
  it("returns the imports needed by a specific export flow", () => {
    const graph = buildWASMModuleGraph(girFlows, entryPoints, capabilityEntries);
    const imports = getImportsForFlow(graph, "handleRequest");
    const effects = imports.map((i) => i.effect);
    assert.deepEqual(effects, ["network.outbound"]);
  });

  it("returns the imports needed by an internal effectful flow", () => {
    const graph = buildWASMModuleGraph(girFlows, entryPoints, capabilityEntries);
    const imports = getImportsForFlow(graph, "logRequest");
    const effects = imports.map((i) => i.effect);
    assert.deepEqual(effects, ["io.stdout"]);
  });

  it("returns empty array for a pure internal flow with no declared effects", () => {
    const graph = buildWASMModuleGraph(girFlows, entryPoints, capabilityEntries);
    const imports = getImportsForFlow(graph, "parseBody");
    assert.deepEqual(imports, []);
  });

  it("returns empty array for a flow not in the graph", () => {
    const graph = buildWASMModuleGraph(girFlows, entryPoints, capabilityEntries);
    assert.deepEqual(getImportsForFlow(graph, "nonExistent"), []);
  });
});

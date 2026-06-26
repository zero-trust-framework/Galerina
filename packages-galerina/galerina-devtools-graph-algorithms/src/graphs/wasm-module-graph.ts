import { GraphBuilder } from "../core/builder.js";
import type { Graph } from "../core/types.js";

// ─── Node & Edge Data ───────────────────────────────────────────────────────

export interface WASMNodeData {
  readonly kind: "export" | "import" | "internal";
  readonly wasmName: string;
  readonly galerinaName: string;
  readonly paramTypes: readonly string[];
  readonly resultTypes: readonly string[];
  readonly effect?: string;
}

export interface WASMEdgeData {
  readonly relation: "imports" | "exports" | "calls";
}

export type WASMModuleGraph = Graph<WASMNodeData, WASMEdgeData>;

// ─── Builder ────────────────────────────────────────────────────────────────

/**
 * Builds a WASMModuleGraph from GIR data.
 *
 * Nodes:
 *   - One "export" node per GIR entryPoint flow
 *   - One "import" node per WASM import needed (from allowedEffectsMask)
 *   - One "internal" node per pure flow
 *
 * Edges:
 *   - export → calls → internal (pure helpers called from entry points)
 *   - internal → imports → import (when an effectful call is made)
 */
export function buildWASMModuleGraph(
  girFlows: readonly {
    name: string;
    qualifier: string;
    entryPoints: readonly string[];
    allowedEffectsMask: number;
    effects: { declared: readonly string[] };
  }[],
  entryPoints: readonly string[],
  capabilityEntries: readonly {
    functionName: string;
    wasmImport?: string;
    requiredEffects: readonly string[];
  }[],
): WASMModuleGraph {
  const builder = new GraphBuilder<WASMNodeData, WASMEdgeData>();

  const entryPointSet = new Set(entryPoints);

  // Determine which flows are exports vs internals
  const exportFlows = girFlows.filter((f) => entryPointSet.has(f.name));
  const internalFlows = girFlows.filter((f) => !entryPointSet.has(f.name));

  // Build a map from effect name to import node id for deduplication
  // Map: effect → import node id (wasmImport string or functionName)
  const effectToImportNodeId = new Map<string, string>();

  // Pre-compute: which capabilities are relevant (have a wasmImport or requiredEffects)?
  // Build map: effect → capability entry for quick lookup
  const effectToCapability = new Map<
    string,
    { functionName: string; wasmImport?: string; requiredEffects: readonly string[] }
  >();
  for (const cap of capabilityEntries) {
    for (const effect of cap.requiredEffects) {
      if (!effectToCapability.has(effect)) {
        effectToCapability.set(effect, cap);
      }
    }
  }

  // Helper: determine import node id for an effect
  function importNodeId(effect: string): string {
    const cap = effectToCapability.get(effect);
    return cap?.wasmImport ?? `import:${effect}`;
  }

  // Add export nodes
  for (const flow of exportFlows) {
    const nodeId = flow.name;
    if (!builder["nodes"].has(nodeId)) {
      builder.addNode(nodeId, {
        kind: "export",
        wasmName: `$${flow.qualifier}_${flow.name}`,
        galerinaName: flow.name,
        paramTypes: [],
        resultTypes: [],
      });
    }
  }

  // Add internal nodes
  for (const flow of internalFlows) {
    const nodeId = flow.name;
    if (!builder["nodes"].has(nodeId)) {
      builder.addNode(nodeId, {
        kind: "internal",
        wasmName: `$${flow.qualifier}_${flow.name}`,
        galerinaName: flow.name,
        paramTypes: [],
        resultTypes: [],
      });
    }
  }

  // Collect all effects needed across all flows, add import nodes
  const allEffects = new Set<string>();
  for (const flow of girFlows) {
    for (const effect of flow.effects.declared) {
      allEffects.add(effect);
    }
  }

  for (const effect of allEffects) {
    const nodeId = importNodeId(effect);
    if (!builder["nodes"].has(nodeId)) {
      const cap = effectToCapability.get(effect);
      builder.addNode(nodeId, {
        kind: "import",
        wasmName: cap?.wasmImport ?? nodeId,
        galerinaName: cap?.functionName ?? effect,
        paramTypes: [],
        resultTypes: [],
        effect,
      });
      effectToImportNodeId.set(effect, nodeId);
    } else {
      effectToImportNodeId.set(effect, nodeId);
    }
  }

  // Add edges: export → calls → internal (pure helpers)
  // We consider "internal" flows to be called by all export flows as pure helpers
  // (no declared effects means pure helper)
  const pureInternals = internalFlows.filter((f) => f.effects.declared.length === 0);

  for (const exportFlow of exportFlows) {
    for (const internal of pureInternals) {
      // Avoid duplicate edges
      const existing = builder["outEdges"].get(exportFlow.name) ?? [];
      const alreadyLinked = existing.some((e) => e.to === internal.name);
      if (!alreadyLinked) {
        builder.addEdge(exportFlow.name, internal.name, { relation: "calls" });
      }
    }
  }

  // Add edges: internal/export → imports → import (when effectful)
  for (const flow of girFlows) {
    for (const effect of flow.effects.declared) {
      const importId = effectToImportNodeId.get(effect);
      if (importId === undefined) continue;

      // Avoid duplicate edges
      const existing = builder["outEdges"].get(flow.name) ?? [];
      const alreadyLinked = existing.some((e) => e.to === importId);
      if (!alreadyLinked) {
        builder.addEdge(flow.name, importId, { relation: "imports" });
      }
    }
  }

  return builder.build();
}

// ─── Query Functions ─────────────────────────────────────────────────────────

/**
 * Returns the galerinaName of all export nodes in the graph.
 */
export function getExports(graph: WASMModuleGraph): string[] {
  return graph
    .nodes()
    .filter((n) => n.data.kind === "export")
    .map((n) => n.data.galerinaName);
}

/**
 * Returns the node data for all import nodes in the graph.
 */
export function getImports(graph: WASMModuleGraph): WASMNodeData[] {
  return graph
    .nodes()
    .filter((n) => n.data.kind === "import")
    .map((n) => n.data);
}

/**
 * Returns the import node data for all imports needed by a specific flow.
 * Follows edges with relation "imports" from the named flow node.
 * Returns an empty array if the flow is not present or has no imports.
 */
export function getImportsForFlow(
  graph: WASMModuleGraph,
  flowName: string,
): WASMNodeData[] {
  if (!graph.hasNode(flowName)) return [];

  return graph
    .outEdges(flowName)
    .filter((e) => e.data.relation === "imports")
    .map((e) => graph.node(e.to)?.data)
    .filter((d): d is WASMNodeData => d !== undefined);
}

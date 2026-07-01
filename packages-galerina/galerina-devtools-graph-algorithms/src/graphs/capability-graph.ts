import { GraphBuilder } from "../core/builder.js";
import type { Graph } from "../core/types.js";

// ─── Node & Edge Data ───────────────────────────────────────────────────────

export interface CapabilityNodeData {
  readonly kind: "flow" | "stdlib" | "wasm-import";
  readonly effectRequired?: string;  // e.g. "storage.read"
  readonly wasmImport?: string;      // e.g. "host:fs.readText"
}

export interface CapabilityEdgeData {
  readonly relation: "requires" | "mapsTo";
  readonly effect: string;
}

export type CapabilityGraph = Graph<CapabilityNodeData, CapabilityEdgeData>;

// ─── Builder Input ──────────────────────────────────────────────────────────

export interface CapabilityEntry {
  readonly functionName: string;         // e.g. "File.readText"
  readonly requiredEffects: readonly string[];  // e.g. ["storage.read"]
  readonly wasmImport?: string;          // e.g. "host:fs.readText"
}

// ─── Builder ────────────────────────────────────────────────────────────────

/**
 * Builds a CapabilityGraph from flows and their stdlib capability requirements.
 *
 * Nodes:
 *   - One "flow" node per distinct flow name.
 *   - One "stdlib" node per distinct CapabilityEntry (keyed by functionName).
 *   - One "wasm-import" node per distinct wasmImport string.
 *
 * Edges:
 *   - flow → stdlib  : relation "requires", effect = first of requiredEffects
 *     (one edge per (flow, capability) pair, one per requiredEffect)
 *   - stdlib → wasm-import : relation "mapsTo", effect = first of requiredEffects
 *
 * Usage:
 *   const capGraph = buildCapabilityGraph(
 *     flows.map(f => ({ name: f.name, capabilities: getStdlibCallsInFlow(f) })),
 *   )
 */
export function buildCapabilityGraph(
  flows: readonly { name: string; requiredCapabilities: readonly CapabilityEntry[] }[],
): CapabilityGraph {
  const builder = new GraphBuilder<CapabilityNodeData, CapabilityEdgeData>();

  // First pass: add all flow nodes
  for (const flow of flows) {
    if (!builder["nodes"].has(flow.name)) {
      builder.addNode(flow.name, { kind: "flow" });
    }
  }

  // Collect all unique stdlib capabilities across all flows
  const capabilityMap = new Map<string, CapabilityEntry>();
  for (const flow of flows) {
    for (const cap of flow.requiredCapabilities) {
      if (!capabilityMap.has(cap.functionName)) {
        capabilityMap.set(cap.functionName, cap);
      }
    }
  }

  // Add stdlib nodes
  for (const [fnName, cap] of capabilityMap) {
    const firstEffect = cap.requiredEffects[0] ?? "";
    const stdlibNodeData: CapabilityNodeData =
      cap.wasmImport !== undefined
        ? { kind: "stdlib", effectRequired: firstEffect, wasmImport: cap.wasmImport }
        : { kind: "stdlib", effectRequired: firstEffect };
    builder.addNode(fnName, stdlibNodeData);
  }

  // Add wasm-import nodes for capabilities that declare one
  const wasmImportsSeen = new Set<string>();
  for (const cap of capabilityMap.values()) {
    if (cap.wasmImport !== undefined && !wasmImportsSeen.has(cap.wasmImport)) {
      wasmImportsSeen.add(cap.wasmImport);
      builder.addNode(cap.wasmImport, {
        kind: "wasm-import",
        wasmImport: cap.wasmImport,
      });
    }
  }

  // Second pass: add edges
  for (const flow of flows) {
    for (const cap of flow.requiredCapabilities) {
      // For each required effect, add a flow→stdlib "requires" edge
      const effects = cap.requiredEffects.length > 0 ? cap.requiredEffects : [""];
      for (const effect of effects) {
        builder.addEdge(flow.name, cap.functionName, {
          relation: "requires",
          effect,
        });
      }

      // stdlib→wasm-import "mapsTo" edge (once per capability)
      if (cap.wasmImport !== undefined) {
        const firstEffect = cap.requiredEffects[0] ?? "";
        // Only add the edge once (it may be requested by multiple flows)
        const existing = builder["outEdges"].get(cap.functionName) ?? [];
        const alreadyLinked = existing.some((e) => e.to === cap.wasmImport);
        if (!alreadyLinked) {
          builder.addEdge(cap.functionName, cap.wasmImport, {
            relation: "mapsTo",
            effect: firstEffect,
          });
        }
      }
    }
  }

  return builder.build();
}

// ─── Query Functions ─────────────────────────────────────────────────────────

/**
 * Returns all CapabilityEntries required by the named flow.
 * Returns an empty array if the flow is not present in the graph.
 */
export function getCapabilitiesRequiredByFlow(
  graph: CapabilityGraph,
  flowName: string,
): readonly CapabilityEntry[] {
  if (!graph.hasNode(flowName)) return [];

  // Collect all out-edges from the flow with relation "requires"
  const stdlibEdges = graph.outEdges(flowName).filter((e) => e.data.relation === "requires");

  // Group effects by stdlib function name to reconstruct CapabilityEntry
  const effectsByFn = new Map<string, string[]>();
  for (const edge of stdlibEdges) {
    const list = effectsByFn.get(edge.to);
    if (list !== undefined) {
      if (!list.includes(edge.data.effect)) {
        list.push(edge.data.effect);
      }
    } else {
      effectsByFn.set(edge.to, edge.data.effect ? [edge.data.effect] : []);
    }
  }

  const results: CapabilityEntry[] = [];
  for (const [fnName, effects] of effectsByFn) {
    const node = graph.node(fnName);
    if (node === undefined) continue;
    const entry: CapabilityEntry =
      node.data.wasmImport !== undefined
        ? { functionName: fnName, requiredEffects: effects, wasmImport: node.data.wasmImport }
        : { functionName: fnName, requiredEffects: effects };
    results.push(entry);
  }
  return results;
}

/**
 * Returns the names of all flows that require a given stdlib capability
 * (identified by its functionName).
 * Returns an empty array if the capability node is not present.
 */
export function getFlowsRequiringCapability(
  graph: CapabilityGraph,
  capabilityName: string,
): readonly string[] {
  if (!graph.hasNode(capabilityName)) return [];

  return graph
    .inEdges(capabilityName)
    .filter((e) => e.data.relation === "requires")
    .map((e) => e.from);
}

/**
 * Returns all WASM import strings that a given flow transitively requires.
 * Follows: flow →requires→ stdlib →mapsTo→ wasm-import
 * Returns an empty array if the flow is not present or has no WASM imports.
 */
export function getWASMImportsForFlow(
  graph: CapabilityGraph,
  flowName: string,
): readonly string[] {
  if (!graph.hasNode(flowName)) return [];

  const wasmImports: string[] = [];

  for (const requiresEdge of graph.outEdges(flowName)) {
    if (requiresEdge.data.relation !== "requires") continue;

    const stdlibNode = requiresEdge.to;
    for (const mapsToEdge of graph.outEdges(stdlibNode)) {
      if (mapsToEdge.data.relation === "mapsTo") {
        const wasmId = mapsToEdge.to;
        if (!wasmImports.includes(wasmId)) {
          wasmImports.push(wasmId);
        }
      }
    }
  }

  return wasmImports;
}

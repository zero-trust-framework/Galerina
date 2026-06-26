// =============================================================================
// lln-graph — CapabilityGraph
//
// Models capability grants and requirements across flows and packages.
// Nodes are capabilities or flows; edges represent "requires" or "grants".
// =============================================================================

import { GraphBuilder } from "../core/builder.js";
import type { Graph, LlnDiagnostic, NodeId } from "../core/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CapabilityNodeKind = "capability" | "flow" | "package" | "actor";

export interface CapabilityNodeData {
  readonly name: string;
  readonly kind: CapabilityNodeKind;
  readonly description?: string;
}

export type CapabilityEdgeKind = "requires" | "grants" | "inherits";

export interface CapabilityEdgeData {
  readonly kind: CapabilityEdgeKind;
  /** Optional: the policy or manifest that authorises this edge. */
  readonly authorisedBy?: string;
}

export type CapabilityGraph = Graph<CapabilityNodeData, CapabilityEdgeData>;

// ---------------------------------------------------------------------------
// Diagnostic constant
// ---------------------------------------------------------------------------

export const LLN_PGRAPH_030 = {
  code: "SPORE-PGRAPH-030",
  name: "CAPABILITY_NOT_GRANTED",
  severity: "error",
  message: "A flow requires a capability that has not been granted.",
} as const satisfies LlnDiagnostic;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface CapabilityEntry {
  readonly name: string;
  readonly kind: CapabilityNodeKind;
  readonly description?: string;
}

export interface CapabilityRelation {
  readonly from: string;
  readonly to: string;
  readonly kind: CapabilityEdgeKind;
  readonly authorisedBy?: string;
}

export function buildCapabilityGraph(
  entries: readonly CapabilityEntry[],
  relations: readonly CapabilityRelation[],
): CapabilityGraph {
  const builder = new GraphBuilder<CapabilityNodeData, CapabilityEdgeData>();

  for (const e of entries) {
    builder.addNode(e.name, { name: e.name, kind: e.kind, description: e.description });
  }

  for (const r of relations) {
    builder.addEdge(r.from, r.to, { kind: r.kind, authorisedBy: r.authorisedBy });
  }

  return builder.build();
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Return all capability names that are directly or transitively granted
 * to `actorId` (follows "grants" and "inherits" edges only — not "requires").
 */
export function resolveCapabilities(
  graph: CapabilityGraph,
  actorId: NodeId,
): string[] {
  const granted: string[] = [];
  const visited = new Set<NodeId>([actorId]);
  const queue: NodeId[] = [actorId];
  let cursor = 0;

  while (cursor < queue.length) {
    const current = queue[cursor++]!;
    for (const edge of graph.outEdges(current)) {
      if (edge.data.kind !== "grants" && edge.data.kind !== "inherits") continue;
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      queue.push(edge.to);
      const node = graph.node(edge.to);
      if (node?.data.kind === "capability") granted.push(edge.to);
    }
  }

  return granted.sort();
}

/**
 * Validate that all "requires" edges from flow nodes are satisfied by
 * granted capabilities reachable from those flows.
 */
export function validateCapabilities(graph: CapabilityGraph): LlnDiagnostic[] {
  const diagnostics: LlnDiagnostic[] = [];

  for (const node of graph.nodes()) {
    if (node.data.kind !== "flow") continue;

    const granted = new Set(resolveCapabilities(graph, node.id));

    for (const edge of graph.outEdges(node.id)) {
      if (edge.data.kind !== "requires") continue;
      if (!granted.has(edge.to)) {
        diagnostics.push({
          ...LLN_PGRAPH_030,
          message: `Flow "${node.id}" requires capability "${edge.to}" which has not been granted.`,
        });
      }
    }
  }

  return diagnostics;
}

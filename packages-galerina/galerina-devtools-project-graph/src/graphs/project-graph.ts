// =============================================================================
// lln-graph — ProjectGraph
//
// Workspace knowledge graph: packages, documents, flows, types, effects,
// policies, and their relationships. Replaces logicn-devtools-project-graph.
//
// Node and edge kinds are preserved identically from the existing
// implementation so migration is a drop-in replacement.
// =============================================================================

import { GraphBuilder } from "../core/builder.js";
import { bfsPath } from "../algorithms/bfs.js";
import type { Graph, NodeId } from "../core/types.js";

// ---------------------------------------------------------------------------
// Node and edge kinds (preserved from logicn-devtools-project-graph)
// ---------------------------------------------------------------------------

export type ProjectGraphNodeKind =
  | "Package"
  | "Document"
  | "Flow"
  | "Type"
  | "Effect"
  | "Policy"
  | "UnsafeFeature"
  | "Report"
  | "Target"
  | "CompilerRule"
  | "RuntimeRule"
  | "SecurityRule"
  | "ComputeFeature"
  | "Decision";

export type ProjectGraphEdgeKind =
  | "owns"
  | "provides"
  | "uses"
  | "checked_by"
  | "enforced_by"
  | "documents"
  | "generates"
  | "fallback_for"
  | "maps_to"
  | "classified_as"
  | "depends_on"
  | "explains";

export type EdgeConfidence = "EXTRACTED" | "INFERRED" | "AMBIGUOUS";

export interface ProjectGraphNodeData {
  readonly kind: ProjectGraphNodeKind;
  readonly label: string;
  readonly sourcePath?: string;
  readonly summary?: string;
  readonly tags: readonly string[];
}

export interface ProjectGraphEdgeData {
  readonly kind: ProjectGraphEdgeKind;
  readonly confidence: EdgeConfidence;
  readonly evidencePath?: string;
  readonly rationale?: string;
}

export type ProjectGraph = Graph<ProjectGraphNodeData, ProjectGraphEdgeData>;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface ProjectGraphNodeEntry {
  readonly id: string;
  readonly kind: ProjectGraphNodeKind;
  readonly label: string;
  readonly sourcePath?: string;
  readonly summary?: string;
  readonly tags?: readonly string[];
}

export interface ProjectGraphEdgeEntry {
  readonly from: string;
  readonly to: string;
  readonly kind: ProjectGraphEdgeKind;
  readonly confidence?: EdgeConfidence;
  readonly evidencePath?: string;
  readonly rationale?: string;
}

export function buildProjectGraph(
  nodes: readonly ProjectGraphNodeEntry[],
  edges: readonly ProjectGraphEdgeEntry[],
): ProjectGraph {
  const builder = new GraphBuilder<ProjectGraphNodeData, ProjectGraphEdgeData>();

  for (const n of nodes) {
    builder.addNode(n.id, {
      kind: n.kind,
      label: n.label,
      sourcePath: n.sourcePath,
      summary: n.summary,
      tags: n.tags ?? [],
    });
  }

  for (const e of edges) {
    builder.addEdge(e.from, e.to, {
      kind: e.kind,
      confidence: e.confidence ?? "EXTRACTED",
      evidencePath: e.evidencePath,
      rationale: e.rationale,
    });
  }

  return builder.build();
}

// ---------------------------------------------------------------------------
// Query operations
// ---------------------------------------------------------------------------

/**
 * Filter the graph to nodes and edges matching `pattern` (case-insensitive).
 * Matches against node id, label, summary, tags, and sourcePath.
 * Edges are included only when both endpoints match.
 */
export function queryGraph(graph: ProjectGraph, pattern: string): ProjectGraph {
  const lower = pattern.toLowerCase();

  const matchingIds = new Set<NodeId>(
    graph
      .nodes()
      .filter(
        (n) =>
          n.id.toLowerCase().includes(lower) ||
          n.data.label.toLowerCase().includes(lower) ||
          (n.data.summary?.toLowerCase().includes(lower) ?? false) ||
          (n.data.sourcePath?.toLowerCase().includes(lower) ?? false) ||
          n.data.tags.some((t) => t.toLowerCase().includes(lower)),
      )
      .map((n) => n.id),
  );

  const filteredEdges = graph
    .edges()
    .filter((e) => matchingIds.has(e.from) && matchingIds.has(e.to));

  const builder = new GraphBuilder<ProjectGraphNodeData, ProjectGraphEdgeData>();
  for (const id of matchingIds) {
    const n = graph.node(id)!;
    builder.addNode(n.id, n.data);
  }
  for (const e of filteredEdges) {
    builder.addEdge(e.from, e.to, e.data);
  }
  return builder.build();
}

/**
 * Return a human-readable explanation of a node: its properties and all
 * incoming and outgoing edges.
 */
export function explainNode(graph: ProjectGraph, nodeId: NodeId): string {
  const node = graph.node(nodeId);
  if (node === undefined) return `Node "${nodeId}" not found in graph.`;

  const lines: string[] = [
    `Node: ${node.id}`,
    `  kind:    ${node.data.kind}`,
    `  label:   ${node.data.label}`,
  ];
  if (node.data.sourcePath !== undefined) lines.push(`  source:  ${node.data.sourcePath}`);
  if (node.data.summary !== undefined) lines.push(`  summary: ${node.data.summary}`);
  if (node.data.tags.length > 0) lines.push(`  tags:    ${node.data.tags.join(", ")}`);

  const outgoing = graph.outEdges(nodeId);
  if (outgoing.length > 0) {
    lines.push("  outgoing edges:");
    for (const e of outgoing) {
      lines.push(`    --[${e.data.kind}]--> ${e.to}`);
    }
  }

  const incoming = graph.inEdges(nodeId);
  if (incoming.length > 0) {
    lines.push("  incoming edges:");
    for (const e of incoming) {
      lines.push(`    ${e.from} --[${e.data.kind}]-->`);
    }
  }

  return lines.join("\n");
}

/**
 * Find the shortest path from one node to another.
 * Delegates to bfsPath(). Returns null if unreachable.
 */
export function findPath(
  graph: ProjectGraph,
  from: NodeId,
  to: NodeId,
): NodeId[] | null {
  return bfsPath(graph, from, to);
}

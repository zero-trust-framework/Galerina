// =============================================================================
// lln-graph — Topological Sort (Kahn's algorithm)
//
// Works on directed graphs. If the graph is not a DAG (contains a cycle),
// returns the partial order produced so far and the remaining cycle nodes.
// =============================================================================

import type { Graph, NodeId } from "../core/types.js";

export type TopoResult =
  | { readonly ok: true; readonly order: readonly NodeId[] }
  | {
      readonly ok: false;
      readonly order: readonly NodeId[];
      readonly cycle: readonly NodeId[];
    };

/**
 * Topological sort using Kahn's in-degree-reduction algorithm.
 *
 * Returns ok:true with `order` (all nodes in topological order) when the
 * graph is a DAG.
 *
 * Returns ok:false with partial `order` and `cycle` (the node ids that could
 * not be scheduled, which form the cycle) when a cycle is detected.
 *
 * Ordering within the same "level" (equal in-degree) is alphabetical by
 * NodeId, guaranteeing deterministic output for the same input.
 */
export function topoSort<N, E>(graph: Graph<N, E>): TopoResult {
  // Compute in-degrees.
  const inDegree = new Map<NodeId, number>();
  for (const node of graph.nodes()) {
    inDegree.set(node.id, 0);
  }
  for (const edge of graph.edges()) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  // Seed queue with zero-in-degree nodes, sorted for determinism.
  const ready: NodeId[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) ready.push(id);
  }
  ready.sort();

  const order: NodeId[] = [];

  while (ready.length > 0) {
    // Take the lexicographically smallest ready node.
    const current = ready.shift()!;
    order.push(current);

    // Reduce in-degree of successors; enqueue newly zero ones.
    const newlyReady: NodeId[] = [];
    for (const edge of graph.outEdges(current)) {
      const deg = (inDegree.get(edge.to) ?? 1) - 1;
      inDegree.set(edge.to, deg);
      if (deg === 0) newlyReady.push(edge.to);
    }
    // Insert in sorted order to keep the queue deterministic.
    newlyReady.sort();
    ready.push(...newlyReady);
    // Re-sort because we may have inserted in the middle semantically;
    // since we always shift from the front and insert sorted, this keeps it correct.
    ready.sort();
  }

  if (order.length === graph.nodeCount) {
    return { ok: true, order };
  }

  // Nodes remaining in inDegree with deg > 0 are part of the cycle.
  const cycle = [...inDegree.entries()]
    .filter(([, deg]) => deg > 0)
    .map(([id]) => id)
    .sort();

  return { ok: false, order, cycle };
}

// =============================================================================
// lln-graph — Depth-First Search algorithms
// =============================================================================

import type { Graph, GraphNode, NodeId } from "../core/types.js";

/**
 * Post-order DFS traversal starting from `start`.
 * The visitor is called once per reachable node, after all descendants
 * have been visited. Nodes not reachable from `start` are not visited.
 */
export function dfsVisit<N, E>(
  graph: Graph<N, E>,
  start: NodeId,
  visitor: (node: GraphNode<N>) => void,
): void {
  const visited = new Set<NodeId>();

  function visit(id: NodeId): void {
    if (visited.has(id)) return;
    visited.add(id);
    for (const edge of graph.outEdges(id)) {
      visit(edge.to);
    }
    const n = graph.node(id);
    if (n !== undefined) visitor(n);
  }

  visit(start);
}

/**
 * Detect whether the graph contains any cycle reachable from any node.
 *
 * Uses the "gray/black" (visiting/visited) DFS technique:
 *  - visiting: currently on the DFS call stack (a back-edge to a visiting node = cycle)
 *  - visited:  fully processed, no cycle found through this node
 *
 * Returns { hasCycle: false } when the graph is acyclic.
 * Returns { hasCycle: true, cycle: NodeId[] } with one example cycle path when cyclic.
 */
export function detectCycle<N, E>(
  graph: Graph<N, E>,
): { hasCycle: false } | { hasCycle: true; cycle: NodeId[] } {
  const visiting = new Set<NodeId>();
  const visited = new Set<NodeId>();

  // `stack` tracks the DFS path for cycle reporting.
  const stack: NodeId[] = [];

  function visit(id: NodeId): NodeId[] | null {
    if (visited.has(id)) return null;
    if (visiting.has(id)) {
      // Back edge found — extract the cycle from the stack.
      const cycleStart = stack.indexOf(id);
      return [...stack.slice(cycleStart), id];
    }

    visiting.add(id);
    stack.push(id);

    for (const edge of graph.outEdges(id)) {
      const cycle = visit(edge.to);
      if (cycle !== null) return cycle;
    }

    stack.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  }

  for (const node of graph.nodes()) {
    if (visited.has(node.id)) continue;
    const cycle = visit(node.id);
    if (cycle !== null) return { hasCycle: true, cycle };
  }

  return { hasCycle: false };
}

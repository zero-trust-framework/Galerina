// =============================================================================
// lln-graph — Breadth-First Search algorithms
// =============================================================================

import type { Graph, NodeId } from "../core/types.js";

/**
 * Find the shortest path between two nodes using BFS.
 * Returns the path as an ordered array of NodeIds (inclusive of from and to),
 * or null if no path exists or either node is missing.
 */
export function bfsPath<N, E>(
  graph: Graph<N, E>,
  from: NodeId,
  to: NodeId,
): NodeId[] | null {
  if (!graph.hasNode(from) || !graph.hasNode(to)) return null;
  if (from === to) return [from];

  const visited = new Set<NodeId>([from]);
  // Each entry in the queue is the current path from `from` to the frontier node.
  const queue: NodeId[][] = [[from]];
  let cursor = 0;

  while (cursor < queue.length) {
    const path = queue[cursor++]!;
    const current = path[path.length - 1]!;

    for (const edge of graph.outEdges(current)) {
      if (visited.has(edge.to)) continue;
      const next = [...path, edge.to];
      if (edge.to === to) return next;
      visited.add(edge.to);
      queue.push(next);
    }
  }

  return null;
}

/**
 * Return the set of all NodeIds reachable from `start` (inclusive of start
 * itself) by following directed edges.
 * Returns an empty set if `start` does not exist.
 */
export function bfsReachable<N, E>(
  graph: Graph<N, E>,
  start: NodeId,
): Set<NodeId> {
  const reachable = new Set<NodeId>();
  if (!graph.hasNode(start)) return reachable;

  reachable.add(start);
  const queue: NodeId[] = [start];
  let cursor = 0;

  while (cursor < queue.length) {
    const current = queue[cursor++]!;
    for (const edge of graph.outEdges(current)) {
      if (reachable.has(edge.to)) continue;
      reachable.add(edge.to);
      queue.push(edge.to);
    }
  }

  return reachable;
}

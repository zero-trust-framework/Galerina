// =============================================================================
// lln-graph — Reachability queries
// =============================================================================

import { bfsReachable } from "./bfs.js";
import type { Graph, NodeId } from "../core/types.js";

/**
 * Returns true if `to` is reachable from `from` by following directed edges.
 * A node is considered reachable from itself (distance 0).
 * Returns false if either node does not exist.
 */
export function canReach<N, E>(
  graph: Graph<N, E>,
  from: NodeId,
  to: NodeId,
): boolean {
  if (!graph.hasNode(from) || !graph.hasNode(to)) return false;
  if (from === to) return true;
  return bfsReachable(graph, from).has(to);
}

/**
 * Returns the set of all NodeIds reachable from `start` (inclusive).
 * Alias for bfsReachable — provided here for ergonomic imports.
 */
export function allReachable<N, E>(
  graph: Graph<N, E>,
  start: NodeId,
): Set<NodeId> {
  return bfsReachable(graph, start);
}

/**
 * Returns true if every node in `targets` is reachable from `start`.
 */
export function canReachAll<N, E>(
  graph: Graph<N, E>,
  start: NodeId,
  targets: readonly NodeId[],
): boolean {
  const reachable = bfsReachable(graph, start);
  return targets.every((t) => reachable.has(t));
}

/**
 * Returns only the subset of `targets` that is reachable from `start`.
 */
export function reachableSubset<N, E>(
  graph: Graph<N, E>,
  start: NodeId,
  targets: readonly NodeId[],
): NodeId[] {
  const reachable = bfsReachable(graph, start);
  return targets.filter((t) => reachable.has(t));
}

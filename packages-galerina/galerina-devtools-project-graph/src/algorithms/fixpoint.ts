// =============================================================================
// lln-graph — Iterative fixpoint propagation
//
// Used for dataflow analyses (e.g. effect propagation across the call graph)
// where values must flow through edges until no further changes occur.
// =============================================================================

import { GraphBuilder } from "../core/builder.js";
import type { Graph, GraphNode, NodeId } from "../core/types.js";
import { LLN_PGRAPH_004 } from "../core/types.js";

/** Default maximum iterations before emitting SPORE-PGRAPH-004. */
const DEFAULT_MAX_ITERATIONS = 1_000;

export type FixpointResult<N, E> =
  | { readonly ok: true; readonly graph: Graph<N, E>; readonly iterations: number }
  | {
      readonly ok: false;
      readonly graph: Graph<N, E>;
      readonly iterations: number;
      readonly diagnostic: typeof LLN_PGRAPH_004;
    };

/**
 * Iterative fixpoint propagation.
 *
 * `propagate` is called for each node on each pass. It receives the current
 * graph and the current node, and returns the (possibly updated) node data.
 * When no node data changes in a pass, the algorithm has reached fixpoint.
 *
 * The algorithm rebuilds the graph after each pass where at least one node
 * changed. Edges are always preserved unchanged.
 *
 * Returns ok:true when convergence is reached within `maxIterations`.
 * Returns ok:false (with the last graph state) when `maxIterations` is hit.
 */
export function fixpoint<N, E>(
  initial: Graph<N, E>,
  propagate: (graph: Graph<N, E>, node: GraphNode<N>) => N,
  maxIterations: number = DEFAULT_MAX_ITERATIONS,
): FixpointResult<N, E> {
  let current = initial;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    let changed = false;
    const builder = new GraphBuilder<N, E>();

    // Add all nodes, potentially with updated data.
    for (const node of current.nodes()) {
      const nextData = propagate(current, node);
      builder.addNode(node.id, nextData);
      if (!changed && !dataEqual(node.data, nextData)) {
        changed = true;
      }
    }

    // Preserve all edges unchanged.
    for (const edge of current.edges()) {
      builder.addEdge(edge.from, edge.to, edge.data);
    }

    current = builder.build();

    if (!changed) {
      return { ok: true, graph: current, iterations: iteration };
    }
  }

  return {
    ok: false,
    graph: current,
    iterations: maxIterations,
    diagnostic: LLN_PGRAPH_004,
  };
}

/**
 * Rebuild a graph with updated node data for a single node.
 * Utility used by graph-specific propagation functions.
 */
export function updateNode<N, E>(
  graph: Graph<N, E>,
  id: NodeId,
  updater: (current: N) => N,
): Graph<N, E> {
  const builder = new GraphBuilder<N, E>();
  for (const node of graph.nodes()) {
    if (node.id === id) {
      builder.addNode(node.id, updater(node.data));
    } else {
      builder.addNode(node.id, node.data);
    }
  }
  for (const edge of graph.edges()) {
    builder.addEdge(edge.from, edge.to, edge.data);
  }
  return builder.build();
}

/**
 * Shallow structural equality check for node data objects.
 * Compares own enumerable properties one level deep.
 * Arrays are compared by JSON serialization for predictable behaviour
 * with effect string arrays.
 */
function dataEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  if (ka.join(",") !== kb.join(",")) return false;
  for (const key of ka) {
    if (
      !dataEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      )
    ) {
      return false;
    }
  }
  return true;
}

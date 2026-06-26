// =============================================================================
// lln-graph — immutable Graph<N,E> implementation
//
// Not exported directly. Consumers receive Graph<N,E> instances from
// GraphBuilder.build() or GraphBuilder.fromJSON().
// =============================================================================

import type { Graph, GraphEdge, GraphJSON, GraphNode, NodeId } from "./types.js";

/**
 * Concrete immutable graph. Map-backed for O(1) node lookup.
 * Produced exclusively by GraphBuilder.
 */
export class ImmutableGraph<N, E> implements Graph<N, E> {
  readonly nodeCount: number;
  readonly edgeCount: number;

  readonly #nodes: ReadonlyMap<NodeId, GraphNode<N>>;
  readonly #outEdges: ReadonlyMap<NodeId, ReadonlyArray<GraphEdge<E>>>;
  readonly #inEdges: ReadonlyMap<NodeId, ReadonlyArray<GraphEdge<E>>>;
  readonly #allEdges: ReadonlyArray<GraphEdge<E>>;
  readonly #allNodes: ReadonlyArray<GraphNode<N>>;

  constructor(
    nodes: ReadonlyMap<NodeId, GraphNode<N>>,
    outEdges: ReadonlyMap<NodeId, ReadonlyArray<GraphEdge<E>>>,
    inEdges: ReadonlyMap<NodeId, ReadonlyArray<GraphEdge<E>>>,
    allEdges: ReadonlyArray<GraphEdge<E>>,
  ) {
    this.#nodes = nodes;
    this.#outEdges = outEdges;
    this.#inEdges = inEdges;
    this.#allEdges = allEdges;
    this.#allNodes = Array.from(nodes.values());
    this.nodeCount = nodes.size;
    this.edgeCount = allEdges.length;
  }

  hasNode(id: NodeId): boolean {
    return this.#nodes.has(id);
  }

  node(id: NodeId): GraphNode<N> | undefined {
    return this.#nodes.get(id);
  }

  nodes(): readonly GraphNode<N>[] {
    return this.#allNodes;
  }

  outEdges(from: NodeId): readonly GraphEdge<E>[] {
    return this.#outEdges.get(from) ?? [];
  }

  inEdges(to: NodeId): readonly GraphEdge<E>[] {
    return this.#inEdges.get(to) ?? [];
  }

  edges(): readonly GraphEdge<E>[] {
    return this.#allEdges;
  }

  toJSON(): GraphJSON<N, E> {
    return {
      schemaVersion: "spore.graph.v1",
      nodes: this.#allNodes.map((n) => ({ id: n.id, data: n.data })),
      edges: this.#allEdges.map((e) => ({
        from: e.from,
        to: e.to,
        data: e.data,
      })),
    };
  }
}

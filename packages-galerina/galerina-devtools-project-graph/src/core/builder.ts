// =============================================================================
// lln-graph — GraphBuilder<N,E>
//
// Mutable builder that produces immutable Graph<N,E> instances.
// Fluent API: builder.addNode(...).addNode(...).addEdge(...).build()
// =============================================================================

import { ImmutableGraph } from "./graph.js";
import type { Graph, GraphEdge, GraphJSON, GraphNode, NodeId } from "./types.js";

/**
 * Mutable builder that produces immutable `Graph<N,E>` instances.
 *
 * ## Usage — typed graph variants
 * Use the domain-specific factories (`buildEffectGraph`, `buildDependencyGraph`,
 * etc.) when working with the LogicN-specific graph shapes. They handle node
 * creation and edge wiring for you.
 *
 * ## Usage — ad-hoc / transient graphs
 * `GraphBuilder` can be used directly whenever you need to wrap an existing
 * array-based data structure temporarily to run an lln-graph algorithm on it.
 * For example, converting a plain `{ nodes[], edges[] }` object so you can
 * call `bfsPath()`:
 *
 * ```ts
 * import { GraphBuilder, bfsPath } from "lln-graph";
 *
 * const builder = new GraphBuilder<LegacyNode, LegacyEdge>();
 * for (const n of legacyGraph.nodes) builder.addNode(n.id, n);
 * for (const e of legacyGraph.edges) {
 *   try { builder.addEdge(e.from, e.to, e); } catch { /* skip invalid edges *\/ }
 * }
 * const path = bfsPath(builder.build(), startId, endId);
 * ```
 *
 * ## Edge direction convention for dependency graphs
 * When building a dependency graph manually, edges must go **dep → task**
 * (prerequisite points forward to its dependent), NOT task → dep.
 * `resolveDependencies()` does not reverse the topoSort result — the forward
 * edge direction means in-degree-0 nodes (no prerequisites) naturally appear
 * first in Kahn's algorithm. Getting this backwards yields a reversed order.
 */
export class GraphBuilder<N, E> {
  readonly #nodes = new Map<NodeId, GraphNode<N>>();
  readonly #outEdges = new Map<NodeId, GraphEdge<E>[]>();
  readonly #inEdges = new Map<NodeId, GraphEdge<E>[]>();
  readonly #allEdges: GraphEdge<E>[] = [];

  /**
   * Add a node. If a node with the same id already exists, its data is
   * overwritten (last-write wins).
   */
  addNode(id: NodeId, data: N): this {
    this.#nodes.set(id, { id, data });
    if (!this.#outEdges.has(id)) this.#outEdges.set(id, []);
    if (!this.#inEdges.has(id)) this.#inEdges.set(id, []);
    return this;
  }

  /**
   * Add a directed edge from → to.
   * Both `from` and `to` nodes must have been added before calling addEdge,
   * or an Error is thrown. Duplicate edges (same from/to/data) are allowed
   * (the graph is a multigraph at the representation level).
   */
  addEdge(from: NodeId, to: NodeId, data: E): this {
    if (!this.#nodes.has(from)) {
      throw new Error(
        `lln-graph GraphBuilder.addEdge: source node "${from}" has not been added. Call addNode first.`,
      );
    }
    if (!this.#nodes.has(to)) {
      throw new Error(
        `lln-graph GraphBuilder.addEdge: target node "${to}" has not been added. Call addNode first.`,
      );
    }
    const edge: GraphEdge<E> = { from, to, data };
    this.#allEdges.push(edge);
    this.#outEdges.get(from)!.push(edge);
    this.#inEdges.get(to)!.push(edge);
    return this;
  }

  /**
   * Produce an immutable Graph from the current state of the builder.
   * The builder can continue to be used after build() returns.
   */
  build(): Graph<N, E> {
    // Freeze edge arrays so the immutable graph cannot be mutated via
    // references that escaped the builder.
    const frozenOut = new Map<NodeId, readonly GraphEdge<E>[]>();
    const frozenIn = new Map<NodeId, readonly GraphEdge<E>[]>();

    for (const [id, edges] of this.#outEdges) {
      frozenOut.set(id, Object.freeze([...edges]));
    }
    for (const [id, edges] of this.#inEdges) {
      frozenIn.set(id, Object.freeze([...edges]));
    }

    return new ImmutableGraph<N, E>(
      new Map(this.#nodes),
      frozenOut,
      frozenIn,
      Object.freeze([...this.#allEdges]),
    );
  }

  /**
   * Deserialise a GraphJSON back into an immutable Graph.
   * Throws if schemaVersion does not match "spore.graph.v1".
   */
  static fromJSON<N, E>(json: GraphJSON<N, E>): Graph<N, E> {
    if (json.schemaVersion !== "spore.graph.v1") {
      throw new Error(
        `lln-graph: unsupported graph schemaVersion "${json.schemaVersion}". Expected "spore.graph.v1".`,
      );
    }
    const builder = new GraphBuilder<N, E>();
    for (const { id, data } of json.nodes) {
      builder.addNode(id, data);
    }
    for (const { from, to, data } of json.edges) {
      builder.addEdge(from, to, data);
    }
    return builder.build();
  }
}

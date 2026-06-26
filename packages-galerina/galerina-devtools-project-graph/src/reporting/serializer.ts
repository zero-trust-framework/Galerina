// =============================================================================
// lln-graph — Graph serialization helpers
//
// graphToJSON / graphFromJSON with schema validation.
// These wrap the toJSON() method and GraphBuilder.fromJSON() with runtime
// schema version checks so consumers don't need to handle that manually.
// =============================================================================

import { GraphBuilder } from "../core/builder.js";
import type { Graph, GraphJSON } from "../core/types.js";

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a graph to its canonical JSON representation.
 * Identical to graph.toJSON() but provided here for symmetric import patterns.
 */
export function graphToJSON<N, E>(graph: Graph<N, E>): GraphJSON<N, E> {
  return graph.toJSON();
}

/**
 * Deserialise a GraphJSON back to an immutable Graph.
 * Validates schemaVersion and throws if it does not match "spore.graph.v1".
 */
export function graphFromJSON<N, E>(json: unknown): Graph<N, E> {
  if (
    typeof json !== "object" ||
    json === null ||
    !("schemaVersion" in json)
  ) {
    throw new Error(
      'lln-graph: graphFromJSON received a value that is not a GraphJSON object (missing "schemaVersion" field).',
    );
  }

  const typed = json as { schemaVersion: unknown };
  if (typed.schemaVersion !== "spore.graph.v1") {
    throw new Error(
      `lln-graph: unsupported graph schemaVersion "${String(typed.schemaVersion)}". Expected "spore.graph.v1".`,
    );
  }

  return GraphBuilder.fromJSON<N, E>(json as GraphJSON<N, E>);
}

/**
 * Serialize a graph to a compact JSON string (no indentation).
 * Suitable for embedding in JSONL reports.
 */
export function graphToJSONString<N, E>(graph: Graph<N, E>): string {
  return JSON.stringify(graph.toJSON());
}

/**
 * Serialize a graph to a pretty-printed JSON string.
 * Suitable for standalone report files.
 */
export function graphToJSONPretty<N, E>(graph: Graph<N, E>, indent = 2): string {
  return JSON.stringify(graph.toJSON(), null, indent);
}

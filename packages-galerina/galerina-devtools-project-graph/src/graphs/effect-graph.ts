// =============================================================================
// lln-graph — EffectGraph
//
// Models the flow call graph annotated with LogicN effect declarations.
// Effect propagation uses the fixpoint algorithm so transitive effects
// (effects inherited from callees) are always computed correctly.
//
// Diagnostic codes: SPORE-PGRAPH-010..013 — project-graph-owned, the effect-graph VIEW of
// effect propagation; distinct from logicn-core-compiler's authoritative SPORE-EFFECT-* codes.
// =============================================================================

import { GraphBuilder } from "../core/builder.js";
import { fixpoint } from "../algorithms/fixpoint.js";
import type { Graph, LlnDiagnostic, NodeId } from "../core/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EffectSafetyLevel =
  | "safe"
  | "guarded"
  | "privileged"
  | "unsafe"
  | "experimental";

export interface EffectNodeData {
  readonly flowName: string;
  readonly safetyLevel: EffectSafetyLevel;
  /** Effects explicitly declared by the developer on this flow. */
  readonly declaredEffects: readonly string[];
  /** Effects inferred by the compiler from the flow body. */
  readonly inferredEffects: readonly string[];
  /** Effects inherited from callees through transitive propagation. */
  readonly transitiveEffects: readonly string[];
}

export interface EffectEdgeData {
  /** Whether this is a direct syntactic call or a transitive dependency. */
  readonly callType: "direct" | "transitive";
}

/** Directed call graph where nodes are flows and edges are calls. */
export type EffectGraph = Graph<EffectNodeData, EffectEdgeData>;

// ---------------------------------------------------------------------------
// Diagnostic constants (mirrored from logicn-core-compiler)
// ---------------------------------------------------------------------------

export const LLN_PGRAPH_010 = {
  code: "SPORE-PGRAPH-010",
  name: "UNDECLARED_EFFECT_IN_GRAPH",
  severity: "error",
  message: "Flow performs an effect that is not declared in its effects list.",
} as const satisfies LlnDiagnostic;

export const LLN_PGRAPH_011 = {
  code: "SPORE-PGRAPH-011",
  name: "EFFECT_NOT_INFERRED",
  severity: "error",
  message: "Flow declares an effect that cannot be inferred from its body or callees.",
} as const satisfies LlnDiagnostic;

export const LLN_PGRAPH_012 = {
  code: "SPORE-PGRAPH-012",
  name: "UNSAFE_EFFECT_IN_SAFE_FLOW",
  severity: "error",
  message: "Flow with safety level 'safe' performs a side-effectful operation.",
} as const satisfies LlnDiagnostic;

export const LLN_PGRAPH_013 = {
  code: "SPORE-PGRAPH-013",
  name: "TRANSITIVE_EFFECT_UNDECLARED",
  severity: "error",
  message:
    "Flow inherits a transitive effect from a callee that is not declared on the calling flow.",
} as const satisfies LlnDiagnostic;

export const LLN_PGRAPH_EFFECT_DIAGNOSTICS = [
  LLN_PGRAPH_010,
  LLN_PGRAPH_011,
  LLN_PGRAPH_012,
  LLN_PGRAPH_013,
] as const;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface EffectGraphEntry {
  readonly flowName: string;
  readonly safetyLevel: EffectSafetyLevel;
  readonly declaredEffects: readonly string[];
  readonly inferredEffects: readonly string[];
  /** Direct callees by flowName. */
  readonly calls: readonly string[];
}

/**
 * Construct an EffectGraph from a flat list of flow entries.
 * Transitive effects start empty — call propagateEffects() to populate them.
 */
export function buildEffectGraph(entries: readonly EffectGraphEntry[]): EffectGraph {
  const builder = new GraphBuilder<EffectNodeData, EffectEdgeData>();

  for (const entry of entries) {
    builder.addNode(entry.flowName, {
      flowName: entry.flowName,
      safetyLevel: entry.safetyLevel,
      declaredEffects: entry.declaredEffects,
      inferredEffects: entry.inferredEffects,
      transitiveEffects: [],
    });
  }

  for (const entry of entries) {
    for (const callee of entry.calls) {
      if (builder.build().hasNode(callee)) {
        builder.addEdge(entry.flowName, callee, { callType: "direct" });
      }
    }
  }

  return builder.build();
}

// ---------------------------------------------------------------------------
// Effect propagation
// ---------------------------------------------------------------------------

/**
 * Propagate transitive effects upward through the call graph using the
 * generic fixpoint algorithm.
 *
 * A caller inherits all inferred and transitive effects of its direct callees.
 * The algorithm iterates until no node's transitiveEffects changes.
 */
export function propagateEffects(graph: EffectGraph): EffectGraph {
  const result = fixpoint(graph, (g, node) => {
    const current = node.data;
    const accumulated = new Set<string>(current.transitiveEffects);

    for (const edge of g.outEdges(node.id)) {
      const callee = g.node(edge.to);
      if (callee === undefined) continue;
      for (const effect of callee.data.inferredEffects) accumulated.add(effect);
      for (const effect of callee.data.transitiveEffects) accumulated.add(effect);
    }

    // Don't include in transitiveEffects what is already tracked in inferredEffects
    // (it's already reported there). Declared-only effects may still appear as
    // transitive when they originate from a callee but are not locally inferred.
    for (const inferred of current.inferredEffects) accumulated.delete(inferred);

    const nextTransitive = [...accumulated].sort();

    return {
      ...current,
      transitiveEffects: nextTransitive,
    };
  });

  return result.graph;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate effect declarations against inferred and transitive effects.
 * Returns zero diagnostics when the graph is fully correct.
 */
export function validateEffects(graph: EffectGraph): LlnDiagnostic[] {
  const diagnostics: LlnDiagnostic[] = [];

  for (const node of graph.nodes()) {
    const { flowName, safetyLevel, declaredEffects, inferredEffects, transitiveEffects } =
      node.data;

    // SPORE-PGRAPH-010: inferred effect not declared.
    for (const effect of inferredEffects) {
      if (!declaredEffects.includes(effect)) {
        diagnostics.push({
          ...LLN_PGRAPH_010,
          message: `Flow "${flowName}" performs effect "${effect}" that is not declared.`,
        });
      }
    }

    // SPORE-PGRAPH-011: declared effect not inferred (dead declaration).
    for (const effect of declaredEffects) {
      if (!inferredEffects.includes(effect) && !transitiveEffects.includes(effect)) {
        diagnostics.push({
          ...LLN_PGRAPH_011,
          message: `Flow "${flowName}" declares effect "${effect}" but it cannot be inferred from the flow body or callees.`,
        });
      }
    }

    // SPORE-PGRAPH-012: safe flow has any effects.
    if (safetyLevel === "safe" && inferredEffects.length > 0) {
      diagnostics.push({
        ...LLN_PGRAPH_012,
        message: `Flow "${flowName}" is marked safe but performs effects: ${inferredEffects.join(", ")}.`,
      });
    }

    // SPORE-PGRAPH-013: transitive effect not declared on caller.
    for (const effect of transitiveEffects) {
      if (!declaredEffects.includes(effect)) {
        diagnostics.push({
          ...LLN_PGRAPH_013,
          message: `Flow "${flowName}" inherits transitive effect "${effect}" from a callee but does not declare it.`,
        });
      }
    }
  }

  return diagnostics;
}

/**
 * Collect all effects visible on a given flow (declared + inferred + transitive, deduplicated).
 */
export function allEffectsFor(graph: EffectGraph, flowName: NodeId): readonly string[] {
  const node = graph.node(flowName);
  if (node === undefined) return [];
  const { declaredEffects, inferredEffects, transitiveEffects } = node.data;
  return [...new Set([...declaredEffects, ...inferredEffects, ...transitiveEffects])].sort();
}

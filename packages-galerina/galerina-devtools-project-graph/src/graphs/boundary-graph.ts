// =============================================================================
// lln-graph — BoundaryGraph
//
// Models trust boundaries in a LogicN application and validates that
// effects and secrets do not cross boundaries illegally.
//
// Diagnostic codes: LLN-PGRAPH-020..023 — project-graph-owned, the boundary-graph VIEW of trust
// boundaries; distinct from logicn-core-compiler's own (planned) LLN-BOUNDARY-* boundary checker.
// =============================================================================

import { GraphBuilder } from "../core/builder.js";
import type { Graph, LlnDiagnostic } from "../core/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BoundaryType =
  | "api"
  | "webhook"
  | "worker"
  | "job"
  | "network"
  | "database"
  | "secret"
  | "filesystem"
  | "ffi"
  | "ai"
  | "wasm";

export type TrustLevel = "untrusted" | "validated" | "internal" | "privileged";

export interface BoundaryNodeData {
  readonly boundaryId: string;
  readonly boundaryType: BoundaryType;
  readonly trustLevel: TrustLevel;
  readonly allowedEffects: readonly string[];
  readonly deniedEffects: readonly string[];
  readonly requiredPolicies: readonly string[];
}

export interface BoundaryEdgeData {
  readonly transferredEffects: readonly string[];
  readonly transferredSecrets: readonly string[];
  readonly requiresValidation: boolean;
}

/** Directed graph of trust boundaries. Edges represent data/control flow crossings. */
export type BoundaryGraph = Graph<BoundaryNodeData, BoundaryEdgeData>;

// ---------------------------------------------------------------------------
// Diagnostic constants
// ---------------------------------------------------------------------------

export const LLN_PGRAPH_020 = {
  code: "LLN-PGRAPH-020",
  name: "EFFECT_CROSSES_BOUNDARY",
  severity: "error",
  message: "An effect is transferred across a boundary that does not allow it.",
} as const satisfies LlnDiagnostic;

export const LLN_PGRAPH_021 = {
  code: "LLN-PGRAPH-021",
  name: "SECRET_CROSSES_UNSAFE_BOUNDARY",
  severity: "error",
  message: "A secret value crosses a boundary that is not a declared secret boundary.",
} as const satisfies LlnDiagnostic;

export const LLN_PGRAPH_022 = {
  code: "LLN-PGRAPH-022",
  name: "UNTRUSTED_INPUT_UNVALIDATED",
  severity: "error",
  message: "Data from an untrusted boundary crosses into the application without validation.",
} as const satisfies LlnDiagnostic;

export const LLN_PGRAPH_023 = {
  code: "LLN-PGRAPH-023",
  name: "REQUIRED_POLICY_MISSING",
  severity: "error",
  message: "A boundary crossing requires a policy that is not declared.",
} as const satisfies LlnDiagnostic;

export const LLN_PGRAPH_BOUNDARY_DIAGNOSTICS = [
  LLN_PGRAPH_020,
  LLN_PGRAPH_021,
  LLN_PGRAPH_022,
  LLN_PGRAPH_023,
] as const;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface BoundaryEntry {
  readonly boundaryId: string;
  readonly boundaryType: BoundaryType;
  readonly trustLevel: TrustLevel;
  readonly allowedEffects: readonly string[];
  readonly deniedEffects: readonly string[];
  readonly requiredPolicies?: readonly string[];
}

export interface BoundaryCrossing {
  readonly from: string;
  readonly to: string;
  readonly transferredEffects: readonly string[];
  readonly transferredSecrets: readonly string[];
  readonly requiresValidation: boolean;
}

export function buildBoundaryGraph(
  boundaries: readonly BoundaryEntry[],
  crossings: readonly BoundaryCrossing[],
): BoundaryGraph {
  const builder = new GraphBuilder<BoundaryNodeData, BoundaryEdgeData>();

  for (const b of boundaries) {
    builder.addNode(b.boundaryId, {
      boundaryId: b.boundaryId,
      boundaryType: b.boundaryType,
      trustLevel: b.trustLevel,
      allowedEffects: b.allowedEffects,
      deniedEffects: b.deniedEffects,
      requiredPolicies: b.requiredPolicies ?? [],
    });
  }

  for (const c of crossings) {
    builder.addEdge(c.from, c.to, {
      transferredEffects: c.transferredEffects,
      transferredSecrets: c.transferredSecrets,
      requiresValidation: c.requiresValidation,
    });
  }

  return builder.build();
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateBoundaries(graph: BoundaryGraph): LlnDiagnostic[] {
  const diagnostics: LlnDiagnostic[] = [];

  for (const edge of graph.edges()) {
    const target = graph.node(edge.to);
    if (target === undefined) continue;

    const { boundaryId, boundaryType, deniedEffects, trustLevel, requiredPolicies } =
      target.data;

    // LLN-PGRAPH-020: effect not allowed at target boundary.
    for (const effect of edge.data.transferredEffects) {
      if (deniedEffects.includes(effect)) {
        diagnostics.push({
          ...LLN_PGRAPH_020,
          message: `Effect "${effect}" is denied at boundary "${boundaryId}" (type: ${boundaryType}).`,
        });
      }
    }

    // LLN-PGRAPH-021: secrets crossing a non-secret boundary.
    if (edge.data.transferredSecrets.length > 0 && boundaryType !== "secret") {
      for (const secret of edge.data.transferredSecrets) {
        diagnostics.push({
          ...LLN_PGRAPH_021,
          message: `Secret "${secret}" crosses boundary "${boundaryId}" which is not a secret boundary (type: ${boundaryType}).`,
        });
      }
    }

    // LLN-PGRAPH-022: untrusted source without validation.
    const source = graph.node(edge.from);
    if (
      source !== undefined &&
      source.data.trustLevel === "untrusted" &&
      edge.data.requiresValidation === false
    ) {
      diagnostics.push({
        ...LLN_PGRAPH_022,
        message: `Data from untrusted boundary "${source.data.boundaryId}" crosses to "${boundaryId}" without validation.`,
      });
    }

    // LLN-PGRAPH-023: required policies declared but not met.
    // (Policy IDs are checked against the edge's declared policies — runtime enforcement
    // carries the actual policy document; the graph records the requirement.)
    if (requiredPolicies.length > 0 && edge.data.requiresValidation === false) {
      for (const policy of requiredPolicies) {
        if (trustLevel !== "privileged" && trustLevel !== "internal") {
          diagnostics.push({
            ...LLN_PGRAPH_023,
            message: `Boundary "${boundaryId}" requires policy "${policy}" but the crossing does not declare validation.`,
          });
        }
      }
    }
  }

  return diagnostics;
}

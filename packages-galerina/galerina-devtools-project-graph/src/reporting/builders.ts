// =============================================================================
// lln-graph — Report section builders
//
// Convert graph instances into structured report sections that can be
// embedded in LogicN's runtime reports (logicn-core-reports).
// =============================================================================

import type { EffectGraph } from "../graphs/effect-graph.js";
import type { BoundaryGraph } from "../graphs/boundary-graph.js";
import type { ProjectGraph } from "../graphs/project-graph.js";
import type { EventDAG } from "./event-dag.js";
import type { ExecutionProofV1 } from "./chain.js";
import { denialEvents } from "./event-dag.js";

// ---------------------------------------------------------------------------
// Report section types
// ---------------------------------------------------------------------------

export interface EffectReportSection {
  readonly kind: "effect-graph";
  readonly flowCount: number;
  readonly effectCount: number;
  readonly flows: readonly {
    readonly flowName: string;
    readonly safetyLevel: string;
    readonly declaredEffects: readonly string[];
    readonly transitiveEffects: readonly string[];
  }[];
}

export interface BoundaryReportSection {
  readonly kind: "boundary-graph";
  readonly boundaryCount: number;
  readonly crossingCount: number;
  readonly boundaries: readonly {
    readonly boundaryId: string;
    readonly boundaryType: string;
    readonly trustLevel: string;
  }[];
}

export interface ProjectReportSection {
  readonly kind: "project-graph";
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly nodesByKind: Readonly<Record<string, number>>;
}

export interface AuditChainSection {
  readonly kind: "audit-chain";
  readonly eventCount: number;
  readonly denialCount: number;
  readonly statusSummary: Readonly<Record<string, number>>;
  readonly categorySummary: Readonly<Record<string, number>>;
}

export interface ProofReportSection {
  readonly kind: "execution-proof";
  readonly schemaVersion: string;
  readonly proofId: string;
  readonly generatedAt: string;
  readonly hashes: {
    readonly manifestSha256: string;
    readonly auditSha256: string;
    readonly evidenceSha256: string;
    readonly denialSha256: string;
    readonly artefactSha256: string;
  };
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function effectGraphToReport(graph: EffectGraph): EffectReportSection {
  const allEffects = new Set<string>();
  const flows = graph.nodes().map((n) => {
    for (const e of n.data.declaredEffects) allEffects.add(e);
    for (const e of n.data.inferredEffects) allEffects.add(e);
    for (const e of n.data.transitiveEffects) allEffects.add(e);
    return {
      flowName: n.data.flowName,
      safetyLevel: n.data.safetyLevel,
      declaredEffects: n.data.declaredEffects,
      transitiveEffects: n.data.transitiveEffects,
    };
  });

  return {
    kind: "effect-graph",
    flowCount: graph.nodeCount,
    effectCount: allEffects.size,
    flows,
  };
}

export function boundaryGraphToReport(graph: BoundaryGraph): BoundaryReportSection {
  const boundaries = graph.nodes().map((n) => ({
    boundaryId: n.data.boundaryId,
    boundaryType: n.data.boundaryType,
    trustLevel: n.data.trustLevel,
  }));

  return {
    kind: "boundary-graph",
    boundaryCount: graph.nodeCount,
    crossingCount: graph.edgeCount,
    boundaries,
  };
}

export function projectGraphToReport(graph: ProjectGraph): ProjectReportSection {
  const nodesByKind: Record<string, number> = {};
  for (const node of graph.nodes()) {
    nodesByKind[node.data.kind] = (nodesByKind[node.data.kind] ?? 0) + 1;
  }

  return {
    kind: "project-graph",
    nodeCount: graph.nodeCount,
    edgeCount: graph.edgeCount,
    nodesByKind,
  };
}

export function eventDagToReport(dag: EventDAG): AuditChainSection {
  const statusSummary: Record<string, number> = {};
  const categorySummary: Record<string, number> = {};

  for (const node of dag.nodes()) {
    statusSummary[node.data.status] = (statusSummary[node.data.status] ?? 0) + 1;
    categorySummary[node.data.category] = (categorySummary[node.data.category] ?? 0) + 1;
  }

  return {
    kind: "audit-chain",
    eventCount: dag.nodeCount,
    denialCount: denialEvents(dag).length,
    statusSummary,
    categorySummary,
  };
}

export function proofChainToReport(chain: ExecutionProofV1): ProofReportSection {
  return {
    kind: "execution-proof",
    schemaVersion: chain.schemaVersion,
    proofId: chain.proofId,
    generatedAt: chain.generatedAt,
    hashes: chain.hashes,
  };
}

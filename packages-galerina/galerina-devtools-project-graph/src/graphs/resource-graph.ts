// =============================================================================
// lln-graph — ResourceLifecycleGraph
//
// State machine graph for LogicN runtime resource lifecycle.
// States: declared → planned → initializing → ready → failed → shutting_down → closed
// =============================================================================

import { GraphBuilder } from "../core/builder.js";
import type { Graph, LlnDiagnostic, NodeId } from "../core/types.js";
import { LLN_PGRAPH_002, LLN_PGRAPH_005 } from "../core/types.js";
import { updateNode } from "../algorithms/fixpoint.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResourceState =
  | "declared"
  | "planned"
  | "initializing"
  | "ready"
  | "failed"
  | "shutting_down"
  | "closed";

export type ResourceScope = "runtime" | "request";

export interface ResourceNodeData {
  readonly resourceName: string;
  readonly scope: ResourceScope;
  readonly state: ResourceState;
  readonly initializedAt?: string;
  readonly closedAt?: string;
  readonly failureReason?: string;
}

export interface LifecycleTransitionData {
  /** The event that triggers this transition, e.g. "init_success". */
  readonly trigger: string;
  readonly guardCondition?: string;
}

export type ResourceLifecycleGraph = Graph<ResourceNodeData, LifecycleTransitionData>;

// ---------------------------------------------------------------------------
// Valid state machine transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: ReadonlyMap<ResourceState, ReadonlySet<ResourceState>> = new Map([
  ["declared",      new Set<ResourceState>(["planned", "failed"])],
  ["planned",       new Set<ResourceState>(["initializing", "failed"])],
  ["initializing",  new Set<ResourceState>(["ready", "failed"])],
  ["ready",         new Set<ResourceState>(["shutting_down", "failed"])],
  ["failed",        new Set<ResourceState>(["shutting_down"])],
  ["shutting_down", new Set<ResourceState>(["closed", "failed"])],
  ["closed",        new Set<ResourceState>()],
]);

export function validateTransition(from: ResourceState, to: ResourceState): boolean {
  return VALID_TRANSITIONS.get(from)?.has(to) ?? false;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface ResourceEntry {
  readonly resourceName: string;
  readonly scope: ResourceScope;
  readonly initialState?: ResourceState;
}

/**
 * Build a ResourceLifecycleGraph with one node per resource.
 * The graph edges represent the state machine transitions common to all
 * resources (not instance-specific history). For instance-specific
 * lifecycle tracking, use advanceState().
 */
export function buildResourceLifecycleGraph(
  resources: readonly ResourceEntry[],
): ResourceLifecycleGraph {
  const builder = new GraphBuilder<ResourceNodeData, LifecycleTransitionData>();

  for (const r of resources) {
    builder.addNode(r.resourceName, {
      resourceName: r.resourceName,
      scope: r.scope,
      state: r.initialState ?? "declared",
    });
  }

  return builder.build();
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

export interface AdvanceStateOptions {
  readonly trigger: string;
  readonly timestamp?: string;
  readonly failureReason?: string;
}

export type AdvanceResult =
  | { readonly ok: true; readonly graph: ResourceLifecycleGraph }
  | { readonly ok: false; readonly diagnostic: LlnDiagnostic };

/**
 * Advance a resource to a new state, returning an updated immutable graph.
 * Validates the transition is permitted by the state machine.
 */
export function advanceState(
  graph: ResourceLifecycleGraph,
  resourceName: NodeId,
  nextState: ResourceState,
  options: AdvanceStateOptions,
): AdvanceResult {
  const node = graph.node(resourceName);
  if (node === undefined) {
    return {
      ok: false,
      diagnostic: {
        ...LLN_PGRAPH_002,
        message: `Resource "${resourceName}" not found in the lifecycle graph.`,
      },
    };
  }

  if (!validateTransition(node.data.state, nextState)) {
    return {
      ok: false,
      diagnostic: {
        ...LLN_PGRAPH_005,
        message: `Cannot transition resource "${resourceName}" from "${node.data.state}" to "${nextState}".`,
      },
    };
  }

  const updated = updateNode(graph, resourceName, (current) => ({
    ...current,
    state: nextState,
    initializedAt: nextState === "ready" ? (options.timestamp ?? new Date().toISOString()) : current.initializedAt,
    closedAt: nextState === "closed" ? (options.timestamp ?? new Date().toISOString()) : current.closedAt,
    failureReason: nextState === "failed" ? options.failureReason : undefined,
  }));

  return { ok: true, graph: updated };
}

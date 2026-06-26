// =============================================================================
// lln-graph — EventDAG
//
// Causality DAG built from LogicN RuntimeAuditEvents.
// Edges connect events via traceId / spanId / parentSpanId relationships.
// =============================================================================

import { GraphBuilder } from "../core/builder.js";
import type { Graph } from "../core/types.js";

// ---------------------------------------------------------------------------
// RuntimeAuditEvent types (mirrored from logicn-core-reports)
// ---------------------------------------------------------------------------

export type RuntimeAuditCategory =
  | "runtime"
  | "network"
  | "capability"
  | "effect"
  | "secret"
  | "deployment"
  | "webhook"
  | "verification";

export type RuntimeAuditStatus =
  | "started"
  | "allowed"
  | "denied"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped"
  | "warning"
  | "error"
  | "executed"
  | "verified";

/**
 * Minimal RuntimeAuditEvent shape required by the DAG builder.
 * Structurally compatible with the full RuntimeAuditEvent in logicn-core-reports.
 */
export interface RuntimeAuditEvent {
  readonly schemaVersion: "spore.runtime.audit.v1";
  readonly eventId: string;
  readonly timestamp: string;
  readonly category: RuntimeAuditCategory;
  readonly status: RuntimeAuditStatus;
  readonly message: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly parentSpanId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// DAG types
// ---------------------------------------------------------------------------

export interface AuditEventNodeData {
  readonly eventId: string;
  readonly timestamp: string;
  readonly category: RuntimeAuditCategory;
  readonly status: RuntimeAuditStatus;
  readonly message: string;
  readonly traceId?: string;
  readonly spanId?: string;
}

export type CausalityKind = "child-span" | "continuation" | "triggered-by";

export interface CausalityEdgeData {
  readonly relationKind: CausalityKind;
}

export type EventDAG = Graph<AuditEventNodeData, CausalityEdgeData>;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a causality DAG from an ordered array of RuntimeAuditEvents.
 *
 * Edge rules:
 * - If event B has `parentSpanId === A.spanId`, add edge A → B ("child-span").
 * - If events share the same traceId and are adjacent in time, add A → B ("continuation").
 * - Events without traceId/spanId are isolated nodes.
 *
 * Events are inserted as nodes in timestamp order. Duplicate eventIds are
 * skipped (last-writer-wins semantics for recovery scenarios).
 */
export function buildEventDAG(events: readonly RuntimeAuditEvent[]): EventDAG {
  // Sort by timestamp for deterministic ordering.
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const builder = new GraphBuilder<AuditEventNodeData, CausalityEdgeData>();
  const spanIndex = new Map<string, string>(); // spanId → eventId
  const seen = new Set<string>();

  for (const event of sorted) {
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);

    builder.addNode(event.eventId, {
      eventId: event.eventId,
      timestamp: event.timestamp,
      category: event.category,
      status: event.status,
      message: event.message,
      traceId: event.traceId,
      spanId: event.spanId,
    });

    if (event.spanId !== undefined) {
      spanIndex.set(event.spanId, event.eventId);
    }
  }

  // Add causality edges on a second pass (all nodes must exist first).
  for (const event of sorted) {
    if (!seen.has(event.eventId)) continue;

    // child-span: connect parent span to this event.
    if (event.parentSpanId !== undefined) {
      const parentEventId = spanIndex.get(event.parentSpanId);
      if (parentEventId !== undefined && parentEventId !== event.eventId) {
        builder.addEdge(parentEventId, event.eventId, { relationKind: "child-span" });
      }
    }
  }

  // continuation: connect sequential events sharing the same traceId.
  const byTrace = new Map<string, string[]>(); // traceId → [eventId, ...]
  for (const event of sorted) {
    if (event.traceId === undefined) continue;
    const list = byTrace.get(event.traceId) ?? [];
    list.push(event.eventId);
    byTrace.set(event.traceId, list);
  }

  for (const [, eventIds] of byTrace) {
    for (let i = 0; i < eventIds.length - 1; i++) {
      const from = eventIds[i]!;
      const to = eventIds[i + 1]!;
      // Only add continuation if not already linked by child-span.
      const alreadyLinked = builder
        .build()
        .outEdges(from)
        .some((e) => e.to === to);
      if (!alreadyLinked) {
        builder.addEdge(from, to, { relationKind: "continuation" });
      }
    }
  }

  return builder.build();
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Return all events in a given trace, sorted by timestamp. */
export function eventsInTrace(dag: EventDAG, traceId: string): AuditEventNodeData[] {
  return dag
    .nodes()
    .filter((n) => n.data.traceId === traceId)
    .map((n) => n.data)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/** Return all events with a given status. */
export function eventsByStatus(
  dag: EventDAG,
  status: RuntimeAuditStatus,
): AuditEventNodeData[] {
  return dag
    .nodes()
    .filter((n) => n.data.status === status)
    .map((n) => n.data)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/** Return all denial events in the DAG. */
export function denialEvents(dag: EventDAG): AuditEventNodeData[] {
  return eventsByStatus(dag, "denied");
}

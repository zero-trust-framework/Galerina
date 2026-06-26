// =============================================================================
// lln-graph — DependencyGraph
//
// Task execution dependency graph with cycle detection and topological sort.
// Replaces logicn-core-tasks/src/dependency-graph.ts.
//
// Error codes updated to SPORE-PGRAPH-* format for consistency.
//
// EDGE DIRECTION NOTE (critical for consumers):
//
//   Edges point FORWARD: dep → task  (prerequisite → dependent)
//
//   This means:
//     - buildDependencyGraph adds  addEdge(dep, task.name, ...)
//     - Raw GraphBuilder usage must do the same
//     - resolveDependencies() does NOT reverse the topoSort result;
//       Kahn's algorithm naturally produces execution order when edges
//       point from prerequisites to dependents (in-degree 0 = no prereqs = runs first)
//
//   Getting this backwards (task → dep) will produce a reversed execution order.
//   This is the most common mistake when using GraphBuilder directly.
// =============================================================================

import { GraphBuilder } from "../core/builder.js";
import { topoSort } from "../algorithms/topo.js";
import type { Graph, LlnDiagnostic } from "../core/types.js";
import { LLN_PGRAPH_001, LLN_PGRAPH_003 } from "../core/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskNodeData {
  readonly taskName: string;
  readonly description?: string;
  readonly effects?: readonly string[];
}

export interface DependencyEdgeData {
  readonly required: boolean;
}

export type DependencyGraph = Graph<TaskNodeData, DependencyEdgeData>;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface TaskEntry {
  readonly name: string;
  readonly description?: string;
  readonly effects?: readonly string[];
  /** Names of tasks that must complete before this task runs. */
  readonly depends?: readonly string[];
}

/**
 * Build a DependencyGraph from a list of task entries.
 *
 * Edge direction: dep → task (prerequisite points forward to its dependent).
 * `resolveDependencies()` returns nodes in this natural topoSort order
 * (prerequisites first) — **no reversal is applied or needed**.
 *
 * Missing dependency targets are recorded as diagnostics (SPORE-PGRAPH-003)
 * rather than throwing, so the caller can decide how to surface them.
 *
 * @example
 * const { graph, diagnostics } = buildDependencyGraph([
 *   { name: "install" },
 *   { name: "build", depends: ["install"] },
 *   { name: "test",  depends: ["build"]   },
 * ]);
 * const result = resolveDependencies(graph);
 * // result.order === ["install", "build", "test"]
 */
export function buildDependencyGraph(tasks: readonly TaskEntry[]): {
  graph: DependencyGraph;
  diagnostics: LlnDiagnostic[];
} {
  const diagnostics: LlnDiagnostic[] = [];
  const builder = new GraphBuilder<TaskNodeData, DependencyEdgeData>();
  const knownNames = new Set(tasks.map((t) => t.name));

  for (const task of tasks) {
    builder.addNode(task.name, {
      taskName: task.name,
      description: task.description,
      effects: task.effects ?? [],
    });
  }

  for (const task of tasks) {
    for (const dep of task.depends ?? []) {
      if (!knownNames.has(dep)) {
        diagnostics.push({
          ...LLN_PGRAPH_003,
          message: `Task "${task.name}" depends on "${dep}" which is not declared.`,
        });
        continue;
      }
      // dep runs before task → edge goes dep → task (forward direction).
      builder.addEdge(dep, task.name, { required: true });
    }
  }

  return { graph: builder.build(), diagnostics };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type DependencyResolution =
  | { readonly ok: true; readonly order: readonly string[] }
  | {
      readonly ok: false;
      readonly order: readonly string[];
      readonly cycle: readonly string[];
      readonly diagnostic: LlnDiagnostic;
    };

/**
 * Resolve the execution order for all tasks in the graph using Kahn's
 * topoSort algorithm.
 *
 * Returns `ok: true` with task names in **execution order** (prerequisites
 * first). The order is deterministic: nodes at the same level are sorted
 * alphabetically by id.
 *
 * Returns `ok: false` with the cycle node ids when the graph is not a DAG.
 * The `diagnostic` property carries the `SPORE-PGRAPH-001` (CYCLE_DETECTED) code.
 *
 * **No reversal is applied.** `buildDependencyGraph` uses the dep→task edge
 * direction so that the raw topoSort order is already correct for execution.
 * If you build the graph manually with GraphBuilder, use the same convention.
 */
export function resolveDependencies(graph: DependencyGraph): DependencyResolution {
  const result = topoSort(graph);

  if (result.ok) {
    return { ok: true, order: result.order };
  }

  return {
    ok: false,
    order: result.order,
    cycle: result.cycle,
    diagnostic: {
      ...LLN_PGRAPH_001,
      message: `Circular dependency detected between tasks: ${result.cycle.join(" → ")}.`,
    },
  };
}

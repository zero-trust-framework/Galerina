# SPORE-Graph

**Graph data structures, algorithms, and runtime reporting for the [Galerina](https://github.com/galerina) platform.**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

---

## What is it?

SPORE-Graph is a standalone TypeScript library that provides:

- An **immutable, generic graph core** (`Graph<N,E>`, `GraphBuilder<N,E>`) with O(1) node lookup
- **Graph algorithms** — BFS path finding, DFS cycle detection, Kahn's topological sort, iterative fixpoint, reachability helpers
- **Galerina-specific typed graph shapes** — EffectGraph, BoundaryGraph, ProjectGraph, DependencyGraph, ResourceLifecycleGraph, CapabilityGraph — each with their own builders, validators, and diagnostic codes
- A **runtime reporting pipeline** — JSONL audit writer (7-rule contract), 5-hash execution proof chain (v1 + v2 upgrade path), event causality DAG, and report-section builders

Everything is Apache 2.0, has zero runtime dependencies, targets Node.js ≥ 18, and ships as ESM with full TypeScript declarations and source maps.

---

## Why it was made

Galerina started with graph implementations scattered across several packages with no shared foundation:

| Package | What it did |
|---|---|
| `galerina-devtools-project-graph` | 1 144-line workspace knowledge graph with inline BFS path-finding |
| `galerina-core-tasks/dependency-graph.ts` | 69-line hand-written DFS for task dependency resolution |
| `galerina-core-compiler` | EffectGraph and BoundaryGraph specified in KB docs but not yet data structures |
| `galerina-core-reports` | ExecutionProofChain and EventDAG as type specs with no graph backing |

This created duplicated algorithm code, no shared diagnostic format, and no common serialisation schema. SPORE-Graph consolidates all of it into one place, purpose-built for Galerina, released as a first-class standalone repo so it can evolve independently and be reused by any Galerina consumer.

---

## When to use it

| You need to… | Use… |
|---|---|
| Check whether a Galerina flow declares all its effects | `buildEffectGraph` → `propagateEffects` → `validateEffects` |
| Verify that secrets cannot cross a trust boundary | `buildBoundaryGraph` → `validateBoundaries` |
| Find the path between two nodes in the workspace knowledge graph | `buildProjectGraph` → `findPath` (delegates to `bfsPath`) |
| Resolve task execution order or detect dependency cycles | `buildDependencyGraph` → `resolveDependencies` |
| Model a resource's lifecycle and guard invalid state transitions | `buildResourceLifecycleGraph` → `advanceState` → `validateTransition` |
| Check whether a flow holds the capabilities it requires | `buildCapabilityGraph` → `resolveCapabilities` → `validateCapabilities` |
| Write a tamper-evident audit log | `createJsonlWriter` |
| Produce a cryptographic proof of a build run | `buildProofChain` / `buildProofChainFromBuffers` → `upgradeExecutionProofV1ToV2` |
| Build a causality DAG from runtime audit events | `buildEventDAG` |
| Run a custom propagation algorithm over any graph | `fixpoint` |
| Wrap any array-based `{ nodes[], edges[] }` structure to use lln-graph algorithms | `GraphBuilder` (ad-hoc pattern — see below) |

---

## Installation

```sh
npm install @galerina/devtools-project-graph
```

Or, if you are working inside the Galerina monorepo before the package is published:

```json
// package.json
"dependencies": {
  "@galerina/devtools-project-graph": "github:galerina/lln-graph"
}
```

---

## Quick start

### Effect graph — validate effect declarations

```ts
import { buildEffectGraph, propagateEffects, validateEffects } from "@galerina/devtools-project-graph";

const graph = buildEffectGraph([
  { flowName: "dbQuery",  safetyLevel: "guarded", declaredEffects: ["database.read"], inferredEffects: ["database.read"], calls: [] },
  { flowName: "getUser",  safetyLevel: "guarded", declaredEffects: ["database.read"], inferredEffects: [], calls: ["dbQuery"] },
]);

const propagated = propagateEffects(graph);
const diagnostics = validateEffects(propagated);
// diagnostics === [] when everything is declared correctly
```

### Dependency graph — resolve execution order

```ts
import { buildDependencyGraph, resolveDependencies } from "@galerina/devtools-project-graph";

const { graph } = buildDependencyGraph([
  { name: "install" },
  { name: "build", depends: ["install"] },
  { name: "test",  depends: ["build"]  },
]);

const result = resolveDependencies(graph);
// result.ok === true
// result.order === ["install", "build", "test"]
```

### Proof chain — hash five build artefacts

```ts
import { buildProofChain, upgradeExecutionProofV1ToV2 } from "@galerina/devtools-project-graph";

const v1 = await buildProofChain({
  manifestPath:  "build/reports/runtime-manifest.json",
  auditPath:     "build/reports/runtime-audit.jsonl",
  evidencePath:  "build/reports/evidence-report.json",
  denialPath:    "build/reports/denial-report.json",
  artefactPath:  "build/reports/artefact.json",
});

const v2 = upgradeExecutionProofV1ToV2(v1);
// v2.sections has five named + hashed entries for structured consumers
```

### JSONL audit writer

```ts
import { createJsonlWriter } from "@galerina/devtools-project-graph";

const writer = createJsonlWriter("build/reports/runtime-audit.jsonl");
await writer.append({
  schemaVersion: "spore.runtime.audit.v1",
  eventId: "...", traceId: "...", spanId: "...",
  timestamp: new Date().toISOString(),
  category: "security", status: "allowed",
  message: "Effect database.read permitted on flow getUser",
});
await writer.close();
```

---

## Integration pattern — wrapping legacy array-based graphs

If you have an existing `{ nodes[], edges[] }` structure (e.g. from a JSON file or an older API) and want to use lln-graph's algorithms on it, build a transient graph and discard it:

```ts
import { GraphBuilder, bfsPath } from "@galerina/devtools-project-graph";

function findPathInLegacyGraph(legacy, fromId, toId) {
  const builder = new GraphBuilder();
  for (const n of legacy.nodes) builder.addNode(n.id, n);
  for (const e of legacy.edges) {
    try { builder.addEdge(e.from, e.to, e); } catch { /* skip invalid refs */ }
  }
  return bfsPath(builder.build(), fromId, toId); // NodeId[] | null
}
```

This pattern was used in production to replace the inline BFS inside `galerina-devtools-project-graph`'s `findProjectGraphPath`.

---

## Edge direction — dependency graphs (important)

When building dependency graphs with `GraphBuilder` directly, edges must go **dep → task** (prerequisite points forward to its dependent):

```ts
// "build" depends on "install" → install must run first
builder.addEdge("install", "build", { required: true }); // ✅ correct
builder.addEdge("build", "install", { required: true }); // ❌ reversed order
```

`resolveDependencies` does **not** reverse the topoSort result. Kahn's algorithm with forward edges naturally produces execution order (in-degree 0 nodes — those with no prerequisites — are scheduled first). `buildDependencyGraph` handles this for you; the note is only relevant when using `GraphBuilder` directly.

---

## Diagnostic codes

### SPORE-GRAPH-* (graph structure)

| Code | Name | Meaning |
|---|---|---|
| `SPORE-GRAPH-001` | `CYCLE_DETECTED` | Graph contains a cycle where a DAG is required |
| `SPORE-GRAPH-002` | `NODE_NOT_FOUND` | Referenced node does not exist |
| `SPORE-GRAPH-003` | `DEPENDENCY_MISSING` | A declared dependency was not found |
| `SPORE-GRAPH-004` | `FIXPOINT_TIMEOUT` | Iterative fixpoint did not converge within max iterations |
| `SPORE-GRAPH-005` | `INVALID_TRANSITION` | Resource lifecycle state transition is not permitted |

### SPORE-EFFECT-* (effect checker)

`SPORE-EFFECT-001` — `UNDECLARED_EFFECT` · `SPORE-EFFECT-002` — `EFFECT_NOT_INFERRED` · `SPORE-EFFECT-003` — `UNSAFE_EFFECT_IN_SAFE_FLOW` · `SPORE-EFFECT-004` — `TRANSITIVE_EFFECT_UNDECLARED`

### SPORE-BOUNDARY-* (boundary checker)

`SPORE-BOUNDARY-001` — `DENIED_EFFECT_CROSSING` · `SPORE-BOUNDARY-002` — `SECRET_CROSSING_NON_SECRET_BOUNDARY` · `SPORE-BOUNDARY-003` — `VALIDATION_REQUIRED` · `SPORE-BOUNDARY-004` — `UNTRUSTED_SECRET_TRANSFER`

### SPORE-CAPABILITY-*

`SPORE-CAPABILITY-001` — `CAPABILITY_NOT_GRANTED`

### SPORE-REPORT-* / SPORE-AUDIT-*

`SPORE-REPORT-001` — invalid `schemaVersion` on audit event · `SPORE-AUDIT-003` — metadata contains a raw secret field

---

## Module structure

```
src/
  core/
    types.ts          — NodeId, GraphNode<N>, GraphEdge<E>, Graph<N,E>, GraphJSON, LlnDiagnostic, SPORE-GRAPH-001..005
    graph.ts          — ImmutableGraph<N,E> implementation (not exported directly)
    builder.ts        — GraphBuilder<N,E> — the only way to construct a Graph
  algorithms/
    bfs.ts            — bfsPath(), bfsReachable()
    dfs.ts            — dfsVisit(), detectCycle()
    topo.ts           — topoSort() — Kahn's algorithm, alphabetical determinism
    fixpoint.ts       — fixpoint(), updateNode()
    reach.ts          — canReach(), allReachable(), canReachAll(), reachableSubset()
  graphs/
    effect-graph.ts   — EffectGraph, propagateEffects(), validateEffects(), allEffectsFor()
    boundary-graph.ts — BoundaryGraph, validateBoundaries()
    project-graph.ts  — ProjectGraph, queryGraph(), explainNode(), findPath()
    dependency-graph.ts — DependencyGraph, buildDependencyGraph(), resolveDependencies()
    resource-graph.ts — ResourceLifecycleGraph, advanceState(), validateTransition()
    capability-graph.ts — CapabilityGraph, resolveCapabilities(), validateCapabilities()
  reporting/
    chain.ts          — ExecutionProofV1/V2, buildProofChain(), buildProofChainFromBuffers(), upgradeExecutionProofV1ToV2()
    event-dag.ts      — EventDAG, buildEventDAG(), eventsInTrace(), denialEvents()
    jsonl.ts          — JsonlWriter, createJsonlWriter(), createInMemoryJsonlWriter(), serializeAuditEvent()
    builders.ts       — effectGraphToReport(), boundaryGraphToReport(), eventDagToReport(), proofChainToReport()
    serializer.ts     — graphToJSON(), graphFromJSON(), graphToJSONString(), graphToJSONPretty()
  index.ts            — all public exports (named, no defaults)
```

---

## Running tests

```sh
npm run build
npm test
```

90 tests across 25 suites, all passing. Test runner is Node.js built-in `node:test` — no extra dependencies.

---

## Licence

Apache 2.0 — see [LICENSE](./LICENSE).

You are free to use, modify, and distribute this library in commercial and open-source projects. Attribution is appreciated but not required.

---

## Acknowledgements

Big thanks to the original graph implementations inside the Galerina monorepo that this library grew from and replaces:

- **`galerina-devtools-project-graph`** — the 1 144-line workspace knowledge graph that established the `NodeKind` and `EdgeKind` taxonomy, the workspace scanning contracts, backend policy model, and the path-finding and explain APIs that lln-graph's `ProjectGraph` and `bfsPath` now power. The ideas here were solid; we just needed them on a proper algorithmic foundation.

- **`galerina-core-tasks/dependency-graph.ts`** — the original hand-written DFS that proved the dependency resolution contract (task ordering, cycle detection, missing dependency errors) that `resolveDependencies` and `buildDependencyGraph` now fulfil with Kahn's algorithm.

Both implementations were authored as part of the Galerina platform and informed every design decision in this library — from the `LlnDiagnostic` interface shape to the choice to make `Graph<N,E>` immutable after construction.

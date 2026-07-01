// @galerina/devtools-flowgraph — Diagnostics
import type { FlowGraph } from "./flow-graph.js";

export type GraphSeverity = "error" | "warning" | "info";

export interface GraphDiagnostic {
  readonly code: string;
  readonly name: string;
  readonly severity: GraphSeverity;
  readonly message: string;
  readonly flows?: readonly string[];   // flows involved
}

// ── FUNGI-GRAPH-001: Cycle detection ────────────────────────────────────────────

export function detectCycles(g: FlowGraph): readonly GraphDiagnostic[] {
  const diags: GraphDiagnostic[] = [];
  const adj = new Map<string, string[]>();
  for (const e of g.edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }

  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): boolean {
    if (stack.has(node)) {
      // Found cycle — extract the cycle path
      const cycleStart = path.indexOf(node);
      const cycle = path.slice(cycleStart);
      diags.push({
        code: "FUNGI-GRAPH-001",
        name: "CycleDetected",
        severity: "error",
        message: `Potential execution cycle detected: ${cycle.join(" → ")} → ${node}. Add a retry limit, timeout, or exit condition.`,
        flows: cycle,
      });
      return true;
    }
    if (visited.has(node)) return false;
    visited.add(node);
    stack.add(node);
    path.push(node);
    for (const next of adj.get(node) ?? []) {
      if (dfs(next)) { path.pop(); stack.delete(node); return false; }
    }
    path.pop();
    stack.delete(node);
    return false;
  }

  for (const name of g.nodes.keys()) dfs(name);
  return diags;
}

// ── FUNGI-GRAPH-002: Dead flows ─────────────────────────────────────────────────

export function detectDeadFlows(g: FlowGraph): readonly GraphDiagnostic[] {
  const reachable = new Set<string>();
  // Flows reachable from routes or public (non-pure) entry points
  for (const flowName of g.routes.values()) reachable.add(flowName);
  // BFS from reachable set
  const queue = [...reachable];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const e of g.edges) {
      if (e.from === cur && !reachable.has(e.to)) {
        reachable.add(e.to);
        queue.push(e.to);
      }
    }
  }
  const diags: GraphDiagnostic[] = [];
  for (const [name, node] of g.nodes) {
    if (!reachable.has(name) && node.qualifier !== "pure") {
      diags.push({
        code: "FUNGI-GRAPH-002",
        name: "DeadFlow",
        severity: "warning",
        message: `Flow '${name}' is never reachable from any route or public entry point. Consider removing it or adding a route.`,
        flows: [name],
      });
    }
  }
  return diags;
}

// ── FUNGI-GRAPH-003: Authority escalation ──────────────────────────────────────

export function detectAuthorityEscalation(g: FlowGraph): readonly GraphDiagnostic[] {
  const diags: GraphDiagnostic[] = [];
  // Find cases where a flow reachable from a public route calls a secure/guarded flow
  // that has sensitive effects (database.write, secret.read, etc.)
  const sensitiveEffects = new Set([
    "database.write", "database.read", "secret.read",
    "storage.write", "process.spawn", "eval.execute",
  ]);
  for (const e of g.edges) {
    const from = g.nodes.get(e.from);
    const to   = g.nodes.get(e.to);
    if (!from || !to) continue;
    // Public route flow → sensitive flow without matching authority
    const fromIsSensitive = from.declaredEffects.some(x => sensitiveEffects.has(x));
    const toIsSensitive   = to.declaredEffects.some(x => sensitiveEffects.has(x));
    if (!fromIsSensitive && toIsSensitive && from.qualifier === "flow") {
      diags.push({
        code: "FUNGI-GRAPH-003",
        name: "AuthorityEscalation",
        severity: "error",
        message: `Flow '${e.from}' (no sensitive effects) calls '${e.to}' which has sensitive effects [${to.declaredEffects.filter(x => sensitiveEffects.has(x)).join(", ")}]. Ensure ${e.from} has appropriate authority declared.`,
        flows: [e.from, e.to],
      });
    }
  }
  return diags;
}

// ── FUNGI-GRAPH-004: PII leakage paths ─────────────────────────────────────────

export function detectPiiLeakagePaths(g: FlowGraph): readonly GraphDiagnostic[] {
  const diags: GraphDiagnostic[] = [];
  for (const e of g.edges) {
    const from = g.nodes.get(e.from);
    const to   = g.nodes.get(e.to);
    if (!from || !to) continue;
    // PII flow → network outbound without redaction
    if (from.hasPii && to.hasNetworkOut && !to.hasAudit) {
      diags.push({
        code: "FUNGI-GRAPH-004",
        name: "PiiLeakagePath",
        severity: "error",
        message: `PII flow '${e.from}' calls '${e.to}' which has network.outbound but no audit.write. Protected values may leak externally without an audit trail.`,
        flows: [e.from, e.to],
      });
    }
  }
  return diags;
}

// ── FUNGI-GRAPH-005: Missing audit coverage ────────────────────────────────────

const HIGH_RISK_EFFECTS = new Set(["database.write", "secret.read", "storage.write"]);

export function detectMissingAuditCoverage(g: FlowGraph): readonly GraphDiagnostic[] {
  const diags: GraphDiagnostic[] = [];
  for (const [name, node] of g.nodes) {
    const isHighRisk = node.declaredEffects.some(e => HIGH_RISK_EFFECTS.has(e));
    if (isHighRisk && !node.hasAudit) {
      diags.push({
        code: "FUNGI-GRAPH-005",
        name: "MissingAuditCoverage",
        severity: "warning",
        message: `Flow '${name}' performs high-risk operations [${node.declaredEffects.filter(e => HIGH_RISK_EFFECTS.has(e)).join(", ")}] without declaring audit.write. Critical state changes should have an audit trail.`,
        flows: [name],
      });
    }
  }
  return diags;
}

// ── FUNGI-GRAPH-006: Unbounded retry / repeated expensive calls ────────────────

export function detectUnboundedRetry(g: FlowGraph): readonly GraphDiagnostic[] {
  const diags: GraphDiagnostic[] = [];
  // Count how many times each flow is called from a single caller
  const callCounts = new Map<string, Map<string, number>>();
  for (const e of g.edges) {
    if (!callCounts.has(e.from)) callCounts.set(e.from, new Map());
    const inner = callCounts.get(e.from)!;
    inner.set(e.to, (inner.get(e.to) ?? 0) + 1);
  }
  for (const [caller, callees] of callCounts) {
    for (const [callee, count] of callees) {
      if (count >= 3) {
        diags.push({
          code: "FUNGI-GRAPH-006",
          name: "UnboundedRetry",
          severity: "warning",
          message: `Flow '${caller}' calls '${callee}' ${count} times in the same path. Consider extracting to a bounded loop or caching the result.`,
          flows: [caller, callee],
        });
      }
    }
  }
  return diags;
}

/** Run all six graph checks. */
export function checkFlowGraph(g: FlowGraph): readonly GraphDiagnostic[] {
  return [
    ...detectCycles(g),
    ...detectDeadFlows(g),
    ...detectAuthorityEscalation(g),
    ...detectPiiLeakagePaths(g),
    ...detectMissingAuditCoverage(g),
    ...detectUnboundedRetry(g),
  ];
}

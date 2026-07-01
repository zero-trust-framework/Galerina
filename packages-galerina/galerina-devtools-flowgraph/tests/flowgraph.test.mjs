// @galerina/devtools-flowgraph — comprehensive test suite
// Uses node:test (built-in, no extra deps) and constructs FlowGraph objects
// directly rather than going through the parser, to keep tests fast and hermetic.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFlowGraph,
  flowGraphToJson,
  flowGraphToMermaid,
  checkFlowGraph,
  detectCycles,
  detectDeadFlows,
  detectAuthorityEscalation,
  detectPiiLeakagePaths,
  detectMissingAuditCoverage,
  detectUnboundedRetry,
  FLOWGRAPH_VERSION,
} from "../dist/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal AST root node (program) with no children. */
function emptyAst(children = []) {
  return { kind: "program", children };
}

/** Make a FlowMeta entry. */
function meta(name, qualifier, effects = []) {
  return {
    name,
    qualifier,
    params: [],
    returnType: "Unit",
    declaredEffects: effects,
    location: { line: 1, column: 1, file: "test.fungi" },
  };
}

/** Build a minimal FlowGraph without AST walking (no call edges). */
function graphFromMetas(metas, routes = new Map()) {
  return buildFlowGraph(emptyAst(), metas, routes);
}

/** Build a FlowGraph with explicit edges injected via AST callExpr nodes. */
function graphWithEdges(metas, edges, routes = new Map()) {
  // Build AST children: one flowDecl per meta, with callExpr children for edges.
  const flowChildren = metas.map(m => {
    const callChildren = edges
      .filter(e => e.from === m.name)
      .map(e => ({ kind: "callExpr", value: e.to, children: [] }));
    return { kind: "flowDecl", value: m.name, children: callChildren };
  });
  const ast = emptyAst(flowChildren);
  return buildFlowGraph(ast, metas, routes);
}

// ── Version export ────────────────────────────────────────────────────────────

test("FLOWGRAPH_VERSION is 0.1.0", () => {
  assert.equal(FLOWGRAPH_VERSION, "0.1.0");
});

// ── buildFlowGraph: basic node creation ──────────────────────────────────────

test("empty graph has no nodes, edges, or routes", () => {
  const g = graphFromMetas([]);
  assert.equal(g.nodes.size, 0);
  assert.equal(g.edges.length, 0);
  assert.equal(g.routes.size, 0);
});

test("nodes populated from FlowMeta", () => {
  const g = graphFromMetas([
    meta("greet", "pure"),
    meta("createSession", "secure", ["database.write", "audit.write"]),
  ]);
  assert.equal(g.nodes.size, 2);
  const greet = g.nodes.get("greet");
  assert.equal(greet.qualifier, "pure");
  assert.equal(greet.hasAudit, false);
  const cs = g.nodes.get("createSession");
  assert.equal(cs.hasAudit, true);
  assert.equal(cs.hasNetworkOut, false);
});

test("hasPii true when effect includes 'pii'", () => {
  const g = graphFromMetas([meta("getPatient", "secure", ["pii.read", "database.read"])]);
  assert.equal(g.nodes.get("getPatient").hasPii, true);
});

test("hasPii true when effect includes 'protected'", () => {
  const g = graphFromMetas([meta("loadRecord", "secure", ["protected.read"])]);
  assert.equal(g.nodes.get("loadRecord").hasPii, true);
});

test("hasNetworkOut true when network.outbound declared", () => {
  const g = graphFromMetas([meta("callApi", "flow", ["network.outbound"])]);
  assert.equal(g.nodes.get("callApi").hasNetworkOut, true);
});

// ── buildFlowGraph: AST edge walking ─────────────────────────────────────────

test("callExpr in flowDecl body produces edge", () => {
  const metas = [meta("A", "flow"), meta("B", "flow")];
  const g = graphWithEdges(metas, [{ from: "A", to: "B" }]);
  assert.equal(g.edges.length, 1);
  assert.equal(g.edges[0].from, "A");
  assert.equal(g.edges[0].to, "B");
});

test("self-calls are not added as edges", () => {
  const metas = [meta("A", "flow")];
  const g = graphWithEdges(metas, [{ from: "A", to: "A" }]);
  assert.equal(g.edges.length, 0);
});

test("callExpr to unknown flow is ignored", () => {
  const metas = [meta("A", "flow")];
  const callChild = { kind: "callExpr", value: "ghost", children: [] };
  const ast = emptyAst([{ kind: "flowDecl", value: "A", children: [callChild] }]);
  const g = buildFlowGraph(ast, metas);
  assert.equal(g.edges.length, 0);
});

// ── flowGraphToJson ───────────────────────────────────────────────────────────

test("flowGraphToJson produces valid JSON", () => {
  const g = graphFromMetas([meta("hello", "pure")]);
  const json = flowGraphToJson(g);
  const parsed = JSON.parse(json);
  assert.equal(parsed.schemaVersion, "fungi.flowgraph.v1");
  assert.ok(Array.isArray(parsed.nodes));
  assert.ok(Array.isArray(parsed.edges));
  assert.equal(typeof parsed.routes, "object");
});

test("flowGraphToJson includes all nodes", () => {
  const g = graphFromMetas([meta("A", "flow"), meta("B", "secure")]);
  const parsed = JSON.parse(flowGraphToJson(g));
  const names = parsed.nodes.map(n => n.name);
  assert.ok(names.includes("A"));
  assert.ok(names.includes("B"));
});

test("flowGraphToJson includes schemaVersion field", () => {
  const g = graphFromMetas([]);
  const parsed = JSON.parse(flowGraphToJson(g));
  assert.equal(parsed.schemaVersion, "fungi.flowgraph.v1");
});

// ── flowGraphToMermaid ────────────────────────────────────────────────────────

test("flowGraphToMermaid starts with 'flowchart LR'", () => {
  const g = graphFromMetas([meta("A", "flow")]);
  const mermaid = flowGraphToMermaid(g);
  assert.ok(mermaid.startsWith("flowchart LR"), `Got: ${mermaid.slice(0, 50)}`);
});

test("flowGraphToMermaid includes node labels", () => {
  const g = graphFromMetas([meta("greet", "pure")]);
  const mermaid = flowGraphToMermaid(g);
  assert.ok(mermaid.includes("greet"));
});

test("flowGraphToMermaid includes edge arrows", () => {
  const metas = [meta("A", "flow"), meta("B", "flow")];
  const g = graphWithEdges(metas, [{ from: "A", to: "B" }]);
  const mermaid = flowGraphToMermaid(g);
  assert.ok(mermaid.includes("A --> B"));
});

// ── FUNGI-GRAPH-001: Cycle detection ───────────────────────────────────────────

test("001: simple A→B→A cycle detected", () => {
  const metas = [meta("A", "flow"), meta("B", "flow")];
  const g = graphWithEdges(metas, [{ from: "A", to: "B" }, { from: "B", to: "A" }]);
  const diags = detectCycles(g);
  assert.ok(diags.length > 0, "Expected cycle diagnostic");
  assert.equal(diags[0].code, "FUNGI-GRAPH-001");
  assert.equal(diags[0].severity, "error");
});

test("001: A→B→C→A three-node cycle detected", () => {
  const metas = [meta("A", "flow"), meta("B", "flow"), meta("C", "flow")];
  const g = graphWithEdges(metas, [
    { from: "A", to: "B" }, { from: "B", to: "C" }, { from: "C", to: "A" },
  ]);
  const diags = detectCycles(g);
  assert.ok(diags.length > 0);
  assert.equal(diags[0].code, "FUNGI-GRAPH-001");
});

test("001: no cycle in A→B→C", () => {
  const metas = [meta("A", "flow"), meta("B", "flow"), meta("C", "flow")];
  const g = graphWithEdges(metas, [{ from: "A", to: "B" }, { from: "B", to: "C" }]);
  const diags = detectCycles(g);
  assert.equal(diags.length, 0);
});

// ── FUNGI-GRAPH-002: Dead flows ─────────────────────────────────────────────────

test("002: flow not reachable from any route is dead", () => {
  const metas = [meta("orphan", "flow")];
  const g = graphFromMetas(metas, new Map());
  const diags = detectDeadFlows(g);
  assert.ok(diags.length > 0);
  assert.equal(diags[0].code, "FUNGI-GRAPH-002");
  assert.equal(diags[0].severity, "warning");
});

test("002: flow reachable from route is not dead", () => {
  const metas = [meta("handler", "flow")];
  const routes = new Map([["GET /greet", "handler"]]);
  const g = graphFromMetas(metas, routes);
  const diags = detectDeadFlows(g);
  assert.equal(diags.length, 0);
});

test("002: pure flow is exempt from dead-flow check", () => {
  const metas = [meta("helper", "pure")];
  const g = graphFromMetas(metas, new Map());
  const diags = detectDeadFlows(g);
  assert.equal(diags.length, 0);
});

test("002: transitively reachable flow is not dead", () => {
  const metas = [meta("entry", "flow"), meta("helper", "flow")];
  const routes = new Map([["POST /do", "entry"]]);
  const g = graphWithEdges(metas, [{ from: "entry", to: "helper" }], routes);
  const diags = detectDeadFlows(g);
  assert.equal(diags.length, 0);
});

// ── FUNGI-GRAPH-003: Authority escalation ──────────────────────────────────────

test("003: plain flow calling database.write flow triggers escalation", () => {
  const metas = [
    meta("publicHandler", "flow", []),
    meta("writeDb", "secure", ["database.write"]),
  ];
  const g = graphWithEdges(metas, [{ from: "publicHandler", to: "writeDb" }]);
  const diags = detectAuthorityEscalation(g);
  assert.ok(diags.length > 0);
  assert.equal(diags[0].code, "FUNGI-GRAPH-003");
  assert.equal(diags[0].severity, "error");
});

test("003: flow with matching authority does not trigger escalation", () => {
  const metas = [
    meta("parentHandler", "flow", ["database.write"]),
    meta("writeDb", "secure", ["database.write"]),
  ];
  const g = graphWithEdges(metas, [{ from: "parentHandler", to: "writeDb" }]);
  const diags = detectAuthorityEscalation(g);
  assert.equal(diags.length, 0);
});

// ── FUNGI-GRAPH-004: PII leakage paths ─────────────────────────────────────────

test("004: pii flow → network.outbound without audit triggers leakage", () => {
  const metas = [
    meta("getPatient", "secure", ["pii.read", "database.read"]),
    meta("sendReport", "flow", ["network.outbound"]),
  ];
  const g = graphWithEdges(metas, [{ from: "getPatient", to: "sendReport" }]);
  const diags = detectPiiLeakagePaths(g);
  assert.ok(diags.length > 0);
  assert.equal(diags[0].code, "FUNGI-GRAPH-004");
  assert.equal(diags[0].severity, "error");
});

test("004: pii flow → network.outbound WITH audit is safe", () => {
  const metas = [
    meta("getPatient", "secure", ["pii.read"]),
    meta("sendAuditedReport", "flow", ["network.outbound", "audit.write"]),
  ];
  const g = graphWithEdges(metas, [{ from: "getPatient", to: "sendAuditedReport" }]);
  const diags = detectPiiLeakagePaths(g);
  assert.equal(diags.length, 0);
});

test("004: non-pii flow → network.outbound is clean", () => {
  const metas = [
    meta("getPublicData", "flow", ["database.read"]),
    meta("sendReport", "flow", ["network.outbound"]),
  ];
  const g = graphWithEdges(metas, [{ from: "getPublicData", to: "sendReport" }]);
  const diags = detectPiiLeakagePaths(g);
  assert.equal(diags.length, 0);
});

// ── FUNGI-GRAPH-005: Missing audit coverage ────────────────────────────────────

test("005: database.write without audit.write triggers warning", () => {
  const metas = [meta("updateRecord", "secure", ["database.write"])];
  const g = graphFromMetas(metas);
  const diags = detectMissingAuditCoverage(g);
  assert.ok(diags.length > 0);
  assert.equal(diags[0].code, "FUNGI-GRAPH-005");
  assert.equal(diags[0].severity, "warning");
});

test("005: database.write WITH audit.write is clean", () => {
  const metas = [meta("updateRecord", "secure", ["database.write", "audit.write"])];
  const g = graphFromMetas(metas);
  const diags = detectMissingAuditCoverage(g);
  assert.equal(diags.length, 0);
});

test("005: secret.read without audit.write triggers warning", () => {
  const metas = [meta("readSecret", "secure", ["secret.read"])];
  const g = graphFromMetas(metas);
  const diags = detectMissingAuditCoverage(g);
  assert.ok(diags.length > 0);
  assert.equal(diags[0].code, "FUNGI-GRAPH-005");
});

test("005: storage.write without audit.write triggers warning", () => {
  const metas = [meta("writeFile", "flow", ["storage.write"])];
  const g = graphFromMetas(metas);
  const diags = detectMissingAuditCoverage(g);
  assert.ok(diags.length > 0);
  assert.equal(diags[0].code, "FUNGI-GRAPH-005");
});

// ── FUNGI-GRAPH-006: Unbounded retry ───────────────────────────────────────────

test("006: caller invoking same callee 3 times triggers warning", () => {
  const metas = [meta("caller", "flow"), meta("callee", "flow")];
  // Inject 3 identical edges (same from→to)
  const edges = [
    { kind: "callExpr", value: "callee", children: [] },
    { kind: "callExpr", value: "callee", children: [] },
    { kind: "callExpr", value: "callee", children: [] },
  ];
  const flowNode = { kind: "flowDecl", value: "caller", children: edges };
  const ast = emptyAst([
    flowNode,
    { kind: "flowDecl", value: "callee", children: [] },
  ]);
  const g = buildFlowGraph(ast, metas);
  const diags = detectUnboundedRetry(g);
  assert.ok(diags.length > 0);
  assert.equal(diags[0].code, "FUNGI-GRAPH-006");
  assert.equal(diags[0].severity, "warning");
});

test("006: caller invoking same callee twice does not trigger", () => {
  const metas = [meta("caller", "flow"), meta("callee", "flow")];
  const edges = [
    { kind: "callExpr", value: "callee", children: [] },
    { kind: "callExpr", value: "callee", children: [] },
  ];
  const ast = emptyAst([
    { kind: "flowDecl", value: "caller", children: edges },
    { kind: "flowDecl", value: "callee", children: [] },
  ]);
  const g = buildFlowGraph(ast, metas);
  const diags = detectUnboundedRetry(g);
  assert.equal(diags.length, 0);
});

// ── checkFlowGraph (combined) ─────────────────────────────────────────────────

test("checkFlowGraph returns empty array for clean well-formed graph", () => {
  // A clean graph: one route, one flow with audit, pure helper
  const metas = [
    meta("handleRequest", "flow", ["database.read", "audit.write"]),
    meta("computeHash", "pure", []),
  ];
  const routes = new Map([["GET /resource", "handleRequest"]]);
  const g = graphWithEdges(metas, [{ from: "handleRequest", to: "computeHash" }], routes);
  const diags = checkFlowGraph(g);
  assert.equal(diags.length, 0);
});

test("checkFlowGraph aggregates multiple diagnostic codes", () => {
  // Graph with both a dead flow (002) and a missing-audit (005)
  const metas = [
    meta("deadOrphan", "flow"),
    meta("riskyWrite", "secure", ["database.write"]),
  ];
  const g = graphFromMetas(metas, new Map());
  const diags = checkFlowGraph(g);
  const codes = diags.map(d => d.code);
  assert.ok(codes.includes("FUNGI-GRAPH-002"), "Expected dead flow diag");
  assert.ok(codes.includes("FUNGI-GRAPH-005"), "Expected missing audit diag");
});

test("each diagnostic has code, name, severity, message fields", () => {
  const metas = [meta("orphan", "flow")];
  const g = graphFromMetas(metas, new Map());
  const diags = checkFlowGraph(g);
  for (const d of diags) {
    assert.ok(typeof d.code === "string" && d.code.length > 0);
    assert.ok(typeof d.name === "string" && d.name.length > 0);
    assert.ok(["error", "warning", "info"].includes(d.severity));
    assert.ok(typeof d.message === "string" && d.message.length > 0);
  }
});

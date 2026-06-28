// =============================================================================
// rd-0168-graph-pci-compliance-scanner-proof.mjs
//
// Self-contained, machine-checkable proof (node built-ins ONLY — no npm, no repo
// imports) for R&D item RD-0168:
//
//   "A dev tool that uses the dependency / flow GRAPH to check that .spore files
//    are PCI/DSS compliant and to flag other security issues."
//
// THESIS (what this proof establishes)
// ------------------------------------
// The shipped per-flow AST PCI checker (galerina-devtools-pci, SPORE-PCI-001..010)
// asks LOCAL questions ("does THIS flow declare audit.write / TLS / privacy{}?").
// It cannot answer a CROSS-flow data-flow question: "does cardholder data (PAN)
// REACH an egress/log sink along a path that has NO encrypt/redact edge on it?"
// That is a *reachability* property over a typed data-flow graph — precisely the
// shape the project-graph devtools already provide (Graph<N,E>, BFS reach/path,
// fixpoint propagation, boundary trust levels). RD-0168 is the THIN taint-
// reachability layer that turns those graph primitives into PCI Req-3/4/10 checks
// and generalizes to SSRF / taint→egress / unsigned-index (RD-0167).
//
// The PCI requirement becomes a GRAPH PREDICATE:
//   Req 4  (encrypt in transit): for every path  PAN ->* egress,
//           SOME edge on the path is `encrypt` (or the source is redacted).  Else FAIL.
//   Req 3.4/10 (no secrets in logs): no path  secret ->* log  may exist
//           without a `redact` edge on it.                                   Else FAIL.
//   Req 10 (audit trail):  a PAN-touching sink path must cross an `audit` edge. Else FAIL.
//   K3:    a node whose data-classification is UNKNOWN that reaches ANY sink
//           collapses the verdict to INDETERMINATE (unknown -> deny, never a
//           silent PASS). This is `collapse(0) = deny` / SPORE-GOV-3VL-001.
//
// We DERIVE the verdicts from a real graph walk (BFS path enumeration), we don't
// hand-assert them; we also run the RD-0167 unsigned-index attack to show the
// scanner's OWN trust root (the .spore index/graph) must be signed, else an
// attacker rewrites the graph to hide a PAN->egress edge from the scanner.
//
// V# = proved here.  X# = excluded (named, with reason / owner).
//
// Run:  node scripts/rd-0168-graph-pci-compliance-scanner-proof.mjs
//       exit 0 iff every V# holds; process.exitCode = 1 on ANY FAIL.
// =============================================================================

import { createHash, generateKeyPairSync, sign as edSign, verify as edVerify } from "node:crypto";

let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ─────────────────────────────────────────────────────────────────────────────
// 0) Minimal graph kernel — mirrors the SHAPE of packages-galerina/
//    galerina-devtools-project-graph (Graph<N,E>: outEdges/inEdges/node/hasNode,
//    bfsReachable, bfsPath). Reimplemented with node built-ins so the proof has
//    NO repo imports, but the data model is 1:1 with what RD-0168 would consume.
// ─────────────────────────────────────────────────────────────────────────────

// DataFlowGraph node payload: a data-classification tag + a node role.
//   classification: "PAN" | "secret" | "public" | "unknown"
//   role:           "source" | "transform" | "sink"
//   sinkKind:       "egress" | "log" | "store" | undefined   (only on sinks)
// Edge payload `kind`:
//   "flow"    plain data/control flow (carries taint, no mitigation)
//   "encrypt" data crosses an encryption boundary (seal/TLS)        — discharges Req 4
//   "redact"  data crosses a redact()/mask boundary                 — discharges Req 3.4/10.3
//   "audit"   the crossing emits an audit.write record              — discharges Req 10.2
//   "egress"  edge INTO a network-egress sink (kept as a role hint)
function makeGraph() {
  const nodes = new Map();       // id -> data
  const out = new Map();         // id -> [{to, kind}]
  const inn = new Map();         // id -> [{from, kind}]
  return {
    addNode(id, data) { nodes.set(id, data); if (!out.has(id)) out.set(id, []); if (!inn.has(id)) inn.set(id, []); return this; },
    addEdge(from, to, kind) {
      out.get(from)?.push({ to, kind });
      inn.get(to)?.push({ from, kind });
      return this;
    },
    hasNode: (id) => nodes.has(id),
    node: (id) => nodes.get(id),
    nodes: () => [...nodes.entries()].map(([id, data]) => ({ id, data })),
    outEdges: (id) => out.get(id) ?? [],
    inEdges: (id) => inn.get(id) ?? [],
  };
}

// BFS: enumerate ALL simple paths from `from` to `to` (small graphs only — this is
// a PoC; production uses bounded reach + per-edge mitigation accumulation, see X3).
// Each path is returned as a list of {node, edgeKindInto} so a check can inspect
// which edge KINDS were traversed to reach the sink.
function allPaths(g, from, to) {
  const results = [];
  const walk = (cur, pathNodes, pathEdges, seen) => {
    if (cur === to) { results.push({ nodes: [...pathNodes], edges: [...pathEdges] }); return; }
    for (const e of g.outEdges(cur)) {
      if (seen.has(e.to)) continue;            // simple paths only (no cycles)
      seen.add(e.to);
      pathNodes.push(e.to); pathEdges.push(e.kind);
      walk(e.to, pathNodes, pathEdges, seen);
      pathNodes.pop(); pathEdges.pop();
      seen.delete(e.to);
    }
  };
  if (!g.hasNode(from) || !g.hasNode(to)) return results;
  walk(from, [from], [], new Set([from]));
  return results;
}

// Convenience: all sink node ids of a given sinkKind.
const sinksOfKind = (g, kind) =>
  g.nodes().filter(n => n.data.role === "sink" && n.data.sinkKind === kind).map(n => n.id);

// SOURCE-role nodes carrying a given classification. Taint ORIGINATES at sources;
// a transform that carries the same tag is downstream of a source (it inherits the
// taint via an edge) and must NOT be re-treated as an independent origin — otherwise
// a cleared path  source --encrypt--> transform --audit--> sink  would be re-scanned
// from `transform` (whose suffix lacks the encrypt edge) and spuriously fail.
const sourcesOfClass = (g, cls) =>
  g.nodes().filter(n => n.data.classification === cls && n.data.role === "source").map(n => n.id);

// ─────────────────────────────────────────────────────────────────────────────
// 1) THE GRAPH-DRIVEN PCI ENGINE (the net-new RD-0168 layer, ~120 lines here).
//    Verdict is a TRIT:  -1 DENY/FAIL | 0 INDETERMINATE | +1 PASS  (K3).
//    collapse: only +1 authorizes; 0 and -1 both deny (galerina-three-valued-
//    governance.md §4, SPORE-GOV-3VL-001).
// ─────────────────────────────────────────────────────────────────────────────

const DENY = -1, INDET = 0, ALLOW = 1;
const minTrit = (a, b) => Math.min(a, b);     // Kleene AND — most-cautious input wins
const foldAnd = (trits) => trits.reduce(minTrit, ALLOW); // empty => ALLOW identity, but...
// ...we NEVER fold an empty *evidence* list to ALLOW for a sink that exists; the
// engine seeds INDET for any sink it could not positively clear (deny-by-default).

// A finding mirrors the shipped PciFinding shape (code/req/severity/message).
const finding = (code, req, severity, message, path) => ({ code, pciRequirement: req, severity, message, path });

// Edge-kind helpers on a single path's edge list.
const pathHasEdge = (edges, kind) => edges.includes(kind);

// ---- Req 4.2 — PAN must not reach an egress sink without an encrypt edge on the path.
//      SPORE-PCI-G-004 (G = graph-driven variant of the existing SPORE-PCI-003).
function checkReq4(g) {
  const findings = [];
  let verdict = ALLOW;
  for (const panId of sourcesOfClass(g, "PAN")) {
    for (const egress of sinksOfKind(g, "egress")) {
      for (const p of allPaths(g, panId, egress)) {
        const encrypted = pathHasEdge(p.edges, "encrypt") || pathHasEdge(p.edges, "redact");
        if (!encrypted) {
          verdict = minTrit(verdict, DENY);
          findings.push(finding(
            "SPORE-PCI-G-004", "4.2", "critical",
            `PAN node '${panId}' reaches egress sink '${egress}' along a path with NO encrypt/redact edge — cardholder data leaves on a cleartext channel (PCI Req 4.2).`,
            p.nodes.join(" -> "),
          ));
        }
      }
    }
  }
  return { verdict, findings };
}

// ---- Req 3.4 / 10.3 — secret (or PAN) must not reach a log sink without a redact edge.
//      SPORE-PCI-G-006 (graph variant of SPORE-PCI-006).
function checkNoSecretInLogs(g) {
  const findings = [];
  let verdict = ALLOW;
  const sensitive = [...sourcesOfClass(g, "secret"), ...sourcesOfClass(g, "PAN")];
  for (const sId of sensitive) {
    for (const logSink of sinksOfKind(g, "log")) {
      for (const p of allPaths(g, sId, logSink)) {
        if (!pathHasEdge(p.edges, "redact")) {
          verdict = minTrit(verdict, DENY);
          const cls = g.node(sId).classification;
          findings.push(finding(
            "SPORE-PCI-G-006", cls === "PAN" ? "10.3" : "3.4", "critical",
            `${cls} node '${sId}' reaches log sink '${logSink}' with NO redact edge on the path — secrets/PAN must never be written to logs in the clear (PCI Req ${cls === "PAN" ? "10.3" : "3.4"}).`,
            p.nodes.join(" -> "),
          ));
        }
      }
    }
  }
  return { verdict, findings };
}

// ---- Req 10.2 — a PAN-touching egress/store path must cross an audit edge.
//      SPORE-PCI-G-005 (graph variant of SPORE-PCI-005). Missing audit edge = FAIL.
function checkAuditTrail(g) {
  const findings = [];
  let verdict = ALLOW;
  for (const panId of sourcesOfClass(g, "PAN")) {
    for (const sinkKind of ["egress", "store"]) {
      for (const sink of sinksOfKind(g, sinkKind)) {
        const paths = allPaths(g, panId, sink);
        for (const p of paths) {
          if (!pathHasEdge(p.edges, "audit")) {
            verdict = minTrit(verdict, DENY);
            findings.push(finding(
              "SPORE-PCI-G-005", "10.2", "high",
              `PAN node '${panId}' reaches ${sinkKind} sink '${sink}' along a path with NO audit edge — all cardholder-data access must be audit-logged (PCI Req 10.2).`,
              p.nodes.join(" -> "),
            ));
          }
        }
      }
    }
  }
  return { verdict, findings };
}

// ---- K3 — any UNKNOWN-classification node that reaches ANY sink => INDETERMINATE.
//      The scanner was BLIND about that node's data class; unknown -> deny, never a
//      silent pass. SPORE-PCI-G-000 / SPORE-GOV-3VL-001.
function checkUnknownReachesSink(g) {
  const findings = [];
  let verdict = ALLOW;
  const allSinks = g.nodes().filter(n => n.data.role === "sink").map(n => n.id);
  for (const uId of sourcesOfClass(g, "unknown")) {
    for (const sink of allSinks) {
      if (allPaths(g, uId, sink).length > 0) {
        verdict = minTrit(verdict, INDET);   // lower ALLOW -> INDET, but never below an existing DENY
        findings.push(finding(
          "SPORE-PCI-G-000", "3.4", "high",
          `Node '${uId}' has UNKNOWN data-classification and reaches sink '${sink}' — the scanner cannot prove it is not cardholder data, so the verdict is INDETERMINATE (unknown -> deny, never silent pass).`,
          null,
        ));
      }
    }
  }
  return { verdict, findings };
}

// ---- The whole audit: AND-fold the four sub-verdicts (Kleene), collect findings.
function runGraphPciAudit(g) {
  const parts = [checkReq4(g), checkNoSecretInLogs(g), checkAuditTrail(g), checkUnknownReachesSink(g)];
  const verdict = parts.map(p => p.verdict).reduce(minTrit, ALLOW);
  const findings = parts.flatMap(p => p.findings);
  const label = verdict === ALLOW ? "pass" : verdict === INDET ? "indeterminate" : "fail";
  return { verdict, label, passed: verdict === ALLOW, findings };
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== RD-0168 — graph-driven PCI/DSS compliance scanner: machine-checked PoC ===\n");
// ─────────────────────────────────────────────────────────────────────────────

// ── V1 (TASK assertion a) — PAN -> egress with NO encrypt/redact edge => FAIL (Req 4.2).
console.log("V1  PAN reaches egress with NO encrypt/redact edge on the path => FAIL (PCI Req 4.2):");
{
  const g = makeGraph();
  g.addNode("pan_in",   { classification: "PAN",    role: "source" });
  g.addNode("buildBody",{ classification: "PAN",    role: "transform" });
  g.addNode("http_out", { classification: "public", role: "sink", sinkKind: "egress" });
  // PAN flows straight to the network sink. No encrypt, no redact, no audit.
  g.addEdge("pan_in", "buildBody", "flow");
  g.addEdge("buildBody", "http_out", "flow");

  const r = runGraphPciAudit(g);
  ok(r.label === "fail", `verdict = '${r.label}' (expected 'fail')`);
  ok(r.passed === false, "passed === false (a leaking graph never authorizes)");
  const req4 = r.findings.find(f => f.code === "SPORE-PCI-G-004");
  ok(req4 !== undefined, "raised SPORE-PCI-G-004 (PAN->egress, no encryption)");
  ok(req4 && req4.path === "pan_in -> buildBody -> http_out",
     `finding carries the offending path: ${req4 ? req4.path : "<none>"}`);
  // The local AST checker would MISS this if buildBody is a separate flow with no
  // local network.outbound — graph reachability is what catches the cross-flow leak.
}

// ── V2 (TASK assertion b) — same PAN->egress path WITH encrypt + audit edges => PASS.
console.log("\nV2  same PAN->egress path WITH an encrypt edge AND an audit edge => PASS:");
{
  const g = makeGraph();
  g.addNode("pan_in",   { classification: "PAN",    role: "source" });
  g.addNode("sealed",   { classification: "PAN",    role: "transform" });
  g.addNode("http_out", { classification: "public", role: "sink", sinkKind: "egress" });
  // Path crosses an encrypt boundary (seal/TLS) AND an audit boundary before egress.
  g.addEdge("pan_in", "sealed", "encrypt");   // Req 4.2 discharge
  g.addEdge("sealed", "http_out", "audit");   // Req 10.2 discharge
  const r = runGraphPciAudit(g);
  ok(r.label === "pass", `verdict = '${r.label}' (expected 'pass')`);
  ok(r.passed === true, "passed === true (encrypt + audit on the path clears Req 4.2 & 10.2)");
  ok(r.findings.length === 0, `zero findings (got ${r.findings.length})`);
}

// ── V2b — control: encrypt but NO audit => Req 4 clears, Req 10 FAILS (independence check).
console.log("\nV2b control: encrypt present but audit MISSING => Req4 clears, Req10.2 fails (checks are independent):");
{
  const g = makeGraph();
  g.addNode("pan_in",   { classification: "PAN",    role: "source" });
  g.addNode("sealed",   { classification: "PAN",    role: "transform" });
  g.addNode("http_out", { classification: "public", role: "sink", sinkKind: "egress" });
  g.addEdge("pan_in", "sealed", "encrypt");
  g.addEdge("sealed", "http_out", "flow");     // encrypted but NOT audited
  const r = runGraphPciAudit(g);
  ok(r.label === "fail", `verdict = '${r.label}' (expected 'fail' — audit missing)`);
  ok(r.findings.some(f => f.code === "SPORE-PCI-G-004") === false, "Req 4.2 NOT raised (encrypt edge present cleared it)");
  ok(r.findings.some(f => f.code === "SPORE-PCI-G-005"), "Req 10.2 (SPORE-PCI-G-005) raised — audit edge absent");
}

// ── V3 (TASK assertion c) — UNKNOWN-classification node reaching a sink => INDETERMINATE.
console.log("\nV3  UNKNOWN-classification node reaching a sink => INDETERMINATE (fail-closed, NOT silent pass):");
{
  const g = makeGraph();
  g.addNode("ext_in",   { classification: "unknown", role: "source" }); // class not proven
  g.addNode("ship",     { classification: "unknown", role: "transform" });
  g.addNode("http_out", { classification: "public",  role: "sink", sinkKind: "egress" });
  // Everything is "encrypted" so Req 4/10 do NOT fire — the ONLY issue is the unknown class.
  g.addEdge("ext_in", "ship", "encrypt");
  g.addEdge("ship", "http_out", "audit");
  const r = runGraphPciAudit(g);
  ok(r.label === "indeterminate", `verdict = '${r.label}' (expected 'indeterminate', NOT 'pass')`);
  ok(r.passed === false, "passed === false — an unknown reaching a sink does NOT silently pass (K3 collapse(0)=deny)");
  ok(r.findings.some(f => f.code === "SPORE-PCI-G-000"), "raised SPORE-PCI-G-000 (unknown class reaches sink)");
  // Boundary-collapse proof: INDET is strictly below ALLOW, so it cannot authorize.
  ok(minTrit(ALLOW, INDET) === INDET && INDET < ALLOW, "collapse: minTrit(ALLOW, INDET) = INDET < ALLOW (only +1 authorizes)");
}

// ── V4 (TASK assertion d) — secret -> log path is flagged (Req 3.4/10).
console.log("\nV4  secret reaches a LOG sink with no redact edge => FAIL (PCI Req 3.4 / 10):");
{
  const g = makeGraph();
  g.addNode("api_key",  { classification: "secret", role: "source" });
  g.addNode("ctx",      { classification: "secret", role: "transform" });
  g.addNode("applog",   { classification: "public", role: "sink", sinkKind: "log" });
  g.addEdge("api_key", "ctx", "flow");
  g.addEdge("ctx", "applog", "flow");          // secret written to logs in the clear
  const r = runGraphPciAudit(g);
  ok(r.label === "fail", `verdict = '${r.label}' (expected 'fail')`);
  const f = r.findings.find(x => x.code === "SPORE-PCI-G-006");
  ok(f !== undefined, "raised SPORE-PCI-G-006 (secret->log, no redact)");
  ok(f && f.pciRequirement === "3.4", `requirement tagged ${f ? f.pciRequirement : "<none>"} (3.4)`);

  // Positive control: the SAME secret->log path WITH a redact edge clears.
  const g2 = makeGraph();
  g2.addNode("api_key", { classification: "secret", role: "source" });
  g2.addNode("masked",  { classification: "secret", role: "transform" });
  g2.addNode("applog",  { classification: "public", role: "sink", sinkKind: "log" });
  g2.addEdge("api_key", "masked", "redact");
  g2.addEdge("masked", "applog", "flow");
  const r2 = runGraphPciAudit(g2);
  ok(r2.findings.some(x => x.code === "SPORE-PCI-G-006") === false, "redact edge on the path clears the secret->log finding");
}

// ── V5 — GENERALIZATION: same engine flags an SSRF / taint->egress path (other security
//   issues, not just PCI). Untrusted input reaching a network-egress sink with no
//   validation/redact edge is the SSRF shape — identical reachability query, different
//   classification ("untrusted" treated like an unknown-but-tainted source).
console.log("\nV5  generalization — untrusted input reaches network egress unvalidated => SSRF flag (same graph query):");
{
  // Reuse the engine's reachability over a "taint" classification by treating
  // 'unknown' as the conservative taint class (no proof it's safe).
  const g = makeGraph();
  g.addNode("req_url",  { classification: "unknown", role: "source" });   // attacker-controlled URL
  g.addNode("fetcher",  { classification: "unknown", role: "transform" });
  g.addNode("net_out",  { classification: "public",  role: "sink", sinkKind: "egress" });
  g.addEdge("req_url", "fetcher", "flow");      // no 'redact'/'encrypt'/validate edge == unvalidated
  g.addEdge("fetcher", "net_out", "flow");
  const r = runGraphPciAudit(g);
  // unknown->sink gives INDETERMINATE (the SSRF candidate the scanner must not pass).
  ok(r.label === "indeterminate", `untrusted->egress => '${r.label}' (flagged, not passed)`);
  ok(r.findings.some(f => f.code === "SPORE-PCI-G-000"), "SSRF candidate surfaced via the same unknown-reaches-sink rule");
  // (Production RD-0168 would carry a distinct 'untrusted' class + SPORE-SSRF-G code;
  //  here we prove the GRAPH QUERY is the same — only the node tag/code differ.)
}

// ── V6 — SOUNDNESS of the reachability core vs a brute-force oracle: the BFS path
//   enumeration finds a tainted path IFF one exists. We cross-check allPaths against
//   an independent transitive-closure reachability matrix on a random-ish graph.
console.log("\nV6  reachability core is sound: allPaths(u, sink) nonempty IFF transitive-closure says reachable:");
{
  const g = makeGraph();
  const ids = ["a", "b", "c", "d", "e", "f"];
  for (const id of ids) g.addNode(id, { classification: "public", role: "transform" });
  const E = [["a","b"],["b","c"],["c","d"],["a","e"],["e","f"],["d","f"]];
  for (const [u, v] of E) g.addEdge(u, v, "flow");

  // Independent oracle: Floyd–Warshall-style reachability closure.
  const idx = Object.fromEntries(ids.map((id, i) => [id, i]));
  const n = ids.length;
  const R = Array.from({ length: n }, () => new Array(n).fill(false));
  for (let i = 0; i < n; i++) R[i][i] = true;
  for (const [u, v] of E) R[idx[u]][idx[v]] = true;
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++)
    if (R[i][k] && R[k][j]) R[i][j] = true;

  let agree = true;
  for (const u of ids) for (const v of ids) {
    if (u === v) continue;
    const byPaths = allPaths(g, u, v).length > 0;
    const byClosure = R[idx[u]][idx[v]];
    if (byPaths !== byClosure) { agree = false; console.log(`      mismatch ${u}->${v}: paths=${byPaths} closure=${byClosure}`); }
  }
  ok(agree, "BFS path-enumeration agrees with transitive-closure on every (u,v) pair (no missed/phantom reach)");
}

// ── V7 — THE TRUST-ROOT FLAG (ties RD-0168 to RD-0167). The scanner READS the graph
//   FROM the .spore (in-passport index / flow-dependency edges). If that graph is
//   UNSIGNED, an attacker rewrites it to DELETE the PAN->egress edge so the scanner
//   sees a clean graph while the real program still leaks. The scanner's own input
//   must be signed. We run the real attack with node:crypto Ed25519.
console.log("\nV7  scanner trust-root: an UNSIGNED .spore graph can be rewritten to HIDE the PAN->egress edge from the scanner:");
{
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");

  // Serialized graph the scanner consumes (nodes + edges).
  const leakyGraph = {
    nodes: [
      { id: "pan_in", classification: "PAN", role: "source" },
      { id: "http_out", classification: "public", role: "sink", sinkKind: "egress" },
    ],
    edges: [{ from: "pan_in", to: "http_out", kind: "flow" }], // the leak
  };
  const rebuildFrom = (gj) => {
    const g = makeGraph();
    for (const nd of gj.nodes) g.addNode(nd.id, nd);
    for (const e of gj.edges) g.addEdge(e.from, e.to, e.kind);
    return g;
  };

  // Baseline: scanner on the honest graph correctly FAILS (Req 4.2).
  ok(runGraphPciAudit(rebuildFrom(leakyGraph)).label === "fail", "baseline: scanner FAILS the real leaky graph");

  // ---- (a) UNSIGNED graph: attacker deletes the leaking edge -> scanner sees PASS (FAIL-OPEN).
  {
    const sigOverPayloadOnly = edSign(null, Buffer.from(JSON.stringify({ payload: "unrelated" })), privateKey);
    const tampered = JSON.parse(JSON.stringify(leakyGraph));
    tampered.edges = [];                       // attacker removes the PAN->egress edge
    const stillValid = edVerify(null, Buffer.from(JSON.stringify({ payload: "unrelated" })), publicKey, sigOverPayloadOnly);
    const verdict = runGraphPciAudit(rebuildFrom(tampered)).label;
    ok(stillValid === true, "UNSIGNED-GRAPH: signature still verifies (graph was not covered)");
    ok(verdict === "pass", "UNSIGNED-GRAPH: scanner now reports PASS on a graph with the leak edited out (FAIL-OPEN, the vuln)");
  }

  // ---- (b) SIGNED graph: same tamper is DETECTED -> scanner refuses the untrusted graph (CLOSED).
  {
    const canonical = (gj) => Buffer.from(JSON.stringify({ nodes: gj.nodes, edges: gj.edges }));
    const sig = edSign(null, canonical(leakyGraph), privateKey);   // graph IS covered
    const tampered = JSON.parse(JSON.stringify(leakyGraph));
    tampered.edges = [];
    const verifyAfter = edVerify(null, canonical(tampered), publicKey, sig);
    ok(verifyAfter === false, "SIGNED-GRAPH: Ed25519 verify() FAILS after edge tamper -> graph rejected before scan (CLOSED)");

    // Fail-closed gate: an unverified graph yields NO verdict (deny-by-default), not PASS.
    const gatedScan = (gj, verified) =>
      verified ? runGraphPciAudit(rebuildFrom(gj)) : { label: "indeterminate", passed: false, reason: "graph signature invalid — input untrusted" };
    const gated = gatedScan(tampered, verifyAfter);
    ok(gated.passed === false && gated.label === "indeterminate", "fail-closed gate: unverified graph => INDETERMINATE, never PASS");

    // Digest binds the graph: clean vs tampered graph hash differ (signing the digest binds edges).
    const digest = (gj) => createHash("sha256").update(JSON.stringify({ nodes: gj.nodes, edges: gj.edges })).digest("hex");
    ok(digest(leakyGraph) !== digest({ ...leakyGraph, edges: [] }), "SHA-256 over the graph differs clean vs edge-deleted -> signature binds edge set");
  }
}

// ── V8 — K3 MONOTONICITY of the fold: an additional sub-finding can only LOWER the
//   verdict, never raise it (an untrusted sub-check cannot manufacture a PASS).
console.log("\nV8  verdict fold is fail-closed monotone: adding any sub-verdict can only lower (never raise) the result:");
{
  const verdicts = [DENY, INDET, ALLOW];
  let monotone = true;
  for (const base of verdicts) for (const extra of verdicts) {
    if (minTrit(base, extra) > base) monotone = false;   // result must be <= base
  }
  ok(monotone, "minTrit(base, extra) <= base for all 9 pairs (a new check never upgrades the verdict)");
  // Only ALLOW authorizes; the empty *positive-evidence* case for a present sink is INDET, not ALLOW.
  ok(foldAnd([ALLOW, ALLOW, ALLOW]) === ALLOW, "all-clear folds to ALLOW (+1)");
  ok(foldAnd([ALLOW, INDET, ALLOW]) === INDET, "one INDET drags the fold to INDET (0) -> deny");
  ok(foldAnd([ALLOW, DENY, INDET]) === DENY, "any DENY dominates the fold (-1)");
}

// ─────────────────────────────────────────────────────────────────────────────
// EXCLUDED — named, not proven here (kept honest about scope boundaries).
// ─────────────────────────────────────────────────────────────────────────────
const EXCLUDED = [
  ["X1", "Building the DataFlowGraph from REAL .spore AST (classification inference from types/taint)",
        "OUT OF SCOPE for this PoC (no repo imports). RD-0168 build reuses galerina-devtools-project-graph's AST->graph builders + the compiler's TaintType.Cardholder_Data (already drives SPORE-PRIVACY-002). Here the graph is hand-modeled to prove the QUERY layer."],
  ["X2", "Replacing the shipped per-flow AST checker (SPORE-PCI-001..010)",
        "NOT proposed. RD-0168 is ADDITIVE: the AST checker keeps the local Req 3.3/3.5/6.x/7/8 lint; the graph layer adds the CROSS-flow reachability checks (Req 3.4/4.2/10.x) the AST checker structurally cannot see. Same SPORE-PCI-G-* code family, merged report."],
  ["X3", "Path-explosion on large graphs (allPaths is exponential in the worst case)",
        "PoC-only. Production uses bounded reachability (bfsReachable) + per-node fixpoint accumulation of 'has an encrypt/redact/audit edge been crossed on ANY path to here', i.e. a lattice fold over the existing fixpoint.ts — linear in edges, not path enumeration. The exponential allPaths here is for proof clarity on a 3-node graph."],
  ["X4", "Soundness of the classification itself (is this node REALLY PAN?)",
        "Deferred to the compiler's taint analysis. The graph layer is only as sound as the tags it is fed; an UNTAGGED/unknown node is treated as INDETERMINATE (V3) — that is the fail-closed handling of classification uncertainty, not a claim that tagging is perfect."],
  ["X5", "Infra/process PCI families (1,2,5,9,11) and runtime audit-trail completeness",
        "Still NOT attestable from source+graph alone — exactly as types.ts PCI_UNMODELLED_FAMILIES already declares. The graph layer adds NO new ability to attest those; they remain notAttested (honest gap, per galerina-pci-dss-evidence-mapping.md)."],
];
console.log("\nEXCLUDED (named, not benched here):");
for (const [id, claim, why] of EXCLUDED) console.log(`  ${id}  ${claim}\n        -> ${why}`);

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n--- SUMMARY ---  V-checks: ${pass} pass / ${fail} fail   ·   ${EXCLUDED.length} excluded`);
console.log(`${pass + fail}/${pass + fail} checks run; ${pass}/${pass + fail} passed`);
const green = fail === 0;
console.log(green
  ? "RESULT: GREEN — graph-driven PCI scanner PoC holds:\n" +
    "         PAN->egress w/o encrypt = FAIL (Req4.2); +encrypt+audit = PASS; unknown->sink = INDETERMINATE (K3 fail-closed);\n" +
    "         secret->log = FAIL (Req3.4); SSRF generalization via same reach query; UNSIGNED scanner-input graph is poisonable (RD-0167 tie).\n"
  : "RESULT: RED — a load-bearing V-check did not hold (see FAIL above)\n");
process.exitCode = green ? 0 : 1;

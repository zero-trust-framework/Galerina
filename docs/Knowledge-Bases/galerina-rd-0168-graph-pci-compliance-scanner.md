# RD-0168 — Graph-driven PCI/DSS + security compliance scanner

**Owner ask (2026-06-28):** "a dev tool to check files, using partially the graph, that everything is PCI/DSS
compliant and for other security issues that may come up."

**Verdict:** 🧪 **DESIGN — build-ready, ADOPT-additive** · **ZT 9/10** · proof
`scripts/rd-0168-graph-pci-compliance-scanner-proof.mjs` (**31/31**) · paper = **defensive** (+ modest scientific).

## The gap it fills
The shipped `galerina-devtools-pci` checker (`pci-checker.ts`, `SPORE-PCI-001..010`) is **per-flow AST** — it asks
*local* questions ("does THIS flow declare `audit.write` / TLS / `privacy{}`?"). It structurally cannot answer the
**cross-flow data-flow** question PCI Req 3.4 / 4.2 / 10.x actually demand:

> *Does cardholder data (PAN) **reach** an egress / log / store sink along a path with **no** encrypt / redact /
> audit edge?*

That is a **reachability property over a typed graph** — exactly what the project-graph devtools already expose.
RD-0168 is the thin **taint-reachability layer** that turns each PCI requirement into a **graph predicate**.

## What it checks (graph predicates)
Over a `DataFlowGraph` (nodes tagged `PAN`/`secret`/`public`/`unknown` + role `source`/`transform`/`sink`; edges
typed `flow`/`encrypt`/`redact`/`audit`/`egress`):

| Predicate | PCI req | Code | Fails when |
|---|---|---|---|
| PAN →* egress must cross `encrypt` (or source `redact`) | 4.2 | `SPORE-PCI-G-004` | unencrypted PAN leaves the boundary |
| no `secret\|PAN` →* `log` without `redact` | 3.4 / 10.3 | `SPORE-PCI-G-006` | cardholder/secret data hits a log |
| PAN → egress/store must cross `audit` | 10.2 | `SPORE-PCI-G-005` | no audit trail on the data path (proven independent of Req 4) |
| `unknown`-class source reaches ANY sink → **INDETERMINATE** | (K3) | `SPORE-PCI-G-000` | classification unknown → **never a silent PASS** |

**Generalizes:** the same reachability query flags SSRF / taint→egress (untrusted source → network sink,
unvalidated), and is the engine RD-0167's unsigned-index check plugs into.

## How the graph is used
Verdict is a **Kleene trit** (DENY −1 / INDET 0 / ALLOW +1); the four sub-checks AND-fold via `minTrit` so **only +1
authorizes** — reusing the K3 calculus (`galerina-three-valued-governance.md`, `collapse(0)=deny`, `SPORE-GOV-3VL-001`).
Taint **originates only at `source`-role nodes** (a transform inherits taint via edges — re-originating from tagged
transforms spuriously fails already-cleared paths; this was the one correctness bug found + fixed in the proof).

## Reuse vs net-new
- **REUSE (~70%):** `Graph<N,E>`/`GraphBuilder`, `bfsReachable`/`bfsPath`/`canReach`, `fixpoint.ts` (production
  linear lattice-fold), `EffectGraph`/`FlowGraph` flags (`hasPii`/`hasAudit`/`hasNetworkOut`), `BoundaryGraph`
  (`trustLevel`, secret-crossing, untrusted-unvalidated — already Req-3/4-shaped), the compiler's
  `TaintType.Cardholder_Data` (already drives `SPORE-PRIVACY-002`), and the existing `PciAuditReport` + K3 machinery.
- **NET-NEW:** the `DataFlowGraph` builder (AST → classified nodes + mitigation-typed edges), the four path-predicate
  checks (`SPORE-PCI-G-000/004/005/006`), and merging graph findings into the existing report. **Additive**, not a
  rewrite — the AST checker keeps the local Req 3.3/3.5/6.x/7/8 lint.

## Trust root (load-bearing ZT result, V7)
The scanner reads its graph **from the `.spore`** (in-passport index / flow-dependency edges, per
[[galerina-rd-0154-0167-tritmesh-mesh-database]] RD-0167). If that graph is **unsigned, an attacker deletes the
PAN→egress edge and the scanner reports PASS on a still-leaking program (FAIL-OPEN)**. Ed25519-covering the graph
makes the tamper fail `verify()` → the gate yields INDETERMINATE, never PASS. The proof runs this attack both ways
with `node:crypto`. **→ the scanner's input graph MUST be signed.**

## Build estimate (~2–3 days)
Day 1 `DataFlowGraph` builder (AST → classified nodes/typed edges, reuse project-graph builders + compiler taint
tags). Day 2 port the four checks to the **linear** `bfsReachable`+`fixpoint` form (replace the PoC's exponential
`allPaths` with per-node accumulation of "encrypt/redact/audit crossed on any path to here"); wire into
`runPciAudit`. Day 3 tests (~15–20, same green bar as the existing 29) + signed-graph input gate + CLI.

> Related: the rules export ([galerina-rules-master-registry.md](galerina-rules-master-registry.md)) found ~350
> `SPORE-*` codes enforced in `src` but undocumented, incl. a `PCI-*` family beyond `001..010` — reconcile when building.

# LogicN ↔ TritMesh — boundary, governance seam, conformance

**What this captures:** the **LogicN-relevant** knowledge from the TritMesh repo
(`C:\wwwprojects\LogicN-TritMesh\TritMesh`, pinned `5db2e17`). TritMesh is a **separate downstream
product** (a trit-native mesh database) that *consumes* LogicN as its governance layer. Per TritMesh's own
design-notes 00/02 — **"separate repos, no merge; no shared crypto substrate; LogicN governs, TritMesh stores
and computes"** — LogicN does **not** absorb TritMesh's product architecture. This doc records only the seam +
conformance that matter to LogicN; the product details stay in the TritMesh repo (catalog: `logicn-rd-absorption-catalog.md`).

> This is the canonical real-world example of **LogicN-as-a-governance-layer for an external host** — the
> inverse of LogicN's own `OrdersDB.insert(...)` host-call pattern: here the host (TritMesh, Rust) calls *into*
> compiled `.lln` governance across the WASM boundary.

## The boundary (TritMesh design-note 00)
- **LogicN** = a governed `flow`+`contract` *language* on commodity CPU/WASM. It **governs**.
- **TritMesh** = a trit-native mesh *database* (MeshQL + ANN/HNSW + `.tmf`/TMX-256 + ML-DSA-65 root sig). It
  **stores and computes**.
- They share design DNA (*separate the hot path from governance/audit*) but **no cryptographic substrate**.
  TMX-256/ML-DSA live entirely in TritMesh's Rust engine; `.lln` never touches a hash primitive — it makes
  *policy* decisions only.
- **Crypto-on-core is inherited, not invented, by TritMesh:** its `research/encryption-on-photonic-substrates.md`
  (2026-06-15) derives the same invariant LogicN already holds as `LLN-SUBSTRATE-001` — no bit-exact crypto on a
  noisy photonic substrate; photonics fits the **ANN layer**, never the cipher/hash/lattice math. (Already in
  LogicN's KB via `logicn-substrate-failure-model.md`, `logicn-substrate-contracts.md`, the `rd-absorbed/` lane
  docs, and `logicn-quantum-resilience-roadmap.md`.)

## The governance seam (TritMesh design-note 02) — PEP/PDP over WASM
```
   MeshQL request (caller, query)
        │
        ▼
 ┌───────────────┐  authorizeRead(caller,q)   ┌─────────────────────────┐
 │ TritMesh (Rust)│ ─────────────────────────► │ .lln  authorizeRead     │  PDP (Policy Decision Point)
 │ query planner  │ ◄───────────────────────── │   → Decision allow/deny/unknown
 └──────┬─────────┘   Decision                  └─────────────────────────┘
        │  collapse_deny(Decision):  Allow→proceed · Deny→refuse · Unknown→refuse (FAIL-CLOSED)
        ▼
 ┌───────────────┐  returnRows(caller,rows)    ┌─────────────────────────┐
 │ execute query │ ─────────────────────────► │ .lln  egress-redaction  │  (protected fields redacted)
 │ (ANN + store) │ ◄───────────────────────── │   → safe rows           │
 └──────┬─────────┘                             └─────────────────────────┘
        ▼  result
```
- TritMesh is the **PEP (Policy Enforcement Point)**; the `.lln` flows are the **PDP**. The engine never invents
  an Allow — it enforces what the PDP returns and **collapses `unknown → deny`** (matches LogicN's deny-by-default).
- Two seam points: **pre-execution authorization** (`authorizeRead`) and **pre-egress redaction** (`returnRows`).
- Mechanism (roadmap): `logicn build governance/*.lln → governance.wasm` (+ signed `.lmanifest`); the engine
  verifies the manifest, loads the module, and calls the governed functions, mapping `Decision → Trit → collapse_deny`.

## Conformance — what LogicN already hosts for TritMesh (CONFORMANCE-FINDINGS, 2026-06-15)
Running `logicn check` against TritMesh `.lln` confirms LogicN can host TritMesh's **governance/policy/data-model**
layer **today**: `enum` + bare variants, `type` records incl. **nested** records, `pure flow` + `if`/`return` +
comparisons, core `Bool/Int/String/Float`, the three-valued `Decision` enum, **`protected` field label + `redact()`**,
**`guarded flow` + `contract { intent effects }` + host call**, and the **governance verifier** firing usefully
(it raised `LLN-GOV-002`: writes-without-declared-audit). What LogicN cannot host is the **byte/packing/crypto**
layer — by design (that is TritMesh's deterministic engine).

## The LogicN-gap findings (TritMesh `logicn-issues/0001–0005`) — status
These were filed against the 2026-06-15 prototype and are **already reconciled** (bridge task 0001 / the 39-agent
audit): most are now **shipped or by-design**, not blockers.

| Issue | Subject | Current LogicN status |
|---|---|---|
| 0001 | no lambda/closures (`map`) | by-design — use named `fn` + `for-in` (shipped) |
| 0002 | no bitwise operators | **by-design / permanent** (engine-side; roadmap `#126` parser-hint only) |
| 0003 | no byte buffers / crypto | crypto is **engine-side** (now the `logicn-ext-tmf` engine: TMX-256/container/KEM-DEM shipped) |
| 0004 | collections & iteration | `for-in` shipped (interpreter); WASM lowering = roadmap `#128` (GAP-4) |
| 0005 | three-valued `Decision` | enum works; verifier-proven collapse = `LLN-GOV-3VL-001` (shipped) |

## See also
`logicn-rd-adoption-2026-06-16.md` · `logicn-rd-absorption-catalog.md` (TritMesh section) · `logicn-tmf-engine.md`
(the `.tmf` engine TritMesh's format inspired) · `logicn-substrate-contracts.md` · `logicn-three-valued-governance.md`.
Product details (MeshQL, ANN, balanced-ternary entity model, `.tmf` product layout) live in the TritMesh repo at `5db2e17`.

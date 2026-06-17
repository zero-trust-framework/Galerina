# LogicN Roadmap — Autonomous Build Queue (2026-06-17)

> Companion to `logicn-roadmap-and-audit-2026-06-17.md` (the %-audit). This doc is the **work
> queue for autonomous mode**, and it encodes the two standing rules the owner set:
>
> 1. **Every item is classified — 🟢 zero-trust-safe to build / 🟡 needs R&D / 🔴 needs owner discussion.**
>    Only 🟢 items are auto-built; 🟡 are dispatched to the R&D bridge; 🔴 are surfaced, never auto-built.
> 2. **Anything that could be understood or improved by R&D is dispatched** rather than guessed.
>
> The classifier *is* the zero-trust governor: an item is 🟢 only if it changes **no enforcement
> authority** (fail-closed defaults, monotone, fully tested, nothing downstream consumes it to relax
> a gate). The moment an item could weaken a gate, launder taint, or alter execution fidelity, it is
> **not** 🟢 — it goes to R&D or the owner.

## Verify state (this session)
- **Graph:** clean — 3,622 nodes / 4,029 edges / 4 manifests / 1,923 files.
- **Tests:** full suite green (re-confirmed this turn; see commit log).
- Shipped this session: Gap-B revocation registry (v0+tamper+v2 pinning), zero-touch key lifecycle, Phase-0 interpreter dead-copy removal (`d005d75`), 0011 resolver parts b+c (`fc88cb8`).

## 🟢 Zero-trust-safe — auto-build queue (in order)
| # | Item | Why it's 🟢 (changes no authority) |
|---|---|---|
| 1 | **0011 (a-config)** — `ProjectConfig.governance: full\|auto\|lean`, default `full`, fail-closed parse (`LLN-CONFIG-GOV-003` on invalid). | Adds a *setting*. Default is the secure pole; nothing consumes it to relax a gate (item e — the consumer — is harness-gated). Mirrors `posture.ts`. Fully testable. |
| 2 | **0011 (a-grammar)** — `contract { governance: ... }` clause in the `.lln` parser → flow contract field. | Additive optional clause; unknown value → error; inherits project default. Changes no enforcement until (e). Conformance/diagnostic-namespace test must stay green. |
| 3 | **0011 (d)** — `governanceMode` per-flow `ProofObligation` + CFG-fingerprint inclusion + `governanceMode` field on the audit record (distinct from `executionTier`). | Adds a *tamper-evident label* of which profile was authorised. Additive to the manifest; strengthens auditability, relaxes nothing. |
| 4 | **LLN-ENTROPY-001/002 + LLN-PCI-\* code allocations** (hub-owned diagnostic registry). | Registry additions only. Care: keep the diagnostic-namespace conformance test green. No runtime behaviour. |
| 5 | **#125 `secure-flow-run`** — `logicn run --governed` over the shipped Tower LOAD→EXEC→ERASE + trap + fuse-loader, + `kill`/`erase` over `TowerRuntime.evict()`. The only buildable slice of the native-tools idea. | Wraps existing gates; changes no enforcement (plumbing/CLI ergonomics). Pending owner go — it's a new *execution* entry point, so confirm scope first. |

## 🟡 R&D-dispatch (understand/verify before any build)
| Job | Question | Status |
|---|---|---|
| **0014 fidelity differential harness** | How to prove a faster tier (WASM / SlottedScope) is byte-identical to the reference walker, fail-closed on divergence — the design + the `lean→WASM` lowering-proof contract. **Unblocks item (e), SlottedScope, governed-path compilation.** | DISPATCHED this turn |
| **0015 mid-compute capability revocation** | Re-evaluate K3 capability mid-run → pre-empt + zeroize a long-running brawn isolate. The one genuinely-unbuilt zero-trust scenario (note 39 residue). | DISPATCHED this turn |
| **0016 contract→test generator** | Synthesise property/security tests from a flow's GIR (K3 matrix, boundary, substrate, fault) + senior-dev standards (TAP/JUnit, seeds, escape-hatch, Contract-Coverage metric). ~80% substrate shipped, generator 0%. Extends the `LLN-GEN-TEST-001..007` paper spec. | DISPATCHED 2026-06-17 |
| **0017 fault-handler grammar** | First-class `on_*_fault` AST/GIR (don't parse today; 0 matches) — prereq for 0016's fault-injection dimension; reconcile with #58. | DISPATCHED 2026-06-17 |
| **0018 capability→control mapping + attestation** | Reverse table (effects/K3 → PCI/SOC2 req IDs) + unified attestation report over the shipped manifest/governance-impact/provenance/PCI-ledger; "app emits its own evidence". ~60% shipped, mapping+reasoning is the gap. | DISPATCHED 2026-06-17 |
| routePrecision lane axis | Thread `contract.substrate.tolerance` into `precision-strategy.ts` RoutingContext (note 38 residue). Small, but touches the substrate model — design-confirm first. | OPEN (logged, not yet dispatched) |
| ~~native POSIX redesign (tail/curl/grep)~~ | **NOT dispatched — track-not-build** (no photonic substrate; THA-162 already rejected; crypto-on-core caps photonic at bulk math). Verdict in `logicn-contract-driven-generation.md`. | CLOSED (settled NO) |

## 🔴 Owner-discuss / gated — never auto-built
| Item | Gate |
|---|---|
| **0011 (e)** — the AOT-`lean`→WASM router (the ~2,129× win) | Behind job 0014's fidelity harness. Touches execution fidelity = a governance boundary. |
| SlottedScope / tryWhileFastPath wiring | Medium-risk scope-representation refactor; same harness gate. |
| `.tmf` engine slices 3–5 (KEM-DEM, signature custody, revocation) | Owner-steer; large build. |
| ffsim quantum worker landing | Owner-gated (out-of-process Tier-3 toxic border). |
| `#149` history-scrub / first public push | Owner-gated. |
| QRNG / QKD hardware | Hardware-gated (photonic perf = theoretical gap). |

## Operating loop (autonomous mode)
For each item: **classify → if 🟢: build → verify (graph + tests) → commit; if 🟡: write a bridge
job; if 🔴: stop and surface.** Run the full suite + graph at every phase boundary. Commit
incrementally. The hard floors (crypto-on-core, K3 gate, secret/PII egress, three-valued border)
are never touched by any item here.

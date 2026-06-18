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
- Shipped this session: Gap-B revocation registry (v0+tamper+v2 pinning), zero-touch key lifecycle, Phase-0 interpreter dead-copy removal (`d005d75`), 0011 resolver parts b+c (`fc88cb8`), 0011 (a-config) (`4261102`), **#125 secure-flow-run `--governed` (`da17cfc`)**.

## ⚑ 2026-06-18 — R&D bridge queue DRAINED
All R&D jobs **0014–0019 + every in-bounds roadmap item are DONE + adversarially verified** (R&D `ef851aa→0d74bf6`, unpushed per #149; handover `LogicN-R-AND-D/_session-bridge/HANDOFF-2026-06-18-auto-run.md`). Absorbed into KB; see [[logicn-rd-queue-drained-2026-06-18]].

**⚑ OWNER DECISIONS 2026-06-18:** #1 **RESOLVED → WASM i32 = the semantic reference tier** (walker conforms; unblocks the 0014 fidelity harness + the lean→WASM router). #2 prep-next; #3/#5 hold for Phase 5; #4 hold (Ed25519-only until ML-DSA-65 custody #34); **#149 DO NOT PUSH until the harness is 100% green under WASM-i32.** **Low-value 🟢 tasks DROPPED per owner** (0011 a-grammar = speculative until the lean→WASM consumer exists; LLN-* code allocations deferred) — budget conserved for the harness. **Now in flight = implement the 0014 fidelity harness + make the walker/bytecode-VM conform to WASM i32** (build order: R&D done-record 0014 §6.3). **Two sub-forks surfaced to owner, awaiting call:** (a) integer overflow = literal-WASM-WRAP vs fail-closed-TRAP (WASM `i32.add` wraps silently — it does NOT trap; hub recommends TRAP); (b) bytecode-VM retroactivity (it's live + already divergent on div0). Tree-walker = PATCH-to-conform, never strip (it's the governed runtime for secure flows, #125).

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

## ⚑ 2026-06-18 — cycle-end status + technical debt
**Shipped this cycle:** 0011(a-config) `4261102` · #125 secure-flow-run `da17cfc` · R&D harvest `1867492` · pipeline-security audit `8559b81` · **0014 conformance — WASM tier now fully fail-closed**: slice 1/3 walker+bytecode trap `cfb72f9`, slice 2/3 WASM emitter checked-arith `6542bae`, item-3 fail-open hardening `8450174`, the audit-caught `1277` fail-open `b01f713`, + the BigInt-mul→fast-path optimization. Suite 49/49 · 4,551. R&D jobs 0021 (conformance verify + harness corpus) + 0022 (gas + zeroize-proof) dispatched.

**Immediate next:** the **0014 fidelity differential harness (slice 3/3)** — THE gate that unblocks the lean→WASM router (~2,129× win) + ExecutionGraph lowering + promotes WASM to a certified runtime tier. R&D 0021 designs its adversarial corpus.

**Technical debt introduced this cycle (honest):**
1. **Tri-tier consistency burden** — the 3 execution tiers (walker/bytecode/WASM) now MUST agree on i32 trap semantics. Today that's held by `i32-arith.ts` (single source of truth) + unit tests + the parallel-agent test updates + manual review — NOT yet by a systematic differential. The 0014 harness is what *locks* this; until it lands, any future arithmetic change must manually update all three tiers + re-verify.
2. **i32-trap perf cost** — overflow checks add ~2-3 i32 ops per add/sub; mul is a magnitude-guarded branch (BigInt only for |operands|>46340); div/rem are native traps (~free). Bounded + the owner-accepted "premium for safety." LogicN's tier ranking is unchanged.
3. **WASM binary growth** — the checked-arith helpers (~6 lines each) are emitted when referenced (deterministic → wasmHash stable).

**Known-bug backlog (from the 5-agent audit):** harness not built (high, in-flight) · lean→WASM unwired + ExecutionGraph NOP stub (high, gated on harness) · ML-DSA-65 #34 (high, owner-gated) · .tmf slices 4-5 (gated on #34) · recursion-depth bound not adversarially tested (medium) · root typecheck not reproducible from clean install (medium, CI/DX) · version.json/SECURITY.md count drift (low, #150) · GateCache/rotation-manager unwired-by-design (low) · #149 history-scrub + first push (owner-gated).

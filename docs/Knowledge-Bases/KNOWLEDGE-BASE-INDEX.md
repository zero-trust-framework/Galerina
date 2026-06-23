# LogicN Core Knowledge Base — Master Navigation Guide & TCB Map

**Version:** 1.1 (2026-06-05)  
**Purpose:** Official index, validation hierarchy, and cross-reference schema for the LogicN language, compiler pipelines, and governed runtime containment model. All implementation work must conform to the specifications mapped here.

---

## 1. Documentation Architecture

```
┌──────────────────────────────────┐
│   architecture-charter.md        │  Layer 0 — Principles
│   "controlled, explainable and   │  (overrides everything below)
│    governable computation"        │
└──────────────┬───────────────────┘
               │ Enforces
               ▼
┌──────────────────────────────────┐
│   logicn-governance-rules.md     │  Layer 1 — Hard Rules
│   28+ numbered rules, LLN codes  │  (governs compiler + runtime)
└──────────┬───────────┬───────────┘
           │           │
           ▼           ▼
┌──────────────────┐  ┌──────────────────────────────┐
│ logicn-           │  │ logicn-contract-              │
│ architecture-     │  │ authoring-guide.md            │
│ patterns.md       │  │                               │
│ 9 patterns        │  │ Syntax reference: contract {} │
│ 2 feature profiles│  │ clauses, invariant, step      │
└────────┬──────────┘  └──────────────────────────────┘
   Layer 2A — Layout    Layer 2B — Syntax Reference
         │
         │ Realized via
         ▼
┌──────────────────────────────────┐
│ logicn-deterministic-runtime-    │  Layer 3 — Physical Runtime
│ containment.md                   │  (DRCM: DSS, DWI, V_DPM)
│ 7-module DRCM architecture       │
└──────────────────────────────────┘
```

---

## 2. Document Inventory

### Core Layer Documents

| Document | Tier | Responsibility | Key Concepts |
|---|---|---|---|
| `architecture-charter.md` | Layer 0: Principles | Absolute invariant axioms. No Rust host deps, pure declarative WASI TCB, security-first. | 12-Category Complete Mediation Model, foundational philosophy |
| `logicn-governance-rules.md` | Layer 1: Hard Rules | 18-category rule registry, 50+ LLN codes with enforce status. LLN-CAP-001, LLN-RES-001, LLN-OBS-001, LLN-IMPORT-001-004, LLN-ACCESS-001-002, LLN-ASSIMILATE-001-003 enforced/planned. Comment syntax. | S/C/E/K/I/M/A/P/EC/ID/AU/LC/T/FG/ST/BF/GT/IM/AC/AS categories |
| `logicn-architecture-patterns.md` | Layer 2A: Layout Patterns | 9 concrete execution topologies, feature profiles, @experimental_profile directive. | drcm_stable_v0 / drcm_core_v1 profiles; patterns 1–9 |
| `logicn-contract-authoring-guide.md` | Layer 2B: Syntax Reference | Official grammar blueprint — contract syntax, policy {} vs domain guard disambiguation. | Three-block structure: contract → policy → body |
| `logicn-contract-clause-reference.md` | Layer 2B: Syntax Reference | Per-clause reference for all contract sub-blocks including resilience/observability/invariant, plus `access {}` Default Deny, `guard {}`, `gate {}`, `import`, `static`, `bitfield`. | Status, syntax, auto-defaults, LLN codes, minimal examples |
| `logicn-tower-native-syntax.md` | Layer 2B: Syntax Reference | Tower-native security primitives §1–§10: `trap`, `governed`, `view()`, `match`, `static`, `bitfield`, `gate`, `access`, `import`, `import plugin`. | WAT output, V_DPM bitmask, Default Deny, assimilation, govComment manifest |
| `logicn-governed-inference-tower.md` | Layer 2B: Syntax Reference | Three-tier AI governance (BitNet/GroqCloud/NVFP4), Promotion Pipeline CLI, `ai {}` contract structure | governance_tier, audit_depth, fallback_approved, .lmanifest engine passport, tasks #118–#124 |
| `logicn-deterministic-runtime-containment.md` | Layer 3: Physical Runtime | DRCM 7-module architecture, 4 locked decisions (DSS/DWI/V_DPM/step). | DSS.wasm, V_DPM 32-bit register, DWI 4MB isolates, fuel injection |

### Security, Governance & Policies

| Document | Purpose |
|---|---|
| `logicn-domain-guard-policies.md` | Static Manifest Clamping — `policy Name {}` external anchor + `[conforms_to: X]` Differential Proof; LLN-GOV-004 |
| `logicn-drcm-phase1-specs.md` | DRCM Phase 1 specs: CAS atomic (#32), key custody (#34), separator injection (#35) |
| `logicn-cbor-manifest-spec.md` | CBOR anatomy (RFC 8949), 9 custom tags 400-408, 5 security controls (depth/duplicates/overflow/canon/type) |
| `logicn-governance-cicd-pipeline.md` | CI/CD governance architecture — change-class gates, manifest signing, future tech (FHE/AI agents/PQS/ZKP) |
| `logicn-resilience-observability-design.md` | resilience {} + observability {} approved design — circuit_breaker, DPM integration, LLN-RES-001/LLN-OBS-001 |
| `logicn-hardened-border.md` | Plugin DMZ "Toxic Border" spec — 5-stage load/execute/erase cycle, LLN-BORDER-001–005 SECURITY_ALERTs, blacklist protocol, `logicn border-check` CLI |
| `logicn-34-offline-key-ceremony-runbook.md` | **#34 unblock runbook** — the offline key ceremony (QRNG/SP-800-90 entropy → `generateHybridGovernanceKeyPair` → offline custody → `signProofGraphHybrid` v2 → rotation/revocation). Signing code already shipped+tested; only gate is the owner's air-gapped ceremony. Also covers #149 re-sign. |
| `logicn-quantum-resistance-posture.md` | **Quantum-resistance decision record** — *resist where reasonable, no hot-path hammering*. **DECISION: KEEP SHA-256** (already quantum-OK; Grover→128-bit). The PQ work is the SIGNATURE: ML-DSA-65/FIPS-204 over the SHA-256 digest (#34, DONE), hybrid w/ Ed25519, per-surface ctx. ML-KEM only if encryption is added. `LLN-CRYPTO-PQ-001` ENFORCED. |
| `logicn-design-stability-and-forward-planning.md` | **Stability charter** — anti-mistake principles (null/ambient-authority/silent-coercion/one-hop-taint/roll-your-own-crypto…), crypto-format **versioning rule** (bump on any format change once keys persist), **provisional-stopgap register** (marker-effect pattern, pipe-encoding), enforcement **escalation plan** (inter-flow warning→error), diagnostic-namespace ownership. |
| `logicn-diagnostic-namespace-ownership.md` | **Diagnostic namespace = a CHECKED invariant.** Canonical registry (compiler-diagnostics.md ∪ governance-rules.md); a conformance test (`diagnostic-namespace.test.mjs`) fails on any NEW emitted LLN-* code that isn't registered or on the shrink-only `PENDING_REGISTRATION` allowlist (65-code baseline at adoption). Mechanism tags + numbering rule. Prevents semantic drift. |
| `logicn-zero-trust-engine.md` | **Concept: LogicN *is* the zero-trust engine** — the Governance Border Gateway / "Toxic Border", 4 mandates (K3 capability gate · substrate validator/crypto-on-core · attestation verifier TMX-256+hybrid · LOAD→TRAP→ERASE zeroize). Settled-design recap of shipped code; residuals = .tmf file-sig (slice 4) + mid-compute revocation. |
| `logicn-key-custody-and-rotation.md` | **Design: key rotation core-vs-ext (2026-06-17).** Verdict SPLIT — core *declares + verifies*, ext (`logicn-ext-secrets-vault`) *executes*. Two core gaps: **#110** (secrets{} rotation policy parsed but credential body dropped at `parser.ts:4114` → not a manifest proof obligation) + the **Key Custody / revocation registry** (enforce `v(k)=Deny if k∈K_revoked`; self-signing, append-only). |
| `../../security/revocations/REV-2026-06.md` | **Key revocation advisory (governance-critical).** Signing key `8eecf4187ebc9341` COMPROMISED (git history `cb5036d`), rotated to `ab46f4c7e2797b9b`; revocation-NOT-history-scrub decision (preserves commit-SHA trust chain). Human mirror of the planned custody registry. |
| `../../THIRD-PARTY-NOTICES.md` | **Third-party license accountability (2026-06-17).** All deps permissive/free (MIT ×21 / Apache-2.0 ×4 / ISC ×2 / BSD-3 ×1); attribution + courtesy source links; no copyleft/cost; argon2 elects Apache-2.0 for the bundled C ref. |

### Research & Engineering Goals

| Document | Purpose |
|---|---|
| `logicn-engineering-goals.md` | **Start here for "what done looks like"** — Goals A/B/C, T-006/007/008 acceptance tests |
| `logicn-fault-tolerance-and-stability.md` | **Fault tolerance & stability reference** (2026-06-21 re-R&D) — defines LogicN + every fail-closed/fail-safe mechanism across the Binary/Hybrid/Photonic Tri-Pipe, with the real maths (K3 `vAnd=min` monotonicity, NMR closed form, Freivalds `≤2⁻ᵏ`, the precision wall `(1−ε)^m→0`) + examples + honest weakest links |
| `logicn-governed-design-synthesis.md` | Deep research: 14-category model, 9 missing categories, change-class workflow |
| `logicn-governed-runtime-research-2026-06-03.md` | 113-agent research: Cedar/OPA/Pony/Austral/Koka/in-toto/W3C-PROV enhancements |
| `logicn-platform-infographic-concept.md` | "Governed Tower" poster concept — 5-floor building layout; render when DRCM Phase 2+5 complete |
| `logicn-photonic-tri-substrate-rd-agenda.md` | **R&D agenda** — LogicN as the *governance/verification layer* for emerging photonic/ternary substrates (NOT hardware/crypto). 3 directions: (A) three-valued allow/deny/unknown logic proved fail-closed, (B) substrate-tolerance + crypto-on-deterministic-core contracts, (C) substrate failure-mode model in the verifier. KB-first. Provenance: `notes/31–33` (TMX-256 boundary). **Direction A now spiked → next row.** |
| `logicn-tpl-bitnet-fidelity-audit.md` | **Verification record (2026-06-15)** — read-only audit confirming `tpl-simulator.ts` is byte-compatible with Microsoft BitNet's I2_S ternary kernel (`ggml-bitnet-mad.cpp`, MIT). All 4 claims backed by quoted `file:line`: encoding `00=-1·01=0·10=+1·11=ILLEGAL` ✅ exact, packing `(q0<<6)\|(q1<<4)\|(q2<<2)\|(q3<<0)` ✅ exact, T-MAC add/sub/skip ✅ (BitNet's SIMD `maddubs`-on-biased-encoding differs but is non-affecting), scale `i2_scale=max\|w\|` post-accum ✅. **This is the foundation Directions A & C sit on** — proves the trit the `Verdict` calculus and noise model reason about is the genuine BitNet trit. Pinned by golden-vector test `tower-citizen/tests/tpl-bitnet-fidelity.test.mjs`. No BitNet code copied; core stays TS. |
| `logicn-three-valued-governance.md` | **Direction A spike (done) — sub-spec + impl.** Three-valued governance verdict (`ALLOW +1 / DENY -1 / INDETERMINATE 0`), Kleene K3 calculus reusing `tpl-simulator`'s `minTrit`(∧)/`maxTrit`(∨)/`negTrit`(¬) — confirmed an exact K3 match, no semantics changed. Collapse rule at the trust boundary (`0,-1 → deny`), **proved fail-closed**: `authorize(v) ⇔ v=+1` plus a no-coercion theorem (`0` never becomes `+1` in composition), both pinned as exhaustive tests. Diagnostic `LLN-GOV-3VL-001` (indeterminate→deny, audited, never silent). Module: `logicn-tower-citizen/src/three-valued-governance.ts`. **C now spiked → next row;** B is the follow-up. |
| `logicn-substrate-failure-model.md` | **Direction C spike — sub-spec + impl.** Seeded **software** substrate failure-mode model (phase-drift / crosstalk / lane-failure / readout noise) extending the ternary stack as a NEW sibling `logicn-tower-citizen/src/substrate-model.ts` (`tpl-simulator` untouched). Canonical guarantee-check is **closed-form** von Neumann NMR (`nmrFailureProbability`), Monte-Carlo `NoisyLane` only cross-checks it. **Central result:** `effectiveVerdict = vAnd(ideal, reading)` ⇒ substrate noise can cost **availability, never safety** (no failure mode manufactures an ALLOW — inherits Direction A No-Coercion); proved exhaustively. Diagnostics `LLN-SUBSTRATE-001..004` (crypto-on-noisy / tolerance-unachievable / redundancy-insufficient / unvoted-into-deterministic). Raising TMR (`consensusTrit`) clears `-002` monotonically. Compiler/`substrate{}`-grammar wiring deferred to Direction B → next row. |
| `logicn-substrate-contracts.md` | **Direction B spike — sub-spec.** The `substrate { lane; tolerance; redundancy }` **contract block** (optional, peer to `resilience {}`/`observability {}`) + a `verifySubstrate()`/`substrate-inference.ts` pass in `logicn-core-compiler` enforcing **B1** crypto-on-noisy-lane (`LLN-SUBSTRATE-001`), **B2** redundancy sufficiency vs the Direction-C model (`-002` warn-dev/err-prod, `-003` always-err), **B3** unvoted-analog-into-deterministic (`-004`). Reuses the codes Direction C registered. Math-home: the pure NMR functions now live in the shared zero-dep package **`@logicn/substrate-math`** (extracted 2026-06-15; both tower-citizen + compiler depend on it — single source of truth, no copy/drift); the compiler's `substrate-math.ts` is a thin re-export, tower-citizen keeps `SubstrateParamError` validation wrappers. Safety inherited from Direction A `vAnd` (not re-proved). No-regression: flows without `substrate{}` are inert. Plus the **B3 safety-clause sink** (`safety{require deterministic_execution}` → determinism sink any profile) and a language-wide **lexer scientific-notation** fix (the review-caught fail-open blocker). |
| `logicn-ext-bridge-quantum-design.md` | 🟢 **PHASE 0/1.5 IMPLEMENTED (2026-06-15).** Package `logicn-ext-bridge-quantum` exists in the suite (21 tests); governance core + hybrid Ed25519+ML-DSA-65 attestation shipped; only out-of-process EXEC + venv sandbox (Phase 2) remains. Spec for `@logicn/ext-bridge-quantum` — a governed, **out-of-process** bridge wrapping IBM **`ffsim`** (fermionic quantum-chemistry sim, Apache-2.0) as a Tier-3 untrusted backend. *Govern it, don't absorb it:* no ffsim math reimplemented, ffsim's Rust stays out-of-process. New job-oriented `QuantumSimBackend` contract (not the ternary `InferenceBridge`); `quantum {}` contract sub-block (analog of `ai {}`); the **subspace-dim governor** `C(norb,nα)·C(norb,nβ)` as the real memory ceiling; **tolerance-determinism** (never bit-exact) needing an additive manifest extension; full Toxic Border + CF-3/CF-7 attestation reuse. **All 7 decisions RATIFIED 2026-06-15:** tolerance-certified iff 3 pins + fail-closed; crypto-exclusion = `LLN-SUBSTRATE-001` by declaring `lane: noisy` (reuses the shipped `verifySubstrate` — `logicn-substrate-contracts.md`); receipt signs SHA-256 on the deterministic core. Opens with a §2 correcting `notes/33`'s ffsim↔ternary/NTT/BitNet/MeshQL conflations. |
| `logicn-tmf-engine.md` | 🏗️ **IN PROGRESS (Phase 2, #6) — authoritative in-KB home for the `.tmf` engine** (`packages-logicn/logicn-ext-tmf`, an **ext** package, owner-authorized 2026-06-16). The deterministic integrity/authenticity/confidentiality layer LogicN *governs*: TMX-256 (3-ary SHAKE256 tree, root binds `header_core`), §6 fail-closed `.tmf` container, hybrid Ed25519+ML-DSA-65 signing, ML-KEM-768 KEM-DEM. **Crypto-on-core (`LLN-SUBSTRATE-001`)** — no photonic crypto. Slices 1–2 ✅ shipped (golden-verified), 3 (KEM-DEM) next. Implemented-slice specs vendored into the package `spec/` (R&D pin `fb68d06`). Core boundary intact (ext ≠ core). |
| `logicn-rd-adoption-2026-06-16.md` | **Govern-don't-absorb ledger** for the `.tmf` / tri-encryption R&D — what LogicN USES NOW (U1 verify-before-decrypt gate ✅, U2 no-cleartext-embedding, U3/U4) vs R&D-only/gated. Updated 2026-06-16: the `.tmf` engine is now in-repo as an ext package (see `logicn-tmf-engine.md`); other R&D-only items stand. |
| `logicn-benchmark-scoreboard-standard.md` | **Benchmark scoreboard RULE** (owner 2026-06-23) — the canonical format every scoreboard must use, ENFORCED by `npm run compare` §1.5: production-ceiling winner (the 3 `⟨interp⟩` diagnostic tiers can't win), winner-ordered, LogicN `WASM▶prod rank·×slower` + `gov ×slower`, tally + no-silent-caps excluded/no-data lists. Don't hand-roll — quote §1.5. |
| `logicn-rd-absorption-catalog.md` | **The complete R&D→KB ledger** (LogicN is the single main library). All 49 R&D knowledge docs accounted for: specs vendored to `logicn-ext-tmf/spec/`, 29 docs mirrored verbatim into `rd-absorbed/`, 19 catalog-only (with their KB-absent facts preserved in Appendix A — incl. the measured crypto benchmark table, golden-file sizes, ffsim goldens). Standing rule: memory `feedback-auto-import-rd-docs`. |
| `logicn-quantum-resilience-roadmap.md` | **Quantum-resilience standard & roadmap (L0–L4)** — curated from the R&D standard + `notes/36-qtcripto`. The resilience ladder (L1/L2 today → L3 target), ITS-primitive conditions (OTP/QKD/QDS/QRNG), photonic lanes A–E (A & photonic-primitive REJECTED, B/C track, D buildable, E proposed), the `KDF(K_pqc‖K_qkd)` combiner, Q0–Q4 roadmap, will-not-do list, and the NSA/NCSC/BSI/ANSSI "PQC-primary, QKD-niche" consensus. Builds on `logicn-quantum-resistance-posture.md`. |
| `logicn-qrng-entropy-capability-design.md` | 🔵 **DESIGN-ONLY (roadmap Q1, Lane D).** Governed interface for a QRNG entropy capability: SP 800-90B health (RCT/APT) → 90A DRBG → key/nonce schedule, behind the LogicN boundary. Capability `entropy.qrng`, **fail-closed** (`unknown → deny`, no silent CSPRNG fallback); candidate diagnostics `LLN-ENTROPY-001/002`. Crypto-on-core: QRNG is a *source*, never a primitive; never raw bits → key. No hardware/code yet; grounding survey = R&D task 0005. |
| `logicn-tritmesh-boundary-and-seam.md` | **LogicN ↔ TritMesh boundary** — captures the LogicN-relevant knowledge from the TritMesh product repo (`5db2e17`): the separation (LogicN governs, TritMesh stores/computes; no shared crypto), the **PEP/PDP governance seam** (`.lln`→WASM `authorizeRead`/`returnRows`, `unknown→deny`), the conformance findings (LogicN hosts TritMesh's governance layer today), and the reconciled LogicN-gap issues. TritMesh product details stay in their repo (catalog §4). |
| `logicn-rd-performance-and-boundary-opportunities.md` | **Analysis (2026-06-17)** — can the absorbed R&D improve LogicN perf / boundary / memory? Verdicts: **no governance-hot-path speedup** (R&D gives a crypto cost-model + guardrails + an ext AI-lane); **real boundary wins** (committing-AEAD/verify-before-decrypt, no-cleartext-embedding, QRNG entropy, PEP/PDP seam, threshold custody); **memory security yes** (crypto-erasure, key-zeroization), **efficiency mostly no** (density tricks are data-plane; pursue `#127`). |

### Build & Roadmap

| Document | Purpose |
|---|---|
| `logicn-checkpoint-2026-06-06.md` | **Latest full checkpoint** — verified tests (44/44, 4,171), audit (auth-service 31/31 clean), benchmark baseline, %-audit, roadmap, + design decisions (OS/HW `off\|auto\|on` #195, GateCache #194, ternary XOR #196, Zig-ready #197). *(historical 2026-06-06 snapshot — for CURRENT status see `logicn-roadmap-and-percent-audit-2026-06-21.md`, 53/53 · 4,989)* |
| `logicn-roadmap.md` | Forward roadmap — P9 byte-parity ✅ (tokenize), parity-extension cluster, security remediation, Post-P9 |
| `logicn-task-ledger.md` | Task ledger #1–#197 + code-area reverse index; landed-batch log |
| `logicn-techdebt-gaps-review.md` | P9 post-parity tech-debt review — 50 verified findings → tasks #161–#193 |
| `logicn-build-roadmap.md` | Build roadmap v6.0 — Phases 1–3 ✅, DRCM Phases 1–4 ✅, Tower-native v2.1 (tasks #86–#94) ✅ |
| `logicn-roadmap-and-audit-2026-06-17.md` | **SUPERSEDED 2026-06-21 → `logicn-roadmap-and-percent-audit-2026-06-21.md` (53/53 · 4,989) is the current READ-FOR-STATUS doc.** Historical snapshot: 49/49 · 4,518; senior-dev audit P0/P1/P2 remediation list; performance review (interpreter is slowest tier → route to WASM + `governance: auto`); R&D queue 0006–0012; reopen-triage outcome. |
| `logicn-engineering-goals.md` | Three architectural goals with acceptance tests |
| `logicn-continuation-brief-2026-06-15.md` | **READ-FIRST continuation/handoff brief** — recent-work inventory, build/test cheatsheet, GateCache finding (built-but-unwired class), open items, and the audit scope (steps 6/8/10 + wiring/dead-code hunt). |
| `logicn-framework-layer-design.md` | **Framework-layer scope decision** — one secure App Kernel boundary + many protocol adapters (REST now; SOAP/gRPC/GraphQL later); "no middleware" = fixed kernel pipeline; build order P1–P6 (P1/B2/B3 DONE); explicitly excludes notes' Citadel/photonic/Zig/middleware-fusion material |
| `logicn-framework-api-server-v02.md` / `…-implementation.md` | Detailed REST/HTTP transport spec (v0.2) consumed by the framework layer's P2 |
| `logicn-wasmtime-baseline.md` | Benchmark baseline: governance-cost 3.2K/s → 1.88M/s after WASM. *Context (2026-06-17): this is Stage-A tree-walker → WASM tier, NOT a "beats Python" claim; see `logicn-roadmap-and-audit-2026-06-17.md` §4 for the corrected cross-language hierarchy (interpreter is below Python; WASM is native-class).* |
| `logicn-roadmap-2026-06-23.md` | **CURRENT ROADMAP (security-first)** — security issues first; NEAR/MID/LONG; missing/stub packages = consider-not-always. Rebuilt 2026-06-23. |
| `logicn-roadmap-and-percent-audit-2026-06-23.md` | **CURRENT %-AUDIT doc** — 53/53 · 5,042 · ~76%; weighted %-audit (supersedes the 2026-06-21/-22 audits). Roadmap portion superseded by `logicn-roadmap-2026-06-23.md`. |
| `logicn-outstanding-rd-and-todos-2026-06-23.md` | Single source of truth for everything outstanding — R&D gaps, designed-but-unbuilt, build items, missing/incomplete packages. |
| `logicn-rd-results-log.md` | **R&D verdict quick-lookup** — adopted / designed / tracked / **refuted (with reasons)** / pending / gated; append a row per `done/NNNN-*`. |
| `logicn-paper-worthiness-assessment-2026-06-23.md` | **Full-corpus paper-worthiness refresh** (wf `w4zqo3nu8`) — **0 flagship / 0 workshop / 9 defensive-pub**; all ~22 candidates re-derive cited prior art (Kleene/Belnap/Bruns-Huth, Zdancewic-Myers robust-declassification, von-Neumann NMR, simdjson, Zhang-Sanchez memoization-net-negative, Marr "Are We Fast Yet?"). Strongest = benchmark unit-truth (still defensive-pub). **EXTENDED 2026-06-23 (wf `w3krivzqf`)** over the 6 new delta clusters → **0 flagship / 0 workshop / 3 defensive-pub / 3 none**; `t-as-signed-artifact` downgraded defensive-pub→none (CommitLLM/VeriLLM already ship the signed-commitment-vs-Freivalds split). 0-flagship strategy quadruple-confirmed. |
| `logicn-rd-notes-46-47-50-51-apiserver-lln-2026-06-23.md` | R&D batch (wf `wg7f09b67`): notes 46/47/50/51 + blueprint PDF + `//lln:` cache-chain + api-server completeness; ~85% re-derive; net-new = affine/type-state authority (#0087) · signed flow-graph+GIR compile-cache (#0088) · api-server TLS mapper (#0089). |
| `logicn-pci-dss-evidence-mapping.md` | **HONEST** PCI DSS v4.0 → LogicN-artifact compliance-evidence map (6.4.3/3.4/11.3.4/10.2-3); grades each by what is ENFORCED vs ⚠ aspirational (WASI isolation #102-106) vs 🔑 placeholder (PQ signing #34); discloses the 7/12 checker gap. Corrects the blueprint PDF's over-claim. |
| `logicn-architecture-rd-2026-06-23.md` | Forward architecture R&D — zero-trust · best-tech · photonic-tri · Tri-Pipe + tower-citizen integration; 16-item prioritised build ladder. |
| `logicn-compiler-intelligence-deterministic-foresight.md` | Owner R&D Doc 005 — deterministic compiler intelligence + Tri-Pipe routing; mapped against shipped code (verify-before-build); ~85% of routing maths = shipped substrate-inference/substrate-math. |
| `logicn-contract-invariant-module-wide-rd.md` | R&D on module-wide `contract.invariant{}` (note 45) — promote `invariant{}` from flow-scope to module-scope; intuition verdict + build assessment. |
| `logicn-external-idea-mining-2026-06-23.md` | External idea-mining re-pass over `C:\wwwprojects\x` (12 OSS repos) for governance-layer ideas; ranked, verify-before-build. |
| `logicn-rd-53-azt-selfcert-and-blackhole-protocol-2026-06-23.md` | **notes/53 R&D** (wf `wrkp9iwjt`) — AZT Self-Certification (`.lproof` PCC) + the Black-Hole data-destruction protocol; ~80% re-derives shipped (cap-confinement ZT10, K3 −1 DENY ZT10, Stage-A/B parity, exhaustiveness+DbC, arena `memory.fill(0)`, single-node crypto-shred, PCI 7/12). NET-NEW = .lproof-as-wasm-custom-section · runtime epoch-attestation watchdog · mesh crypto-shred cascade (DoS-amp — gate on revocation registry) · neuro-symbolic SLM auditor · intrusion-triggered arena fill (all #102-106/#34-gated). REFUTE = quantum-evaporation-as-security + QBER trigger (crypto-on-noisy). **NO military terminology** (4 substitutions). Renames TritMesh "Tri-Pipe Substrate Router" → **"Substrate Dispatch Gateway"** (TritMesh-side only; LogicN's shipped Tri-Pipe untouched). |
| `logicn-rd-flow-kind-tier-inference-2026-06-23.md` | **Flow-kind tier inference R&D** (wf `w2roo2p7h`, ZT 9.2, defensive-pub) — owner idea: infer the governance tier from the effect footprint instead of hand-declaring. Compiler today enforces "declared effects ⊇ body effects" but NOT "declared tier ⊇ inferred-minimum tier" → a `guarded flow` doing `http.post` silently skips ALL secure-only obligations (GOV-010/006). NET-NEW = effect→tier lattice + ONE fail-closed escalate-only floor check (`LLN-TIER-001`) + implement the dead `LLN-DAG-002` + //lln propose-into-`//@`; compile-time not runtime. Build M, owner-gated. |
| `logicn-rd-tritmesh-1-5-and-52-3d-2026-06-23.md` | **TritMesh notes 1-6 + 52-3D-1/2 → LogicN** (wf `we2yovu53`, 52 heads: 26 shipped · 11 TritMesh-only · 7 track · 5 refuted · **3 net-new**). The "Tri-Pipe Router" = the shipped ExecutionRouter/PartitionDecider/photonic-switch (≠ LogicN Tri-Pipe lanes). Net-new, all invariant-safe: (1) telemetry→K3 degrade-only feedback loop [S]; (2) K3 ternary partial-return `Result.Masked` per-field shaper [M]; (3) EMERGENT T-as-signed-artifact admission (Freivalds verifies the result, not that T is the admitted matrix) [M, HW-gated #102-106]. O(1)-matmul/Grover/superdense-drop-MAC REFUTED. |
| `logicn-coverage-audit-zerotrust-tripipe-2026-06-23.md` | **Ground-up coverage audit** (wf `wzgahdkzc`, 95 parts) — ZT 52cov/32gap/11na · photonic-Tri 25cov/13gap/57na; runtime trust-boundary + photonic hub well-covered, GAPs cluster in host-side auditors (parse-fail→PASS) and the compiler lowering/IR/plan layer (zero photonic lens); 5 LIVE fail-opens flagged (value-state 34B-hole live; wat-emitter #163 already-fixed/#165 narrowed by hub verify; snarkjs placeholder receipt; core-cli regex redactor; registry unsigned stubs). R&D jobs **0093–0100** dispatched. |
| `logicn-contract-permissions-design.md` | **Layer 2B Syntax (DESIGN, net-new)** — `contract.permissions { hardware.camera }` device-grant clause (V_PERM + LLN-PERM-001..006, fail-closed). |

### Supporting Reference

| Document | Purpose |
|---|---|
| `logicn-design-secrets-epilogue-blocks.md` | secrets {} + epilogue {} — auto-by-default, vault/KMS rotation, taint guard |
| `logicn-contract-economics.md` | economics {} — CostGraph/ValueGraph auto-inference |
| `logicn-domain-guard-policies.md` | Domain guard: policy Name {} as external anchor, [conforms_to:] decorator |
| `secure-by-default-syntax-principles.md` | 12 syntax-level security principles |
| `capabilities.md` | Capability model — effects vs capabilities, structured descriptors |
| `logicn-runtime-component-structure.md` | Mermaid diagrams — package ecosystem, compiler pipeline, execution tiers |

---

## 3. Order of Precedence & Conflict Resolution

When any ambiguity or structural conflict is identified across KB documents during compilation, static analysis, or authoring:

**Tier 1 — Architecture Charter** overrides all downstream documents.
- If a pattern or code block implies a custom native host FFI extension: rejected per the *No Rust Guest-Side Bypass* principle.
- If a rule contradicts a charter axiom: the charter wins.

**Tier 2 — Governance Rules** dictate compiler diagnostic behavior.
- If the Contract Authoring Guide permits a syntax layout that violates a numbered rule in `logicn-governance-rules.md`: the rule takes precedence and the compiler emits a hard build fault.
- LLN diagnostic codes are authoritative. The rule document is the single source of truth for what each code means.

**Tier 3 — Design Reference Guides** (patterns + contract authoring guide) describe syntactic intent.
- They must map exactly onto the physical sandbox constraints of the runtime-containment doc.
- If a pattern shows syntax that contradicts the DRCM model: the DRCM model wins.

---

## 4. Feature Gate Manifest

| Profile | Description | Patterns | Compiles today? |
|---|---|---|---|
| `drcm_stable_v0` | Fully enforced by Stage A compiler | 1, 2, 3, 5 (and stable portions of 4, 6) | ✅ Yes |
| `drcm_core_v1` | Forward-looking — requires `@experimental_profile` wrapper | 4 (step), 7, 8, 9 | ⚠️ Parsed, verification skipped |

**Wrapping syntax:**
```lln
@experimental_profile(name: "drcm_core_v1", status: "planned_phase_5") {
  ;; ... forward-looking DRCM syntax here ...
  let result = step external_api::call(payload)
}
```

**Compiler behavior:**
- `--release`: `@experimental_profile` blocks parsed, verification skipped, grammar validated
- `--enable-experimental-profile=drcm_core_v1`: full verification and WAT gate injection active
- Bare `step` in `--release` without wrapper: `LLN-DRCM-UNSUPPORTED`
- Under `drcm_core_v1`: bare `step` is AST-rewritten to `security::interim::BoundaryProxy`

**Graduation path:** When a DRCM phase ships, remove the `@experimental_profile(...)` wrapper. The inner syntax is already correct — no source rewriting needed. Recompile and fix any new static proof errors.

---

## 5. 12-Category Complete Mediation Model

From `notes/17-contact components` (2026-06-04). Every high-trust `.lln` module must be mediated across all 12 categories:

| # | Category | Language Primitive | Rule Category |
|---|---|---|---|
| 1 | Syntax | `types {}`, `flow`, `step` | S-xxx |
| 2 | Contract | `intent {}`, `invariant {}` | C-xxx |
| 3 | Effect | `effects {}` | E-xxx |
| 4 | Capability | `authority {}`, `targets {}` | K-xxx |
| 5 | Isolation | `limits {}` | I-xxx |
| 6 | Monotonic | *(implicit — V_DPM)* | M-xxx |
| 7 | AI Authoring | *(implicit — app.ai-guide.md)* | A-xxx |
| 8 | Process | `request {}`, `response {}` | P-xxx |
| 9 | Economics 🌟 | `economics {}` | EC-xxx |
| 10 | Identity 🌟 | `.lmanifest`, ML-DSA-65 | ID-xxx |
| 11 | Auditability 🌟 | `privacy {}`, `secrets {}`, `audit {}` | AU-xxx |
| 12 | Lifecycle 🌟 | *(policy — contract versioning)* | LC-xxx |

🌟 = DRCM Phase 3+ (Economics partially enforced today via economics-inference.ts)

---

## 6. Implementation Task Map

### ✅ Complete

| Tasks | Description |
|---|---|
| #30–#35 | DRCM Phase 1 — all 5 security fixes (wildcard ban, prefix scanner, CAS spec, .lmanifest, key custody spec, separator spec) |
| #45–#62 | Phases 1–3 — compiler quality, language features, docs, CI/CD (all complete) |

### 🟡 Open — Next Build Targets

| Task | Description | Priority |
|---|---|---|
| **#36** | DRCM Phase 2 — `invariant {}` parser + WAT gate injection | **Next** |
| **#63** | `governance-impact.json` artifact per build/PR | High |
| **#64** | `logicn check --diff` — local dry run change-class | High |
| **#65** | `logicn init-env` — root policy validation | Medium |
| **#66** | LLN-OBS-002: observability cannot access privacy scope | Medium |
| **#67** | Binary CBOR encoder for .lmanifest (RFC 8949) | DRCM Phase 3 gate |
| **#68** | Hardened CBOR parser for DSS.wasm | DRCM Phase 5 gate |

### ⬜ DRCM Phases 3–7 (future)

| Tasks | Description |
|---|---|
| #37 | DRCM Phase 3 — .lmanifest admission gate |
| #38–#39 | DRCM Phase 4 — Structured capabilities + policy {} |
| #40–#41 | DRCM Phase 5 — step keyword + DSS supervisor |
| #42 | DRCM Phase 6 — Epilogue Receipt |
| #43–#44 | DRCM Phase 7 — Negative tests + OS Layer 2 |

---

## 7. Negative Test Strategy Anchor

The Phase 7 negative test suite uses this index to auto-discover cross-document validation requirements:

1. Every `LLN-xxx` code in the registry → must have a test in `tests/negative/`
2. Every pattern in `logicn-architecture-patterns.md` → must have a positive test in `tests/patterns/`
3. Every `@experimental_profile(drcm_core_v1)` block in examples → must have a test confirming it parses cleanly under `--release` and fully verifies under `--enable-experimental-profile=drcm_core_v1`

---

## 8. AI Tool Instructions

When an AI tool is generating LogicN code for this project:

1. **Check this index first** — determine which layer governs the code being written
2. **Check the rules doc** — find the applicable LLN codes and their enforcement status
3. **Choose the right pattern** — use the Quick Selector in `logicn-architecture-patterns.md`
4. **Use the contract authoring guide** — for the correct `contract {}` clause structure
5. **Wrap forward-looking syntax** — use `@experimental_profile(name: "drcm_core_v1", ...)` for any DRCM Phase 2+ syntax
6. **Never self-grant capabilities** — all authority/effects widening must go through the propose → verify → approve pipeline (rule C-005)
7. **Always include `intent {}`** on secure/governed flows — rule A-001

---

## 9. Quick Reference: Which file answers which question?

| Question | Answer in |
|---|---|
| What are the project's core principles? | `architecture-charter.md` |
| What rule governs X? What LLN code fires? | `logicn-governance-rules.md` |
| How do I structure this type of flow? | `logicn-architecture-patterns.md` |
| What goes in a `contract {}` block? | `logicn-contract-authoring-guide.md` |
| How does the DRCM work? DSS, DWI, V_DPM? | `logicn-deterministic-runtime-containment.md` |
| Can I write `step` / `invariant` today? | `logicn-architecture-patterns.md` (Feature Profile Reference) |
| How do `secrets {}` and `epilogue {}` work? | `logicn-design-secrets-epilogue-blocks.md` |
| How is `economics {}` auto-inferred? | `logicn-contract-economics.md` |
| What did the governed runtime research find? | `logicn-governed-runtime-research-2026-06-03.md` |

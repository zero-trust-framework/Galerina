# R&D — TritMesh notes 1-5 + 52-3D (for LogicN) (2026-06-23)

## Bottom line

Across 7 per-note surveys and 2 combination passes (tritmesh-1..6, 52-3D-1/2), **~85-90% of every head RE-DERIVES already-shipped LogicN substrate/governance work**, exactly as VERIFY-BEFORE-BUILD predicted. The notes are a single chained TritMesh brainstorm: a substrate-routing gateway ("Tri-Pipe Substrate Router" = R&D-007 / note 6), a MeshQL/.tmf product ecosystem (notes 1-5), and a photonic/ternary physics tutorial (52-3D-1/2).

After deduping, **three genuinely net-new LogicN governance mechanics** survive scrutiny, all small, all invariant-safe, all TRACK-or-build-on-shipped-rails:

1. **Degrade-only telemetry → K3 admission feedback loop** (tritmesh-4 §3) — the strongest. Both halves ship; the closed runtime loop does not.
2. **Governed Transformation-Matrix admission (T-as-signed-artifact)** — EMERGENT only when 52-3D-1 ("geometry = code") composes with 52-3D-2 (".tmf governs the reprogram blob"). Freivalds verifies the *result*; nothing admits T-the-matrix as signed code.
3. **K3 ternary partial-return / per-branch `Result.Masked` response shaping** (trittmesh-5) — masking is binary-only today (redact/seal/reject); no three-valued keep-the-rest response shaper.

Everything else is ALREADY-SHIPPED (cite below), REFUTED physics (O(1) matmul, Grover line-rate, superdense "drop the MAC"), or TRITMESH-ONLY product surface (MeshQL, .tmf passport, 5-product suite, Any-Sync mesh). **All invariants hold:** crypto stays Binary, photonic is degrade-only with projected-not-measured perf, no crypto-on-photonic, K3-0 is fail-safe-only.

## The Tri-Pipe-Router vs LogicN-Tri-Pipe distinction (read this first)

The task name conflates two same-named things:

- **The notes' "Tri-Pipe Substrate Router"** (R&D-007 / tritmesh-6) is a *physics-aware routing GATEWAY* across Binary-silicon (S_B) / Hybrid-accelerator (S_H) / Photonic-quantum (S_P).
- **LogicN's shipped "Tri-Pipe"** is `logicn-tri-pipe/src/execution-router.ts` (`ExecutionRouter.route` + `createTriPipeEngine`) — a 3-axis composition (AXIS-1 capability tier via `resolveHardware`, AXIS-2 `routePrecision`, AXIS-3 `PartitionDecider` net-win gate).

These are **the same thing**: the notes' R(o) re-derives `ExecutionRouter.route` 1:1. Every router mechanic in the notes is shipped — routing function, `R(D_crypto)→S_B` (= LLN-SUBSTRATE-001, `partition-decider.ts:112`), `E_route = min(cap,avail)` (= `vAnd`/`allOf`), the analog→trit discretization gate (= `decideAtBoundary` + `effectiveVerdict=vAnd` + `freivalds.ts` tolerance re-verify + `photonic-bridge.ts:99` 0b11 corrupt-trit trap), and the Tower-Citizen sim/hw hot-swap (= `photonic-switch.ts selectPhotonicBackend`, fail-closed, attested-only). **Nothing in the router itself is a new mechanic.**

## Per-head verdict table

| Head | Source | Verdict | LogicN use | photonic/tri | Invariant |
|---|---|---|---|---|---|
| Type-system partitioning (Tri primitive + K3) | tm-1 | ALREADY-SHIPPED | governance verdict lattice (three-valued-governance.ts) | core tri primitive | PASS |
| Float-as-gate prohibition (f64→K3) | tm-1 | ALREADY-SHIPPED | LLN-SUBSTRATE-004 + f64-not-a-gate | analog→trit safety boundary | PASS |
| Secret primitive + Brand/SealTaint zero-wipe | tm-1 | ALREADY-SHIPPED | R&D 0055 B2b + LLN-PRIVACY-002 | n/a (digital) | PASS |
| Pointer prohibition + SoA bump-arena | tm-1 | ALREADY-SHIPPED | wat-emitter arena (R&D 0055) | n/a | PASS |
| Composite types (Record/Enum/Option/Result/Tensor) | tm-1 | ALREADY-SHIPPED | shipped type system | n/a | PASS |
| Three expansion guardrails (crypto-Binary/No-Coercion/passport) | tm-1 | ALREADY-SHIPPED | standing invariants | No-Coercion safety basis | PASS |
| Nested-record SoA auto-flatten vs single-level | tm-1 | TRITMESH-ONLY | TritMeshQL stub only | n/a | PASS (vacuous) |
| Tri-Pipe Router — 3-pipe taxonomy S_B/S_H/S_P | tm-1,2,3,4,5,6,combo | ALREADY-SHIPPED | SubstrateLane + LANE_PROFILES + Tier | photonic lane taxonomy | PASS |
| Tri-Pipe Router — R(o) + crypto→S_B denial | tm-1,2,3,4,5,6,combo | ALREADY-SHIPPED | ExecutionRouter + PartitionDecider | routing safety core | PASS |
| Tri-Pipe Router — K3 routing conj min(cap,hw) | tm-1,2,3,4,5,6,combo | ALREADY-SHIPPED | vAnd/allOf + fail-closed-to-digital | K3-0 = fail-safe fallback | PASS |
| Tri-Pipe Router — Tower-Citizen sim/hw hot-swap | tm-1,2,3,4,5,6,combo | ALREADY-SHIPPED | photonic-switch.ts + emulator | sim-now/hw-later | PASS |
| Tri-Pipe Router — I/O discretization (v_a→trit, 0=trap) | tm-1,2,3,4,5,6,combo | ALREADY-SHIPPED | substrate-model NoisyLane + freivalds | photonic readout boundary | PASS |
| Tri-Pipe Router — retry-vs-trap on 0 state | tm-1,4,6 | TRACK | substrate{} on_indeterminate knob (default trap) | photonic dead-zone disposition | PASS-by-design |
| Photonic O(1) matmul + Grover line-rate | tm-1,2,3,4,6,52-3D | REFUTE | none — aspirational only | perf-claim boundary | PASS (by refusing) |
| MeshQL — query-as-capability-contract | tm-2,5,combo | TRITMESH-ONLY | typed-AST seam only | n/a (digital) | PASS |
| MeshQL — ternary result set (governed iterator) | tm-2 | ALREADY-SHIPPED | allOf/decideAtBoundary | K3-0 fail-safe withhold | PASS |
| MeshQL — named Masked-vs-Trapped distinction | tm-2 | TRACK | expose 0 vs -1 on row results | retry-on-0 aligns RECOVERING | PASS |
| MeshQL — governance DCE (compile-time cap fold) | tm-2 | ALREADY-SHIPPED | Static Manifest Clamping | n/a | PASS |
| MeshQL — PII taint → egress sentinel | tm-2 | ALREADY-SHIPPED | LLN-PRIVACY-002 SealTaint | n/a | PASS |
| MeshQL — hot/cold split + distributed query topology | tm-2 | TRITMESH-ONLY | local K3 gate authoritative | n/a | PASS |
| **Degrade-only telemetry → K3 admission feedback loop** | **tm-4** | **NEW-MECHANIC** | **wire observability anomaly → vAnd operand on cert/admission** | **substrate-agnostic, withSideSignal semantics** | **PASS** |
| Audit/compliance — K3-verdict immutable .tmf ledger | tm-4 | ALREADY-SHIPPED | audit-logger + .tmf history chain | n/a (digital crypto) | PASS |
| Rollback as CID-pointer revert | tm-4 | TRITMESH-ONLY | none | n/a | N/A |
| DR — mesh resurrection + Tri-State recovery | tm-4 | TRITMESH-ONLY | borrowed K3-0 hold shipped | n/a | PASS (borrowed part) |
| No-downtime upgrades — hold-in-0 wasm hot-swap | tm-4 | TRITMESH-ONLY | K3-0 hold + per-module admission shipped | n/a | PASS |
| Recovering FSM / "TritMesh Catch" | tm-3 | ALREADY-SHIPPED | TLSTP S4 FSM (disjoint from trit) | photonic tamper = degrade-only 0 | PASS (S4 corrects note's "hold 0") |
| TLSTP/B8 cert gate — revocation-unknown→DENY + mid-stream | tm-3 | ALREADY-SHIPPED | cert-gate.ts S1 + B8 G2b | none on crypto path | PASS |
| Mid-stream revocation cadence (poll vs chunk-boundary) | tm-3 | TRACK | B8/S4 config decision | n/a (digital) | PASS |
| **K3 ternary partial-return (Result.Masked per-branch)** | **tm-5** | **NEW-MECHANIC** | **per-field vAnd fold → typed Masked sentinel, keep-the-rest** | **K3-native, digital** | **PASS** |
| Graph-traversal DoS — DAG depth + fuel | tm-5 | ALREADY-SHIPPED | limits{} + recursion cap + CBOR depth-8; fuel #103/104 | n/a | PASS |
| MeshQL graph as .tmf nodes+edges | tm-5 | TRITMESH-ONLY | per-hop K3 → partial-return head | n/a | N/A |
| Encrypted cold-index OpenSearch + arena zero-wipe | tm-5 | TRITMESH-ONLY | arena-zeroize already 0055 B2 | n/a | N/A (cleartext-embedding ⚠ LLN-PRIVACY-002) |
| .tmf-governed multi-app suite (Dumb-App/Smart-Core) | tm-3,combo | TRITMESH-ONLY | consumes shipped .tmf+K3 | none | PASS (reuses invariants) |
| Substrate noise model + NMR/TMR voting | 52-3D-1 | ALREADY-SHIPPED | nmrFailureProbability + consensusTrit | photonic failure modes | PASS |
| Photonic ternary / Base-3 mod-3 optical adder | 52-3D-1 | ALREADY-SHIPPED | tpl-simulator trit ops | TritMesh hardware claim | PASS (n/a governance) |
| WDM parallel logic | 52-3D-1 | ALREADY-SHIPPED | emulator wdmCrosstalkMatrix (R&D 0042 vocab) | crosstalk = noise param | PASS |
| Sync vs async photonic execution | 52-3D-1 | TRITMESH-ONLY | async reserved; de-color impl | hardware timing | n/a |
| Measurement-based "third logic" (MBQC) | 52-3D-1 | REFUTE | low-trust citizen behind gate | governance-neutral physics | PASS by structure |
| Neuromorphic photonics (LIF optical neuron) | 52-3D-1 | TRITMESH-ONLY | neuron = Citizen, governed as T-MAC lane | hardware ML accel | PASS by structure |
| Balanced-ternary 3D-vector volumetric matmul | 52-3D-1,2,combo | REFUTE | T-MAC already routed/verified | aspirational, not O(1) | PASS by enforcement |
| Physical O(1) speed-of-light matmul (t=L·n/c) | 52-3D-2 | REFUTE | none — projected envelope | must label aspirational | PASS-with-correction |
| Physical TamperTrust fold (vAnd(T_digital,T_physical)) | 52-3D-2 | ALREADY-SHIPPED | cert-gate withSideSignal/sideSignals | brake-not-key | PASS |
| Eps calibration — static vs attested measured floor | 52-3D-2 | ALREADY-SHIPPED | toleranceWitness + pinnedEnvHash | calibration-as-attestation | PASS |
| Governance DCE (compile-time K3 fold deletes deny branch) | 52-3D-2 | ALREADY-SHIPPED | K3 abstract-interp + R&D 0036 DCE | n/a | PASS |
| O(1) bump-arena + SoA caching | 52-3D-2 | ALREADY-SHIPPED | GC-free, flat SoA 2.22x (R&D 0055) | n/a | PASS |
| Quantum QKD/QBER → tri-state gate | 52-3D-2,combo | TRACK | hybrid-KEM K_final=KDF(K_pqc‖K_qkd), track-only | QKD supplies key not cipher | PASS |
| MBQC quantum bridge via .tmf passport | 52-3D-2 | ALREADY-SHIPPED | #199 ffsim Phase-1 (20/20) | quantum = Tier-3 citizen | PASS |
| Quantum superdense/holographic windfalls ("drop the MAC") | 52-3D-2,combo | REFUTE | forbidden — keep digital AEAD | transport hype | VIOLATION-if-adopted |
| Programmable-mesh reconfig as E2EE config-blob (config-as-citizen) | 52-3D-2 | TRACK | reuses attestation/manifest rails; HW-gated | config integrity ↔ physical safety | PASS |
| **EMERGENT: Governed Transformation-Matrix admission (T-as-signed-artifact)** | **52-3D combo** | **NEW-MECHANIC** | **extend fuse-loader/wasmHash to photonic-config blob class + photonic.reprogram cap** | **gate runs in Binary core; photonic degrade-only downstream** | **PASS** |
| Holographic volumetric storage + O(1) read | 52-3D combo | TRACK | .tmf CID stays digital SHA-256 | storage physics aspirational | PASS |
| Capability-fold into ExecutionRouter.route | tm combo | TRACK | add cap_check operand to route() (availability half shipped) | availability fallback shipped | PASS |

## NEW mechanics worth implementing in LogicN (ranked)

1. **Degrade-only telemetry → K3 admission feedback loop** (governance/runtime, S). The two halves ship — blind observability (`logicn-observability createObservability`, counts/error-rates/health, no payloads) and the degrade-only side-signal (`cert-gate.ts withSideSignal`, `vAnd`, No-Coercion `min(t*,r)≤t*`). NOT shipped: feeding the *live* anomaly metric back into the admission/cert gate as that operand, so a node auto-degrades ALLOW→INDETERMINATE under attack. Net-new runtime self-throttle, reuses `withSideSignal`+`vAnd`, no new crypto/lattice.

2. **K3 ternary partial-return / per-branch `Result.Masked` response shaping** (governance/runtime, M). Today masking is binary-only: `governance-verifier.ts` rejects a leak (redact/seal/remove-field) and `view(cap1|cap2)` is a masked pointer; there is no three-valued per-branch partial-return that denies one field while returning the rest with a typed `Masked(code)` sentinel carrying LLN-GOV-3VL-001. A thin fail-closed composition of `decideAtBoundary`+`view()`+`redact()` at an output boundary; deny-by-default on unknown branches.

3. **Governed Transformation-Matrix admission (T-as-signed-artifact)** (governance/compiler, M). EMERGENT only when 52-3D-1 (geometry=code) composes with 52-3D-2 (.tmf governs the reprogram blob). Verified absent (0 hits for config-blob/matrix fingerprint/tensor-admission). `hybrid-engine.ts:219` Freivalds verifies the matmul *result*, NOT that T is the admitted matrix — a hot weight/config swap is an unsigned code path today. Extend signed-admission (`fuse-loader`/`wasmHash`/`behavioralFingerprint`) to a photonic-config artifact class + `photonic.reprogram` capability, admitted by `certGate`/`decideAtBoundary` before the PPU port reprograms the mesh. HW-gated (#102-106) but the *governance rail* is core-buildable now.

## Already-shipped / re-derived (cite)

- **K3 verdict lattice / vAnd / decideAtBoundary / LLN-GOV-3VL-001** — `three-valued-governance.ts`; KB `logicn-three-valued-governance.md`.
- **Crypto-on-core (R(D_crypto)→S_B / LLN-SUBSTRATE-001)** — `substrate-inference.ts` CRYPTO_EFFECT; `substrate-model.ts verifyToleranceUnderNoise`; `partition-decider.ts:112`.
- **Analog→trit discretization, NMR/TMR, fail-safe-0** — `substrate-model.ts` NoisyLane/effectiveVerdict/nmrFailureProbability; LLN-SUBSTRATE-002/003/004; `freivalds.ts`; `photonic-bridge.ts:99` (0b11 trap).
- **Router R(o) + net-win cost gate** — `execution-router.ts`, `tri-pipe.ts`, `partition-decider.ts` (proven 0 mis-routes / 0 slowdowns, D2 25/25).
- **Tower-Citizen sim/hw hot-swap** — `photonic-switch.ts selectPhotonicBackend`, `emulator.ts` (deterministic=false), `logicn-tower-citizen`; KB `rd-photonic-ppu-emulator-and-switch.md`.
- **Physical TamperTrust fold + revocation-unknown→DENY** — `cert-gate.ts withSideSignal/sideSignals`; TLSTP S1; KB `logicn-b8-governed-transport.md`.
- **Recovering FSM (correctly above the trit)** — KB `logicn-tlstp-s4-recovering-fsm.md` (INV-2/INV-3; rejects note's "hold 0" alias).
- **Secret zero-wipe + SealTaint + GC-free SoA arena** — R&D 0055 (`wat-emitter.ts` B2b), LLN-PRIVACY-002, flat SoA 2.22x.
- **eps calibration-as-attestation** — `toleranceWitness`+`pinnedEnvHash`+`backendArtifactHash`; KB `logicn-ext-bridge-quantum-design.md`.
- **Governance DCE + const/branch-fold** — R&D 0036 (proven 1.64x, 7.1x code-size).
- **DoS limits** — `governance-verifier.ts` LLN-GOV-019 limits{}, interpreter recursion cap 2000, CBOR depth-8 Billion-Laughs; fuel #103/104.
- **Immutable audit ledger** — `audit-logger.ts` + `logicn-ext-tmf/spec/tmf-history-chain-v0.md` (per-segment AEAD+ML-DSA).
- **MBQC quantum bridge** — `logicn-ext-bridge-quantum` (#199, Phase-1 20/20, Tier-3 Toxic Border).
- **Trit algebra / WDM crosstalk vocab** — `tpl-simulator.ts`, `emulator.ts wdmCrosstalkMatrix` (R&D 0042).

## REFUTED (with reason)

- **Photonic O(1) matmul / "speed of light" / t=L·n/c** — precompute trade (O(N²) apply, dense O(N²) mem, fusion densifies 39x); `rd-aot-tensor-precompute-proof.mjs`. Conversion tax collapses Meech ideal 9.4x → realized ~1.9x (retention ~0.20, `partition-decider.ts`). Present only as labelled-aspirational.
- **Grover line-rate / quantum DB search** — unbacked line-rate claim; silicon sim is O(2^N) and loses quantum security.
- **ntt_mul ≈ matmul** — refuted; different operation.
- **Measurement-based "third logic" (MBQC) as a new governance primitive** — governance treats it identically to any low-trust analog reading; adds no primitive.
- **Superdense "drop the MAC/AEAD because entanglement self-proves integrity"** — VIOLATES crypto-Binary + No-Coercion; photonic/quantum state is PAC-learnable. Keep digital ML-DSA/AEAD always.
- **Crypto/KDF on photonics "to speed it up"** — forbidden by LLN-SUBSTRATE-001 (0.999≠1.0 corrupts keys); vAnd=min cannot lift 0→+1. Compiler already traps it.

## TritMesh-only (saved for later)

- MeshQL / TritMeshQL (query-as-capability-contract; graph as .tmf nodes+edges) — zero hits in core LogicN source; the reusable nucleus (K3 row verdicts, governance DCE) is shipped; the engine is a product.
- .tmf passport / "Govern-Don't-Absorb" / 5-product suite (DB/Object/Stream/Vector/Audit) / Dumb-App-Smart-Core gateway — consumes shipped .tmf+K3+capability machinery; adds no governance algebra; Smart-Core isolation is aspirational #102-106.
- Any-Sync P2P mesh resurrection / CID-pointer rollback / hold-in-0 wasm hot-swap — product data-plane/networking; borrowed K3-0 is shipped.
- Encrypted cold-index OpenSearch + arena zero-wipe — arena-zeroize is owned (R&D 0055 B2); ⚠ cleartext-semantic-embedding search collides with LLN-PRIVACY-002 if ever pulled in.
- Sync/async photonic timing, neuromorphic LIF neuron, Base-3 optical adder, holographic storage — substrate/hardware vocabulary; governed as ordinary low-trust Citizens behind the discretization gate.
- Nested-record SoA auto-flatten — TritMeshQL-only; single-level reject is the fail-closed default if ever built.
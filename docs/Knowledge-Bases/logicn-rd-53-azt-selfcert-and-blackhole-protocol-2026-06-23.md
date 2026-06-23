# AZT Self-Certification & the Black-Hole Protocol (notes/53-blackhole) — Use/Don't-Use Ledger

> **R&D verdict doc.** Classifies every sub-mechanic of notes/53-blackhole against shipped LogicN
> (VERIFY-BEFORE-BUILD). ~80% of the note RE-DERIVES already-shipped architecture. Also records the
> **Tri-Pipe (Substrate) Router → Substrate Dispatch Gateway** rename for the TritMesh side.
> Date: 2026-06-23. Status: design audit, **no build** (net-new items are owner/substrate-gated).

---

## 0. Terminology policy — NO military-grade language

Per the note's own §"We have to be careful with the term *military grade*", this doc uses **none** of it.
Substitutions adopted **verbatim** throughout:

| Banned quality label | Adopted substitution |
|---|---|
| "military-grade" | **Formally Verified** / **Mathematically Proven** |
| "highly secure" | **Cryptographically Bound** |
| "fail-safe" | **Fail-Closed K3 Determinism** |
| (top tier brand) | **Absolute Zero-Trust (AZT)** |

External standards may be **named as compliance *targets*** (DoD IL6, CNSSI 1253, NERC CIP, IEC 62443,
DO-178C, SEC Reg SCI, PCI-DSS, HIPAA, SOC2, OWASP) — but **never** as a quality adjective, and **no**
"MIL-SPEC" profile is invented. Use **AZT** tiers. A standard may only be presented as **proven** where
it is actually enforced; everything else is disclosed as ◑ partial or ⚠ aspirational (see §4).

**Invariants enforced in every verdict below:** crypto stays Binary/digital (LLN-SUBSTRATE-001); photonic/analog
is degrade-only (No-Coercion: min(t\*,r) ≤ t\*, never lifts 0→+1, never a key/cipher byte); K3 "0" is
fail-safe-only. Any claim that an **analog/quantum physical property destroys the data in the trust path**
("quantum evaporation", "wave-function collapse annihilates the data") = **REFUTE** (crypto-on-noisy). The
**digital** halves (`memory.fill(0)` zero-wipe; crypto-shredding by zeroizing digital keys) are legitimate.

---

## 1. Use / Don't-use ledger

### PART I — AZT Self-Certification (the `.lproof` artifact)

| Mechanic | Verdict | Shipped artifact OR why-not | ZT /10 | Paper |
|---|---|---|---|---|
| `.lproof` proof-carrying-code object embedded as a **WASM custom section** | **RENAME-CANDIDATE** | Proof *content* fully shipped: `proof-graph.ts` (`ProofGraph`, obligations+evidence+`governanceSignature`), `manifest-generator.ts` (`generateManifest` → signed `.lmanifest`: `sourceHash`, `proofObligations`, behavioral fingerprint, policy DAG). Net-new is **only the wrapper**: grep `.lproof / customSection / appendCustomSection` over packages-logicn → **0 hits**; `.lmanifest` is a **detached** CBOR+JSON sidecar by design. | 7 | none |
| Static Capability Confinement  `C_ast ⊆ C_manifest` | **ALREADY-SHIPPED** | `governance-verifier.ts` (capability/effect obligations, deny-by-default); `proof-graph.ts` `ProofObligationKind 'capability'/'effect'`; `manifest-generator.ts` `buildCapabilityImports` admission. Compiler refuses to mint the manifest when declared effects exceed the contract. | **10** | none |
| Compilation Isomorphism  `f_source(x) ≡ f_wasm(x)` (Stage-A==Stage-B parity) | **ALREADY-SHIPPED** | `self-hosted-bootstrap.test.mjs` (same source through Stage-A interpreter and Stage-B self-hosted runtime, return-value parity); `tests/r6-corpus/r6-parity.test.mjs` (5-flow + manifest gate). **Honest scope:** per-corpus differential testing over 5 flows, **not** a universal ∀x proof; Trusting-Trust framing is rhetorical. | 6 | workshop |
| K3 Exhaustiveness + DbC `ensure` post-conditions | **ALREADY-SHIPPED** | `governance-verifier.ts` LLN-MATCH-001 (match-arm exhaustiveness or build rejects) + DbC `invariant { ensure result … }` fail-closed at the single flow exit (R&D 0040, SHIPPED); `three-valued-governance.ts` LLN-GOV-3VL-001. **Honest scope:** match-exhaustiveness + bounded-invariant + fail-closed K3 collapse — **not** a general termination/halting proof (halting is undecidable; WCET stays aspirational). | 8 | none |
| Continuous Epoch Attestation (runtime watchdog minting a token every N cycles) | **NET-NEW** | **Verified absent.** No periodic invariant-attestation minter. The only `setInterval` hits are a bench mem-sampler + secrets-vault rotation sweep (rotates *credentials*, not invariants). `cert-gate` is a per-call K3 fold; `attestation.ts` is per-flow; epilogue-receipt is one-per-execution; `runtimeContext.epoch` = Unix ms only. All `fuel`/cycle refs live in **DSS `.lln` design** (substrate-blocked). | 5 | defensive-pub |
| Neuro-Symbolic local-SLM AI auditor (AI-proposes/math-disposes, proof-tactic synthesis, adversarial pre-cognition) | **NET-NEW** | **Verified absent.** Grep `neuro.?symbolic / local SLM / AI auditor / proof tactic / proposes…disposes` matches only KB docs, never compiler/runtime source. `logicn-ai/src/index.ts` is a **static advisor** (`suggestedFix` strings + `approved` boolean), not an SLM, not a tactic synthesizer. The "AI proposes / math disposes" *principle* ships (advisor + human approval); the embedded SLM does not. | 4 | defensive-pub |
| Compliance Matrix (invariants → PCI/OWASP/HIPAA/SOC2/DO-178C/SEC Reg SCI) + AZT-tier audit output | **TRACK** | `logicn-pci-dss-evidence-mapping.md` (honest 7/12 mapping, gaps disclosed); `logicn-devtools-pci/src/pci-checker.ts` LLN-PCI-001..010. **Over-claim to fix:** note presents all standards as fully satisfied; shipped reality counts 7/12 families (the 5 unmodeled families silently not-counted = over-report-by-omission — must become INDETERMINATE→fail-closed). WASI isolation ⚠ aspirational (#102-106), sigs 🔑 PQ-pending (#34). | 3 | none |

### PART II — The Black-Hole Protocol (data destruction on intrusion)

| Mechanic | Verdict | Shipped artifact OR why-not | ZT /10 | Paper |
|---|---|---|---|---|
| (1a) Event-Horizon trigger — **K3 −1 DENY** admission gate | **ALREADY-SHIPPED** | `three-valued-governance.ts` (`Verdict = -1/0/1`; DENY=−1; Kleene-AND most-cautious-wins; empty-clause INDETERMINATE→deny; fail-closed soundness + no-coercion). The one trigger that is real today. | **10** | none |
| (1b) Event-Horizon trigger — continuous epoch-attestation watchdog | **TRACK** | Aspirational. No runtime cycle-counter / heartbeat / per-epoch token minter. Needs the in-WASM supervisor (fuel #103/104, Smart-Core isolation #102-106). Buildable later via Wasmtime-TCB DSS (DRCM Phase 5); inert today. | 4 | none |
| (1c) Event-Horizon trigger — **QBER spike** (fiber-tap detection) | **REFUTE** | Aspirational + **in the trust path with no hardware**. Grep `QBER` over packages-logicn → **0 hits** (exists only in the Lane-E BB84 *simulation* bench + the track-not-build QKD doc: "THEORETICAL GAP"). Eavesdropping IS detectable in principle, but needs single-photon optics + SNSPDs out of scope; agencies say combine-never-substitute. | 1 | none |
| (2) Phase-1 Singularity — atomic `memory.fill(0)` across the arena | **ALREADY-SHIPPED** | `wat-emitter.ts` B2 per-flow `$__lln_heap` rebase + B2b on-entry zeroing loop when module `handlesSecrets`, + owner-chosen zero-on-EXIT for primitive-return secret leaves; vault zero-wipe in `rotation-manager.ts`. **Strip 2 over-claims:** (a) NOT a "single-clock-cycle / transistors flip instantly" primitive — it is an **O(arena-size)** WASM loop; (b) it fires at **per-flow entry/exit** (deterministic reclamation), **not** on a runtime intrusion event. | 9 | defensive-pub |
| (2b) Phase-1 variant — **intrusion-triggered** arena fill (on runtime −1, not per-flow exit) | **NET-NEW** | **Verified absent.** Shipped fill is per-flow-entry reclamation; no runtime hook fires an arena wipe on a live mid-execution −1 DENY. Buildable digitally once (1b) exists; gated on #102-106. The zero-wipe and the −1 verdict both exist but are **not wired together** as active defense. | 7 | none |
| (3) Phase-2 **Quantum Evaporation** — no-cloning wave-function collapse destroys photonic data | **REFUTE** | **Crypto-on-noisy in the trust path.** Violates LLN-SUBSTRATE-001 and No-Coercion (`substrate-model.ts`: noise degrades a verdict ONE step toward HOLD=0; ±1 never inverts; never a key/cipher byte). Photonic channel is **degrade-only (availability, not safety)**, never a destruction primitive. The legit fact (eavesdropping is detectable) already lives under (1c) as an aspirational *trigger*; the "evaporation destroys the data" framing must be dropped. | 0 | none |
| (4) Phase-3 **Crypto-Shredding** — zeroize digital decryption keys → cold blobs become unrecoverable noise | **ALREADY-SHIPPED** | The **digital** half is legit + largely shipped: history-chain key-erasure ratchet (tmf slice 5), privacy-retention crypto-erasure LLN-PRIVACY-013, vault zero-wipe (`rotation-manager.ts`), enforced revocation registry (`governance/revocations.json`, `isKeyRevoked`). **Strip over-claim** "all the energy in the universe to decrypt" → it's standard PQ-AEAD security (NIST SP 800-88 cryptographic-erase), not thermodynamics. | 8 | defensive-pub |
| (5) **Mesh-wide cascade** crypto-shred signal (Any-Sync broadcast to destroy a session key globally) | **NET-NEW** | **Verified absent.** Grep `cascade / black-hole / mesh-shred` matches only parser **error-recovery cascade** + docs; no Any-Sync primitive propagating "destroy session key K across all nodes". Single-node crypto-erase (item 4) exists; the mesh cascade does not. Buildable digitally (signed governance broadcast + per-node key destruction, no new crypto), gated on #102-106. **Caution:** a forgeable cascade signal is a **DoS amplifier** — any build MUST verify the trigger under the shipped revocation/trust-anchor registry before honoring it. | 5 | none |

---

## 2. NET-NEW buildable items (verified absent — what to grep proves it)

These four are genuinely net-new **design** (owner/substrate-gated, mostly behind #102-106 / #34 / #103-104).
None violate an invariant; all keep crypto Binary.

1. **`.lproof` as a WASM custom section** — embed the *already-shipped* signed `.lmanifest`+`ProofGraph` as one
   self-contained object in a WASM custom section. Net-new = the **wrapper/embedding only**; the proof content
   ships. Recommend **RENAME** the existing signed-manifest+ProofGraph as the "AZT proof view" rather than mint a
   new format. Prior art: proof-carrying code (Necula 1997) — defensive-pub at most.
2. **Continuous epoch attestation runtime** — a runtime State-Invariant Watchdog that mints a time-locked
   token/report-chain every N cycles. Crypto stays Binary (signs a digest, same as `attestation.ts`). Floor =
   **defensive-pub** (TPM remote attestation + IMA/measured-boot, in-toto, SLSA, SGX/TDX re-attest freshness are
   heavy prior art). SEU/cosmic-ray framing is aspirational on WASM-on-host (no HW fault channel).
3. **Crypto-shredding by digital key-zeroize** *(single-node SHIPPED — item 4)*; the **mesh cascade** (item 5) is
   the net-new part. Build it as a signed governance broadcast verified under the revocation/trust-anchor registry.
4. **Neuro-symbolic AZT auditor** — local SLM that proposes invariants/tactics; solver verifies, **AI has zero
   authority**. Aspirational; the contract-driven test generation it leans on is already ~80% substrate / **0%
   generator** (R&D 0016), so "adversarial pre-cognition across 5 vectors" over-claims an unbuilt generator.

Also net-new: **(2b) intrusion-triggered arena fill** — wire the shipped `memory.fill(0)` to a live runtime −1.

## 3. REFUTED items (do not build / strip the framing)

- **Quantum Evaporation as the security mechanism (item 3)** — crypto-on-noisy; analog/quantum physics in the
  trust path; violates LLN-SUBSTRATE-001 + No-Coercion. Photonic is degrade-only, never a destruction primitive.
- **QBER spike as a shipped/near-term trigger (1c)** — no single-photon hardware in scope (THEORETICAL GAP);
  detectable-in-principle ≠ buildable-now. Keep only as an aspirational *trigger*, never a data-destruction step.

## 4. ALREADY-SHIPPED items (cite, don't rebuild)

Static capability confinement (`C_ast ⊆ C_manifest`, ZT 10), Stage-A/B parity (R6 corpus), K3 exhaustiveness +
DbC post-conditions, the **K3 −1 DENY** trigger (ZT 10), arena `memory.fill(0)` zero-wipe (per-flow), single-node
crypto-shredding, and the PCI-DSS evidence mapping. **Fix before any external audit ships:** the compliance matrix
must inherit the honesty doc's disclosure rules — present only ✅ enforced and ◑ disclosed-partial; the 5 unmodeled
PCI families must become **INDETERMINATE→fail-closed**, never a silent pass; never render ⚠ aspirational rows
(WASI sandbox, WCET) as "PASS".

---

## 5. Tri-Pipe (Substrate) Router → **Substrate Dispatch Gateway**

**Recommendation: rename the TritMesh substrate-routing concept to "Substrate Dispatch Gateway"**
(component `SubstrateDispatchGateway`; dispatch axis S_B/S_H/S_P).

**Rationale.** It names exactly what it IS — a physics-aware gateway that **dispatches** an op to the correct
hardware substrate. It contains **zero** "tri"/"pipe"/military jargon, so it cannot collide with LogicN's **three
shipped "Tri-Pipe" senses** (the K3 governance lane model; the `logicn-tri-pipe` capstone package; the
hardware-tier topology). "**Dispatch**" deliberately differs from the **shipped `ExecutionRouter`**
(`logicn-tri-pipe/src/execution-router.ts`) so the schematic name does not clash with a shipped class while still
reading as routing. Crypto-stays-Binary is naturally phrasable: *"the gateway never dispatches a crypto/control op
to S_P"* = LLN-SUBSTRATE-001 at `partition-decider.ts:113`.

**Runners-up (all RENAME-CANDIDATE, all lose to #1):** Substrate Affinity Router (loses on reusing "Router"
→ verbal clash with the shipped `ExecutionRouter`); Hardware Lane Selector (re-overloads "lane" + HLS≈High-Level
Synthesis); Physics-Aware Compute Bridge (clunky, "Bridge" already overloaded, weak acronym); Substrate Admission
Gateway (risks re-confusing hardware routing with the K3 **capability** admission gate — the exact mix-up the
rename solves).

**Disambiguation from LogicN's shipped Tri-Pipe (critical).** The "Tri-Pipe Substrate Router" schematic in
notes/tritmesh-6 is **~85-90% already shipped**: `ExecutionRouter.route` (3-axis: `resolveHardware` tier ×
`routePrecision` × `PartitionDecider`); `LLN-SUBSTRATE-001` crypto-stays-digital; `selectPhotonicBackend`
sim/hw hot-swap; substrate-model NoisyLane discretization with 0=trap. **So this is a TritMesh-side
documentation/branding rename, not a LogicN code refactor** — re-point TritMesh's notes at the shipped
`ExecutionRouter` *under the new name*; do **not** spawn a parallel router.

**Rename scope — two buckets (keep it mechanical):**
- **BUCKET A — LEAVE UNTOUCHED** (LogicN's three legitimate shipped senses): `logicn-tri-pipe/*` (capstone
  package), `logicn-hardware-tier` "Tri-Pipe topology", the K3 "Tri-Pipe lane model". Owner instruction: do not
  edit LogicN's shipped Tri-Pipe.
- **BUCKET B — RENAME** (TritMesh-side text describing the *unbuilt* substrate gateway): `notes/tritmesh-6.md`
  ("Tri-Pipe Router"/"Tri-Pipe Substrate Router"/"Tri-Pipe architecture" = R&D-007); `notes/53-blackhole` ~line 780
  ("Tri-Pipe optical bridge" → "Substrate Dispatch Gateway optical lane"); the TritMesh R&D verdict/index docs that
  quote the old name (`logicn-rd-tritmesh-1-5-and-52-3d-2026-06-23.md`, `KNOWLEDGE-BASE-INDEX.md:124`,
  `logicn-architecture-rd-2026-06-23.md`, `logicn-compiler-intelligence-deterministic-foresight.md`). Cleanest
  edit: "Tri-Pipe (Substrate) Router" → "Substrate Dispatch Gateway (the TritMesh name for the shipped LogicN
  `ExecutionRouter`)". Build/index/diagram artifacts regenerate from source — no hand-edit. Net-new residue =
  only the "retry-vs-trap on K3-0" disposition knob (TRACK: `substrate{} on_indeterminate`, default trap).

---

## 6. Net-zero-trust posture & paper-worthiness summary

- **Highest ZT (10):** static capability confinement; K3 −1 DENY trigger. **(9):** arena zero-wipe;
  the shipped `ExecutionRouter`/Tri-Pipe.
- **No flagship paper.** LogicN is "no new science by design." Floors: arena zero-wipe / crypto-shredding =
  defensive-pub (secure-zero, `memset_s`, ZeroizeOnDrop, NIST SP 800-88, Signal key ratchets); epoch attestation
  / SLM auditor = defensive-pub (TPM/IMA/in-toto/SLSA/SGX-TDX); Stage-A/B parity = at most a **workshop** note on
  measured negatives (translation validation, Pnueli 1998). Everything else: none.

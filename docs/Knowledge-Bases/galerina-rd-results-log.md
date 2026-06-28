# Galerina — R&D Results Log (quick-lookup verdict table)

**Purpose.** One-glance lookup of *what R&D concluded and why* — **positive AND negative**. A REFUTED idea is as
valuable as an adopted one: recording *why we did not adopt* stops it being re-proposed (the corpus repeatedly finds
~80% of "new" ideas re-derive shipped architecture). **Standing process (owner 2026-06-23):** when an R&D job comes
back (`_session-bridge/done/NNNN-*.done.md`), the hub absorbs it into the KB and **adds a row here** — adopted or
refuted, with the reason — then refreshes the KB index. See [[feedback-rd-absorb-positive-and-negative]].

**Verdict legend:** ✅ ADOPTED (built/shipped) · 🧪 DESIGNED (KB design, build pending) · 🔭 TRACKED (track-not-build)
· ❌ REFUTED (not adopted + reason) · ⏳ PENDING (dispatched, awaiting `done/`) · 🔒 GATED (owner/HW/infra-gated).

> Full doc-level absorption history is in [galerina-rd-absorption-catalog.md](galerina-rd-absorption-catalog.md); per-cluster
> disposition tables (every finding, both directions) live in e.g. [galerina-transport-auth-research-explained-2026-06-22.md](galerina-transport-auth-research-explained-2026-06-22.md).
> This log is the *quick-lookup verdict roll-up* across them.

## Pending (dispatched to the R&D bridge — awaiting `done/`)
| Job | Topic | Verdict |
|---|---|---|
| 0078 | OCSP staple-caching for S1 `revocation_fresh` (availability vs Zero-Trust) | ⏳ |
| 0079 | Is the framework structure best-possible for AI comprehension? | ⏳ |
| 0080 | `contract{}` memory-cleanup / arena-reuse directive | ⏳ |
| 0081 | Per-component photonic/tri gap verdicts | ⏳ |
| 0082 | 16-packages photonic/tri + missing/incomplete/stub package status | ⏳ |
| 0083 | Closed-capabilities photonic/tri variant | ⏳ |
| 0084 | Security standards × K3 (PCI/DSS + full OWASP + CWE/NIST/MITRE/SLSA) | ⏳ |
| 0085 | RAG-vulnerabilities rulebook-curator → reconcile `GALERINA_SECURITY_RULEBOOK` + RAG threat class | ⏳ |
| 0090 | Front-file / root-layout reorg to match the framework layout (PLAN only) | ⏳ |
| 0091 | Base-package set a standard framework requires (full list to review) | ⏳ |
| 0092 | Unify tri-logic + data-query benchmark workloads (so they become unit-comparable) | ⏳ |

## Adopted / Designed (recent)
| Topic | Verdict | Why / what | Ref |
|---|---|---|---|
| TLSTP S1 K3 cert/channel-validation gate | ✅ ADOPTED | revocation-unknown→DENY by the K3 algebra; reuses shipped `vAnd`/`allOf`/`decideAtBoundary`; no new crypto | cert-gate.ts; [s1 guide](galerina-tlstp-s1-cert-gate.md) |
| K3 three-valued governance (Direction A) | ✅ ADOPTED | fail-closed `DENY<INDET<ALLOW`; No-Coercion proven | three-valued-governance.ts |
| Substrate noise model / NMR (Direction C) | ✅ ADOPTED | closed-form von-Neumann redundancy; availability-not-safety | substrate-model.ts |
| `substrate{}` contract block (Direction B) | ✅ ADOPTED | tolerance/determinism for photonic/ternary substrates | galerina-substrate-contracts.md |
| DbC output post-conditions (R&D 0040) | ✅ ADOPTED | `invariant{ ensure result }` fail-closed at flow exit, all tiers | galerina-dbc-output-postconditions.md |
| `for…where` filtered iteration (R&D 0037) | ✅ ADOPTED | branchless predicated guard | for-where verdict |
| AOT const-fold + DCE (R&D 0036) | ✅ ADOPTED | proven 1.64× / 7.1× code-size win | aot-tricks verdict |
| Revocation registry enforcement | ✅ ADOPTED | `isKeyRevoked` wired into fuse/resolver/bridge; key `8eecf4…`→Deny | revocation-registry.mjs |
| `contract.permissions {}` device-grant clause | 🧪 DESIGNED | distinct V_PERM block + SPORE-PERM-001..006, fail-closed | [permissions design](galerina-contract-permissions-design.md) |
| DRCM degrade-only photonic operand · CBOR SubstrateAttestation Tag-418 · economics/security photonic lanes | 🧪 DESIGNED | degrade-only (brake-only), keep crypto Binary | [architecture R&D](galerina-architecture-rd-2026-06-23.md) |
| Compiler Intelligence (Doc 005): §2 Governance DCE · §3 substrate envelope+value-taint · §4 auto-resilience wrap | 🧪 DESIGNED | all `design-then-build`; ~75-85% substrate reused; net-new = K3 trust-dataflow pass (SPORE-GDCE-001), `substrate{photonic}` keyword, AST→GIR resilience wrap. No "guessing" — deterministic, unknown→0→keep | [compiler-intelligence](galerina-compiler-intelligence-deterministic-foresight.md) (wf `w2gzcbx9d`) |
| Photonic auto-promotion WITHOUT explicit authorization | ❌ REFUTED | violates "no hidden power/cost" + determinism contract; precision/crypto→photonic "must stay impossible" — agency is BOUNDED (explicit `substrate{}` envelope + auto-route within, fail-closed to Binary) | compiler-intelligence §3 |
| Module-wide `contract.invariant{}` (note 45 Part 1) | 🧪 DESIGNED | promote flow-`invariant{}` → module-wide, injected into every flow; **tier by provability** (static-proof / block-build · injected DbC `ensure` · alias-to-`limits`); AI-drift immunity (invariant lives at the contract layer, not the body an AI edits) | [invariant module-wide R&D](galerina-contract-invariant-module-wide-rd.md) |
| Bitnet bridge Standard-2 governance gate (R&D 0086, owner-forwarded) | ✅ ADOPTED / BUILT | wired the `canCommit()` PREFLIGHT on the native path of BOTH cpu+gpu bridges, fail-closed (denied COMMIT throws, native addon not called); closed a doc-vs-code unwired-control gap; +3 tests (13→16 green). Secondary `canCommit()`-weak-predicate finding left for owner decision | bitnet-{cpu,gpu}-bridge.ts; `done/0086-*` |
| External idea mining 2026-06-23 (`C:\x` re-mine) | 🔭 TRACKED (candidates) | 18 net-new (5 HIGH: transform-order gate `SPORE-TRANSFORM-ORDER` · **filtered-search-as-deny-by-default** [closes a fail-open] · signal-dependent erasure · incoherent-lane two-valued sub-lattice · PDK tolerance vocab) + 13 MED/LOW; ~20 re-derived/refuted. Surfaced for owner — NOT auto-built | [mining 2026-06-23](galerina-external-idea-mining-2026-06-23.md) |
| FHE encrypted-similarity | 🔭 TRACKED | crypto-on-core-OK but never line-rate + solves a threat model Galerina doesn't have; selective-disclosure ANN dominates | rd-absorbed/rd-fhe-encrypted-similarity-v0.md |
| Real DSS.wasm / Wasmtime TCB (DRCM Ph5) | 🔒 GATED | #102-106 external-infra + owner gated | galerina-drcm.md |
| ML-DSA-65 hybrid `.lmanifest` signing (#34) | 🔒 GATED | verify is PQ-ready; signer build owner-gated (offline custody) | galerina-quantum-resistance-posture.md |
| notes/46 — borrow V8/Node+Rust patterns, not trust | 🔀 MIXED (mostly already-shipped) | Headline cache-law/K3/arena/backpressure/signed-admission re-derive shipped arch; on-disk hot-path compile cache **REFUTED** (~56ns compile vs ~2150ns key = ~38× slower); net-new = compiler-enforced **affine authority** + type-state pipeline + must-use→compile-error + newtype hashes (→bridge 0087); risk half (eval/finalizers/shared-mem/ambient-imports) all REFUTED | gate-cache.ts · hybrid-engine.ts:317 · value-state-checker.ts · [doc](galerina-rd-notes-46-47-50-51-apiserver-spore-2026-06-23.md) |
| `//spore:` chain-of-logic cache (serialize R&D-0045 flow-graph + GIR) | ✅ ADOPTED (net-new, security-gated) | Works + ~30% pre-built; analyze recomputed each run & GIR never deserialized today; the `//spore:` TEXT is a forgeable generated VIEW → cache key MUST be SIGNED source; persist STRUCTURE never the ruling; red/green, uncertain=recompute (→bridge 0088) | flow-dependency-analysis.ts · gir-emitter.ts · [doc](galerina-rd-notes-46-47-50-51-apiserver-spore-2026-06-23.md) |
| `galerina-framework-api-server` — all R&D done? | 🔀 MIXED — security gap CLOSED | channelVerdict-supply seam **SHIPPED** (`resolveChannelVerdict`, `d33b0d5`); the TLS peer-cert→`CertGateInput` mapper (**#0089**) is **BUILT in-session 2026-06-23** — opt-in `tls` mode, `getPeerCertificate(true)`→`certGate`→`channelVerdict`, fail-closed (missing/errored factor→0→DENY), +6 e2e (11→17 green), crypto stays Binary; #212 deny→HTTP already-shipped; remaining tail = example-app/drain (open-build, breadth), rate-limit→KERNEL (TRACK), v0.2 fat-spec re-import REFUTED | api-server/src/index.ts · cert-gate.ts · [doc](galerina-rd-notes-46-47-50-51-apiserver-spore-2026-06-23.md) |
| Compiler-enforced affine authority + type-state pipeline (R&D 0087, from notes/46) | ✅ UNLOCKED (owner GO) · ⚠️ **NOT clean-ready — premise correction** | **Verify-before-build 2026-06-23:** R&D 0087 assumed `value-state-checker.ts` "already does use-counting" — it does NOT (no `useCount`/linear/affine infra; grep-empty). AND the authority-object TYPES it would make affine (`DecisionToken`/`HostEffectPermit`/…) **don't exist as Galerina types**, so there is **no consumer** today. Building affine infra now = speculative, no consumer. → **re-scope needed** (define authority types + a consumer first, OR pick the smaller `must-use`/`newtype-hash` items). Unlocked but sequencing-blocked | BUNDLE all 5 compile-time tightenings on the shared value-state pass (affine/move-once authority · Raw→Verified→Authorized→Sealed type-state · run-scope lifetimes · must-use→compile-error · newtype hashes); **GATE item 1 (affine) on explicit owner GO** first. Zero-trust cost: NONE (pure tightening — more programs rejected, none newly admitted); grounds on the SHIPPED fuse-loader admission stages. Design + tests + bench done | value-state-checker.ts · `done/0087-*` |
| Signed content-hash-keyed flow-graph + GIR compile-cache (R&D 0088, the `//spore:` chain-of-logic) | 🧪 DESIGNED — build pending | **`.lcache` SIDECAR** (NOT a `.lmanifest` section — keeps the signed governance artifact pure + disposable); flow-graph keyed on `sourceHash`, GIR on the FULL notes/46 dependency hash (absent field→`""`, never silently collides); **interim HMAC-SHA256 → `governanceSignature` once #34 lands; unsigned cache = RED = recompute**. New `SPORE-CACHE-*` codes + 34/34 re-runnable bench. Cache STRUCTURE never the ruling | flow-dependency-analysis.ts · gir-emitter.ts · `done/0088-*` |
| notes/47 (DRCM precursor) + architecture blueprint PDF | already-shipped (~90% re-derive) · 🧪 deliverable WRITTEN | June-3 precursor of shipped DRCM (DbC / SPORE-PRIVACY-002 / SPORE-MONO + signed `.lmanifest` + ASIC + WASI #102-106 + PCI/OWASP 0084); net-new = numbered-PCI-requirement→artifact **compliance-evidence mapping TABLE** — now written (honest grading: enforced vs ⚠ aspirational isolation vs 🔑 PQ-placeholder; discloses 7/12 checker gap) | [PCI evidence map](galerina-pci-dss-evidence-mapping.md) · governance-verifier.ts |
| notes/50 — backend roadmap + tri/photonic primer + photonics pointers | already-shipped (0 net-new buildable) | ~95% reference; primer re-derives K3 + substrate + blind-observability; SAX already mined today (S-parameter-composition); gdsfactory/Meep/Photontorch **REFUTED** (keep physics/sim outside the governance boundary) | three-valued-governance.ts · galerina-external-idea-mining-2026-06-23.md |
| notes/51 — NumPy→TS: full numeric/ndarray/linalg in core? | ❌ REFUTED (by design) | Full NumPy parity in core = NO by design; core governs numeric SHAPES (core-vector types), compute behind ext-bridge-cpp/-bitnet; `for x in xs where c` = the shipped `np.where` analog; ndarray/broadcasting REFUTE; dense linalg (inv/det/eig) = TRACK behind a future Toxic-Border ext-bridge on real demand | core-vector/src/index.ts · ext-bridge-cpp/src/index.ts |
| **RD-0150** — Graph as the standard data model for **API / DB I/O** border (security/speed/organisation) | 🧪 DESIGNED (concept) · **ZT 7** (hub) | **HYBRID property-graph**: graph SPINE for reachability/capability/verdict/provenance + columnar/SoA PAYLOAD for bulk scans. Isolation goes STRUCTURAL (no edge=no reach) → `Q∩S_user` = K3 reachability; closes CWE-639/285 + realizes NIST T1/T4. **Wins security+organisation, mixed on speed** (loses bulk scans/aggregations to SoA — why note 54 chose it), **introduces CWE-400** (mandatory traversal-budget gate) + MUST carry the 0037 separate-presence-channel discipline. Crypto stays digital; topology photonic-accelerable only outside the gate. 3 open problems (cross-tenant edge crypto custody is hardest). Owner-assigned 2026-06-27; verify lenses failed → worker honesty-pass | [graph-as-data-io concept](galerina-rd-0150-graph-as-data-io-border-concept.md) (wf `wf_a3d324a3-815`) |
| **Egress hardening + note-54 IDOR border + audit redaction (hub session 2026-06-27)** | ✅ SHIPPED | (A) network TLS+port enforcement at the outbound dial · (C) `redactText` central redaction sink in audit-receipt metadata · (D) note-54 per-user data hard border `Qexecuted = Q ∩ S_user` (IDOR/CWE-639) → prod · force-HTTPS boot setting + local-dev loopback + internal-proxy allow-list (`GALERINA_ALLOW_PLAINTEXT_EGRESS` / `..._ALLOW_LOCALHOST` / `..._EGRESS_ALLOWED_HOSTS`). Full suite 60/60·5,945 | e474b1f · 4baf422 · a4471a6 · 5f73cb2 · 74d720c · b6033e1 · [egress doc](galerina-egress-tls-boot-setting.md) · tower-citizen/data-plane-border.ts |

## 2026-06-27 — RD-0137..0143 ("automate the defence" with photonic/tri/Tower-Citizen/Tri-Pipe)

Owner notes `75-improvments-r-d-1..6`. Proof: `scripts/rd-0138-0143-photonic-security-suite-proof.mjs`
(8/8 V GREEN, 4 excluded). Full doc: [photonic-security-automation](galerina-rd-0138-0143-photonic-security-automation.md).
ZT score = how zero-trust-sound *as written* (0–10). Deep per-claim matrix handed to the encryption R&D worker.

| RD | Topic | ZT | Verdict | Why (one line) |
|---|---|---|---|---|
| 0137 | Tarmeties (2nd ungoverned/speed product) | 7 | 🔒 GATED (post-v1) | theoretical; one fail-open landmine = governed-artifact-run-ungoverned mode confusion |
| 0138 | Data Privacy | 5 | 🔀 MIXED | AI-cage ✅ re-derives `governAiProposal`; Lane-0 auto-mask ⚠️ fail-open unless declassifier; optical FHE ❌ |
| 0139 | Supply-Chain | 6 | 🔀 MIXED | package charters ✅ re-derive `boundary-policy`/`fuse-loader`; photonic 0-latency audit ❌; attestation core net-new |
| 0140 | Audit / Provenance | 6 | 🔀 MIXED | lineage DAG + audit-receipt ✅ shipped; optical PUF signature ❌ (PAC-learnable); WDM=blind-observability exporter |
| 0141 | Capability Control | 5 | 🔀 MIXED | temporal leasing ✅ re-derives `lease.ts`; optical phase-gate-as-authority ❌ (No-Coercion + 0-cycle) |
| 0142 | Fail-Close Auth | 4 | 🔀 MIXED (lowest) | attestation ✅ shipped; **Lane-0 "serve SYNTHETIC data on auth-drop" ❌ most anti-ZT**; optical heartbeat-as-gate ❌ |
| 0143 | Net-new: Zero-Storage Secrets + Polymorphic Obfuscation | 5 | 🔀 MIXED | secrets digital-half ✅ (≈shipped, `#110`); photonic wave-keys ❌; **obfuscation ❌ security-by-obscurity = anti-ZT** |

**Cross-cutting net-new (owner-gated):** formalize "Tri-Pipe Lane 0" as a typed, audited **declassifier rail**
(extend `partialReturn` with a `SPORE-DECLASSIFY-*` obligation so "mask-and-continue" is only reachable through it).
**Proved (V1–V3):** No-Coercion ⇒ photonic state can't be the gate/signature; Lane-0 mask-and-continue is fail-open
vs the shipped fail-closed `maskByVerdict`; "0 CPU cycles" refuted (latency≠work).

## 2026-06-27 — RD-0144..0149 ("automate the defence" in Governed Chaos & Multi-Substrate)

Owner notes `75-improvments-r-d-7..12`. Proof `scripts/rd-0144-0149-governed-chaos-suite-proof.mjs` (6/6 V GREEN).
Full doc: [governed-chaos-multisubstrate](galerina-rd-0144-0149-governed-chaos-multisubstrate.md). Same pattern as
RD-0138-0143. **NB: RD-0148 (note 11) is a byte-identical DUPLICATE of RD-0147 (note 10) — delete candidate.**

| RD | Topic | ZT | Verdict | Why (one line) |
|---|---|---|---|---|
| 0144 | Degrade-Only | 6 | 🔀 MIXED | Survival-Contract auto-degrade ✅ re-derives substrate{}/DRCM (safe direction); spectral-shredding ❌ (X1 + 0-cycle) |
| 0145 | Substrate-Switch | 5 | 🔀 MIXED | intent-partition ✅; fluid blend ⚠️ needs Safe-Floor; phase-routing-as-switch ❌ (No-Coercion) |
| 0146 | Verified-Approx | 6 | 🔀 MIXED | bound invariants ✅ re-derive DbC; Freivalds ✅; **K3-0-as-"proceed" ⚠️ availability-not-safety (V1)**; fuzzy-analog aspirational |
| 0147 | Fault-Healing | 5 | 🔀 MIXED | telemetry+NMR ✅; predictive hot-swap aspirational; optical self-reverse 0-energy ❌ |
| 0148 | *(dup of 0147)* | — | ❌ DUPLICATE | note 11 == note 10 byte-for-byte |
| 0149 | AI-Proposal-Safety | 6 | 🔀 MIXED | abstract-interp + No-Coercion ✅; **shadow-sandbox net-new but data-exposure → behind note-54 border (V3)**; optical parallel aspirational |

**Net-new (owner-gated):** shadow/canary deploy of AI proposals = note-54 border (D, shipped) + attenuated caps +
Freivalds + the Lane-0 declassifier rail (RD-0138-0143). **Proved:** V1 K3-0=availability-not-safety; V2 substrate-
blend Safe-Floor; V3 shadow-fork must run behind the note-54 border (ties to this session's D).

## 2026-06-27 — RD-0151..0153 (Dynamic Assimilation · Tri-Logic Ambiguity · Governed AI, notes 13-15)

> RD-0150 (graph-as-data-spine, ZT 7) is in the **Adopted / Designed** table above — not repeated here.

Owner notes `75-improvments-r-d-13..15` (RD-0150 reserved in worker session). Proof
`scripts/rd-0151-0153-assimilation-ambiguity-neural-proof.mjs` (6/6 V GREEN). Full doc:
[assimilation-ambiguity-neural](galerina-rd-0151-0153-assimilation-ambiguity-neural.md).

| RD | Topic | ZT | Verdict | Why (one line) |
|---|---|---|---|---|
| 0151 | Dynamic Assimilation (hot-plug HW) | 6 | 🔀 MIXED | Hardware Citizen attestation = genuine net-new seam, re-derives bridge-attestation, **HW-gated**; 0-overhead transmutation + spectral 0-cycle ❌ |
| 0152 | Tri-Logic Ambiguity (0 as asset) | 5 | 🔀 MIXED | re-derives substrate-noise/partialReturn; **"feed dummy data, keep live flow alive" ❌ fail-open** (sound form = scoped decoy); phase-cancel 0-cycle ❌ |
| 0153 | Governed AI / neural | 6 | 🔀 MIXED | **Weight Charter + anti-poisoning invariant ✅** (No-Coercion); vector-clamping = ML technique out-of-core (ext-bridge); photonic-as-alignment-gate ❌ |

**Net-new (owner-gated):** Hardware Citizen attestation (RD-0151, HW-gated) · Model Weight Charter + anti-
poisoning invariant (RD-0153, in-core seam). **Proved:** V1 optical-can't-be-the-gate + weight-can't-add-cap;
V2 0-cycle refute; V3 "0-as-asset"/"clamp-and-continue" sound only fail-closed, not fabricate-in-live-flow.

## 2026-06-28 — RD-0154..0167 (TritMesh / `.spore` mesh-database, notes `76-mesh-r-d-01..08`)

Owner notes `76-mesh-r-d-01..08` (database-side R&D; `.spore`=rebrand of `.tmf`). 7 parallel workers, **228
machine-checked asserts across 7 proofs, all GREEN** (`scripts/rd-0154-0155-*` 45 · `rd-0156-*` 29 · `rd-0157-0159-*`
29 · `rd-0160-0161-*` 32 · `rd-0162-0164-*` 26 · `rd-0165-*` 26 · `rd-0166-0167-*` 41). Full doc:
[tritmesh-mesh-database](galerina-rd-0154-0167-tritmesh-mesh-database.md). **Load-bearing refute: a ternary
dot-product `I=S·C` carries NO unforgeability (runnable forgery) → cannot replace TLS/mTLS/X.509; valid only as a
deny-only PRE-FILTER in front of real PQ crypto.**

| RD | Topic | ZT | Verdict |
|---|---|:--:|---|
| 0154 | Scaling-walls + streaming/backpressure + memory-safety | 9 | ✅ ADOPT; **"memory-safe in prod" ❌** (isolation≠safety; gate not enforced) |
| 0155 | TritMesh vs Postgres/Cassandra positioning | 6 | 🔭 TRACK — crypto-tax real; absolutist adjectives = availability not safety |
| 0156 | Photonic Interference Fabric / Wavefront DB | 2 | ❌ REFUTE (optical≠crypto; O(N) not O(1)) / 🔭 TRACK storage |
| 0157 | Virtual Wavefront Engine (silicon) | 6 | 🔀 sparse O(E) + SIMD modest ✅; O(1) + Mᵏ-instant ❌ |
| 0158 | Tri-Router K3 + hot/cold dual-matrix | 8 | ✅ ADOPT (real crypto on the gate); Lambda merge proven |
| 0159 | Mycorrhizal Overlay — rebuild graph not data | 7 | ✅ ADOPT — re-derives RD-0150; novelty=silicon framing |
| 0160 | T-CSR + hyperbolic + semantic phase-hash | 7 | ✅ ADOPT w/ corrections; phase-hash kills fuzzy search (honest) |
| 0161 | Symbiotic vs Pure-Phase + 100PB + NVMe-DMA + decoupled | 8 | ✅ zero-copy + headless DiD / ❌ O(1) + "fits in WASM" (it STREAMS) |
| 0162 | TritSocket (zero-copy websockets) | 8 | ✅ zero-copy + min-plus-in-mesh / ❌ vector-auth≠TLS (forgery) + public source-routing |
| 0163 | Cross-language silicon package (new repo) | 9 | 🧪 DESIGN — perf PRE-FILTER only, NOT a security boundary |
| 0164 | TritRPC (gRPC overhaul) | 8 | ✅ zero-copy serialization / ❌ kill-mTLS; kill-HTTP/2=interop loss |
| 0165 | TritSSL / "Wavefront TLS" | 2 | ❌ REFUTE (no identity binding; 0-RTT≠AKE) / ✅ PQ subset (ML-DSA on TLS) |
| 0166 | Graph-driven CPU cache opt (L1/L2/L3) | 5 | ✅ ADOPT (model-bounded); "latency zero" ❌ (work stays Θ(n)) — *worker ZT 2→5* |
| 0167 | Graph in `.spore` as SIGNED primary index + >4GB | 8 | ✅ ADOPT **GATED on signing** — unsigned index = silent read-redirect (proven exploit) |

**Net-new (owner-gated):** signed `.spore` index (RD-0167, defensive-pub) · cross-lang pre-filter lib (RD-0163, new
repo, NOT a security boundary) · zero-copy data plane (RD-0161/0162) · TritMesh taxonomy. **Papers:** ~12 defensive,
0 scientific; strongest 0167 + 0161.

## 2026-06-28 — RD-0168 (graph-driven PCI/DSS + security compliance scanner — owner tool ask)

🧪 DESIGN (build-ready, ADOPT-additive) · **ZT 9** · proof `scripts/rd-0168-graph-pci-compliance-scanner-proof.mjs`
(31/31) · paper=defensive(+modest scientific). Full doc:
[graph-pci-compliance-scanner](galerina-rd-0168-graph-pci-compliance-scanner.md). Turns PCI requirements into
**monotone reachability predicates over a SIGNED governance graph**: the shipped `galerina-devtools-pci` checker is
per-flow AST (local) and cannot answer *"does PAN REACH an egress/log/store sink with no encrypt/redact/audit edge?"*
— RD-0168 is the thin taint-reachability layer that can (`SPORE-PCI-G-000/004/005/006`). K3 fail-closed (unknown-class
source → sink = INDETERMINATE, never silent PASS). **Load-bearing ZT (V7):** the scanner must read a SIGNED graph
(RD-0167) — an unsigned in-`.spore` graph lets an attacker delete the PAN→egress edge → scanner PASSes a still-leaking
program (fail-OPEN); Ed25519-covering closes it. ~70% reuse (project-graph algos + BoundaryGraph + compiler taint
tags); net-new = DataFlowGraph builder + 4 predicate checks. Build ≈2–3 days, additive.

## Refuted — and WHY we did not adopt (the negative record)
| Idea | Verdict | Why refuted |
|---|---|---|
| Photonic SHA-256 / any crypto-on-photonic | ❌ REFUTED | crypto/keys stay Binary by invariant; analog can't be a key (No-Coercion); photonic = degrade-only operand only |
| Photonic state as a signature/auth byte | ❌ REFUTED | PAC-learnable optical state; crypto-on-core violation → demoted to a degrade-only K3 tamper signal *under* the digital Ed25519+ML-DSA-65 sig |
| Ternary Ephemeral Ratchet (analog `E_ternary` in the KDF) | ❌ REFUTED | hard crypto-on-core violation |
| Continuous float trust `T_c` as the gate | ❌ REFUTED | conflicts with discrete fail-closed K3 → telemetry-only, discretized via `vAnd` |
| TMX-256 / ML-DSA TritMesh stack for Galerina | ❌ REFUTED | keep SHA-256 (Grover→128-bit OK) + ML-DSA-65; no benefit to swapping |
| Z3/SMT proof for the cert-gate K3 algebra | ❌ REFUTED (2026-06-23) | a 4-factor `min` is already exhaustively tested by the 3⁴ truth table; Z3 belongs on tri-tier i32 conformance instead |
| Tri-logic "speeds up" JSON parsing | ❌ REFUTED | category error (K3 is governance, not parsing); the real win is a simdjson branchless classifier |
| Photonic tensor-precompute = O(1) | ❌ REFUTED | classic precompute trade (apply still O(N²); dense T_reach mem; fusion densifies 39×) — not O(1) |
| Cleartext semantic routing across a trust boundary | ❌ KILLED | SPORE-PRIVACY-002 blocks cleartext semantic embeddings at network sinks |
| `contract.invariant` "Auto self-healing immune system" (note 45 Part 2) | ❌ REFUTED | (1) loosen-on-low-risk = FAIL-OPEN (spoof telemetry → loosened net); invariants must be monotonic-tighten-only (`SPORE-MONO`); (2) synthesise conditions from analog HIV telemetry = No-Coercion violation + guessing; (3) host-side `GalerinaAutoInvariantEngine` misplaces trust (host is hostile; enforcer must be in-DSS.wasm). Sound core re-derives the shipped monotonic emergency overlay | [invariant module-wide R&D](galerina-contract-invariant-module-wide-rd.md) |


## Complete R&D ledger — all bridge `done/` files (swept 95, 2026-06-23)

> Comprehensive per-job index of every R&D `done/NNNN-*.done.md` (owner: make the log complete-per-job). The curated
> verdict tables above carry the *why* on the notable ones; this is the full roll-up. Regenerate after new `done/` land.

| id | title | status | done-file |
|---|---|---|---|
| 0001 | Reconcile Galerina conformance findings against verified current state | ⚠ partial | `0001-galerina-state-reconciliation.done.md` |
| 0002 | Photonic / ternary in TLS·SSL (HTTPS) — honest role-mapping | ✓ done | `0002-photonic-ternary-in-tls.done.md` |
| 0003 | R&D retrospective: recent findings vs Phase 1 (Pages) | ✓ done | `0003-rnd-retrospective-pages-vs-phase1.done.md` |
| 0004 | Lane E (QKD/OTP) adversarial verification | ✓ done | `0004-lane-e-adversarial-verification.done.md` |
| 0005 | QRNG Q1 entropy-capability grounding survey | ✓ done | `0005-qrng-q1-grounding-survey.done.md` |
| 0006 | Mine note 37 (n-valued / fuzzy logic) for extractable value | ✓ done | `0006-note37-n-valued-extract.done.md` |
| 0007 | Design the real "elastic precision" residual from note 38 (and repair its formula) | ✓ done | `0007-note38-elastic-precision.done.md` |
| 0008 | Simulate the zero-trust border ABSORBING the framework (.tmf / audit / PCI-DSS) - with a compute model | ✓ done | `0008-note39-zero-trust-absorption-sim.done.md` |
| 0009 | double-check of the tri-pipe verdict (HUB-authored re-verification) | ✓ done | `0009-recheck-tripipe-verdict.done.md` |
| 0009 | Tri-Pipe heterogeneous engine + the Heterogeneous Handoff Invariant (skeptical eval + corrected maths) | ✓ done | `0009-tri-pipe-heterogeneous-engine.done.md` |
| 0010 | Nested quantum simulation inside the continuous engine - feasibility + governance | ✓ done | `0010-nested-quantum-in-continuous-engine.done.md` |
| 0011 | Realistic/partial governance mode ("auto", default "full") + governance caching | ⚠ partial | `0011-partial-governance-auto-mode.done.md` |
| 0012 | Reopened "watch" items (crypto stopgap / GateCache #194 / C++ bridge precondition) | ✓ done | `0012-reopened-triage-items.done.md` |
| 0013 | Make Galerina able to express standard data-structure / array benchmarks | ✓ done | `0013-galerina-express-standard-benchmarks.done.md` |
| 0014 | Fidelity Differential Harness (design + lowering-proof contract) | ✓ done | `0014-fidelity-differential-harness.done.md` |
| 0014 | 0014 re-check under PROVE-OWN-MATHS (standalone report) | ✓ done | `0014-recheck-prove-own-maths.done.md` |
| 0015 | Mid-Compute Capability Revocation (design — thin composition) | ✓ done | `0015-mid-compute-capability-revocation.done.md` |
| 0016 | Contract-driven test generator (galerina generate tests over GIR) | ✓ done | `0016-contract-driven-test-generator.done.md` |
| 0017 | First-class fault handlers (on_*_fault) — grammar/AST/GIR design | ✓ done | `0017-fault-handler-grammar.done.md` |
| 0018 | Capability->regulatory-control mapping + unified attestation report | ✓ done | `0018-capability-to-control-mapping-attestation.done.md` |
| 0019 | Photonic-hardware-READY observation seam (trit-watch / wave-probe) | ✓ done | `0019-photonic-ready-observation-seam.done.md` |
| 0020 | Disambiguate ambiguous citations · From Galerina-Encriptions R&D · Date 2026-06-18 · Status complete · doc-hygie | ✓ done | `0020-disambiguate-ambiguous-citations.done.md` |
| 0021 | Adversarial i32 cross-tier conformance + harness corpus · From Galerina-Encriptions R&D · Date 2026-06-18 · Stat | ✓ done | `0021-adversarial-i32-conformance-and-harness-corpus.done.md` |
| 0022 | Deterministic compute-gas + zeroize-on-trap proof | ✓ done | `0022-deterministic-gas-and-zeroize-proof.done.md` |
| 0023 | tower-citizen runtime verification access | ✓ done | `0023-tower-citizen-runtime-verification-access.done.md` |
| 0024 | Formal-verification prototype: Z3/SMT proof of cross-tier i32 conformance | ✓ done | `0024-formal-verification-z3-i32-conformance-prototype.done.md` |
| 0025 | Governance-as-T-MAC decision kernel | ✓ done | `0025-governance-as-tmac-decision-kernel.done.md` |
| 0026 | Kleene-semiring matrix formulation of governance | ✓ done | `0026-kleene-semiring-matrix-governance.done.md` |
| 0027 | Decouple governance from the de-colored eval core (emit a verdict trit-vector) · DONE | ✓ done | `0027-decouple-governance-from-decolored-eval.done.md` |
| 0028 | Photonic-HW-readiness mapping for the governance-T-MAC kernel | ✓ done | `0028-photonic-hw-readiness-governance-tmac.done.md` |
| 0029 | Linear sub-pipeline flattening onto the ternary T-MAC (which real flows qualify?) | ✓ done | `0029-linear-subpipeline-flatten-tmac.done.md` |
| 0030 | Flat SoA AST + constant-time governed traversal (two audited keepers) | ✓ done | `0030-flat-ast-and-constant-time-traversal.done.md` |
| 0031 | `boundary flow` proposal: honest verdict + the param-taint increment | ✓ done | `0031-boundary-flow-verdict-and-param-taint.done.md` |
| 0032 | Grounded "more stable than C++" per-axis analysis + prove-own-maths + the two liveness hazards | ✓ done | `0032-stability-vs-cpp-analysis-and-proof.done.md` |
| 0033 | Done 0033 — memory-safety vs the WASM path: intra-module gap, crypto secret-hygiene, + ternary tombstoning | ✓ done | `0033-memory-safety-vs-wasm-and-ternary-tombstoning.done.md` |
| 0034 | Memory-safety STANCE: Governed Capability + Ternary-Tagged (drop the Rust borrow checker) | ✓ done | `0034-memory-safety-stance-capability-ternary-not-rust.done.md` |
| 0035 | Trust-trit path-authorization + the mtrit mask (refined tri-pipe: the one genuine kernel) | ✓ done | `0035-governance-grid-path-authorization-and-mtrit-mask.done.md` |
| 0036 | AOT optimization adoption (classical tricks) + tensor-precompute re-verify | ✓ done | `0036-aot-optimization-adoption.done.md` |
| 0037 | Trit graph-query engine: performance tricks (DONE) | ✓ done | `0037-trit-graph-query-engine-performance.done.md` |
| 0038 | FAIL-OPEN: an i32-overflow trap assigned to a non-returned binding is silently DISCARDED | ✓ done | `0038-i32-overflow-fail-open-discarded-trap.done.md` |
| 0039 | Align the excluded benchmarks (matrix-multiply / tri-logic / data-query) to one unit per runtime | ✓ done | `0039-benchmark-unit-alignment.done.md` |
| 0040 | Design-by-Contract + formal verification for a stable Galerina runtime | ✓ done | `0040-design-by-contract-formal-verification-stable-runtime.done.md` |
| 0041 | Incremental / sub-expression memoization + content-addressed materialised store | ✓ done | `0041-incremental-memoization-and-materialized-results.done.md` |
| 0042 | WDM-ternary "Tri-Photonic" compute layer | ✓ done | `0042-wdm-ternary-tri-photonic-compute-layer.done.md` |
| 0043 | "Golden-standard" re-audit of the standing owner decisions (keep / revise / retire, with evidence) | ✓ done | `0043-golden-standard-decision-reaudit.done.md` |
| 0044 | "Predictability mass equation" / eigendecomposition skip-iteration | ✓ done | `0044-predictability-mass-equation-eigendecomposition.done.md` |
| 0045 | Structured engineering metadata & three-tier comment system | ✓ done | `0045-structured-engineering-metadata-and-comment-tiers.done.md` |
| 0046 | Type PLACEMENT (contract.types vs TypeScript-style top-level) runtime perf | ✓ done | `0046-type-placement-contract-vs-typescript-runtime-perf.done.md` |
| 0047 | Cross-platform "generated / do-not-edit" comment-marker survey + recommendation | ✓ done | `0047-cross-platform-generated-comment-marker.done.md` |
| 0048 | Testing strategy: gap-rank + prioritised "which test-types to add" | ✓ done | `0048-testing-strategy-which-test-types-to-add.done.md` |
| 0049 | USES/USEDBY dependency graph as a RUNTIME efficiency lever (demand-driven recompute) | ✓ done | `0049-uses-usedby-graph-for-runtime-efficiency.done.md` |
| 0050 | `galerina-telemetry-sidecar`: cloud-native BLIND structural observability | ✓ done | `0050-cloud-native-blind-observability-telemetry-bridge.done.md` |
| 0051 | "Ecosystem / social-computer" positioning + the verified-import model | ✓ done | `0051-ecosystem-social-computer-language-positioning-and-verified-imports.done.md` |
| 0052 | WASM compilation granularity: single- vs multi-module, packages OUTSIDE the app | ✓ done | `0052-wasm-compilation-granularity-single-vs-multi-module-packages-outside.done.md` |
| 0053 | Photonic PPU: emulator + cost model + switchable-package spec | ✓ done | `0053-photonic-ppu-emulator-and-cost-model.done.md` |
| 0054 | `hardware()` capability directive + per-tier (binary/hybrid/photonic) package topology | ✓ done | `0054-hardware-capability-directive-and-per-tier-packages.done.md` |
| 0055 | Beyond-bump memory architectures (tri/photonic substrate) | ✓ done | `0055-beyond-bump-memory-tri-photonic.done.md` |
| 0056 | Galerina Ecosystem Layouts: the App layer + the App-Framework layer (zero-trust, Tri-Pipe-ready) | ✓ done | `0056-ecosystem-layouts-app-and-app-framework-layer.done.md` |
| 0057 | Trusted↔Symbiote Tensor Handoff, Dual-Sympathy Components, and the Package-Manager Class Eliminated | ✓ done | `0057-symbiote-handoff-dual-sympathy-package-manager.done.md` |
| 0058 | Compile the App-Kernel Admission Gate to DSS.wasm on a minimal Wasmtime TCB (DRCM Phase 5) | ✓ done | `0058-kernel-as-dss-wasm-on-wasmtime-tcb.done.md` |
| 0059 | Formal proof STRUCTURE for the fault-tolerance model + external-review triage | ✓ done | `0059-formal-proof-structure-and-external-review-triage.done.md` |
| 0060 | TypeScript 7 "Go rewrite" + parallelization for toolchain speed | ✓ done | `0060-typescript7-go-rewrite-and-parallelization-for-toolchain-speed.done.md` |
| 0061 | Compiler R&D (first dedicated pass) | ✓ done | `0061-first-dedicated-compiler-rnd.done.md` |
| 0062 | 3rd-party package architecture: zero-trust, golden-standard, Tri-Pipe-transparent | ✓ done | `0062-third-party-package-architecture-zero-trust-tripipe-transparent.done.md` |
| 0063 | AI-driven chain-of-attack prevention | ✓ done | `0063-ai-driven-chain-of-attack-prevention.done.md` |
| 0064 | Should 3rd-party packages have a graph plugin? | ✓ done | `0064-third-party-package-graph-plugin.done.md` |
| 0065 | TLSTP (TriLogic Secure Transport Protocol): digital-core spec | ✓ done | `0065-tlstp-trilogic-secure-transport-protocol-digital-core-spec.done.md` |
| 0066 | B8 HTTP-transport: governed transport-adapter DESIGN | ✓ done | `0066-b8-http-transport-governed-adapter-design.done.md` |
| 0067 | Double-check boundary R&D + the prove-maths / formal-verification methods | ✓ done | `0067-boundary-rnd-and-prove-maths-methods-double-check.done.md` |
| 0068 | Galerina governance for REGULAR HTTP/SSL APIs (MITM & friends) | ✓ done | `0068-galerina-governance-for-regular-apis-http-ssl-mitm.done.md` |
| 0069 | Dynamic Trust Mesh → K3: continuous trust as DEGRADE-ONLY telemetry | ✓ done | `0069-dynamic-trust-mesh-as-degrade-only-k3-telemetry.done.md` |
| 0070 | Photonic / path-deviation "TamperTrust" resolver: degrade-only K3 signal | ✓ done | `0070-photonic-path-deviation-tampertrust-resolver.done.md` |
| 0071 | Reconcile the Governed Trust Capsule signing spec to ONE canonical method | ✓ done | `0071-reconcile-governed-trust-capsule-signing-spec.done.md` |
| 0072 | Prove-maths closure: vacuous proofs fixed, missing artifacts added, 0014-C3 promoted | ✓ done | `0072-prove-maths-closure-fix-vacuous-proofs-and-missing-artifacts.done.md` |
| 0073 | R&D-record hygiene: stale claims corrected, citations re-anchored, 0054 proof scripts authored | ✓ done | `0073-rnd-record-hygiene-stale-claims-and-citation-reanchor.done.md` |
| 0074 | CLOSURE INDEX: 0065–0070 open threads — disposition recorded | ✓ done | `0074-CLOSURE-INDEX-0065-0070-open-threads.done.md` |
| 0075 | Three defensive-publication notes (cited prior-art records, novelty disclaimed) | ✓ done | `0075-write-3-defensive-publication-notes.done.md` |
| 0076 | Measured-negative benchmark: K3 hard-fail vs soft-fail availability / false-deny cost | ✓ done | `0076-measured-negative-k3-hardfail-vs-softfail-availability-benchmark.done.md` |
| 0077 | 0077 follow-up — No-Coercion carryover to the unified lattice, machine-checked | ✓ done | `0077-followup-nocoercion-carryover-proof.done.md` |
| 0077 | #205: unify type-confidence + governance-verdict under one Kleene lattice | ✓ done | `0077-kleene-lattice-unify-type-confidence-and-governance-verdict.done.md` |
| 0078 | OCSP staple-caching for the TLSTP S1 revocation_fresh sub-verdict | ✓ done | `0078-ocsp-staple-caching-for-s1-revocation-fresh.done.md` |
| 0079 | Is the application-framework structure best for AI comprehension? | ✓ done | `0079-is-framework-structure-best-for-ai-comprehension.done.md` |
| 0080 | A contract{} memory-cleanup / arena-reuse directive | ✓ done | `0080-contract-memory-cleanup-directive.done.md` |
| 0081 | Per-component photonic/tri gap verdicts (architecture components) | ✓ done | `0081-component-photonic-tri-gap-verdicts.done.md` |
| 0082 | Per-package photonic/tri verdicts + missing/incomplete build status | ✓ done | `0082-packages-photonic-tri-and-missing-incomplete-status.done.md` |
| 0083 | Closed-capabilities × photonic/tri (security primitive gap) | ✓ done | `0083-closed-capabilities-photonic-tri.done.md` |
| 0084 | Security standards under K3 three-valued governance (the unknown→pass collapse) | ✓ done | `0084-security-standards-k3-three-valued-pci-owasp.done.md` |
| 0085 | RAG-vulnerabilities rulebook reconciliation + a K3 retrieval-trust design | ✓ done | `0085-rag-vulnerabilities-rulebook-curator-analysis.done.md` |
| — | Findings-verification bench (0021/0022 i32 conformance) | ✓ done | `findings-verification-bench.done.md` |
| — | OWED-closure pass (retro-audit → PROVEN) — 2026-06-18 | ✓ done | `owed-closure-2026-06-18.done.md` |
| — | Quantum-bridge APP-project R&D program | ✓ done | `quantum-bridge-app-project-rnd.done.md` |
| — | Roadmap §1 #4 (refinement) — Selective embedding-disclosure → trusted-zone ANN | ✓ done | `roadmap-1-4-selective-disclosure-ann.done.md` |
| — | Roadmap #2 — Revocation-registry wire format + fail-closed reference verifier | ✓ done | `roadmap-2-revocation-registry-reference.done.md` |
| — | Roadmap #3 — QRNG SP 800-90 conditioning-pipeline reference + bench | ✓ done | `roadmap-3-qrng-conditioning-pipeline-reference.done.md` |
| — | Roadmap "later/research" — FHE for encrypted similarity | ✓ done | `roadmap-fhe-encrypted-similarity.done.md` |

> Maintenance: append a row whenever a `done/NNNN-*.done.md` lands. Keep the *why* on refutals — that is the point.

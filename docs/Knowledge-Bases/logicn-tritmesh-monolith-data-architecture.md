# TritMesh Monolith + Data Architecture — Build Guide (note 41)

The adopted/grounded findings from the owner's `notes/41-tritmesh` (single-WASM monolith, zero-middleware,
govern-don't-absorb hot/cold data, data-oriented design, `.tmf` metadata, P2P). Companion to the note-42 transport
build-guides ([index](logicn-tlstp-build-guide-index.md)) and the grounded analysis
([logicn-transport-auth-research-explained-2026-06-22.md](logicn-transport-auth-research-explained-2026-06-22.md)).

**Honest framing up front:** unlike note 42 (which yielded the net-new 0065–0070 transport pieces), **most of note 41
re-derives shipped LogicN architecture or is refuted/HW-gated.** This guide states, per theme, exactly what is
SHIPPED (cite, don't rebuild), what is NET-NEW (buildable), what is REFUTED, and what is ASPIRATIONAL-HW. Binding
posture: crypto stays Binary; fail-closed; no perf claim without a named-machine bench.

---

## 1. Govern-Don't-Absorb (hot/cold data split) — SHIPPED invariant + the one net-new data-plane piece

### 1.1 What it is
The DB **governs** heavy data; it never **absorbs** it. A blob (video, image, archive) lives in cold object storage;
the hot TritMesh/`.tmf` layer holds only a tiny **passport**: a capability contract + a content hash + a pointer.
This is already a standing LogicN invariant (privacy/egress `SealTaint`, `LLN-PRIVACY-002`; the `.tmf` engine stores
metadata, not blobs). **Correction to the note:** the capability *grant* lives in the signed `.lmanifest` `fuse{}`
block, NOT in the `.tmf` (the `.tmf` is integrity/confidentiality only).

### 1.2 The maths — content-addressing + the authorization predicate
A blob `B` is chunked `B = b₁‖b₂‖…‖b_n`, each chunk E2EE-encrypted, and the **content identifier** is a hash tree:
```
CID = H( H(b₁) ‖ H(b₂) ‖ … ‖ H(b_n) )          H = SHA-256 (Binary, crypto-on-core)
```
The hot record is the passport `P = { CID, cap_required, sem_sig, uri_cold }`. The fetch authorization is a K3 conjunction:
```
fetch_allowed = decideAtBoundary( vAnd( cap_check, integrity_check ) )
  cap_check       = +1 iff the caller's manifest grants cap_required, else −1        (fuse-loader deny-by-default)
  integrity_check = +1 iff H(downloaded chunks) == CID, else −1                       (client re-hash)
```
**Tamper-evidence theorem.** Because `CID` is collision-resistant (SHA-256, ~2¹²⁸), a cold store that returns
`B' ≠ B` yields `H(B') ≠ CID` except with negligible probability, so `integrity_check = −1` → `fetch_allowed = deny`.
The cold store is therefore **untrusted by construction** — it can withhold or corrupt, never forge. (`vAnd = min`, so
a single −1 denies; see [logicn-tlstp-s1-cert-gate.md](logicn-tlstp-s1-cert-gate.md) §2 for the K3 lattice.)

### 1.3 Worked example
A 2 GB video, chunked into n = 4096 × 512 KB, E2EE'd, dropped in cold storage → `CID = 0x9f3c…`. Hot `.tmf`:
`{ CID:0x9f3c…, cap_required:"media.view", sem_sig:<256-trit>, uri_cold:"s3://…/9f3c" }`.
- **Authorized + intact:** caller has `media.view` (`cap_check=+1`); client downloads, re-hashes → `0x9f3c…` (`integrity_check=+1`); `vAnd(+1,+1)=+1` → allow.
- **Tampered (DENY):** store returns a swapped chunk; client hash = `0x9f3c…` ≠… → `0x71aa…` → `integrity_check=−1`; `vAnd(+1,−1)=−1` → deny.
- **Unauthorized (DENY):** caller lacks `media.view` → `cap_check=−1` → deny before any byte is fetched.

### 1.4 Tiers
- **SHIPPED:** the govern-don't-absorb invariant, content-addressing (B5a + `.tmf`), deny-by-default capability gate.
- **NET-NEW (buildable):** the **edge-client chunk → E2EE → CID upload pipeline** + the hot-passport `fetch_allowed`
  flow as a first-class data plane (the mechanic is sound; only the wiring is new).
- **REFUTED:** embedding a usable E2EE key in the `.tmf` (secret-handling violation → use the `logicn-ext-secrets-vault`
  + a KEM-wrapped key); balanced-ternary "semantic clustering" of `.tmf` on K3 trits (category error — similarity is
  an ANN/vector concern under `SealTaint`, never the governance trit).

---

## 2. Data-Oriented Design (SoA + zero-copy + arena + batching) — mostly SHIPPED

### 2.1 The maths
- **Structure-of-Arrays vs Array-of-Structures (cache lines).** A 64-byte cache line holds `⌊64/s⌋` contiguous
  fields of size `s`. Iterating one field over `N` records: AoS touches `N` lines (one per record, field scattered);
  SoA touches `⌈N·s/64⌉` lines. For `s = 4` (i32) that's a **16× fewer-misses** ceiling. LogicN's flat SoA AST is
  shipped (`Int32Array` val/parent + CSR children, measured 2.22×).
- **Arena bump allocator.** Allocation is `ptr += size; return ptr − size` — **O(1)**, no free-list. Per-flow reset is
  `ptr = HEAP_BASE` — **O(1)** reclamation of the whole arena; secret-zeroing on reset is `fill(0)` over `[HEAP_BASE,
  ptr)`. Shipped: `wat-emitter.ts` B1 `deriveArenaWATMemory` (ceiling from `contract.memory{arena}`, `WAT_HEAP_BASE=1024`),
  B2 per-flow `$__lln_heap` reset, B2b secret-zero on reset (R&D 0055). LogicN-compiled is GC-free monotone bump.
- **Zero-copy boundary.** A downstream stage reads bytes in place via `(ptr, len)` instead of copying — saves the
  `O(len)` copy + an allocation per hop. (Intra-module is free today; cross-trust-boundary zero-copy is #102-106-gated.)
- **Ring-buffer batching.** Amortize the host-boundary cost `C_switch` over `k` operations: per-op cost
  `= C_switch/k + C_op`, so a batch of `k` reduces the syscall tax by `k×`. (Designed in R&D 0058's byte-mover shim;
  substrate-gated.)

### 2.2 Worked example (arena)
Contract `memory{ arena: 64KiB }` → `WAT_HEAP_BASE=1024`, ceiling `1024+65536`. A flow allocs 3 records (40 B, 80 B,
24 B): `ptr` 1024→1064→1144→1168 (3 × O(1)). Flow exits → `ptr = 1024` (whole 144 B reclaimed in one op); if the flow
`handlesSecrets`, `[1024,1168)` is zeroed first. No GC, no per-object free.

### 2.3 Tiers
- **SHIPPED:** flat SoA AST (2.22×), arena bump + per-flow reset + secret-zero (0055), AOT const-fold/branch-fold/DCE (1.64×).
- **ASPIRATIONAL-HW:** cross-trust-boundary zero-copy IPC + the batched byte-mover ring-buffer (#102-106 WASM Component Model).
- **HONEST:** "DB engine" DOD is moot — the `logicn-data-*` packages are README/stubs (no `src/`); DOD ships for the AST/runtime, not a DB.

---

## 3. Single-WASM monolith / "zero-middleware = mathematical security" — half-decided, half-aspirational

### 3.1 The argument + its maths
Each middleware boundary (router, RPC, OS socket, DB driver) is an attack surface where data is (de)serialized and
can leak/corrupt. Collapsing `m` boundaries into one WASM linear-memory space removes `m` serialization seams; the
remaining trusted surface is the Wasmtime binary + a thin bootstrap shim. The *attack-surface-reduction* claim is
sound. The **"mathematical security"** claim, however, rests on **WASM linear-memory ISOLATION at the network
boundary** — which is **DRCM/DSS.wasm**, today a **115-byte placeholder** (`build/dss-supervisor.wasm`) with the real
~31 KB DSS still **uncompiled `.lln`**, blocked on #102-106 + Stage-B P9.4.

### 3.2 Tiers
- **DECIDED (deployment stance):** main-app-as-WASM + packages-outside (R&D 0052), explicitly **NOT a single monolith**
  ([logicn-build-output-and-env-secrets.md](logicn-build-output-and-env-secrets.md)). The shipped, citable half is the
  kernel anti-middleware pipeline + one-time fail-closed admission.
- **ASPIRATIONAL-HW:** the in-sandbox-isolation **guarantee** ([logicn-deterministic-runtime-containment.md](logicn-deterministic-runtime-containment.md), #102-106) — do NOT claim it as settled.
- **REFUTED (framing):** "single-WASM monolith = mathematical security" as settled architecture.

---

## 4. Tree-walker-into-WASM — the one concrete forward-design (NET-NEW, #125)

Note 41's sharpest idea: secure/effectful flows that can't be lowered to WASM (today they run in the host tree-walker,
gap #125) would, in a monolith, run a **tree-walker compiled INTO the WASM module** — so even un-lowerable governed
flows execute sandboxed from the host OS. Invariant-clean (no analog in crypto). **Tier: NET-NEW, tied to #125 +
DRCM** (needs the self-hosted Stage-B pipeline to compile the walker; substrate-adjacent).

---

## 5. `.tmf` metadata + P2P (Any-Sync) — engine shipped, mesh unbuilt
- **SHIPPED/decided:** the `.tmf` format + engine (`logicn-ext-tmf`), content-addressed signed admission.
- **UNBUILT (vision):** the live P2P/Any-Sync mesh (CID routing, Spaces, sharding, contextual hydration) — zero
  first-party implementation; content-addressed *identity* ships, the live P2P *transport/directory* does not. The
  real social-ecosystem build is a blind-observability telemetry sidecar (R&D 0050/0051), not a P2P DB.

---

## The hard path to go through (note 41)
1. **Already done — cite, don't rebuild:** arena + per-flow reset + secret-zero (0055), SoA AST, content-addressing,
   govern-don't-absorb invariant, `.tmf` engine.
2. **Net-new, buildable now:** the **edge-client chunk → E2EE → CID → hot-passport `fetch_allowed`** data plane (§1.4).
   *Hard part:* keep the cold store untrusted — client re-hash is mandatory; the `.tmf` carries no key (KEM-wrap +
   vault), no usable secret, no capability grant.
3. **Net-new, substrate-adjacent:** **tree-walker-into-WASM** (§4, #125) — gated on the self-hosted Stage-B pipeline.
4. **Do NOT claim:** in-sandbox-isolation "mathematical security" until DRCM/DSS.wasm is real (#102-106).
5. **Refused:** key-in-`.tmf`, semantic-clustering-on-trits, single-monolith-as-settled.

*Sources: `notes/41-tritmesh`; grounded in [logicn-tlstp-transport-auth-rnd-2026-06-22.md](logicn-tlstp-transport-auth-rnd-2026-06-22.md)
(cluster 8) + the explainer. Related R&D: 0052 (granularity), 0055 (arena), 0058 (DSS.wasm), 0050/0051 (telemetry vs P2P).*

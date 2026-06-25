# R&D 0109 — TritMesh "AZT Database" feature-list gap analysis (2026-06-24)

> **What this is.** The TritMesh 6-pillar feature list AND the positioning statement were both
> AI-generated (optimistic). This is the R&D that *improves and dismisses* them: it maps every
> claimed feature to the REAL status of shipped LogicN + prior R&D, separating (a) what is
> already covered, (b) the genuine reusable LogicN mechanics still worth building, and (c) the
> band that is TritMesh-product, #102-106/HW-blocked, or refuted physics. Workflow `w4yz0t10v`
> (7 agents). TritMesh is a SEPARATE product consuming LogicN governance — we are NOT building it.

## Bottom line

**~80% of the Zero-Trust feature surface is already covered** by shipped or RD-done LogicN
substrate. The genuine remaining work is **6 net-new reusable LogicN mechanics** (mostly
key-custody + wiring, no new crypto/science), plus a clearly-separated band of TritMesh-product
data-plane and #102-106/HW-blocked items. Two of the AI's headline features were shipped THIS
cycle: **`Result.Masked` partial returns** (R&D 0108 #2, `partial-return.ts`) and the
**Substrate Dispatch Gateway reprogram admission** (R&D 0108 #3, `photonic-admission.ts`).

## Coverage by pillar

| Pillar | shipped / rd-done / missing | Note |
|---|---|---|
| 1 — Data & Storage (.tmf) | 1 / 2 / 0 | container metadata/payload split + verify-before-decrypt + crypto-shred shipped; Shamir threshold + history-chain impl hide inside the rd-done rows |
| 2 — Identity & Auth (AZT) | 1 / 2 / 0 | K3 admission gate fully shipped (the reusable spine); gaps cluster on KEY CUSTODY, not governance logic |
| 3 — Governed Query (MeshQL) | 2 / 0 / 1 | Result.Masked + SQLi-impossible (typed Query + taint) shipped; the one gap = deny-by-default tenant-isolation border (highest-value item) |
| 4 — Communication (Transit) | 2 / 1 / 1 | Substrate Dispatch Gateway + diskless-secrets pkg shipped; TLSTP = RD-done design, narrow wiring owed; geo-sync = product; photonic throughput PROJECTED/HW-blocked |
| 5 — Runtime & Memory (Black Hole) | 2 / 0 / 1 | fail-closed K3 shipped; SealTaint ships the PROPERTY (compile-time taint) not the aspirational runtime address-tag; one clean gap in 5c (memory.fill + intrusion-arena-fill) |
| 6 — Audit & Self-Cert (Wedge) | 0 / 1 / 1 | proof CONTENT fully ships; gap = thin `.lproof` WASM custom-section wrapper (S); epoch-attestation watchdog genuinely missing + #102-106-blocked |

## The "improving" — 6 reusable LogicN mechanics worth building (ranked, no crypto/HW/substrate dep)

1. **Deny-by-default tenant-isolation border** (P3, `LLN-TENANT-001/002`) — **highest-value single item.** Vault tenancy defaults to `tenant_scoped`; `governance-verifier.ts` refuses to mint a manifest for a tenant_scoped vault whose data-access effect is not parameterized by the caller's proven `S_user` — a fail-closed **compile error**. Kills IDOR / OWASP-A01 at compile time. Capability intersection, NOT an AST/query-string rewriter (LogicN does not own the MeshQL string). [M]
2. **Shamir M-of-N threshold custody + distinct-signer K3 quorum** (P1 slice 4 / P2 2c) — the "no master key" + break-glass enabler. SSS over GF(2^8) + k-of-n quorum-counting gate as a shipped core module; algebra exists (`three-valued-governance.ts`), math benched 11/11. [M]
3. **`.lproof` WASM custom-section wrapper** (P6 6a) — embed the already-shipped `.lmanifest` + ProofGraph + Ed25519 attestation as ONE self-contained WASM custom section (proof travels inside the binary, not a sidecar). Plus flip the PCI 5/12 unmodeled families to INDETERMINATE→fail-closed. Content fully ships; this is the wrapper. [S]
4. **`.tmf` append-only history-chain impl** (P1 1c) — build `history-chain.ts` from the frozen `spec/tmf-history-chain-v0.md` (24-byte chain header, LINK(7) prev_root binding, per-epoch SHAKE256 erasure ratchet). MUST include the §5 verifier-side monotone-epoch / trusted-head freshness state — hash-links alone do NOT stop end-truncation/rollback. [M]
5. **Intrusion-Triggered Arena Fill** (P5 5c, the net-new Black-Hole mechanic) — (a) swap the O(arena) `i32.store` zeroing loop (`wat-emitter.ts:579-616`) for the WASM bulk-memory `memory.fill`; (b) wire a runtime K3 −1 DENY or `invariant{}` post-condition breach to fire the wipe **mid-execution** (verdict + zeroing + DbC breach all exist, unconnected). Digital wiring buildable now; true in-sandbox enforcement gated on DSS.wasm #102-106. [M]
6. **Small wiring** — S2 rekey trigger + replace `kernel.ts` presence-only auth with the shipped cert-gate channelVerdict (P4 4a); app-kernel diskless boot loader + #110 `secrets{}` binding (P4 4b); a fail-closed **TTL capability lease** (macaroon prior art) so delegated caps actually expire (cross-cutting). [S each]

## The "dismissing" — what the AI assumed that we do NOT build / cannot claim

- **TritMesh-product (consume shipped LogicN, do NOT build in this tree):** the live per-tenant encrypt/decrypt runtime store + hot-RAM-passport/cold-payload fetch-on-ALLOW data plane (1b); the MeshQL AST-rewriter + typed→execution-DAG planner over flat SoA (3a/3c); Any-Sync continuous CRDT/gossip geo-replication (4d). LogicN supplies only the format (`container.ts`), the K3 gate, governed visibility (redact/seal/SealTaint/partial-return), and the TTL lease.
- **#102-106 / HW-blocked (defer):** photonic throughput (4c — emulator only; ALL O(1) numbers projected, not measured); in-sandbox runtime *enforcement* of K3 verdicts and true per-address memory tags (5a/5b); the continuous epoch-attestation watchdog beyond a skeleton (6b); production private-key custody (offline keygen + HSM/KMS, #34/#107-109) which gates real `.tmf`/PQ signing.
- **Refuted framing to strip everywhere (incl. the positioning statement):** "single-clock-cycle / thermodynamic" wipe, quantum-evaporation, photonic O(1) / speed-of-light matmul, and **"mathematically impossible"-whole-engine** claims. The honest floor: **only the no-raw-string-injection class is literally provable**; capability confinement is provable *by construction*; buffer-over-read/query-leak *impossibility* needs the unshipped DSS isolation + MeshQL border. No new crypto or science anywhere (Shamir-1979, FIPS-204, Necula-1997 PCC, Datomic/event-sourcing, macaroons — all prior art → defensive-pub at most).

## Positioning-statement calibration (claims → evidence)

The statement's power is "trust the math," sold to regulated auditors — so every absolute word must map to a real artifact or it invites the audit it claims to pass. Defensible as-is: the **K3 fail-closed DENY (does not crash)**, the **`memory.fill(0)` arena wipe on flow exit (one atomic instruction doing Θ(arena-size) work — not "O(1)")**, the **immutable/tamper-evident `.tmf` ledger** framing, and the closer *"trusts the math."* Must calibrate: "mathematically proves buffer-over-reads/query-leaks **physically impossible**" → scope to *capability* confinement; "`.lproof` … statically verifies" → proof-graph real, full `.lproof` is gap #3; "**atomic memory isolation**" → taint-tracked SealTaint + arena (the host isolation is #102-106); "`.tmf` **secured by ML-DSA-65**" → construction shipped, `.tmf` PQ signing is gap #9/slice-4; "wipe **the millisecond an invariant is breached**" → on flow exit today, live-breach trigger is gap #5; "**downtime mathematically impermissible**" → fail-closed-not-crash, not an availability proof.

## See also
[[logicn-rd-tritmesh-1-5-and-52-3d-2026-06-23]] (R&D 0106-0108: the 52-head survey + the 3 net-new mechanics #1 shipped/#2#3 built this cycle) · [[logicn-tmf-engine]] · [[logicn-b8-governed-transport]] · `logicn-ext-tmf/spec/{threshold-custody,tmf-history-chain,signature-custody}-v0.md`.

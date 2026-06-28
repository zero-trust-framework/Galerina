# RD-0154..0167 — TritMesh / `.spore` mesh-database architecture

**Source.** Owner notes `notes/76-mesh-r-d-01..08.md` (2026-06-28) — a TritMesh/`.spore` *database* architecture
corpus (`.spore` = rebrand of `.tmf`). Mostly **database-side** R&D, considered for both TritMesh and Galerina.
The owner asked for **separate RD numbers per branch**; 8 notes → 14 branches.

**Hub disposition.** 7 parallel workers, **228 machine-checked assertions across 7 self-contained proofs, all
GREEN** (node built-ins only):
`scripts/rd-0154-0155-tritmesh-scaling-factcheck-proof.mjs` (45/45) ·
`rd-0156-photonic-wavefront-db-proof.mjs` (29/29) ·
`rd-0157-0159-virtual-wavefront-silicon-proof.mjs` (29/29) ·
`rd-0160-0161-tcsr-phasegraph-zerocopy-proof.mjs` (32/32) ·
`rd-0162-0164-tritsocket-tritrpc-proof.mjs` (26/26) ·
`rd-0165-tritssl-wavefront-tls-proof.mjs` (26/26) ·
`rd-0166-0167-cache-graph-spore-index-proof.mjs` (41/41).

> **Scoring note.** ZT = *net zero-trust soundness after refutation* (↑ = safer/sounder). RD-0166 was adjusted
> from the worker's `2` → **`5`** for consistency: it is a sound (if model-bounded) cache optimization with no
> security downside, so it should not sit with the refuted anti-patterns (0156/0165) at ZT 2.

## Per-branch verdicts

| RD | Note(s) | Topic | ZT | Verdict |
|---|---|---|:--:|---|
| 0154 | 01 | TritMesh scaling-walls + streaming/backpressure + hot-RAM memory-safety | **9** | ✅ ADOPT — graph has no max-column wall; the wasm32 wall is exactly 2³²=4 GiB and a chunked conveyor streams 500 GiB at a 256 MiB peak; backpressure bounds the buffer (unbounded OOMs at the predicted tick); 2²⁵⁶ hash space unreachable. **"memory-safe in production" ❌ overclaim** — WASM = host-isolation, not safety (an in-bounds intra-arena overflow traps nothing; the prod memory-gate is declared-but-not-enforced). |
| 0155 | 01 | TritMesh vs Postgres/Cassandra operational positioning | 6 | 🔭 TRACK — crypto-tax on write is real & measured; "self-healing / invincible / instant migration" are availability/UX properties, not safety guarantees (repair fails when all replicas corrupt → data unavailable, but safety holds). |
| 0156 | 02 | Photonic Interference Fabric / Holographic Wavefront DB | **2** | ❌ REFUTE core / 🔭 TRACK storage. Optical masking **is not encryption**: analog phase carries noise ε; pushing one symbol past its decision boundary flips a bit and avalanches ~½ the SHA-256 output → verify fails. "Search a billion records at light-speed" is **O(N)** (the detector must read N bins), not O(1). Holographic storage = legitimate future-HW TRACK; crypto/verdict stay digital. |
| 0157 | 02 | Virtual Wavefront Engine on binary silicon | 6 | 🔀 MIXED — sparse `r=Mq` is real **O(E)** vs dense O(n²); branchless SIMD a real but **modest** constant factor (~4.3×). ❌ O(1)/"a billion rows in one cycle"; ❌ `Mᵏ` "instant billion-node topology" (one multiply is O(n³)). |
| 0158 | 02 | Tri-Router (1/0/−1) + phase-shifted hot/cold dual-matrix | 8 | ✅ ADOPT **only with real crypto on the gate** — K3 routing checked against the shipped tower-citizen calculus (`min(1,0)=0→quarantine`, `¬(+1)=−1→wipe`, and the do-not-assume catch: `¬0=0`, not +1). Hot/cold Lambda merge proven correct by distributivity (must keep integer accumulators — trit-saturating the sum silently breaks it). |
| 0159 | 02 | Mycorrhizal Overlay — rebuild graph not data + border isolation | 7 | ✅ ADOPT — rebuilding an O(E) graph index ≪ rewriting O(bytes) data. **Re-derives [[galerina-rd-0150-graph-as-data-spine]]** (no-edge=no-reach, IDOR/CWE-639 structurally closed); novelty = silicon framing only. |
| 0160 | 03 | Next-gen graph: T-CSR + hyperbolic embeddings + semantic phase-hash | 7 | ✅ ADOPT w/ corrections — Ternary-CSR is genuinely **O(E)** (lossless round-trip), Poincaré-disk `dH` embeds a tree with lower distortion than Euclidean. Semantic phase-hash is **an honest tradeoff, not free**: 64-bit is collision-certain at 10¹¹ nodes (need ≥93 bits) and a 1-char typo avalanches ~½ the bits → kills fuzzy/prefix search. |
| 0161 | 03 | Symbiotic Index vs Pure-Phase + 100PB + NVMe-DMA zero-copy + decoupled | 8 | ✅ ADOPT (zero-copy + headless DiD) / ❌ REFUTE (O(1), "fits in WASM"). Full 100PB table arithmetic verified (8 TB/125 GB/171 TB/1.25 TB/3.2 TB); **none fit in 4 GB** — all STREAM (smallest 31× over) so "fits in WASM" is FALSE, "streams through" TRUE. NVMe-DMA zero-copy is real (~2.8× on one drive). Decoupled/headless `.spore`-stream-back = sound defense-in-depth. |
| 0162 | 04 | TritSocket (zero-copy websockets) | 8 | ✅ ADOPT zero-copy (io_uring/DPDK) + min-plus routing **inside the mesh** / ❌ REFUTE vector-auth-replaces-TLS (**runnable forgery** — public C → accepting S, no secret) + public-internet source-routing (sender controls only its first AS hop). |
| 0163 | 04 | Generic cross-language silicon package (new repo) | **9** | 🧪 DESIGN — sound deliverable = a ternary bit-packing + SIMD dot-product **PERFORMANCE pre-filter** lib (php/node/c++/c#/java/ts), a deny-only gate **in front of** real PQ crypto. ❌ "sold as security" by construction (the same kernel forges a credential from public C). Loud "does NOT replace TLS/auth" caveat is the contribution. |
| 0164 | 05 | TritRPC (gRPC overhaul) | 8 | ✅ ADOPT zero-copy serialization (mmap structs, FlatBuffers/Cap'n-Proto class) / ❌ REFUTE kill-mTLS-via-vector-auth; "kill HTTP/2 via io_uring" = real tradeoff forfeiting multiplexing/flow-control/HPACK/proxy interop. |
| 0165 | 06 | TritSSL / "Wavefront TLS" (next-gen SSL) | **2** | ❌ REFUTE core / ✅ ADOPT PQ subset. Deleting X.509/CA/handshake for a public `.spore` vector has **no identity binding** (forgeable, no secret), 0-RTT ≠ authenticated key exchange (static accept-vector is replayable; no key agreement), and Mach-Zehnder `I=2E₀²[1+cos Δφ]` is correct physics but analog (BER≈50% at the boundary). Sound: keep **ML-DSA/lattice**, model `.spore` as a signed PQ capability token **layered inside** CA-anchored TLS 1.3. |
| 0166 | 07 | Graph-driven CPU cache optimization (L1/L2/L3) | 5 | ✅ ADOPT (model-bounded) — AMAT `81→1.39 ns`, cache-line packing 256 two-bit edges/line (vs 2 at 32 B), `D=⌈Tmem/Tcompute⌉=50`, branchless trit-gate bit-identical over all 9 Kleene pairs, Huge-Pages TLB 262 144→1. ❌ "latency mathematically zero / absolute limit" (work stays Θ(n); only latency is hidden). |
| 0167 | 07,08 | Graph inside `.spore` as a **SIGNED** primary index + >4GB/>10GB synthesis | **8** | ✅ ADOPT, **GATED on mandatory index signing**. An in-`.spore` adjacency **index** is executable trust (reads follow it). **Proven exploit:** an *unsigned* index (outside the signed region) lets an attacker rewrite `colidx`, the Ed25519 signature **still verifies**, and a read of `balance` is silently redirected to `attacker_99999` (fail-open). Cover the index with the passport signature → identical tamper fails `verify()`, fail-closed, un-re-signable. Block-matrix chunking holds peak < 4 GB over 12 GB. The framework cross-checks the passport index vs a DB-rebuilt index → it's a signed *hint*, not the sole truth. |

## Load-bearing results

- **A ternary dot-product cannot replace cryptographic auth** (RD-0162/0164/0165). `I = S·C` is a linear functional
  with **zero unforgeability** — three independent runnable forgeries (copy public C to hit `I==256`; blind-amplitude
  clears a soft `I>0` gate at ~0.51/knock → P(breach in 20)≈0.99; algebraic non-uniqueness binds no identity). The
  keyed-MAC / ML-DSA control defeats all three because it holds a secret. **Sound use = a deny-only PRE-FILTER ANDed
  in front of real PQ crypto** (its false-ALLOWs can never manufacture a composed ALLOW).
- **Optical/analog ≠ crypto** (RD-0156/0165). Re-confirms the compute-only fence (`SPORE-SUBSTRATE-001`): noise breaks
  bit-exactness; light may *hint*, it must not *decide*. Crypto/verdict stay digital (Ed25519/ML-DSA).
- **Signed-index-or-poisoning** (RD-0167) — the strongest net-new ZT result; an unsigned in-passport index is a silent
  read-redirection vulnerability. Defensive-publication worthy.
- **Streaming, not fitting** (RD-0154/0161). Every "fits in 4 GB WASM" is false; the architecture *streams* (O(N),
  bandwidth-bound) under backpressure. SIMD/photonics/zero-copy cut the **constant**, never the **order**.

## Net-new buildable leads (owner-gated)

1. **Graph as a SIGNED primary index inside `.spore`** (RD-0167) — prototype behind a RED/perf harness; the signing
   requirement is mandatory, not optional. Overlaps [[galerina-rd-0150-graph-as-data-spine]].
2. **Cross-language ternary pre-filter library** (RD-0163, note 04 ask #2) — a new repo under `C:\wwwprojects`; a
   PERF gate only, never a security boundary; ship with the forgery caveat front-and-centre.
3. **Zero-copy data plane** (RD-0161/0162) — NVMe-DMA + io_uring + stream-backpressure for the TritMesh/Galerina
   egress path; the engineering (not the "O(1)") is the win.
4. **TritMesh deployment taxonomy** — Core / Symbiotic / Wavefront naming + the decoupled/headless architecture.

## Paper-worthiness

~12 **defensive-publication** candidates (the refutation write-ups + the signed-index result); **0 scientific-paper-grade**
(the engineering re-derives known CS — data-oriented design, CSR, hyperbolic embeddings, io_uring, tropical algebra).
Strongest defensive candidates: **RD-0167** (signed-index-or-poisoning) and **RD-0161** (zero-copy streaming appliance).

## Excluded / future-HW (named, not re-litigated)

Holographic/photorefractive crystals, AVX-512 lane-throughput envelopes, autonomous-AI flow-severing, photonic 0-cycle
"transmutation/spectral-shred", and any analog-as-authority claim → kept to their settled homes
([[logicn-compute-only-fence-and-wasm-verdict]], [[logicn-photonic-tri-rd]], [[feedback-most-secure-default-when-unsure]]).

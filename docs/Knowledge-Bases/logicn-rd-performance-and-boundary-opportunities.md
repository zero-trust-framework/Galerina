# Can the absorbed R&D improve LogicN performance, boundary, or memory?

**Status: analysis (2026-06-17).** An honest audit of whether the newly-absorbed R&D (the `.tmf`/encryption
lanes, photonic/quantum lanes, NVFP4, BitNet, substrate model, KEM-DEM, QRNG) offers anything for **(A)** LogicN
runtime / CPU / GPU performance, **(B)** the trust boundary, or **(C)** memory efficiency & security. Verdicts:
**✅ use** · **🛡️ guardrail (tells us what NOT to do)** · **⚠️ adjacent lane (ext/AI, not governance core)** · **❌ n/a**.

> **Headline:** most of this R&D is *governance/crypto*, not runtime tuning. It offers **boundary & memory-security**
> wins (real, buildable) and a few **guardrails**, but **no governance-hot-path speedup** — LogicN's runtime perf
> levers remain its own (WASM lowering, GateCache, V8 shape-stable objects). Don't let the crypto excitement
> misdirect perf work.

## A. Runtime / CPU / GPU performance
| R&D item | Verdict | What it actually means for LogicN |
|---|---|---|
| **Lane A — photonic-accelerated lattice signing** | 🛡️ guardrail | **Measured a wash** (offloadable fraction f≈28%, Amdahl ceiling ~1.4×, net ≈0.9× after conversion tax + re-verify). *Actively rules out* chasing photonic crypto acceleration. Don't build it. (`rd-absorbed/rd-photonic-accelerated-lattice-signing.md`) |
| **Measured crypto benchmark** (catalog App A) | ✅ use (cost model) | Real numbers say crypto is **not** the bottleneck: ML-KEM-768 encaps ~2k ops/s, AES-NI 1,273 MB/s; the genuine costs are **signature size** + **SLH-DSA-256s signing ~5 s**. → LogicN's crypto-effect cost model should keep PQ signing on the **cold path** (admission-time), never a hot loop. Already how slice 3/4 are scoped. |
| **NVFP4 4-bit codec** + **BitNet I2_S ternary kernels** | ⚠️ adjacent lane | Real GPU/CPU levers — but for the **AI-accelerator / inference** surface (`logicn-ai-linear-algebra-accelerator-support`, `logicn-precision-attestation`, `#201`), **not** the governance runtime. BitNet's T-MAC (add/sub/skip, no multiply) + NVFP4 9-byte blocks help *quantized model* throughput, governed as an ext bridge — they do nothing for `flow`/`contract` evaluation speed. |
| **Digital lattice accelerators** (Sapphire, KyberMat — from the encryption research) | ⚠️ adjacent | If LogicN ever hot-paths NTT/matrix-mod-q, the win is a **digital** systolic/ASIC accelerator (which removes the "analog" advantage). Crypto stays cold-path/ext, so this is reference-only. |
| **Substrate model (NMR/TMR)** | ❌ n/a (availability, not speed) | `vAnd`/consensus buys *availability under noise*, not throughput. No perf lever. |
| Photonic MVM / "ternary is faster" | 🛡️ guardrail | Explicitly rejected: trit packing **costs** cycles on commodity CPUs; ternary is a *modeling* choice (3-valued logic), ~1% storage premium, **not** a speed claim. Don't promise ternary speed. |

**Net (A):** the R&D gives a **cost model** (keep PQ on the cold path) and **guardrails** (no photonic/ternary
speed myths), plus an **AI-lane** opportunity (NVFP4/BitNet) that is ext, not governance core. The real
governance-runtime wins remain LogicN-native: WASM lowering of `for-in` (`#128`), `GateCache` (`#194`),
shape-stable security objects (`#127`), lexer/compiler passes.

## B. Trust boundary — security
| R&D item | Verdict | Boundary improvement |
|---|---|---|
| **KEM-DEM + committing-AEAD + verify-before-decrypt** (slice 3, shipped) | ✅ use | A hardened confidentiality boundary for any data LogicN governs at rest/in transit: §8.5 **CTX/CMT-4** closes partitioning-oracle / key-confusion attacks (Len–Grubbs–Ristenpart); **no-silent-downgrade** + fail-closed K3 = a reusable boundary template. |
| **"No cleartext semantic embedding across a trust boundary"** (U2 / `LLN-PRIVACY`) | ✅ use | vec2text recovers ~92% of short text ⇒ sharing embeddings ≈ sharing documents. A genuine egress rule for the boundary; partly shipped (`logicn-privacy-embedding-egress.md`), extensible to a checked diagnostic. |
| **QRNG entropy capability** (Q1 design) | ✅ use (when HW) | Hardens key/nonce generation **at** the boundary (side-channel/fault), fail-closed `entropy.qrng` (`LLN-ENTROPY-001/002`). Design done; HW-gated. |
| **PEP/PDP governance seam** (TritMesh design-note 02) | ✅ use (pattern) | A clean external-host boundary: enforcement point calls compiled `.lln` PDP across WASM, `unknown→deny`. Canonical reusable architecture (`logicn-tritmesh-boundary-and-seam.md`). |
| **Threshold (M-of-N) custody** | ✅ use (slice 4/5) | k-of-n signature quorum + k-of-n Shamir of the data key — a stronger multi-party boundary for high-value artifacts. |
| **Lane E QKD two-plane** | ⚠️ niche/HW | An *additional* physics lock on specific point-to-point links; combine-never-substitute, HW-gated. Boundary upgrade only for niche high-value links. |
| **ProofGraph governance signature binding** (CRYPTO-003, shipped) | ✅ use | Binds hardware-seal / epilogue / liability / hardening-tier into the canonical signing payload — a tamper-evident boundary attestation. |

**Net (B):** **strong, real boundary wins** — the committing-AEAD/verify-before-decrypt confidentiality boundary
(now buildable), the no-cleartext-embedding egress rule, QRNG-hardened entropy, the PEP/PDP seam pattern, and
threshold custody. Several are shipped or designed; the rest are buildable patterns.

## C. Memory — efficiency & security
| R&D item | Verdict | Effect |
|---|---|---|
| **Crypto-erasure / key-erasure ratchet** (history-chain, slice 5) | ✅ use (security) | Dropping a per-epoch key **crypto-erases** the data without touching the bytes — strong "forget" semantics for sensitive memory/storage. |
| **Key zeroization + committing-AEAD** (spec §7) | ✅ use (security) | Reader zeroizes derived keys on any failure; CMT-4 prevents one ciphertext opening under two keys (no key-confusion in memory). Pairs with the secret-taint / `seal()`/`redact()` discharge. |
| **NVFP4 9-byte block · 5-trits/byte packing (~1% overhead)** | ⚠️ adjacent (efficiency) | Real memory-density techniques — but for the **TritMesh/AI data plane** (embeddings, quantized weights), not LogicN's governance memory (arenas, request-scope, borrow/move/pinned). No gain for `flow`/contract state. |
| **Substrate `vAnd` redundancy (TMR)** | ❌ n/a | Costs memory (replication) for availability; not an efficiency win. |
| **Shape-stable security objects** (`#127`, LogicN-native) | ✅ use (both) | *Not* from this R&D, but the relevant memory+speed lever: fixed-shape Passport/PolicySnapshot/DecisionToken objects keep V8 hidden classes monomorphic — less churn, faster, lower memory. The actual LogicN memory optimization to pursue. |

**Net (C):** the R&D meaningfully improves memory **security** (crypto-erasure, key zeroization, committing-AEAD,
secret-taint) but offers little for LogicN memory **efficiency** — the density tricks are data-plane (TritMesh/AI),
and LogicN's own `#127` shape-stable-objects work is the real efficiency+security memory lever.

## Bottom line
- **Performance:** no governance-hot-path speedup from the R&D; it gives a crypto **cost model** + **guardrails**,
  and an **AI-lane** (NVFP4/BitNet) opportunity that is ext, not core.
- **Boundary:** **yes — multiple real wins** (committing-AEAD/verify-before-decrypt, no-cleartext-embedding,
  QRNG entropy, PEP/PDP seam, threshold custody).
- **Memory:** **security yes** (crypto-erasure, zeroization, no key-confusion); **efficiency mostly no** (density
  tricks are data-plane; pursue `#127` for LogicN itself).

## See also
`logicn-tmf-engine.md` · `logicn-quantum-resilience-roadmap.md` · `logicn-qrng-entropy-capability-design.md` ·
`logicn-tritmesh-boundary-and-seam.md` · `logicn-rd-absorption-catalog.md` · `logicn-performance-roadmap.md` ·
`logicn-substrate-contracts.md` · `logicn-tpl-bitnet-fidelity-audit.md` · `logicn-privacy-embedding-egress.md`.

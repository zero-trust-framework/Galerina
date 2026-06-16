# R&D Absorption Catalog — the complete ledger

**LogicN is the single "main library."** Every durable knowledge doc from the R&D repo
(`C:\wwwprojects\LogicN-R-AND-D`) is accounted for here so nothing is silently missing. Built from a 49-doc
classification sweep (2026-06-17), pinned to R&D commit **`238f07a`** (Lane E delta absorbed 2026-06-17; the earlier 29-doc sweep was captured at `fb68d06`). The standing import rule is the memory
`feedback-auto-import-rd-docs`; re-run it whenever R&D changes.

## How absorption works (the four dispositions)
- **vendored** → format **specs** copied into the engine package `packages-logicn/logicn-ext-tmf/spec/` (provenance pin in that folder's `PROVENANCE` note). These ARE the implementation contract.
- **mirrored** → durable research/strategy/findings copied **verbatim** into `docs/Knowledge-Bases/rd-absorbed/rd-*.md` with a provenance header. That subfolder is intentionally **not** scanned by `kb-graph` (scanner is non-recursive) so the mirrors carry their upstream-relative links without polluting the graph. They are still in the repo = in the library.
- **curated** → high-value strategic content rewritten as a flat first-class KB doc (graph-indexed): `logicn-quantum-resilience-roadmap.md`, and the pre-existing `logicn-*` docs listed under "native view".
- **catalog_only** → process/status/duplicate/superseded/gated docs that should NOT be imported as their own doc; their genuinely KB-absent facts are captured in **Appendix A** below.

> R&D remains **upstream/authoring**. Edit the source there, then re-vendor/re-mirror here. Do **not** fork the copies.

## 1. Specs — vendored into `logicn-ext-tmf/spec/`
`tmx-256-construction-v0` · `tmf-container-v0` · `tmf-modalities-v0` · `tmf-encryption-v0` · `signature-custody-v0` · `threshold-custody-v0` · `inclusion-proof-v0` · `tmf-history-chain-v0` · `governed-trust-capsule-v0` · `nvfp4-codec-v0`. Curated view: `logicn-tmf-engine.md`. The golden generators `tmf/spec/_vectors/*.py` stay upstream as the authoring oracle (binding conformance = the in-package golden tests).

## 2. Mirrored verbatim into `rd-absorbed/` (30 docs)
| R&D source | `rd-absorbed/` mirror | Curated/native view |
|---|---|---|
| QUANTUM-RESILIENCE-STANDARD-AND-ROADMAP.md | `rd-absorbed/rd-quantum-resilience-standard-and-roadmap.md` | **logicn-quantum-resilience-roadmap.md** |
| NOVELTY-AND-IP-ASSESSMENT.md | `rd-absorbed/rd-novelty-and-ip-assessment.md` | (primary home is the mirror) |
| VERIFICATION-FINDINGS-2026-06-16.md | `rd-absorbed/rd-adversarial-verification-findings-2026-06-16.md` | logicn-security-audit cluster |
| RESEARCH-PHASE-photonic-signing-and-trust-capsule.md | `rd-absorbed/rd-photonic-signing-and-trust-capsule.md` | logicn-quantum-resilience-roadmap.md |
| RESEARCH-PHASE-privacy-governance.md | `rd-absorbed/rd-privacy-governed-compile-time-primitive.md` | logicn-privacy-embedding-egress.md |
| tmf/research/external-repos-analysis.md | `rd-absorbed/rd-external-repos-grounding-ledger.md` | logicn-external-idea-mining-2026-06-15.md |
| tmf/research/photonic-lane-A-accelerated-signing.md | `rd-absorbed/rd-photonic-accelerated-lattice-signing.md` | logicn-quantum-resilience-roadmap.md |
| tmf/research/photonic-lane-B-quantum-digital-signatures.md | `rd-absorbed/rd-quantum-digital-signatures-lane-b.md` | logicn-quantum-resilience-roadmap.md |
| tmf/research/photonic-lane-C-optical-puf.md | `rd-absorbed/rd-photonic-lane-c-optical-puf.md` | logicn-quantum-resilience-roadmap.md |
| tmf/research/photonic-lane-D-qrng.md | `rd-absorbed/rd-qrng-entropy-source-for-hybrid-signing.md` | logicn-quantum-resilience-roadmap.md |
| tmf/research/photonic-lane-E-qkd-confidentiality.md *(238f07a)* | `rd-absorbed/rd-photonic-lane-e-qkd-confidentiality.md` | logicn-quantum-resilience-roadmap.md |
| tmf/research/photonic-ternary-in-tls.md | `rd-absorbed/rd-photonic-ternary-in-tls.md` | (bridge task 0002) |
| tmf/research/real-vs-aspirational-ledger.md | `rd-absorbed/rd-tmf-real-vs-aspirational-ledger.md` | logicn-tmf-engine.md |
| tmf/research/storage-and-query-v0.md | `rd-absorbed/rd-tmf-storage-and-query.md` | (gated — MeshQL/DB) |
| tmf/research/encryption-architecture.md | `rd-absorbed/rd-tmf-research-encryption-architecture.md` | logicn-tmf-engine.md |
| tmf/research/open-questions.md | `rd-absorbed/rd-tmf-research-open-questions.md` | logicn-tmf-engine.md |
| tmf/research/ternary-in-cryptography.md | `rd-absorbed/rd-tmf-research-ternary-in-cryptography.md` | logicn-quantum-resistance-posture.md |
| tri-encription/research/LLN-AMD-024-tmf-confidentiality.md | `rd-absorbed/rd-tmf-confidentiality-layout.md` | logicn-tmf-engine.md / tmf-encryption-v0 |
| tri-encription/research/photonic-sha256-integrity.md | `rd-absorbed/rd-photonic-sha256-integrity.md` | logicn-hardware-future-substrates.md |
| tri-encription/research/metadata-confidentiality.md | `rd-absorbed/rd-tri-encription-research-metadata-confidentiality.md` | logicn-privacy-embedding-egress.md |
| tri-encription/research/quantum-resilient-tri-encryption.md | `rd-absorbed/rd-tri-encription-research-quantum-resilient-tri-encryption.md` | logicn-tmf-engine.md |
| tri-encription/FINDINGS-AND-ROADMAP.md | `rd-absorbed/rd-tri-encription-findings-and-roadmap.md` | logicn-tmf-engine.md |
| tri-encription/lln/README.md | `rd-absorbed/rd-tri-encription-lln-readme.md` | logicn-rd-adoption-2026-06-16.md |
| RD-DIRECTION.md | `rd-absorbed/rd-rd-direction.md` | logicn-rd-adoption-2026-06-16.md |
| CROSSOVER-encryption-rnd.md | `rd-absorbed/rd-crossover-encryption-rnd.md` | logicn-tmf-engine.md |
| ENCRYPTION-RND-FULL-BRIEF.md | `rd-absorbed/rd-encryption-rnd-full-brief.md` | logicn-tmf-engine.md |
| diagnostics-namespace-rnd-response.md | `rd-absorbed/rd-diagnostics-namespace-rnd-response.md` | logicn-diagnostic-namespace-ownership.md |
| FFSM/ffsim-build-readiness.md | `rd-absorbed/rd-ffsim-build-readiness.md` | logicn-ext-bridge-quantum-design.md |
| FFSM/ffsim-op-catalog.md | `rd-absorbed/rd-ffsm-ffsim-op-catalog.md` | logicn-ext-bridge-quantum-design.md |
| privacy/privacy-governance-v0.md | `rd-absorbed/rd-privacy-governance-compile-time-design.md` | logicn-privacy-embedding-egress.md |

## 3. catalog_only (19 docs — not imported; disposition + reason)
| R&D source | Reason | Covered by |
|---|---|---|
| README.md, tmf/README.md | folder index / TOC | logicn-tmf-engine.md |
| RND-STATE.md | R&D master resume-state index | logicn-rd-adoption-2026-06-16.md (facts → App. A) |
| tmf/STATUS-AND-NEXT-STEPS.md | dated decision brief (engine-language fork now resolved → TS) | logicn-tmf-engine.md |
| tmf/research/findings-and-next-intentions.md | narrative status (facts → App. A) | logicn-tmf-engine.md |
| tmf/notes/1.md, 2.md, 3.md | early brainstorm; MeshQL/TUFC/transport are **gated R&D-only** | logicn-rd-adoption-2026-06-16.md |
| tri-encription/lln/logicn-gaps-candidate-issues.md | dogfooding bug log (GAP-1..4) | logicn-build-roadmap.md (#125–#128) |
| tri-encription/bench/README.md | benchmark data (numbers → App. A) | logicn-tmf-engine.md |
| photonic-tri-governance/00-OVERVIEW.md, README.md | session work-records | logicn-photonic-tri-substrate-rd-agenda.md |
| photonic-tri-governance/direction-b/{00,01}*.md | plan-and-log (Direction B) | logicn-substrate-contracts.md |
| photonic-tri-governance/direction-c/{00,01}*.md | plan-and-log (Direction C) | logicn-substrate-failure-model.md |
| FFSM/README.md, SESSION-HANDOFF.md | index / handoff | logicn-ext-bridge-quantum-design.md |
| FFSM/_raw-miner-findings.md | raw ffsim source-mining (facts → App. A) | logicn-ext-bridge-quantum-design.md |

Process/scratch deliberately **not** cataloged: `_session-bridge/*`, `*/notes/*` duplicates (`tri-encription/notes/1-3` == `tmf/notes/1-3`), probe `*.lln`, `spec/_vectors/*`, vendored `node_modules`.

## Appendix A — durable facts captured from non-mirrored docs
Facts genuinely absent elsewhere in the KB, preserved here so the library is complete.

**Measured crypto benchmark** (from `tri-encription/bench/README.md`; i9-9900K, Node v24.16.0, `@noble` 0.6.1 pure-JS, single-thread):
- ML-KEM-768 keygen/encaps/decaps **2,498 / 2,123 / 1,719 ops/s**; hybrid X25519+ML-KEM-768 606/237/285; ML-DSA-65 keygen/sign/verify **545 / 114 / 505 ops/s**.
- Hashes (pure-JS): SHA-256 210 MB/s; SHA3-256/SHAKE256 26 MB/s; AES-256-GCM 38 MB/s; TMX-256 full 21 MB/s; Reed-Solomon GF(256) k=10 m=4 encode/recover 159/248 MB/s.
- **Native (node:crypto/OpenSSL):** SHA-256 614 MB/s; SHAKE256 ≈0.81× SHA-256 (498 MB/s — choosing the XOF costs ~nothing on real HW); AES-256-GCM (AES-NI) **1,112–1,273 MB/s** (~34× the pure-JS floor); ChaCha20-Poly1305 pure-JS 182 MB/s (the no-AES-NI alt).
- **Per-64 KiB `.tmf` section round-trip** (seal→TMX root→sign→verify-before-decrypt→open): L3 (hybrid-768 + ML-DSA-65) **~27 ms**; L5 (hybrid-1024+P-384 + ML-DSA-87) ~43 ms; L5 + {ML-DSA-87, SLH-DSA-256s} AND **~5,265 ms** (SLH-DSA *signing* dominates; its verify ~13 ms so receivers are unaffected); receiver verify+open ~10–27 ms.
- **Read:** PQ KEM is not a speed problem (cost is ciphertext size 1088/1568 B); the real costs are signature *size* and SLH-DSA-256s *signing* latency (~5 s, cold-path only); AEAD is never the bottleneck.

**Golden-file facts** (from `tmf/research/findings-and-next-intentions.md`): container golden = **203 bytes**; passed **17 tamper + 11 bounds** fail-closed cases; NVFP4 golden block bytes `38a150413f00000000`. NVFP4 E2M1 has 8 explicit magnitudes {0,½,1,1½,2,3,4,6} (not 3 ternary states); there is a second-level per-tensor FP32 `global_scale` above the 1-byte E4M3 per-block scale; the idealized IEEE decode is wrong for the 0/0.5 subnormals (use the fixed value table).

**ffsim grounding** (from `FFSM/_raw-miner-findings.md`): 1-D Fermi-Hubbard norb=2 half-filling ground-state eigenvalue = **−6.000000000000** (exact, smallest golden); H2/STO-6G linear-method VQE `result.fun` = −0.970773. **Jordan-Wigner is provably non-bit-deterministic** (`par_iter().fold().reduce()` merges thread-local HashMaps in nondeterministic order → Pauli-coeff sums reassociate; tol cutoff can flip near-threshold terms) — the concrete proof that the bridge's `determinismMode` must be **tolerance, not exact**. Thread partitioning is host-dependent unless `RAYON_NUM_THREADS` is pinned.

**Other:** RFC 9964 (May 2026) specifics — COSE-ML-DSA: ML-DSA-65 = COSE alg `-49`, EMPTY ctx, signs the COSE `Sig_structure`; Trust Capsule moved domain separation into the signed `body_protected` `surface` label + `external_aad`. NIST **SP 800-226** grounds the privacy declassifier's `aggregate` label (DP ≠ anonymization; GDPR Art 5(1)(b)+89). GAP-4: `for…in` runs in the interpreter but the WASM wat-emitter has no `forEachStmt` case (emits a no-op stub) → roadmap **#128** (fail-loud). MeshQL/TUFC/Virtio-Trit/systolic-array transport (notes 1–3) remain **gated R&D-only** (not LogicN governance knowledge).

## See also
`logicn-tmf-engine.md` · `logicn-quantum-resilience-roadmap.md` · `logicn-rd-adoption-2026-06-16.md` · `feedback-auto-import-rd-docs` (the standing rule) · `packages-logicn/logicn-ext-tmf/spec/PROVENANCE.md`.

# LogicN — R&D Results Log (quick-lookup verdict table)

**Purpose.** One-glance lookup of *what R&D concluded and why* — **positive AND negative**. A REFUTED idea is as
valuable as an adopted one: recording *why we did not adopt* stops it being re-proposed (the corpus repeatedly finds
~80% of "new" ideas re-derive shipped architecture). **Standing process (owner 2026-06-23):** when an R&D job comes
back (`_session-bridge/done/NNNN-*.done.md`), the hub absorbs it into the KB and **adds a row here** — adopted or
refuted, with the reason — then refreshes the KB index. See [[feedback-rd-absorb-positive-and-negative]].

**Verdict legend:** ✅ ADOPTED (built/shipped) · 🧪 DESIGNED (KB design, build pending) · 🔭 TRACKED (track-not-build)
· ❌ REFUTED (not adopted + reason) · ⏳ PENDING (dispatched, awaiting `done/`) · 🔒 GATED (owner/HW/infra-gated).

> Full doc-level absorption history is in [logicn-rd-absorption-catalog.md](logicn-rd-absorption-catalog.md); per-cluster
> disposition tables (every finding, both directions) live in e.g. [logicn-transport-auth-research-explained-2026-06-22.md](logicn-transport-auth-research-explained-2026-06-22.md).
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
| 0085 | RAG-vulnerabilities rulebook-curator → reconcile `LOGICN_SECURITY_RULEBOOK` + RAG threat class | ⏳ |

## Adopted / Designed (recent)
| Topic | Verdict | Why / what | Ref |
|---|---|---|---|
| TLSTP S1 K3 cert/channel-validation gate | ✅ ADOPTED | revocation-unknown→DENY by the K3 algebra; reuses shipped `vAnd`/`allOf`/`decideAtBoundary`; no new crypto | cert-gate.ts; [s1 guide](logicn-tlstp-s1-cert-gate.md) |
| K3 three-valued governance (Direction A) | ✅ ADOPTED | fail-closed `DENY<INDET<ALLOW`; No-Coercion proven | three-valued-governance.ts |
| Substrate noise model / NMR (Direction C) | ✅ ADOPTED | closed-form von-Neumann redundancy; availability-not-safety | substrate-model.ts |
| `substrate{}` contract block (Direction B) | ✅ ADOPTED | tolerance/determinism for photonic/ternary substrates | logicn-substrate-contracts.md |
| DbC output post-conditions (R&D 0040) | ✅ ADOPTED | `invariant{ ensure result }` fail-closed at flow exit, all tiers | logicn-dbc-output-postconditions.md |
| `for…where` filtered iteration (R&D 0037) | ✅ ADOPTED | branchless predicated guard | for-where verdict |
| AOT const-fold + DCE (R&D 0036) | ✅ ADOPTED | proven 1.64× / 7.1× code-size win | aot-tricks verdict |
| Revocation registry enforcement | ✅ ADOPTED | `isKeyRevoked` wired into fuse/resolver/bridge; key `8eecf4…`→Deny | revocation-registry.mjs |
| `contract.permissions {}` device-grant clause | 🧪 DESIGNED | distinct V_PERM block + LLN-PERM-001..006, fail-closed | [permissions design](logicn-contract-permissions-design.md) |
| DRCM degrade-only photonic operand · CBOR SubstrateAttestation Tag-418 · economics/security photonic lanes | 🧪 DESIGNED | degrade-only (brake-only), keep crypto Binary | [architecture R&D](logicn-architecture-rd-2026-06-23.md) |
| FHE encrypted-similarity | 🔭 TRACKED | crypto-on-core-OK but never line-rate + solves a threat model LogicN doesn't have; selective-disclosure ANN dominates | rd-absorbed/rd-fhe-encrypted-similarity-v0.md |
| Real DSS.wasm / Wasmtime TCB (DRCM Ph5) | 🔒 GATED | #102-106 external-infra + owner gated | logicn-drcm.md |
| ML-DSA-65 hybrid `.lmanifest` signing (#34) | 🔒 GATED | verify is PQ-ready; signer build owner-gated (offline custody) | logicn-quantum-resistance-posture.md |

## Refuted — and WHY we did not adopt (the negative record)
| Idea | Verdict | Why refuted |
|---|---|---|
| Photonic SHA-256 / any crypto-on-photonic | ❌ REFUTED | crypto/keys stay Binary by invariant; analog can't be a key (No-Coercion); photonic = degrade-only operand only |
| Photonic state as a signature/auth byte | ❌ REFUTED | PAC-learnable optical state; crypto-on-core violation → demoted to a degrade-only K3 tamper signal *under* the digital Ed25519+ML-DSA-65 sig |
| Ternary Ephemeral Ratchet (analog `E_ternary` in the KDF) | ❌ REFUTED | hard crypto-on-core violation |
| Continuous float trust `T_c` as the gate | ❌ REFUTED | conflicts with discrete fail-closed K3 → telemetry-only, discretized via `vAnd` |
| TMX-256 / ML-DSA TritMesh stack for LogicN | ❌ REFUTED | keep SHA-256 (Grover→128-bit OK) + ML-DSA-65; no benefit to swapping |
| Z3/SMT proof for the cert-gate K3 algebra | ❌ REFUTED (2026-06-23) | a 4-factor `min` is already exhaustively tested by the 3⁴ truth table; Z3 belongs on tri-tier i32 conformance instead |
| Tri-logic "speeds up" JSON parsing | ❌ REFUTED | category error (K3 is governance, not parsing); the real win is a simdjson branchless classifier |
| Photonic tensor-precompute = O(1) | ❌ REFUTED | classic precompute trade (apply still O(N²); dense T_reach mem; fusion densifies 39×) — not O(1) |
| Cleartext semantic routing across a trust boundary | ❌ KILLED | LLN-PRIVACY-002 blocks cleartext semantic embeddings at network sinks |

> Maintenance: append a row whenever a `done/NNNN-*.done.md` lands. Keep the *why* on refutals — that is the point.

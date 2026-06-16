# Quantum-Resilience Standard & Roadmap (L0–L4)

**Status: strategy/standard doc (absorbed from R&D 2026-06-16/17).** Curated LogicN view of the `.tmf`
quantum-resilience standard. Verbatim R&D source: `rd-absorbed/rd-quantum-resilience-standard-and-roadmap.md`
(pinned R&D `fb68d06`); companion implementation brief: `notes/36-qtcripto`. Decision record for the *crypto*
posture is `logicn-quantum-resistance-posture.md` (this doc is the forward-looking standard + roadmap on top of it).

> **Posture (binding):** grounded + cited; honest-core vs aspirational kept strictly separate; **no security or
> performance number without a reproducible benchmark + the device it ran on**; no invented crypto; fail-closed
> (`unknown → deny`); **crypto-on-core** — the bit-exact trust primitive is always digital; photonics/quantum
> live *around* the gate, never inside it (`LLN-SUBSTRATE-001`).

## Bottom line
- **`.tmf` is quantum-*resistant* today, not quantum-*proof*.** Its security is PQC — standardized but
  **conjectural** (rests on unproven lattice/hash hardness). Strong, deployable, but not a proof.
- **"TRUE quantum resilience" = information-theoretic / unconditional security** (holds vs *any* adversary with
  unlimited classical+quantum compute, resting on physics/information theory, not a hard math problem).
- **Photonics can deliver information-theoretic *pieces*** — QKD (key distribution), QRNG (entropy), QDS
  (signatures) — each with hard physical limits, and **never** the bit-exact parts (hash/AEAD/verification).
- **No ITS drop-in at scale.** The honest, achievable target is **L3 = PQC everywhere + information-theoretic
  locks where physics allows**, combined so an attacker must defeat **both** a computational assumption **and** physics.

## The resilience ladder
| Level | Name | Rests on | Quantum status | `.tmf` |
|---|---|---|---|---|
| **L0** | Classical | RSA/ECC hardness | broken by Shor | rejected |
| **L1** | PQC (computational) | lattice/hash hardness (unproven) | resistant, conjectural | core of `.tmf` |
| **L2** | Hybrid PQC + classical | *both* a PQC and a classical assumption | resistant + transition hedge | **default today** |
| **L3** | Layered: PQC + ITS where possible | a computational assumption **AND** physics | resistant + physics floor | **the target** |
| **L4** | Fully information-theoretic | physics + information theory only | proof vs any adversary | constrained settings only |

`.tmf` sits at **L1/L2**. "TRUE" = **L4**; the realistic honest target is **L3** (L4 only on links/topologies where physically possible).
> Don't conflate this L0–L4 *resilience* axis with NIST *security-level* tiers (1–5); SLH-DSA is the NIST-level-5 hash-only hedge but is still computational (L1).

## What `.tmf` has (L1–L2) and the gap
- **Today:** ML-KEM-768/1024 (FIPS 203, hybrid X25519/P-384); ML-DSA-65/87 (FIPS 204) + SLH-DSA (FIPS 205), hybrid Ed25519; SHAKE256/SHA-256 256-bit (Grover-safe — preimage→~128-bit; BHT ~n/3 collision is huge-memory/impractical); AES-256-GCM / ChaCha20-Poly1305. **Every row is computational.**
- **The gap (none of these is ITS):** ❌ no ITS confidentiality (no OTP/QKD-keyed channel — *the biggest, least-assessed gap* → Lane E); ❌ no ITS signatures (QDS exists but sub-1-Hz, no PKI → Lane B); 🟡 ITS entropy partially in reach (QRNG → Lane D); ❌ no physics-based guarantee anywhere in the trust path (by design — crypto-on-core).

## ITS primitives and their non-negotiable conditions
| Primitive | ITS guarantee | Hard conditions |
|---|---|---|
| **One-Time Pad** (Shannon 1949) | perfect secrecy | key truly-random, ≥ message length, used once, secret → reduces to **key distribution** |
| **QKD** (BB84 1984 / E91 1991, no-cloning) | ITS key agreement; eavesdropping is detectable | (a) **authenticated** classical channel — QKD does *not* authenticate (MITM-able without PQC/pre-shared auth); (b) characterized/trusted devices (DI-QKD removes this but ~0.07 bits/event — Nature 2022); (c) point-to-point reach; multi-hop needs **trusted nodes that see the key** (breaks end-to-end ITS) or immature repeaters; (d) single-photon/SNSPD hardware |
| **QDS** (Gottesman–Chuang 2001) | ITS signatures | sub-1-Hz, **no PKI**, closed enrolled group, quantum channels |
| **QRNG** | ITS randomness | a *source* not a primitive; must pass SP 800-90B health + 90A DRBG; **never raw bits → key** |

**Unavoidable truths:** authentication is not free (QKD/OTP give secrecy, not identity → still need a PQC/QDS authenticator); key distribution *is* the whole problem; therefore L4 is only achievable in constrained settings, and at internet scale the ceiling is **L3**.

## The photonic lanes
| Lane | Capability | ITS? | Verdict |
|---|---|---|---|
| **A** | photonic-*accelerated* lattice signing | ❌ | **REJECTED permanently** — measured *wash* (f≈28%, Amdahl ceiling ~1.4×, net ≈0.9× after conversion tax + re-verify). See `rd-absorbed/rd-photonic-accelerated-lattice-signing.md`. |
| **B** | QDS (quantum digital signatures) | ✅ | **track-not-build** — inert AND-only Tier-B `alg` slot already specified. `rd-absorbed/rd-quantum-digital-signatures-lane-b.md`. |
| **C** | optical-PUF (hardware identity) | ❌ | defense-in-depth only, never sole factor (ML-learnable). `rd-absorbed/rd-photonic-lane-c-optical-puf.md`. |
| **D** | QRNG (entropy) | ✅ | **integrate as a governed capability** (the cheap, real ITS upgrade). `rd-absorbed/rd-qrng-entropy-source-for-hybrid-signing.md`. |
| **E** | QKD/OTP (confidentiality) | ✅ | **SURVEYED 2026-06-17 — track + define interface** (`rd-absorbed/rd-photonic-lane-e-qkd-confidentiality.md`). QKD-keyed AEAD (not OTP — rates too low); combine via RFC 9370; QKD-only profile forbidden. |
| — | photonic MVM/hash/AEAD as the *primitive* | ❌ | **REJECTED permanently** — analog ≤~6–10-bit can't hold bit-exact crypto (crypto-on-core). |

## The hybrid key-establishment combiner (Lane E shape)
`K_final = KDF(K_pqc ‖ K_qkd)` via a standard-conformant combiner (**ETSI TS 103 744** CatKDF/CasKDF over HKDF/RFC 5869; IETF key-combiner drafts; **RFC 9370** Multiple Key Exchanges in IKEv2) — confidentiality holds if **either** input key is secret → an independent ITS lock on top of the KEM. **Caveat:** the independence is for *confidentiality only* — the QKD link's *authentication* still rests on the PQC/pre-shared authenticator, so both locks share an authentication root.

## Lane E — QKD/OTP confidentiality (surveyed 2026-06-17)
Full survey: `rd-absorbed/rd-photonic-lane-e-qkd-confidentiality.md` (web-cited). It fills the §Q2 gap and answers the `notes/36-qtcripto` deployment question.
- **QKD-keyed AEAD, not OTP.** QKD rates are kbit/s–Mbit/s at metro range, collapsing to **~0.0034 bps at the 1,002 km twin-field record** (Liu et al., PRL 130, 210801, 2023); satellite (Micius) ~kHz; DI-QKD ~0.07 bits/event. OTP needs a key as long as the message → impossible at bandwidth; so the slow QKD key only **seeds/refreshes** the existing digital AEAD key (crypto-on-core: QKD sits *before* the cipher, like QRNG).
- **Four blockers → track-not-build** (mirrors Lane B): authentication gap (QKD does **not** authenticate → PQC stays mandatory, never replaced); trusted-node problem (multi-hop relays *see* the key → not end-to-end ITS); rate/distance/hardware; agency guidance (NSA/NCSC/BSI/ANSSI: PQC primary, QKD niche).
- **Governed interface:** a **reserved-future** `kem_profile` "hybrid + QKD" (not allocated until vetted HW); QKD is **only ever an additional combiner input** — a **QKD-only profile is forbidden**; the QKD classical channel is authenticated by the shipped **#34 hybrid signer** (no new authenticator); a policy that *requires* the QKD lock resolves **`unknown → deny`** when the link is unavailable (must **not** silently fall back to PQC-only); `K_qkd` is established out-of-band and consumed **locally** — never on the wire.
- **Deployment — two planes** (answer to `notes/36-qtcripto`): (1) a universal always-on **PQC plane** (KEM-DEM + #34 signer) over the open internet — the floor; (2) an opt-in **QKD dark-fibre plane** between equipped node *pairs* establishing `K_qkd` out-of-band. The sealed `.tmf` (keyed with `K_final`) then flows over the **normal internet** — only the *key* was strengthened on the dark-fibre plane. Nodes are dual-homed; QKD is link-local, PQC is wide-area. Best topologies: datacenter/rack interconnect, metro point-to-point, satellite uplink.
- **Measured (digital half only — `qkd-hybrid-bench.mjs` 9/9, i9-9900K):** the BB84 sim detects eavesdropping (clean QBER 0% → accept; intercept-resend **25.2% > 11%** → abort); the combiner is **either-half-holds**; it is **one SHAKE256 call (~124k ops/s)** vs ML-KEM-768 encaps ~1,520 → **the QKD lock is ~free on the digital side.** ⚠️ The real QKD key-rate is a **hardware-gated theoretical gap**; the BB84 sim is **noiseless** (real channels carry ~1–5% baseline QBER, which is why the abort threshold is ~11% not 0%) — it shows the *principle*, not a real link, and omits error-correction + privacy-amplification.

## Roadmap (R&D + interface work; hardware integration owner- and availability-gated)
- **Q0 — PQC baseline + hybrid (L2). ✅ DONE / shipping.** The always-present base layer.
- **Q1 — QRNG entropy capability (Lane D). 🟢 buildable as an interface now.** Host SP 800-90B source → 90A DRBG → keygen/nonce behind the LogicN capability boundary, **fail-closed on a failed health test**. Acceptance: a NIST-ESV-validated QRNG + a measured RBG2/RBG3 throughput on named HW. (Benefit at signing is side-channel/fault hardening, not more unforgeability.)
- **Q2 — Lane E: QKD/OTP survey + governance interface. 🟡 track + define.** The QKD sibling of Lane B + the hybrid-KDF profile above. Track + keep the interface defined and inert until a vetted QKD link + reproducible key-rate measurement exists. **Survey now written** (`rd-absorbed/rd-photonic-lane-e-qkd-confidentiality.md`, 2026-06-17) — see the Lane E section below.
- **Q3 — QDS Tier-B (Lane B). 🟡 track.** Interface defined; stays track-not-build until the four Lane-B acceptance criteria hold.
- **Q4 — research horizon. 🔬 watch only.** Device-independent QKD/QDS, quantum repeaters / twin-field, MDI-everywhere.

### Target architecture (L3 where topology allows)
```
Confidentiality = PQC KEM-DEM  ⊕(KDF)  optional QKD/OTP key (point-to-point)   → break BOTH math AND physics
Entropy         = QRNG (ITS) → SP 800-90B health → 90A DRBG → every key/nonce
Authenticity    = PQC ML-DSA (+Ed25519 hybrid, +SLH-DSA level-5)  +  optional QDS AND-term (track)
Integrity/hash/AEAD = DIGITAL, bit-exact (crypto-on-core) — NEVER photonic
Governance      = K3 three-valued gate; any capability unavailable ⇒ unknown → deny (fail-closed)
```

## Will NOT do (with reasons)
Photonic/analog as the cipher/hash/signature/verification primitive (precision wall + conversion-tax wash — **permanently rejected**); bespoke "ternary crypto" / quantum-flavoured cipher (invented crypto; ternary's only honest crypto role is NTRU/ML-KEM lattice polynomials, tri-logic is the *governance gate*); QKD as a general PQC drop-in (NSA/NCSC/BSI/ANSSI consensus: PQC primary, QKD niche-only — ANSSI: "extra physical security … not a replacement"; NSA CNSA 2.0 mandates PQC; EuroQCI is a counterpoint, so not globally universal); one-time-pad at scale; building quantum hardware (integrate *vetted* HW only); any ITS/security/performance number without a reproducible benchmark + the device; replacing the digital bit-exact core.

## Implementation brief (from `notes/36-qtcripto`)
A concrete L3 engineering brief: **Lane D** — pipe physical QRNG (e.g. ID Quantique Quantis) through SP 800-90B health → 90A DRBG → ML-KEM seeds/nonces, fail-closed on health-test failure. **Lane E** — `K_final = KDF(K_PQC ‖ K_QKD)` over a point-to-point fibre link (refs: RFC 9370, ETSI ISG QKD, CNSA 2.0). **Lane B** — the tripartite **AND gate**: `if (verify_ML_DSA() && verify_QDS()) accept_file()` for small enrolled groups. Library pointers it raises: Open Quantum Safe **liboqs**, Rust **pqcrypto** crates, **SimulaQron** (QKD dev simulator), Qiskit/ffsim (decoherence sim).

> ⚠️ **Superseded framing:** `notes/36` frames the engine as a Rust `libtmf_core` built on liboqs/pqcrypto. That is **superseded** — the owner decision (2026-06-16) builds the engine in-repo as the **TypeScript** ext package `logicn-ext-tmf` on `@noble/post-quantum` (crypto-on-core, deterministic). Treat liboqs/pqcrypto/SimulaQron as *reference/validation* options for the host-side QKD/QRNG hardware lanes, **not** as a directive to rewrite the engine in Rust. See `logicn-tmf-engine.md`.

## See also
`logicn-quantum-resistance-posture.md` · `logicn-tmf-engine.md` · `logicn-rd-absorption-catalog.md` · `logicn-substrate-failure-model.md` · `logicn-post-quantum-hardware-security.md`. Verbatim sources under `rd-absorbed/` (lanes A–D, signing/trust-capsule, the standard).

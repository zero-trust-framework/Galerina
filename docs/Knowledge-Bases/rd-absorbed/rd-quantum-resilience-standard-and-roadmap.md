<!-- ABSORBED R&D SOURCE — verbatim mirror. LogicN is the main library; the R&D repo is upstream/authoring.
     Source: LogicN-R-AND-D/QUANTUM-RESILIENCE-STANDARD-AND-ROADMAP.md  ·  Pinned: R&D 238f07a (2026-06-17)
     Integrated LogicN view: logicn-quantum-resilience-roadmap.md  ·  Catalog: logicn-rd-absorption-catalog.md
     Rule: edit the upstream source then re-vendor; do not fork this copy (feedback-auto-import-rd-docs). -->

> **Absorbed R&D source (verbatim).** Curated/integrated view: `logicn-quantum-resilience-roadmap.md`. See `logicn-rd-absorption-catalog.md`. Internal links below point at the upstream R&D tree.

---
# `.tmf` quantum resilience — what we have, the TRUE-resilience standard, and the roadmap

> **Status:** R&D strategy doc, 2026-06-16. **Posture (binding):** grounded + cited; honest-core vs aspirational
> kept strictly separate; **no security or performance number without a reproducible benchmark + the device it
> ran on**; no invented crypto; fail-closed (`unknown → deny`); **crypto-on-core** (the bit-exact trust primitive
> is always digital; photonics/quantum live *around* the gate, never inside it).
> **What this answers:** "is `.tmf` *truly* quantum-resilient, and can photonic logic raise it to a higher
> standard?" — with an explicit roadmap and an explicit **will-not-do** list.

---

## 0. Bottom line up front
1. **`.tmf` is quantum-*resistant* today, not quantum-*proof*.** Its security is **post-quantum cryptography
   (PQC)** — classical algorithms believed hard for quantum computers, resting on **unproven computational
   hardness assumptions** (lattices, hashes). That is the strong, deployable, standards-backed state of the art —
   but it is *conjectural*, not *unconditional*.
2. **"TRUE quantum resilience" means a strictly higher bar: information-theoretic / unconditional security** —
   security that holds against **any** adversary with **unlimited** (classical or quantum) computing power,
   resting on **physics and information theory**, not on a math problem staying hard.
3. **Photonics genuinely can deliver information-theoretic *pieces*** — key distribution (QKD), entropy (QRNG),
   signatures (QDS) — **but each has hard physical/operational limits**, and photonics **cannot** do the
   bit-exact parts (hashing, the AEAD, signature verification): those stay digital (the precision wall, already
   settled — Lane A wash + crypto-on-core).
4. **There is no information-theoretic drop-in at scale.** Full unconditional security is only physically
   realizable in *constrained* settings (point-to-point links, special hardware, closed groups). The honest,
   achievable upgrade is a **LAYERED standard**: PQC everywhere **+** information-theoretic locks **where physics
   allows**, combined so that breaking confidentiality requires defeating **both** a computational assumption
   **and** physics.

---

## 1. The resilience ladder (define the levels)
| Level | Name | Security rests on | Quantum status | Where `.tmf` is |
|---|---|---|---|---|
| **L0** | Classical | RSA/ECC hardness | **Broken** by Shor | — (rejected) |
| **L1** | PQC (computational) | lattice/hash hardness (**unproven**, believed quantum-hard) | Resistant, conjectural | core of `.tmf` |
| **L2** | Hybrid PQC + classical | *both* a PQC and a classical assumption | Resistant + transition hedge | **`.tmf` default today** |
| **L3** | **Layered: PQC + information-theoretic where possible** | a computational assumption **AND** physics | Resistant + a physics floor | **the target** |
| **L4** | **Fully information-theoretic / unconditional** | physics + information theory only (no computational assumption) | **Proof** (vs any adversary) | only in constrained settings |

**`.tmf` sits at L1/L2.** "TRUE quantum resilience" is **L4**; the realistic, honest target is **L3** (L4 only on
links/topologies where it is physically possible).

---

## 2. What `.tmf` HAS today (L1–L2) — and the honest caveat
| Layer | Primitive | Quantum posture | Rests on |
|---|---|---|---|
| Confidentiality (KEM) | ML-KEM-768/1024 (FIPS 203), hybrid w/ X25519/P-384 | PQ; defeats harvest-now-decrypt-later | **module-lattice (MLWE) hardness — unproven** |
| Authenticity (sig) | ML-DSA-65/87 (FIPS 204) + SLH-DSA (FIPS 205) | PQ; hybrid w/ Ed25519 | **MLWE/MSIS (ML-DSA); hash security (SLH-DSA)** |
| Integrity (hash) | SHAKE256 / SHA-256, 256-bit | Grover-safe for *preimage* (quadratic → ~128-bit); *collisions* weakened at most to ~n/3 by BHT (impractical — huge quantum memory) ⇒ 256-bit keeps a comfortable margin | hash one-wayness/collision resistance |
| Symmetric (AEAD) | AES-256-GCM / ChaCha20-Poly1305, 256-bit | Grover-safe | block-cipher/PRF security |

**The caveat that defines the gap:** every row above is **computational**. A `.tmf` is secure *as long as the
lattice/hash problems stay hard* — a belief, NIST-standardized and well-studied, but **not a proof**. None of it
is information-theoretic. SLH-DSA is the most conservative (hashes only, no lattice), which is why it's the
**NIST-level-5** cold-path hedge (a NIST *security-level* tier — distinct from this doc's L0–L4 *resilience*
ladder; don't conflate the two axes) — but it is still computational. **That conjectural foundation is exactly
what L3/L4 aim to backstop with physics.**

---

## 3. What `.tmf` does NOT have (the gap to TRUE / information-theoretic)
- ❌ **No information-theoretic confidentiality** (no one-time-pad / QKD-keyed channel). *This was the biggest gap
  — now **assessed** in [`tmf/research/photonic-lane-E-qkd-confidentiality.md`](tmf/research/photonic-lane-E-qkd-confidentiality.md)
  (the digital half benched 9/9).* No ITS confidentiality *ships* today; the photonic lanes covered signing (A/B),
  identity (C), and entropy (D), and **Lane E now covers QKD/OTP for confidentiality** (constrained: QKD-keyed
  AEAD, not OTP; point-to-point; combine never substitute).
- ❌ **No information-theoretic signatures** — QDS exists and *is* ITS, but is sub-1-Hz, has no PKI, and needs
  quantum hardware → **Lane B, track-only** (already assessed).
- 🟡 **ITS entropy is partially in reach** — QRNG is a real, standardized ITS entropy *source* (not a primitive),
  deployable via the SP 800-90 pipeline → **Lane D, peripheral** (already assessed).
- ❌ **No physics-based guarantee anywhere in the trust path** — integrity, authenticity, and the AEAD are all
  digital-computational, by design (crypto-on-core).

---

## 4. The standard for TRUE quantum resilience (what must be achieved)
**Information-theoretic security (ITS) / unconditional security:** the adversary may have unlimited classical and
quantum computing power and still learns nothing (confidentiality) or cannot forge (authenticity), because the
guarantee is **physics/information theory**, not a hard problem. The building blocks and their *exact* conditions:

| Primitive | The ITS guarantee | The non-negotiable conditions (this is where it gets hard) |
|---|---|---|
| **One-Time Pad** (Shannon 1949) | perfect secrecy of a message | key must be **truly random, as long as the message, used once, and secret** — so the whole problem reduces to **distributing that much secret key** |
| **QKD** (BB84 1984; E91 1991) | ITS *key agreement* — eavesdropping disturbs the quantum states and is **detectable** (no-cloning) | **(a)** an **authenticated** classical channel (QKD does **not** authenticate — needs pre-shared keys or a classical/PQC signature, or it's MITM-able); **(b)** **characterized/trusted devices** (device-independent QKD removes this but is far slower — the 2022 Nature DI-QKD demo: ~0.07 bits/entanglement-event); **(c)** **point-to-point** reach (distance/rate limited; multi-hop needs **trusted nodes** that *see the key* — breaking end-to-end ITS — or immature quantum repeaters); **(d)** special hardware (single-photon optics, often SNSPDs) |
| **QDS** (Gottesman–Chuang 2001) | ITS *signatures* (no-cloning) | sub-1-Hz, **no PKI** (closed enrolled group, non-copyable key material), quantum channels — **Lane B** |
| **QRNG** | ITS *randomness* (true unpredictability) | a *source*, not a primitive — must pass SP 800-90B health tests + SP 800-90A DRBG conditioning; **never raw bits → key** — **Lane D** |

**The unavoidable truths of the standard:**
- **Authentication is not free.** QKD/OTP give *secrecy*, not *identity*. You still need a signature to know who
  you're talking to — and the only deployable ones are **PQC** (or QDS, which has no PKI). So **ITS confidentiality
  is bootstrapped on a (PQC or pre-shared) authenticator.** Pure ITS does not escape this.
- **Key distribution is the whole problem.** OTP is trivial *given* a shared random key as long as the message;
  QKD is one way to make that key with ITS — but only point-to-point, slowly, with special hardware.
- **Therefore L4 (full ITS) is only achievable in constrained settings.** At internet scale, open-world, anyone-
  can-verify, the honest ceiling is **L3** (PQC + ITS where physics allows).

---

## 5. The honest photonic landscape (what photonics gives — and can't)
| Photonic capability | ITS? | What it genuinely gives | Hard limits | Project lane | Verdict |
|---|---|---|---|---|---|
| **QKD** (key distribution) | ✅ (under §4 conditions) | a shared secret whose secrecy needs **no computational assumption** | auth not solved; point-to-point; trusted-node for networks; special HW; **NSA/NCSC/BSI/ANSSI recommend PQC over it** for general use | **Lane E** (written + digital half benched 9/9) | track + define interface |
| **OTP** (confidentiality) | ✅ (Shannon) | perfect message secrecy | needs key as long as msg, once, secret → key-distribution-bound | (uses Lane E key) | constrained only |
| **QDS** (signatures) | ✅ (no-cloning) | ITS authenticity/non-repudiation | sub-1-Hz, **no PKI**, quantum HW | **Lane B** | track-not-build |
| **QRNG** (entropy) | ✅ (true randomness) | unconditional unpredictability for keys/nonces | a source not a primitive; SP 800-90 pipeline; peripheral | **Lane D** | integrate as a governed capability |
| **Optical-PUF** (identity) | ❌ | hardware-bound device identity | ML-learnable; defense-in-depth only | **Lane C** | additional factor, never sole |
| **Photonic MVM / hash / AEAD as the *primitive*** | ❌ | (nothing usable) | analog ≤~6–10-bit can't hold bit-exact crypto; conversion tax | **Lane A (wash) + crypto-on-core** | **REJECTED, permanently** |

**Read:** photonics' honest ITS contributions are **key distribution (QKD), entropy (QRNG), and signatures
(QDS)** — all *around* the digital gate. It can **never** be the cipher, hash, or verification math.

---

## 6. Roadmap — raising the standard (and the honest constraints at each step)
> Each phase: **deliverable · ITS gain · hard constraints · governance integration · acceptance bar.** Phases are
> R&D-and-interface work; actual hardware integration is owner-gated and hardware-availability-gated.

**Q0 — PQC baseline + hybrid (L2). ✅ DONE / shipping.**
The current `.tmf` stack (§2). This is the floor everything else layers on. No ITS, but deployable and standards-
backed. *Nothing to do — it stays the always-present base layer.*

**Q1 — QRNG entropy capability (the cheap, deployable, *real* ITS upgrade). 🟢 Buildable as an interface now.**
- **Deliverable:** wire the **Lane D** governed entropy capability — a host-side SP 800-90B source → 90A DRBG →
  keygen/nonce, behind the LogicN capability boundary, **fail-closed** on a failed health test (`unknown → deny`).
- **ITS gain:** the *randomness* feeding every key/nonce becomes information-theoretically unpredictable (true
  entropy), removing PRNG-seed as a trust assumption. The digital core is unchanged.
- **Constraints:** a *source*, not the cipher; must go through the SP 800-90 pipeline; benefit at signing is
  side-channel/fault hardening, **not** more unforgeability (Lane D §3). No throughput claim without a bench.
- **Acceptance:** a NIST-ESV-validated QRNG behind the boundary + a measured RBG2/RBG3 throughput on named HW.

**Q2 — Lane E: QKD / OTP confidentiality survey + governance interface (the missing assessment). 🟡 Track + define.**
- **Deliverable:** the QKD sibling of Lane B — an honest survey (BB84 / MDI-QKD / twin-field; rates, distances,
  device assumptions, the authentication and trusted-node problems, the NSA/NCSC/BSI/ANSSI "prefer PQC" guidance)
  **+ a defined governance interface** for a **hybrid key-establishment** profile: `K_final = KDF(K_pqc ‖ K_qkd)`
  via a **standard-conformant combiner** (**RFC 9370** multiple-KEM IKEv2 / **ETSI TS 103 744** CatKDF/CasKDF over
  HKDF), so **confidentiality** holds
  if **either** the PQC KEM **or** the QKD key is secure — a genuine **additional, independent, information-
  theoretic lock** on top of the existing KEM (exactly how IETF/ETSI frame combining QKD with PQC). **Caveat: the
  independence is for *confidentiality* only — the QKD link's *authentication* still rests on the PQC/pre-shared
  authenticator (§4), so the two locks share an authentication root.**
- **Lane E is now WRITTEN** — [`tmf/research/photonic-lane-E-qkd-confidentiality.md`](tmf/research/photonic-lane-E-qkd-confidentiality.md)
  (web-cited, at Lane B's depth; the digital combiner + a BB84 sim benched **9/9** in `bench/qkd-hybrid-bench.mjs`).
  It confirms this Q2 framing: **QKD-keyed AEAD, not OTP** (rates too low — 0.0034 bps @ 1,002 km); combine via
  RFC 9370 / ETSI TS 103 744; point-to-point; fail-closed; **track the hardware, don't build it**. The deployment
  **two-plane** architecture (universal PQC plane + opt-in QKD dark-fibre plane; the QKD key never leaves the link)
  is in Lane E §5 — answering the owner's `notes/36-qtcripto` deployment question.
- **ITS gain (where applicable):** on a point-to-point link with QKD hardware, the session key gains a secrecy
  floor that rests on **physics, not lattices** — moving that link to **L3**.
- **Hard constraints (stated, not hidden):** point-to-point only; networks need **trusted nodes** (which see the
  key → not end-to-end ITS) or immature quantum repeaters; QKD **does not authenticate** (the classical channel
  must be PQC/pre-shared-key authenticated — so PQC is still required, not replaced); special hardware; **the
  security agencies recommend PQC over QKD for general use** — so Lane E is a *niche additional lock for specific
  high-value links*, never a replacement. Combine, never substitute.
- **Acceptance:** a vetted QKD system on a real link + a hybrid-KDF integration + a reproducible key-rate
  measurement with its hardware; until then, **track + keep the interface defined and inert** (mirrors Lane B §8).

**Q3 — QDS Tier-B (ITS signatures). 🟡 Track (interface already defined, Lane B §8).**
- Monitor maturity; the inert, capability-gated, AND-only Tier-B `alg` slot is already specified. No PKI / sub-Hz
  today → stays track-not-build until the four Lane-B acceptance criteria all hold.

**Q4 — Research horizon (no build). 🔬 Watch only.**
- Device-**independent** QKD/QDS (removes the device-trust assumption), quantum repeaters / twin-field (range),
  MDI everywhere (removes detector side-channels). All research-grade; revisit when standardized + benchable.

### The combined target architecture (L3 where topology allows)
```
Confidentiality = PQC KEM-DEM   ⊕(KDF)  optional QKD/OTP key (point-to-point)   → break BOTH (math AND physics)
Entropy         = QRNG (ITS) → SP 800-90B health → 90A DRBG → every key/nonce
Authenticity    = PQC ML-DSA (+Ed25519 hybrid, +SLH-DSA level-5 profile)   +  optional QDS AND-term (track)
Integrity/hash/AEAD = DIGITAL, bit-exact (crypto-on-core) — NEVER photonic
Governance      = K3 three-valued gate over all of it; any capability unavailable ⇒ unknown → deny (fail-closed)
```
This reaches **L3** (computational **and** physics) on equipped links, and **L4** (pure ITS) only in fully
constrained closed-group point-to-point settings. It never claims unconditional security *everywhere*.

---

## 7. What will NOT be done (explicit, with the reason)
- ❌ **Photonic/analog as the cipher, hash, signature, or verification primitive.** The analog precision wall
  (~≤6–10-bit, error-tolerant) cannot hold bit-exact EUF-CMA / avalanche crypto; the conversion tax kills any
  speedup (Lane A measured *wash*). **Permanently rejected** (crypto-on-core).
- ❌ **"Ternary crypto" / a bespoke quantum-flavoured cipher or hash.** Invented crypto. Rejected. (Ternary's only
  honest crypto role is NTRU/ML-KEM lattice polynomials; tri-logic is the *governance gate*, not the cipher.)
- ❌ **QKD as a general drop-in replacement for PQC.** NSA (its **QKD/QC** guidance), UK NCSC, German BSI, French
  ANSSI **treat PQC (+ symmetric keying) as the primary solution and QKD as niche-only — not a general-purpose
  replacement** (ANSSI: QKD is acceptable only as *"extra physical security on top of algorithmic cryptography,
  not a replacement"*; NSA mandates the PQC algorithms separately via **CNSA 2.0**). QKD doesn't solve
  authentication, needs special hardware, has limited reach, and the trusted-node model breaks end-to-end ITS.
  *(This is the NSA/NCSC/BSI/ANSSI consensus; some national/EU programs — e.g. **EuroQCI** — nonetheless build QKD
  infrastructure, so it is not a globally universal stance.)* We use QKD **only** as an *additional* point-to-point
  lock combined with PQC, where the threat model and topology justify it.
- ❌ **One-time pad at scale.** Key management (as many secret key bits as message bits, distributed secretly) is
  impractical beyond niche point-to-point.
- ❌ **Building quantum hardware** (single-photon sources, SNSPDs, repeaters, QRNG chips). We integrate *vetted*
  hardware behind the governance boundary; we do not build or simulate it as if it were real.
- ❌ **Any ITS / security / performance number without a reproducible benchmark + the device.** Every quantum
  claim here is either cited to its source apparatus or marked a **THEORETICAL GAP** (no LogicN hardware exists).
  No number is synthesized.
- ❌ **Replacing the digital bit-exact core.** It stays. Photonics/quantum live *around* the gate, always.

---

## 8. Honest bottom line
- **Today:** `.tmf` is **L2** — strong, deployable, standards-backed PQC + classical hybrid. It is quantum-
  *resistant*, on *unproven* computational assumptions. That is the correct, honest state of the art.
- **"TRUE quantum resilience" (L4, unconditional)** is **not a drop-in** — it is physically constrained to
  point-to-point, special-hardware, closed-group settings, and it *still* needs a (PQC/pre-shared) authenticator.
- **The achievable raise of the standard is L3:** keep PQC everywhere, add **QRNG** (deployable now) for ITS
  entropy, and define **Lane E (QKD/OTP)** and **Lane B (QDS)** as *additional independent locks* for the specific
  high-value links/artifacts where the physics is available — combined so an attacker must defeat **both math and
  physics**. That is a real, honest upgrade for the right targets — **not** a claim that `.tmf` becomes
  unconditionally secure for everyone everywhere.

---

## Sources (web-verified by the adversarial pass, 2026-06-16)
- C. E. Shannon, *Communication Theory of Secrecy Systems*, Bell Syst. Tech. J. 28(4):656–715 (1949) — perfect
  secrecy / one-time pad (H(key) ≥ H(message)).
- Bennett & Brassard, *BB84* (1984); Ekert, *E91* — entanglement-based QKD (1991); Wootters & Zurek, *no-cloning*
  (Nature, 1982).
- Gottesman & Chuang, *Quantum Digital Signatures*, arXiv:quant-ph/0105032 (2001) — and the Lane B citation set.
- Brassard, Høyer, Tapp (1997) — the ~n/3 quantum hash-collision speedup (huge-memory, impractical).
- **NSA/CSS**, *Quantum Key Distribution (QKD) and Quantum Cryptography (QC)* page (against QKD for NSS; prefers
  PQC) + **CNSA 2.0** (the separate PQC-algorithm mandate); UK **NCSC** QKD guidance; **ANSSI** ("extra physical
  security … not a replacement"); **BSI** (QKD niche-only, TR-02102-1 hybrid PQC); the **2024 joint
  ANSSI+BSI+NLNCSA+Sweden** QKD position paper ("niche use cases"; PQC + symmetric keying the priority).
- NIST **FIPS 203 / 204 / 205** (ML-KEM / ML-DSA / SLH-DSA, Aug 2024); **SP 800-90A/B/C** (DRBG / entropy /
  RBG constructions); **ITU-T X.1702** (QRNG, 2019).
- **ETSI TS 103 744** *Quantum-safe Hybrid Key Establishment* (CatKDF/CasKDF over HKDF/RFC 5869) + IETF
  key-combiner drafts — the `K_pqc ‖ K_qkd` combiner (secure if ≥ 1 input key is secret).
- Device-independent QKD anchor: Nadlinger et al., *Experimental quantum key distribution certified by Bell's
  theorem*, Nature 607, 682 (2022) — ~0.07 bits/entanglement-event ("far slower").
- Project: `tmf/research/photonic-lane-{A,B,C,D}-*.md`, `ENCRYPTION-RND-FULL-BRIEF.md` §3 (crypto-on-core),
  `tmf/spec/{signature-custody,threshold-custody,tmf-encryption}-v0.md`.

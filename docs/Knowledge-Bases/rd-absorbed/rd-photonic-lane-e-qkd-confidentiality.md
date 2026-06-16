<!-- ABSORBED R&D SOURCE — verbatim mirror. LogicN is the main library; the R&D repo is upstream/authoring.
     Source: LogicN-R-AND-D/tmf/research/photonic-lane-E-qkd-confidentiality.md  ·  Pinned: R&D 238f07a (2026-06-17)
     Integrated LogicN view: logicn-quantum-resilience-roadmap.md  ·  Catalog: logicn-rd-absorption-catalog.md
     Rule: edit the upstream source then re-vendor; do not fork this copy (feedback-auto-import-rd-docs). -->

> **Absorbed R&D source (verbatim).** Curated/integrated view: `logicn-quantum-resilience-roadmap.md`. See `logicn-rd-absorption-catalog.md`. Internal links below point at the upstream R&D tree.

---
# Photonic-era confidentiality — Lane E: QKD / OTP for information-theoretic confidentiality

> **Status:** research findings (2026-06-16). **Lane:** E — the *confidentiality* sibling of Lane B (QDS = ITS
> signatures). Fills the gap the [`../../QUANTUM-RESILIENCE-STANDARD-AND-ROADMAP.md`](../../QUANTUM-RESILIENCE-STANDARD-AND-ROADMAP.md)
> §6 Q2 identified — no QKD-for-confidentiality lane existed (A/B = signing, C = identity, D = entropy).
> **Posture (binding, inherited):** grounded + cited (FIPS/NIST/RFC/ETSI/peer-reviewed only); **no performance
> number without a reproducible benchmark + the machine/apparatus it ran on**; no invented crypto; fail-closed
> (`unknown → deny`); honest-core vs aspirational kept strictly separate. **crypto-on-core:** the cipher/AEAD/hash
> stay bit-exact digital; QKD lives *around* the gate, supplying a key, never computing the cipher.
> **Scope:** **track + define the governed interface; do NOT build the hardware** (mirrors Lane B). Prompted by
> the owner's implementation brief `LogicN/notes/36-qtcripto` (which this lane answers, incl. its deployment Q).

---

## 0. One-paragraph verdict
QKD (Quantum Key Distribution) is a genuinely-photonic, **information-theoretically secure** primitive for
*key agreement* — its secrecy comes from the **no-cloning theorem** (eavesdropping disturbs non-orthogonal quantum
states and is **detectable**), not from a computational hardness assumption, so it is **not Shor-breakable**. It is
real, published, *and commercially deployed* science. But it is constrained on every axis: **point-to-point** links
only, **brutal key rates at distance** (a record **1,002 km** twin-field link runs at **0.0034 bits/s** — useless
for bulk data), **special hardware** (single-photon optics, often cryogenic SNSPDs), a **trusted-node problem** that
breaks end-to-end ITS across networks, and — most decisively — **QKD does not authenticate**, so it *still* requires
a PQC (or pre-shared-key) signature to stop a man-in-the-middle. The security agencies (NSA, UK NCSC, German BSI,
French ANSSI) therefore **recommend PQC over QKD** for general use. **The honest verdict: combine, never substitute.**
LogicN's role is to **define the governed hybrid-KEM interface** — `K_final = KDF(K_pqc ‖ K_qkd)`, per **RFC 9370**
/ **ETSI TS 103 744** — so a QKD-equipped *link* earns an **additional, independent, physics-based confidentiality
lock on top of PQC**, point-to-point, fail-closed; and to **track the field**, not build the lasers.

---

## 1. The honest framing — QKD is real photonic *confidentiality*, not the rejected photonic-cipher trap
The crypto-on-core line ([`../../ENCRYPTION-RND-FULL-BRIEF.md`](../../ENCRYPTION-RND-FULL-BRIEF.md) §3) permanently
rejects "an analog photonic computation that *is* the cipher/hash" — the ≤~6–10-bit precision wall vs bit-exact
crypto (Lane A measured a *wash*). QKD is **categorically different** and must not be conflated with it:

| | Rejected "photonic cipher" trap | Quantum Key Distribution (this lane) |
|---|---|---|
| What the photons do | *compute* the cipher/hash in analog optics | *carry* non-orthogonal quantum states to **agree a shared secret key** |
| Security rests on | nothing — analog precision can't hold bit-exact crypto | **no-cloning** + measurement disturbance (eavesdropping detectable) — **information-theoretic** |
| Output | (unusable) | a **symmetric key**, then fed to the **unchanged digital AEAD** |
| Verdict | invented/impossible — **rejected** | published + deployed science — **real, but constrained, track-only** |

So QKD never tries to *be* the cipher: it produces a **key** whose secrecy needs no computational assumption, and
that key seeds the existing digital KEM-DEM. It respects crypto-on-core by sitting **before** the cipher, like QRNG.

---

## 2. The QKD family + the rate/distance reality (web-cited)
| Scheme | What it adds | Record distance / rate (cited apparatus) | Notes |
|---|---|---|---|
| **BB84** (1984) + **decoy-state** (Lo–Ma–Chen / Wang 2005) | the workhorse prepare-and-measure protocol; decoy states defeat photon-number-splitting | metro range; **Mbit/s** class commercially (Toshiba/IDQ, ~tens of km) | trusts the detectors |
| **MDI-QKD** (Lo–Curty–Qi 2012) | removes **all detector side-channels** (untrusted central measurement) | ~400–500 km fiber class | the same "MDI" idea as Lane B's MDI-QDS |
| **Twin-field QKD** (Lucamarini et al., *Nature* 2018) | beats the repeaterless secret-key-capacity bound | **1,002 km, 0.0034 bps** (USTC, *PRL* 130, 210801, 2023); 830 km (2022) — **no trusted nodes/repeaters** | the long-distance record; rate is *fractions of a bit/s* |
| **Satellite QKD** (Micius; Liao et al., *Nature* 549, 43, 2017) | free-space, trans-continental via a satellite trusted relay | **~1,200 km, kHz** decoy-state QKD; entanglement distribution 1,200 km (*Science* 2017) | satellite is a **trusted node** |
| **Device-independent QKD** (2022, *Nature* 607) | removes the **device-trust** assumption | **~0.07 bits/entanglement-event** (could not finish finite-key stats in a 75-h run) | research-grade; far slower |

**Reading the rates honestly (the load-bearing engineering point):** QKD key rates are **kbit/s–Mbit/s at metro
range, collapsing to ~0.003 bit/s at 1,000 km.** This **bounds the use**:
- **A one-time pad is impossible at bandwidth.** OTP needs a fresh secret key **as long as the message** (§Shannon);
  no QKD rate can pad a Gbit/s data stream. OTP is a niche-of-a-niche (very low-bandwidth, ultra-high-value).
- **So the practical Lane-E primitive is QKD-*keyed AEAD***, not OTP: the slow QKD key **seeds / periodically
  refreshes** the symmetric key of the existing AES-256-GCM/ChaCha20-Poly1305 DEM. The data is encrypted by the
  fast digital AEAD; QKD only contributes *key material* — exactly the `K_qkd` combiner input below.

---

## 3. The four blockers — why track-not-build (mirrors Lane B §7)
1. **Authentication gap (decisive).** QKD gives *secrecy*, not *identity*. Its classical channel **must be
   authenticated** (Wegman–Carter with a pre-shared key, or a PQC/ML-DSA signature) or it is trivially
   MITM-able — a chicken-and-egg that means **PQC is still required, not replaced.**
2. **Trusted-node problem.** Multi-hop QKD networks relay through **trusted nodes that see the key** → **not
   end-to-end ITS**. End-to-end needs quantum repeaters (immature/unrealized) or DI-QKD (≈0.07 bits/event). So
   QKD's ITS is **link-local**, never network-wide.
3. **Rate / distance / hardware.** Point-to-point; brutal rates (§2); single-photon sources + (often cryogenic)
   SNSPDs. Lab/metro/satellite infrastructure, not commodity.
4. **Agency guidance.** **NSA** (its QKD/QC page — against QKD for NSS, prefers PQC), **UK NCSC**, **German BSI**,
   **French ANSSI** treat **PQC (+ symmetric keying) as the primary solution and QKD as niche-only** (ANSSI: *"extra
   physical security on top of algorithmic cryptography, not a replacement"*). *(Counterpoint, for honesty: some
   national/EU programs — e.g. EuroQCI — nonetheless build QKD infrastructure; the stance is not globally universal.)*

---

## 4. LogicN's role — the governed hybrid-KEM interface (define, do **not** build)
QKD slots in **only** as an *additional* key-establishment input to the existing KEM-DEM
([`../spec/tmf-encryption-v0.md`](../spec/tmf-encryption-v0.md) §2/§3), never a replacement:

### 4.1 The combiner (standards-grounded)
```
K_final = KDF( K_pqc ‖ K_qkd )           # secure if EITHER input key is secret ("break BOTH" to break confidentiality)
  K_pqc = ML-KEM-768/1024 shared secret  (mathematical lock; the always-present L2 baseline)
  K_qkd = a BB84/twin-field QKD key       (physics lock; only on a QKD-equipped point-to-point link)
```
- **RFC 9370** *Multiple Key Exchanges in IKEv2* — combines up to **7** successive KEMs so that **"an attacker
  must break *all* the key exchanges"**, and "if at least one component is quantum-resistant, the final shared
  secret is quantum-safe." This is exactly the multi-lock property; a QKD-derived key is one of the exchanges.
- **ETSI TS 103 744** *Quantum-safe Hybrid Key Establishment* (CatKDF/CasKDF over HKDF/RFC 5869) — the QKD-aware
  combiner. **ETSI ISG-QKD** / **ITU-T Y.3800** — the QKD-network reference architecture.

### 4.2 How it appears to `.tmf` (governed, fail-closed)
| Interface element | Definition for Lane E |
|---|---|
| **`kem_profile` slot** | a **reserved future** value "hybrid + QKD" in `tmf-encryption-v0` §2.1 — **not allocated** until vetted QKD hardware + a key story exist. The QKD key is mixed into the `K_aead` schedule (§3) via the combiner above. |
| **Hybrid posture** | QKD is **only ever an additional combiner input**, never a replacement — a QKD-only profile is **forbidden** (it would forfeit open-internet reach and still lack authentication). The PQC KEM stays mandatory. |
| **Authentication** | the QKD classical channel is authenticated by the **existing #34 hybrid signer** (`signature-custody-v0` §2.1) — Lane E does **not** add a new authenticator; it consumes the one that ships. |
| **Capability gate** | whether a link *has* a QKD key is a **capability** behind the LogicN governance boundary. A policy that **requires** the QKD lock resolves to **`unknown → deny`** when the link is unavailable (fail-closed) — it **MUST NOT** silently drop the QKD input and fall back to PQC-only without the policy's consent (mirrors Lane B §8.2). A policy that only requires PQC still seals normally; the QKD lock is then an un-asserted bonus. |
| **Key never on the wire** | `K_qkd` is established **out-of-band** on the QKD plane and consumed **locally** (§5); it is never carried in the `.tmf` or over the internet. |

---

## 5. Deployment architecture — answering `notes/36-qtcripto`'s question
> *"How do you deploy TritMesh nodes to accommodate both open-internet PQC connections and closed-loop QKD
> dark-fiber links?"* — the honest answer is a **two-plane** design.

- **PQC plane (universal, always-on, open internet).** Every node, every connection runs the **L2 baseline**:
  KEM-DEM (X25519+ML-KEM-768) + the #34 hybrid signature. This is the end-to-end, wide-area, anyone-can-connect
  layer. *Nothing about QKD changes this — it is the floor.*
- **QKD plane (opt-in, point-to-point, dark fiber, QKD-equipped node *pairs* only).** A dedicated optical link
  between two co-located or metro nodes with QKD transceivers establishes `K_qkd` **on that link**.
- **The key insight that makes it deployable:** the QKD plane establishes **keys out-of-band**; the `.tmf`
  **ciphertext** (sealed with `K_final`) then flows over the **normal internet**. You do **not** route QKD over the
  public internet (you can't — it breaks ITS and there's no reach); you route the **sealed data**, whose key was
  *strengthened on the dark-fiber plane*. So a node is **dual-homed**: a standard NIC for PQC-over-internet, and
  (on equipped nodes) a QKD transceiver on dedicated fibre to one peer.
- **Networks stay PQC end-to-end; QKD is link-local.** Because multi-hop QKD needs **trusted relays** (which see
  the key → not end-to-end ITS), the architecture keeps QKD **per-link** and uses **PQC for the wide area**. A
  "QKD-secured link" is a property of a *specific node pair*, marked as a governance capability — long-haul
  confidentiality rests on PQC, and *specific high-value links additionally* get the physics lock.
- **Where it pays off (topologies):** (a) **data-center / rack interconnect** — short dark fibre, high QKD rate,
  the ideal case; (b) **metro point-to-point** — commercial Toshiba/IDQ, Mbit/s over ~tens of km; (c) **satellite
  uplink** — Micius-class kHz key refresh for trans-continental high-value links (with the satellite as a stated
  trusted node). In all three: **PQC everywhere underneath, QKD as the additional per-link lock.**

---

## 6. R&D without hardware — what we can and cannot test
- **We have NO QKD hardware → no real QKD benchmark. THEORETICAL GAP** (identical posture to Lane B §7).
- **Simulators** (QuTech **NetSquid** / **SimulaQron**, or a protocol-level BB84 simulation) test the **software /
  protocol logic and the governed combiner** — they do **not** establish real photonic security (a simulator cannot
  model real-device side-channels, detector imperfections, or genuine no-cloning; it executes the *protocol*).
- **What IS real and benchable (the digital + protocol half):** the **hybrid-KEM combiner** (real `@noble`
  ML-KEM-768 + a stand-in/simulated `K_qkd` → KDF → `K_final`; *either-half-holds* property) and a **BB84 protocol
  simulation** (sift + QBER → eavesdropper detection) — both clearly labelled **protocol/digital demonstrations,
  not hardware security**. Reference: [`../../tri-encription/bench/qkd-hybrid-bench.mjs`](../../tri-encription/bench/qkd-hybrid-bench.mjs).

**Measured (2026-06-16, i9-9900K / Node v24.16.0 / `@noble`) — `qkd-hybrid-bench.mjs` 9/9:** the BB84 sim detects
eavesdropping (clean QBER **0%** → accept; intercept-resend QBER **25.2%** > the 11% threshold → abort); the
combiner is **either-half-holds** (an attacker with one key half derives the wrong `K_final`); and the combiner is
**one SHAKE256 call (~124,000 ops/s)** — negligible beside ML-KEM-768 (encaps ~1,520 / decaps ~1,145 ops/s;
ML-KEM-1024 encaps ~1,075; ML-DSA-65 verify ~499) — so **adding the QKD lock costs ~nothing on the digital side.**
**Re-analysis: the measured results confirm every Lane-E *digital* claim and contradict none** — the only unmeasured
thing is the real QKD key rate (no hardware = THEORETICAL GAP). *Caveat: the BB84 sim is **noiseless** (real channels
carry ~1–5% baseline QBER, which is exactly why the abort threshold is ~11%, not 0%); it shows the **principle**
(eavesdropping is detectable), not a real link, and omits error-correction + privacy-amplification.*

---

## 7. Honest ledger
| Claim | Status |
|---|---|
| QKD = ITS *key agreement* (no-cloning), real + commercially deployed | **Grounded, cited** |
| Rates brutal at distance (0.0034 bps @ 1,002 km; kHz satellite) ⇒ **OTP-at-bandwidth impossible** ⇒ QKD-keyed AEAD, not OTP | **Grounded, cited** |
| QKD does **not** authenticate ⇒ PQC/pre-shared auth still required | **Grounded** |
| Trusted-node networks break end-to-end ITS | **Grounded** |
| Combine via RFC 9370 / ETSI TS 103 744; secure if **either** half holds | **Grounded, cited** |
| A photon *is* the cipher / OTP everything with QKD | **REJECTED** (crypto-on-core; rate reality) |
| QKD replaces PQC | **REJECTED** (NSA/NCSC/BSI/ANSSI: combine, never substitute) |
| Any LogicN QKD throughput / key-rate number | **THEORETICAL GAP — no hardware**; nothing synthesized |

## 8. What would move Lane E from track → build (acceptance, mirrors Lane B §8.3)
1. a **vetted QKD system on a real point-to-point link** available to the parties (today: none in scope);
2. the **hybrid-KEM combiner integrated** + a **reproducible key-rate measurement with its hardware** (today:
   THEORETICAL GAP — only the digital combiner + a BB84 *simulation* are benchable here);
3. a **governed capability + enrollment** story for the QKD link (design sketch only, §4);
4. an authenticated classical channel via the shipped #34 signer (this one **already exists**).
Until 1–3 hold: **track the field, keep the interface defined and inert, do not build.**

## 9. Sources (web-verified 2026-06-16)
- **RFC 9370**, *Multiple Key Exchanges in IKEv2* (2023) — https://www.rfc-editor.org/info/rfc9370/ (up to 7 KEMs;
  "attacker must break all"; combine classical+PQC+quantum-derived key material).
- **ETSI TS 103 744**, *Quantum-safe Hybrid Key Establishment* (CatKDF/CasKDF); **ETSI ISG-QKD**; **ITU-T Y.3800**
  (QKD network reference architecture).
- Bennett & Brassard, *BB84* (1984); Lo, Ma & Chen / Wang, *decoy-state QKD* (2005); Lo, Curty & Qi, *MDI-QKD*,
  PRL 108, 130503 (2012); Lucamarini et al., *twin-field QKD*, Nature 557 (2018).
- Liu et al., *Experimental Twin-Field QKD over 1000 km Fiber*, **Phys. Rev. Lett. 130, 210801 (2023)** —
  https://link.aps.org/doi/10.1103/PhysRevLett.130.210801 (1,002 km, 0.0034 bps, no trusted nodes).
- Liao et al., *Satellite-to-ground QKD*, **Nature 549, 43 (2017)** (Micius, ~1,200 km, kHz); *Satellite-based
  entanglement distribution over 1,200 km*, **Science (2017)** — https://www.science.org/doi/10.1126/science.aan3211.
- Nadlinger et al., *Device-independent QKD*, **Nature 607, 682 (2022)** (~0.07 bits/entanglement-event).
- Shannon, *Communication Theory of Secrecy Systems* (1949) — the OTP key-length bound.
- **NSA** QKD/QC guidance; **NCSC** / **BSI** / **ANSSI** PQC-over-QKD positions (+ the 2024 joint position paper).
- Companions: [`photonic-lane-B-quantum-digital-signatures.md`](photonic-lane-B-quantum-digital-signatures.md)
  (the ITS-signature sibling), [`photonic-lane-D-qrng.md`](photonic-lane-D-qrng.md) (ITS entropy),
  [`../../QUANTUM-RESILIENCE-STANDARD-AND-ROADMAP.md`](../../QUANTUM-RESILIENCE-STANDARD-AND-ROADMAP.md) (the L3 target).

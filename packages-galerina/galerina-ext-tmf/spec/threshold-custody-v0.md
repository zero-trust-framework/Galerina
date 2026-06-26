# `.tmf` threshold (M-of-N) custody — v0 (multi-vector locking)

**Status:** Draft, buildable. Adds **k-of-n** ("M-of-N") locking on **two orthogonal axes** — authorization
and decryption — so no single key (or single key-holder) is a single point of unlock. Generalizes
[`signature-custody-v0.md`](signature-custody-v0.md) §5 (whose hybrid **AND** rule is exactly the `k = n`
special case) and reuses [`tmf-encryption-v0.md`](tmf-encryption-v0.md) §3 (the symmetric key it shares).
Reference: [`../../tri-encription/bench/threshold-custody.mjs`](../../tri-encription/bench/threshold-custody.mjs).
**No invented crypto:** standard signatures + Shamir Secret Sharing (1979) only; threshold *lattice* signatures
are explicitly **out of scope** (§4).

> **The idea (multi-vector, not one lock).** Two independent thresholds, each defeating a different attack:
> **(A) a signature quorum** — at least `k` of `n` distinct, registered key-holders must vouch for the artifact
> (defeats a single stolen/coerced signing key); **(B) key secret-sharing** — the symmetric data key is split so
> at least `k` of `n` share-holders must combine to decrypt (defeats a single stolen recipient key). They
> compose with — they do **not** replace — the existing verify-before-decrypt gate, the hybrid PQ crypto, and
> the K3 governance gate.

---

## 1. Two orthogonal M-of-N axes
| Axis | Question | Mechanism | Defeats |
|---|---|---|---|
| **A. Authorization quorum** | "did *enough* trusted parties vouch?" | k-of-n over **distinct standard signatures** (Ed25519/ML-DSA), enforced by the K3 gate | one stolen/coerced/rogue **signing** key |
| **B. Decryption sharing** | "can a lone key-holder decrypt?" | k-of-n **Shamir SSS** on the symmetric data key | one stolen/leaked **recipient/data** key |

Either axis can be used alone or together; `k = n` on axis A is the current AND-hybrid; `k = n = 1` is the
single-signer / single-key default. Both axes are **fail-closed** (< k ⇒ deny / cannot decrypt).

---

## 2. Axis A — k-of-n signature quorum (authorization)
The signature block ([`tmf-container-v0.md`](tmf-container-v0.md) §5 / `signature-custody-v0` §4) already carries
`n` entries `{alg, pubkey, sig}` over the `integrity_root`. The **AND** rule ("all `n` must verify") becomes a
**threshold** rule:

> **Accept iff at least `k` of the `n` entries verify, each under a *distinct*, registry-resolved, non-revoked
> key, over the same `integrity_root`** (and each `ctx`-bound per `signature-custody` §2.1). Fewer than `k` ⇒
> `AuthError` (fail-closed).

**`k` is a verifier-side policy, NOT a downgradeable file field.** Trust comes from the Trust Capsule /
out-of-band registry, never from the file (`signature-custody` §6/§7). So the artifact carries the *available*
signatures (`n` entries); the **required threshold `k` and the authorized signer set live in the Trust Capsule
policy** for that artifact class. An attacker therefore cannot "downgrade `k`" by editing the file — the verifier
applies its own required `k`; an artifact with too few valid registered signers is rejected. (Adding more
signatures than required is harmless; removing them only makes it *less* likely to meet `k`.)

- **Distinctness MUST be enforced:** `k` valid signatures must come from `k` *different* registered `key_id`s,
  not the same key signing `k` times (else "k-of-n" collapses to 1). The K3 gate counts **distinct** authorized
  signers.
- **K3 governance encoding (the genuine "Tri" fit):** the quorum is a three-valued decision —
  `count(distinct, valid, registered, non-revoked signers) ≥ k → allow` ; `< k → deny` ;
  `registry/revocation status unknown → deny` (fail-closed `collapse(0)=deny`, matching `k3-policy.spore`).
- **Composition:** each entry may itself be a hybrid (e.g. each signer signs with `{Ed25519, ML-DSA-65}`
  AND-internally), so axis A (quorum across signers) and the per-signer PQ hybrid are independent and stack.

This is **quorum multi-signature** (k distinct standard signatures + a counting policy) — no new cryptography.

---

## 3. Axis B — k-of-n Shamir secret-sharing of the data key (decryption)
The symmetric section key — `K_aead` (`tmf-encryption-v0` §3), or a separately generated data-encryption key
(DEK) that `K_aead` wraps — is split into `n` shares via **Shamir Secret Sharing over GF(2⁸)** (the same field
as the §7 Reed–Solomon), threshold `k`:

```
SSS.split(K, k, n):  per key-byte, sample a degree-(k−1) polynomial f with f(0) = key_byte and random higher
                     coeffs; share_i = (x_i, f(x_i)) for n distinct non-zero x_i ∈ GF(256)\{0}.
SSS.combine(any k shares): Lagrange-interpolate f(0) per byte → K.   (< k shares ⇒ K is information-theoretically
                     hidden: every candidate key is equally consistent.)
```

- **Decryption requires `k` of `n` share-holders** to combine shares → reconstruct `K` → then the **unchanged**
  verify-before-decrypt path runs (integrity → authenticity/quorum → K3 allow → AEAD-open, `tmf-encryption-v0`
  §7). Fewer than `k` shares ⇒ the key cannot be formed ⇒ **cannot decrypt** (no oracle, no partial leak).
- **Information-theoretic for the *sharing*** (Shamir): `k−1` shares reveal *nothing* about `K`. (This is a
  property of the split, not of the AEAD.) A **wrong/forged share** yields a wrong `K`; the committing AEAD
  (`tmf-encryption-v0` §4/§8.5) then fails the tag — **fail-closed**, no silent wrong-plaintext.
- **Share delivery is out of band / orthogonal:** shares are distributed to `n` holders (e.g. each holder's KEM
  public key encapsulates one share, or shares are pre-provisioned). This spec pins the *sharing*, not the
  delivery channel.
- **Relation to the KEM:** axis B sits *below* the AEAD and is independent of the KEM profile — it changes *who
  can assemble the key*, not how the key encrypts. Single-recipient KEM-DEM is the `k = n = 1` case.

---

## 4. What is explicitly OUT (honesty)
- ❌ **Threshold *lattice* signatures** (a single combined ML-DSA signature reconstructed from k-of-n key
  shares). Threshold/multiparty ML-DSA is **not standardized or mature** — speccing it would be invented crypto.
  Axis A is therefore **quorum multi-signature** (k *distinct, separate* signatures), not a threshold signature.
  (FROST gives threshold *Schnorr/Ed25519* — a possible *classical-half* future option, labelled later, behind a
  vetted library; the PQ half stays per-signer.)
- ❌ Any "ternary"/bespoke sharing scheme. Axis B is **Shamir SSS over GF(2⁸)** — classical, vetted, 1979.
- ❌ Any throughput/latency claim without a reproducible benchmark + the machine.

---

## 5. Threats addressed (beyond single-lock)
| Threat | Single-lock outcome | M-of-N mitigation |
|---|---|---|
| One signing key stolen | forge accepted | **Axis A:** still need `k−1` other distinct registered signers |
| One signer coerced/rogue (insider) | malicious artifact signed | **Axis A:** `< k` ⇒ deny |
| One recipient/data key leaked | full decrypt | **Axis B:** `< k` shares ⇒ cannot reconstruct the key |
| Quorum "downgrade" (edit `k` in the file) | bypass | `k` is **verifier policy** (Trust Capsule), not a file field |
| Same key counted `k` times | fake quorum | distinctness enforced (K3 counts distinct `key_id`s) |
| Wrong/forged share injected | wrong-plaintext oracle | committing AEAD fails the tag (fail-closed) |

---

## 6. Reference & status
- **Reference** (`bench/threshold-custody.mjs`, **11/11**): (A) k-of-n quorum over real `@noble` Ed25519
  signatures — accepts ≥k distinct valid, rejects `<k`, rejects duplicate-signer, forged, and wrong-root; (B)
  Shamir SSS over GF(2⁸) on a 32-byte key — reconstructs from any k, fails from `k−1`, wrong share ⇒ wrong key ⇒
  committing-AEAD fail-closed.
- **Status:** format + policy specified; the production threshold-policy resolution lives in the Trust Capsule
  (owner-gated wiring, `governed-trust-capsule-v0`). Real signing remains Blocked on the vetted lib
  (`signature-custody` §8); the SSS math is real and reproducible.

## Sources
- Adi Shamir, *How to Share a Secret*, CACM 1979 — the k-of-n secret-sharing on axis B.
- FIPS 204 (ML-DSA) · RFC 8032 (Ed25519) — the per-signer primitives on axis A (`signature-custody` §3).
- Komlo–Goldberg, *FROST: Flexible Round-Optimized Schnorr Threshold Signatures*, 2020 — the labelled-later
  classical-half threshold option (§4), **not** built here.

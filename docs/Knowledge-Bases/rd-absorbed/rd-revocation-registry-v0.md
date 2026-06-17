<!-- ABSORBED R&D SOURCE — verbatim mirror. LogicN is the main library; the R&D repo is upstream/authoring.
     Source: LogicN-R-AND-D/tmf/spec/revocation-registry-v0.md (roadmap #2; bench 28/28)  ·  Pinned: R&D rnd-session 2026-06-17
     Integrated LogicN view: logicn-key-custody-and-rotation.md + logicn-tmf-engine.md (engine Slice-5 conformance)  ·  Catalog: logicn-rd-absorption-catalog.md
     Rule: edit the upstream source then re-vendor; do not fork this copy (feedback-auto-import-rd-docs). -->

> **Absorbed R&D source (verbatim).** See `logicn-rd-absorption-catalog.md`. Internal links point at the upstream R&D tree.

---

# `.tmf` revocation registry / trust-registry wire format + fail-closed verifier — v0

**Status:** Draft, buildable + **verified** (the canonical pre-image bytes + digest are reproduced by the
reference bench; the hybrid signature uses **real `@noble`** Ed25519 + ML-DSA-65). Makes
[`signature-custody-v0.md`](signature-custody-v0.md) §7 — which currently describes **rotation + revocation in
prose only** — **byte-exact**. Feeds custody / engine Slice-5: a verifier can now resolve `key_id → {current,
revoked}` against a *signed, freshness-bounded, anti-rollback* artifact instead of an unspecified "CRL-like list
published alongside the keys".

> **The one rule (fail-closed, unknown → deny).** A revocation registry answers *"is this `key_id` still
> trusted right now?"*. Every uncertainty collapses to **deny**: a revoked key is denied, an **unknown** key
> under a policy that requires a fresh registry is denied (never silently allowed), a **stale** registry (now >
> `next_update`) is denied, a **bad signature** is rejected, and a **rolled-back** sequence number is rejected.
> The registry is only as trustworthy as the signature over it — so it is signed by the shipped **#34 hybrid
> signer** (Ed25519 + ML-DSA-65, AND-verified) over a canonical pre-image, exactly as a `.tmf` root is.

Builds on / reuses, unchanged:
[`signature-custody-v0.md`](signature-custody-v0.md) §2.1 (the #34 hybrid `{Ed25519, ML-DSA-65}` over a digest,
per-surface `ctx`), [`tmf-container-v0.md`](tmf-container-v0.md) / [`tmf-encryption-v0.md`](tmf-encryption-v0.md)
(the house length-prefix framing `LP()` / little-endian), [`governed-trust-capsule-v0.md`](governed-trust-capsule-v0.md)
§8 (the K3 `allow / deny / unknown→deny` reader). No invented crypto: SHA-256 + Ed25519 + ML-DSA-65 only.

---

## 1. Where this sits

| Job | Owner | This spec |
|---|---|---|
| Integrity ("exact bytes?") | TMX-256 (file root) | n/a — a registry is its own signed artifact, not a `.tmf` body |
| Authenticity ("right signer?") | #34 hybrid sig over a digest (signature-custody §2.1) | **reused** — signs the registry's canonical pre-image digest |
| **Freshness + revocation status ("trusted *now*?")** | this spec | the CRL-like registry: signed list of revoked `key_id`s + a freshness window + anti-rollback seq |
| Trust anchor (which keys?) | Trust Capsule / out-of-band PKI (signature-custody §7) | the registry **signing key** is a Trust-Capsule-pinned root, resolved out of band — never trusted from the registry itself |

A `.tmf` reader's signature step (container §6 step 5 / signature-custody §6) ends with *"`key_id(pubkey)` is
current and NOT revoked (§7)"*. **This spec is that check, made byte-exact.** The registry is fetched/pinned
out of band (a keys endpoint or the Trust Capsule); its own signature is verified against a **separately
pinned registry-signing root**, and only then is its revocation verdict trusted.

---

## 2. House framing (inherited, not invented)

All multi-byte integers are **little-endian**. Every variable-length field is length-prefixed with the TMX
house convention:

```
LP(b)   = LE32(len(b)) ‖ b            # u32 little-endian length, then the bytes (tmx-256 §1; encryption §3)
LE32(n) = 4-byte little-endian
LE64(n) = 8-byte little-endian
u8(n)   = 1 byte
```

This is the **same** `LP()`/LE used by [`tmf-container`](tmf-container-v0.md),
[`tmf-encryption`](tmf-encryption-v0.md) §3, [`inclusion-proof`](inclusion-proof-v0.md), and the KEM-DEM
key schedule — no new framing is introduced. Concatenation of length-prefixed fields is unambiguous, which is
what makes the canonical pre-image (§4) re-encodable byte-for-byte by any conforming verifier.

---

## 3. Wire format (byte-precise)

A revocation registry is a single record: a fixed header, a length-prefixed list of entries, then the hybrid
signature block. The bytes **before** the signature block are the **canonical pre-image** (§4) that is signed.

### 3.1 Header

| Off | Size | Field | Notes |
|---|---|---|---|
| 0 | 8 | `MAGIC` | `0x89 'T' 'M' 'R' 0x0D 0x0A 0x1A 0x0A` — PNG-style guard (`TMR` = TMf Revocation); detects text/CRLF mangling |
| 8 | 1 | `version` u8 | `0` for v0. Verifier rejects unknown version. |
| 9 | — | `registry_id` | **`LP(bytes)`** — stable id of *this* registry stream (e.g. `"tmf-revocation-2026"`), so two registries cannot be confused / cross-replayed |
| … | 8 | `issued_at` u64 LE | issuance time, **epoch seconds** |
| … | 8 | `next_update` u64 LE | freshness horizon, **epoch seconds**: a verifier with `now > next_update` treats the registry as **stale → deny** (§6) |
| … | 8 | `sequence` u64 LE | **monotonic** sequence number; a verifier MUST reject any registry whose `sequence` is **≤** the highest `sequence` it has already accepted **for the same `registry_id`** (anti-rollback, §6) |
| … | 4 | `entry_count` u32 LE | number of revocation entries that follow |

`registry_id` is length-prefixed and sits inside the header, so its length is explicit and it is bound into
the signed pre-image. (`MAGIC ‖ version ‖ LP(registry_id) ‖ issued_at ‖ next_update ‖ sequence ‖ entry_count`
is the fixed-then-variable header; offsets after `registry_id` are relative to its end.)

### 3.2 Entry list — `entry_count` entries, each

| Off | Size | Field | Notes |
|---|---|---|---|
| 0 | — | `key_id` | **`LP(bytes)`** — the revoked signing key's `key_id` (signature-custody §7, e.g. `"tmf-key-2026-03"`) |
| … | 1 | `reason_code` u8 | §3.3 |
| … | 8 | `revoked_at` u64 LE | epoch seconds the revocation took effect (informational + audit; the verdict is binary "present ⇒ revoked") |

Entries MUST be sorted **ascending by `key_id`** (lexicographic over the raw `key_id` bytes) and `key_id`s
MUST be **unique**. This makes the registry **canonical** (one byte string per logical set) and lets a verifier
binary-search and reject duplicate/unsorted input as malformed (§6). The *presence* of a `key_id` in the list
is the revocation; `revoked_at`/`reason_code` are metadata.

### 3.3 `reason_code` registry (u8) — mirrors RFC 5280 §5.3.1 CRLReason

| Val | Name | Meaning |
|---|---|---|
| `0` | `unspecified` | no reason given |
| `1` | `keyCompromise` | the private key is known/suspected compromised |
| `2` | `caCompromise` | an issuing authority key is compromised |
| `3` | `affiliationChanged` | the subject's affiliation changed |
| `4` | `superseded` | replaced by a newer key (routine rotation, signature-custody §7) |
| `5` | `cessationOfOperation` | the key is retired / no longer operated |
| `6` | `privilegeWithdrawn` | the key's authorization was withdrawn |
| `255` | `reserved` | MUST NOT be emitted; a verifier rejects it as malformed |

A verifier MAY surface `reason_code` (e.g. distinguish a routine `superseded` from an emergency
`keyCompromise`) but **MUST NOT** change the *verdict* on it: any present `key_id` is revoked regardless of
reason. Unknown reason values in `[7, 254]` are accepted and treated as `unspecified` (forward-compatible);
`255` is rejected (reserved sentinel).

### 3.4 Signature block (after the canonical pre-image)

The bytes `file[0 : sig_offset]` are the **canonical pre-image** `P` (§4). Immediately after `P`:

```
0   2   sig_count   u16 LE        2 = hybrid (verification = logical AND over all entries) — signature-custody §4
then sig_count entries, each:
    2   alg         u16 LE        1=Ed25519, 2=ML-DSA-65   (signature-custody §3)
    4   pubkey_len  u32 LE
    …   pubkey      bytes
    4   sig_len     u32 LE
    …   signature   bytes         = Sign(sk, digest)   where digest = SHA-256(P)   (signature-custody §2.1)
```

This is the **identical** signature-block byte layout as [`tmf-container`](tmf-container-v0.md) §5 /
signature-custody §4, reused verbatim. Default profile is the #34 transition hybrid `{Ed25519, ML-DSA-65}`,
**AND-verified** (both must verify). The L5 long-lived profile `{ML-DSA-87, SLH-DSA-SHA2-256s}`
(signature-custody §5) is permitted with the same block layout; v0's golden vector uses the #34 default.

---

## 4. What is signed — the canonical pre-image and the #34 digest

The registry is a **non-COSE** surface (like the `.tmf` root and the LogicN-#34 manifest), so it follows the
signature-custody §2.1 construction **verbatim**, *not* the COSE/RFC-9964 empty-ctx form of the Trust Capsule:

```
P      = MAGIC ‖ version ‖ LP(registry_id) ‖ issued_at ‖ next_update ‖ sequence ‖ entry_count
         ‖  for each entry (in canonical sorted order):  LP(key_id) ‖ reason_code ‖ revoked_at
digest = SHA-256(P)                                    # 32 bytes — the #34 "digest = SHA-256(canonical_body)"
sig_ed   = Ed25519.Sign(sk_ed,  digest)               # deterministic (RFC 8032)
sig_ml   = ML-DSA-65.Sign(sk_ml, digest, ctx="tmf-revocation-v0")   # pure ML-DSA, per-surface ctx (FIPS-204; #34 §2.1)
```

- `P` is **exactly** the on-wire header + entry list bytes (§3.1/§3.2). The signature block is **not** part of
  `P` (it signs the digest of `P`). Because `version`, `registry_id`, `issued_at`, `next_update`, `sequence`,
  and every entry are in `P`, none can be altered under a valid signature — in particular `sequence` and
  `next_update` are signed, so an attacker cannot roll the sequence back or extend freshness without re-signing.
- **Per-surface domain separation** (#34 intent): the ML-DSA `ctx = "tmf-revocation-v0"` (a distinct surface
  label) ensures a registry signature cannot be cross-protocol-confused with a `.tmf`-root signature
  (`ctx="tmf-root-v0"`) or a LogicN-manifest signature under the same key — empirically the binding holds
  (signature-custody §2.1, `ctx-binding.mjs`). Ed25519 has no ctx parameter; its domain separation is the
  distinct `digest` (over a `MAGIC`-prefixed pre-image that no other surface produces).
- **Why digest-then-sign here (vs the Trust Capsule's sign-`Sig_structure`-directly):** this surface is the
  #34 construction (a 32-byte SHA-256 digest signed by the hybrid pair), identical to the `.tmf`-root and
  manifest surfaces — *not* a COSE object. RFC 9964's empty-ctx / no-pre-hash rule applies to the **COSE**
  surface only (the Trust Capsule). Keeping this surface on the #34 form means it shares the deployed #34
  signer with zero new code paths.

---

## 5. Verifier policy inputs (verifier-side, NOT file fields)

Like the threshold `k` (threshold-custody §2), these are **verifier policy**, resolved out of band — never
read from the registry (a registry cannot weaken the policy that judges it):

| Input | Meaning |
|---|---|
| `registry_signing_root` | the pinned `{ed_pk, ml_pk}` the registry's signature is checked against (Trust Capsule, signature-custody §7). **Resolved out of band, never from the registry.** |
| `now` | the verifier's current epoch-seconds clock (for the freshness check) |
| `require_fresh_registry` | policy bit: if **true**, an `key_id` **not present** in a valid fresh registry is treated as **unknown → deny** (a key must be *positively* known-current). If false (legacy/soft mode), an absent `key_id` is "not revoked" (allow), the classic CRL semantic. **Default: true** for high-assurance surfaces. |
| `expected_registry_id` | (optional) the `registry_id` this verifier expects, so a valid registry for a *different* stream is not accepted in this context |
| `last_seq[registry_id]` | the highest `sequence` already accepted for this `registry_id` (anti-rollback state the verifier persists) |

`require_fresh_registry` is the crux of **unknown → deny**: a CRL by itself only lists *revoked* keys, so an
unknown key looks "not revoked" and is silently allowed. Under `require_fresh_registry=true` the registry is
treated as an **allow-list-by-absence-of-revocation *plus* a freshness proof**: if the registry is missing,
stale, or unverifiable, **every** lookup is `unknown → deny`, not "allow because not listed".

---

## 6. Fail-closed verifier algorithm

```
verify_and_lookup(registry_bytes, key_id, policy) -> ALLOW | DENY:

A. PARSE + AUTHENTICATE the registry (any failure ⇒ registry is UNUSABLE):
  1. file[0:8] == MAGIC                                              else Malformed     → DENY
  2. version == 0                                                    else Unsupported   → DENY
  3. strict parse: LP lengths in bounds, exactly entry_count entries,
     no trailing bytes before the sig block, sig block well-formed,
     entries strictly ascending + unique by key_id, no reason_code 255   else Malformed → DENY
  4. P = registry_bytes[0 : sig_offset]; digest = SHA-256(P)
  5. sig_count == 2 and algs == {Ed25519, ML-DSA-65}                 else Malformed     → DENY
  6. each in-file pubkey == the pinned registry_signing_root pubkey  else AuthError     → DENY
     (trust the PINNED root, never the registry's own key — signature-custody §6)
  7. Ed25519.Verify(ed_pk, digest, sig_ed) AND
     ML-DSA-65.Verify(ml_pk, digest, sig_ml, ctx="tmf-revocation-v0")  else AuthError   → DENY
     (hybrid = AND: BOTH must verify)
  8. if policy.expected_registry_id set: registry_id == it           else WrongRegistry → DENY
  9. ANTI-ROLLBACK: sequence > policy.last_seq[registry_id]          else Rollback      → DENY
     (a replayed OLD registry — e.g. one predating a revocation — is rejected even if its
      signature is valid; on accept, the verifier advances last_seq[registry_id] = sequence)
 10. FRESHNESS: now <= next_update                                   else Stale         → DENY
     (an expired registry is not evidence of current status)

B. REVOCATION LOOKUP (registry is authentic + fresh + newest):
 11. if key_id present in entries:                                   REVOKED            → DENY
     (a present key_id is denied EVEN IF its file signature is cryptographically valid —
      the one intentional refusal of a "valid" signature, signature-custody §7)
 12. if key_id absent:
        if policy.require_fresh_registry: this is positive evidence the key is current → ALLOW
        else (legacy CRL mode): absent ⇒ not revoked                                  → ALLOW
 13. UNKNOWN handling: if step A produced ANY failure (registry missing / malformed /
     unverifiable / stale / rolled-back), and policy.require_fresh_registry:
        unknown status                                                                 → DENY
     (NEVER fall through to "allow because not listed" — that is the silent-accept bug)
```

Every branch is `→ DENY` except an authentic-fresh-newest registry in which the `key_id` is **absent** (allow)
or **present** (deny). This is the K3 calculus (governed-trust-capsule §8): `allow / deny / unknown → deny`,
`collapse(unknown)=deny`. A verifier with **no vetted Ed25519/ML-DSA library MUST deny every lookup** (it
cannot authenticate the registry) — same no-silent-downgrade posture as signature-custody §6.

### 6.1 Error taxonomy

| Error | Cause | Disposition |
|---|---|---|
| `Malformed` | bad magic / version / LP out of bounds / trailing bytes / unsorted or duplicate `key_id` / `reason_code=255` / wrong sig-block shape | DENY |
| `AuthError` | in-file pubkey ≠ pinned root, or Ed25519/ML-DSA verify false (either ⇒ AND fails) | DENY |
| `WrongRegistry` | `registry_id` ≠ `expected_registry_id` | DENY |
| `Rollback` | `sequence ≤ last_seq[registry_id]` (replayed/old registry) | DENY |
| `Stale` | `now > next_update` (freshness window expired) | DENY |
| `Revoked` | `key_id` present in entries (valid sig notwithstanding) | DENY |
| `Unknown` | registry unusable **and** `require_fresh_registry` ⇒ status unknown | DENY |

---

## 7. Golden / known-answer vector (the conformance artifact)

A fixed registry → its **exact canonical pre-image bytes** + the **SHA-256 digest**. The deterministic part
(pre-image + digest) is reproducible by anyone in any language; the Ed25519 signature is deterministic
(RFC 8032) and byte-reproducible from the seeded key; the ML-DSA-65 signature is **hedged** (length pinned
3309 B, bytes vary), so only its **verify=true** round-trip is pinned (same posture as the Trust Capsule and
signature-custody golden vectors).

```
Registry (canonical):
  version       = 0
  registry_id   = "tmf-revocation-2026"            (19 bytes)
  issued_at     = 1750000000                        (2025-06-15T...Z)
  next_update   = 1752592000                        (issued_at + ~30 days)
  sequence      = 7
  entries (sorted ascending by key_id, unique):
    [0] key_id="tmf-key-2025-11"  reason=1 (keyCompromise)         revoked_at=1749000000
    [1] key_id="tmf-key-2026-01"  reason=4 (superseded)            revoked_at=1748000000
    [2] key_id="tmf-key-2026-02"  reason=5 (cessationOfOperation)  revoked_at=1751000000

canonical pre-image P (144 bytes; the bench's printed `P_hex`, normative — contiguous):
  89544d520d0a1a0a 00 13000000 746d662d7265766f636174696f6e2d32303236
  80e14e6800000000 806e766800000000 0700000000000000 03000000
  0f000000 746d662d6b65792d323032352d3131 01 409f3f6800000000
  0f000000 746d662d6b65792d323032362d3031 04 005d306800000000
  0f000000 746d662d6b65792d323032362d3032 05 c0235e6800000000

  decomposition: MAGIC(8) ‖ version=00 ‖ LP(registry_id)=13000000+"tmf-revocation-2026"
   ‖ issued_at=80e14e68… (LE u64 1750000000) ‖ next_update=806e7668… (LE u64 1752592000)
   ‖ sequence=07…(LE u64) ‖ entry_count=03000000 ‖ 3×{ LP(key_id) ‖ reason ‖ revoked_at(LE u64) }
   (entries emitted in CANONICAL ascending key_id order: 2025-11 < 2026-01 < 2026-02)

digest = SHA-256(P) = 25cd8e435e663a0392114aaa20cf3a0736bb8b4fca871ab689ff46a123a72126
Ed25519 pubkey (seeded) = e4030998cfd5ad1723c169f956aa0b9eb8619b5992bd612c2af428ebc79f8df0
Ed25519 sig (deterministic, 64 B) = c44979f469eebabf004da3d4be4d597e314b4b63762ce963f0b2fffa842c600a
                                    9ee49f9e07a717ef9b50fba14d8e4a878a2ebf55a35d48cc059cbc62d025100a  (verify=true)
ML-DSA-65 (-49) pubkey 1952 B / sig 3309 B (hedged → length pinned, bytes vary): verify=true under ctx="tmf-revocation-v0"

fail-closed checks (bench asserts each):
  lookup("tmf-key-2026-01")  -> REVOKED  -> DENY        (present, reason=superseded)
  lookup("tmf-key-2025-11")  -> REVOKED  -> DENY        (present, reason=keyCompromise)
  lookup("tmf-key-2099-12")  -> absent; require_fresh=true, registry fresh+valid -> ALLOW
  lookup(... ) with now > next_update      -> Stale       -> DENY
  lookup(... ) with a flipped pre-image byte -> AuthError -> DENY (both sigs fail)
  registry signed by a non-pinned key       -> AuthError  -> DENY
  replay sequence<=7 vs last_seq=7          -> Rollback    -> DENY
  unknown key + missing/unusable registry, require_fresh=true -> Unknown -> DENY
```

The full suite is **28/28** (golden vector + positive path + every fail-closed negative).

Any conforming implementation MUST reproduce `P` byte-for-byte and the same `SHA-256(P)`; the JS reference
[`../../tri-encription/bench/revocation.mjs`](../../tri-encription/bench/revocation.mjs) (`@noble` SHA-256 +
Ed25519 + ML-DSA-65) produces them and runs the full fail-closed suite.

---

## 8. Threats addressed

| Threat | Mitigation |
|---|---|
| Use a key after it was revoked | `key_id` present ⇒ DENY even with a valid file signature (§6 step 11) — the intentional refusal (signature-custody §7) |
| Silent-accept of an unknown/never-seen key | `require_fresh_registry` ⇒ unknown → DENY (§5/§6 step 13); a CRL alone would silently allow it |
| Replay an **old** registry (predating a revocation) | monotonic `sequence` + persisted `last_seq` ⇒ Rollback DENY (§6 step 9); `sequence` is inside the signed `P` |
| Extend a stale registry's life | `next_update` is signed; `now > next_update` ⇒ Stale DENY (§6 step 10) — cannot be edited without re-signing |
| Forge / tamper the registry | #34 hybrid AND-sig over `SHA-256(P)`; any byte change flips the digest ⇒ both sigs fail (§6 step 7) |
| Trust the registry's own signing key blindly | pubkey checked against the **pinned** registry-signing root, not the registry (§6 step 6) |
| Cross-registry / cross-surface confusion | `registry_id` bound in `P` + `expected_registry_id` check (§6 step 8); per-surface ML-DSA `ctx` (§4) |
| Reader without a PQC/Ed25519 lib silently accepts | fail-closed: cannot authenticate ⇒ DENY every lookup (§6) |
| Quantum break of the classical half | ML-DSA-65 half of the hybrid still authenticates the registry |

---

## 9. Status & what unblocks it

- **Buildable now:** the wire format, canonical pre-image, digest, and fail-closed verifier are fully specified
  and exercised with **real `@noble`** Ed25519 + ML-DSA-65 in `bench/revocation.mjs` (the same signer the rest
  of the suite uses — no new dependency, no new crate, no Rust).
- **Production wiring (owner-gated):** the *registry-signing root* and the `require_fresh_registry` /
  `expected_registry_id` policy live in the **Trust Capsule** (governed-trust-capsule §custody,
  signature-custody §7), resolved out of band. Distribution (a `keys.../tmf/revocation` endpoint or a pinned
  artifact) and the persisted `last_seq` store are deployment concerns, pinned by policy, not by this format.
- **Honest-core:** the QRNG entropy lane (governed-trust-capsule §9) is a software stand-in in R&D; real
  chip-backed entropy is owner-gated and is **not** required by this format (signing randomness for the hedged
  ML-DSA path comes from the vetted library / OS CSPRNG). This spec invents **no** cryptography — SHA-256
  (FIPS 180-4), Ed25519 (RFC 8032), ML-DSA-65 (FIPS 204) only.

## 10. Sources

- RFC 5280, *Internet X.509 PKI Certificate and CRL Profile* — §5 (CRL), §5.3.1 (CRLReason) —
  https://www.rfc-editor.org/rfc/rfc5280 (the CRL idiom + reason codes this profile mirrors)
- FIPS 204, *Module-Lattice-Based Digital Signature (ML-DSA)* — https://csrc.nist.gov/pubs/fips/204/final
- RFC 8032, *Edwards-Curve Digital Signature Algorithm (EdDSA)* — https://www.rfc-editor.org/rfc/rfc8032
- FIPS 180-4, *Secure Hash Standard (SHA-256)* — https://csrc.nist.gov/pubs/fips/180-4/final
- Companions: [`signature-custody-v0.md`](signature-custody-v0.md) §2.1/§4/§7 (the #34 hybrid signer + custody
  lifecycle this makes byte-exact), [`governed-trust-capsule-v0.md`](governed-trust-capsule-v0.md) §8 (the K3
  fail-closed reader), [`tmf-container-v0.md`](tmf-container-v0.md) §5 / [`tmf-encryption-v0.md`](tmf-encryption-v0.md)
  §3 (the `LP()`/LE house framing), [`threshold-custody-v0.md`](threshold-custody-v0.md) §2 (verifier-policy-not-file-field).
</content>
</invoke>

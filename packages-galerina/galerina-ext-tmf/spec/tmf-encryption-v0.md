# `.tmf` encryption (confidentiality) layer — v0 (byte-precise, buildable)

**Status:** Draft, buildable + **partially verified** (the deterministic key-schedule / framing bytes are
reproduced by a stdlib generator; the KEM/AEAD ciphertext bytes are **Blocked on a vetted lib** and shown as
labelled placeholders — same posture as [`signature-custody-v0.md`](signature-custody-v0.md)). This is the
**v1 confidentiality layer** deferred by [`tmf-container-v0.md`](tmf-container-v0.md) §10, now promoted from
the [`SPORE-AMD-024`](../../tri-encription/research/SPORE-AMD-024-tmf-confidentiality.md) blueprint into the
oracle-backed spec track. Companion: the integrity core [`tmx-256-construction-v0.md`](tmx-256-construction-v0.md)
and authenticity [`signature-custody-v0.md`](signature-custody-v0.md) (the gate this layer sits **under**).

A reference generator + golden vector are produced by
[`_vectors/gen_tmf_encryption.py`](_vectors/gen_tmf_encryption.py) (stdlib SHAKE256 + struct only).

> **The one rule (verify-before-decrypt).** Confidentiality is added **under** the existing TMX-256 +
> ML-DSA-65 gate, never beside it. The integrity root is recomputed from the **ciphertext** leaves, the
> signature is verified over that root, the K3 governance verdict must be `ALLOW(+1)`, and only **then** does
> any key decapsulate. Every failure is `unknown(0) → deny`, fail-closed. No plaintext is ever produced
> before all three checks pass.

Grounded only: ML-KEM (FIPS 203), ML-DSA (FIPS 204), KEM-DEM/HPKE (NIST SP 800-227, RFC 9180), AEAD
(AES-256-GCM = NIST SP 800-38D; Ascon-AEAD128 = SP 800-232; ChaCha20-Poly1305 = RFC 8439). No invented
cipher; nothing here depends on photonic/ternary hardware or any performance number.

---

## 1. What this layer adds, and what it reuses

| Job | Owner | This layer |
|---|---|---|
| Integrity ("exact bytes?") | TMX-256 (already specced) | reused unchanged — TMX hashes **ciphertext** opaquely |
| Authenticity ("right signer?") | ML-DSA-65 over the root (already specced) | reused unchanged — signs the root over ciphertext leaves |
| **Confidentiality ("only the intended reader?")** | **this layer** | KEM-DEM: hybrid KEM → SHAKE256 KDF → AAD-committing AEAD |
| Availability ("survive bit-rot?") | RS erasure on ciphertext, **outside** the gate | reused — re-verify recovered bytes vs the signed root (§7) |

The container's integrity/authenticity bytes are **codec-agnostic** (container §4.3): TMX hashes the
ciphertext exactly as it hashes cleartext, so adding encryption changes **no** integrity/signature bytes —
only the *payload* a section carries. This layer therefore composes cleanly as a **v1 container change**
(§8); the v0 byte layout and its golden vector are unaffected.

---

## 2. Three orthogonal selector axes (the sketch's `0x01/0x02` collision, resolved)

The [`SPORE-AMD-024`](../../tri-encription/research/SPORE-AMD-024-tmf-confidentiality.md) sketch overloaded
`0x01`/`0x02` across **three different axes** — KEM profile (§2.1), DEM single-shot-vs-STREAM (§2.3), and
(after the 2026-06-16 ratification) the AEAD suite. A byte-precise format cannot keep them collapsed. v0
splits them into **three independent selector bytes**, each with its own registry:

### 2.1 `kem_profile` u8 — how the section key is encapsulated
| Val | KEM | `ct_kem` size | Level / notes |
|---|---|---|---|
| `0x01` | ML-KEM-768 standalone (FIPS 203) | **1088 B** | L3, post-transition target |
| `0x02` | **Hybrid X25519 + ML-KEM-768** | **1120 B** | L3, **default** during the PQ transition |
| `0x03` | ML-KEM-1024 standalone (FIPS 203) | **1568 B** | **L5**, post-transition (long-lived / Path B) |
| `0x04` | **Hybrid P-384 + ML-KEM-1024** | **1665 B** | **L5 default** (long-lived; PQ half = L5, classical hedge = P-384 / Cat 3) |

All four sizes are runtime-measured against `@noble/post-quantum` (`bench/profile-l5-sizes.mjs`):
ML-KEM-768 ct 1088, hybrid-768 1120; ML-KEM-1024 ct 1568, hybrid-1024+P-384 1665.

**Hybrid layout (`0x02`).** `ct_kem = ML-KEM-768 ciphertext (1088 B) ‖ X25519 ephemeral public key (32 B)`,
in that order — the `@noble/post-quantum` `ml_kem768_x25519` ("X-Wing"-style) encoding the bench validates at
runtime (1120 B). The 32-byte hybrid shared secret is the KEM's own combiner output
(`SHA3-256(ss_mlkem ‖ ss_x25519 ‖ ct_x25519 ‖ pk_x25519 ‖ label)`); this layer treats it as an opaque
32-byte secret and derives from it in §3. The combiner is the vetted library's, not re-specified here.

**Level-5 tier (`0x03`/`0x04`) — Path B, long-lived data.** For presumptively decades-lived `.tmf` archives
where harvest-now-decrypt-later wants the larger margin, the level-5 KEM is **ML-KEM-1024** (NIST Category 5) —
this PQ half carries the level-5 guarantee. Its hybrid partner (`@noble` `ml_kem1024_p384`) is **P-384**, *not*
X25519: P-384 is NIST **Category 3** (~192-bit, SP 800-57) — a materially stronger *classical hedge* than
X25519 (Cat 1, ~128-bit), though **not** itself a Category-5 curve (that would be P-521, which `@noble` does not
expose as an ML-KEM-1024 hybrid). This is sound because a hybrid KEM inherits IND-CCA from its **stronger** half,
so the deployed guarantee is ML-KEM-1024's Cat 5; the classical half is a transition hedge, not the level anchor.
`ct_kem (0x04) = ML-KEM-1024 ciphertext (1568 B) ‖ P-384 ephemeral point (97 B uncompressed) = 1665 B`. The DEM (§2.2) and key schedule (§3) are unchanged — the
tier only swaps the KEM (and pairs with the level-5 signature profile, signature-custody §2/§3). These are
cold-path, once-per-artifact operations, so the larger keys/latency are irrelevant.

### 2.2 `aead_suite` u8 — the symmetric DEM (ratified 2026-06-16)
| Val | AEAD | nonce | tag | Profile |
|---|---|---|---|---|
| `0x01` | **AES-256-GCM** (SP 800-38D) | 96-bit (12 B) | 128-bit (16 B) | **default** — 256-bit Grover margin, AES-NI, suite-consistent with level-3 ML-KEM-768/ML-DSA-65 |
| `0x02` | Ascon-AEAD128 (SP 800-232) | 128-bit (16 B) | 128-bit (16 B) | constrained / embedded |
| `0x03` | ChaCha20-Poly1305 (RFC 8439) | 96-bit (12 B) | 128-bit (16 B) | no-AES-NI alternate |
| `0x04` | **XChaCha20-Poly1305** (draft-irtf-cfrg-xchacha) | 192-bit (24 B) | 128-bit (16 B) | extended/random nonces; STREAM uses the **24-B variant (§6.1)**. Reference `bench/xchacha-suite.mjs` 14/14 |

`0x03` is **strictly** RFC 8439 ChaCha20-Poly1305 at a 12-byte nonce — a distinct primitive from
XChaCha20-Poly1305 (`0x04`), whose 24-byte nonce is built via HChaCha20 sub-keying. Suites `0x01`–`0x03` use a
12-byte nonce (the §6 STREAM scheme); **`0x04` uses a 24-byte nonce and the 24-byte STREAM variant of §6.1**. The
nonce width is a function of `aead_suite`, fixed by the table above (and `aead_suite` is bound into the AAD
context §4, so a suite/nonce-width swap fails the tag).

Default AES-256-GCM rationale: `.tmf` is a data fabric on commodity/server hardware holding presumptively
**long-lived** confidential data — harvest-now-decrypt-later wants the 256-bit margin, and AES-NI is
measured at **1,273 MB/s** on the i9-9900K (34× the pure-JS floor — `bench/aes-native-vs-purejs.mjs`), so
the AEAD is not the bottleneck.

### 2.3 `dem_mode` u8 — single-shot vs segmented stream
| Val | Mode | Use |
|---|---|---|
| `0x01` | single-shot | small/fixed payloads, localized attributes, API packets |
| `0x02` | segmented STREAM | large media (image/audio/video); structurally defeats truncation/reorder/splice (§6) |

All three axes are independent: e.g. `kem_profile=0x02, aead_suite=0x01, dem_mode=0x02` = hybrid KEM +
AES-256-GCM + streamed. All three bytes are **bound into the AEAD AAD** (§4), so none can be swapped under a
valid tag, and they are also part of the container section metadata bound into the signed root.

---

## 3. DEM key schedule — SHAKE256 (suite-consistent, ratified)

The whole `.tmf` crypto stack is Keccak: TMX-256 = SHAKE256, ML-KEM/ML-DSA use Keccak internally, and the
hybrid KEM combiner is SHA3-256/SHAKE256. The DEM KDF is therefore **SHAKE256** (ratified —
`encryption-architecture.md` §0 #2; KMAC256 is the FIPS-friendly alternate), keeping **one hash family**
across the format. All variable-length inputs are length-prefixed (`LP(x) = u32le(len(x)) ‖ x`, the TMX
house convention) so the concatenation is unambiguous.

```
K_aead    = SHAKE256( LP("tmf-dem-kdf-v0")    ‖ LP(shared_secret) ‖ LP(aead_context) ) [:32]
key_commit= SHAKE256( LP("tmf-dem-commit-v0") ‖ LP(K_aead) )                            [:32]
```

- `shared_secret` = the 32-byte KEM output (§2.1).
- `aead_context` = the 36-byte section descriptor (§4) — binding it into the KDF means a key derived for one
  section/epoch/profile cannot open another even before the AEAD tag is checked.
- The two domain-separation tags (`tmf-dem-kdf-v0`, `tmf-dem-commit-v0`) prevent the KDF and the commitment
  from ever colliding on the same SHAKE input.

---

## 4. AAD-committing AEAD + the 36-byte AAD context (resolves SPORE-AMD-024 Q5)

AES-256-GCM (and ChaCha20-Poly1305) are **not key-committing** — a single ciphertext can be made to decrypt
under two different keys. To close that, the **key commitment is bound into the AEAD associated data**:

```
committed_aad = aead_context (36 B)  ‖  key_commit (32 B)        # 68 B, fed to AEAD as AAD
ciphertext    = AEAD.Seal(K_aead, nonce, plaintext, committed_aad)
```

A reader that does not reconstruct `key_commit` from its derived `K_aead` produces the wrong AAD and the tag
fails — so the ciphertext is **bound to `H(K_aead)`** (bench test T10). This is the **AAD-commitment
hardening** against key/ciphertext-substitution (Albertini et al., USENIX Security 2022); it is **not** a
proof of full CMT-1 key-commitment for AES-256-GCM (T10 shows the commitment is authenticated as an AAD
field, not that no single ciphertext opens under two attacker-chosen keys). A **fully key-committing profile
(CMT-1/CMT-4) is now sketched in §8.5** (the CTX transform — `commit_mode=01`; the zero-prefix padding fix is a
reserved alternative). The
`aead_context` is not stored redundantly on the wire; it is **reconstructed** from the container's section
metadata, so tampering with any field changes the AAD and fails the tag.

### `aead_context` — 36-byte fixed descriptor (the AAD pre-commitment)
| Off | Size | Field | Notes |
|---|---|---|---|
| 0 | 8 | `section_id` u64 | the section's stable id (TVCID half) |
| 8 | 16 | `coord` | 128-bit coordinate block (TVCID half; opaque/non-semantic — see §5) |
| 24 | 2 | `modality` u16 | mirrors container §4.2 (`0`=Vector…) |
| 26 | 1 | `kem_profile` u8 | §2.1 |
| 27 | 1 | `aead_suite` u8 | §2.2 |
| 28 | 1 | `dem_mode` u8 | §2.3 |
| 29 | 1 | `conf_flags` u8 | bit0 = encrypted; **bits 1–2 = `commit_mode`** (§8.5: `00` none / `01` CTX / `10`–`11` reserved); bits 3–7 reserved (MUST be 0) |
| 30 | 4 | `epoch` u32 | timeline / key-rotation epoch (§6 forward secrecy) |
| 34 | 2 | reserved u16 | MUST be 0 |

This binds `TVCID ‖ modality ‖ crypto-profile ‖ epoch` into every tag, so a ciphertext section cannot be
lifted/replanted into another context or decrypted under the wrong profile — closing SPORE-AMD-024 open
question #5.

---

## 5. Metadata minimization (the `coord`/TVCID is opaque)

Per the ratified metadata verdict (`encryption-architecture.md` §0 #3,
[`metadata-confidentiality.md`](../../tri-encription/research/metadata-confidentiality.md)): a **cleartext
semantic embedding cannot survive zero-trust** (vec2text recovers ~92% of short text). So the Vector/Attribute
(embedding) sections are **encrypted inside the DEM**; the only cleartext is integrity/authenticity metadata
plus this layer's selector bytes and an **opaque, non-semantic** `coord`/TVCID. Fine semantic filtering
happens **only at trusted, post-verify endpoints** — never on cleartext in-network. (This drops the source
notes' "firewalls filter on meaning" feature, by design.)

---

## 6. Segmented STREAM (`dem_mode=0x02`) — anti-truncation/reorder/splice

A large payload is split into fixed chunks (default 1 MB); each chunk is sealed independently with a
**position-derived nonce**, so dropping, reordering, or splicing chunks is detected by a nonce/tag mismatch.

```
nonce (96 bit) = prefix8 (64-bit random) ‖ BE-u32( (index << 1) | last_flag )
                 └ cross-stream uniqueness ┘ └ within-stream uniqueness + final-chunk binding ┘
frame_i        = AEAD.Seal(K_aead, nonce_i, chunk_i, committed_aad) = ciphertext_i ‖ tag_i (16 B)
```

- 31-bit index ⇒ ≤ 2³¹ chunks ≈ 2 PB at 1 MB/chunk; the 64-bit random prefix gives cross-stream uniqueness.
- The 1-bit `last_flag` makes the final chunk unforgeable: a dropped trailing chunk leaves a non-final chunk
  whose nonce no longer matches, so the tag fails (anti-truncation). Bench test T4 exercises
  round-trip + truncation + reorder + tamper, all fail-closed.
- **Reader obligation (normative).** Anti-truncation holds *only* if the reader requires a terminator: a STREAM
  decrypt **MUST** open the final received chunk with `last_flag=1` and **fail-closed (`CryptoError`) if no valid
  `last=1` terminator is present** — otherwise a silently dropped trailing chunk goes undetected (every remaining
  chunk still opens as non-final). (`bench/xchacha-suite.mjs` shows both the terminator-requiring open and its
  rejection of a dropped final chunk.)
- The nonce is **not stored** — it is recomputed from `prefix8 ‖ index ‖ (i == last)`.

### 6.1 24-byte STREAM nonce (`aead_suite=0x04`, XChaCha20-Poly1305)
The 96-bit nonce above serves the 12-byte suites (`0x01`–`0x03`). XChaCha20-Poly1305 (`0x04`) has a 192-bit
nonce (HChaCha20 sub-keying), so STREAM uses the wider layout:

```
nonce (192 bit) = prefix16 (128-bit random) ‖ BE-u64( (index << 1) | last_flag )
                  └ cross-stream uniqueness ┘ └ within-stream index + final-chunk binding ┘
```

- **63-bit index** ⇒ ≤ 2⁶³ chunks (effectively unbounded); the **128-bit random prefix** makes cross-stream
  nonce collision negligible even with random prefixes (XChaCha's reason for being). `last_flag` binds the final
  chunk exactly as §6 (anti-truncation), under the same reader terminator obligation. The nonce is again **not
  stored** — recomputed from `prefix16 ‖ index ‖ (i == last)`. Writers and readers **MUST reject `index ≥ 2⁶³`**
  (`MalformedCrypto`): beyond it the `BE-u64` field wraps mod 2⁶⁴ and the nonce repeats (catastrophic AEAD nonce
  reuse). The bound is **enforced** in the reference, not merely assumed.
- **Single-shot `0x04`** (`dem_mode=0x01`) may instead carry a 24-byte **random** nonce — safe at this width
  without a counter. Both paths (single-shot + STREAM) are exercised in
  [`bench/xchacha-suite.mjs`](../../tri-encription/bench/xchacha-suite.mjs) (round-trip, tamper, reorder,
  truncation — all fail-closed), and **CTX (§8.5) composes over `0x04` unchanged**.

History append (`+1`, RD-DIRECTION §3.3): each appended segment is its own sealed+signed unit whose
`aead_context.epoch` advances and whose AAD hash-links the previous segment's root; per-epoch key rotation
gives forward secrecy, and dropping a segment key is crypto-erasure without breaking the chain. (On-wire
multi-segment packaging — the segment offset table — is now specced in
[`tmf-history-chain-v0.md`](tmf-history-chain-v0.md) §8; reference `bench/history-pack.mjs` 9/9.)

---

## 7. Reader algorithm (fail-closed; extends container §6)

```
PRE: integrity + authenticity already pass (container §6 steps 1–5 over the CIPHERTEXT leaves).
     A reader with no vetted KEM/AEAD lib MUST reject every conf_flags.encrypted=1 section (never
     emit ciphertext as if cleartext) — same posture as the signed-without-verifier rule.

6.  K3 GOVERNANCE: verdict = collapse(key_release(...));  authorize(verdict) == ALLOW(+1)   else DENY (deny on 0/-1)
7.  reconstruct aead_context (36 B) from the section metadata
8.  shared_secret = KEM.Decapsulate(ct_kem, recipient_sk)        # 0x02 splits ct_kem -> ML-KEM ct ‖ X25519 pub
9.  K_aead       = SHAKE256(LP("tmf-dem-kdf-v0") ‖ LP(shared_secret) ‖ LP(aead_context))[:32]
10. committed_aad = aead_context ‖ SHAKE256(LP("tmf-dem-commit-v0") ‖ LP(K_aead))[:32]
11. single-shot:  plaintext = AEAD.Open(K_aead, nonce, ct ‖ tag, committed_aad)            else CryptoError
    STREAM:       for i: chunk_i = AEAD.Open(K_aead, nonce_i, frame_i, committed_aad)       else CryptoError
                  (nonce_i recomputed from prefix8/index/last; any drop/reorder/tamper -> CryptoError)
12. emit plaintext.
```

Steps 6–12 run **only after** integrity+authenticity (container §6). Decapsulation never precedes the
`ALLOW(+1)` verdict (bench test T9). Any error ⇒ reject, fail-closed, zeroize derived keys.

## 7.1 Error taxonomy (extends container §7)
| Error | Cause | Disposition |
|---|---|---|
| `GovDeny` | K3 verdict `0`/`-1` (`collapse(0)=deny`) | reject (fail-closed) |
| `CryptoError` | AEAD tag fail (tamper / wrong AAD / wrong key / wrong key-commitment / CTX-commit mismatch / dropped-reordered chunk / **missing `last=1` STREAM terminator**) | reject (fail-closed) |
| `NoCryptoLib` | `conf_flags.encrypted=1` and no vetted KEM/AEAD lib available | reject — **never** emit ciphertext as cleartext |
| `MalformedCrypto` | `ct_kem`/nonce/tag wrong size for the declared profile, or **STREAM `index ≥ 2⁶³`** (nonce-wrap) | reject |

---

## 8. Container v1 binding & versioning
- Adds a `conf_flags` confidentiality bit + the three selector bytes (§2) into each section's crypto
  descriptor; these are bound into the signed root (no silent downgrade) and into the AEAD AAD (no lift/replant).
- **Codec-agnostic / non-breaking to v0 integrity:** TMX hashes ciphertext opaquely, so adopting this layer
  changes no v0 integrity/signature bytes; it is a `version_minor`/v1 addition. The v0 container golden vector
  remains valid.
- **Now specced (was deferred):** the **level-5 tier** `kem_profile=0x03/0x04` (ML-KEM-1024 / hybrid+P-384,
  §2.1) + the level-5 signature profile (ML-DSA-87 + SLH-DSA, signature-custody §2–3) — owner-ratified
  2026-06-16.
- **Now specced (was deferred):** the `+1` **append-only history chain** —
  [`tmf-history-chain-v0.md`](tmf-history-chain-v0.md) (hash-linked segments, key-erasure ratchet,
  crypto-erasure, anti-rollback via verifier monotone-epoch state).
- **Now sketched (was deferred):** the fully key-committing **CMT-1/CMT-4 profile** — §8.5 (`commit_mode=01`,
  CTX transform over `H = SHAKE256`; reference `bench/cmt-ctx.mjs` 10/10); and **`aead_suite=0x04`
  XChaCha20-Poly1305** + its 24-byte STREAM-nonce variant — §2.2 / §6.1 (reference `bench/xchacha-suite.mjs` 14/14).
- **Not in v0 of this layer:** real KEM/AEAD bytes (Blocked on a vetted lib — see §9); any throughput/latency or
  photonic/ternary claim.

---

## 8.5 CMT-committing AEAD profile (`commit_mode` = CTX) — the §4/§8 future option, now sketched

§4 binds `key_commit = H(K_aead)` into the AAD — **substitution-hardening**, not a CMT-1 *proof* for AES-256-GCM
(a single `(C,T)` can still, in principle, be crafted to open under two attacker-chosen keys: Dodis et al. 2018;
Len–Grubbs–Ristenpart 2021 partitioning oracles; Albertini et al. 2022). This profile closes that gap with a
generic, all-Keccak transform.

### Construction — **CTX** (Chan & Rogaway, ESORICS 2022), `H = SHAKE256`
Replace the meaning of the tag region with a collision-resistant commitment over the **base AEAD tag** `T`:

```
(C ‖ T)    = aead_suite.Seal(K_aead, nonce, plaintext, committed_aad)     # any §2.2 suite; T = 16-B tag
commit_tag = SHAKE256( LP("tmf-cmt-ctx-v0") ‖ LP(K_aead) ‖ LP(nonce) ‖ LP(committed_aad) ‖ LP(T) )[:32]
on the wire: C ‖ T(16 B) ‖ commit_tag(32 B)              # +32 B/frame vs §4, INDEPENDENT of message size
```

Reader (extends §7 step 11): recompute `commit_tag'` from the derived `K_aead`, `nonce`, reconstructed
`committed_aad`, and the received `T`; **constant-time compare** — mismatch ⇒ `CryptoError` (fail-closed) —
**then** run `aead_suite.Open`. Reference: [`bench/cmt-ctx.mjs`](../../tri-encription/bench/cmt-ctx.mjs)
(**10/10**: round-trip, ciphertext-tamper, commit-tamper, key-binding under 5000 random keys, nonce/AAD binding,
STREAM compose, **and the no-silent-downgrade test** — `commit_mode` 01→00 strip fails the tag, §below).

> **Variant note (vs textbook CTX).** This profile keeps the base tag `T` on the wire (`C ‖ T ‖ commit_tag`),
> whereas textbook CTX *discards* `T` and transmits only `C ‖ H(K,N,A,T)`. Retaining `T` lets the unmodified
> `@noble` `Open(K,N,C‖T,A)` verify the base AEAD (it only exposes that API), and it **only adds** an equality
> constraint to any frame collision, so commitment is **≥ textbook CTX**, never weaker. The cost is **+16 B/frame
> vs textbook CTX** (the `+32 B` figure above is vs the §4 baseline), and `T` — the standard, already-public AEAD
> tag — is exposed, which is harmless.

### Why CTX (vs the alternatives)
- **CMT-4, not just CMT-1.** CTX binds `key + nonce + AAD + message` (the message via `T`), the strongest
  commitment level — so a frame cannot be re-keyed *or* lifted/replanted under a different context. The §4
  AAD-hardening is subsumed (and `committed_aad` already carries `key_commit`, so the two compose).
- **Clean proof.** CTX's security reduces to the **collision resistance of `H`** (Chan–Rogaway). Two distinct
  keys opening one frame would be a SHAKE256 collision. `bench/cmt-ctx.mjs` T-CMT-4 exhibits the binding
  empirically (0 collisions over 5000 keys).
- **Suite-agnostic + all-Keccak.** Works black-box over **any** `aead_suite` (`0x01`–`0x04`) — `@noble` exposes
  only `Open(K,N,C‖T,A)`, and CTX needs only the tag `T`, which is on the wire. `H = SHAKE256` keeps one hash
  family (TMX-256 / ML-KEM / ML-DSA / DEM-KDF).
- **Fixed 32 B overhead**, independent of message length — unlike the Albertini zero-prefix padding fix (which
  inflates every chunk and interacts awkwardly with STREAM). That padding fix (CMT-1 only) is kept as a
  **reserved** alternative for environments without a hash in the AEAD path.

### Selector — `commit_mode` (2 bits inside `conf_flags`, so it is bound with zero new wire fields)
| `conf_flags` bits 1–2 | `commit_mode` | Meaning |
|---|---|---|
| `00` | none | §4 AAD-hardening only (default; **not** a CMT proof for GCM) |
| `01` | **CTX** | this section — CMT-4, `commit_tag` = 32-B SHAKE256; tag region becomes `T(16) ‖ commit_tag(32)` |
| `10` | reserved | Albertini zero-prefix padding (CMT-1) |
| `11` | reserved | — |

`commit_mode` lives in the **`conf_flags` byte** (`aead_context` offset 29, §4), so it is already bound into
every AEAD tag and into the signed root — **no silent downgrade** (an attacker cannot strip CTX to `00` without
changing the AAD and failing the tag). This supersedes the old "bits 1–7 reserved MUST be 0": **bits 1–2 are now
`commit_mode`; bits 3–7 remain reserved (MUST be 0)**. Default `.tmf` writers SHOULD emit `commit_mode=01` (CTX)
for new long-lived sections; `00` remains valid for compatibility with the §4 baseline.

---

## 9. Golden vector + reconciliation note

### Golden vector (`python spec/_vectors/gen_tmf_encryption.py`)
Deterministic parts (KDF, commitment, 36-byte context, committed AAD, STREAM nonces) are **real SHAKE256 /
byte math** — reproducible by anyone in any language. `ct_kem` and the AEAD ciphertext+tag are **zero-filled
placeholders of the correct standard sizes** (no vetted KEM/AEAD in Python stdlib; we do not hand-roll
lattice/AEAD crypto). The verified `@noble` bench produces the **real** ct/tag; its full suite (KEM-DEM and
STREAM round-trip, tamper, AAD-binding, verify-before-decrypt, committing-AEAD) passes **11/11** under
`node --test` (the bench README's numbered list counts the dual-profile T1 — `0x01` and `0x02` — as one
logical test, hence "10").

```
shared_secret (TEST) = 000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
aead_context (36 B)  = 070000000000000003000000050000000700000000000000000002010101010000000000
   section_id=7 | coord=i32le(3,5,7,0) | modality=0 | kem=0x02 aead=0x01 dem=0x01 flags=0x01 | epoch=1 | rsvd=0
K_aead   (SHAKE256)  = 9b4fdce2fa64e0bd431f7d5d075cf18c423ef756101080d5fc15618d63dac4c5
key_commit           = bc8eee3b4561d7de4396b25921929816e5c536468568c4e481c51018ecc4a488
committed_aad (68 B) = <aead_context> ‖ <key_commit>
single-shot body     = ct_kem[1120] | nonce[12]=404142434445464748494a4b | ct[5] | tag[16]   (= 1153 B; ct_kem/ct/tag placeholders)
STREAM nonces        = idx0/last0 -> a1a2a3a4a5a6a7a800000000 ; idx1 -> …00000002 ; idx2/last1 -> …00000005
self-checks          = KDF deterministic + context/epoch/secret-bound; STREAM nonce bit-packing OK
```

### Reconciliation note (bench KDF) — ✅ DONE (2026-06-16)
The bench [`bench/lib/kemdem.mjs`](../../tri-encription/bench/lib/kemdem.mjs) originally derived `K_aead` with
**HKDF-SHA256** + SHA-256 commitment (predating the SHAKE256 ratification). It is now **reconciled to the
SHAKE256 schedule above** (suite-consistent — one Keccak family across TMX-256/ML-KEM/ML-DSA/DEM), and
`tmf-crypto.test.mjs` still passes **11/11** (the round-trip/tamper/AAD invariants don't pin derived key bytes).
The reconciliation is cross-checked by
[`bench/oracle-check.mjs`](../../tri-encription/bench/oracle-check.mjs): the **JS (`@noble`) and Python (stdlib)
DEM key schedules are now byte-identical** — for `shared_secret = bytes(0..31)` and the 36-byte context, both
produce `K_aead = 9b4fdce2…` and `key_commit = bc8eee3b…`. The conformance oracle is therefore airtight across
both implementations.

**CTX + XChaCha oracle (§8.5 / §6.1) — ✅ DONE (2026-06-16).** The new deterministic constructs are now
oracle-backed too: [`_vectors/gen_cmt_ctx.py`](_vectors/gen_cmt_ctx.py) (stdlib SHAKE256) publishes the **CTX
`commit_tag`** and the **XChaCha 24-byte STREAM nonce**, and
[`bench/oracle-check-cmt.mjs`](../../tri-encription/bench/oracle-check-cmt.mjs) proves the JS (`@noble`,
`bench/lib/commit.mjs` — the same code `cmt-ctx.mjs`/`xchacha-suite.mjs` use) bytes are **byte-identical**
(`commit_tag = ca22f4f5…`, STREAM nonce#2 `…0000000000000005`). The oracle now spans the key schedule **and** the
committing/nonce layers; the generator count is **9**.

---

## 10. Sources
- FIPS 203, *Module-Lattice-Based Key-Encapsulation Mechanism (ML-KEM)* — https://csrc.nist.gov/pubs/fips/203/final
- FIPS 204, *Module-Lattice-Based Digital Signature (ML-DSA)* — https://csrc.nist.gov/pubs/fips/204/final
- NIST SP 800-227 (ipd), *Recommendations for Key-Encapsulation Mechanisms* — https://csrc.nist.gov/pubs/sp/800/227/ipd
- RFC 9180, *Hybrid Public Key Encryption (HPKE)* — https://www.rfc-editor.org/rfc/rfc9180
- NIST SP 800-38D, *GCM* — https://csrc.nist.gov/pubs/sp/800/38/d/final · SP 800-232, *Ascon* — https://csrc.nist.gov/pubs/sp/800/232/final
- RFC 8439, *ChaCha20-Poly1305* — https://www.rfc-editor.org/rfc/rfc8439
- draft-irtf-cfrg-xchacha, *XChaCha: eXtended-nonce ChaCha and AEAD_XChaCha20_Poly1305* —
  https://datatracker.ietf.org/doc/draft-irtf-cfrg-xchacha/ (the §2.2 `0x04` suite; 24-byte nonce via HChaCha20.)
- Albertini, Duong, Gueron, Kölbl, Luykx, Schmieg, *How to Abuse and Fix Authenticated Encryption Without
  Key Commitment*, USENIX Security 2022 — https://www.usenix.org/conference/usenixsecurity22/presentation/albertini
- John Chan, Phillip Rogaway, *On Committing Authenticated Encryption* (CTX), ESORICS 2022 —
  https://eprint.iacr.org/2022/1260 (the §8.5 transform: `commit = H(K, N, A, T)`, CMT-4, reduces to CR of `H`.)
- Mihir Bellare, Viet Tung Hoang, *Efficient Schemes for Committing Authenticated Encryption*, EUROCRYPT 2022 —
  https://eprint.iacr.org/2022/268 (UtC / RtC / HtE; the CMT-1…CMT-4 commitment hierarchy.)
- Julia Len, Paul Grubbs, Thomas Ristenpart, *Partitioning Oracle Attacks*, USENIX Security 2021 —
  https://www.usenix.org/conference/usenixsecurity21/presentation/len (why non-committing AEAD is exploitable.)
- Yevgeniy Dodis, Paul Grubbs, Thomas Ristenpart, Joanne Woodage, *Fast Message Franking: From Invisible
  Salamanders to Encryptment*, CRYPTO 2018 — https://eprint.iacr.org/2019/016 (the original two-key GCM collision.)
- Blueprint: [`SPORE-AMD-024-tmf-confidentiality.md`](../../tri-encription/research/SPORE-AMD-024-tmf-confidentiality.md) ·
  measured bench: [`tri-encription/bench/README.md`](../../tri-encription/bench/README.md)

# `.tmf` signature block + key custody — v0

**Status:** Spec **FROZEN v0** (byte format + custody + FIPS-204 verification semantics); structural golden
vector reproduces (`gen_sig_block.py`, confirmed byte-for-byte); real signing/verification **impl Blocked**
(needs a vetted FIPS-204/Ed25519 library — we do **not** hand-roll or fake crypto). **Directly consumable by
Galerina task #34** — see §2.1. This fully specifies the signature block from
[`tmf-container-v0.md`](tmf-container-v0.md) §5 and the key-custody lifecycle, reusing the Galerina
`BridgeManifest` / `BridgeAttestation` idiom. A **structural** golden vector (placeholder keys, real sizes)
is in [`_vectors/gen_sig_block.py`](_vectors/gen_sig_block.py).

> **The one rule:** **sign *over* the 32-byte integrity root; never replace the hash with a signature, and
> never use a signature as an address/key.** Integrity (TMX-256) answers *"are these the exact bytes?"*;
> authenticity (this spec) answers *"did the right key-holder vouch for them?"*. Distinct jobs, combined in
> the NIST-recommended order.

---

## 1. What is signed

The signature input is the **32-byte `integrity_root`** (TMX §6) — the root of the 3-ary coordinate-bound
tree, which already binds `header_core`, every leaf, and section order. So one signature over 32 bytes
authenticates the entire file. The signer does **not** re-hash the file; the root *is* the message.

---

## 2. ML-DSA-65 done correctly (and the explainer's equation corrected)

ML-DSA-65 (FIPS 204, Module-Lattice DSA; the ex-Dilithium "Dilithium3" parameter set, modulus `q = 8380417`)
is used as a **black-box** `Sign(sk, msg) → σ` / `Verify(pk, msg, σ) → bool` over `msg = integrity_root`. We
do not reimplement it — a vetted library does (that's the Blocked dependency).

> **Correction.** The explainer's "`M · D_root ≡ S (mod q)`" is **not** how ML-DSA verifies. Verification
> (simplified but faithful) recomputes `w₁' = UseHint(h, A·z − c·t₁·2^d)` and **accepts iff** (a) the
> signature vector satisfies the norm bound `‖z‖∞ < γ₁ − β`, **and** (b) the challenge hash matches:
> `c̃ == H(μ ‖ w₁')`, where `A = ExpandA(ρ)`, `μ` binds the message (our root), and `c` is the challenge
> polynomial. It is **two checks (a norm bound + a hash match)**, not a single matrix congruence. We rely on
> the standardized algorithm, not a bespoke equation.

**Sizes (FIPS 204, ML-DSA-65):** public key **1952 B**, signature **3309 B**, secret key 4032 B.

### 2.1 The construction is generic: "hybrid Ed25519 + ML-DSA-65 over a 32-byte digest" (= Galerina #34)

This block is **not `.tmf`-specific**. It signs a **32-byte digest** with the hybrid pair; only *which* digest
changes per use:

| Use | 32-byte signing input | Digest function |
|---|---|---|
| `.tmf` (this spec) | `integrity_root` | TMX-256 (SHAKE256 tree) |
| **Galerina task #34** | `.lmanifest` body digest | **SHA-256** |

Freezing this spec therefore **directly unblocks Galerina #34** (ML-DSA-65 over the SHA-256 digest, hybrid with
Ed25519): #34 is the *same* construction with `digest = SHA-256(canonical_body)` — zero crypto-invention.

**FIPS-204 precision (the easy-to-get-wrong parts):**
- Use **pure ML-DSA** — `ML-DSA.Sign(sk, M, ctx)` with **`M` = the 32-byte digest itself** — **not**
  *HashML-DSA* (the pre-hash variant is for large messages; here the message *is* already a digest).
- **MUST pass a distinct per-surface domain-separation context** `ctx` (FIPS-204 binds `ctx` into `μ`), one per
  digest-type, so a key signing one surface cannot be cross-protocol-confused with another: e.g.
  `ctx = "tmf-root-v0"` for a `.tmf` TMX root vs a distinct `ctx` (e.g. `"galerina-manifest-v0"`) for a Galerina
  manifest's SHA-256 digest. A bare 32-byte value is otherwise ambiguous between the two; the per-surface `ctx`
  removes the ambiguity. (A distinct *key* per surface is also acceptable; a distinct `ctx` is the cheaper
  default.)
  - **Empirically verified** (`..\..\tri-encription\bench\ctx-binding.mjs`): with `@noble` ML-DSA-65, a
    signature made under `ctx="tmf-root-v0"` verifies `true` under the same ctx but `false` under a different
    ctx **and** `false` under no ctx — the context genuinely binds. The **working reference implementation** is
    the deployed per-surface-`ctx` signer in the Galerina attestation surface (owner's flow #6).
- Verification is the two-check form above (norm bound **and** `c̃ == H(μ ‖ w₁')`), with `μ` binding `M` and `ctx`.

---

## 3. Algorithms & sizes

| Alg id | Name | Class | pubkey | signature | Notes |
|---|---|---|---|---|---|
| `1` | Ed25519 | classical (RFC 8032) | 32 B | 64 B | L1; live today; **not** PQ — Shor-breakable |
| `2` | ML-DSA-65 | PQ lattice (FIPS 204) | 1952 B | 3309 B | **L3** PQ target; the Blocked dependency |
| `3` | SLH-DSA-SHA2-256s | PQ hash-based (FIPS 205) | 64 B | 29792 B | **L5** conservative backup; security rests only on the hash |
| `4` | ML-DSA-87 | PQ lattice (FIPS 204) | 2592 B | 4627 B | **L5** lattice; pairs with `kem_profile` 0x03/0x04 |

All sizes runtime-measured against `@noble/post-quantum` (`../../tri-encription/bench/profile-l5-sizes.mjs`).
SLH-DSA-SHA2-256**f** (sig 49856 B, faster signing) is the alternate `0x03` parameter set where verify/sign
latency matters more than artifact size; `256s` is the default for long-lived archives (smaller signatures,
slow signing — irrelevant on the cold path).

---

## 4. Signature block byte format

Located immediately after the payload region; present iff `flags.signed` (container §5). All ints LE.

```
0   2   sig_count   u16          1 = single, 2 = hybrid (verification = logical AND over all entries)
then sig_count entries, each:
    2   alg         u16          1=Ed25519, 2=ML-DSA-65, 3=SLH-DSA-SHA2-256s, 4=ML-DSA-87  (see §3)
    4   pubkey_len  u32
    …   pubkey      bytes
    4   sig_len     u32
    …   signature   bytes        = Sign(sk, integrity_root)
```

### Structural golden vector (hybrid Ed25519 + ML-DSA-65; placeholder keys)
`python spec/_vectors/gen_sig_block.py` (pk/sig are **zero-filled placeholders of the correct sizes** —
**not** real signatures; signing is Blocked):

```
signing input (integrity_root) = 43386e644c7b53aa0900cda21c15acd15f30b3fdf997950e39e7dd3dbc685212

L3 transition default — algs {Ed25519, ML-DSA-65}, verify = AND:
  entry alg=1 (Ed25519)    pubkey_len=  32   sig_len=  64
  entry alg=2 (ML-DSA-65)  pubkey_len=1952   sig_len=3309
  total block size = 5379 bytes   (2 + Ed25519[106] + ML-DSA-65[5271])
  header bytes     = 02000100200000000000000000000000  (count=2 | alg=1 | pubkey_len=32 | pk[0:6 zeros]…)

L5 long-lived profile (Path B) — algs {ML-DSA-87, SLH-DSA-256s}, verify = AND:
  entry alg=4 (ML-DSA-87)     pubkey_len=2592   sig_len= 4627
  entry alg=3 (SLH-DSA-256s)  pubkey_len=  64   sig_len=29792
  total block size = 37097 bytes  (2 + ML-DSA-87[7229] + SLH-DSA-256s[29866])
  header bytes     = 02000400200a00000000000000000000  (count=2 | alg=4 | pubkey_len=2592 | pk[0:6 zeros]…)

verify (no lib, either profile) -> AuthError: no vetted verifier wired -> reject signed file (fail-closed)
```

---

## 5. Hybrid policy (recommended default during the PQ transition)

- **Default `sig_count = 2`, algs `{Ed25519, ML-DSA-65}`.** Verification is **AND** — *both* must verify.
  Rationale: you stay authentic if *either* primitive holds (Ed25519 covers a hypothetical ML-DSA
  implementation flaw today; ML-DSA covers the quantum future). This mirrors Galerina's own posture
  (Ed25519 live, ML-DSA-65 migration on cold paths).
- A pure-PQ profile (`{ML-DSA-65}`) is allowed; `flags.signed` + the algs are bound under the signed root, so
  the profile cannot be silently downgraded.
- **Multi-party / M-of-N custody:** this AND rule is the `k = n` special case of a **k-of-n signature quorum** —
  see [`threshold-custody-v0.md`](threshold-custody-v0.md), which generalizes "all `n` must verify" to "at least
  `k` of `n` *distinct* registered signers must verify" (the threshold `k` is verifier policy, not a file field),
  and pairs it with k-of-n Shamir secret-sharing of the data key — so no single key/holder is a single point of
  unlock.
- **Level-5 long-lived profile (Path B, owner-ratified 2026-06-16): `{ML-DSA-87, SLH-DSA-SHA2-256s}`, AND-verified.**
  For decades-lived `.tmf` archives, pair the level-5 lattice signature (ML-DSA-87) with the **hash-based**
  SLH-DSA — whose security rests *only* on the hash, not on any lattice assumption. AND-verification means a
  future cryptanalytic break of one family still leaves the artifact authentic under the other. This is the
  cold-path signature half of the level-5 tier (its KEM half is `kem_profile` 0x03/0x04, tmf-encryption-v0 §2.1).
  No classical curve is needed here: unlike the KEM transition hedge, both halves are PQ and SLH-DSA *is* the
  conservative hedge. (Sign latency is irrelevant — once per artifact.)

---

## 6. Verification (fail-closed; container §6 step 5)

```
if flags.signed:
    block present + well-formed at file[region_off + payload_region_len : ]   else AuthError
    parse sig_count entries
    for each entry: ok = Verify(alg, pubkey, integrity_root, signature)       else AuthError on any false
    (hybrid = AND: every entry MUST verify)
    key_id(pubkey) is current and NOT revoked (see §7)                        else AuthError
otherwise: a reader with no vetted verifier MUST reject every flags.signed=1 file (never downgrade).
```

Trust in `pubkey` comes from the **Trust Capsule / out-of-band PKI** (§7), **not** from the file — the file
carries the key only so the verifier knows *which* key to check against the trusted registry.

---

## 7. Key custody lifecycle (reuse `BridgeManifest` / `BridgeAttestation`)

Custody is the genuinely hard part (it is Galerina's open blocker #34/#107-109 too). v0 reuses the existing
attestation idiom rather than inventing a `.tmf`-specific PKI.

- **Identity:** every signing key has a `key_id`, e.g. `tmf-key-YYYY-MM` (one active signing key per period;
  finer granularity allowed). The `key_id` is recorded in the `BridgeManifest`/attestation, not invented per-file.
- **Private-key custody:** signing keys live in an **HSM/KMS**, never in the repo, never in a `.tmf`, never
  in source. (Matches the "no secrets/private keys committed" rule.) The signer is a **vetted FIPS-204/Ed25519
  library invoked through the Galerina governance/capability boundary** (a host call — crypto cannot live in
  `.spore`: `galerina check` rejects even bitwise `^`, see `..\..\tri-encription\spore\probe-no-bitwise.spore`); the key
  never enters governed `.spore` code, and the engine language is **not** assumed to be Rust (directive: prefer
  Galerina + a host crypto lib over a Rust engine, which is unusable in the main project).
- **Public-key distribution:** published via the **Trust Capsule** (the SPIFFE/Sigstore-style attestation
  surface) or a keys endpoint (e.g. `keys.../tmf/{key_id}`). Verifiers resolve `key_id → trusted pubkey`
  there; the in-file pubkey must match the registry entry.
  - **Working reference (owner-deployed):** the shipped **hybrid bridge attestation + opt-in `mlDsaPublicKey`
    admission policy** is the concrete enforcement point of this model — the bridge attestation carries the
    `{Ed25519, ML-DSA-65}` key material, and the admission policy decides *which* `mlDsaPublicKey` is admitted
    to the trusted registry (opt-in, not trust-on-first-use). That is exactly the `.tmf`-custody "resolve
    against the Trust Capsule, never trust the file's own key" rule, already running.
- **Rotation:** new `key_id` per period. Overlap window: during rotation, accept signatures from the
  previous and current `key_id`; re-signing of long-lived artifacts is optional (old signatures stay valid
  while the old `key_id` is non-revoked).
- **Revocation:** a revocation list (CRL-like, published alongside the keys). A **revoked `key_id` ⇒
  `AuthError` even if the signature is cryptographically valid** — revocation is checked at verify time
  (§6). This is the one place a "valid signature" is still refused, and it is intentional (fail-closed).

---

## 8. Status & what unblocks it
- **Blocked on:** a vetted FIPS-204 (ML-DSA-65) + Ed25519 implementation, invoked through the Galerina
  governance/capability boundary (a host/native lib — **not** assumed Rust; directive #1 prefers Galerina over a
  Rust engine, unusable in the main project). For Galerina #34 the natural path is its existing attestation
  host-call surface: **`@noble/post-quantum` `ml_dsa65` + `ed25519`** are already a Galerina dependency, so #34
  needs no new crate and no Rust.
- **Until then:** the format and custody lifecycle are fully specified; readers **reject** all `flags.signed=1`
  files (no silent downgrade). No placeholder is ever shipped as if it were a real signature.

## 9. Threats addressed
| Threat | Mitigation |
|---|---|
| Forge a `.tmf` | ML-DSA-65 (PQ) over the root; hybrid adds Ed25519 |
| Quantum break of classical sig | ML-DSA-65 half of the hybrid holds |
| Downgrade (drop the PQ half) | `flags.signed` + algs bound under the signed root; AND verification |
| Stolen signing key | rotation (new `key_id`) + **revocation** (revoked `key_id` → `AuthError`) |
| Trust the file's own key blindly | pubkey resolved against the Trust Capsule registry, not trusted from the file |
| Reader without PQC lib silently accepts | fail-closed: MUST reject every signed file |

## Sources
- FIPS 204, *Module-Lattice-Based Digital Signature Standard (ML-DSA)* — https://csrc.nist.gov/pubs/fips/204/final
- FIPS 205, *Stateless Hash-Based Digital Signature Standard (SLH-DSA)* — https://csrc.nist.gov/pubs/fips/205/final
- RFC 8032, *Edwards-Curve Digital Signature Algorithm (EdDSA)* — https://www.rfc-editor.org/rfc/rfc8032
- Galerina KB: `galerina-governance-signature.md`, `galerina-signed-attestation.md`, `galerina-post-quantum-hardware-security.md` (custody #34/#107-109)

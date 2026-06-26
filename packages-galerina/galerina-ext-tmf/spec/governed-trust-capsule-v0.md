# Governed Trust Capsule — v0 (a CWT/COSE profile that bests JWT)

**Status:** Draft, buildable (deterministic parts golden-vectored with real `@noble` crypto; full COSE library
wiring Blocked on the same vetted-lib gate as signing). The near-term deliverable of the photonic-signing
research phase (`..\..\RESEARCH-PHASE-photonic-signing-and-trust-capsule.md` §2). A **profile of CWT (RFC 8392)
over COSE (RFC 8152 / 9052 / 9053)** — it inherits the COSE/CBOR ecosystem instead of inventing a wire format,
and fixes JWT's known failure modes with the **digital** primitive already built (#34 hybrid sig). Photonics
appears only where it is real (Lanes C/D/ANN), always *around* the digital signature, never as it.

> **Crypto-on-core (the hard line, inherited).** The Capsule is signed by the **digital** hybrid
> Ed25519 + ML-DSA-65 over a 32-byte digest (signature-custody-v0 §2.1 = Galerina #34). No photonic/analog
> computation is the signature. PUF/QRNG/ANN are bound *around* it (§9), under it, never replacing it.

Builds on: [`signature-custody-v0.md`](signature-custody-v0.md) (the #34 hybrid sig + per-surface ctx),
[`tmf-encryption-v0.md`](tmf-encryption-v0.md) §4 (the 36-byte AAD context),
[`inclusion-proof-v0.md`](inclusion-proof-v0.md) (selective disclosure), `ENCRYPTION-RND-FULL-BRIEF.md` §3.

---

## 1. Why CWT/COSE, and why a *profile* (not a new format)
CWT/COSE is the CBOR-native, IETF-standard signed-claims stack (the binary analog of JWS/JWT). Choosing it:
- **inherits ecosystem trust** (RFC-defined structures, existing verifiers, the CBOR deterministic-encoding
  rules) — the brief's "adopt standards, don't invent" posture;
- **is binary + length-prefixed by construction** (CBOR major types encode length), which removes JWT's
  base64url/JSON canonicalization ambiguity *for free* — the same property `.tmf`'s `LP()` gives, native to CBOR;
- leaves room for the fixes below as a **profile** (constraints + claim/header conventions), not a fork.

### JWT flaw → Trust Capsule fix
| JWT flaw | Trust Capsule fix |
|---|---|
| `alg:none`; RS256↔HS256 alg-confusion (verifier dispatches on attacker-controlled `alg`) | **Verifier fixes the algorithm by policy/key metadata**; `alg` lives in the COSE *protected* header (signed) and the verifier rejects any token whose `alg` ≠ the key's bound alg. `none` is not in the profile registry (§4). |
| JSON/base64url canonicalization ambiguity | **CBOR deterministic encoding** (RFC 8949 §4.2 / CTAP2 canonical) — definite-length, sorted keys, smallest-int — length-prefixed by nature (≡ `.tmf` `LP()`). |
| No post-quantum | **Hybrid Ed25519 + ML-DSA-65**, AND-verified, per-surface FIPS-204 ctx (#34, built + verified). |
| No channel/replay binding | **`external_aad` = the 36-byte AAD context** (audience ‖ epoch ‖ channel ‖ purpose), signed-but-not-transmitted (§5). |
| Coarse ambient claims | **Capability-scoped, deny-by-default** claims + macaroon-style **attenuable caveats** (§6). |
| Whole-token disclosure | **TMX-256 inclusion proofs** over the claim set — disclose a subset + Merkle path (§7). |
| Silent-accept readers | **Fail-closed reader + K3 verdict** (`allow / deny / unknown → deny`) (§8). |
| (new) hardware binding | Optional **optical-PUF** sender-constraint (Lane C, defense-in-depth, §9). |
| (new) entropy | **QRNG** nonces / ephemeral keys (Lane D, §9). |
| (new) fast attribute policy | **photonic-ANN** attribute matching, trusted endpoint only, post decrypt+re-verify (§9). |

---

## 2. Structure — COSE_Sign hybrid over a CWT claims set
The Capsule is a **`COSE_Sign`** object (CBOR tag 98 — *multiple* signers, for the hybrid), not `COSE_Sign1`,
because two independent signatures (Ed25519 **and** ML-DSA-65) must both verify (AND):

```
COSE_Sign = [ protected : bstr .cbor header_map,     ; body-protected header (signed)
              unprotected : header_map,               ; e.g. kid hints (not signed)
              payload : bstr .cbor CWT_Claims,         ; the CWT claims (CBOR map, int keys)
              signatures : [ COSE_Signature, COSE_Signature ] ]   ; [Ed25519, ML-DSA-65]
COSE_Signature = [ protected : bstr .cbor { 1: alg }, unprotected : { 4: kid }, signature : bstr ]
```
- `payload` is a **CWT claims map** (RFC 8392): `1`=iss `2`=sub `3`=aud `4`=exp `5`=nbf `6`=iat `7`=cti
  (+ `8`=cnf RFC 8747 for the PUF/key confirmation, §9; profile claims in the private range, §6).
- Each `COSE_Signature.protected` pins its own `alg` (signed): **EdDSA = `-8`** (RFC 9053); **ML-DSA-65 = `-49`**
  — the IANA-registered COSE code point from **RFC 9964** (*ML-DSA for JOSE and COSE*, Proposed Standard, 2026;
  also ML-DSA-44 = `-48`, ML-DSA-87 = `-50`). *(The draft `draft-ietf-cose-dilithium` is now published as
  RFC 9964; an earlier version of this doc wrongly called the code point provisional — corrected on review.)*

### The signed message — RFC-9964-conformant COSE signing
COSE signs the **`Sig_structure`** directly. RFC 9964 mandates **empty `ctx`** for ML-DSA in COSE and **no
application-layer pre-hash** (pure ML-DSA over the `Sig_structure` bytes as the message `M`):
```
Sig_structure = [ "Signature", body_protected, sign_protected, external_aad, payload ]   ; RFC 9052 §4.4
M             = CBOR(Sig_structure)                      ; the message, signed DIRECTLY (no pre-hash)
sig_ed        = Ed25519.sign(M, sk_ed)                   ; deterministic (RFC 8032)
sig_mldsa     = ML-DSA.Sign(M, sk_mldsa, ctx="")         ; pure ML-DSA, EMPTY ctx (RFC 9964)
```
**Per-surface domain separation (the #34 intent), done the COSE way.** RFC 9964's empty-ctx rule means the
ML-DSA `ctx` parameter cannot carry the per-surface label #34 used. Instead the Capsule binds the surface into
the **signed `body_protected` header** (a `surface` label = `"tmf-trust-capsule-v0"`) **and** the `external_aad`
(§5) — both sit inside the `Sig_structure`, hence are signed — so a Capsule signature still cannot be
cross-protocol-confused with a `.tmf`-root or Galerina-manifest signature under the same key. This achieves #34's
domain-separation goal while staying RFC-9964-interoperable.
**Relation to #34 / `.tmf`.** The `.tmf`-root and Galerina-#34-manifest surfaces are *not* COSE objects and keep
the #34 construction verbatim (pure ML-DSA over a 32-byte digest with a per-surface `ctx`, signature-custody
§2.1). The Capsule is the **COSE surface** of the same `{Ed25519, ML-DSA-65}` AND-hybrid, encoded per RFC 9964
(direct `Sig_structure`, empty ctx). Signing the `Sig_structure` directly (not a SHA-256 pre-hash) means there
is **no application-layer 128-bit collision ceiling** — security is ML-DSA-65's own (NIST Category 3) and
Ed25519's, exactly as RFC 9964 intends.

---

## 3. Canonical encoding
All CBOR is **deterministically encoded** (RFC 8949 §4.2): definite-length items, map keys sorted by encoded
bytes, integers in shortest form, no indefinite-length, no duplicate keys. A verifier MUST re-encode and
compare (reject non-canonical input) — this is the CBOR-native equivalent of `.tmf`'s length-prefixed `LP()`
canonicalization and is what kills JWT's "two parsers disagree on the bytes" class of attack.

---

## 4. Algorithm agility without alg-confusion
- The profile registry of permitted algs is **closed**: `{ EdDSA(-8), ML-DSA-65(-49, RFC 9964),
  SLH-DSA-SHA2-256s }` (the L5 cold-path profile). `none` and all MAC/symmetric algs are **absent** — a verifier
  that only knows this registry cannot be tricked into HS/RS confusion. **Maturity note:** ML-DSA's COSE binding
  is final (RFC 9964); **SLH-DSA's COSE binding is still draft-stage** (`draft-ietf-cose-sphincs-plus`, no RFC
  yet) — so the SLH-DSA entry is **provisional** until its RFC, and uses the precise FIPS-205 name
  `SLH-DSA-SHA2-256s` (not bare "SLH-DSA-256s").
- The verifier's expected alg(s) come from the **resolved key's metadata** (Trust Capsule registry / the
  signature-custody Trust Capsule, §custody), **not** from the token. The token's `alg` (in the signed
  protected header) must *equal* the key's bound alg, else `AlgMismatch → deny`. The verifier never *dispatches*
  on the token's `alg`.
- Hybrid is **AND**: both `COSE_Signature` entries must verify; a missing/mismatched second signature is a
  downgrade and fails closed (the alg set is itself bound under each signed protected header).

---

## 5. Channel / replay binding (`external_aad` = the 36-byte AAD context)
The COSE `external_aad` is **signed but not transmitted** — the verifier reconstructs it from its own context
and a mismatch fails the signature. The Capsule sets it to the `.tmf` **36-byte AAD context**
(tmf-encryption §4): `section_id ‖ coord ‖ modality ‖ kem/aead/dem/flags ‖ epoch ‖ reserved`, re-purposed as
`audience ‖ channel-coord ‖ purpose ‖ profile ‖ epoch`. Effect: a stolen Capsule replayed to a different
audience / channel / epoch / purpose reconstructs a different `external_aad` ⇒ `M` differs ⇒ both signatures
fail ⇒ replay denied, **without** the binding ever appearing in the payload (no extra disclosure).

---

## 6. Capability claims + macaroon-style attenuation
- Claims are **capability-scoped and deny-by-default**: absence of a capability = denied (never ambient
  "logged-in ⇒ allowed"). Capabilities live in a profile claim (private CWT key) as an explicit allow-list.
- **Attenuable caveats** (macaroons, Birgisson et al. 2014): a holder may *narrow* a Capsule by appending
  caveats (e.g. `expires-before`, `audience=X`, `method=GET`) without the issuer. Caveats can only **restrict**;
  the verifier evaluates every caveat under the **K3** calculus (any caveat `deny`, or `unknown`, ⇒ deny).
  Attenuation is bound by a keyed chain so a caveat cannot be dropped (the macaroon HMAC-chain, or — to stay on
  one primitive — a SHAKE256 caveat-chain mirroring the §history ratchet). **Honest note:** classic macaroons
  use HMAC; this profile pins the SHAKE256 variant for suite-consistency and records that as a deliberate
  deviation, not a new primitive.

---

## 7. Selective disclosure (TMX-256 inclusion proofs)
Instead of SD-JWT-style salted hashes, the claim set is committed as a **TMX-256 tree** (each claim a
coordinate-bound leaf); the signed `cti`/a `sd_root` claim carries the root. A holder discloses a subset of
claims + their **inclusion proofs** ([`inclusion-proof-v0.md`](inclusion-proof-v0.md), 133-B proofs) — the
verifier reconstructs the signed root and accepts only claims that prove in. Undisclosed claims never leave the
holder; the signature still covers the whole set via the root. (Reuses an already-built, golden-vectored piece.)

---

## 8. Fail-closed verify (K3)
```
1. CBOR decode; reject non-canonical (RFC 8949 §4.2)                         else MalformedCapsule
2. resolve key(s) from the Trust Capsule registry (NOT from the token)       else AuthError
3. expected alg(s) == token's signed protected alg(s)                        else AlgMismatch
4. reconstruct external_aad (§5); M = CBOR(Sig_structure)  (§2 — signed DIRECTLY, no pre-hash)
5. verify Ed25519 AND ML-DSA-65 over M (ML-DSA empty ctx, RFC 9964; §2)      else AuthError (any false)
6. key_id current + not revoked (signature-custody §7)                       else AuthError
7. exp/nbf/iat window valid                                                  else Expired/NotYetValid
8. evaluate capabilities + every caveat under K3; collapse(unknown)=deny     else GovDeny
9. (optional) confirm PUF/cnf possession (§9), if the profile requires it     else AuthError
10. Accept — emit only authorized claims.
```
Every branch is `→ deny`; `unknown → deny`. A reader without a vetted ML-DSA/Ed25519 verifier rejects every
signed Capsule (never downgrades) — same rule as signature-custody §6.

> **Canonical signing method (the ONE definition — binding for the §12 reader).** The message signed at step 4/5
> is `M = CBOR(Sig_structure)` — the COSE `Sig_structure` bytes signed **DIRECTLY**, with **no application-layer
> pre-hash** (RFC 9964 / RFC 9052 §4.4), ML-DSA `ctx = ""` (empty). This is the single method used everywhere in
> this spec (§2, §8, §11, §12) — there is no `SHA-256(...)` pre-hash anywhere. *Rationale:* (a) **standards** —
> RFC 9964 signs `Sig_structure` directly; an application `SHA-256` pre-hash is non-conformant and would not
> interoperate with a standard COSE/ML-DSA verifier (and "pure" ML-DSA ≠ the separate HashML-DSA algorithm, which
> has its own distinct code points). (b) **128-bit collision ceiling** — a SHA-256 pre-hash caps the signed
> message at SHA-256 collision resistance (~2^128), which would clamp the hybrid below **ML-DSA-65's NIST
> Category-3** margin and defeat the PQ rationale of the hybrid; direct signing keeps Ed25519 and ML-DSA-65 each
> at native strength. (c) **no streaming gain** — ML-DSA and Ed25519 already hash `M` internally and the
> `Sig_structure` is a bounded in-memory CBOR value (not a stream), so a pre-hash buys nothing and only lowers
> the ceiling. (Closes hub D13; an earlier draft of §8 step 4 erroneously wrote `M = SHA-256(CBOR(Sig_structure))`
> — corrected to the §2/RFC-9964 direct form on review, per R&D 0071.)

---

## 9. Photonic bindings — scoped, optional, always around the digital sig
| Binding | Lane | Where it sits | What it is NOT |
|---|---|---|---|
| **Optical-PUF** sender-constraint | C | a `cnf` (RFC 8747) **key-confirmation** claim: the Capsule is bound to a PUF-derived key the holder must demonstrate possession of (challenge-response) at use | not a signature; no public verifiability without the enrollment DB; **ML-modeling-attackable ⇒ defense-in-depth only, never sole** (Lane C) |
| **QRNG** entropy | D | the source for FIPS-204 hedged-signing randomness, ephemeral keys, and the `cti`/nonce — behind SP 800-90B health-tests + a DRBG conditioner | not a crypto primitive; an entropy source *outside* the cipher |
| **Photonic-ANN** attribute match | — | fast attribute-policy matching at the **trusted endpoint, post decrypt + re-verify only** | never in-network on cleartext (vec2text inversion — encrypt the attribute vector; match only at the trusted end) |
None of these is the signature. They are bound *under* the digital hybrid sig (PUF via `cnf`, QRNG via the
entropy interface, ANN strictly post-verify). Lanes B (QDS) is a future Tier-B cold-path signing lane — tracked,
not wired here.

---

## 10. Threat model
| Threat | Mitigation |
|---|---|
| Token theft + replay (different audience/channel/epoch) | `external_aad` binding (§5) — replay reconstructs a different `M`, both sigs fail |
| `alg:none` / alg-confusion / downgrade | closed alg registry + verifier-fixed alg + AND-hybrid bound under each signed header (§4) |
| Canonicalization / parser-disagreement | deterministic CBOR, re-encode-and-compare (§3) |
| Quantum adversary (harvest-now-forge-later) | ML-DSA-65 half (PQ) of the hybrid; SLH-DSA L5 cold-path profile for long-lived Capsules |
| PUF modeling (ML extraction of a noisy optical PUF) | PUF is defense-in-depth only (Lane C); compromise of the PUF still leaves the digital hybrid sig — never sole custody |
| Endpoint compromise | capability scoping + attenuation limit blast radius; ANN/attribute match only post-verify at the trusted end |
| Embedding inversion (vec2text) on a carried attribute vector | attribute vectors are **encrypted in transit**; matched only at the trusted endpoint (never a cleartext routing layer) |
| Stolen signing key | rotation + revocation (signature-custody §7); revoked `key_id` ⇒ deny even if the sig is valid |
| Silent-accept reader | fail-closed; no-verifier ⇒ reject every signed Capsule |

---

## 11. Golden vectors + adversarial review
- **Golden vectors** (generator: [`tri-encription/bench/gen-trust-capsule.mjs`](../../tri-encription/bench/gen-trust-capsule.mjs);
  output: [`_vectors/trust_capsule_vectors.txt`](_vectors/trust_capsule_vectors.txt); real `@noble`,
  RFC-9964-conformant): a fixed CWT claims set → deterministic CBOR → `Sig_structure` → **signed directly** (no
  pre-hash; ML-DSA empty ctx) → a **real, byte-reproducible** Ed25519 signature (deterministic) + a real
  ML-DSA-65 (`-49`) verify round-trip. Confirmed bytes: `body_protected = a1677375726661636574746d662d74727573742d63617073756c652d7630`
  (`{surface: "tmf-trust-capsule-v0"}`); `Sig_structure[-8]` = 164 B (sha256 `e2aa876d…`); Ed25519 pubkey
  `e4030998…`, sig `a109484c…` (64 B, `verify=true`); ML-DSA-65 pubkey 1952 / sig 3309 (`verify=true`; hedged ⇒
  length pinned, bytes vary). Seeded keys for reproducibility.

## 12. Adversarial fail-open review — run 2026-06-16 (`gen-trust-capsule.mjs`)
Code-demonstrated fail-closed (all returned `false`, i.e. rejected):
- **alg-swap** — an Ed25519 signature verified under a *different* `alg`'s `Sig_structure` (`M` differs) → rejected.
- **audience/channel replay** — one flipped byte in `external_aad` → `M` differs → both signatures reject.
- **surface-swap** — a different signed `surface` label in `body_protected` → `M` differs → rejected (the
  RFC-9964-compatible domain separation replacing #34's ctx; cross-protocol confusion blocked).
- **wrong verification key** → rejected.
Design-enforced (not code-paths in the vector, asserted by the profile + §8 reader): no `none`/MAC alg in the
closed registry; verifier never dispatches on the token's `alg` (resolves the key first, then equality-checks);
**AND-hybrid** (both signatures required — no "first that verifies"); non-canonical CBOR rejected (§3);
`unknown` capability/caveat → deny (§6/§8); absent required `cnf` → deny; expired/revoked → deny; no-crypto-lib
→ reject (never downgrade). **No fail-open path found** in the deterministic core; the remaining items are
verifier-implementation obligations the §8 algorithm makes explicit.

## 13. Sources
RFC 8392 (CWT) · RFC 8152 / 9052 / 9053 (COSE / COSE algorithms) · RFC 8949 (CBOR, deterministic encoding) ·
RFC 8747 (CWT `cnf`) · FIPS 204 (ML-DSA) · RFC 8032 (Ed25519) · **RFC 9964** (*ML-DSA for JOSE and COSE*,
Proposed Standard 2026 — ML-DSA-65 = COSE `-49`, empty ctx, signs `Sig_structure` directly;
https://www.rfc-editor.org/info/rfc9964) · `draft-ietf-cose-sphincs-plus` (SLH-DSA COSE binding, **draft**) ·
Birgisson et al., *Macaroons* (NDSS 2014) · SD-JWT (`draft-ietf-oauth-selective-disclosure-jwt`, for comparison)
· companions: signature-custody-v0, tmf-encryption-v0 §4, inclusion-proof-v0.

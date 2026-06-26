# `.tmf` container format — v0 (byte-precise, buildable)

**Status:** Draft, buildable + **verified**. Companion to
[`tmx-256-construction-v0.md`](tmx-256-construction-v0.md) (the integrity/hash core). This file
defines the **on-disk/on-wire byte layout**; TMX-256 defines how the integrity root over that layout
is computed and signed. A reference writer/reader and the golden container vector below are produced by
[`_vectors/gen_tmf_container.py`](_vectors/gen_tmf_container.py) — its `integrity_root` is **identical**
to the TMX construction's golden root, so the two specs are provably consistent.

Grounded only; nothing here depends on photonic/ternary hardware or any performance number. NVFP4 appears
as **one opt-in payload codec**, never as a mandatory unit and never in the integrity bytes
(see [external-repos-analysis.md](../research/external-repos-analysis.md) §2 — NVFP4 is real but lossy).

---

## 1. Layout overview

```
┌──────────────────────────── HEADER (56 bytes) ───────────────────────────┐
│ [0:24]  header_core  (magic, versions, profile, flags, section_count)     │  ← bound into root
│ [24:56] integrity_root = TMX-256 root (32 bytes)                          │  ← NOT bound into itself
├──────────────────────────── SECTION TABLE ───────────────────────────────┤
│ section_count × 56-byte entries (kind, modality, coord_len, off/len, leaf)│
├──────────────────────────── PAYLOAD REGION ──────────────────────────────┤
│ concatenated (coord ∥ payload) slices, referenced by table offsets        │
├──────────────────────────── SIGNATURE BLOCK ─────────────────────────────┤
│ present iff flags.signed; ML-DSA-65 (and/or Ed25519) over integrity_root  │  ← v0: format normative, impl Blocked
└───────────────────────────────────────────────────────────────────────────┘
```

All multi-byte integers are **little-endian**. There is **no implicit padding** between fields or
sections; every offset is explicit. The format is append-friendly (compaction re-serializes the payload
region without changing `integrity_root`, which is a *logical* fingerprint — see TMX §5).

---

## 2. Header (56 bytes)

| Off | Size | Field | Notes |
|---|---|---|---|
| 0 | 8 | `MAGIC` | `0x89 'T' 'M' 'F' 0x0D 0x0A 0x1A 0x0A` — PNG-style guard (detects text/CRLF mangling, bad EOF) |
| 8 | 2 | `version_major` u16 | `0` for v0. Reader rejects unknown major. |
| 10 | 2 | `version_minor` u16 | `0`. Minor bumps are backward-compatible additions. |
| 12 | 2 | `tmx_profile` u16 | `0`=SHAKE256 (FIPS, **default**), `1`=K12/KT256 (non-FIPS), `2`=BLAKE3 (non-FIPS) |
| 14 | 2 | `flags` u16 | bit0 = `signed`; bits 1–15 reserved, MUST be 0 |
| 16 | 8 | `section_count` u64 | number of section-table entries |
| **0** | **24** | **`header_core` = bytes[0:24)** | exactly the above; **this is what the root binds** |
| 24 | 32 | `integrity_root` | the TMX-256 root (TMX §5). **Not** part of `header_core` (no self-binding). |

`header_core` is the first 24 bytes verbatim. Because `flags` (incl. the `signed` bit), `tmx_profile`,
and `section_count` live inside `header_core`, none can be swapped under a valid signed root.

---

## 3. Section-table entry (56 bytes each)

| Off | Size | Field | Notes |
|---|---|---|---|
| 0 | 2 | `kind` u16 | section kind (§4.1); **bound into the leaf** |
| 2 | 2 | `modality` u16 | modality plane (§4.2); **bound into the leaf** |
| 4 | 4 | `coord_len` u32 | length of the coordinate prefix inside this section's slice |
| 8 | 8 | `blob_off` u64 | offset of the `(coord ∥ payload)` slice from the **start of the payload region** |
| 16 | 8 | `blob_len` u64 | total slice length; `payload_len = blob_len − coord_len` |
| 24 | 32 | `leaf_hash` | the TMX leaf digest (TMX §2) for `(kind, modality, coord, payload)` |

The payload region starts immediately after the table: `region_off = 56 + section_count × 56`.
For section *i*: `slice = file[region_off + blob_off_i : region_off + blob_off_i + blob_len_i]`,
`coord = slice[0:coord_len_i]`, `payload = slice[coord_len_i:]`.

Section **order is bound** into the root (it determines leaf order in the tree), so reordering is detected.

---

## 4. Field registries (v0)

### 4.1 `kind` (section kind) — opaque u16, with a small reserved registry
`0`=RESERVED · `1`=DATA · `2`=INDEX · `3`=SCHEMA · `4`=META · `7`=LINK (history-chain link-leaf,
[`tmf-history-chain-v0.md`](tmf-history-chain-v0.md) §1). Unknown kinds are *readable* (the reader
verifies them) but their semantics are application-defined. `kind` is bound into the leaf, so a
`DATA→INDEX` relabel breaks verification.

### 4.2 `modality` (payload plane) — u16, mirrors the data model
`0`=Vector · `1`=Graph · `2`=Attribute · `3`=Blob · `4`=Relation (matches `entity.spore`). Bound into the leaf.
**Modality selects the payload codec; TMX hashes the bytes opaquely either way.**

### 4.3 Modality codecs (informative) — where NVFP4 fits, as an *option*
- `Vector` MAY use **NVFP4** blocks: each block = **16 × E2M1 (4-bit) elements (8 bytes) + 1 × E4M3 (1-byte)
  per-block scale = 9 bytes** (verified against NVIDIA `modelopt`/`TransformerEngine` — see the external-repos
  analysis). NVFP4 is **lossy** → fine for embeddings/tensors, **never** for integrity-bearing bytes, and
  **never mandatory**. A `Vector` section MAY instead carry raw `f32`/`f16`, or any other codec.
- `Blob` is opaque bytes (may itself wrap JPEG/MP4/etc. — `.tmf` *wraps*, it does not obsolete codecs).
- `Graph`/`Relation`/`Attribute` codecs are application-defined in v0.

The integrity layer is **codec-agnostic**: changing a modality's codec never changes how TMX hashes it.

---

## 5. Signature block (present iff `flags.signed`)

Located immediately after the payload region. **Normative format; v0 implementation is Blocked** — it needs
a vetted FIPS-204 (ML-DSA-65) / Ed25519 library; do not hand-roll. The golden vector below is **unsigned**.

```
0   2   sig_count   u16          1 = single, 2 = hybrid (all entries must verify — logical AND)
then sig_count entries, each:
    2   alg         u16          1=Ed25519, 2=ML-DSA-65, 3=SLH-DSA-SHA2-256s, 4=ML-DSA-87  (signature-custody §3)
    4   pubkey_len  u32
    …   pubkey      bytes
    4   sig_len     u32
    …   signature   bytes        = Sign(sk, integrity_root)   ← input IS the 32-byte root, not re-hashed
```

- **Sign over the root** (TMX §6). Recommended transition form: `sig_count=2`, `{Ed25519, ML-DSA-65}`
  (secure if either holds) — the shared `BridgeManifest`/`BridgeAttestation` idiom, custody gated on
  Galerina #34/#107-109.
- Trust in `pubkey` comes from the **Trust Capsule / out-of-band PKI**, not from the file itself.
- The block is *not* covered by `integrity_root` (it signs the root); but `flags.signed` **is** in
  `header_core`, so signed↔unsigned cannot be flipped under a valid signature.

---

## 6. Reader algorithm (fail-closed; matches TMX §8)

```
1. file[0:8] == MAGIC                          else BadMagic            (hard error)
2. version_major == 0                          else UnsupportedVersion  (hard error)
   tmx_profile is implemented                  else UnknownProfile      (hard error)
2b. BOUNDS — all MUST, performed BEFORE any hashing (else MalformedTable):
    region_off = 56 + section_count*56;  region_off <= len(file)
    for each section i (entry at 56 + i*56):
        entry fully present:  56 + (i+1)*56 <= region_off
        coord_len_i <= blob_len_i
    payload_region_len = max over i of (blob_off_i + blob_len_i)   (0 if no sections)
    region_off + payload_region_len <= len(file)
    if NOT flags.signed: region_off + payload_region_len == len(file)   (no trailing bytes)
3. for each section i:
       slice = file[region_off+blob_off_i : region_off+blob_off_i+blob_len_i]
       coord = slice[:coord_len_i]; payload = slice[coord_len_i:]
       if TMX.leaf(kind_i,modality_i,coord,payload) != leaf_hash_i:  IntegrityError
4. root' = TMX.root(file[0:24], TMX.top_node([leaf_hash_0..]))
   if root' != integrity_root:                                      IntegrityError
5. if flags.signed:
       signature block MUST be present + well-formed at
         file[region_off + payload_region_len : ]                   else AuthError
       for each sig entry: verify(alg, pubkey, integrity_root, sig)
       if any fails:                                                AuthError
       — a reader with NO vetted FIPS-204/Ed25519 lib MUST reject EVERY
         flags.signed=1 file; it MUST NOT accept it as if unsigned.
6. Accept.
```

No self-healing in the trust path; any mismatch is a hard error. The **step 2b bounds checks are
normative MUST**, run **before** any leaf is hashed, and raise `MalformedTable`. The **signed path is
fail-closed**: `flags.signed=1` with an absent/malformed/unverifiable signature block is `AuthError`,
and an incomplete (no-crypto-lib) reader rejects all signed files — never silently downgrades to unsigned.

## 7. Error taxonomy (v0)

| Error | Cause | Disposition |
|---|---|---|
| `BadMagic` | first 8 bytes ≠ MAGIC | reject |
| `UnsupportedVersion` | `version_major ≠ 0` | reject |
| `MalformedTable` | offsets/lengths out of bounds, overlap, or extend past EOF | reject |
| `IntegrityError` | leaf or root mismatch | reject (fail-closed) |
| `AuthError` | `flags.signed` and signature absent / malformed / unverifiable, **or** no vetted crypto lib available | reject (fail-closed) |
| `UnknownProfile` | `tmx_profile` not implemented | reject |

Bounds-checking is **step 2b** (normative MUST, before any hashing): each table entry fully present,
`coord_len ≤ blob_len`, and `blob_off + blob_len ≤ payload_region_len` where
`payload_region_len = maxᵢ(blob_off_i + blob_len_i)`; any violation is `MalformedTable`. **Overlap:**
overlapping blob ranges do **not** break integrity — each leaf is independently re-hashed and the root
binds all leaves — so overlap is a *data-model* error, not a cryptographic one: a reader MAY warn but
MUST NOT silently treat an overlapping file as canonical. An **unsigned** file MUST have no trailing
bytes (`region_off + payload_region_len == EOF`); a **signed** file's signature block occupies the rest.

---

## 8. Golden container vector (2 sections, unsigned)

Produced by `python spec/_vectors/gen_tmf_container.py`. `integrity_root` equals the TMX golden root,
proving the two specs agree. Any conforming writer MUST produce these exact bytes for this input.

```
sections:
  sec0: kind=1(DATA) modality=0(Vector)    coord=i32le(3,5,7)  payload="hello"
  sec1: kind=1(DATA) modality=2(Attribute) coord=i32le(3,5,8)  payload="world!"

total_len      = 203 bytes
integrity_root = 43386e644c7b53aa0900cda21c15acd15f30b3fdf997950e39e7dd3dbc685212   (== TMX golden root)
layout         = header[0:56]  table[56:168]  region[168:203]

00000000  89 54 4d 46 0d 0a 1a 0a 00 00 00 00 00 00 00 00   MAGIC, ver0, ver0, profile0, flags0
00000010  02 00 00 00 00 00 00 00 43 38 6e 64 4c 7b 53 aa   section_count=2 | integrity_root…
00000020  09 00 cd a2 1c 15 ac d1 5f 30 b3 fd f9 97 95 0e   …integrity_root…
00000030  39 e7 dd 3d bc 68 52 12 01 00 00 00 0c 00 00 00   …root | entry0: kind=1 mod=0 coord_len=12
00000040  00 00 00 00 00 00 00 00 11 00 00 00 00 00 00 00   entry0: blob_off=0 blob_len=17
00000050  34 eb 47 16 9c fa f5 b3 fa c1 96 70 62 4c 4d c4   entry0.leaf_hash (leaf0)…
00000060  d7 00 28 38 be 55 42 62 5d 6a 90 d2 a5 ee fc 72   …leaf0
00000070  01 00 02 00 0c 00 00 00 11 00 00 00 00 00 00 00   entry1: kind=1 mod=2 coord_len=12 blob_off=17
00000080  12 00 00 00 00 00 00 00 65 a4 d5 56 88 38 d5 68   entry1: blob_len=18 | entry1.leaf (leaf1)…
00000090  e1 bf e4 5f 96 99 7b 25 16 74 42 5a 62 43 dc 04   …leaf1…
000000a0  da 1c a5 48 d2 11 59 4b 03 00 00 00 05 00 00 00   …leaf1 | region: coord0=i32le(3,5,…
000000b0  07 00 00 00 68 65 6c 6c 6f 03 00 00 00 05 00 00   …7) "hello" | coord1=i32le(3,5,…
000000c0  00 08 00 00 00 77 6f 72 6c 64 21                  …8) "world!"

read_tmf(buf) -> (n=2, profile=0, flags=0)                 verified OK
tamper(payload 'h'->'H')   -> IntegrityError: leaf mismatch at entry 0
signed-without-verifier    -> AuthError (refuses to downgrade a signed file)
trailing-bytes (unsigned)  -> MalformedTable
truncated-header           -> MalformedTable
```

---

## 9. Versioning & conformance
- A conforming reader MUST implement steps 1–6 (§6) and reject on any error (no partial accept).
- A conforming writer MUST reproduce §8 byte-for-byte for the given input.
- `version_minor` may add **trailing** optional structures; `version_major` bumps are breaking.
- Profile changes (`tmx_profile`) change every hash value — a deliberate, versioned break.

## 10. Not in v0
- Streaming/mmap reads, append-log/compaction, encryption-at-rest (confidentiality is **deferred** to v1 —
  see the ratified decisions). **The v1 layer is now byte-precise specced in
  [`tmf-encryption-v0.md`](tmf-encryption-v0.md):** KEM-DEM via three orthogonal selector bytes
  (`kem_profile` default hybrid X25519+ML-KEM-768; `aead_suite` default **AES-256-GCM**, Ascon-AEAD128
  constrained, ChaCha20-Poly1305 alt; `dem_mode` single-shot/STREAM), a SHAKE256 DEM KDF, an AAD-committing
  AEAD, with the **Vector/Attribute (embedding) sections encrypted** (never a cleartext in-network routing
  layer — see `..\research\encryption-architecture.md` §0). This adds a `conf_flags` confidentiality bit +
  the selector bytes — a **versioned v1 change**; the v0 byte layout and golden vector above are unaffected
  (TMX hashes ciphertext opaquely).
- Real signing (Blocked on a vetted FIPS-204/Ed25519 lib).
- Any fixed throughput/latency claim; any photonic/ternary-hardware dependency.

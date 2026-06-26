# TMX-256 (TriMerkle-XOF) — concrete v0 construction

**Status:** Draft, buildable. This is the grounded, byte-precise core extracted from
`notes/1.md` §4, with three real bugs fixed and **reproducible test vectors**. Everything
here runs on commodity hardware today; nothing in this file depends on photonic/ternary
hardware or any performance claim. See [`../research/real-vs-aspirational-ledger.md`](../research/real-vs-aspirational-ledger.md)
for what was kept vs. cut, and [`../research/encryption-architecture.md`](../research/encryption-architecture.md)
for how this sits inside the zero-trust / PQC stack.

> **One-line security model.** TMX-256 is a *hash* (integrity / content-addressing /
> Merkle proofs). It says "these are exactly these bytes, at these coordinates." It does
> **not** say "the right party vouched for this" — that is the job of the **ML-DSA-65
> signature over the root** (§6). Hash and signature are distinct and combined in the
> NIST-recommended order: **sign over the hash, never replace the hash with a signature.**

---

## 0. What TMX-256 is

A **3-ary (ternary) Merkle tree** in which every node is computed with an **XOF**
(extendable-output function), leaves are **coordinate-bound**, and the **root binds the
file header**. "TMX-256" = *TritMesh Merkle-XOF, 256-bit output*.

- **Default profile `TMX-256-SHAKE`** uses **SHAKE256** (FIPS 202) — a NIST-approved XOF.
  This is the only profile with test vectors here and the certification-safe default.
- Speed profiles (`TMX-256-K12` = KangarooTwelve/KT256 per RFC 9861; `TMX-256-B3` = BLAKE3)
  are **non-FIPS** and **out of scope for v0** beyond reserving the profile IDs. They change
  every hash value and must never be implied to be faster here without a benchmark (the
  parallel-lane speedup they target needs hardware we do not have — see the ledger).

Why 3-ary rather than binary: it matches the ternary theme and gives shorter trees
(`log₃ n` vs `log₂ n`). On a single CPU core a 3-ary tree is *not* faster than one serial
SHA-256 pass — it does strictly more work. The 3-ary shape is a **modeling** choice, not a
speed claim.

---

## 1. Notation & primitives

| Symbol | Meaning |
|---|---|
| `SHAKE256(M, 32)` | FIPS-202 SHAKE256 of message `M`, squeezed to 32 bytes |
| `LE16(x)`, `LE32(x)`, `LE64(x)` | unsigned little-endian, 2 / 4 / 8 bytes |
| `LP(b)` | **length-prefixed bytes** = `LE32(len(b)) ∥ b` (makes concatenation injective) |
| `∥` | byte concatenation |
| `H = 32` | digest length in bytes (256-bit) |
| `ARITY = 3` | tree fan-in |

**Domain tags** (ASCII, length-prefixed so their variable length is harmless):

```
TAG_ABSENT = "TMX-ABSENT-v0"
TAG_LEAF   = "TMX-LEAF-v0"
TAG_NODE   = "TMX-NODE-v0"
TAG_ROOT   = "TMX-ROOT-v0"
```

> **Why `LP(...)` everywhere.** `notes/1.md` hashed `tag ∥ codex ∥ modality ∥ TVCID ∥ len(C) ∥ C`.
> Concatenating variable-length fields without a length prefix on *every* field is a classic
> domain-separation hazard (two different field splits can produce the same byte string). v0
> length-prefixes every variable field, so the encoding is **injective**: distinct inputs
> never collide on encoding alone.

---

## 2. Leaf hash — coordinate + modality + kind binding

```
leaf = SHAKE256(
          LP(TAG_LEAF)
        ∥ LE16(kind)            // section kind (schema/data/index/meta/…)
        ∥ LE16(modality)        // modality plane (vector/graph/attribute/blob/relation)
        ∥ LP(coord)             // the TVCID coordinate bytes (opaque to TMX)
        ∥ LP(payload),          // the cell payload bytes
        32)
```

The coordinate **and** modality **and** kind are *inside* the hashed input, so a valid leaf
cannot be lifted from one `(coord, modality, kind)` and replanted at another — that changes
the leaf hash and breaks the root. This is the textbook **position-binding / domain-separation**
property, and it is the one genuinely good idea TMX inherits from the source notes.

> **Fix vs. notes/1.md:** the notes bound `modality` and `TVCID` but **not** `kind`; v0 binds
> `kind` too, so a section cannot be relabelled `data → index` under a valid tree. `coord` is
> opaque length-prefixed bytes: any TVCID encoding works (e.g. `[X,Y,T]` as three `i32`, or a
> 16-byte 64-trit address). TMX never interprets it.

---

## 3. Internal node (3-ary)

```
node = SHAKE256( LP(TAG_NODE) ∥ child0 ∥ child1 ∥ child2 , 32 )
```

Children are fixed 32-byte digests, so no length prefix is needed between them. The **ABSENT
sentinel** pads short final groups so arity is always exactly 3 and the tree shape is
deterministic for any leaf count:

```
ABSENT = SHAKE256( LP(TAG_ABSENT) , 32 )
```

> **Fix vs. notes/1.md:** the notes said missing siblings "naturally evaluate to the balanced
> ternary `0` state, requiring zero bits of absorption overhead." That conflates the *data*
> trit value `0` with a *hash-tree* padding node and is not well-defined. v0 uses an explicit,
> fixed "nothing-up-my-sleeve" ABSENT digest, which is unambiguous and testable.

> **On ABSENT being fixed/public:** ABSENT is a constant, precomputable, **non-secret** sentinel — that
> is safe. It is length-prefixed and domain-tagged (`LP(TAG_ABSENT)`), so it is syntactically distinct
> from any leaf or node input, and the root binds `LP(header_core)` alongside `top_node` (§5). Hence an
> attacker cannot forge a valid root even by contriving a different tree shape that collides on
> `top_node` — and such a collision is itself negligible under SHAKE256's 256-bit output.

---

## 4. Tree shape (deterministic for any n ≥ 1)

1. Start with the ordered list of leaf digests `L₀ … L_{n-1}` (section order = leaf order).
2. **Reduce** in groups of 3, padding the last group with `ABSENT` to a full triple; each
   triple becomes one `node`. This yields `⌈n/3⌉` nodes.
3. Repeat step 2 until exactly one node remains: that is `top_node`.
4. **Always reduce at least once** — even a single leaf becomes `NODE(L₀, ABSENT, ABSENT)`.
   So `top_node` is *always* a NODE-domain digest; a raw leaf can never be reinterpreted as
   an interior node (a small but real second-preimage hygiene point).

Section order is therefore bound into the root: reordering sections changes `top_node`.

---

## 5. Root — binds the header, never itself

```
root = SHAKE256( LP(TAG_ROOT) ∥ LP(header_core) ∥ top_node , 32 )
```

where **`header_core = file[0 .. 24)`** — the first 24 bytes of the container, i.e. everything
*before* the `integrity_root` field (see [`tmf-container-v0.md`](tmf-container-v0.md) once
written; layout summarized below).

> **Fix vs. notes/1.md and the earlier TritMesh ARCHITECTURE (the load-bearing bug).** Both
> wrote `root = XOF(… ∥ TmfHeader ∥ …)` while *also* storing the root **inside** the header.
> That is circular: the root would depend on a header field that contains the root. v0 defines
> `header_core` as the header bytes **excluding** the `integrity_root` (and excluding the
> signature block), so the root binds profile/version/flags/section-count without binding
> itself. The stored `integrity_root` is then simply `root`.

**What the root does and does not cover.** The root binds: the fixed header fields, the leaf
order, and every leaf's `(kind, modality, coord, payload)`. It deliberately does **not** bind
physical layout (byte offsets/lengths in the section table), so a file can be re-serialized
(compacted) without changing its root — the root is a *logical* content fingerprint. Layout
tampering is still caught **when the file is signed** (§6): moving a payload offset makes the
reader recompute a leaf that no longer matches the stored leaf hash bound under the signed root.

---

## 6. Signing the root — ML-DSA-65 (FIPS 204)

```
signature = ML-DSA-65.Sign(sk, root)        // FIPS 204; input is the 32-byte root
ok        = ML-DSA-65.Verify(pk, root, signature)
```

- The signature input **is the 32-byte root**. We never use the signature as an address or a
  content hash (it isn't derivable from content, isn't stable across signers).
- **Integrity vs. authenticity, stated precisely:**
  - *Unsigned* `.tmf`: the root detects **accidental corruption** and supports Merkle
    inclusion proofs, but gives **no protection against an adversary who can rewrite the whole
    file** (they recompute a consistent root). This is expected.
  - *Signed* `.tmf`: ML-DSA-65 over the root gives **post-quantum authenticity**. The trust
    chain is: `signature → root → top_node → … → leaf_hash(i) → recompute from
    (kind, modality, coord, payload)`. Break any link and verification fails closed.
- **v0 status:** the construction is specified and test-vectored for the *hash*; the *signature*
  needs a vetted FIPS-204 implementation. Do **not** ship a hand-rolled ML-DSA. Until a vetted
  library is wired, mark signing **Blocked** rather than faking it (a fake placeholder must be
  explicitly labelled non-cryptographic and rejected in any non-test profile).
- Galerina's own posture matches this: Ed25519 is live today, ML-DSA-65 is the migration target
  on cold/build paths (gated on key custody) — see the architecture report. A **hybrid**
  `Ed25519 + ML-DSA-65` dual-signature is the recommended transition form.

---

## 7. Container layout (v0 summary, for context)

```
Offset  Size  Field
------  ----  --------------------------------------------------------------
0       8     MAGIC = 0x89 'T' 'M' 'F' 0x0D 0x0A 0x1A 0x0A   (PNG-style guard)
8       2     version_major (u16 LE)
10      2     version_minor (u16 LE)
12      2     tmx_profile   (u16 LE)   0=SHAKE256(FIPS) 1=K12 2=BLAKE3
14      2     flags         (u16 LE)   bit0 = signed
16      8     section_count (u64 LE)
        ----  ^^^^^^^^^^^^^^^^^^^^ header_core = bytes [0..24)  (bound into root) ^^^^^^^^^^^^
24      32    integrity_root  (= root from §5; NOT part of header_core)
56      …     SECTION TABLE   (section_count entries, 56 bytes each)
…       …     SECTION PAYLOAD REGION (coord ∥ payload slices, referenced by table)
…       …     SIGNATURE BLOCK (present iff flags.signed; ML-DSA-65 over root)
```

**Section table entry (56 bytes):**

```
0   2   kind       (u16 LE)   bound into leaf
2   2   modality   (u16 LE)   bound into leaf
4   4   coord_len  (u32 LE)   length of the coord prefix inside this section's slice
8   8   blob_off   (u64 LE)   offset of (coord∥payload) slice from start of payload region
16  8   blob_len   (u64 LE)   total slice length;  payload_len = blob_len - coord_len
24  32  leaf_hash  (the §2 leaf digest)
```

`coord = slice[0 .. coord_len)`, `payload = slice[coord_len .. blob_len)`. One offset/length
pair per section; the coordinate is simply the slice's prefix. (The magic uses the PNG trick:
the `0x89 … 0x0D 0x0A 0x1A 0x0A` bytes detect text-mode/CRLF mangling and stray EOF handling.)

---

## 8. Reader algorithm (fail-closed)

```
1. Read & check MAGIC; else BadMagic.            (hard error)
2. Check version_major supported; else UnsupportedVersion.
3. For each section i:
     slice   = payloadRegion[blob_off_i .. blob_off_i + blob_len_i)
     coord_i = slice[0 .. coord_len_i)
     pay_i   = slice[coord_len_i .. ]
     recomputed = leaf(kind_i, modality_i, coord_i, pay_i)         (§2)
     if recomputed != leaf_hash_i:  IntegrityError.                (hard error)
4. top = top_node([leaf_hash_0 … leaf_hash_{n-1}])                 (§4)
   root' = SHAKE256(LP(TAG_ROOT) ∥ LP(file[0..24)) ∥ top, 32)      (§5)
   if root' != integrity_root:  IntegrityError.                    (hard error)
5. if flags.signed:
     if not ML-DSA-65.Verify(pk, integrity_root, signature): AuthError.  (hard error)
6. Accept.
```

**No self-healing in the trust path.** Any mismatch is a hard, fail-closed error. (The notes'
"Matrix Neighborhood Convolution" self-heal is an *availability* idea for non-trust data only,
and any repaired byte must re-verify against the signed root or be rejected — see the ledger.)

---

## 9. Inclusion (Merkle) proofs

To prove section `i` is in a signed file without shipping the whole file: give the verifier
`header_core`, `leaf_hash_i` (or the data to recompute it), and the sibling digests along the
path from leaf `i` to the root (2 siblings per level for a 3-ary tree). The verifier recomputes
`top_node`, then `root`, then checks the ML-DSA-65 signature. This enables selective disclosure
and streaming verification — a real, useful property of the tree shape (independent of any
hardware). **Now byte-precise:** see [`inclusion-proof-v0.md`](inclusion-proof-v0.md) for the wire format,
verifier algorithm, and a golden vector that reconstructs *this exact* root (`_vectors/gen_inclusion_proof.py`).

---

## 10. Golden test vectors (TMX-256-SHAKE v0)

Generated by [`_vectors/gen_tmx_vectors.py`](_vectors/gen_tmx_vectors.py) using only Python's
standard-library `hashlib.shake_256` (FIPS 202). **Reproduce with**
`python spec/_vectors/gen_tmx_vectors.py`. Any conforming implementation in any language MUST
match these:

```
ABSENT          = 1758f20e501b1baaf42d5b2d5a07a9054e2134132139ae3d3af35f95f158d563

# 2-section worked example
#   sec0: kind=1, modality=0, coord=i32le(3,5,7),  payload="hello"
#   sec1: kind=1, modality=2, coord=i32le(3,5,8),  payload="world!"
leaf0           = 34eb47169cfaf5b3fac19670624c4dc4d7002838be5542625d6a90d2a5eefc72
leaf1           = 65a4d5568838d568e1bfe45f96997b251674425a6243dc04da1ca548d211594b
top_node        = 0970038c1fe3b538db6f896672f560ceaf17cb8f0bdaf1fb53c8fe542667af0c   (= NODE(leaf0, leaf1, ABSENT))
header_core     = 89544d460d0a1a0a00000000000000000200000000000000   (MAGIC ∥ ver0 ∥ ver0 ∥ profile0 ∥ flags0 ∥ count=2)
integrity_root  = 43386e644c7b53aa0900cda21c15acd15f30b3fdf997950e39e7dd3dbc685212

# single-leaf file: top is NODE(leaf0, ABSENT, ABSENT), never a bare leaf
single-leaf top = 0ec91f7bf195b4954987aedacbfff3c188512c5fc1ff6d24db69cb95fc1e3c20

# tamper(modality 0→1 on sec0) ⇒ integrity_root changes ⇒ verification fails (checked)
```

---

## 11. What is deliberately NOT in v0

- **No `ntt_mul`, no "O(1) single clock cycle," no systolic/photonic path.** TMX is plain
  SHAKE256 on a CPU. Parallelizing the tree across lanes is a *future, benchmarked*
  optimization, not part of the format.
- **No NVFP4 hard-coding in the integrity layer.** A section payload may *contain* NVFP4
  micro-blocks, but TMX hashes opaque bytes; the container does not mandate NVFP4 (the notes'
  fixed 9-byte-block assumption is a payload codec concern, recorded as an open question).
- **No "signature = address," no hash replacement, no in-gate self-healing.** See the ledger.

## Sources
- FIPS 202, *SHA-3 Standard: Permutation-Based Hash and Extendable-Output Functions* — https://csrc.nist.gov/pubs/fips/202/final
- NIST SP 800-185, *cSHAKE, KMAC, TupleHash, ParallelHash* — https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.800-185.pdf
- FIPS 204, *Module-Lattice-Based Digital Signature Standard (ML-DSA)* — https://csrc.nist.gov/pubs/fips/204/final
- RFC 9861, *KangarooTwelve and TurboSHAKE* (KT128/KT256) — https://www.rfc-editor.org/rfc/rfc9861.html

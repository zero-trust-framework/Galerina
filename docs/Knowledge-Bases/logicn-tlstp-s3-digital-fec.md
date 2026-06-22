# TLSTP S3 — digital FEC over opaque AEAD ciphertext

> **Citation base:** `file:line` references resolve against the LogicN production repo
> (`C:\wwwprojects\LogicN`, STRICTLY READ-ONLY).
> **Binding posture (carried into every TLSTP doc):** every cipher/KDF/key/signature byte stays **Binary
> (digital)**. Photonics/analog may feed **only** a K3 governance verdict via `vAnd` (degrade-only), never a key,
> KDF, cipher, or signature byte. Fail-closed (unknown → DENY). No perf claim without a named-machine bench. Honest
> tiering (buildable-now vs substrate-gated #102-106 vs aspirational-HW). The ~75-85% that re-derives shipped
> architecture is cited, not rebuilt.

---

## 1. What it is + why adopted

S3 adds **digital forward-error-correction (an `(n,k)` erasure code — Reed–Solomon, or a fountain/LT code) layered
strictly UNDER the AEAD boundary**, so the receiver can reconstruct lost or corrupted *ciphertext* symbols from any
`k` of the `n` transmitted symbols and recover from packet loss **without retransmission** — and without the FEC ever
touching a key or plaintext byte. It is adopted as the **only sound digital residue** of the owner's refuted "ternary
symbol repair / request only the missing entropy" idea: that idea was rejected on two grounds (an AEAD/MAC fails
closed on a single bit, and a "request the missing entropy" wire-delta re-opens the killed cleartext-semantic leak
`LLN-PRIVACY-002`), whereas FEC-over-opaque-ciphertext re-introduces *none* of that —
see the refutation and the surviving residue in
`docs/Knowledge-Bases/logicn-tlstp-transport-auth-rnd-2026-06-22.md:79` (the "only sound residue = digital FEC over
opaque ciphertext") and the spec source in
`C:\wwwprojects\LogicN-R-AND-D\_session-bridge\done\0065-tlstp-trilogic-secure-transport-protocol-digital-core-spec.done.md:69-80`
(**§2 S3**). It **reuses the shipped AEAD rail unchanged**: the AES-256-GCM `C‖T` ciphertext+tag emitted by
`kemdem.ts` `seal()` (`packages-logicn/logicn-ext-tmf/src/kemdem.ts:168-188`), and the fail-closed AEAD verify in
`open()` (`kemdem.ts:189-199`). The authenticate-then-repair ordering means a post-repair bit error is **not** a soft
failure — it still fails the AEAD tag closed → `−1`/DENY at the K3 boundary `decideAtBoundary`
(`packages-logicn/logicn-tower-citizen/src/three-valued-governance.ts:141-153`).

**Tier:** buildable-now, purely digital. Repair overhead is a performance question ⇒ **no perf claim is asserted
here; any throughput/latency figure requires a named-machine bench.**

---

## 2. The maths, in detail

### 2.1 Symbols, parameters, and what "erasure" means

We transmit a **codeword** of `n` symbols built from `k` **data symbols** (the AEAD ciphertext, chunked) plus
`m = n − k` **parity symbols**. Each symbol is a fixed-length block of bytes; coding is done **byte-wise and
independently per byte position**, so the algebra is over the field of one byte, **GF(2⁸)** (the AES Rijndael field).

| Symbol | Meaning |
|---|---|
| `k` | number of original **data** symbols (chunks of opaque ciphertext) |
| `m` | number of **parity** symbols added, `m = n − k` |
| `n` | total transmitted symbols, `n = k + m` |
| `(n,k)` | the code; here a **systematic MDS** code (Reed–Solomon) |
| **erasure** | a symbol whose value is *unknown but whose position is known* (a dropped/timed-out packet, or a symbol flagged corrupt by an outer per-symbol CRC). Distinct from an *error* (unknown position). |
| `r` | the **redundancy / overhead ratio** `r = (n − k)/k = m/k` |

**Erasure-recovery property (MDS / Singleton-optimal).** A Reed–Solomon code is **Maximum-Distance-Separable**: its
minimum Hamming distance is `d = n − k + 1`. The number of *erasures* a code can fill is `d − 1 = n − k = m`.
Therefore:

> **Recovery rule.** The `k` data symbols are recoverable **iff at least `k` of the `n` symbols arrive** — i.e. **any
> `k` of the `n`**. Equivalently: tolerate up to `m = n − k` erasures. Lose `m+1` or more ⇒ **unrecoverable**.

This is the exact behaviour S3 needs: "recover the `k` data symbols from ANY `k` of the `n` transmitted symbols."

**Why erasures (positions known) cost half what errors cost.** For an MDS code with `t` errors (unknown positions) and
`e` erasures (known positions), correction succeeds iff `2t + e ≤ d − 1 = n − k`. S3 uses the **pure-erasure** regime
(`t = 0`): each transmitted symbol is either *received intact* or *absent/flagged* (an outer per-symbol integrity
check — CRC32 or a length/sequence tag — converts a corrupt symbol into a known erasure). Hence the budget is the full
`e ≤ m`. **S3 deliberately does NOT attempt blind error-correction on the ciphertext** — that is the AEAD's job, and
the AEAD must remain the sole arbiter of authenticity.

### 2.2 GF(2⁸): the arithmetic

GF(2⁸) has 256 elements (the byte values `0x00..0xFF`). It is built modulo the AES irreducible polynomial
`p(x) = x⁸ + x⁴ + x³ + x + 1` (`0x11B`).

- **Addition** is bitwise XOR: `a + b = a ⊕ b`. (Note `a + a = 0`, so addition = subtraction.)
- **Multiplication** is polynomial multiplication mod `p(x)`. Implemented in O(1) via **log/antilog tables** over a
  generator `g = 0x03` (a primitive element of GF(2⁸)):
  - `a · b = antilog[(log[a] + log[b]) mod 255]` for `a,b ≠ 0`; and `a · 0 = 0`.
  - `a⁻¹ = antilog[(255 − log[a]) mod 255]` for `a ≠ 0`.

These tables are 256-entry constants; the field has exactly the closure/associativity/distributivity/inverse axioms
needed for the linear algebra below.

### 2.3 The encoder: a systematic Vandermonde (Reed–Solomon) generator

Let the `k` data symbols (per byte position) be the column vector **d** = `(d₀, …, d_{k−1})ᵀ`. We pick `n` **distinct,
non-zero** evaluation points `x₀, …, x_{n−1} ∈ GF(2⁸)` (so we need `n ≤ 255`). The Vandermonde matrix is

```
        ┌ 1   x₀   x₀²  …  x₀^{k−1} ┐
   V =  │ 1   x₁   x₁²  …  x₁^{k−1} │      (n × k, over GF(2⁸))
        │ ⋮                          ⋮ │
        └ 1  x_{n−1} … x_{n−1}^{k−1} ┘
```

The full codeword is **c = V · d** (each `cᵢ = Σ_{j=0}^{k−1} V[i][j]·dⱼ`, all arithmetic in GF(2⁸)). The **MDS
property** is exactly the statement that **every `k×k` submatrix of `V` is invertible** — which holds for a Vandermonde
matrix precisely because the `xᵢ` are distinct (its determinant is `∏_{p<q}(x_q − x_p) ≠ 0`).

For a **systematic** code (data symbols transmitted verbatim, with parity appended — which S3 wants, so the AEAD reads
the original ciphertext untouched on the no-loss path) we row-reduce so the first `k` rows are the identity. Equivalent
construction: let `Î` be the `k×k` identity and `P` be an `m×k` **Cauchy** (or row-reduced Vandermonde) matrix every
square submatrix of which is invertible; the generator is

```
   G = [ I_k ;  P ]        (n × k)         transmit  c = G · d  =  ( d  ;  P·d )
```

so the first `k` symbols are the data `d` and the last `m = n−k` are parity `p = P·d`.

### 2.4 The decoder (erasure fill)

Suppose any subset `S` of received symbols with `|S| = k`. Let `G_S` be the `k×k` submatrix of `G` formed by the rows
indexed by `S`, and `c_S` the corresponding received values. Because **every `k×k` submatrix of `G` is invertible**
(MDS), `G_S⁻¹` exists and

```
   d = G_S⁻¹ · c_S            (exact reconstruction of all k data symbols)
```

`G_S⁻¹` is computed once via Gauss–Jordan elimination over GF(2⁸) (cost O(k³) field ops, amortized across all byte
positions in the symbol). With the systematic form, the surviving *data* rows are identity rows (free), so only the
columns for the *missing* data symbols need solving against the surviving *parity* rows.

**Proof sketch (recovery iff ≥k received).**
1. (Sufficiency) If `|S| ≥ k`, pick any `k`-subset; `G_S` is invertible (MDS) ⇒ `d = G_S⁻¹ c_S` is unique and exact. ∎
2. (Necessity) If `|S| = k − 1`, the system `G_S d = c_S` is `k−1` equations in `k` unknowns over GF(2⁸); its solution
   set is a coset of a ≥1-dimensional kernel ⇒ **≥ 256 distinct candidate `d`** all consistent with what was received.
   No deterministic rule can pick the true one without *more transmitted symbols* — and "request the missing symbol"
   is exactly the forbidden move (it re-opens `LLN-PRIVACY-002`; see §4). Hence unrecoverable. ∎

### 2.5 The LT / fountain (rateless) alternative

When `n` is not fixed in advance (a lossy, rate-unknown link), an **LT code** (a fountain code) is the rateless
substitute. Each output symbol `y` is the XOR of a random subset of the `k` input symbols:

```
   y = ⊕_{j ∈ N(y)} d_j           |N(y)| = degree drawn from the Robust-Soliton distribution μ(·)
```

The receiver runs **belief propagation (peeling)**:

```
   repeat until no change:
     find any received y with exactly ONE still-unknown neighbour d_j     (a "degree-1 ripple" symbol)
     set   d_j ← y ⊕ (⊕ of the already-known neighbours of y)             (XOR-back-substitution)
     mark d_j known; XOR d_j out of every other y that references it
```

Decoding succeeds (w.h.p.) once **≈ k·(1 + ε)** symbols arrive, for a small overhead `ε` controlled by the degree
distribution. The **Robust-Soliton distribution** `μ(d)` (Luby 2002) keeps the ripple non-empty:
`μ(d) = (ρ(d) + τ(d)) / β`, where `ρ(1)=1/k`, `ρ(d)=1/(d(d−1))` for `d≥2`, and `τ` adds a spike at `d = k/R` with
`R = c·ln(k/δ)·√k` for failure target `δ`. The crucial S3 property is identical to RS: **belief propagation operates
only on opaque ciphertext bytes via XOR; it derives no key and produces no plaintext.** XOR is GF(2⁸) addition — same
field, same binding posture.

### 2.6 The ordering invariant (authenticate-then-repair) — stated formally

Let `E_K` be AEAD-seal with key `K`, producing `(C, T)`; let `D_K` be AEAD-open, a *partial* function that returns
plaintext on a valid tag and **⊥ (DENY)** otherwise. Let `Φ = (encode, decode)` be the FEC. S3 mandates the
composition order

```
   send:     m ──E_K──► (C,T) ──chunk──► d ──encode──► c = G·d        (FEC OUTSIDE/UNDER the AEAD)
   receive:  c' (lossy) ──decode──► d̂ ──reassemble──► (Ĉ,T̂) ──D_K──► m  or  ⊥
```

The security claim S3 relies on is **transparency of repair to authenticity**:

> If `decode` succeeds it returns `d̂`. If `d̂ = d` (true erasure-fill within budget) then `D_K(Ĉ,T̂) = D_K(C,T)`. If
> `d̂ ≠ d` (a repair that produced wrong ciphertext — e.g. a genuine error miscounted as an erasure, or a budget
> overrun masked as success) then `(Ĉ,T̂) ≠ (C,T)` and, by AEAD INT-CTXT, `Pr[D_K(Ĉ,T̂) ≠ ⊥] ≤ ε_AEAD` (negligible:
> ~2⁻¹²⁸ for GCM's 128-bit tag).

So **a post-repair bit error still fails the tag closed → `−1`/DENY**. FEC can only ever turn an *erasure* into a
clean ciphertext or fail; it can never forge authenticity, and it never participates in the authenticity decision. The
verdict path is unchanged: a failed `open()` yields a `−1` that `decideAtBoundary` collapses to deny
(`three-valued-governance.ts:141-153`), and an INDETERMINATE (e.g. "still waiting for more symbols") collapses to deny
too (`LLN-GOV-3VL-001`, `three-valued-governance.ts:99-128`). **Unknown → DENY** holds end to end.

---

## 3. Worked examples

All three use the canonical S3 sizing from
`0065-...done.md:77` worked spec: **`k = 4` data + `m = 2` parity = `n = 6`**, so the budget is `m = 2` erasures and
overhead `r = (n−k)/k = 2/4 = 50%`.

To keep the field arithmetic legible we use a **single-byte symbol per chunk** and a small systematic generator. Take
evaluation points and build a systematic `G = [I₄ ; P]` whose two parity rows are

```
   p₀ = 1·d₀ ⊕ 1·d₁ ⊕ 1·d₂ ⊕ 1·d₃                 (a plain XOR row — "even parity")
   p₁ = α⁰·d₀ ⊕ α¹·d₁ ⊕ α²·d₂ ⊕ α³·d₃              (a Vandermonde row, α = g = 0x03)
```

with GF(2⁸) powers of `α = 0x03`: `α⁰ = 0x01`, `α¹ = 0x03`, `α² = 0x05`, `α³ = 0x0F`.
(Check: `0x03·0x03 = x²+x = 0x05`; `0x05·0x03 = (x²+1)(x+1) = x³+x²+x+1 = 0x0F`.) Every 4×4 submatrix of this `G` is
invertible (the parity rows are distinct Vandermonde evaluations), so any 4 of 6 symbols reconstruct.

### Example A — lose 2 symbols → recover (within budget)

**Inputs.** Data bytes `d = (d₀,d₁,d₂,d₃) = (0x10, 0x20, 0x30, 0x40)` (one byte per ciphertext chunk, after
`kemdem.seal()`).

**Encode (sender).**
- `p₀ = 0x10 ⊕ 0x20 ⊕ 0x30 ⊕ 0x40`. Step: `0x10⊕0x20 = 0x30`; `0x30⊕0x30 = 0x00`; `0x00⊕0x40 = 0x40`. ⇒ **`p₀ = 0x40`**.
- `p₁ = 0x01·0x10 ⊕ 0x03·0x20 ⊕ 0x05·0x30 ⊕ 0x0F·0x40`.
  - `0x01·0x10 = 0x10`
  - `0x03·0x20 = 0x60`  (`0x20·2 = 0x40`, `⊕ 0x20 = 0x60`)
  - `0x05·0x30`: `0x30·2 = 0x60`, `·4 = 0xC0`; `0x05 = 4+1` ⇒ `0xC0 ⊕ 0x30 = 0xF0`
  - `0x0F·0x40`: `0x40·2 = 0x80`, `·4 = 0x80·2 = 0x1B (reduce: 0x100⊕0x11B=0x1B)`… use `0x40 = 0100 0000`:
    `·2=0x80`, `·4=0x1B`, `·8=0x36`; `0x0F = 8+4+2+1` ⇒ `0x36 ⊕ 0x1B ⊕ 0x80 ⊕ 0x40 = 0x6D`
    (steps: `0x36⊕0x1B=0x2D`; `⊕0x80=0xAD`; `⊕0x40=0xED` → recompute carefully below).

  Recomputing `0x0F·0x40` cleanly with the antilog table (`α=0x03`): `log[0x40]=0x06? ` — to avoid table ambiguity in
  prose, use the doubling chain just listed: `0x40·1=0x40, ·2=0x80, ·4=0x1B, ·8=0x36`. `0x0F = 1+2+4+8` so
  `0x0F·0x40 = 0x40 ⊕ 0x80 ⊕ 0x1B ⊕ 0x36`. Steps: `0x40⊕0x80=0xC0`; `0xC0⊕0x1B=0xDB`; `0xDB⊕0x36=0xED`.
  ⇒ contribution `= 0xED`.
  - Sum `p₁ = 0x10 ⊕ 0x60 ⊕ 0xF0 ⊕ 0xED`. Steps: `0x10⊕0x60=0x70`; `0x70⊕0xF0=0x80`; `0x80⊕0xED=0x6D`.
    ⇒ **`p₁ = 0x6D`**.

**Codeword transmitted:** `c = (d₀,d₁,d₂,d₃,p₀,p₁) = (0x10, 0x20, 0x30, 0x40, 0x40, 0x6D)` — 6 symbols.

**Channel.** Symbols `d₁` (idx 1) and `d₃` (idx 3) are **lost** (timed out). Received `S = {d₀, d₂, p₀, p₁}`,
`|S| = 4 = k` → within budget (`2 ≤ m = 2`).

**Decode.** Unknowns `{d₁, d₃}`; knowns `{d₀=0x10, d₂=0x30}`. Use the two parity equations:
- From `p₀`:  `d₁ ⊕ d₃ = p₀ ⊕ d₀ ⊕ d₂ = 0x40 ⊕ 0x10 ⊕ 0x30`. Steps: `0x40⊕0x10=0x50`; `0x50⊕0x30=0x60`.
  ⇒ **(eq.1) `d₁ ⊕ d₃ = 0x60`**.
- From `p₁`:  `0x03·d₁ ⊕ 0x0F·d₃ = p₁ ⊕ 0x01·d₀ ⊕ 0x05·d₂ = 0x6D ⊕ 0x10 ⊕ (0x05·0x30)`.
  `0x05·0x30 = 0xF0` (from encode). RHS: `0x6D⊕0x10=0x7D`; `0x7D⊕0xF0=0x8D`.
  ⇒ **(eq.2) `0x03·d₁ ⊕ 0x0F·d₃ = 0x8D`**.

Solve the 2×2 GF(2⁸) system. From eq.1, `d₁ = 0x60 ⊕ d₃`. Substitute into eq.2:
`0x03·(0x60 ⊕ d₃) ⊕ 0x0F·d₃ = 0x8D` → `0x03·0x60 ⊕ (0x03 ⊕ 0x0F)·d₃ = 0x8D`.
- `0x03·0x60`: `0x60·2=0xC0`, `⊕0x60=0xA0` ⇒ `0xA0`.
- `0x03 ⊕ 0x0F = 0x0C`.
So `(0x0C)·d₃ = 0x8D ⊕ 0xA0 = 0x2D`. Then `d₃ = 0x2D · (0x0C)⁻¹`.
- `(0x0C)⁻¹`: `0x0C = 0x04·0x03`; inverses: `(0x04)⁻¹` and `(0x03)⁻¹` combine, or directly via table
  `(0x0C)⁻¹ = 0xAA` (verify: `0x0C·0xAA`: `0xAA·4 = ?` → trust the table; we verify by back-substitution below).
- `d₃ = 0x2D · 0xAA`. Compute: `0x2D = 0010 1101`; `0xAA·1=0xAA, ·2=0x9F? ` — instead verify by the *known answer*
  `d₃ = 0x40`: check `0x0C · 0x40 = 0x2D`? `0x40·2=0x80,·4=0x1B,·8=0x36`; `0x0C = 4+8` ⇒ `0x1B ⊕ 0x36 = 0x2D`. ✓
  So **`d₃ = 0x40`** (consistent), and from eq.1 **`d₁ = 0x60 ⊕ 0x40 = 0x20`**. ✓

**Reconstructed `d = (0x10, 0x20, 0x30, 0x40)` — bit-identical to the original ciphertext chunks.** Reassemble
`(Ĉ,T̂) = (C,T)` and hand to AEAD `open()` (`kemdem.ts:190-199`): tag verifies → plaintext released, K3 verdict `+1`
→ `decideAtBoundary` = **allow**. FEC touched no key and no plaintext; it only filled two opaque-ciphertext symbols.

### Example B — lose 3 symbols → unrecoverable → AEAD never even runs (DENY)

**Inputs.** Same encoded codeword `c = (0x10, 0x20, 0x30, 0x40, 0x40, 0x6D)`.

**Channel.** Symbols `d₁, d₃, p₁` are lost (3 erasures). Received `S = {d₀=0x10, d₂=0x30, p₀=0x40}`, `|S| = 3 < k = 4`.
Erasure count `3 > m = 2` → **over budget**.

**Decode attempt.** Unknowns `{d₁, d₃}` (2 unknowns) but only **one** usable parity equation remains (`p₀`):
`d₁ ⊕ d₃ = 0x60`. This is 1 equation in 2 unknowns over GF(2⁸): its solution set is
`{ (d₁, d₃) : d₃ ∈ GF(2⁸), d₁ = 0x60 ⊕ d₃ }` — **256 candidate solutions**, exactly the necessity argument in §2.4.
The decoder **cannot** select the true `(0x20, 0x40)` and **returns FAIL (cannot reconstruct)**.

**S3 response (fail-closed, and this is the load-bearing behaviour):**
- The decoder **does NOT** ask the peer to "send the missing symbol's entropy / a delta-matrix" — that move is
  forbidden (it re-opens the cleartext-semantic leak `LLN-PRIVACY-002`; see §4). It may only request **whole
  additional FEC symbols of the same opaque code**, or time out.
- The reassembled buffer is incomplete ⇒ **`open()` is never called** — there is no candidate `(Ĉ,T̂)` to authenticate.
- The transport produces an **INDETERMINATE (`0`)** while the FEC budget is being collected, which
  `decideAtBoundary` collapses to **deny** with `LLN-GOV-3VL-001`
  (`three-valued-governance.ts:121-128, 141-153`). On budget exhaustion / timeout the transport FSM (S4) transitions
  `Recovering → Closed/Erase` to a definite **`−1`/DENY** — **never silently to `+1`**.

**Outcome: no plaintext, no channel — fail-closed. AEAD never ran.** This is the canonical S3 deny case from
`0065-...done.md:77` ("lose 3 → unrecoverable → AEAD never even runs").

### Example C — repaired-but-wrong ciphertext → AEAD tag fails closed (DENY)

This example exercises the **authenticate-then-repair** guarantee (§2.6) when an erasure is *miscounted* — e.g. a
symbol was silently corrupted in transit but its outer per-symbol CRC failed to flag it, so the decoder treated a
**3rd, undetected error as if 2 erasures were the whole story** and produced a `d̂ ≠ d`.

**Setup.** Same codeword; `d₁, d₃` are lost (treated as erasures, in budget), but additionally the *received* `p₀`
arrived **corrupted** as `p₀' = 0x41` (one bit flipped) and was **not** flagged (worst case). The decoder uses
`p₀' = 0x41` and `p₁ = 0x6D` and solves:
- (eq.1′) `d₁ ⊕ d₃ = p₀' ⊕ d₀ ⊕ d₂ = 0x41 ⊕ 0x10 ⊕ 0x30 = 0x61` (one bit off from the true `0x60`).
- (eq.2)  unchanged: `0x03·d₁ ⊕ 0x0F·d₃ = 0x8D`.
- Solving as in Example A but with RHS `0x61`: `(0x0C)·d₃ = 0x8D ⊕ (0x03·0x61)`. `0x03·0x61 = 0x61·2 ⊕ 0x61 = 0xC2⊕0x61 = 0xA3`.
  `(0x0C)·d₃ = 0x8D ⊕ 0xA3 = 0x2E`, so `d₃ = 0x2E·(0x0C)⁻¹ ≠ 0x40` — a **wrong** byte; `d₁` likewise wrong.

**Reassembly** yields `(Ĉ, T̂) ≠ (C, T)` — the reconstructed ciphertext differs from what was sealed.

**AEAD `open()` (`kemdem.ts:190-199`).** It recomputes the GCM tag over `Ĉ` and compares to `T̂`. By INT-CTXT, the
probability the corrupted ciphertext still verifies is `≤ 2⁻¹²⁸`. So `open()` **throws `TmfCryptoError`**
(`kemdem.ts` fail-closed open path) → the transport maps the exception to **`−1`** → `decideAtBoundary` = **deny**.

**Outcome: a post-repair bit error fails the tag closed → DENY.** FEC's miscount **cannot** be laundered into a valid
message; authenticity remains entirely the AEAD's decision. This is the §2.6 invariant in action and the reason FEC is
safe to place under the AEAD.

---

## 4. The hard build path

> **Tier reminder:** all of S3 is **buildable-now, digital**. It sits in transport/framework code under the
> **owner-unlocked B8** adapter (B8 is now UNLOCKED, 2026-06-22 —
> `docs/Knowledge-Bases/logicn-transport-auth-research-explained-2026-06-22.md:13-15`). Coordinate with **0066** (the
> B8 host adapter that runs TLSTP). **No perf claim ships without a named-machine bench.**

### 4.1 Module placement and the exact shipped functions it reuses

1. **New codec module** `packages-logicn/logicn-ext-tmf/src/fec-rs.ts` (sibling to `kemdem.ts`, same package — it
   operates on the same `Uint8Array` ciphertext objects and shares the GF(2⁸) discipline AES already lives in).
   - **Inputs:** `encode(chunks: Uint8Array[], k: number, m: number): Uint8Array[]` (returns `n = k+m` symbols, the
     first `k` identical to inputs — *systematic*); `decode(received: (Uint8Array|null)[], present: number[], k, m):
     Uint8Array[] | null` (returns the `k` data chunks, or `null` if `|present| < k`).
   - **Pure digital, no key.** It must import **nothing** from the key/KDF surface. The only cross-module touchpoint
     is the *bytes* of `SealResult.body` (`C‖T`) from `kemdem.ts:153-158, 183`.
2. **Transport framing in the B8 adapter** (0066 module, host side). Sender path:
   `seal()` (`kemdem.ts:168-188`) → **chunk `body` into `k`** → `fec-rs.encode` → frame each of the `n` symbols with a
   sequence index + an **outer per-symbol CRC32** (so a corrupt symbol becomes a *known erasure*, keeping the decoder
   in the pure-erasure regime, §2.1) → emit.
   Receiver path: collect symbols, drop CRC-failed ones → when `≥ k` present, `fec-rs.decode` → reassemble `body` →
   `open()` (`kemdem.ts:189-199`, **fail-closed**). The verdict from `open()` flows into the existing K3 boundary:
   `−1` on AEAD throw, `0` while still collecting (INDETERMINATE), `+1` only on a verified tag — resolved by
   `decideAtBoundary` (`three-valued-governance.ts:141-153`) and composed with the channel verdict via `vAnd`
   (`three-valued-governance.ts:49-51`; degrade-only, No-Coercion `effectiveVerdict = vAnd` at
   `substrate-model.ts:200-205`).
3. **Capability gating.** Expose `transport.fec` as a deny-by-default capability so FEC is *off* unless granted —
   reuse the closed capability-import builder `buildCapabilityImports` (`fuse-loader.ts:435-455`,
   `LLN-FUSE-UNKNOWN-CAP`). An ungranted `transport.fec` ⇒ refuse to fuse (no silent default).

### 4.2 Ordered implementation steps

1. **GF(2⁸) tables.** Generate `log[256]`, `antilog[512]` over `g = 0x03`, plus `mul(a,b)` and `inv(a)`. Add a
   self-test asserting `a·a⁻¹ = 1` for all `a ≠ 0` and `mul(a,b) = mul(b,a)`. (Constant tables; no runtime branching on
   secret data — see gotcha (G5).)
2. **Systematic generator `G = [I_k ; P]`.** Build `P` as a Cauchy matrix (guaranteed every-square-submatrix-
   invertible) or a row-reduced Vandermonde; assert `n ≤ 255` and `k ≤ n`. Unit-test: every `k×k` submatrix of `G`
   inverts (sample, or exhaustively for small `n`).
3. **`encode`** = the first `k` rows are passthrough; compute the `m` parity rows by GF(2⁸) matrix–vector product,
   byte-position by byte-position.
4. **`decode`** = build `G_S` from present rows, Gauss–Jordan invert over GF(2⁸), multiply. Return `null` (NOT a
   guess) when `|present| < k`.
5. **Wire it under the AEAD** in the B8 adapter exactly in the order of §2.6 (seal → chunk → encode; decode →
   reassemble → open). **The `open()` call site must be unchanged** — it already fails closed (`kemdem.ts:189-199`).
6. **Map decode/AEAD results to the trit:** `decode==null OR still-collecting → 0 (INDETERMINATE)`; `open() throws →
   −1`; `open() returns plaintext → +1`. Feed through `decideAtBoundary` and `vAnd`.
7. **(Optional) LT/fountain mode** (§2.5) for rate-unknown links: degree-sampler from the Robust-Soliton
   distribution + a peeling decoder. Same binding: XOR-only, opaque ciphertext, no key.

### 4.3 Tests to write

- **Round-trip, no loss:** systematic output ⇒ first `k` symbols byte-identical to input; `decode(encode(d)) = d`.
- **Recover boundary:** for every `k`-subset of the `n` symbols, `decode` reconstructs `d` exactly (Example A is one
  case). Property-test over random `d`.
- **Deny boundary (Example B):** any `< k` present ⇒ `decode` returns `null`; assert `open()` is **never called** and
  the boundary verdict is **deny** with `LLN-GOV-3VL-001`.
- **Repair-but-wrong (Example C):** inject a flipped bit into a *received* symbol that escapes the per-symbol CRC ⇒
  `decode` produces `d̂ ≠ d` ⇒ `open()` **throws** ⇒ verdict `−1`/deny. (Proves authenticate-then-repair.)
- **Tamper-with-tag:** flip a bit in `T` after a clean decode ⇒ AEAD fails closed.
- **Overhead/identity:** `r = m/k` matches the configured code; `n ≤ 255` and `k ≤ n` are enforced.
- **GF(2⁸) algebra:** inverse/commutativity/associativity self-tests (step 1).
- **Negative — privacy:** assert the decoder API exposes **no** "request missing symbol-`i` value/delta" path; only
  "request additional whole opaque FEC symbols." (Guards against G2.)
- **Bench (separate, named-machine):** repair throughput vs loss rate — produced only to back any future perf claim;
  **none asserted in this doc.**

### 4.4 The HARD PARTS / gotchas (called out explicitly)

- **(G1) Keep FEC strictly UNDER the AEAD — the single most important rule.** FEC must repair **ciphertext only** and
  **never** touch plaintext or a key. The composition order in §2.6 is non-negotiable: **encrypt → encode** on send,
  **decode → open** on receive. Inverting it (repair plaintext, or "repair-then-trust") would let a wrong repair pass
  as authentic — the exact thing AEAD INT-CTXT is protecting and the reason the owner's original "ternary symbol
  repair" was refuted (`logicn-tlstp-transport-auth-rnd-2026-06-22.md:79, 90`). Enforce by construction: `fec-rs.ts`
  imports nothing from the key/KDF surface, and the only legal `open()` caller is the receive path *after* `decode`.

- **(G2) NEVER "request only the missing entropy" / a delta-matrix on the wire — this re-opens `LLN-PRIVACY-002`.**
  The lawful loss-recovery move is "send **additional whole opaque FEC symbols** of the same code" (a fountain top-up),
  which leaks nothing about content. A "send me the value at position `i`" or "send the delta between your chunk and
  mine" request leaks structure of the (would-be) plaintext and re-opens the killed cleartext-semantic-routing leak
  (vec2text ~92%) the privacy rule exists to forbid (`logicn-tlstp-transport-auth-rnd-2026-06-22.md:79`,
  `0065-...done.md:78`). The decode API must make this *impossible to express*, not merely discouraged (test in §4.3).

- **(G3) Erasures vs errors — get the regime right.** S3 lives in the **pure-erasure** regime (`t = 0`, budget
  `e ≤ m`). That only holds if a *corrupt* symbol is reliably converted into a *known* erasure by an outer per-symbol
  integrity check (CRC32 / sequence tag) **before** `decode`. If a corrupt symbol slips through unflagged, you are
  silently in the error regime where the budget halves (`2t + e ≤ n−k`) and `decode` may produce `d̂ ≠ d`. **This is
  acceptable for S3 precisely because the AEAD is the backstop** (Example C): a wrong repair fails the tag closed. But
  do *not* lean on FEC for integrity — the CRC is for erasure-flagging/availability, the **AEAD alone** decides
  authenticity. Never widen the FEC into a blind error-corrector over ciphertext.

- **(G4) Fail-closed on under-budget — return `null`, never a guess.** `|present| < k` must return `null` and produce
  an INDETERMINATE→deny verdict (`LLN-GOV-3VL-001`), with the S4 timeout escalating to `−1`/Erase. A decoder that
  returns a *plausible* `d̂` from an under-determined system (256 candidates, §2.4) would hand a fabricated ciphertext
  to `open()`; even though the tag would almost certainly reject it, the *correct* behaviour is to never reach `open()`
  at all. Unknown → DENY.

- **(G5) Constant-time / no secret-dependent branching.** Although FEC operates on *ciphertext* (already public), keep
  the GF(2⁸) ops table-driven and branch-free on data values to avoid leaking via the codec the kind of side-channel
  the AEAD layer is careful about. Do not early-exit on byte values.

- **(G6) Matrix-invertibility is a *correctness* precondition, not a runtime hope.** Use a Cauchy `P` (provably MDS) or
  verify the Vandermonde points are distinct & non-zero at construction. A non-MDS generator silently breaks the
  "any-`k`-of-`n`" guarantee for some loss patterns — test every `k`-subset for small `n`.

- **(G7) Field-arithmetic bugs are easy and silent.** GF(2⁸) addition is XOR (so `+` == `−`, and `2·a ≠ a+a` in the
  field sense people expect); multiplication must reduce mod `0x11B`. The worked examples in §3 are deliberately
  hand-verifiable — use them as golden vectors. A single wrong table entry passes round-trip-no-loss tests but fails
  on specific loss patterns.

- **(G8) Don't conflate availability with the verdict.** FEC improves **availability** (fewer retransmits under loss);
  it is **not** a safety/authenticity signal and must never push a verdict toward `+1`. It only ever determines whether
  `open()` *gets a candidate to check*. The trit still comes from the AEAD result via `decideAtBoundary` + `vAnd`
  (degrade-only). This mirrors the substrate model's `vAnd` availability-not-safety stance
  (`substrate-model.ts:200-205`).

# TLSTP S5 — opt-in transport.obfuscate morphing frames

> **Citation base.** `file:line` references resolve against the LogicN production repo
> (`C:\wwwprojects\LogicN`, **READ-ONLY**). Source done: `C:\wwwprojects\LogicN-R-AND-D\_session-bridge\done\0065-tlstp-trilogic-secure-transport-protocol-digital-core-spec.done.md` §2-S5.
> Grounding: `docs/Knowledge-Bases/logicn-tlstp-transport-auth-rnd-2026-06-22.md` (D9), the absorbed cluster
> `docs/Knowledge-Bases/rd-absorbed/rd-tlstp-transport-auth-cluster-2026-06-22.md` (0065 S5), and the narrative
> explainer `docs/Knowledge-Bases/logicn-transport-auth-research-explained-2026-06-22.md` (S5 row).
>
> **Binding posture.** Crypto/KDF/cipher/signature/key bytes stay **Binary** (digital). Photonics/analog may feed
> ONLY a K3 governance verdict via `vAnd` (degrade-only), never a key. Fail-closed (unknown→DENY). **No perf claim
> without a named-machine bench.** Honest tiering. This is a BUILD-GUIDE for one adopted survivor — it does NOT
> re-derive the ~75–85% of the owner's notes that re-derive shipped architecture; those are cited, not rebuilt.

---

## 1. What it is + why adopted

**S5** is an opt-in transport capability, `transport.obfuscate`, that **morphs the on-wire size and segment
boundaries of frames** so a passive network observer cannot learn the structure of the plaintext from the
record-length sequence. The padding/segment lengths are drawn by a CSPRNG-driven length sampler that is **seeded
from the digital AEAD/KDF keystream** the channel already produces — so it introduces **zero new crypto** (the
seed is Binary key-derived material from `kemdem.ts`, never analog). It is adopted (`0065` §2-S5; hub decision
**D9**; `WILL USE` row **S5**) because it reuses two shipped rails verbatim — the **deny-by-default capability
gate** (`buildCapabilityImports`, `fuse-loader.ts:435-455` in `logicn-framework-app-kernel`, diagnostic
`LLN-FUSE-UNKNOWN-CAP`) and the **AEAD keystream** (`logicn-ext-tmf/src/kemdem.ts`) — and adds only a length
sampler plus one **hard composition rule**: a morphed frame **REPLACES** any cleartext routing tag, it never
accompanies one. It is classified as **metadata-confidentiality / availability**, NOT payload confidentiality
(the payload was already AEAD-confidential), and it carries an **honestly stated limit**: it defeats size/boundary
analysis but **not** timing/volume analysis (§2.6).

---

## 2. The maths, in detail

### 2.0 Symbols (defined once)

| Symbol | Meaning |
|---|---|
| `P` | a plaintext message, `len(P) = L` bytes |
| `L` | true plaintext length in bytes |
| `c` | the AEAD ciphertext+tag for one record; `len(c) = L + τ` where `τ` = tag length (16 B for AES-256-GCM / Poly1305) |
| `τ` | AEAD authentication-tag length in bytes (constant; 16) |
| `KS` | the digital AEAD/KDF **keystream** — Binary bytes produced by `kemdem.ts` (X25519+ML-KEM-768 → SHAKE256 → AEAD). The seed source. |
| `seed` | a fixed-width slice taken from a **dedicated obfuscation sub-stream** of `KS` (domain-separated label, never the cipher's data keystream) |
| `R` | a deterministic CSPRNG keyed by `seed`; `R.next() → uniform u ∈ [0,1)` (or a uniform integer over a range) |
| `S(L)` | the **length sampler**: a function `(L, R) ↦ ℓ`, the morphed on-wire frame size |
| `ℓ` | the chosen morphed frame size in bytes, `ℓ ≥ L + τ` (padding only — never truncation) |
| `pad` | padding bytes appended inside the AEAD boundary, `pad = ℓ − (L + τ)`, `pad ≥ 0` |
| `B` | a fixed **block/quantum** size (the granularity the sampler quantizes to), e.g. 256 B |
| `B_max` | the maximum frame size the sampler may emit (the padding ceiling) |
| `cap ∈ {granted, absent}` | the result of the `transport.obfuscate` capability check |
| `vAnd(a,b) = min(a,b)` | Kleene-∧ on the K3 verdict lattice (`three-valued-governance.ts:49`); `Verdict ∈ {DENY −1, INDETERMINATE 0, ALLOW +1}` (`three-valued-governance.ts:40-44`) |
| `O = (ℓ₁, ℓ₂, …, ℓₙ)` | the **observer's view** — the sequence of on-wire frame sizes (the ONLY size signal a passive observer gets) |
| `T = (t₁, …, tₙ)` | the **timing/volume view** — inter-frame arrival times and total byte count (explicitly OUT of S5's threat model) |

### 2.1 The capability gate (deny-by-default, fail-closed)

Morphing only ever runs if the package was admitted with the `transport.obfuscate` capability. This is the shipped
deny-by-default fold (`buildCapabilityImports`, `fuse-loader.ts:435-455`): an undeclared capability has no factory
and returns `fuseError("LLN-FUSE-UNKNOWN-CAP", …)`. As a verdict:

```
cap_verdict = (transport.obfuscate ∈ declared_capabilities) ? ALLOW(+1) : INDETERMINATE(0)
emit_morphed = ( decideAtBoundary(cap_verdict).authorized == true )
            = ( cap_verdict == ALLOW )                         // collapse: only +1 authorizes
```

`collapse(v) = allow ⇔ v == +1` (`three-valued-governance.ts:89-92`); both `0` and `−1` deny. So **absent →
INDETERMINATE → DENY → no morphing** (and, separately, no obfuscation namespace is even linked into the module).
This is the fail-closed/unknown→DENY invariant applied to the feature switch itself.

### 2.2 The length sampler `S(L)` (keystream-seeded, digital)

The seed is digital, derived material:

```
seed = HKDF-Expand(KS, label = "tlstp/obfuscate/v0", n bytes)     // Binary, domain-separated sub-stream
R    = CSPRNG(seed)                                                 // deterministic given seed
```

Then a padding-only quantizing sampler (one valid concrete `S`; the family is open as long as the invariants below
hold). Quantize the **true** size up to a block boundary, then add a keystream-random number of extra blocks:

```
base   = ceil( (L + τ) / B ) · B                       // smallest block-multiple that holds the record
extra  = floor( R.next() · (k+1) ) · B,   k ≥ 0        // 0..k extra blocks, uniform on the keystream
ℓ      = min( base + extra, B_max )                    // padding ceiling
pad    = ℓ − (L + τ)                                    // bytes of padding INSIDE the AEAD
```

**Hard invariants the sampler must satisfy (each a checkable property, not prose):**

1. **Padding-only (no truncation):**  `ℓ ≥ L + τ`  and  `pad ≥ 0`.  (You can never make a frame smaller than its
   own authenticated ciphertext.)
2. **Determinism from the digital seed only:**  `S` reads entropy **only** from `R` (which is keyed by `seed ⊂ KS`).
   No wall-clock, no `Math.random`, no analog input. Same `(seed, L)` → same `ℓ`. This is what keeps it crypto-on-core
   clean: the sampler is a pure function of Binary key material.
3. **Routing inside the seal:**  any routing/tag bytes live INSIDE the AEAD ciphertext `c` (and inside the padded
   frame), never as a cleartext sibling header (§2.5).
4. **Ceiling:**  `ℓ ≤ B_max`  (bounds the worst-case overhead; the cost is paid in bandwidth — a perf concern that
   needs a bench, §4).

### 2.3 The traffic-analysis model — what leakage is removed

Let an adversary `A` be a **passive on-path observer** who sees `O = (ℓ₁, …, ℓₙ)` (frame sizes) but cannot decrypt
(AEAD holds). The size channel leaks information about the plaintext lengths `L⃗ = (L₁, …, Lₙ)`:

```
Leakage_size(A) = I( L⃗ ; O )         // mutual information between true lengths and observed sizes
```

**Fixed-size baseline vs morphed.** With a *naïve* transport that ships one frame per message at its natural size,
`ℓᵢ = Lᵢ + τ`, so `O` is an affine bijection of `L⃗`:

```
ℓᵢ = Lᵢ + τ   ⇒   I( L⃗ ; O ) = H( L⃗ )      // sizes reveal EVERYTHING about lengths (full leakage)
```

With S5, the observed size is the quantized, keystream-padded value:

```
ℓᵢ = min( ceil((Lᵢ+τ)/B)·B + R-random·B , B_max )
```

Two reductions stack:

- **Quantization** collapses every `Lᵢ` in the half-open interval `( (m−1)B − τ , mB − τ ]` to the **same** base
  multiple `mB`. So all lengths in a block map to one observed value — the adversary cannot distinguish them. The
  size channel's *resolution* drops from 1 byte to `B` bytes:
  `H(L mod B | O)` bits per frame become **unrecoverable** from size alone.
- **Keystream padding** adds a value `extra·B` that is a deterministic function of secret key material the adversary
  does not hold. From the adversary's view, `extra` is **computationally indistinguishable from uniform** on
  `{0, B, …, kB}`. So even two messages with the *same* true length produce *different* observed sizes across the
  stream, and the mapping `O → base` is no longer invertible: the adversary cannot even recover the block multiple.

Formally, against a PRF-secure CSPRNG, for the obfuscated stream:

```
I( L⃗ ; O )  ≤  Σᵢ [ H(Lᵢ) − H(Lᵢ | ℓᵢ) ]   and   H(Lᵢ | ℓᵢ) ≥ log₂(min(B, residual-block-mass))
```

i.e. each frame's size leaks **at most** `H(Lᵢ) − log₂(B)`-style residual, and against a true PRF the recoverable
block index is masked by the uniform `extra` term ⇒ `I(L⃗;O) → 0` for the *boundary/segmentation* component.

### 2.4 The morph-replaces-tag rule (the LLN-PRIVACY-002 safety invariant)

The single security-critical algebraic constraint. Let `frame = (header, c)` where `header` may or may not contain
a **cleartext routing tag** `rt`. Define:

```
leak(frame) =  1  if rt is present in cleartext (an unsealed routing/semantic tag)
               0  otherwise
```

S5 is sound **iff** for every emitted frame:

```
emit_morphed(frame) = 1   ⇒   leak(frame) = 0          // morphing REPLACES the tag, never accompanies it
```

Contrapositive (the violation to forbid): `leak(frame) = 1  ∧  emit_morphed = 1` re-opens `LLN-PRIVACY-002` — the
killed cleartext-semantic-routing leak (vec2text ~92% reconstruction). A morphed frame that *also* carries a
cleartext tag has spent bandwidth hiding the size while broadcasting the routing class in the clear: net leakage is
**unchanged or worse**. The routing info must move INSIDE the AEAD `c` (covered by both confidentiality and
integrity), and the cleartext tag must be **deleted**, not duplicated.

### 2.5 What S5 does NOT defend — the honest limit (threat-model reasoning)

S5 protects exactly the **size/boundary** sub-channel of `O`. It does **not** protect the **timing/volume**
channel `T`:

- **Volume:** total bytes `Σℓᵢ` still scales with total true bytes `ΣLᵢ` (padding has a ceiling `B_max`; you cannot
  pad an unbounded transfer into a flat profile without unbounded cost). A 1 GB upload still looks like ~1 GB.
- **Timing:** inter-frame arrival times `T` are produced by the *application's* send schedule and the network, NOT
  by the sampler. S5 reshapes *sizes*, not *when bytes leave*. Request/response cadence, burst patterns, and
  think-time gaps survive untouched. Website-fingerprinting attacks that key on timing + total volume are
  **out of scope**.

The reason is structural: the sampler's only input is the keystream and `L`; it has no clock and emits no cover
traffic on a schedule. Defeating timing/volume needs **constant-rate padding / cover traffic / a traffic schedule**,
which is a *different* mechanism with a *different* (much higher) cost — not claimed here.

### 2.6 SNI / handshake-metadata sibling

Frame morphing does nothing for **TLS SNI** or other handshake-plaintext metadata (it sits above an established
channel). The decided answer is **NOT to invent** a bespoke LogicN mechanism: use **ECH + Oblivious HTTP
(RFC 9458)** for SNI/endpoint-metadata confidentiality (`0065` §2-S5; hub `B8` guidance step 6). S5 and ECH/OHTTP
are orthogonal, composable layers.

---

## 3. Worked examples

Concrete numbers throughout. Parameters: `τ = 16`, block `B = 256`, extra-block range `k = 3` (so `extra ∈
{0,256,512,768}`), ceiling `B_max = 4096`.

### Example A — a fixed-size baseline stream (the leak)

A naïve transport ships three messages at natural size. Plaintext lengths `L⃗ = (50, 600, 50)`.

| msg | `L` | `c = L+τ` | observed `ℓ` (naïve) |
|---|---|---|---|
| 1 | 50 | 66 | **66** |
| 2 | 600 | 616 | **616** |
| 3 | 50 | 66 | **66** |

Observer view `O = (66, 616, 66)`.  Inference: msg 1 and msg 3 are byte-identical in size ⇒ very likely the
**same** request type; msg 2 is a large distinct type. The size channel has leaked the message-type structure and a
replay/identical-request pattern. `I(L⃗; O) = H(L⃗)` — full leakage.

### Example B — the same stream, morphed (the defense), step by step

Same `L⃗ = (50, 600, 50)`. Capability `transport.obfuscate` is **granted**, so
`cap_verdict = ALLOW(+1)`, `decideAtBoundary(+1).authorized = true` ⇒ morphing runs.
Seed `R` yields the sequence `R.next() = (0.10, 0.95, 0.55, …)`.

**Frame 1** (`L=50`):
```
base  = ceil(66/256)·256 = 1·256 = 256
extra = floor(0.10 · 4)·256 = floor(0.40)·256 = 0·256 = 0
ℓ     = min(256 + 0, 4096) = 256
pad   = 256 − 66 = 190           // 190 padding bytes INSIDE the AEAD
```
**Frame 2** (`L=600`):
```
base  = ceil(616/256)·256 = 3·256 = 768
extra = floor(0.95 · 4)·256 = floor(3.80)·256 = 3·256 = 768
ℓ     = min(768 + 768, 4096) = 1536
pad   = 1536 − 616 = 920
```
**Frame 3** (`L=50`, identical plaintext-length to frame 1):
```
base  = ceil(66/256)·256 = 256
extra = floor(0.55 · 4)·256 = floor(2.20)·256 = 2·256 = 512
ℓ     = min(256 + 512, 4096) = 768
pad   = 768 − 66 = 702
```

Observer view `O = (256, 1536, 768)`.

Inference now: frame 1 and frame 3 had **identical** true lengths (50) yet appear as **256** and **768** — the
adversary cannot tell they are the same request type, and cannot recover the true length within a 256-byte block.
The keystream `extra` term (different for frames 1 and 3 because `R` advanced) broke the identical-size correlation.
Routing info for all three frames lives **inside** `c` (rule §2.4 satisfied: `leak = 0`). The size/boundary leak is
removed. (Cost: 190 + 920 + 702 = 1812 padding bytes — a **bandwidth** cost that needs a bench, §4. No perf claim
asserted.)

### Example C — DENY / failure case (the rule that protects the invariant)

Same stream, but the package was admitted **without** `transport.obfuscate`, OR a developer tried to emit a morphed
frame that still carries a cleartext routing tag.

**C1 — capability absent (deny-by-default):**
```
transport.obfuscate ∉ declared_capabilities
cap_verdict        = INDETERMINATE(0)            // unknown capability → INDETERMINATE
decideAtBoundary(0).authorized = false           // collapse: 0 denies (LLN-GOV-3VL-001)
emit_morphed       = false                        // no morphing; if the host-import was requested:
                   → fuseError("LLN-FUSE-UNKNOWN-CAP", …)   // fuse-loader.ts:443-447
```
Result: **DENY** — the stream ships unmorphed (the size leak of Example A is *present*, but no invariant is
violated, and the developer is told to declare the capability). Fail-closed: the feature is OFF unless explicitly
granted.

**C2 — morph + cleartext tag (the forbidden combination):**
```
emit_morphed = 1   AND   leak(frame) = 1     // morphed frame ALSO carries cleartext routing tag `rt`
⇒ violates §2.4 invariant  ( emit_morphed ⇒ leak == 0 )
⇒ re-opens LLN-PRIVACY-002 (cleartext-semantic-routing leak, vec2text ~92%)
```
Result: **build/lint must REJECT** this configuration (DENY). The size is hidden but the routing class is broadcast
in the clear — net leakage unchanged or worse. The fix is to move `rt` inside the AEAD and **delete** the cleartext
sibling. This is the single most important S5 gotcha (§4, HARD PART #2).

---

## 4. The hard build path

All steps are under the **owner-locked B8** gate (`feedback-http-transport-owner-locked`): B8 is **UNLOCKED** as of
2026-06-22, but `transport.obfuscate` is sequenced **after** the security core (S1 cert-gate → S4 Recovering FSM +
S2 ratchet → S3 FEC + **S5**). Build S5 with a bench, not before. Design/spec is in `0065` §2-S5; production is
cited, not edited.

**Module placement.** S5 is transport-side protocol logic that sits ABOVE the raw-byte host shim (it never sees a
key directly — it consumes already-derived keystream). It belongs in the B8 transport adapter package
(`logicn-framework-api-server`, the owner-locked B8 package) as a `tlstp/obfuscate` unit, NOT inside
`logicn-tower-citizen` (governance) and NOT inside `logicn-ext-tmf` (crypto). It *imports* from both but adds no
crypto and no new verdict type.

**Ordered steps:**

1. **Register the capability (deny-by-default).** Add `transport.obfuscate` to the capability registry consumed by
   `buildCapabilityImports` (`fuse-loader.ts:435-455`, `logicn-framework-app-kernel`). Inputs: the package's
   declared capability list. Output: either a granted obfuscation namespace or `LLN-FUSE-UNKNOWN-CAP`. **Reuse**
   `buildCapabilityImports` verbatim — do not write a parallel gate. Add a `capability-types.ts` bit position and
   confirm it is NOT a banned wildcard root.

2. **Wire the capability verdict to the feature switch.** `cap_verdict = ALLOW(+1)` iff granted, else
   `INDETERMINATE(0)`. Resolve through `decideAtBoundary` (`three-valued-governance.ts:141`) — reuse, do not
   re-implement the collapse. `emit_morphed = decideAtBoundary(cap_verdict).authorized`. Inputs: declared caps.
   Output: a boolean switch + an `LLN-GOV-3VL-001` diagnostic on collapse.

3. **Derive the obfuscation seed (digital, domain-separated).** Take a dedicated sub-stream slice off the AEAD/KDF
   keystream from `kemdem.ts` (`logicn-ext-tmf`) via `HKDF-Expand(KS, "tlstp/obfuscate/v0", n)`. Inputs: the live
   channel keystream. Output: `seed` (Binary). **Reuse** the existing SHAKE256/HKDF helpers — add no new KDF. The
   seed must come from a **distinct label** so the obfuscation CSPRNG never consumes the cipher's data keystream.

4. **Implement the length sampler `S(L)`.** Pure function `(L, R) ↦ ℓ` per §2.2 with the four invariants. Inputs:
   `L`, `τ`, `B`, `k`, `B_max`, `R`. Output: `ℓ`, `pad`. Pad INSIDE the AEAD boundary (encrypt-then-pad-the-record
   is wrong; pad-the-plaintext-then-AEAD is correct so padding is authenticated). Routing/tag bytes go INSIDE `c`.

5. **Enforce the morph-replaces-tag rule (§2.4) as a lint/build check, not a runtime hope.** A static rule that
   rejects any transport config where a morphed frame path also emits a cleartext routing tag. Output: a DENY
   diagnostic referencing `LLN-PRIVACY-002`. This is the SealTaint-adjacent guarantee — treat it as a hard gate.

6. **SNI sibling:** do NOT build a bespoke SNI hider. Document that endpoint/handshake-metadata confidentiality uses
   **ECH + Oblivious HTTP (RFC 9458)** as the decided pattern. S5 stays scoped to established-channel frame sizes.

7. **Bench before any perf/overhead claim.** Measure padding overhead (`Σpad / ΣL`), throughput, and latency on a
   **named machine**. Until then, state overhead as "bandwidth cost, unmeasured." No perf claim without a bench
   (binding posture).

**Tests to write:**

- **Determinism:** same `(seed, L)` ⇒ byte-identical `ℓ` (golden-vector the sampler).
- **Padding-only:** property test `∀ L: ℓ ≥ L+τ ∧ pad ≥ 0 ∧ ℓ ≤ B_max`.
- **Indistinguishability:** two equal-`L` messages at different stream positions produce different `ℓ` (Example B,
  frames 1 vs 3) with overwhelming probability.
- **Deny-by-default:** capability absent ⇒ no morphing + `LLN-FUSE-UNKNOWN-CAP` (Example C1).
- **Invariant guard (the load-bearing test):** morphed-frame + cleartext-routing-tag config ⇒ build REJECT with an
  `LLN-PRIVACY-002` reference (Example C2).
- **Threat-model honesty test:** assert that total volume `Σℓ` still tracks `ΣL` (within the ceiling) — encodes,
  in a test, that S5 does NOT hide volume/timing.

**HARD PARTS / gotchas (called out explicitly):**

- **HARD #1 — Pad must be INSIDE the AEAD.** If you AEAD-encrypt first and then append padding *outside* the
  ciphertext, the padding is unauthenticated and an attacker can strip it to recover `ℓ`-vs-`L` (re-opening the
  leak) or use it as a malleability oracle. Order is **plaintext + pad → AEAD**. Easy to get backwards.
- **HARD #2 (most dangerous) — The morph-replaces-tag rule (§2.4).** The intuitive, wrong implementation keeps the
  existing cleartext routing header "for routing" and just pads the body. That re-opens `LLN-PRIVACY-002` and makes
  the whole feature counterproductive. The morphed frame MUST carry routing INSIDE the seal and the cleartext tag
  MUST be deleted. This is the single easiest mistake and must be a hard build-time DENY, not a code-review note.
- **HARD #3 — Seed domain separation.** Seeding the obfuscation CSPRNG off the *same* keystream slice the cipher
  uses risks keystream reuse / cross-purpose correlation. Use a distinct HKDF label. Subtle, security-relevant.
- **EASY-to-get-wrong — Honest scope.** It is tempting to market S5 as "traffic-analysis resistance." It is
  **size/boundary** resistance only; timing and volume survive (§2.5). Overclaiming here is a documentation
  security bug — keep the limit stated wherever the feature is described.
- **GOTCHA — Padding ceiling vs availability.** `B_max` bounds overhead but also caps how much a large `L` can be
  hidden; very large records degrade toward their natural size class. This is a deliberate availability/overhead
  trade, not a bug — document it.
- **TIER note — buildable-now (digital).** Capability gate + keystream PRNG are all Binary/digital and reuse shipped
  rails; there is **no** substrate (#102-106) or photonic dependency in S5 itself. The only deferred item is the
  perf characterization, which is a bench, not a substrate gate.

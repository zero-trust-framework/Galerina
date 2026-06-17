<!-- ABSORBED R&D SOURCE — verbatim mirror. LogicN is the main library; the R&D repo is upstream/authoring.
     Source: LogicN-R-AND-D/tmf/spec/qrng-conditioning-pipeline-v0.md (roadmap #3; bench 17/17)  ·  Pinned: R&D rnd-session 2026-06-17
     Integrated LogicN view: logicn-quantum-resilience-roadmap.md (entropy.qrng interface)  ·  Catalog: logicn-rd-absorption-catalog.md
     Rule: edit the upstream source then re-vendor; do not fork this copy (feedback-auto-import-rd-docs). -->

> **Absorbed R&D source (verbatim).** See `logicn-rd-absorption-catalog.md`. Internal links point at the upstream R&D tree.

---

# QRNG SP 800-90B → SP 800-90A conditioning pipeline — v0

**Status:** Draft, buildable + **verified**. Reference + bench:
[`tri-encription/bench/qrng-conditioning.mjs`](../../tri-encription/bench/qrng-conditioning.mjs) (17/17 pass,
Node v24.16.0). Makes the SP 800-90 pipeline of
[`research/qrng-q1-entropy-capability-grounding-survey.md`](../research/qrng-q1-entropy-capability-grounding-survey.md)
(bridge task 0005) byte-precise and runnable. It reuses that survey's exact RCT/APT/DRBG parameters; it does
not repeat them. Parent research: [`research/photonic-lane-D-qrng.md`](../research/photonic-lane-D-qrng.md).

> **Honest-core (binding).** The QRNG chip is **owner-gated**: the noise source in the reference is a clearly
> labelled **software STAND-IN** (a deterministic xorshift32 PRNG), used only to exercise the health-test and
> DRBG logic. The **real** noise source is a NIST SP 800-90B ESV-validated quantum source (e.g. ID Quantique
> Quantis, ESV #63). Nothing here claims the stand-in is a QRNG, and **no throughput/perf number** is made
> (this is a correctness bench).
>
> **What this pipeline is (and is not).** A QRNG is an **entropy source, not a primitive** — it sits *before*
> the cipher/signer and supplies entropy only (crypto-on-core). **Raw bits → key is prohibited**; bits must
> pass SP 800-90B health tests and be conditioned/expanded by an SP 800-90A DRBG. No invented crypto:
> HMAC_DRBG over SHA-256 is the standard SP 800-90A §10.1.2 mechanism, instantiated over `@noble` HMAC + SHA-256.

---

## 1. Purpose

Specify the **digital** stage of a NIST-conformant random-bit pipeline that turns a physical/quantum noise
source into `rnd` (FIPS-204 hedged-signing nonce) or a key-generation seed `ξ`, **fail-closed**: any health
fault, or a DRBG reseed-required condition, returns **no bytes** (`unknown → deny`, mirroring
`LLN-ENTROPY-001/002`). The pipeline is the three SP 800-90 layers, of which a QRNG occupies only the first box:

```
[ noise source ] → [ 90B continuous health tests ] → [ 90A HMAC_DRBG(SHA-256) ] → rnd / keygen seed ξ
  STAND-IN here      RCT (§4.4.1) + APT (§4.4.2)       Instantiate/Reseed/Generate    consumed by FIPS-204
  (real = QRNG,      fail-closed: out of service        + update(), reseed_counter,
   owner-gated)       on a failed test                   reseed_interval ceiling
        └────────────────── SP 800-90C RBG construction (target RBG2/RBG3) ──────────────────┘
```

## 2. The pipeline contract

| Stage | Function | Output on success | Output on failure |
|---|---|---|---|
| 0. Noise source | one sample per draw (binary 0/1 or non-binary 0..255) | a sample | n/a (stand-in cannot itself fail; a real source raises a 90B fault) |
| 1a. RCT (90B §4.4.1) | latch a "stuck" source | accept sample | **latched fail** → pipeline returns `null` |
| 1b. APT (90B §4.4.2) | latch gradual bias / entropy loss | accept sample | **latched fail** → pipeline returns `null` |
| 1c. Pack/extract | pack accepted samples into seed material | ≥ 48 B seed (≥ 3s/2 bits at s=256) | `< 48 B` → `INSUFFICIENT_ENTROPY` → `null` |
| 2. HMAC_DRBG | Instantiate(entropy‖nonce‖pers) → Generate(n) | `n` bytes | reseed required (`reseed_counter > reseed_interval`) → `null` |
| 3. Output | `rnd` / keygen seed | bytes | (any upstream failure) → **no bytes** |

The function `runPipeline(...)` returns `{ ok, reason, bytes }`; `bytes` is `null` on **every** non-`OK`
reason (`RCT_FAIL`, `APT_FAIL`, `INSUFFICIENT_ENTROPY`, `DRBG_RESEED_REQUIRED`). There is no partial output.

## 3. SP 800-90B continuous health tests (byte/parameter-precise)

All `alpha` (false-positive rate) values are taken as a **negative-log2 exponent** `alphaLog2` (i.e.
`alpha = 2^-alphaLog2`); recommended range `2^-20 .. 2^-40` (90B §4.3), default `2^-20` (§4.4).

### 3.1 Repetition Count Test (RCT, 90B §4.4.1)

Cutoff:

```
C = 1 + ceil( -log2(alpha) / H )        with -log2(alpha) = alphaLog2  (exact, no float log of a tiny number)
```

Fail (latched) the first time any value repeats **≥ C** times consecutively. `H` = assessed per-sample
min-entropy. **Worked example (NIST 90B §4.4.1):** `H = 2.0, alpha = 2^-20 → C = 1 + ceil(20/2.0) = 11`.

| H | alphaLog2 | C |
|---|---|---|
| 2.0 | 20 | **11** (NIST worked example) |
| 4.0 | 20 | 6 |
| 1.0 | 30 | 31 |
| 0.99 | 20 | 22 (the clean-source test config) |

### 3.2 Adaptive Proportion Test (APT, 90B §4.4.2)

Window **`W = 1024` for binary** sources, **`W = 512` for non-binary**. In each window fix the **first**
sample `A`; count its occurrences over the `W` samples; **fail (latched) if count ≥ C**, where `C` is the
**binomial critical value** for `p = 2^-H` at `alpha`:

```
C = smallest c such that  P[ Binomial(W, p) >= c ] <= alpha          (one-sided upper tail; p = 2^-H)
```

There is **no universal APT cutoff** — it is per-source (depends on `W`, `H`, `alpha`). The reference
computes the tail in log-space (numerically stable). **Cross-check against a published NIST per-source value
(survey §2):** non-binary `W = 512, H = 4, alpha = 2^-28 → C = 69`. (The reference reproduces `C = 69`
exactly.) For the binary clean-source config (`W = 1024, H = 0.99, alpha = 2^-20`) the cutoff is `C = 593`.

## 4. SP 800-90A HMAC_DRBG over SHA-256 (90A §10.1.2)

Internal state `{ K (32 B), V (32 B), reseed_counter }`. `reseed_interval = 2^48`,
`max_number_of_bits_per_request = 2^19 bits = 65536 B` (90A Table 2; survey §3).

- **Update** (`§10.1.2.2`): `K = HMAC(K, V‖0x00‖provided_data); V = HMAC(K, V);` and **iff** `provided_data`
  is non-empty, `K = HMAC(K, V‖0x01‖provided_data); V = HMAC(K, V)`.
- **Instantiate** (`§10.1.2.3`): `K = 0x00·32`, `V = 0x01·32`, `Update(entropy ‖ nonce ‖ personalization)`,
  `reseed_counter = 1`.
- **Reseed** (`§10.1.2.4`): `Update(entropy ‖ additional_input)`, `reseed_counter = 1`.
- **Generate** (`§10.1.2.5`): if `reseed_counter > reseed_interval` → **return null (no bytes)**; optional
  pre-`Update(additional_input)`; `V = HMAC(K, V)` repeatedly until `n` bytes; truncate to `n`;
  post-`Update(additional_input)`; `reseed_counter += 1`.

## 5. Fail-closed rules (normative — mirrors `LLN-ENTROPY-001/002`)

1. **Health-test failure → out of service.** On the first RCT or APT failure the source is latched failed and
   the pipeline returns **`null`** (no bytes). 90B §4.3: on a persistent failure "the entropy source **shall
   not produce any outputs**." (Intermittent vs persistent handling is a documented policy decision; the
   reference latches on first failure.)
2. **Insufficient entropy → deny.** If fewer than `3s/2` bits (48 B at `s = 256`) survive to seed the DRBG,
   deny (90A §8.6 instantiate floor).
3. **Reseed required → deny, do not silently emit.** `Generate` returns `null` when
   `reseed_counter > reseed_interval`; output resumes only after a successful `Reseed` (90A §9.3 / §11.4.2
   error-state spirit). The reference demonstrates both the deny and the recovery-on-reseed.
4. **No partial output.** Any non-`OK` reason yields `bytes = null` — there is no half-filled buffer.
5. **A QRNG never keys directly.** Raw samples are never returned; only DRBG output is. The signing benefit is
   side-channel/fault hardening (FIPS-204 graceful degradation), not added unforgeability.

## 6. Golden / known-answer vectors

### 6.1 NIST CAVP HMAC_DRBG SHA-256 (proves the DRBG is the real mechanism, not a toy)

NIST CAVP DRBGVS, **HMAC_DRBG, [SHA-256], PredictionResistance = False, no reseed, COUNT 0**. Two `Generate`
calls of 1024 bits each, no personalization, no additional input; the **second** output is `ReturnedBits`.

```
EntropyInput  = ca851911349384bffe89de1cbdc46e6831e44d34a4fb935ee285dd14b71a7488
Nonce         = 659ba96c601dc69fc902940805ec0ca8
Personalization = (empty)
ReturnedBits  = e528e9abf2dece54d47c7e75e5fe302149f817ea9fb4bee6f4199697d04d5b89
                d54fbb978a15b5c443c9ec21036d2460b6f73ebad0dc2aba6e624abf07745bc1
                07694bb7547bb0995f70de25d6b29e2d3011bb19d27676c07162c8b5ccde0668
                961df86803482cb37ed6d5c0bb8d50cf1f50d476aa0458bdaba806f48be9dcb8
```

The reference reproduces `ReturnedBits` **byte-exact**.

### 6.2 Health-test cutoff golden values

| Test | Parameters | Cutoff C | Source |
|---|---|---|---|
| RCT | `H = 2.0, alpha = 2^-20` | **11** | NIST 90B §4.4.1 worked example |
| RCT | `H = 4.0, alpha = 2^-20` | 6 | `C = 1 + ceil(20/4.0)` |
| RCT | `H = 1.0, alpha = 2^-30` | 31 | `C = 1 + ceil(30/1.0)` |
| APT | `W = 512, H = 4, alpha = 2^-28` (non-binary) | **69** | survey §2 published per-source value |

### 6.3 Pipeline behavioural vectors (deterministic from the stand-in seed)

| # | Source | Config | Expected |
|---|---|---|---|
| b | clean binary, seed 12345 | `H=0.99, alpha=2^-20, 8192 samples, 64 B` | passes; deterministic 64 B; same seed → same bytes; other seed → different |
| c | stuck (constant 1) | same | `RCT_FAIL`, `bytes = null` |
| d | biased (run-capped 0.75 ones) | same | `APT_FAIL`, `bytes = null` |
| f | fixed entropy | reseed + ceiling | reseed → counter=1, output changes; `counter > 2^48` → `null`; reseed → recovers |

## 7. LogicN role (governance boundary)

Crypto and entropy cannot live in `.lln` (`logicn check` rejects even bitwise ops; `signature-custody-v0` §7).
This pipeline is a **host-side** SP 800-90 RBG invoked through the LogicN capability boundary (`entropy.qrng`).
LogicN governs the **availability and admission** of the entropy capability: a failed 90B health test →
entropy source unavailable → `unknown → deny`, identical to how a missing vetted verifier makes the reader
reject every signed file. LogicN does not generate or condition bits itself.

## 8. Conformance

A conformant implementation MUST: (1) reproduce the §6.1 CAVP `ReturnedBits` byte-exact; (2) compute the RCT
cutoff per §3.1 and reproduce the §6.2 golden cutoffs (incl. `C = 11` and `C = 69`); (3) compute the APT
cutoff as the binomial upper-tail critical value per §3.2; (4) return **no bytes** on any health-test failure,
insufficient entropy, or reseed-required condition (§5); (5) implement HMAC_DRBG `Update`/`Instantiate`/
`Reseed`/`Generate` per §4 with the `reseed_interval = 2^48` ceiling enforced. The reference bench
[`qrng-conditioning.mjs`](../../tri-encription/bench/qrng-conditioning.mjs) checks all of these (17/17).

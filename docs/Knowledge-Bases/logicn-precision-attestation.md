# #201 — Calibration-as-Attestation: the measured half of the tolerance/determinism model

**Lane opened:** 2026-06-15. **Source:** [logicn-external-idea-mining-2026-06-15.md](logicn-external-idea-mining-2026-06-15.md)
(8 vendored repos → ideas #1/#2/#3/#5/#12). **Principle:** *govern, don't absorb* — LogicN
**declares → verifies → records** numeric facts; the bridge computes them. No kernel/noise math in core,
no new crypto (SHA-256 + Ed25519 only).

## The gap this closes

The shipped `DeterminismMode "tolerance"` (FFSM Phase 0) pins *environment hashes* (`pinnedEnvHash`
+ `backendArtifactHash` + a positive `tolerance`, fail-closed all-3-pins) — but the word **"tolerance"
had no enforced numeric witness**. A bridge could *claim* an arbitrarily tight band with nothing measured
behind it, and "how close to ideal was this run" was unrecorded. This lane adds the **measured half**.

## Increment 1 — measured manifest fields (LANDED 2026-06-15)

`@logicn/inference-bridge-contract/src/manifest.ts` — all **optional**, **opt-in**, **hash-preserving**
(a manifest that sets none serializes byte-identically; existing inference/ffsim hashes unaffected — proven
by `contract.test.mjs`). 9/9 contract tests green.

| Field | Idea | Meaning | Fail-closed check |
|---|---|---|---|
| `comparabilityHash?` | #2 | sha256 of the matched comparability set (prompt/template/gen-settings/sample-count/judge) | must be sha256 hex if present |
| `measuredFidelity?` | #12 | 0..1 closeness-to-reference oracle the **bridge supplies** | must be in [0,1] |
| `minFidelity?` | #12 | 0..1 declared **floor** | requires `measuredFidelity` present **and** ≥ floor, else DENY ("floor unproven") |
| `toleranceWitness {redundancyN, epsilonMeasured, stdDev, noiseModelId}` | #3 | binds declared `tolerance` to a measured (N, ε, std) curve + the noise model it was measured under | N≥1, ε>0, std≥0, noiseModelId required; **declared `tolerance` must be ≥ `epsilonMeasured`** |

**Core invariant (idea #3):** *a tolerance backend may NOT claim a tighter band than it measured.*
`tolerance < epsilonMeasured` → DENY. This is what turns `redundancy:N`/`tolerance:ε` from author-asserted
constants into verifiable claims.

Candidate diagnostics (when wired into the compiler/Tower admission path): **LLN-PRECISION-ATTEST** (declared
≠ observed precision), **LLN-PRECISION-FIDELITY** (below floor), **LLN-PRECISION-WITNESS** (claim tighter
than measured).

## Next increments (not yet built)

1. **#5 — widen `PrecisionTechnique`** to a grounded production taxonomy (`ternary | int4-QAT | gptq | awq |
   marlin | nf4 | gguf | fp8 | fp16 | fp4_block`) + a `storagePrecision` vs `computePrecision` split
   (the fake-quantized case). ⚠️ Cross-package ripple — verify no exhaustive `switch` in tower-citizen/bridges
   first (the current enum is consumed as a map key, which is safe, but check the router).
2. **#1 — precision-attestation gate (compiler/Tower side):** read the bridge's exported quant config vs
   tensor headers, enforce `declared == observed` per module, record the coverage table as a signed manifest
   record. Closes the Brawn fail-open (a bridge shipping a layer at the wrong precision / a swapped tokenizer
   passes the naive `packageHash` pin today).
3. **#3/#4 — substrate integration:** tie `toleranceWitness` into `verifySubstrate` (LLN-SUBSTRATE-002/003)
   and add the typed noisy→deterministic **reducer** rule (only an `expectation` or `voted@N` aggregate may
   cross into a deterministic sink — LLN-SUBSTRATE-004 structural shape). Add a `NoiseModel` descriptor so a
   tolerance proven under model A can't be reused under model B (#8).
4. **#2 — comparability enforcement:** promote `comparabilityHash` from "validated if present" to a required
   pin for tolerance mode **with migration** (the ffsim manifest + its tests must add it) — deferred so the
   first increment stays non-breaking.

## Guardrails (from the idea-mining synthesis)

- Do **not** port ModelOpt scale math / SPDNN noise simulators into core — DECLARE + VERIFY + RECORD only.
- `PrecisionTechnique`/`NoiseModel` stay a **closed governance vocabulary**, not a config dump.
- Reuse Ed25519 + SHA-256; no TMX/tree-hash smuggled in via "streaming substrate" framing.

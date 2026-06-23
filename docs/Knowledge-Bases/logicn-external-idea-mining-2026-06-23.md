# External Idea Mining — `C:\wwwprojects\x` (fresh pass, 2026-06-23)

Re-mine of the 12 open-source repos in `C:\wwwprojects\x` for LogicN **governance-layer** ideas (workflow
`w52hn3lza`, 6 cluster agents, source-level reads not just READMEs). Verify-before-build vs the
[2026-06-15 pass](logicn-external-idea-mining-2026-06-15.md). **38 ideas: 18 net-new · 12 already-mined-0615 ·
6 refuted/out-of-bounds · 2 already-shipped.** The higher net-new rate (vs 0615) is because this pass read SOURCE
(BitNet's Jan-2026 CPU guide, SPDNN/PNN detector laws, turbovec — never mined before) not just READMEs. Invariants
honored throughout: crypto Binary, photonic = degrade-only/projected, fail-closed; no repo math/kernels ported.

> **Posture: these are candidates, NOT a build queue.** Per owner caution, the HIGH picks are surfaced for a
> decision; nothing is auto-built. Heavy items would dispatch to the R&D bridge.

## The 5 HIGH-value net-new ideas
1. **Transform-mode ordering DAG gate** *(nvidia / ModelOpt `mode.py:78-89`)* — a governed transform declares
   `next_modes` / `next_prohibited_modes` / a terminal `export_mode`; the compiler verifies legal **composition
   order** statically (e.g. quantize forbids sparsity-after; `real_quantize` is terminal). **LogicN has Static
   Manifest Clamping but NO order/time-axis gate** (grep + KB empty). → proposed `LLN-TRANSFORM-ORDER`,
   deny-by-default, terminal-seal. *Invariant: n/a (pure compile-time check).*
2. **Filtered-search-as-deny-by-default** *(linear-vec / turbovec `search.rs`)* — push the ACL/tenant allowlist
   **INTO** the tri-pipe vector kernel (block-granularity short-circuit: a 32-vector block with zero allowed slots
   never reaches scoring), instead of over-fetch-then-discard. **This is the missing RUNTIME half of the
   `for/where`-mask verdict + `LLN-PRIVACY-002`** — today they filter the OUTPUT, which is fail-OPEN if the discard
   is ever skipped. *Security-relevant; fits security-first.*
3. **Signal-dependent erasure** *(photonic-nn / SPDNN `PhotonActivation.py:12`)* — the detector law `P(click) =
   1−exp(−|x|)` makes erasure probability scale with operand **magnitude**: a small-magnitude operand erases to
   no-click (= K3 INDETERMINATE `0`) far more often than a large one. The shipped `substrate-model.ts` uses a
   **constant** `laneFailureProb` — this is a more faithful (and stricter) degrade model. *Invariant: degrade-only —
   strengthens it.*
4. **Incoherent-encoding lanes are a two-valued `{0,+1}` sub-lattice** *(photonic-nn / SPDNN coherent-vs-incoherent)*
   — an intensity/incoherent lane is **non-negative**, so it structurally **cannot carry DENY (`−1`)**. → a TYPED
   lane constraint: only sign-carrying (coherent) lanes may carry a full K3 verdict; incoherent lanes are
   ALLOW/INDETERMINATE only. A real typing insight for the substrate/Tri-Pipe lane model. *Invariant: degrade-only
   (a conflict worth encoding).*
5. **PDK-grounded substrate tolerance vocabulary** *(photonics-ref / awesome_photonics PDKs)* — replace the opaque
   `substrate { tolerance: epsilon }` with **named foundry quantities** (`insertion_loss_dB`, `extinction_ratio_dB`,
   `free_spectral_range`, `crosstalk_dB`) — every real photonic substrate is a PDK of named measured tolerances.
   Makes the substrate contract concrete + checkable. *Invariant: degrade-only; projected/aspirational labels.*

## Net-new MEDIUM / LOW (13)
| Idea | Cluster | Value | Invariant |
|---|---|:--:|---|
| Per-tensor **precision-FLOOR** invariant (forbid quantizing a sensitive tensor below a floor) | bitnet | MED | digital |
| Heterogeneous-precision manifest (per-tensor-class precision map, one signed object) | bitnet | MED | Binary |
| **Backend-route attestation** for skill-style routers (chosen {backend,format,hw} ⊆ signed allow-list, unknown→DENY) | bitnet | MED | Binary, fail-closed |
| **Seed-pinning**: RHT `random_sign_mask` / amax-history seed = determinism-class secret, SHA-256-pinned in manifest | nvidia | MED | Binary |
| **Data-oblivious** annotation: transform from math-of-(dim,seed) only, provably zero data-input edge | linear-vec | MED | n/a |
| Mesh-depth as a first-class reliability axis (Reck/Clements insertion-loss compounding over depth) | photonic-nn | MED | degrade-only |
| **Process-corner** axis (typ/min/max fab variation, distinct from runtime noise) on `substrate{}` | photonics-ref | MED | Binary |
| **S-parameter composition**: govern photonic-block composition as a tolerance-accumulation contract | photonics-ref | MED | degrade-only |
| **Two-axis tolerance** (`rtol` + `atol`), not a single scalar band (ffsim `approx_eq`) | ffsim | MED | degrade-only |
| **Factored subspace gate** (`dim_a`, `dim_b` separately, not just the product) | ffsim | MED | n/a |
| Govern the **depolarizing-noise knob** as a declared/attested injected-error param (not undeclared) | ffsim | MED | degrade-only |
| **Reasoning-budget exhaustion** = a typed INDETERMINATE verdict (max-tokens-overrun), not silent truncation | bitnet | LOW | Binary, fail-closed |
| **Bounded-result** contract: `effective_k = min(k, |eligible|)`, never pad-to-k (composes with DbC `ensure result`) | linear-vec | LOW | n/a, fail-closed |

## Re-derived / out-of-bounds (verify-before-build worked)
~80% as expected: the precision-routing / NVFP4-as-PrecisionTechnique / calibration-as-attestation / ternary-taxonomy
/ recipe{} / fidelity-oracle / carry-state-provenance bulk is already-mined-0615 or shipped (`precision_policy{}`,
`logicn-precision-attestation.md`, `substrate-failure-model.ts` LLN-SUBSTRATE-001..004). Refuted/out-of-bounds: the
SIMD/CUDA kernels themselves (host/ext perf code, not governance), speculative-decoding (re-frames the shipped
typed-reducer/vAnd #4), PEFT/LoRA-as-mutation (subsumed by the unbuilt #1 attestation table).

## Recommended top picks (for owner decision)
- **#2 filtered-search-as-deny-by-default** — it closes a genuine fail-OPEN (output-filter → kernel-fused deny),
  fits security-first. *Strongest pick.*
- **#1 transform-order gate** — a real new compile-time gate (order axis), generalizes Static Manifest Clamping.
- Photonic #3/#4/#5 — strengthen the substrate model (degrade-only, projected); good if the photonic lane is being
  advanced.

> Source: workflow `w52hn3lza` (2026-06-23). Full output: task `w52hn3lza.output`.

# R&D — notes/62 "expand maths to other areas" (2026-06-25, `wf w9hj3oaf4`)

Owner asked (notes/62-x.md) to take the LogicN maths further: continuous/fuzzy ternary, tensorized No-Coercion,
ternary Byzantine consensus, a tri-pipe compute router, and two new application domains (gaming, web/API backend).
Six independent R&D agents + adversarial refute. **Headline: all six are *mostly-shipped / sound-with-caveat* —
the maths cores already ship; the deltas are small, buildable, fail-safe additions. 0 flagship papers
(defensive-pub).**

## Ledger

| # | Theme | Proposal | Using / not | ZT | Paper |
|---|---|---|---|---|---|
| 1 | **Continuous Ternary Algebra** (fuzzy gov for AI) | `ConfidenceVerdict` probability-vector `p=[p_deny,p_unknown,p_allow]`, Σp=1, **fail-safe collapse** to the discrete Verdict | Core **USING** (ships as `admission-feedback` `anomalyScore∈[0,1]`) · Δ vector-shape **not yet** | 88 | none |
| 2 | **Tensorized No-Coercion** (Hadamard-min over matrices) | `V_final = V_core ⊙min T_sub`; thin deny-by-default `vAndTensor()` over the proven scalar `vAnd=min` | Core **USING** (scalar `vAnd` proven) · Δ tensor-arity wrapper **not yet** | **90** | none |
| 3 | **Ternary Byzantine Consensus** (abstain-aware quorum) | Variadic `consensusTritN(votes[])=sign(Σ)`, tie→0, generalizing the shipped 3-input `consensusTrit` | Core **USING** (`consensusTrit`/`majorityVote`) · Δ N-party reducer **not yet** | 88 | none |
| 4 | **Tri-Pipe Compute Router** (+1 fast / 0 AI-worker / −1 snap-shut) | Third **`0→review` lane**: INDETERMINATE dispatches to a *gated-proposal* worker (never auto-approve) | Core partial · Δ review-lane **not yet** | **9 ⚠️** | none |
| 5 | **Gaming domain** (chaos-physics / 1-bit NPC swarms / generative fail-closed) | A runnable game profile/example composing existing tier+substrate+No-Coercion (none exists today) | Δ worked-example **not yet** | 88 | none |
| 6 | **Web/API backend** (JWT/OAuth scopes, K3 step-up) | Three-way boundary `{−1→drop/WAF, 0→STEP-UP (MFA), +1→allow}` vs today's binary INDETERMINATE→deny | Core ~80% **USING** (`decideAtBoundary`) · Δ step-up branch **not yet** | 88 | none |

## Refuted / corrected from the raw notes
- **O(1) tensor-min** → it is **O(N²)** (element-wise min over the verdict tensor). No asymptotic win; the value is
  arity/ergonomics, not speed.
- **JWT `min(0,1)=0` framing** → misleading: `min` collapses to **DENY**, not "Read-Only". The shipped sign-of-sum
  semantics are the correct model.
- **Byzantine threshold `floor((N−A)/2)+1`** → *different and more permissive* than the shipped `sign(Σ)` consensus;
  do not adopt the looser threshold.

## ⚠️ The ZT-9 finding (theme 4)
Routing a governance decision to an **AI worker lowers zero-trust by design** — it inserts an AI into the decision
path. Only admissible as a **gated proposal** that still requires the normal signed approval workflow; it must
**never** become an auto-approve lane. Scored ZT 9/100 precisely to record that constraint. The other five preserve
deny-by-default and fail-closed and score 88–90.

## Net-new (small, sound, buildable — all sit on shipped primitives)
1. **`ConfidenceVerdict`** probability-vector verdict shape with fail-safe collapse (triage signal, not a new gate).
2. **`vAndTensor`** element-wise redact/min tensor wrapper around scalar `vAnd` (deny-by-default, O(N²)).
3. **`consensusTritN`** abstain-aware N-party quorum reducer (generalizes `consensusTrit`; unreachable = abstain).

All owner-gated to build. None changes what LogicN *is*; each is a thin, fail-safe extension of an existing,
verified primitive. Consistent with the 0-flagship-papers / defensive-pub strategy.

*Source: workflow `w9hj3oaf4` (2026-06-25); feeds the `.tmf`/database/TritMesh follow-on (`wf_8febafb6-973`).*

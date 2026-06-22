# 0070 — Photonic/path-deviation TamperTrust resolver

> **Citation base.** `file:line` references resolve against the LogicN production repo
> (`C:\wwwprojects\LogicN`, STRICTLY READ-ONLY). Sources: worker done report
> `LogicN-R-AND-D/_session-bridge/done/0070-photonic-path-deviation-tampertrust-resolver.done.md`;
> grounding/disposition `docs/Knowledge-Bases/logicn-tlstp-transport-auth-rnd-2026-06-22.md` (D3 + net-new #2)
> and `docs/Knowledge-Bases/logicn-transport-auth-research-explained-2026-06-22.md` (WILL-USE "TamperTrust resolver").

---

## 1. What it is + why adopted

The TamperTrust resolver is the **lawful form** of the owner's "use photonic/optical physical state as an auth factor" proposal (notes/42-auth Doc001 §4 / Doc003 §3B): instead of letting a measured physical deviation `δ` *authenticate*, it turns `δ` into a **degrade-only K3 governance verdict** that can only push an upstream decision toward DENY, never manufacture an ALLOW (done report §0–§3; grounding D3, net-new #2). It was adopted because it reuses the shipped governance kernel *verbatim* — `vAnd`/`effectiveVerdict` (Kleene meet, `three-valued-governance.ts:48-51`, `substrate-model.ts:204-206`), the noisy-lane tolerance gate `verifyToleranceUnderNoise` with `LLN-SUBSTRATE-001..004` (`substrate-model.ts:300-335`), the erasure-to-0 read rule (`substrate-model.ts:167-185`), and the audited boundary collapse `decideAtBoundary` (`three-valued-governance.ts:141-153`) — adding **zero new crypto and zero new gate semantics**. Identity stays Binary (Ed25519 + ML-DSA-65); the TamperTrust verdict is bound as a **`cnf`-row caveat under** that digital signature (RFC 8747 confirmation key), defense-in-depth, **never sole**. Honest tiering: the **governance resolver is buildable today** against the deterministic photonic emulator; the **optical sensing front-end is aspirational-HW** (`emulator.ts:27,43` reports `deterministic=false`, `ENOB_CEILING=8`) and no "unspoofable" claim is made (optical PUFs are PAC-learnable).

---

## 2. The maths, in detail

### 2.0 Symbols

| Symbol | Domain | Meaning |
|---|---|---|
| `P_base` | ℝⁿ | calibrated baseline physical fingerprint, attested at enrolment |
| `P_actual` | ℝⁿ | live physical observable: `[φ, θ, t]` (phase, polarisation, timing) **or** path-fingerprint `[D, Δτ, t_arrival]` |
| `δ` | ℝ≥0 | deviation magnitude `δ = ‖P_actual − P_base‖` (a norm; scalar) |
| `τ` | ℝ>0 | tolerance band — the largest deviation considered "untampered" |
| `dead` | bool | the lane was dark / unreadable / erased this read |
| `r` | trit `{−1,0,+1}` | quantised TamperTrust **reading** |
| `t*` | Verdict `{−1,0,+1}` | the verdict the **digital** signature path already reached |
| `e` | Verdict `{−1,0,+1}` | the **effective** (folded) verdict `e = vAnd(t*, r)` |
| `pBad` | [0,1] | modelled single-lane error probability |
| `N` | odd ≥1 | declared N-modular redundancy (replica count) |
| `ε_model` | [0,1] | modelled residual failure of the N-vote |
| `ε_decl` | [0,1] | the flow's declared tolerance ceiling |

K3 verdict encoding (`three-valued-governance.ts:40-44`): `DENY = −1`, `INDETERMINATE = 0`, `ALLOW = +1`, with the **total order** `−1 < 0 < +1`.

### 2.1 Step 1 — Quantise deviation → trit `r`

The quantiser mirrors the shipped `NoisyLane.read` rule: a dead/unreadable lane abstains to `0` and **never fabricates ±1** (`substrate-model.ts:167-172, 180`).

```
            ⎧  0    if dead = true                 (erased / unreadable → INDETERMINATE)
  r(δ) =    ⎨ +1    if  δ ≤ τ   and not dead        (within band → no tamper evidence)
            ⎩ −1    if  δ >  τ   and not dead        (past band → tamper evidence)
```

Key asymmetry: the **only** way to obtain `r = +1` is a clean read strictly inside the band. Anything missing, ambiguous, or out-of-band falls to `0` or `−1` — never to a silent `+1`. This is the same fail-closed shape as the erasure rule (`substrate-model.ts:170-172`): `if rng() < laneFailureProb → {value: 0, indeterminate: true}`.

### 2.2 Step 2 — Tolerance gate `verifyToleranceUnderNoise` (NMR)

Before a noisy `r` is allowed to *confirm* anything, the read must **provably converge** under N-modular voting, else it denies. The gate runs with `ctx = { hasCryptoEffect:false, laneIsNoisy:true, sinkRequiresDeterminism:true }` and applies a fixed priority (`substrate-model.ts:298, 309-333`):

```
  001  hasCryptoEffect ∧ laneIsNoisy                       → DENY  LLN-SUBSTRATE-001  (never: crypto stays Binary)
  004  laneIsNoisy ∧ sinkRequiresDeterminism ∧ N = 1       → DENY  LLN-SUBSTRATE-004  (un-voted read into a det. sink)
  003  ¬met ∧ (pBad ≥ 0.5)                                 → DENY  LLN-SUBSTRATE-003  (voting cannot converge)
  003  ¬met ∧ N > 1                                        → DENY  LLN-SUBSTRATE-003  (declared N still short)
  002  ¬met ∧ N = 1                                        → DENY  LLN-SUBSTRATE-002  (tolerance unmet at N=1)
  ----                                                     → ALLOW (tolerance proven)
```

The underlying closed forms (single source of truth `logicn-substrate-math/src/index.ts`, wrapped at `substrate-model.ts:95-98, 215-219`):

**Per-lane flip probability** (`index.ts:60-62`, gains `PHASE_GAIN=1.0`, `XTALK_GAIN=0.5`, `READOUT_GAIN=0.5` at `index.ts:39-41`):

```
  pFlip = clamp01( phaseDriftSigma·1.0 + crosstalkCoeff·0.5 + readoutSigma·0.5 )
```

**Single-lane error** (lane fails OR survives-then-flips) (`index.ts:68-75`):

```
  pBad = clamp01( laneFailureProb + (1 − laneFailureProb)·pFlip )
```

**Exact von Neumann NMR residual** — probability that ≥ ⌈N/2⌉ of N independent lanes are bad (`index.ts:90-99`):

```
  need = (N + 1) / 2                          (= ⌈N/2⌉ for odd N)
  ε_model(pBad, N) = Σ_{k=need}^{N}  C(N,k) · pBad^k · (1 − pBad)^{N−k}
```

`met = (mustCommit ? ε_model ≤ ε_decl : true)` (`substrate-model.ts:249`). For `pBad < 0.5`, `ε_model` is **strictly decreasing** in odd N (voting converges); for `pBad ≥ 0.5` voting cannot help (`redundancyHelps = pBad < 0.5`, `substrate-model.ts:251, 321`).

### 2.3 Step 3 — Fold with `vAnd` (Kleene meet)

`vAnd` delegates to `minTrit` (`three-valued-governance.ts:48-51`), and `minTrit(a,b) = a < b ? a : b` (`tpl-simulator.ts:149-152`) — the **greatest-lower-bound (meet)** of the total order `−1 < 0 < +1`. The fold is `effectiveVerdict(t*, r) = vAnd(t*, r)` (`substrate-model.ts:204-206`):

```
  e = vAnd(t*, r) = min(t*, r)
```

Full truth table of the fold (rows = `t*`, columns = `r`):

| `vAnd` (= min) | `r = −1` | `r = 0` | `r = +1` |
|---|---|---|---|
| **`t* = −1`** | −1 | −1 | −1 |
| **`t* = 0`**  | −1 | 0  | 0  |
| **`t* = +1`** | −1 | 0  | **+1** |

The single `+1` cell (bottom-right) requires `t* = +1` **and** `r = +1`.

### 2.4 Step 4 — Collapse at the boundary

`decideAtBoundary(e)` (`three-valued-governance.ts:141-153`):

```
  e = +1  → allow,  no diagnostic
  e = −1  → deny,   no diagnostic (ordinary policy denial)
  e =  0  → deny,   emit LLN-GOV-3VL-001 (INDETERMINATE_COLLAPSED_TO_DENY)
```

### 2.5 The No-Coercion theorem (degrade-only, structural)

**Claim.** For all `t*, r ∈ {−1,0,+1}`: `e = vAnd(t*, r) ≤ t*`, and `e = +1 ⟺ (t* = +1 ∧ r = +1)`.

**Proof.** `e = min(t*, r)`. A meet (min) of a total order satisfies `min(a,b) ≤ a` for every `b`; hence `e ≤ t*`. For the equality: `min(t*, r) = +1` in `{−1,0,+1}` forces both arguments to be the maximum, i.e. `t* = +1 ∧ r = +1`. ∎

**Corollaries (the safety properties).**
1. `t* = 0 ⇒ e = min(0, r) ≤ 0` ⇒ `e ≠ +1`. *(0 → +1 is impossible: a side-signal cannot upgrade INDETERMINATE.)*
2. `t* = −1 ⇒ e = min(−1, r) = −1` for all `r`. *(DENY is absorbing: −1 → ALLOW is impossible.)*
3. The reading's only powers are **confirm** (`r = +1` leaves `e = t*`) or **degrade** (`r ∈ {0,−1}` pushes `e` down). It has **no** power to manufacture an ALLOW.

This is the substrate-model central result, inherited unchanged (`substrate-model.ts:14-19`: "noise can only DEGRADE a verdict toward deny, never UPGRADE a 0/−1 into +1 … the substrate can cost AVAILABILITY, never SAFETY"). Safety is **structural** — it holds for *every possible* reading, including an adversarially-spoofed one (§3 below), not a runtime check that could be misconfigured open.

### 2.6 Adversary argument (PAC-learnable θ does NOT break safety)

Grant the strongest realistic attacker: optical PUFs are poly-time **PAC-learnable** (grounding D3; done §0.2), so the attacker *can* forge a within-band deviation. The best a forged `δ` achieves is `δ ≤ τ ⇒ r = +1`. Substituting into the theorem: `e = vAnd(t*, +1) = min(t*, +1) = t*`. So a perfect spoof yields **e = t\*** — exactly "no degradation." The attacker cannot lift a `t*` that was not already `+1`. The physical layer therefore carries **zero** authority on its own; its safety contribution is independent of θ being unforgeable. (Empirical corroboration on the same kernel: 0053/E6 confident-DENY-never-flips-OPEN, MC 0/400k, P ≈ 3e-138; done §3.)

---

## 3. Worked examples

All arithmetic uses the shipped closed forms (§2.2) and was re-derived numerically. Take a band `τ = 5.0` (deviation units), `mustCommit = true`, declared tolerance `ε_decl = 0.02`. Sensing profile (per-read noise model fed to `verifyToleranceUnderNoise`): `phaseDriftSigma = 0.02`, `crosstalkCoeff = 0.02`, `readoutSigma = 0.06`, `laneFailureProb = 0.01` ⇒

```
  pFlip = 0.02·1.0 + 0.02·0.5 + 0.06·0.5 = 0.02 + 0.01 + 0.03 = 0.060
  pBad  = 0.01 + (1 − 0.01)·0.060 = 0.01 + 0.0594 = 0.0694
  ε_model(N=1) = 0.069400   ε_model(N=3) = 0.013781   ε_model(N=5) = 0.0030043
```

### Example A — within band → CONFIRM (allow)

Upstream digital verdict `t* = +1` (Ed25519 + ML-DSA-65 signature verified, capability gate passed).
Live read `P_actual` vs `P_base`: `δ = 1.8`. Lane readable (`dead = false`), declared `N = 3`.

1. **Quantise.** `δ = 1.8 ≤ τ = 5.0` and not dead ⇒ `r = +1`.
2. **Tolerance gate.** `hasCryptoEffect = false` (skip 001). `N = 3 ≠ 1` (skip 004). `ε_model(N=3) = 0.013781 ≤ ε_decl = 0.02` ⇒ `met = true` ⇒ gate returns **ALLOW**.
3. **Fold.** `e = vAnd(+1, +1) = min(+1, +1) = +1`.
4. **Boundary.** `decideAtBoundary(+1)` ⇒ **allow**, no diagnostic.

**Outcome: ALLOW.** The physical layer confirmed; `e = t*` (no degradation).

### Example B — out of band → DENY (tamper)

Upstream `t* = +1` (digital identity is fine). Live read `δ = 9.3` (e.g. the optical path was re-spliced / a MITM relay inserted extra fiber). Lane readable, `N = 3`.

1. **Quantise.** `δ = 9.3 > τ = 5.0`, not dead ⇒ `r = −1` (tamper evidence).
2. **Tolerance gate.** Same params ⇒ `met = true` ⇒ ALLOW (the gate only governs whether a *noisy read may be trusted to confirm*; it does not soften a deny).
3. **Fold.** `e = vAnd(+1, −1) = min(+1, −1) = −1`.
4. **Boundary.** `decideAtBoundary(−1)` ⇒ **deny**, no diagnostic (ordinary policy denial).

**Outcome: DENY.** Note the **digital signature still verified** — TamperTrust degraded an otherwise-allowed channel because the physical path deviated past the band. This is the defense-in-depth win: it costs availability (a possibly-legitimate `+1` denied), never safety.

### Example C — dead/unreadable lane → DENY (fail-closed)

Two sub-cases, both denying.

**C1 — erased lane.** Upstream `t* = +1`. The optical front-end returns no usable sample this read (`dead = true`), declared `N = 3`, sensing params as above.
1. **Quantise.** `dead = true` ⇒ `r = 0` (mirrors `NoisyLane.read` erasure-to-0, `substrate-model.ts:170-172`).
2. **Tolerance gate.** `met = true` (params fine).
3. **Fold.** `e = vAnd(+1, 0) = min(+1, 0) = 0`.
4. **Boundary.** `decideAtBoundary(0)` ⇒ **deny** + **`LLN-GOV-3VL-001`** (`INDETERMINATE_COLLAPSED_TO_DENY`).

**Outcome: DENY (audited).** Unknown → DENY, with a diagnostic that is structurally impossible to drop.

**C2 — un-voted noisy read into a deterministic sink.** Same as A (`δ = 1.8`, `r` would be `+1`) **but declared `N = 1`** and `ctx.sinkRequiresDeterminism = true`.
1. **Quantise.** `r = +1` provisionally.
2. **Tolerance gate.** Branch 004 fires first: `laneIsNoisy ∧ sinkRequiresDeterminism ∧ N === 1` ⇒ **DENY `LLN-SUBSTRATE-004`** (`substrate-model.ts:315-317`). The gate's verdict is `DENY`, short-circuiting the fold.
3. **Result.** Resolver returns DENY before any confirm is possible.

**Outcome: DENY.** An un-voted analog reading is never allowed to confirm a determinism-requiring decision.

**C3 (variant) — noisy lane, voting cannot converge.** If the sensing profile were the degraded one (`phaseDriftSigma = 0.6`, `crosstalkCoeff = 0.6`, `readoutSigma = 6.0`, `laneFailureProb = 0.2`): `pFlip` clamps to `1.0`, `pBad = 1.0 ≥ 0.5`, so `redundancyHelps = false`; even `N = 7` gives `ε_model = 1.0 > ε_decl`. Branch 003 fires ⇒ **DENY `LLN-SUBSTRATE-003`** ("majority voting does not converge"). A lane this noisy can never produce a trustworthy confirm.

---

## 4. The hard build path

**Where it lives.** A new resolver module in `logicn-tower-citizen/src` (the package that already owns `three-valued-governance.ts` and `substrate-model.ts`), e.g. `tamper-trust.ts`. It is a **Verdict-typed composition over shipped functions** — no new gate, no new crypto. The `cnf`-row binding hooks the Governed Trust Capsule reader (`governed-trust-capsule-v0.md §9`, capsule slice 5 / #12); the test driver uses `logicn-ext-photonic-emulator`.

### Ordered steps

1. **Define inputs/types.** Inputs: `P_base`, `P_actual` (an `n`-vector; the resolver only needs the scalar `δ = ‖P_actual − P_base‖` — keep the norm choice pluggable), `τ`, a `dead` flag, the `SubstrateParameters` sensing profile (`substrate-model.ts:50-61`), and a `SubstrateGuarantee` (`resultId`, `epsilonDeclared`, `redundancyN`, `mustCommit`; `substrate-model.ts:221-226`). Output: a `Verdict` (and the `SubstrateDecision` / `BoundaryDecision` records for audit).

2. **Quantiser `deviationToTrit(δ, τ, dead): Verdict`.** Implement §2.1 exactly. **HARD PART:** the dead-lane branch MUST be tested *first* and MUST return `0`, never ±1 — this is the erasure-to-0 invariant (`substrate-model.ts:167-172, 180`). Do not "default to +1 when uncertain."

3. **Tolerance gate.** Call `verifyToleranceUnderNoise(params, guarantee, ctx, profile)` (`substrate-model.ts:300-335`) with `ctx = { hasCryptoEffect:false, laneIsNoisy:true, sinkRequiresDeterminism:true }`. If `decision.verdict === DENY`, return it immediately (do not fold). **HARD PART:** set `hasCryptoEffect:false` deliberately and document why — if anyone ever wires a crypto effect onto this lane, 001 (`LLN-SUBSTRATE-001`, `substrate-model.ts:310-312`) must fire; the resolver is *not* the place to relax that. Also: pass the **same** `params` to the gate that the quantiser's noise assumptions came from (a mismatch silently lies about convergence).

4. **Fold.** `e = effectiveVerdict(t*, r)` (`substrate-model.ts:204-206`) where `t*` is the verdict the digital path already produced. **HARD PART:** the fold MUST run *after* the digital signature path produces `t*` — never before, never in parallel with key/sig verification. The resolver consumes a finished `t*`; it does not participate in signature checking.

5. **Boundary collapse.** `decideAtBoundary(e, onDiagnostic)` (`three-valued-governance.ts:141-153`), forwarding `LLN-GOV-3VL-001` to the `AuditLogger` egress when `e = 0`.

6. **`cnf`-row binding (capsule integration).** Emit the resolved TamperTrust verdict as an **attenuation-only `cnf` caveat under** the capsule's Ed25519 + ML-DSA-65 signature (RFC 8747; the same `cnf` seam 0068 uses for RFC-5705 channel-binding). **HARD PART:** it must be a *caveat that can only narrow or deny*, bound **inside** the signed structure — if it rides outside the signature it is forgeable, and if it can *broaden* authority it violates the Monotonic-Security rule. Reconcile the capsule's §2-vs-§8 pre-hash contradiction (grounding D13) before wiring the reader.

7. **Tests (emulator-driven).** Drive `P_actual` from `logicn-ext-photonic-emulator` (seeded `value` only). Cover: (a) within-band confirm (Example A); (b) out-of-band deny (Example B); (c) dead-lane → `0` → deny + `LLN-GOV-3VL-001` (C1); (d) `N=1` deterministic-sink → `LLN-SUBSTRATE-004` (C2); (e) degraded profile → `LLN-SUBSTRATE-003` (C3); (f) a **No-Coercion exhaustive table test**: for all 9 `(t*, r)` pairs assert `vAnd(t*, r) ≤ t*` and `e = +1 ⟺ t*=+1 ∧ r=+1`; (g) a spoof test: forced `r = +1` against `t* ∈ {0,−1}` still denies. **HARD PART / the easiest thing to get wrong:** the emulator's `BridgeResult.latencyMs` is **wall-clock** (`photonic-bridge.ts:118, 128`) and `deterministic=false` (`photonic-bridge.ts:11`, `emulator.ts:27`). It MUST NEVER enter the trit path — only the seeded `value` may drive the quantiser. Folding `latencyMs` (or any non-seeded field) would inject non-determinism into a verdict and break the reproducible-build property.

### Gotchas summary (called out explicitly)

- **Erasure-to-0 is fail-closed, not "best guess +1."** Dead/ambiguous reads go to `0` (→ deny + audit), never `+1`. Test the dead branch first.
- **`latencyMs` / any non-seeded emulator field is poison to the verdict.** Only the seeded `value` is admissible (`photonic-bridge.ts:118, 128`).
- **The fold direction is fixed by the meet.** `e = vAnd(t*, r) ≤ t*` is the whole safety story; do not "average," "weight," or add a float trust score — that reintroduces the indeterminate-as-allow risk K3 exists to forbid (grounding D2). A float gate is explicitly refused.
- **Crypto stays Binary.** `δ`/φ/θ/timing/`[D,Δτ,t]` feed ONLY `r`, which feeds ONLY `vAnd`. They never enter a KDF, cipher, or signature input. `hasCryptoEffect` on this lane must stay `false` so 001 protects the boundary.
- **Honest tiering.** The resolver + gate + `cnf` binding are **buildable today** against the emulator. The optical sensing front-end (measuring real φ/θ/sub-ns timing / `[D,Δτ,t]`) is **aspirational-HW** — needs photonic silicon plus a calibration/attestation root (`ToleranceWitness`); the emulator is `deterministic=false`, `ENOB_CEILING=8` by construction (`emulator.ts:27,43`). **No "unspoofable" claim** (optical PUFs are PAC-learnable) and **no sub-ns figure** without a named device or a labelled-aspirational envelope.

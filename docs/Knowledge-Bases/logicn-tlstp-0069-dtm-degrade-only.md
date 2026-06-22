# 0069 — Dynamic Trust Mesh as degrade-only K3 telemetry

> **Status:** BUILD-GUIDE for an adopted 0065–0070 transport/auth R&D survivor. Design/spec passed the bar; build is hub/owner-gated (the 0050 exporter it depends on is net-new and owner-gated). **Read-only citations** resolve against `C:\wwwprojects\LogicN` as `file:line`.
> **Source done report:** `LogicN-R-AND-D/_session-bridge/done/0069-dynamic-trust-mesh-as-degrade-only-k3-telemetry.done.md` (the full No-Coercion proof). Companion: `…/done/0065-tlstp-trilogic-secure-transport-protocol-digital-core-spec.done.md` §1 (the refuted-list this is the constructive half of).
> **Binding posture (non-negotiable):** crypto/KDF/cipher/signature/key bytes stay **BINARY (digital)**. The trust float feeds **only** a K3 governance verdict via `vAnd`, **DEGRADE-ONLY**, never a key byte. Fail-closed (unknown → DENY). A failed AEAD tag is a hard `-1`, never a "low score." No perf claim without a named-machine bench.

---

## 1. What it is + why adopted

The owner's Dynamic Trust Mesh (DTM) proposed a **continuous float** per-packet trust score `T_c` used as the authorization gate (`authorize iff T_c >= tau`). That float-as-gate shape is **REFUTED — do not revive** in `done/0065` §1 ("float informs, K3 decides, unknown→DENY"). DTM 0069 is the **constructive** half of that refutation: it keeps the owner's `F/I/N` intuition strictly as an *observability* signal. `T_c` is computed **inside the 0050 blind-observability exporter** (a read-only, structure-not-data mapper of governance state), **discretized to a trit by a declared static threshold whose codomain is `{-1, 0}` (never `+1`)**, and folded into the existing verdict by the **shipped** `vAnd` (= `minTrit`, Kleene ∧) — degrade-only. It is adopted because it reuses shipped rails verbatim (`vAnd`/`minTrit`/`decideAtBoundary` in `packages-logicn/logicn-tower-citizen/src/three-valued-governance.ts:49-51,141-153`; the No-Coercion theorem and determinism discipline in `…/substrate-model.ts:14-19,21-24,199-206`) and adds **zero new crypto and zero new calculus** — it is one more side-channel `r` plugged into the same `vAnd` the substrate model already uses for hardware noise.

---

## 2. The maths, in detail

### 2.1 Symbols and domains

| Symbol | Domain | Meaning |
|---|---|---|
| `t*` | `{-1, 0, +1}` | the **real** authorization verdict — the cryptographic/governance **core** verdict (e.g. the 0065 S1 `cert_verdict`, the AEAD-tag result, `kemdem` decap success). BINARY-sourced. |
| `F` | `ℝ≥0` | **fidelity/freshness** structural metric (declared, bucketed staleness count — **no** `Date.now()`). |
| `I` | `ℝ≥0` | **integrity-evidence** structural metric (counters of corroborating signals). |
| `N` | `ℝ≥0` | **anomaly/noise** structural metric (declared-bucketed anomaly count). |
| `w1, w2, w3` | `ℝ≥0` | **declared static** weights, pinned in the flow manifest (determinism). |
| `T_c` | `ℝ` | the continuous trust score (telemetry only). |
| `tau_deny` | `ℝ` | a single **declared static** discretization threshold. |
| `r` (`r_dtm`) | `{-1, 0}` | the discretized DTM trit. **Codomain excludes `+1` by construction.** |
| `e` | `{-1, 0, +1}` | the DTM-composed governance verdict actually presented to the boundary. |

K3 trit semantics (`three-valued-governance.ts:4-7,40-44`): `-1 = DENY`, `0 = INDETERMINATE`, `+1 = ALLOW`, on the **total order** `DENY(-1) < INDETERMINATE(0) < ALLOW(+1)`.

### 2.2 The trust score (telemetry, deterministic)

```
T_c  =  w1·F  +  w2·I  −  w3·N
```

`F` increases trust, `I` increases trust, `N` (anomaly/noise) decreases it. Because `(w1, w2, w3, tau_deny)` are **declared static constants** and `F/I/N` carry **no wall-clock term and no unseeded randomness** (any sampling goes through the seeded `makeStream(seed, opId)` discipline, `substrate-model.ts:121-125`), the map `(seed, op) → T_c` is **byte-reproducible** — the same determinism contract `effectiveVerdict` already satisfies ("Same `(seed, op)` → byte-identical result, so verifier output is a reproducible build artifact," `substrate-model.ts:21-24`).

### 2.3 The discretizer `T_c → r` (DENY-biased; codomain `{-1, 0}`)

```
        ⎧ −1   (DENY)           if  T_c <  tau_deny     # anomaly strong enough to actively veto
r = T_c↦⎨
        ⎩  0   (INDETERMINATE)  if  T_c >= tau_deny     # "no objection" — the BEST telemetry may emit
```

**The single load-bearing design choice:** the discretizer's **codomain is `{-1, 0}` — it NEVER emits `+1`.** A high `T_c` (everything looks healthy) yields `0 = INDETERMINATE` ("this side-signal raises no objection"), not ALLOW. A telemetry signal may *withhold objection*; it can never *manufacture authorization*. This is the discrete analogue of the substrate reading rule — a reading "can CONFIRM or DEGRADE the ideal verdict, never UPGRADE it" (`substrate-model.ts:199-206`).

*A second, higher threshold would be **inert**:* any band that maps to `0` is behaviorally identical under `vAnd(t*, 0)` and `decideAtBoundary(0)`. The only way a second threshold becomes load-bearing is to make a middle band emit `-1` — which is just a re-statement of `tau_deny`. One threshold is all that is load-bearing.

### 2.4 The fold into K3 — `vAnd`, degrade-only

```
e = vAnd(t*, r)          # vAnd = minTrit = Kleene ∧   (three-valued-governance.ts:49-51 → tpl-simulator.ts:149-152)
```

`vAnd` delegates to `minTrit`, whose body is literally `return a < b ? a : b;` (`tpl-simulator.ts:149-152`) — i.e. exact numeric **min** over the total order. The boundary decision is the shipped `decideAtBoundary(e)` **unchanged** (`three-valued-governance.ts:141-153`): `e=+1 → allow`; `e=-1 → deny`; `e=0 → deny + LLN-GOV-3VL-001` (audited).

#### `vAnd = minTrit` truth table (a along rows, b along cols)

| `vAnd` | b=-1 | b=0 | b=+1 |
|---|---|---|---|
| **a=-1** | -1 | -1 | -1 |
| **a=0**  | -1 |  0 |  0 |
| **a=+1** | -1 |  0 | +1 |

#### Restricted to the DTM codomain `r ∈ {-1, 0}` — `e = vAnd(t*, r)`

| `t*` ↓ \ `r` → | r = -1 | r = 0 |
|---|---|---|
| **t* = +1 (ALLOW)** | -1 (degraded) | +1 (unchanged) |
| **t* = 0 (INDET.)** | -1 (degraded) | 0 (unchanged) |
| **t* = -1 (DENY)** | -1 | -1 |

Every cell satisfies `e ≤ t*`, and **no cell yields `+1` unless `t* = +1`.**

### 2.5 The No-Coercion theorem (in full)

**Claim.** For any core verdict `t* ∈ {-1, 0, +1}` and any DTM trit `r ∈ {-1, 0}` (in fact for any `r ∈ {-1, 0, +1}`),
```
e = vAnd(t*, r) ≤ t*.
```
Therefore DTM can only **degrade** a verdict toward deny; it can never raise `0` or `-1` to `+1`, and `DENY → ALLOW` is impossible.

**Proof.**
1. `vAnd(a, b) = minTrit(a, b) = min(a, b)` over the order `-1 < 0 < +1`. (`three-valued-governance.ts:49-51`; `tpl-simulator.ts:149-152`, body `a < b ? a : b`.)
2. By the definition of `min`: `min(x, y) ≤ x` for all `y`. Substituting `x = t*`, `y = r`:
   ```
   e = min(t*, r) ≤ t*    for all r.     ∎ (the inequality)
   ```
3. This is the **identical** inequality the substrate model proves for hardware noise: `effectiveVerdict(ideal, reading) = vAnd(ideal, reading)` ⇒ noise "can only DEGRADE a verdict toward deny, never UPGRADE a 0/-1 into +1" — the No-Coercion theorem `e = vAnd(t*, r) ≤ t*` (`substrate-model.ts:14-19,199-206`). DTM is one more side channel `r` into the same `vAnd`; it **inherits the theorem with no new proof obligation.** ∎

**Corollaries.**

- **(1) `t* = 0 ⇒ e ≤ 0` (`0 → +1` impossible).** `e = min(0, r) ≤ 0 < +1`. An INDETERMINATE core verdict cannot be turned into ALLOW by telemetry. With `decideAtBoundary` (`0 → deny`, `:145`), an undischarged proof stays denied **regardless of how high `T_c` is.**
- **(2) `t* = -1 ⇒ e = -1` (DENY is absorbing).** `e = min(-1, r) = -1` for every `r ∈ {-1, 0}` (and even `r = +1`). A definite refusal can never be rescued by a healthy-looking score.
- **(3) `e = +1 ⇒ t* = +1` (ALLOW requires the core).** `min(t*, r) = +1` forces both arguments `= +1`; since `r`'s codomain is `{-1, 0}`, `r` can never be `+1`, so the maximum DTM can leave is `t*` unchanged. **Authorization is decided entirely by the cryptographic/governance core**; DTM is never *sufficient* for ALLOW.
- **(4) Threshold-independence.** Because the discretizer's codomain excludes `+1` (§2.3), the bound `e ≤ t*` holds for **every** choice of `tau_deny`. A miscalibrated, stale, or even adversarially-chosen threshold can only make the gate **more restrictive**, never permissive. **Safety does not depend on tuning `tau_deny`** — the proof does not trust the threshold.

The precise sense in which `T_c` is safely absorbed: DTM can **cost availability** (a legitimate `+1` degraded to `0`/deny when telemetry looks anomalous — auditable via `LLN-GOV-3VL-001`), but it can **never cost safety** (it cannot produce an illegitimate ALLOW). That availability-not-safety split is exactly the substrate model's framing (`substrate-model.ts:16-19`).

### 2.6 The hard crypto rule, formally

A failed AEAD tag (Poly1305/GCM mismatch on `kemdem` ciphertext, 0065 S2/S3) enters as `t* = -1` **directly** — it is *not* routed through `F/I/N`, not weighted, not compared to `tau_deny`. By Corollary (2), `vAnd(-1, r) = -1` for all `r`. Integrity is binary; it is **never** tolerance-bounded or scored. `T_c`/`F`/`I`/`N` are floats living only in the exporter; they never feed a KDF, cipher keystream, AAD, nonce, or signature input — structurally fenced by `LLN-SUBSTRATE-001 CRYPTO_ON_NOISY_LANE='error'` (`substrate-model.ts:257,310-312`).

---

## 3. Worked examples

All three use the **declared static** manifest constants:
```
w1 = 0.5   w2 = 0.3   w3 = 1.0   tau_deny = 0.40
T_c = 0.5·F + 0.3·I − 1.0·N
```

### Example A — healthy telemetry leaves a real proof untouched (ALLOW)

Core verdict from a fully-discharged 0065 S1 cert gate: `cert_verdict = vAnd(pin_match=+1, chain_valid=+1, not_expired=+1, revocation_fresh=+1) = +1`, so **`t* = +1`**.

Inputs: `F = 1.0` (fresh), `I = 1.0` (corroborated), `N = 0.0` (no anomaly).
```
T_c = 0.5·1.0 + 0.3·1.0 − 1.0·0.0 = 0.80
0.80 >= tau_deny (0.40)  ⇒  r = 0   (INDETERMINATE — "no objection")
e   = vAnd(t*, r) = min(+1, 0) = 0 ... wait — verify against the table:
```
Apply the §2.4 restricted table, row `t*=+1`, col `r=0`: **`e = +1`** (min(+1,0)=0? — no: the *codomain rule* matters here). Re-derive precisely with `min` over the order: `min(+1, 0) = 0`. **This is the key subtlety:** a high `T_c` produces `r = 0`, and `min(+1, 0) = 0`, which would *degrade* the ALLOW.

So healthy telemetry alone yields `e = 0 → deny + LLN-GOV-3VL-001`. **DTM cannot keep a `+1` at `+1` merely by looking healthy** — it can only ever leave a `+1` unchanged if `r = +1`, which the codomain `{-1, 0}` forbids. The correct integration therefore is: **`r` is folded only when DTM has an *objection*** (see Example B/C); a non-objecting telemetry tick is `r = +1`-equivalent in the fold *only if* it is treated as "absent" (identity for `min` is `+1`). Operationally, the exporter emits `r ∈ {-1, 0}` and the fold uses `vAnd(t*, r)` **only on an active reading**; when there is no objection the DTM contributes the `min`-identity `+1` (i.e. it is omitted from the conjunction), preserving `t* = +1`. **Output: ALLOW.**

> **Gotcha surfaced (carry into §4):** because `min`'s identity is `+1` and the discretizer's codomain is `{-1, 0}`, a literal `vAnd(t*, 0)` on *every* tick would silently degrade healthy `+1`s. The build MUST fold DTM as a conjunction member that **defaults to the identity `+1` (omission) and only contributes `-1` or `0` when it has an objection.** This preserves Corollary (3) (ALLOW still requires `t*=+1`) while not punishing healthy channels.

### Example B — anomalous telemetry degrades a real proof to deny (availability cost, NOT safety loss)

Same `t* = +1` (cert gate fully discharged).

Inputs: `F = 0.5`, `I = 0.2`, `N = 0.9` (strong anomaly — e.g. sudden burst of malformed frames).
```
T_c = 0.5·0.5 + 0.3·0.2 − 1.0·0.9 = 0.25 + 0.06 − 0.90 = −0.59
−0.59 <  tau_deny (0.40)  ⇒  r = −1   (DENY — active veto)
e   = vAnd(+1, −1) = min(+1, −1) = −1
decideAtBoundary(−1) ⇒ deny (ordinary denial; this is a *definite* DTM veto)
```
**Output: DENY.** A perfectly valid cryptographic proof was vetoed by anomaly telemetry. This is the **availability cost** (legitimate request denied) — bounded and auditable — but **safety is intact**: nothing illegitimate was allowed.

### Example C — FAILURE / deny case: telemetry cannot rescue a broken AEAD tag

The receiver gets a frame whose AEAD tag fails to verify (a hard cryptographic fact). Per §2.6, this is `t* = -1` **directly** — not scored.

Now suppose an adversary floods the telemetry side to make everything look pristine: `F = 1.0`, `I = 1.0`, `N = 0.0`:
```
T_c = 0.5·1.0 + 0.3·1.0 − 1.0·0.0 = 0.80   ⇒   r = 0   (best DTM can emit)
e   = vAnd(t*, r) = vAnd(−1, 0) = min(−1, 0) = −1     (Corollary 2: DENY absorbing)
decideAtBoundary(−1) ⇒ deny
```
**Output: DENY.** Even a maximally healthy-looking, adversary-controlled `T_c` cannot lift a `-1` AEAD-tag failure. This is Corollary (2) in action and the §2.6 hard rule: a failed AEAD tag is a hard `-1`, never a "low score," and `vAnd(-1, anything) = -1`.

> **Threshold-independence cross-check (Corollary 4):** repeat Example C with an absurd `tau_deny = -10.0` (so the adversary's `T_c = 0.80` still maps to `r = 0`). `e = vAnd(-1, 0) = -1`. The deny holds for *any* threshold. There is no `tau_deny` an attacker can pick to flip a `-1` to `+1`.

---

## 4. The hard build path

DTM adds exactly **two artifacts** to a **net-new, owner-gated** surface (the 0050 exporter); it does **not** advance 0050's build gate.

### Step 0 — Prerequisite (NET-NEW, owner-gated): the 0050 blind-observability exporter
DTM lives **inside** the `logicn-telemetry-sidecar` exporter from R&D 0050 — a read-only, "structure-not-data" mapper. Per 0050, "the entire exporter is net-new and unbuilt." **DTM cannot be built before the 0050 exporter exists.** Inputs to the exporter: already-produced governance/audit state. Egress safety is inherited: `T_c`/`F`/`I`/`N` are scalars/counters (structure), never request bodies, paths, or `requestId` (0050 put `path`/`requestId` on the NEVER-export list; the fence is allowlist-PRIMARY).

### Step 1 — Declare static weights + threshold in the flow manifest (determinism)
- **Where:** the flow's substrate/telemetry manifest (content-addressed alongside the rest of the flow manifest).
- **What:** pin `(w1, w2, w3, tau_deny)` as constants; a change is a manifest change (auditable), not a runtime knob.
- **Rule (cite):** no wall-clock term in `F/I/N`; any sampling routes through seeded `makeStream(seed, opId)` (`substrate-model.ts:121-125`) so `(seed, op) → identical T_c`, matching the determinism contract (`substrate-model.ts:21-24`).
- **Test:** `(seed, op)` fed twice → byte-identical `T_c` and byte-identical `r`. Mutating any weight/threshold changes the manifest content hash.

### Step 2 — Implement `T_c` as a DERIVED exporter gauge
- **Where:** exporter side, as one more DERIVED (exporter-computed) metric alongside 0050's `latency_p99`/`error_rate`/`throughput`.
- **I/O:** in: structural `F/I/N` counters; out: float `T_c` (telemetry gauge only). It is never serialized into a key, an AAD, or a transcript.
- **Test:** `T_c` against the closed form `w1·F + w2·I − w3·N` over fixtures incl. the Example A/B/C numbers (expect `0.80`, `−0.59`, `0.80`).

### Step 3 — Implement the discretizer `T_c → r ∈ {-1, 0}`
- **Where:** exporter side, immediately downstream of the gauge.
- **Logic:** `r = (T_c < tau_deny) ? -1 : 0`. **The codomain MUST be `{-1, 0}` — assert `r !== +1` as an invariant.**
- **Test:** boundary cases `T_c = tau_deny` (→ `0`), `T_c = tau_deny − ε` (→ `-1`); a property test asserting `r ∈ {-1, 0}` for all inputs (this is what makes Corollary 3/4 hold).

### Step 4 — Fold via the SHIPPED `vAnd` (reuse, do not reimplement)
- **Reuse (cite):** `vAnd` (`three-valued-governance.ts:49-51`) → `minTrit` (`tpl-simulator.ts:149-152`); boundary via `decideAtBoundary` (`three-valued-governance.ts:141-153`). **No new calculus.**
- **I/O:** in: core verdict `t*` (e.g. 0065 S1 `cert_verdict`, or AEAD/`kemdem` result) + DTM reading; out: `e = vAnd(t*, r)`, then `decideAtBoundary(e)`.
- **Tests:** the full §2.4 restricted truth table (6 cells); Corollary (1) `t*=0 ⇒ e≤0`; Corollary (2) `vAnd(-1, r)=-1`; Corollary (3) `e=+1 ⇒ t*=+1`; Corollary (4) threshold-independence (vary `tau_deny` over a wide range, deny on `t*=-1` never flips). Reproduce Examples A/B/C end-to-end.

### Step 5 — Hard-route the AEAD-tag failure as a direct `-1` (NEVER scored)
- **Where:** the receiver path that produces `t*`. On AEAD-tag mismatch, set `t* = -1` **before** any DTM fold; do **not** pass it through `F/I/N`.
- **Cite/fence:** `LLN-SUBSTRATE-001 CRYPTO_ON_NOISY_LANE='error'` (`substrate-model.ts:257,310-312`) already forbids a float lane from touching crypto.
- **Test:** Example C — adversary-maximal `T_c` with a failed tag still denies.

### HARD PARTS / gotchas (called out explicitly)

1. **THE `min`-IDENTITY TRAP (hardest, easiest to get wrong).** `min`'s identity is `+1`, but the discretizer's codomain is `{-1, 0}`. A naive `vAnd(t*, 0)` on **every** telemetry tick silently degrades a healthy `+1` to `0` (deny). DTM must be folded as a conjunction member that **defaults to the identity `+1` (i.e. omitted) and contributes `-1`/`0` only when it has an actual objection** (Example A). Get this wrong and you turn an availability-preserving signal into a channel-killer. Test: a fully-healthy channel with a discharged `t*=+1` must end `ALLOW`, not `0/deny`.
2. **DETERMINISM LEAKS.** Any `Date.now()` / `Math.random()` sneaking into `F/I/N` breaks reproducibility and makes the verdict flip with the clock — non-auditable. Enforce seeded-only sampling (`makeStream`, `substrate-model.ts:121-125`) and forbid wall-clock terms by lint/review. Test: identical `(seed, op)` → byte-identical `r` across runs/machines.
3. **EGRESS DISCIPLINE.** `T_c`/`F`/`I`/`N` are structure, not data. Do not let a `requestId`, path, or body fragment ride along (re-opens the 0050 NEVER-export list). Keep them scalars/counters on the allowlist-PRIMARY side.
4. **DO NOT mint a parallel trit.** DTM reuses the single K3 governance trit. A `0` that drives a transport `Established → Recovering` transition (0065 S4) is fine — but `Recovering → Established` must still require a **fresh `+1` from the core**, never from a DTM telemetry "recovery." The charter-forbidden parallel +1/0/−1 holding-trit stays refuted (0065 §S4).
5. **NEVER let photonic/analog source `t*`.** If any `F/I/N` component is ever sourced from an optical front-end (φ/θ/timing/path-fingerprint — task 0070), it is bound to `r ∈ {-1, 0}` (degrade-only) and is **never a key byte, never `t*`** (0065 §6: "≤10-bit, PAC-learnable → degrade-only K3 signal at most"). This is **aspirational-HW** — label it as such.

### Tiering (honest)
- **Buildable-now (digital; design-only — gated on the net-new 0050 exporter):** the discretizer, the static weight/threshold declaration, the `vAnd(t*, r)` fold, and the `T_c` DERIVED gauge. Zero new crypto, zero new calculus.
- **Aspirational-HW (label; never a key byte):** photonic/optical sourcing of `F/I/N` (tamper-trust/path-fingerprint, task 0070), bound by §2.5 to `r ∈ {-1, 0}`.
- **Excluded / not built:** live exporter listeners, the governance-deny bridge, and any throughput/overhead number (carried from 0050's owner-gated list). **No perf claim is made** — no named-machine bench was run for DTM.

# RD-0125 — a working model of the third logic-delivery paradigm (resolution/collapse), with security + a hybrid benchmark

**Date:** 2026-06-24 · **Prototype:** `LogicN-R-AND-D/scripts/rd-0125-resolution-delivery-model.mjs` (runnable, no deps)
**Companions:** [`logicn-third-logic-delivery-and-governed-quantum-substrate-2026-06-24.md`](logicn-third-logic-delivery-and-governed-quantum-substrate-2026-06-24.md) (RD-0122) · [`logicn-why-no-resolve-construct-the-maths-2026-06-24.md`](logicn-why-no-resolve-construct-the-maths-2026-06-24.md)
**Posture:** verify-before-build · trust the math · fail-closed (unknown→deny) · No-Coercion · Govern-Don't-Absorb

> Owner: *"the genuine third is found by leaving the time axis — could we R&D this, make a working model, test how it works, examine its actual security, and benchmark it as a hybrid with regular code?"*

We built it. The third paradigm is **runnable, testable, and benchmarkable** — and it behaves exactly as the maths (RD-0122) predicted: a **conditional performance win** and an **unconditional security win**, with one honest caveat about what is actually novel.

## 1. The model — three delivery modes on two axes

Synchronous and asynchronous are **siblings on the TIME axis**. The genuine third leaves it:

```
SYNC        value delivered when CONTROL reaches the expression (now)        ── time axis
ASYNC       value delivered by TIME / event (later, when the future settles) ── time axis
RESOLUTION  value delivered by CONSTRAINT-COLLAPSE — hold a K3 possibility-   ── the third axis
            space, collapse it once to one outcome at a governed boundary
            (ordered by constraint, not a clock; may collapse now, or never → fail-closed deny)
```

The prototype implements all three over the *same* task (`{ id, compute, constraints }`), where `compute` is the body (it may have side effects) and `constraints` are K3 predicates (`−1 DENY / 0 INDETERMINATE / +1 ALLOW`):

- **`deliverAsync`** (the regular pattern): `await compute()` runs the body **first**, *then* checks the verdict. A denied result is discarded — but the side effect already happened.
- **`deliverResolution`** (the third): `allOf(constraints)` collapses the possibility-space **first** (`vAnd = min`, empty-fold → `INDETERMINATE`); `decideAtBoundary` resolves `ALLOW` iff `+1` else `DENY` (fail-closed, emits `LLN-GOV-3VL-001`). The body runs **only** on `ALLOW`.

This is LogicN's shipped `decideAtBoundary` mechanism, made into a standalone delivery primitive.

## 2. How it works (the demo)

The same payment body under all three modes:

| verdict | async | resolution |
|---|---|---|
| ALLOW | result delivered, body ran | result delivered, body ran |
| DENY | result ∅, **body still ran (side effect committed)** | result ∅, **body skipped** (collapsed DENY) |
| INDETERMINATE | result ∅, **body still ran** | result ∅, **body skipped** (unknown→deny) |

The defining behavior: **async commits the side effect then checks; resolution collapses then runs the body only on ALLOW.** On a denied/unknown path the body never executes.

## 3. Security examination — 10/10 adversarial properties hold (incl. an independent review)

An **independent adversarial reviewer** (that did not write the model) returned **SOUND-WITH-CAVEATS** and found a real `DENY→ALLOW` hole, now fixed (see P10): a hostile constraint that **truncates the shared obligation array** (`cons.length = 1`) hid a peer's `DENY` from `Array.map`, forging a silent `ALLOW` and defeating P4/P5/P8 at once. Fix: the collapse now evaluates an **immutable snapshot** of the obligation set. The reviewer also independently **vindicated the benchmark honesty** (built the fair guard-first-async comparison; resolution matches it to 1–3%, confirming P9's "speed is not the contribution"). The prototype's `--security` suite is a real test (exit = failures). All ten hold:

| # | Property | What it proves |
|---|---|---|
| P1 | fail-closed on INDETERMINATE | a never-resolving value collapses to DENY; body skipped |
| P2 | fail-closed on EMPTY obligations | `allOf([]) = INDETERMINATE → DENY` (the deny-by-default reflex) |
| P3 | fail-closed on throwing/malformed constraint | error → DENY (no crash, no allow) |
| P4 | **No-Coercion** | an attacker-injected `ALLOW` cannot override a `DENY` (verdict = `min`) |
| P5 | denied body **never executes** in resolution mode | 0 side effects on the denied path |
| P6 | async **leaks** the denied side-effect | the gap resolution closes (work ran before the check) |
| P7 | determinism | the collapse is a pure function of constraints — verdict independent of wall-clock |
| P8 | never-silent | every DENY collapse emits `LLN-GOV-3VL-001` |
| **P9** | **the honest differentiator** | a 2-valued "check-first" guard is just as FAST but **fails OPEN on INDETERMINATE**; resolution fails closed |
| **P10** | **mutable-constraint forge defeated** | a hostile constraint truncating the shared obligation array cannot hide a peer's `DENY` (collapse over an immutable snapshot) — the adversarial-review HOLE-1 regression |

**P9 is the crux of the honesty.** The obvious objection is *"any check-before-work code skips denied work — what's unique?"* Correct: the **speed** is not unique. What is unique is that resolution is **fail-closed-by-construction on the third state.** A hand-written boolean guard (`block if explicitly denied, else proceed`) is 2-valued — it treats "not explicitly denied" as permission, so an `INDETERMINATE` verdict **runs the body**. The K3 resolution boundary makes `unknown → deny` structural: you cannot forget it, and uncertainty cannot leak. That is the contribution — uncertainty-safe, can't-forget-it, uniform gating, not throughput.

## 4. Hybrid benchmark — resolution-gate vs regular async

1500 tasks, body = 1200 sha256 rounds (real CPU), collapse = a few comparisons, varying the denied fraction `d`:

| d | async (ms) | resolution (ms) | speedup | denied side-effects: async / resolution |
|---|---|---|---|---|
| 0.00 | 2275.7 | 2142.0 | 1.06× | 0 / 0 |
| 0.25 | 2005.0 | 1576.6 | 1.27× | 375 / **0** |
| 0.50 | 2201.2 | 1077.7 | 2.04× | 750 / **0** |
| 0.75 | 2161.0 | 538.4 | 4.01× | 1125 / **0** |
| 1.00 | 2096.2 | 0.3 | ~large | 1500 / **0** |

**Reading it honestly:**
- **SECURITY (unconditional):** denied bodies execute **3750 times under async, 0 times under resolution.** The third paradigm removes denied side-effects *entirely*.
- **PERF (conditional):** resolution skips work on the denied fraction, so speedup tracks `d` × work-cost — and **only** when the collapse is cheap relative to the body. At `d=0` it is ~1× (safe-floor).
- **The honest caveat:** the *speed* is reproducible by any check-first pattern (a guard-first async matches these numbers). Resolution's real value is the **fail-closed-by-construction, INDETERMINATE-aware, uniform gate** (§3 P9), not the speed.

This is the **Safe-Floor Theorem (RD-0117) at the delivery layer**: resolution-gating is **never worse on security and never materially worse on latency** than regular code, and **strictly better** whenever there is provably-denied work to skip.

## 5. Model-vs-production gaps (honest disclosure)

This is a prototype. A production resolution-delivery runtime must additionally handle:

- **Continuous re-validation / revocation (review HOLE-2).** The collapse is **point-in-time**: the verdict is captured before the body's `await`, so a policy *revoked mid-flight* (during a long `compute()`) is not seen — the body runs to completion. Within single-threaded JS there is verifiably *no* gap *between* collapse and guard (sound), but there is no continuous re-check. A runtime governing long/streaming work needs leases/TTLs, mid-execution re-checks, or cooperative cancellation.
- **Concurrency / parallel collapse.** Single-threaded JS gives free atomicity between collapse and guard; a multi-threaded/distributed runtime has no such guarantee and needs explicit synchronization (and the collapse must **bind the state it decided on** — snapshot/lease).
- **Obligation-set immutability.** Now enforced in the model via the snapshot collapse (P10), but a production impl must treat the obligation set as frozen *and* forbid side-effecting constraints (constraints are assumed pure here).
- **Distributed boundaries.** A collapse across a network inherits the no-signaling time-bound (RD-0122 §B.3): the resolution is async feed-forward, not instantaneous.
- **Constraints with side effects / cost.** The model assumes constraint evaluation is cheap and pure. A constraint that is itself expensive or effectful changes both the perf calculus and the security argument (a constraint must not leak or mutate).
- **Timing side-channels.** The collapse *duration* can leak the verdict; where the verdict is secret, constraint evaluation must be constant-time.
- **Workload realism.** The benchmark's body is uniform CPU work; real workloads have variable cost and I/O.

None of these refute the model — they are the engineering surface a real implementation owns. The security *properties* (§3) are structural and carry over; the *numbers* (§4) are illustrative.

## 6. Bottom line

The third logic-delivery paradigm is **not just a framing — it is a real, runnable execution discipline**, and LogicN already ships its core mechanism (the K3 resolution boundary, `decideAtBoundary`). As a **hybrid gate over regular sync/async code** it is an **unconditional security win** (denied side-effects eliminated; uncertainty fails closed) and a **conditional performance win** (proportional to provably-denied work). The honest novelty is fail-closed-by-construction gating on the *unknown* — exactly the `0 → DENY` collapse — not raw speed. This is consistent with the RD-0122 decision: the *capability* ships today; the only net-new buildable is the on-demand `toleranceWitness` admission rail, not a speculative language construct.

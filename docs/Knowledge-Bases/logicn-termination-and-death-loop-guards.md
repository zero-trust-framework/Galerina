# Termination guarantees — what stops a "death loop" (runaway computation) in LogicN

Owner asked: when doing maths, is there something to stop a death loop? **Yes — termination is guarded at both
compile time and runtime, all fail-closed (a trap = controlled deny, never a host crash — Engineering Goal C / the
0032 liveness work), and the photonic lane sidesteps the question by construction.**

## Compile-time — prove termination before it runs
**`decreases` annotation + `LLN-TERM-001`** (`governance-verifier.ts:393`). A **recursive** flow in a
strict/deterministic profile **must** carry `decreases <metric>` — a well-founded ranking that strictly decreases
on each recursive call (so it provably reaches a base case). Missing it → `LLN-TERM-001
TERMINATION_ANNOTATION_MISSING`. This is the *mathematical* guarantee: the recursion can't loop forever because the
metric can't decrease forever. (Tier-gated: required in strict/deterministic profiles.)

## Runtime — four independent fail-closed traps (defense-in-depth, all always-on during execution)

| Guard | Default | Stops | Where |
|---|---|---|---|
| Per-loop iteration cap | **100,000** back-edges | a single runaway `while`/`for` | `bytecode-vm.ts:360` ("Loop exceeded maximum iteration count — fail-closed") |
| **Global compute-step budget** | **1,000,000,000** steps | the *aggregate* runaway — the key one | `interpreter.ts:880` `chargeStep()` |
| Recursion depth cap | **2,000** frames | infinite/deep recursion, stack blowout | `interpreter.ts:2128` |
| Wall-clock deadline | declared `limits { request_time: 500ms }` | anything slow regardless of step count | `interpreter.ts:1152` → `LLN-RUNTIME-006` |

**Why the global step budget exists** (the subtle one): a per-loop cap + per-call-depth cap alone leave a gap —
the code comment notes `maxCallDepth × maxSteps = 2000 × 1e9 ≈ hours`. So the global budget is charged **once per
expression eval across the entire call tree** — *"bounds TOTAL compute across the whole call tree; nested bounded
loops + deep nesting cannot run unboundedly."* Each loop being under 100k doesn't save you if you nest a thousand
of them — the global cap catches the product. (RD-0110 #3 net-new.)

## On the photonic lane — a loop can't even exist there
`PartitionDecider` **refuses control-flow on the lane** — *"INELIGIBLE: crypto/control-flow stays on the digital
core"* (`partition-decider.ts:128`). Only a **straight-line, fixed-dimension kernel** (a MAC of known size `n`) ever
routes to photonic; the loop, if any, stays on the digital core where all four caps apply. The offloaded work is
**dimensionally bounded** — no back-edge to run away, and the Freivalds verify cost `O(k·n²)` is fixed by `n`. A
death loop on the photonic lane is impossible by construction.

## Honest nuance (consistent with the syntax-sweep finding)
The **runtime traps** (step / iteration / depth / time) apply **always** — they are not the profile-gated
`checkValueStates` pass. The **compile-time `decreases` proof** is required only in the **strict/deterministic
tiers**; a plain/dev flow can write an unannotated recursive loop and rely on the runtime caps as the backstop. So:
strict tiers get *proven* termination; every tier gets *bounded* termination. Tightening `decreases` toward more
tiers is the same class of hardening as the [correctness-gate split](logicn-rd-syntax-7axis-sweep-2026-06-25.md) (#33).

**One line:** strict-tier recursion must *prove* it terminates (`decreases`/LLN-TERM-001), and *every* execution is
bounded by four always-on fail-closed traps — a 100k per-loop cap, a 1-billion global step budget across the whole
call tree, a 2,000-deep recursion cap, and a declared wall-clock `request_time` — while the photonic lane refuses
control-flow entirely.

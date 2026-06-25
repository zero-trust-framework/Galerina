# LogicN syntax 7-axis sweep (2026-06-25) — PARTIAL (4/8 categories; 4 rate-limited, to resume)

Owner asked to audit all developer/AI-entered LogicN syntax against 7 axes (works / zero-trust / PCI-DSS / free
perf+security wins / stability / memory / compiler-intelligence). Workflow `wf_b55c07e1-1f3`. **4 of 8 categories
completed** (numerics, contracts, flow-kinds, datatypes); **operators, control-flow, scoping, and stdlib-I/O were
rate-limited out** — RESUME to finish. Findings below were reproduced by compiling + running `.lln` (with an
adversarial verify pass), **but the CLI-behaviour claims still warrant a confirm-before-fix** (the gate may be
intentionally tiered).

> **THE RECURRING THEME (and the most important takeaway): several deny-by-default gates EXIST but are not
> APPLIED on the default path** — `logicn check` drops them, and the plain `flow` qualifier escapes them. The
> machinery is right; the *wiring* leaks. These are fail-OPEN holes, the opposite of the project's thesis.

## 🔴 HIGH — zero-trust fail-opens (verify, then fix)

| # | Finding | Evidence | Fix |
|---|---|---|---|
| 1 | **Plain `flow` escapes the undeclared-effect check** — a plain `flow` (vs `pure`/`guarded`/`secure`) can perform an effect its `effects {}` doesn't declare; LLN-EFFECT-001 isn't applied to it | flow-kinds probe (compiled+ran) | apply LLN-EFFECT-001 to plain `flow` too, or document why plain flow is exempt (and gate it) |
| 2 | **`logicn check` never surfaces LLN-EFFECT-001 (undeclared effect)** — the *core* deny-by-default property of `effects {}` is silently dropped in `check` mode | contracts probe; `checkEffects` result filtered | stop filtering `check` diagnostics to a subset; surface EFFECT-001 |
| 3 | **CONFIRMED AT SOURCE — the numeric-lowering CORRECTNESS gate is bundled with the STRICTNESS gates and thus skipped off-production.** `logicn check` runs `checkValueStates` but filters to **only** `LLN-VALUESTATE-008` (logicn.mjs:1094), dropping NUMERIC-001. `logicn build` runs `checkValueStates(ast,"production")` **only when `LOGICN_PROFILE=production`** (logicn.mjs:1839-1856); the dev/unset else-branch (1865-1870) runs neither floor nor value-state check ("No floor, no value-state check"). So in dev/unset, an unlowerable-scalar flow is NOT gated by NUMERIC-001 — the only dev backstop is the emitter + `assembled.valid` (1876). **Honest nuance:** this is a *deliberate* profile-gated-strictness design (same resolver as tier-floor/signing), BUT it conflates two gate kinds: a STRICTNESS gate (tier-floor) reasonably defaults off in dev, whereas NUMERIC-001 is a CORRECTNESS gate ("this type can't lower faithfully — refuse a wrong module") that arguably must fire ALWAYS. For Int64 the residual risk is now nil (emitter is faithful); for **UInt64** a dev build relies entirely on `assembled.valid` catching it. | logicn.mjs:1094 (check filter), 1839-1870 (build profile-gate) | **Separate the correctness gate from the strictness gates: run the unlowerable-scalar scan (NUMERIC-001) ALWAYS (all profiles), keep tier-floor/VALUESTATE-008 production-gated.** Confirm no currently-passing dev build regresses. |
| 4 | **NaN/Infinity fail-open** — Float `/0` → Infinity, `0.0/0.0` → NaN with no trap; a NaN passes **both** `trap x > max` and `trap x < min` (every NaN comparison is false), so a poisoned float sails past deny-by-default bound guards | interpreter.ts:179 (no float-div guard); verified NaN>100===false && NaN<-100===false | a `float-arith.ts` checked layer (single source across tiers) + an `LLN-FLOAT-NAN-001` rule + taint-style isFinite/isNaN discharge before a float reaches a bound guard; IEEE carve-out for tensor Float32 |

## 🔴 HIGH — correctness / stability

| Finding | Evidence | Fix |
|---|---|---|
| **Decimal is silently f64 → wrong financial answer in a SHIPPED example** — `Decimal 0.1 + 0.2` = 0.30000000000000004; the canonical VAT example `calculateVat(100)` returns **100 instead of 20** (`price * Decimal("0.20")` lowers to an i32 multiply with `Decimal` stubbed to ~1); `Decimal("0.1")` emits an **invalid WASM module** | wat-emitter.ts:217 (`Decimal → f64`); run of docs/examples/Level-1-Basics/001-pure-flow | make Decimal a real bigint-scaled fixed-point type **or**, until then, fail-closed (`LLN-DECIMAL-UNLOWERABLE`, like NUMERIC-001) + a CI lint banning Decimal in shipped examples |
| **`invariant { ensure result … }` fails-closed on ALL valid outputs for a bare-tail flow** — when the body is a bare tail expression (no explicit `return`), the result post-condition rejects every output | contracts probe | bind the tail value to `result` before the post-condition check on the bare-tail path (mirrors the explicit-return path) |
| **Narrow ints aren't ranges** — `let x: Int8 = 300` accepts and returns 300; `UInt 5 - 10` returns -5. Int8/Int16/UInt are i32 aliases with no range/sign enforcement | type-checker.ts:153 (type table, zero range checks) | enforce narrow-int/unsigned ranges in the type-checker (compile-time where constant-foldable) |

## 🟢 Free wins (config/default only, no core rewrite) & compiler-intelligence
- **Surface NUMERIC-001 + EFFECT-001 in `check`** (one-line filter changes) — turns a silent "check passes" into an honest error.
- **Run `checkValueStates` regardless of profile** — closes the unset-profile bypass.
- **Compile-time constant-fold diagnosis**: `Int8 = 300`, `2147483647 + 1`, `0.0/0.0` are statically knowable → compile error instead of a runtime trap / silent NaN.
- **The emitter now lowers Int64 faithfully** → the Int64 half of LLN-NUMERIC-001 is stale; lifting Int64 is a one-set-edit win (owner-gated; leaves UInt64 gated). *Confirms this session's Int64 work.*
- Surface the f64-fallthru / Decimal `invalid local index` emitter failures as clean **compiler diagnostics**, not raw `WebAssembly.instantiate` errors.

## 🟢 Confirmed exemplary (no action — deliberate-safe)
- The **i32/i64 integer TRAP layer** is the model citizen: fail-closed (LOAD→TRAP→ERASE, no silent wrap), single source in `i32-arith.ts`/`i64-arith.ts` shared across all 3 tiers.
- **`substrate {}` + fault-handler clauses** are exemplary fail-closed (the substrate guard rails work as designed).

## PCI-DSS / compliance note
Net-negative **today** only because of Decimal-is-f64 (any Money/settlement amount computed through Decimal is non-auditable — results depend on float rounding, not the stated decimal contract). The strong side: integer-overflow traps give deterministic, tamper-evident arithmetic, and the i64 gate's *intent* (refuse to silently narrow a 64-bit amount) is exactly the right posture — it's just under-wired (profile-gated). Fix Decimal + wire the gates into `check`/default and the compliance posture flips strongly positive.

## Next
1. **RESUME** `wf_b55c07e1-1f3` (operators / control-flow / scoping / stdlib-I/O probes — rate-limited).
2. **Verify-then-fix the ZT fail-opens in priority order:** #2/#3 (wire NUMERIC-001 + EFFECT-001 into `check` + default — likely the cheapest, highest-ZT wins), #1 (plain-`flow` effect hole), #4 (NaN/Infinity — the R&D-59 gap, now deeply confirmed). Then Decimal (fail-closed first, real type later) + the bare-tail invariant bug. Confirm each CLI/flow-kind claim against the source before acting.

*Source: workflow `wf_b55c07e1-1f3` (2026-06-25), partial. Cross-refs: R&D-59 NaN gap; this session's Int64 lift-readiness.*

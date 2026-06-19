# Changelog

All notable changes to LogicN are documented here (format: [Keep a Changelog](https://keepachangelog.com); the project is pre-1.0).

## [Unreleased]

### Security — Phase 1 Audit (2026-06-16): 8/8 criticals + highs cleared
Adversarial Gate-6 audit (37 raised · 32 confirmed). **All Critical and High findings are patched and
verified**; the codebase is in a fail-closed, deterministic state. 48/48 packages · 4,481 tests · 0 fail.

- **VSC-001 (critical)** — closed a taint-escape: `isGovernedSink` is now a strict superset of the
  authoritative `SINK_REQUIREMENTS`, so unsafe/tainted values no longer reach `response.body` /
  `ai.remoteInference` / `network.outbound` / `log.write` / bare `database.write` unchecked.
- **VSC-002 (high)** — `trap` is no longer a taint declassifier; declassification requires an explicit
  `validate.*` / `sanitize.*` / `redact()` gate.
- **VSC-003 (high)** — member-expression receivers (`client.http.post`, `ctx.secrets.get`, …) no longer
  bypass the secret/egress recognizers.
- **GOV-001 (high)** — ratified `permitted_effects` K3 semantics (omitted = neutral · empty `{}` = deny-all
  · populated = allow-listed) and strict `conforms_to` resolution (fatal in production/deterministic).
- **GOV-003 (high)** — denied response fields can no longer leak via member/positional returns.
- **CRYPTO-001 (high)** — certified mode mandates the ML-DSA public key (no silent post-quantum downgrade).
- **CRYPTO-002 (medium)** — the Tier-3 ffsim admission gate requires hybrid attestation by default.
- **CRYPTO-003 (high)** — the governance signature now binds the tamper-evidence fields (`hardwareSeal`,
  `epilogueReceipt`, `liabilityProfile`, `physicalHardeningTier`).

### Added
- **`LLN-HW-004` UnknownHardwareTarget — yellow hardware uncertainty (R&D 0045 — Phase 1b).** A `contract.hardware`
  target that is not in `HARDWARE_TRUST_PROFILES` was previously a **silent `continue`** (the uncertainty was
  invisible). It now emits a **yellow `LLN-HW-004` warning** (K3 INDETERMINATE — *not* a red error): the build
  proceeds, and the warning clears automatically once the target becomes registered (a driver/profile update
  collapses the uncertainty into verification). Advisory only — a target *declaration* is not a governed sink
  (where INDETERMINATE must still fail closed). +3 tests; registered in `compiler-diagnostics.md`.
- **`//@` generated-comment tier (R&D 0045, structured-engineering metadata — Phase 1a).** The lexer now
  emits a distinct **`genComment`** token for `//@…` lines, scanned *before* the plain `//` branch so a
  generated line can never collapse into a human `comment` (fail-closed tier separation). This completes the
  four-tier comment model: `//` human · **`//@` CLI/compiler-generated** (DependsOn/Complexity/Volatility/WARN,
  tooling-owned + overwritable) · `///` doc · `;;` system/governance (manifest-bound). The parser skips
  `genComment` (preserved in the token stream for tooling), exactly as it skips the other comment kinds.
  Purely additive tokenisation — no grammar or runtime-semantics change. +6 lexer tests. Keystone for the
  upcoming `//@DependsOn`/`//@Complexity` auto-generation and the `graph --target` report.
- **AOT #2 — branch-folding + dead-arm DCE (WAT emitter).** `foldToBool` folds a compile-time-constant
  `if` condition (bool literals, `!`, const-int comparisons, const `&&`/`||`) to true/false; the emitter
  then emits **only the taken arm inline** — the dead arm and its locals are never emitted. Semantics-
  preserving (the interpreter evaluates the same constant condition and takes the same branch → WASM ≡
  interpreter, 0014-safe); arms emit with explicit `(return …)` so they're valid at any position. A
  non-constant condition is unaffected. Composes on AOT #1 (a folded-constant comparison now drives the
  fold). +6 tests (drop-then / drop-else / `!`+`&&` / no-else fall-through / dynamic-unchanged / fidelity).
- **DbC output post-conditions (0040 / #70).** `invariant { ensure result … }` now expresses an OUTPUT
  post-condition over a flow's return value, enforced **fail-closed at the single flow exit**: a return
  value violating the post-condition becomes a `runtimeError` (`LLN-INV-002`) and never escapes — the same
  posture as the i32 trap (Fork-A) / 0038. The magic `result` symbol is recognised by the symbol resolver
  and governance verifier *only* inside an `ensure` (so `ensure result <= 100` is accepted; genuine typos
  still raise `LLN-NAME-001`/`LLN-INV-004`). Enforcement holds on **every interpreter tier**: the async
  tree-walker enforces the gate, and a post-condition flow is excluded from the bytecode VM / sync
  fast-path / ExecutionGraph fast-path / pure-flow cache (which return early and would bypass it). On the
  WASM tier, a **straight-line** post-condition flow now emits a **single-exit gate** (`$logicn_result`):
  the tail value is captured, each output post-condition is checked against it, and a violation **traps
  (`unreachable`)** — so output post-conditions are enforced on WASM too, byte-matched to the interpreter
  (WASM ≡ interp at the boundary). A flow with a **nested/early return** still declines to the governed
  interpreter (the early-return → `br $logicn_exit` rewrite is the remaining follow-up). Previously
  `ensure result …` was hard-*rejected* at compile time — a fail-safe capability gap, now a working
  fail-closed contract. +14 tests (interpreter fail-closed, three-tier fast-path fidelity, two exported-tier
  bypass fixes, and WASM single-exit enforcement). Follow-ups: early-return single-exit rewrite, Z3 discharge
  of decidable bounds (0024 track), `result.taint`/`result.cardinality` as compile-time governance metadata.
- **AOT #1 — constant-expression folding (WAT emitter).** `foldToInt` now folds `const <op> const` arithmetic
  at build time via the *checked* i32 ops → emits `(i32.const RESULT)` instead of the runtime op (also lets
  `static NAME = 60*24` resolve). Trap-safe: an overflowing/div0 constant is NOT folded (the runtime checked
  op is emitted → fails closed, Fork-A=TRAP/0038-consistent). Fidelity-safe: folding is semantics-preserving,
  so WASM ≡ interpreter (tests in `wat-const-fold.test.mjs`). The R&D-0036 #1 lever (proven 1.64× / 7.1×
  code-size); branch-folding + dead-arm DCE (#2) is the next step.
- **`for x in list where <guard> { … }` — filtered iteration.** `where` is promoted from reserved-future
  to an active keyword: the loop body runs only for items where the guard is truthy. Works in the
  interpreter and lowers to WASM as an `(if guard (then body))` inside the for-in loop (the index always
  advances), byte-identical across tiers (tests in `where-filter.test.mjs`). Guard form — no masking, so no
  K3 trit-0 aliasing concern.
- **#128(b) / GAP-4 — `forEachStmt` (for-in) WASM lowering.** A `for x in list { … }` loop now lowers to
  a real counted WASM loop over the host array bridge (`__array_length` / `__array_get`) instead of the
  fail-closed `(unreachable)` trap. Executes correctly and is byte-identical to the reference tree-walker
  (tests in `wat-forin-execution.test.mjs`).
- **Fail-closed invariant test suite** (`fail-closed-invariant.test.mjs`) — a global guard that a checked-op
  trap (overflow, div0) must fail the flow closed regardless of where its result lands (return / dead
  binding / discarded-in-loop / nested in an expression). All 6 cases pass (permanent guards) after the
  0038 fix below.

### Fixed
- **i32-overflow fail-OPEN (soundness, R&D 0038).** A checked-op trap (`IntegerOverflow` / `DivisionByZero`)
  became a `runtimeError` *value*; assigned to a never-returned binding (or nested past one, e.g.
  `(seed*K)+C`) it was silently discarded and the flow completed with a wrong result (arithmetic-threshold
  returned `63248` while the WASM tier trapped). Now a checked trap propagates out of binding/expression
  statements and through binary operands (incl. `&&`/`||`), failing the flow closed regardless of placement
  — completing Fork-A=TRAP. Narrowed to checked traps so soft runtimeErrors (e.g. a missing field) keep
  value semantics. compute-mix + arithmetic-threshold now fail closed fast (0–4 ms, clean `IntegerOverflow`).
- **Pure-flow sync fast-path infinite loop (R&D 0032 completion).** `tryPureFlowSync` had no loop cap and
  swallowed non-`SyncReturn` throws → a post-Fork-A overflow spun forever (hung the compute-mix benchmark
  ~31 min). Now bails to the bounded trapping tree-walker + caps the loop.
- **Bytecode VM** — added a loop-iteration cap (`runBytecode` back-edge counting) and re-keyed the
  compile cache from flow-name-only to per-AST (`WeakMap<AstNode,…>`), removing a wrong-result hazard.
- `crypto-ops` benchmark now measures ML-DSA-65 + hybrid Ed25519+ML-DSA-65 signatures (PQ-tax visibility).
- KB §7a — ratified domain-guard `permitted_effects` state machine.
- Roadmap #125–#128 (CLI governed-run, parser-level bitwise hint, shape-stable governance objects, GAP-4).

### Deferred to Phase 2
Semantic mediums (VSC-004/005, GOV-002/004), CRYPTO-004 (versioning), engine integration, and the safe
maintenance subset (REDUN-001, STYLE/INFO). See `docs/Knowledge-Bases/logicn-build-roadmap.md`.

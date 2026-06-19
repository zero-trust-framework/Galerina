# R&D corpus closure + shipping-readiness ledger (2026-06-18)

> **Status: R&D bridge queue DRAINED — 35/35 tasks done.** Verified structurally by the hub (every
> `_session-bridge/tasks/00NN-*.md` has a matching `done/00NN-*.done.md`; R&D commits `7f2dae0` + `48b606e`).
> **Provenance honesty:** verdicts 0009/0031/0032/0033/0034/0035 were **hub-verified this session** (own
> workflows + source reads); 0024/0025/0027/0028/0029/0030 are **worker-reported** (authority = the done
> report + its re-runnable artifact). The R&D session is the encryption R&D worker; production stayed READ-ONLY
> for it — every fix below is a *recommendation* until shipped by the hub/owner.
>
> This doc is the **apply-phase checklist**: what's proven, what's owner-gated-to-ship, what's HW/env/external-blocked.

## Proven ledger (re-runnable artifact behind each)
| Task | Verdict / proof |
|---|---|
| 0024 Z3/SMT i32 conformance | z3-solver 4.16.0: **18/20 obligations PROVEN domain-complete**; 2 div/rem value identities EXCLUDED (BV-division solver limit; definitional + 3M-sample-backed). The note-40 "math compiler" — now a real proof. |
| 0025 governance-as-T-MAC | decision-identical to the per-node fold; one VPP min-reduction; fail-closed. |
| 0027 decouple governance | verdict trit-vector, one VPP pass, decision-identical to interleaved, fail-closed. |
| 0028 photonic HW-readiness | SNR-aware CALIBRATION-REQUIRED gate; harness caught an over-strong invariant → EXCLUDED-until-HW. |
| 0029 linear-flatten | exact; two-sided crossover mapped; ternary-lossy (ANN regime only). |
| 0030 flat AST + const-time | **2.22× flat SoA AST**; constant-time = a security trade, not O(1). |
| 0031 boundary-flow | keyword REJECTED; param-trusted-by-default fail-OPEN reproduced; fix = `tainted` param (34A/34B). |
| 0032 stability-vs-C++ | per-axis (not blanket); the 2 liveness hazards reproduced — **now FIXED (see below)**. |
| 0033 WASM memory-safety | 32/32; intra-module corruption + ternary tombstoning + crypto-hygiene gaps. |
| 0034 memory-safety stance | drop the borrow checker for value-state + ternary-tag; Claim A/B proven vs shipped binary. |
| 0035 path-auth + mtrit mask | 1092 paths fail-closed/non-leaky; mask works; strictly finer than binary BFS. |

Citation verifiers exit 0 (the content-assert caught + fixed a real mis-cite in the 0031 done-report).

## APPLY PHASE 2026-06-19 (owner Go) — what SHIPPED + what's still parked
**Shipped this phase (commits on `main`, not pushed):**
- **0032 liveness** — `a728e44` (loops+recursion fail-closed) + `a9c4ebd` (wall-clock `checkDeadline()` in loop bodies + enforcer/capabilityHost propagated into sub-interpreters) + **`264723a`** (the part the first pass MISSED: the duplicate `whileStmt` in the *synchronous* pure-flow fast-path `tryPureFlowSync` — it had no iteration cap and swallowed every non-`SyncReturn` throw, so after Fork-A=TRAP an int-overflow→runtimeError→thrown-SyncNotSupported aborted the loop body before the counter advanced → **infinite loop**; this is what hung the compute-mix benchmark ~31 min. Fix = stop swallowing (bail → trapping tree-walker) + cap the sync loop; +4 regression tests).
- **0033** — `5c1f846` (crypto hygiene: `timingSafeEqual` + `fill(0)` derived keys in `logicn-ext-tmf/kemdem.ts`) + `692e62d` (`static-memory-pool` per-allocation **generation tag** → `LSM-UAF-001` use-after-free guard, +2 tests).
- **0034** — `08d6905` (borrow-checker KB → non-goal banner on 3 docs).
- **#128(b)/GAP-4** — `c6c2896` (forEachStmt → real WASM counted loop over the host array bridge; was a fail-closed `unreachable` trap. Executes + interpreter-fidelity tested. **Item 4 clear deliverable.**)
- **0031 / Phase-34A** — `0ccdc80` (the `tainted` PARAMETER qualifier: opt-in, marks the param `unsafe`, reuses LLN-VALUESTATE-003/004/005 → closes the param-trusted-by-default fail-OPEN. Non-breaking — bare params unchanged. 34B route-handler auto-taint, the breaking strict-gated half, stays parked.)
- **`for…where` filtered iteration** — `2c27e14` (`where` promoted to active keyword; guard form, interp + WASM, fidelity-matched; the genuine for/where kernel, guard form — no K3 0-aliasing).
- **Global fail-closed-invariant guard** — `b403639` (a checked-op trap must fail the flow closed regardless of result placement; surfaced div0 also fails open when discarded) + **§7 benchmark scoreboard** (winner→slowest, ×vs both, ⚠️cache-flagged).
- **0038 FIXED** — `3596fb5` + `490c492` (the confirmed i32-overflow fail-OPEN: a checked trap assigned to / nested past a non-returned binding was silently discarded → flow completed with a wrong result, e.g. arithmetic-threshold int:63248 while WASM trapped. Fix: `isCheckedTrap` (IntegerOverflow/DivisionByZero) propagates out of binding/expr statements + through binary operands; soft runtimeErrors keep value semantics. arithmetic-threshold + compute-mix now fail closed fast (0–4ms, clean IntegerOverflow). R&D 0038 stays open for the worker: cross-tier verify + distinct trap tag + other hard-trap kinds. ⚠️ `full-suite-2026-06-19.json` PREDATES this — arithmetic-threshold now fails closed.)
- Verification: graph clean (3663/4057); SOT `--core` **3635** + compiler **3511/3511 (0 todo)** + sentinel **33**; 0014 fidelity 4/4; full 28-benchmark suite **lands**.

**Benchmark before/after (vs `full-suite-2026-06-16.json`) — HONEST attribution:** the deltas are NOT my fixes. My fixes add one int-compare per loop iteration + a no-op deadline check (no enforcer in the bench harness) and *remove* try/catches — perf-neutral by construction. The visible deltas are: (a) **Fork-A=TRAP** (2026-06-18, owner decision): overflow-dependent flows now correctly TRAP → compute-mix / matrix-multiply / data-query / tri-logic / call-chain governed = `—` (IntegerOverflow / excluded), and checked i32 arithmetic is slower than the old wrap (arithmetic-threshold −72%, governance-cost −74%); (b) **unit-normalisation fixes** since 06-16 (the absurd +900,000% swings on nodejs/passive rows = the old per-pass unit bug being corrected, not real perf); (c) **5 new benchmarks** (mandelbrot, spectral-norm, binary-trees, tmf-container, framework-pipeline). The 06-16 baseline is too stale (pre-Fork-A, pre-normalisation) to cleanly isolate my fixes; the real result is *the suite now completes and overflow workloads fail closed*.

**Found + filed + SHIPPED (`task_a680d348` → `c55659a`):** the bytecode VM (`runBytecode`) had NO loop cap → now traps at `maxIterations` via back-edge counting (byte-identical to the tree-walker; caveat: count is GLOBAL not per-loop — conservative, latent fidelity gap for a future >100k-back-edge multi-loop bytecode flow, per-loop refinement is the follow-up). `compileToBytecode` cache re-keyed flow-NAME-only → `WeakMap<AstNode,…>` (per-compilation isolation — also removes the bench-runner cross-`main` pollution). +5 tests; hub-verified (suite 3502 + benchmark probe). Implemented in a spawned session, verified + committed here.

**Still parked (owner-gated / not started):** 0034 `move`/`USE_AFTER_MOVE` wiring (new syntax — needs owner design); 0031 **34B** route-handler auto-taint (breaking — strict-profile-gated, needs routeDecl wiring); 0035 trit-fold reachability + 0025 governance-T-MAC decision path (security-critical governance decision path); 0033 WASM handles/WasmGC (ABI); GAP-2 (CLI: expose effectful `secure flow main` to `--invoke` — fuzzy, "document or expose"). **Item 4's clear half (GAP-4 forEach) + 0031-34A SHIPPED above.**

## WORKER R&D RESULTS 2026-06-19 (bridge 0036–0041 — worker session drained the queue; 0040 HELD)
The R&D worker ran the six tasks the hub filed this session. **0036/0037/0038/0039/0041 DONE** (done-reports
committed `5e7b9e4`/`158dc68`/`48e85fe`); **0040 HELD** (DbC/formal-verification — worker respected the owner
"do not run yet"). All re-ran the hub harnesses (don't-trust-check) + extended them; each self-corrected at
least once (recorded). Nothing built into production (owner-gated). Summaries:

- **0036 — AOT adoption.** Re-verified D1–D5 (none refuted) + independently re-derived D2/D4. NEW proof
  `aot-classical-tricks.mjs`: const-fold + propagation + branch-fold + DCE = **1.64× wall-clock, 7.1× fewer
  AST nodes, 2.1× fewer taken-path dispatches**, byte-identical over 50k random inputs. Source-verified that
  LogicN has literal-const substitution (`staticConsts`) but **NOT** const-*expression* folding or
  branch-folding → **ADOPT #1/#2**. Build order: ①const-expr-fold+prop ②branch-fold+dead-arm-DCE
  ③trap-tail simplify ④small-pure-flow inlining ⑤cross-flow LTO ⑥PGO(defer). (Self-correction: dead-arm
  DCE is a code-size/cache/lowering-speed win, NOT a per-call traversal win — a correct walker never walks
  the dead arm.)
- **0037 — trit graph-query engine** (⚠ "Mesh" rename pending; also flags `tri-encription/bench/meshql.mjs`).
  Confirmed for/where branchless filter is **MODEST** (≈1.0× ± noise; inverts for expensive f). **Proved the
  SEPARATE-PRESENCE-CHANNEL correctness fix end-to-end** (trit-0 as a filter mask aliases 0=INDETERMINATE → a
  fail-open/read bug; a distinct presence bit restores distinguishability + stays fail-closed) → **adoptable
  trick #1 (correctness, do first; cheap — one bit lane).** Dynamic-`where` = runtime mask over columnar
  layout, taken path (NOT superposition = 2–4× work). Precompute envelope MEASURED: WIN small+dense+repeated
  all-pairs; LOSE sparse/single-source/large; O(N²)/relationship memory.
- **0038 — i32 fail-open.** INDEPENDENTLY confirmed (11/11) + fix-spec'd. **Hub already shipped the fix**
  (`3596fb5`+`490c492`, value-propagation). Worker's recommended design is **cleaner**: make `i32R` THROW at
  the op (trap-at-point) — then a trap can never reach a downstream op or assignment, so the message
  divergence + the `isCheckedTrap` checks both become unnecessary, and all tiers align to the bare trap-kind.
  → **the throw-at-op refactor is the recommended follow-up** to my value-propagation fix.
- **0039 — benchmark alignment** (SPEC; production edit owner-gated). Unify matrix-multiply to **n=32 for ALL**
  (tree-walker cap; unit `mul-adds/s`, N=32768); tri-logic = every runtime `runBulkTri(100000)` (`trit-ops/s`);
  data-query = one query `filterAndCount` at **N=2000** (fix the `logicnOpsPerRun=1000` undercount). Model
  harness proves the unit logic + that it introduces no nbody-class false win. **Ready for the hub/owner to apply.**
- **0041 — memoization.** Win/loss envelope: **5.27× on repeated/pure**, **1.77× SLOWER + unbounded memory on
  unique**, cold = full price, content-addressed store 4.62× for hot static, pure-only/PII preserved (0 leaks).
  Verdict: **DON'T build by default** — the shipped whole-flow LRU already captures most of the win; the
  sub-expression tier earns its keep only for a profiled hot pure sub-result recurring across whole-flow args.

**Answer to "what R&D is on hold / unlockable":** **0040 (DbC + formal verification) is the only HELD R&D
task** — unlock by owner go (verify-before-build: ~80% likely already shipped). Everything else in the worker
queue is DONE. Owner-gated PRODUCTION builds (separate from R&D-worker tasks) still pending a steer: 0036
const-fold/DCE adoption (build order above), 0037 presence-channel + tricks, 0038 throw-at-op refactor, 0039
benchmark re-author (spec ready), 0031-34B, 0025/0035 governance decision-path, `move` syntax, WASM handles.

## Shipping-readiness / unblock map (what gates the *application* of the proven work)
1. **Owner-gated (production read-only — the big bucket; batch applied per owner Go 2026-06-18/19, see APPLY PHASE above):**
   - **0032 liveness hazards** — **✅ SHIPPED** `a728e44`+`a9c4ebd`+`264723a` (incl. the sync fast-path completion).
   - **0033** — crypto hygiene **✅ SHIPPED** `5c1f846`; `static-memory-pool` generation tag **✅ SHIPPED** `692e62d`; WASM handles/WasmGC for the intra-module gap — still parked (ABI).
   - **0031** `tainted` param (34A/34B); **0034** borrow-checker KB→non-goal **✅ SHIPPED** `08d6905` (the `move`/`USE_AFTER_MOVE` wiring still parked); **0035** wire the trit-fold into live reachability; **0025** governance-T-MAC decision path; GAP-2/GAP-4 engine fixes (parked).
2. **HW-gated (EXCLUDED-until-silicon):** all photonic latency/energy numbers (0028, governance-T-MAC, linear-flatten on a real T-MAC); real QRNG (IDQ Quantis); a hardware TEE; ARM-MTE/CHERI (declined — no silicon, emulate the idea via gen-tags).
3. **Env/runtime-gated:** **X1** — that the shipped tiers physically *dispatch* through the proven ops (the standing "proven-semantics ≠ proven-live-dispatch" gap; recurs in 0014/0021/0022/0023/0024/0032) — needs the 0014 fidelity harness wired into the live tiers. G3 (−6.0 Hubbard under pinned `uv.lock` WSL ffsim). Any perf number needs a named machine + reproducible bench.
4. **Solver-gated:** 0024's 2 div/rem value identities (BV-division SMT limit) — not load-bearing.
5. **External-cited (re-fetch before publishing):** the cross-language interpreter-speed numbers (§4 of the tree-walker doc, tier-ASSERTED — the research pass died on the spend limit) + the literature figures in the coverage index (vec2text, FHE, QKD attributions).

**Highest-leverage unblock:** the owner lifting the read-only gate (ship the proven-fix batch) and/or **wiring the 0014 harness into the live tiers — that single move closes X1**, the most-recurring blocked item across the whole corpus.

## The recurring honest theme (recorded — record-everything)
Every photonic/tri "game-changer" proposal oversold (O(1), `ntt_mul`, matrix-exp shortest-path, "3 parallel CPUs", quantum-erasure GC) — each audit **stripped the overclaim and kept the genuine kernel**. The real, proven wins are all **CPU-side / algebraic / fail-closed**: governance-as-min-fold, flat SoA AST, de-coloring the interpreter, ternary tombstoning, trust-trit path-authorization, and the degrade-to-DENY self-heal.

## See also
`logicn-memory-safety-model.md` · `logicn-tree-walker-speed-and-photonic-governance.md` · `logicn-prove-own-maths-roadmap.md` ·
`logicn-formal-verification-direction.md` (0024 Z3) · `logicn-tritmesh-meshql-shortest-path-parked.md` · `logicn-roadmap-autonomous-queue-2026-06-17.md` · the `_session-bridge/done/00NN-*.done.md` reports (authority).

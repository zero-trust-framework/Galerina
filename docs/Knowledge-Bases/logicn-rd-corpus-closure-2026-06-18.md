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

## Shipping-readiness / unblock map (what gates the *application* of the proven work)
1. **Owner-gated (production read-only — the big bucket; now being applied per owner Go 2026-06-18):**
   - **0032 liveness hazards** — recursion-depth guard + loop/forEach fail-closed: **✅ APPLIED `a728e44`**. Remaining: `checkDeadline()` inside loop bodies; propagate enforcer+capabilityHost into sub-interpreters (close the gate-drop).
   - **0033 crypto** — `fill(0)` derived keys, `timingSafeEqual`, live `isRevoked`; WASM handles/WasmGC for the intra-module gap; the `static-memory-pool` per-allocation **generation tag** (use-after-free-via-reuse).
   - **0031** `tainted` param (34A/34B); **0034** downgrade the borrow-checker KB to a non-goal + wire `move`/`USE_AFTER_MOVE`; **0035** wire the trit-fold into live reachability; **0025** governance-T-MAC decision path; GAP-2/GAP-4 engine fixes.
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

# LogicN — % completion audit + roadmap (2026-06-25 **v2**)

**Verdict:** **~88% shippable / ~62% full-vision.** Ticks up from the morning v1 (~87/~61) on the session's
**faithful Int64 WASM lowering** reaching a validating fused module. Supersedes
[logicn-percent-audit-roadmap-2026-06-25.md] (v1). Honesty bar held throughout — and this v2 explicitly
folds in the **honest cross-language benchmark** (LogicN does NOT win on raw speed and is not designed to).

## Headline deltas since v1

- **Faithful Int64 WASM lowering — a fused Int64 module now VALIDATES under wabt + runs exact** (Step 0 +
  Step 1 interpreter + Step 2b emitter: i64 helpers, routing, return/local valtype, literal `i64.const`
  origination, foldToInt-R2 guard). Worker cross-verified walker≡WASM≡exact-BigInt (rd-0113b 12/12). The
  `LLN-NUMERIC-001` gate still **stays closed** (lift is owner-gated after the full differential).
- **Untrusted Governed Lane** documented + diagrammed ([untrusted-governed-lane.md] +
  `docs/diagrams/logicn-untrusted-governed-lane.svg`).
- **R&D 0100–0113 paper-ranked: 0 papers** (6 defensive-pub, 8 no) — the posture holds
  ([logicn-rd-paper-ranking-0100-0113-2026-06-25.md]).

## Cross-language benchmark — the honest standing

**LogicN does not win on raw speed, and it is not built to.** It is a governance-first, fail-closed
interpreter; native/JIT languages beat its *governed* tier by 3–6 orders of magnitude, exactly as the
anti-inflation truth-audit predicts (Node is 1549×–4554× the governed tree-walker). Per comparable compute
benchmark — **winner / runner-up / where LogicN's *governed* tier landed**:

| Benchmark | Winner | Runner-up | LogicN (governed) | Gap (winner ÷ governed) |
|-----------|--------|-----------|-------------------|--------------------------|
| compute-mix | nodejs 133.0M | rust 129.8M | **last** (292) | ~456,000× |
| arithmetic-threshold | rust 1.6B | rustAvx2 1.6B | **last** (1.9k) | ~840,000× |
| six-digit-guess | rust 77.4M | rustAvx2 72.8M | **last** (1) | huge |
| record-allocation | rust 1.2B | rustAvx2 1.2B | **last** (255) | ~4.7M× |
| governance-cost | rustAvx2 897.5M | rust 887.7M | **last** (740) | ~1.2M× |
| mandelbrot | rust 21.2M | nodejs 6.2M | **last** (1) | huge |
| binary-trees | nodejs 73.0M | rust 20.3M | **last** (25) | ~2.9M× |
| nbody | nodejs 3.3k | python 38 | **last** (2) | ~1,650× (matches the truth-audit's 1549×) |
| low-memory | rustAvx2 614.1k | rust 129.7k | **last** (15) | ~41,000× |

**Reading it honestly:** the WASM tier (`wasm`) sits above the governed tree-walker but still below
native; the i64 work this session *extends* that WASM tier (it was i32/f64-only) but these benchmarks are
i32/f64, so the numbers are unchanged. **The `logicnPassive`-mode "#1" rankings** (fibonacci, matrix,
nbody, json-parse, crypto-ops, text-html) **are NOT real wins** — they are the incomparable-unit artifacts
the truth-audit's unit-alignment flags (different workload/unit than the other runtimes), and presenting
them as speed wins would be exactly the inflation the `overclaim-phrases` lint forbids. **LogicN's value is
the governance** (fail-closed K3, signed admission, deny-by-default), not throughput; speed is a known,
accepted cost of the governance-first design.

## Subsystem breakdown

| Subsystem | Shippable | Full-vision | Headline |
|-----------|-----------|-------------|----------|
| Compiler + numeric | **90%** | **64%** | i32 trapping arithmetic end-to-end; **Int64 now lowers faithfully to validating WASM (param + literal)**; gate stays closed pending the full differential + lift |
| Runtime + interpreter | 88% | 66% | tree-walker ≡ bytecode ≡ real-WASM byte-identical (i32 + now Int64 param/literal); liveness fully fail-closed |
| Governance + value-state | 90% | 68% | K3 unknown→DENY; taint/secret/embedding/protected + affine passport; tier-floor; fuse-loader admission |
| Crypto + TMF + secrets | 90% | 72% | binary crypto (SHA-256 + hybrid Ed25519+ML-DSA-65); TMX-256 + inclusion proofs; env.tmf; secrets{} obligation |
| Web + ext + substrate | 88% | 42% | web-* = enforced contract + stub-guard only; photonic/substrate honestly emulated (`executedNatively=false`) |
| Benchmarks + CI + devtools | 90% | 68% | honest harness (anti-inflation truth-audit); 8 enforcing CI lints + mutation audit; **lln-astshape** dev tool |

## Roadmap

### NOW
- **Finish the Int64 gate-lift chain** (the active big-rock): worker folds the literal slice into rd-0113b →
  complete 0014 Int64 differential passes non-vacuously; Step-2 type-checker tightening (mixed
  Int+Int64→Int64 contagion @type-checker:883; fail-closed Int-bodied-Int64-init reject @:414); the rare
  bare-`return <literal>` threading. **Then owner-gated lift of `LLN-NUMERIC-001` for Int64** (UInt64 stays gated).
- **Wire the SEC-002 mutation audit + the full suite into `conventions.yml` CI** (still local-only).
- **#34: real ML-DSA-65 default `.lmanifest` signature**; resolve the 2 Hardened-Border drifts.

### NEXT
- **UInt64** (its own `u64-arith.ts` + unsigned `div_u`/`lt_u`/`extend_i32_u`) — then lift it too.
- **Extend the 0014 differential** to strings/arrays/records/floats/Option/Result across all three tiers +
  the 6-component-tuple slice.
- web-* lead pair (`logicn-web-render` + `logicn-web-state`); .tmf slice 4; drive report-only lint baselines to 0.

### LATER (HW-gated / completeness)
- Float32-faithful + bit-faithful Decimal emission. Revocation trust-anchor rotation / k-of-n threshold.
  Photonic emulator calibration vs a named PIC (#102-106). .lcache signed compile-cache sidecar.

## Honesty-bar attestation
Held. Crypto stays digital; no overclaim phrases (lint enforcing + green); photonic/quantum mark
non-native; the benchmark section above **refuses the `logicnPassive` "wins"** as incomparable artifacts and
states plainly that native languages are orders of magnitude faster than LogicN's governed tier. **0 papers**
across the full 0001–0113 corpus. `shippable` = wired + tested + fail-closed at build-production.

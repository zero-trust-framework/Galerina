# % Completion audit + full benchmark table (2026-06-25, post security-hardening session)

Refreshes the v2 audit after this session (Int64 lift, parser/ingestion/SSRF/BOM/VALUESTATE-006 hardening, 2
threat-models, scanner + allowlist-audit). Headline unchanged in magnitude: **~88% shippable / ~63% full-vision**
— this session raised the *security posture* (several real exploitables closed) more than the feature %.

## % completion by module

| Module | Shippable % | State + this session's delta | Top remaining |
|---|---|---|---|
| **Compiler core** (lex/parse/typecheck/value-state/effect/gov/emit/interp) | **~90%** | mature; hardened this session (parser-DoS, ingestion-DoS, BOM, SSRF redirect, VALUESTATE-006 leak) | #36 effect-alias smuggle + signed-stub; WASM emitter gaps for string/record workloads |
| **Numeric types** | **~78%** | Int/Int8-64 + overflow traps ✅; **Int64 gate LIFTED** | UInt64 (needs u64-arith); Float NaN fail-open + Decimal-is-f64-wrong (#33) |
| **Runtime / App-Kernel / Tower (admission)** | **~85%** | signed-WASM admission, fuse-loader, revocation solid | #102-106 WASM isolation aspirational; manifest-verifier inconsistency (#36 H3/H4) |
| **Crypto / secrets** | **~83%** | ext-secrets-tmf (+manifest validator), ext-tmf slices 1-3, attestation | hybrid-PQ sig treated-unsigned by fuse (#36 H3); ML-DSA #34 finish |
| **Substrate / photonic** | **~60% full-vision** | governance + self-check (Freivalds/No-Coercion/ToleranceWitness) ship; **emulator-level (Rung-2)** | real PIC hardware (#102-106, TRACK) |
| **K3 governance / effects / tier** | **~85%** | three-valued (vAnd=min), tier-floor, effects; plain-flow escape fixed | effect-alias smuggle (#36 C1) |
| **Graph / devtools** | **~90%** | scanner hardened, audit tools (allowlist-sensitive added), **border 93/0** | #149 CI fail-closed unwired (last step) |
| **Examples / docs / KB** | **~82%** | KB comprehensive; BOM + VALUESTATE-006 example breakage fixed | Decimal-wrong examples + multi-line-intent + stale-rule examples (#37) |
| **Web / DB packages** | **stubs (by design)** | intentional deny-by-default tripwires | finish only when drivers land |
| **Benchmark suite** | **~85%** | comprehensive cross-language; truth-audited units | WASM-compile gaps for string/record workloads |

## Full benchmark table (production-ceiling scoreboard, 2026-06-25)

`graph`/runner truth: **Winner = fastest PRODUCTION runtime** (the 3 `⟨interp⟩` Stage-A diagnostic tiers can't
win). **WASM ▶ production is the shipping cost**; governed ⟨interp⟩ is the worst-case diagnostic, NOT shipping.

| Benchmark | 🏆 Winner (ceiling) | Speed | WASM ▶ prod: rank · ×slower |
|---|---|---|---|
| fibonacci-recursive | **WASM ▶ production** | 16.5K/s | **🥇 1st/5 · won** |
| hardware-targets | **WASM ▶ production** | 42.65M/s | **🥇 1st/4 · won** |
| six-digit-guess | Rust (generic) | 77.65M/s | 3rd/5 · 2.1× |
| record-allocation | Rust AVX2 | 1.17B/s | 3rd/5 · 2.1× |
| gpu-compute | Rust AVX2 | 1.17B/s | 4th/6 · 2.4× |
| matrix-multiply | Deno WebGPU (RTX 2060) | 1.62B/s | 5th/6 · 3.7× |
| low-memory | Rust AVX2 | 6.07B/s | 4th/5 · 14× |
| collection-pipeline | Rust AVX2 | 13.24B/s | 3rd/5 · 61× |
| governance-cost | Rust AVX2 | 902.18M/s | 3rd/5 · 306× |
| compute-mix / arithmetic-threshold | Node.js / Rust AVX2 | 129M / 1.57B | WASM compile failed * |
| call-chain / nbody / binary-trees / json-parse / mandelbrot / spectral-norm / tmf-container / tower-of-hanoi | Node.js / Rust | — | no WASM build (string/record/recursion gap) * |

**Winner tally (production ceiling):** Rust AVX2 ×6 · Node.js ×5 · Rust (generic) ×5 · **WASM ▶ production ×2** ·
Deno WebGPU ×1. Excluded (not unit-aligned): tri-logic, data-query. *The `WASM compile failed` / `no WASM build`
rows are the real engineering gap — the emitter doesn't yet lower string/record/some-recursion workloads to WASM
(they fall back to the interpreter). A full run is refreshing these numbers.

## Honest read
LogicN **trades raw speed for governed trust** — that is the design, not a regression. Where the emitter produces
WASM, it is **competitive** (won 2 benchmarks outright at native speed; within 2-4× of the Rust ceiling on several
more). The **governed interpreter** tiers are 1,000-45,000× slower but are **diagnostic** (Stage-A worst-case),
not the shipping path. The genuine perf work is **closing the WASM-emit gaps** for string/record/recursion-heavy
workloads (so more benchmarks have a production WASM row at all), not optimizing the interpreter. LogicN beats the
Python floor on 2/13 unit-aligned interpreter benchmarks today.

*Source: `logicn-devtools-benchmarks` `compare.mjs` over `results/latest.json` (2026-06-25); supersedes the v2
audit's table.*

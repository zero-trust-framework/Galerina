# LogicN — % completion audit + roadmap (2026-06-25)

**Verdict (adversarially verified):** **~87% shippable / ~61% full-vision.** Honesty bar HELD throughout
(binary crypto + LLN-SUBSTRATE-001, degrade-only K3, no free-O(1)/instant/FTL, `shippable` = wired+tested+
fail-closed and NOT spec-only). Produced by a 6-subsystem survey + an adversarial inflation critic
(workflow `wvvuh8kiu`, 7 agents); every headline % is grounded against the live tree + the fresh
all-green sweep below. Supersedes [logicn-percent-audit-roadmap-2026-06-24-v2.md] (~84%/~63%): shippable
ticked up from the session's fail-closed wins; full-vision held (new surface = new caveats).

## Fresh full-sweep results (this date, all captured live)

| Sweep | Result |
|-------|--------|
| **Graph** | project 5263 nodes / 5926 edges · kb 149 orphans / 69 broken links · Hardened Border **91 PASS / 2 drift** (logicn-ext-bridge-cpp, logicn-tower-citizen — pre-existing known) |
| **Tests** | core-compiler **3813/3813** · sentinel-memory **34/34** · tower-citizen **267/267** = **4114 / 0 fail** |
| **Security audit** | **every ENFORCING gate 0 violations** (tier-boundary · production-blockers · name-collisions · diagnostic-doc-drift · overclaim-phrases · graph-integrity · web-stub-guard · gate-injection · NUL-hygiene) · **SEC-002 mutation 17/17 KILLED, 0 survived** (cert-pin, fuse gates 1/2/2b, i32 overflow traps, secret-egress sinks all genuinely guarded) |
| **Benchmark** | truth-audit **PASSED** — cross-runtime correctness agrees on all 6 (nbody/mandelbrot/binary-trees/spectral-norm/tmf-container) · 14 unit-aligned · anti-inflation honest (Node 1549×/4554×/651× the governed tree-walker, no inflated wins) |
| Report-only baselines (non-enforcing, documented backlog) | diagnostic-codes 158 (V5 name-case 134) · lln-quality 105 (.lln retrofit) · doc-drift 28 · provenance 3 |

## Subsystem breakdown

| Subsystem | Shippable | Full-vision | Headline |
|-----------|-----------|-------------|----------|
| Compiler + numeric | 88% | 60% | i32 trapping arithmetic fully wired end-to-end; **scalar Int64 fail-CLOSED (correct, not yet executable)** |
| Runtime + interpreter | 88% | 66% | tree-walker ≡ bytecode ≡ real-WASM byte-identical (0014, i32 only); liveness fully fail-closed (per-loop + per-call + **global compute-step cap**) |
| Governance + value-state | 90% | 68% | K3 unknown→DENY; taint/secret/embedding/protected + **affine passport typestate**; tier-floor; fuse-loader admission gates |
| Crypto + TMF + secrets | 90% | 72% | crypto stays binary (SHA-256 + hybrid Ed25519+ML-DSA-65); TMX-256 + inclusion proofs; env.tmf; secrets{} obligation |
| Web + ext + substrate | 88% | **42%** | web-* = **enforced contract + stub-guard only (packages are stubs)**; photonic/substrate honestly emulated (executedNatively=false); TPL erase-on-trap |
| Benchmarks + CI + devtools | 90% | 68% | honest benchmark harness; 8 enforcing CI lints + mutation audit (local); graph + name-registry |

## Binding must-asterisk caveats (a buyer/auditor MUST be told)

1. **64-bit integers are not executable yet.** Scalar `Int64`/`UInt64` parse + type-check, but the compiler **refuses them fail-closed** (`LLN-NUMERIC-001`, error) rather than silently truncate 64→32. The checked `i64-arith.ts` + interpreter int64 dispatch ARE shipped + unit-tested, but are **unreachable in any real flow** (gate-closed) — their green tests prove the arithmetic in isolation, not an end-to-end Int64 program. The WASM emitter still emits no i64 bodies (`wat-emitter.ts:2989-2996`). i32 (trapping) + f64 are the only widths faithful end-to-end across all tiers.
2. **The DEFAULT (non-certified) `.lmanifest` profile emits PLACEHOLDER signatures** (`manifest-generator.ts:685-693`). Real hybrid Ed25519+ML-DSA-65 signing is wired and fires for the certified/production profile with a signing key — but the default-profile output is not a real signature. #34 ML-DSA over the digest is the standing finish.
3. **The web-* packages are STUBS.** What ships is the *enforced contract* (`governance/web-failclosed-contract.json` + `audit-web-stub-guard.mjs`, which blocks any impl that lacks its LLN-WEB-* acceptance tests) + reserved codes — NOT running XSS/redirect/gesture defenses.
4. **RD-0112 #8 R1 (trit-correct REJECT tombstone) is DEFERRED** — a design decision, not a fail-open: a compute-segment packed-trit block can't decode to REJECT via a bare `pool.free` without a pool API change (the segment fill is mandatorily 0xFF for i32). R2 (erase-on-trap) shipped. .lcache loader is spec-only (deferred to #34).
5. **The all-green evidence is LOCAL, not CI-continuous.** The SEC-002 mutation audit (17/17) and the full 4114-test suite run locally; neither is in `conventions.yml` yet (CI runs the build-free lints only). **This is the #1 NOW item.**
6. **2 Hardened-Border drifts** (logicn-ext-bridge-cpp omits node:crypto; logicn-tower-citizen omits @logicn/substrate-math + ml-dsa) — informational (`graph-all` always exits 0), owner-call to widen-allowlist vs treat-as-violation.
7. **Report-only lint baselines are >0 by design** (diagnostic-codes 158, lln-quality 105, doc-drift 28, provenance 3) — documented non-enforcing backlogs, not security failures.
8. Liveness caps are **deterministic step/iteration/depth counts only** — no wall-clock/resource deadline. Revocation/registry gates fire only when the host injects the predicate. Cross-flow secret/embedding propagation is intra-procedural (coarse fail-closed). Photonic/quantum results honestly mark `executedNatively=false` / `deterministic=false`.

## Roadmap

### NOW (close the loop on what already exists)
- **Wire the SEC-002 mutation audit + the full 4114-test suite into `conventions.yml` CI** (the load-bearing item — make green-everything continuous, not local; `grep -c mutation conventions.yml` = 0 today). Per-package install is the friction; a security-tier job is the fix.
- **#34: make the default `.lmanifest` profile emit a real ML-DSA-65 signature** (over the SHA-256 digest), retire the placeholder default.
- **Resolve the 2 Hardened-Border drifts** (widen the allowlists for the genuinely-needed imports, or treat as violations) so the border is 93/93.

### NEXT (the standing core-component builds)
- **Faithful i64 emitter — SUBSTANTIALLY DONE (Step 2b), short path to the Int64 gate-lift.** Status as of 2026-06-25 (verified plan `logicn-i64-lowering-plan-verified-2026-06-25.md`): Step 0 (shared `numeric-lowering.ts`) + Step 1 (interpreter literal-coercion + fast-tier fail-closed bail) + Step 2b emitter (i64 checked helpers, type routing, return/local valtype, **literal `i64.const` origination 3g/3h, foldToInt R2**) all SHIPPED. **A fused Int64 WASM module now VALIDATES under wabt + runs exact + traps** (`tests/wat-i64-milestone.test.mjs`); the worker cross-verified walker≡WASM≡exact-BigInt (rd-0113b 12/12, param slice; literal slice next off the 3g signal). **REMAINING before the owner-gated lift:** (a) the worker's literal-slice differential folds into rd-0113b → the complete 0014 Int64 corpus passes non-vacuously; (b) Step-2 type-checker tightening (mixed Int+Int64→Int64 contagion @type-checker:883; fail-closed Int-bodied-Int64-init reject @:414); (c) the rare bare-`return <literal>` threading through `emitBlockStatements` (fail-safe to walker today). Then remove `"Int64"` (only) from `BACKEND_UNLOWERABLE_SCALAR`. **UInt64 stays gated** (needs its own unsigned `u64-arith`).
- **RD-0112 #8 R1 design decision** (recommend `pool.freeNoScrub()` + bench frees via a trit-aware path) — then the recycled governance slot decodes to REJECT.
- **web-* lead pair** (`logicn-web-render` + `logicn-web-state`) when scheduled — every other web package is downstream of the render sanitiser gate + the state taint lattice; emit the reserved LLN-WEB-* codes.
- **Extend the 0014 byte-identical differential beyond i32** (strings/arrays/records/floats/Option/Result across all three tiers) + the 6-component-tuple harness slice.
- **.tmf slice 4** (ML-DSA-65 over the TMX-256 root) + drive the report-only lint baselines to 0, then drop `--soft`.

### LATER (completeness / HW-gated)
- UInt64 (its own `u64-arith.ts`, unsigned div_u/lt_u). Float32-faithful + arbitrary-precision Decimal emission (value-safe today via f64-widening, but not bit-faithful). Revocation trust-anchor rotation / k-of-n threshold (single static pin today). Photonic emulator calibration against a named real PIC (HW-gated #102-106). .lcache signed compile-cache sidecar. Regenerate the 3 stale provenance artifacts.

## Honesty-bar attestation
Held throughout. Crypto stays digital (node:crypto + @noble); no overclaim phrases (the lint is enforcing + green); photonic/quantum results honestly mark non-native/non-deterministic; benchmarks anti-inflate (Node is 1549×–4554× the governed walker — no inflated wins). The surveys are candid: they degrade their own headline numbers in their caveats. `shippable` here means **wired + tested + fail-closed at build-production** (several gates degrade to warning on dev/check); every must-asterisk caveat above is binding.

*Source: workflow `wvvuh8kiu` (6 subsystem surveys + inflation critic) + the fresh live sweep (graph/tests/security-audit/benchmark). The critic shaved overall shippable from a naive ~89 mean to 87 to reflect the spec-only/gate-closed surface bundled into the compiler-numeric (88, i64 reachable-blocked) and web-ext (88, contract-not-impl) headline %s.*

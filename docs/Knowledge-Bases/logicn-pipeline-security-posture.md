# Compile-Pipeline Security Posture — math-secure / zero-trust / quantum-resilient (per stage)

> **Owner question (2026-06-18):** with the WASM tier now mathematically hardened (i32 strict-trap,
> `cfb72f9`), can we enhance WASM's security/efficiency, and is **every stage before WASM**
> mathematically secure, zero-trust, and quantum-resilient? This is the grounded audit. Companion:
> [[logicn-architecture-layers]] (the 6-layer map), the 0014 fidelity-harness design, [[logicn-quantum-resistance-posture]].

## The honest framing (what each axis even means per stage)
The pre-WASM stages are **analysis passes** — they read the AST and produce diagnostics + the GIR.
They do **no cryptography**. So per axis:
- **Mathematically secure** = deterministic, no undefined behavior, sound value semantics, **fail-closed** on anything unknown (no "lying abstraction" — never a wrong value presented as right).
- **Zero-trust** = deny-by-default, no ambient authority, every boundary verified, `unknown → deny`.
- **Quantum-resilient** = for analysis stages this is **mostly N/A** (nothing to break). It only bites where a stage feeds the **crypto trust chain** — the hashes (SHA-256) and the signature (Ed25519 → ML-DSA-65). So "is the pipeline quantum-resilient?" reduces to **two facts**, below.

## Per-stage verdict
| Stage | Math-secure | Zero-trust | Quantum-resilient | Notes |
|---|---|---|---|---|
| **1 Lexer/Parser** | ✅ deterministic; DoS limits; rejects bitwise crypto ops (`LLN-PARSE-001`) | ✅ reserved-keyword table immutable; `pure` can't declare effects (syntactic) | n/a (no crypto) | Sound. |
| **2 Semantic (types/value-state/taint)** | ✅ K3 three-valued; empty `permitted_effects {}` = deny-all | ✅ taint can't reach a sink un-cleaned; secrets can't egress | n/a | Sound. |
| **3 Governance core (effects/K3 gate/floors)** | ✅ no-coercion theorem (Unknown can't become Allow), proven to depth-4 | ✅ deny-by-default; unregistered stdlib ops require broad effect | **enforces it** — `LLN-CRYPTO-PQ-001` requires PQ signing (`crypto.sign.hybrid`/`mldsa65`/`slhdsa`) in production profiles | The pipeline *demands* PQ crypto here. |
| **4 GIR + tiers** | ⚠️ **the frontier** — see WASM below | ✅ lean only when EffectFree ∧ taint-clean (monotone) | hashes = SHA-256 (Grover-OK ✓) | GIR is immutable + hashed. |
| **5 Runtime (Tower/fuse-loader)** | ✅ atomic trap before next instr; clean rollback | ✅ closed-allowlist imports; hash+sig+capability gates; zeroize | sig verify accepts Ed25519 **or** ML-DSA-65 | The verify path is PQ-ready; the *build* path isn't (↓). |
| **WASM emitter (the tier itself)** | ⚠️ **two real gaps (below)** | ✅ only pure/effect-free flows get a real body; rest stay `unreachable`; sandboxed linear memory | wasmHash/behavioralFingerprint = SHA-256 ✓ | This is where the work is. |

## The quantum-resilience answer, in two facts
1. **Hashing is already quantum-resilient.** Every fingerprint in the trust chain — `sourceHash`, GIR hash, `wasmHash`, `behavioralFingerprint`, CFG fingerprint — is **SHA-256**, whose Grover-reduced security (≈128-bit) is fine. No change needed. ✅
2. **The one Shor-breakable primitive is the build-path signature.** `LLN-CRYPTO-PQ-001` *requires* a post-quantum signature in production, and the fuse-loader *verifies* Ed25519-or-ML-DSA-65 — but the **build path signs standalone Ed25519** (`logicn.mjs`), so there's a gap between what the language mandates and what the toolchain emits. **Closing it = ML-DSA-65 over the SHA-256 digest + hybrid Ed25519 = owner item #34.** This is the *only* genuine PQ gap in the entire pipeline.

> Net: the pipeline is quantum-resilient **except** the build signature (#34). Everything else is either non-crypto analysis or already SHA-256/PQ-ready.

## The mathematical-security frontier = the WASM emitter (two concrete enhancements)
**(a) Integer overflow — IN PROGRESS.** Slice 1/3 shipped (`cfb72f9`): walker + bytecode VM trap on overflow/div0. Slice 2/3 = the emitter's unified checked-arith helpers (`$lln_checked_add/sub/mul_i32`; div/rem stay native — they already trap on div0 + `INT32_MIN/-1`). Slice 3/3 = the 0014 harness certifying walker ≡ bytecode ≡ WASM.

**(b) The silent `(i32.const 0)` fail-opens — the #128-sibling, NOT yet built.** `wat-emitter.ts` has ~13 sites that emit a **wrong value** instead of failing when the emitter can't lower something: unresolved name (`753`), unresolved member (`796`), unknown op (`832`), unknown unary (`840`), empty block (`1072`), empty match (`1089`), no default arm (`1142`), unhandled node kind (`1176`), unresolved block expr (`1224`), default return (`1979`), Phase-25 empty/no-AST/no-info bodies (`2329/2336/2346`). **Only line `1655` (statements, #128) traps; every expression-level case is fail-OPEN.** A wrong `0` flowing into a governance predicate is exactly the lying-abstraction class we just eliminated for overflow. **Fix: emit `(unreachable)` (fail-closed trap) at these sites instead of `(i32.const 0)`** — so the WASM tier declines loudly and falls back to the walker, rather than silently computing a wrong value. This is the highest-leverage WASM *security* enhancement.

## Efficiency enhancements (WASM)
- **The lean→WASM router** — the native-speed win for pure flows; gated on the 0014 harness (slice 3/3). The biggest efficiency lever, and it's safe *because* the harness proves byte-identity.
- **Unified checked-arith helpers** (chosen over inline `if`) — smaller binary → faster load + verification, single auditable trap point.
- **SIMD** — the emitter already supports `v128`; tensor/vector flows could lower to SIMD (future, measure first).

## Prioritized enhancement list
| # | Enhancement | Axis | Status |
|---|---|---|---|
| 1 | i32-overflow-trap **emitter** (slice 2/3) | math-secure (WASM) | next — designed, owner-approved |
| 2 | **0014 fidelity harness** (slice 3/3) | math-secure + efficiency-enabler | next — designed |
| 3 | **Harden the ~13 expression-level fail-opens** → `unreachable` (the #128-sibling) | math-secure (WASM) | **buildable now, not gated** — highest-leverage security fix |
| 4 | **ML-DSA-65 build signing** (#34) | quantum-resilient | owner-gated (needs offline custody) — the *only* real PQ gap |
| 5 | lean→WASM router | efficiency | gated on #2 |
| 6 | CFG fingerprint beyond effects-only (#3) · runtime-observed surface (#102-104) | zero-trust (tamper/observe) | Phase-5 deferred |

**Bottom line:** the pre-WASM stages are already math-secure + zero-trust by construction (deterministic, deny-by-default, fail-closed); their only crypto touchpoint (SHA-256 hashing) is already quantum-resilient. The real work is all in the WASM tier — finish the i32-trap (1,2), then **harden the silent fail-opens (3)** — plus the one standing PQ gap, ML-DSA-65 build signing (#34). Item **3 is buildable now and not owner-gated.**

---

## 2026-06-18 — cycle-end audit update (WASM emitter pass COMPLETE)

The WASM-emitter math-security frontier from the audit above is now **closed**:
- **i32 overflow → TRAP** across all three tiers (walker `cfb72f9`, bytecode VM `cfb72f9`, WASM emitter checked-arith helpers `6542bae`), single source of truth `i32-arith.ts`. Mul uses a magnitude-guarded fast-path (`(a*b)|0` for |operands| ≤ 46340; BigInt only for genuinely-large operands) — recovers the BigInt-per-multiply perf cost while staying byte-identical.
- **Silent fail-opens hardened** (`8450174` + `b01f713`): all 10 genuine "emitter-cannot-lower" sites now `(unreachable)` (fail-closed → decline to walker), incl. `emitBlockLastExpr:1277` which the first pass missed (a double-quoted `return`). The legit void/empty/exhaustiveness defaults (`;; return void`, `;; empty block`, `;; no default arm`) are correctly left as `(i32.const 0)` — they are NOT fail-opens (exhaustiveness is guaranteed by the Phase-10 type-checker).

**A 5-agent adversarial audit verdict (2026-06-18):** the enforcement core is **hardened + zero-trust/fail-closed** across all three tiers; `1277` was the single residual hole (now closed). The audit also caught + reconciled two of its own sub-reports being STALE (they claimed WASM slice 2/3 "not built" / "~13 fail-opens" — git `6542bae`/`8450174` show shipped). **No silent-wrong-value path remains in the WASM tier.**

**Genuine residual gaps (defense-in-depth, by-design deferrals — not active holes):** the 0014 fidelity harness (slice 3/3) is NOT built (the gate for the lean→WASM router); ML-DSA-65 build-path signing (#34, owner-gated — the one PQ gap; hashing is already SHA-256/Grover-OK); trust-anchor pinning (rogue-signer); recursion-depth bound (8) documented but not adversarially measured; plugin-sandbox is a validator, not process isolation.

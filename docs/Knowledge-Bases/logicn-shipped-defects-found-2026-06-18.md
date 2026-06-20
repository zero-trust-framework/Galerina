# Shipped-Code Defects Found by Adversarial R&D — hub-verified ledger (2026-06-18)

> The adversarial R&D loop (jobs 0014–0022) surfaced a set of "shipped-code defects." This is the
> **hub's code-grounded verification** of each — with **corrected severity**, because two were
> over-stated as active exploits when the code shows they are latent or defense-in-depth-covered.
> That correction is the point: a finding is only as good as its verified blast radius. Companion:
> [[logicn-pipeline-security-posture]], [[logicn-security-audit-2026-06-16]].
>
> **Headline:** **none of these is an active, exploitable hole in the currently-shipped hub runtime.**
> Three were fixed this session; one is latent (Phase-2 gate); two are design-gated; two are in the
> owner-gated quantum-bridge repo.

## Ledger
| # | Finding | Location (verified) | Hub verdict | Severity | Status |
|---|---|---|---|---|---|
| 1 | Walker `INT32_MIN` unary-neg divergence + `-0` leak vs other tiers | `interpreter.ts` BINARY_DISPATCH / unary | **REAL** cross-tier divergence | was med | ✅ **FIXED** this session — `i32NegChecked` traps `-INT32_MIN`; `\| 0` canonicalizes `-0→0` (`cfb72f9`) |
| 2 | Silent `(i32.const 0)` fail-open — `emitBlockLastExpr` unrecognized block tail | `wat-emitter.ts:1277` | **REAL** fail-open (a wrong 0 into a governance predicate) | medium | ✅ **FIXED** this session — now `(unreachable)`, fail-closed (`b01f713`) |
| 3 | Zeroize-on-trap data-remanence | `tower-runtime.ts:98` (no try/finally, trap returns early); `plugin-sandbox.ts:58-60` (`erase()` = boolean no-op) | **REAL structurally, but LATENT** — `PluginSandbox` holds **no secret buffer** (Phase-1 `execute()` is a stub: "real dispatch in logicn-ext-bridge-*"). No secret memory exists to remain today. | latent (high **when Phase-2 lands**) | **OPEN — hard Phase-2 prerequisite.** The i32-overflow traps shipped this session make mid-exec traps more common, so fix the LOAD→TRAP→ERASE *before* Phase-2 wires real execution+buffers. |
| 4 | Deadline "fail-open" — interpreter caught the deadline throw + **continued** | `interpreter.ts:1505-1511` | **REAL fail-open PATTERN, but DEFENSE-IN-DEPTH-COVERED** — the governed effect was still blocked downstream by `capabilityHost.check()` (fail-closed, `capabilityHost.ts:218-225`, called by `execute()` at `:241`). **Not an exploitable bypass.** | was med → low | ✅ **HARDENED** this session — interpreter now fail-closes too (returns the host's `err` shape, one layer earlier). Fail-closed at every layer. |
| 5 | `MAX_ITERATIONS` (100k loop guard) lives in only one tier | `interpreter.ts:1187` (`LLN-RUNTIME-005`, walker only) | **REAL** — bytecode VM / WASM rely on the (unbuilt) compute-gas | medium | ✅ **LOOP-CAP CLOSED CROSS-TIER (2026-06-20).** The cap now THROWS fail-closed in the walker (`interpreter.ts:1273-1278`/`:1311-1313`), `SyncInterpreter:436`, AND the bytecode-VM (`bytecode-vm.ts:351-363`) → `result:'error'`; a recursion-depth guard was added too (`callDepth`/`maxCallDepth`). Locked by `fidelity-differential.test.mjs:223`. **Still design-gated:** only the WASM/Wasmtime tier relies on the (unbuilt) compute-gas/fuel (R&D 0022-A) for the *unified* budget. |
| 6 | `max_instructions_ceiling` parses but is never enforced | `parser.ts:3434` (parsed in `enforced_limits {}`); no enforcer | **REAL** parse-without-enforce | medium | **OPEN — design-gated** on R&D 0022-A (same gas mechanism). |
| 7 | `ffsim.__version__` probe doesn't exist in ffsim 0.0.80 → reports "unavailable" | quantum-bridge `env-detect.ts:25` | as R&D reported (NOT hub-verified — separate production repo) | high (blocks Phase-2) | **OPEN — owner-gated** (production-repo gate). One-line fix (`importlib.metadata.version`). |
| 8 | Op-enum mismatch — golden op not in `QuantumOp` enum | quantum-bridge worker/enum | as R&D reported (NOT hub-verified) | high (gate would reject its own golden) | **OPEN — owner-gated** (production-repo gate). |

## What this says about the project (the real point)
The adversarial loop is doing exactly what it should: **catching the framework's own conformance + security breaks before they ship downstream.** The *value* is the verified ledger — including the honest down-grades (3 latent, 4 defense-in-depth). The two genuine open *hub* items are **(3) zeroize-on-trap** (close it as part of Phase-2's real execution, with a `try/finally` LOAD→TRAP→ERASE + a real `TPLSimulator.erase()` wipe + a property test that traps mid-buffer-write and asserts zero entropy) and **(5)+(6)** the resource-bound enforcement (the R&D 0022-A compute-gas). Everything else is fixed, design-gated, or in the owner-gated quantum-bridge repo.

---

## 2026-06-20 — security-residual sweep (0032 / 0033 / GOV-003) — hub, verified 50/50 · 4708

A follow-up sweep of the R&D-flagged fail-open residuals. **Half were already fixed in production** (the R&D done-doc snapshots were stale — *verify-before-build* confirmed by reading the live tree, not the snapshot). Three were genuinely open and are now fixed + regression-tested.

| Residual | Source | Verdict | Resolution |
|---|---|---|---|
| **0033 use-after-free** (no scrub on free → recycled slot leaks prior tenant's COMMIT → governance gate fail-OPEN) | R&D 0033(b) | **REAL, open** | ✅ **FIXED** — `static-memory-pool.ts free()` REJECT-fills freed bytes to `0xFF` (i32 −1 = `TritState.REJECT`) → gate over a recycled slot collapses to DENY (fail-closed by construction). Complements the shipped generation/`assertLive` stale-handle guard. + scrub-on-free test. |
| **GOV-003 intermediate-binding rename** (`let e = user.email; return e` launders a denied field past the response-leak check) | audit residual | **REAL, open** | ✅ **FIXED** — `collectBodyFieldNames` builds a **precise** alias-carry map (direct field-access / identifier renames + alias-of-alias; opaque call results carry nothing → no false positives) and resolves a returned alias back to the field it carries. + 4 tests (catch rename / clean on redact-through-alias / catch alias-of-alias / no false-positive). |
| **0033(c) crypto secret-hygiene** (timing-unsafe compare + un-zeroized derived keys in the `.tmf` engine) | R&D 0033(c) | **PARTLY already done** | ✅ **FIXED** — `kemdem.ts` already routed compares through `crypto.timingSafeEqual` + `fill(0)`-zeroized derived keys (done at slice 3); `container.ts` integrity compares (`:148`/`:155`) now use the vetted `crypto.timingSafeEqual` too (was an already-constant-time hand-rolled XOR). Golden vectors byte-exact (engine 33/33). |
| **0032 Hazard-1 fail-open loop** | R&D 0032 | **ALREADY FIXED** (verified) | The cap now throws fail-closed in all 3 interpreter tiers → `result:'error'`; see ledger item 5. |
| **0032 Hazard-2 recursion → host OOM** | R&D 0032 | **ALREADY FIXED** (verified) | Catchable `callDepth`/`maxCallDepth` guard (`interpreter.ts:742,1868-2127`); locked by `fidelity-differential.test.mjs:223`. |
| **0032 fix#4 sub-interpreter gate-drop** (governed sub-flow ran ungoverned — capability + deadline enforcer dropped) | R&D 0032 | **ALREADY FIXED** (verified) | All 3 sub-interpreter sites now pass `this.enforcer, this.capabilityHost` (`interpreter.ts:851,860,2126`) → sub-flows inherit the gate. |

**Still owner-gated / large (out of residual scope):** 0033(a) intra-module WASM aliasing (MSWasm/WasmGC handle model); the 0032 compute-gas/fuel unified budget (R&D 0022-A) — also closes ledger items 5/6 at the WASM tier. Companion R&D record: `LogicN-R-AND-D/_session-bridge/done/0032-*.done.md` and `0033-*.done.md` (resolved banners).

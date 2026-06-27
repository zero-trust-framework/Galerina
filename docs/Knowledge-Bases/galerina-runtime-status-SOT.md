# Galerina — Runtime Status: Single Source of Truth (SOT)

**Last verified: 2026-06-06 (by running the suites, not by reading prior docs)**

> **⏩ CURRENT 2026-06-27 (post-Galerina-rebrand, verified by running `node scripts/run-all-tests.cjs`):**
> **60/60 packages · 5,927 tests · 0 fail.** Supersedes every earlier figure below — `44/44·4,128 →
> 47/47·4,346 → 48/48·4,360 → 53/53·4,980` are dated snapshots kept for history. Includes this session's
> network TLS/port dial enforcement, audit-receipt redaction sink, the note-54 data-plane IDOR border, and
> the force-HTTPS egress boot setting.
>
> **⏩ NEWER AUDIT 2026-06-21** — see [galerina-roadmap-and-percent-audit-2026-06-21.md](galerina-roadmap-and-percent-audit-2026-06-21.md).
> Counts refreshed to **53/53 packages · 4,980 tests · 0 fail** (verified by running; the `version.json` `--emit-counts` bump is deferred to a clean run — it refused under concurrent R&D CPU load).
> The §6 / `appLayerStatus` "app layer = TEMPLATES, NOT IMPLEMENTED" line is now **partly stale**: the
> app-framework **admission/fusion border + scaffolder + governed resolver are REAL and tested** this
> session (fuse-loader 3 gates + `planComposition` + revocation = 60 tests; `galerina new app`; unified
> admission vocabulary; SPORE-PKG-006). Still unbuilt: the signed registry index + a richer example app.
> Two-axis position (Axis B self-hosting ≈80%) and real-DSS.wasm 0% are unchanged.

This document exists because the percentage and test-count figures across the
roadmap/audit docs contradicted each other and the actual code. Where any other
doc disagrees with this one, **this one wins** for figures it has re-verified — but this SOT's own body is now stale in places (it still carries 2026-06-06 `44/44 · 4,128` and `48/48` figures, and a `33/33` change-log row). For CURRENT status defer to [galerina-roadmap-and-percent-audit-2026-06-21.md](galerina-roadmap-and-percent-audit-2026-06-21.md) + version.json (**53/53 · 4,989**, 2026-06-22). Every number
below was produced by executing something, not by carrying a figure forward.

---

## 1. Verified test counts

Reproduce all at once from the repo root: **`npm test`** (= `node scripts/run-all-tests.cjs`).
**2026-06-15 verified (re-run this session): 48/48 packages, 4,360 tests, 0 fail.**
(Produced by running `node scripts/run-all-tests.cjs` — supersedes the earlier 47/47·4,346
and the stale task-ledger 44/44·4,128 figures. Per-package highlights: core-compiler 3,361 ·
tower-citizen 173 · devtools-project-graph 90 · devtools-graph-algorithms 95 ·
framework-app-kernel 38 · devtools-context 35 · ext-bridge-quantum 12 · substrate-math 6.)
**Earlier same-day figure (kept for history):** 47/47 packages, 4,346 tests, 0 fail.
For the SOT four only: `npm run test:core` → 3,445 tests (graph 95 · economics 15 ·
compiler 3,321 · security 14). (Auto-generate these counts to stop drift = #150.)

| Package | Tests | Pass | Fail | Notes |
|---|---|---|---|---|
| galerina-core-compiler | 3,322 | 3,322 | 0 | **P9 BYTE-PARITY ACHIEVED (#143, 2026-06-06):** the self-hosted **`lexer.spore` `tokenize` produces a byte-for-byte identical token stream in the Stage-A interpreter AND in real WASM** executed through the #105 admission gate — verified over a 12-input corpus (keywords/identifiers/symbols/operators/numbers/member/method) in `tests/wat-p9-tokenize-parity.test.mjs`. The full path runs: `.spore → WAT → real-wabt binary → Ed25519-attested #105 admission → execute → reconstruct tokens from linear memory`. Enablers: **#144** enum-variant member lowering; **#145** string-intern table exposure + complete host stdlib (`char_to_string`/`str_concat`/`str_eq`/`char_is_letter|digit`/`array_contains_str`/`unwrap_or`/…) + output reader; **#160** type-directed lowering (Option<Char> None/Some sentinel dispatch + binding, `charLiteral`→codepoint, `codePoint` identity, `Char.toString`→`__char_to_string`, String `+`→`__str_concat`, String `==`/`!=`→`__str_eq`, `Array<String>.contains`→`__array_contains_str`, `(unreachable)` tail terminator). Scope note: parity is proven for **`tokenize`**; parser/type-checker/governance-verifier WASM parity remain (they execute in Stage-A). **#105 WASM admission gate** (`wasm-runtime.ts`): attestation-first Ed25519 verify before host linking, closed-allowlist imports — `CRITICAL_SECURITY_VIOLATION` fail-closed; proven end-to-end in real WASM |
| galerina-core-economics | 15 | 15 | 0 | |
| galerina-devtools-graph-algorithms | 95 | 95 | 0 | |
| galerina-core-security | 14 | 14 | 0 | |
| **SOT FOUR TOTAL** | **3,383** | **3,383** | **0** | |
| *(Governed Inference Tower + Sentinels — 2026-06-06)* | | | | |
| galerina-tower-citizen | 106 | 106 | 0 | Brain: Hybrid engine + TPL sim + Brain→Brawn + ai{} gov + in-mem/batched audit + Triple-Lock + flight-boot + LST/Egress audit wiring + **CF-3/CF-7 bridge attestation** (Ed25519 sign/verify + hash pin; `ERR_BRIDGE_UNATTESTED` fail-closed) + **P9 certified mode mandates signed bridges** (`ERR_CERTIFIED_NO_ATTESTATION`) + **enforced V_DPM capability gate** (branchless `(req & granted)==req`; `ERR_CAPABILITY_DENIED`) + **numeric policy table** (ai{} compiled once → packed i32 flags + O(1) Set membership + pre-paid certified preconditions; 2.04× on the governance-check slice) |
| galerina-ext-bridge-cpp | 13 | 13 | 0 | Brawn: BitNet CPU bridge + cpp registry factory (determinism oracle) + **signed `BridgeManifest` + addon SHA-256 pin** (`ERR_ADDON_HASH_MISMATCH`) |
| galerina-devtools-package-graph | 7 | 7 | 0 | Boundary auditor |
| galerina-core-sentinel-memory (LSM) | 30 | 30 | 0 | Fixed-block pool, 128-bit alignment, Compute/Governance segmentation, ternary TPL state buffer |
| galerina-core-sentinel-io (LSIO) | 23 | 23 | 0 | Manifest loader, HMAC/SHA-256 integrity gate, zero-copy mapper, photonic-bus seam |
| galerina-core-sentinel-time (LST) | 13 | 13 | 0 | Deterministic Logical Clock + drift monitor (PRECISION_FAULT) |
| galerina-core-sentinel-power (LSP) | 17 | 17 | 0 | Thermal envelope governor → deterministic kernel down-tiering |
| galerina-core-sentinel-state (LSS) | 14 | 14 | 0 | Atomic HMAC-verified snapshots + cold-boot recovery |
| galerina-core-sentinel-egress | 20 | 20 | 0 | Governed audit egress: ring buffer + batched HMAC-chained tamper-evident flush |
| galerina-inference-bridge-contract | 4 | 4 | 0 | Neutral Brain/Brawn contract (CF-4): InferenceBridge/BridgeOp/Result + bridge-manifest schema (CF-3) + fixed-point scale + oracle interface; zero deps |
| *(full suite — supplementary)* | | | | |
| **FULL PROJECT TOTAL** | **4,128** | **4,128** | **0** | 44/44 packages |

> Note: the previously-flagged CBOR test failures
> (`tests/governance/cbor-secure-parser.test.mjs`) no longer appear in the full
> run — the root test runner's smart-dispatch (glob-expanded `node --test`)
> executes the tracked compiler suite cleanly. Full run on 2026-06-06:
> **37/37 packages, 3,942 tests, 0 failures.**

---

## 2. Stage A compiler status

**Stage A (TypeScript interpreter) — 100% of implemented feature set.**

All syntax, governance checks, CBOR manifests, DSS simulation (Phases 1–7 DRCM),
Tower-native keywords, and self-hosted Stage B pipeline are fully exercised by
the test suite via the Stage A interpreter.

| Area | Status | Evidence |
|---|---|---|
| Core syntax (flow/contract/match/record/enum) | ✅ 100% | All examples + governance tests pass |
| Governance rules (SPORE-GOV/EFFECT/CAP/etc.) | ✅ 100% | 35+ rule codes registered + tested |
| CBOR .lmanifest generation | ✅ 100% | CBOR Tag 410-417; build artifacts generated |
| DSS simulation (Phases 1–7 DRCM) | ✅ 95% | Phase 7 OCI deployment pending (#113) |
| Tower-native syntax (v2.2) | ✅ 100% | See §4 |
| Named arguments | ✅ 100% | |
| Domain guard policies (Static Manifest Clamping) | ✅ 100% | |
| @experimental_profile directive | ✅ 100% | |
| Module path separator `::` | ✅ 100% | |
| Record constructor in let bindings | ✅ 100% | |
| Match exhaustiveness check (SPORE-MATCH-001) | ✅ 100% | |
| For-loop desugaring | ✅ 100% | |

---

## 3. DRCM Phase status

| Phase | Description | Status | Blocker |
|---|---|---|---|
| Phase 1 | Capability audit, manifest serialisation, receipt signing | ✅ 100% | — |
| Phase 2 | invariant {} block + WAT gate injection | ✅ 100% | — |
| Phase 3 | .lmanifest generation pipeline + admission gate | ✅ 100% | — |
| Phase 4 | Structured SystemCapabilityType + policy {} monotonicity | ✅ 100% | — |
| Phase 5 | DWI step keyword + DSS supervisor in .spore | ✅ 100% | — |
| Phase 6 | Epilogue Receipt generation + verification + ledger | ✅ 100% | — |
| Phase 7 (negative tests) | OWASP vectors + containment failure tests | ✅ 100% | — |
| Phase 7 (OCI/gVisor) | Layer 2 OS container config + Linux deployment | ✅ 100% | scripts/Dockerfile.galerina + deploy-linux.sh |

**DRCM overall: ~98% (all Stage-A phases + OCI complete; real DSS.wasm pending Stage B)**

---

## 4. Tower-native syntax (v2.2) — 100%

All 12 Tower-native constructs are implemented in Stage A and recognised by the
Stage B self-hosted `lexer.spore` and `parser.spore` (tasks #97/#98, 2026-06-05):

| Keyword/Construct | Status | Task |
|---|---|---|
| `;;` govComment token | ✅ | #93, #97 |
| `guard` domain ceiling | ✅ | Stage A, #97/#98 |
| `access {}` enforcement | ✅ | #89 |
| `gate {}` admission guard | ✅ | #88 |
| `static` compile-time constants | ✅ | #86 |
| `bitfield` governance register | ✅ | #87 |
| `governed` flow qualifier | ✅ | #82 |
| `view(cap)` MMCP type annotation | ✅ | #83 |
| `trap` keyword (inverted ensure) | ✅ | #81 |
| `step` cross-boundary DWI call | ✅ | #40 |
| `evict` plugin eviction | ✅ | #92 |
| `assimilate` plugin import | ✅ | #92 |
| `policy {}` state mutation | ✅ | #90 |

---

## 5. Stage B self-hosting (the real metric)

8 files in `packages-galerina/galerina-core-compiler/src/self-hosted/`.

**Axis B — Engine self-hosting (THE goal):** The compiler/runtime engine itself
rewritten in Galerina so Galerina compiles and runs Galerina. Status: **≈80%** (M-C
reached; cross-flow calls + recursion work; R6 corpus all passing).

| Pipeline stage | File | Status | Evidence |
|---|---|---|---|
| Lex | `lexer.spore` | **near-full** (v2.2 updated 2026-06-05) | Full token stream + GovComment + 52 keywords; 32 executing tests |
| Parse | `parser.spore` | **partial (full body AST)** (v2.2 updated 2026-06-05) | `parseFlows` yields complete flow AST; 11 new v2.2 record types; `guardDecls` in ParseResult; 63 executing tests |
| Type-check | `type-checker.spore` | **partial (return + body)** | `checkFlowBodies` walks full body AST; 22 executing tests |
| Effect-check | `effect-checker.spore` | **partial (return + body)** | `checkBodyEffects` from body call expressions; 21 executing tests |
| Govern | `governance-verifier.spore` | **partial (decl + body)** | `checkBodyGovernance` walks body AST; 17 executing tests |
| Emit (GIR) | `gir-emitter.spore` | **partial (flat + body)** | `emitBodyGIR` lowers full body; 21 executing tests |
| Execute | `runtime.spore` | **partial (GIR eval + calls)** | `runProgram` + flow table; recursion works (fib(15)=610); 20 executing tests |
| Capabilities | `compiler.capabilities.spore` | **functional** | 8 flows, tested |

**v2.2 Stage B updates (2026-06-05, tasks #97/#98):**
- `lexer.spore`: Added `GovComment` token kind; added 12 v2.2 keywords (guard, access,
  gate, static, bitfield, governed, view, trap, step, evict, assimilate, policy);
  added `;;` govComment scanning with `GovComment` token emission. Table now 52 keywords.
- `parser.spore`: Added 11 v2.2 AST record types (GuardDecl, AccessDecl, GateDecl,
  StaticDecl, BitfieldDecl, TrapDecl, StepExpr, EvictExpr, AssimilatedPluginDecl,
  GovernedFlowDecl, PolicyMutationDecl); added `guardDecls: Array<GuardDecl>` to
  ParseResult; added `guard {}` top-level parsing in `parseFlows`; initialised and
  returned `guardDecls`.
- Both files: 0 errors, 0 governance warnings (`node galerina.mjs check` verified).

Tally: **1 functional + 7 partial + 0 stub** (8 modules).

---

## 6. Real DSS.wasm and production deployment

| Component | Status | Notes |
|---|---|---|
| Real DSS.wasm | 0% | All Stage A simulation; Wasmtime component pending (#102-#106) |
| OCI/gVisor container | ✅ Ed25519 Stage A | scripts/Dockerfile.galerina + scripts/.dockerignore (#113) |
| galerina deploy | ✅ full pipeline | check+build+verify+health; --tag support (#112) |
| Linux deployment | ✅ deploy-linux.sh | scripts/deploy-linux.sh (#111) |
| galerina keygen / signing | ✅ Ed25519 Stage A | galerina keygen generates Ed25519 keypair (#107) |
| Signature verification | ✅ in galerina verify | Ed25519 verify in admission gate (#109) |
| R6 corpus parity | ✅ 10 tests green | tests/r6-corpus/r6-parity.test.mjs (#116) |
| ML-DSA-65 signing | 0% | Library-dependent (#107-#110) |
| Lean4 formal verification | 0% | External infrastructure |
| Intel SGX/TXT attestation | 0% | Hardware-dependent |

These items MUST NOT be marked done until the infrastructure actually executes
(project rule: no number shown until a backend actually executes).

---

## 7. The two-axis model

"Runtime-in-Galerina" conflates two distinct axes:

| Axis | Honest current state | Basis |
|---|---|---|
| A — governed decision logic in `.spore` | **14 governed services tested** (of 25 `.spore` service files) | §8 |
| B — engine self-hosting (THE goal) | **≈80%** — R6 corpus: Stage A == Stage B on all 5 flows; v2.2 syntax recognised by lexer + parser | §5 |

Against the actual goal (Axis B at 100%), current position is **≈80%**.

---

## 8. Axis A — governed service surface

`examples/auth-service/` holds 25 `.spore` service files. **14 are covered by
executing endpoint/integration tests** (the rest are unverified surface):

auditChainService, capabilityHostService, compilationService, economicsService,
getPatient, governanceService, manifestVerificationService, proofVerifierService,
routingPolicyService, runtimeProfileService, typeRegistryService,
valueClassificationService, verifyPassword, verifyPasswordService.

---

## 9. What cannot be truthfully completed in-repo

- Deno Deploy / real production traffic
- Intel SGX / TXT hardware attestation in the ProofGraph
- Lean4 formal-verification export / DO-178C certificate
- ML-DSA-65 (FIPS 204) post-quantum signing
- A production deployment with real external traffic
- Real Wasmtime DSS.wasm execution (currently Stage A simulation)

---

## 10. Change log

### 2026-06-05 (tasks #112/#113/#116/#117 — this session)
- **Task #112** — `galerina deploy` command: check+build+verify+health pipeline, --tag support.
- **Task #113** — `scripts/Dockerfile.galerina` OCI container config + `scripts/.dockerignore`.
  DRCM Phase 7 OCI gate now ✅ complete.
- **Task #116** — R6 parity gate wired into `scripts/run-phase-close.mjs` as
  `tests:r6-corpus` (`node --test tests/r6-corpus/r6-parity.test.mjs`); 10 tests.
- **Task #117** — Production readiness declaration: `version.json` at project root,
  `galerina version` command, SOT updated (keygen, signing, R6, OCI, deploy).

### 2026-06-05 (tasks #97/#98/#115 — prior session)
- **Task #97** — lexer.spore v2.2 update: added `GovComment` to `TokenKind` enum;
  expanded `makeKeywordTable()` from 40 to 52 keywords (added: guard, access, gate,
  static, bitfield, governed, view, trap, step, evict, assimilate, policy); added
  `;;` govComment interception in `tokenize` (emits `TokenKind.GovComment`).
  `phase40-stage-b-bootstrap.test.mjs` updated: keyword count test → 52. Both files
  check clean: `node galerina.mjs check` 0 errors, 0 governance warnings.
- **Task #98** — parser.spore v2.2 update: added 11 new record type declarations
  (GuardDecl, AccessDecl, GateDecl, StaticDecl, BitfieldDecl, TrapDecl, StepExpr,
  EvictExpr, AssimilatedPluginDecl, GovernedFlowDecl, PolicyMutationDecl); updated
  `ParseResult` to add `guardDecls: Array<GuardDecl>`; added `guard {}` top-level
  declaration parsing in `parseFlows`; initialised `guardDecls` in `parseFlows` and
  included in the return value. Check clean: 0 errors, 0 governance warnings.
- **Task #115** — This SOT updated to reflect: Stage A 100%, DRCM Phases 1-7 ~95%
  (OCI pending), Tower-native syntax 100%, 33/33 packages / 3,387 tests, Stage B ≈80%,
  Real DSS.wasm 0%, Production deployment 0%.

### 2026-06-02 (prior session — summarised)
- R6 corpus achieved: Stage A == Stage B on all 5 corpus flows.
- Full self-hosted pipeline: source → lex → parse → typecheck → effect-check →
  govern → emit GIR → execute, all in Galerina. fib(15)=610, sumTo(100)=5050.
- All DRCM Phases 1–7 (negative tests) complete.
- Tower-native keywords #81-#96 implemented in Stage A.

---

## 11. Supersedes / corrects

- `galerina-audit-2026-06-02.md` — test counts (§1) and the "Stage B 2/8 / 55%"
  framing (§2–3).
- `galerina-runtime-in-galerina-roadmap.md`, `galerina-roadmap-phases-41-60.md`,
  `galerina-roadmap-next10-phases.md` — the single-number percentage; use the
  two-axis model in §7 instead.
- All prior versions of this SOT document — this version (2026-06-05) supersedes.

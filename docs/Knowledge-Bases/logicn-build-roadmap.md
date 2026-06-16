# LogicN — Build Roadmap

**Version:** 7.0 (2026-06-06)  
**Last updated:** 2026-06-06 — P9 self-hosting: flow-body emission real (small modules execute via real wabt); **CORRECTION — the lexer module does NOT yet wabt-assemble** (undefined stdlib fns; see §16) + Governed-Tower hardening shipped; graph 2924 nodes / 3673 edges; **44/44 packages · 4,128 tests · 0 fail**; audit:security 31 files / 0 findings; 18 CBOR manifests canonical; governance:diff NEUTRAL (no authority widening); r6 Stage-A parity green

---

## 📍 Current snapshot (2026-06-06)

**Governed Inference Tower hardening (logicn-tower-citizen, 106 tests):**
- `CF-3/CF-7` **bridge attestation** — Ed25519 sign/verify + sha256 manifest & addon-hash pinning; `ERR_BRIDGE_UNATTESTED` fail-closed; `logicn bridge-attest` CLI (keygen/hash/sign).
- **P9 Certified Profile** now mandates signed bridges (`ERR_CERTIFIED_NO_ATTESTATION`), governed egress, and per-call `approved_models`+`max_tokens`+`max_token_cost`.
- **Enforced V_DPM capability gate** — branchless `(required & granted) === required`; `ERR_CAPABILITY_DENIED` before any compute (the bitmask was decorative; now live).
- **Numeric policy table** — `ai{}` compiled once → packed i32 flags + O(1) `Set` membership + pre-paid certified preconditions (2.04× on the governance-check slice; scales with allow-list size).

**P9 self-hosting bootstrap (logicn-core-compiler) — flow-body emission real; module assembly NOT yet:**
> CORRECTION (2026-06-06): an earlier claim said the lexer "compiles to a real wabt-assembling WASM module".
> That was overstated. SMALL flows do compile + execute via real wabt (verified). The LEXER's flow bodies emit
> real instructions, but the MODULE references undefined stdlib fns (`$charCount`/`$Ok`/`$Some`/`$None`), so real
> wabt rejects it and `assembleWAT` silently fell back to a 240-byte minimal-encoder stub. Full lexer assembly +
> execution is gated on the **stdlib runtime (#145)**.
- `P9.4a` guarded-flow WAT bodies · `P9.4b` record struct layout (construct + `r.field` access, verified in real WASM) · `P9.4c` guarded-flow export gating.
- **#145a MILESTONE (2026-06-06): the self-hosted lexer module now wabt-assembles to a real WASM binary.**
  `charCount`/`Ok`/`Err` wired to host imports + `__array_append` returns the array handle (last linking
  blocker cleared). The module LINKS + produces a valid binary via real wabt (verified, not the stub).
  REMAINING for tokenize byte-parity (#145b): token-VALUE correctness needs type-aware string lowering
  (String `+`→`__str_concat`; `Char.toString`→`__char_to_string`) + the host output reader. **Linking done; string semantics next.**

**The single remaining P9 gate → EXECUTION PARITY (next):** run `tokenize.wasm` and byte-compare to the interpreter. Needs the host-import runtime (string table + `__array_*`/`__str_*`/`__char_*` bridge + list/record memory walk) wired into `WebAssembly.instantiate` — i.e. **#105 (real-Wasmtime `logicn run`)**. Interpreter-level Stage-A==Stage-B parity is already locked (lexer-parity + R6 #101).

### Next up (ordered)
0. ✅ **#105 — WASM admission-gate harness (security core, 2026-06-06):** `wasm-runtime.ts`
   — attestation-first Ed25519 verify BEFORE host linking (tampered/unsigned → `CRITICAL_SECURITY_VIOLATION`,
   no instantiation), closed-allowlist host imports (no ambient scope), dev/prod differ ONLY in
   observability (host-call log / trap memory dump); proven in real WASM (5 tests). The locked
   security boundary is built.
1. **Tokenize EXECUTION byte-parity (completes P9):**
   - ✅ **#144 enum-variant member lowering (2026-06-06)** — `EnumType.Variant` → declaration-order i32 tag
     (`buildEnumVariants` registry); **all 9 `tokenize` placeholders eliminated**, verified in real WASM
     incl. enum-in-record round-trip (tests/wat-p9_4d-enum-lowering, 4 tests).
   - 🔲 **#145 — type-aware STRING semantics (the real bulk, discovered reading lexer.lln):** the lexer builds
     token values via `value = value + nc.toString()`. Today String `+` lowers to `i32.add` (handle arithmetic)
     and `Char.toString` → `__int_to_str` (returns the char's *decimal*, not the char). Needs: `__char_to_string`
     + `__str_concat` host fns **and type-aware lowering** (String `+` → concat; `Char.toString` → char-to-string),
     which needs String/Char var-type tracking (annotations + `Option<Char>` match bindings). Plus string-intern
     table exposure + a list/record output reader in `wasm-runtime.ts`. *Then* `tokenize.wasm` == interpreter
     (golden: lexer-parity). Note: no `;; unresolved` markers remain — the string gaps are SEMANTIC, not marker-flagged.
2. **#102–#104, #106 — real DSS.wasm (Post-P9, DRCM Phase 4):** `dss/index.lln` → `build/dss.wasm`; Wasmtime component supervises DWI guests; real per-DWI fuel; DSS.wasm signs epilogue receipts.
3. **CF-4 — extract `@logicn/tpl-oracle`** so the Brawn (`ext-bridge-cpp`) imports NO Tower runtime (currently pulls `StubTernaryBridge`/`GovernanceEnforcer` from `tower-citizen`).
4. **CF-5 / CF-9 / CF-10** — vector T-MAC commit gate · ECC/TMR · atomic failover.
5. **Record follow-ons** — `#record-update` lowering + cross-flow return-type tracking (so `let r = someCall()` returning a record resolves field access).
6. **#110** — key rotation in `secrets {}`; **#69** — floor-specific dev-tools graphs.

---

## ✅ Complete — All of Phases 1–3 + DRCM Phases 1–4

### Compiler Quality (Phase 1)
`#57` Named record constructors · `#61` `::` module separator · `#55` Named arguments · `#62` Multi-variant match arms `A|B =>` · `#45` LLN code wiring · `#50` EC/ID/AU/LC/T/FG codes

### New Language Features (Phase 2)
`#56` Domain Guard Policies `[conforms_to:]` · `#58` `resilience {}` + `observability {}` · `#52` `security::interim` real module · `#51` `@experimental_profile` directive

### Docs, Examples, CI Gates (Phase 3)
`#46–49` Pattern examples + README + examples migration + graph index · `#53` KB index · `#54` T-006/007/008 goal tests · `#59` Change-class CI + GitHub Action · `#60` Contract clause reference

### DRCM Phase 1 — Critical Security Fixes
`#30` Wildcard ban LLN-CAP-001 · `#31` Prefix-token scanner · `#32–35` CAS/CBOR/key custody/separator specs

### DRCM Phase 2 — `invariant {}` Block
`#36` Parser + static eval + WAT gate injection · LLN-INV-001/003/004 enforced

### DRCM Phase 3 — .lmanifest + Admission Gate
`#67` Binary CBOR RFC 8949 · `#37` `logicn verify` admission gate · `#63` governance-impact.json · `#64` `logicn check --diff` · `#65` `logicn init-env`

### DRCM Phase 4 — Structured Capabilities + `policy {}` Parser
`#38` Structured SystemCapabilityType replacing string grants · `#39` `policy {}` block parser + monotonicity verifier (LLN-MONO-001/002)

### CI/CD Enhancements
`#66` LLN-OBS-002 observability/privacy separation · `#71` `logicn check --what-if` shadow policy analysis · `#73` `assuming {}` parser (AST node assumingDecl) · `#74` `assuming {}` manifest-lookup proof verification

### Topological Graph Engine (Foundation)
`#79` Pre-resolved Policy DAG (CBOR Tag 416) · `#80` Behavioral Fingerprinting (CBOR Tag 417) · `logicn manifest-to-dot` DOT visualization · V_DPM extended to 32-bit topology layout

### Tower-Native Syntax (v1.0)
`#81` `trap` keyword + WAT gate + LLN-TRAP-001/002 · `#82` `governed` floor qualifier + manifest ProofObligation · `#83` `view()` MMCP capability-masked pointer type (Tag 415 stub) · `#84` match exhaustiveness LLN-MATCH-001 · `#85` `DSS.lln` V_DPM foundation (Floor 2 bootstrap)

### Tower-Native Syntax v2.1 — Foundations Complete (tasks #86–#94)
`#86` `static` compile-time constants (WAT `(i32.const N)` folding) · `#87` `bitfield` governance registers + V_DPM rewrite (`NAME.field` bitmask + `NAME.BIT_field` position) · `#88` `gate {}` admission guard verifier (LLN-GATE-001/002; `gateConstraints[]` manifest) · `#89` `access {}` Default Deny + `grant` enforcement (LLN-ACCESS-001/002) · `#92` `guard Name {}` domain ceiling syntax (replaces `policy Name {}`) · `#93` `import "./path.lln"` DAG merge (LLN-IMPORT-001-004) · `#94` `import plugin safe/assimilate` bridged plugins (`assimilatedPlugins[]` manifest; LLN-ASSIMILATE-001-003) · `;;` govComment as first-class token → `governanceAnnotations[]` in manifest

### Agile Governance Patterns + Proof-Tracing (Design)
`logicn-agile-governance-pattern.md` · `logicn-proof-tracing-design.md` · `logicn-topological-graph-engine.md`

---

## 🟡 Now Open — Phase 5 + Remaining Tasks

### CI/CD Enhancements
| Task | What | Priority |
|---|---|---|
| **#72** | Hierarchical policy inheritance `parent_policy:` | Medium |

### Tower Completion (Phase 5 gates)
| Task | What | Priority |
|---|---|---|
| **#75** | Governance-as-Evidence: AuditEvent CBOR Tag 410 schema | Phase 5 gate |
| **#76** | LLN-INV-000 DSS trap handler | Phase 5 gate |
| **#77** | ExecutionDAG compile-time CFG → CBOR Tag 414 | DRCM Phase 6 |
| **#78** | MMCP full enforcement (view() runtime gate) → CBOR Tag 415 | DRCM Phase 5 |

### Tower-Native Syntax v2.1 (Remaining)
| Task | What | Priority |
|---|---|---|
| **#90** | `policy {}` State Mutation Governance — permitted transitions on `mut` variables | Phase 5 |
| **#91** | Migrate `vdpm.lln` from verbose VDPM_BIT_* flows to `bitfield V_DPM { }` | After #87 ✅ |

### Phase 9B — Self-Hosting → WASM (in progress)
The self-hosted compiler sources in `packages-logicn/logicn-core-compiler/src/self-hosted/`
(`lexer.lln`, `parser.lln`, `type-checker.lln`, `governance-verifier.lln`, …) now
compile through the Stage-A toolchain. Progress on assembling them to WASM:

| Sub-phase | What | Status |
|---|---|---|
| **P9.2** | `externref` lowering fix — host-handle values cross the WASM boundary | ✅ Done — `lexer.lln` now `logicn build`s to `build/lexer.wasm` |
| **P9.3** | Stdlib host mapping — self-hosted sources resolve stdlib calls to host imports | ✅ Done — lexer + parser link against the host stdlib |
| **P9.4** | Guarded flow bodies + record types fully lowered to WASM | ⬜ Remaining — `parser.wasm` builds but record/guarded-body lowering is still partial |

**Verify:** `node logicn.mjs build packages-logicn/logicn-core-compiler/src/self-hosted/lexer.lln`
emits `build/lexer.wasm`; the parser builds too, pending P9.4 for full body lowering.
See `logicn-phase-9-roadmap.md` (Phase 9B, Stage B1–B5) for the self-hosting plan.

---

## ⬜ DRCM Phases 5–7 (Future)

### Phase 5 — DSS.wasm Supervisor + Step Keyword
```
V_DPM structure definition in DSS.lln  ← START HERE when ready
    ↓
Capability → bitmask mapping
    ↓
step keyword + DWI isolate allocation (#40)
    ↓
DSS supervisor: DPM tracking + trap handler (#41)
    ↓
MMCP (#78) + topology bit validation (bits 8-15)
    ↓
Governance-as-Evidence: AuditEvent CBOR Tag 410 (#75)
    ↓
LLN-INV-000 trap handler (#76)
    ↓
CBOR secure parser: depth/duplicate/overflow (#68)
```

### Phase 6 — Epilogue Receipt + ExecutionDAG
```
Epilogue Receipt: generation + verification + ledger (#42)
    ↓
ExecutionDAG compile-time CFG construction (#77)
    ↓
DAG-edge validation in DSS.wasm signal loop
```

### Phase 7 — Hardening + Deployment
```
Negative test suite: all OWASP vectors (#43)
    ↓
Floor-specific dev tools graphs (#69)
    ↓
WAT single-exit body transformation (#70)
    ↓
Layer 2 OS container config OCI/gVisor (#44)
    ↓
Linux server deployment verification
```

---

## CI/CD Gate Status

| Gate | Status | What |
|---|---|---|
| `tests:core` | ✅ | 3,285 tests — 4 SOT packages |
| `tests:patterns` | ✅ | 8 architecture patterns |
| `tests:goals` | ✅ | T-006/007/008 acceptance tests |
| `tests:devtools-*` | ✅ | 5 devtools packages |
| `tests:ext-*` | ✅ | secrets-vault + proof-snarkjs |
| `audit:security` | ✅ | 0 errors (46 VALUESTATE tracked) |
| `audit:naming` | ✅ | 19 naming findings (informational) |
| `audit:provenance` | ✅ | 0 ungated flows |
| `manifest:cbor` | ✅ | 6 manifests canonical CBOR + round-trip |
| `graph:reindex` | ✅ | 2888 nodes / 3625 edges |
| `governance:diff` | ✅ | Change class vs HEAD~1 per cadence |

---

## .lmanifest Contents (Current)

Every `logicn build` now produces a binary CBOR `.lmanifest` containing:

| Field | CBOR Tag | Status |
|---|---|---|
| `sourceHash` | — | ✅ SHA-256 of .lln source |
| `proofObligations` | Tag 403 | ✅ invariant static/runtime classifications |
| `derivedConstraints` | — | ✅ secret sink + taint rules |
| `policyResolutionDag` | Tag 416 | ✅ pre-resolved effect bitmask |
| `behavioralFingerprint` | Tag 417 | ✅ CFG path SHA-256 |
| `governanceSignature` | Tag 404 | 🔲 placeholder (real ML-DSA-65 in Phase 5) |
| `executionDag` | Tag 414 | 🔲 DRCM Phase 6 (#77) |
| `capabilityPointers` | Tag 415 | 🔲 stub in derivedConstraints (#83) — full enforcement Phase 5 (#78) |
| `governanceAnnotations` | — | ✅ `;;` govComment tokens collected into manifest narrative |
| `gateConstraints` | — | ✅ `gate {}` admission guard conditions recorded (#88) |
| `assimilatedPlugins` | — | ✅ Hot-Code Residency plugins tracked with path + source hash (#94) |

---

## Complete Task Register

### ✅ Complete (94 tasks)
Tasks #1–67 + #71 + #73 + #74 + #79–89 + #92–#94 (see task list for full detail)

### 🟡 Open (Priority order)

| # | Task | Phase |
|---|---|---|
| **#72** | Hierarchical policy inheritance | Medium |
| **#75** | Governance-as-Evidence CBOR Tag 410 schema | Phase 5 gate |
| **#76** | LLN-INV-000 DSS trap handler | Phase 5 gate |
| **#68** | CBOR secure parser DSS hardening | Phase 5 gate |
| **#78** | MMCP full enforcement Tag 415 | Phase 5 gate |
| **#70** | WAT single-exit body transform | Phase prereq |
| **#77** | ExecutionDAG CFG → Tag 414 | Phase 6 gate |
| **#69** | Floor-specific dev tools graphs | Phase 7 |
| **#90** | `policy {}` State Mutation Governance | Phase 5 |
| **#91** | Migrate `vdpm.lln` to `bitfield V_DPM {}` | After #87 ✅ |
| **#118** | `logicn-ext-bridge-groq` GroqCloud HTTP wrapper | Track B |
| **#119** | `logicn-ext-bridge-bitnet` BitNet CPU WASI-NN backend | Track A |
| **#120** | `logicn wrap` C++ wrapper generator | CLI |
| **#121** | `logicn promote` full promotion pipeline | CLI |
| **#122** | `logicn-ext-bridge-nvfp4` NVFP4 TensorRT-LLM backend | Hardware-gated |
| **#123** | `governance_tier` boot.lln mapping | Parser |
| **#124** | `audit_depth full` AuditEvent AI inference fields | Verifier |
| **#125** | `logicn run --governed <flow>` — execute effectful/secure flows via the **governed interpreter** (`console.log` / `audit.write` / capability host) **enforcing the manifest's allowed effects**. Today `run` is WASM-`--invoke`-only (only pure, primitive-returning flows are exported), so a `secure flow main { console.log }` can be *checked* but not *executed* from the CLI — the error at `logicn.mjs:1300` correctly says so but offers no run path. Governance-sensitive: must honour deny-by-default (no ambient `console`/capabilities), reuse `interpreter.ts`'s `ContractEnforcer` + `CapabilityHost`, not bypass them. Dogfooding finding (.tmf R&D #2). | CLI |
| **#126** | Extend the descriptive operator hint beyond `^`/`~` (`lexer.ts:790`). `&` `\|` `<<` `>>` and `&&` `\|\|` currently emit a generic `LLN-PARSE-001`. Must be **parser-level, not lexer**: `\|` is overloaded for multi-variant match arms (`A\|B =>`, `parser.ts:1709`) and `<<`/`>>` are `<`/`>` pairs used in generics/comparison — none can be blanket-rejected in the lexer. In *expression* position, hint `&` `\|` `<<` `>>` → engine/extension (crypto-on-core) and `&&` `\|\|` → use the `and`/`or` keywords. From R&D conformance audit (DX only, low priority). | DX |

### Governed Inference Tower (Track A/B)
| Task | What | Priority |
|---|---|---|
| **#118** | `logicn-ext-bridge-groq`: GroqCloud HTTP wrapper — governed `step()` via WASI-HTTP, `ai {}` enforcement (max_token_cost, max_latency_ms, approved_models), AuditEvent CBOR Tag 410 | Track B |
| **#119** | `logicn-ext-bridge-bitnet`: BitNet CPU WASI-NN Wasmtime backend — `wasmtime-wasi-nn-bitnet` Rust crate, BitNet.cpp FFI, TL2/TL1 kernel selection, wired into `logicn-ai-lowbit` | Track A |
| **#120** | `logicn wrap`: governance wrapper generator from C++ headers → `.lln` flow + `_host.rs` Wasmtime registration | CLI |
| **#121** | `logicn promote`: full promotion pipeline (wrap + static analysis + sign) → `build/engine.wasm` + signed `.lmanifest` with license/commit metadata | CLI |
| **#122** | `logicn-ext-bridge-nvfp4`: NVFP4 TensorRT-LLM backend — Apache 2.0 + NOTICE; hardware-gated (Blackwell B200/RTX5090) | Hardware-gated |
| **#123** | `governance_tier` mapping in `boot.lln`: `ai_tier_1/2/3` → assimilated plugin routing; no flow-code changes to switch backends | Parser |
| **#124** | `audit_depth full`: enhanced AuditEvent fields for AI inference — token_count, latency_ms, input_hash, output_hash, model_version, engine_id | Verifier |

### ⬜ DRCM (Gated)
`#40–44`: Phase 5–7 (step keyword, DSS.wasm, Epilogue Receipt, OWASP tests, OCI)

---

## Tower-Native Syntax (v1.0 + v2.1 spec)

Compile-time security primitives that map LogicN source directly onto the Governed Tower architecture and V_DPM register. Unlike general-purpose control flow, these keywords are **declarative security primitives** — each one causes the compiler to emit Tower-specific metadata, proof obligations, or WAT gates.

**v1.0 (implemented — Stage A):**

| Keyword | What it declares | Compile-time output |
|---|---|---|
| `governed floor_N` | Floor authorization for a flow | ProofObligation (CBOR Tag 403) with floor + bit |
| `view(cap)` | Capability-masked memory pointer | MMCP stub (CBOR Tag 415) in derivedConstraints |
| `trap COND : ERR` | Hard invariant in failure-condition form | WAT `unreachable` gate + ProofObligation |

**v2.1 (implemented — tasks #86–#94 complete):**

| Keyword | What it declares | Compile-time output |
|---|---|---|
| `static NAME = VALUE` | Compile-time constant | WAT `(i32.const N)` folding; zero runtime overhead |
| `bitfield NAME { field: bit }` | Typed governance register (V_DPM) | `NAME.field` (bitmask) + `NAME.BIT_field` (position) |
| `gate(condition) { ... }` | Admission guard wrapping flows | `gateConstraints[]` in manifest; bit 8 WAT gate (Phase 5) |
| `access { grant ... }` | Call-boundary Default Deny negotiation | `grant` lines verified against effects + capability registry |
| `guard Name {}` | Top-level domain ceiling | Replaces `policy Name {}`; Differential Proof at compile time |
| `import "./path.lln"` | DAG merge file import | Symbols enter scope; resolved path + hash in manifest |
| `import plugin safe/assimilate` | Bridged plugin | `assimilatedPlugins[]` in manifest; LLN-ASSIMILATE-001-003 |
| `;; text` | `govComment` token | `governanceAnnotations[]` in manifest narrative |

See `logicn-tower-native-syntax.md` for full grammar, semantics, and cross-references.

---

## Knowledge Base (Current — 34 docs, v6.0 additions reflected in layer listing)

**Layer 0:** `architecture-charter.md`  
**Layer 1:** `logicn-governance-rules.md` (37+ LLN codes)  
**Layer 2A:** `logicn-architecture-patterns.md`  
**Layer 2B:** `logicn-contract-authoring-guide.md` · `logicn-contract-clause-reference.md` · `logicn-resilience-observability-design.md` · `logicn-domain-guard-policies.md` · `logicn-governance-cicd-pipeline.md` · `logicn-cbor-manifest-spec.md` · `logicn-tower-native-syntax.md` · `logicn-governed-inference-tower.md` ← NEW  
**Layer 3:** `logicn-deterministic-runtime-containment.md` · `logicn-drcm-phase1-specs.md`  
**Topology:** `logicn-topological-graph-engine.md`  
**Patterns:** `logicn-agile-governance-pattern.md` · `logicn-proof-tracing-design.md`  
**Root:** `logicn-engineering-goals.md` · `logicn-build-roadmap.md` (this doc) · `KNOWLEDGE-BASE-INDEX.md`  
**Research:** `logicn-governed-design-synthesis.md` · `logicn-governed-tower-specification.md` · `logicn-platform-infographic-concept.md` · `logicn-floor3-proof-zone-graph.md`

---

## P9 Completion Roadmap (2026-06-06)

State: **44/44 packages · 4,089 tests · 0 fail.** Stage A compiler 100%; the
Governed Inference Tower + 6 Sentinels + neutral bridge contract are built, wired,
governed, and benchmarked. The single gate to P9 is self-hosting (Stage B).

### P9 — self-hosting bootstrap (the gate)
- **#120 P9.4a — guarded flow WAT bodies** ✅ DONE (2026-06-06): the WAT emitter now
  lowers `guarded` flow bodies via `emitWATFromFlowAST` (only when emission fully
  succeeds, else `unreachable` — protects the 3,259 compiler tests). Verified: a
  guarded flow emits real `i32.add` and the suite stays green.
- **#120 P9.4b — record struct layout** ✅ CONSTRUCTION DONE (2026-06-06): a `#record`
  literal now bump-allocates `fieldCount*4` bytes above `$__lln_heap` (base 1024),
  stores each field at its slot offset, and evaluates to the base pointer — per-record
  `$__lln_rec_N` locals make it safe under nesting + record-returning calls. Verified
  end-to-end: a record-returning flow assembles via wabt and executes in real WASM with
  the correct struct in linear memory (tests/wat-p9_4b-record-layout). **Field ACCESS
  also DONE** (2026-06-06): `r.field` → `i32.load` at the slot offset, resolved via a
  `buildRecordLayouts` registry + per-flow var→type tracking (from `let r: T`/`let r =
  T{…}` literal types + record-typed params); round-trips in real WASM (build a record,
  read fields back — 5 tests). REMAINING: `#record-update` still emits the placeholder
  (needs a base-copy), and `let r = someCall()` returning a record isn't type-tracked
  (cross-flow return-type inference) — neither blocks the self-hosted `tokenize` path.
- **#120 P9.4c — export gating for governed flows** ✅ DONE (2026-06-06): a `guarded`
  flow with no declared effects is now WASM-exportable (it lowers like a pure flow), so
  `logicn run --invoke <guardedFlow>` reaches governed entry points. Verified: a guarded
  flow is exported and invocable in real WASM (tests/wat-p9_4c-export-gating, 2 tests).
- **Ceremony — EMISSION half ✅ DONE (2026-06-06):** the self-hosted lexer
  (`src/self-hosted/lexer.lln`) now compiles to a real, wabt-assembling WASM module —
  **all 9 flows have real bodies (0 `unreachable` stubs)**, `tokenize` (record-returning)
  included, using the P9.4b record heap (tests/wat-p9-ceremony-emission, 3 tests). This
  is the milestone "self-hosted `tokenize` emits real WASM". Interpreter-level Stage-A ==
  Stage-B parity is already locked (lexer-parity.test.mjs, PARITY_ACHIEVED=true; R6 #101).
- **Ceremony — EXECUTION-PARITY half 🔲 REMAINING (Post-P9, overlaps #105):** running
  `tokenize.wasm` and byte-comparing its output to the interpreter needs the full
  host-import runtime (string table + `__array_*`/`__str_*`/`__char_*` bridge +
  list/record memory walk) wired into `WebAssembly.instantiate`. That is the real-Wasmtime
  `logicn run` harness (#105), not a compiler-emitter gap.

### Post-P9 — real DSS.wasm (DRCM Phase 4)
- #102 dss/index.lln → build/dss.wasm via Stage B
- #103 Wasmtime component supervises DWI guests · #104 real fuel · #105 `logicn run`
  on the real DSS component · #106 receipt signing in DSS.wasm

### 🔒 Flagged externals — blocked on an external dependency or explicit go-ahead (DOCS ONLY)
These are recorded, not started. Each line = **status + blocker**. Do NOT implement or run any of these here.

| Task | Status | Blocker |
|---|---|---|
| **#102** — compile `dss/index.lln` → `build/dss.wasm` via Stage B | 🔲 BLOCKED (pending) | Needs Stage B WASM module assembly (gated on P9 string-runtime #145/#143); no real `dss.wasm` until the self-hosted pipeline emits + links full modules. |
| **#103/#104** — real Wasmtime component model + per-DWI fuel | 🔲 BLOCKED (pending) | Needs the **Wasmtime runtime** (component-model host + real per-isolate fuel metering); today fuel/supervision is simulated, not enforced by a real engine. |
| **#106** — epilogue receipts signed by `DSS.wasm` | 🔲 BLOCKED (pending) | Depends on a real `dss.wasm` (#102) running under Wasmtime (#103); receipt-signing logic exists, but in-WASM signing by the supervisor can't land until #102/#103 do. |
| **#110** — key rotation in `secrets {}` | 🔲 BLOCKED (pending) | Needs an external **KMS** (key-management service) to source/rotate keys; rotation semantics can't be enforced without a real key custodian. |
| **#149** — signing-key git-history scrub + CI secret scanning | 🔲 BLOCKED — **DESTRUCTIVE, user-driven** | Rewrites git history (committed key `8eecf4187ebc9341` in `cb5036d:.env.logicn-signing`; already rotated → `ab46f4c7e2797b9b`). **DO NOT run** without explicit user go-ahead — requires force-push + collaborator coordination. |

### Parallel hardening track (regulated-assurance lens, from the security audits)
- **CF-3 finish** — Tower verifies `sha256(canonicalManifestString)` + signature;
  `requireSignedBridge` in the Certified Profile; `logicn bridge attest` tool.
- **CF-4 finish** — extract the TPL oracle (`TPLSimulator`/`StubTernaryBridge`) into
  `@logicn/tpl-oracle` so the Brawn imports NO Tower runtime.
- **CF-5** — vector T-MAC commit gate (`canCommit()` in `execute()`).
- Packed-array refactor + fixed-point `i2_scale` (Phase 2 throughput).
- ✅ Numeric policy table (2026-06-06) — `compilePolicy()` compiles `ai{}` ONCE into
  packed i32 flags + an O(1) membership Set + pre-paid certified preconditions; the
  hot path is branchless flag tests + `Set.has` (2.04× on the governance-check slice,
  scales with allow-list size). [Contract → runtime CLI manifest reparse still open.]

### After P9: foundations to 100%
Once the bootstrap ceremony passes, drive the remaining Stage B pipeline modules
(parser/type-checker/effect/govern/emit/runtime `.lln`) from "partial" to "full"
so LogicN compiles and runs LogicN end-to-end — then port `logicn-tower-citizen`
itself to `.lln:tri` (compiler can host it; oracle preserved).

# LogicN — Build Roadmap

**Version:** 7.0 (2026-06-06)  
**Last updated:** 2026-06-06 — P9 self-hosting: flow-body emission real (small modules execute via real wabt); **CORRECTION — the lexer module does NOT yet wabt-assemble** (undefined stdlib fns; see §16) + Governed-Tower hardening shipped; graph 2924 nodes / 3673 edges; **44/44 packages · 4,128 tests · 0 fail**; audit:security 31 files / 0 findings; 18 CBOR manifests canonical; governance:diff NEUTRAL (no authority widening); r6 Stage-A parity green

---

## 🏁 Phase 1 Security Audit — COMPLETE (2026-06-16)

**The perimeter is sealed.** All **8/8** Critical + High findings from the adversarial Gate-6 audit are
patched and verified; the codebase is in a **fail-closed, deterministic** state. 48/48 packages · 4,481
tests · 0 fail · tsc clean · graph reindexed. Local tag: `audit-phase1-2026-06-16` (unpushed — gated on #149).

**Cleared (8):** VSC-001 (crit taint-escape) · VSC-002 (trap declassifier) · VSC-003 (memberExpr recognizer
bypass) · GOV-001 (K3 `permitted_effects` + strict `conforms_to`) · GOV-003 (member/positional response leak)
· CRYPTO-001 (certified PQ-key mandate) · CRYPTO-002 (Tier-3 hybrid) · CRYPTO-003 (tamper-evidence fields
signed). Enforces K3 governance semantics, plugs taint escapes, strictly resolves `conforms_to` pointers,
and binds the full tamper-evidence set under the signature.

### Parked backlog (deliberate — nothing falls through the cracks)
- **Safe subset** (REDUN-001, GAP-*, STYLE/INFO) — *Deferred.* Kept out of this milestone to preserve a
  pristine, security-only commit history. Staged for the next routine maintenance cycle.
- **GOV-003 residual + audit mediums/lows** (VSC-004/005, GOV-002/004, intermediate-binding dataflow) —
  *Tracked for dedicated R&D.* Deliberate semantic choices (taint semantics, binding-level dataflow) that
  need fresh architectural review to avoid breaking developer ergonomics.
- **CRYPTO-004** (algo-label binding) — *Tracked.* Versioning-sensitive (crypto-format bump per the
  design-stability charter).
- **Owner-gated** (#149 git-history scrub + first clean push · #199 Phase 2 engine landing · enc-rnd bridge
  pings · LLN-DP-* allocation) — *Blocked / Queued.* Awaiting owner-supervised execution.

---

## 🏗️ Phase 2 — `.tmf` engine build (#6) — IN PROGRESS (2026-06-16)

Owner decision: build as a **new LogicN package** (`packages-logicn/logicn-ext-tmf`), engine first.
Specs frozen in `LogicN-R-AND-D/tmf/spec/*`; crypto-on-core (bit-exact, deterministic; SHAKE256 via
`node:crypto`, ML-DSA-65 via `@noble/post-quantum` — no Rust, no photonic crypto).

| Slice | Scope | Status |
|---|---|---|
| 1 | **TMX-256 integrity core** (TriMerkle-XOF/SHAKE256: leaf/node/root, ABSENT, tree shape) | ✅ **DONE** — golden-verified vs frozen spec (9 tests; cross-lang conformant w/ Python ref). 49/49 · 4,490. |
| 2 | **Container reader/writer** (header + 56-byte section table; §6 fail-closed reader) | ✅ **DONE** — byte-exact golden (203 B) + full §7 error taxonomy (10 tests). 49/49 · 4,500. |
| 3 | KEM-DEM confidentiality (hybrid X25519+ML-KEM-768 → **SHAKE256** KDF → AES-256-GCM, §4 committing-AAD + §8.5 CTX/CMT-4, STREAM, verify-before-decrypt) | ✅ **DONE** — `src/kemdem.ts`; deterministic key-schedule/AAD/nonces/CTX golden-verified byte-for-byte (K_aead `9b4fdce2…`, commit_tag `ca22f4f5…`) + real hybrid-KEM/AES-GCM round-trip & all fail-closed tamper cases (14 tests). 49/49 · 4,514. |
| 4 | **#7** ML-DSA-65 signing over the root (hybrid Ed25519), reusing the shipped signer | ⬜ |
| 5 | Inclusion proofs · history chain · **#12** Governed Trust Capsule (RFC 9964) | ⬜ |

Remaining enc-rnd hand-offs gated behind this: #7 (slice 4), #12 (slice 5); #9/#10/#11 (privacy + namespace) and #13 (ffsim landing, needs QB-001) tracked separately.

---

## 🔐 2026-06-16 cycle — security audit · PQ benchmark · R&D adjudication

**Verified:** 48/48 packages · 4,481 tests · 0 fail · graph 3569 nodes / 4005 edges / 1875 files · zero `.td` (migration complete). **ALL original audit criticals + highs cleared (8):** VSC-001 (crit), VSC-002, VSC-003, CRYPTO-001, CRYPTO-002, CRYPTO-003, GOV-001, GOV-003. Residual: GOV-003 intermediate-binding-rename (dataflow follow-up); the audit's 10 medium / 10 low / 6 info remain as backlog.

**Security — adversarial Gate-6 audit (23 confirmed):**
- ✅ **CRYPTO-001 (high) FIXED** (`16145bd`) — certified mode silently permitted a post-quantum downgrade: the construction guard required only the Ed25519 `publicKeyPem`, so `checkBridgeAttestation` admitted bridges on the classical half whenever `mlDsaPublicKey` was unprovisioned. Now throws **`ERR_CERTIFIED_NO_PQ_KEY`**; certified-profile tests migrated to hybrid attestation + a no-downgrade guard test (183/183 tower-citizen).
- ✅ **CRYPTO-002 (medium) FIXED** (`a1d7cee`) — `verifyFfsimAdmission` now requires hybrid by default (Tier-3 toxic border; `ERR_QUANTUM_PQ_REQUIRED`); `requireHybrid` added to `AttestationPolicy` + honored in `checkBridgeAttestation`; `requireHybrid:false` opts down. quantum 21/21.
- ✅ **VSC-001 (CRITICAL) FIXED** (`915b16d`) — taint escape: `isGovernedSink` had diverged from the authoritative `SINK_REQUIREMENTS`, so unsafe/tainted values reached `response.body` / `ai.remoteInference` / `network.outbound` / `log.write` / bare `database.write` / `http(s).get` with **no diagnostic**. `isGovernedSink` now ⊇ `getSinkRequirement()` (single source of truth) + 4 regression tests.
- **Full audit RE-VERIFIED (2026-06-16): 37 raised · 32 confirmed** (raw: `tasks/w6lqlqgck.output`). Closed: VSC-001, CRYPTO-001, CRYPTO-002. **Open HIGH backlog — deliberate, individually-tested (do NOT batch on auto):**
  - ✅ **VSC-002 FIXED** (owner decision A) — `trap` no longer declassifies (was: any identifier *mentioned* in a trap condition had its taint cleared, laundering unsafe values into injection sinks). `trap` is now value-state-neutral; declassification requires an explicit `validate.*`/`sanitize.*`/`redact()` gate. trap-decl tests rewritten to the fail-closed semantics. 48/48 · 4,466.
  - ✅ **VSC-003 FIXED** — secret/network/log/serialization recognizers bailed on any non-identifier receiver, so a memberExpr receiver (`client.http.post`, `ctx.secrets.get`, `obj.log.info`, `app.json.encode`) bypassed every one (LLN-SECRET-002/PRIVACY-002 silently skipped). Added a shared `receiverSegment()` (last dotted-path segment) routed through all four — fail-closed, additive. +3 tests. 48/48 · 4,469.
  - ✅ **GOV-001 FIXED** (`00f387a`, owner-ratified) — `permitted_effects` K3 state machine (omitted=neutral/auto-inherit · empty `{}`=deny-all · populated=allow-listed) + unresolvable `conforms_to` = fatal in production/deterministic (was fail-open). KB §7a. +4 tests. · ✅ **GOV-003 FIXED** (`99f0025`) — denied response fields can't leak via member/positional returns (`collectBodyFieldNames` broadened + redact/seal discharge); **residual ✅ FIXED (2026-06-20):** the intermediate-binding RENAME (`let e = user.email; return e`, incl. alias-of-alias) is now caught — `collectBodyFieldNames` builds a precise alias-carry map (direct field-access / identifier renames only; opaque call results carry nothing → no false positives) + 4 regression tests in `gov003-response-leak.test.mjs`. · ✅ **CRYPTO-003 FIXED** (`f43dbf6`) — `hardwareSeal`/`epilogueReceipt`/`liabilityProfile`/`physicalHardeningTier` now bound under the gov signature (canonical sub-hashes; in-place pre-persistence per the VERSIONING charter).
  - 🔲 **CRYPTO-003** — the governance signature omits several security-relevant ProofGraph fields. **Versioning-sensitive** (crypto-format bump per the design-stability charter — handle deliberately).
  - **+10 medium · 10 low · 6 info** (QB-001 admission-not-structurally-enforced, VSC-004/005, GOV-002/004, CRYPTO-004/005/006, dead-code/style) — full triage list in `tasks/w6lqlqgck.output`.
  - ✅ **Low cleanup done** (`cleanup` commit): DEAD-001 (TamperResponseStrategy → single source of truth for VALID_TAMPER), DEAD-002 (dead `hasNode` removed), DUP-001 (duplicate context extractor consolidated). 🔲 REDUN-001 (LLN_SUBSTRATE_00x const consolidation across substrate-inference/-model) deferred — analogous to DEAD-001 but cross-file diagnostic construction.

**Benchmark — Gate 9 (`8273ad3`):** `crypto-ops` now measures **ML-DSA-65 + hybrid Ed25519+ML-DSA-65**. PQ-tax: hybrid verify ≈ 1.75 ms (~17× Ed25519), sign ≈ 6.7 ms (~84×); sigs/keys ~50× larger. governance-cost unchanged within noise. These rows are an **R4 regression gate** — PQ stays at amortized admission/build boundaries, never the per-decision hot path.

**R&D adjudication:** `notes/35-hashing` (photonic "THA-162" ternary hash) **rejected** — contradicts crypto-on-core (analog optics can't compute a bit-exact hash; security-by-radix is an encoding illusion; IOTA's Curl ternary hash was broken → reverted to binary Keccak). Keep SHA-256; PQ the *signature* (ML-DSA-65, shipping).

**Open CLI/DX (filed):** #125 `logicn run --governed` · ✅ **#126 parser-level bitwise hint** (`2026-06-20`) —
`& | << >>` in expression position now get the clear `LLN-PARSE-001` crypto-on-core hint (matching the lexer's
`^`/`~`), with recovery that suppresses the confusing follow-on. Done in the `parseExpression` binary loop (value
context — so it never flags generic `<<`/`>>` in TYPE position or `|` match-arm patterns, which parse elsewhere).
+5 tests; SOT 3710. **NB:** bitwise ops are *intentionally* NOT LogicN operators (crypto-on-core boundary) — #126 is
the HINT, not the feature.

**Tech debt this cycle:** CRYPTO-002 + 14 unverified findings; `crypto-ops` ML-DSA numbers are pure-JS upper bounds (native binding would re-baseline); governance-cost LogicN-runtime variants need a clean re-measure (old baseline had incomplete fields).

---

## 📍 Current snapshot (2026-06-06)

**Governed Inference Tower hardening (logicn-tower-citizen, 106 tests):**
- `CF-3/CF-7` **bridge attestation** — Ed25519 sign/verify + sha256 manifest & addon-hash pinning; `ERR_BRIDGE_UNATTESTED` fail-closed; `logicn bridge-attest` CLI (keygen/hash/sign).
- **P9 Certified Profile** now mandates signed bridges (`ERR_CERTIFIED_NO_ATTESTATION`), governed egress, and per-call `approved_models`+`max_tokens`+`max_token_cost`.
- **Enforced V_DPM capability gate** — branchless `(required & granted) === required`; `ERR_CAPABILITY_DENIED` before any compute (the bitmask was decorative; now live).
- **Numeric policy table** — `ai{}` compiled once → packed i32 flags + O(1) `Set` membership + pre-paid certified preconditions (2.04× on the governance-check slice; scales with allow-list size).

**P9 self-hosting bootstrap (logicn-core-compiler) — ✅ COMPLETE: emission AND execution byte-parity:**
> HISTORY (2026-06-06): an earlier claim said the lexer "compiles to a real wabt-assembling WASM module".
> At the time that was overstated — the MODULE referenced undefined stdlib fns (`$charCount`/`$Ok`/`$Some`/`$None`),
> so real wabt rejected it and `assembleWAT` fell back to a 240-byte minimal-encoder stub. That gap is now CLOSED:
> the stdlib runtime (#145) is wired, the lexer module wabt-assembles to a real binary, and `tokenize.wasm`
> byte-matches the interpreter (golden: `tests/wat-p9-tokenize-parity`, 21 cases).
- `P9.4a` guarded-flow WAT bodies · `P9.4b` record struct layout (construct + `r.field` access, verified in real WASM) · `P9.4c` guarded-flow export gating.
- **#145a MILESTONE (2026-06-06): the self-hosted lexer module now wabt-assembles to a real WASM binary.**
  `charCount`/`Ok`/`Err` wired to host imports + `__array_append` returns the array handle (last linking
  blocker cleared). The module LINKS + produces a valid binary via real wabt (verified, not the stub).
  **#145b ✅ DONE: token-VALUE correctness via type-aware string lowering** (String `+`→`__str_concat`;
  `Char.toString`→`__char_to_string`) with String/Char var-type tracking (incl. `Option<Char>` match bindings),
  the host output reader (`readResult`/`readArray`/`readRecordField`), and string-intern exposure
  (`getInternedStrings`/`seedString`). **Linking AND string semantics done — `tokenize.wasm` byte-matches the
  interpreter (golden: `wat-p9-tokenize-parity`, 21 cases).**

**P9 EXECUTION PARITY → ✅ ACHIEVED (2026-06-06):** `tokenize.wasm` runs through the #105 admission gate and its output byte-matches the interpreter across a 21-case corpus (incl. string-heavy paths: `char_to_string`, `str_concat`, escapes, `Option<Char>` match bindings). The host-import runtime (string table + `__array_*`/`__str_*`/`__char_*` bridge + list/record memory walk) is wired into `WebAssembly.instantiate`. Golden: `tests/wat-p9-tokenize-parity.test.mjs` (21/21). Both the WASM execution parity AND interpreter-level Stage-A==Stage-B parity (lexer-parity + R6 #101) are now locked.

### Next up (ordered)
0. ✅ **#105 — WASM admission-gate harness (security core, 2026-06-06):** `wasm-runtime.ts`
   — attestation-first Ed25519 verify BEFORE host linking (tampered/unsigned → `CRITICAL_SECURITY_VIOLATION`,
   no instantiation), closed-allowlist host imports (no ambient scope), dev/prod differ ONLY in
   observability (host-call log / trap memory dump); proven in real WASM (5 tests). The locked
   security boundary is built.
1. ✅ **Tokenize EXECUTION byte-parity — DONE (completes P9, 2026-06-06):**
   - ✅ **#144 enum-variant member lowering (2026-06-06)** — `EnumType.Variant` → declaration-order i32 tag
     (`buildEnumVariants` registry); **all 9 `tokenize` placeholders eliminated**, verified in real WASM
     incl. enum-in-record round-trip (tests/wat-p9_4d-enum-lowering, 4 tests).
   - ✅ **#145 — type-aware STRING semantics DONE (2026-06-06):** the lexer builds token values via
     `value = value + nc.toString()`. String `+` now lowers to `__str_concat` and `Char.toString` to
     `__char_to_string` (was: `i32.add` handle arithmetic / `__int_to_str` decimal). Shipped + wired:
     `__str_concat` + `__char_to_string` host fns (`src/wasm-runtime.ts:225,266`); type-aware lowering
     (`src/wat-emitter.ts:880,1008`); String/Char var-type tracking incl. `Option<Char>` match bindings
     (`src/wat-emitter.ts:1328-1336,1546-1568,1854-1862`); string-intern table exposure
     (`getInternedStrings`/`seedString`, `src/wat-emitter.ts:524` + `src/wasm-runtime.ts:297`); list/record
     output reader (`readArray`/`readResult`/`readRecordField`, `src/wasm-runtime.ts:299-305`). `tokenize.wasm`
     == interpreter byte-for-byte (golden: `wat-p9-tokenize-parity`, 21 cases). No `;; unresolved` markers remained.
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
| **#127** | **Shape-stable governance objects** (V8 hidden-class / inline-cache discipline). Keep hot-path governance objects (PolicySnapshot, GateDecisionInput, DecisionToken, ForensicEvent, and a future Passport/ModuleIdentity) **monomorphic** — fixed field order, no dynamic property add/delete — so the engine keeps a stable hidden class (faster validation, deterministic replay, stable cache keys); fixed structs in the future deterministic/WASM core. Rule: *optimize the path to the decision, not the decision* (consistent with GateCache #194 + the R4 PQ-tax gate). Profiling/design task — **partly already realised** (numeric policy table, V_DPM bitmask). | Perf/design |
| **#128** | **GAP-4 (enc-rnd dogfooding): `for…in` not lowered to WASM — and SILENT.** `forEachStmt` parses + executes in the Stage-A interpreter, but `wat-emitter.ts` has **no case for it** (confirmed — zero `forEachStmt` handler), so under Stage-B the loop body silently never runs (no-op, no error). **Two parts:** (a) **safety (priority) — ✅ DONE 2026-06-17** — `emitBlockStatements` `default` branch no longer emits the silent `(i32.const 0) ;; unhandled stmt` fallthrough; it now emits an atomic `(unreachable) ;; unsupported-in-WASM: <kind>` fail-closed trap (mirrors the ensure/trapDecl gates + flow-stub discipline ~L413-435). Confirmed: the module still assembles (wabt-valid) but traps at runtime instead of returning a wrong result. Regression test `tests/wat-failclosed-unsupported-stmt.test.mjs` (4 cases: no silent no-op, fail-closed trap emitted, module well-formed/assembles, supported `while` unaffected). `test:core` green (compiler 3459). (b) **feature (follow-up, OPEN)** — implement real `forEachStmt` lowering (block+loop+iterator over the collection); when it lands, flip the for-in cases in the regression test from "traps" to "lowers correctly". | Stage-B / safety |

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
- **Ceremony — EXECUTION-PARITY half ✅ DONE (2026-06-06):** `tokenize.wasm` runs through
  the #105 admission gate and its output byte-matches the interpreter. The full host-import
  runtime (string table + `__array_*`/`__str_*`/`__char_*` bridge + list/record memory walk)
  is wired into `WebAssembly.instantiate`. Golden: `tests/wat-p9-tokenize-parity.test.mjs`
  (21/21, incl. string-heavy paths).

### Post-P9 — real DSS.wasm (DRCM Phase 4)
- #102 dss/index.lln → build/dss.wasm via Stage B
- #103 Wasmtime component supervises DWI guests · #104 real fuel · #105 `logicn run`
  on the real DSS component · #106 receipt signing in DSS.wasm

### 🔒 Flagged externals — blocked on an external dependency or explicit go-ahead (DOCS ONLY)
These are recorded, not started. Each line = **status + blocker**. Do NOT implement or run any of these here.

| Task | Status | Blocker |
|---|---|---|
| **#102** — compile `dss/index.lln` → `build/dss.wasm` via Stage B | 🔲 BLOCKED (pending) | P9 string-runtime (#145/#143) is **✅ DONE** — no longer a blocker. Remaining: drive the full self-hosted Stage-B pipeline (parser/type-checker/govern/emit `.lln`) to module-assembly + link parity for `dss/index.lln` (today only `lexer.lln` reaches WASM byte-parity), plus the Wasmtime component host (#103). |
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

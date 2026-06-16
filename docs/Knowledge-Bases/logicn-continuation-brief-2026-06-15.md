# LogicN — Continuation / Handoff Brief (2026-06-15)

**Purpose:** read-first state document so a fresh session (or this one) can continue
**without re-deriving context**. Authoritative status lives in `logicn-runtime-status-SOT.md`
+ the auto-memory SOT; this brief is the *recent-work* snapshot + the audit scope.

---

## ⭐⭐ READ FIRST — 2026-06-16 session (supersedes the 2026-06-15 "START HERE" below)

**State: 48/48 packages · 4,371 tests · 0 fail · graph 3,563/4,001/1,870. 23 commits on `Initial commit`,
ALL LOCAL** (push blocked — no GitHub creds; then needs `--force` over the re-initialized history + **key
rotation** — the leaked `.env.logicn-signing` must be rotated; scrub ≠ rotation).

**Shipped this session** (detail: ledger §5/§6/§7):
- **#200/P10 integrity close-out** — doc reconciliation; **#177 graph fix** (`.lln` packages now index);
  full-repo 14-cluster audit (48 findings); idea-mining (8 repos → 12 ranked). Docs: `logicn-200-closeout-2026-06-15.md`, `logicn-external-idea-mining-2026-06-15.md`.
- **#201 calibration-as-attestation (contract portion)** — measured `BridgeManifest` fields (`comparabilityHash`/
  fidelity-floor/`toleranceWitness` + "can't claim tighter than measured") + `QuantizationMethod`; an adversarial
  review CAUGHT + I FIXED a real attestation-injectivity fail-open (non-finite `tolerance` → `canonNum`).
  Enforcement VERIFIED end-to-end (`hybrid-engine→verifyAttestation→validateManifestShape`). Doc: `logicn-precision-attestation.md`.
- **#202 honesty pass** — README counts 44/44·4,129→48/48·4,371 + "0 audit findings" corrected; FFSM banner;
  scaffold READMEs (data-query/registry/ai/ai-neural); manifest-generator/gate-cache/egress-tamper/LEXER_PARITY/app-kernel-TODO.
- **Audit fixes** — border-check tests; sentinel `instanceof` fix; graph-dup (vendored `project-graph` NOT mergeable → hardened `canReach`).
- **R&D ingestion (.tmf + tri-encryption)** — `logicn-rd-adoption-2026-06-16.md` (memory `[[logicn-tmf-tri-encryption-rd]]`).
  **U1 LANDED** = `tests/patterns/pattern-10-verify-before-decrypt-gate.lln` (runs on WASM, fail-closed). U3/U4 done.
  All **3 dogfooding findings FIXED** (#1 reserved-keyword diagnostic; #2 secure-flow-not-in-WASM-surface diagnostic; #3 CLI bool args were silently mis-marshalling → now loud).

**Next — ALL need a decision (no clean autonomous items left):**
1. **#201 #3/#4 substrate witness** — DESIGN: let an *attested* `toleranceWitness` refine the conservative anti-gaming `LANE_PROFILE` floor? (precision-attestation.md §"Next increments #3").
2. **U2/#204** — "no cleartext semantic embedding across a trust boundary" — needs a LogicN model (type? egress governance? new `LLN-PRIVACY-*`).
3. **B — storage/compute precision split** (`int4`/`int8` + Tower Records + manifest fields) — forward-looking, no current user; wants a nod.
4. **User-gated:** cert-profile-in-signed-pre-image (HIGH) · #149 key rotation · fusion-B2 ABI · `policy{}` deferred (R&D).
5. **Cleanup (flagged):** root `test-output.txt` 409KB · 5 scratch `test_*.mjs` · 24 `.pdb` ~32MB.

**R&D recommendation (mine):** TASK 2 (ML-DSA-65 spec → unblocks #34) + golden-vector oracle first; hold the `.tmf` engine / confidentiality / MeshQL builds.

---

## ⭐ START HERE — next session (2026-06-16) [PRIOR — 2026-06-15 session's note; superseded above]

**Last session (evening 2026-06-15) was docs-only — no code changed, suite still green at §1's
4,245/0.** What landed:
- **TMX-256 / TriMerkle-XOF boundary review** (a separate project, TritMesh, keeps proposing
  crypto for LogicN via discussion-only notes): `notes/31` (ML-DSA≠hash category error), `notes/32`
  (even the *corrected* TMX doesn't transfer — explainer to the other AI), `notes/33` (evidence
  dossier: every point quoted from code, file:line). **Verdict: keep SHA-256 + ML-DSA-65-over-digest;
  do NOT adopt TMX / invent crypto / couple to `.tmf`.**
- **Photonic/ternary R&D agenda** (the legit lane the review clarified — LogicN as the *governance
  layer* for such substrates, not the hardware/crypto): `docs/Knowledge-Bases/logicn-photonic-tri-substrate-rd-agenda.md`
  (in KB index). Auto-memory: `logicn-photonic-tri-rd.md`. User chose **KB-first** (agenda before code).

**▶▶ MOST RECENT STATE — read this first (2026-06-15 late · suite 48/48 · 4,360 · 0 fail):**
- **R&D photonic/tri — ALL 3 DIRECTIONS SHIPPED** (A 3-valued governance, C noise model, B `substrate{}`
  contracts + `LLN-SUBSTRATE-001..004`) + new `@logicn/substrate-math` pkg. Record:
  `C:\wwwprojects\LogicN-R-AND-D\photonic-tri-governance\00-OVERVIEW.md`. **Crypto UNCHANGED by design.**
- **Quantum-resistance posture RECORDED → DECISION: KEEP SHA-256** (already quantum-OK; Grover→128-bit).
  The PQ work is the SIGNATURE: finish ML-DSA-65 over the SHA-256 digest (#34), hybrid w/ Ed25519.
  Doc: `logicn-quantum-resistance-posture.md`; candidate enforcement `LLN-CRYPTO-PQ-001`.
- **ffsim quantum bridge — Phase 0 + Phase 1 SHIPPED** (`packages-logicn/logicn-ext-bridge-quantum`, 12 tests):
  Phase 0 = shared-manifest tolerance-certified extension (fail-closed pins, hash-preserving); Phase 1 =
  pure-TS governance core (`subspace.ts` governor, `limits.ts` gate, `quantum-contract.ts`, `manifest.ts`,
  `env-detect.ts`, `ffsim-backend.ts` LOAD→TRAP→ERASE, registry, `schemas/data_types.json`).
  Spec/status: `logicn-ext-bridge-quantum-design.md`. **NEXT: Phase 1.5** (wire tower-citizen `AuditLogger`
  + Ed25519 attestation into the lifecycle — pure TS, testable) → **Phase 2** (real hashed `ffsim_worker.py`
  + child_process driver — gated on a pinned venv WITH ffsim) → **Phase 3** (H₂ example flow + flip #199).
- **Honesty fixes landed:** README/ledger now say *Ed25519-live / ML-DSA-65-planned*; CBOR tags 410/414/415
  marked declared-only; `logicn new` CLI verb; #105 disallowed-host-import fail-closed. Integrity audit:
  `logicn-integrity-audit-2026-06-15.md`.
- **Deferred (deeper parser work, NOT shipped):** #148 contract-level `policy{}` + #110 `secrets{rotation}`
  (both dropped at parse — need parser support, verified by AST dump).
- **No git ops this whole session. TCB items PARKED pending explicit go-ahead:** cert-profile signature
  pre-image + #149 committed-key scrub.
- **Pending research chips (re-spawn if lost on restart):** encryption-on-photonic + .tmf expansion — both
  in the **TritMesh** project (`C:\wwwprojects\LogicN-TritMesh`), grounded in the boundary notes.

**DONE since (suite now 46/46 · 4,282 · 0 fail):**
- ✅ **R&D Directions A + C + B — ALL SHIPPED** (forked session; record at `C:\wwwprojects\LogicN-R-AND-D\photonic-tri-governance\00-OVERVIEW.md`):
  - **A** three-valued governance (`ALLOW/DENY/INDETERMINATE`), proved fail-closed, `LLN-GOV-3VL-001`,
    `tower-citizen/src/three-valued-governance.ts`, spec `logicn-three-valued-governance.md`.
  - **C** substrate failure-mode noise model (`tower-citizen/src/substrate-model.ts`, seeded NMR;
    *noise costs availability, never safety* — `effectiveVerdict = vAnd`), spec `logicn-substrate-failure-model.md`.
  - **B** `contract { substrate { lane; tolerance; redundancy } }` block + compiler pass
    (`core-compiler/src/substrate-inference.ts`), `LLN-SUBSTRATE-001..004`. **B1 = crypto-on-noisy-lane**
    (the durable TMX-thread insight, now enforced). Spec `logicn-substrate-contracts.md`.
  - **New package** `logicn-substrate-math` (shared NMR, single source of truth, dedupe).
  - **Real fail-open bug found+fixed** by adversarial review: the lexer had no scientific-notation, so
    `tolerance: 1e-6` → `[1,e,-,6]` → silently loosened to `1.0`. Root-cause fix in `lexer.ts` (language-wide).
  - **BitNet fidelity audit** (spawned): `tpl-simulator` confirmed byte-faithful to BitNet I2_S.
  - **Crypto explicitly UNCHANGED** (SHA-256 + ML-DSA-65 stay; guardrail working as intended).
  - **Verified (re-confirmed by me):** 47/47 packages · 4,346 tests · 0 fail · graph clean (2,994/3,764).
  - **Open follow-ups (documented, not done):** lane↔hardware evasion check (next spike) · per-lane noise
    profile registry · `routePrecision()` lane axis · HMAC-bound `SubstrateModelSnapshot` · substrate-math
    standalone `npm install`.
- ✅ **#179 LEDGER (#146)** — `logicn ledger <egress-dir> [--json]` CLI (post-hoc, off the hot path),
  deny-by-default. `devtools-pci/src/cli.ts` + `logicn.mjs` (injection-safe spawn) + 3 CLI tests (24 total).
- ✅ **#179 POSTURE (#195)** — `createAppKernel` resolves `'auto'` fail-secure via `@logicn/core-config`
  `resolvePosture` (relative-dist import; single source of truth) and records the resolution on each
  audit event. **Strictly additive: default stays `'off'`, only `'auto'` triggers resolution.**
  `app-kernel/src/kernel.ts` + 5 tests (38 total).
- ✅ **#179 dead-code sweep** — nothing to delete: the 3 flagged "orphans" were all intended deliverables.
  Posture + ledger are now wired; **fusion is a working build-time primitive** (`logicn build --package`
  → e2e-fuse, 10 tests) → **keep-document, not orphaned**.

**Auto-completable wirings close-out (2026-06-15 late · suite now 46/46 · 4,304 · 0 fail):**
- ✅ **`logicn new` verb** — wired the CLI verb → `scripts/logicn-new.mjs` (injection-safe spawn). #176's
  scaffolder is now reachable as `logicn new <dir> [--name]`, not just a standalone script.
- ✅ **CBOR tags 410/414/415 — honest downgrade** (NOT serialization). Tag 410 (AuditEvent) is **runtime-only
  by design** (serializing it would make the manifest non-deterministic); 414/415 are **declared-only**,
  deferred to Phase 5. Fixed misleading comments + `MmcpCapabilityPointerStub.status: "declared_only"` +
  `logicn-cbor-manifest-spec.md` status column. 416/417 confirmed ACTIVE. (manifest 18/18.)
- ✅ **#105 negative path** — a module importing a DISALLOWED host fn now fails **closed** at link
  (`wasm-runtime.ts:341` try/catch → `CRITICAL_SECURITY_VIOLATION` + `onViolation`), not a raw `LinkError`.
  +1 test (admission gate 6/6).
- ⛔ **#148 `policy{}` verifier — REVERTED (deeper than wiring).** Verified by AST dump: contract-level
  `policy {}` is **dropped at parse** (contractDecl has no policy node); the `policy:block` node only
  exists inside `resource {}` (under `resourceDecl`, not `contractDecl`). A verifier "wiring" would be a
  **no-op / dead code** (the GateCache anti-pattern). Real fix = parser-level (structure contract-level
  `policy{}` + locate resource policy blocks). Flagged, not shipped.
- ⛔ **#110 secrets rotation — DEFERRED (deeper than wiring).** Verified by AST dump: `secrets:block`
  survives but the nested `rotation { interval/strategy/onRotationFault }` is **dropped at parse** — only
  `decl:credential <name>` remains, with no rotation fields. `SecretsRotationManager` exists in
  `ext-secrets-vault`, but there is **no parsed rotation data to wire to it**. Real fix = parser captures
  the rotation sub-block → verifier validates → manifest `rotationPolicies?` field. A genuine feature, not
  a wiring. Flagged, not shipped.
  **Lesson:** the integrity audit's "auto-completable" label for #148/#110 was over-optimistic — both
  need parser support the change-point analysis missed. VERIFY-BEFORE saved two dead-code commits.

**Pick up next (in rough priority):**
1. **#179 FUSION (B2) — DECISION NEEDED.** Kernel-lifecycle fusion is blocked on an ABI mismatch: the
   fused `.wasm` is a sync `invoke(name, ...i32) → i32` (`fuse-loader.ts:411/458`), the kernel handler is
   `async (ctx) → HandlerResult` with full request/policy/JSON (`kernel.ts:48-62`) — no lossless bridge,
   and the fused REST adapter already does its own routing/deny-by-default (duplicating kernel steps 2/4/5/7).
   Options: **A** thin handler at step 10 only (lossy, kernel stays authoritative; lowest risk if it must land),
   **B** seam routing (fused wasm owns dispatch — architectural), **C** keep-document + revisit when the ABI
   exposes structured request/response (zero-risk default, taken this session), **D** extend the wasm ABI first
   (multi-step). *Recommend D when ready; C holds until then.*
2. **R&D Direction C** — substrate failure-mode model in the verifier (extend `tpl-simulator`); then B.
3. **Fresh-session audit** (steps 6/8/10) — see §6.
4. **Full benchmark analysis table** vs Rust/Python/Node with winners marked (still pending).
5. **Open chip** `task_488d7c8c` — regression test pinning `sourceFile` inside the signed manifest body.

Build/test/run cheatsheet is §3. Guardrails below still apply.

---

## 0. Guardrails (always apply)
- LogicN stays a **TypeScript-like `flow` + `contract`** language. The `notes/30-notes*.md`
  files are **discussion-only** (Citadel / photonic CPU / middleware-fusion / Zig / `.tmf`
  TritMesh DB are **NOT adopted**; TritMesh is a **separate** project — do not couple to it).
- **Zero Trust Framework** bar on everything: deny-by-default, no ambient authority, least
  capability, fail-closed, actor-aware audit, explicit data exposure, OS/HW-as-compromised
  posture (#195), AI-proposes / compiler-verifies / runtime-authorizes / human-approves.
- Every `match` MUST end with a mandatory `_ =>` (or `else =>`) wildcard — **LLN-TYPE-023** (#174).

## 1. Verified state (2026-06-15)
- **Full suite: 45/45 packages → 46 with `logicn-api-protocol-rest` · 4,245 tests · 0 fail**
  (`node scripts/run-all-tests.cjs`). tower-citizen 124, app-kernel 33, core-config 25,
  devtools-pci 21, compiler ~2,859.
- Project graph: **2,977 nodes / 3,742 edges** (`node packages-logicn/logicn-core-cli/dist/index.js graph --out build/graph`).
- Benchmarks: ran clean; **no runtime-benchmark movement** vs git baseline `93f2b2d` (session
  changes were compile-time or reverted — see §4).

## 2. What landed this session (inventory)
| Area | Files | Task |
|---|---|---|
| **App Kernel P1** (real TS, was spec-only) | `logicn-framework-app-kernel/src/{types,route-defaults,kernel,fuse-loader,index}.ts`, `tests/*`, `tsconfig.json`, `package.json` | #172 |
| **Fuse B1** (package `/src`→`.wasm`) | `logicn.mjs` (`build --package`, signed `fuse` block in `.lmanifest`), `examples/fuse-demo/my-custom-api-rest/` | #175 |
| **Fuse B2** (governed loader) | `logicn-framework-app-kernel/src/fuse-loader.ts` (wasm-hash + sig verify, deny-by-default host imports) | #175 |
| **Fuse B3** (reference adapter) | `logicn-api-protocol-rest/` (package.lln.json, src/index.lln, tests/e2e-fuse.test.mjs, package.json, dist/) | #175 |
| **#195 posture** | `logicn-core-config/src/posture.ts`, `tests/posture.test.mjs` | #168 |
| **#194 GateCache** | `logicn-tower-citizen/src/gate-cache.ts`, `tests/gate-cache.test.mjs`, `index.ts` export; `hybrid-engine.ts` (wired→**reverted**, see §4) | #167 |
| **#196 ternary gates** | `logicn-tower-citizen/src/tpl-simulator.ts` (sumTrit/xorTrit/carry/min/max/consensus/neg), `tests/ternary-ops.test.mjs` | #173 |
| **#174 `_=>` rule** | `logicn-core-compiler/src/type-checker.ts` (LLN-TYPE-023, retired LLN-TYPE-021) + sweep of 191 matches across 26 `.lln` | #174 |
| **#153 hardening** | compiler `value-state-checker.ts` (taint unknown-origin→tainted), `effect-checker.ts` (LLN-STDLIB-002 unknown-effectful→denied), `index.ts` (triToBool) + tests | #153 |
| **#146 ledger** | `logicn-devtools-pci/src/compliance-ledger.ts` (+ index, tsconfig, tests) | #146 |
| **#176 scaffolder** | `scripts/logicn-new.mjs` | #176 |
| **#150 counts** | `scripts/run-all-tests.cjs` (`--emit-counts` → version.json + SOT line) | #150 |
| **Dev hook** | `scripts/rebuild-fusable-packages.mjs` + `.claude/settings.json` (first Stop hook, before phase-close) | — |
| **Docs** | `logicn-framework-layer-design.md` (L0–L3, §10 secure defaults, §11 fuse, P1/B2/B3 done, REST+SOAP example), `compiler-diagnostics.md`/`formal-type-system-spec.md` (LLN-TYPE-023), `logicn-build-roadmap.md` (flagged externals), 3 framework READMEs (template banners) | #154 + |

## 3. Build / test / run cheatsheet
- **TS packages whose own `tsc` isn't on PATH** (app-kernel, core-config, devtools-pci, tower-citizen):
  `cd <pkg> && node /c/wwwprojects/LogicN/packages-logicn/logicn-core-compiler/node_modules/typescript/bin/tsc -p tsconfig.json && node --test tests/*.test.mjs`. (Fix properly via **#155** npm workspaces.)
- **Full suite:** `node scripts/run-all-tests.cjs` (`--core` fast, `--emit-counts` writes counts, `--list`).
- **Fusable packages** (have `package.lln.json`): `node logicn.mjs build --package <dir>` → `<dir>/dist/`.
- **Benchmarks:** `npm --prefix packages-logicn/logicn-devtools-benchmarks run run` (or `run:quick`, then `compare`). GateCache micro-bench: `node packages-logicn/logicn-devtools-benchmarks/benchmarks/gate-cache/bench.mjs`.
- **Graph:** `node packages-logicn/logicn-core-cli/dist/index.js graph --out build/graph`; KB graph: `node logicn.mjs kb-graph`.

## 4. ⚠️ GateCache finding — a CLASS of issue to hunt for
GateCache (#194) was **built + tested but wired nowhere**, and when wired it was **~38× SLOWER**
(cold `compilePolicy` ≈ 56 ns — the #140 branchless table; GateCache content-hash key ≈ 2,150 ns).
**Reverted** (`hybrid-engine.ts:244` uses `compilePolicy`; comment explains why). It stays an
**opt-in utility** for genuinely-expensive future evaluators only. It does **not** and **cannot**
move the `governance-cost` benchmark (that's a `pure flow`, no `ai{}`, interpreter-bound — the real
lever is **WASM execution**: governed `⟨interp⟩` 269K× vs WASM 60× slower-than-Rust).
**→ The audit should hunt for similar gaps: exported-but-unused modules, features that move no
metric, dead/redundant code, missing integrations.**

## 5. Open items
- **#177** graph: index pure-`.lln` fusable packages (`api-protocol-rest`, `fuse-demo` are absent as graph nodes).
- **#149** signing-key git-history scrub — **DESTRUCTIVE; needs explicit user go-ahead** (documented, NOT run).
- External infra (flagged, not in-repo completable): **#102/#103/#104/#106** (real wasmtime component model + fuel), **#110** (KMS key rotation).
- Other completable: #147, #148, #155, #156, #157, #158, #69.

## 6. Audit scope (user steps 6/8/10 — for the fresh session)
1. **Full code + architecture audit** of the §2 new/changed surface (App Kernel pipeline, fuse-loader,
   GateCache, compliance-ledger, posture, #153 hardening, `_=>` rule).
2. **Find new + missing elements like GateCache** (§4 class): unwired exports, dead code, missing wiring,
   redundant assets → **#155-style cleanup**.
3. **Zero-trust / security hardening check:** confirm every new path is deny-by-default + fail-closed
   (fuse-loader sig/hash/capability gates; kernel 12-step fail-closed; compliance-ledger deny-by-default;
   posture fail-secure; #153 checks).
4. **Standards cross-ref:** mandatory `_=>`, flow+contract, no notes-derived material; flag regressions.
5. Re-run full suite + graph + a benchmark sanity pass after cleanup.

## 7. Authoritative sources
`docs/Knowledge-Bases/logicn-runtime-status-SOT.md` · `logicn-task-ledger.md` ·
`logicn-framework-layer-design.md` · auto-memory `reference-logicn-runtime-status-sot.md`.

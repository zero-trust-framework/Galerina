# LogicN — Outstanding R&D + To-Dos catalog (2026-06-23)

Single source-of-truth for everything outstanding this cycle. Owner ask: *"anything not fully R&D, even a small
detail, send to R&D (multiple jobs); make sure it's correctly logged in R&D / todos / KB / docs; make sure missing
& incomplete packages are on the todo and/or R&D."* Status keys: **📤 dispatched** (R&D bridge task filed) · **🧪
designed** (design exists in KB, build pending) · **🔨 build** (engineering, no R&D needed) · **📋 todo** (logged,
unscheduled).

> **Rebuilt roadmap (SECURITY-FIRST): [logicn-roadmap-2026-06-23.md](logicn-roadmap-2026-06-23.md)** — fix security
> issues first; missing/stub packages are *consider-not-always*.
>
> **Landed since this catalog was first written (2026-06-23 cont.):** ✅ S1 cert-gate · ✅ sentinel-egress flaky fix ·
> ✅ graph-coverage fix (+28 pkgs) · ✅ 6 architecture diagrams · ✅ architecture + compiler-intelligence R&D
> (designs) · ✅ `contract.permissions{}` design · ✅ R&D results log + 95-row ledger · ✅ **3 dev tools**
> (status/rd-absorb/stray-docs, wired into the Stop cadence) · ✅ **api-server HTTP transport** (serves end-to-end,
> fail-closed, 5/5 e2e + adversarially reviewed). Live status: `node scripts/status.mjs`.

## A. R&D dispatched to the bridge (`C:\wwwprojects\LogicN-R-AND-D\_session-bridge\tasks\`)
| Task | Topic | Status |
|---|---|---|
| 0078 | OCSP staple-caching for the S1 `revocation_fresh` sub-verdict (availability vs Zero-Trust) | 📤 |
| 0079 | Is the application-framework structure best-possible for AI comprehension? | 📤 |
| 0080 | `contract{}` memory-cleanup / arena-reuse directive (zero-on-exit secrets) | 📤 |
| **0081** | Per-component photonic/tri gap verdicts (parser, tiered-runtime, resilience, test-gen, effect-checker, interpreter, WASM-P9, PQ/HW, .tmf, symbol-resolver, parity) | 📤 |
| **0082** | 16-packages photonic/tri verdicts + **missing/incomplete/stub package status** | 📤 |
| **0083** | Closed-capabilities photonic/tri variant (or confirm n/a) | 📤 |
| **0084** | Security standards × K3 three-valued — **PCI/DSS + full OWASP (Top10/ASVS/API/LLM) + CWE/NIST/MITRE/SLSA** (unknown→INDETERMINATE fail-closed) | 📤 |
| **0085** | **RAG-vulnerabilities rulebook-curator** (`E:\projects\RAG-vulnerabilities`) → reconcile `LOGICN_SECURITY_RULEBOOK` with the LLN registry + RAG/LLM-retrieval threat class | 📤 |

## B. R&D designed (in KB; build pending) — [logicn-architecture-rd-2026-06-23.md](logicn-architecture-rd-2026-06-23.md)
| Item | Where | Status |
|---|---|---|
| `contract.permissions { hardware.camera }` device-permission clause (V_PERM + LLN-PERM-001..006) | [logicn-contract-permissions-design.md](logicn-contract-permissions-design.md) | 🧪 |
| DRCM degrade-only photonic-confidence operand (keep V_DPM Binary) | arch-rd #13 | 🧪 |
| CBOR `.lmanifest` SubstrateAttestation tag (Tag 418) | arch-rd #7 | 🧪 |
| core-economics photonic ExecutionTarget + degrade-only cost axis (brake-only) | arch-rd #14 | 🧪 |
| core-security photonic-lane taint/egress rule | arch-rd #15 | 🧪 |
| Standardise `withSideSignal`/`vAnd` as the ONLY photonic/sentinel→verdict channel | arch-rd #6 | 🧪 |
| Per-package Tri-Pipe coverage as machine-checkable metadata | arch-rd #16 | 🧪 |
| **Compiler Intelligence (Doc 005)** — §2 Governance DCE pass (`LLN-GDCE-001`) · §3a `substrate{photonic}` envelope keyword · §3b value-level substrate-taint · §4 auto-resilience AST→GIR wrap | [compiler-intelligence](logicn-compiler-intelligence-deterministic-foresight.md) (wf `w2gzcbx9d`) | 🧪 design-complete → build |

## C. Build items (engineering — no further R&D needed)
| # | Item | Source | Status |
|---|---|---|---|
| 1 | **Wire S1 cert-gate into `kernel.ts:307`** (closes the audit's only HIGH; both audit + R&D rank #1) | audit + arch-rd #1 | 🔨 |
| 2 | **Fix the 2 WAT codegen fail-opens (#163 record-update → silent `i32.const 0`, #165 float)** — **VERIFIED REAL** 2026-06-23 (techdebt review:54-73; these are the #161-191 set, distinct from the #128 set the Phase-4 audit called "hardened" — both true). Fix-forward = emit `unreachable` (fail-closed) or lower properly; check WASM-parity test impact first | arch-rd #3 | 🔨 |
| 3 | Tainted-by-default at posture-gated entry boundaries (the 34B `value-state-checker.ts:1162-1191` hole) | audit + arch-rd #4 | 🔨 |
| 4 | Auto-discover `packages-logicn/*` as the project-graph manifest (kill the drift this session fixed by hand) | this session + arch-rd #5 | 🔨 |
| 5 | Expand the SEC-002 mutant catalog (3 B5a → one per shipped fail-closed gate; incl. cert-gate's 5 in-test guards) | audit + arch-rd #9 | 🔨 |
| 6 | De-color the tree-walker · 0014 fidelity harness · ML-DSA-65 #34 · hostile-host I/O contract (XL, #102-106) | arch-rd #8/#11/#12/last | 🔨 |
| 7 | #149 CI secret-scan + re-sign legacy old-key artifacts | audit (devsecops) | 🔨 |
| 8 | Adopt tower-citizen K3 `decideAtBoundary` as the universal admission collapse | arch-rd #2 | 🔨 |

## D. Missing / incomplete packages (todo + R&D 0082)
- `logicn-framework-api-server` → ✅ **BUILT** (real Node HTTP transport over the kernel; serves end-to-end, fail-closed, 5/5 e2e). `logicn-framework-example-app` still README+TODO → 🔨 build a real runnable example on the framework (NEAR).
- **Planned stubs in `logicn.workspace.json`** (README+package.json, not test-bearing): `logicn-data*` family, `logicn-web*` family, `logicn-db-*` adapters, `logicn-target-{js,wasm,native,gpu}` → 📋 classify (build vs stay-stub) per R&D 0082.
- **Photonic/tri verdict for each** → R&D 0082 (most target-* are software-tier n/a; real photonic target = `logicn-target-photonic`).

## E. Carried doc/tooling work (Phase 3 / earlier batch)
- `docs/contracts` correctness gate: add `assuming{}` doc, `permissions{}` (boot/task) doc, reconcile vs the clause-reference. 📋
- notes/ → KB refactor (copy KB-worthy content out, strip `/notes` refs from README). 📋
- ✅ **DONE** — stray `*.md` tracker shipped as `scripts/audit-stray-docs.mjs` (outside-/docs + duplicate basenames + kb-graph orphans/broken-links; `--summary` wired into the Stop hook).
- Benchmark rebuild: winner-ordered tables · min-token devtool · accuracy · **add "1 Billion Nested Loop Iterations"** · confirm correct file. 📋
- Audit hygiene: 10 stale `build/egress-test-*` ledgers committed; leftover `_scratch-effect006.mjs`; `.gitignore` `egress-it-*` doesn't match `egress-test-*`. 🔨

## F. Audit posture (Phase 4, workflow `wj6vrjkmg`)
No critical/exploitable issues; **no regressions this cycle**. One **HIGH** (pre-existing): `kernel.ts:307` presence-only
auth (cert-gate unwired) → closed by C#1. Full detail: task output `wj6vrjkmg.output`.

> Pointers: bridge `_session-bridge/tasks/0081-0085` · [architecture R&D](logicn-architecture-rd-2026-06-23.md) ·
> [permissions design](logicn-contract-permissions-design.md) · [2026-06-23 roadmap+%audit](logicn-roadmap-and-percent-audit-2026-06-23.md) · ledger §10.

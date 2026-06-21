# LogicN Roadmap — phase-close snapshot 2026-06-21

> A current-state roadmap produced at an autonomous phase boundary. Authoritative test/graph counts come
> from this session's runs (suite 53/53 · 4959; phase-close **all gates green** — graph **3740 nodes / 4136
> edges**, security/naming/provenance audits 0 errors, 68 manifests canonical, governance-diff neutral). All commits
> below are on `origin/main`. The success metric (owner) is the **soundness of the forward line to a
> golden-standard photonic language**, not "% shipped".

---

## 1. Shipped this session (non-framework, all pushed)

| Area | What landed | Commit(s) |
|---|---|---|
| **#165 f64 WAT lowering** | float-returning flows `(result f64)`, f64 locals (`watStackType`), float-arith contagion in `inferExprType` — end-to-end, +8 runtime tests; cross-flow/`if`/cmp follow-ups locked | `64dce9d`, `a63b6b8` |
| **#169 host Char classifiers** | `isUpper/isLower/isWhitespace` wired into the `logicn.mjs` run-host (had drifted behind `createHostRuntime`) | `9df005a` |
| **Memory model tests** | runtime arena-bound trap (governed==enforced) + use-after-reset aliasing (R&D 0055 audit gap) | `c0de2b4` |
| **NUL-byte hygiene** | de-binarized `wasm-runtime.ts` (literal NUL → `\0`, byte-identical, admission tests 7/7) so the P9 admission gate is grep/git-visible again; + a systemic guard test | `7483512`, `43269f2` |
| **Host-runtime completeness guard** | locks that `createHostRuntime` provides every emitter-declared host import (#169-class regression guard) | `2ba7652` |
| **Build/env-secrets doc** | how a LogicN app builds today (one signed `app.wasm` + per-package fusables) + the `.env` trust model folded in | `59ca508` |
| **Revocation registry v3 TODO** | worker handoff applied: v2 trust-anchor pinning marked IMPLEMENTED (verified vs code), v3 = root rotation + k-of-n (comment-only) | `c6206b2` |
| **Ledger/roadmap reconciliation** | verified-done: #174 (cmd-injection), #175 (keygen 0600), #194 (GateCache — deliberately unwired). Root-caused #171. **Found + tracked #200** (nested record member access). | `2cb4d35`, `a897679`, `f72b890`, `be17db9` |

**Broad WASM-codegen verification (probed, confirmed correct):** f64 (all forms), string methods (+ literal seeding), const-fold (respects the overflow trap), records (construction + 1-level access + params), method chaining, recursion + mutual recursion, for-in + `where`-filter, enum + int `match`. The codegen is mature; the **one** found gap is #200.

---

## 2. Architecture R&D — PARKED for owner (highest-leverage line)

The ecosystem/app-framework design is **done in the bridge, awaiting owner questions** (HOLD rule):
- **0056** ecosystem layouts (app layer + app-framework layer), **0057** trusted↔symbiote tensor handoff / Dual-Sympathy / pkg-manager class, **0058** kernel→`DSS.wasm`-on-Wasmtime (DRCM Phase 5) — all reconciled vs the live tree, + the grounded **master prompt** (`_session-bridge/MASTER-PROMPT-…`).
- **Locked decisions:** naming = *governed compute substrate* (L1) + *application framework* (L3, zero-trust/compile-to-WASM/no-middleware) under the **Zero-Trust Framework** brand; folder-level **BSL** (`/core` Apache, `/enterprise` BSL, B7 lint); `kernel.ts` = **Non-Bypassable Admission Gate**, not middleware; host → minimal **Wasmtime TCB**.
- The roadmap's **buildable-next (B1–B8)** are framework — they wait for owner go.

---

## 3. Open non-framework finds — tracked, need supervision / owner "go"

| Item | State | Why not done autonomously |
|---|---|---|
| **#200** nested record member access (`o.i.v`) → WASM | fail-closed to walker (works, no WASM); root-caused | medium emitter feature (field-type map + recursive lowering) — not a safe unattended edit to the critical emitter |
| **run-host unification** | `logicn run --wasm` broken for string-heavy flows (~11 missing host fns in the inline run-host) | result-reading refactor OR hand-mirroring code-point string fns — user-facing command, needs a "go" |
| **#171** in-band `-1` None sentinel | latent (`Some(x<0)`→None); root-caused | boxed-handle fix is wide blast-radius |
| **#172** `__int_to_str` i32 truncation | latent (i64 only) | gated on broader i64 support |

---

## 4. Parked framework + gated (owner / external)

- **2 NUL-byte fixes** in framework files (`kernel.ts`, inference `manifest.ts`) — same byte-identical fix as `wasm-runtime.ts`, but App-Kernel admission file is owner's to approve.
- **#149** signing-key git-history scrub — destructive, owner-driven.
- **DRCM Phase 5 / #102–106 / #110** — gated on Wasmtime component model + KMS.

---

## 5. Next line (recommended)

1. **Engage the parked framework R&D** (0056/0057/0058) — the highest-leverage move per the owner's own audit; unblocks the B1–B8 buildable line.
2. **Give a "go"** on the **run-host fix** and/or **#200** to convert the two concrete non-framework gaps into WASM coverage (both verified + scoped).
3. Otherwise the autonomous loop continues as **regression-watch + new-gap discovery** (it found #200 and the NUL-byte hazard this way).

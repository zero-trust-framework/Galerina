# LogicN application framework — detailed plan (2026-06-21)

Companion to the flowchart (source → signed WASM → admission → Tri-Pipe execution). This is the
architecture, the locked decisions, shipped-vs-build status, and the forward roadmap — including the
binary/hybrid/photonic fault-tolerance dimension (a dedicated re-R&D is in flight; its ranked
hardening plan folds into §6 when it lands).

## 1. What it is
A **zero-trust application framework**: compile-time conventions + a library of signed, governed
packages **fused at declared seams — NOT runtime middleware**. Governance is part of execution, not a
layer around it. The substrate (LogicN language + runtime) is **Binary/Hybrid/Photonic ("Tri-Pipe")
ready**; the framework / admission / crypto surface is **Binary-only by invariant**.

## 2. The stack (L0–L4)
| Layer | What | Status |
|---|---|---|
| **L0 Substrate** | language, compiler, governed tree-walker, WASM emitter | SHIPPED |
| **L1 Engines / Tri-Pipe** | `logicn-tower-citizen` + photonic emulator + `ExecutionRouter` + hardware-tier | SHIPPED |
| **L2 Admission / fusion border** | `fuse-loader.ts` 3 gates + `border-check` + `LinkError` + arena trap | SHIPPED; **vocabulary unified this session (B2)** |
| **L3 Framework conventions** | App-Kernel host + app-layout scaffolder + protocol adapters | scaffolder **BUILT (B1)**; kernel = non-bypassable admission gate |
| **L4 App** | a concrete `my-logicn-app/` (TritMesh = example only) | convention + scaffold |

## 3. Build & distribution
- `logicn build App.lln` → **one signed `build/App.wasm` + signed `.lmanifest`** (CBOR, Ed25519).
  Intra-app flows fuse to one wasm (`module-registry.ts`); cross-package = one signed wasm per
  package, host-linked at the fuse border (`planComposition`).
- **Capability binding lives in the signed `.lmanifest fuse{}` block** — never in `.tmf`.
- App layout (B1 scaffolder): `App.lln + App.manifest + flows/ + deps/ + proofs/ + tests/`, deny-by-default.
  **`tests/` = developer-authored tests** (hand-written, mirrors the monorepo `<pkg>/tests/` convention), kept
  SEPARATE from generated / contract-driven tests (R&D 0016) so a regen never clobbers hand-written ones —
  generated output lands under `proofs/` (or a clearly-marked `generated/`). Owner note 2026-06-22 (task #214).
- Distribution: `package-logicn.json` + lock + the **governed resolver** (hash + Ed25519 signature +
  registry origin + `installScript:deny`, LLN-PKG-001..006). `.env` = runtime-only secrets, never
  compiled in (prod = vault/KMS).

## 4. The admission border (security keystone)
Three **fail-closed** gates, deny-by-default:
1. **hash-pin** — `.wasm` sha256 must equal the signed descriptor.
2. **signature + revocation** — valid Ed25519 from a non-revoked key (revocation now enforced at the
   fuse gate **and** the resolver **and** `bridge-attest verify`, this session).
3. **closed capabilities** — a declared cap with no host-import factory refuses to fuse; an
   unresolved import is a link-time `LinkError → CRITICAL_SECURITY_VIOLATION`.

**Unified capability vocabulary (B2 this session):** the compiler ontology (`capability-types.ts`,
bit-wired to V_DPM) is canonical; `border-check` aliases onto it; the fusion gate is drift-guarded —
the two admission gates can no longer diverge.

## 5. Execution & the Tri-Pipe
`ExecutionRouter` routes each eligible compute kernel:
- **Binary** — default + universal fallback (the whole governed/crypto/admission surface).
- **Hybrid** — Binary core + offloaded kernels whose result is **Freivalds-cheap-verified**; net-win
  partitioned.
- **Photonic** — fully-eligible kernels only, **emulated today** (perf projected, not measured).

**Invariant:** crypto · governance · K3 · admission · secrets = **Binary-only**. Hybrid/Photonic must
**fail-safe to Binary**.

## 6. Fault tolerance / stability (re-R&D in flight)
Already shipped (don't re-derive): fail-closed core · arena bound + no `memory.grow` · integer
overflow/division traps that propagate out of bindings · DbC output post-conditions (`ensure result`)
· K3 dead-zone as fail-**safe** (0 = indeterminate → availability, not safety) · NMR closed-form
substrate tolerance · `substrate{}` + `verifySubstrate` · DRCM containment + Wasmtime TCB + fuel ·
fault-injection diagnostic suite · engineering goal C (no system crash).

### Tri-Pipe fault model (re-R&D `wpa9c3wqk`, 2026-06-21 — 4 pipes mapped, 24 hardenings adversarially verified)

**One uniform principle:** Binary is the universal floor; every higher pipe can only **decline down to
it** — never corrupt, never expand authority.
- **Binary (fail-CLOSED core):** traps/denies rather than proceeds. i32 overflow/div-zero traps
  propagate out of bindings/operands; K3 verdicts authorize ⇔ *exactly* ALLOW (INDETERMINATE → deny,
  never silent); empty clause set / `permitted_effects {}` = hard deny-all; DbC post-conditions are
  atomic single-exit gates; the committed arena traps over-budget. Crypto/governance/K3/admission/
  secrets/control/exact-arithmetic = Binary-only by invariant (the proven precision wall).
- **Hybrid (fail-SAFE to Binary, Freivalds-verified):** offload only on a proven absolute-ns net win,
  crypto/control never eligible; the result is cheap-verified (Freivalds / scalar tolerance) and on any
  drift / NaN / Inf the photonic value is DENIED and the *exact digital* value committed. Worst case =
  "stayed digital".
- **Photonic (tolerance/NMR, K3 dead-zone fail-SAFE):** emulator-only (`executedNatively=false`,
  honest); the K3 dead-zone is fail-safe-ONLY — `vAnd(ideal,reading)` is monotone, so substrate noise
  can only degrade a verdict toward DENY, never fabricate an ALLOW.

**Weakest link:** runtime crash-containment (Goal C / DRCM Phase 5) is **asserted, not demonstrated** —
the T-008 test is `assert.ok(true)` and `logicn diagnostic` only counts trap *declarations*, never
fires a fault. A second, **live** weak link was concrete and is now fixed (item 1 below).

**Ranked build status:**
1. ✅ **BUILT (`449d8f2`)** — made `dispatchPlan` total over exceptions: a photonic-port throw declines
   to the digital floor, a binary fault/drift becomes a governed `ERR_BRIDGE_DISPATCH_FAULT` `trapFired`
   receipt. The one live, code-confirmed break of fail-safe-to-Binary / no-crash. +4 tests, 206/206.
2. ✅ **BUILT (2026-06-22)** — split the receipt's truth channels: the analog (tolerance-verified) photonic
   value is no longer folded into the bit-exact `ternaryChecksum` (it stays the digital subset only); a new
   `valuesReproducible` flag on the receipt goes **false** when an analog value contributed (recorded in
   `bridgesUsed`/`byOp` but excluded from the bit-exact channel). `hybrid-engine.ts` dispatch + `buildReceipt`
   + the receipt interface; `photonic-dispatch.test.mjs` updated to the new semantics (+2 assertions).
   tower-citizen 206/206; full suite 53/53 · 4989.
3. ✅ **BUILT (2026-06-22)** — pin **LLN-MONO-001**: `parseEmergencyBlock` now SURFACES an emergency-block
   `allow`/`grant` as an `allow:` action node (was: silently consumed by the "unknown action — skip" branch,
   so the verifier's `EMERGENCY_EXPANDS_CAPABILITY` check could never fire → fail-silent permission widening
   in the Binary governance core). The existing verifier error now fires as a hard compile error. Parser-only
   fix (parser-parses / verifier-validates split preserved). +5 tests `tests/governance/emergency-monotonicity.test.mjs`;
   compiler 3684, full suite 53/53 · 4989.
4. ✅ **BUILT (closed 2026-06-22)** — both fail-open admission/clamp holes shut: certified-mode photonic
   admission bound to a verified signed manifest (`7a58a26`) + the `maxTolerance` band clamp (runner.ts
   `effectiveTolerance=Math.min`) were already done; the remaining **caller-independent `N_MAX` vote-count
   clamp** is now built — `tmacVoted` clamps N to `[1, N_MAX_VOTES=1024]` (a non-finite/enormous caller N
   was an infinite-loop hang / O(N·n) resource-exhaustion fail-open via `execute(op, Infinity|1e9)`); bridge
   `execute` + constructor route through `clampVotes`. +4 tests; photonic-emulator 46/46; suite 53/53 · 4993.
5. **DESIGN-ONLY / owner-gated** — the crash-containment weakest link: interim = a real same-process
   supervisor harness replacing the T-008 placeholder + relabel the diagnostic declaration counts; full
   DWI / guard-page / fuel isolation is DRCM Phase 5 (#40/#41).

## 7. Roadmap / next
- **Built this session:** B1 scaffolder · B2 admission unification · revocation into resolver +
  bridge-attest.
- **Verified already shipped:** B3 linker · B4 revocation-at-fuse · B5 resolver core · B6 examples.
- **Net-new to build (owner-directed):** B5a signed central registry index · B6 richer worked example
  · the fault-tolerance hardenings from the in-flight re-R&D.
- **Gated:** DRCM Phase 5 (kernel → `DSS.wasm` on Wasmtime TCB) · untrusted-peer memory isolation
  (#102-104) · B8 SPSC ring-buffer transport.

Locked decisions: all **Apache-2.0** (no BSL) · `kernel.ts` = non-bypassable admission gate (not
middleware) · TritMesh = example name only · Binary-only crypto/governance/admission.

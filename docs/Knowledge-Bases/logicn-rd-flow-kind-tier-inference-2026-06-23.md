# Flow-Kind Tier Inference — Floor-Not-Ceiling for `pure` / `guarded` / `secure`

**KB doc** · status: R&D verdict (verify-before-build complete) · 2026-06-23 · proposed file `docs/Knowledge-Bases/logicn-flow-kind-tier-inference-2026-06-23.md`
**Zero-trust score: 9.2 / 10** · paper verdict: **defensive-pub**
Source files cited are all under `packages-logicn/logicn-core-compiler/src/`.

---

## 1. Owner idea + the three zero-trust constraints

**Owner idea.** A flow's tier keyword (`pure` / `guarded` / `secure`, plus plain `flow` and `governed floor_N flow`) is today a pure *declaration* — the developer types a keyword, it is parsed to a node kind, and every downstream pass reads the tier straight back from that kind. Nothing derives a tier *floor* from what the flow's body actually does. The owner wants the compiler to **infer the minimum tier a flow's footprint requires** and refuse a flow that is declared *below* that floor — so a flow that performs `http.post` or touches a secret cannot wear the weaker `guarded` (or plain `flow`) keyword to dodge the secure-only governance obligations.

Three constraints, each a hard zero-trust invariant:

1. **Floor, not ceiling — escalate-only.** Inference may only ever *raise* the required tier. Declaring `secure` for a benign body stays legal (over-strict is fine); declaring `guarded` for a network/secret body is the violation. The check fires *only* when `declared < required`. Adding any effect can only push the floor up, never down (it is a max-fold over a fixed effect→tier table). This is lattice-join / "computed level must dominate declared level" discipline.
2. **Compile-time, not runtime.** The decision is made when the signed source is compiled, never deferred to execution. See §6 for the three reasons (provability, fail-closed timing, authority integrity).
3. **Propose, don't rewrite.** The tooling (the `//lln` CLI) may *propose* a raised tier into a generated `//@` comment, but the authoritative act is the compiler **refusing** an under-declared flow. The tool proposes; the compiler disposes. No silent auto-rewrite of human source.

---

## 2. ALREADY-SHIPPED vs NET-NEW (verify-before-build)

### Mechanics (verified)

The tier is **declared by keyword, parsed to a node kind, and read back from that kind — never from effects.**
- `parser.ts:566-572` — `parseFlowDecl(qualifier)` maps the keyword to the `AstNodeKind`: `secure→secureFlowDecl`, `pure→pureFlowDecl`, `guarded→guardedFlowDecl`, else `flowDecl`. `governed floor_N flow` parses as a guarded flow then re-tags to `governedFlowDecl`.
- `interpreter.ts:2379-2384` — `qualifierFromFlowKind(kind)` returns `"pure"`/`"guarded"`/`"secure"`/`"flow"` straight from the node kind. **`FlowMeta.qualifier` is a faithful echo of the keyword; nothing can raise it from effects.**

### ALREADY-SHIPPED (do NOT rebuild)

| # | Capability | Evidence |
|---|---|---|
| 1 | **Effect inference from the body** | `effect-checker.ts` `EFFECT_REGISTRY` (line 45) + `inferEffectsFromNode` / `inferDirectEffectsForFlow`; e.g. `http.post → network.outbound`, `secret.read`, etc. |
| 2 | **A real one-directional PURE floor** (escalate-only, fail-closed ERROR) | `LLN-EFFECT-003` at `effect-checker.ts:455-493`. A `pure` flow declaring *any* effect, using a `PURE_FORBIDDEN_EFFECT` (line 381: `network.*`, `secret.*`, `database.*`, `payment.charge`, `ai.inference`, `process.spawn`, …), or *calling* an effectful flow is rejected. Pure structurally forbids effects. |
| 3 | **An effect-COMPLETENESS floor for secure/guarded** | `LLN-EFFECT-001` at `effect-checker.ts:495-519` — declared effects must *cover* the body. This is "declared effects ⊇ body effects." `LLN-EFFECT-002` (line 521) warns on over-declared effects. |
| 4 | **Qualifier reliably derived from node kind** | `interpreter.ts:2379-2384`. |
| 5 | **Policy/manifest subset confinement** | `LLN-INHERIT-001/002` (child `permitted_effects ⊆ parent`) + `LLN-GRANT` capability-vs-effect checks in `governance-verifier.ts`. These are *policy-hierarchy* subset checks, not a body→tier floor. |
| 6 | **Guarded-flow value-state registration** | **Already fixed in the working tree** — `value-state-checker.ts:1015` now lists `case "guardedFlowDecl"` with the `#0093` comment (see §5). |

**The gap.** The compiler enforces *"declared EFFECTS ⊇ body effects"* but **NOT** *"declared TIER ⊇ body's minimum required tier."* Concretely, `guarded flow f(...) contract{ effects{ network.outbound } } { http.post(...) }` passes today: `LLN-EFFECT-001` is satisfied (the effect is declared), and because `qualifier === "guarded"` *not* `"secure"`, every secure-only obligation in `governance-verifier.ts` is skipped — intent `GOV-010` (≈ line 1352), epilogue/proof `GOV-006` (≈ line 1906), secret-egress hardening — all gate on `qualifier === "secure"`. A grep for `requiredQualifier` / `minTier` / `inferredTier` / `mustBeSecure` / `inferMinimumTier` / `LLN-TIER` returns **zero matches** (verified). The only tier-from-effects rule that exists is the pure floor. The documented governed-floor rule **`LLN-DAG-002`** ("a `floor_1` flow cannot carry `secret.*`") exists **solely as a comment** at `governance-verifier.ts:486` — it is never pushed as a diagnostic.

### NET-NEW needed (for floor-not-ceiling)

- **(a)** An **effect→minimum-tier lattice** + **one uniform floor check** `declared_tier >= inferred_minimum_tier`, escalate-only, fail-closed ERROR when under-declared. (§3.)
- **(b)** Wiring so an **undetected/indirect border** keeps the flow at the *stricter* tier (fail-closed on uncertainty).
- **(c)** Implement the already-documented-but-dead **`LLN-DAG-002`** as the governed-floor projection of the same comparison.
- **(d)** The **`//lln` CLI propose-into-`//@` writer** (tool proposes, compiler disposes).

---

## 3. The inference lattice + the floor-check diagnostic

### 3.1 Inference rule — `inferMinimumTier(...)`

A new total, monotone function over an **ordered lattice `pure(0) < guarded(1) < secure(2)`**:

```
inferMinimumTier(flow, flowNode, callGraph, allFlows) -> "pure" | "guarded" | "secure"
```

It **reuses existing machinery** — `inferEffectsFromNode(flowNode)` (`effect-checker.ts`) for the observed effect set, plus value-state-checker governed-sink reachability and the existing `buildFlowCallGraph` — and reduces it to a single integer **max-fold** over a fixed table `EFFECT_MIN_TIER`. Classification (take the MAX over the whole footprint; escalate-only):

**SECURE (tier 2)** if ANY of:
- a **border/egress** effect: any `network.*` (`network.outbound` / `.external` / `.inbound` / `.internal`), `email.send`;
- a **credential/secret** effect: `secret.read` / `secret.write` and the `crypto.sign/seal/encrypt/decrypt` family (key material only);
- a **high-consequence governed sink** is reachable: `http.post/get/put/patch/delete`, `EmailService.send`, `StripePayment.charge` / `payment.charge`, `AuditLog.write` / `audit.write`, `database.write` (insert/update/delete/upsert), `ai.inference` (prompt exfil), `process.spawn`. (≈ a new `SECURE_REQUIRED_EFFECTS` = `PURE_FORBIDDEN_EFFECTS` minus the merely-guarded ones.)
- the flow **calls (transitively)** a flow whose own inferred minimum is `secure` — **secure is contagious up the call graph.**

**GUARDED (tier 1)** if not secure but any benign side-effect is observed: `database.read`, `cache.read/write`, `filesystem.read`, `clock.read`, `random.generate`, or it calls a guarded-minimum flow. These touch state / non-determinism but cross no trust border and use no credential.

**PURE (tier 0)** only if the footprint is empty: no observed effects, no effectful/guarded/secure callee. (Same structural condition the pure floor already enforces, now expressed as the lattice bottom rather than a special case.)

The governed-floor variant `governed floor_N flow` maps onto the same lattice: `floor_1`/execution may NOT carry `secret.*` / `network.*` (those demand the secure tier / a higher floor), which gives **`LLN-DAG-002` a real fail-closed implementation** instead of a comment.

### 3.2 The floor check — `LLN-TIER-001`

ONE uniform check, added to `checkFlowEffects` (`effect-checker.ts`) right after the existing `EFFECT-001/002` block — it already has `flowNode`, `observedEffects`, `callGraph`, `allFlows` in scope, so **zero new plumbing**:

```
const declared = TIER_RANK[flow.qualifier];   // pure0 guarded1 secure2; plain `flow` ranks at guarded(1) — it is NOT pure
const required = TIER_RANK[inferMinimumTier(flow, flowNode, callGraph, allFlows)];
if (declared < required) emit fail-closed ERROR LLN-TIER-001;
```

**New diagnostic — `LLN-TIER-001` / `FLOW_TIER_FLOOR_VIOLATION`, severity ERROR (fail-closed):**
- **message:** `${qualifier} flow "${name}" has a footprint that requires at least a '${requiredTier}' flow (it ${reason}, e.g. effect "${witnessEffect}" / sink ${witnessSink}). Declared tier '${qualifier}' is below the inferred minimum.`
- **suggestedFix:** `Change "${qualifier} flow" to "${requiredTier} flow".`
- **suggestedCode:** `${requiredTier} flow ${name}`
- **location:** the witness call site (reuse `inferEffectCallLocations`).

**Semantics:**
- **Escalate-only / tighten-only** — fires *only* when `declared < required`. `declared >= required` is always accepted (over-strict is legal; the separate `LLN-EFFECT-002` over-declared-*effects* warning is unaffected).
- **Fail-closed on uncertainty** — any callee whose node cannot be resolved, any unknown stdlib call, or any effect not in `EFFECT_MIN_TIER` is treated as `unknown = secure` (No-Coercion-one-level-up), not ignored. An undetected/indirect border leaves the flow at the higher floor and forces an explicit declaration.
- **Upgrades two currently-too-weak rules to the SAME hard error:** plain `flow` declaring `secret.read` / `payment.charge` (today only an `LLN-EFFECT-001` *warning*, `effect-checker.ts:537-550`) and `guarded` flow doing `http.post` (today silently accepted because `qualifier != secure`) both now trip `LLN-TIER-001`.

**Companion rules.** `LLN-DAG-002` (`GOVERNED_FLOOR_EFFECT_MISMATCH`, ERROR) gets its first real emission as the governed-floor projection of `LLN-TIER-001`. Optional advisory `LLN-TIER-002` (info/WARNING) for the `//lln` propose path when the tool *raises* a written `//@` tier suggestion — auditable but **non-blocking**. The authoritative gate is `LLN-TIER-001` at compile time; `LLN-TIER-002` is advisory only.

---

## 4. The guarded-flow bug — motivating fragility, and how the floor defangs it

**The bug (now fixed).** `value-state-checker.ts` `walkNode` switch (around lines 1006-1025) listed `flowDecl` / `secureFlowDecl` / `pureFlowDecl` and **omitted `guardedFlowDecl`**, so a guarded node fell to the `default: walkChildren` arm — `pushScope()` / `registerParamBinding()` never ran for guarded-flow params. Consequence was **fail-open**: at a governed sink, `lookupBinding(param)` returned `undefined`, so `LLN-VALUESTATE-003` (UnsafeValueReachedGovernedSink) could not fire for *any* guarded flow — the whole tier was unchecked by value-state. This was the **lone** omission: every other pass enumerates all four kinds (`taint-checker.ts:152` `FLOW_KINDS`, `type-checker.ts:517/929`, `symbol-resolver.ts:98/435`, `governance-verifier.ts:93/2299`, `manifest-generator.ts:536`, `gir-emitter.ts:234/1034`, `interpreter.ts:362/661/2381/2530`, `effect-checker.ts:886`, and even `collectUserFlows` at `value-state-checker.ts:632-648`).

It is **already fixed in the working tree** — `value-state-checker.ts:1015` now has `case "guardedFlowDecl"` with the `#0093` comment; guarded params now push scope and register bindings.

**Why the floor still matters (defense-in-depth).** This omission is exactly the **per-checker enumeration brittleness** the owner cites: correctness depending on every one of ~10 passes remembering every one of 4 kinds. The dangerous flows the value-state checker was failing to inspect were precisely the **under-declared** ones — a flow doing `http.post` / touching a secret but wearing `guarded` to dodge the secure-only passes. Under `LLN-TIER-001` that flow **cannot exist**: its `network.outbound` / `secret.*` footprint forces inferred-minimum = `secure`, `declared guarded < secure` fails closed at compile time, and the program is rejected *before any checker runs on it*. A genuinely-guarded flow (benign I/O only) has no governed sink for the omitted pass to miss.

So the N-passes × 4-kinds matrix collapses to a **single chokepoint**: one effect→tier fold + one comparison gate the dangerous footprint at the door, instead of trusting N passes to each independently remember the guarded case. The two fixes are **complementary** — fix the omission *and* add the floor so the omission stops being security-relevant.

---

## 5. Prior art + paper verdict + zero-trust score

This is **not novel research** — it is a well-established discipline (computed security level must dominate declared level) specialized to LogicN's 3-point tier axis. Honest prior art:

- **Koka / Eff / Frank** — algebraic effect systems infer a function's effect *row* from its operations and propagate it. The effect→tier fold is a *coarsening* of an inferred effect row into a 3-point lattice; `EFFECT_REGISTRY` is already a Koka-style operation→effect table.
- **JIF (Jif/Java Information Flow), FlowCaml / Caml-flow** — security-typed languages that *infer* a function's security/integrity label from the labels of operations it performs and reject under-labeled flows. `LLN-TIER-001` is the same "computed level must dominate declared level," lattice-join semantics, fail-closed.
- **Object-capability / least-authority inference** (E, Pony reference capabilities, Austral linear capabilities) — the minimum authority a procedure needs is derived from the capabilities it exercises. "Minimum tier from footprint" is least-authority inference projected onto a tier ordering.
- **ESLint / Clippy effect lints, Rust `no_std` / `#![forbid]`** — "this function does I/O / network, it must be annotated" is exactly the lint-propose half (`//lln` writing the tier into `//@`).
- **Cedar / OPA policy-as-data subset checks** (already mirrored in LogicN as `LLN-INHERIT-001/002` and `LLN-GRANT`) — "declared authority must be a superset of used authority," here specialized to the tier axis.
- **SLSA / in-toto provenance levels + taint/declassification calculi** — "a level computed from the build/dataflow must meet or exceed the asserted level" is the same dominance discipline on a provenance lattice.

**Paper verdict: defensive-pub.** No new crypto, no new science — it is a synthesis of known information-flow / least-authority discipline. Consistent with the LogicN IP posture (0 patents, defensive-pub + Apache-2.0, papers only for measured negatives). Worth a short defensive-publication note positioning the **3-point tier coarsening of an effect row as a single fail-closed compile-time floor**, but not a flagship paper.

**Zero-trust score: 9.2 / 10.** It closes a real fail-open (under-declaration to dodge secure-only obligations), is escalate-only and fail-closed on uncertainty, makes the decision at the only point where the unsafe program never runs, and converts a fragile N×4 enumeration into one chokepoint. Marginal deductions: it depends on `EFFECT_REGISTRY` completeness (mitigated by `unknown = secure`), and the `//lln` propose path adds a (non-authoritative) advisory surface.

---

## 6. Why compile-time, not runtime (rejected)

1. **Provability.** The value proposition is a *static* posture proof (the `.lproof` / AZT direction, note 53). The tier is the *premise* other secure-only obligations discharge against — `governance-verifier.ts` gates intent (`GOV-010`, ≈ line 1352), epilogue/proof (`GOV-006`, ≈ line 1906), and secret-egress hardening on `qualifier === "secure"`. If the tier is only known at runtime, none of those can be proved before execution; the artifact would assert a posture it cannot certify.
2. **Fail-closed timing.** A runtime tier assignment means the *first* border-crossing call is what reveals the flow should have been secure — by then the egress may already have happened (the very fail-open being killed). Compile-time refusal is the only point where the unsafe program never runs.
3. **Authority integrity.** Runtime inference is derived from a forgeable/observable execution path, not the signed source; it cannot be pinned into the compile-cache key (#0088 keys on *signed* source, `//lln` text is a forgeable *view*). Inferring at the `//lln` CLI / compile step is fine and encouraged; deferring the *decision* to runtime is what is rejected. Inference at compile time **raises** the floor; runtime can only ever observe, never tighten in time.

---

## 7. Build recommendation

**Verdict: BUILD — size M.** Owner-gated on the questions below, but technically low-risk and high zero-trust value; the prerequisite guarded-flow fix has already landed.

| Slice | Work | Size |
|---|---|---|
| **S1** | `EFFECT_MIN_TIER` table + `inferMinimumTier(...)` max-fold (reuses `inferEffectsFromNode` + `buildFlowCallGraph`) | **S** |
| **S2** | `LLN-TIER-001` floor check in `checkFlowEffects`, fail-closed, escalate-only, `unknown = secure`; absorbs the two too-weak rules | **S** |
| **S3** | `LLN-DAG-002` as the governed-floor projection (first real emission) | **S** |
| **S4** | `//lln` propose-into-`//@` writer + advisory `LLN-TIER-002` (propose-don't-rewrite) | **M** |

Total ≈ **M** (S1–S3 are the core fail-closed gate and are small; S4 is the larger advisory-tooling slice and can ship after). Register `LLN-TIER-001/002` + `LLN-DAG-002` in the governance-rules registry and add to the diagnostic-code index so they are not orphaned (per the universal-coverage rule). **Prerequisite (already done):** `value-state-checker.ts:1015` `case "guardedFlowDecl"`.

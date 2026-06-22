# LogicN — Diagnostic Code Taxonomy Audit (2026-06-22)

The `LLN-EFFECT-002` overload was a **symptom of a systemic disease**, not an isolated bug. This is the full
audit (task **#213**), commissioned after that finding, of **all 336 `LLN-*` diagnostic codes across ~90
families** (7 parallel auditors), with **every flag adversarially re-verified against live source**. A
companion audit of the **non-`LLN-*` namespaces** (`ERR_*`, bare `*_VIOLATION`/`*_DENIED`, CBOR tags;
`wdjnqlw27`) is appended in §6.

**Bottom line (all namespaces audited):** ~30 `LLN-*` diagnostics + the `ERR_*` runtime family (2 security
HIGHs) are diseased via the same five structural root causes. **The standard/structured namespaces are CLEAN —
CBOR tags (400-417) and HTTP `KernelErrorCode` — precisely because they each have a single-source-of-truth
helper.** That contrast IS the prescription: the durable fix is a **registry-conformance CI lint** (proposed
#215) that gives the diagnostic families the discipline the clean namespaces already have. Without it, every
future code is a coin-flip.

> Build status: the #201 work is **paused** (uncommitted) pending this audit. The `LLN-EFFECT-006` split I did
> for #201 is **correct and aligns with the policy below** — but it surfaced that `devtools-project-graph`
> still carries the OLD inverted `EFFECT-002` (finding H2). Remediation is gated on owner direction.

---

## 1. The five root causes (the disease, generalized)

| # | Root cause | Why it's dangerous | Worst example |
|---|---|---|---|
| **R1** | **One code, multiple distinct/opposite failure modes** (+ mixed severity) | A consumer filtering by code can't tell a typo from a privilege breach; can't triage by severity | `LLN-SECRET-002` = 3 modes (timing side-channel · network exfiltration · cross-flow), 2 unregistered |
| **R2** | **One failure mode split across multiple codes** | The rule can't be filtered/gated reliably; the two copies drift | SSRF under both `LLN-NET-001` and `LLN-NET-002` |
| **R3** | **Duplicate, divergent definitions across packages** | A package redefines another's code with a *different/inverted* meaning while claiming to be canonical | `devtools-project-graph/effect-graph.ts` redefines EFFECT-002/003/004 inverted, header falsely says "canonical to logicn-core-compiler" |
| **R4** | **Inline emits with no single metadata constant** | name/severity/message live only at the call site → drift; audits can't enumerate; raw `throw new Error("LLN-…")` | `LLN-MANIFEST-*` (raw throws), `LLN-PARSE-*`, `LLN-RUNTIME-002/003` |
| **R5** | **Dead / unregistered codes** — defined-never-emitted OR emitted-never-registered | The published code set ≠ what the compiler can produce; **worse: dead codes wired as production-BLOCKING gates = false enforcement** | `LLN-MEMORY-001..007` are dead **and** listed as production blockers in `production-check.ts` |

**The single most alarming finding (R5, security):** `production-check.ts` lists `LLN-MEMORY-001/002/003/007`
as **production-blocking gates**, but those codes have **no emitter anywhere** (the borrow/move/bounds checker
is unimplemented). The gate advertises memory-safety enforcement it does not provide.

**The most common root cause (R3):** divergent duplicate definitions — `devtools-project-graph` and the
`flowgraph`/`project-graph` GRAPH codes and `CONFIG`/`CONFIG-GOV` all re-declare codes locally instead of
importing the canonical constant. This is *why* EFFECT-002 drifted even after the compiler fixed it.

---

## 2. Confirmed HIGH-severity findings (security-relevant — fix first)

| Code(s) | Issue | What's wrong | Fix |
|---|---|---|---|
| **LLN-SECRET-002** | R1 (worst) | 3 modes under one code: `SecretComparisonDenied` (timing, error, the only *registered* one) · `SecretSentToNetwork` (egress, error, **unregistered**) · `SecretCrossesFlowBoundary` (cross-flow, warning, **unregistered**) — `value-state-checker.ts:1480/1526/1873` | Split → SECRET-002 (compare) + SECRET-004 (egress) + SECRET-005 (cross-flow); register all in the invariants matrix |
| **LLN-PRIVACY-002** | R1 | `EmbeddingEgressDenied` (egress, error) + `EmbeddingCrossesFlowBoundary` (cross-flow, warning) under one code; **not in the matrix at all** — `value-state-checker.ts:1497/1564/1581` | Split → PRIVACY-002 (egress) + PRIVACY-003 (cross-flow); register both |
| **LLN-GOV-004** | R1 | 3 modes: `DENIED_TARGET_SELECTED` · `DOMAIN_GUARD_NOT_FOUND` (typo) · `DOMAIN_GUARD_POLICY_VIOLATION` (privilege breach) — `governance-verifier.ts:1406/2559/2592`. A typo and a privilege breach are indistinguishable | Split → GOV-004 + GOV-021 + GOV-022 |
| **LLN-MONO-001** | R1 | `EMERGENCY_EXPANDS_CAPABILITY` (error, "critical security violation") + `EMERGENCY_UNKNOWN_ACTION` (warning, typo) — `governance-verifier.ts:2922/2936`. *(The code #201's parse-pin work routes through.)* | Split the typo case → MONO-003 (warning); MONO-001 = expansion only |
| **LLN-INV-002** | R1 | "post-condition could not be evaluated" (fail-closed) vs "post-condition proven false" — `interpreter.ts:1097/1103`; no exported constant | Register LLN_INV_002; split "unevaluable" from "violated" |
| **LLN-ASSIMILATE-002** | R1+R4 | 3 modes (budget-not-declared advisory [spec'd, never emitted] · plugin-exceeds-budget · tower-at-capacity), both live ones are raw `throw new Error` — `tower-runtime.ts:70/75` | Split → ASSIMILATE-002/004/005; convert to structured diagnostics |
| **LLN-EFFECT-002** | R2+R3 | over-declaration fires as EFFECT-006 (compiler) **and** EFFECT-002 (devtools), while EFFECT-002 means the *opposite* (under-declaration) in the compiler — `effect-graph.ts:56/190` falsely "canonical" | Re-sync `devtools-project-graph/effect-graph.ts` to import the compiler constants |
| **LLN-NET-001/002** | R2 | SSRF/private-range block emitted under NET-002 (canonical) **and** NET-001 (`stdlib.ts:1205`); NET-001's real meaning is allowlist-denial | Retag `stdlib.ts:1205` → NET-002 |
| **LLN-INTENT-001 / GOV-001** | R2+R5 | identical `name` INTENT_BEHAVIOR_MISMATCH under two codes, **opposite severity** (INTENT-001 error/dead, GOV-001 warning/live) | Retire dead INTENT-001; GOV-001 canonical (or vice-versa); resolve severity |
| **LLN-MATCH-001 / SAFETY-006** | R2 | non-exhaustive match split: MATCH-001 (warning, enum) vs SAFETY-006 (error, Tri) | Unify under one MATCH family w/ sub-codes, or document the deliberate split + cross-ref |
| **LLN-MANIFEST-\*** | R4+R5 | two disjoint schemes: numbered 001-005 (docs-only, never emitted) vs suffix `DEPTH`/`LENGTH-OVERFLOW`/`DUPLICATE-KEY` (raw throws, unregistered) — `manifest-generator.ts:350-404` | Pick ONE scheme; register; replace raw throws with structured diagnostics |
| **LLN-MEMORY-001..007** | R5 (security) | 7 codes defined, **none emitted**; **001/002/003/007 wired as production-BLOCKING gates that can never fire** (`production-check.ts:39-42`) | Implement the checker, OR remove from the production-blocking set + mark RESERVED |
| **LLN-GRAPH-002..005** | R3 | defined twice — `flowgraph/diagnostics.ts` (security: DeadFlow/AuthorityEscalation/PiiLeakagePath/MissingAuditCoverage) vs `project-graph/core/types.ts` (generic: NODE_NOT_FOUND/…) | Re-namespace project-graph → `LLN-PGRAPH-*` |

---

## 3. Confirmed MEDIUM findings (correctness/clarity)

`LLN-EFFECT-001` (error under-declare + warning plain-flow-privileged, mislabeled) → split EFFECT-007 ·
`LLN-EFFECT-003` (EFFECT_BOUNDARY_VIOLATION vs devtools UNSAFE_EFFECT_IN_SAFE_FLOW) → import canonical ·
`LLN-EFFECT-004` (NON_CANONICAL/UNKNOWN + spec mislabel + devtools TRANSITIVE — 3 meanings) → reconcile ·
`LLN-VALUESTATE-006` (ProtectedBoundaryViolation + ProtectedValueAtAuditLog) → split VALUESTATE-008 ·
`LLN-GOV-017` (invalid-value error + low-risk-flow warning) → split GOV-023 ·
`LLN-ASSUME-002` (no-contract error + claim-not-found warning) → split ASSUME-005 ·
`LLN-BINDING-001/002/005` (immutable-reassign split across a dead stub + the live 005) → retire 001/002, keep 005 ·
`LLN-RUNTIME-002` (FlowNotFound + UnresolvedCall) · `LLN-RUNTIME-003` (executePlan-fail + generic-exception) ·
`LLN-RUNTIME-006` (fail-closed limit deny + after-the-fact request_time *advisory* — contradicts its own "aborted" message) → split RUNTIME-009 ·
`LLN-RUNTIME-EFFECT-GATE` (non-numbered, unregistered) → renumber ·
`LLN-CONFIG-GOV-001/002/003` (collides numerically with CONFIG-003; GOV-001/002 are text-embedded, not structured) ·
`LLN-IMPORT-004` (local-vs-import + import-vs-import shadowing) ·
`LLN-PROFILE-003/004/005/007` (defined, enforcement dead) ·
`LLN-COMPUTE-001` (defined, never emitted; README advertises 001-007) ·
`LLN-PARSE-001/002/003` (emitted, no metadata constants; PARSE-001 also carries 4 meanings incl. the bitwise-op design-rejection — split → PARSE-010) ·
`LLN-INTENT-001..005` (all defined, none emitted) · `LLN-STRING-001..004 / BLOCK-003/004 / CHAR-001/002/004` (defined, dead) ·
`LLN-SYNTAX-003/005` (emitted, unregistered; 004 missing) · `LLN-TAINT-005` (header-injection code dead; folded into TAINT-001) ·
`LLN-MUTATION-001/002` (Stage-B `.lln`-only; no name/severity; `verifyMutationPolicy` defined but never called) ·
`SEC/EC/ID/AU/OBS-002` (naming/const-export gaps) · `LLN-FAULT-001/003` (no constants; FAULT-002 gap).

## 4. Confirmed LOW findings (hygiene)

`LLN-ASSUME-001` (two names, one mode) · `LLN-CAP-001` (NETWORK_WILDCARD_BANNED fires on all wildcards incl. `database.*`) ·
`LLN-GOV-008` (registered, empty-stub emit) · `LLN-SYNTAX-006` (LET_AT_TOP_LEVEL also used for `readonly`) ·
`LLN-LEX-004` (FileTooLarge also used for token-count overflow) · `LLN-RES-001` (defined in 2 places, hand-copied name) ·
`LLN-BORDER-004` (VALUE_BELOW_MIN/ABOVE_MAX two names) + BORDER uses bespoke `SECURITY_ALERT` severity vocab ·
`LLN-BORDER-005` (spec'd, never emitted) · `LLN-BACKEND-001` (IO-error now + JS-emitter ambient-authority reserved — latent overload) ·
`LLN-WASM-*/WAT-*` (phantom — docs only) · `LLN-TAINT-002/006` (registered/defined, dead) · `LLN-BINDING-006` (defined, dead) · `LLN-IMPORT-000/001` (info unregistered; two I/O modes).

---

## 5. The remediation policy — "one code, one fault, one source of truth"

The standard that makes the disease impossible (this is what #213 establishes, and what a CI lint enforces):

1. **One code = one failure mode = one `name` = one severity-policy.** (A dev→prod severity toggle of the
   *same* problem is allowed; two different problems are not.)
2. **One code = one exported metadata constant** (the single source of truth), **referenced at every emit
   site.** No inline `code:"LLN-…"` literals; no raw `throw new Error("LLN-…")`. Severity/name/message live in
   the constant only.
3. **No package redefines another package's code.** Consumers `import` the canonical constant from
   `logicn-core-compiler`. (Kills R3.)
4. **Every code is either live-emittable or explicitly `RESERVED`** in the registry. Docs/README ranges must
   match emittable reality.
5. **Production-blocking gates reference only live-emittable codes.** (No advertising unenforced protection.)
6. **One uniform severity vocabulary** (`error`/`warning`/`info`) and **one numbering scheme per family** (no
   bespoke `SECURITY_ALERT`, no non-numbered `RUNTIME-EFFECT-GATE`, no colliding `CONFIG-GOV`).

**Proposed #215 — diagnostic-registry conformance lint (the durable fix).** A CI check + a generated registry
that fails the build when: a code has >1 `name`/severity at its emit sites; a code is emitted without its
exported constant; a code is defined in >1 package; a code is emitted-but-unregistered or
defined-but-never-emitted (unless `RESERVED`); a production-blocking gate names a non-live code. Without #215
the 30 fixes below will re-rot.

---

## 6. Non-`LLN-*` namespaces

### 6a. `ERR_*` / `*_VIOLATION` / CBOR tags (companion audit `wdjnqlw27`) — DONE 2026-06-22

**`ERR_*` runtime codes — DISEASED (2 security HIGHs).** ~22 of ~30 are clean (quantum limit codes, `ERR_AI_*`,
`ERR_CERTIFIED_*` are each one-mode). Flagged:
- **`ERR_BRIDGE_UNATTESTED`** (HIGH, overloaded) — one code collapses ≥5 distinct attestation failures
  (requireHybrid-without-key MISCONFIG · missing attestation · Ed25519 sig-fail · hash-pin mismatch · ML-DSA
  sig-fail), split only by free-text. **A misconfiguration and a forged signature — operator-error vs
  active-attack — are forensically opposite yet share one code** (`hybrid-engine.ts:444`, `checkBridgeAttestation`
  :347-373). → 5 codes + `ERR_ATTESTATION_POLICY_MISCONFIGURED` (the misconfig isn't a bridge fault).
- **`ERR_BRIDGE_DISPATCH_FAULT`** (HIGH, opposite-failure-modes) — one try/catch wraps both `bridge.execute()`
  and `assertDeterminism()`, so a bridge **crash** and a **`CITIZEN_STANDARD_VIOLATION` determinism-integrity
  breach** map to one code (`hybrid-engine.ts:643-651`; the fault-tolerance KB documents the collision). →
  catch the determinism throw → `ERR_BRIDGE_DETERMINISM_DRIFT`.
- **`ERR_QUANTUM_PQ_REQUIRED`** + **`ERR_ADDON_HASH_MISMATCH`** (MED, naming) — only embedded in free-text
  `reason` strings, NOT structured `code` fields — they look like codes but nothing can branch on them.
  `ERR_QUANTUM_PQ_REQUIRED` is also the 3rd spelling of "no ML-DSA key" (with `ERR_CERTIFIED_NO_PQ_KEY` + an
  un-coded reason). → promote to structured codes; unify the PQ-key meaning.
- **`ERR_LIMIT`** (LOW, dead) — unreachable `?? "ERR_LIMIT"` fallback (`ffsim-backend.ts:55`).
- **`ERR_CAPABILITY_DENIED`** (cross-namespace) — "capability not held" spread across `ERR_CAPABILITY_DENIED`
  (runtime) / `LLN-CAPABILITY-001` (devtools) / the confusingly near-named `LLN-CAP-001` (a *different*
  network-wildcard concern). → cross-reference runtime+static halves; resolve CAP vs CAPABILITY.
- **Family-level:** the runtime `ERR_*` set is undocumented vs the only error-code registry
  (`logicn-core/docs/error-codes.md`), which itself defines a **3rd, unused naming scheme**
  `LogicN-ERR-{DOMAIN}-NNN`. → pick one scheme; register the live `ERR_*` codes.

**Bare `*_VIOLATION` trap codes — mostly CLEAN ✅.** `CRITICAL_SECURITY_VIOLATION`, `GOVERNANCE_DENIED`,
`RUNTIME_VIOLATION`, `TPL_INTEGRITY_FAULT`, `INPUT_SIZE_EXCEEDED`, `VAULT_MUTATION_DENIED` each carry one
meaning. Two minor: `EFFECT_BOUNDARY_VIOLATION` lives as BOTH an `LLN-EFFECT-003` `name:` AND a bare trap code
(cross-namespace dual-life → prefix the trap form, e.g. `TRAP_…`); `CITIZEN_STANDARD_VIOLATION` is
string-duplicated in two files (→ shared const).

**CBOR tags (400-417) — CLEAN ✅.** No tag-number reuse, no schema split.

> **Why the split (the lesson):** the **clean** namespaces (CBOR tags, HTTP/`KernelErrorCode`) each have a
> **single source of truth** — a tag-constant set / the `errorResponse()` helper. The **diseased** namespaces
> (`LLN-*`, `ERR_*`) emit inline with per-site names/severities and cross-package redefinitions. The
> remediation policy (§5) + the #215 lint simply give the diagnostic families the discipline the clean
> namespaces already have.

### 6b. HTTP status codes / `KernelErrorCode` — AUDITED 2026-06-22: HEALTHY ✅ (the exemplar)
The framework's HTTP-status layer is the **opposite of the disease** — and the shape the `LLN-*` families
should adopt. `logicn-framework-app-kernel/src/kernel.ts` maps each `KernelErrorCode` (a typed union, :186-195)
**1:1 to a status through a single `errorResponse(status, code, message)` helper** (:202) — the single source
of truth the `LLN-*` families lack. Mapping (fail-closed, standard): 404 `route_not_found` · 405
`method_not_allowed` · 413 `payload_too_large` · 415 `unsupported_media_type` · 401 `unauthorized` · 422
`unprocessable_entity` · 409 `conflict` · 429 `too_many_requests` · 500 `internal_error`. No overload (500
covering internal faults is correct/standard; 422 for both bad-UTF-8 and bad-JSON is one mode).

Two MINOR cross-surface consistency notes (NOT overloads):
1. **Backpressure status divergence:** overload is **429** (kernel concurrency, `kernel.ts:351`) vs **503**
   (telemetry `/readyz` pod-shed, `governance-telemetry/server.ts`) vs the proposed **503 + `X-LogicN-State`**
   (#212 governance-deny bridge, unbuilt). 429 (client-slow-down) and 503 (server-unavailable) carry different
   semantics — pick + document one convention per condition; confirm governance-deny → 503 when #212 lands.
2. **Telemetry hand-rolls statuses** (`res.statusCode = 405/404/500`, `server.ts:58-80`) instead of the
   kernel's typed `KernelErrorCode`/`errorResponse` layer. When #211 adds timeout/rate-limit, make rate-limit
   **429** (match the kernel), not 503; ideally route the telemetry server through the same typed helper.

*Minor anomaly:* `kernel.ts` trips grep's binary heuristic ("NUL byte ~offset 4039"), but the file reads as
valid text and compiles clean (app-kernel 60/60) — it's a grep artifact (the `──` U+2500 box-drawing
separators in the section comments), not a real corruption.

**Net:** the HTTP namespace has NONE of the EFFECT-002 disease — it is well-factored (one helper = one source
of truth). It is the **target shape** for the `LLN-*` remediation, not a problem to fix.

---

## 7. Remediation backlog (prioritized; all gated on owner direction)

- **P0 (security): SECRET-002, PRIVACY-002, GOV-004, MONO-001, INV-002, ASSIMILATE-002** (overloaded
  security codes) + **MEMORY-001..007 false production gate** (R5 security) + **NET-001/002 SSRF** (R2).
- **P1 (correctness): EFFECT-002 devtools re-sync** + GRAPH dup re-namespace + INTENT/GOV-001 + MATCH/SAFETY-006
  + MANIFEST scheme + the EFFECT-001/003/004 family + VALUESTATE-006 + BINDING-001/002→005 + RUNTIME-002/003/006.
- **P2 (hygiene): the dead/unregistered cluster** (PARSE/INTENT/STRING/BLOCK/CHAR/PROFILE/COMPUTE/TAINT/WASM)
  + naming (ASSUME-001/002, CAP-001, CONFIG-GOV, IMPORT, LEX-004, SYNTAX-006, BORDER, BACKEND, RES-001).
- **Capstone: #215 registry-conformance lint** — do this alongside P0/P1 so fixes can't regress.

**Sequencing note (owner's runtime-first rule):** the P0 security overloads sit in the live runtime/governance
path (value-state-checker, governance-verifier, interpreter), so they rank first under that rule too.

## See also
[logicn-task-ledger.md](logicn-task-ledger.md) §9 (#213) · [logicn-security-invariants-matrix.md](logicn-security-invariants-matrix.md)
(the registry several findings reference) · [logicn-diagnostics-spec.md](logicn-diagnostics-spec.md) ·
[logicn-rd-0059-0064-triage-2026-06-22.md](logicn-rd-0059-0064-triage-2026-06-22.md) (#201 / LLN-EFFECT-006 origin).

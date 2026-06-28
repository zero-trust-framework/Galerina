# Galerina — Master Rules Registry (Consolidated Snapshot)

**Version:** 1.0 (2026-06-28) — generated consolidation
**Status:** Consolidated, read-only snapshot. **NOT the source of truth.**

> **Source-of-truth note.** This file is a *consolidated, point-in-time index* of every Galerina
> governance / security / compliance rule and `SPORE-*` diagnostic code found across the Knowledge-Base
> docs and the package sources, assembled to give one place to look up "all rules".
> The **authoritative, living source of truth for numbered rules + diagnostic codes is
> [`galerina-governance-rules.md`](galerina-governance-rules.md)** — when this snapshot and that
> registry disagree, that registry wins. Compliance-package codes live in
> [`galerina-compliance-governance.md`](galerina-compliance-governance.md) /
> [`galerina-compliance-packages.md`](galerina-compliance-packages.md); type/operator/field codes live
> in [`galerina-trust-sensitivity-type-rules.md`](galerina-trust-sensitivity-type-rules.md),
> [`operator-type-rules.md`](operator-type-rules.md), and [`field-read-rules.md`](field-read-rules.md).

All governance/diagnostic codes use the **`SPORE-*`** namespace (the legacy `LLN-*` namespace is retired).

**Enforcement legend:**
- **ENFORCED** — the compiler/runtime rejects (or traps on) violations today.
- **ADVISORY / WARN** — emitted as a warning, not a hard failure.
- **PLANNED** — scheduled for a DRCM phase / future version; parsed or specified but not yet enforced.
- **PRINCIPLE** — architecture discipline, not (yet) compiler-enforced.
- **RUNTIME** — fires at runtime (trap / audit event), not at compile time.

**How to read the tables:** `Code (SPORE-*) | Rule / what it enforces | Enforcement | Source doc`.
Source-doc shorthand: **gov** = `galerina-governance-rules.md`; **comp-gov** = `galerina-compliance-governance.md`;
**comp** = `galerina-compliance.md`; **comp-pkg** = `galerina-compliance-packages.md`;
**trust** = `galerina-trust-sensitivity-type-rules.md`; **op** = `operator-type-rules.md`; **field** = `field-read-rules.md`.

---

## ⚠️ Policy Disambiguation (carried from the SoT)

Three distinct "policy"-related concepts exist in Galerina and must never be confused:

| Concept | Syntax | Location | Purpose |
|---|---|---|---|
| **Domain Guard Policy** | `policy DomainName { permitted_effects {} enforced_limits {} }` | External file in `governance/policies/` | Immutable ceiling; referenced via `[conforms_to: X]` on `contract {}` |
| **`access {}` Capability Negotiation (v2.1)** | `access { purpose "..." allow T to "..." }` | Inline block **between** `contract {}` and `{ body }` | Active negotiation of call-boundary rights; replaces deprecated inline `policy {}` |
| **Emergency Policy Overlay** | `policy { emergency { on X { deny Y } } }` | Inline block **between** `contract {}` and `{ body }` | Runtime monotonic security overlay per-flow |

- Domain Guard Policies → rules K-000, SPORE-GOV-004, SPORE-LIMIT-001, SPORE-GOV-019 (see `galerina-domain-guard-policies.md`)
- `access {}` / legacy inline `policy {}` → S-009, SPORE-SYNTAX-LEGACY-003
- Emergency Policy Overlays → S-008, M-001..M-003, SPORE-MONO-001/002/003

---

## 1. Syntax & Contract Structure (S-/C-)

| Code (SPORE-*) | Rule / what it enforces | Enforcement | Source doc |
|---|---|---|---|
| SPORE-GOV-001 | S-001: `contract {}` placed inside the flow body (must sit between signature and body) | ENFORCED | gov |
| SPORE-GOV-005 | S-002: flow qualifier (`pure`/`guarded`/`secure`) must match the authority declared | ENFORCED | gov |
| SPORE-GOV-010 | S-003 / A-001 / A-003: missing `intent {}` on a secure/guarded flow, OR logic/URLs/vars smuggled into an `intent {}` string (prompt-injection guard) | ENFORCED | gov |
| SPORE-EFFECT-001 | S-004 / E-001: side effect performed but not declared in `effects {}` (deny-by-default; omitting `effects` = pure) | ENFORCED | gov |
| SPORE-GOV-020 | S-008: `policy {}` placed inside `contract {}` (must be a separate block) | PLANNED (DRCM Phase 4) | gov |
| SPORE-SYNTAX-LEGACY-003 | S-009: inline `policy {}` between contract and body — use `access {}`; `policy` keyword reserved for State Mutation Governance | ADVISORY (v2.1) | gov |
| SPORE-INV-003 | S-005: `invariant {}` misplaced (outside `contract {}`) / declared empty | ENFORCED (empty-block, task #36) + PLANNED (misplacement, Phase 2) | gov |
| SPORE-STEP-001 | S-006: `step` used as a contract clause instead of a body-level keyword | PLANNED (DRCM Phase 5) | gov |
| SPORE-GOV-003 | C-001: `request {}` / `response {}` on a non-API/internal/pure flow | ENFORCED | gov |
| SPORE-GOV-018 | C-003: `liability {}` hand-authored in source (it is auto-computed) | ENFORCED | gov |
| SPORE-GOV-017 | C-004: `cyber_physical_hardening {}` without ASIC hardware + high liability | ENFORCED | gov |
| *(no code)* | S-000: module path separator `::` canonical (both `::` and `.` accepted) | ENFORCED (Stage A) | gov |
| *(no code)* | S-007: named arguments at call sites unsupported in Stage A — use positional | ENFORCED (Stage A parser) | gov |
| *(no code)* | C-002: `secrets {}` / `economics {}` / `epilogue {}` are auto-by-default; declaring = explicit override | ENFORCED | gov |
| *(no code)* | C-005: AI may only *propose* widening of authority/effects/secrets via propose→verify→approve | PRINCIPLE + PLANNED | gov |

---

## 2. Effects (E-)

| Code (SPORE-*) | Rule / what it enforces | Enforcement | Source doc |
|---|---|---|---|
| SPORE-EFFECT-001 | E-001: all external access must be declared in `effects {}` (families: `audit.write`, `ledger.mutate`, `network.outbound/inbound`, `storage.read/write`, `state.mutate`, `db.read/write`, `secret.access`, `shell.execute`, `ai.call`) | ENFORCED | gov |
| SPORE-EFFECT-002 | E-002: effects are additive — declaring a subset of what the body performs is rejected | ENFORCED | gov |
| SPORE-EFFECT-003 | E-003: any effect in a `pure` flow is always a hard error (no warning) | ENFORCED | gov |

---

## 3. Secrets, Value-State & Privacy Taint (K-004, P-002, AU-003)

| Code (SPORE-*) | Rule / what it enforces | Enforcement | Source doc |
|---|---|---|---|
| SPORE-SECRET-001 | K-004 / A-005: `SecureString` (anything reading from / derived from `secret.get`/`vault.read`/`kms.decrypt`/`secrets.*`) flows to a log/audit sink. Declassifier: `redact()` | ENFORCED | gov |
| SPORE-SECRET-002 | K-004: secret flows to a network/egress sink (http/https/fetch/email). Also fires on `SecureString == x` (use `constantTimeEquals()`). Declassifier: `redact()` | ENFORCED | gov, op |
| SPORE-SECRET-003 | K-004 / AU-003: secret flows to serialize/JSON/audit-record sink. Declassifier: `redact()` | ENFORCED | gov |
| SPORE-SECRET-004 | K-004: secret-dependent branch / control flow (timing side-channel, CWE-208). Mitigation: `Crypto.constantTimeEquals()` / balance both arms | ENFORCED (warning) | gov |
| SPORE-PRIVACY-002 | P-002: cleartext semantic embedding (`Embedding`/`EmbeddingResult`, vec2text-invertible) flows to network/egress. Declassifier (sole): `seal()` / `encrypt()` — `validate`/`parse`/`decode` do NOT declassify | ENFORCED | gov |
| SPORE-PRIVACY-001 | declarative `privacy {}` block `deny protected X to Y` clause | PLANNED (Phase 10C+) | gov |
| SPORE-SECRET-BREACH | K-005 / AU-002: secret detected in output stream by DSS sink monitor (cleartext-prefix scan), runtime trap 3001 | PLANNED (Phase 1) | gov |
| SPORE-SECRET-FATAL | secret breach caused a DSS permission drop | PLANNED (Phase 1) | gov |
| SPORE-CLI-REDACT-001 | CLI output tripwire: a bare credential (PEM/`AKIA…`/`ghp_…`/`xox?-…`/JWT) or `key=value` secret reached CLI output; `redactCliOutputChecked` scrubs + surfaces the marker. Defense-in-depth, not the primary boundary | ENFORCED (R&D 0094) | gov |

> Derivation propagates: a secret carried through `slice`/concat/member/record/non-redacting call stays `SecureString`. `redact()` is the sole declassifier. **Bool-typed** results of secret comparisons are exempt from taint; a `trap` that fires before a sink clears the taint chain.

---

## 4. Capabilities & Network/SSRF (K-/I-)

| Code (SPORE-*) | Rule / what it enforces | Enforcement | Source doc |
|---|---|---|---|
| SPORE-CAP-001 | K-000/K-001: raw-string capability declaration, or wildcard `*` in `NetworkTarget` (must use typed `SystemCapability` / algebraic `NetworkTarget` variants) | PLANNED (DRCM Phase 4) | gov |
| SPORE-CAP-002 | K-002: `UnrestrictedInternet` network target without explicit `authority {}` policy authorization | PLANNED (DRCM Phase 4) | gov |
| SPORE-CAP-003 | K-003: path traversal / symlink-escape / Unicode-bypass in a filesystem capability path (canonicalized at compile time) | PLANNED (DRCM Phase 4) | gov |
| SPORE-CAP-004 | I-002: guest DWI isolate attempted to mutate V_DPM directly | PLANNED (DRCM Phase 5) | gov |
| SPORE-CAP-CONFUSION | capability request fails structural match | PLANNED (DRCM Phase 4) | gov |
| SPORE-STEP-002 | I-001: cross-trust-boundary call made without `step` (no live pointers may cross; `step` allocates a shared-nothing ≤4 MB DWI isolate) | PLANNED (DRCM Phase 5) | gov |

> Architecture rules without their own code: I-003 (DWI isolates shared-nothing, no global mutable state — structurally enforced by the WASM linear-memory model); I-004 (DSS itself is a `.spore`→WASM program; Wasmtime is the TCB).

---

## 5. Monotonic Security / DRCM Posture (M-)

| Code (SPORE-*) | Rule / what it enforces | Enforcement | Source doc |
|---|---|---|---|
| SPORE-MONO-001 | M-001: attempted capability expansion — once a V_DPM bit is cleared it cannot be re-set in the same session (Monotonic Security Rule) | PLANNED (DRCM Phase 4) | gov |
| SPORE-MONO-002 | M-002: capability requested beyond the Wasmtime launch configuration (DPM bounded by OCI/gVisor Layer-2) | PLANNED (DRCM Phase 5) | gov |
| SPORE-MONO-003 | M-003: emergency policy overlay attempted de-escalation (overlays are one-way; may escalate Tier1→2→3, never revert) | PLANNED (DRCM Phase 4) | gov |

---

## 6. Invariants & Termination (INV-/TERM-)

| Code (SPORE-*) | Rule / what it enforces | Enforcement | Source doc |
|---|---|---|---|
| SPORE-INV-000 | RUNTIME — `unreachable` hardware trap fired; DSS emits Audit Event (CBOR Tag 410) | PLANNED (DRCM Phase 5, #76) | gov |
| SPORE-INV-001 | pre-condition `ensure expr` statically proved false at compile time | ENFORCED (task #36) | gov |
| SPORE-INV-002 | post-condition `ensure` failed after body (DbC output post-condition) | PLANNED (Phase 2) | gov |
| SPORE-INV-003 | `invariant {}` declared empty, or misplaced outside `contract {}` | ENFORCED (empty) + PLANNED (misplacement) | gov |
| SPORE-INV-004 | `ensure` expression references a symbol not in the flow's parameter scope | ENFORCED (task INV-004) | gov |
| SPORE-TERM-001 | `decreases` annotation violation (termination proof) | ENFORCED | gov |

---

## 7. Substrate / Crypto-Lane / Tiering (SUBSTRATE-/CRYPTO-/TIER-)

| Code (SPORE-*) | Rule / what it enforces | Enforcement | Source doc |
|---|---|---|---|
| SPORE-SUBSTRATE-001 | crypto-on-core: `crypto.hash/sign/verify/encrypt/decrypt/seal` must run on a deterministic bit-exact (digital) lane | ENFORCED | gov |
| SPORE-SUBSTRATE-005 | compute-only-lane: a network/persistence/secret/process external-reach effect declared on a noisy/photonic lane — that lane is an untrusted Tier-3 compute-only accelerator with ZERO external reach; effect must move to a digital lane (confused-deputy fence) | ENFORCED | gov |
| SPORE-CRYPTO-PQ-001 | `crypto.sign` in a certified profile must declare a PQ/hybrid algorithm (`crypto.sign.hybrid`/`mldsa65`/`slhdsa`) | ENFORCED (certified profiles) | gov |
| SPORE-RETAIN-001 | sound-erasure: a write-once/fixed-media substrate (`eraseModel: crypto-only`) may only receive KEM-DEM ciphertext; cleartext-secret-tainted value reaching it is fail-closed. "Delete" = key destruction + witness (NIST SP 800-88 "Purge") | ENFORCED at decision core + signed discovery rail (R&D 0116/0118); Stage-1 trap / Stage-3 witness owner-gated; physical dispatch HW-gated | gov |

---

## 8. Tenant Isolation / IDOR (TENANT-)

| Code (SPORE-*) | Rule / what it enforces | Enforcement | Source doc |
|---|---|---|---|
| SPORE-TENANT-001 | dangling `tenant.scope` caller-scope binding with no `.tenant_scoped` data-access effect to bind (advisory) | ENFORCED (R&D 0109) | gov |
| SPORE-TENANT-002 | tenant-scoped data access (`*.tenant_scoped`) not bound to the caller's proven scope — deny-by-default IDOR / OWASP-A01 compile gate, fail-closed in every profile (capability intersection over the manifest) | ENFORCED (R&D 0109) | gov |
| SPORE-TENANT-003 | body-dataflow proof that the tenant binding is actually applied (deferred follow-on to TENANT-002) | PLANNED (deferred) | gov |

---

## 9. Identity, Attestation & Proof Receipts (ID-/PROOF-CERT-/ASSUME-/AU-)

| Code (SPORE-*) | Rule / what it enforces | Enforcement | Source doc |
|---|---|---|---|
| SPORE-ID-001 | ID-001/ID-003: compiled artifact's `.lmanifest` missing, tampered, or signature/hash verification failed (Ed25519 + ML-DSA-65; SHA-256 binary hash). Hard admission gate | PLANNED (DRCM Phase 3) | gov |
| SPORE-PROOF-CERT-001 | certified profile refuses a Phase-1 placeholder / undecodable `zk_snark_receipt` proof (forgeable public-input recompute). CWE-347/345 | ENFORCED (R&D 0094, certified path) | gov |
| SPORE-PROOF-CERT-002 | certified profile rejected a `zk_snark_receipt` that did not `verify() === true` against the claimed input (or no verifier supplied — deny-by-default) | ENFORCED (R&D 0094, certified path) | gov |
| SPORE-ASSUME-001 | PT-001: `assuming(flowRef,"claim")` condition not found in the referenced flow's manifest ProofObligations | PLANNED (task #73) | gov |
| SPORE-ASSUME-002 | referenced manifest signature invalid or expired | PLANNED (task #74) | gov |
| SPORE-ASSUME-003 | manifest `sourceHash` mismatch — referenced flow changed since the manifest was signed | PLANNED (task #74) | gov |
| SPORE-ASSUME-004 | condition found as `runtime-precheck` only (partial proof — WAT gate still needed) | PLANNED (task #74) | gov |
| SPORE-AU-001 | AU-001: `epilogue { strategy: none }` on a high-trust flow (`max_risk_liability: high`) | PLANNED (DRCM Phase 6) | gov |

> ID-002 (ML-DSA-65 = minimum PQ signing algorithm for `.lmanifest`, epilogue receipts, GovernanceSignature) and AU-002 (output streams pass the Secret Sink Monitor) are PRINCIPLE/PLANNED rules without distinct compile codes.

---

## 10. Resilience / Fault-Handling / Observability (RES-/FAULT-/OBS-)

| Code (SPORE-*) | Rule / what it enforces | Enforcement | Source doc |
|---|---|---|---|
| SPORE-RES-001 | `retry` on `database.write`/`gateway.charge` without `idempotent: true` | ENFORCED (task #58) | gov |
| SPORE-RES-CB-PENDING | declared-but-inert safety control: `resilience { fallback circuit_breaker }` is a NO-OP today (DRCM Phase 5) — must not read as enforced | ENFORCED warning (R&D 0120) | gov |
| SPORE-FAULT-001 | `on_denial_fault retry` — retrying a capability denial collides with deny-only monotonicity (SPORE-MONO-001) | ENFORCED (0017) | gov |
| SPORE-FAULT-002 | `fallback <flow>` whose effect-set is not a subset of the post-fault capability set | PLANNED (0017 follow-on) | gov |
| SPORE-FAULT-003 | fail-OPEN fault action (`log` outside the `on_rotation_fault` back-compat opt-in — keeps serving past the fault) | ENFORCED (0017) | gov |
| SPORE-FAULT-004 | `fallback <flow>` recursion/cycle beyond depth-1 | PLANNED (0017 follow-on) | gov |
| SPORE-OBS-001 | explicit `observability {}` on a `pure` flow (no side effects to observe) | ENFORCED (task #58) | gov |

---

## 11. Economics (EC-)

| Code (SPORE-*) | Rule / what it enforces | Enforcement | Source doc |
|---|---|---|---|
| SPORE-EC-001 | EC-002: static cost overflow — estimated loop cost exceeds `max_aggregate_flow_budget` | PLANNED (DRCM Phase 5) | gov |
| SPORE-EC-002 | EC-003: `charge_failure_tolerance_ratio` breached — DPM quarantine triggered (monotonic, per M-001) | PLANNED (DRCM Phase 5) | gov |

> EC-001 (economics auto-by-default; declare only to override) is a no-code ENFORCED rule.

---

## 12. Resources / Isolation Runtime (RESOURCE-)

| Code (SPORE-*) | Rule / what it enforces | Enforcement | Source doc |
|---|---|---|---|
| SPORE-RESOURCE-001 | fuel exhaustion in a DWI isolate | PLANNED (DRCM Phase 5) | gov |

---

## 13. Supply-Chain / SBOM / Workspace-Index Integrity (SBOM-/INTEL-/SUPPLY-)

| Code (SPORE-*) | Rule / what it enforces | Enforcement | Source doc |
|---|---|---|---|
| SPORE-SBOM-001 | CycloneDX SBOM must never claim integrity it lacks — a component without a well-formed `sha256:<64hex>` hash is emitted `galerina:integrity=UNVERIFIED`, BOM marked `complete=false` (fail-closed) | ENFORCED (R&D 0120-F3) | gov |
| SPORE-INTEL-001 | poisoned-index guard: `workspace.lindex` bound under an integrity tag (HMAC-SHA256 if `GALERINA_INDEX_HMAC_KEY` set, else SHA-256); mismatch → discard cache + full re-parse (fail-closed) | ENFORCED (R&D 0098) | gov |
| SPORE-INTEL-002 | a caller-supplied `indexDir` containing a `..` traversal segment is refused before any write (CWE-22) | ENFORCED (R&D 0098) | gov |
| SPORE-SUPPLY-001 | OWASP-A06: supply-chain attestation drift against the hash-pinned lockfile | PLANNED / package-level (described in comp-gov OWASP table) | comp-gov |

---

## 14. Imports & Source Boundary (IMPORT-/IM-)

| Code (SPORE-*) | Rule / what it enforces | Enforcement | Source doc |
|---|---|---|---|
| SPORE-IMPORT-005 | IM-: import path escapes the allowed project root — pre-governance path traversal (must stay within `GALERINA_FS_ROOT`/cwd; segment-safe + post-symlink-canonicalization) | ENFORCED | gov |
| SPORE-IMPORT-006 | imported file exceeds the maximum import size — compile-time read-DoS guard (stat-checked before read) | ENFORCED | gov |
| SPORE-IMPORT-001 | IM-001: `import "./path.spore"` target file not found at the resolved path | PLANNED (v2.1) | gov |
| SPORE-IMPORT-002 | IM-002: imported file has parse errors — cannot merge DAG | PLANNED (v2.1) | gov |
| SPORE-IMPORT-003 | IM-003: circular import detected in the import chain | PLANNED (v2.1) | gov |
| SPORE-IMPORT-004 | IM-004: imported symbol name conflicts with a local definition (local wins) | PLANNED warning (v2.1) | gov |

---

## 15. Access / Assimilation / Gate (ACCESS-/ASSIMILATE-/GATE-)

| Code (SPORE-*) | Rule / what it enforces | Enforcement | Source doc |
|---|---|---|---|
| SPORE-ACCESS-001 | AC-001: `access { grant X }` references an unknown capability name | PLANNED warning (v2.1) | gov |
| SPORE-ACCESS-002 | AC-002: `grant` capability not declared in the flow's `effects {}` | PLANNED warning (v2.1) | gov |
| SPORE-ASSIMILATE-001 | AS-001: `assimilate` plugin declared outside `boot.spore` (boot-time only) | PLANNED warning (v2.1) | gov |
| SPORE-ASSIMILATE-002 | AS-002: `assimilation_memory_budget` not declared in `governance {}` | PLANNED warning (v2.1) | gov |
| SPORE-ASSIMILATE-003 | AS-003: assimilated plugin has no `access { grant }` block (inherits no capabilities) | PLANNED error (v2.1) | gov |
| SPORE-GATE-001 | GT-001: `gate(condition)` references a condition not in `knownDomainGuards` | PLANNED warning → Phase-5 error (v2.1) | gov |
| SPORE-GATE-002 | GT-002: `gate {}` wrapping a `pure flow` (redundant — pure flows have no effects) | PLANNED (v2.1) | gov |

---

## 16. Static Declarations & Bitfields (STATIC-/BF-)

| Code (SPORE-*) | Rule / what it enforces | Enforcement | Source doc |
|---|---|---|---|
| SPORE-STATIC-001 | ST-001: `static` value is not a compile-time constant (contains runtime expressions) | PLANNED (v2.1) | gov |
| SPORE-STATIC-002 | ST-002: `static` name declared more than once in scope | PLANNED (v2.1) | gov |
| SPORE-BF-001 | BF-001: two fields in a `bitfield` use the same bit position | PLANNED (v2.1) | gov |
| SPORE-BF-002 | BF-002: bit position exceeds 31 (V_DPM is a 32-bit register) | PLANNED (v2.1) | gov |

---

## 17. Feature Gates & Lifecycle (FG-/DRCM-/DEP-)

| Code (SPORE-*) | Rule / what it enforces | Enforcement | Source doc |
|---|---|---|---|
| SPORE-DRCM-UNSUPPORTED | A-004: bare `step`/DRCM syntax used without an `@experimental_profile` wrapper in `--release` | PLANNED (parser, 2026-07) | gov |
| SPORE-FG-001 | FG-001: `@experimental_profile` wraps already-stable syntax (cleanup signal) | PLANNED (parser, 2026-07) | gov |
| SPORE-DEP-001 | LC-002: deprecated syntax in use — migration available | PLANNED (post-DRCM) | gov |

---

## 18. Type System — Trust/Sensitivity & Operators (TYPE-/SAFETY-)

| Code (SPORE-*) | Rule / what it enforces | Enforcement | Source doc |
|---|---|---|---|
| SPORE-TYPE-003 | a domain/brand type (`Email`, `CustomerId`, `Array<Email>`, …) assigned from a raw `unsafe let` value — domain types imply validation. Trust (`unsafe let`/`safe mut`) and sensitivity (`protected`/`redacted`) are independent axes | (documented Phase 9B target) | trust |
| SPORE-TYPE-004 | InvalidBinaryOperation — operator applied to unsupported operand types: `String + Int`, cross-currency `Money<GBP> + Money<USD>`, `Tri && / ||`, `Tri` as branch condition, `String < String`, undeclared-`Eq` record `==` | (Phase 7B target) | op |
| SPORE-TYPE-005 | InvalidUnaryOperation — `!` on non-`Bool`, unary `-` on non-numeric, `!Tri` | (Phase 7B target) | op |
| SPORE-SAFETY-001 | `Tri` used as a truthy/falsy branch condition (must `match` all three of `True`/`False`/`Unknown`) | (referenced alongside TYPE-004) | op |

> Field-read rules (`field-read-rules.md`): explicit `allow read … fields:[…]` allow-lists are safest; `all except […]` is broad/riskier; `all current except […]` snapshots the resolved field set and denies future fields until review; `fields: all` requires stronger review. These are *authoring/report* rules (warnings + field-read report entries), not yet a numbered `SPORE-*` code in the registry.

---

## 19. Compliance — PII / PHI / PCI / SOX / GDPR (compliance package codes)

> These codes come from the compliance KBs (`comp-gov`, `comp-pkg`). They describe the compliance-package
> layer (`@galerina/compliance-*`, Phase 38/46+). Several are **package-level / planned** rather than core-compiler-enforced today.

| Code (SPORE-*) | Rule / what it enforces | Enforcement | Source doc |
|---|---|---|---|
| SPORE-PII-001 | `PII<T>` value reached an unapproved sink (e.g. logger) | PLANNED / package (comp-gov) | comp-gov |
| SPORE-PII-002 | `PII<T>` stored without an encryption declaration | PLANNED / package | comp-gov |
| SPORE-PII-003 | `PII<T>` transmitted without a consent check | PLANNED / package | comp-gov |
| SPORE-PHI-001 | `PHI<T>` value reached an unapproved sink (HIPAA) | PLANNED / package | comp-gov |
| SPORE-PHI-002 | `PHI<T>` access lacks a declared purpose (HIPAA Minimum-Necessary) | PLANNED / package | comp-gov |
| SPORE-PCI-001 | PCI cardholder data reached a non-PCI context | PLANNED / package | comp-gov |
| SPORE-PCI-002 | raw PAN (`PCI<String>`) stored after authorization | PLANNED / package | comp-gov |
| SPORE-AUDIT-001 | regulated write lacks the `audit.write` effect (SOX/GDPR) | PLANNED / package | comp-gov |
| SPORE-AUDIT-002 | immutable audit log (`audit.immutable`) cannot be deleted | PLANNED / package | comp-gov |
| SPORE-CONSENT-001 | personal data processed without a consent check | PLANNED / package | comp-gov |
| SPORE-RETENTION-001 | retention schedule required for this data type | PLANNED / package | comp-gov |
| SPORE_HIPAA_001 | PHI without `protected_boundary` (exported by `@galerina/compliance-hipaa`) | PLANNED / package (comp-pkg) | comp-pkg |
| SPORE_EU_AI_001 | high-risk AI without event logging (EU AI Act Art. 12; `@galerina/compliance-eu-ai-act`) | PLANNED / package | comp-pkg |

**OWASP Top-10 compiler-coverage mapping** (comp-gov): A01 Broken Access Control → capability system / `SPORE-TENANT-002`; A02 Crypto Failures → compile-time crypto policy; A03 Injection → `Tainted<T>` propagation; A04 Insecure Design → effect/intent graph; A05 Misconfiguration → production-profile gates; A06 Vulnerable Components → `SPORE-SUPPLY-001`; A07 Auth/Session → `SecureString`/`ProtectedSecret<T>`; A08 Integrity Failures → governance manifests; A09 Logging Failures → `audit.write` + `PII<T>` sink block; A10 SSRF → network allowlist (`network.external`).

**Regulatory mapping** (comp): EU AI Act Art. 12/13, HIPAA §164.312, SOC 2 TSC, SEC 17a-4, ISO 27001, NIST CSF 2.0 — satisfied structurally via GovernanceGraph/ProofGraph/CapabilityGraph/PrivacyGraph/LineageGraph/AuditGraph/CostGraph + `galerina-verify` offline proof CLI. These are architecture mappings, not individual `SPORE-*` codes.

---

## 20. Process / Testing / CI (no diagnostic codes — discipline rules)

| Rule | What it enforces | Enforcement | Source doc |
|---|---|---|---|
| P-001 / T-005 | run graph + full tests at every phase/Stop boundary (`run-phase-close.mjs`: 13 suites + security audit + graph re-index) | ENFORCED (Stop hook) | gov |
| P-002 | update docs/KB in the same session as any syntax/semantics/architecture change | PRINCIPLE | gov |
| P-003 | DRCM implementation (#30–#44) blocked until primary runtime roadmap completes | PRINCIPLE | gov |
| P-004 / T-004 | Stage B must keep parity with Stage A — R6 corpus (5 flows, 21 cases) is the minimum gate | ENFORCED (CI) | gov |
| P-005 | no Rust in the project except benchmark harnesses | PRINCIPLE | gov |
| T-001 | every `SPORE-*` code must have a negative test (`tests/negative/`) | PRINCIPLE + PLANNED | gov |
| T-002 | DRCM containment tests must attempt real violations (path traversal, fuel exhaustion, secret injection, V_DPM mutation, manifest tamper) | PLANNED (Phase 7) | gov |
| T-003 | architecture patterns 1–6 must have working compiled examples | PENDING (#46) | gov |
| T-006 | Goal A acceptance: static proof eliminates runtime overhead (≤5% delta) | PLANNED (post-Phase 2) | gov |
| T-007 | Goal B acceptance: single-cycle bitmask trap fires on a revoked capability | PLANNED (post-Phase 5) | gov |
| T-008 | Goal C acceptance: an isolated fault does not crash the supervisor / siblings | PLANNED (post-Phase 5) | gov |
| LC-001 | contract updates are atomic — partial migrations rejected at the admission gate | PLANNED (post-DRCM) | gov |
| LC-003 | `@experimental_profile` blocks graduate by removing the directive + recompiling | PRINCIPLE | gov |

---

## 21. Comment / Annotation Syntax (from the SoT)

| Syntax | Token | Purpose |
|---|---|---|
| `// text` | `comment` | Code documentation — discarded after parse |
| `/// text` | `docComment` | API documentation — extracted by doc tooling |
| `;; text` | `govComment` | Governance annotation — scanned by verifier, stored in `.lmanifest` (`governanceAnnotations[]`) |
| `/* text */` | `comment` | Block comment — discarded after parse |
| `;` (trailing) | `newline` | Optional statement separator — silently collapsed |

---

## 22. Registry-vs-Code Gap Analysis

This snapshot indexes **105** distinct `SPORE-*` codes from the documentation sources and **459** distinct
`SPORE-*` codes referenced in `packages-galerina/**/src/**/*.ts`. The two sets diverge substantially — most
notably, a large body of compiler-enforced codes exists **in code but is absent from every KB doc** (the prose
registry covers the governance/DRCM surface thoroughly but lags the lexer/parser/type-checker/config/package
diagnostic surface).

### 22a. Codes found ONLY in code (enforced/referenced in `src`, NOT in any doc source)

These are the real "documentation gaps" — diagnostics live in the implementation but the registry/KB does not
list them. Grouped by family (count shown). Descriptions are NOT transcribed because they are not authored in the
KB; treat the family name as the only verified fact. **The single biggest gap is the `CONFIG`, `LOGIC`, `TYPE-007+`,
`TAINT`, `VAULT`, `FUSE-*`, `PCI-003+`, `MEMORY`, `BORDER`, `PGRAPH`, `PROFILE`, `SYNTAX-00x`, and `LEX` families.**

- **Lexer/Parser:** SPORE-LEX-001..006; SPORE-PARSE / -001/-002/-003 / -DEPTH-001; SPORE-PARSE-DEPTH-001; SPORE-SYNTAX-001/002/003/005/006/007/008/009/010; SPORE-SYNTAX-LEGACY-001/002
- **Type system (beyond -003/-004/-005):** SPORE-TYPE-001, -002, -007..-023, -030, -031
- **Config / profile gates:** SPORE-CONFIG (+ -001..-027), SPORE-CONFIG-GOV-001/002/003, SPORE-PROFILE (+ -001..-007, -005B)
- **Governance (registry lists 001/003/005/010/017/018/019/020 only):** SPORE-GOV-002, -006..-009, -011..-016, SPORE-GOV-3VL-001
- **Taint / value-state:** SPORE-TAINT (+ -001..-006); SPORE-VALUESTATE (+ -001..-003, -005..-008) *(note: registry text references VALUESTATE-004 but it is not in the code grep)*
- **Secrets/vault extra:** SPORE-VAULT-001..005; SPORE-SECRET (bare)
- **Logic / Tri / decision:** SPORE-LOGIC-001..014; SPORE-TRI-001..005; SPORE-DECISION-001..005; SPORE-MATCH-001; SPORE-SAFETY-002..006; SPORE-GOV-3VL-001
- **Primitives:** SPORE-BYTE-001..005; SPORE-CHAR-001..004; SPORE-STRING-001..004; SPORE-NUMERIC-001, SPORE-NUMERIC-OP-001, SPORE-FLOAT-NAN-001
- **Memory safety:** SPORE-MEMORY-001..008; SPORE-RAWPTR-001
- **Effects extra:** SPORE-EFFECT-004, -005; SPORE-RUNTIME-EFFECT-GATE
- **Supply-chain / package fuse (signing/registry/revocation):** SPORE-FUSE-* (29 codes incl. -HASH-MISMATCH, -SIG-INVALID, -KEY-REVOKED, -REVOCATION-UNVERIFIABLE, -UNSIGNED, -HYBRID-*, -SET-*); SPORE-PKG-001..006; SPORE-SBOM-001 *(SBOM-001 IS documented — listed here only because the FUSE/PKG neighbours are not)*
- **Manifest integrity:** SPORE-MANIFEST-DEPTH, -DUPLICATE-KEY, -LENGTH-OVERFLOW; SPORE-WASM-ADMIT; SPORE-PASSPORT-002; SPORE-PROV-001
- **Proof/Privacy graphs:** SPORE-PGRAPH-001..005/010..013/020..023/030; SPORE-GRAPH-001..006; SPORE-DAG-001/002
- **Compliance PCI extra (registry/comp lists 001/002 only):** SPORE-PCI-000, -003..-010
- **Substrate/hardware extra:** SPORE-SUBSTRATE-002/003/004, -DEADZONE; SPORE-HW-001..004; SPORE-COMPUTE-001; SPORE-HINT-COMPUTE-001; SPORE-TIER-001; SPORE-BACKEND-001
- **Borders / boundaries / binding / context:** SPORE-BORDER-001..005; SPORE-BOUNDARY; SPORE-BOOL-BOUNDARY-001..005; SPORE-BINDING-001..006; SPORE-CONTEXT-001; SPORE-BLOCK-001..004
- **Economics extra:** SPORE-ECON-001/002/003 *(distinct from the documented EC-001/EC-002 codes)*
- **Naming / style / architecture:** SPORE-NAME-001..003; SPORE-NAMING-001..005; SPORE-STYLE-001/002, -SEC-001; SPORE-ARCH-001/002; SPORE-INHERIT-001/002
- **Runtime / trap / safety:** SPORE-RUNTIME-002..007; SPORE-TRAP-001/002; SPORE-TIMEOUT
- **Misc / infra:** SPORE-AFFINE-001; SPORE-ANTI-ABUSE-001; SPORE-AUDIT-003; SPORE-BUILD-001; SPORE-EVENT-001..005; SPORE-INTENT-001..005; SPORE-NET-001/002; SPORE-OBS-002; SPORE-OMNI-001..005; SPORE-PIPELINE-001..005; SPORE-REPORT-001/005; SPORE-SEC-014/020/021; SPORE-SOURCE-ESCAPE-001; SPORE-STDLIB-001/002; SPORE-IMPORT-000; SPORE-GEN-TEST-005
- **Placeholders (not real codes — template/example strings in source):** SPORE-G, SPORE-XXX-NNN, SPORE-SERIES-NNN, SPORE-PROOF-CERT-00 (truncated literal). These should be ignored.

### 22b. Codes found ONLY in the docs (in a KB source, NOT matched in `src`)

These are documented but not (yet) wired in the scanned `src` — i.e. **planned/spec-only** codes. This is expected
for DRCM-phase and compliance-package codes:

- **DRCM-phase planned:** SPORE-CAP-002, -003, -004, SPORE-CAP-CONFUSION; SPORE-STEP-001, -002; SPORE-MONO-003; SPORE-RESOURCE-001; SPORE-SECRET-FATAL; SPORE-FG-001
- **Resilience follow-ons:** SPORE-FAULT-002, -004
- **Lifecycle:** SPORE-DEP-001 (and the `SPORE-DEP` family stem)
- **Compliance package layer (Phase 38/46+, package-enforced not core):** SPORE-PII-001/002/003; SPORE-PHI-001/002; SPORE-CONSENT-001; SPORE-RETENTION-001; SPORE-AUDIT-001/002; SPORE-SUPPLY-001; SPORE-PRIVACY-001
  - *(`SPORE_HIPAA_001` / `SPORE_EU_AI_001` from comp-pkg use underscores and live in the compliance packages, not scanned `src`.)*

> **Caveats.** (1) The "only in code" set is computed over `packages-galerina/**/src/**/*.ts` only — tests,
> generated WAT, and non-`packages-galerina` trees were not scanned, so a doc-only code could still be enforced
> elsewhere. (2) Family-stem hits (e.g. bare `SPORE-GOV`, `SPORE-FUSE`) are template/prefix constants, not
> distinct diagnostics. (3) `SPORE-MONO-003` and the `compliance` codes are *intentionally* doc-ahead-of-code
> (planned). The actionable gap is **22a**: a large enforced diagnostic surface (config, logic, type, taint,
> vault, fuse, memory, border, pgraph, primitives) that the prose registry in `galerina-governance-rules.md`
> does not yet enumerate.

---

*End of consolidated snapshot. Authoritative source: `galerina-governance-rules.md`.*

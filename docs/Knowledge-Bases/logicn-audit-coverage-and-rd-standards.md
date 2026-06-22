# LogicN — Audit Coverage & R&D Standards (#219)

Owner-directed 2026-06-22: the audit / coverage / R&D standards LogicN requires, **grounded in researched
best-practice + production examples from mature projects** (not invented). Source: research sweep `wb3hevspu`
(7 agents: rustc, Roslyn/Clang, ESLint/Semgrep/golangci, Cedar/OPA, SLSA/in-toto/Sigstore, proof/mutation/fuzz).
Each standard is testable/enforceable and maps to a LogicN enforcer that already exists:
**#215** conformance scanner (`scripts/audit-diagnostic-codes.mjs`) · **#218** coverage cross-check
(`scripts/audit-coverage.mjs`) · **ENV-001** lint gate (`scripts/lint-conventions.mjs`) · **SEC-002** mutation
tests · **BLD-003** provenance · **DOC-004** doc↔source drift. Companion: [coverage cross-check methodology](logicn-coverage-crosscheck-methodology.md).

## Anchor standards
1. **UNIVERSAL COVERAGE (→ #218 + #215).** Every governable construct (every emittable `LLN-*`/`ERR_*` code,
   contract clause, capability/syntax form, effect, stdlib fn, CLI cmd, generated artifact) MUST be indexed by
   ≥1 audit, reconciled **bidirectionally**: index→audit (no blind spots) + audit→index (no phantoms).
   Emittable-but-unregistered OR registered-but-no-longer-emittable MUST fail the build; a registered code with
   0 emit sites MUST be explicitly tagged `retired/no-longer-emitted`, never silently orphaned. Default-on-unknown
   = FAIL. *Basis: rustc `tidy` `error_codes.rs` bidirectional `E####` reconcile + no-longer-emitted tag · Roslyn
   RS2000/2001/2002 shipped/unshipped ledger · OPA `--coverage` covered/not_covered.*
2. **EVERY SECURITY GATE HAS A FAIL-CLOSED TEST (→ SEC-002).** No gate (deny-by-default effect, K3 dead-zone,
   substrate fault, `invariant{ensure}`, revoked-key admission, privacy/secret-egress fence, provenance verify)
   is "done" without a negative test that exercises the failure/indeterminate path, asserts Deny/reject, AND
   **flips RED if the gate is mutated to fail-open** (re-introduce-the-hole). Fail-closed is a proven,
   regression-protected property, not a design claim. Systematizes the ad-hoc i32-overflow / 6-of-6
   fail-closed-invariant guards. *Basis: OWASP Authorization Cheat Sheet (deny-by-default + safe-termination) ·
   StrykerJS/PIT mutation thresholds · seL4 noninterference proof-gating.*

## Diagnostic registry & ID space
3. **Registry completeness (→ #215 + #218).** Every emittable `LLN-*` MUST be in one central registry
   (`logicn-governance-rules.md`, split shipped/unshipped) WITH a long-form explanation; CI diffs source-extracted
   codes vs registry and fails on unregistered-emit / emit-less-registration / missing-explanation. *Basis: rustc
   `error_codes!` + `E####.md` one-per-code + tidy orphan detection · Roslyn RS2000.*
4. **Structured ID space (→ #215 / ENV-001).** Every diagnostic MUST have (a) a stable constant `LLN-<DOMAIN>-<NNN>`
   code, (b) exactly one category from the closed 14-category set (S/C/E/K/I/M/A/P/EC/ID/AU/LC/T/FG), (c) a
   domain-reserved numeric range, (d) a non-null version-stable help URI. Meta-check rejects non-constant /
   duplicate / mis-prefixed / out-of-range / unknown-category / help-missing. *Basis: Roslyn RS1015/1017/1018/1019/1020
   · clang-tidy mandatory group prefix.*
5. **Atomic scaffolding (→ ENV-001 generator + #215).** The ONLY sanctioned way to add a diagnostic is a generator
   that, in one transaction, emits: enforcement code + per-code doc page + test file (≥1 positive + ≥1 negative)
   + registry entry + release-note line. "Code without doc/test" is an unreachable state; anything added outside
   the generator is caught by the registry-completeness check. *Basis: clang-tidy `add_new_check.py` · ESLint
   triad policy · golangci-lint new-linter checklist.*

## Rule docs + tests
6. **Per-rule triad (→ #215 + DOC-004).** A rule is admissible only if the build resolves THREE co-located
   artifacts keyed by the exact code: implementation, doc page, test file — plus a structured metadata record
   (code, description, severity/tier, fix-available, docs URL). Missing any → fail-closed. *Basis: ESLint core
   triad + `meta.docs` · eslint-plugin-eslint-plugin require-meta-* · Semgrep schema-required metadata.*
7. **Positive + negative coverage (→ #218 + SEC-002).** Every rule's test MUST have ≥1 MUST-FLAG fixture (input
   it rejects, asserting exact code + tier) AND ≥1 MUST-PASS near-miss (it must not flag). Absence of either →
   fail-closed; known gaps marked with an explicit TODO annotation, never omitted. *Basis: ESLint/typescript-eslint
   RuleTester (throws if no valid OR no invalid case) · Semgrep `ruleid:`/`ok:` + tracked `todoruleid:`.*
8. **Exhaustive snapshot assertions (→ #218 + DOC-004).** Every diagnostic MUST have ≥1 snapshot test: a `.lln`
   fixture + a golden capture of the FULL governance output (code, message, span, suggestion, verdict tier), at
   message granularity (an extra unasserted OR a missing asserted diagnostic fails). Fixtures exhaustively
   annotate every expected verdict inline (`//~ DENY LLN-PRIVACY-002`). Output changes force a reviewed re-bless;
   new diagnostics ship fixture + blessed snapshot in the same change. *Basis: rustc `tests/ui` `.stderr` + `--bless`
   + `//~` exhaustive annotations · clang-tidy `CHECK-MESSAGES`.*
9. **Executable doc examples (→ DOC-004 + #215).** Every explanation MUST embed a runnable `.lln` snippet that
   produces that exact code; CI compiles it and asserts the emitted code matches. A documented example that no
   longer errors (esp. a deny-by-default rule) is a fail-closed regression. The one-line summary is single-sourced
   across code descriptor / doc / release-note (drift fails). *Basis: rustc `error_index_generator` runs
   `compile_fail,E####` doctests + tidy "doesn't use its own error code".*
10. **Derived catalog + changelog (→ DOC-004 + #218).** The public diagnostics catalog / KB registry index AND
    governance release-notes MUST be machine-GENERATED from rule metadata; CI runs the generator in check/diff
    mode and fails on any diff (catches an added/renamed rule whose docs/index/changelog wasn't updated). *Basis:
    `eslint-doc-generator --check` · Roslyn `AnalyzerReleases.*.md`.*

## Coverage gate
11. **Policy/clause coverage threshold (→ #218 + ENV-001).** Every rule/clause MUST be exercised ≥1×; the harness
    emits per-clause coverage (distinguishing "condition never true" from "expression never evaluated"), supports a
    minimum-coverage floor and exits non-zero below it (unknown = FAIL), attaches the report to every PR touching
    contracts/policies, and a failing governance test blocks merge. *Basis: OPA `opa test --coverage` + `opa eval
    --fail` · conftest.*

## Correctness rigor (R&D standards)
12. **Mutation testing (→ SEC-002, the largest gate).** Correctness-critical modules (rule evaluators, tri-tier
    interpreter, crypto/.tmf engine, fail-closed-invariant suite) run mutation testing in CI with a hard break
    threshold (non-zero exit on low score); a surviving mutant in a security path fails the build. The permanent
    fail-closed guards are specifically mutation-tested (flip Deny→Allow / trap→value-semantics ⇒ caught). *Basis:
    StrykerJS `thresholds.break` · PIT `mutationThreshold`.*
13. **Property-based testing (→ SEC-002 + #218).** Security/arithmetic surfaces covered by property tests over
    generated+shrunk adversarial inputs with a persisted failure corpus — e.g. checked-arith never silently drops
    overflow/div0, taint is monotone, seal()/redact() are the sole secret-taint discharges, K3 0=INDETERMINATE
    never aliases a masked value. Supersedes fixed-pair sampling (the retired 3M tri-tier sample). *Basis:
    Hypothesis · Quviq QuickCheck.*
14. **Differential model-vs-impl (→ SEC-002 + #218, extends Stage-A==Stage-B parity).** Where a reference model +
    a production interpreter/WASM path both exist (tri-tier i32 conformance, Stage-A vs Stage-B), CI runs
    large-scale differential/fuzz testing into BOTH and fails on any divergence. *Basis: AWS Cedar `cedar-drt`
    (~100M tests/6h nightly, Lean/Dafny model vs Rust impl).*
15. **Continuous fuzzing of toxic borders (→ SEC-002 + #215 border inventory).** Every untrusted-input border
    (`.lln` lexer/parser, `.tmf` container/KEM-DEM decoder, runtime DMZ border-check, Tier-3 bridges) has a fuzz
    harness in a continuous job; crashes fail-closed (reject), auto-captured as regression corpus; a fix isn't
    accepted until the reproducer is in the corpus. *Basis: Google OSS-Fuzz.*
16. **Proof-gating (→ SEC-002 + BLD-003 proof-artifact freshness).** A change to a correctness-critical kernel
    surface (admission gate, tri-tier conformance, crypto digest path, DRCM containment) isn't done until a
    machine-checked proof — Z3/SMT translation-validation (the "math compiler" direction) or refinement argument —
    shows conformance to spec; the proof artifact is a required, checked-in gate output; absence of a current
    passing proof blocks release of that surface. *Basis: seL4 refinement gating · Cedar `cedar-lean` model-as-spec.*
17. **Design-level model-checking (→ SEC-002 pre-impl gate + DOC-004).** Any new concurrency/distribution or
    multi-step governance protocol (mid-compute capability revocation, key rotation/revocation registry, inter-flow
    escalation) has safety invariants written as a machine-checkable model (TLA+ or Z3) and exhaustively checked
    BEFORE implementation; the model + run + any counterexample recorded in the R&D ledger. *Basis: "Formal Methods
    at AWS" (TLA+/TLC found design bugs incl. a 35-step counterexample).*

## Provenance (BLD-003)
18. **Graded provenance + verify choke point.** Every governed artifact carries a provenance record at a declared
    SLSA-equivalent level (L1 floor; L2 = signed by a dedicated build identity; L3 = per-flow build isolation +
    signing-key unreachable from user/build steps). No artifact is admitted/executed without a VERIFY pass that
    ALL hold: (1) recomputed digest == attested subject, (2) signature valid against an append-only log, (3)
    signer/build identity == contract-declared producer. The declared level is an admission gate (kernel.ts), not
    advisory metadata; extends to dependency intake. *Basis: SLSA v1.0 L1/L2/L3 · in-toto digest-bound subjects ·
    Sigstore cosign+Fulcio+Rekor · `gh attestation verify`/`npm audit signatures`.*
19. **Auto-rotating, identity-bound keys.** Signatures bind to artifacts by content digest (SHA-256, matching the
    SHA-256+ML-DSA posture), never by name/path/version; prefer short-lived identity-bound keys — anchor ONE
    hardware-protected root, auto-rotate leaves, revoke-on-rotate; never key material on a CLI. Every signing event
    in an append-only tamper-evident log; revocation machine-evaluated at admission (revoked key ⇒ Deny — closes
    the markdown-only REV-2026-06 gap). *Basis: Sigstore keyless (ephemeral OIDC-bound key) · in-toto digest-binding
    · npm provenance.* (Aligns with the [keys-rotate-automatically] feedback.)
20. **Reproducibility + freshness (folds #216).** Governed builds are deterministic (pinned source + recorded env
    ⇒ bit-identical artifact/digest; extends Stage-A==Stage-B + DRCM); emit a machine-readable env manifest;
    reproducibility-BAD is fail-closed; trust raisable by N-of-M independent rebuilds. Separately, every GENERATED
    artifact (graph, code-index, `.wasm`, `.lmanifest`, reports) is stamped with git-commit + tool-version +
    build-time, and CI FAILS if stale vs HEAD — "is this current?" a check, not a guess. *Basis: Debian Reproducible
    Builds (`.buildinfo`, rebuilderd GOOD/BAD, `SOURCE_DATE_EPOCH`) · folds LogicN #216.*

## Status / how to use
These are the bar each enforcer is measured against. **Current reality (honest):** the enforcers EXIST but most
standards are not yet fully met — e.g. #215 scanner runs but isn't CI-enforcing (154 baseline); #218 coverage
runs (codes dimension) but 317 codes are registry-uncovered (std 1/3); snapshot/triad/coverage-threshold/mutation/
proof standards are largely aspirational. Adopt incrementally: wire each standard into its enforcer, drive its
metric to green, then flip that enforcer to CI-enforcing. Full per-facet research evidence: task `wb3hevspu.output`.

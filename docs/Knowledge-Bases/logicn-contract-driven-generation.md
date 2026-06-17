# Contract-Driven Generation — tests, compliance, audit, manifests (design + grounded gap map)

> **Owner idea (2026-06-17):** the `contract` in a `flow` already defines the failure states
> mathematically, so the compiler should **synthesise** the hostile tests (and the compliance
> evidence) humans skip — generated/regenerated from the CLI — instead of relying on developer
> intuition. Extends to PCI/SOC2 reports, audit logs, manifests/SBOM — **"as part of the app, not
> just LogicN."** Plus a "probably a NO": redesigning POSIX `tail`/`curl`/`grep`/`kill` natively for
> photonic/ternary logic.
>
> This doc records the **grounded** verdict (a 5-agent verify-before-build sweep, 2026-06-17) — what
> is already shipped vs. the real gap — and the design decisions. R&D jobs **0016/0017/0018** carry
> the design forward. The principle is sound; the discipline is: **build the narrow
> generators/mappers on top of the shipped GIR/manifest/PCI surfaces — do not re-derive them.**

## Why it fits LogicN uniquely
In a normal language a dev must *imagine* what could go wrong (happy-path bias). A LogicN `contract`
is a machine-readable spec of the boundaries (capabilities, effects, limits, tolerance, substrate,
faults), so the generator has the exact failure states. It shifts the burden of proof: the human
writes airtight contracts, the engine writes the security audit. This is the Zero-Trust evolution —
you can't "forget" to test a missing-capability state if the test is generated from the contract.

## Grounded shipped-vs-gap map (verify-before-build)
| Area | Shipped | Verdict | The real gap |
|---|---|---|---|
| **Contract→tests** | **~80%** | **R&D-design first (job 0016)** | The *substrate* is shipped — `parser.ts` exposes every contract sub-block as AST; `gir-emitter.ts` `GIRFlow` is traversable; `effect-checker.ts` gives declared-vs-inferred; `capability-types.ts` has the K3 bit algebra; 3 conformance suites already "test the compiler." A **paper spec exists** (`logicn-developer-tooling-advanced.md`, `LLN-GEN-TEST-001..007`, incl. `-005` overwrite-guard). But the **generator is 0% built**, no property engine is wired (the "fast-check" in-repo is a *comment*), and the senior-dev pieces (Contract-Coverage metric, seeds, escape-hatch) are undesigned. |
| **Contract→compliance / audit / manifest / SBOM** | **~60%** | **mostly-shipped wire-gap (job 0018)** | Evidence is auto-generated: signed `lln.manifest.v1` (`manifest-generator.ts`), `governance-impact.json`, W3C-PROV provenance, PCI `runPciAudit` + a SHA-256 **compliance-ledger**. Gaps: **no capability→regulatory-control mapping** (the keystone), SOC2 = zero code, contract-keyed SBOM doc-only, runtime per-decision audit events (Phase 5 #102-104), no **unified attestation report**, no declared-vs-observed correlation. |
| **Native POSIX redesign** (`tail`/`curl`/`grep`/`kill`) | **~15%** | **track-not-build** (owner's "NO" is correct) | No photonic/ternary substrate to redesign *for* (BitNet is a Stage-A deterministic simulator; THA-162 ternary hashing already **REJECTED** in the roadmap; crypto-on-core caps photonic at bulk math). `kill→TRAP/ERASE` already shipped (zeroize). `resonance-grep` = ANN search, already adjudicated (FHE verdict + killed cleartext-semantic-routing). **Only buildable slice = #125 `secure-flow-run`** (a CLI verb over the shipped Tower LOAD→EXEC→ERASE + trap + fuse-loader) — plumbing, not photonics. |

## Senior-dev standards the generator must meet (adoption levers)
- **TAP + JUnit XML.** `node:test` emits TAP natively (≈free); JUnit XML is a thin adapter → CI parses both with zero custom scripting.
- **Deterministic seeds.** Every fuzzed vector carries a seed; a failure prints `logicn test --seed 0x…` to reproduce exactly. No flaky tests.
- **Escape hatch (the #1 adoption lever).** Read-only `*.auto.test.*` (regenerated, never hand-edited; formalises `LLN-GEN-TEST-005`) + hand-written `*.custom.test.*` sidecars that are never clobbered.
- **Contract Coverage metric.** The LogicN analog of line coverage, but stronger: every clause (capability × {Allow/Deny/Unknown}, each limit × {pass/violate}, each effect/taint sink, each fault) must have a generated test that **assaults and defends** it. Report % of clauses covered. Tie to the contract **CFG fingerprint** (0011(d)) → a contract change that doesn't regenerate is a CI failure.
- **Idempotent generation.** Same contract → byte-identical output (diffable in PRs).

## What the generator synthesises (the vector taxonomy)
K3 capability matrix (Allow→succeed / Deny→border-denial / **Unknown→coerce-to-Deny + LOAD→TRAP→ERASE**) · numeric boundaries (limit→pass, limit+ε→fail, 0, underflow, overflow) · substrate/type violation (continuous params into a discrete-engine flow → `LLN-SUBSTRATE-001` pre-execution) · secret/PII egress to a sink (seal/redact floor) · **fault injection** (`on_*_fault` → simulated KMS/denial fault asserts fail-*closed*) · deny-by-default for unknown routes/verbs. *(Fault tests are blocked on job 0017 — `on_*_fault` does not parse yet.)*

## Design decisions (owner's open questions)
1. **Write-to-disk vs ephemeral → both, split by role.** Write read-only `*.auto.test.*` to disk *for readability* (ephemeral black-box tests are the "black magic" senior devs reject); in CI **regenerate from the contract and diff against the committed copy** (mismatch = fail). The on-disk file is a transparency artifact — the contract is the source of truth, so a tampered on-disk test can't weaken the gate.
2. **K3 denial tests: mock by default, real "dummy border gateway" as opt-in `--integration`.** The K3 gate is pure logic, so most governance properties are provable hermetically by mocking the capability state (fast, deterministic, CI-friendly). The physical border is a slower integration tier.
3. **Audit-log storage: layered, the chained ledger is the anchor.** Append to a local cryptographically-chained immutable ledger (tamper-evident, survives partition, defeats server-breach-deletes-logs) *and* stream to a write-only SIEM (aggregation/alerting). Never make either the only copy. (The compliance-ledger SHA-256 chain is the shipped primitive.)

## R&D jobs dispatched (2026-06-17)
- **0016** — contract→test generator over GIR (+ Contract-Coverage metric, seed policy, escape-hatch, mock infra, property-engine choice; prototype on real flows). Extends `LLN-GEN-TEST-001..007`.
- **0017** — first-class `on_*_fault` handler grammar/AST/GIR (prereq for fault-injection tests; reconcile with #58 auto-by-default; fail-closed default).
- **0018** — capability→regulatory-control mapping + unified attestation report ("app emits its own evidence"); PCI DSS 4.0.1 first, SOC2 wrapper on the compliance-ledger.

## Build carve-out (not R&D)
**#125 `secure-flow-run`** (`logicn run --governed` over shipped Tower LOAD→EXEC→ERASE + trap + fuse-loader, + `kill`/`erase` over `TowerRuntime.evict()`) is the *only* salvageable, non-photonic slice of the native-tools idea — a plain CLI-ergonomics build, explicitly scoped to exclude photonic redesign. It is a 🟢 queue item (wraps existing gates, changes no enforcement), pending owner go.

## See also
`logicn-developer-tooling-advanced.md` (the `LLN-GEN-TEST` paper spec) · `logicn-governance-mode-ladder.md` (CFG fingerprint, 0011(d)) · `logicn-roadmap-autonomous-queue-2026-06-17.md` · `logicn-fhe-encrypted-similarity-verdict` (the adjudicated "search on sealed data" question).

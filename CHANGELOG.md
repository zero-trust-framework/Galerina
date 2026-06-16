# Changelog

All notable changes to LogicN are documented here (format: [Keep a Changelog](https://keepachangelog.com); the project is pre-1.0).

## [Unreleased]

### Security — Phase 1 Audit (2026-06-16): 8/8 criticals + highs cleared
Adversarial Gate-6 audit (37 raised · 32 confirmed). **All Critical and High findings are patched and
verified**; the codebase is in a fail-closed, deterministic state. 48/48 packages · 4,481 tests · 0 fail.

- **VSC-001 (critical)** — closed a taint-escape: `isGovernedSink` is now a strict superset of the
  authoritative `SINK_REQUIREMENTS`, so unsafe/tainted values no longer reach `response.body` /
  `ai.remoteInference` / `network.outbound` / `log.write` / bare `database.write` unchecked.
- **VSC-002 (high)** — `trap` is no longer a taint declassifier; declassification requires an explicit
  `validate.*` / `sanitize.*` / `redact()` gate.
- **VSC-003 (high)** — member-expression receivers (`client.http.post`, `ctx.secrets.get`, …) no longer
  bypass the secret/egress recognizers.
- **GOV-001 (high)** — ratified `permitted_effects` K3 semantics (omitted = neutral · empty `{}` = deny-all
  · populated = allow-listed) and strict `conforms_to` resolution (fatal in production/deterministic).
- **GOV-003 (high)** — denied response fields can no longer leak via member/positional returns.
- **CRYPTO-001 (high)** — certified mode mandates the ML-DSA public key (no silent post-quantum downgrade).
- **CRYPTO-002 (medium)** — the Tier-3 ffsim admission gate requires hybrid attestation by default.
- **CRYPTO-003 (high)** — the governance signature now binds the tamper-evidence fields (`hardwareSeal`,
  `epilogueReceipt`, `liabilityProfile`, `physicalHardeningTier`).

### Added
- `crypto-ops` benchmark now measures ML-DSA-65 + hybrid Ed25519+ML-DSA-65 signatures (PQ-tax visibility).
- KB §7a — ratified domain-guard `permitted_effects` state machine.
- Roadmap #125–#128 (CLI governed-run, parser-level bitwise hint, shape-stable governance objects, GAP-4).

### Deferred to Phase 2
Semantic mediums (VSC-004/005, GOV-002/004), CRYPTO-004 (versioning), engine integration, and the safe
maintenance subset (REDUN-001, STYLE/INFO). See `docs/Knowledge-Bases/logicn-build-roadmap.md`.

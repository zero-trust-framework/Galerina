# Security Policy

## Posture
LogicN is governance-first and zero-trust by construction: deny-by-default effects, fail-closed
(`unknown → deny`), **crypto-on-core** (bit-exact cryptography on a deterministic digital core), and
post-quantum-ready signatures (**hybrid Ed25519 + ML-DSA-65**, NIST FIPS 204).

## Audit status
**Phase 1 audit — COMPLETE (2026-06-16).** All **Critical and High** vulnerabilities from the adversarial
sweep are patched and verified; the codebase is in a fail-closed, deterministic state (48/48 packages,
4,481 tests, 0 failures). The audit ledger lives in
[`docs/Knowledge-Bases/logicn-build-roadmap.md`](docs/Knowledge-Bases/logicn-build-roadmap.md)
(see "Phase 1 Security Audit — COMPLETE"). **Phase 2** (semantic mediums + engine integration) is staged
for the next R&D block.

## Reporting a vulnerability
Please report security issues **privately** to the maintainer — `<SET SECURITY CONTACT BEFORE PUBLISHING>` —
and do **not** open a public issue for an unpatched vulnerability. You can expect an acknowledgement and a
remediation timeline.

## Supported versions
Pre-1.0; security fixes land on `main`.

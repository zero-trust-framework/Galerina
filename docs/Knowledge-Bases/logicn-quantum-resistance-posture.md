# LogicN Quantum-Resistance Posture (Zero-Trust)

**Status:** governance posture + decision record. **Date:** 2026-06-15.
**Principle (the rule):** *Make LogicN quantum-resistant **where it can reasonably be done** — where the
threat is real and the cost is amortized (cold paths) — **without hammering hot-path performance** for
marginal benefit.*

---

## Threat model — what a cryptographically-relevant quantum computer (CRQC) actually breaks
- **Shor's algorithm → asymmetric / public-key** (RSA, ECDSA, **Ed25519**): *polynomial-time* break —
  the private key is recoverable from the public key. **This is the real quantum threat.**
- **Grover's algorithm → symmetric + hashes** (AES, **SHA-256**): only a *quadratic* speedup. SHA-256's
  ~2²⁵⁶ preimage work drops to ~2¹²⁸ — still infeasible. NIST treats SHA-256 as quantum-acceptable.

## The rules / decisions

### R1 — Integrity hash: **KEEP SHA-256.** *(DECISION: do NOT change or replace it.)*
SHA-256 (FIPS 180-4) is **already quantum-resistant** — Grover leaves 128-bit security, which is
acceptable. Replacing it buys **zero** quantum benefit while costing reproducible-build determinism,
interop, and FIPS posture. "Replace SHA-256 with a signature/lattice scheme" (the rejected TMX proposal,
`notes/31–34`) is a **category error** — a hash and a signature do different jobs, and the quantum risk is
on the *signature*, not the *hash*. If a higher hash margin is ever required, escalate to **SHA-384/512** —
**never** to a signature scheme. **Reasonable-cost: no change = no cost.** ✅

### R2 — Signatures: **migrate to post-quantum (ML-DSA-65).** *(The genuine PQ work — #34.)*
**Ed25519** (the live signature today) is **Shor-breakable** → a CRQC could forge manifest signatures and
fake supply-chain provenance ("harvest-now, **forge**-later" for long-lived artifacts). The remedy is
**ML-DSA-65 (FIPS 204) signing over the same SHA-256 digest**, **hybrid Ed25519 + ML-DSA-65** during
transition (defense-in-depth: secure if *either* scheme holds). Cost is **once-per-build** (a cold path) →
reasonable. Conservative backup: **SLH-DSA (FIPS 205, hash-based)** — Stage-2 option noted in `attestation.ts`. ✅

**Status (corrected 2026-06-16 — was overstated as "to finish"):** the hybrid algorithm is **SHIPPED for
the ProofGraph governance signature** (Phase 55: `generateHybridGovernanceKeyPair`, `signProofGraphHybrid`,
`verifyGovernanceSignatureHybrid` in `proof-graph.ts`, via `@noble/post-quantum` `ml_dsa65` — a real
dependency, not "planned"). Signature tiers: `lln.gov.sig.v1` (Ed25519, compat) → `v2` (hybrid, both
required) → `v3` (pq_strict, future). It was **untested until 2026-06-16** (`tests/hybrid-pq-signature.test.mjs`,
proves round-trip + fail-closed + both-required). **Remaining #34 scope:** (a) the audit `attestation.ts` and
bridge `bridge-attestation.ts` surfaces are **still Ed25519-only** (not yet hybrid); (b) **production key
custody** (long-lived signing key storage/rotation — relates to `#149`) is the genuine open gate, not the
algorithm. **Hardening note:** the *sync* `verifyGovernanceSignature` accepts a `v2` signature but checks
**only the Ed25519 half** — a careless caller silently loses PQ assurance; candidate for `LLN-CRYPTO-PQ-001`
(force the async hybrid verifier, or reject `v2` in the sync path).

### R3 — Key exchange / encryption: **ML-KEM only if/when confidentiality is added.**
LogicN does **not** encrypt artifacts today (manifests are *signed*, not encrypted), so there is **no
"harvest-now-decrypt-later" exposure now.** If confidential data-at-rest/in-transit is ever added, use
**ML-KEM (FIPS 203)**. Not currently needed. ⏸

### R4 — "Reasonable cost" guardrail (the performance limit).
PQ measures live on **cold paths** (build-time signing, attestation, admission) where the cost amortizes.
**Do NOT PQ-harden per-request hot paths** for marginal benefit. (Corollary, from the GateCache analysis:
a *cache key* is **not** security crypto and must stay cheap — not even SHA-256 there, let alone ML-DSA.)

### R5 — Crypto-on-core complement *(already enforced — `LLN-SUBSTRATE-001`).*
Integrity / `Hash` / `Sign` effects must run on a **deterministic, bit-exact** lane. A PQ signature is
worthless if computed on a non-bit-exact substrate, so the PQ posture (R1–R2) and the substrate posture
reinforce each other.

## Candidate future enforcement (recorded, not built)
A compile-time check — **`LLN-CRYPTO-PQ-001`**: a `Sign` effect must declare a PQ-or-hybrid algorithm from
an approved allowlist — would make this posture machine-checked (deny-by-default for non-PQ signing in
certified mode). Recorded as a candidate; not yet implemented.

## Net decision
**KEEP SHA-256 (R1).** Spend the quantum-resistance budget on the **signature** (R2 — finish ML-DSA-65,
#34), on **cold paths only** (R4). That is the **maximum quantum resistance reasonably achievable without
a performance regression** — which is exactly the zero-trust posture asked for.

**Cross-refs:** `notes/31–34` (TMX boundary: hash ≠ signature) · `logicn-task-ledger.md` #34/#107–109 ·
`logicn-substrate-contracts.md` (LLN-SUBSTRATE-001) · `manifest-generator.ts` / `attestation.ts`.

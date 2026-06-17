# Design: Key Custody & Rotation — what belongs in core vs ext

> **Status:** design (2026-06-17), grounded against the working tree (verify-before-build). Answers the owner's question: *"should key rotation be brought into the core packages?"* **Verdict: a split — govern in core, execute in ext — plus two concrete core gaps to close.** Decided by LogicN's own invariants: **crypto-on-core** (bit-exact verify on the deterministic core) and **govern-don't-absorb** (core governs mechanisms, ext implements them — the same call that put TMX-256 in `logicn-ext-tmf` and Vault in `logicn-ext-secrets-vault`, not core).

## 1. The split (confirmed)

| Concern | Lives in | Why | Status |
|---|---|---|---|
| Rotation **policy / governance** — the `secrets { rotation { interval · strategy · on_rotation_fault } }` declaration, fail-closed outcome, audit of rotation events | **core** (grammar + governance-verifier + manifest) | It's a *declaration + proof obligation* — core's job; no network/vendor state | grammar parses (`parser.ts:4109/4114`); **body not yet retained → Gap A** |
| Rotation **mechanism** — the Vault/KMS/HSM handshake, dual-token swap, quiesce, zero-wipe, timer sweeps | **ext** (`logicn-ext-secrets-vault`) | Network protocols + vendor APIs + runtime state would bloat the zero-trust brain and break the toxic border | **built + fail-closed (2026-06-17)** — `SecretsRotationManager`/`VaultClient`; rotation faults now apply `onRotationFault` (default **`halt`** = evict+zero-wipe; `quarantine`; `log`=opt-in lenient) so a stale key is never served on a failed rotation (16 tests). Was previously fail-OPEN (logged + kept serving). |
| Secret **taint inference + egress guards** (`LLN-SECRET-002`) | **core** | Compile-time data-flow proof | shipped (`value-state-checker.ts`) |
| Signature **keygen / verify** (Ed25519; hybrid Ed25519+ML-DSA-65 construction) | **core** | crypto-on-core, bit-exact | shipped; full ML-DSA (#34) correctly gated on DRCM Phase 5 |
| **Key custody — revocation enforcement** (evaluate a revoked key id as Deny) | **core** (governance gate) | A trust decision the border/verifier must make deterministically | **MISSING as an enforced primitive → Gap B** |
| Signing-key **rotation execution** (generate/store/distribute the project identity) | **ops + ext** | Offline key handling; not core | manual + `.env.logicn-signing` |

**Bringing the rotation *engine* into core would be wrong** — it drags HashiCorp Vault HTTP, KMS sealing, and timer sweeps across the core/ext boundary, breaking the deny-by-default "core stays minimal + host-agnostic" invariant. The engine stays in ext; core only *declares and verifies*.

## 2. Gap A — `#110`: the rotation policy is parsed but dropped

`parser.ts:4114` parses `secrets { credential <name> { provider … } rotation { … } }`, but only the credential **name** survives into the manifest — the **body (provider / path / rotation policy) is discarded**. So a declared `rotation { interval 1h … on_rotation_fault halt }` never becomes a verifiable proof obligation: nothing checks that a conforming ext rotation driver is actually bound.

**Fix (core only, minimal):**
1. Retain the full credential body + `rotation{}` policy in the `contractDecl` AST (stop dropping it at `parser.ts:4114`).
2. Emit it as a **manifest proof obligation** (`manifest-generator.ts`, mirroring the existing secret-sink-constraint path at `~:515`) so `logicn verify` **fails closed** when a declared rotation policy has no conforming bound ext driver.
3. The runtime engine stays in `logicn-ext-secrets-vault` — core checks *against* it, does not reimplement it.

## 3. Gap B — the Key Custody / revocation registry (the owner's catch)

`security/revocations/REV-2026-06.md` is a **human compliance artifact**. To a K3 gate verifying a payload at runtime, a Markdown file does not exist — so the compromised key `8eecf4187ebc9341`, which can still produce a *mathematically valid* Ed25519/ML-DSA-65 signature, would be **blindly accepted**. The revocation must become an **enforced core primitive**.

### 3.1 The mandate (preemptive deterministic block)

Let `K_revoked` be the set of revoked key fingerprints. For a payload signed by key `k`, the gate evaluates **before** spending any cycles verifying the signature:

```
            ⎧ -1 (Deny)            if k ∈ K_revoked
   v(k) =   ⎨
            ⎩ evaluate signature    if k ∉ K_revoked
```

Revocation is a K3 short-circuit to `Deny`, evaluated ahead of signature verification (cheaper *and* safer — a revoked key never reaches the verifier). Revoked **public** keys are retained (you verify-then-distrust historical signatures, you don't forget them).

### 3.2 The registry as a governed artifact

The registry itself is high-value and must be governed like one:

- **Machine-readable & canonical** — a strict CBOR/JSON state file (working name `revocations.lmanifest`), not prose. The Markdown advisory (`REV-2026-06.md`) becomes the human mirror of an entry, not the source of truth.
- **Append-only / immutable** — a key id, once revoked, never leaves the set. Each entry: `{ keyId, algorithm, revokedAt, reason, supersededBy }`.
- **Self-signing** — the registry is signed by the **current active** key (`ab46f4c7e2797b9b` / the hybrid identity). The border gateway **verifies the registry's own signature before trusting its contents** (chicken-and-egg solved by a root/trust-anchor key pinned in the admission policy, never the revoked key).
- **Consulted by the gate** — `logicn.mjs` `verify` / `border-check` and `bridge-attestation` evaluate `v(k)` against the registry before any signature check. (Today `logicn.mjs` does keygen + verify but consults no revocation set — that is the wiring to add.)

### 3.3 Bootstrap entry

`8eecf4187ebc9341` (Ed25519, revoked 2026-06-17, reason: committed to git history at `cb5036d`, superseded by `ab46f4c7e2797b9b`) is the first registry entry. The three public keys already on disk under `governance/` (`8eecf4…`, `ab46f4c7…`, and the older `f89c9478a0c3c8ae`) are the inventory to reconcile into custody state.

## 4. Verify-before-build — do NOT rebuild

- `SecretsRotationManager` + `VaultClient` (`logicn-ext-secrets-vault`) — dual-token rotation, quiesce, atomic swap, zero-wipe, sweep, dispose: **built + tested**. Wire to it.
- Secret-taint inference + `LLN-SECRET-002` egress guards (`value-state-checker.ts`) — shipped.
- Ed25519 keygen + manifest sign/verify (`logicn.mjs`, `manifest-generator.ts`) — shipped, fail-closed.
- Hybrid Ed25519+ML-DSA-65 construction — spec FROZEN (`logicn-ext-tmf/spec/signature-custody-v0.md`); full ML-DSA (#34) gated on DRCM Phase 5 — do not start ad hoc.
- Bridge attestation CF-3/CF-7 (`bridge-attestation.ts`) — shipped.

## 5. Build plan (both core, owner-gated)

1. **Gap A (#110)** — AST body-retention + manifest proof-obligation emit; bind-check against the ext driver. Small, in-core, reuses the ext engine. *(Open.)*
2. **Gap B (Key Custody registry) — v0 + tamper-evidence + v2 pinning SHIPPED 2026-06-17.** `governance/revocations.json` (canonical, append-only; bootstrap `8eecf4187ebc9341`, owner-signed) + `governance/revocation-registry.mjs` (`isKeyRevoked`, `assertRegistryTrustworthy`) + a fail-closed `v(k)` pre-check in `logicn.mjs verify` (`LLN-MANIFEST-REVOKED-KEY`) + the zero-touch `key-lifecycle.mjs` (`LLN-KEY-*`). **v1 tamper-evidence:** Ed25519 self-signature; edit-without-re-sign fails closed. **v2 trust-anchor pinning:** `governance/trust-anchor.json` pins the authorizing root (`ab46f4c7e2797b9b`) — a registry signed by any other (e.g. rogue fresh) key is rejected. 12 tests. **Remaining:** wire `isKeyRevoked` into `border-check` + `bridge-attestation`; promote the primitive into `logicn-core-security` for suite coverage.
   - **v3 = engine Slice-5 (`logicn-ext-tmf`):** the full byte-precise binary trust-registry per the R&D spec `revocation-registry-v0.md` (freshness `next_update`, anti-rollback `sequence`, hybrid Ed25519+ML-DSA-65 AND-verified, dedicated root distinct from operational key, `require_fresh_registry` unknown→deny). Conformance contract = R&D `bench/revocation.mjs` (28/28, golden vector). Absorbed: `rd-absorbed/rd-revocation-registry-v0.md`. Owner-gated engine build.

Both are *governance/verification* additions to core — consistent with crypto-on-core — and neither pulls mechanism into core. Cross-refs: [[logicn-design-secrets-epilogue-blocks]], [[logicn-zero-trust-engine]], `security/revocations/REV-2026-06.md`, [[logicn-quantum-resistance-posture]].

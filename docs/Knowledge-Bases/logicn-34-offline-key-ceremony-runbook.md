# #34 — Offline key ceremony runbook (unblocking PQ `.lmanifest` signing)

**Status:** runbook 2026-06-23. Ties the EXISTING research (the owner noted it "may help") into the concrete
procedure that unblocks #34. **The signing CODE is already shipped + tested** — the only gate was the offline
key *custody/ceremony*, which the research below now operationalizes.

## What already exists (so #34 is NOT a code task)
- **Hybrid signing:** `generateHybridGovernanceKeyPair` · `signProofGraphHybrid` · `verifyGovernanceSignatureHybrid`
  in `proof-graph.ts`, via `@noble/post-quantum` `ml_dsa65` (a real dependency). Tiers `lln.gov.sig.v1` (Ed25519)
  → `v2` (hybrid Ed25519+ML-DSA-65, both required) → `v3` (pq_strict). Tested: `tests/hybrid-pq-signature.test.mjs`.
- **Secure generation:** [logicn-qrng-entropy-capability-design.md](logicn-qrng-entropy-capability-design.md) —
  the SP 800-90A/B/C conditioning pipeline that supplies *unpredictable* entropy to the key schedule. (Rule:
  **never raw quantum bits → key**; raw output is biased and MUST pass the full SP 800-90 pipeline first. A
  conditioned OS CSPRNG is the acceptable fallback when no QRNG source is present.)
- **Custody / rotation:** [logicn-key-custody-and-rotation.md](logicn-key-custody-and-rotation.md) — the SPLIT
  model: core *declares + verifies* (`secrets { rotation { interval · strategy · on_rotation_fault } }`), ext
  `logicn-ext-secrets-vault` *executes* (`SecretsRotationManager`/`VaultClient`, fail-closed `onRotationFault`
  default `halt` = evict+zero-wipe). Revocation enforced (`revocation-registry.mjs` → revoked key id ⇒ Deny).

## The ceremony — what the owner runs OFFLINE (the residual gate, by design)
"Offline custody" means these steps happen on an **air-gapped** machine; they are inherently owner/ops, not
automatable from the live repo. The runbook makes them concrete:

1. **Condition entropy.** On the air-gapped host, gather entropy through the SP 800-90 pipeline (QRNG source if
   available, else a conditioned OS CSPRNG). This is the seed source for step 2.
2. **Generate the hybrid keypair** with `generateHybridGovernanceKeyPair` (seeded from step 1) — yields an
   Ed25519 keypair + an ML-DSA-65 keypair. **The private halves never leave the air-gapped host** except into
   offline custody (HSM, or an encrypted offline `.env.logicn-signing`).
3. **Publish the PUBLIC keys** to the repo's `governance/` (`signing-key-<keyId>.pub.pem` + the ML-DSA public
   key), keyed by a fresh `keyId`. Public keys are not secret — they're how verifiers check the signature.
4. **Sign production artifacts** with the offline private key via `signProofGraphHybrid`, emitting a `v2`
   (hybrid) `governanceSignature` on the `.lmanifest`. Re-sign any artifact currently signed ONLY by the old
   Ed25519 key (this is the **#149 re-sign half** — the same ceremony covers it).
5. **Record rotation + revocation lifecycle.** Declare `secrets { rotation { interval … on_rotation_fault halt } }`
   on the signing flow (core verifies the obligation); the ext vault driver executes the swap; add the *previous*
   keyId to `governance/revocations.json` so it evaluates to Deny going forward.

## What is hub-actionable vs owner-only
| Step | Owner (offline) | Hub (automatable) |
|---|:--:|:--:|
| Entropy conditioning + keypair generation (1–2) | ✅ air-gapped | — |
| Publish public keys + keyId (3) | ✅ | hub can scaffold the `governance/` file layout |
| Sign / re-sign artifacts (4) | ✅ holds the key | hub provides the `signProofGraphHybrid` invocation + a `logicn sign` CLI wrapper |
| Rotation policy declaration + revocation entry (5) | decision | ✅ hub can wire `secrets{rotation{}}` retention (**Gap A / #110**) + the revocation entry |

## Verdict
**#34 is unblockable now** — the signing code, the secure-generation pipeline, and the custody/rotation lifecycle
all exist. The only thing that was ever "gated" is the owner running the air-gapped key ceremony (steps 1–4),
which is owner-controlled *by design* (that's what "offline custody" means). The two hub-side follow-ups that
make the ceremony smoother: a **`logicn sign` CLI** wrapping `signProofGraphHybrid`, and closing **#110 / Gap A**
(retain the `rotation{}` body into the manifest as a proof obligation). One nuance from the custody doc: it lists
"full ML-DSA (#34)" as *gated on DRCM Phase 5* — that ties the **in-sandbox secure-signing-in-WASM** story to
#102-106, but the **offline-sign-then-verify** path above does **not** need Phase 5 and works today.

> Related: [logicn-quantum-resistance-posture.md](logicn-quantum-resistance-posture.md) (R2 = the genuine PQ
> work is the signature, not the SHA-256 hash) · [logicn-key-lifecycle-diagnostics.md](logicn-key-lifecycle-diagnostics.md).

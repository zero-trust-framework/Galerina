# `.gate` — the total, capability-typed, SIGNED IR

`.gate` is the canonical **total + capability-typed + SIGNED** intermediate
representation for Galerina. It **subsumes GIR** (`.gir` / `fungi.gir.v1`): every
field GIR carries is present here, plus three things GIR does not guarantee —
**totality** (proof obligations + exhaustiveness + deny-by-default), **capability
typing** (every effect resolved to a host capability *and* a V_DPM bit), and a
**signature block** that makes the artifact admissible.

## Where `.gate` sits in the pipeline

```
.graph  →  .fungi  →  .gate  →  WASM
 (source    (governed  (total +   (DSS.wasm executes
  graph)     source)    cap-typed  from the SIGNED
                        + SIGNED)  capability set, not
                                   the graph topology)
```

`.gate` is the last governed artifact before lowering. A `.gate` file is the
**signed contract the runtime executes against**: DSS.wasm configures its V_DPM
register from the capability set in the `.gate`, not from anything it re-derives
by walking the graph.

## The two hard rules (RD-0231, proof-enforced)

These are not style preferences. They are enforced, and every example here honors
them:

1. **Sign the graph or it poisons.** Every `.gate` carries a `signature` block.
   An **unsigned `.gate` is inadmissible** — the runtime refuses to load it. There
   is no "unsigned but trusted" path.

2. **Topology is NEVER the authority.** Admission is decided by the **SIGNED
   capability**, not the graph shape. A `.gate` whose topology looks perfectly
   clean but whose signature is missing or invalid **DENIES at runtime**. You
   cannot launder a capability in through graph structure; the only thing that
   grants an effect is a valid signature over a capability set that contains it.

A corollary that falls straight out of rule 2: the `capabilities` and `totality`
blocks are the authority surface. The `gir` block is descriptive (what the flow
*is*); the signed `capabilities` + `policyResolutionDag` are prescriptive (what
the flow is *allowed to do*).

## Signatures here are ILLUSTRATIVE

**Every hash and signature in these files is a hand-authored placeholder.** These
are reference examples for building the `.gate` compiler later, not compiler
output. Real signing uses the shape the compiler already emits for manifests and
attestations:

- Real manifests emit placeholder Ed25519 + ML-DSA-65 signatures
  (`placeholder:sha256:<bodyHash>`) unless real keys are configured
  (`galerina keygen`); ML-DSA-65 is gated on key custody (DRCM task #34). See
  `packages-galerina/galerina-core-compiler/src/manifest-generator.ts`.
- The audit attestation encodes the hybrid signature as
  `"<ed25519-b64>|<ml-dsa-65-b64>"` with algorithm `Ed25519+ML-DSA-65`, and
  verification requires BOTH (logical AND). See
  `packages-galerina/galerina-core-compiler/src/attestation.ts`.

In these examples we use `"value": "placeholder:<ed25519>|<ml-dsa-65>"` to mirror
that hybrid layout without pretending to be a real signature. A future `.gate`
compiler would replace the placeholder with a real signature over the canonical
body (RFC 8785 JCS — see `manifestSigningInput` in the manifest generator).

## File format (`fungi.gate.v1`)

Each `.gate` file is pretty-printed JSON:

```jsonc
{
  "schemaVersion": "fungi.gate.v1",
  "sourceFile": "<relative path to the .fungi>",
  "sourceHash": "sha256:<illustrative>",

  // GIR — subsumes fungi.gir.v1 (one flow object per flow in the source).
  "gir": {
    "name": "<flow name>",
    "qualifier": "pure" | "guarded" | "secure" | "flow",
    "effects": { "declared": [...], "observed": [...], "status": "compliant" },
    "intent":  { "declared": "<intent string>", "status": "satisfied" | null },
    "protected_values": [ { "name": "...", "type": "..." } ],
    "audit":   { "protected_values_redacted": true | false },
    "execution": { "preferred": [...], "denied": [...], "fallback": "cpu" | null },
    "proofs":  [ { "name": "...", "status": "satisfied" | "missing" | "failed" } ],
    "tensors": [ { ... GIRTensorInfo ... } ],           // omitted when empty
    "target_affinity": { "suggested": [...], "reason": "..." },  // when inferable
    "capabilities": { "<effect>": "host.<...>" },        // GIR effect→cap map
    "contract": { "hasIntent": ..., "hasPrivacy": ..., "hasAuditRequirements": ...,
                  "hasSensitivityQualifiers": ..., "effectCount": N },
    "allowedEffectsMask": <int>                          // EffectFlags bitset (O(1) subset check)
  },

  // TOTAL + CAPABILITY-TYPED extension (what makes this .gate, not .gir):

  // Capability typing — every declared effect resolved to BOTH a host capability
  // and its V_DPM bit position. vdpmBit = -1 means "recognised but read-only / no
  // V_DPM bit" (e.g. database.read) OR "extended domain effect not yet bit-wired".
  "capabilities": {
    "<effect>": { "host": "host.<...>", "vdpmBit": <int or -1> }
  },

  // Totality — the proof burden that makes the flow total (no un-handled path).
  "totality": {
    "proofObligations": [ { "kind": "...", "flowName": "...",
                            "verified": "static" | "runtime-precheck" | "pending",
                            "description": "..." } ],
    "exhaustiveness": "<note on match-arm coverage / deny-by-default>",
    "denyByDefault": true
  },

  // Pre-resolved policy DAG — V_DPM masks (NOT EffectFlags). allowedEffects is the
  // OR of the V_DPM bit masks of the declared effects; read-only effects contribute 0.
  "policyResolutionDag": { "allowedEffects": <mask>, "deniedEffects": <mask> },

  // Signature — ILLUSTRATIVE. Its presence is what makes the artifact admissible.
  "signature": {
    "algorithm": "Ed25519+ML-DSA-65",
    "keyId": "illustrative",
    "bodyHash": "sha256:<illustrative>",
    "value": "placeholder:<ed25519>|<ml-dsa-65>"
  }
}
```

### How the numbers are derived (so the compiler can reproduce them)

All numeric masks below are grounded in the real compiler constants — not invented:

- **`gir.allowedEffectsMask`** — `EffectFlags` bitset from
  `type-registry.ts` via `effectsToFlags`:
  `database.read=1, database.write=2, network.outbound=4, audit.write=8,
  ai.inference=16, network.inbound=32, …`. Unknown effects are **skipped**
  (contribute 0) but remain visible by name in `effects.declared` — this mirrors
  the real fast-path subset check, where an unmapped effect is name-tracked, not
  silently granted.

- **`capabilities.<effect>.vdpmBit`** — `CAPABILITY_BIT_POSITION` from
  `capability-types.ts` (the V_DPM register layout in DSS.wasm):
  `network.outbound=0, storage.write=1, secret.access=2, audit.write=3,
  database.write=4, ai.inference=5, shell.execute=6, native.call=7`.
  `database.read = -1` (read-only, no bit). Extended domain effects that are not
  yet bit-wired also use `-1`.

- **`capabilities.<effect>.host`** — `EFFECT_TO_CAPABILITY` from
  `gir-emitter.ts` (e.g. `audit.write → host.audit.write`). Effects with no entry
  fall back to the emitter default `host.<effect>`.

- **`policyResolutionDag.allowedEffects`** — the V_DPM mask, computed exactly as
  `manifest-generator.ts` does it: OR of `resolveCompositeBitmask(effect)` over
  all declared effects. This is a **different bitset** from
  `gir.allowedEffectsMask` (EffectFlags) — the two are intentionally distinct and
  should not be conflated.

### Extended (domain) effects that don't bit-map cleanly

Some valid `.fungi` sources declare effects that are **not** in the canonical
V_DPM / EffectFlags tables today: `payment.charge` (453), `pii.write` and
`phi.read` (465). These are faithfully preserved in `effects.declared` and given a
default `host.<effect>` capability with `vdpmBit: -1`. They are called out per
file and in the summary as constructs the `.gate` format may want to formalise
(either promote to real V_DPM bits or define a distinct "domain capability" lane).

## The examples

Each `.gate` here is lowered from a real, **valid (zero-diagnostic)** `.fungi`
example and accurately reflects *its own* source — effects, intent, protected
values, redaction, tensors, and compute governance:

| file | source `.fungi` | what it demonstrates |
|------|-----------------|----------------------|
| `001-pure-flow.gate`               | `Level-1-Basics/001-pure-flow`               | pure flow, **no effects** — minimal `.gate` |
| `104-multiple-effects.gate`        | `Level-3-Effects/104-multiple-effects`       | three effects; a protected value that is **not** redacted (`missing` proof) |
| `173-validation-chain.gate`        | `Level-4-Security/173-validation-chain`      | canonical raw → validate → protected → redact → audit chain |
| `224-contract-best-practices.gate` | `Level-5-Governance/224-contract-best-practices` | gold-standard full contract (privacy, audit, context, observability) |
| `208-audit-proof-required.gate`    | `Level-5-Governance/208-audit-proof-required` | destructive delete with mandatory audit evidence |
| `365-ai-summary-flow.gate`         | `Level-7-AI/365-ai-summary-flow`             | `ai.inference` + tensor + compute governance (`deny remote.execution`) |
| `453-financial-payment-charge.gate`| `Level-9-Enterprise/453-financial-payment-charge` | `Money<GBP>` payment; **extended effect** `payment.charge` |
| `465-enterprise-summary.gate`      | `Level-9-Enterprise/465-enterprise-summary`  | every layer: PII/PHI, AI, compute, policy, audit; partial redaction ⇒ `missing` proof |

## Grounding references (real compiler shapes)

- `packages-galerina/galerina-core-compiler/src/gir-emitter.ts` — `GIRFlow`,
  `EFFECT_TO_CAPABILITY`, tensor/affinity/proof derivation.
- `packages-galerina/galerina-core-compiler/src/capability-types.ts` —
  `CAPABILITY_BIT_POSITION`, `resolveCompositeBitmask` (V_DPM layout).
- `packages-galerina/galerina-core-compiler/src/type-registry.ts` — `EffectFlags`
  / `effectsToFlags` (the `allowedEffectsMask` bitset).
- `packages-galerina/galerina-core-compiler/src/manifest-generator.ts` —
  `LManifest`, `PolicyResolutionDag`, `proofObligations`, placeholder signature.
- `packages-galerina/galerina-core-compiler/src/attestation.ts` — hybrid
  `Ed25519+ML-DSA-65` signature layout.

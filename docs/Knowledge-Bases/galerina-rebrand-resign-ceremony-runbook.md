# Galerina rebrand — crypto wire-tag re-sign ceremony (operator runbook)

> **Status:** OPERATOR-GATED · written 2026-06-26 after the Galerina source rebrand landed (suite 60/60).
> The source rename is done; this runbook migrates the **preserved crypto wire-tags** and **re-signs the
> root-signed artifacts** — the half the codemod deliberately could not touch, because it needs the
> **offline trust-anchor root key**. Run it in a focused session, on a green tree, with the root key loaded.

> **UPDATE 2026-06-26 (verify session — CODE HALF APPLIED).** The wire-format migration is now DONE in source and
> green. The 4 governance **contexts** are `galerina.*.v2` (deliberate v-bump — owner's choice, supersedes the
> "keep v1" note below; old `logicn.*.v1`/`galerin.*.v1` artifacts fail closed rather than silently mis-verify),
> and the `lln.*` format tags the rebrand had MISSED in `galerina-devtools-project-graph`
> (`graph`/`execution.proof`/`runtime.audit`) are now `spore.*`, matching the compiler. Full suite + the integrity
> scanner (`scripts/verify-artifacts.mjs` section 4) are green. **What REMAINS operator-gated:** re-signing the
> root-signed artifacts under the offline root `ab46f4c7` only if you want galerina-branded content inside their
> *signed payloads* — `governance/revocations.json` is currently RESTORED to its valid pre-rebrand bytes (not
> re-signed). The `LLN-` **diagnostic codes** in project-graph (e.g. `LLN-REPORT-001`) were the last on the old namespace — now MIGRATED to `SPORE-*` (project-graph was the ONLY package still on `LLN-`; `SPORE-` is universal, no central registry hardcodes them).

## Why this is separate
The rebrand codemod preserved every signed/hashed wire-format string verbatim, because renaming bytes
inside a signed payload invalidates the signature and the codemod cannot re-sign. Two key facts:
- **Root key `ab46f4c7e2797b9b`** signs the trust-anchored artifacts (revocations.json + the app/greeting
  manifests). It is **offline by design** (`governance/trust-anchor.json` pins it; see the offline
  key-ceremony runbook). It is NOT `.env.galerina-signing` (that holds the *operational* key `9c2d7d4502a2eedd`).
- The current tree is **internally consistent and GREEN** at the OLD tags (verifiers, emitters, and the
  3 artifacts all use `galerin.*`/`spore.*`). This ceremony moves them to the new brand atomically + re-signs.

## Tag migration map (owner scheme: `galerin`→`galerina`, `spore`→`spore`)
| Old (preserved) | New | Where |
|---|---|---|
| `galerin.proofgraph.governance.v1` | `galerina.proofgraph.governance.v2` ✅ APPLIED | ProofGraph context |
| `galerin.bridge.manifest.v1` | `galerina.bridge.manifest.v2` ✅ APPLIED | bridge attestation |
| `galerin.audit.attestation.v1` | `galerina.audit.attestation.v2` ✅ APPLIED | audit attestation |
| `galerin.config.environment.v1` | `galerina.config.environment.v2` ✅ APPLIED | env config (serialized schemaVersion) |
| `spore.gov.sig.v1` / `.v2` | `spore.gov.sig.v1` / `.v2` | governance signature algorithm (v2 = hybrid Ed25519+ML-DSA) |
| `spore.runtime.audit.v1` | `spore.runtime.audit.v1` | audit-event schemaVersion |
| `spore.runtime.manifest.v1` | `spore.runtime.manifest.v1` | runtime manifest schema |
| `spore.gir.v1` | `spore.gir.v1` | GIR schema |
| `spore.govdiff.v1` | `spore.govdiff.v1` | gov-diff schema |
| `spore.app.v1` | `spore.app.v1` | App.manifest schemaVersion |

**Version-bump decision — SUPERSEDED 2026-06-26 (owner chose the v2 HARD boundary for the 4 contexts; applied in source — see UPDATE at top):** _(original draft below)_ RECOMMEND keeping the `.v1`/`.v2`
suffix and only swapping the brand prefix (simplest; the suffix already versions the wire format). Only bump
(e.g. `…​.v2`/`.v3`) if you want a hard version boundary that legacy verifiers reject outright — that forfeits
the dual-accept grace window.

## Step 1 — DUAL-ACCEPT (code; do FIRST so old persisted artifacts keep verifying mid-migration)
Widen every verify GATE to accept old OR new, but DON'T change emitters yet. Files/lines (current):
- `packages-galerina/galerina-core-compiler/src/proof-graph.ts`
  - type union L548: add `| "spore.gov.sig.v1" | "spore.gov.sig.v2"`
  - gate L859 `if (alg !== "spore.gov.sig.v1")` → `if (alg !== "spore.gov.sig.v1" && alg !== "spore.gov.sig.v1")`
  - gate L882 `… !== "spore.gov.sig.v2"` → also allow `"spore.gov.sig.v2"`
- `packages-galerina/galerina-core-compiler/src/audit-writer.ts`
  - type L29 + gate L77 `!== "spore.runtime.audit.v1"` → also allow `"spore.runtime.audit.v1"`
- The 4 `galerin.*` contexts: wherever a verifier compares the context string, accept the `galerina.*` twin.
- **Add a NEW-tag fixture test** for each gate (sign a fixture with the new tag, assert it verifies) — this is
  what proves dual-accept actually works; the existing suite only exercises the old tags.
- Gate: full suite stays **60/60** (old path unbroken) AND the new-tag fixtures pass.

## Step 2 — CUTOVER emitters + the App.manifest schema (code)
Now flip the EMIT side to the new tags:
- proof-graph.ts emitters L797/L837 → `spore.gov.sig.v1`/`.v2`; audit-writer.ts L218 → `spore.runtime.audit.v1`.
- The 4 contexts at their emit sites → `galerina.*`.
- `App.manifest` schemaVersion `spore.app.v1` → `spore.app.v1`, and **remove the bridge hack** in
  `scripts/galerina-new.mjs` `substituteName` (the `.split("spore.app.v1")…`/`src/App.spore` lines) + revert
  `app-scaffold.test.mjs` to expect `spore.app.v1` from the migrated template directly.

## Step 3 — RE-SIGN the 3 root-signed artifacts (NEEDS the offline root key ab46f4c7)
Load the root key into the signing env (NEVER on the command line), then:
```
# 1. revocations.json — load ab46f4c7 as GALERINA_SIGNING_KEY_ID + GALERINA_SIGNING_PRIVATE_KEY_B64, then:
node governance/sign-revocations.mjs          # re-signs with the migrated content
# 2. App.manifest + packages/greeting/dist/greeting.lmanifest.json — regenerate+re-sign via the build/fuse
#    signer with the root key (the same path `galerina build`/the fuse step uses; greeting.wasm is unchanged).
# 3. If rotating the root, update governance/trust-anchor.json pin AFTER re-signing (deliberate ceremony).
```
The 3 artifacts are currently RESTORED to their original `galerin`/`spore` bytes (commit history: restored after
the codemod broke them). Re-signing replaces them with migrated content + a fresh valid signature.

## Step 4 — VERIFY + FINALIZE
- `node scripts/run-all-tests.cjs` → **60/60** (esp. cli-compatibility signing/build/deploy/verify, the
  example-app fuse test, audit-chain, proof-chain).
- `node scripts/lint-conventions.mjs` → enforcing audits + provenance green.
- Regen build/ catalogs+graph (`code-index`/`gen-code-registry`/`kb-index`/`graph-all`/`audit-coverage`).
- After a release with dual-accept, REMOVE the old-tag acceptance from the Step-1 gates (drop `spore.*`/`galerin.*`).
- Update `version.json` + any doc that still cites the old wire tags.

## Rollback
`git revert` the ceremony commits; the 3 artifacts can be restored from the pre-ceremony commit (the codemod
era restored them from `8a2a315`). The old tags + signatures verify as-is, so rollback is clean.

## See also
[[galerina-rd-0131-rebrand-galerina]] (the rebrand record + the operator-gated remainder) ·
`governance/trust-anchor.json` (the pinned root) · the offline key-ceremony runbook (root-key custody).

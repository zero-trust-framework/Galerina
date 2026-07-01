# Consistency Gates — dev tools + rules that block the "internal drift / silent fail-open" class

**Why this exists (2026-07-01):** a class of defects kept recurring where the compiler's own
*derived tables and boundaries* drifted apart or were silently softened, so a check that looked
enforced was not. Examples found and fixed this session: the effect vocabulary was defined in
≥4 tables that disagreed (`secret.read/write` were mask-invisible → a fast-path fail-open); a
plain `build` **signed** an artifact that `build --production` would refuse; security/governance
diagnostics were mode-gated or suppressed. None of these is a *user* bug — they are **meta**
defects (the toolchain lying to itself). Ordinary tests don't catch them because each table/mode
is internally consistent; only a *cross-table / cross-mode* invariant check does.

This file is the registry of the **rules** (invariants that must always hold) and the **gates**
(dev tools that fail CI if a rule is violated). Rule: **every rule here has an executable gate;
every gate here is wired into `scripts/run-phase-close.mjs`** so it runs on every phase close.

---

## Rules (invariants that must always hold)

| # | Rule | Rationale |
|---|---|---|
| **CG-1** | **One source of truth for the effect vocabulary.** `effect-checker.ts::CANONICAL_EFFECTS` is authoritative; every other effect table (`type-registry.ts::EFFECT_NAME_TO_FLAG`, `EFFECT_REGISTRY`, `SECURE_REQUIRED`/`PURE_FORBIDDEN`, and the docs) must agree — a name accepted by one part of the compiler but unknown to another is forbidden. | A drifted name is accepted in one pass and dropped in another → a silent authority gap (e.g. mask-invisible `secret.read`). |
| **CG-2** | **No canonical name is mask-invisible.** Every canonical effect used in a fast subset check must map to an `EffectFlags` bit (or be explicitly documented as bit-exempt). | `effectsToFlags(x)===0` for a real effect makes `(required & declared)===required` pass vacuously. |
| **CG-3** | **No security/governance diagnostic may be muted silently.** A security/governance code that is mode-gated (softer outside `build --production`) or in a `SUPPRESS` set must be on a **reviewed allowlist with a reason**. | "Muted early to stop it alerting" is how a real control gets left off. Muting must be a visible, auditable act. |
| **CG-4** | **A signed artifact must be production-strict.** The compiler must not emit a signed `.lmanifest` for an artifact that fails production-strict security/governance — even from a lenient `build`. | A signed manifest is an admission credential; signing a dev-lenient violating artifact is a fail-open at the boundary. |
| **CG-5** | **Local effect/capability sets use only real names.** Any hand-maintained `Set` of effect/capability names (inference passes, tier sets, capability maps) must contain only canonical effects, registered aliases, `EFFECT_REGISTRY` operations, or known capabilities — never a name that matches nothing. | A dead name (`gateway.charge` vs `payment.charge`) silently disables the classification for real flows. |
| **CG-6** | **Docs/specs teach only compilable vocabulary.** The KB registry and the `.graph` SPEC may name only canonical effects/families. | An AI (or human) authoring from the docs otherwise writes plausible-but-non-compiling governed code. |

---

## Gates (dev tools that enforce the rules) — all wired into `run-phase-close.mjs`

| Gate | Enforces | Command | Blocks on |
|---|---|---|---|
| `scripts/audit-effect-canonicality.mjs` | CG-1, CG-2, CG-6 | `node scripts/audit-effect-canonicality.mjs [--strict]` | internal table drift (C1–C4); docs drift under `--strict` (C5–C6) |
| `scripts/audit-muted-diagnostics.mjs` | CG-3 | `node scripts/audit-muted-diagnostics.mjs` | a security/governance code muted without a reviewed allowlist entry |
| compiler (`cli.ts`) production-strict signing gate | CG-4 | (in-compiler; regression-tested) | signing a plain-`build` artifact that fails production strictness |
| regression tests | all | `node --test scripts/tests/dev-tools-scripts.test.mjs` | a gate that stops detecting its own defect class |

**How to run them all:** `node scripts/run-phase-close.mjs` (runs every gate + the dev-tool tests),
plus `node scripts/run-all-tests.cjs` (full suite). Green = every rule holds.

---

## Pending coverage (tracked; extend the gates here as they land — Commit 2)

`audit-effect-canonicality.mjs` currently gates 3 tables. The zero-trust component sweep found the
same class in more places; extend the gate to cover them, then reconcile:
- `capability-types.ts` `CAPABILITY_BIT_POSITION` / `KNOWN_CAPABILITIES` (the V_DPM capability vocabulary; already carries `storage.write`/`ledger.mutate`/`shell.execute`/`native.call`).
- `gir-emitter.ts` `EFFECT_TO_CAPABILITY` (only 8 of 31+ canonical effects mapped — decide bit-exempt vs gap).
- Stage-A `CANONICAL_EFFECTS` (TS) vs Stage-B `self-hosted/effect-checker.fungi` `knownEffects()` (divergent).
- Local inference sets (`MUTATION_EFFECTS`, `NETWORK_EFFECTS`, `AI_EFFECTS`, `HIGH_TRUST_EFFECTS`) — CG-5 regression guard.
- **Runtime-enforceability (CG-2 extension):** canonical effects `payment.charge`, `pii.read/write`, `phi.read/write` have **no V_DPM bit** → not runtime bit-enforceable. Assign bits (or a domain-capability lane).

**Rule for new defect classes (the meta-rule):** when a defect turns out to be a toolchain
self-inconsistency, do not just fix the instance — add the invariant to the table above and a gate
that fails on it, so the *class* cannot silently return. (See `.claude` memory: `logicn-rule-error-to-tooling`.)

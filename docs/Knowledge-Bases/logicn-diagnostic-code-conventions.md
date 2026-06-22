# LogicN — Diagnostic Code Conventions (the rules)

The authoritative naming + structure rules for **every diagnostic / error / status code** in LogicN. Written
after the [taxonomy audit](logicn-diagnostic-code-taxonomy-audit-2026-06-22.md) found ~30 codes diseased
(overloaded meanings, mixed-case severities, cross-package duplication, dead codes). **These rules exist to
make those classes impossible** — each rule names the finding it prevents. Enforced by the #215 scanner
(`scripts/audit-diagnostic-codes.mjs`); this doc is the spec it encodes.

> **Binding for all contributors (human + AI).** Adding or editing a code that violates these is a build
> failure once the scanner is CI-enforcing. When in doubt, run `node scripts/audit-diagnostic-codes.mjs` — it
> must stay green (baseline only goes down).

---

## 1. The cardinal rule
**One code = one failure mode = one `name` = one severity-policy = one definition.**
A code answers exactly one question. If you need to report a second, distinct problem, allocate a second code.
*(Prevents: V1 overload — e.g. SECRET-002 carrying 3 modes; V4 multi-severity.)*
*(A `dev`-warning → `prod`-error toggle of the SAME problem is allowed — that's one failure mode, two profiles.)*

## 2. Code identifier format
- **Compiler / governance diagnostics:** `LLN-<FAMILY>-<NNN>` — `FAMILY` = UPPERCASE `[A-Z0-9]+`, `NNN` =
  zero-padded number. No bespoke suffixes (`LLN-RUNTIME-EFFECT-GATE` ✗ → `LLN-RUNTIME-010` ✓). No parallel
  sub-schemes that collide with the parent (`LLN-CONFIG-GOV-003` ✗ collides with `LLN-CONFIG-003`).
- **Runtime/host errors:** `ERR_<DOMAIN>_<DETAIL>` — UPPER_SNAKE. **One scheme per layer** — do NOT introduce a
  third (the unused `LogicN-ERR-{DOMAIN}-NNN` in `error-codes.md` must go).
- **Numbers are allocated monotonically and never repurposed.** A retired code's number stays retired
  (versioning stability); document reserved gaps explicitly (no silent gaps like the missing `FAULT-002`).

## 3. `name` (the symbolic label) — ONE case convention
- **`name` is `UPPER_SNAKE_CASE`.** e.g. `UNDECLARED_EFFECT`, `EMERGENCY_EXPANDS_CAPABILITY`,
  `SECRET_SENT_TO_NETWORK`. *(Chosen because the governance/security core — the most codes and the
  highest-stakes — already uses it, and UPPER_SNAKE visually separates a code-name constant from a PascalCase
  TS type/class.)*
- **PascalCase names are legacy and migrate to UPPER_SNAKE** (`SecretComparisonDenied` → `SECRET_COMPARISON_DENIED`,
  `ProtectedBoundaryViolation` → `PROTECTED_BOUNDARY_VIOLATION`). The scanner will warn on PascalCase during the
  migration window, then error. *(Prevents the case-split the owner flagged.)*
- **A `name` belongs to exactly ONE code** (no `INTENT_BEHAVIOR_MISMATCH` under both GOV-001 and INTENT-001).
  *(Prevents: V2 collision.)*
- **Don't reuse a diagnostic `name` as a bare trap/violation token** (`EFFECT_BOUNDARY_VIOLATION` must not be
  both an `LLN-EFFECT-003` `name:` and a free-standing thrown code — prefix the trap form, e.g. `TRAP_…`).
  *(Prevents: cross-namespace collision.)*

## 4. `severity` — fixed lowercase vocabulary, by axis
- **Diagnostic severity is exactly `"error" | "warning" | "info"` — lowercase, no others.**
  No `SECURITY_ALERT`, no UPPERCASE `ERROR`/`INFO`/`WARNING`, no `Low`/`critical` on a diagnostic.
  *(Prevents: V3 severity-vocab — the 17 offenders incl. BORDER's `SECURITY_ALERT` and tower-citizen's
  UPPERCASE audit severities.)*
- **Risk-rating is a SEPARATE axis from diagnostic severity.** A security/PCI finding's risk uses its own
  field with one fixed scale `"low" | "medium" | "high" | "critical"` (lowercase) — never mixed into a
  diagnostic's `severity`, and never two spellings (`Low|Medium|High|Critical` vs `critical|high|medium` must
  converge). *(Prevents: the §7 cross-scale inconsistency.)*
- **Audit-event severity is also a separate axis.** Tower-citizen `AuditEvent.severity` is a runtime/audit
  vocabulary (currently UPPERCASE `ERROR|WARNING|INFO`), distinct from compiler diagnostic severity. The #215
  scanner's V3 therefore checks ONLY the diagnostic axis (severities attached to an `LLN-*`/`ERR_*` code).
  Migrating the audit-event vocabulary to lowercase to match is a **versioning-sensitive format change** (it
  alters signed audit records) — deferred to a deliberate, version-bumped change (Stage I), not forced here.

## 5. Single source of truth
- **Every code has exactly one exported metadata constant** (`export const LLN_<FAMILY>_<NNN> = { code, name,
  severity, message, … }` / the `ERR_*` equivalent), listed in its family's `_DIAGNOSTICS` array.
- **Every emit references the constant** — no inline `code: "LLN-…"` string literals, no
  `throw new Error("LLN-…: …")`. Severity/name/message live in the constant only, so they cannot drift between
  the spec and the call site. *(Prevents: R4 inline-emit drift; the raw-throw `MANIFEST-*`/`ASSIMILATE-*` cases.)*
- **A "code" must be a structured field, not free text.** `{ ok:false, reason:"ERR_X: …" }` is not a code —
  use `{ ok:false, errorCode:"ERR_X", reason:"…" }`. *(Prevents: `ERR_QUANTUM_PQ_REQUIRED` /
  `ERR_ADDON_HASH_MISMATCH` / `ERR_BRIDGE_UNATTESTED`-mode-collapsing being invisible + un-branchable.)*

## 6. No cross-package redefinition
- **One package owns each code** (`logicn-core-compiler` is the canonical exporter for `LLN-*`). Other packages
  **import** the constant — they never re-declare a code with their own `name`/`severity`.
  *(Prevents: R3 — the #1 root cause. e.g. `devtools-project-graph/effect-graph.ts` redefining EFFECT-002/003/004
  inverted; the GRAPH-* dual definitions.)*
- A doc/comment claiming "canonical to X" must actually import from X.

## 7. No dead codes, no false gates
- **Every defined code is live-emittable OR explicitly `RESERVED`** in the registry; README/spec ranges must
  match what the compiler can actually emit. *(Prevents: R5 — INTENT/STRING/CHAR/MEMORY/COMPUTE/PROFILE dead sets.)*
- **A production-blocking gate may reference ONLY live-emittable codes.** *(Prevents the worst R5 case:
  `MEMORY-001..007` gating production while having no emitter — advertising enforcement that can't fire.)*

## 8. Adding a new diagnostic — the checklist
1. Pick the family (or propose a new one); allocate the **next free `NNN`** (never reuse a retired one).
2. Add the exported metadata constant: `code` (§2), `name` UPPER_SNAKE (§3), `severity` lowercase (§4),
   `message`, optional `why`/`suggestedFix`. Add it to the family `_DIAGNOSTICS` array.
3. Emit **via the constant** (§5) — no inline literal, no raw throw.
4. If another package needs it, **import** it (§6) — don't redeclare.
5. Register it in [logicn-governance-rules.md](logicn-governance-rules.md) / the invariants matrix; if not yet
   wired, mark it `RESERVED` (§7).
6. **Run `node scripts/audit-diagnostic-codes.mjs`** — it must report no new V1/V2/V3/V4 (§215 guard).

## 9. Enforcement
The #215 scanner (`scripts/audit-diagnostic-codes.mjs`) checks §1/§3/§4 today (V1 overload, V2 collision, V3
severity-vocab, V4 multi-severity) and is being hardened for §5/§6/§7 (single-constant, cross-package, dead
codes, the production-gate check). Once a category reaches 0 it flips to CI-enforcing (wired into
`run-phase-close.mjs`). The convention and the scanner move together: the scanner is this doc, executable.

> **Owner-confirmable choice:** §3 picks **`UPPER_SNAKE` for `name`** (driving a rename of the PascalCase
> families). If you prefer PascalCase, that's the one knob to flip here — everything else is forced by the
> findings.

## See also
[logicn-diagnostic-code-taxonomy-audit-2026-06-22.md](logicn-diagnostic-code-taxonomy-audit-2026-06-22.md)
(the findings these rules prevent) · [logicn-governance-rules.md](logicn-governance-rules.md) (the LLN code
registry) · `scripts/audit-diagnostic-codes.mjs` (the enforcement) · [logicn-task-ledger.md](logicn-task-ledger.md) §9 (#213/#215).

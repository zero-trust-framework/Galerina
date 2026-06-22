# Coverage Cross-Check Methodology — index every dimension, then prove the audit covered it

**Status:** IN PROGRESS — owner-directed 2026-06-22. **`codes` dimension BUILT + RUN** (`scripts/audit-coverage.mjs`,
wired into run-phase-close `--soft`); other dimensions pending. Full end-of-roadmap pass (ALL items, finished
AND unfinished) is the remaining scope; thereafter a standing gate on every audit.

**First run (codes, 2026-06-22) — the tool works + surfaced real signal:** 930 codes indexed vs only 67 LLN
codes in the governance registry → **317 src-real `LLN-*` REGISTRY-UNCOVERED** (the registry is blind to most
codes); **40 DEAD candidates** (≥8 are false-positives — `ERR_REGISTRY_*` are live+tested but the code-index
doesn't recognise the `{code:"ERR_…"}` result-object emit pattern → a code-index emit-detection gap to fix);
0 registry-phantoms. Report: `build/coverage/coverage-codes.md`. Triage of the 317/40 is the codes-coverage
remediation (distinct from the conformance scanner's V1-V5).

## Why (the motivating failure)
The diagnostic-"codes" audit nearly missed real problems. The src-only R3 scan (codes defined in >1
package's `src`) found EFFECT/GRAPH but **missed** `logicn-devtools-project-graph` squatting on core's
`LLN-BOUNDARY` series — because core owns that series only in its **README/TODO**, not yet in `src`. A
`grep` for a stale "canonical to core" comment caught it by luck. **An audit whose completeness rests on
one detector's blind spots is not trustworthy.** The fix: for each governed dimension, build a comprehensive
INDEX, then CROSS-CHECK the audit against the index in BOTH directions so coverage is provable, not assumed.

## The principle
```
An audit is only as complete as the index it is cross-checked against.
Index the whole domain (every source) → prove the audit touched every entry → prove every finding maps back.
```

## Universal-coverage REQUIREMENT (owner 2026-06-22, hard rule)
**Everything in LogicN must be indexed by at least ONE audit.** An orphan — any construct (code, capability,
syntax form, effect, governance rule, stdlib fn, CLI command, generated artifact) covered by NO index/audit —
is a gap by definition. The first coverage run proved the risk: **317 src-real `LLN-*` codes are not in the
governance registry** (the registry covered 67 of ~930). The end-state is: for each dimension, `audit-coverage`
shows 0 orphans (every entry covered) and 0 phantoms (every audited thing exists).

## Standards must be RESEARCH-GROUNDED (owner 2026-06-22)
The audit / coverage / R&D standards we require are not to be invented in a vacuum — they are benchmarked
against **best practice + real production examples from mature projects** (see ledger **#219**): how Rust
(diagnostic registry + UI/`stderr` tests per diagnostic), Roslyn/Clang (analyzer/diagnostic groups, every
diagnostic documented+tested), ESLint/analyzers (docs + tests REQUIRED per rule), Cedar/OPA (policy + coverage
tests), SLSA/in-toto/Sigstore (build provenance/attestation), and proof-gated research projects do it. The
output is a LogicN "Audit Coverage & R&D Standards" doc that each enforcer (#215 scanner, #218 coverage,
TASK-ENV/SEC/BLD/DOC) is measured against.

## The dimensions to index (the "graph indexing for each")
One index per governed dimension. Each pairs with its audit and its enforcing detector/scanner.

| Dimension | Index (tool) | Audit | Detector/gate | Status |
|---|---|---|---|---|
| Diagnostic codes (`LLN-*`, `ERR_*`, traps) | `scripts/code-index.mjs` → `build/code-index/` | [taxonomy audit](logicn-diagnostic-code-taxonomy-audit-2026-06-22.md) | `scripts/audit-diagnostic-codes.mjs` (V1-V5) | ✅ index + audit + scanner exist |
| Capabilities · syntax · full language surface | **#217** capability/syntax index (PARKED) | — | — | 🔲 build #217 first |
| Flows · dependencies · symbols | `logicn-core-cli graph` → `build/graph/` | — | phase-close regen | ✅ index exists; no coverage audit yet |
| Governance rules | [logicn-governance-rules.md](logicn-governance-rules.md) registry | rules index | invariants matrix | 🔲 index-ify |
| Effects | `EFFECT_REGISTRY` / `CANONICAL_EFFECTS` (effect-checker) | #201 work | effect-checker | partial |
| Non-LLN namespaces (CBOR tags, HTTP status, metric names) | — | taxonomy audit §6 | — | 🔲 index-ify |

## The cross-check (bidirectional — this is the new gate)
For each dimension, the audit is "covered" only when ALL THREE hold:
1. **Index → audit (no blind spots):** every entry in the index was examined by the audit/detector. A code
   in `code-index` that no scanner rule inspects is an uncovered blind spot.
2. **Audit → index (no phantom findings):** every audit finding maps to a real index entry. A finding about
   a code not in the index means the index is incomplete (or the finding is stale).
3. **Index completeness (all sources):** the index ingests EVERY source of truth, not just `src` — docs,
   README, TODO, registries, manifests. *(This is the Stage-D lesson: README-only ownership was invisible to
   a src-only index.)* An index that misses a source silently under-reports coverage.

Output per dimension: a `coverage-<dimension>.md` report — `indexed N · audited M · uncovered [...] ·
phantom [...] · sources ingested [...]`. Green = the three conditions hold with empty gap lists.

## Graph the audit — it is a TOOL, never a manual pass (owner 2026-06-22, token economy)
The cross-check — AND the audit itself, wherever possible — is **deterministic code**, not an LLM reading
files. A manual audit costs tokens every run and inherits the reader's blind spots (the exact reason the
codes audit nearly missed `LLN-BOUNDARY`). A script is cheap, repeatable, and CI-gateable. Concretely:
- **`scripts/audit-coverage.mjs <dimension>`** reads the dimension's index (a JSON graph — `code-index.json`,
  the #217 capability index, the project-graph JSON) and the audit's machine-readable coverage set, computes
  the bidirectional set-difference, and emits `build/coverage/coverage-<dimension>.md` + exit code = gap count.
- **Each audit must expose what it covers in machine-readable form.** The codes dimension already does — the
  #215 scanner's rules ARE its coverage; the `code-index` ARE the entries. A prose audit doc that NO detector
  backs is precisely the thing to REPLACE with a detector, because its coverage cannot be graphed (and so
  cannot be trusted).
- **The LLM's role shifts** from "perform the audit" to "build/extend the detector + read the gap report" —
  `feedback-build-tools-to-save-tokens` applied to auditing itself. Do NOT hand-audit what a script can graph.

## Procedure (end-of-roadmap pass)
1. Enumerate every roadmap item (finished + unfinished) and map each to the dimension(s) it touches.
2. For each dimension: ensure its index exists (build #217 etc.), then run/author the cross-check report.
3. Review the reports together; any non-empty gap list is a remediation task (the index, the audit, or the
   detector is incomplete — fix whichever).
4. Wire the green cross-checks into `run-phase-close.mjs` so coverage can only improve (regression gate).

## Connections
Builds on the existing token-saver tooling ([feedback-build-tools-to-save-tokens]) and the diagnostic-code
[conventions](logicn-diagnostic-code-conventions.md) + [scanner](logicn-diagnostic-code-taxonomy-audit-2026-06-22.md).
#217 (capability/syntax index) is a prerequisite for the capabilities/syntax dimension. The project graph
(`build/graph/`) already indexes flows/deps/symbols but has no coverage audit yet — a candidate first target.

## Trigger
Owner gated this to "once [the current roadmap] is finished." Do NOT start the full pass until the in-flight
work (#201 + the rest) lands. A single-dimension proof-of-concept is the FIRST RUN of
`scripts/audit-coverage.mjs codes` (a TOOL to be written), NOT a manual cross-check — building that script is
itself the token-saving move and can be done sooner on owner request to validate the methodology.

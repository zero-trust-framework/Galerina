# Coverage cross-check — dimension: codes (#218 / std #1 universal coverage)

Index: code-index.json (941 codes) · Derived registry: build/code-registry (ALL codes, by construction) · Curated: logicn-governance-rules.md (69 LLN codes).

## Universal coverage (anchor std #1)
- 941/941 codes catalogued in the DERIVED registry by construction → NO ORPHANS ✓

## Coverage HOLES (actionable — exit code)
- REGISTRY-PHANTOM (curated governance-rules.md lists a code absent from source — stale): 0

## Backlogs (NOT orphans — tracked for incremental adoption, not exit-failing)
- governance-rules.md CURATION gap: 323 src-real LLN-* lack a semantic entry in the curated registry (they ARE in the derived registry). Generate/curate per std #10.
- PHANTOM doc-only drift: 464 (std #9/#10 → DOC-004).
- INLINE / no exported constant (R4): 289 (std #5 → taxonomy Stage F).
- DEAD / RESERVED (defined, never emitted): 0 (std #1 wire-or-retire; tagged RESERVED in the derived registry).

## Notes
- #215 scanner is SRC-ONLY; doc/README-declared ownership is invisible to it (Stage-D LLN-BOUNDARY lesson); REGISTRY-PHANTOM covers the reverse, full doc-ownership = scanner §6 (future).
- Known false-dead pending const-id resolution: LLN-BOOL-BOUNDARY-001/002 (live via validateBoolBoundary).

## Coverage holes: 0 · curation backlog: 323 · drift: 464 · R4-inline: 289 · RESERVED: 0

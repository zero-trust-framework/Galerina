# Coverage cross-check — dimension: codes (#218)

Index: build/code-index/code-index.json (930 codes) · Registry: logicn-governance-rules.md (67 LLN codes)

## Coverage HOLES (actionable)
- DEAD (defined, never emitted): 32 — LLN-BOOL-BOUNDARY-001, LLN-BOOL-BOUNDARY-002, LLN-BOOL-BOUNDARY-003, LLN-BOOL-BOUNDARY-004, LLN-BOOL-BOUNDARY-005, LLN-DECISION-001, LLN-DECISION-002, LLN-DECISION-003, LLN-DECISION-004, LLN-DECISION-005, LLN-GOV-3VL-001, LLN-OMNI-001, LLN-OMNI-002, LLN-OMNI-003, LLN-OMNI-004, LLN-OMNI-005, LLN-TRI-001, LLN-TRI-002, LLN-TRI-003, LLN-TRI-004, LLN-TRI-005, LLN-TYPE-010, LLN-TYPE-012, LLN-TYPE-013, LLN-TYPE-015, LLN-TYPE-018, LLN-TYPE-019, LLN-VAULT-001, LLN-VAULT-002, LLN-VAULT-003, LLN-VAULT-004, LLN-VAULT-005
- REGISTRY-UNCOVERED (src-real LLN-* not in the governance registry — audit blind spot): 317
    LLN-ANTI-ABUSE-001
    LLN-ARCH-001
    LLN-ARCH-002
    LLN-AUDIT-001
    LLN-AUDIT-003
    LLN-BACKEND-001
    LLN-BINDING-001
    LLN-BINDING-002
    LLN-BINDING-003
    LLN-BINDING-004
    LLN-BINDING-005
    LLN-BINDING-006
    LLN-BLOCK-001
    LLN-BLOCK-002
    LLN-BLOCK-003
    LLN-BLOCK-004
    LLN-BOOL-BOUNDARY-001
    LLN-BOOL-BOUNDARY-002
    LLN-BOOL-BOUNDARY-003
    LLN-BOOL-BOUNDARY-004
    LLN-BOOL-BOUNDARY-005
    LLN-BORDER-001
    LLN-BORDER-002
    LLN-BORDER-003
    LLN-BORDER-004
    LLN-BORDER-005
    LLN-BUILD-001
    LLN-BYTE-001
    LLN-BYTE-002
    LLN-BYTE-003
    LLN-BYTE-004
    LLN-BYTE-005
    LLN-CHAR-001
    LLN-CHAR-002
    LLN-CHAR-003
    LLN-CHAR-004
    LLN-COMPUTE-001
    LLN-CONFIG-001
    LLN-CONFIG-002
    LLN-CONFIG-003
    …and 277 more
- REGISTRY-PHANTOM (registry lists a code absent from the index — stale): 0

## Known backlog (tracked elsewhere — reported, not counted as new holes)
- DOC-ONLY drift (documented, no src def/emit): 468 (taxonomy audit R5)
- INLINE / no exported constant (R4): 288 (taxonomy audit Stage F)

## Completeness note
- The #215 scanner is SRC-ONLY; doc/README-declared ownership is invisible to it (the Stage-D
  LLN-BOUNDARY lesson). REGISTRY-PHANTOM partly covers the reverse; a full doc-ownership check is
  the scanner §6 hardening (future).

## TOTAL coverage holes: 349 (dead 32 + registry-uncovered 317 + registry-phantom 0)

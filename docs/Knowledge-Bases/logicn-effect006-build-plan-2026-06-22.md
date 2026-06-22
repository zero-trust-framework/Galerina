# #201 — LLN-EFFECT-006 strict over-declaration: build plan + classification (2026-06-22)

Owner greenlit #201 ("build now"): an effect **declared** on a flow but not **observed** in its body (nor
inherited transitively) is `LLN-EFFECT-006 OVERDECLARED_EFFECT` — error, ALL profiles. The mirror of
`LLN-EFFECT-001` (use-without-declare). `LLN-EFFECT-002` is de-overloaded to carry ONLY transitive-missing.
Owner: "full principled fix + ALL effects operation-inferred (no declarative exemption — pii/phi inferred from
a protected-type op)"; "the build must also fix every over-declared fixture/example."

## WIP already in place (restored from stash)
- ① AI `\w+Model\.\w+` + payment `\b\w*Payment\w*\.\w+` patterns in `EFFECT_CALL_PATTERNS`.
- `LLN-EFFECT-006` emit in `effect-checker.ts` (~line 529); EFFECT-002 now transitive-only.
- Reduced the flagged set 61 → **39 files (48 flow:effect pairs)**.

## Classification of the 39 (workflow `witigc2uq`, 8 agents · 472k tok): A=24 · B=11 · C=13

### Structural finding (drives category A)
The EFFECT-006 **observed** set is built from `inferEffectsFromNode` → `EFFECT_CALL_PATTERNS` (regex) ONLY, and:
1. **skips local `fnDecl` bodies** (effect-checker.ts ~996/1025: `if (n.kind === "fnDecl") return;`) — so
   effects performed inside nested helpers are invisible (110 `http.get`, 112 `OrdersDB.insert`, 354 `*Model.classify`).
2. **receiver patterns too narrow** — misses `EmailGateway`, `ExternalService`/`*Service`, `ApiClient`/`*Client`,
   `*Store`, `*SDK`, `Process.spawn`, AI compute-target receivers (`QuantumOptimiser`, `OpticalProjection`,
   `*Simulator`, bare `Model`, `*ModelRegistry`), and payment-charge that is ALSO network egress.
3. **no cross-flow callee propagation into the observed set** — a flow calling a user flow `fetchRate()` that
   declares `network.outbound` is not credited (108, 120). (`hasTransitiveEffect` exists in the EFFECT-006 guard
   but isn't catching these — needs investigation: call-graph may not capture bare-call edges.)

→ Category A is a genuine checker-inference improvement (fnDecl descent + patterns/registry + propagation), with
**global blast radius** (broadening observed-effect inference can newly raise/clear EFFECT-001/006 elsewhere) →
must be verified against the FULL suite, not just these 39.

### Category B — type-driven pii/phi (11): the new inference (sub-step ②)
`checkEffects(flows, ast)` has **no type/value-state input** — so pii/phi must be inferred by tracking
`protected <Brand>` annotations in the AST and the read/write op. Brands seen in the corpus:
- **PII** (identity/contact): `NhsNumber`, `PatientName`, `DateOfBirth`, `PatientId`, `Email`, `Address`/contact.
- **PHI** (health/medical): `PatientData` (composite medical record); (`DiagnosisCode`/`BloodType`/`MedicationCode` if read).
- read op = field/param access or DB select binding a protected value; write op = DB insert/update of, or network
  send of, a protected value. (`redact(x)` should NOT count as egress of the raw value.)
- Flows: 451, 452, 459(×2), 460(×2), 461, 462, 463, 465(pii.write), 471. **465 `phi.read` is actually category C**
  (no PHI brand is read — remove that one declaration).

### Category C — true over-declarations (13): per-example (sub-step ③)
REMOVE the declaration: 091 (database.write+audit.write — only validates/counts), 173 (database.write — ends at
audit), 176 (database.read — only builds a query string), 204 (database.write — scores+audits in-memory), 217
(database.write — buggy stub `return Ok(...)`), 465 (phi.read — no PHI read), 040 (audit.write — readable-form demo).
ADD a minimal op: 151 (audit.write — governed create should audit), 152 (database.write — should persist after parse).
**Negative-test CONFLICT (see decision D1):** 119 (`network` broad alias — already EFFECT-004/005), 356
(audit.write — deliberately omits audit to trigger GOV-002), 458 (audit.write — omits audit to trigger AUDIT-001).

## Remaining sub-steps
④ flip the 2 warning-asserting unit tests → EFFECT-006 error · ⑤ port the over-declaration check to Stage-B
`src/self-hosted/effect-checker.lln` · ⑥ register `LLN_EFFECT_006` metadata (mirror `LLN_EFFECT_005` in index.ts;
name `OVERDECLARED_EFFECT`, error) + diagnostics-spec doc.

## DECISIONS SURFACED (the classification raised two genuine ones — see chat AskUserQuestion 2026-06-22)
- **D1** — EFFECT-006 vs negative tests / governance-required effects (119, 356, 458). Recommended:
  **suppress EFFECT-006 when the effect is already flagged invalid-name (EFFECT-004/005) OR a governance rule
  (GOV-002/AUDIT-001) mandates that effect's operation** — fires only for genuinely-extra authority. Keeps the
  teaching corpus intact and avoids contradictory advice.
- **D2** — pii/phi brand→family map. Recommended default: identity/contact brands = pii; health/medical = phi
  (table above). Owner-confirmable per the #201 note.

## OWNER ANSWERS (2026-06-22)
- **D1 → "Suppress when already covered."** EFFECT-006 stays silent when the effect is already flagged
  invalid-name (EFFECT-004/005) OR a governance rule (GOV-002/AUDIT-001) mandates that effect's operation.
- **D2 → "I'll specify the map."** The pii/phi brand→family map will be owner-provided. Until then, category B
  (②) is BLOCKED: build the ② machinery but **temporarily exempt `pii.*`/`phi.*` from the EFFECT-006 check**
  (documented interim, NOT the permanent no-exemption policy) so the 11 pii/phi flows stay green; remove the
  exemption + populate the map when the owner provides it.

## Delivery split
- **Part 1 (now, unblocked):** ⑥ `LLN_EFFECT_006` metadata · D1(a) suppress on invalid/broad effect name (119) ·
  category-A inference fixes (fnDecl descent + receiver patterns + cross-flow propagation) · category-C example
  fixes (remove/add per table) · D1(b) suppress audit.write when GOV-002/AUDIT-001 covers it (356/458) ·
  ④ unit tests · interim pii/phi exemption. Verify FULL suite.
- **Part 2 (owner map):** populate pii/phi brand map, build ② type-driven inference, remove the interim exemption,
  verify the 11 flows · ⑤ Stage-B `effect-checker.lln` port.

Full per-flow evidence: task output `tasks/witigc2uq.output`.

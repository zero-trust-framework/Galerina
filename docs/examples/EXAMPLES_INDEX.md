# Galerina Canonical Example Corpus — Index

> Generated: 2026-05-31  |  Total: 222 examples  |  Stable: 188  |  Draft: 34

This file is the human-readable companion to `examples.manifest.json`.
Each example lives at `docs/Examples/<level-dir>/<id>/example.fungi`.

---

## Contents

- [Level 1 — Basics](#level-1-basics)
- [Level 2 — Types](#level-2-types)
- [Level 3 — Effects](#level-3-effects)
- [Level 4 — Security](#level-4-security)
- [Level 5 — Governance](#level-5-governance)
- [Level 6 — Compute](#level-6-compute)
- [Level 7 — AI](#level-7-ai)
- [Level 8 — Targets](#level-8-targets)
- [Level 9 — Enterprise](#level-9-enterprise)
- [Proposed — Readable Logic Forms](#proposed-readable-logic-forms)

---

## Level 1 — Basics

Core syntax — pure/guarded/secure flow, let/mut/readonly, Result, Option, match, enum, record, type alias, contract.

**23 examples** — 19 stable, 4 draft

| ID | Concept | Status | Key Features |
|---|---|---|---|
| `001-pure-flow` | pure flow | stable | Money |
| `002-guarded-flow` | guarded flow | draft | Result, unsafe |
| `003-secure-flow` | secure flow | stable | Result, audit, protected, record, unsafe |
| `004-local-fn-helper` | fn helper | stable | Money, fn |
| `005-let-binding` | let binding | stable | — |
| `006-mut-binding` | mut binding | draft | — |
| `007-readonly-parameter` | readonly parameter | stable | contract, flow, for |
| `008-readonly-local-binding` | readonly local binding | stable | — |
| `009-unsafe-let-boundary` | unsafe let — boundary input | stable | unsafe |
| `010-result-return` | Result return type | stable | Result |
| `011-option-return` | Option return type | stable | Option |
| `012-match-result` | match on Result | draft | Result, match |
| `013-match-option` | match on Option | draft | Option, match |
| `014-enum-basic` | enum declaration | stable | enum |
| `015-record-basic` | record type | stable | record |
| `016-type-alias` | type alias | stable | — |
| `017-domain-brand-type` | branded domain type | stable | — |
| `018-protected-type-label` | protected type qualifier | stable | protected |
| `019-redacted-type-label` | redacted type qualifier | stable | redacted |
| `020-invalid-fn-top-level` | fn cannot be declared at top level `FUNGI-SYNTAX-005` | stable | Money, fn |
| `021-flow-contract-basic` | flow contract block with types, intent, and events | stable | Array, Result, events, match, protected |
| `022-no-toplevel-let` | top-level let bindings are rejected `FUNGI-SYNTAX-006` | stable | contract, flow |
| `023-readable-logic-forms` | readable operator aliases — and, or, unless, is | stable | unless |

## Level 2 — Types

Primitive and domain types — Int, Decimal, String, Bool, Byte, Char, Email, PatientId, NhsNumber, Money, Tensor, Option, Result, Array, Duration, Timestamp.

**43 examples** — 40 stable, 3 draft

| ID | Concept | Status | Key Features |
|---|---|---|---|
| `051-int-basic` | Int type | stable | — |
| `052-decimal-basic` | Decimal type | stable | — |
| `053-string-basic` | String type | stable | — |
| `054-bool-basic` | Bool type | stable | — |
| `055-byte-basic` | Byte type | stable | — |
| `056-char-basic` | Char type | stable | — |
| `057-email-type` | protected Email domain type | stable | protected, unsafe |
| `058-patient-id-type` | protected PatientId domain type | stable | protected, unsafe |
| `059-nhs-number-type` | protected NhsNumber domain type | stable | protected, unsafe |
| `060-invalid-email-assignment` | direct assignment to protected Email is forbidden `FUNGI-TYPE-003` | stable | protected |
| `061-redacted-email` | redacted Email label | stable | redacted |
| `062-invalid-redacted-email` | protected Email cannot be assigned to redacted Email directly `FUNGI-TYPE-002` | draft | protected, redacted |
| `063-option-some` | Option<T> with Some value | stable | Option |
| `064-option-none` | Option<T> with None value | stable | Option |
| `065-option-invalid-arity` | Option<T> requires exactly one type parameter `FUNGI-TYPE-009` | stable | Option |
| `066-result-success` | Result<T,E> Ok variant | stable | Result |
| `067-result-error` | Result<T,E> Err variant | stable | Result |
| `068-result-invalid-arity` | Result<T,E> requires exactly two type parameters `FUNGI-TYPE-009` | stable | Result |
| `069-auto-inference` | Auto type inference | stable | — |
| `070-auto-invalid` | Auto requires an initializer `FUNGI-TYPE-002` | draft | — |
| `071-money-gbp` | Money<GBP> type | stable | Money |
| `072-money-add-same-currency` | Money<GBP> addition with same currency | stable | Money |
| `073-money-cross-currency-invalid` | cross-currency Money addition is forbidden `FUNGI-TYPE-004` | stable | Money |
| `074-money-times-decimal` | Money<GBP> multiplied by Decimal | stable | Money |
| `075-money-divide-decimal` | Money<GBP> divided by Decimal | stable | Money |
| `076-money-times-money-invalid` | Money multiplied by Money is forbidden `FUNGI-TYPE-004` | stable | Money |
| `077-money-ratio` | Money<GBP> / Money<GBP> yields Decimal | stable | Money |
| `078-money-ratio-cross-currency-invalid` | cross-currency Money ratio is forbidden `FUNGI-TYPE-004` | stable | Money |
| `079-tensor-basic` | Tensor<Dtype, Shape> with static shape | stable | Tensor |
| `080-tensor-dynamic-shape` | Tensor<Dtype, DynamicShape> | stable | Tensor |
| `081-tensor-invalid-arity` | Tensor requires exactly two type parameters `FUNGI-TYPE-009` | stable | Tensor |
| `082-readonly-view` | ReadOnlyView<T> generic type | stable | — |
| `083-readonly-view-invalid` | ReadOnlyView requires exactly one type parameter `FUNGI-TYPE-009` | stable | flow |
| `084-unknown-type` | unknown type name produces FUNGI-TYPE-001 `FUNGI-TYPE-001` | stable | flow |
| `085-type-mismatch` | type mismatch produces FUNGI-TYPE-002 `FUNGI-TYPE-002` | stable | flow |
| `086-protected-not-redacted` | protected value cannot be directly assigned to redacted binding `FUNGI-TYPE-002` | draft | protected, redacted |
| `087-protected-email-audit` | full protected -> redacted -> audit pattern | stable | audit, protected, redacted |
| `088-array-range` | Array.range static constructor | stable | Array |
| `089-duration-type` | Duration type and arithmetic | stable | and, contract, flow |
| `090-result-sequence` | Result.sequence converts Array<Result<T,E>> to Result<Array<T>, E> | stable | Array, Result |
| `091-trust-sensitivity-independent` | trust and sensitivity are independent axes | stable | Array, Result, audit, protected, unsafe |
| `092-boolean-logic` | Bool, true/false, if/else, and/or/not, comparisons | stable | and, contract, flow, or |
| `093-time-types` | Duration, Timestamp, Duration.ofSeconds, add/subtract | stable | and, contract, flow |

## Level 3 — Effects

Effect system — declaring database.write, network.outbound, storage.read, audit.write; effect propagation and enforcement.

**20 examples** — 18 stable, 2 draft

| ID | Concept | Status | Key Features |
|---|---|---|---|
| `101-pure-no-effects` | pure flow has no effects | stable | Money |
| `102-guarded-database-write` | guarded flow declaring database.write effect | stable | Result |
| `103-guarded-network-outbound` | guarded flow declaring network.outbound effect | stable | Result, unsafe |
| `104-multiple-effects` | flow declaring multiple effects | stable | Result, audit, record |
| `105-missing-database-effect` | undeclared database.write effect `FUNGI-EFFECT-001` | stable | Result |
| `106-missing-network-effect` | undeclared network.outbound effect `FUNGI-EFFECT-001` | stable | Result, unsafe |
| `107-pure-flow-calls-effectful-flow` | pure flow cannot call an effectful flow `FUNGI-EFFECT-003` | draft | Money |
| `108-guarded-flow-calls-effectful-flow` | guarded flow can call effectful flow when it declares the same effects | stable | Money, Result |
| `109-local-fn-pure-helper` | local fn as a pure helper inside a flow | stable | Money, fn |
| `110-local-fn-uses-parent-effect` | local fn may use effects declared by the containing flow | stable | Result, fn, unsafe |
| `111-local-fn-effect-not-covered-by-parent` | local fn cannot use effects not declared by the containing flow `FUNGI-EFFECT-001` | stable | Result, fn, unsafe |
| `112-local-fn-cannot-declare-effects` | local fn cannot declare its own effects `FUNGI-SEC-014` | stable | Result, fn |
| `113-secure-flow-with-effects` | secure flow with full effects pattern | stable | Result, audit, protected, record, redacted, unsafe |
| `114-secure-flow-missing-audit-effect` | secure flow calls AuditLog.write but does not declare audit.write `FUNGI-EFFECT-001` | stable | Result, audit, protected, unsafe |
| `115-effect-propagation-through-call` | effect propagation through a flow call chain | draft | Result |
| `116-effect-propagation-missing-parent` | caller missing effect required by callee `FUNGI-EFFECT-002` | stable | Result |
| `117-effectful-operation-in-pure-flow` | storage.read in a pure flow is forbidden `FUNGI-EFFECT-003` | stable | Result, unsafe |
| `118-filesystem-read-guarded` | guarded flow with storage.read effect | stable | Result, unsafe |
| `119-effect-name-invalid` | non-canonical effect name is rejected `FUNGI-EFFECT-004` | stable | Result, unsafe |
| `120-effect-summary-example` | comprehensive effects example showing all patterns | stable | Result, audit, protected, redacted, unsafe |

## Level 4 — Security

Security model — trust boundaries, unsafe let, validate gates, protected/redacted labels, audit sinks, secret handling.

**27 examples** — 25 stable, 2 draft

| ID | Concept | Status | Key Features |
|---|---|---|---|
| `151-http-request-boundary` | HTTP request data enters as unsafe | stable | Result, audit, protected, unsafe |
| `152-file-boundary` | file content enters as unsafe | stable | Result, unsafe |
| `153-environment-boundary` | environment variables enter as unsafe | stable | Result, unsafe |
| `154-validate-email` | validating unsafe email to protected Email | stable | Result, audit, protected, record, unsafe |
| `155-validate-patient-id` | validating unsafe patientId to protected PatientId | stable | Result, audit, protected, record, unsafe |
| `156-validate-nhs-number` | validating unsafe nhsNumber to protected NhsNumber | stable | Result, audit, protected, redacted, unsafe |
| `157-invalid-email-assignment` | assigning String directly to protected Email is forbidden `FUNGI-TYPE-003` | stable | protected |
| `158-redact-email` | redact() converts protected Email to redacted Email | stable | protected, redacted |
| `159-redact-patient-id` | redact() converts protected PatientId to redacted PatientId | stable | protected, redacted |
| `160-protected-not-redacted` | protected value cannot be directly assigned to redacted binding `FUNGI-TYPE-002` | draft | protected, redacted |
| `161-safe-audit-log` | safe audit log write with redacted value | stable | audit, protected, redacted |
| `162-invalid-audit-log` | unsafe value reaches audit sink without validation `FUNGI-VALUESTATE-003` | stable | audit, unsafe |
| `163-unsafe-audit-log` | passing unsafe value to audit sink `FUNGI-VALUESTATE-003` | stable | audit, unsafe |
| `164-safe-database-write` | protected value is safe to write to database | stable | Result, protected, record, unsafe |
| `165-unsafe-database-write` | unsafe value cannot be written to a database sink `FUNGI-VALUESTATE-003` | stable | unsafe |
| `166-safe-network-send` | protected value may be sent over network (policy dependent) | stable | Result, protected |
| `167-unsafe-network-send` | unsafe value crossing a trust boundary via network `FUNGI-VALUESTATE-003` | stable | unsafe |
| `168-redacted-network-send` | redacted value is safe to send to audit endpoints | stable | Result, audit, protected, redacted |
| `169-secret-comparison` | direct equality comparison on secrets is forbidden `FUNGI-SECRET-002` | stable | flow |
| `170-constant-time-comparison` | constantTimeEquals for safe secret comparison | stable | flow, for |
| `171-protected-console-log` | secret value sent to console sink is forbidden `FUNGI-SECRET-001` | stable | flow |
| `172-secret-console-log` | secret value sent to console sink is forbidden `FUNGI-SECRET-001` | stable | flow |
| `173-validation-chain` | complete canonical trust flow chain | stable | Result, audit, protected, redacted, unsafe |
| `174-multiple-protected-values` | multiple protected values all validated and redacted in audit | stable | Result, audit, protected, record, redacted, unsafe |
| `175-security-summary-example` | comprehensive security example showing all patterns | stable | Result, audit, protected, redacted, unsafe |
| `176-sql-injection-concat` | string taint propagation (SQL injection pattern) `FUNGI-VALUESTATE-004` | stable | Result, unsafe |
| `177-secret-serialization` | SecureString serialization denied `FUNGI-SECRET-003` | draft | Result |

## Level 5 — Governance

Governance — intent, policy, authority, contract blocks (errors, context, timeouts, retries, limits, privacy, observability, events), contract sets.

**26 examples** — 22 stable, 4 draft

| ID | Concept | Status | Key Features |
|---|---|---|---|
| `201-intent-basic` | intent declaration on a guarded flow | stable | Result |
| `202-secure-intent-boundary` | secure flow with full intent declaration | stable | Result, audit, protected, record, redacted, unsafe |
| `203-intent-mismatch-invalid` | intent mismatch when flow behaviour contradicts declared intent `FUNGI-INTENT-001` | draft | Result, events, protected |
| `204-remote-execution-denied` | compute target with remote.execution denied | stable | Result, audit |
| `205-remote-execution-violation` | compute target remote violates governance policy `FUNGI-GOV-004` | draft | Result, audit |
| `206-protected-data-sharing-authority` | authority block for sharing protected data externally | stable | Result, audit, protected |
| `207-protected-data-sharing-missing-authority` | sending protected data externally without authority block `FUNGI-GOV-003` | draft | Result, audit, protected |
| `208-audit-proof-required` | delete flow with full audit evidence | stable | Result, audit, protected, record, redacted |
| `209-audit-proof-missing` | intent requires audit but no audit.write sink used `FUNGI-GOV-002` | stable | Result, audit, protected, record |
| `210-governed-execution-plan` | full governed execution plan for a ML inference flow | stable | Result, audit |
| `211-policy-block-allows-purpose` | policy block declaring allowed purpose for data sharing | stable | Result, audit, protected |
| `212-policy-purpose-mismatch` | declared purpose does not match observed template use `FUNGI-GOV-005` | draft | Result, audit, match, protected |
| `213-governance-summary-example` | comprehensive governance example showing all patterns | stable | Result, audit, protected, record, redacted, unsafe |
| `214-contract-secure-flow` | flow contract on secure flow with governance intent | stable | Result, audit, events, protected, record, unsafe |
| `215-contract-set` | reusable contract set applied to a flow | stable | Result, Set, audit, events, protected, record |
| `216-event-declaration` | global event declaration + flow emission + FUNGI-EVENT-001 `FUNGI-EVENT-001` | stable | Result, audit, events, record |
| `217-contract-set-validation` | contract set use resolution — FUNGI-GOV-011 and FUNGI-GOV-012 `FUNGI-GOV-011` | stable | Result, Set, audit, protected, record, unsafe |
| `218-errors-contract` | contract errors block — returns, map, expose, redact, audit | stable | Map, Result, audit, errors, record |
| `219-response-denies` | contract response.denies — FUNGI-GOV-003 `FUNGI-GOV-003` | stable | Result, audit, protected |
| `220-context-required` | contract context block — require actor, require trace_id, correct usage | stable | Result, audit |
| `221-timeouts-retries` | contract timeouts and retries blocks | stable | Result, audit, errors, record, retries, timeouts |
| `222-limits-privacy` | contract limits and privacy blocks | stable | Result, audit, errors, limits, privacy, protected |
| `223-observability` | contract observability block — trace, measure, count, deny patterns | stable | Result, audit, errors, observability, protected, record |
| `224-contract-best-practices` | gold standard contract — named result type, full contract, raw->protected->redact->audit | stable | Result, audit, errors, events, observability, privacy |
| `225-context-missing` | FUNGI-CONTEXT-001 — context require actor declared but never accessed `FUNGI-CONTEXT-001` | stable | Result, audit |
| `226-full-16-section-minimal` | all 16 contract sections in canonical order — minimal but complete template | stable | Result, audit, errors, events, limits, observability |

## Level 6 — Compute

Compute and numeric — compute targets, tensor types, Money arithmetic, Decimal precision, statistics.

**20 examples** — 20 stable, 0 draft

| ID | Concept | Status | Key Features |
|---|---|---|---|
| `301-compute-target-best` | compute target selection with ordered preference and fallback | stable | Tensor |
| `302-compute-deny-remote` | denying remote execution in a secure credit-scoring flow | stable | Result, Tensor, audit, protected, unsafe |
| `303-compute-gpu-explicit` | explicit GPU targeting with CPU fallback | stable | Tensor |
| `304-tensor-basic` | tensor shape encoded in the type signature | stable | Tensor |
| `305-tensor-dynamic-shape` | dynamic shape tensor for variable-length inference | stable | Result, Tensor |
| `306-tensor-arity-invalid` | Tensor requires exactly two type parameters: element type and shape `FUNGI-TYPE-009` | stable | Tensor |
| `307-vector-type` | fixed-length vector type for embeddings | stable | flow, for |
| `308-matrix-type` | matrix type for weight tensors | stable | flow, for |
| `309-compute-photonic` | photonic compute target with classical fallback chain | stable | Result, Tensor |
| `310-compute-fallback-required` | mandatory fallback declaration when targeting npu or gpu | stable | Result, Tensor, audit |
| `311-money-vat-calculation` | multiplying Money by a Decimal rate | stable | Money |
| `312-money-invalid-cross-currency` | adding Money values of different currencies is a type error `FUNGI-TYPE-004` | stable | Money |
| `313-decimal-precision` | dividing Money by a Decimal value for precise splitting | stable | Money |
| `314-compute-npu-ai-inference` | full AI text classification flow with NPU targeting and governance | stable | Result, Tensor |
| `315-compute-summary` | complete governed AI inference flow with audit, hardware targeting, and deny clause | stable | Result, Tensor, audit |
| `316-invalid-tensor-add` | Tensor arithmetic requires shape compatibility `FUNGI-TYPE-004` | stable | Tensor |
| `317-money-cross-currency-compute` | Cross-currency arithmetic is denied `FUNGI-TYPE-004` | stable | Money |
| `318-compute-hint-missing` | ai.inference without compute target preference `FUNGI-HINT-COMPUTE-001` | stable | Result |
| `319-money-times-decimal` | Money<C> * Decimal is valid scaling | stable | Money |
| `320-statistics-stdlib` | pure statistical computation using Array.reduce and map | stable | Array, Map, fn |

## Level 7 — AI

AI integration — ai.inference effect, embedding flows, batch inference, governed AI patterns, signed attestation.

**20 examples** — 12 stable, 8 draft

| ID | Concept | Status | Key Features |
|---|---|---|---|
| `351-embedding-flow` | basic AI embedding flow returning a typed tensor | stable | Result, Tensor |
| `352-ai-inference-effect` | calling an AI model without declaring the required ai.inference effect `FUNGI-EFFECT-001` | draft | Result |
| `353-protected-ai-input` | protected PII validated and passed through an AI risk model with redacted audit | stable | Result, audit, protected, redacted, unsafe |
| `354-ai-batch-inference` | batch AI inference over an array of inputs | draft | Array, Result |
| `355-ai-governance-denied-remote` | AI inference with remote execution denied for patient data governance | stable | Result |
| `356-ai-missing-audit` | secure AI flow that declares audit.write but omits the AuditLog.write call `FUNGI-GOV-002` | draft | Result, audit |
| `357-tensor-model-input-output` | shape-typed model input and output tensors using a batch dimension | stable | Result, Tensor, while |
| `358-ai-secure-string-in-ai` | passing a SecureString to an AI model is a secret-exposure error `FUNGI-SECRET-001` | draft | Result |
| `359-embedding-with-fallback` | embedding flow with NPU/GPU preference and CPU fallback | stable | Result, Tensor |
| `360-ai-audit-redacted` | protected patient data redacted in AI audit log entry | stable | Result, audit, protected, redacted, unsafe |
| `361-ai-any-tensor` | AnyTensor for dynamically loaded models with unknown shape | stable | Result |
| `362-ai-invalid-tensor-arity` | Tensor type with missing shape argument raises FUNGI-TYPE-009 `FUNGI-TYPE-009` | stable | Result, Tensor |
| `363-local-model-only` | local-only AI classification denying both remote execution and network outbound | draft | Result, unsafe |
| `364-ai-effect-propagation` | a pure flow calling an ai.inference flow inherits that effect and must declare it `FUNGI-EFFECT-002` | draft | and, effects, flow |
| `365-ai-summary-flow` | complete AI governance pattern — healthcare risk scoring with PII, audit, and compute governance | stable | Result, Tensor, audit, protected, unsafe |
| `366-ai-unsafe-input-to-model` | Unsafe input cannot flow directly to AI model `FUNGI-VALUESTATE-003` | draft | Result, unsafe |
| `367-ai-inference-without-effect` | ai.inference effect must be declared `FUNGI-EFFECT-001` | draft | flow |
| `368-contract-ai-flow` | flow contract with AI intent for IGO optimisation `FUNGI-HINT-COMPUTE-001` | stable | Result, events |
| `368-signed-attestation` | flow contract with audit requirement for signed attestation | stable | Result, audit, events |
| `369-ai-classification-flow` | full AI classify flow — ClassifierModel, compute target, protected input, redacted audit | stable | Result, audit, events, observability, privacy, protected |

## Level 8 — Targets

Compute targets — cpu, gpu, npu, wasm, photonic, quantum, adaptive/deterministic runtime, deny clauses.

**16 examples** — 15 stable, 1 draft

| ID | Concept | Status | Key Features |
|---|---|---|---|
| `401-target-cpu` | explicit CPU compute target | stable | Result, Tensor |
| `402-target-gpu` | explicit GPU compute target with CPU fallback | stable | Result, Tensor |
| `403-target-npu` | explicit NPU compute target with GPU fallback | stable | Result, Tensor |
| `404-target-wasm` | WebAssembly compute target for browser or sandboxed execution | stable | Tensor |
| `405-target-photonic` | photonic (optical) compute target with GPU fallback | stable | Result, Tensor |
| `406-target-quantum` | quantum compute target with classical CPU fallback | stable | Result, Tensor |
| `407-target-best-prefer` | compute target best with ordered preference list and fallback | stable | Result, Tensor |
| `408-target-deny-remote` | denying remote.execution placement category | stable | Result, Tensor |
| `409-target-deny-list` | multiple denied target categories in a single deny clause | stable | Result, Tensor |
| `410-adaptive-runtime` | adaptive runtime block that learns from workload to optimise batching and warmup | stable | Result, Tensor, while |
| `411-deterministic-runtime` | deterministic runtime for regulated environments requiring identical execution planning | stable | Result, Tensor, audit |
| `412-target-photonic-with-fallback` | photonic preference with full classical fallback chain | stable | Result, Tensor |
| `413-target-quantum-simulation` | quantum preference with GPU simulation and CPU fallback | stable | Result, Tensor |
| `414-target-no-fallback-invalid` | omitting the fallback clause from a non-cpu compute target is an error `FUNGI-TARGET-001` | draft | Result, Tensor |
| `415-target-summary` | complete compute target governance — prefer, deny, fallback, adaptive runtime, and audit | stable | Result, Tensor, audit, unsafe |
| `416-target-fallback-missing` | compute target without fallback `FUNGI-HINT-COMPUTE-001` | stable | Tensor |

## Level 9 — Enterprise

Enterprise patterns — healthcare PII, financial payments, compliance effects, full 16-section contracts, supply chain.

**22 examples** — 12 stable, 10 draft

| ID | Concept | Status | Key Features |
|---|---|---|---|
| `451-healthcare-patient-create` | healthcare PII governance pattern — create patient record with NHS number, protected types, and audit | stable | Result, audit, protected, record, unsafe |
| `452-healthcare-invalid-pii-log` | passing a protected PatientId directly to a log call without redaction `FUNGI-SECRET-001` | draft | Result, audit, protected, record, unsafe |
| `453-financial-payment-charge` | payment governance flow with approved merchant, Money type, and audit | stable | Money, Result, audit, protected |
| `454-financial-cross-currency-invalid` | adding Money<GBP> and Money<USD> without currency conversion is a type error `FUNGI-TYPE-004` | stable | Money |
| `455-financial-money-calculation` | financial tax calculation using Money and Decimal | stable | Money |
| `456-compliance-pii-effect` | accessing PII without declaring the pii.read effect `FUNGI-PII-001` | draft | Result, protected, record, unsafe |
| `457-compliance-phi-effect` | handling HIPAA PHI without declaring the phi.read effect `FUNGI-PHI-001` | draft | Result, protected, record, unsafe |
| `458-compliance-audit-required` | secure flow that declares audit.write but never calls AuditLog.write `FUNGI-AUDIT-001` | draft | Result, audit, protected, record, unsafe |
| `459-multi-protected-values` | multiple PII types in one flow — all validated as protected and all redacted in audit | stable | Result, audit, protected, redacted, unsafe |
| `460-authority-data-sharing` | authority block authorises sharing protected PatientData with an external service | stable | Result, audit, protected, unsafe |
| `461-authority-missing` | sharing protected data across a trust boundary without an authority block `FUNGI-GOV-003` | draft | Result, audit, protected, unsafe |
| `462-policy-purpose` | policy block declares the permitted purpose for data use in a communication flow | stable | Result, audit, protected, unsafe |
| `463-policy-mismatch` | declared purpose does not match the template used in the flow body `FUNGI-GOV-005` | draft | Result, audit, match, protected, unsafe |
| `464-enterprise-supply-chain` | flow requiring a module capability that has not been accepted in the supply-chain manifest `FUNGI-MODULE-005` | draft | Result, audit |
| `465-enterprise-summary` | complete enterprise-grade healthcare flow — patient create with PII, NHS number, AI risk scoring, audit, and governance proof | stable | Result, Tensor, audit, protected, record, unsafe |
| `466-pii-without-pii-effect` | PII access requires pii.read effect `FUNGI-PII-001` | draft | Result |
| `467-protected-response-body` | Protected value in response body requires policy `FUNGI-GOV-003` | draft | Result, protected |
| `468-full-contract-model` | full contract model — all 16 sections in canonical order | stable | Result, audit, errors, events, limits, observability |
| `469-contract-financial-payment` | full 16-section contract on a financial payment flow — all sections in canonical order | stable | Money, Result, audit, errors, events, limits |
| `470-contract-healthcare-search` | healthcare patient search with complete privacy, observability, errors, and context contract sections | draft | Result, audit, errors, events, limits, observability |
| `471-medical-medication-check` | medical domain — record types Patient and Medication, interaction validation pattern | stable | Result, audit, errors, events, observability, privacy |
| `472-physics-simulation` | scientific domain — Mass, Force, Energy domain record types, pure kinetic energy calculation | stable | record |

## Proposed — Readable Logic Forms

Proposed readable operator aliases — equality, comparison, boolean, unless, governance.

**5 examples** — 5 stable, 0 draft

| ID | Concept | Status | Key Features |
|---|---|---|---|
| `010-readable-equality` | readable equality alias | stable | — |
| `011-readable-comparison` | readable numeric comparison alias | stable | — |
| `020-readable-boolean` | readable boolean operators | stable | and, or |
| `030-readable-unless` | unless as if-not alias | stable | unless |
| `040-governance-readable` | readable forms in governance conditions | stable | Money, Result, audit |

---

## Summary by Level

| Level | Name | Total | Stable | Draft |
|---|---|---|---|---|
| 1 | Basics | 23 | 19 | 4 |
| 2 | Types | 43 | 40 | 3 |
| 3 | Effects | 20 | 18 | 2 |
| 4 | Security | 27 | 25 | 2 |
| 5 | Governance | 26 | 22 | 4 |
| 6 | Compute | 20 | 20 | 0 |
| 7 | AI | 20 | 12 | 8 |
| 8 | Targets | 16 | 15 | 1 |
| 9 | Enterprise | 22 | 12 | 10 |
| P | Readable Logic Forms | 5 | 5 | 0 |
| **—** | **Total** | **222** | **188** | **34** |

---

*Machine-readable data: [`examples.manifest.json`](examples.manifest.json)*


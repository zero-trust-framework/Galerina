// =============================================================================
// galerina-core-compiler — compiler pipeline contracts
//
// Package: @galerina/core-compiler
// Role:    Parsing, checking, diagnostics, and IR contracts for the
//          Galerina compiler pipeline.
//
// Phase 3: scanner-level safety rules (validateCoreSyntaxSafety)
// Phase 4: lexer + parser (lex, parseProgram)
// Phase 5: effect checker (checkEffects, checkFlowEffects)
// =============================================================================

// Phase 4 — Lexer
export {
  lex,
  V1_ACTIVE_KEYWORDS,
  V1_FUTURE_RESERVED,
  V1_DEPRECATED_RESERVED,
  TokenKindId,
  type Token,
  type TokenKind,
  type TokenKindIdValue,
  type LexResult,
  type LexerDiagnostic,
} from "./lexer.js";

/** FUNGI-LEX-001: Generic type nesting exceeds maximum depth (8 levels). */
export const FUNGI_LEX_001 = {
  code: "FUNGI-LEX-001",
  name: "ExcessiveNesting",
  severity: "error" as const,
  message: "Generic type nesting exceeds maximum depth (8 levels). Simplify the type.",
  suggestedFix: "Use a type alias to break up deeply nested generics.",
} as const;

/** FUNGI-LEX-002: String literal or identifier exceeds maximum length (10,000 characters). */
export const FUNGI_LEX_002 = {
  code: "FUNGI-LEX-002",
  name: "OversizedToken",
  severity: "error" as const,
  message: "String literal or identifier exceeds maximum length (10,000 characters).",
  suggestedFix: "Split large string literals or shorten identifier names.",
} as const;

/** FUNGI-LEX-003: Invalid unicode escape sequence in string literal. */
export const FUNGI_LEX_003 = {
  code: "FUNGI-LEX-003",
  name: "InvalidUnicodeEscape",
  severity: "error" as const,
  message: "Invalid unicode escape sequence in string literal.",
  suggestedFix: "Use \\u{XXXXXX} with 1-6 hex digits, or \\uXXXX with exactly 4.",
} as const;

/** FUNGI-LEX-004: Source file exceeds the 10 MB maximum. */
export const FUNGI_LEX_004 = {
  code: "FUNGI-LEX-004",
  name: "FileTooLarge",
  severity: "error" as const,
  message: "File exceeds maximum size (10MB). Split into smaller files.",
} as const;

/** FUNGI-LEX-005: A single line exceeds 10,000 characters. */
export const FUNGI_LEX_005 = {
  code: "FUNGI-LEX-005",
  name: "LineTooLong",
  severity: "warning" as const,
  message: "Line exceeds maximum length (10,000 characters).",
} as const;

/** FUNGI-LEX-006: Lexer emitted too many diagnostics; further errors suppressed. */
export const FUNGI_LEX_006 = {
  code: "FUNGI-LEX-006",
  name: "TooManyDiagnostics",
  severity: "error" as const,
  message: "Lexer emitted the maximum number of diagnostics (100). Further errors suppressed. Fix the first errors and re-compile.",
  why: "Emitting thousands of cascading diagnostics from a single malformed file wastes resources and obscures the root cause.",
  suggestedFix: "Fix the first reported errors — cascading errors usually disappear once the root cause is resolved.",
} as const;

// Phase 4 — Parser
export {
  parseProgram,
  NodeFlags,
  type NodeFlagsMask,
  type AstNode,
  type AstNodeKind,
  type ParseResult,
  type ParseDiagnostic,
  type FlowMeta,
  type SourceLocation as ParserSourceLocation,
} from "./parser.js";

// Phase 5 / 18E / 18H / 19A — Effect Checker
export {
  checkEffects,
  checkFlowEffects,
  checkStdlibEffects,
  effectResultsToDiagnostics,
  EFFECT_REGISTRY,
  LEGACY_EFFECT_CALL_PATTERNS_COUNT,
  inferEffectsForOperation,
  inferDirectEffectsForFlow,
  buildModuleAliasMap,
  buildFlowEffectSummary,
  type EffectCheckResult,
  type EffectDiagnostic,
  type FlowEffectSummary,
  type EffectCheckerMode,
} from "./effect-checker.js";

// ── AI-code-gen referee: the machine-consumable structural leak proof (fungi.leakproof.v1) ──
// Normalizes the compiler's governance diagnostics into one stable schema an autonomous LLM writer can
// read to self-patch the exact capability leak. Fail-closed (any deny → module verdict 'leak'); signable.
export { buildLeakProof, canonicalLeakProof } from "./leak-proof.js";
export type { CapabilityLeakProof, LeakFinding, LeakCategory, LeakFix, CodeAnchor } from "./leak-proof.js";
// RD-0128 (note 67): signable TestWitness receipt binding a wasm artifact to its leak proof + test-suite digest.
export { buildTestWitness, testSuiteDigest, canonicalTestWitness, testWitnessDigest, witnessVouchesClean } from "./leak-proof.js";
export type { TestWitness } from "./leak-proof.js";

// Execution Graph Kernel — ProofGraph, ExecutionSignature, GraphFingerprint
// Phase 26B: ImmutableInputSeal, HardwareSealedDispatch, FUNGI-HW-001/002/003
// Phase 40: EpilogueReceipt, generateEpilogueReceipt
export {
  computeExecutionSignature,
  executionSignatureHash,
  buildProofGraph,
  makeManifestEnvelope,
  buildProofGraphCached,
  getProofCacheStats,
  clearProofCache,
  sharesGovernanceShape,
  diffFingerprints,
  generateROIReport,
  signProofGraph,
  signProofGraphHybrid,
  verifyGovernanceSignature,
  verifyGovernanceSignatureHybrid,
  generateGovernanceKeyPair,
  generateHybridGovernanceKeyPair,
  generateEpilogueReceipt,
  type GovernanceAlgorithm,
} from "./proof-graph.js";
// #56 (galerina fix --write): the safe single-line edit applier + re-check-gated auto-fix orchestration.
export { applyFixEdits, computeAutoFix } from "./fix-edit.js";
export type { FixEdit, ApplyFixEditsResult, AutoFixOutcome } from "./fix-edit.js";
// #49 production hybrid (Ed25519+ML-DSA-65) verifier for the fuse loader's injected hybridVerifier seam.
export { makeLmanifestHybridVerifier } from "./lmanifest-hybrid-verifier.js";
export type { LmanifestHybridVerdict, LmanifestHybridVerifierInput } from "./lmanifest-hybrid-verifier.js";
export {
  FUNGI_HW_001,
  FUNGI_HW_002,
  FUNGI_HW_003,
  type ExecutionSignature,
  type ProofGraph,
  type ProofObligation,
  type ProofObligationKind,
  type ProofEvidence,
  type GraphFingerprint,
  type GovernanceROIReport,
  type ImmutableInputSeal,
  type HardwareSealedDispatch,
  type GovernanceKeyPair,
  type EpilogueReceipt,
  type EpilogueProofStrategy,
  type EpilogueFailureAction,
} from "./proof-graph.js";

// Phase 18D / 18E / 18F / Hybrid WASM — Type Registry
export {
  TypeId,
  EffectFlags,
  EffectCheckerFlags,
  HardwareGovernanceClass,
  HardwareObservabilityLevel,
  HardwareObservability,
  ProofLevel,
  HARDWARE_GOVERNANCE_CLASS_MAP,
  HARDWARE_TRUST_PROFILES,
  type HardwareGovernanceClassId,
  type HardwareObservabilityLevelId,
  type ProofLevelId,
  type HardwareTrustProfile,
  GovernanceFlags,
  ComputeCompatibilityFlags,
  NativeCapabilityId,
  EFFECT_TO_NATIVE_CAPABILITY,
  effectsToFlags,
  effectsSubset,
  resolveTypeId,
  parseTensorType,
  tensorElementTypesCompatible,
  tensorDimensionCountsCompatible,
  TYPE_NAME_TO_ID,
  DEFAULT_WAT_ASSEMBLER_CONFIG,
  type TypeIdValue,
  type EffectFlagsMask,
  type EffectCheckerFlagsMask,
  type GovernanceFlagsMask,
  type ComputeCompatibilityFlagsMask,
  type TensorTypeInfo,
  type RuntimeManifest,
  type NativeCapabilityIdValue,
  type WATAssemblerConfig,
  type NativePluginManifest,
} from "./type-registry.js";

// Phase 6 / 18C — Value-State Checker
export {
  checkValueStates,
  ValueStateFlags,
  SINK_REQUIREMENTS,
  getSinkRequirement,
  type ValueStateDiagnostic,
  type ValueStateCheckResult,
  type ValueStateFlagsMask,
  type SinkRequirement,
} from "./value-state-checker.js";

// ---------------------------------------------------------------------------
// Gate diagnostics — FUNGI-GATE-001
//
// Reserved for Phase 19 @gate annotation enforcement.
// When a flow is annotated @gate, callers must use error propagation (?)
// and the result must transition the binding from unsafe to safe.
// ---------------------------------------------------------------------------

/** FUNGI-GATE-001: @gate-annotated flow called without required error propagation or state transition. */
export const FUNGI_GATE_001 = {
  code: "FUNGI-GATE-001",
  name: "GateAnnotationRequired",
  severity: "error" as const,
  message: "This flow is annotated @gate. Callers must use error propagation (?) and assign the result to a 'safe mut' binding.",
  why: "@gate flows are the only way to transition data from unsafe to safe. Without the ? operator, errors are silently ignored and the transition is not proven.",
  suggestedFix: "Change the call to: safe mut name = gateFn(value)?",
} as const;

/** FUNGI-VALUESTATE-005: A value derived from an unsafe binding reached a governed sink. */
export const FUNGI_VALUESTATE_005 = {
  code: "FUNGI-VALUESTATE-005",
  name: "DERIVED_UNSAFE_VALUE_AT_SINK",
  severity: "error" as const,
  message: "A value derived from an unsafe binding reached a governed sink. Even after transformation (e.g. .trim()), a value derived from unsafe input is still tainted.",
  why: "SQL injection and similar attacks pass through string methods like .trim(), .replace(), and .toLowerCase().",
  suggestedFix: "Use a validation gate (validate.*, sanitize.*) to transform the unsafe value into a safe/validated type.",
};

// Phase 6 — Type Checker
export {
  checkTypes,
  type TypeDiagnostic,
  type TypeCheckResult,
} from "./type-checker.js";

/** FUNGI-TYPE-003: raw String assigned to a branded type (Brand<T,"Name"> alias) without a validation gate. */
export const FUNGI_TYPE_003 = {
  code: "FUNGI-TYPE-003",
  name: "InvalidNominalConversion",
  severity: "error",
  message:
    "Branded types (type X = Brand<T, \"Name\">) cannot be assigned a raw String value. "
    + "Use a validation gate such as validate.x(raw)? to produce a trusted branded value.",
} as const;

// FUNGI-TYPE-010..019 — per formal-type-system-spec.md canonical mapping
export const FUNGI_TYPE_010 = { code: "FUNGI-TYPE-010", name: "UnsatisfiedGenericConstraint", severity: "error", message: "Type does not satisfy the required generic constraint." } as const;
export const FUNGI_TYPE_011 = { code: "FUNGI-TYPE-011", name: "InvalidCollectionElement", severity: "error", message: "Collection element type does not match the declared element type." } as const;
export const FUNGI_TYPE_012 = { code: "FUNGI-TYPE-012", name: "InvalidResultType", severity: "error", message: "Ok/Err branch type does not match the declared Result<T,E> type." } as const;
export const FUNGI_TYPE_013 = { code: "FUNGI-TYPE-013", name: "InvalidSecretOperation", severity: "error", message: "Protected secret value cannot use this operator. Use constantTimeEquals() for equality." } as const;
export const FUNGI_TYPE_014 = { code: "FUNGI-TYPE-014", name: "MissingRequiredEffect", severity: "error", message: "Calling this function requires an effect that the current flow does not declare." } as const;
export const FUNGI_TYPE_015 = { code: "FUNGI-TYPE-015", name: "GovernedSinkViolation", severity: "error", message: "Governed sink requires a safe/validated binding; received an unsafe binding." } as const;
export const FUNGI_TYPE_016 = { code: "FUNGI-TYPE-016", name: "TensorShapeMismatch", severity: "error", message: "Tensor shapes are incompatible for this operation." } as const;
export const FUNGI_TYPE_017 = { code: "FUNGI-TYPE-017", name: "QuantizedPrecisionMismatch", severity: "warning", message: "Cannot mix quantized (Int8) and floating-point (Float32) without explicit dequantize(). General numeric narrowing is FUNGI-TYPE-002." } as const;
export const FUNGI_TYPE_018 = { code: "FUNGI-TYPE-018", name: "InvalidRuntimeTargetType", severity: "error", message: "This type cannot exist in the selected compute target." } as const;
export const FUNGI_TYPE_019 = { code: "FUNGI-TYPE-019", name: "UnknownSymbol", severity: "error", message: "Symbol is not defined in the current scope." } as const;

// FUNGI-TYPE-030/031 — Tensor element type and dimension checking (Phase 18D)

/** FUNGI-TYPE-030: Tensor operations received mismatched element types. */
export const FUNGI_TYPE_030 = {
  code: "FUNGI-TYPE-030",
  name: "TensorElementTypeMismatch",
  severity: "error" as const,
  message: "Tensor element types do not match. Float32 and Int8 tensors cannot be combined without explicit conversion.",
  why: "Mixed-precision tensor operations produce undefined results on GPU/NPU targets. All tensors in an operation must share the same element type, or use explicit quantize()/dequantize().",
  suggestedFix: "Use dequantize() to convert Int8 to Float32 before the operation, or quantize() to convert Float32 to Int8.",
} as const;

/** FUNGI-TYPE-031: Tensor operations received incompatible dimension counts. */
export const FUNGI_TYPE_031 = {
  code: "FUNGI-TYPE-031",
  name: "TensorDimensionMismatch",
  severity: "error" as const,
  message: "Tensor dimension counts do not match. [768] (rank 1) cannot be used where [Batch, 768] (rank 2) is expected.",
  why: "Rank mismatch causes silent shape errors in tensor operations. NPU/GPU kernels require matching rank at compile time.",
  suggestedFix: "Use Tensor.unsqueeze() to add a batch dimension, or Tensor.squeeze() to remove one.",
} as const;

/** FUNGI-VALUESTATE-006: A protected value was assigned to a plain (unprotected) binding. */
export const FUNGI_VALUESTATE_006 = {
  code: "FUNGI-VALUESTATE-006",
  name: "ProtectedBoundaryViolation",
  severity: "error" as const,
  message: "A protected value is used where the plain (unprotected) type is required. Declare the binding as 'protected X', or pass through an authorised access gate.",
} as const;

/** FUNGI-VALUESTATE-007: A redacted value cannot convert back to its original type. */
export const FUNGI_VALUESTATE_007 = {
  code: "FUNGI-VALUESTATE-007",
  name: "RedactedBoundaryViolation",
  severity: "error" as const,
  message: "A redacted value cannot be converted back to its original type. Redaction is irreversible.",
} as const;

export {
  resolveSymbols,
  ModuleExportRegistry,
  type SymbolDiagnostic,
  type SymbolResolveResult,
  type SymbolTable,
  type ExportedSymbol,
  type ExportKind,
} from "./symbol-resolver.js";

/** FUNGI-NAME-003: Local binding shadows a built-in domain type. */
export const FUNGI_NAME_003 = {
  code: "FUNGI-NAME-003",
  name: "CrossModuleShadow",
  severity: "warning",
  message: "Local binding shadows a built-in domain type. Rename to avoid confusion.",
} as const;

// Phase 11E — Import Resolver
export {
  resolveImports,
  type ImportedSymbol,
  type ImportResolveResult,
} from "./import-resolver.js";

// Phase R3 — Package Type Registry
export {
  KNOWN_PACKAGE_TYPES,
  KNOWN_DOMAIN_TYPES,
  resolveImportedTypes,
  loadManifestTypes,
} from "./package-type-registry.js";

// Phase 17A / 18B — Package Manifest Resolver
export {
  loadPackageManifest,
  resolvePackageTypes,
  checkPackageCapabilityExpansion,
  checkInstallScript,
  checkPackageProvenance,
  checkRegistryTrust,
  getResolverReport,
  type PackageManifest,
  type PackageTargets,
  type PackageCompute,
  type PackageResolverDiagnostic,
  type CapabilityExpansionResult,
  type ResolverReport,
  type ResolvedPackageEntry,
} from "./package-resolver.js";

// CycloneDX SBOM emitter (R&D 0120-F3) — fail-closed on missing integrity (FUNGI-SBOM-001).
export { generateCycloneDxSbom } from "./sbom.js";
export type { SbomResult, SbomDiagnostic, SbomOptions } from "./sbom.js";

// ---------------------------------------------------------------------------
// Package resolver diagnostics — FUNGI-PKG-001..005
// ---------------------------------------------------------------------------

/** FUNGI-PKG-001: Package declares capabilities not present in the lockfile snapshot. */
export const FUNGI_PKG_001 = {
  code: "FUNGI-PKG-001",
  name: "CapabilityExpanded",
  severity: "error" as const,
  message: "Package declares new capabilities not present in the lockfile. This is a breaking security change — review and re-approve.",
  why: "Hidden capability expansion is a supply-chain attack vector. Any new capability must be explicitly reviewed before the lockfile is updated.",
  suggestedFix: "Run 'galerina package audit' to review the new capability declarations, then update the lockfile after explicit approval.",
} as const;

/** FUNGI-PKG-002: Package comes from an unregistered or unverified registry. */
export const FUNGI_PKG_002 = {
  code: "FUNGI-PKG-002",
  name: "UntrustedRegistry",
  severity: "error" as const,
  message: "Package comes from an unregistered or unverified registry. Galerina requires all packages to come from a declared trusted registry.",
  why: "Dependency confusion attacks inject malicious packages via unofficial registries.",
  suggestedFix: "Add the registry to the project's trusted registry list, or switch to a verified source.",
} as const;

/** FUNGI-PKG-003: Package manifest has no content-addressable hash. */
export const FUNGI_PKG_003 = {
  code: "FUNGI-PKG-003",
  name: "MissingHash",
  severity: "warning" as const,
  message: "Package has no content-addressable hash. Without a hash, tamper detection and reproducible builds are not possible.",
  why: "A package without a hash can be silently replaced with a different version.",
  suggestedFix: "Add 'hash: sha256:<hex>' to the package manifest. Run 'galerina package hash' to generate it.",
} as const;

/** FUNGI-PKG-004: Package declares or attempts an install script; default policy denies. */
export const FUNGI_PKG_004 = {
  code: "FUNGI-PKG-004",
  name: "InstallScriptDenied",
  severity: "error" as const,
  message: "Package attempts to declare an install script. Galerina denies install scripts by default.",
  why: "Install scripts execute arbitrary code during package resolution — a major supply-chain attack surface.",
  suggestedFix: "Remove the installScript declaration. If absolutely necessary, configure an explicit resolver policy with signature verification.",
} as const;

/** FUNGI-PKG-005: Package has no signature; origin cannot be cryptographically verified. */
export const FUNGI_PKG_005 = {
  code: "FUNGI-PKG-005",
  name: "MissingSignature",
  severity: "warning" as const,
  message: "Package has no signature. Origin cannot be cryptographically verified.",
  why: "An unsigned package cannot prove it came from the claimed publisher. It could be a substituted or tampered build.",
  suggestedFix: "Sign the package with 'galerina package sign' and add 'signature:' to the manifest.",
} as const;

/** FUNGI-PKG-006: Package is signed by a REVOKED key; trusted origin cannot be established. */
export const FUNGI_PKG_006 = {
  code: "FUNGI-PKG-006",
  name: "RevokedSigner",
  severity: "error" as const,
  message: "Package is signed by a revoked key. A revoked signing key cannot establish trusted origin.",
  why: "Revocation is the supply-chain kill switch: a leaked or compromised signing key keeps producing cryptographically valid signatures, so the gate must refuse a revoked signer even when the signature verifies — at resolution as well as admission.",
  suggestedFix: "Re-sign the package with a current, non-revoked key and update 'signerKeyId:' in the manifest.",
} as const;

// Phase 17A — Naming Policy Checker
export {
  checkNamingPolicy,
  FUNGI_STYLE_001,
  FUNGI_STYLE_002,
  FUNGI_STYLE_SEC_001,
  type NamingPolicyDiagnostic,
  type NamingPolicyResult,
  type NamingPolicyConfig,
} from "./naming-policy-checker.js";

// Pass 8 - GIR Emitter
export {
  emitGIR,
  emitExpr,
  buildSemanticGraph,
  buildAiGraph,
  buildExecutionPlan,
  EFFECT_TO_CAPABILITY,
  type GIRFlow,
  type GIRProgram,
  type GIREmitResult,
  type GIRExpr,
  type GIRRecordField,
  type GalerinaAiGraph,
  type AiGraphFlow,
  type AiGraphParameter,
  type AiGraphEvent,
  type AiGraphContract,
  type AiGraphDiagnostic,
  type AiGraphGovernance,
  type AiGraphSourceSpan,
  type PassiveExecutionPlan,
} from "./gir-emitter.js";
// R&D 0016 - Contract-driven test generation (fault-injection + effect-egress dimensions)
export {
  generateFaultInjectionTests,
  generateFaultInjectionSuite,
  generateEffectEgressTests,
  generateCapabilityDenialTests,
  generateBoundaryTests,
  generateSubstrateViolationTests,
  generateContractTestSuite,
  renderFaultInjectionTAP,
  type FaultInjectionTestCase,
  type EffectEgressTestCase,
  type CapabilityDenialTestCase,
  type BoundaryTestCase,
  type SubstrateViolationTestCase,
  type ContractTestSuite,
} from "./test-generator.js";
export {
  analyzeFlowDependencies,
  analyzeProgramFlowDependencies,
  renderDependencyComments,
  rewriteGeneratedComments,
  type FlowDependencies,
  type ProgramFile,
  type ProgramFlowAnalysis,
} from "./flow-dependency-analysis.js";
export {
  cyclomaticComplexity,
  renderComplexityComment,
} from "./flow-complexity.js";
export type { SemanticGraph } from "@galerina/devtools-graph-algorithms";

// Phase 15 — Passive Execution Plans
export {
  executePlan,
  type ExecutionStep,
  type ApprovedCapability,
  type ValidateContextStep,
  type ValidateParamStep,
  type CapabilityCallStep,
  type ResponseStep,
  type EmitEventStep,
  type ReturnStep,
} from "./runtime/executionPlan.js";

// Stage A - AST Interpreter
export {
  executeFlow,
  BINARY_DISPATCH,
  isPureEffectFree,
  extractRequestTimeMs,
  extractNetworkRequestsLimit,
  FUNGI_VOID,
  FUNGI_NONE,
  FUNGI_RUNTIME_005,
  // Optimization A: binding slot array
  assignSlots,
  SlottedScope,
  // Optimization B: while loop fast-path stub
  tryWhileFastPath,
  tryPureFlowSync,
  executeFlowSync,
  // Phase 29A: NaN-boxing helpers
  tagInt,
  isTagged,
  untag,
  fitsTagged,
  MAX_TAGGED,
  MIN_TAGGED,
  type GalerinaValue,
  type ExecutionResult,
  type ExecutionAuditRecord,
  type FlowExecutionResult,
  type RuntimeAuditEntry,
  type InterpreterRuntimeOptions,
  type ExecutionTier,
  type TierFallbackReason,
} from "./interpreter.js";

// Phase 29C — Production Readiness Check
export { checkProductionReadiness } from "./production-check.js";

// Pure Flow LRU Memoization Cache
export {
  pureFlowCacheKey,
  getCachedPureFlow,
  setCachedPureFlow,
  clearPureFlowCache,
  getPureFlowCacheStats,
} from "./pure-flow-cache.js";

// Phase 23C — ExecutionGraph build-once-run-many cache
export {
  buildExecutionGraph,
  executionGraphCacheKey,
  getGraphCacheStats,
  getCachedGraph,
  getOrLoadGraph,
  storeGraph,
  ExecOp,
  type ExecNode,
  type ExecutionGraph,
} from "./execution-graph.js";

// Stage A - Audit Writer
export {
  createAuditWriter,
  buildFlowAuditEvent,
  type AuditEvent,
  type AuditWriter,
} from "./audit-writer.js";

// Phase 25 — WAT Assembler (WAT → WASM binary)
export {
  assembleWAT,
  executeWASMFlow,
  type WATAssemblerResult,
  type WASMExecutionResult,
} from "./wat-assembler.js";

// P9 (#105) — WASM execution harness as a SECURITY ADMISSION GATE
export {
  wasmHash, generateRunnerKeypair, signWasm, verifyWasm,
  createHostRuntime, admitAndInstantiate,
} from "./wasm-runtime.js";
export type {
  AdmissionPolicy, RunnerProfile, WasmAttestation, AdmissionVerdict,
  Observer, HostRuntime, AdmissionResult,
} from "./wasm-runtime.js";

// Phase 19 / 22A / 22 / 27D — WAT Emitter (WebAssembly Text Format) — skeleton + SIMD types + pure bodies + SIMD ops
export {
  emitWAT,
  renderWAT,
  buildWATModule,
  buildWATModuleFromGIR,
  emitWATBody,
  emitWATFromFlowAST,
  emitWATExpr,
  emitBlockLastExpr,
  buildRecordLayouts,
  buildEnumVariants,
  getInternedStrings,
  extractFlowParamNames,
  findFlowNodeInAST,
  getWATImportsForEffects,
  galerinaTypeToWAT,
  DEFAULT_WAT_MEMORY,
  DEFAULT_WASM_SIMD,
  WAT_SIMD_OPS,
  type WATModule,
  type WATEmitResult,
  type WATFunction,
  type WATImport,
  type WATExport,
  type WATFuncType,
  type WATValType,
  type WATMemory,
  type WATFlowInput,
  type WATGIRInput,
  type WATParamDef,
  type WASMSIMDCapability,
  type WATSIMDInstruction,
} from "./wat-emitter.js";

// Security Policy — Anti-abuse architecture (Phase 25D+)
export {
  ANTI_ABUSE_EFFECTS,
  PRIVATE_IP_RANGES,
  FUNGI_NET_001,
  FUNGI_NET_002,
  FUNGI_RUNTIME_006,
  FUNGI_ANTI_ABUSE_001,
  parseNetworkDestinationPolicy,
  isHostAllowed,
  type NetworkDestinationPolicy,
} from "./security-policy.js";

// Stage A - Runtime Pipeline
export {
  run,
  serve,
  type RuntimeResult,
  type RuntimeOptions,
  type RuntimeMode,
} from "./runtime.js";

// Stage A - Route Registry
export {
  buildRouteRegistry,
  type RouteEntry,
  type RouteRegistry,
  type RouteMatch,
} from "./route-registry.js";

// Stage A - Route Dispatcher
export {
  startServer,
  makeResponseValue,
  makeApiErrorValue,
  type ServerConfig,
  type RunningServer,
} from "./route-dispatcher.js";

// Stage A - Standard Library
export {
  callStdlib,
  jsObjectToGalerina,
  galerinaValuesEqual,
  type StdlibContext,
} from "./stdlib.js";

// Phase 18H — Standard Library Registry
export {
  STDLIB_CAPABILITY_MAP,
  STDLIB_MODULE_KIND,
  TENSOR_STDLIB_OPS,
  TRI_STDLIB_OPS,
  getStdlibRequiredEffects,
  getStdlibModuleKind,
  getStdlibWasmImport,
  type StdlibCapabilityEntry,
  type StdlibModuleKind,
  type TensorOpInfo,
  type TriOpInfo,
} from "./stdlib-registry.js";

// ---------------------------------------------------------------------------
// Stdlib diagnostics — FUNGI-STDLIB-001
// ---------------------------------------------------------------------------

/**
 * FUNGI-STDLIB-001: An effectful stdlib function was called without the
 * required effect being declared in the flow's contract.
 *
 * Example: calling File.readText() without declaring storage.read.
 * The STDLIB_CAPABILITY_MAP defines required effects per function.
 *
 * This diagnostic is emitted by the effect checker when a stdlib call is
 * detected in the flow body but the corresponding effect is not declared.
 */
export const FUNGI_STDLIB_001 = {
  code: "FUNGI-STDLIB-001",
  name: "StdlibEffectNotDeclared",
  severity: "error" as const,
  message: "Effectful stdlib function called without declaring the required effect in the contract.",
  why: "Every stdlib function that performs I/O, network access, filesystem access, or secret reads must be explicitly declared as an effect. This enables static governance proof and WASM import table generation.",
  suggestedFix: "Add the required effect to the contract: contract { effects { storage.read } }",
} as const;

// Stage A - Proof Chain
export {
  buildProofChain,
  verifyProofChain,
  type ExecutionProofChain,
  type ProofHashes,
  type EvidenceRecord,
  type DenialRecord,
  type ProofChainInputs,
} from "./proof-chain.js";

// Stage A - Governance Verifier
export {
  verifyGovernance,
  extractArenaLimitMB,
  FUNGI_GOV_001,
  FUNGI_GOV_003,
  FUNGI_GOV_006,
  FUNGI_GOV_013,
  FUNGI_GOV_019,
  FUNGI_GOV_020,
  FUNGI_TERM_001,
  FUNGI_VAL_001,
  FUNGI_VAL_002,
  FUNGI_VAL_003,
  RECOGNISED_VALUE_CLASSIFICATIONS,
  FUNGI_CONTEXT_001,
  FUNGI_GOV_011,
  FUNGI_GOV_012,
  // New category codes (task #50 — EC/ID/AU/LC/T/FG)
  FUNGI_RES_001,
  FUNGI_OBS_001,
  FUNGI_EC_001,
  FUNGI_EC_002,
  FUNGI_ID_001,
  FUNGI_AU_001,
  FUNGI_DRCM_UNSUPPORTED,
  // #34 — post-quantum signing enforcement
  FUNGI_CRYPTO_PQ_001,
  // Direction B — substrate {} contract obligations
  FUNGI_SUBSTRATE_001,
  FUNGI_SUBSTRATE_002,
  FUNGI_SUBSTRATE_003,
  FUNGI_SUBSTRATE_004,
  FUNGI_SUBSTRATE_005,
  type GovernanceDiagnostic,
  type GovernanceVerifyResult,
  type DeploymentProfile,
} from "./governance-verifier.js";

// Direction B — substrate inference module (the substrate {} verifier pass) + NMR math
export {
  inferFlowSubstrate,
  checkSubstrateViolations,
} from "./substrate-inference.js";
export type { InferredSubstrate, SubstrateViolation, SubstrateLane } from "./substrate-inference.js";
export { singleLaneErrorProbability, nmrFailureProbability } from "./substrate-math.js";

// Phase 28 — Runtime Profile Enforcement (strict / high_integrity / deterministic)
export {
  checkProfiles,
  PROFILE_DIAGNOSTICS,
  FUNGI_PROFILE_001, FUNGI_PROFILE_002, FUNGI_PROFILE_003, FUNGI_PROFILE_004,
  FUNGI_PROFILE_005, FUNGI_PROFILE_005B, FUNGI_PROFILE_006, FUNGI_PROFILE_007,
  type RuntimeProfile,
  type ProfileDiagnostic,
} from "./profile-checker.js";

// Phase 32 — Governance Diff (galerina diff main..branch)
export {
  diffGovernance,
  flowShape,
  renderGovernanceDiff,
  type GovernanceDiff,
  type FlowDelta,
  type FlowGovernanceShape,
} from "./governance-diff.js";

// Phase 31 — Bytecode VM for pure integer flows
export {
  compileToBytecode,
  runBytecode,
  tryRunBytecode,
  clearBytecodeCache,
  Op,
  type BytecodeProgram,
} from "./bytecode-vm.js";

// Phase 28 — Taint Tracking & Sink Safety (Tainted<T> / SafeFor<Context,T>)
export {
  checkTaint,
  UNTAINT_BOUNDARIES,
  INJECTION_SINKS,
  TAINT_DIAGNOSTICS,
  FUNGI_TAINT_001, FUNGI_TAINT_002, FUNGI_TAINT_003, FUNGI_TAINT_004,
  type SinkContext,
  type TaintDiagnostic,
  FUNGI_TAINT_005,
  FUNGI_TAINT_006,
} from "./taint-checker.js";

// Phase 29/33 — Economics Inference (convention over configuration)
export {
  inferFlowEconomics,
  describeEconomics,
  type InferredEconomics,
  type InferredTarget,
} from "./economics-inference.js";

// ---------------------------------------------------------------------------
// Economics / Lineage / AI governance diagnostics — FUNGI-ECON-001..003
// ---------------------------------------------------------------------------

/** FUNGI-ECON-001: Flow execution may exceed the declared economic budget. */
export const FUNGI_ECON_001 = {
  code: "FUNGI-ECON-001",
  name: "BudgetExceeded",
  severity: "warning" as const,
  message: "Flow execution may exceed the declared economic budget.",
  why: "Economic contracts enable cost-aware scheduling. When actual cost exceeds declared targets, the runtime can route to cheaper alternatives or alert before money is spent.",
  suggestedFix: "Increase the target_cost in contract.economics, or declare preferred_execution wasm to reduce compute cost.",
} as const;

/** FUNGI-ECON-002: Protected data binding has no lineage declaration. */
export const FUNGI_ECON_002 = {
  code: "FUNGI-ECON-002",
  name: "LineageMissing",
  severity: "info" as const,
  message: "Protected data binding has no lineage declaration.",
  why: "Data lineage tracking enables automated regulatory reporting (GDPR Article 30, CCPA). Without lineage, organisations must manually trace data origins during audits.",
  suggestedFix: "Add lineage { source origin owner Team retention duration } to the contract.",
} as const;

/** FUNGI-ECON-003: AI model call uses a model not in the contract's approved_models list. */
export const FUNGI_ECON_003 = {
  code: "FUNGI-ECON-003",
  name: "AiModelUnapproved",
  severity: "error" as const,
  message: "AI model call uses a model not in the contract's approved_models list.",
  why: "Unapproved AI models can incur unexpected costs, produce unaudited outputs, or violate data processing agreements with vendors.",
  suggestedFix: "Add the model to contract.ai.approved_models, or remove the call.",
} as const;

/** FUNGI-GOV-014: Flow declares compute targets with prefer [...] but no fallback target is declared. */
export const FUNGI_GOV_014 = {
  code: "FUNGI-GOV-014",
  name: "MissingFallbackTarget",
  severity: "warning" as const,
  message: "Flow declares compute targets with prefer [...] but no fallback target is declared. A fallback is required — without it, a native accelerator crash becomes an unrecoverable service failure.",
  why: "When native modules crash, the WASM control plane must fall back to a governed CPU/WASM path. No fallback = potential service outage with no recovery path.",
  suggestedFix: "Add: targets { fallback cpu } or targets { fallback wasm }",
} as const;

// Stage A - Boundary Graph
export {
  buildBoundaryGraph,
  type BoundaryGraph,
  type BoundaryNodeData,
  type BoundaryCheckResult,
} from "./boundary-graph.js";

// ---------------------------------------------------------------------------
// Effect diagnostics — FUNGI-EFFECT-005
// ---------------------------------------------------------------------------

/**
 * FUNGI-EFFECT-005: Effect name is a broad alias without a specific dot-path qualifier.
 *
 * Broad aliases (`network`, `database`, `filesystem`, `ai`, `audit`) are demoted
 * in favour of canonical names (`network.outbound`, `database.read`, etc.) because
 * they can imply broader authority than intended and are ambiguous in governance audits.
 *
 * Severity: warning in development mode, error in production mode.
 */
export const FUNGI_EFFECT_005 = {
  code: "FUNGI-EFFECT-005",
  name: "BroadAliasUsed",
  severity: "warning" as const,
  message: "Effect name is a broad alias. Use the canonical dot-path name to precisely declare authority.",
  why: "Broad aliases are ambiguous and may grant more authority than intended in future Galerina versions. Canonical names are stable, auditable, and governance-traceable.",
  suggestedFix: "Replace 'network' with 'network.outbound', 'database' with 'database.read' or 'database.write', 'filesystem' with 'storage.read' or 'storage.write'.",
} as const;

// Phase 9B — Event Checker
export {
  checkEvents,
  FUNGI_EVENT_001,
  FUNGI_EVENT_002,
  FUNGI_EVENT_003,
  FUNGI_EVENT_004,
  FUNGI_EVENT_005,
  type EventDiagnostic,
  type EventCheckResult,
} from "./event-checker.js";

// Phase 10A — Signed Attestation
export {
  buildAttestation,
  signAttestation,
  verifyAttestation,
  generateAttestationKey,
  signAttestationHybrid,
  verifyAttestationHybrid,
  generateHybridAttestationKey,
  attestationToYaml,
  attestationFromJson,
  type GalerinaAttestation,
  type AttestationInputs,
  type AttestationKeyPair,
  type HybridAttestationKeyPair,
} from "./attestation.js";

// Phase 11C — Runtime Contract Enforcement
export {
  createContractEnforcer,
  type ContractEnforcer,
} from "./runtime/contractEnforcer.js";

export type { ContractEnforcementRecord } from "./runtime/runtimeReport.js";
export type { RuntimeContext } from "./runtime/runtimeContext.js";
export { verifyRuntimeManifestHash } from "./runtime/runtimeContext.js";

// Phase 11C / R4 — Capability Host
export {
  createCapabilityHost,
  parseNetworkDestinationPolicy as parseNetworkDestinationPolicyForHost,
  type CapabilityHost,
  type CapabilityCall,
  type CapabilityResult,
  type CapabilityCheckResult,
  type CapabilityHostConfig,
  type FlowCallCounters,
  type NetworkDestinationPolicy as CapabilityNetworkPolicy,
} from "./runtime/capabilityHost.js";

// Phase 11D — Governed Memory (skeleton)
export {
  createGovernedMemory,
  type GovernedMemory,
  type GovernedValueTag,
} from "./runtime/governedMemory.js";

// Stage B — Root Capability Provider (Phase 14)
export {
  createRootCapabilityProvider,
  COMPILER_MINIMUM_CAPABILITIES,
  type RootCapabilityProvider,
  type CompilerCapabilityHost,
  type UserRuntimeCapabilities,
  type CapabilityDomain,
} from "./runtime/rootCapabilityProvider.js";

// Phase 16A — Canonical Hashing
export {
  canonicalHash,
  stripNonDeterministic,
  hashSource,
  hashGIR,
  hashPassivePlan,
} from "./runtime/canonicalHash.js";

// Phase 21A/B/C/D — Lowering Plans (TypedArray, Monomorphisation, Kernel Fusion, Lazy Iterator)
export {
  buildTypedArrayLoweringPlan,
  buildMonomorphisationPlan,
  buildKernelFusionPlan,
  buildLazyIteratorChain,
  ELEMENT_TYPE_TO_TYPED_ARRAY,
  PRODUCTION_ERASURE,
  DEV_ERASURE,
  type TypedArrayLoweringEntry,
  type TypedArrayLoweringPlan,
  type EraseableMetadata,
  type MonomorphisationCandidate,
  type MonomorphisationSpecialisation,
  type MonomorphisationPlan,
  type KernelFusionGroup,
  type KernelFusionPlan,
  type LazyIteratorOp,
  type LazyIteratorStage,
  type LazyIteratorChain,
} from "./lowering-plan.js";

// Phase 22B / 23A/B — GPU, NPU, and APU Plans
export {
  buildWebGPUPlan,
  buildNPUPlan,
  buildAPUSharedMemoryPlan,
  type WebGPUComputePlan,
  type NPUKernelPlan,
  type APUSharedBuffer,
  type APUSharedMemoryPlan,
} from "./gpu-plan.js";

// Phase 23C — Register VM Bytecode
export {
  emitBytecode,
  type RegisterId,
  type ConstantPoolIndex,
  type RegisterOpcode,
  type RegisterInstruction,
  type RegisterFunction,
  type RegisterBytecodeModule,
} from "./register-vm.js";

// Phase 23D — StringView, BytesView, TensorView (zero-copy buffer views)
export {
  createStringView,
  createBytesView,
  sliceStringView,
  type StringView,
  type BytesView,
  type TensorView,
  type WASMLinearMemoryLayout,
} from "./views.js";

// Stage B — Self-hosting milestone tracker
export {
  generateStageBReport,
  type StageBMilestone,
  type StageBReport,
} from "./stage-b-report.js";

export interface CompilerInput {
  readonly projectRoot: string;
  readonly entryFiles: readonly string[];
}

export interface SourceLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

// Unified Annotation Pass — single-pass type+value-state+effect+governance annotation
export {
  annotate,
  type NodeId,
  type NodeAnnotation,
  type AnnotationMap,
} from "./unified-annotator.js";

// Phase 24/25 — Fused compiler + SoA internals (data-oriented, WASM-ready)
export { SoANodeArena, MAX_NODES } from "./soa-arena.js";
export {
  toFlatTokenStream,
  tokenStreamKind,
  tokenStreamStart,
  tokenStreamEnd,
  tokenStreamValue,
  TOKEN_STRIDE,
  type FlatTokenStream,
} from "./flat-token-stream.js";
export {
  fusedCompile,
  packOpcode,
  unpackOp,
  unpackTypeId,
  unpackEffectMask,
  unpackFlags,
  GIR_OP,
  type FusedPassResult,
} from "./fused-pass.js";

export interface CompilerDiagnostic {
  readonly code: string;
  /** Screaming-snake-case diagnostic name, e.g. "TRI_BRANCH_CONDITION". */
  readonly name: string;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
  readonly location?: SourceLocation;
  /** Human-readable fix suggestion for IDE quick-fix integration. */
  readonly suggestedFix?: string;
}

export interface CompilerResult {
  readonly ok: boolean;
  readonly diagnostics: readonly CompilerDiagnostic[];
  readonly reports: readonly string[];
}

export interface CompilerSourceText {
  readonly file: string;
  readonly text: string;
}

export interface CoreSyntaxSafetyOptions {
  readonly scanSecrets?: boolean;
  readonly scanUnsafeDynamicCode?: boolean;
}

// ---------------------------------------------------------------------------
// Intent and safety level types
// ---------------------------------------------------------------------------

/**
 * All recognised flow safety levels — mirrors SafetyLevel in @galerina/core.
 * Kept local until workspace links are in place.
 */
export type CompilerSafetyLevel =
  | "safe"
  | "guarded"
  | "privileged"
  | "unsafe"
  | "experimental";

/**
 * A kind mismatch found during intent/effect consistency checking.
 */
export type IntentMismatchKind =
  | "undeclared_effect"
  | "destructive_effect_in_safe_flow"
  | "missing_intent"
  | "unsafe_without_fallback"
  | "unsafe_without_reason"
  | "privileged_without_capability"
  | "experimental_in_production";

export interface IntentMismatch {
  readonly kind: IntentMismatchKind;
  readonly message: string;
  readonly path?: string;
}

/**
 * Result of running the intent/effect consistency checker on a single flow.
 * Structurally compatible with CompilerResult.
 */
export interface IntentCheckResult {
  readonly flowName: string;
  readonly safetyLevel: CompilerSafetyLevel;
  readonly intent?: string;
  readonly declaredEffects: readonly string[];
  /** Effects the checker could infer from the flow body. */
  readonly inferredEffects: readonly string[];
  readonly mismatches: readonly IntentMismatch[];
  readonly diagnostics: readonly CompilerDiagnostic[];
}

// ---------------------------------------------------------------------------
// Intent diagnostic codes — FUNGI-INTENT-001..005
//
// Note: The source document uses "LN-INTENT-*"; the canonical repo format
// is "FUNGI-INTENT-*" (matching FUNGI-CONFIG-*, FUNGI-LOGIC-*, etc.).
// ---------------------------------------------------------------------------

/** Declared intent conflicts with inferred behavior (e.g. delete in a "send receipt" flow). */
export const FUNGI_INTENT_001 = {
  code: "FUNGI-INTENT-001",
  name: "INTENT_BEHAVIOR_MISMATCH",
  severity: "error",
  message: "Declared intent conflicts with inferred behavior.",
} as const;

/** API route, webhook, payment flow, or other governed surface is missing a required intent declaration. */
export const FUNGI_INTENT_002 = {
  code: "FUNGI-INTENT-002",
  name: "MISSING_REQUIRED_INTENT",
  severity: "error",
  message: "Governed surface requires an intent declaration.",
} as const;

/** Unsafe block is missing a reason, approval, or fallback declaration. */
export const FUNGI_INTENT_003 = {
  code: "FUNGI-INTENT-003",
  name: "UNSAFE_MISSING_REASON_OR_FALLBACK",
  severity: "error",
  message: "Unsafe block must declare reason, approval, and a safe fallback.",
} as const;

/** Privileged flow does not declare the required capability. */
export const FUNGI_INTENT_004 = {
  code: "FUNGI-INTENT-004",
  name: "PRIVILEGED_MISSING_CAPABILITY",
  severity: "error",
  message: "Privileged flow must declare its required capability.",
} as const;

/** Experimental flow or block is included in a production build target. */
export const FUNGI_INTENT_005 = {
  code: "FUNGI-INTENT-005",
  name: "EXPERIMENTAL_IN_PRODUCTION",
  severity: "error",
  message: "Experimental code must not be included in a production build target without explicit approval.",
} as const;

export const FUNGI_INTENT_DIAGNOSTICS = [
  FUNGI_INTENT_001,
  FUNGI_INTENT_002,
  FUNGI_INTENT_003,
  FUNGI_INTENT_004,
  FUNGI_INTENT_005,
] as const;

// ---------------------------------------------------------------------------
// Syntax diagnostics — FUNGI-SYNTAX-001..002
// ---------------------------------------------------------------------------

/** `var` is not a valid Galerina keyword. Use `let` or `mut`. */
export const FUNGI_SYNTAX_001 = {
  code: "FUNGI-SYNTAX-001",
  name: "VAR_NOT_SUPPORTED",
  severity: "error",
  message: "Galerina does not support var. Use let for immutable bindings or mut for mutable bindings.",
} as const;

/** `const` is not a valid Galerina keyword. Use `let` or `readonly`. */
export const FUNGI_SYNTAX_002 = {
  code: "FUNGI-SYNTAX-002",
  name: "CONST_NOT_SUPPORTED",
  severity: "error",
  message: "Galerina does not support const. Use let for immutable bindings or readonly for read-only values.",
} as const;

/** `let` binding at top level — must be inside a flow. */
export const FUNGI_SYNTAX_006 = {
  code: "FUNGI-SYNTAX-006",
  name: "LET_AT_TOP_LEVEL",
  severity: "error",
  message: "Top-level let bindings are not allowed. Move this inside a flow, or use const for compile-time constants.",
} as const;

/** `mut` binding at top level — mutable state must be flow-local. */
export const FUNGI_SYNTAX_007 = {
  code: "FUNGI-SYNTAX-007",
  name: "MUT_AT_TOP_LEVEL",
  severity: "error",
  message: "Top-level mut bindings are not allowed. Mutable state must be flow-local.",
} as const;

/** `unsafe let` at top level — boundary data must be owned by a secure flow. */
export const FUNGI_SYNTAX_008 = {
  code: "FUNGI-SYNTAX-008",
  name: "UNSAFE_LET_AT_TOP_LEVEL",
  severity: "error",
  message: "unsafe let is only allowed inside a secure flow. Boundary data must be owned by a governed flow.",
} as const;

/** `emit` at top level — events may only be emitted inside flows. */
export const FUNGI_SYNTAX_009 = {
  code: "FUNGI-SYNTAX-009",
  name: "EMIT_AT_TOP_LEVEL",
  severity: "error",
  message: "Events may only be emitted inside flows. Declare events globally, emit them inside governed execution.",
} as const;

export const FUNGI_SYNTAX_DIAGNOSTICS = [
  FUNGI_SYNTAX_001,
  FUNGI_SYNTAX_002,
  FUNGI_SYNTAX_006,
  FUNGI_SYNTAX_007,
  FUNGI_SYNTAX_008,
  FUNGI_SYNTAX_009,
] as const;

// ---------------------------------------------------------------------------
// Legacy syntax diagnostics — FUNGI-SYNTAX-LEGACY-001
// ---------------------------------------------------------------------------

/**
 * FUNGI-SYNTAX-LEGACY-001: `with effects [...]` is legacy syntax.
 *
 * Fired as a warning by the parser when the old `with effects [database.write]`
 * form is detected. The canonical form is `contract { effects { database.write } }`.
 *
 * The legacy form remains parseable for backwards compatibility.
 */
export const FUNGI_SYNTAX_LEGACY_001 = {
  code: "FUNGI-SYNTAX-LEGACY-001",
  name: "LegacyEffectsSyntax",
  severity: "warning" as const,
  message: "'with effects [...]' is legacy syntax. Use 'contract { effects { ... } }' instead.",
  suggestedFix: "Replace 'with effects [database.write]' with:\n  contract {\n    effects {\n      database.write\n    }\n  }",
} as const;

// ---------------------------------------------------------------------------
// Binding diagnostics — FUNGI-BINDING-001..004
// ---------------------------------------------------------------------------

/** Attempt to reassign an immutable `let` binding. */
export const FUNGI_BINDING_001 = {
  code: "FUNGI-BINDING-001",
  name: "IMMUTABLE_LET_REASSIGNMENT",
  severity: "error",
  message: "Cannot reassign immutable let binding. Use mut only if reassignment is required.",
} as const;

/** Attempt to reassign a `readonly` binding. */
export const FUNGI_BINDING_002 = {
  code: "FUNGI-BINDING-002",
  name: "READONLY_REASSIGNMENT",
  severity: "error",
  message: "Cannot reassign readonly binding.",
} as const;

/** Attempt to mutate a value through a `readonly` binding. */
export const FUNGI_BINDING_003 = {
  code: "FUNGI-BINDING-003",
  name: "READONLY_PROPERTY_MUTATION",
  severity: "error",
  message: "Cannot mutate a value through a readonly binding.",
} as const;

/** `mut` binding used in a pure or safe context where mutation is forbidden. */
export const FUNGI_BINDING_004 = {
  code: "FUNGI-BINDING-004",
  name: "MUT_IN_PURE_CONTEXT",
  severity: "error",
  message: "mut binding used where mutation is forbidden. Use let or a functional accumulator (fold, count, filter).",
} as const;

/** FUNGI-BINDING-005: Reassignment of immutable let binding denied. */
export const FUNGI_BINDING_005 = {
  code: "FUNGI-BINDING-005",
  name: "IMMUTABLE_BINDING_REASSIGNED",
  severity: "error",
  message: "Cannot reassign an immutable 'let' binding. Use 'mut' if reassignment is intended.",
} as const;

/** FUNGI-BINDING-006: Type-changing reassignment of mut binding denied. */
export const FUNGI_BINDING_006 = {
  code: "FUNGI-BINDING-006",
  name: "MUT_TYPE_CHANGE",
  severity: "error",
  message: "Cannot change the type of a 'mut' binding on reassignment. 'mut' bindings are type-stable.",
} as const;

export const FUNGI_BINDING_DIAGNOSTICS = [
  FUNGI_BINDING_001,
  FUNGI_BINDING_002,
  FUNGI_BINDING_003,
  FUNGI_BINDING_004,
  FUNGI_BINDING_005,
  FUNGI_BINDING_006,
] as const;

// ---------------------------------------------------------------------------
// Raw-pointer diagnostics — FUNGI-RAWPTR-001
// ---------------------------------------------------------------------------

/**
 * Raw pointer syntax detected outside an approved unsafe block.
 *
 * Galerina bans raw pointer access in normal code. Only approved unsafe blocks
 * may use raw pointer expressions, and they must declare reason + fallback.
 */
export const FUNGI_RAWPTR_001 = {
  code: "FUNGI-RAWPTR-001",
  name: "RAW_POINTER_OUTSIDE_UNSAFE",
  severity: "error",
  message: "Raw pointer access is not allowed in normal Galerina code. Move this into an approved unsafe block with declared reason and fallback.",
} as const;

export const FUNGI_RAWPTR_DIAGNOSTICS = [FUNGI_RAWPTR_001] as const;

// ---------------------------------------------------------------------------
// Pipeline diagnostics — FUNGI-PIPELINE-001..005
// ---------------------------------------------------------------------------

/** A method called in a pipeline chain does not exist on the current type. */
export const FUNGI_PIPELINE_001 = {
  code: "FUNGI-PIPELINE-001",
  name: "UNKNOWN_PIPELINE_METHOD",
  severity: "error",
  message: "Unknown method in pipeline chain.",
} as const;

/** The return type of a pipeline stage does not match the input of the next. */
export const FUNGI_PIPELINE_002 = {
  code: "FUNGI-PIPELINE-002",
  name: "PIPELINE_TYPE_MISMATCH",
  severity: "error",
  message: "Pipeline stage output type does not match the next stage's input type.",
} as const;

/** A pipeline contains a fallible stage whose Result is not handled. */
export const FUNGI_PIPELINE_003 = {
  code: "FUNGI-PIPELINE-003",
  name: "UNHANDLED_FALLIBLE_PIPELINE",
  severity: "error",
  message: "Fallible pipeline stage produces a Result that is not handled or propagated.",
} as const;

/** A pipeline stage uses an effect not declared on the enclosing flow. */
export const FUNGI_PIPELINE_004 = {
  code: "FUNGI-PIPELINE-004",
  name: "PIPELINE_UNDECLARED_EFFECT",
  severity: "error",
  message: "Pipeline stage requires an effect that is not declared on the enclosing flow.",
} as const;

/** A pipeline attempts to mutate a value through a readonly receiver. */
export const FUNGI_PIPELINE_005 = {
  code: "FUNGI-PIPELINE-005",
  name: "PIPELINE_READONLY_MUTATION",
  severity: "error",
  message: "Pipeline stage attempts to mutate a readonly receiver.",
} as const;

export const FUNGI_PIPELINE_DIAGNOSTICS = [
  FUNGI_PIPELINE_001,
  FUNGI_PIPELINE_002,
  FUNGI_PIPELINE_003,
  FUNGI_PIPELINE_004,
  FUNGI_PIPELINE_005,
] as const;

// ---------------------------------------------------------------------------
// Typed content block diagnostics — FUNGI-BLOCK-001..004
// ---------------------------------------------------------------------------

/** Unknown typed content block type — only html, dom, script, css are valid. */
export const FUNGI_BLOCK_001 = {
  code: "FUNGI-BLOCK-001",
  name: "UNKNOWN_CONTENT_BLOCK_TYPE",
  severity: "error",
  message: "Unknown typed content block type. Valid types are: html, dom, script, css.",
} as const;

/** Typed content block was opened but its closing marker was never found. */
export const FUNGI_BLOCK_002 = {
  code: "FUNGI-BLOCK-002",
  name: "UNCLOSED_CONTENT_BLOCK",
  severity: "error",
  message: "Typed content block is never closed. The closing marker must appear alone at the start of a line.",
} as const;

/** The closing marker does not match the opening marker. */
export const FUNGI_BLOCK_003 = {
  code: "FUNGI-BLOCK-003",
  name: "MISMATCHED_CONTENT_BLOCK_MARKER",
  severity: "error",
  message: "Typed content block closing marker does not match the opening marker.",
} as const;

/** A ProtectedSecret value was emitted into a script or html block. */
export const FUNGI_BLOCK_004 = {
  code: "FUNGI-BLOCK-004",
  name: "SECRET_IN_CONTENT_BLOCK",
  severity: "error",
  message: "ProtectedSecret cannot be emitted into a typed content block.",
} as const;

export const FUNGI_BLOCK_DIAGNOSTICS = [
  FUNGI_BLOCK_001,
  FUNGI_BLOCK_002,
  FUNGI_BLOCK_003,
  FUNGI_BLOCK_004,
] as const;

// ---------------------------------------------------------------------------
// String diagnostics — FUNGI-STRING-001..004
// ---------------------------------------------------------------------------

/** Attempted String.decode() produced an invalid UTF-8 sequence. */
export const FUNGI_STRING_001 = {
  code: "FUNGI-STRING-001",
  name: "INVALID_UTF8_DECODE",
  severity: "error",
  message: "Attempted decode produced invalid UTF-8. Handle the DecodeError with a map block.",
} as const;

/** A secret value was assigned to a plain String binding instead of SecureString. */
export const FUNGI_STRING_002 = {
  code: "FUNGI-STRING-002",
  name: "SECRET_STORED_AS_STRING",
  severity: "error",
  message: "Secret value must not be stored in a plain String. Use SecureString or Secret.env().",
} as const;

/** A Bytes value was assigned to a String binding without an explicit decode step. */
export const FUNGI_STRING_003 = {
  code: "FUNGI-STRING-003",
  name: "IMPLICIT_STRING_BYTE_CONVERSION",
  severity: "error",
  message: "Bytes cannot become String without an explicit decode. Use String.decode(bytes, Encoding.UTF8).",
} as const;

/** `.length` was called on a String without specifying whether chars or bytes are counted. */
export const FUNGI_STRING_004 = {
  code: "FUNGI-STRING-004",
  name: "AMBIGUOUS_STRING_LENGTH",
  severity: "warning",
  message: "Ambiguous String length. Use .charCount() for Unicode scalar count or .encodedLength(Encoding.UTF8) for byte length.",
} as const;

export const FUNGI_STRING_DIAGNOSTICS = [
  FUNGI_STRING_001,
  FUNGI_STRING_002,
  FUNGI_STRING_003,
  FUNGI_STRING_004,
] as const;

// ---------------------------------------------------------------------------
// Char diagnostics — FUNGI-CHAR-001..004
// ---------------------------------------------------------------------------

/** A Char value was assigned to or compared with a Byte without an explicit conversion. */
export const FUNGI_CHAR_001 = {
  code: "FUNGI-CHAR-001",
  name: "CHAR_BYTE_CONFUSION",
  severity: "error",
  message: "Char cannot be assigned to Byte. Char is text; Byte is raw data. Encode explicitly with .toString().encode(Encoding.UTF8).",
} as const;

/** A character literal contains an invalid Unicode scalar value. */
export const FUNGI_CHAR_002 = {
  code: "FUNGI-CHAR-002",
  name: "INVALID_CHAR_LITERAL",
  severity: "error",
  message: "Character literal contains an invalid Unicode scalar value.",
} as const;

/** A character literal contains more than one character unit. */
export const FUNGI_CHAR_003 = {
  code: "FUNGI-CHAR-003",
  name: "MULTI_CHAR_LITERAL",
  severity: "error",
  message: "Char literal must contain exactly one character unit. Use String for multi-character values.",
} as const;

/** A Char was used as an integer without calling .codePoint(). */
export const FUNGI_CHAR_004 = {
  code: "FUNGI-CHAR-004",
  name: "IMPLICIT_CHAR_NUMBER_CONVERSION",
  severity: "error",
  message: "Char cannot be used as an integer directly. Use .codePoint() to get the Unicode code point.",
} as const;

export const FUNGI_CHAR_DIAGNOSTICS = [
  FUNGI_CHAR_001,
  FUNGI_CHAR_002,
  FUNGI_CHAR_003,
  FUNGI_CHAR_004,
] as const;

// ---------------------------------------------------------------------------
// Byte diagnostics — FUNGI-BYTE-001..005
// ---------------------------------------------------------------------------

/** A Byte literal value is outside the valid 0–255 range. */
export const FUNGI_BYTE_001 = {
  code: "FUNGI-BYTE-001",
  name: "BYTE_OUT_OF_RANGE",
  severity: "error",
  message: "Byte value must be between 0 and 255.",
} as const;

/** A Byte arithmetic result could exceed 255 without explicit overflow handling. */
export const FUNGI_BYTE_002 = {
  code: "FUNGI-BYTE-002",
  name: "BYTE_OVERFLOW",
  severity: "error",
  message: "Byte arithmetic result may exceed 255. Use wrapping, checked, or saturating arithmetic explicitly.",
} as const;

/** A Bytes value was assigned to a String binding without an explicit decode step. */
export const FUNGI_BYTE_003 = {
  code: "FUNGI-BYTE-003",
  name: "IMPLICIT_BYTE_STRING_CONVERSION",
  severity: "error",
  message: "Bytes cannot become String without an explicit decode. Use String.decode(bytes, Encoding.UTF8).",
} as const;

/** A raw Bytes value was passed to a log sink without redaction. */
export const FUNGI_BYTE_004 = {
  code: "FUNGI-BYTE-004",
  name: "RAW_BYTES_LOGGED",
  severity: "error",
  message: "Raw Bytes must not be passed directly to a log sink. Redact, hash, or encode before logging.",
} as const;

/** A Bytes read has no declared memory limit or streaming path. */
export const FUNGI_BYTE_005 = {
  code: "FUNGI-BYTE-005",
  name: "UNBOUNDED_BYTES_READ",
  severity: "error",
  message: "Bytes read without a declared memory limit or a streaming path. Declare maxBodyMb or use a streaming reader.",
} as const;

export const FUNGI_BYTE_DIAGNOSTICS = [
  FUNGI_BYTE_001,
  FUNGI_BYTE_002,
  FUNGI_BYTE_003,
  FUNGI_BYTE_004,
  FUNGI_BYTE_005,
] as const;

// ---------------------------------------------------------------------------
// Memory diagnostics — FUNGI-MEMORY-001..008
//
// HONEST STATUS (#65 / RD-0130, 2026-06-26). Of this family ONLY FUNGI-MEMORY-008
// is WIRED (emitter detectUnsafeBlockWithoutReason; the `unsafe block` construct
// must declare a reason + fallback). FUNGI-MEMORY-001..007 are RESERVED / NOT
// EMITTED: no compiler pass produces them and none is planned.
//
// WHY (and why that is correct, not a gap): Galerina is VALUE-SEMANTICS — no shared
// mutable aliasing (a mutated copy never affects its source), no references, no
// raw pointers, no manual malloc/free. The live runtime is a GC tree-walker; the
// production path is WASM (monotonic per-flow bump heap + capability-sandboxed,
// bounds-checked linear memory — no free). So the Rust-borrow-checker bug classes
// these codes name — 001 use-after-move, 002 borrow-after-move, 003
// borrow-escapes-scope, 004 readonly-mutation-through-a-ref, 005 mutable-alias —
// cannot occur by construction. 006 BOUNDS_VIOLATION names a COMPILE-TIME bounds
// proof we do not ship; bounds are enforced at RUNTIME (WASM trap / interpreter
// guard). 007 unchecked-access-outside-unsafe has no scanner (008 covers the
// unsafe-block obligation that matters).
//
// The ONE linear-resource guarantee Galerina genuinely needs — consume-once
// ("a passport used twice") — ships + is enforced as FUNGI-AFFINE-001
// (value-state-checker.ts), NOT via these codes. `move`/`borrow`/`pinned` are
// reserved lexer keywords: parsed, currently unenforced.
//
// DO NOT add 001..007 to PRODUCTION_BLOCKERS (production-check.ts): a blocker no
// pass can emit is a FALSE capability claim (RD-0124; enforced by
// scripts/audit-production-blockers.mjs, and the phase29 reserved-codes tripwire).
// Re-classify one as live ONLY if Galerina ever gains shared mutable references AND
// a real detector is wired. They stay defined (namespace stability — the
// catalog/registry/expected-diagnostics reference them), not deleted. Canonical
// stance: docs/Knowledge-Bases/galerina-memory-safety-model.md.
// ---------------------------------------------------------------------------

// --- FUNGI-MEMORY-001..007: RESERVED / NOT-EMITTED (value-semantics; see family header) ---

/** RESERVED (no compiler pass emits this): a moved value used again after ownership transferred. */
export const FUNGI_MEMORY_001 = {
  code: "FUNGI-MEMORY-001",
  name: "USE_AFTER_MOVE",
  severity: "error",
  message: "A moved value cannot be used again. Ownership transferred at the move site.",
} as const;

/** A value was borrowed after its ownership had already moved. */
export const FUNGI_MEMORY_002 = {
  code: "FUNGI-MEMORY-002",
  name: "BORROW_AFTER_MOVE",
  severity: "error",
  message: "Cannot borrow a value after ownership has moved.",
} as const;

/** A borrowed reference outlives the scope of its owner. */
export const FUNGI_MEMORY_003 = {
  code: "FUNGI-MEMORY-003",
  name: "BORROW_ESCAPES_SCOPE",
  severity: "error",
  message: "Borrowed reference cannot outlive its owner. Return ownership via move instead.",
} as const;

/** Mutation was attempted through a readonly reference. */
export const FUNGI_MEMORY_004 = {
  code: "FUNGI-MEMORY-004",
  name: "READONLY_MUTATION",
  severity: "error",
  message: "Cannot mutate a value through a readonly reference.",
} as const;

/** A mutable borrow exists while another borrow or alias is active. */
export const FUNGI_MEMORY_005 = {
  code: "FUNGI-MEMORY-005",
  name: "MUTABLE_ALIAS",
  severity: "error",
  message: "A mutable borrow cannot coexist with another active borrow or alias of the same value.",
} as const;

/** An index may be outside the bounds of the target collection. */
export const FUNGI_MEMORY_006 = {
  code: "FUNGI-MEMORY-006",
  name: "BOUNDS_VIOLATION",
  severity: "error",
  message: "Index may be outside collection bounds. Use .get(index) for safe access or prove bounds at compile time.",
} as const;

/** An unchecked access was used outside an approved unsafe block. */
export const FUNGI_MEMORY_007 = {
  code: "FUNGI-MEMORY-007",
  name: "UNCHECKED_ACCESS_OUTSIDE_UNSAFE",
  severity: "error",
  message: "Unchecked index or memory access must be inside an approved unsafe block with a declared reason and fallback.",
} as const;

// --- FUNGI-MEMORY-008: the ONE WIRED memory code (emitter: detectUnsafeBlockWithoutReason) ---

/** An unsafe memory operation has no declared safe fallback. (WIRED — emitted by detectUnsafeBlockWithoutReason.) */
export const FUNGI_MEMORY_008 = {
  code: "FUNGI-MEMORY-008",
  name: "UNSAFE_MEMORY_REQUIRES_FALLBACK",
  severity: "error",
  message: "Unsafe memory operation must declare a safe fallback. Every unsafe block requires a fallback flow.",
} as const;

export const FUNGI_MEMORY_DIAGNOSTICS = [
  FUNGI_MEMORY_001,
  FUNGI_MEMORY_002,
  FUNGI_MEMORY_003,
  FUNGI_MEMORY_004,
  FUNGI_MEMORY_005,
  FUNGI_MEMORY_006,
  FUNGI_MEMORY_007,
  FUNGI_MEMORY_008,
] as const;

// ---------------------------------------------------------------------------
// Compute-target diagnostics — FUNGI-COMPUTE-001
//
// Emitted by the SemanticGraph / ExecutionPlanner (NOT the parser) when a
// flow's body contains patterns incompatible with its declared compute target.
//
// Example trigger: a flow declares `compute { target npu }` but contains
//   `while random()` — non-deterministic iteration cannot map to an NPU.
//
// The parser sets NodeFlags.HasCompute so the compiler knows to check;
// the actual compatibility proof lives in the semantic/planner layer.
// ---------------------------------------------------------------------------

/** FUNGI-COMPUTE-001: Pattern is not compatible with the declared compute target. */
export const FUNGI_COMPUTE_001 = {
  code: "FUNGI-COMPUTE-001",
  name: "ComputeTargetIncompatiblePattern",
  severity: "warning" as const,
  message: "This pattern may not map efficiently to the declared compute target (NPU/GPU/TPU).",
  why: "NPU and GPU targets require deterministic, data-parallel patterns. Non-deterministic control flow (random(), dynamic dispatch, unbounded loops) cannot be compiled to fixed-function hardware.",
  suggestedFix: "Use pure, deterministic operations compatible with the target. Move non-deterministic logic to a CPU-qualified flow.",
} as const;

// ---------------------------------------------------------------------------
// Backend / CLI diagnostics — FUNGI-BACKEND-001
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Build diagnostics — FUNGI-BUILD-001
// ---------------------------------------------------------------------------

/**
 * FUNGI-BUILD-001: Same source produced different output on repeated compilation.
 * Indicates a compiler bug, nondeterministic behaviour, or hidden state leakage.
 */
export const FUNGI_BUILD_001 = {
  code: "FUNGI-BUILD-001",
  name: "NonDeterministicBuild",
  severity: "error" as const,
  message: "Same source produced different output on repeated compilation. This indicates a compiler bug, nondeterministic behaviour, or hidden state leakage.",
  suggestedFix: "Check for: timestamp in output, random values in codegen, hash map iteration order, filesystem enumeration order.",
};

/** FUNGI-BACKEND-001: The CLI or runtime backend encountered an unrecoverable error (e.g. file read failure). */
export const FUNGI_BACKEND_001 = {
  code: "FUNGI-BACKEND-001",
  name: "BackendError",
  severity: "error" as const,
  message: "The Galerina compiler backend encountered an unrecoverable error.",
  why: "A required file could not be read, or an internal pipeline step failed before compilation could begin.",
  suggestedFix: "Check that the file path is correct and that the file is readable.",
};

// ---------------------------------------------------------------------------
// Source-level escape diagnostics — FUNGI-SOURCE-ESCAPE-001
// ---------------------------------------------------------------------------

// Phase 12A — Source Escape Checker
export {
  checkSourceEscapes,
  type EscapeDiagnostic,
  type EscapeCheckResult,
} from "./source-escape-checker.js";

/** FUNGI-SOURCE-ESCAPE-001: Galerina source calls eval() or a dynamic code loading function. */
export const FUNGI_SOURCE_ESCAPE_001 = {
  code: "FUNGI-SOURCE-ESCAPE-001",
  name: "SourceLevelEvalEscape",
  severity: "error" as const,
  message: "Galerina source calls eval() or a dynamic code loading function. This bypasses governance, capability checks, and audit trails.",
  why: "Dynamic code cannot be effect-checked, verified, or audited.",
  suggestedFix: "Replace with a declared flow with explicit effects and capability declarations.",
};

// ---------------------------------------------------------------------------
// Safety diagnostics — FUNGI-SAFETY-001..006
//
// These replace the deprecated Galerina_COMPILER_* diagnostic codes from
// validateCoreSyntaxSafety. All new safety-checker diagnostics must use
// this series. Galerina_COMPILER_* codes are frozen — do not extend them.
// ---------------------------------------------------------------------------

/** A Tri value was used directly as a branch condition without explicit conversion. */
export const FUNGI_SAFETY_001 = {
  code: "FUNGI-SAFETY-001",
  name: "TRI_BRANCH_CONDITION",
  severity: "error",
  message: "Tri values must not be used directly as branch conditions. Use exhaustive match or an explicit conversion policy.",
} as const;

/** An unsafe implicit assignment occurred between Bool, Tri, or Decision types. */
export const FUNGI_SAFETY_002 = {
  code: "FUNGI-SAFETY-002",
  name: "UNSAFE_LOGIC_ASSIGNMENT",
  severity: "error",
  message: "Implicit conversion between Tri, Bool, and Decision is not allowed. Use an explicit policy-bearing conversion flow.",
} as const;

/** A Tri unknown value was mapped to true without policy justification. */
export const FUNGI_SAFETY_003 = {
  code: "FUNGI-SAFETY-003",
  name: "TRI_UNKNOWN_AS_TRUE",
  severity: "error",
  message: "Converting Tri unknown to true requires explicit policy justification. In secure flows, this is always an error.",
} as const;

/** A raw secret literal was detected in source code. */
export const FUNGI_SAFETY_004 = {
  code: "FUNGI-SAFETY-004",
  name: "SECRET_LITERAL",
  severity: "error",
  message: "Source must not contain raw secret literals. Use SecureString or an environment reference.",
} as const;

/** An unsafe dynamic code execution call was detected. */
export const FUNGI_SAFETY_005 = {
  code: "FUNGI-SAFETY-005",
  name: "UNSAFE_DYNAMIC_CODE",
  severity: "error",
  message: "Unsafe dynamic code execution must not appear in Galerina source. Declare intent and use a governed flow.",
} as const;

/** A Tri match block is missing one or more required cases. */
export const FUNGI_SAFETY_006 = {
  code: "FUNGI-SAFETY-006",
  name: "TRI_MATCH_NOT_EXHAUSTIVE",
  severity: "error",
  message: "Tri match must handle all three cases: Positive, Neutral, and Negative.",
} as const;

export const FUNGI_SAFETY_DIAGNOSTICS = [
  FUNGI_SAFETY_001,
  FUNGI_SAFETY_002,
  FUNGI_SAFETY_003,
  FUNGI_SAFETY_004,
  FUNGI_SAFETY_005,
  FUNGI_SAFETY_006,
] as const;

// Phase 18 — Monkey-Patch Checker (source-level SEC-020/021 detection)
export {
  checkMonkeyPatching,
  checkMonkeyPatchingSource,
  type MonkeyPatchDiagnostic,
  type MonkeyPatchCheckResult,
} from "./monkey-patch-checker.js";

// ---------------------------------------------------------------------------
// Security diagnostics — FUNGI-SEC-020..021
//
// Source-level detection: fired by checkMonkeyPatching() / checkMonkeyPatchingSource().
// FUNGI-BACKEND-001 is reserved for the future JS emitter (ambient authority checks).
// ---------------------------------------------------------------------------

/** FUNGI-SEC-020: Runtime behaviour modification is prohibited in Galerina. */
export const FUNGI_SEC_020 = {
  code: "FUNGI-SEC-020",
  name: "RuntimeMutation",
  severity: "error" as const,
  message: "Runtime behaviour modification is prohibited in Galerina. Use adapters, interfaces, or mocks instead of patching runtime objects.",
  suggestedFix: "Declare an adapter implementing the interface, or use a mock in test boundaries.",
} as const;

/** FUNGI-SEC-021: Prototype or object mutation after definition is prohibited. */
export const FUNGI_SEC_021 = {
  code: "FUNGI-SEC-021",
  name: "PrototypeMutation",
  severity: "error" as const,
  message: "Prototype or object mutation after definition is prohibited. Galerina requires declared behaviour.",
  suggestedFix: "Use type declarations, adapters, or explicit contract extensions.",
} as const;

// ---------------------------------------------------------------------------
// Governed surface types — surfaces that require intent declarations
// ---------------------------------------------------------------------------

export type GovernedSurfaceKind =
  | "api.route"
  | "webhook"
  | "payment.flow"
  | "secret.access"
  | "network.call"
  | "ai.invoke"
  | "native.interop"
  | "deployment.action"
  | "unsafe.block"
  | "privileged.flow";

// ---------------------------------------------------------------------------
// Private internal types
// ---------------------------------------------------------------------------

// Mirrors ContentBlockType in @galerina/core — kept local until workspace links are in place.
type ContentBlockType = "html" | "dom" | "script" | "css";

const VALID_CONTENT_BLOCK_TYPES: ReadonlySet<string> = new Set<ContentBlockType>([
  "html", "dom", "script", "css",
]);

interface ContentBlockScope {
  readonly blockType: ContentBlockType;
  readonly marker: string;
  readonly startLine: number;
}

type ContentBlockOpenResult =
  | { readonly kind: "entered"; readonly scope: ContentBlockScope }
  | { readonly kind: "unknown_type"; readonly diagnostics: readonly CompilerDiagnostic[] };

type KnownCoreType = "Bool" | "Tri" | "Decision";

interface KnownSymbol {
  readonly name: string;
  readonly type: KnownCoreType;
  readonly location: SourceLocation;
}

interface FlowScope {
  readonly kind:
    | "flow"
    | "secure flow"
    | "pure flow"
    | "guarded flow"
    | "privileged flow"
    | "unsafe flow"
    | "experimental flow"
    | "unsafe block";
  readonly startLine: number;
  readonly braceDepth: number;
}

interface MatchBlock {
  readonly symbol: KnownSymbol;
  readonly startLine: number;
  readonly braceDepth: number;
  readonly cases: Set<string>;
}

const TRI_CASES = ["Positive", "Neutral", "Negative"] as const;

export function validateCoreSyntaxSafety(
  source: CompilerSourceText,
  options: CoreSyntaxSafetyOptions = {},
): CompilerResult {
  const diagnostics: CompilerDiagnostic[] = [];
  const symbols = new Map<string, KnownSymbol>();
  const lines = source.text.split(/\r?\n/);
  let flowScope: FlowScope | undefined;
  let matchBlock: MatchBlock | undefined;
  let contentBlockScope: ContentBlockScope | undefined;
  let braceDepth = 0;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();

    // ── Typed content block tracking ─────────────────────────────────────
    // When inside a block, skip all other checks. Brace depth is not updated
    // so that { } in HTML/CSS/JS do not affect Galerina scope tracking.
    if (contentBlockScope !== undefined) {
      if (trimmed === contentBlockScope.marker) {
        contentBlockScope = undefined;
      }
      return;
    }

    // Detect typed content block opens (html/dom/script/css <<MARKER).
    const blockOpen = parseContentBlockOpen(source.file, line, lineNumber);
    if (blockOpen !== undefined) {
      if (blockOpen.kind === "entered") {
        contentBlockScope = blockOpen.scope;
      } else {
        diagnostics.push(...blockOpen.diagnostics);
      }
      return; // block opener line needs no further processing
    }
    // ─────────────────────────────────────────────────────────────────────

    collectFlowSymbols(source.file, line, lineNumber, symbols);
    collectVariableSymbol(source.file, line, lineNumber, symbols);

    const flowStart = parseFlowStart(line, lineNumber, braceDepth);

    if (flowStart !== undefined) {
      flowScope = flowStart;
    }

    if (matchBlock !== undefined) {
      collectMatchCases(line, matchBlock);
    }

    if (matchBlock === undefined) {
      matchBlock = parseTriMatchStart(source.file, line, lineNumber, braceDepth, symbols);
    }

    diagnostics.push(
      ...detectTriBranchCondition(source.file, line, lineNumber, symbols),
      ...detectUnsafeCoreAssignment(source.file, line, lineNumber, symbols),
      ...detectRiskyTriBoolPolicy(source.file, line, lineNumber, flowScope),
      ...detectUnsupportedBindingKeyword(source.file, line, lineNumber),
      ...detectMutInPureFlow(source.file, line, lineNumber, flowScope),
      ...detectUnsafeBlockWithoutReason(source.file, line, lineNumber),
      ...detectRawPointerOutsideUnsafe(source.file, line, lineNumber, flowScope),
    );

    if (options.scanSecrets ?? true) {
      diagnostics.push(...detectSecretLiteral(source.file, line, lineNumber));
    }

    if (options.scanUnsafeDynamicCode ?? true) {
      diagnostics.push(...detectUnsafeDynamicCode(source.file, line, lineNumber));
    }

    braceDepth += countBraceDelta(line);

    if (
      matchBlock !== undefined &&
      braceDepth < matchBlock.braceDepth
    ) {
      diagnostics.push(...validateTriMatchExhaustive(source.file, matchBlock));
      matchBlock = undefined;
    }

    if (flowScope !== undefined && braceDepth < flowScope.braceDepth) {
      flowScope = undefined;
    }

    if (trimmed === "") {
      return;
    }
  });

  if (matchBlock !== undefined) {
    diagnostics.push(...validateTriMatchExhaustive(source.file, matchBlock));
  }

  // Report any typed content block that was opened but never closed.
  if (contentBlockScope !== undefined) {
    diagnostics.push(
      createCompilerDiagnostic(
        FUNGI_BLOCK_002.code,
        FUNGI_BLOCK_002.name,
        FUNGI_BLOCK_002.severity,
        `${contentBlockScope.blockType} block opened with marker ${contentBlockScope.marker} is never closed.`,
        { file: source.file, line: contentBlockScope.startLine, column: 1 },
      ),
    );
  }

  return {
    ok: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    diagnostics,
    reports: [],
  };
}

/**
 * Validates a typed content block at the AST level.
 *
 * Stage 1 status: STUB — returns empty diagnostics.
 * Full implementation (Stage 2) will validate block content based on type:
 *   html/dom — HTML structure validation
 *   script   — JavaScript syntax check; FUNGI-BLOCK-004 secret detection
 *   css      — CSS property/selector validation
 *
 * TODO FUNGI-BLOCK-004: detect ProtectedSecret references interpolated into script blocks.
 */
export function validateTypedContentBlock(_input: {
  readonly blockType: "html" | "dom" | "script" | "css";
  readonly marker: string;
  readonly content: string;
  readonly file: string;
  readonly startLine: number;
}): readonly CompilerDiagnostic[] {
  return [];
}

function collectFlowSymbols(
  file: string,
  line: string,
  lineNumber: number,
  symbols: Map<string, KnownSymbol>,
): void {
  const flowMatch = line.match(
    /^\s*(?:secure\s+|pure\s+)?flow\s+[A-Za-z_][A-Za-z0-9_]*\s*\(([^)]*)\)/,
  );

  if (flowMatch?.[1] === undefined) {
    return;
  }

  for (const parameter of flowMatch[1].split(",")) {
    const parameterMatch = parameter.match(
      /\b([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(Bool|Tri|Decision)\b/,
    );

    if (parameterMatch?.[1] === undefined || parameterMatch[2] === undefined) {
      continue;
    }

    symbols.set(parameterMatch[1], {
      name: parameterMatch[1],
      type: parameterMatch[2] as KnownCoreType,
      location: { file, line: lineNumber, column: line.indexOf(parameterMatch[1]) + 1 },
    });
  }
}

function collectVariableSymbol(
  file: string,
  line: string,
  lineNumber: number,
  symbols: Map<string, KnownSymbol>,
): void {
  const variableMatch = line.match(
    /^\s*(?:let|const)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(Bool|Tri|Decision)\b/,
  );

  if (variableMatch?.[1] === undefined || variableMatch[2] === undefined) {
    return;
  }

  symbols.set(variableMatch[1], {
    name: variableMatch[1],
    type: variableMatch[2] as KnownCoreType,
    location: { file, line: lineNumber, column: line.indexOf(variableMatch[1]) + 1 },
  });
}

function parseFlowStart(
  line: string,
  lineNumber: number,
  braceDepth: number,
): FlowScope | undefined {
  // Match: [safety-level] flow <name> or unsafe block <name>
  const flowMatch = line.match(
    /^\s*(secure\s+|pure\s+|guarded\s+|privileged\s+|unsafe\s+|experimental\s+)?(?:(flow)\b|(block)\b)/,
  );

  if (flowMatch === null) {
    return undefined;
  }

  // "unsafe block" is distinct from "unsafe flow"
  const isBlock = flowMatch[3] === "block";
  const prefix = flowMatch[1]?.trim() ?? "";

  let kind: FlowScope["kind"];

  if (isBlock && prefix === "unsafe") {
    kind = "unsafe block";
  } else {
    switch (prefix) {
      case "secure":       kind = "secure flow";       break;
      case "pure":         kind = "pure flow";         break;
      case "guarded":      kind = "guarded flow";      break;
      case "privileged":   kind = "privileged flow";   break;
      case "unsafe":       kind = "unsafe flow";       break;
      case "experimental": kind = "experimental flow"; break;
      default:             kind = "flow";              break;
    }
  }

  return {
    kind,
    startLine: lineNumber,
    braceDepth: braceDepth + Math.max(countBraceDelta(line), 1),
  };
}

/**
 * Validates that declared intent and effects are consistent with inferred behavior.
 *
 * Stage 1 status: STUB — returns an empty result.
 * Full implementation requires the compiler AST to carry FlowDeclarationMetadata.
 * Wire up in Stage 3 once the parser emits intent/effect nodes.
 *
 * TODO FUNGI-INTENT-001: check inferred effects against declared effects.
 * TODO FUNGI-INTENT-002: require intent on governed surfaces.
 * TODO FUNGI-INTENT-003: require unsafe blocks to declare reason + fallback.
 * TODO FUNGI-INTENT-004: require privileged flows to declare capability.
 * TODO FUNGI-INTENT-005: block experimental flows in production targets.
 */
export function validateIntentEffects(
  _flowName: string,
  _safetyLevel: CompilerSafetyLevel,
  _intent: string | undefined,
  _declaredEffects: readonly string[],
  _inferredEffects: readonly string[],
  _isProductionTarget: boolean,
): IntentCheckResult {
  return {
    flowName: _flowName,
    safetyLevel: _safetyLevel,
    ...(_intent === undefined ? {} : { intent: _intent }),
    declaredEffects: [..._declaredEffects],
    inferredEffects: [..._inferredEffects],
    mismatches: [],
    diagnostics: [],
  };
}

function parseTriMatchStart(
  file: string,
  line: string,
  lineNumber: number,
  braceDepth: number,
  symbols: Map<string, KnownSymbol>,
): MatchBlock | undefined {
  const match = line.match(/^\s*match\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/);

  if (match?.[1] === undefined) {
    return undefined;
  }

  const symbol = symbols.get(match[1]);

  if (symbol?.type !== "Tri") {
    return undefined;
  }

  return {
    symbol: {
      ...symbol,
      location: { file, line: lineNumber, column: line.indexOf(match[1]) + 1 },
    },
    startLine: lineNumber,
    braceDepth: braceDepth + 1,
    cases: new Set<string>(),
  };
}

function collectMatchCases(line: string, matchBlock: MatchBlock): void {
  const caseMatch = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=>/);

  if (caseMatch?.[1] !== undefined) {
    matchBlock.cases.add(caseMatch[1]);
  }
}

function detectTriBranchCondition(
  file: string,
  line: string,
  lineNumber: number,
  symbols: Map<string, KnownSymbol>,
): readonly CompilerDiagnostic[] {
  const conditionMatch = line.match(/^\s*if\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/);
  const symbol = conditionMatch?.[1] === undefined ? undefined : symbols.get(conditionMatch[1]);

  if (symbol?.type !== "Tri") {
    return [];
  }

  return [
    createCompilerDiagnostic(
      FUNGI_SAFETY_001.code,
      FUNGI_SAFETY_001.name,
      FUNGI_SAFETY_001.severity,
      FUNGI_SAFETY_001.message,
      { file, line: lineNumber, column: line.indexOf(symbol.name) + 1 },
    ),
  ];
}

function detectUnsafeCoreAssignment(
  file: string,
  line: string,
  lineNumber: number,
  symbols: Map<string, KnownSymbol>,
): readonly CompilerDiagnostic[] {
  const assignmentMatch = line.match(
    /^\s*(?:let|const)\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*(Bool|Tri|Decision)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\b/,
  );

  if (assignmentMatch?.[1] === undefined || assignmentMatch[2] === undefined) {
    return [];
  }

  const targetType = assignmentMatch[1] as KnownCoreType;
  const sourceSymbol = symbols.get(assignmentMatch[2]);

  if (sourceSymbol === undefined || sourceSymbol.type === targetType) {
    return [];
  }

  if (
    (sourceSymbol.type === "Tri" && (targetType === "Bool" || targetType === "Decision")) ||
    (sourceSymbol.type === "Decision" && targetType === "Tri")
  ) {
    return [
      createCompilerDiagnostic(
        FUNGI_SAFETY_002.code,
        FUNGI_SAFETY_002.name,
        FUNGI_SAFETY_002.severity,
        `${sourceSymbol.type} must not implicitly convert to ${targetType}. Use an explicit policy-bearing conversion flow.`,
        { file, line: lineNumber, column: line.indexOf(sourceSymbol.name) + 1 },
      ),
    ];
  }

  return [];
}

function detectRiskyTriBoolPolicy(
  file: string,
  line: string,
  lineNumber: number,
  flowScope: FlowScope | undefined,
): readonly CompilerDiagnostic[] {
  const secure = flowScope?.kind === "secure flow";

  // Case 1: an EXPLICIT `unknown_as: true` / `unknown_as_true` policy. This was
  // always flagged — converting the indeterminate (Neutral/HOLD) state to `true`
  // is risky, and forbidden outright in secure flows.
  if (/\bunknown_as(?:\s*:\s*true|_true)\b/.test(line)) {
    return [
      createCompilerDiagnostic(
        FUNGI_SAFETY_003.code,
        FUNGI_SAFETY_003.name,
        secure ? "error" : "warning",
        secure
          ? "secure flow must not convert Tri unknown to true."
          : "Converting Tri unknown to true is risky and must be justified by policy.",
        { file, line: lineNumber, column: line.search(/\bunknown_as/) + 1 },
      ),
    ];
  }

  // Case 2 (FAIL-CLOSED, #153): a Tri→Bool / Tri→Decision conversion with NO
  // explicit policy for the unknown (Neutral/HOLD) state. Previously this was
  // silently accepted — the HOLD state could collapse to a default value (and a
  // truthy default is the dangerous case). Deny-by-default: every conversion
  // must declare how the unknown state is handled via an `unknown_as:` clause.
  const conversionMatch = line.match(/\b[Tt]ri\.(toBool|toDecision)\s*\(/);
  if (conversionMatch !== null && !/\bunknown_as\b/.test(line)) {
    const method = conversionMatch[1];
    const col = line.search(/\b[Tt]ri\.(?:toBool|toDecision)/);
    return [
      createCompilerDiagnostic(
        FUNGI_SAFETY_003.code,
        FUNGI_SAFETY_003.name,
        secure ? "error" : "warning",
        secure
          ? `secure flow must not call Tri.${method} without an explicit unknown-state policy (e.g. unknown_as: Negative). The Neutral/HOLD state must never silently coerce to a truthy default.`
          : `Tri.${method} without an explicit unknown-state policy is risky: the Neutral/HOLD state may silently coerce to a default. Declare unknown_as: to make the conversion fail-closed.`,
        { file, line: lineNumber, column: col >= 0 ? col + 1 : 1 },
      ),
    ];
  }

  return [];
}

function detectSecretLiteral(
  file: string,
  line: string,
  lineNumber: number,
): readonly CompilerDiagnostic[] {
  const secretMatch = line.match(
    /\b(api[_-]?key|token|secret|password)\b\s*[:=]\s*"([^"]+)"/i,
  );

  if (secretMatch?.[2] === undefined || isPlaceholderSecret(secretMatch[2])) {
    return [];
  }

  return [
    createCompilerDiagnostic(
      FUNGI_SAFETY_004.code,
      FUNGI_SAFETY_004.name,
      FUNGI_SAFETY_004.severity,
      FUNGI_SAFETY_004.message,
      { file, line: lineNumber, column: line.indexOf(secretMatch[2]) + 1 },
    ),
  ];
}

function detectUnsafeDynamicCode(
  file: string,
  line: string,
  lineNumber: number,
): readonly CompilerDiagnostic[] {
  if (!/\b(?:eval|Function|unsafe_exec|raw_shell)\s*\(/.test(line)) {
    return [];
  }

  return [
    createCompilerDiagnostic(
      FUNGI_SAFETY_005.code,
      FUNGI_SAFETY_005.name,
      FUNGI_SAFETY_005.severity,
      FUNGI_SAFETY_005.message,
      { file, line: lineNumber, column: Math.max(line.search(/\b(?:eval|Function|unsafe_exec|raw_shell)\s*\(/) + 1, 1) },
    ),
  ];
}

function validateTriMatchExhaustive(
  file: string,
  matchBlock: MatchBlock,
): readonly CompilerDiagnostic[] {
  const missing = TRI_CASES.filter((triCase) => !matchBlock.cases.has(triCase));

  if (missing.length === 0) {
    return [];
  }

  return [
    createCompilerDiagnostic(
      FUNGI_SAFETY_006.code,
      FUNGI_SAFETY_006.name,
      FUNGI_SAFETY_006.severity,
      `Tri match is missing cases: ${missing.join(", ")}.`,
      { file, line: matchBlock.startLine, column: matchBlock.symbol.location.column },
    ),
  ];
}

// Pattern: optional `print ` prefix, then a word, then ` <<MARKER`
// Valid:   html <<HTML, dom <<DOM, script <<SCRIPT, css <<CSS
// Invalid: xml <<XML (unknown type)
const CONTENT_BLOCK_OPEN_RE =
  /^\s*(?:print\s+)?([a-zA-Z][a-zA-Z0-9_]*)\s+<<([A-Z_][A-Z0-9_]*)\s*$/;

function parseContentBlockOpen(
  file: string,
  line: string,
  lineNumber: number,
): ContentBlockOpenResult | undefined {
  const match = line.match(CONTENT_BLOCK_OPEN_RE);

  if (match === null || match[1] === undefined || match[2] === undefined) {
    return undefined;
  }

  const rawType = match[1].toLowerCase();
  const marker = match[2];

  if (!VALID_CONTENT_BLOCK_TYPES.has(rawType)) {
    return {
      kind: "unknown_type",
      diagnostics: [
        createCompilerDiagnostic(
          FUNGI_BLOCK_001.code,
          FUNGI_BLOCK_001.name,
          FUNGI_BLOCK_001.severity,
          `Unknown typed content block type "${rawType}". Valid types are: html, dom, script, css.`,
          { file, line: lineNumber, column: line.search(new RegExp(`\\b${match[1]}\\b`)) + 1 },
        ),
      ],
    };
  }

  return {
    kind: "entered",
    scope: {
      blockType: rawType as ContentBlockType,
      marker,
      startLine: lineNumber,
    },
  };
}

function detectUnsupportedBindingKeyword(
  file: string,
  line: string,
  lineNumber: number,
): readonly CompilerDiagnostic[] {
  const trimmed = line.trim();

  // Ignore comment lines and doc comments
  if (trimmed.startsWith("//") || trimmed.startsWith("///")) {
    return [];
  }

  // Detect `var <identifier>` or `var <identifier>:` as a statement
  if (/^\s*\bvar\s+[A-Za-z_]/.test(line)) {
    return [
      createCompilerDiagnostic(
        FUNGI_SYNTAX_001.code,
        FUNGI_SYNTAX_001.name,
        FUNGI_SYNTAX_001.severity,
        FUNGI_SYNTAX_001.message,
        { file, line: lineNumber, column: line.search(/\bvar\b/) + 1 },
      ),
    ];
  }

  // Detect `const <identifier>` or `const <identifier>:` as a statement
  // Exclude TypeScript-style `export const` — this scanner runs on .fungi files
  if (/^\s*\bconst\s+[A-Za-z_]/.test(line)) {
    return [
      createCompilerDiagnostic(
        FUNGI_SYNTAX_002.code,
        FUNGI_SYNTAX_002.name,
        FUNGI_SYNTAX_002.severity,
        FUNGI_SYNTAX_002.message,
        { file, line: lineNumber, column: line.search(/\bconst\b/) + 1 },
      ),
    ];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Binding and pipeline checker stubs
// ---------------------------------------------------------------------------

/**
 * Checks whether a reassignment targets an immutable binding.
 *
 * Stage 1 status: STUB — returns diagnostics based on binding kind alone.
 * Full implementation requires AST-level binding scope tracking.
 *
 * TODO FUNGI-BINDING-001: reject reassignment of let bindings.
 * TODO FUNGI-BINDING-002: reject reassignment of readonly bindings.
 */
export function checkBindingReassignment(input: {
  readonly bindingKind: "let" | "mut" | "readonly";
  readonly bindingName: string;
  readonly location: SourceLocation;
}): readonly CompilerDiagnostic[] {
  if (input.bindingKind === "let") {
    return [
      createCompilerDiagnostic(
        FUNGI_BINDING_001.code,
        FUNGI_BINDING_001.name,
        FUNGI_BINDING_001.severity,
        `Cannot reassign immutable let binding ${input.bindingName}. Use mut only if reassignment is required.`,
        input.location,
      ),
    ];
  }

  if (input.bindingKind === "readonly") {
    return [
      createCompilerDiagnostic(
        FUNGI_BINDING_002.code,
        FUNGI_BINDING_002.name,
        FUNGI_BINDING_002.severity,
        `Cannot reassign readonly binding ${input.bindingName}.`,
        input.location,
      ),
    ];
  }

  return [];
}

/**
 * Checks whether a property mutation occurs through a readonly binding.
 *
 * Stage 1 status: STUB — returns diagnostic when binding is readonly.
 * Full implementation requires property access tracking in the AST.
 *
 * TODO FUNGI-BINDING-003: reject property mutation through readonly binding.
 */
export function checkReadonlyMutation(input: {
  readonly bindingKind: "let" | "mut" | "readonly";
  readonly bindingName: string;
  readonly propertyName: string;
  readonly location: SourceLocation;
}): readonly CompilerDiagnostic[] {
  if (input.bindingKind !== "readonly") {
    return [];
  }

  return [
    createCompilerDiagnostic(
      FUNGI_BINDING_003.code,
      FUNGI_BINDING_003.name,
      FUNGI_BINDING_003.severity,
      `Cannot mutate property ${input.propertyName} through readonly binding ${input.bindingName}.`,
      input.location,
    ),
  ];
}

/**
 * Validates a method-chain pipeline for type safety, effects, and readonly rules.
 *
 * Stage 1 status: STUB — returns an empty result.
 * Full implementation requires:
 *   - Type scope (to resolve method return types)
 *   - Effect context (to compare declared vs used effects)
 *   - Readonly scope (to detect readonly receiver mutation)
 *
 * TODO FUNGI-PIPELINE-001: reject unknown pipeline methods.
 * TODO FUNGI-PIPELINE-002: reject type mismatches between stages.
 * TODO FUNGI-PIPELINE-003: require Result handling in fallible pipelines.
 * TODO FUNGI-PIPELINE-004: require declared effects for effectful stages.
 * TODO FUNGI-PIPELINE-005: reject readonly receiver mutation.
 */
export function checkMethodChain(_input: {
  readonly receiver: string;
  readonly calls: readonly { readonly methodName: string }[];
  readonly location: SourceLocation;
}): readonly CompilerDiagnostic[] {
  return [];
}

/**
 * Checks whether a `mut` binding is used inside a pure-context flow.
 *
 * Implemented: Phase 3 (binding-level, no AST required).
 * `pure flow` bodies must not contain mutable bindings; callers should use
 * `let` or a functional accumulator (fold, count, filter).
 *
 * @param flowSafetyLevel - The safety level of the enclosing flow.
 * @param bindingName     - Name of the binding declared with `mut`.
 * @param location        - Source location for the diagnostic.
 */
export function checkMutInPureContext(input: {
  readonly flowSafetyLevel: "pure" | "safe" | "secure" | "guarded" | "privileged" | "unsafe" | "experimental";
  readonly bindingName: string;
  readonly location: SourceLocation;
}): readonly CompilerDiagnostic[] {
  if (input.flowSafetyLevel !== "pure") {
    return [];
  }

  return [
    createCompilerDiagnostic(
      FUNGI_BINDING_004.code,
      FUNGI_BINDING_004.name,
      FUNGI_BINDING_004.severity,
      `mut binding ${input.bindingName} is not allowed in a pure flow. Use let or a functional accumulator (fold, count, filter).`,
      input.location,
    ),
  ];
}

/**
 * Emits FUNGI-BINDING-004 when a `mut` binding declaration appears inside a
 * `pure flow` body. `pure flow` contexts forbid all mutable state.
 *
 * Phase 3 binding-level rule — no AST required. Full effect tracking
 * (including deeply nested pure closures) is Phase 5 work.
 */
function detectMutInPureFlow(
  file: string,
  line: string,
  lineNumber: number,
  flowScope: FlowScope | undefined,
): readonly CompilerDiagnostic[] {
  if (flowScope?.kind !== "pure flow") {
    return [];
  }

  const trimmed = line.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("///")) {
    return [];
  }

  // Match `mut <identifier>` as a binding declaration (not a type name or argument label)
  const mutMatch = line.match(/^\s*\bmut\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
  if (mutMatch === null || mutMatch[1] === undefined) {
    return [];
  }

  return [
    createCompilerDiagnostic(
      FUNGI_BINDING_004.code,
      FUNGI_BINDING_004.name,
      FUNGI_BINDING_004.severity,
      `mut binding "${mutMatch[1]}" is not allowed in a pure flow. Use let or a functional accumulator (fold, count, filter).`,
      { file, line: lineNumber, column: line.search(/\bmut\b/) + 1 },
    ),
  ];
}

/**
 * Emits FUNGI-MEMORY-008 when an `unsafe block` opening line is missing a
 * `reason` declaration. Every unsafe block must declare a human-readable
 * reason justification on the same line as the block header.
 *
 * Syntax required: unsafe block <name> reason "<text>" fallback <safeFlow> {
 *
 * Phase 3 binding-level rule. Structural validation of reason/fallback content
 * is Phase 5 (AST) work.
 */
function detectUnsafeBlockWithoutReason(
  file: string,
  line: string,
  lineNumber: number,
): readonly CompilerDiagnostic[] {
  // Only fire on lines that begin an unsafe block scope
  if (!/^\s*\bunsafe\s+block\b/.test(line)) {
    return [];
  }

  // If `reason` keyword already appears on the same line, declaration is present
  if (/\breason\b/.test(line)) {
    return [];
  }

  return [
    createCompilerDiagnostic(
      FUNGI_MEMORY_008.code,
      FUNGI_MEMORY_008.name,
      FUNGI_MEMORY_008.severity,
      `unsafe block must declare a reason on the opening line. Expected: unsafe block <name> reason "<justification>" fallback <safeFlow> { ... }`,
      { file, line: lineNumber, column: line.search(/\bunsafe\b/) + 1 },
    ),
  ];
}

/**
 * Emits FUNGI-RAWPTR-001 when a raw-pointer dereference expression appears
 * outside an approved unsafe block.
 *
 * Galerina bans raw pointer access in normal code. The pattern `*identifier`
 * at the start of an expression (after whitespace, `=`, or `(`) is treated
 * as a pointer dereference. Inside an `unsafe flow` or `unsafe block` scope
 * the expression is permitted.
 *
 * Phase 3 binding-level rule. Type-level pointer tracking is Phase 5 work.
 */
function detectRawPointerOutsideUnsafe(
  file: string,
  line: string,
  lineNumber: number,
  flowScope: FlowScope | undefined,
): readonly CompilerDiagnostic[] {
  // Pointer access is permitted inside unsafe scopes
  if (flowScope?.kind === "unsafe flow" || flowScope?.kind === "unsafe block") {
    return [];
  }

  const trimmed = line.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("///")) {
    return [];
  }

  // Detect `*identifier` as a pointer dereference — after `=`, `(`, or at start
  const ptrMatch = line.match(/(?:^|[=(,\s])\*([A-Za-z_][A-Za-z0-9_]*)\b/);
  if (ptrMatch === null) {
    return [];
  }

  const column = line.search(/(?:^|[=(,\s])\*[A-Za-z_]/) + 1;

  return [
    createCompilerDiagnostic(
      FUNGI_RAWPTR_001.code,
      FUNGI_RAWPTR_001.name,
      FUNGI_RAWPTR_001.severity,
      FUNGI_RAWPTR_001.message,
      { file, line: lineNumber, column },
    ),
  ];
}

function createCompilerDiagnostic(
  code: string,
  name: string,
  severity: CompilerDiagnostic["severity"],
  message: string,
  location?: SourceLocation,
  suggestedFix?: string,
): CompilerDiagnostic {
  return {
    code,
    name,
    severity,
    message,
    ...(location === undefined ? {} : { location }),
    ...(suggestedFix === undefined ? {} : { suggestedFix }),
  };
}

function countBraceDelta(line: string): number {
  let delta = 0;

  for (const character of line) {
    if (character === "{") {
      delta += 1;
    }

    if (character === "}") {
      delta -= 1;
    }
  }

  return delta;
}

function isPlaceholderSecret(value: string): boolean {
  return /^(?:example|placeholder|redacted|change-me|todo|SecureString\(redacted\))$/i.test(
    value,
  );
}

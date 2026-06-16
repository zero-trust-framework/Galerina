export { TowerRuntime } from "./tower-runtime.js";
export { AuditLogger } from "./audit-logger.js";
export type { AuditLoggerOptions, EgressSink } from "./audit-logger.js";
export { PluginSandbox } from "./plugin-sandbox.js";
export type { TowerConfig } from "./tower-runtime.js";
export type { TowerAuditEvent, AuditFilter } from "./audit-logger.js";
export type { PluginMetadata, ExecutionResult } from "./plugin-sandbox.js";

// ── Unified Hybrid Inference Engine — best-of-all-three (BitNet + NVFP4 + Groq) ──
export { HybridInferenceEngine, createHybridEngine } from "./hybrid-engine.js";
export type { HybridInferenceRequest, HybridInferenceReceipt, AiGovernance } from "./hybrid-engine.js";
export {
  routePrecision,
  planHybridInference,
  TECHNIQUE_SOURCE,
  TECHNIQUE_BITS,
  OP_SENSITIVITY,
} from "./precision-strategy.js";
export type {
  PrecisionTechnique,
  SchedulingTechnique,
  InferenceOpClass,
  PrecisionDecision,
  RoutingContext,
  HybridPlan,
} from "./precision-strategy.js";

// ── Virtual Photonic Processor — BitNet-faithful ternary core (TPL Standard v1.0) ──
export { TPLSimulator, TritState, SecurityTrap, TPLIntegrityFault } from "./tpl-simulator.js";
// Balanced-ternary logic gates (#196/#173) — carry-free SUM (== XOR), carry, AND/OR, multiply, consensus.
export {
  negTrit, sumTrit, xorTrit, carryTrit, addTrit, mulTrit, minTrit, maxTrit, consensusTrit,
} from "./tpl-simulator.js";
export { GovernanceEnforcer, TPL_DEFAULT_POLICY } from "./governance-enforcer.js";
export type { TransitionPolicy, RestrictedTransition } from "./governance-enforcer.js";

// ── Three-valued governance verdicts (Direction A) — proved fail-closed ──
// Kleene K3 over the trit (vAnd=minTrit ∧, vOr=maxTrit ∨, vNot=negTrit ¬); collapse
// at the trust boundary (0,-1 → deny); LLN-GOV-3VL-001 audits 0→deny. Never silent.
export {
  Verdict, vAnd, vOr, vNot, allOf, anyOf, collapse, authorize,
  decideAtBoundary, GOV_3VL_DIAGNOSTIC,
} from "./three-valued-governance.js";
export type { GovernanceDiagnostic, BoundaryDecision } from "./three-valued-governance.js";

// ── Substrate failure-mode model (Direction C) — seeded, fail-closed ──
// Models photonic/ternary noise (phase-drift/crosstalk/lane-failure/readout) in software.
// effectiveVerdict = vAnd(ideal, reading): noise can cost availability, never safety.
// Canonical check = closed-form von Neumann NMR; NoisyLane is the seeded fault-injector.
// LLN-SUBSTRATE-001..004. Compiler/substrate{}-grammar wiring is deferred to Direction B.
export {
  SubstrateParamError, singleLaneErrorProbability, nmrFailureProbability, majorityVote,
  NoisyLane, effectiveVerdict, checkGuarantee, verifyToleranceUnderNoise,
  empiricalAdversarialError, votedTrit3, SUBSTRATE_DIAGNOSTICS,
} from "./substrate-model.js";
export type {
  SubstrateParameters, Reading, Neighbors, SubstrateGuarantee, SubstrateCheckResult,
  SubstrateDiagnostic, SubstrateVerifyContext, SubstrateProfile, SubstrateDecision,
} from "./substrate-model.js";

// ── Hardware Execution Bridge — the Brain/Brawn seam (native FFI contract) ──
export { assertDeterminism } from "./bridge/interface.js";

// ── Bridge attestation (CF-3 / CF-7) — signed manifest verification ──
export {
  attestationHash, signManifest, verifyAttestation, generateAttestationKeypair, attestBridge,
  signManifestHybrid, verifyAttestationHybrid, generateHybridAttestationKeypair,
} from "./bridge-attestation.js";
export type { AttestationPolicy, AttestationResult } from "./bridge-attestation.js";

// ── Numeric policy table — ai{} compiled once into packed flags + membership Set ──
export {
  compilePolicy,
  POL_HAS_ALLOWLIST, POL_DENY_HOST_NATIVE, POL_HAS_CALL_BUDGET, POL_HAS_TOKEN_BUDGET, POL_HAS_COST_CEILING,
} from "./compiled-policy.js";
export type { CompiledPolicy, PolicyTrap } from "./compiled-policy.js";

// ── GateCache — memoize the COMPILED governance evaluator, NEVER the decision (#194) ──
export {
  GateCache, defaultGateCache, compilePolicyCached, policyCacheKey,
} from "./gate-cache.js";
export type { GateCacheStats } from "./gate-cache.js";
export type { InferenceBridge, BridgeOp, BridgeResult, BridgeRegistry } from "./bridge/interface.js";
export { StubTernaryBridge, StubFp4Bridge, createStubRegistry } from "./bridge/stub-provider.js";

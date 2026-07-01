// =============================================================================
// Galerina Phase 18D — Type Registry Constants
//
// TypeId, EffectFlags, and ComputeCompatibilityFlags — numeric representations
// of types, effects, and compute properties for fast internal comparisons.
//
// Principle: use IDs internally; use string names only for diagnostics.
//
// Phase 18D: export the constants. The type checker still uses BUILT_IN_TYPES
//   (string Set) internally — migration to TypeId happens in Phase 19.
// Phase 19:  type-checker.ts migrates hot-path comparisons to TypeId.
// Phase 21+: full TypeRegistry with shape fingerprints, structural checks.
// =============================================================================

// ---------------------------------------------------------------------------
// TypeId — numeric identifiers for built-in Galerina types
//
// Use TypeId.Int instead of the string "Int" in hot-path comparisons.
// Custom/user-defined types are assigned IDs >= 1000 by the symbol resolver.
// ---------------------------------------------------------------------------

export const TypeId = {
  // Sentinel
  Unknown:      0,

  // Unit / void
  Void:         1,
  Unit:         2,

  // Logical
  Bool:         3,
  Tri:          4,

  // Integer
  Int:          5,
  Int8:         6,
  Int16:        7,
  Int32:        8,
  Int64:        9,
  UInt8:        10,
  UInt16:       11,
  UInt32:       12,
  UInt64:       13,

  // Floating point
  Float16:      14,
  Float32:      15,
  Float64:      16,
  Double:       17,
  Decimal:      18,

  // Text
  String:       19,
  Char:         20,
  SecureString: 21,

  // Binary
  Byte:         22,
  Bytes:        23,

  // Temporal
  Timestamp:    24,
  Duration:     25,
  Date:         26,
  Time:         27,
  DateTime:     28,

  // JSON
  Json:         29,

  // Collections
  Array:        30,
  List:         31,
  Set:          32,
  Map:          33,
  Option:       34,
  Result:       35,

  // Compute / AI
  Tensor:       36,
  AnyTensor:    37,
  Vector:       38,
  Matrix:       39,

  // Security
  Hash:         40,
  Signature:    41,
  Secret:       42,

  // HTTP / API
  Request:      43,
  Response:     44,
  Context:      45,

  // Domain / financial
  Money:        46,

  // Branded
  Brand:        47,

  // AI types
  Prompt:       48,
  Embedding:    49,
  Classification: 50,
  ModelOutput:  51,

  // Governance
  AuditRecord:  52,
  AuditProof:   53,
  ExecutionPlan: 54,
  RuntimeReport: 55,

  // Custom types start at 1000 (assigned by symbol resolver)
} as const;

export type TypeIdValue = typeof TypeId[keyof typeof TypeId];

/**
 * Reverse map: type string name → TypeId numeric value.
 * Populated from TypeId constant.
 */
export const TYPE_NAME_TO_ID: ReadonlyMap<string, TypeIdValue> = new Map(
  Object.entries(TypeId).map(([name, id]) => [name, id as TypeIdValue]),
);

/**
 * Look up a TypeId by name. Returns TypeId.Unknown for unrecognised types.
 * Handles qualifier stripping (e.g. "protected Email" → "Email").
 */
export function resolveTypeId(typeName: string): TypeIdValue {
  // Strip qualifiers: "protected Email" → "Email", "redacted String" → "String"
  const bare = typeName.replace(/^(protected|redacted|unsafe|safe|secret)\s+/, "").trim();
  // Strip generic args: "Array<Int>" → "Array", "Tensor<Float32, [768]>" → "Tensor"
  const base = bare.indexOf("<") >= 0 ? bare.slice(0, bare.indexOf("<")).trim() : bare;
  return (TYPE_NAME_TO_ID.get(base) ?? TypeId.Unknown) as TypeIdValue;
}

// ---------------------------------------------------------------------------
// EffectFlags — bitset for common Galerina effects
//
// Enables fast subset checking: requiredEffects ⊆ declaredEffects becomes
//   (required & declared) === required
//
// Keep full effect names for diagnostics/reports. Use flags only in hot-path.
// Canonical list: the `EffectFlags` const immediately below (the inline source of truth).
// ---------------------------------------------------------------------------

export const EffectFlags = {
  None:            0,
  DatabaseRead:    1 << 0,   // database.read
  DatabaseWrite:   1 << 1,   // database.write
  NetworkOutbound: 1 << 2,   // network.outbound
  AuditWrite:      1 << 3,   // audit.write
  AiInference:     1 << 4,   // ai.inference / ai.remoteInference
  NetworkInbound:  1 << 5,   // network.inbound (webhooks, callbacks)
  StorageRead:  1 << 6,   // storage.read
  StorageWrite: 1 << 7,   // storage.write
  CryptoVerify:    1 << 8,   // crypto.verify / crypto.password.verify
  SecretAccess:    1 << 9,   // secret.access
  StateRead:       1 << 10,  // state.read
  StateWrite:      1 << 11,  // state.write
  MessagePublish:  1 << 12,  // message.publish
  ModelTrain:      1 << 13,  // ai.train (privileged)
} as const;

export type EffectFlagsMask = number;

const EFFECT_NAME_TO_FLAG: ReadonlyMap<string, EffectFlagsMask> = new Map([
  ["database.read",              EffectFlags.DatabaseRead],
  ["database.write",             EffectFlags.DatabaseWrite],
  ["network.outbound",           EffectFlags.NetworkOutbound],
  ["audit.write",                EffectFlags.AuditWrite],
  ["ai.inference",               EffectFlags.AiInference],
  ["ai.remoteInference",         EffectFlags.AiInference],
  ["network.inbound",            EffectFlags.NetworkInbound],
  ["storage.read",            EffectFlags.StorageRead],
  ["storage.write",           EffectFlags.StorageWrite],
  ["crypto.verify",              EffectFlags.CryptoVerify],
  ["crypto.password.verify",     EffectFlags.CryptoVerify],
  ["secret.access",              EffectFlags.SecretAccess],
  // FUNGI-EFFECT reconciliation (2026-07-01): secret.read/secret.write are the
  // canonical fine-grained names in effect-checker.ts, but were absent here, so
  // effectsToFlags(["secret.read"]) returned 0 (mask-invisible) — a latent
  // fail-open in the fast subset check. Map them to the SecretAccess bit.
  ["secret.read",                EffectFlags.SecretAccess],
  ["secret.write",               EffectFlags.SecretAccess],
  ["state.read",                 EffectFlags.StateRead],
  ["state.write",                EffectFlags.StateWrite],
  ["message.publish",            EffectFlags.MessagePublish],
  ["ai.train",                   EffectFlags.ModelTrain],
]);

/**
 * Converts an array of effect name strings to a combined EffectFlagsMask.
 * Unknown effects are silently skipped — they are tracked in the full name array.
 *
 * Fast check: (effectsToFlags(required) & declared) === effectsToFlags(required)
 */
export function effectsToFlags(effects: readonly string[]): EffectFlagsMask {
  let mask = EffectFlags.None;
  for (const effect of effects) {
    const flag = EFFECT_NAME_TO_FLAG.get(effect);
    if (flag !== undefined) mask |= flag;
  }
  return mask;
}

/**
 * Returns true when all required effects are declared.
 * Fast bitset subset check: requiredEffects ⊆ declaredEffects.
 */
export function effectsSubset(required: EffectFlagsMask, declared: EffectFlagsMask): boolean {
  return (required & declared) === required;
}

// ---------------------------------------------------------------------------
// ComputeCompatibilityFlags — compiler-proven compute properties
//
// Set by the type checker on flows whose types + body satisfy the property.
// The SemanticGraph and ExecutionPlanner map these to hardware targets.
// The type checker proves properties; the backend makes placement decisions.
// ---------------------------------------------------------------------------

export const ComputeCompatibilityFlags = {
  None:             0,
  TensorCompilable: 1 << 0,  // all ops are tensor ops with no dynamic shapes
  PureMath:         1 << 1,  // only mathematical operations, no I/O or side effects
  FixedShape:       1 << 2,  // all tensor shapes are statically known at compile time
  NoDynamicBranch:  1 << 3,  // no runtime-dependent control flow (suitable for NPU)
  ReadonlyInputs:   1 << 4,  // all params are readonly — safe for APU shared memory
  SIMDCompatible:   1 << 5,  // element-wise operations can use SIMD
  QuantizationSafe: 1 << 6,  // types allow Int8 quantization without lossy error
} as const;

export type ComputeCompatibilityFlagsMask = number;

// ---------------------------------------------------------------------------
// NativeCapabilityId — reserved IDs for native acceleration modules
//
// These are the capability IDs that native (non-WASM) modules must declare.
// Gated identically to any other effect — must appear in contract.effects.
// The runtime resolves: ai.inference → host.npu.inference (if NPU available).
//
// Architecture rule: WASM governs, native accelerates, Galerina proves the boundary.
// See: docs/Knowledge-Bases/galerina-hybrid-wasm-architecture.md
// ---------------------------------------------------------------------------

export const NativeCapabilityId = {
  NpuInference:       "host.npu.inference",
  GpuCompute:         "host.gpu.compute",
  GpuMatmul:          "host.gpu.matmul",
  ApuSharedMemory:    "host.apu.shared_memory",
  WasmSimd:           "host.wasm.simd",       // WASM SIMD (still WASM)
  PhotonicBridge:     "host.photonic.bridge", // Phase 29+
} as const;

export type NativeCapabilityIdValue = typeof NativeCapabilityId[keyof typeof NativeCapabilityId];

/**
 * Maps Galerina effect names to their preferred native capability IDs.
 * The runtime selects the best available native target for an effect.
 * Fallback: CPU (always available, no native capability required).
 */
export const EFFECT_TO_NATIVE_CAPABILITY: ReadonlyMap<string, NativeCapabilityIdValue> = new Map([
  ["ai.inference",  NativeCapabilityId.NpuInference],
  ["compute.gpu",   NativeCapabilityId.GpuCompute],
  ["compute.npu",   NativeCapabilityId.NpuInference],
  ["compute.apu",   NativeCapabilityId.ApuSharedMemory],
]);

// ---------------------------------------------------------------------------
// GovernanceFlags — properties proven by the governance verifier
//
// Compact bitmask per flow. Many governance checks become:
//   actualMask & forbiddenMask === 0
//
// Distinct from NodeFlags (parser-detected), EffectCheckerFlags (effect-proven),
// and ComputeCompatibilityFlags (type-proven). These are GOVERNANCE-VERIFIER-proven.
// ---------------------------------------------------------------------------

export const GovernanceFlags = {
  None:              0,
  RequiresAudit:     1 << 0,  // flow uses a governed sink that mandates audit.write
  DenyRemote:        1 << 1,  // flow denies remote.execution (compute governance)
  ContainsPII:       1 << 2,  // flow handles protected or redacted PII data
  AllowsNetwork:     1 << 3,  // flow declares or uses network.outbound
  RequiresActor:     1 << 4,  // contract.context requires actor / user_id field
  ProductionStrict:  1 << 5,  // flow is in production profile and verified error-free
  RequiresIntent:    1 << 6,  // flow is a secure flow requiring an intent declaration
  HasPolicy:         1 << 7,  // flow declares a policy block
} as const;

export type GovernanceFlagsMask = number;

// ---------------------------------------------------------------------------
// RuntimeManifest — per-flow compact governance manifest
//
// The runtime executes FROM this manifest — it does not re-verify governance.
// The manifest is signed by the compiler via the attestation system.
// ---------------------------------------------------------------------------

export interface RuntimeManifest {
  readonly schemaVersion: "fungi.runtime.manifest.v1";
  readonly flow: string;
  readonly qualifier: string;
  readonly requiresAudit: boolean;
  readonly deniesRemote: boolean;
  readonly allowedEffects: readonly string[];
  readonly requiredContext: readonly string[];
  readonly computeTarget: string;
  readonly governanceFlagsMask: GovernanceFlagsMask;
  readonly proofObligations: readonly string[];
  readonly policyPurposes: readonly string[];
  readonly verified: boolean;
  /**
   * Arena memory limit in megabytes, extracted from contract.memory { arena N mb }.
   * Phase 22C: populated by extractArenaLimitMB from the governance verifier.
   * Undefined when no arena memory constraint is declared.
   */
  readonly arenaLimitMb: number | undefined;
}

// ---------------------------------------------------------------------------
// EffectCheckerFlags — properties proven by the effect checker
//
// Distinct from NodeFlags (parser-detected) and ComputeCompatibilityFlags
// (type-checker-proven). These are EFFECT-CHECKER-proven authority properties.
//
// The effect checker sets these on flows that satisfy the condition.
// The ExecutionPlanner uses them to select hardware targets.
// The type checker does NOT set these — authority proofs require effect analysis.
// ---------------------------------------------------------------------------

export const EffectCheckerFlags = {
  None:                  0,
  PureComputeCandidate:  1 << 0,  // no database, network, filesystem, audit, or mutation outside scope
  ParallelSafe:          1 << 1,  // no shared state — can run concurrently
  KernelFusionCandidate: 1 << 2,  // pure math ops — can be fused into one loop
  EffectFree:            1 << 3,  // truly no effects at all (strict subset of PureComputeCandidate)
  ReadyForAPU:           1 << 4,  // readonly + pure + no I/O → APU shared-memory candidate
  ReadyForNPU:           1 << 5,  // pure + no dynamic branch + tensor types → NPU candidate
} as const;

// ---------------------------------------------------------------------------
// HardwareGovernanceClass — classifies hardware by governance authority
//
// Every hardware target in Galerina has a class that determines:
//   - Whether it may be part of the GovernancePlane
//   - What proof level is required before dispatching work to it
//   - What observability guarantees it provides
//
// The Governance Visibility Rule: less observable → stronger proof requirements.
// The Accelerator Sovereignty Rule: no accelerator may become a governance authority.
// ---------------------------------------------------------------------------

/**
 * HardwareGovernanceClass classifies every compute target by its role in
 * the governance hierarchy.
 *
 * GovernancePlane (0):   CPU, WASM, Trusted Runtime.
 *   May: issue leases, enforce policy, evaluate authority, build ProofGraph.
 *   Proof requirement: Standard ProofGraph.
 *
 * ExecutionPlane (1):    GPU, NPU, TPU. Deterministic, observable.
 *   May: execute pre-approved work.
 *   Proof requirement: ProofGraph + Input Seal.
 *
 * AcceleratorPlane (2):  Photonic, Neuromorphic. Partially observable.
 *   May: accelerate approved mathematical operations.
 *   Proof requirement: ProofGraph + Input Seal + Runtime Attestation.
 *
 * ExperimentalPlane (3): Quantum, future novel substrates. Opaque/probabilistic.
 *   May: act as Mathematical Oracle (never governance authority).
 *   Proof requirement: Full proof chain + Post-execution validation.
 */
export const HardwareGovernanceClass = {
  /** CPU, WASM, Trusted Runtime — the sovereign anchor */
  GovernancePlane:   0,
  /** GPU, NPU, TPU — deterministic, observable execution */
  ExecutionPlane:    1,
  /** Photonic, Neuromorphic — partially observable acceleration */
  AcceleratorPlane:  2,
  /** Quantum, future substrates — probabilistic, opaque, needs full proof chain */
  ExperimentalPlane: 3,
} as const;

export type HardwareGovernanceClassId = (typeof HardwareGovernanceClass)[keyof typeof HardwareGovernanceClass];

/**
 * Hardware observability level — numeric enum for type system enforcement.
 *
 * Maps directly to ProofLevel: less observable → higher proof requirement.
 *
 * Governance Visibility Rule:
 *   FullyObservable     → Standard proof
 *   PartiallyObservable → Attested proof
 *   Opaque              → Sealed proof (Input/Output seals required)
 *   Probabilistic       → Escalated / FormalRequired
 *
 * This is a TYPE SYSTEM property — the compiler enforces proof level
 * based on the observability of the hardware target declared in contract.hardware.
 */
export const HardwareObservabilityLevel = {
  FullyObservable:     0,  // CPU, GPU — deterministic registers, fully inspectable
  PartiallyObservable: 1,  // NPU, TPU, ANE — deterministic result but opaque loops
  Opaque:              2,  // Photonic, Neuromorphic — analog/event-driven, partial visibility
  Probabilistic:       3,  // Quantum — wave-function collapse, inherently non-deterministic
} as const;

export type HardwareObservabilityLevelId = (typeof HardwareObservabilityLevel)[keyof typeof HardwareObservabilityLevel];

/**
 * ProofLevel — required proof burden based on hardware observability.
 *
 * ProofLevel is proportional to 1/Observability.
 *
 * Standard     — CPU/WASM (GovernancePlane). ProofGraph only.
 * Attested     — GPU/NPU (ExecutionPlane, fully observable). ProofGraph + ExecutionSignature.
 * Sealed       — NPU/TPU/ANE (ExecutionPlane, opaque loops). ProofGraph + Input/Output Seals.
 * Escalated    — Photonic/Neuromorphic (AcceleratorPlane). + Runtime Attestation.
 * FormalRequired — Quantum (ExperimentalPlane). Full chain + post-execution validation.
 */
export const ProofLevel = {
  Standard:       0,  // CPU, WASM — standard ProofGraph
  Attested:       1,  // GPU, deterministic NPU — + ExecutionSignature
  Sealed:         2,  // NPU, TPU, ANE — + ImmutableInputSeal + OutputSeal
  Escalated:      3,  // Photonic, Neuromorphic — + RuntimeAttestation
  FormalRequired: 4,  // Quantum — + post-execution validation, result sanitisation
} as const;

export type ProofLevelId = (typeof ProofLevel)[keyof typeof ProofLevel];

/**
 * Full hardware trust profile — combines governance class, observability, and proof level.
 * Used by the ProofGraph builder to escalate proof requirements automatically.
 */
export interface HardwareTrustProfile {
  readonly targetId:          string;
  readonly governanceClass:   HardwareGovernanceClassId;
  readonly observabilityLevel: HardwareObservabilityLevelId;
  readonly requiredProofLevel: ProofLevelId;
  readonly requiresInputSeal:  boolean;  // true for Sealed+ targets
  readonly requiresAttestation: boolean; // true for Escalated+ targets
}

/**
 * Legacy string-based observability (for KB/display use).
 * Use HardwareObservabilityLevel (numeric) in type-system enforcement.
 */
export const HardwareObservability = {
  Full:    "full",     // GovernancePlane + ExecutionPlane (CPU, GPU)
  High:    "high",     // ExecutionPlane (NPU, TPU — deterministic but internal state hidden)
  Partial: "partial",  // AcceleratorPlane (photonic, neuromorphic)
  Opaque:  "opaque",   // ExperimentalPlane (quantum — cannot observe without disturbing)
} as const;

/**
 * Complete hardware trust profile map.
 * Maps target IDs to their full trust profile for ProofGraph escalation.
 */
export const HARDWARE_TRUST_PROFILES: ReadonlyMap<string, HardwareTrustProfile> = new Map(
  (
    [
      // GovernancePlane — Standard proof, fully observable
      ["wasm",                   HardwareGovernanceClass.GovernancePlane,  HardwareObservabilityLevel.FullyObservable,     ProofLevel.Standard,       false, false],
      ["wasm.simd128",           HardwareGovernanceClass.GovernancePlane,  HardwareObservabilityLevel.FullyObservable,     ProofLevel.Standard,       false, false],
      ["cpu",                    HardwareGovernanceClass.GovernancePlane,  HardwareObservabilityLevel.FullyObservable,     ProofLevel.Standard,       false, false],
      // ExecutionPlane, fully observable — Attested proof
      ["intel",                  HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.FullyObservable,     ProofLevel.Attested,       false, false],
      ["intel.avx2",             HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.FullyObservable,     ProofLevel.Attested,       false, false],
      ["intel.avx512",           HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.FullyObservable,     ProofLevel.Attested,       false, false],
      ["amd",                    HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.FullyObservable,     ProofLevel.Attested,       false, false],
      ["amd.zen4",               HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.FullyObservable,     ProofLevel.Attested,       false, false],
      ["amd.zen5",               HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.FullyObservable,     ProofLevel.Attested,       false, false],
      ["arm",                    HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.FullyObservable,     ProofLevel.Attested,       false, false],
      ["arm.neon",               HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.FullyObservable,     ProofLevel.Attested,       false, false],
      ["arm.sve2",               HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.FullyObservable,     ProofLevel.Attested,       false, false],
      ["arm.sme2",               HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.FullyObservable,     ProofLevel.Attested,       false, false],
      ["amd.rdna",               HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.FullyObservable,     ProofLevel.Attested,       false, false],
      ["gpu",                    HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.FullyObservable,     ProofLevel.Attested,       false, false],
      // ExecutionPlane, partially observable — Sealed proof (Input/Output seals required)
      ["npu",                    HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.PartiallyObservable, ProofLevel.Sealed,         true,  false],
      ["npu.validation",         HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.PartiallyObservable, ProofLevel.Sealed,         true,  false],
      ["npu.ai",                 HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.PartiallyObservable, ProofLevel.Sealed,         true,  false],
      ["apu",                    HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.PartiallyObservable, ProofLevel.Sealed,         true,  false],
      ["apple.neural_engine",    HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.PartiallyObservable, ProofLevel.Sealed,         true,  false],
      ["apple.silicon",          HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.PartiallyObservable, ProofLevel.Sealed,         true,  false],
      ["google.tpu.inference",   HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.PartiallyObservable, ProofLevel.Sealed,         true,  false],
      ["google.tpu.training",    HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.PartiallyObservable, ProofLevel.Sealed,         true,  false],
      ["google.axion",           HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.FullyObservable,     ProofLevel.Attested,       false, false],
      ["amd.cdna",               HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.PartiallyObservable, ProofLevel.Sealed,         true,  false],
      ["amd.instinct",           HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.PartiallyObservable, ProofLevel.Sealed,         true,  false],
      ["qualcomm.hexagon",       HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.PartiallyObservable, ProofLevel.Sealed,         true,  false],
      // Nvidia GPU targets — ExecutionPlane, partially observable (CUDA opaque loops)
      ["nvidia",                 HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.PartiallyObservable, ProofLevel.Sealed,         true,  false],
      ["nvidia.blackwell",       HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.PartiallyObservable, ProofLevel.Sealed,         true,  false],
      ["nvidia.blackwell.rtx",   HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.PartiallyObservable, ProofLevel.Sealed,         true,  false],
      ["nvidia.blackwell.b200",  HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.PartiallyObservable, ProofLevel.Sealed,         true,  false],
      ["nvidia.hopper",          HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.PartiallyObservable, ProofLevel.Sealed,         true,  false],
      ["nvidia.ada",             HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.PartiallyObservable, ProofLevel.Sealed,         true,  false],
      ["nvidia.ampere",          HardwareGovernanceClass.ExecutionPlane,   HardwareObservabilityLevel.PartiallyObservable, ProofLevel.Sealed,         true,  false],
      // AcceleratorPlane — Escalated proof (+ Runtime Attestation)
      ["photonic",               HardwareGovernanceClass.AcceleratorPlane, HardwareObservabilityLevel.Opaque,             ProofLevel.Escalated,      true,  true ],
      ["neuromorphic",           HardwareGovernanceClass.AcceleratorPlane, HardwareObservabilityLevel.Opaque,             ProofLevel.Escalated,      true,  true ],
      // ExperimentalPlane — FormalRequired proof
      ["quantum",                HardwareGovernanceClass.ExperimentalPlane, HardwareObservabilityLevel.Probabilistic,     ProofLevel.FormalRequired, true,  true ],
    ] as const
  ).map(([targetId, governanceClass, observabilityLevel, requiredProofLevel, requiresInputSeal, requiresAttestation]) => [
    targetId,
    { targetId, governanceClass, observabilityLevel, requiredProofLevel, requiresInputSeal, requiresAttestation } as HardwareTrustProfile,
  ])
);

/**
 * Maps hardware target IDs to their governance class.
 * Used by CostGraph for routing decisions and ProofGraph for proof escalation.
 */
export const HARDWARE_GOVERNANCE_CLASS_MAP: ReadonlyMap<string, HardwareGovernanceClassId> = new Map([
  // GovernancePlane (0) — may issue authority
  ["wasm",                    HardwareGovernanceClass.GovernancePlane],
  ["wasm.simd128",            HardwareGovernanceClass.GovernancePlane],
  ["wasm.wasi",               HardwareGovernanceClass.GovernancePlane],
  ["cpu",                     HardwareGovernanceClass.GovernancePlane],
  // ExecutionPlane (1) — deterministic, observable execution
  ["intel",                   HardwareGovernanceClass.ExecutionPlane],
  ["intel.avx2",              HardwareGovernanceClass.ExecutionPlane],
  ["intel.avx512",            HardwareGovernanceClass.ExecutionPlane],
  ["intel.pcore",             HardwareGovernanceClass.ExecutionPlane],
  ["intel.ecore",             HardwareGovernanceClass.ExecutionPlane],
  ["amd",                     HardwareGovernanceClass.ExecutionPlane],
  ["amd.zen4",                HardwareGovernanceClass.ExecutionPlane],
  ["amd.zen5",                HardwareGovernanceClass.ExecutionPlane],
  ["amd.epyc",                HardwareGovernanceClass.ExecutionPlane],
  ["amd.rdna",                HardwareGovernanceClass.ExecutionPlane],
  ["amd.cdna",                HardwareGovernanceClass.ExecutionPlane],
  ["amd.instinct",            HardwareGovernanceClass.ExecutionPlane],
  ["arm",                     HardwareGovernanceClass.ExecutionPlane],
  ["arm.neon",                HardwareGovernanceClass.ExecutionPlane],
  ["arm.sve2",                HardwareGovernanceClass.ExecutionPlane],
  ["arm.sme2",                HardwareGovernanceClass.ExecutionPlane],
  ["arm.cloud",               HardwareGovernanceClass.ExecutionPlane],
  ["arm.edge",                HardwareGovernanceClass.ExecutionPlane],
  ["npu",                     HardwareGovernanceClass.ExecutionPlane],
  ["npu.validation",          HardwareGovernanceClass.ExecutionPlane],
  ["npu.audit",               HardwareGovernanceClass.ExecutionPlane],
  ["npu.ai",                  HardwareGovernanceClass.ExecutionPlane],
  ["apu",                     HardwareGovernanceClass.ExecutionPlane],
  ["gpu",                     HardwareGovernanceClass.ExecutionPlane],
  ["apple.silicon",           HardwareGovernanceClass.ExecutionPlane],
  ["apple.cpu.arm64",         HardwareGovernanceClass.ExecutionPlane],
  ["apple.gpu.metal",         HardwareGovernanceClass.ExecutionPlane],
  ["apple.neural_engine",     HardwareGovernanceClass.ExecutionPlane],
  ["apple.m_series",          HardwareGovernanceClass.ExecutionPlane],
  ["apple.a_series",          HardwareGovernanceClass.ExecutionPlane],
  ["google.axion",            HardwareGovernanceClass.ExecutionPlane],
  ["google.titanium",         HardwareGovernanceClass.ExecutionPlane],
  ["google.tpu.inference",    HardwareGovernanceClass.ExecutionPlane],
  ["google.tpu.training",     HardwareGovernanceClass.ExecutionPlane],
  ["qualcomm.hexagon",        HardwareGovernanceClass.ExecutionPlane],
  // Nvidia
  ["nvidia",                  HardwareGovernanceClass.ExecutionPlane],
  ["nvidia.blackwell",        HardwareGovernanceClass.ExecutionPlane],
  ["nvidia.blackwell.rtx",    HardwareGovernanceClass.ExecutionPlane],
  ["nvidia.blackwell.b200",   HardwareGovernanceClass.ExecutionPlane],
  ["nvidia.hopper",           HardwareGovernanceClass.ExecutionPlane],
  ["nvidia.ada",              HardwareGovernanceClass.ExecutionPlane],
  ["nvidia.ampere",           HardwareGovernanceClass.ExecutionPlane],
  // AcceleratorPlane (2) — partially observable, needs attestation
  ["photonic",                HardwareGovernanceClass.AcceleratorPlane],
  ["neuromorphic",            HardwareGovernanceClass.AcceleratorPlane],
  // ExperimentalPlane (3) — opaque/probabilistic, needs full proof chain
  ["quantum",                 HardwareGovernanceClass.ExperimentalPlane],
]);

export type EffectCheckerFlagsMask = number;

// ---------------------------------------------------------------------------
// Tensor type parsing helpers
//
// Extracts element type and shape from a Tensor<ElementType, [d1, d2, ...]>
// type string. Used by FUNGI-TYPE-030/031 checking.
// ---------------------------------------------------------------------------

export interface TensorTypeInfo {
  readonly elementType: string;
  readonly dimensions: readonly (number | "dynamic")[];
  readonly valid: boolean;
}

/**
 * Parses a Tensor<ElementType, [d1, d2, ...]> type string into its components.
 *
 * Returns `valid: false` if the string is not a well-formed Tensor type.
 *
 * Examples:
 *   "Tensor<Float32, [768]>"              → { elementType: "Float32", dimensions: [768] }
 *   "Tensor<Float32, [Batch, 768]>"       → { elementType: "Float32", dimensions: ["dynamic", 768] }
 *   "Tensor<Int8, [32, 32]>"             → { elementType: "Int8", dimensions: [32, 32] }
 */
export function parseTensorType(typeName: string): TensorTypeInfo {
  const INVALID: TensorTypeInfo = { elementType: "", dimensions: [], valid: false };

  const trimmed = typeName.trim();
  if (!trimmed.startsWith("Tensor<") || !trimmed.endsWith(">")) return INVALID;

  const inner = trimmed.slice("Tensor<".length, -1).trim();
  const commaIdx = inner.indexOf(",");
  if (commaIdx === -1) return INVALID;

  const elementType = inner.slice(0, commaIdx).trim();
  const shapeRaw = inner.slice(commaIdx + 1).trim();

  if (!shapeRaw.startsWith("[") || !shapeRaw.endsWith("]")) return INVALID;

  const dimStr = shapeRaw.slice(1, -1).trim();
  const dimParts = dimStr === "" ? [] : dimStr.split(",").map((s) => s.trim());

  const dimensions: (number | "dynamic")[] = dimParts.map((d) => {
    const n = Number(d);
    return Number.isFinite(n) && d.match(/^\d+$/) ? n : "dynamic";
  });

  return { elementType, dimensions, valid: true };
}

/**
 * Returns true when two tensor types are element-type compatible.
 * Float32 ← Float32 ✅, Float32 ← Int8 ❌ (→ FUNGI-TYPE-030)
 */
export function tensorElementTypesCompatible(expected: string, actual: string): boolean {
  return expected.trim() === actual.trim();
}

/**
 * Returns true when two tensor shapes are dimension-count compatible.
 * [768] and [768] → true. [Batch, 768] and [768] → false (→ FUNGI-TYPE-031)
 */
export function tensorDimensionCountsCompatible(
  expected: readonly (number | "dynamic")[],
  actual: readonly (number | "dynamic")[],
): boolean {
  return expected.length === actual.length;
}

// ---------------------------------------------------------------------------
// NativePluginManifest — manifest schema for Phase 27 native acceleration plugins
//
// Every native module that provides hardware acceleration (NPU, GPU, APU) must
// declare a manifest satisfying this interface. The manifest is signed by the
// publisher (FUNGI-PKG-005 equivalent for native modules) and verified by the
// host runtime before the plugin is loaded.
//
// Architecture rules enforced by this manifest:
//   Rule 1 (Signed):              hash + signature fields required
//   Rule 2 (Capability-declared): capability field (e.g. "host.npu.inference")
//   Rule 4 (Offset-based memory): allowedInputHandles / allowedOutputHandles
//   Rule 7 (Fallback declared):   fallback field required
//   Phase 27 isolation:           childProcess: true (always child process)
//
// See: docs/Knowledge-Bases/galerina-phase-27-ai-native.md
// See: docs/Knowledge-Bases/galerina-hybrid-wasm-architecture.md
// ---------------------------------------------------------------------------

export interface NativePluginManifest {
  readonly schemaVersion: "fungi.native-plugin.v1";
  readonly name: string;
  readonly capability: string;         // e.g. "host.npu.inference"
  readonly hash: string;               // sha256: content hash of native binary
  readonly signature: string;          // ed25519 signature
  readonly edaArenaLimitMb: number;    // max EDA arena size
  readonly allowedInputHandles: number; // max DataHandles for input
  readonly allowedOutputHandles: number;
  readonly childProcess: true;         // Phase 27: always child process
  readonly fallback: string;           // e.g. "cpu" or "wasm"
}

// ---------------------------------------------------------------------------
// WATAssemblerConfig — configuration for the WAT-to-WASM assembler step
//
// Controls whether the JS assembler or system wabt is used, whether the
// output binary is validated after assembly, and the output format.
// ---------------------------------------------------------------------------

export interface WATAssemblerConfig {
  readonly useSystemWabt: boolean;   // --use-system-wabt flag
  readonly validateOutput: boolean;  // validate .wasm binary after assembly
  readonly outputFormat: "binary" | "text";
}

export const DEFAULT_WAT_ASSEMBLER_CONFIG: WATAssemblerConfig = {
  useSystemWabt: false,    // JS assembler by default
  validateOutput: true,
  outputFormat: "binary",
};

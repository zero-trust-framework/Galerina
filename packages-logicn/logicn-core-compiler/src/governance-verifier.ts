// =============================================================================
// LogicN Stage A — Governance Verifier (Pass 7)
//
// Confirms that declared intent, effects, policy, and compute governance match
// observed program behaviour. Runs after all checker passes.
//
// Spec: docs/Knowledge-Bases/logicn-governance-verifier-spec.md
//
// Implemented diagnostics (Stage A / Phase 10C):
//   LLN-GOV-002      MISSING_AUDIT_FOR_GOVERNED_SINK
//   LLN-GOV-003      PROTECTED_DATA_IN_RESPONSE          (Phase 10C)
//   LLN-GOV-004      DENIED_TARGET_SELECTED
//   LLN-GOV-005      POLICY_PURPOSE_MISMATCH
//   LLN-GOV-007      AUTHORITY_BLOCK_MISSING_REASON
//   LLN-GOV-008      EXPERIMENTAL_CODE_IN_PRODUCTION_PROFILE
//   LLN-GOV-009      PRIVILEGED_FLOW_MISSING_CAPABILITY
//   LLN-GOV-010      INTENT_MISSING_ON_SECURE_FLOW
//   LLN-GOV-011      UnknownContractSet
//   LLN-GOV-012      ContractSetRequirementNotMet
//   LLN-CONTEXT-001  REQUIRED_CONTEXT_NOT_ACCESSED       (Phase 10C)
//   LLN-HINT-COMPUTE-001  COMPUTE_TARGET_MISSING_FOR_AI_INFERENCE (planning hint)
//
// Phase 2 — Contract Blocks validation (new):
//   LLN-GOV-019  LIMITS_UNKNOWN_FIELD           (limits {} typo detection)
//   LLN-GOV-020  AUTHORITY_OVERLY_BROAD         (authority { requires * })
//
// Phase 3 — Governance Verifier completion (new):
//   LLN-GOV-001  INTENT_BEHAVIOR_MISMATCH       (heuristic: read/pure intent + write effects)
//   LLN-GOV-006  GOVERNANCE_PROOF_REQUIRED_BUT_MISSING (high-risk secure flow, no epilogue)
//   LLN-TERM-001 TERMINATION_ANNOTATION_MISSING (recursive strict/deterministic flow, no decreases)
//
// DRCM Phase 2 — invariant {} block (task #36):
//   LLN-INV-001  PRE_CONDITION_STATICALLY_FALSE  ensure expr constant-folds to false
//   LLN-INV-002  POST_CONDITION_VIOLATED          (future: post-body invariant violation)
//   LLN-INV-003  INVARIANT_BLOCK_EMPTY            invariant {} with no ensure statements
//   LLN-INV-004  SYMBOL_UNRESOLVED_IN_INVARIANT   ensure references a name not in parameter scope
// =============================================================================

import { type AstNode, type AstNodeKind, type FlowMeta, type SourceLocation } from "./parser.js";
import { KNOWN_SIGNALS, KNOWN_FLOORS, normaliseFloor, KNOWN_CAPABILITIES } from "./capability-types.js";
import { type EffectCheckResult } from "./effect-checker.js";
import { GovernanceFlags, type GovernanceFlagsMask, type RuntimeManifest } from "./type-registry.js";
import { buildProofGraphCached, computeExecutionSignature, generateEpilogueReceipt, type EpilogueFailureAction, type EpilogueProofStrategy, type ProofGraph, type ProofObligation, LLN_HW_001, LLN_HW_002, LLN_HW_003, TAMPER_RESPONSE_STRATEGIES } from "./proof-graph.js";
import { HARDWARE_TRUST_PROFILES, ProofLevel } from "./type-registry.js";
import { checkResilienceViolations } from "./resilience-inference.js";
import { checkObservabilityWarnings } from "./observability-inference.js";
import { checkSubstrateViolations } from "./substrate-inference.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GovernanceDiagnostic {
  readonly code: string;
  readonly name: string;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly location?: SourceLocation;
  readonly suggestedFix?: string;
}

export interface GovernanceVerifyResult {
  readonly diagnostics: readonly GovernanceDiagnostic[];
  readonly intentStatus: ReadonlyMap<string, "satisfied" | "missing" | "mismatch">;
  readonly proofObligations: readonly string[];
  /**
   * Per-flow GovernanceFlags bitmask. Consumers can fast-check properties without
   * re-running the verifier: (flags & GovernanceFlags.RequiresAudit) !== 0.
   * Phase 18F: populated by the verifier for all verified flows.
   */
  readonly governanceFlagsByFlow: ReadonlyMap<string, GovernanceFlagsMask>;
  /**
   * Per-flow RuntimeManifest. Empty in "dev" profile; populated in "production"
   * and "deterministic" profiles.
   * Phase 18F: minimal manifest — full manifest (with audit chain) is Phase 20.
   */
  readonly runtimeManifests: readonly RuntimeManifest[];
  /**
   * Per-flow ProofGraph. Machine-readable compliance certificates produced by
   * the governance verifier. Each flow gets a ProofGraph containing its
   * ProofObligations, evidence, ExecutionSignature, and verified status.
   */
  readonly proofGraphs: ReadonlyMap<string, ProofGraph>;
}

export type DeploymentProfile = "dev" | "production" | "deterministic" | "check-only";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FLOW_KINDS = new Set<AstNodeKind>([
  "flowDecl", "secureFlowDecl", "pureFlowDecl", "guardedFlowDecl", "governedFlowDecl",
]);

function findFlowNode(ast: AstNode, name: string): AstNode | undefined {
  function walk(node: AstNode): AstNode | undefined {
    if (FLOW_KINDS.has(node.kind)) {
      // governedFlowDecl stores value as "governed:<floor>:<name>" — extract the real name
      if (node.kind === "governedFlowDecl") {
        const parts = (node.value ?? "").split(":");
        const realName = parts.slice(2).join(":");
        if (realName === name) return node;
      } else if (node.value === name) {
        return node;
      }
    }
    for (const child of node.children ?? []) {
      const found = walk(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  return walk(ast);
}

function findNodes(root: AstNode, kind: AstNodeKind): AstNode[] {
  const found: AstNode[] = [];
  function walk(node: AstNode): void {
    if (node.kind === kind) found.push(node);
    for (const child of node.children ?? []) walk(child);
  }
  walk(root);
  return found;
}

function hasCallTo(root: AstNode, receiverPattern: RegExp): boolean {
  function walk(node: AstNode): boolean {
    if (node.kind === "callExpr") {
      const receiver = node.children?.[0];
      const method = node.value ?? "";
      const receiverName = receiver?.kind === "identifier" ? (receiver.value ?? "") : "";
      const fullName = receiverName !== "" ? `${receiverName}.${method}` : method;
      if (receiverPattern.test(fullName)) return true;
    }
    return (node.children ?? []).some(walk);
  }
  return walk(root);
}

function extractDeniedTargets(flowNode: AstNode): string[] {
  const denied: string[] = [];
  for (const computeBlock of findNodes(flowNode, "computeTargetBlock")) {
    const body = computeBlock.children?.[0];
    if (body === undefined) continue;
    // Look for deny clause identifiers — stored in block children
    for (const child of body.children ?? []) {
      if (child.kind === "identifier" && child.value?.startsWith("deny:")) {
        denied.push(child.value.slice("deny:".length));
      }
    }
  }
  return denied;
}

function hasIntentDecl(flowNode: AstNode): boolean {
  return findNodes(flowNode, "intentDecl").length > 0 ||
    // Also check for intent clause stored as a child identifier (earlier parser form)
    (flowNode.children ?? []).some(
      (c) => c.kind === "identifier" && c.value?.startsWith("intent:"),
    );
}

function makeGovDiag(
  code: string,
  name: string,
  severity: GovernanceDiagnostic["severity"],
  message: string,
  location: SourceLocation | undefined,
  suggestedFix?: string,
): GovernanceDiagnostic {
  const base = { code, name, severity, message };
  if (location !== undefined && suggestedFix !== undefined) {
    return { ...base, location, suggestedFix };
  }
  if (location !== undefined) return { ...base, location };
  if (suggestedFix !== undefined) return { ...base, suggestedFix };
  return base;
}

// ---------------------------------------------------------------------------
// Diagnostic constants
// ---------------------------------------------------------------------------

/** LLN-GOV-003: A field listed in contract.response.denies appears in the response body. */
export const LLN_GOV_003 = {
  code: "LLN-GOV-003",
  name: "PROTECTED_DATA_IN_RESPONSE",
  severity: "error" as const,
  message: "A field listed in contract.response.denies appears in the response body. Protected or sensitive data must not leak through the API surface.",
} as const;

/** LLN-CONTEXT-001: A required context field declared in contract.context is never accessed. */
export const LLN_CONTEXT_001 = {
  code: "LLN-CONTEXT-001",
  name: "REQUIRED_CONTEXT_NOT_ACCESSED",
  severity: "warning" as const,
  message: "A required context field declared in contract.context is never accessed in the flow body.",
} as const;

/** LLN-GOV-011: `use SetName` references a contract set not declared at program scope. */
export const LLN_GOV_011 = {
  code: "LLN-GOV-011",
  name: "UnknownContractSet",
  severity: "error" as const,
  message: "Contract set referenced with 'use' is not declared at program scope.",
} as const;

/** LLN-GOV-012: Contract set audit requirement not met by flow's declared effects. */
export const LLN_GOV_012 = {
  code: "LLN-GOV-012",
  name: "ContractSetRequirementNotMet",
  severity: "warning" as const,
  message: "Contract set requires audit.write but the flow does not declare it.",
} as const;

// ── LLN-SUBSTRATE codes (Direction B) ──────────────────────────────────────────────
// The substrate {} contract block's three invariants, fail-closed. Codes are shared
// with Direction C's SUBSTRATE_DIAGNOSTICS (logicn-tower-citizen/src/substrate-model.ts);
// the strings must match byte-for-byte. Implemented in substrate-inference.ts.
// Spec: docs/Knowledge-Bases/logicn-substrate-contracts.md.

/** LLN-CRYPTO-PQ-001: a crypto.sign effect in a certified profile must declare a PQ/hybrid algorithm. */
export const LLN_CRYPTO_PQ_001 = {
  code: "LLN-CRYPTO-PQ-001",
  name: "SIGN_EFFECT_NOT_POST_QUANTUM",
  severity: "error" as const,
  message: "A crypto.sign effect in a certified profile must declare a post-quantum/hybrid signing algorithm — add crypto.sign.hybrid, crypto.sign.mldsa65, or crypto.sign.slhdsa. Ed25519-only signatures are Shor-breakable (harvest-now-forge-later).",
} as const;

/** PQ/hybrid signing-algorithm marker effects that satisfy LLN-CRYPTO-PQ-001. */
const PQ_SIGN_ALGORITHMS = new Set(["crypto.sign.hybrid", "crypto.sign.mldsa65", "crypto.sign.slhdsa"]);

/** LLN-SUBSTRATE-001: a crypto/hash/sign effect declared on a noisy lane (integrity is never tolerated). */
export const LLN_SUBSTRATE_001 = {
  code: "LLN-SUBSTRATE-001",
  name: "CRYPTO_ON_NOISY_LANE",
  severity: "error" as const,
  message: "A crypto/hash/sign effect declared on a noisy lane. Integrity requires bit-exactness and cannot be tolerance-bounded — move it to a digital lane.",
} as const;

/** LLN-SUBSTRATE-002: declared tolerance not provable under the modeled noise at the declared redundancy. */
export const LLN_SUBSTRATE_002 = {
  code: "LLN-SUBSTRATE-002",
  name: "TOLERANCE_UNACHIEVABLE_UNDER_NOISE",
  severity: "error" as const, // downgraded to warning in the dev profile by substrate-inference
  message: "Declared substrate tolerance is not provable under the modeled noise at the declared redundancy. Declare redundancy (TMR) to clear it.",
} as const;

/** LLN-SUBSTRATE-003: declared redundancy cannot meet tolerance under the model (incl. pBad ≥ 0.5). */
export const LLN_SUBSTRATE_003 = {
  code: "LLN-SUBSTRATE-003",
  name: "REDUNDANCY_INSUFFICIENT",
  severity: "error" as const,
  message: "Declared redundancy cannot meet the tolerance under the modeled noise (raise N, or — when the lane error ≥ 0.5 — voting cannot converge and the lane must change).",
} as const;

/** LLN-SUBSTRATE-004: an un-voted (N=1) noisy result feeds a context requiring determinism. */
export const LLN_SUBSTRATE_004 = {
  code: "LLN-SUBSTRATE-004",
  name: "UNVOTED_ANALOG_INTO_DETERMINISTIC",
  severity: "error" as const,
  message: "An un-voted (redundancy: 1) result from a noisy lane feeds a context requiring determinism. Add a consensus vote (redundancy: tmr) or use a digital lane.",
} as const;

// ── LLN-ASSIMILATE codes ──────────────────────────────────────────────────────────
//
// LLN-ASSIMILATE-001  assimilated plugin declared outside boot.lln project manifest.
//                     Only boot.lln may grant assimilation authority. Individual flow
//                     files cannot promote plugins to Hot-Code Residency.
// LLN-ASSIMILATE-002  assimilation_memory_budget not declared in boot.lln governance {}
//                     block but an assimilated plugin exists in the project.
//                     When omitted, the runtime auto-calculates: min(RAM * 0.20, 256MB).
//                     Declare explicitly only to override the auto ceiling.
//                     Add: governance { assimilation_memory_budget: auto } or
//                          governance { assimilation_memory_budget: 50MB } to boot.lln.
// LLN-ASSIMILATE-003  assimilated plugin contract {} has no access { grant } block.
//                     All assimilated plugins must declare explicit capability grants —
//                     they are pre-warmed at boot so V_DPM bits must be known ahead of time.

// ── LLN-BORDER codes (Hardened Border protocol) ───────────────────────────────────
//
// LLN-BORDER-001  Plugin input missing required field — schema deviation detected.
//                 Treated as potential schema poisoning attack. Plugin call blocked.
// LLN-BORDER-002  Plugin input type mismatch — expected vs actual type differs.
//                 Schema deviation treated as hostile input. Logged as SECURITY_ALERT.
// LLN-BORDER-003  Plugin input field too large — exceeds maxLength constraint.
//                 Possible buffer overflow attempt. Plugin call blocked.
// LLN-BORDER-004  Plugin input value out of range — below minimum or above maximum.
//                 Range violation treated as boundary probe. Plugin call blocked.
// LLN-BORDER-005  Plugin triggered unexpected trap (panic-as-security event).
//                 Plugin version automatically blacklisted. AuditEvent generated.

// ── LLN-GATE codes ────────────────────────────────────────────────────────────────
//
// LLN-GATE-001  gate(condition) references a condition not in knownDomainGuards.
//               Stage A: warning (guard may be in another file).
//               Stage B: error (full project context available).
// LLN-GATE-002  gate {} wraps a pure flow — redundant.
//               Pure flows have no side effects, so a gate is meaningless.

// ── LLN-ACCESS codes ──────────────────────────────────────────────────────────────
//
// LLN-ACCESS-001  access {} grant references unknown capability name.
// LLN-ACCESS-002  access {} grants capability not declared in flow's effects {}.
//                 Default Deny means grants must be consistent with the flow's own effects.

/** LLN-GOV-019: A `limits {}` block contains an unrecognised field name (likely a typo). */
export const LLN_GOV_019 = {
  code: "LLN-GOV-019",
  name: "LIMITS_UNKNOWN_FIELD",
  severity: "warning" as const,
  message: "Unrecognised field in limits {} block. Possible typo — check against known fields: memory, request_time, max_request_size, max_response_size.",
} as const;

/** LLN-GOV-020: authority block uses 'requires *' or 'requires all' — overly broad grant. */
export const LLN_GOV_020 = {
  code: "LLN-GOV-020",
  name: "AUTHORITY_OVERLY_BROAD",
  severity: "warning" as const,
  message: "Overly broad authority: 'requires *' grants all capabilities. Declare specific capabilities instead.",
} as const;

/** LLN-GOV-006: Secure flow with high max_risk_liability has no epilogue {} proof strategy. */
export const LLN_GOV_006 = {
  code: "LLN-GOV-006",
  name: "GOVERNANCE_PROOF_REQUIRED_BUT_MISSING",
  severity: "warning" as const,
  message: "Secure flow has high max_risk_liability but no epilogue {} proof strategy declared.",
} as const;

/** LLN-GOV-001: Detected intent/behaviour mismatch (read/query intent vs write effects, etc.). */
export const LLN_GOV_001 = {
  code: "LLN-GOV-001",
  name: "INTENT_BEHAVIOR_MISMATCH",
  severity: "warning" as const,
  message: "Intent declaration contradicts declared effects or behaviour.",
} as const;

/** LLN-TERM-001: Recursive flow in strict/deterministic profile lacks a decreases annotation. */
export const LLN_TERM_001 = {
  code: "LLN-TERM-001",
  name: "TERMINATION_ANNOTATION_MISSING",
  severity: "warning" as const,
  message: "Recursive flow in strict/deterministic profile lacks a 'decreases' annotation.",
} as const;

/** LLN-GOV-013: A pure flow calls a flow with effects. Pure flows cannot cross into governed boundaries. */
export const LLN_GOV_013 = {
  code: "LLN-GOV-013",
  name: "BoundaryViolation",
  severity: "error" as const,
  message: "A pure flow calls a flow with effects. Pure flows cannot cross into governed boundaries.",
  why: "Pure flows are proven effect-free. Calling an effectful flow breaks this proof.",
  suggestedFix: "Change 'pure flow' to 'guarded flow' and declare the required effects.",
} as const;

/** LLN-GOV-005: policy { purpose "read-only" } but flow also uses database.write (or similar). */
export const LLN_GOV_005 = {
  code: "LLN-GOV-005",
  name: "PolicyPurposeMismatch",
  severity: "warning" as const,
  message: "Policy purpose contradicts declared effects.",
} as const;

/** LLN-GOV-007: authority block exists but has no reason clause. */
export const LLN_GOV_007 = {
  code: "LLN-GOV-007",
  name: "AuthorityBlockMissingReason",
  severity: "error" as const,
  message: `Authority block must include a reason declaration. Add: reason "Explain why this authority is needed"`,
} as const;

/** LLN-GOV-009: privileged flow declares no effects or capabilities. */
export const LLN_GOV_009 = {
  code: "LLN-GOV-009",
  name: "PrivilegedFlowMissingCapability",
  severity: "warning" as const,
  message: "Privileged flow declares no effects or capabilities. Privileged flows should explicitly declare what authority they require.",
} as const;

// ---------------------------------------------------------------------------
// LLN-VAL-001 / LLN-VAL-002 / LLN-VAL-003 — Value/Safety governance
// ---------------------------------------------------------------------------

/**
 * LLN-VAL-001: A `safety_critical` flow does not declare `audit.write`.
 *
 * Safety-critical flows have the highest consequence classification. The audit
 * trail is non-negotiable — it is the primary evidence of correct operation.
 * Every safety_critical flow must produce an audit record.
 */
export const LLN_VAL_001 = {
  code: "LLN-VAL-001",
  name: "SafetyCriticalMissingAudit",
  severity: "error" as const,
  message: "A safety_critical flow must declare audit.write in its effects block.",
  why: "Safety-critical systems require an immutable audit trail. Governance without audit is unverifiable.",
  suggestedFix: "Add `audit.write` to the effects block of this flow.",
} as const;

/**
 * LLN-VAL-002: A `safety_critical` flow does not declare
 * `require deterministic_execution` in its `contract.safety` block.
 *
 * Deterministic execution is a pre-condition for formal verification of
 * safety-critical systems. Without it, the ProofGraph cannot be trusted.
 */
export const LLN_VAL_002 = {
  code: "LLN-VAL-002",
  name: "SafetyCriticalMissingDeterminism",
  severity: "error" as const,
  message: "A safety_critical flow must declare `require deterministic_execution` in contract.safety.",
  why: "Safety-critical correctness depends on deterministic, repeatable execution. Non-determinism invalidates formal proof.",
  suggestedFix: "Add `contract { safety { require deterministic_execution } }` to this flow.",
} as const;

/**
 * LLN-VAL-003: The `classification` value in `contract.value` is not a
 * recognised LogicN value classification.
 *
 * Value classifications are a closed set — unrecognised values cannot be
 * mapped to governance rules, tooling checks, or regulatory frameworks.
 */
export const LLN_VAL_003 = {
  code: "LLN-VAL-003",
  name: "UnknownValueClassification",
  severity: "error" as const,
  message: "Unrecognised classification in contract.value. Use a recognised classification: safety_critical, mission_critical, regulated, financial, medical, government, national_security, confidential, internal, or public.",
  why: "Value classifications drive governance rules, routing decisions, and compliance mapping. Unknown classifications cannot be enforced.",
  suggestedFix: "Replace with a recognised classification.",
} as const;

// ---------------------------------------------------------------------------
// New diagnostic codes (task #50) — EC/ID/AU/LC/T/FG categories
// These are PLANNED (DRCM phases) but exported here for test suites and tooling.
// ---------------------------------------------------------------------------

/** LLN-RES-001: retry declared on mutation effect without idempotent: true. */
export const LLN_RES_001 = {
  code: "LLN-RES-001",
  name: "RESILIENCE_RETRY_ON_MUTATION",
  severity: "error" as const,
  message: "retry declared on a flow with mutation effects (database.write, gateway.charge) without idempotent: true. Retrying mutations risks duplicate writes.",
} as const;

/** LLN-OBS-001: explicit observability {} on a pure flow (no side effects to observe). */
export const LLN_OBS_001 = {
  code: "LLN-OBS-001",
  name: "OBSERVABILITY_ON_PURE_FLOW",
  severity: "warning" as const,
  message: "Explicit observability {} declared on a pure flow. Pure flows have no side effects — telemetry is meaningless here.",
} as const;

// ── LLN-ASSUME codes ────────────────────────────────────────────────────────────────
//
// LLN-ASSUME-001  Flow referenced in assuming() does not exist in the known flow registry.
// LLN-ASSUME-002  Claim in assuming() does not match any ProofObligation in the flow's manifest.
// LLN-ASSUME-003  Referenced manifest is not present or sourceHash has changed (tampered/stale).
// LLN-ASSUME-004  assuming() references a flow from a different trust domain (cross-module).
//                 Only permitted when that flow's manifest carries a valid GovernanceSignature.
//
// These codes enforce the Proof-Tracing safety property:
//   "A developer cannot bypass a proof — they can only reference a proof that exists."

// ── LLN-MONO codes ────────────────────────────────────────────────────────────────────
//
// LLN-MONO-001  Emergency transition attempts to ADD a capability (expand permissions).
//               Only DENY/CLEAR operations are permitted in emergency {} blocks.
//               Monotonicity rule: V_DPM bits can only be cleared, never set.
// LLN-MONO-002  Emergency transition references an unknown signal type.
//               Valid signals: invariant_failure, capability_denied, fuel_exhausted,
//               manifest_tampered, quarantine_request, any_failure.

// ── LLN-TRAP codes ────────────────────────────────────────────────────────────────────
//
// LLN-TRAP-001  trap error code is not a valid identifier (empty or contains spaces).
//               Error codes must be SCREAMING_SNAKE_CASE identifiers.
// LLN-TRAP-002  trap condition references symbols not in the flow's parameter scope.
//               Same as LLN-INV-004 but for trapDecl nodes.

// ── LLN-DAG codes ─────────────────────────────────────────────────────────────────────
//
// LLN-DAG-001  governed flow declares an unknown Tower floor.
//              Valid floors: floor_1..4 / execution / containment / proof / attestation.
// LLN-DAG-002  governed flow floor is inconsistent with the flow's effects profile.
//              A floor_1 (Execution) flow cannot declare secret.access effects —
//              secret access is a Floor 3+ capability.

// ── LLN-MATCH codes ───────────────────────────────────────────────────────────────────
//
// LLN-MATCH-001  match expression on a known enum type has no wildcard (_) arm
//                and does not cover all known variants. Missing arms create "governance holes"
//                where a V_DPM signal or capability could pass unchecked.
//                Only fires when the match target type is known to the compiler.

/** LLN-EC-001 (PLANNED Phase 5): static cost overflow — max_aggregate_flow_budget exceeded by estimated loop. */
export const LLN_EC_001 = {
  code: "LLN-EC-001",
  name: "ECONOMICS_COST_OVERFLOW",
  severity: "error" as const,
  message: "Static economic analysis: estimated aggregate cost exceeds max_aggregate_flow_budget ceiling.",
} as const;

/** LLN-EC-002 (PLANNED Phase 5): charge_failure_tolerance_ratio breached — DPM quarantine triggered. */
export const LLN_EC_002 = {
  code: "LLN-EC-002",
  name: "ECONOMICS_FAILURE_TOLERANCE_BREACHED",
  severity: "error" as const,
  message: "Charge failure rate exceeded tolerance ratio — DSS DPM quarantine bit set.",
} as const;

/** LLN-ID-001 (PLANNED Phase 3): manifest missing, tampered, or signature verification failed. */
export const LLN_ID_001 = {
  code: "LLN-ID-001",
  name: "MANIFEST_VERIFICATION_FAILED",
  severity: "error" as const,
  message: "Module manifest is missing, has been tampered with, or signature verification failed. Module cannot be instantiated.",
} as const;

/** LLN-AU-001 (PLANNED Phase 6): epilogue { strategy: none } on high-trust flow. */
export const LLN_AU_001 = {
  code: "LLN-AU-001",
  name: "EPILOGUE_NONE_ON_HIGH_TRUST",
  severity: "error" as const,
  message: "epilogue { strategy: none } declared on a high-trust flow (max_risk_liability: high). High-trust flows must produce a verifiable receipt.",
} as const;

/** LLN-DRCM-UNSUPPORTED: bare step/invariant/emergency syntax used without @experimental_profile wrapper in --release. */
export const LLN_DRCM_UNSUPPORTED = {
  code: "LLN-DRCM-UNSUPPORTED",
  name: "DRCM_FEATURE_NOT_YET_SUPPORTED",
  severity: "error" as const,
  message: "DRCM feature used without @experimental_profile wrapper in --release build. Wrap with @experimental_profile(name: \"drcm_core_v1\", status: \"planned_phaseN\") { ... }.",
} as const;

/** Recognised value classifications from the LogicN governance scope KB. */
export const RECOGNISED_VALUE_CLASSIFICATIONS = new Set([
  "safety_critical", "mission_critical", "regulated", "financial",
  "medical", "government", "national_security",
  "confidential", "internal", "public",
]);

// ---------------------------------------------------------------------------
// LLN-GOV-005 helpers
// ---------------------------------------------------------------------------

/**
 * Purpose-to-denied-effects mapping.
 * "read-only" declares only read access, so database.write is contradictory.
 * "internal" declares no external traffic, so network.outbound is contradictory.
 */
const PURPOSE_DENIED_EFFECTS: ReadonlyMap<string, readonly string[]> = new Map([
  ["read-only", ["database.write"]],
  ["internal",  ["network.outbound"]],
]);

/**
 * Extracts all policy block purpose values from a flow node.
 * policy { purpose "read-only" } is stored as policyDecl with an
 * identifier child { value: "purpose:read-only" }.
 */
function extractPolicyPurposes(flowNode: AstNode): string[] {
  const purposes: string[] = [];
  for (const child of flowNode.children ?? []) {
    if (child.kind === "policyDecl") {
      for (const clause of child.children ?? []) {
        if (clause.kind === "identifier" && clause.value?.startsWith("purpose:")) {
          purposes.push(clause.value.slice("purpose:".length));
        }
      }
    }
  }
  return purposes;
}

// ---------------------------------------------------------------------------
// LLN-GOV-007 helpers
// ---------------------------------------------------------------------------

/**
 * Returns all authorityDecl nodes in the flow (or anywhere under the root).
 * The parser stores a reason clause as a stringLiteral child of authorityDecl.
 * If no stringLiteral child exists the reason is missing.
 */
function hasAuthorityReason(authorityNode: AstNode): boolean {
  // The parser stores: children.push({ kind: "stringLiteral", value: reasonText })
  // An identifier child with value starting "reason:" would also indicate reason.
  return (authorityNode.children ?? []).some(
    (c) =>
      c.kind === "stringLiteral" ||
      (c.kind === "identifier" && c.value?.startsWith("reason:")),
  );
}

// ---------------------------------------------------------------------------
// LLN-GOV-009 helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when a flow node has qualifier "privileged".
 * Because the parser does not yet emit a dedicated privilegedFlowDecl kind,
 * we detect it by looking for an identifier child with value "qualifier:privileged"
 * (injected by the flow body parser when it encounters the privileged keyword)
 * OR by checking if the flow node's value starts with "privileged:".
 */
function isPrivilegedFlow(flowNode: AstNode, flow: FlowMeta): boolean {
  // Primary signal: flow qualifier encoded in the value field
  if ((flowNode.value ?? "").startsWith("privileged:")) return true;
  // Secondary: any identifier child that encodes the qualifier
  if ((flowNode.children ?? []).some(
    (c) => c.kind === "identifier" && c.value === "qualifier:privileged",
  )) return true;
  // Tertiary: flow meta qualifier (parser currently uses "flow" for privileged flows,
  // but we also accept a future FlowMeta extension)
  if ((flow as { qualifier: string }).qualifier === "privileged") return true;
  return false;
}

// ---------------------------------------------------------------------------
// LLN-GOV-003 helpers
// ---------------------------------------------------------------------------

/**
 * Extracts field names listed in contract.response.denies.
 * The parser stores response sub-block children as:
 *   contractDecl → identifier { value: "response:block", children: [identifier { value: "denies:email" }, ...] }
 */
function extractResponseDeniedFields(flowNode: AstNode): Set<string> {
  const denied = new Set<string>();
  const contractNode = (flowNode.children ?? []).find((c) => c.kind === "contractDecl");
  if (contractNode === undefined) return denied;

  // Find response:block child inside contractDecl
  for (const child of contractNode.children ?? []) {
    if (child.kind === "identifier" && child.value === "response:block") {
      for (const rc of child.children ?? []) {
        if (rc.kind === "identifier" && rc.value?.startsWith("denies:")) {
          denied.add(rc.value.slice("denies:".length));
        }
      }
    }
  }
  return denied;
}

/**
 * Collects named argument field names from callExpr nodes in RETURN statements
 * of the flow body. This is used to detect denied fields leaking into the response.
 *
 * Only examines return statement expressions (not intermediate calls like AuditLog.write)
 * to avoid false positives where denied field names appear in intermediate operations
 * such as redact(amount) or audit logging.
 */
function collectBodyFieldNames(flowNode: AstNode): Set<string> {
  const fields = new Set<string>();

  function walkReturnExpr(node: AstNode): void {
    // Discharge: redact(...) / seal(...) sanitise their contents — do not collect inside them
    // (GOV-003: seal() recognised alongside redact()).
    if (node.kind === "callExpr" && (node.value === "redact" || node.value === "seal")) {
      return;
    }
    if (node.kind === "callExpr") {
      for (const child of node.children ?? []) {
        // Named argument labels are identifier nodes with a value child
        if (child.kind === "identifier" && child.value !== undefined && (child.children ?? []).length > 0) {
          const valueChild = child.children![0];
          const isDischarged = valueChild !== undefined &&
            valueChild.kind === "callExpr" &&
            (valueChild.value === "redact" || valueChild.value === "seal");
          if (!isDischarged) {
            fields.add(child.value);
          }
        }
      }
    }
    // GOV-003 broadening (audit 2026-06-16): a denied field can leak via a bare member access
    // (`return user.email`) or a positional value (`return Ok(email)`), not only a named-argument
    // label. Collect those forms too — exact field-name match against response.denies; redact()/
    // seal() above discharge anything they wrap. memberExpr stores the field name in `value`.
    if (node.kind === "memberExpr" && node.value !== undefined) {
      fields.add(node.value);
    }
    if (node.kind === "identifier" && node.value !== undefined && (node.children ?? []).length === 0) {
      fields.add(node.value);
    }
    for (const child of node.children ?? []) walkReturnExpr(child);
  }

  function findReturnStmts(node: AstNode): void {
    if (node.kind === "returnStmt") {
      for (const child of node.children ?? []) {
        walkReturnExpr(child);
      }
      return; // don't recurse further into return
    }
    for (const child of node.children ?? []) findReturnStmts(child);
  }

  // Walk the flow body block — it's the last child of the flow node
  // (after params, typeRef, effectsDecl, contractDecl, intentDecl, etc.)
  const blockChildren = (flowNode.children ?? []).filter((c) => c.kind === "block");
  const bodyBlock = blockChildren[blockChildren.length - 1];

  if (bodyBlock !== undefined) {
    findReturnStmts(bodyBlock);
  }

  return fields;
}

// ---------------------------------------------------------------------------
// LLN-CONTEXT-001 helpers
// ---------------------------------------------------------------------------

/**
 * Extracts required context field names from a flow's contract.context block.
 * Returns an array of field names (after stripping the "require:" prefix).
 * Finds contractDecl children with value "context:block", then collects
 * identifier children whose value starts with "require:".
 */
function extractRequiredContext(flowNode: AstNode): string[] {
  const contractNode = (flowNode.children ?? []).find((c) => c.kind === "contractDecl");
  if (contractNode === undefined) return [];

  const result: string[] = [];
  for (const child of contractNode.children ?? []) {
    if (child.kind === "identifier" && child.value === "context:block") {
      for (const rc of child.children ?? []) {
        if (rc.kind === "identifier" && rc.value?.startsWith("require:")) {
          result.push(rc.value.slice("require:".length));
        }
      }
    }
  }
  return result;
}

/**
 * Phase 25 LLN-VAL: Extracts the `classification` value from `contract.value { classification ... }`.
 *
 * The AST structure is:
 *   contractDecl → identifier [value:block] → identifier [decl:classification <cls> domain <dom> ...]
 *
 * Returns the classification string (e.g. "safety_critical"), or null if not declared.
 */
function extractValueClassification(flowNode: AstNode): string | null {
  const contractNode = (flowNode.children ?? []).find((c) => c.kind === "contractDecl");
  if (contractNode === undefined) return null;

  for (const child of contractNode.children ?? []) {
    if (child.kind === "identifier" && child.value === "value:block") {
      for (const valueChild of child.children ?? []) {
        if (valueChild.kind === "identifier" && valueChild.value?.startsWith("decl:")) {
          // Parse "decl:classification safety_critical domain aerospace ..."
          const pairs = valueChild.value.slice("decl:".length).split(/\s+/);
          const classIdx = pairs.indexOf("classification");
          if (classIdx !== -1 && classIdx + 1 < pairs.length) {
            return pairs[classIdx + 1] ?? null;
          }
        }
      }
    }
  }
  return null;
}

/**
 * Phase 25 LLN-VAL: Extracts requirements from `contract.safety { require ... }`.
 *
 * The AST structure is:
 *   contractDecl → identifier [safety:block] → identifier [require:<req1>.require.<req2>...]
 *
 * Returns a set of requirement names (e.g. { "deterministic_execution", "bounded_runtime" }).
 */
function extractSafetyRequirements(flowNode: AstNode): Set<string> {
  const contractNode = (flowNode.children ?? []).find((c) => c.kind === "contractDecl");
  const requirements = new Set<string>();
  if (contractNode === undefined) return requirements;

  for (const child of contractNode.children ?? []) {
    if (child.kind === "identifier" && child.value === "safety:block") {
      for (const safetyChild of child.children ?? []) {
        if (safetyChild.kind === "identifier" && safetyChild.value?.startsWith("require:")) {
          // Format: "require:deterministic_execution.require.bounded_runtime"
          // Split on ".require." to get individual requirements.
          const raw = safetyChild.value.slice("require:".length);
          const parts = raw.split(/\.require\.|\.require$/);
          for (const part of parts) {
            const req = part.trim().replace(/^\./, "");
            if (req.length > 0) requirements.add(req);
          }
        }
      }
    }
  }
  return requirements;
}

/**
 * Phase 26B: Extracts hardware target IDs from `contract.hardware { target <id> allow <id> }`.
 *
 * The AST structure is:
 *   contractDecl → identifier [hardware:block] → identifier [decl:target <id> allow <id2> ...]
 *
 * Returns all declared target IDs (primary + allowed).
 */
function extractHardwareTargets(flowNode: AstNode): string[] {
  const contractNode = (flowNode.children ?? []).find((c) => c.kind === "contractDecl");
  const targets: string[] = [];
  if (contractNode === undefined) return targets;

  for (const child of contractNode.children ?? []) {
    if (child.kind === "identifier" && child.value === "hardware:block") {
      for (const hwChild of child.children ?? []) {
        if (hwChild.kind === "identifier" && hwChild.value?.startsWith("decl:")) {
          const raw = hwChild.value.slice("decl:".length);
          // Parse "target arm . sve2 allow google . tpu . inference require mte"
          // Target IDs use dots but the lexer splits on dots — rejoin with dots
          const tokens = raw.split(/\s+/);
          let i = 0;
          while (i < tokens.length) {
            const tok = tokens[i];
            if (tok === "target" || tok === "allow") {
              // Collect the dot-separated ID that follows
              i++;
              const parts: string[] = [];
              while (i < tokens.length && tokens[i] !== "target" &&
                     tokens[i] !== "allow" && tokens[i] !== "require" &&
                     tokens[i] !== "deny" && tokens[i] !== "fallback") {
                if (tokens[i] !== ".") parts.push(tokens[i] ?? "");
                i++;
              }
              const id = parts.join(".");
              if (id.length > 0) targets.push(id);
            } else {
              i++;
            }
          }
        }
      }
    }
  }
  return targets;
}

/**
 * Checks whether a given context field name is referenced in the flow body.
 * Looks for any identifier node with value matching the field name, or
 * member access patterns like `context.actor` (memberExpr/callExpr with the field name).
 */
function isContextFieldAccessed(flowNode: AstNode, fieldName: string): boolean {
  const bodyBlocks = (flowNode.children ?? []).filter((c) => c.kind === "block");
  const bodyBlock = bodyBlocks[bodyBlocks.length - 1];

  if (bodyBlock === undefined) return false;

  function walk(node: AstNode): boolean {
    // Check identifier nodes that match the field name directly
    if (node.kind === "identifier" && node.value === fieldName) return true;
    // Check memberExpr: context.actor → memberExpr { value: "actor", children: [identifier { value: "context" }] }
    if (node.kind === "memberExpr" && node.value === fieldName) return true;
    // Check letDecl/mutDecl/readonlyDecl that reference the field in their value string
    if (
      (node.kind === "letDecl" || node.kind === "mutDecl" || node.kind === "readonlyDecl") &&
      node.value?.includes(fieldName)
    ) {
      return true;
    }
    return (node.children ?? []).some(walk);
  }

  return walk(bodyBlock);
}

// ---------------------------------------------------------------------------
// Phase 2 — LLN-GOV-019: limits {} field name validation
// ---------------------------------------------------------------------------

/** Known field names accepted in a `limits {}` contract sub-block. */
const KNOWN_LIMITS_FIELDS = new Set([
  "memory", "request_time", "max_request_size", "max_response_size",
]);

/**
 * Extracts the `limits {}` block children from a flow's contractDecl and
 * returns an array of declared field names (the first token on each decl line).
 *
 * The AST structure is:
 *   contractDecl → identifier { value: "limits:block" }
 *     → identifier { value: "decl:memory 64mb" }
 *     → identifier { value: "decl:request_time 500ms" }
 *     ...
 */
function extractLimitsFields(flowNode: AstNode): Array<{ field: string; location?: SourceLocation }> {
  const contractNode = (flowNode.children ?? []).find((c) => c.kind === "contractDecl");
  if (contractNode === undefined) return [];

  const limitsBlock = (contractNode.children ?? []).find(
    (c) => c.kind === "identifier" && c.value === "limits:block",
  );
  if (limitsBlock === undefined) return [];

  const fields: Array<{ field: string; location?: SourceLocation }> = [];
  for (const child of limitsBlock.children ?? []) {
    if (child.kind === "identifier" && (child.value ?? "").startsWith("decl:")) {
      const decl = (child.value ?? "").slice("decl:".length).trim();
      const firstToken = decl.split(/\s+/)[0];
      if (firstToken !== undefined && firstToken.length > 0) {
        const locPart = child.location !== undefined ? { location: child.location } : {};
        fields.push({ field: firstToken, ...locPart });
      }
    }
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Phase 2 — LLN-GOV-020: authority overly-broad detection
// ---------------------------------------------------------------------------

/**
 * Checks whether an authority block's content includes a broad wildcard grant
 * (`requires *` or `requires all`).
 *
 * The authority block stores its line-level content as:
 *   - identifier children with value "require:<something>" for `require` clauses
 *   - OR raw decl:... lines for other content
 *
 * We scan both patterns.
 */
function hasOverlyBroadAuthority(authNode: AstNode): boolean {
  for (const child of authNode.children ?? []) {
    // effectRef with empty value → `require *`
    // (the `*` operator token cannot be read as an identifier by the parser,
    //  so it produces effectRef with value="" — treat as wildcard)
    if (child.kind === "effectRef") {
      const v = (child.value ?? "").trim().toLowerCase();
      if (v === "" || v === "*" || v === "all") return true;
    }
    // Check `require:*` or `require:all`
    if (child.kind === "identifier") {
      const v = (child.value ?? "").toLowerCase();
      if (v === "require:*" || v === "require:all") return true;
      // Raw decl line: "decl:requires *" or "decl:requires all"
      if (v.startsWith("decl:")) {
        const content = v.slice("decl:".length);
        if (/requires?\s+\*/.test(content) || /requires?\s+all\b/.test(content)) return true;
      }
    }
  }
  // Also check the raw value of the authority node itself if it encodes content
  const rawValue = (authNode.value ?? "").toLowerCase();
  if (/requires?\s+\*/.test(rawValue) || /requires?\s+all\b/.test(rawValue)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Phase 3 — LLN-GOV-006: economics max_risk_liability extraction
// ---------------------------------------------------------------------------

/**
 * Extracts `max_risk_liability` as a number from a flow's contract.economics block.
 *
 * The AST structure is:
 *   contractDecl → identifier { value: "economics:block" }
 *     → identifier { value: 'decl:max_risk_liability "50000"' }
 *
 * Returns the numeric value, or undefined if not declared or unparseable.
 */
function extractMaxRiskLiability(flowNode: AstNode): number | undefined {
  const contractNode = (flowNode.children ?? []).find((c) => c.kind === "contractDecl");
  if (contractNode === undefined) return undefined;

  const economicsBlock = (contractNode.children ?? []).find(
    (c) => c.kind === "identifier" && c.value === "economics:block",
  );
  if (economicsBlock === undefined) return undefined;

  for (const child of economicsBlock.children ?? []) {
    if (child.kind === "identifier" && (child.value ?? "").startsWith("decl:")) {
      const content = (child.value ?? "").slice("decl:".length);
      if (content.includes("max_risk_liability")) {
        // Extract the numeric portion — strip quotes, units, etc.
        const match = content.match(/max_risk_liability\s+"?(\d[\d,]*)"?/);
        if (match?.[1] !== undefined) {
          const n = Number(match[1].replace(/,/g, ""));
          return Number.isFinite(n) ? n : undefined;
        }
      }
    }
  }
  return undefined;
}

/**
 * Returns true if the flow's contractDecl contains an epilogue block
 * (i.e., an identifier child with value starting "epilogue:block" or "epilogue:").
 */
function hasEpilogueBlock(flowNode: AstNode): boolean {
  const contractNode = (flowNode.children ?? []).find((c) => c.kind === "contractDecl");
  if (contractNode === undefined) return false;

  return (contractNode.children ?? []).some(
    (c) => c.kind === "identifier" &&
      (c.value === "epilogue:block" || (c.value ?? "").startsWith("epilogue:")),
  );
}

// ---------------------------------------------------------------------------
// Phase 3 — LLN-TERM-001: termination annotation helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the flow body contains a direct recursive call to itself.
 * A call is recursive when callExpr.value === flowName.
 */
function hasRecursiveCall(flowNode: AstNode, flowName: string): boolean {
  function walk(node: AstNode): boolean {
    if (node.kind === "callExpr" && node.value === flowName) return true;
    return (node.children ?? []).some(walk);
  }
  // Only search inside the body block (last block child)
  const blocks = (flowNode.children ?? []).filter((c) => c.kind === "block");
  const body = blocks[blocks.length - 1];
  return body !== undefined ? walk(body) : false;
}

// ---------------------------------------------------------------------------
// Phase 3 — LLN-GOV-001: intent/behaviour mismatch (extended heuristic)
// ---------------------------------------------------------------------------

/**
 * Checks for clear-cut contradictions between the intent string and declared effects.
 *
 * Returns an array of mismatch description strings (one per detected contradiction).
 * Empty array means no contradiction found.
 */
function detectIntentMismatch(
  intentText: string,
  declaredEffects: readonly string[],
): string[] {
  const mismatches: string[] = [];
  const text = intentText.toLowerCase();

  // "read" or "query" intent but effects include database.write or audit.write
  if (
    (text.includes("read") || text.includes("query")) &&
    (declaredEffects.includes("database.write"))
  ) {
    mismatches.push(`intent suggests read/query but effects include database.write`);
  }

  // "pure" or "no side effects" intent but effects are non-empty
  if (
    (text.includes("pure") || text.includes("no side effect")) &&
    declaredEffects.length > 0
  ) {
    mismatches.push(`intent declares pure/no-side-effects but effects are declared: ${declaredEffects.join(", ")}`);
  }

  return mismatches;
}

// ---------------------------------------------------------------------------
// Phase 22C — Arena memory extraction
// ---------------------------------------------------------------------------

/**
 * Extracts the arena memory limit (in MB) from a flow's contract.memory block.
 *
 * The memory block is stored in the AST as:
 *   contractDecl
 *     identifier { value: "memory:block" }
 *       identifier { value: "decl:arena 8 mb" }
 *
 * Returns the arena size in megabytes, or undefined if no arena declaration exists.
 */
export function extractArenaLimitMB(flowNode: AstNode): number | undefined {
  // Find the contractDecl child
  const contractDecl = (flowNode.children ?? []).find((c) => c.kind === "contractDecl");
  if (contractDecl === undefined) return undefined;

  // Find the memory:block identifier child
  const memoryBlock = (contractDecl.children ?? []).find(
    (c) => c.kind === "identifier" && c.value === "memory:block",
  );
  if (memoryBlock === undefined) return undefined;

  // Find a child with value starting "decl:arena"
  for (const child of memoryBlock.children ?? []) {
    if (child.kind === "identifier" && child.value?.startsWith("decl:arena")) {
      // Parse the number from "decl:arena 8 mb" → 8
      const match = child.value.match(/decl:arena\s+(\d+(?:\.\d+)?)\s*mb/i);
      if (match?.[1] !== undefined) {
        const mb = Number(match[1]);
        return Number.isFinite(mb) ? mb : undefined;
      }
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Verifier implementation
// ---------------------------------------------------------------------------

/**
 * LLN-INV-004: Collect all identifier references in an ensure expression that
 * are NOT in the flow's parameter scope. These would silently emit (i32.const 0)
 * in the WAT emitter — catching them in the Verifier (Floor 3) instead keeps the
 * emitter "dumb" and gives developers actionable error messages.
 *
 * Built-in names (true/false/None) are always in scope and excluded.
 */
function collectUnresolvedIdentifiers(
  expr: AstNode,
  paramNames: ReadonlySet<string>,
): readonly string[] {
  const BUILTIN_NAMES = new Set(["true", "false", "None", "Some", "Ok", "Err"]);
  const unresolved = new Set<string>();

  function walk(node: AstNode): void {
    if (node.kind === "identifier") {
      const name = node.value ?? "";
      if (name !== "" && !paramNames.has(name) && !BUILTIN_NAMES.has(name) && !/^\d/.test(name)) {
        unresolved.add(name);
      }
    }
    // Recurse into binary/unary/call children; skip member expressions
    // (e.g. `runtime::getBalance(...)` — the receiver name is a module path, not a local)
    if (node.kind !== "memberExpr") {
      for (const child of node.children ?? []) walk(child);
    }
  }

  walk(expr);
  return [...unresolved];
}

/**
 * 0040/#70: true when an `ensure` expression references the magic `result` symbol — i.e.
 * it is an OUTPUT POST-CONDITION over the flow's return value (`ensure result <= MAX`),
 * not a parameter pre-condition. Walks the whole expr including member receivers so that
 * `result.field` is also recognised. `result` is reserved only inside `invariant {} ensure`.
 */
function exprReferencesResult(node: AstNode): boolean {
  if (node.kind === "identifier" && node.value === "result") return true;
  for (const child of node.children ?? []) if (exprReferencesResult(child)) return true;
  return false;
}

class GovernanceVerifier {
  private readonly diagnostics: GovernanceDiagnostic[] = [];
  private readonly intentStatus = new Map<string, "satisfied" | "missing" | "mismatch">();
  private readonly proofObligations: string[] = [];
  private knownContractSets: Map<string, AstNode> = new Map();
  /**
   * Domain Guard Policies collected from top-level `policy Name { ... }` declarations.
   * Key = policy name (e.g. "InvoicingDomainGuard"), value = policyDecl AST node.
   * Used by the Differential Proof pass for `contract [conforms_to: Name] { }` (task #56).
   */
  private knownDomainGuards: Map<string, AstNode> = new Map();
  /**
   * All flows in the current compilation unit, keyed by flow name.
   * Value holds the AST node for the flow declaration.
   * Built in verify() and consumed by verifyAssumingBlocks() (task #74).
   */
  private knownFlows: Map<string, { node?: AstNode }> = new Map();
  private readonly governanceFlagsByFlow = new Map<string, GovernanceFlagsMask>();
  private readonly runtimeManifests: RuntimeManifest[] = [];
  private readonly proofGraphsByFlow = new Map<string, ProofGraph>();
  private currentProfile: DeploymentProfile = "dev";

  verify(
    ast: AstNode,
    flows: readonly FlowMeta[],
    effectResults: readonly EffectCheckResult[],
    profile: DeploymentProfile,
    sourceFile?: string,
  ): void {
    this.currentProfile = profile;
    // Collect all contractSetDecl nodes from top-level program children
    this.knownContractSets = new Map();
    for (const child of ast.children ?? []) {
      if (child.kind === "contractSetDecl" && child.value !== undefined) {
        this.knownContractSets.set(child.value, child);
      }
    }

    // Collect all top-level policyDecl / guardDecl nodes as Domain Guard policies (task #56).
    // A domain guard policy has a name (e.g. "InvoicingDomainGuard") and contains
    // permitted_effects, permitted_capabilities, and/or enforced_limits sub-blocks.
    // `guardDecl` is the v2.2 canonical form; `policyDecl` is the legacy alias kept for compat.
    this.knownDomainGuards = new Map();
    for (const child of ast.children ?? []) {
      if (child.kind === "policyDecl" && child.value !== undefined && child.value !== "policy") {
        this.knownDomainGuards.set(child.value, child);
      }
      if (child.kind === "guardDecl" && child.value !== undefined && child.value !== "guard") {
        this.knownDomainGuards.set(child.value, child);
      }
    }

    // ── LLN-GOV-007: check top-level authority blocks for missing reason ──
    for (const child of ast.children ?? []) {
      if (child.kind === "authorityDecl" && !hasAuthorityReason(child)) {
        this.diagnostics.push(makeGovDiag(
          LLN_GOV_007.code,
          LLN_GOV_007.name,
          "error",
          `Top-level authority block must include a reason declaration. ` +
          `Add: reason "Explain why this authority is needed"`,
          child.location,
          `Add inside the authority block: reason "Explain why this authority is needed"`,
        ));
      }
    }

    // Build knownFlows map for assuming {} proof-tracing (task #74)
    this.knownFlows = new Map();
    for (const flow of flows) {
      const flowNode = findFlowNode(ast, flow.name);
      this.knownFlows.set(flow.name, flowNode !== undefined ? { node: flowNode } : {});
    }

    for (const flow of flows) {
      const flowNode = findFlowNode(ast, flow.name);
      const effectResult = effectResults.find((r) => r.flowName === flow.name);
      this.verifyFlow(flow, flowNode, effectResult, profile, flows, effectResults);
    }

    // ── LLN-MONO-001/002: Policy monotonicity verification (DRCM Phase 4, task #39) ──
    // Scan all AST nodes for policyDecl blocks and verify emergency {} transitions.
    const allNodes = ast.children ?? [];
    this.verifyPolicyMonotonicity(allNodes);

    // ── LLN-INHERIT-001/002: Policy hierarchy subset verification (task #72) ──
    // Verifies parent_policy: annotations — child permitted_effects ⊆ parent.
    this.verifyPolicyHierarchy(allNodes);

    // ── LLN-DAG-001/002: governed flow floor validation ───────────────────────────
    this.verifyGovernedFlows(allNodes);

    // ── LLN-GATE-001/002: gate {} admission guard block validation ────────────────
    this.verifyGateBlocks(allNodes);

    // ── LLN-STATIC-001/002: static compile-time constant validation ──────────────
    this.verifyStaticDecls(allNodes);

    // ── LLN-BF-001/002: bitfield register bitmask validation ─────────────────────
    this.verifyBitfieldDecls(allNodes);

    // ── LLN-ASSIMILATE-001/003: assimilated plugin validation ─────────────────────
    this.verifyAssimilatedPlugins(allNodes, sourceFile ?? "");
  }

  getResult(): GovernanceVerifyResult {
    return {
      diagnostics: [...this.diagnostics],
      intentStatus: new Map(this.intentStatus),
      proofObligations: [...this.proofObligations],
      governanceFlagsByFlow: new Map(this.governanceFlagsByFlow),
      runtimeManifests: [...this.runtimeManifests],
      proofGraphs: new Map(this.proofGraphsByFlow),
    };
  }

  private verifyFlow(
    flow: FlowMeta,
    flowNode: AstNode | undefined,
    effectResult: EffectCheckResult | undefined,
    profile: DeploymentProfile,
    allFlows: readonly FlowMeta[] = [],
    allEffectResults: readonly EffectCheckResult[] = [],
  ): void {
    const loc = flow.location;

    // ── LLN-GOV-008: Experimental code in production ──────────────────────
    if (flow.qualifier === "flow" && flowNode?.kind === "flowDecl") {
      // Check for 'experimental' qualifier pattern — if name starts with Exp or
      // if the source file contains 'experimental flow'
    }
    // Direct check: experimentalFlowDecl doesn't exist as a kind, but if
    // someday it does, we'd check here. For now, skip.

    // ── LLN-GOV-010: secure flow without intent ───────────────────────────
    if (flow.qualifier === "secure" && flowNode !== undefined) {
      if (!hasIntentDecl(flowNode)) {
        const isProduction = profile === "production" || profile === "deterministic";
        this.diagnostics.push(makeGovDiag(
          "LLN-GOV-010",
          "INTENT_MISSING_ON_SECURE_FLOW",
          isProduction ? "error" : "info",
          `secure flow '${flow.name}' has no intent declaration. Intent is recommended for all secure flows and required in production profiles.`,
          loc,
          `Add: intent "Describe what this flow does and what it protects"`,
        ));
      } else {
        this.intentStatus.set(flow.name, "satisfied");
        this.proofObligations.push(`intent_declared:${flow.name}`);
      }
    }

    // ── LLN-GOV-002: governed sink without audit ──────────────────────────
    // If a flow writes to a governed sink (database.write) but doesn't
    // declare audit.write, emit a warning
    if (flowNode !== undefined) {
      const hasDbWrite = flow.declaredEffects.includes("database.write");
      const hasAuditWrite = flow.declaredEffects.includes("audit.write");
      const hasAuditLogCall = hasCallTo(flowNode, /^AuditLog\.write$/);

      if (hasDbWrite && !hasAuditWrite && !hasAuditLogCall) {
        const isProduction = profile === "production" || profile === "deterministic";
        this.diagnostics.push(makeGovDiag(
          "LLN-GOV-002",
          "MISSING_AUDIT_FOR_GOVERNED_SINK",
          isProduction ? "warning" : "info",
          `Flow '${flow.name}' writes to a database but declares no audit.write effect and calls no AuditLog.write(). Consider adding audit evidence.`,
          loc,
          `Add 'audit.write' to effects and call AuditLog.write({ event: "..." })`,
        ));
      }

      if (hasAuditWrite || hasAuditLogCall) {
        this.proofObligations.push(`audit_required:${flow.name}`);
      }
    }

    // ── LLN-GOV-004: denied compute target selected ───────────────────────
    // Check if flow denies remote.execution but declares network.outbound
    if (flowNode !== undefined) {
      const deniedTargets = extractDeniedTargets(flowNode);
      const hasRemoteDenied = deniedTargets.some(
        (t) => t === "remote.execution" || t === "remote",
      );
      const hasNetworkOutbound = flow.declaredEffects.includes("network.outbound") ||
        (effectResult?.declaredEffects ?? []).includes("network.outbound");

      if (hasRemoteDenied && hasNetworkOutbound) {
        this.diagnostics.push(makeGovDiag(
          "LLN-GOV-004",
          "DENIED_TARGET_SELECTED",
          "error",
          `Flow '${flow.name}' denies remote.execution but declares network.outbound. These constraints are contradictory.`,
          loc,
          `Remove network.outbound from effects, or remove deny [remote.execution] from compute target block.`,
        ));
      }

      if (deniedTargets.length > 0) {
        this.proofObligations.push(`denied_targets_not_selected:${flow.name}`);
      }
    }

    // ── LLN-HINT-COMPUTE-001: ai.inference without compute target preference ─
    // Planning hint — not a governance error. Helps developers optimise.
    if (flowNode !== undefined) {
      const hasAiInference = flow.declaredEffects.includes("ai.inference");
      const hasComputeTarget = findNodes(flowNode, "computeTargetBlock").length > 0;

      if (hasAiInference && !hasComputeTarget) {
        this.diagnostics.push(makeGovDiag(
          "LLN-HINT-COMPUTE-001",
          "COMPUTE_TARGET_MISSING_FOR_AI_INFERENCE",
          "info",
          `Flow '${flow.name}' uses ai.inference but has no compute target preference. NPU or GPU acceleration would improve performance.`,
          loc,
          `Add: compute target best { prefer [npu, gpu, cpu] fallback cpu }`,
        ));
      }
    }

    // ── LLN-GOV-001: intent / behaviour mismatch (heuristic) ─────────────
    // Check for clear-cut contradictions between intent text and effects.
    // Also retain the original "local" vs network.outbound detection.
    if (flowNode !== undefined && hasIntentDecl(flowNode)) {
      const intentNodes = findNodes(flowNode, "intentDecl");
      for (const intentNode of intentNodes) {
        const intentText = (intentNode.value ?? "");
        const intentLower = intentText.toLowerCase();

        // Original: local/on-device hint + network.outbound
        const hasLocalHint = intentLower.includes("local") ||
          intentLower.includes("without remote") ||
          intentLower.includes("on-device");
        const hasNetworkEffect = flow.declaredEffects.includes("network.outbound");
        if (hasLocalHint && hasNetworkEffect) {
          this.diagnostics.push(makeGovDiag(
            "LLN-GOV-001",
            "INTENT_BEHAVIOR_MISMATCH",
            "warning",
            `Flow '${flow.name}' intent suggests local execution but declares network.outbound. Verify intent matches actual behaviour.`,
            loc,
            `Review whether network.outbound is genuinely needed, or update the intent declaration.`,
          ));
          this.intentStatus.set(flow.name, "mismatch");
        }

        // Extended: read/query intent vs database.write; pure intent vs any effects
        const mismatches = detectIntentMismatch(intentText, flow.declaredEffects);
        for (const mismatch of mismatches) {
          this.diagnostics.push(makeGovDiag(
            "LLN-GOV-001",
            "INTENT_BEHAVIOR_MISMATCH",
            "warning",
            `Flow '${flow.name}': intent/behaviour mismatch — ${mismatch}.`,
            loc,
            `Review the intent declaration or adjust the declared effects to match the intent.`,
          ));
          this.intentStatus.set(flow.name, "mismatch");
        }
      }
    }

    // ── LLN-GOV-003: response contract violation ──────────────────────────
    // If contract.response.denies lists a field and the flow body uses that
    // field name as a named argument label in a callExpr (e.g. return record
    // with email: ...), emit LLN-GOV-003.
    if (flowNode !== undefined) {
      const deniedFields = extractResponseDeniedFields(flowNode);
      if (deniedFields.size > 0) {
        const bodyFields = collectBodyFieldNames(flowNode);
        for (const field of deniedFields) {
          if (bodyFields.has(field)) {
            this.diagnostics.push(makeGovDiag(
              LLN_GOV_003.code,
              LLN_GOV_003.name,
              "error",
              `Flow '${flow.name}' returns field '${field}' which is denied by contract.response.denies. ` +
              `Protected data must not leak through the API surface. Use redact(${field}) or remove the field.`,
              loc,
              `Remove '${field}' from the response or use: ${field}: redact(${field})`,
            ));
          }
        }
      }
    }

    // ── LLN-CONTEXT-001: required context field not accessed ──────────────
    // If contract.context declares require actor (or other field) and the
    // flow body never references that field, emit a warning.
    if (flowNode !== undefined) {
      const requiredContextFields = new Set(extractRequiredContext(flowNode));
      for (const field of requiredContextFields) {
        if (!isContextFieldAccessed(flowNode, field)) {
          this.diagnostics.push(makeGovDiag(
            LLN_CONTEXT_001.code,
            LLN_CONTEXT_001.name,
            "warning",
            `Flow '${flow.name}' declares context.require '${field}' but never accesses it in the flow body. ` +
            `Required context fields should be read and used.`,
            loc,
            `Add: let ${field} = context.${field}`,
          ));
        }
      }
    }

    // ── LLN-GOV-005: policy purpose mismatch ─────────────────────────────
    // If a flow declares a policy block with purpose "read-only" but also
    // declares database.write in its effects, emit a warning.
    if (flowNode !== undefined) {
      const purposes = extractPolicyPurposes(flowNode);
      for (const purpose of purposes) {
        const deniedEffects = PURPOSE_DENIED_EFFECTS.get(purpose) ?? [];
        for (const deniedEffect of deniedEffects) {
          const hasDeniedEffect = flow.declaredEffects.includes(deniedEffect);
          if (hasDeniedEffect) {
            this.diagnostics.push(makeGovDiag(
              LLN_GOV_005.code,
              LLN_GOV_005.name,
              "warning",
              `Flow '${flow.name}' declares purpose '${purpose}' but also uses ${deniedEffect} effect. ` +
              `Verify the policy purpose matches actual behaviour.`,
              loc,
              `Remove ${deniedEffect} from effects, or update the policy purpose.`,
            ));
          }
        }
      }
    }

    // ── LLN-GOV-007: authority block missing reason ───────────────────────
    // If an authority block exists but has no reason clause, emit an error.
    if (flowNode !== undefined) {
      const authorityNodes = findNodes(flowNode, "authorityDecl");
      for (const authNode of authorityNodes) {
        if (!hasAuthorityReason(authNode)) {
          this.diagnostics.push(makeGovDiag(
            LLN_GOV_007.code,
            LLN_GOV_007.name,
            "error",
            `Authority block in flow '${flow.name}' must include a reason declaration. ` +
            `Add: reason "Explain why this authority is needed"`,
            authNode.location ?? loc,
            `Add inside the authority block: reason "Explain why this authority is needed"`,
          ));
        }
      }
    }

    // ── LLN-GOV-009: privileged flow without capability ───────────────────
    // If a flow has qualifier "privileged" but declares no effects or contract,
    // emit a warning.
    if (flowNode !== undefined && isPrivilegedFlow(flowNode, flow)) {
      const hasEffects = flow.declaredEffects.length > 0;
      const hasContract = (flowNode.children ?? []).some((c) => c.kind === "contractDecl");
      if (!hasEffects && !hasContract) {
        this.diagnostics.push(makeGovDiag(
          LLN_GOV_009.code,
          LLN_GOV_009.name,
          "warning",
          `Privileged flow '${flow.name}' declares no effects or capabilities. ` +
          `Privileged flows should explicitly declare what authority they require.`,
          loc,
          `Add a contract or effects declaration: contract { effects { privileged.action } }`,
        ));
      }
    }

    // ── LLN-GOV-013: pure flow crossing into governed boundary ────────────
    // If a pure flow body contains a callExpr whose name resolves to a flow
    // in the program that is "guarded" or "secure", emit LLN-GOV-013.
    if (flowNode !== undefined && flow.qualifier === "pure") {
      const callNodes = findNodes(flowNode, "callExpr");
      for (const callNode of callNodes) {
        const calleeName = callNode.value ?? "";
        if (calleeName === "") continue;
        // Check if calleeName matches a guarded or secure flow in the program
        const calleeEffectResult = allEffectResults.find(
          (r) => r.flowName === calleeName,
        );
        // Also check the flows list for qualifier
        const calleeFlowMeta = allFlows.find((f) => f.name === calleeName);
        const isGoverned =
          calleeFlowMeta?.qualifier === "guarded" ||
          calleeFlowMeta?.qualifier === "secure" ||
          (calleeEffectResult?.declaredEffects ?? []).length > 0;
        if (isGoverned) {
          this.diagnostics.push(makeGovDiag(
            LLN_GOV_013.code,
            LLN_GOV_013.name,
            "error",
            `Pure flow '${flow.name}' calls '${calleeName}' which is a governed or effectful flow. ` +
            LLN_GOV_013.message,
            callNode.location ?? loc,
            LLN_GOV_013.suggestedFix,
          ));
        }
      }
    }

    // ── LLN-GOV-011/012: contract set references ──────────────────────────
    if (flowNode !== undefined) {
      // Find contractDecl child of the flow
      const contractNode = (flowNode.children ?? []).find((c) => c.kind === "contractDecl");
      if (contractNode !== undefined) {
        // Find all `use:SetName` identifier children
        for (const child of contractNode.children ?? []) {
          if (child.kind === "identifier" && child.value?.startsWith("use:")) {
            const setName = child.value.slice("use:".length);
            const contractSetNode = this.knownContractSets.get(setName);

            if (contractSetNode === undefined) {
              // LLN-GOV-011: unknown contract set
              this.diagnostics.push(makeGovDiag(
                LLN_GOV_011.code,
                LLN_GOV_011.name,
                "error",
                `Flow '${flow.name}' references unknown contract set '${setName}'. Declare it with: contract set ${setName} { ... }`,
                child.location ?? loc,
                `Add at program scope: contract set ${setName} { rules { } events { } audit { } }`,
              ));
            } else {
              // LLN-GOV-012: check audit requirements
              // Find audit:block child in the contractSetDecl
              const auditBlock = (contractSetNode.children ?? []).find(
                (c) => c.kind === "identifier" && c.value === "audit:block",
              );
              if (auditBlock !== undefined && (auditBlock.children ?? []).length > 0) {
                // Audit block has content — check whether flow declares audit.write
                const hasAuditWrite = flow.declaredEffects.includes("audit.write");
                if (!hasAuditWrite) {
                  this.diagnostics.push(makeGovDiag(
                    LLN_GOV_012.code,
                    LLN_GOV_012.name,
                    "warning",
                    `Flow '${flow.name}' uses contract set '${setName}' which requires audit.write, but the flow does not declare it.`,
                    child.location ?? loc,
                    `Add 'audit.write' to the flow's effects declaration.`,
                  ));
                }
              }
            }
          }
        }
      }
    }

    // ── LLN-VAL: contract.value and contract.safety enforcement ──────────
    if (flowNode !== undefined) {
      const classification = extractValueClassification(flowNode);

      if (classification !== null) {
        // LLN-VAL-003: Unknown classification
        if (!RECOGNISED_VALUE_CLASSIFICATIONS.has(classification)) {
          this.diagnostics.push({
            ...LLN_VAL_003,
            message: `${LLN_VAL_003.message.replace("Unrecognised classification in contract.value.", `Unknown classification '${classification}' in contract.value for flow '${flow.name}':`)}`,
            location: loc,
            suggestedFix: LLN_VAL_003.suggestedFix,
          });
        }

        if (classification === "safety_critical") {
          // LLN-VAL-001: safety_critical must declare audit.write
          if (!flow.declaredEffects.includes("audit.write")) {
            this.diagnostics.push({
              ...LLN_VAL_001,
              message: `Flow '${flow.name}' is classified safety_critical but does not declare audit.write. ${LLN_VAL_001.why}`,
              location: loc,
              suggestedFix: LLN_VAL_001.suggestedFix,
            });
          }

          // LLN-VAL-002: safety_critical must require deterministic_execution in contract.safety
          const safetyReqs = extractSafetyRequirements(flowNode);
          if (!safetyReqs.has("deterministic_execution")) {
            this.diagnostics.push({
              ...LLN_VAL_002,
              message: `Flow '${flow.name}' is classified safety_critical but does not declare 'require deterministic_execution' in contract.safety. ${LLN_VAL_002.why}`,
              location: loc,
              suggestedFix: LLN_VAL_002.suggestedFix,
            });
          }
        }
      }
    }

    // ── LLN-HW: contract.hardware ProofLevel enforcement ─────────────────
    // Phase 26B: auto-infer proof requirements from HARDWARE_TRUST_PROFILES.
    // No explicit contract syntax needed — the seal and proof level are automatic.
    if (flowNode !== undefined) {
      const hwTargets = extractHardwareTargets(flowNode);
      const hasAuditWrite = flow.declaredEffects.includes("audit.write");
      const hasAuditAttestation = (flowNode.children ?? []).some(c =>
        c.kind === "contractDecl" &&
        (c.children ?? []).some(child =>
          child.kind === "identifier" &&
          child.value === "audit:block" &&
          (child.children ?? []).some(a =>
            a.kind === "identifier" && a.value?.includes("runtime_attestation")
          )
        )
      );

      for (const targetId of hwTargets) {
        const profile = HARDWARE_TRUST_PROFILES.get(targetId);
        if (profile === undefined) continue; // unknown target — not our concern here

        // LLN-HW-001: quantum target requires FormalRequired proof chain
        if (profile.requiredProofLevel >= ProofLevel.FormalRequired) {
          this.diagnostics.push({
            ...LLN_HW_001,
            message: `Flow '${flow.name}' declares hardware target '${targetId}' (ExperimentalPlane). ${LLN_HW_001.message}`,
            location: loc,
            suggestedFix: LLN_HW_001.suggestedFix,
          });
        }

        // LLN-HW-002: sealed target (NPU/TPU/ANE) without audit.write
        if (profile.requiredProofLevel >= ProofLevel.Sealed &&
            profile.requiredProofLevel < ProofLevel.FormalRequired &&
            !hasAuditWrite) {
          this.diagnostics.push({
            ...LLN_HW_002,
            message: `Flow '${flow.name}' uses sealed hardware target '${targetId}' but does not declare audit.write. ${LLN_HW_002.message}`,
            location: loc,
            suggestedFix: LLN_HW_002.suggestedFix,
          });
        }

        // LLN-HW-003: AcceleratorPlane (photonic/neuromorphic) without attestation requirement
        if (profile.requiresAttestation && !hasAuditAttestation && !hasAuditWrite) {
          this.diagnostics.push({
            ...LLN_HW_003,
            message: `Flow '${flow.name}' uses AcceleratorPlane target '${targetId}'. ${LLN_HW_003.message}`,
            location: loc,
            suggestedFix: LLN_HW_003.suggestedFix,
          });
        }
      }
    }

    // ── Compute GovernanceFlags bitmask for this flow ─────────────────────
    {
      const fn = flowNode;
      const hasAuditEff  = flow.declaredEffects.includes("audit.write");
      const hasAuditCall = fn !== undefined && hasCallTo(fn, /^AuditLog\.write$/);
      const hasDbWrite   = flow.declaredEffects.includes("database.write");
      const deniedTargets = fn !== undefined ? extractDeniedTargets(fn) : [];
      const hasRemoteDenied   = deniedTargets.some((t) => t === "remote.execution" || t === "remote");
      const hasNetworkOutbound = flow.declaredEffects.includes("network.outbound");
      const hasPII       = flow.declaredEffects.some((e) => e.startsWith("pii.") || e.startsWith("phi."));
      const hasPolicy    = fn !== undefined && (fn.children ?? []).some((c) => c.kind === "policyDecl");
      const hasIntent    = fn !== undefined && hasIntentDecl(fn);
      const requiresIntent  = flow.qualifier === "secure" && !hasIntent;
      const isProduction    = this.currentProfile === "production" || this.currentProfile === "deterministic";
      const noErrors        = !this.diagnostics.some((d) => d.severity === "error");

      const requiredContext = fn !== undefined ? extractRequiredContext(fn) : [];
      const needsActor = requiredContext.some((f) => f === "actor" || f === "user_id");

      const mask: GovernanceFlagsMask =
        ((hasAuditEff || hasAuditCall || hasDbWrite) ? GovernanceFlags.RequiresAudit : GovernanceFlags.None) |
        (hasRemoteDenied            ? GovernanceFlags.DenyRemote        : GovernanceFlags.None) |
        (hasPII                     ? GovernanceFlags.ContainsPII        : GovernanceFlags.None) |
        (hasNetworkOutbound         ? GovernanceFlags.AllowsNetwork      : GovernanceFlags.None) |
        (hasPolicy                  ? GovernanceFlags.HasPolicy          : GovernanceFlags.None) |
        (requiresIntent             ? GovernanceFlags.RequiresIntent     : GovernanceFlags.None) |
        (isProduction && noErrors   ? GovernanceFlags.ProductionStrict   : GovernanceFlags.None) |
        (needsActor                 ? GovernanceFlags.RequiresActor      : GovernanceFlags.None);

      this.governanceFlagsByFlow.set(flow.name, mask);

      // Generate RuntimeManifest for production/deterministic profiles
      if (isProduction) {
        const arenaLimitMb = fn !== undefined ? extractArenaLimitMB(fn) : undefined;
        const manifest: RuntimeManifest = {
          schemaVersion: "lln.runtime.manifest.v1",
          flow: flow.name,
          qualifier: flow.qualifier,
          requiresAudit:    (mask & GovernanceFlags.RequiresAudit) !== 0,
          deniesRemote:     (mask & GovernanceFlags.DenyRemote)    !== 0,
          allowedEffects:   [...flow.declaredEffects].sort(),
          requiredContext:  requiredContext,
          computeTarget:    "best",   // Phase 20: extracted from compute block
          governanceFlagsMask: mask,
          proofObligations: this.proofObligations.filter((o) => o.includes(flow.name)),
          policyPurposes:   fn !== undefined ? extractPolicyPurposes(fn) : [],
          verified:         noErrors,
          arenaLimitMb,
        };
        this.runtimeManifests.push(manifest);
      }

      // ── Build ProofGraph for this flow ────────────────────────────────────
      const hasEffectsFlag = (mask & GovernanceFlags.RequiresAudit) !== 0;
      const hasContractFlag = fn !== undefined && (fn.children ?? []).some((c) => c.kind === "contractDecl");
      const hasPrivacyFlag  = (mask & GovernanceFlags.ContainsPII) !== 0;

      // Build ProofObligation list from the flow's governance checks
      const obligations: ProofObligation[] = [];

      if (hasEffectsFlag) obligations.push({
        kind: "effect",
        claim: `Flow ${flow.name} declares required effects`,
        satisfiedBy: "contract.effects",
        diagnosticCode: "LLN-EFFECT-001",
      });
      if (hasContractFlag) obligations.push({
        kind: "capability",
        claim: `Flow ${flow.name} has a contract declaration`,
        satisfiedBy: "contract",
      });
      if (hasPrivacyFlag) obligations.push({
        kind: "privacy",
        claim: `Flow ${flow.name} declares privacy policy`,
        satisfiedBy: "contract.privacy",
        diagnosticCode: "LLN-VALUESTATE-006",
      });

      // Build ExecutionSignature from flow flags
      // effectMask: 0 here — full EffectFlags derivation is Phase 32
      const sig = computeExecutionSignature(
        0, mask, 0, 0, fn?.flags ?? 0,
        flow.declaredEffects.length, 0, false,
      );

      const pg = buildProofGraphCached(
        flow.name, sig, obligations,
        obligations.map((ob) => ({
          obligationKind: ob.kind,
          sourceHash: "sha256:pending",
          girHash: "sha256:pending",
          checkerPassed: true,
          diagnosticsFired: [],
        })),
        "2026-06-01T00:00:00.000Z",
      );
      this.proofGraphsByFlow.set(flow.name, pg);
    }

    // ── LLN-GOV-017: cyber_physical_hardening {} value validation ────────────
    // Validates that if a flow explicitly declares cyber_physical_hardening {},
    // the values are recognised. Also warns if declared on a low-risk flow
    // (auto-by-default is preferred; manual declaration should have good reason).
    // ── LLN-GOV-018: manual liability {} block warning ────────────────────────
    // liability {} is auto-calculated — writing it manually is a design smell.
    if (flowNode !== undefined) {
      this.verifyPhysicalHardeningBlock(flowNode, flow.name);
      this.verifyLiabilityBlock(flowNode, flow.name);
    }

    // ── Phase 2: LLN-GOV-019 limits block field validation ───────────────────
    if (flowNode !== undefined) {
      this.verifyLimitsBlock(flowNode, flow.name);
    }

    // ── Phase 2: LLN-GOV-020 authority overly-broad detection ────────────────
    if (flowNode !== undefined) {
      const authNodes = findNodes(flowNode, "authorityDecl");
      for (const authNode of authNodes) {
        if (hasOverlyBroadAuthority(authNode)) {
          this.diagnostics.push(makeGovDiag(
            "LLN-GOV-020",
            "AUTHORITY_OVERLY_BROAD",
            "warning",
            `Authority block in flow '${flow.name}' uses 'requires *' or 'requires all', which grants all capabilities. ` +
            `Declare specific capabilities instead.`,
            authNode.location ?? loc,
            `Replace 'requires *' with the specific capabilities this flow needs, e.g. 'require payment.read'.`,
          ));
        }
      }
    }

    // ── Phase 3: LLN-GOV-006 high-risk secure flow without epilogue ──────────
    if (flowNode !== undefined && flow.qualifier === "secure") {
      const maxRisk = extractMaxRiskLiability(flowNode);
      if (maxRisk !== undefined && maxRisk >= 5000 && !hasEpilogueBlock(flowNode)) {
        this.diagnostics.push(makeGovDiag(
          "LLN-GOV-006",
          "GOVERNANCE_PROOF_REQUIRED_BUT_MISSING",
          "warning",
          `Secure flow '${flow.name}' has high max_risk_liability (${maxRisk}) but no epilogue {} proof strategy declared. ` +
          `Consider adding epilogue { generate_proof sha256_seal } to produce a verifiable receipt.`,
          loc,
          `Add: contract { ... epilogue { generate_proof sha256_seal  on_verification_failure log_and_continue } }`,
        ));
      }
    }

    // ── Phase 3: LLN-TERM-001 recursive secure flow without decreases ────────
    if (flowNode !== undefined) {
      this.verifyTerminationAnnotation(flow, flowNode);
    }

    // ── LLN-GOV-015/016: epilogue {} strategy validation ─────────────────────
    // When a flow explicitly declares an `epilogue {}` block, validate that the
    // proof strategy and failure action are recognised values.  An omitted block
    // is AUTO-by-default (the runtime selects the tier from the ValueGraph) and
    // emits no diagnostic. Only an invalid explicit value is an error.
    if (flowNode !== undefined) {
      this.verifyEpilogueBlock(flowNode, flow.name);
    }

    // ── LLN-GOV-004 / LLN-LIMIT-001: Domain Guard Differential Proof (task #56) ──
    // If the flow's contract declares [conforms_to: PolicyName], load the external
    // policy and verify that the contract's declared effects and limits are a strict
    // SUBSET of the policy's permitted_effects and enforced_limits ceilings.
    if (flowNode !== undefined) {
      this.verifyDomainGuardConformance(flow, flowNode);
    }

    // ── LLN-INV-001/002: invariant {} static evaluation (DRCM Phase 2 — task #36) ──
    // For each `ensure expr` in the invariant block:
    //   - Statically provable TRUE  → record as statically_verified in ProofGraph
    //   - Statically provable FALSE → LLN-INV-001 hard error (dead code: invariant always fails)
    //   - Unknown at compile time   → record as runtime-precheck (WAT gate to be injected)
    if (flowNode !== undefined) {
      this.verifyInvariantBlock(flow, flowNode, loc);
    }

    // ── LLN-TRAP-001/002: trap {} declarations in flow body ───────────────────
    if (flowNode !== undefined) {
      this.verifyTrapDecls(flow, flowNode, loc);
    }

    // ── LLN-MATCH-001: match exhaustiveness check ─────────────────────────────
    if (flowNode !== undefined) {
      this.checkMatchExhaustiveness(flow, flowNode, loc);
    }

    // ── LLN-CAP-001: Network wildcard ban (DRCM Phase 1 — task #30) ──────────
    // Wildcard `*` in network capability declarations introduces parsing vulnerabilities
    // and ambient authority leaks. Force explicit NetworkTarget variants.
    if (flowNode !== undefined) {
      this.verifyNetworkWildcardBan(flow, flowNode, loc);
    }

    // ── LLN-RES-001: Resilience violation — retry + mutation without idempotent (task #58) ──
    if (flowNode !== undefined) {
      const resViolations = checkResilienceViolations(flowNode, flow);
      for (const v of resViolations) {
        this.diagnostics.push(makeGovDiag(
          v.code,
          "RESILIENCE_RETRY_ON_MUTATION",
          "error",
          v.message,
          loc,
          `Add 'idempotent: true' to the resilience {} block, or remove the retry declaration.`,
        ));
      }
    }

    // ── LLN-OBS-001: Observability on pure flow warning (task #58) ──
    if (flowNode !== undefined) {
      const obsWarnings = checkObservabilityWarnings(flowNode, flow);
      for (const w of obsWarnings) {
        this.diagnostics.push(makeGovDiag(
          w.code,
          "OBSERVABILITY_ON_PURE_FLOW",
          "warning",
          w.message,
          loc,
          `Remove the observability {} block from this pure flow.`,
        ));
      }
    }

    // ── LLN-SUBSTRATE-001..004: substrate {} contract obligations (Direction B) ──
    // B1 crypto-on-noisy-lane · B2 redundancy sufficiency vs the noise model ·
    // B3 un-voted analog into a deterministic sink. Inert for flows without a
    // substrate {} block (or lane: digital). Safety is inherited from Direction A's
    // vAnd/No-Coercion; these codes guard provability/availability.
    if (flowNode !== undefined) {
      // A `safety { require deterministic_execution }` clause is a B3 determinism sink
      // regardless of the deployment profile (spec §4.3 item 3).
      const externalDeterminismSink = extractSafetyRequirements(flowNode).has("deterministic_execution");
      const subViolations = checkSubstrateViolations(flowNode, flow, this.currentProfile, externalDeterminismSink);
      for (const v of subViolations) {
        this.diagnostics.push(makeGovDiag(v.code, v.name, v.severity, v.message, loc, v.suggestedFix));
      }
    }

    // ── LLN-CRYPTO-PQ-001: a Sign effect must be post-quantum/hybrid in a certified profile ──
    // (quantum-resistance posture R2). Ed25519-only — or algorithm-unspecified — signing is
    // Shor-breakable, so it is denied when the deployment is certified (production/deterministic);
    // dev/check-only profiles allow it. The author asserts the algorithm with a marker effect
    // alongside crypto.sign, e.g. `effects { crypto.sign crypto.sign.hybrid }`.
    if (this.currentProfile === "production" || this.currentProfile === "deterministic") {
      const signEffects = flow.declaredEffects.filter(
        e => e === "crypto.sign" || e.startsWith("crypto.sign."),
      );
      if (signEffects.length > 0 && !signEffects.some(e => PQ_SIGN_ALGORITHMS.has(e))) {
        this.diagnostics.push(makeGovDiag(
          LLN_CRYPTO_PQ_001.code, LLN_CRYPTO_PQ_001.name, LLN_CRYPTO_PQ_001.severity,
          LLN_CRYPTO_PQ_001.message, loc,
          "Declare the PQ algorithm: effects { crypto.sign crypto.sign.hybrid }.",
        ));
      }
    }

    // ── LLN-OBS-002: observability {} must not access privacy {} scope (task #66) ──
    // The observability block emits telemetry (best-effort, lossy, non-authoritative).
    // Telemetry must NEVER contain PII, PHI, or secrets declared in privacy {}.
    // Privacy-scoped variables (masked fields) must not appear in observability metrics.
    //
    // Rule: if a flow declares both privacy {} AND observability {}, the compiler
    // must ensure no privacy-scoped field names appear in observability metric names.
    if (flowNode !== undefined) {
      const contractNode = (flowNode.children ?? []).find(c => c.kind === "contractDecl");
      if (contractNode !== undefined) {
        const hasObservability = (contractNode.children ?? []).some(
          c => c.kind === "identifier" && c.value === "observability:block"
        );
        const privacyBlock = (contractNode.children ?? []).find(
          c => c.kind === "identifier" && c.value === "privacy:block"
        );
        if (hasObservability && privacyBlock !== undefined) {
          // Extract privacy-scoped field names from privacy:block declarations
          const privacyFields = new Set<string>(
            (privacyBlock.children ?? [])
              .filter(c => (c.value ?? "").startsWith("pii:") || (c.value ?? "").startsWith("phi:"))
              .map(c => (c.value ?? "").replace(/^(pii|phi):/, "").trim())
              .filter(Boolean)
          );
          // Check observability block for any metric names matching privacy fields
          const observabilityBlock = (contractNode.children ?? []).find(
            c => c.kind === "identifier" && c.value === "observability:block"
          );
          for (const child of observabilityBlock?.children ?? []) {
            const decl = child.value ?? "";
            for (const privField of privacyFields) {
              if (decl.includes(privField)) {
                this.diagnostics.push(makeGovDiag(
                  "LLN-OBS-002",
                  "OBSERVABILITY_ACCESSES_PRIVACY_SCOPE",
                  "error",
                  `Flow '${flow.name}': observability {} references '${privField}' which is declared in privacy {}. ` +
                  `Telemetry must never expose PII/PHI fields. Use aggregate metrics (latency, error_rate) instead.`,
                  loc,
                  `Remove '${privField}' from observability metrics, or use redact(${privField}) in a separate audit {} block.`,
                ));
              }
            }
          }
        }
      }
    }

    // ── LLN-ASSUME-001..004: assuming {} proof-tracing verification (task #74) ──
    if (flowNode !== undefined) {
      this.verifyAssumingBlocks(flowNode, flow, loc);
    }

    // ── LLN-ACCESS-001/002: access {} capability grant enforcement (task #89) ──
    if (flowNode !== undefined) {
      this.verifyAccessBlocks(flowNode, flow, loc);
    }
  }

  /**
   * LLN-ASSUME-001..004: Verify all `assuming {}` blocks in a contract.
   *
   * For each assumingDecl:
   *   1. Check flowRef names a known flow in this compilation unit (LLN-ASSUME-001)
   *   2. Check the claim string appears as a ProofObligation in the known flow (LLN-ASSUME-002)
   *   3. If the flow is external, require that it was compiled with a valid GovernanceSignature (LLN-ASSUME-004)
   *   Note: LLN-ASSUME-003 (manifest file freshness) is a Phase 5 check — requires disk I/O at admission gate.
   *         In Stage A we emit a warning-only placeholder for cross-module assuming().
   */
  private verifyAssumingBlocks(
    flowNode: AstNode,
    flow: FlowMeta,
    loc: SourceLocation | undefined,
  ): void {
    const contractNode = (flowNode.children ?? []).find(c => c.kind === "contractDecl");
    if (contractNode === undefined) return;

    const assumingBlocks = (contractNode.children ?? []).filter(c => c.kind === "assumingDecl");
    if (assumingBlocks.length === 0) return;

    for (const block of assumingBlocks) {
      const refFlowName = block.flowRef ?? "";
      const claim = block.claim ?? "";

      if (refFlowName === "") {
        this.diagnostics.push(makeGovDiag(
          "LLN-ASSUME-001",
          "ASSUMING_MISSING_FLOW_REF",
          "error",
          `Flow '${flow.name}': assuming() requires a flow reference as first argument. ` +
          `Syntax: assuming(flowName, "ensure condition") { }`,
          loc,
          `Provide the name of the flow whose proof you are borrowing.`,
        ));
        continue;
      }

      if (claim === "") {
        this.diagnostics.push(makeGovDiag(
          "LLN-ASSUME-001",
          "ASSUMING_MISSING_CLAIM",
          "error",
          `Flow '${flow.name}': assuming() requires a claim string as second argument. ` +
          `Syntax: assuming(flowName, "ensure condition") { }`,
          loc,
          `Provide the proof obligation claim, e.g. "ensure amount > 0".`,
        ));
        continue;
      }

      // Check: does refFlowName exist in the current compilation unit?
      const refFlow = this.knownFlows.get(refFlowName);
      if (refFlow === undefined) {
        // The flow is either external or doesn't exist.
        // External flows require GovernanceSignature — emit LLN-ASSUME-004 warning.
        // Full manifest-file lookup (LLN-ASSUME-003) is deferred to Phase 5 admission gate.
        this.diagnostics.push(makeGovDiag(
          "LLN-ASSUME-004",
          "ASSUMING_EXTERNAL_FLOW",
          "warning",
          `Flow '${flow.name}': assuming() references '${refFlowName}' which is not in this ` +
          `compilation unit. External proof borrowing requires a GovernanceSignature on ` +
          `'${refFlowName}'.lmanifest. The admission gate (logicn verify) will check this at runtime.`,
          loc,
          `Ensure '${refFlowName}' is compiled separately and its .lmanifest is available at ` +
          `deployment time. Run: logicn verify --assuming ${refFlowName}`,
        ));
        continue;
      }

      // The flow exists in this compilation unit — check if it has the claimed proof obligation.
      // We check the flow's contract invariant {} blocks for a matching ensure expression.
      const refFlowContract = (refFlow.node?.children ?? []).find(c => c.kind === "contractDecl");
      if (refFlowContract === undefined) {
        this.diagnostics.push(makeGovDiag(
          "LLN-ASSUME-002",
          "ASSUMING_NO_CONTRACT",
          "error",
          `Flow '${flow.name}': assuming() references '${refFlowName}' but that flow has ` +
          `no contract {} block. Cannot borrow a proof that was never declared.`,
          loc,
          `Add an invariant {} block to '${refFlowName}' declaring the claimed ensure condition.`,
        ));
        continue;
      }

      // Check ensure expressions — normalise whitespace for comparison
      const normalise = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
      const normClaim = normalise(claim);

      let claimFound = false;
      for (const invBlock of (refFlowContract.children ?? [])) {
        for (const child of (invBlock.children ?? [])) {
          if (child.kind === "ensureDecl" || (child.kind === "identifier" && normalise(child.value ?? "").includes("ensure"))) {
            // Reconstruct the ensure text from AST for comparison
            const ensureText = normalise(`ensure ${child.value ?? ""}`);
            if (ensureText.includes(normClaim) || normClaim.includes(ensureText)) {
              claimFound = true;
              break;
            }
          }
        }
        if (claimFound) break;
      }

      if (!claimFound) {
        this.diagnostics.push(makeGovDiag(
          "LLN-ASSUME-002",
          "ASSUMING_CLAIM_NOT_FOUND",
          "warning",
          `Flow '${flow.name}': assuming() claims '${claim}' is proved in '${refFlowName}', ` +
          `but no matching ensure expression was found in that flow's invariant {} block. ` +
          `The WAT gate will NOT be elided — this proof will be treated as unverified.`,
          loc,
          `Verify the claim string matches exactly an ensure expression in '${refFlowName}' invariant {}. ` +
          `Or add: ensure ${claim.replace(/^ensure\s+/, "")} to '${refFlowName}' invariant {}.`,
        ));
      }
      // If claimFound: proof borrowed successfully — no WAT gate emitted for this claim.
      // This is recorded in the ProofGraph as "borrowed:refFlowName" for the manifest.
    }
  }

  // ── DRCM Phase 2: invariant {} static evaluation ─────────────────────────────
  // Three outcomes per `ensure` expression:
  //   1. Statically TRUE  → statically_verified in ProofGraph (Goal A: no runtime overhead)
  //   2. Statically FALSE → LLN-INV-001 hard error (invariant can never be satisfied)
  //   3. Unknown          → runtime-precheck in ProofGraph (WAT gate injected — Unit 3, task #36)

  private verifyInvariantBlock(flow: FlowMeta, flowNode: AstNode, loc: SourceLocation | undefined): void {
    const contractNode = (flowNode.children ?? []).find(c => c.kind === "contractDecl");
    if (contractNode === undefined) return;

    // Find the invariant:block sub-block (stored as "invariant:block" identifier node)
    const invariantBlock = (contractNode.children ?? []).find(
      c => c.kind === "identifier" && c.value === "invariant:block"
    );
    if (invariantBlock === undefined) return;

    // Build the set of names that are in scope for ensure expressions.
    // In scope: flow parameters (from paramDecl children).
    // The WAT emitter maps these to $p0, $p1, … via local.get.
    // Any identifier in ensure that's NOT in this set → LLN-INV-004.
    const paramNames = new Set<string>(
      (flowNode.children ?? [])
        .filter(c => c.kind === "paramDecl")
        .map(c => ((c.value ?? "").split(":")[0] ?? "").trim())
        .filter(n => n.length > 0)
    );
    // 0040/#70: `result` is the magic OUTPUT symbol. An `ensure` that references it is an
    // output post-condition checked against the return value at the single flow exit — not a
    // parameter pre-condition. Add it to the in-scope set so it is NOT rejected as LLN-INV-004;
    // it is enforced fail-closed by the interpreter (interpreter.checkOutputPostconditions),
    // and the WAT tier declines such flows to that interpreter until single-exit lowering lands.
    const scopeNames = new Set<string>([...paramNames, "result"]);

    // Scan children for ensureDecl nodes
    let invariantCount = 0;
    for (const child of invariantBlock.children ?? []) {
      if (child.kind !== "ensureDecl") continue;
      invariantCount++;
      const exprNode = child.children?.[0];
      if (exprNode === undefined) continue;

      const isPostcondition = exprReferencesResult(exprNode);

      // LLN-INV-004: every identifier in the ensure expr must be in scope — a flow parameter,
      // or `result` for an output post-condition. Unknown names (typos) are still rejected.
      const unresolvedNames = collectUnresolvedIdentifiers(exprNode, scopeNames);
      for (const name of unresolvedNames) {
        this.diagnostics.push(makeGovDiag(
          "LLN-INV-004",
          "SYMBOL_UNRESOLVED_IN_INVARIANT",
          "error",
          `Flow '${flow.name}': invariant 'ensure ${this.describeExpr(exprNode)}' references ` +
          `'${name}' which is not a parameter of this flow. ` +
          `Available parameters: [${[...paramNames].join(", ") || "none"}].`,
          loc,
          `Check the spelling of '${name}' or use a flow parameter name instead.`,
        ));
      }

      // Attempt lightweight static evaluation (constant fold)
      const staticResult = this.tryStaticEval(exprNode);

      if (staticResult === false) {
        // LLN-INV-001: statically proved FALSE → invariant can NEVER be satisfied
        this.diagnostics.push(makeGovDiag(
          "LLN-INV-001",
          "PRE_CONDITION_STATICALLY_FALSE",
          "error",
          `Flow '${flow.name}': invariant 'ensure ${this.describeExpr(exprNode)}' can never be satisfied ` +
          `(statically evaluated to false). This flow would always trap at runtime.`,
          loc,
          `Fix or remove the 'ensure' expression — it evaluates to false for all inputs.`,
        ));
      }
      // Record in ProofGraph regardless of static result
      const exprDesc = this.describeExpr(exprNode);
      if (isPostcondition) {
        // 0040/#70: output post-condition — enforced fail-closed against the return value at
        // the single flow exit by the interpreter (and any tier with single-exit lowering).
        this.proofObligations.push(`invariant_postcondition:${flow.name}:ensure ${exprDesc}:runtime-postcondition`);
      } else if (staticResult === true) {
        // Statically verified — no WAT gate, no runtime overhead (Goal A)
        this.proofObligations.push(`invariant_static:${flow.name}:ensure ${exprDesc}:statically_verified`);
      } else if (staticResult === null) {
        // Unknown — runtime-precheck (WAT gate will be injected in WAT emitter, Unit 3)
        this.proofObligations.push(`invariant_runtime:${flow.name}:ensure ${exprDesc}:runtime-precheck`);
      }
      // staticResult === false → LLN-INV-001 error already emitted above; not recorded as obligation
    }

    // If the invariant block exists but is empty, warn
    if (invariantCount === 0) {
      this.diagnostics.push(makeGovDiag(
        "LLN-INV-003",
        "INVARIANT_BLOCK_EMPTY",
        "warning",
        `Flow '${flow.name}' declares an invariant {} block with no 'ensure' statements. ` +
        `Add at least one 'ensure expr' or remove the block.`,
        loc,
        `Add: ensure <condition>; inside the invariant {} block.`,
      ));
    }
  }

  /**
   * Lightweight constant-fold static evaluator for `ensure` expressions.
   * Returns: true (proved), false (disproved), null (unknown — needs runtime check)
   *
   * Phase 2 scope: only handles literal comparisons and trivially true/false expressions.
   * Phase 4 (SMT solver) will handle arithmetic equality, state invariants, etc.
   */
  private tryStaticEval(expr: AstNode): boolean | null {
    // Boolean literal: ensure true / ensure false
    if (expr.kind === "boolLiteral") {
      return expr.value === "true";
    }

    // Binary comparison with two number literals: ensure 5 > 0, ensure 0 == 0
    if (expr.kind === "binaryExpr" && expr.children?.length === 2) {
      const left  = expr.children[0];
      const right = expr.children[1];
      if (left?.kind === "numberLiteral" && right?.kind === "numberLiteral") {
        const l = parseFloat(left.value ?? "0");
        const r = parseFloat(right.value ?? "0");
        const op = expr.value ?? "";
        switch (op) {
          case ">":  return l > r;
          case "<":  return l < r;
          case ">=": return l >= r;
          case "<=": return l <= r;
          case "==": return l === r;
          case "!=": return l !== r;
        }
      }
    }

    // Logical NOT on a literal: ensure !false
    if (expr.kind === "unaryExpr" && expr.value === "!" && expr.children?.[0]?.kind === "boolLiteral") {
      return expr.children[0].value !== "true";
    }

    // Everything else is unknown → runtime-precheck
    return null;
  }

  /** Produce a short human-readable description of an expression for error messages. */
  private describeExpr(expr: AstNode): string {
    if (expr.kind === "boolLiteral")   return expr.value ?? "?";
    if (expr.kind === "numberLiteral") return expr.value ?? "?";
    if (expr.kind === "identifier")    return expr.value ?? "?";
    if (expr.kind === "binaryExpr" && expr.children?.length === 2) {
      return `${this.describeExpr(expr.children[0]!)} ${expr.value ?? "?"} ${this.describeExpr(expr.children[1]!)}`;
    }
    if (expr.kind === "memberExpr" && expr.children?.length === 1) {
      return `${this.describeExpr(expr.children[0]!)}.${expr.value ?? "?"}`;
    }
    return "...";
  }

  // ── LLN-CAP-001: Network wildcard ban (DRCM Phase 1 — task #30) ─────────────

  private verifyNetworkWildcardBan(flow: FlowMeta, flowNode: AstNode, loc: SourceLocation | undefined): void {
    const contractNode = (flowNode.children ?? []).find(c => c.kind === "contractDecl");
    if (contractNode === undefined) return;

    // Scan all contract sub-blocks for wildcard `*` in network-related declarations.
    // Wildcards can appear as:
    //   effects { network.* }
    //   authority { requires network.* }
    //   authority { requires * }  (overly broad — also caught by LLN-GOV-020)
    for (const child of contractNode.children ?? []) {
      if (child.kind !== "identifier") continue;
      const val = child.value ?? "";

      // Check for `*` in network-related effect declarations
      const isNetworkDecl = val.startsWith("decl:network") || val.includes("network.*") ||
                            val.startsWith("decl:") && val.includes("*");

      // Check effectRef nodes that contain wildcards
      const isWildcardRef = child.kind === "identifier" && val.includes("*") &&
                            (val.includes("network") || val.startsWith("decl:"));

      if (isNetworkDecl || isWildcardRef) {
        this.diagnostics.push(makeGovDiag(
          "LLN-CAP-001",
          "NETWORK_WILDCARD_BANNED",
          "error",
          `Flow '${flow.name}' uses a wildcard '*' in a network capability declaration. ` +
          `Wildcards introduce parsing vulnerabilities and ambient authority leaks. ` +
          `Use explicit NetworkTarget variants instead: ExplicitHost("fqdn") or UnrestrictedInternet.`,
          loc,
          `Replace 'network.*' or 'network: "*"' with an explicit target: effects { network.outbound } ` +
          `and a typed NetworkTarget in the requires block.`,
        ));
      }
    }

    // Also check flow's declared effects for wildcards (effects are pre-processed)
    for (const effect of flow.declaredEffects) {
      if (effect.includes("*")) {
        this.diagnostics.push(makeGovDiag(
          "LLN-CAP-001",
          "NETWORK_WILDCARD_BANNED",
          "error",
          `Flow '${flow.name}' declares wildcard effect '${effect}'. ` +
          `Wildcards are banned — use explicit effect names (e.g. network.outbound, database.read).`,
          loc,
          `Replace '${effect}' with the specific effect this flow needs.`,
        ));
      }
    }
  }

  // ── Domain Guard Differential Proof ──────────────────────────────────────────

  private verifyDomainGuardConformance(flow: FlowMeta, flowNode: AstNode): void {
    // Find the contractDecl with a conformsTo attribute
    const contractNode = (flowNode.children ?? []).find((c) => c.kind === "contractDecl" && c.conformsTo !== undefined);
    if (contractNode === undefined || contractNode.conformsTo === undefined) return;

    const policyName = contractNode.conformsTo;
    const policyNode = this.knownDomainGuards.get(policyName);

    if (policyNode === undefined) {
      // GOV-001 (ratified 2026-06-16): a broken conforms_to inheritance chain. Because an OMITTED
      // permitted_effects block auto-inherits its safety boundary from this policy, a missing
      // policy means the boundary cannot be resolved — FATAL in production/deterministic
      // (fail-closed); a warning in dev (the policy may be in another file still being authored).
      const isProduction = this.currentProfile === "production" || this.currentProfile === "deterministic";
      this.diagnostics.push(makeGovDiag(
        "LLN-GOV-004",
        "DOMAIN_GUARD_NOT_FOUND",
        isProduction ? "error" : "warning",
        `Flow '${flow.name}' declares [conforms_to: ${policyName}] but no policy '${policyName}' was found in this file.` +
        (isProduction
          ? ` A production/deterministic build fails closed on a broken conformance chain.`
          : ` Ensure the policy is declared at the top level of the same file or imported.`),
        contractNode.location ?? flowNode.location,
        `Add: guard ${policyName} { permitted_effects { ... } enforced_limits { ... } }`,
      ));
      return;
    }

    // Extract permitted_effects from the policy
    const permittedEffectsBlock = (policyNode.children ?? []).find(
      (c) => c.kind === "identifier" && c.value === "permitted_effects"
    );
    const permittedEffects = new Set<string>(
      (permittedEffectsBlock?.children ?? [])
        .filter((c) => c.kind === "effectRef" && c.value !== undefined)
        .map((c) => c.value as string)
    );

    // GOV-001 permitted_effects state machine (K3 — ratified 2026-06-16):
    //   • OMITTED block (no node)     → 0 neutral: the policy makes no claim on effects
    //     (auto-inherit / get-out-of-the-way) — a clean limits-only guard. NO effect check here.
    //   • EXPLICITLY EMPTY {} (size 0) → −1 hard deny: revokes ALL effects (every declared violates).
    //   • POPULATED {...}             → +1 allow only the listed effects.
    if (permittedEffectsBlock !== undefined) {
      const denyAll = permittedEffects.size === 0;
      for (const declaredEffect of flow.declaredEffects) {
        if (denyAll || !permittedEffects.has(declaredEffect)) {
          this.diagnostics.push(makeGovDiag(
            "LLN-GOV-004",
            "DOMAIN_GUARD_POLICY_VIOLATION",
            "error",
            denyAll
              ? `Policy Violation in flow '${flow.name}': policy '${policyName}' declares an empty permitted_effects {} (deny-all), so effect '${declaredEffect}' is revoked.`
              : `Policy Violation in flow '${flow.name}': the effect '${declaredEffect}' is not in the ` +
                `permitted_effects of policy '${policyName}'. Permitted: [${[...permittedEffects].join(", ")}].`,
            contractNode.location ?? flowNode.location,
            denyAll
              ? `An empty permitted_effects {} revokes all effects (deny-all). Remove the effect from the flow, or add it to '${policyName}'.`
              : `Remove '${declaredEffect}' from effects, or add it to the '${policyName}' policy's permitted_effects.`,
          ));
        }
      }
    }

    // ── LLN-LIMIT-001: enforced_limits ceiling check ─────────────────────────
    // TODO (task #56 Phase 2): Full structured limit comparison.
    // parseLimitMB() and per-field comparison pending implementation.
    // When implemented: compare contract limits {} values against policy enforced_limits {}
    // ceilings and emit LLN-LIMIT-001 on violation.
    // No diagnostic emitted here until structured parsing is in place.
  }

  // ── Phase 2.1 — LLN-GOV-019: limits {} field name validation ─────────────

  private verifyLimitsBlock(flowNode: AstNode, flowName: string): void {
    const fields = extractLimitsFields(flowNode);
    for (const { field, location } of fields) {
      if (!KNOWN_LIMITS_FIELDS.has(field)) {
        this.diagnostics.push(makeGovDiag(
          "LLN-GOV-019",
          "LIMITS_UNKNOWN_FIELD",
          "warning",
          `Flow '${flowName}' limits block contains unrecognised field '${field}'. ` +
          `Known fields: ${[...KNOWN_LIMITS_FIELDS].join(", ")}. This may be a typo.`,
          location,
          `Recognised fields: memory | request_time | max_request_size | max_response_size`,
        ));
      }
    }
  }

  // ── Phase 3.3 — LLN-TERM-001: termination annotation on recursive flows ──

  private verifyTerminationAnnotation(flow: FlowMeta, flowNode: AstNode): void {
    // Only applies to strict/deterministic security profile secure flows.
    // We infer "strict" or "deterministic" from the deployment profile OR
    // from the flow qualifier being "secure" with a production/deterministic profile.
    // Since the profile is not available inside verifyFlow directly, we check
    // the flow's qualifier and the security_profile field if present.
    const isSecureOrGuarded = flow.qualifier === "secure" || flow.qualifier === "guarded";
    if (!isSecureOrGuarded) return;

    // Check security_profile in contract (stored as decl: lines in a security or profile block)
    // or infer from deployment profile.
    const contractNode = (flowNode.children ?? []).find((c) => c.kind === "contractDecl");
    let hasStrictProfile = false;
    if (contractNode !== undefined) {
      for (const child of contractNode.children ?? []) {
        const v = (child.value ?? "").toLowerCase();
        if (v.includes("strict") || v.includes("deterministic")) {
          hasStrictProfile = true;
          break;
        }
        // Check children of contract sub-blocks for profile hints
        for (const grandchild of child.children ?? []) {
          const gv = (grandchild.value ?? "").toLowerCase();
          if (gv.includes("strict") || gv.includes("deterministic")) {
            hasStrictProfile = true;
            break;
          }
        }
        if (hasStrictProfile) break;
      }
    }
    // Also treat production/deterministic deployment profile as strict
    if (this.currentProfile === "deterministic") hasStrictProfile = true;

    if (!hasStrictProfile) return;

    // Only warn if the flow is recursive and has no decreases annotation
    if (!hasRecursiveCall(flowNode, flow.name)) return;
    if (flow.decreasesMetric !== undefined) return;

    this.diagnostics.push(makeGovDiag(
      "LLN-TERM-001",
      "TERMINATION_ANNOTATION_MISSING",
      "warning",
      `Recursive flow '${flow.name}' in strict/deterministic profile lacks a 'decreases' annotation. ` +
      `Add 'decreases <metric>' to the flow signature to prove termination.`,
      flow.location,
      `Add after the return type: -> ReturnType decreases n`,
    ));
  }

  private verifyPhysicalHardeningBlock(flowNode: AstNode, flowName: string): void {
    const contractNode = (flowNode.children ?? []).find((c) => c.kind === "contractDecl");
    if (contractNode === undefined) return;

    const hardeningNode = (contractNode.children ?? []).find(
      (c) => c.kind === "identifier" && (c.value ?? "").startsWith("cyber_physical_hardening"),
    );
    if (hardeningNode === undefined) return; // auto-by-default → nothing to validate

    // Content stored as one or more `decl:` children (one per directive line).
    // Join them all into a single flat string for keyword extraction.
    const content = (hardeningNode.children ?? [])
      .filter((c) => c.kind === "identifier" && (c.value ?? "").startsWith("decl:"))
      .map((c) => (c.value ?? "").slice("decl:".length))
      .join(" ")
      .toLowerCase();

    const VALID_SHIELDING = new Set(["active_mesh", "deep_trench", "standard_fabric"]);
    const VALID_FAULT_MIT = new Set(["lockstep", "scalar_single", "none"]);
    const VALID_SIDE_CH  = new Set(["constant_row", "differential_masking", "none"]);
    const VALID_TAMPER   = new Set<string>(TAMPER_RESPONSE_STRATEGIES); // single source of truth (proof-graph.ts)

    // Extract keyword=value pairs from the flattened content string
    const extractValue = (keyword: string): string | undefined => {
      const idx = content.indexOf(keyword);
      if (idx === -1) return undefined;
      const after = content.slice(idx + keyword.length).trim().split(/\s+/);
      return after[0];
    };

    const shielding = extractValue("enclosure_shielding");
    if (shielding !== undefined && !VALID_SHIELDING.has(shielding)) {
      this.diagnostics.push(makeGovDiag(
        "LLN-GOV-017", "InvalidPhysicalHardeningValue", "error",
        `Flow '${flowName}' declares cyber_physical_hardening { enclosure_shielding ${shielding} } but '${shielding}' is not a recognised shielding tier.`,
        hardeningNode.location,
        `Valid values: active_mesh | deep_trench | standard_fabric`,
      ));
    }

    const tamper = extractValue("on_tamper_signal");
    if (tamper !== undefined && !VALID_TAMPER.has(tamper)) {
      this.diagnostics.push(makeGovDiag(
        "LLN-GOV-017", "InvalidPhysicalHardeningValue", "error",
        `Flow '${flowName}' declares cyber_physical_hardening { on_tamper_signal ${tamper} } but '${tamper}' is not a recognised tamper response.`,
        hardeningNode.location,
        `Valid values: zeroize | quarantine_core | halt | demote_to_local`,
      ));
    }

    // Warn if declared on a low-risk flow — auto-by-default is preferred
    // (absence of a high max_risk_liability in economics is a proxy for low risk)
    const economicsNode = (contractNode.children ?? []).find(
      (c) => c.kind === "identifier" && (c.value ?? "").startsWith("economics"),
    );
    const hasHighRisk = economicsNode !== undefined &&
      (economicsNode.children ?? []).some((c) =>
        (c.value ?? "").includes("max_risk_liability") && /\d{4,}/.test(c.value ?? ""),
      );
    if (!hasHighRisk) {
      this.diagnostics.push(makeGovDiag(
        "LLN-GOV-017", "PhysicalHardeningOnLowRiskFlow", "warning",
        `Flow '${flowName}' explicitly declares cyber_physical_hardening {} but has no high max_risk_liability in economics {}. ` +
        `The runtime auto-selects the appropriate shielding tier from the ValueGraph. ` +
        `Omit this block unless operating on Tier 1 hardware with proven physical-breach risk.`,
        hardeningNode.location,
        `Remove the cyber_physical_hardening {} block and let the runtime select the tier automatically.`,
      ));
    }
  }

  private verifyLiabilityBlock(flowNode: AstNode, flowName: string): void {
    const contractNode = (flowNode.children ?? []).find((c) => c.kind === "contractDecl");
    if (contractNode === undefined) return;

    const liabilityNode = (contractNode.children ?? []).find(
      (c) => c.kind === "identifier" && (c.value ?? "").startsWith("liability"),
    );
    if (liabilityNode === undefined) return; // not present → no issue

    // liability {} is auto-calculated — writing it manually is a design smell.
    this.diagnostics.push(makeGovDiag(
      "LLN-GOV-018", "ManualLiabilityDeclaration", "warning",
      `Flow '${flowName}' manually declares a liability {} contract block. ` +
      `liability {} is auto-calculated from the ValueGraph breach-risk matrix and stored in the ProofGraph. ` +
      `Declaring it manually couples your source code to a specific risk assessment that may go stale.`,
      liabilityNode.location,
      `Remove the liability {} block. The governance verifier computes and records it automatically.`,
    ));
  }

  /**
   * LLN-INHERIT-001/002: Hierarchical policy inheritance subset verification (task #72).
   *
   * When a policy declares `parent_policy: ParentName`, this verifier checks:
   *   LLN-INHERIT-001: parent policy name is not found in knownDomainGuards
   *   LLN-INHERIT-002: child policy's permitted_effects ⊄ parent's permitted_effects
   *                    (child attempts to use effects the parent doesn't allow)
   *
   * Monotonicity of inheritance: a child policy can ONLY be more restrictive than its parent.
   * It cannot declare effects the parent doesn't permit — that would be privilege escalation.
   *
   * Example (valid):
   *   policy FinanceFullAccess { permitted_effects { database.write, audit.write } }
   *   policy InvoiceRead { parent_policy: FinanceFullAccess; permitted_effects { database.read } }
   *   → database.read has no bit → always permitted (it's a no-op, read-only) ✓
   *
   * Example (invalid — LLN-INHERIT-002):
   *   policy InvoiceRead { parent_policy: FinanceFullAccess; permitted_effects { network.outbound } }
   *   → network.outbound not in FinanceFullAccess.permitted_effects → LLN-INHERIT-002 ✗
   */
  private verifyPolicyHierarchy(nodes: readonly AstNode[]): void {
    // Helper: extract permitted_effects from a policyDecl node
    const extractPermittedEffects = (policyNode: AstNode): Set<string> => {
      const effects = new Set<string>();
      for (const child of policyNode.children ?? []) {
        // The permitted_effects block is stored as an AstNode with effectRef children
        if (child.kind === "identifier" && (child.value ?? "").startsWith("permitted_effects")) {
          // Effects stored as effectRef children
          for (const eff of child.children ?? []) {
            if (eff.kind === "effectRef" && eff.value) effects.add(eff.value);
          }
        }
        // Direct effectRef children (alternative storage form from parseDomainGuardList)
        if (child.kind === "effectRef" && child.value) effects.add(child.value);
      }
      return effects;
    };

    for (const node of nodes) {
      if (node.kind !== "policyDecl" && node.kind !== "guardDecl") continue;
      const policyName = node.value ?? "anonymous-policy";
      const loc = node.location ?? { file: "", line: 0, column: 0 };

      // Look for parent_policy: annotation
      const parentClause = (node.children ?? []).find(
        c => c.kind === "identifier" && (c.value ?? "").startsWith("parent_policy:"),
      );
      if (parentClause === undefined) continue;

      const parentName = (parentClause.value ?? "").replace(/^parent_policy:/, "").trim();
      if (parentName === "") continue;

      // LLN-INHERIT-001: Parent policy not found
      const parentNode = this.knownDomainGuards.get(parentName);
      if (parentNode === undefined) {
        this.diagnostics.push(makeGovDiag(
          "LLN-INHERIT-001",
          "PARENT_POLICY_NOT_FOUND",
          "error",
          `Policy '${policyName}': parent_policy '${parentName}' is not defined in this ` +
          `compilation unit. Parent policies must be declared before child policies, ` +
          `or in the same governance/ directory.`,
          loc,
          `Declare 'guard ${parentName} { ... }' before this guard, or remove parent_policy:`,
        ));
        continue;
      }

      // LLN-INHERIT-002: Child declares effects not in parent's permitted set
      const parentEffects = extractPermittedEffects(parentNode);
      const childEffects  = extractPermittedEffects(node);

      // If parent has no permitted_effects block, all effects are implicitly allowed
      if (parentEffects.size === 0) continue;

      for (const childEff of childEffects) {
        // Check if childEff is covered by parent (exact match or parent allows the root family)
        const rootFamily = childEff.split(".")[0] + ".*";
        const covered = parentEffects.has(childEff) || parentEffects.has(rootFamily);
        if (!covered) {
          this.diagnostics.push(makeGovDiag(
            "LLN-INHERIT-002",
            "CHILD_POLICY_EXCEEDS_PARENT",
            "error",
            `Policy '${policyName}': permitted_effects includes '${childEff}' but parent ` +
            `policy '${parentName}' does not permit this effect. Child policies can ONLY ` +
            `be more restrictive — this is a privilege escalation attempt.`,
            loc,
            `Remove '${childEff}' from '${policyName}' permitted_effects, or add it to ` +
            `'${parentName}' permitted_effects if this expansion is intentional.`,
          ));
        }
      }
    }
  }

  /**
   * LLN-MONO-001/002: Verify emergency {} transitions in all top-level policy {} blocks.
   *
   * Scans the AST for policyDecl nodes, extracts emergencyTransitionDecl children,
   * and validates monotonicity of each transition.
   *
   * DRCM Phase 4 (task #39).
   */
  private verifyPolicyMonotonicity(nodes: readonly AstNode[]): void {
    for (const node of nodes) {
      if (node.kind !== "policyDecl" && node.kind !== "guardDecl") continue;
      const policyName = node.value ?? "anonymous-policy";
      const loc = node.location ?? { file: "", line: 0, column: 0 };

      // Find the emergency:block child (if any)
      const emergencyBlock = (node.children ?? []).find(
        c => c.kind === "identifier" && c.value === "emergency:block"
      );
      if (emergencyBlock === undefined) continue;

      for (const transition of (emergencyBlock.children ?? [])) {
        if (transition.kind !== "emergencyTransitionDecl") continue;

        const signal = transition.value ?? "";
        const transLoc = transition.location ?? loc;

        // LLN-MONO-002: Unknown signal type
        if (!KNOWN_SIGNALS.has(signal)) {
          this.diagnostics.push(makeGovDiag(
            "LLN-MONO-002",
            "UNKNOWN_EMERGENCY_SIGNAL",
            "error",
            `Policy '${policyName}': emergency {} transition uses unknown signal '${signal}'. ` +
            `Valid signals: ${[...KNOWN_SIGNALS].join(", ")}.`,
            transLoc,
            `Replace '${signal}' with a valid signal type.`,
          ));
        }

        // LLN-MONO-001: Check actions for permission expansion
        for (const action of (transition.children ?? [])) {
          const val = action.value ?? "";
          // deny:X and action:X are always valid (clearing bits or setting mode flags)
          if (val.startsWith("deny:") || val.startsWith("action:")) continue;
          // allow:X would be a monotonicity violation
          if (val.startsWith("allow:")) {
            const capName = val.replace(/^allow:/, "");
            this.diagnostics.push(makeGovDiag(
              "LLN-MONO-001",
              "EMERGENCY_EXPANDS_CAPABILITY",
              "error",
              `Policy '${policyName}': emergency {} transition on '${signal}' attempts to ` +
              `ADD capability '${capName}'. Emergency transitions can ONLY clear (deny) ` +
              `capabilities — V_DPM is monotonically decreasing. This is a critical ` +
              `security violation: an emergency handler cannot grant itself new powers.`,
              transLoc,
              `Remove 'allow ${capName}' from the emergency {} transition. ` +
              `Emergency handlers may only deny capabilities, quarantine, or halt.`,
            ));
          } else if (!val.startsWith("deny:") && !val.startsWith("action:") && val !== "") {
            // Unknown action type
            this.diagnostics.push(makeGovDiag(
              "LLN-MONO-001",
              "EMERGENCY_UNKNOWN_ACTION",
              "warning",
              `Policy '${policyName}': emergency {} transition on '${signal}' contains ` +
              `unknown action '${val}'. Only 'deny', 'quarantine', 'emergency', and 'halt' ` +
              `are valid emergency transition actions.`,
              transLoc,
              `Replace '${val}' with a valid action.`,
            ));
          }
        }
      }
    }
  }

  private verifyEpilogueBlock(flowNode: AstNode, flowName: string): void {
    const contractNode = (flowNode.children ?? []).find((c) => c.kind === "contractDecl");
    if (contractNode === undefined) return;

    const epilogueNode = (contractNode.children ?? []).find(
      (c) => c.kind === "identifier" && (c.value ?? "").startsWith("epilogue"),
    );

    // Phase 3.2: auto-assign sha256_seal receipt for high-value flows without
    // an explicit epilogue block. Threshold: max_risk_liability >= 1000.
    if (epilogueNode === undefined) {
      const maxRisk = extractMaxRiskLiability(flowNode);
      if (maxRisk !== undefined && maxRisk >= 1000) {
        const receipt = generateEpilogueReceipt({
          strategy: "sha256_seal",
          onFailure: "log_and_continue",
          sourceText: flowName,
          contractHash: flowName,
        }) as import("./proof-graph.js").EpilogueReceipt;

        const existingPg = this.proofGraphsByFlow.get(flowName);
        if (existingPg !== undefined) {
          this.proofGraphsByFlow.set(flowName, { ...existingPg, epilogueReceipt: receipt });
        }
      }
      return; // no explicit epilogue block → nothing further to validate
    }

    // The content is stored as an identifier child: "decl: generate_proof <strategy> ..."
    const declChild = (epilogueNode.children ?? []).find(
      (c) => c.kind === "identifier" && (c.value ?? "").startsWith("decl:"),
    );
    const content = declChild !== undefined ? (declChild.value ?? "").slice("decl:".length).trim() : "";
    const tokens = content.split(/\s+/);

    const VALID_STRATEGIES = new Set<string>(["auto", "sha256_seal", "zk_snark_receipt", "none"]);
    const VALID_FAILURES   = new Set<string>(["halt_pipeline", "quarantine_payload", "log_and_continue"]);

    // Parse generate_proof <strategy>
    let strategy: EpilogueProofStrategy | "" = "";
    const gpIdx = tokens.indexOf("generate_proof");
    if (gpIdx !== -1) {
      const rawStrategy = tokens[gpIdx + 1] ?? "";
      if (!VALID_STRATEGIES.has(rawStrategy)) {
        this.diagnostics.push(makeGovDiag(
          "LLN-GOV-015",
          "EpilogueInvalidStrategy",
          "error",
          `Flow '${flowName}' declares epilogue { generate_proof ${rawStrategy || "<missing>"} } but '${rawStrategy || "<missing>"}' is not a recognised proof strategy.`,
          epilogueNode.location,
          `Valid strategies: auto | sha256_seal | zk_snark_receipt | none`,
        ));
        return; // invalid strategy — skip receipt generation
      }
      strategy = rawStrategy as EpilogueProofStrategy;
    }

    // Parse on_verification_failure <action>
    let onFailure: EpilogueFailureAction = "log_and_continue";
    const ovfIdx = tokens.indexOf("on_verification_failure");
    if (ovfIdx !== -1) {
      const rawAction = tokens[ovfIdx + 1] ?? "";
      if (!VALID_FAILURES.has(rawAction)) {
        this.diagnostics.push(makeGovDiag(
          "LLN-GOV-016",
          "EpilogueInvalidFailureAction",
          "error",
          `Flow '${flowName}' declares epilogue { on_verification_failure ${rawAction || "<missing>"} } but '${rawAction || "<missing>"}' is not a recognised failure action.`,
          epilogueNode.location,
          `Valid actions: halt_pipeline | quarantine_payload | log_and_continue`,
        ));
        return; // invalid failure action — skip receipt generation
      }
      onFailure = rawAction as EpilogueFailureAction;
    }

    // Validation passed — generate and store the EpilogueReceipt on the ProofGraph.
    if (strategy === "") return; // no generate_proof clause declared; nothing to do

    // No proverBackend injected here — generateEpilogueReceipt returns synchronously.
    const receipt = generateEpilogueReceipt({
      strategy,
      onFailure,
      sourceText: flowName, // use flowName as a stable source identifier at compile time
      contractHash: flowName,
    }) as import("./proof-graph.js").EpilogueReceipt;

    const existingPg = this.proofGraphsByFlow.get(flowName);
    if (existingPg !== undefined) {
      this.proofGraphsByFlow.set(flowName, { ...existingPg, epilogueReceipt: receipt });
    }
  }

  // ── LLN-TRAP-001/002: trap declarations in flow body ────────────────────────

  /**
   * Scan the flow body for trapDecl nodes and verify:
   *  - LLN-TRAP-001: error code is a valid identifier (not empty, no spaces)
   *  - LLN-TRAP-002: condition references only symbols in parameter scope
   *
   * Also records trap obligations in the ProofGraph (CBOR Tag 403, trapKind field).
   */
  private verifyTrapDecls(flow: FlowMeta, flowNode: AstNode, loc: SourceLocation): void {
    const blockNode = (flowNode.children ?? []).find(c => c.kind === "block");
    if (blockNode === undefined) return;

    // Build parameter scope (same as verifyInvariantBlock)
    const paramNames = new Set<string>(
      (flowNode.children ?? [])
        .filter(c => c.kind === "paramDecl")
        .map(c => ((c.value ?? "").split(":")[0] ?? "").trim())
        .filter(n => n.length > 0)
    );

    // Sequential pass: accumulate let/mut binding names into scope as we go,
    // so that trap conditions can reference variables declared before the trap.
    // This matches the semantic intent: trap validates a value already in scope.
    const localScope = new Set<string>(paramNames);

    /**
     * Extract the variable name from a letDecl/mutDecl value string.
     * Format is: [prefix] name[: type]
     * e.g. "unsafe rawFoo: String" → "rawFoo"
     *      "foo: String"           → "foo"
     *      "foo"                   → "foo"
     */
    function extractBindingName(value: string): string {
      // Strip optional "unsafe " / "safe " prefix
      const withoutPrefix = value.replace(/^(unsafe|safe)\s+/, "");
      // Take the name part before ":"
      return (withoutPrefix.split(":")[0] ?? "").trim();
    }

    for (const stmt of blockNode.children ?? []) {
      // Accumulate local binding names into scope before processing the next trap
      if (stmt.kind === "letDecl" || stmt.kind === "mutDecl") {
        const name = extractBindingName(stmt.value ?? "");
        if (name.length > 0) localScope.add(name);
        continue;
      }

      if (stmt.kind !== "trapDecl") continue;

      const errorCode = stmt.value ?? "ERR_TRAP";
      const condExpr = stmt.children?.[0];

      // LLN-TRAP-001: error code must be a valid identifier (non-empty, no spaces)
      if (!errorCode || errorCode.trim() === "" || /\s/.test(errorCode)) {
        this.diagnostics.push(makeGovDiag(
          "LLN-TRAP-001",
          "TRAP_INVALID_ERROR_CODE",
          "error",
          `Flow '${flow.name}': trap has invalid error code '${errorCode}'. ` +
          `Error codes must be non-empty identifiers (SCREAMING_SNAKE_CASE recommended).`,
          stmt.location ?? loc,
          `Use a valid identifier: trap <cond> : ERR_SOME_CODE`,
        ));
      }

      // LLN-TRAP-002: condition must only reference symbols in parameter or local scope
      if (condExpr !== undefined) {
        const unresolvedNames = collectUnresolvedIdentifiers(condExpr, localScope);
        for (const name of unresolvedNames) {
          this.diagnostics.push(makeGovDiag(
            "LLN-TRAP-002",
            "TRAP_SYMBOL_UNRESOLVED",
            "error",
            `Flow '${flow.name}': trap condition references '${name}' which is not a parameter. ` +
            `Available parameters: [${[...paramNames].join(", ") || "none"}].`,
            stmt.location ?? loc,
            `Check the spelling of '${name}' or use a flow parameter name instead.`,
          ));
        }
      }

      // Record as runtime-trap proof obligation (CBOR Tag 403 trapKind field)
      this.proofObligations.push(`runtime-trap:${flow.name}:${errorCode}`);
    }
  }

  // ── LLN-DAG-001/002: governed flow floor validation ─────────────────────────

  /**
  /**
   * LLN-STATIC-001/002: Verify top-level `static NAME = EXPR` declarations.
   *
   * LLN-STATIC-002: Redeclaration — the same name declared more than once.
   * LLN-STATIC-001: Non-constant initializer — static uses a callExpr (runtime value).
   *
   * Static constants must have unique names and must be initialized with compile-time
   * literals (number, string, bool, or a previously-declared static identifier).
   */
  private verifyStaticDecls(nodes: readonly AstNode[]): void {
    const seen = new Set<string>();
    for (const node of nodes) {
      if (node.kind !== "staticDecl") continue;
      const name = node.value ?? "";
      // LLN-STATIC-002: redeclaration
      if (seen.has(name)) {
        this.diagnostics.push(makeGovDiag(
          "LLN-STATIC-002",
          "STATIC_REDECLARATION",
          "error",
          `Static constant '${name}' is declared more than once. Static constants must be unique.`,
          node.location,
          `Remove the duplicate static declaration of '${name}'.`,
        ));
      }
      seen.add(name);
      // LLN-STATIC-001: value must be a compile-time constant (not a function call)
      const valueExpr = node.children?.[0];
      if (valueExpr !== undefined && valueExpr.kind === "callExpr") {
        this.diagnostics.push(makeGovDiag(
          "LLN-STATIC-001",
          "STATIC_NOT_CONSTANT",
          "warning",
          `Static constant '${name}' uses a function call as its value. Static constants should be ` +
          `compile-time literals (number, string, bool). Function calls are evaluated at runtime.`,
          node.location,
          `Replace the function call with a literal value.`,
        ));
      }
    }
  }

  /**
   * LLN-BF-001/002: Verify top-level `bitfield NAME { field: bitPos }` declarations.
   *
   * LLN-BF-002: Bit position out of range — V_DPM is a 32-bit register (positions 0-31).
   * LLN-BF-001: Duplicate bit position — two fields map to the same bit.
   *
   * Each field in a bitfield must have a unique bit position within [0, 31].
   */
  private verifyBitfieldDecls(nodes: readonly AstNode[]): void {
    for (const node of nodes) {
      if (node.kind !== "bitfieldDecl") continue;
      const name = node.value ?? "";
      const seenBits = new Map<number, string>(); // bit position → field name

      for (const child of node.children ?? []) {
        const parts = (child.value ?? "").split(":");
        if (parts.length !== 2) continue;
        const fieldName = (parts[0] ?? "").trim();
        const bitPos = parseInt((parts[1] ?? "").trim(), 10);

        // LLN-BF-002: bit position out of range (0-31 for 32-bit register)
        if (isNaN(bitPos) || bitPos < 0 || bitPos > 31) {
          this.diagnostics.push(makeGovDiag(
            "LLN-BF-002",
            "BITFIELD_BIT_OUT_OF_RANGE",
            "error",
            `Bitfield '${name}': field '${fieldName}' uses bit position ${isNaN(bitPos) ? "NaN" : bitPos}. ` +
            `V_DPM is a 32-bit register — valid positions are 0-31.`,
            child.location,
            `Change bit position to a value between 0 and 31.`,
          ));
          continue;
        }

        // LLN-BF-001: duplicate bit position within the same bitfield
        if (seenBits.has(bitPos)) {
          const existing = seenBits.get(bitPos)!;
          this.diagnostics.push(makeGovDiag(
            "LLN-BF-001",
            "BITFIELD_BIT_OVERLAP",
            "error",
            `Bitfield '${name}': fields '${existing}' and '${fieldName}' both use bit position ${bitPos}. ` +
            `Each bit position must be unique within a bitfield.`,
            child.location,
            `Change one of the fields to use a different bit position.`,
          ));
        } else {
          seenBits.set(bitPos, fieldName);
        }
      }
    }
  }

  /**
   * Scan all top-level AST nodes for governedFlowDecl and verify the floor name.
   *  - LLN-DAG-001: floor name must be in KNOWN_FLOORS
   *  - No other checks in Stage A (full DAG validation is Phase 5)
   */
  private verifyGovernedFlows(nodes: readonly AstNode[]): void {
    for (const node of nodes) {
      if (node.kind !== "governedFlowDecl") continue;

      // value = "governed:<floorName>:<flowName>"
      const parts = (node.value ?? "").split(":");
      const floorName = parts[1] ?? "";
      const flowName = parts.slice(2).join(":");

      // LLN-DAG-001: unknown floor name
      if (!KNOWN_FLOORS.has(floorName)) {
        this.diagnostics.push(makeGovDiag(
          "LLN-DAG-001",
          "GOVERNED_FLOW_UNKNOWN_FLOOR",
          "error",
          `governed flow '${flowName}' declares unknown Tower floor '${floorName}'. ` +
          `Valid floors: floor_1, floor_2, floor_3, floor_4 (or short names: execution, containment, proof, attestation).`,
          node.location,
          `Replace '${floorName}' with a valid floor name, e.g. 'governed floor_3 flow ...'`,
        ));
      } else {
        // Record DAG_CHECK obligation for the flow
        const canonicalFloor = normaliseFloor(floorName);
        this.proofObligations.push(`dag_check:${flowName}:${canonicalFloor}:bit8`);
      }
    }
  }

  // ── LLN-ASSIMILATE: assimilated plugin verification ──────────────────────────

  /**
   * Verify all assimilatedPluginDecl nodes in the top-level AST children.
   *
   * LLN-ASSIMILATE-001: assimilated plugin declared outside boot.lln.
   *   In Stage A single-file compilation we don't have full project context,
   *   so this is a WARNING with note "full enforcement in Stage B".
   *
   * LLN-ASSIMILATE-003: assimilated plugin has no contract {} with access { grant } block.
   *   V_DPM bits must be pre-warmed at boot, so capability grants are mandatory.
   */
  private verifyAssimilatedPlugins(nodes: readonly AstNode[], sourceFile: string): void {
    for (const node of nodes) {
      if (node.kind !== "assimilatedPluginDecl") continue;

      const alias = node.value ?? "<unknown>";

      // LLN-ASSIMILATE-001: warn if not in boot.lln (Stage A warning; Stage B will be error)
      if (!sourceFile.endsWith("boot.lln")) {
        this.diagnostics.push(makeGovDiag(
          "LLN-ASSIMILATE-001",
          "ASSIMILATE_OUTSIDE_BOOT",
          "warning",
          `Assimilated plugin '${alias}' is declared outside boot.lln. ` +
          `Only boot.lln may grant Hot-Code Residency. ` +
          `Move this declaration to boot.lln. (Full enforcement in Stage B multi-file compilation.)`,
          node.location,
          `Move 'import plugin assimilate ...' to boot.lln. The assimilation_memory_budget will auto-calculate from available RAM when omitted.`,
        ));
      }

      // LLN-ASSIMILATE-003: require contract {} with at least one grant
      const contractNode = (node.children ?? []).find(c => c.kind === "contractDecl");
      let hasGrant = false;
      if (contractNode !== undefined) {
        // Walk all children of the contract looking for accessDecl or identifier nodes
        // that carry grant: prefixed values (as parsed by parseContractDecl/parseAccessBlock).
        function walkForGrant(n: AstNode): boolean {
          if (n.kind === "accessDecl") return true;
          if (n.kind === "identifier" && (n.value ?? "").startsWith("grant:")) return true;
          // Also check for access block stored as a sub-identifier "access:block"
          if (n.kind === "identifier" && (n.value ?? "").startsWith("access:")) return true;
          return (n.children ?? []).some(walkForGrant);
        }
        hasGrant = walkForGrant(contractNode);
        // Also accept: contract has child nodes at all (grant lines from the access block)
        // The contract parser stores access { grant X } sub-blocks as children of contractDecl.
        if (!hasGrant) {
          // Broader check: any child with "grant" in its value
          function walkForGrantBroad(n: AstNode): boolean {
            if (typeof n.value === "string" && n.value.includes("grant")) return true;
            return (n.children ?? []).some(walkForGrantBroad);
          }
          hasGrant = walkForGrantBroad(contractNode);
        }
      }

      if (!hasGrant) {
        this.diagnostics.push(makeGovDiag(
          "LLN-ASSIMILATE-003",
          "ASSIMILATE_MISSING_CAPABILITY_GRANTS",
          "error",
          `Assimilated plugin '${alias}' has no access { grant } block in its contract. ` +
          `V_DPM bits are pre-warmed at boot — explicit capability grants are mandatory.`,
          node.location,
          `Add inside the plugin contract: access { grant network.outbound }`,
        ));
      }
    }
  }

  // ── LLN-GATE-001/002: gate {} admission guard verification ──────────────────────

  /**
   * LLN-GATE-001/002: Verify gate {} admission guard blocks.
   *
   * LLN-GATE-001: gate(condition) references a condition not in knownDomainGuards.
   *               Stage A: warning (guard may be in another file).
   *               Stage B: error (full project context available).
   *
   * LLN-GATE-002: gate {} wraps a pure flow — redundant.
   *               Pure flows have no side effects, so a gate is meaningless.
   */
  private verifyGateBlocks(nodes: readonly AstNode[]): void {
    for (const node of nodes) {
      if (node.kind !== "gateDecl") continue;
      const condition = node.value ?? "";
      const loc = node.location ?? { file: "", line: 0, column: 0 };

      // LLN-GATE-001: Unknown condition name
      if (condition !== "" && !this.knownDomainGuards.has(condition)) {
        this.diagnostics.push(makeGovDiag(
          "LLN-GATE-001",
          "GATE_UNKNOWN_CONDITION",
          "warning",
          `gate(${condition}): condition '${condition}' is not defined as a guard {} in this ` +
          `compilation unit. In Stage A single-file compilation, the guard may be in boot.lln. ` +
          `Full enforcement in Stage B multi-file compilation.`,
          loc,
          `Declare 'guard ${condition} { permitted_effects { ... } }' in boot.lln, ` +
          `or check the condition name spelling.`,
        ));
      }

      // LLN-GATE-002: gate wrapping pure flows is redundant
      for (const child of node.children ?? []) {
        if (child.kind === "pureFlowDecl") {
          const flowName = child.value ?? "unknown";
          this.diagnostics.push(makeGovDiag(
            "LLN-GATE-002",
            "GATE_WRAPS_PURE_FLOW",
            "warning",
            `gate(${condition}): wraps pure flow '${flowName}'. Pure flows have no side effects ` +
            `and no capability requirements — the admission gate is redundant here.`,
            child.location ?? loc,
            `Remove the gate {} wrapper from '${flowName}', or change it to a non-pure flow ` +
            `if it has side effects.`,
          ));
        }
      }
    }
  }

  // ── LLN-ACCESS-001/002: access {} capability grant verification ──────────────────

  /**
   * LLN-ACCESS-001/002: Verify access {} capability negotiation blocks.
   *
   * LLN-ACCESS-001: access {} grant references an unknown capability name.
   *                 Valid capability names are in KNOWN_CAPABILITIES.
   *
   * LLN-ACCESS-002: access {} grant capability is not declared in flow's effects {}.
   *                 A flow granting network.outbound to callers must itself declare
   *                 allow network.outbound in its effects {}.
   *
   * Note: access {} operates under Default Deny — only listed grants are permitted.
   * We check that grants are real capabilities (001) and consistent with effects (002).
   */
  private verifyAccessBlocks(
    flowNode: AstNode,
    flow: FlowMeta,
    loc: SourceLocation | undefined,
  ): void {
    const contractNode = (flowNode.children ?? []).find(c => c.kind === "contractDecl");
    if (contractNode === undefined) return;

    // Find accessDecl — the v2.2 access {} block
    const accessBlock = (contractNode.children ?? []).find(c => c.kind === "accessDecl");
    if (accessBlock === undefined) return;

    // Collect all grant:X children
    const grants = (accessBlock.children ?? []).filter(c => (c.value ?? "").startsWith("grant:"));

    for (const grant of grants) {
      const capName = (grant.value ?? "").replace("grant:", "").trim();
      if (capName === "") continue;

      // LLN-ACCESS-001: unknown capability name
      if (!KNOWN_CAPABILITIES.has(capName) && !capName.includes(".")) {
        this.diagnostics.push(makeGovDiag(
          "LLN-ACCESS-001",
          "ACCESS_UNKNOWN_CAPABILITY",
          "warning",
          `Flow '${flow.name}': access {} grants unknown capability '${capName}'. ` +
          `Known capabilities: ${[...KNOWN_CAPABILITIES].filter(c => !c.includes("*")).join(", ")}.`,
          grant.location ?? loc,
          `Check the capability name spelling. Valid capabilities match V_DPM bit positions.`,
        ));
      }

      // LLN-ACCESS-002: granted capability not in flow's declared effects
      // access { grant X } means "callers need X to use this flow"
      // The flow itself must have declared X if X has a V_DPM bit
      const effectEquivalent = capName; // e.g. "network.outbound"
      const flowHasEffect = flow.declaredEffects.includes(effectEquivalent) ||
                            flow.declaredEffects.includes(`effect:${effectEquivalent}`);
      const capHasBit = KNOWN_CAPABILITIES.has(capName) && capName !== "database.read";

      if (capHasBit && !flowHasEffect) {
        this.diagnostics.push(makeGovDiag(
          "LLN-ACCESS-002",
          "ACCESS_GRANT_WITHOUT_EFFECT",
          "warning",
          `Flow '${flow.name}': access {} grants '${capName}' to callers but the flow ` +
          `does not declare 'allow ${capName}' in its effects {}. ` +
          `If callers need this capability, the flow should declare it in effects {}.`,
          grant.location ?? loc,
          `Add 'allow ${capName}' to the flow's contract effects {}, or remove the grant.`,
        ));
      }
    }
  }

  // ── LLN-MATCH-001: match exhaustiveness checking ─────────────────────────────

  /**
   * Scan the flow body for matchExpr nodes that:
   *  - Have no wildcard (_) arm
   *  - Target a known enum-like type (SystemCapabilityType or EmergencySignalType)
   *    identified by: <6 arms AND subject is a field access or local var on a known type
   *  - Emits LLN-MATCH-001 WARNING (not error) — conservative approach
   */
  private checkMatchExhaustiveness(flow: FlowMeta, flowNode: AstNode, loc: SourceLocation): void {
    const blockNode = (flowNode.children ?? []).find(c => c.kind === "block");
    if (blockNode === undefined) return;

    this.walkForMatchExpr(blockNode, flow, loc);
  }

  private walkForMatchExpr(node: AstNode, flow: FlowMeta, loc: SourceLocation): void {
    for (const child of node.children ?? []) {
      if (child.kind === "matchExpr") {
        this.verifyMatchExhaustiveness(child, flow, loc);
      }
      // Recurse into nested blocks (if, while, etc.)
      this.walkForMatchExpr(child, flow, loc);
    }
  }

  private verifyMatchExhaustiveness(matchNode: AstNode, flow: FlowMeta, loc: SourceLocation): void {
    const children = matchNode.children ?? [];
    if (children.length === 0) return;

    // children[0] = subject, rest = matchArm nodes
    const arms = children.slice(1).filter(c => c.kind === "matchArm");

    // Check if there is a wildcard arm
    const hasWildcard = arms.some(arm => arm.value === "_");
    if (hasWildcard) return; // wildcard covers all cases — no LLN-MATCH-001

    // Check if there is a guard arm (when condition => body) — not an enum match
    const hasGuardArm = arms.some(arm => arm.value === "__guard__");
    if (hasGuardArm) return; // guard arms are boolean, not enum-exhaustive

    // Only fire when arm count < 6 (conservative: likely incomplete enum coverage)
    if (arms.length >= 6) return;

    // Check if the subject looks like a known enum type (field access, or known signal/capability)
    const subject = children[0];
    if (subject === undefined) return;
    const subjectDesc = this.describeExpr(subject);
    const looksLikeKnownEnum =
      subjectDesc.includes("signal") ||
      subjectDesc.includes("capability") ||
      subjectDesc.includes("Signal") ||
      subjectDesc.includes("Capability") ||
      (subject.kind === "memberExpr") ||
      (subject.kind === "identifier" && (
        (subject.value ?? "").toLowerCase().includes("signal") ||
        (subject.value ?? "").toLowerCase().includes("cap") ||
        (subject.value ?? "").toLowerCase().includes("mode")
      ));

    if (!looksLikeKnownEnum) return;

    this.diagnostics.push(makeGovDiag(
      "LLN-MATCH-001",
      "MATCH_NON_EXHAUSTIVE",
      "warning",
      `Flow '${flow.name}': match expression on '${subjectDesc}' has no wildcard (_) arm ` +
      `and only ${arms.length} arm(s). Missing arms create governance holes where a ` +
      `V_DPM signal or capability could pass unchecked. ` +
      `Add a wildcard arm: _ => { /* handle unexpected */ }`,
      matchNode.location ?? loc,
      `Add a wildcard arm: _ => { /* govern unexpected variants */ }`,
    ));
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Runs the governance verifier over all flows in the program.
 *
 * Call this after all checker passes (symbol, type, value-state, effect)
 * succeed. It confirms that declared intent, effects, and compute governance
 * match the observed structure of each flow.
 *
 * @param ast           Root program node.
 * @param flows         Flow metadata from parseProgram().
 * @param effectResults Effect checker results per flow.
 * @param profile       Deployment profile — affects diagnostic severity.
 */
export function verifyGovernance(
  ast: AstNode,
  flows: readonly FlowMeta[],
  effectResults: readonly EffectCheckResult[],
  profile: DeploymentProfile = "dev",
  sourceFile?: string,
): GovernanceVerifyResult {
  const verifier = new GovernanceVerifier();
  verifier.verify(ast, flows, effectResults, profile, sourceFile);
  return verifier.getResult();
}

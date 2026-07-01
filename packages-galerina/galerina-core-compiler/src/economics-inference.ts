// =============================================================================
// Galerina Phase 29 / 33 — Economics Inference (Convention over Configuration)
//
// `contract { economics {} }` should be OPTIONAL, not required.
// Most developers shouldn't need to write economics blocks — the compiler
// should infer sensible defaults from the flow's other declarations.
//
// Inferred from:
//   - effect declarations → compute cost tier
//   - contract.value.classification → risk cost tier
//   - contract.hardware.target → preferred execution target
//   - contract.ai → AI cost ceiling
//   - contract.limits → budget constraint
//
// Developers can always OVERRIDE by declaring explicit economics blocks.
// This is "convention over configuration" — Galerina works correctly out-of-box.
//
// AI generators: you do NOT need to generate economics blocks. The compiler
// fills them in. Only write economics when you have specific cost requirements.
// =============================================================================

import { type AstNode, type FlowMeta } from "./parser.js";

// ---------------------------------------------------------------------------
// Inferred economics shape
// ---------------------------------------------------------------------------

export type InferredTarget =
  | "wasm"       // default: portable, governed, safe
  | "cpu"        // local CPU when WASM overhead is unacceptable
  | "gpu"        // bulk compute or AI inference
  | "npu"        // low-power inference
  | "enclave";   // high-risk/high-classification data

export interface InferredEconomics {
  /** Preferred execution target, inferred from hardware hints + effect mix */
  readonly preferredTarget: InferredTarget;
  /** Whether the flow should use a compute budget (auto-set from contract.limits) */
  readonly hasBudget: boolean;
  /** Risk tier: drives ProofLevel escalation */
  readonly riskTier: "standard" | "elevated" | "high" | "critical";
  /** Whether AI cost tracking is auto-enabled */
  readonly trackAiCost: boolean;
  /** True if this was explicitly declared in contract.economics */
  readonly explicit: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// 2026-07-01: dropped dead "ai.infer" (non-canonical, matched nothing; ai.inference is the
// canonical name and is already present; ai.remoteInference is its alias).
const AI_EFFECTS = new Set(["ai.inference", "ai.train", "ai.remoteInference"]);
const HEAVY_EFFECTS = new Set(["database.write", "network.outbound", "storage.write"]);

/** High-risk classifications that auto-escalate economics */
const HIGH_RISK_CLASSIFICATIONS = new Set([
  "safety_critical", "mission_critical", "medical", "financial",
  "government", "national_security",
]);

function extractFromContract(flowNode: AstNode, section: string): string | null {
  const contractNode = (flowNode.children ?? []).find(c => c.kind === "contractDecl");
  if (contractNode === undefined) return null;
  for (const child of contractNode.children ?? []) {
    if (child.kind === "identifier" && child.value === `${section}:block`) {
      return child.children?.[0]?.value ?? null;
    }
  }
  return null;
}

function hasExplicitEconomics(flowNode: AstNode): boolean {
  const contractNode = (flowNode.children ?? []).find(c => c.kind === "contractDecl");
  return (contractNode?.children ?? []).some(
    c => c.kind === "identifier" && c.value === "economics:block",
  );
}

function getValueClassification(flowNode: AstNode): string | null {
  const raw = extractFromContract(flowNode, "value");
  if (raw === null) return null;
  const tokens = raw.replace("decl:", "").split(/\s+/);
  const classIdx = tokens.indexOf("classification");
  return classIdx !== -1 ? (tokens[classIdx + 1] ?? null) : null;
}

function getHardwareTarget(flowNode: AstNode): string | null {
  const raw = extractFromContract(flowNode, "hardware");
  if (raw === null) return null;
  const tokens = raw.replace("decl:", "").split(/\s+/);
  const targetIdx = tokens.indexOf("target");
  return targetIdx !== -1 ? (tokens[targetIdx + 1] ?? null) : null;
}

function hasLimits(flowNode: AstNode): boolean {
  return extractFromContract(flowNode, "limits") !== null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Infer economics for a flow from its other contract declarations.
 *
 * Called by the governance verifier and CostGraph for every flow,
 * regardless of whether `contract { economics {} }` was declared.
 *
 * This is the "hidden contract" — the compiler fills it in so developers
 * don't have to think about it unless they need to override.
 */
export function inferFlowEconomics(
  flowNode: AstNode,
  flow: FlowMeta,
): InferredEconomics {
  if (hasExplicitEconomics(flowNode)) {
    // Developer declared explicit economics — respect it, still infer missing parts
    return {
      preferredTarget: "wasm",
      hasBudget: hasLimits(flowNode),
      riskTier: "standard",
      trackAiCost: flow.declaredEffects.some(e => AI_EFFECTS.has(e)),
      explicit: true,
    };
  }

  // --- Infer preferred execution target ---
  let preferredTarget: InferredTarget = "wasm"; // always start at WASM
  const hwTarget = getHardwareTarget(flowNode);
  if (hwTarget !== null) {
    if (hwTarget.startsWith("npu")) preferredTarget = "npu";
    else if (hwTarget.startsWith("gpu") || hwTarget.startsWith("amd.cdna") || hwTarget.startsWith("nvidia")) preferredTarget = "gpu";
    else if (hwTarget === "enclave") preferredTarget = "enclave";
    else if (hwTarget.startsWith("cpu") || hwTarget.startsWith("intel") || hwTarget.startsWith("amd.zen") || hwTarget.startsWith("arm")) preferredTarget = "cpu";
  } else if (flow.qualifier === "pure" && flow.declaredEffects.length === 0) {
    // Pure EffectFree: WASM is perfect (deterministic, sandboxed, fast)
    preferredTarget = "wasm";
  } else if (flow.declaredEffects.some(e => AI_EFFECTS.has(e))) {
    // AI inference → GPU/NPU preferred
    preferredTarget = "gpu";
  } else if (flow.declaredEffects.some(e => HEAVY_EFFECTS.has(e))) {
    // DB write / network / filesystem → stay on CPU (governance side-effects)
    preferredTarget = "cpu";
  }

  // --- Infer risk tier from value classification ---
  const classification = getValueClassification(flowNode);
  let riskTier: InferredEconomics["riskTier"] = "standard";
  if (classification !== null) {
    if (classification === "safety_critical" || classification === "national_security") {
      riskTier = "critical";
      // Safety-critical and national-security always run in enclave when available
      if (preferredTarget === "wasm" || preferredTarget === "cpu") {
        preferredTarget = "enclave";
      }
    } else if (HIGH_RISK_CLASSIFICATIONS.has(classification)) {
      riskTier = "high";
    } else if (classification === "financial" || classification === "regulated") {
      riskTier = "elevated";
    }
  }

  // PII in declared effects also escalates
  if (flow.declaredEffects.some(e => e.startsWith("pii.") || e.startsWith("phi."))) {
    if (riskTier === "standard") riskTier = "elevated";
  }

  return {
    preferredTarget,
    hasBudget: hasLimits(flowNode),
    riskTier,
    trackAiCost: flow.declaredEffects.some(e => AI_EFFECTS.has(e)),
    explicit: false,
  };
}

/**
 * Describe the inferred economics in human-readable form.
 * Used by `galerina cost --analysis` and AI metadata output.
 */
export function describeEconomics(econ: InferredEconomics): string {
  const parts: string[] = [];
  parts.push(`target: ${econ.preferredTarget}`);
  parts.push(`risk: ${econ.riskTier}`);
  if (econ.trackAiCost) parts.push("AI cost tracked");
  if (econ.hasBudget) parts.push("budget declared");
  if (!econ.explicit) parts.push("(inferred — no explicit economics block needed)");
  return parts.join(" | ");
}

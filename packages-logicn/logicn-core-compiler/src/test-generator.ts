// =============================================================================
// LogicN — Contract-Driven Test Generation (R&D 0016)
//
// Turns a flow's governance contract (its GIR) into executable, fail-closed TEST
// OBLIGATIONS. Five vector dimensions are implemented, each derived deterministically
// from the GIR:
//   1. fault-injection   — one obligation per GIRFlow.faultHandlers entry (0017): inject the
//                          fault, assert the declared/secure-default action, never fail open.
//   2. effect-egress     — one "no unsafe egress" obligation per governed sink (SINK_REQUIREMENTS).
//   3. capability-denial — withhold a required capability → the V_DPM gate denies (fail-closed).
//   4. boundary/fuzz     — per typed parameter: edge values (i32 min/max → trap; empty/NaN/Inf/NUL).
//   5. substrate-violation — a crypto effect on a noisy/photonic lane → LLN-SUBSTRATE-001.
//
// Output is an IR (one *TestCase[] per dimension) renderable to any concrete format; a minimal
// TAP renderer is included. Design: docs/Knowledge-Bases/logicn-contract-driven-generation.md.
//
// Tracked follow-ons (NOT yet built): the full K3 capability MATRIX (+1 allow / 0 indeterminate→deny
// / −1 deny — this module covers only the −1 deny path); structural fuzz for record/enum/Option params;
// and the senior-dev infra — Contract-Coverage metric, deterministic seed, escape-hatch
// (LLN-GEN-TEST-005), JUnit output, mock infra, and a property/shrinker engine.
// =============================================================================

import { type GIRFlow } from "./gir-emitter.js";
import { type FaultHandler, type FaultSignal } from "./resilience-inference.js";
import { getSinkRequirement, type SinkRequirement } from "./value-state-checker.js";

/** A single generated fault-injection test obligation. Deterministic given the GIR. */
export interface FaultInjectionTestCase {
  /** Stable id — `<flow>::<signal>`, usable as a TAP/JUnit test name and a regeneration key. */
  readonly id: string;
  readonly flow: string;
  readonly signal: FaultSignal;
  /** What the test harness must simulate to trigger this fault. */
  readonly injectedFault: string;
  /** The action the flow is contracted to take — `halt` is the fail-closed default. */
  readonly expectedAction: FaultHandler["action"];
  /** Present iff expectedAction === "fallback". */
  readonly fallbackTarget?: string;
  /** The fail-closed property the test asserts after injecting the fault. */
  readonly assertion: string;
  /** Whether the handler was authored or is the inferred secure default. */
  readonly source: FaultHandler["source"];
  /** True when the handler is the one fail-OPEN exception (`log` on on_rotation_fault). */
  readonly failOpen: boolean;
}

/** Human description of the stimulus each fault class injects. */
const INJECTION: Readonly<Record<FaultSignal, string>> = {
  on_timeout_fault: "drive the operation past its time budget (simulate a hang)",
  on_rotation_fault: "fail the key/credential rotation (simulate a KMS/vault outage)",
  on_denial_fault: "deny a required capability mid-flow (capability_denied)",
  on_substrate_fault: "fail a substrate lane (simulate a degraded/unavailable lane)",
};

/** The fail-closed property a test must assert for a given resolved handler. */
function assertionFor(h: FaultHandler): string {
  switch (h.action) {
    case "halt":
      return "the flow result is 'error' (halted) and NO downstream effect is dispatched after the fault — fail-closed";
    case "quarantine":
      return "the flow is quarantined: the active handle is faulted and every subsequent read denies (fail-closed)";
    case "retry":
      return "the flow retries up to the bounded retry count, then halts fail-closed (never an unbounded retry storm)";
    case "fallback":
      return `control transfers to fallback flow '${h.target ?? "<unresolved>"}', which is itself governed by its own fault matrix (depth-1, no re-expansion of capabilities)`;
    case "log":
      // The single fail-OPEN exception — only reachable on on_rotation_fault (back-compat opt-in).
      return "the prior value continues to be served and the fault is logged — FAIL-OPEN (permitted only on on_rotation_fault, and only as an explicit opt-in)";
  }
}

/**
 * Generate one fault-injection test obligation per fault handler on a flow's GIR.
 * Returns [] for a flow that declares no handlers (GIRFlow.faultHandlers is omitted for
 * purely-default flows to keep the canonical GIR/hash stable — see gir-emitter 0017).
 */
export function generateFaultInjectionTests(flow: GIRFlow): FaultInjectionTestCase[] {
  const handlers = flow.faultHandlers ?? [];
  return handlers.map((h): FaultInjectionTestCase => ({
    id: `${flow.name}::${h.signal}`,
    flow: flow.name,
    signal: h.signal,
    injectedFault: INJECTION[h.signal],
    expectedAction: h.action,
    ...(h.target !== undefined ? { fallbackTarget: h.target } : {}),
    assertion: assertionFor(h),
    source: h.source,
    failOpen: h.action === "log",
  }));
}

/** Generate fault-injection obligations across every flow in a GIR program. */
export function generateFaultInjectionSuite(
  flows: readonly GIRFlow[],
): readonly FaultInjectionTestCase[] {
  return flows.flatMap((f) => generateFaultInjectionTests(f));
}

// =============================================================================
// Effect-egress dimension — every governed sink a flow declares becomes a "no unsafe
// egress" obligation: a value that does not meet the sink's required state must be
// REJECTED before it leaves through that sink (the LLN-SECRET / LLN-PRIVACY / LLN-TYPE-015
// governance, exercised at runtime). Reuses the shipped SINK_REQUIREMENTS registry.
// =============================================================================

/** A generated effect-egress test obligation for one governed sink. */
export interface EffectEgressTestCase {
  readonly id: string;                                  // `<flow>::egress::<sink>`
  readonly flow: string;
  readonly sink: string;                                // the governed-sink effect (e.g. network.outbound)
  readonly requiredState: SinkRequirement["requiredState"];
  /** The non-conforming input the test injects to prove the sink rejects it. */
  readonly violatingInput: string;
  readonly assertion: string;
  readonly policyNote: string;
}

/** The non-conforming value to inject for each required sink state. */
const VIOLATING_INPUT: Readonly<Record<SinkRequirement["requiredState"], string>> = {
  safe: "an unsafe (untrusted / unsanitised) value",
  validated: "an unvalidated value",
  redacted: "a raw, un-redacted PII value",
  nonPII: "a PII-bearing value",
};

/**
 * Generate one egress obligation per governed sink among a flow's declared effects. Returns [] for a
 * flow whose declared effects include no governed sink. Deterministic given the GIR + the shipped
 * SINK_REQUIREMENTS registry (exact + pattern sinks via getSinkRequirement).
 */
export function generateEffectEgressTests(flow: GIRFlow): EffectEgressTestCase[] {
  const out: EffectEgressTestCase[] = [];
  for (const effect of flow.effects.declared) {
    const req = getSinkRequirement(effect);
    if (req === undefined) continue; // not a governed sink → no egress obligation
    out.push({
      id: `${flow.name}::egress::${effect}`,
      flow: flow.name,
      sink: effect,
      requiredState: req.requiredState,
      violatingInput: VIOLATING_INPUT[req.requiredState],
      assertion:
        `a value reaching '${effect}' must be ${req.requiredState}; injecting ${VIOLATING_INPUT[req.requiredState]} ` +
        `must be REJECTED (no unsafe egress) — fail-closed`,
      policyNote: req.policyNote,
    });
  }
  return out;
}

// =============================================================================
// Capability-denial dimension — every capability a flow requires becomes a fail-closed
// obligation: withhold that capability and the flow must be DENIED before any effect runs
// ((required & granted) !== required → deny). Exercises the V_DPM capability gate.
// =============================================================================

/** A generated capability-denial test obligation for one required capability. */
export interface CapabilityDenialTestCase {
  readonly id: string;          // `<flow>::cap-deny::<capability>`
  readonly flow: string;
  readonly effect: string;      // the effect that requires the capability
  readonly capability: string;  // the capability name (e.g. host.network.outbound)
  readonly assertion: string;
}

/**
 * Generate one capability-denial obligation per capability a flow requires (from GIRFlow.capabilities,
 * the effect→capability map). Returns [] for a flow that requires no capability (e.g. a pure flow).
 */
export function generateCapabilityDenialTests(flow: GIRFlow): CapabilityDenialTestCase[] {
  const out: CapabilityDenialTestCase[] = [];
  for (const [effect, capability] of flow.capabilities) {
    out.push({
      id: `${flow.name}::cap-deny::${capability}`,
      flow: flow.name,
      effect,
      capability,
      assertion:
        `withhold capability '${capability}' (required for effect '${effect}'): the flow must be DENIED ` +
        `before any effect runs — the V_DPM gate ((required & granted) !== required) denies — fail-closed`,
    });
  }
  return out;
}

// =============================================================================
// Boundary / fuzz dimension — every typed parameter becomes a set of boundary-value
// obligations. For Int this asserts the i32 trap fails closed on overflow (never UB/wrap);
// for other types it asserts deterministic handling of the edges (empty, NaN/Inf, NUL).
// =============================================================================

/** A generated boundary/fuzz test obligation for one parameter at one edge value. */
export interface BoundaryTestCase {
  readonly id: string;          // `<flow>::boundary::p<idx>::<label>`
  readonly flow: string;
  readonly paramIndex: number;
  readonly paramType: string;   // base type (generics/qualifiers stripped)
  readonly value: string;       // the boundary value literal
  readonly assertion: string;
}

const BOUNDARY_VALUES: Readonly<Record<string, readonly { label: string; value: string }[]>> = {
  Int: [
    { label: "zero", value: "0" },
    { label: "neg-one", value: "-1" },
    { label: "max-i32", value: "2147483647" },
    { label: "min-i32", value: "-2147483648" },
  ],
  String: [
    { label: "empty", value: '""' },
    { label: "nul", value: '"\\u0000"' },
    { label: "long", value: '"<oversized string>"' },
  ],
  Bool: [
    { label: "true", value: "true" },
    { label: "false", value: "false" },
  ],
  Float: [
    { label: "zero", value: "0.0" },
    { label: "nan", value: "NaN" },
    { label: "pos-inf", value: "Infinity" },
    { label: "neg-inf", value: "-Infinity" },
  ],
};

/** Strip qualifiers/generics: "protected Money<GBP>" → "Money"; "Result<Int,String>" → "Result". */
function baseType(t: string): string {
  const noQual = t.replace(/^(protected|redacted)\s+/, "");
  return (noQual.split(/[<\s]/)[0] ?? noQual).trim();
}

/**
 * Generate boundary/fuzz obligations per typed parameter (from GIRFlow.paramTypes). Types with no known
 * boundary set (records, enums, Option/Result wrappers) yield none here — they are covered by other
 * dimensions / are tracked for a structural-fuzz follow-on.
 */
export function generateBoundaryTests(flow: GIRFlow): BoundaryTestCase[] {
  const out: BoundaryTestCase[] = [];
  (flow.paramTypes ?? []).forEach((t, idx) => {
    const base = baseType(t);
    const edges = BOUNDARY_VALUES[base];
    if (edges === undefined) return;
    for (const e of edges) {
      out.push({
        id: `${flow.name}::boundary::p${idx}::${e.label}`,
        flow: flow.name,
        paramIndex: idx,
        paramType: base,
        value: e.value,
        assertion: base === "Int"
          ? `feed parameter ${idx} (Int) = ${e.value}: the flow handles the boundary with no UB — any i32 overflow it triggers TRAPS fail-closed (never wraps), byte-identical across tiers`
          : `feed parameter ${idx} (${base}) = ${e.value}: the flow handles the boundary deterministically (no crash, no silent truncation)`,
      });
    }
  });
  return out;
}

// =============================================================================
// Substrate-violation dimension — every crypto effect a flow declares becomes an obligation
// that the op CANNOT run on a noisy/photonic lane (crypto-on-core, LLN-SUBSTRATE-001).
// =============================================================================

const CRYPTO_EFFECT = /^crypto\.(hash|sign|verify|encrypt|decrypt|seal)$/;

/** A generated substrate-violation obligation for one crypto effect. */
export interface SubstrateViolationTestCase {
  readonly id: string;          // `<flow>::substrate::<cryptoEffect>`
  readonly flow: string;
  readonly cryptoEffect: string;
  readonly assertion: string;
}

/**
 * Generate one substrate-violation obligation per crypto effect (crypto.{hash,sign,verify,encrypt,
 * decrypt,seal}) a flow declares. Returns [] for a flow with no crypto effect.
 */
export function generateSubstrateViolationTests(flow: GIRFlow): SubstrateViolationTestCase[] {
  const out: SubstrateViolationTestCase[] = [];
  for (const effect of flow.effects.declared) {
    if (!CRYPTO_EFFECT.test(effect)) continue;
    out.push({
      id: `${flow.name}::substrate::${effect}`,
      flow: flow.name,
      cryptoEffect: effect,
      assertion:
        `route '${effect}' onto a noisy/photonic substrate lane: it must be REJECTED with LLN-SUBSTRATE-001 ` +
        `(crypto-on-core — bit-exact crypto stays on the deterministic digital lane) — fail-closed`,
    });
  }
  return out;
}

/** All generated contract test obligations for a flow, by dimension. */
export interface ContractTestSuite {
  readonly faultInjection: readonly FaultInjectionTestCase[];
  readonly effectEgress: readonly EffectEgressTestCase[];
  readonly capabilityDenial: readonly CapabilityDenialTestCase[];
  readonly boundary: readonly BoundaryTestCase[];
  readonly substrateViolation: readonly SubstrateViolationTestCase[];
}

/** Run every implemented generator dimension over a program's flows. */
export function generateContractTestSuite(flows: readonly GIRFlow[]): ContractTestSuite {
  return {
    faultInjection: flows.flatMap((f) => generateFaultInjectionTests(f)),
    effectEgress: flows.flatMap((f) => generateEffectEgressTests(f)),
    capabilityDenial: flows.flatMap((f) => generateCapabilityDenialTests(f)),
    boundary: flows.flatMap((f) => generateBoundaryTests(f)),
    substrateViolation: flows.flatMap((f) => generateSubstrateViolationTests(f)),
  };
}

/** Render a TAP (Test Anything Protocol) plan from generated cases — a concrete, runnable-shaped output. */
export function renderFaultInjectionTAP(cases: readonly FaultInjectionTestCase[]): string {
  const lines: string[] = ["TAP version 13", `1..${cases.length}`];
  cases.forEach((c, i) => {
    lines.push(`# ${c.id} [${c.source}]${c.failOpen ? " (FAIL-OPEN — review)" : ""}`);
    lines.push(`#   inject: ${c.injectedFault}`);
    lines.push(`#   expect action: ${c.expectedAction}${c.fallbackTarget ? ` → ${c.fallbackTarget}` : ""}`);
    lines.push(`#   assert: ${c.assertion}`);
    // Emitted as a not-yet-implemented obligation (TODO directive) — the harness fills the body.
    lines.push(`not ok ${i + 1} - ${c.id} # TODO inject fault and assert fail-closed`);
  });
  return lines.join("\n") + "\n";
}

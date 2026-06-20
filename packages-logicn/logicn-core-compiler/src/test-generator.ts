// =============================================================================
// LogicN — Contract-Driven Test Generation (R&D 0016) — fault-injection dimension
//
// Turns a flow's governance contract into executable TEST OBLIGATIONS. This first
// slice covers the FAULT-INJECTION dimension, which is unblocked by 0017: the
// `GIRFlow.faultHandlers` matrix (one handler per fault class, declared or the
// fail-closed `halt` default) maps one-to-one onto fault-injection test cases —
// "inject fault X, assert the flow takes its declared action and never fails open."
//
// The output is an intermediate representation (FaultInjectionTestCase[]) from which
// any concrete format (TAP / JUnit / a .lln harness) can be rendered. A minimal TAP
// renderer is included so the generation is end-to-end demonstrable.
//
// Design: docs/Knowledge-Bases/logicn-contract-driven-generation.md (job 0016);
// consumes resilience-inference.ts FaultHandler (0017). The richer dimensions
// (K3 capability matrix, boundary/fuzz, effect-egress, substrate-violation) and the
// Contract-Coverage metric / escape-hatch (LLN-GEN-TEST-005) are tracked follow-ons.
// =============================================================================

import { type GIRFlow } from "./gir-emitter.js";
import { type FaultHandler, type FaultSignal } from "./resilience-inference.js";

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

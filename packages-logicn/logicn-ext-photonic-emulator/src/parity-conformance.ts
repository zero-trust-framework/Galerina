// parity-conformance.ts — the Bifurcated Execution Invariant, made checkable.
//
// A bifurcated component is built twice (a `-binary` impl and a `-photonic` impl) under one
// interface. "Semantic parity" between them is NOT bit-equality — the photonic lane is analog. It is
// TWO relations:
//
//   1. DECISION parity (DISCRETE, must be IDENTICAL): both tiers must make the same admit/reject
//      decision. A corrupt / inadmissible op must fail-closed on BOTH — no tier may admit what the
//      other rejects. (Governance decisions never diverge across hardware — crypto-on-core, K3.)
//   2. NUMERIC parity (CONTINUOUS, within budget): the photonic result must agree with the exact
//      binary result to within the declared `substrate { tolerance }`. Out-of-tolerance ⇒ NOT
//      conformant ⇒ the runtime falls back to binary (fail-closed).
//
// This is the CONFORMANCE GATE: a `-photonic` package is admissible only when it is conformant against
// its `-binary` reference across the corpus. The measured residual feeds the manifest `ToleranceWitness`
// (calibration-as-attestation), and the per-call Freivalds/tolerance re-verify enforces it live.

import type { BridgeOp } from "../../logicn-inference-bridge-contract/dist/index.js";
import { tmacExact, adcRange, PHOTONIC, type PhysParams } from "./emulator.js";
import { PhotonicEmulatorBridge } from "./photonic-bridge.js";
import { toleranceCheck } from "./freivalds.js";

export interface ParityOptions {
  readonly phys?: PhysParams;
  readonly redundancyN?: number;
  /** Declared substrate tolerance (relative). Default 0.05. */
  readonly tolerance?: number;
}

export interface ParityResult {
  /** The exact ternary T-MAC — the `-binary` tier's bit-precise value. NaN if the op was rejected. */
  readonly binaryValue: number;
  /** The emulated + N-voted result — the `-photonic` tier's value. NaN if the op was rejected. */
  readonly photonicValue: number;
  /** Both tiers made the SAME admit/reject decision (the discrete relation). */
  readonly decisionParity: boolean;
  /** |photonic − binary| ≤ tolerance·span (the continuous relation). Only meaningful when admitted. */
  readonly numericWithinTolerance: boolean;
  /** The Bifurcated Execution Invariant holds for this op: decisionParity ∧ (rejected ∨ withinTolerance). */
  readonly conformant: boolean;
  readonly reason: string;
}

/**
 * Check the Bifurcated Execution Invariant for one op: the `-binary` (exact) and `-photonic` (emulated)
 * tiers must make the SAME admit/reject decision, and — when admitted — agree numerically within tolerance.
 * Never throws; a rejection on either tier is captured (not propagated) so divergence is observable.
 */
export function checkParity(op: BridgeOp, opts: ParityOptions = {}): ParityResult {
  const tol = opts.tolerance ?? 0.05;
  const bridge = new PhotonicEmulatorBridge({
    phys: opts.phys ?? PHOTONIC,
    ...(opts.redundancyN !== undefined ? { redundancyN: opts.redundancyN } : {}),
    tolerance: tol,
  });

  let binaryValue = NaN, photonicValue = NaN, binaryRejected = false, photonicRejected = false;
  try { binaryValue = bridge.executeExact(op); } catch { binaryRejected = true; }
  try { photonicValue = bridge.execute(op).value; } catch { photonicRejected = true; }

  // (1) DECISION parity — both admit, or both reject. A divergence here is a hard conformance failure
  // (one tier would accept an op the other rejects — exactly what the invariant forbids).
  const decisionParity = binaryRejected === photonicRejected;
  if (binaryRejected || photonicRejected) {
    return {
      binaryValue, photonicValue, decisionParity,
      numericWithinTolerance: false,
      conformant: decisionParity, // both-reject is conformant (identical fail-closed); split-decision is NOT
      reason: decisionParity
        ? "both tiers fail-closed identically (inadmissible op rejected on binary AND photonic)"
        : `DIVERGENCE: one tier admitted what the other rejected (binaryRejected=${binaryRejected}, photonicRejected=${photonicRejected})`,
    };
  }

  // (2) NUMERIC parity — the photonic value within the declared tolerance of the exact binary value.
  const numericWithinTolerance = toleranceCheck(photonicValue, binaryValue, tol, adcRange(op.count));
  return {
    binaryValue, photonicValue, decisionParity, numericWithinTolerance,
    conformant: decisionParity && numericWithinTolerance,
    reason: numericWithinTolerance
      ? `conformant: |Δ| ${Math.abs(photonicValue - binaryValue).toFixed(3)} ≤ tol·span ${(tol * adcRange(op.count)).toFixed(3)}`
      : `out-of-tolerance: |Δ| ${Math.abs(photonicValue - binaryValue).toFixed(3)} > tol·span ${(tol * adcRange(op.count)).toFixed(3)} (runtime falls back to binary)`,
  };
}

export interface ParityReport {
  readonly total: number;
  readonly conformant: number;
  readonly decisionDivergences: number;
  readonly outOfTolerance: number;
  /** Max measured |photonic − binary| / span across the corpus (feeds the ToleranceWitness). */
  readonly maxRelativeResidual: number;
  /** The invariant holds for EVERY op in the corpus. */
  readonly allConformant: boolean;
}

/**
 * Run the conformance gate over a corpus: the `-photonic` package is admissible iff `allConformant`.
 * Also returns the max residual (the empirical band to record in the manifest's ToleranceWitness).
 */
export function proveBifurcatedParity(ops: readonly BridgeOp[], opts: ParityOptions = {}): ParityReport {
  let conformant = 0, decisionDivergences = 0, outOfTolerance = 0, maxRelativeResidual = 0;
  for (const op of ops) {
    const r = checkParity(op, opts);
    if (r.conformant) conformant++;
    if (!r.decisionParity) decisionDivergences++;
    if (r.decisionParity && !Number.isNaN(r.binaryValue) && !r.numericWithinTolerance) outOfTolerance++;
    if (!Number.isNaN(r.binaryValue) && !Number.isNaN(r.photonicValue)) {
      const span = Math.max(1, adcRange(op.count));
      maxRelativeResidual = Math.max(maxRelativeResidual, Math.abs(r.photonicValue - r.binaryValue) / span);
    }
  }
  return {
    total: ops.length, conformant, decisionDivergences, outOfTolerance,
    maxRelativeResidual, allConformant: conformant === ops.length,
  };
}

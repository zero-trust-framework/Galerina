/**
 * admission-feedback.ts — the telemetry → K3 admission feedback loop (the closed
 * runtime self-throttle). TritMesh R&D 2026-06-23 net-new mechanic #1.
 *
 * Both halves of this loop already shipped independently: blind observability
 * (logicn-observability — health/readiness + error-rate metrics) and the
 * degrade-only side-signal operand (cert-gate.ts `withSideSignal`). What was
 * missing is the wire BETWEEN them: mapping a LIVE telemetry/health reading into a
 * degrade-only `Verdict` and folding it into the admission/cert verdict, so a node
 * under attack auto-throttles ALLOW → INDETERMINATE without a human in the loop.
 *
 * The single safety property, inherited verbatim from the K3 algebra (NOT re-proved
 * here): the telemetry operand is **degrade-only**. It is at most `+1` (ALLOW = the
 * conjunctive identity, "contribute nothing"), so folding it via `vAnd` (= numeric
 * `min`, No-Coercion `min(t*, r) ≤ t*`) can only LOWER an admission verdict, never
 * lift it. A noisy, spoofed, or adversary-influenced telemetry signal can throttle a
 * channel toward DENY but can NEVER manufacture an ALLOW. It is never a key/KDF/
 * cipher byte — crypto stays Binary; this is a governance side-signal only.
 *
 * Two fail-closed seams, deliberately distinct:
 *  1. An EMPTY reading (`{}` — no telemetry to report) yields `+1` (a no-op). Adding
 *     this operand to a gate that has no telemetry wired must NOT brick every
 *     channel; the loop only degrades on POSITIVE evidence of anomaly.
 *  2. A SUPPLIED-but-unreadable reading (health = an unknown string; an anomaly
 *     score that is NaN / out of [0,1]) degrades to `0` — telemetry that is present
 *     but garbage is treated as anomalous, never as healthy.
 */

import {
  Verdict,
  vAnd,
  type BoundaryDecision,
  type GovernanceDiagnostic,
} from "../../logicn-tower-citizen/dist/index.js";
import { withSideSignal, certGate, type CertGateInput } from "./cert-gate.js";

/** Aggregate health, as produced by an observability readiness/liveness probe. */
export type AdmissionHealth = "UP" | "DOWN";

/**
 * A live telemetry reading the admission loop folds into the channel verdict. Every
 * field is optional; an empty object is a no-op (`+1`). Supply the fields you have
 * wired — typically `health` from `HealthRegistry.readiness()` and/or `anomalyScore`
 * derived from `MetricsSnapshot.errorRate` (or a custom attack indicator).
 */
export interface AdmissionTelemetry {
  /**
   * Aggregate health. `"DOWN"` degrades (→ throttle). `"UP"` (or absent) does not.
   * Any other (unknown) string is a malformed reading and degrades, fail-closed.
   */
  readonly health?: AdmissionHealth;
  /**
   * A normalized anomaly indicator in `[0, 1]` (e.g. `MetricsSnapshot.errorRate`, or
   * a bespoke 0..1 attack score). NaN / <0 / >1 is a malformed reading ⇒ degrade.
   */
  readonly anomalyScore?: number;
  /**
   * Score at/above which the node THROTTLES (ALLOW → INDETERMINATE). Default `0.5`.
   * A non-finite / out-of-range override falls back to the default.
   */
  readonly throttleThreshold?: number;
  /**
   * OPT-IN score at/above which the node HARD-DENIES (→ DENY) rather than merely
   * throttling. Must be ≥ the throttle threshold to take effect. Absent ⇒ the loop
   * is throttle-only (the mechanic's default: degrade ALLOW → INDETERMINATE, never
   * synthesize a hard deny from telemetry alone).
   */
  readonly denyThreshold?: number;
}

const DEFAULT_THROTTLE_THRESHOLD = 0.5;

function resolveThrottleThreshold(t: number | undefined): number {
  return typeof t === "number" && Number.isFinite(t) && t >= 0 && t <= 1
    ? t
    : DEFAULT_THROTTLE_THRESHOLD;
}

/**
 * Map a live telemetry reading to a DEGRADE-ONLY side-signal `Verdict`.
 *
 * Result is always `≤ +1`:
 *  - healthy + low-anomaly (or empty) ⇒ `+1` (ALLOW — folds as a no-op);
 *  - `health === "DOWN"`, an unknown health string, a malformed score, or a score in
 *    `[throttleThreshold, denyThreshold)` ⇒ `0` (INDETERMINATE — throttle);
 *  - a score `≥ denyThreshold` (only when `denyThreshold` is supplied) ⇒ `−1` (DENY).
 *
 * The factors fold with `vAnd`, so the WORST of health and anomaly wins — exactly the
 * conjunctive, fail-closed composition the rest of the gate uses.
 */
export function telemetryToSideSignal(input: AdmissionTelemetry): Verdict {
  let v: Verdict = Verdict.ALLOW; // start at the conjunctive identity

  // ── health factor ──────────────────────────────────────────────────────────
  if (input.health !== undefined && input.health !== "UP") {
    // "DOWN" or any unknown string ⇒ degrade (fail-closed on a malformed reading).
    v = vAnd(v, Verdict.INDETERMINATE);
  }

  // ── anomaly-score factor ─────────────────────────────────────────────────────
  if (input.anomalyScore !== undefined) {
    const s = input.anomalyScore;
    const throttle = resolveThrottleThreshold(input.throttleThreshold);
    const deny =
      typeof input.denyThreshold === "number" &&
      Number.isFinite(input.denyThreshold) &&
      input.denyThreshold >= throttle &&
      input.denyThreshold <= 1
        ? input.denyThreshold
        : undefined;

    if (!Number.isFinite(s) || s < 0 || s > 1) {
      v = vAnd(v, Verdict.INDETERMINATE); // garbage reading ⇒ degrade
    } else if (deny !== undefined && s >= deny) {
      v = vAnd(v, Verdict.DENY); // severe anomaly ⇒ hard deny (opt-in)
    } else if (s >= throttle) {
      v = vAnd(v, Verdict.INDETERMINATE); // throttle
    }
    // s < throttle ⇒ no degrade from this factor.
  }

  return v;
}

/**
 * Fold a live telemetry reading into an existing admission verdict — the closed
 * loop in one call. When healthy this returns `base` unchanged (`+1` is the `vAnd`
 * identity); under anomaly it returns `≤ base`. It can never return `> base`.
 *
 * Use this to feed any K3 admission/cert verdict its own runtime telemetry, e.g.
 * `withTelemetryFeedback(certVerdict(subs), { health: report.status, anomalyScore: snapshot.errorRate })`.
 */
export function withTelemetryFeedback(base: Verdict, input: AdmissionTelemetry): Verdict {
  return withSideSignal(base, telemetryToSideSignal(input));
}

/**
 * The closed loop at the cert/channel gate: run the shipped `certGate`, but append
 * the live telemetry reading as one more degrade-only side-signal. The channel opens
 * IFF the cert verdict is `+1` AND every existing side-signal is `+1` AND the
 * telemetry signal is `+1` (healthy + low-anomaly). Under anomaly the telemetry
 * operand throttles the channel toward DENY — but, being `≤ +1`, it can never open a
 * channel the cert factors had already denied.
 *
 * `onDiagnostic` still receives LLN-GOV-3VL-001 whenever an INDETERMINATE verdict is
 * collapsed to deny — including a deny caused by the telemetry throttle.
 */
export function certGateWithTelemetry(
  input: CertGateInput,
  telemetry: AdmissionTelemetry,
  onDiagnostic?: (d: GovernanceDiagnostic) => void,
): BoundaryDecision {
  const signal = telemetryToSideSignal(telemetry);
  return certGate(
    { ...input, sideSignals: [...(input.sideSignals ?? []), signal] },
    onDiagnostic,
  );
}

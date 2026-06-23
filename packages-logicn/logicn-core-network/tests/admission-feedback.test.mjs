// Telemetry → K3 admission feedback loop (net-new mechanic #1, 2026-06-23).
// The single property under test is DEGRADE-ONLY (No-Coercion): a live telemetry
// reading can only LOWER an admission verdict, never lift it — so a noisy/spoofed
// signal can throttle a channel toward DENY but can never manufacture an ALLOW.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Verdict,
  telemetryToSideSignal,
  withTelemetryFeedback,
  certGateWithTelemetry,
} from "../dist/index.js";

const { DENY, INDETERMINATE, ALLOW } = Verdict;
const TRITS = [DENY, INDETERMINATE, ALLOW]; // -1, 0, +1

// A healthy, pinned, in-window cert: cert verdict = +1 with no telemetry.
const NOW = Date.parse("2026-06-22T12:00:00Z");
const PIN = "ab".repeat(32);
const HEALTHY_CERT = {
  pinnedDigests: [PIN],
  presentedDigest: PIN,
  chainOutcome: "valid",
  notBefore: Date.parse("2026-01-01T00:00:00Z"),
  notAfter: Date.parse("2026-12-31T23:59:59Z"),
  now: NOW,
  revocation: "good",
  revocationProducedAt: NOW - 1000,
  revocationFreshnessMs: 60_000,
};

// ── The headline invariant: degrade-only (No-Coercion) ────────────────────────

test("the telemetry side-signal is always ≤ +1 (degrade-only)", () => {
  // A wide sweep of readings — none may ever yield a signal above ALLOW.
  for (const health of [undefined, "UP", "DOWN", "WAT"]) {
    for (const anomalyScore of [undefined, -1, 0, 0.49, 0.5, 0.9, 1, 2, NaN, Infinity]) {
      for (const denyThreshold of [undefined, 0.9]) {
        const sig = telemetryToSideSignal({ health, anomalyScore, denyThreshold });
        assert.ok(sig <= ALLOW, `signal ${sig} exceeded ALLOW for ${JSON.stringify({ health, anomalyScore, denyThreshold })}`);
        assert.ok(TRITS.includes(sig), `signal ${sig} is not a trit`);
      }
    }
  }
});

test("withTelemetryFeedback can never lift a base verdict (min over the lattice)", () => {
  for (const base of TRITS) {
    for (const health of [undefined, "UP", "DOWN", "WAT"]) {
      for (const anomalyScore of [undefined, 0, 0.5, 1, NaN]) {
        const out = withTelemetryFeedback(base, { health, anomalyScore });
        assert.ok(out <= base, `feedback lifted ${base} → ${out}`);
      }
    }
  }
});

// ── No-op seam: an empty / healthy reading must not throttle ───────────────────

test("an empty reading is a no-op (+1) — adding the loop never bricks an un-wired gate", () => {
  assert.equal(telemetryToSideSignal({}), ALLOW);
  assert.equal(withTelemetryFeedback(ALLOW, {}), ALLOW);
  // The closed loop at the cert gate: healthy cert + empty telemetry still opens.
  assert.equal(certGateWithTelemetry(HEALTHY_CERT, {}).authorized, true);
});

test("a healthy, low-anomaly reading does not throttle", () => {
  assert.equal(telemetryToSideSignal({ health: "UP", anomalyScore: 0.1 }), ALLOW);
  assert.equal(certGateWithTelemetry(HEALTHY_CERT, { health: "UP", anomalyScore: 0.1 }).authorized, true);
});

// ── Throttle seam: positive anomaly degrades ALLOW → INDETERMINATE → deny ──────

test("health DOWN throttles a healthy channel (ALLOW → INDETERMINATE → deny)", () => {
  assert.equal(telemetryToSideSignal({ health: "DOWN" }), INDETERMINATE);
  const d = certGateWithTelemetry(HEALTHY_CERT, { health: "DOWN" });
  assert.equal(d.authorized, false);
  assert.ok(d.diagnostic, "an INDETERMINATE collapse must surface LLN-GOV-3VL-001");
});

test("an anomaly score at/above the throttle threshold degrades to INDETERMINATE", () => {
  assert.equal(telemetryToSideSignal({ anomalyScore: 0.49 }), ALLOW); // below default 0.5
  assert.equal(telemetryToSideSignal({ anomalyScore: 0.5 }), INDETERMINATE); // at threshold
  assert.equal(telemetryToSideSignal({ anomalyScore: 0.8, throttleThreshold: 0.9 }), ALLOW); // custom threshold
  assert.equal(certGateWithTelemetry(HEALTHY_CERT, { anomalyScore: 0.7 }).authorized, false);
});

// ── Fail-closed-on-garbage seam (distinct from the empty no-op) ────────────────

test("a SUPPLIED-but-unreadable reading fails closed to INDETERMINATE", () => {
  assert.equal(telemetryToSideSignal({ health: "WAT" }), INDETERMINATE); // unknown health string
  assert.equal(telemetryToSideSignal({ anomalyScore: NaN }), INDETERMINATE);
  assert.equal(telemetryToSideSignal({ anomalyScore: 2 }), INDETERMINATE); // out of [0,1]
  assert.equal(telemetryToSideSignal({ anomalyScore: -0.5 }), INDETERMINATE);
});

// ── Opt-in hard-deny tier ─────────────────────────────────────────────────────

test("denyThreshold (opt-in) escalates a severe anomaly to a hard DENY", () => {
  assert.equal(telemetryToSideSignal({ anomalyScore: 0.95, denyThreshold: 0.9 }), DENY);
  assert.equal(telemetryToSideSignal({ anomalyScore: 0.7, denyThreshold: 0.9 }), INDETERMINATE); // throttle band
  // Without denyThreshold, even a max score only throttles (the mechanic's default).
  assert.equal(telemetryToSideSignal({ anomalyScore: 1 }), INDETERMINATE);
  // A denyThreshold below the throttle threshold is ignored (must be ≥ it).
  assert.equal(telemetryToSideSignal({ anomalyScore: 0.6, throttleThreshold: 0.5, denyThreshold: 0.3 }), INDETERMINATE);
});

// ── The worst factor wins (conjunctive composition) ───────────────────────────

test("health and anomaly fold conjunctively — the worse factor wins", () => {
  // healthy health (+1) AND severe anomaly (−1, opt-in) ⇒ −1
  assert.equal(telemetryToSideSignal({ health: "UP", anomalyScore: 0.95, denyThreshold: 0.9 }), DENY);
  // DOWN health (0) AND low anomaly (+1) ⇒ 0
  assert.equal(telemetryToSideSignal({ health: "DOWN", anomalyScore: 0.1 }), INDETERMINATE);
});

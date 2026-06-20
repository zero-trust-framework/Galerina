// Blind-observability exposition + the structure-not-data egress fence (R&D 0050).
import assert from "node:assert/strict";
import { test } from "node:test";

import { renderPrometheus, effectFamily, isSafeLabel } from "../dist/index.js";

test("renders the governance-native metrics with HELP/TYPE and the dropped-series counter", () => {
  const out = renderPrometheus({
    governanceFlags: { RequiresAudit: true, DenyRemote: false },
    allowedEffectsCount: 3,
    governanceIndeterminateTotal: 2,
    auditEvents: { Success: 10, Denied: 1 },
    executionTiers: { cache: 5, tree: 2 },
    declared: { memoryLimitBytes: 33554432, maxConcurrent: 10 },
  });
  assert.match(out, /# TYPE logicn_governance_flag gauge/);
  assert.match(out, /logicn_governance_flag\{flag="RequiresAudit"\} 1/);
  assert.match(out, /logicn_governance_flag\{flag="DenyRemote"\} 0/);
  assert.match(out, /logicn_audit_events_total\{status="Denied"\} 1/);
  assert.match(out, /logicn_flow_execution_tier_total\{tier="cache"\} 5/);
  assert.match(out, /logicn_governance_indeterminate_total 2/);
  assert.match(out, /logicn_declared_memory_limit_bytes 33554432/);
  // The fence's own counter is ALWAYS present (proves the fence ran).
  assert.match(out, /logicn_telemetry_dropped_series_total 0/);
});

test("effect labels are reduced to their FAMILY — never the arguments", () => {
  const out = renderPrometheus({
    effectsObserved: { "network.outbound('https://customer-x/secret?token=abc')": 4, "network.inbound": 2, "database.query": 1 },
  });
  // network.* collapses to one family series with the summed count; the URL never appears.
  assert.match(out, /logicn_effects_observed_total\{effect_family="network"\} 6/);
  assert.match(out, /logicn_effects_observed_total\{effect_family="database"\} 1/);
  assert.ok(!out.includes("customer-x"), "the effect ARGUMENT must never egress");
  assert.ok(!out.includes("token"), "no query string leaks");
});

test("EGRESS FENCE: a payload-shaped label value is DROPPED and counted, not emitted", () => {
  // An effect with no family separator that looks like a path → unsafe label → dropped.
  const out = renderPrometheus({ effectsObserved: { "/var/secrets/key.pem": 1, "clock": 3 } });
  assert.ok(!out.includes("/var/secrets"), "a path-shaped label must not egress");
  assert.match(out, /logicn_effects_observed_total\{effect_family="clock"\} 3/, "the safe family still emits");
  assert.match(out, /logicn_telemetry_dropped_series_total 1/, "the dropped series is counted");
});

test("EGRESS FENCE: an unsafe behavioral fingerprint is dropped; a clean hash is emitted", () => {
  const dirty = renderPrometheus({ behavioralFingerprint: "user=alice@example.com /admin" });
  assert.ok(!dirty.includes("alice@example.com"), "PII-shaped fingerprint must not egress");
  assert.match(dirty, /logicn_telemetry_dropped_series_total 1/);

  const clean = renderPrometheus({ behavioralFingerprint: "sha256:abc123def456", build: "1.2.3" });
  assert.match(clean, /logicn_behavioral_fingerprint_info\{fingerprint="sha256:abc123def456",build="1.2.3"\} 1/);
  assert.match(clean, /logicn_telemetry_dropped_series_total 0/);
});

test("unknown governance flags / statuses / tiers (outside the closed vocab) are not emitted", () => {
  const out = renderPrometheus({
    governanceFlags: { NotARealFlag: true, RequiresAudit: true },
    auditEvents: { Bogus: 9, Success: 1 },
    executionTiers: { quantum: 7, sync: 2 },
  });
  assert.ok(!out.includes("NotARealFlag"), "unknown flag dropped");
  assert.ok(!out.includes("Bogus"), "unknown status dropped");
  assert.ok(!out.includes("quantum"), "unknown tier dropped");
  assert.match(out, /logicn_governance_flag\{flag="RequiresAudit"\} 1/);
  assert.match(out, /logicn_audit_events_total\{status="Success"\} 1/);
  assert.match(out, /logicn_flow_execution_tier_total\{tier="sync"\} 2/);
});

test("non-finite numbers are dropped (NaN / Infinity never egress)", () => {
  const out = renderPrometheus({ allowedEffectsCount: NaN, proofObligationsCount: Infinity, queueDepth: 4 });
  assert.ok(!out.includes("logicn_allowed_effects"), "NaN gauge omitted");
  assert.ok(!out.includes("logicn_proof_obligations"), "Infinity gauge omitted");
  assert.match(out, /logicn_queue_depth 4/);
});

test("an empty snapshot still emits the fence counter (always-on)", () => {
  const out = renderPrometheus({});
  assert.match(out, /logicn_telemetry_dropped_series_total 0/);
});

test("helper: effectFamily reduces to the namespace before '.' or '('", () => {
  assert.equal(effectFamily("network.outbound('x')"), "network");
  assert.equal(effectFamily("database.query"), "database");
  assert.equal(effectFamily("clock"), "clock");
});

test("helper: isSafeLabel rejects data-shaped values", () => {
  assert.equal(isSafeLabel("network"), true);
  assert.equal(isSafeLabel("sha256:abcd"), true);
  assert.equal(isSafeLabel("/users/x"), false);
  assert.equal(isSafeLabel("a@b.com"), false);
  assert.equal(isSafeLabel("has space"), false);
  assert.equal(isSafeLabel("x".repeat(81)), false, "over-long values are rejected");
});

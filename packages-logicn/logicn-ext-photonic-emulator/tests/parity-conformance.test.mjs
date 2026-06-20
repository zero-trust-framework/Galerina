// parity-conformance.test.mjs — the Bifurcated Execution Invariant conformance gate.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkParity, proveBifurcatedParity, NOISY } from "../dist/index.js";

function packTrits(trits) {
  const out = new Int32Array(Math.max(1, Math.ceil(trits.length / 16)));
  for (let i = 0; i < trits.length; i++) {
    const v = trits[i] ?? 0;
    const enc = v === -1 ? 0 : v === 0 ? 1 : 2;
    const l = i % 16, b = (l / 4) | 0, p = l % 4, s = b * 8 + (3 - p) * 2;
    out[(i / 16) | 0] = (out[(i / 16) | 0] | (enc << s)) | 0;
  }
  return out;
}
function op(n, seed = 0x77) {
  let r = seed >>> 0; const t = [], a = [];
  for (let i = 0; i < n; i++) { r ^= r << 13; r >>>= 0; r ^= r >>> 17; r ^= r << 5; r >>>= 0; t.push((r % 3) - 1); a.push(((r >>> 3) % 7) - 3); }
  return { opClass: "feedforward", precision: "ternary", correlationId: "p", weights: packTrits(t), activations: Int32Array.from(a), count: n, scale: 1 };
}

test("DECISION parity: an admissible op is admitted on BOTH tiers; numerics agree within tolerance", () => {
  const r = checkParity(op(64), { redundancyN: 8 });
  assert.equal(r.decisionParity, true);
  assert.equal(r.numericWithinTolerance, true);
  assert.equal(r.conformant, true);
});

test("DECISION parity: a corrupt op (0b11 sentinel) is rejected on BOTH tiers (no split decision)", () => {
  const bad = { opClass: "feedforward", precision: "ternary", correlationId: "x", weights: Int32Array.from([0b11 << 6]), activations: Int32Array.from([1]), count: 1, scale: 1 };
  const r = checkParity(bad);
  assert.equal(r.decisionParity, true, "both tiers must reject — never admit what the other rejects");
  assert.equal(r.conformant, true, "identical fail-closed IS conformant");
  assert.match(r.reason, /fail-closed identically/);
});

test("a native-handle op (number weights) is rejected on both tiers (decision parity holds)", () => {
  const handle = { opClass: "feedforward", precision: "ternary", correlationId: "h", weights: 42, activations: Int32Array.from([1]), count: 1, scale: 1 };
  const r = checkParity(handle);
  assert.equal(r.decisionParity, true);
  assert.equal(r.conformant, true);
});

test("NUMERIC parity catches a non-conformant photonic impl: a NOISY lane at tight tolerance is NOT conformant", () => {
  const r = checkParity(op(128), { phys: NOISY, redundancyN: 4, tolerance: 0.001 });
  assert.equal(r.decisionParity, true);          // same decision (both admit)
  assert.equal(r.numericWithinTolerance, false); // …but the analog value misses the tight band
  assert.equal(r.conformant, false, "the gate REJECTS a photonic impl that can't hold the declared tolerance");
});

test("the corpus conformance gate passes for a clean photonic lane and reports the residual band", () => {
  const corpus = [16, 32, 64, 128, 256, 512].map((n, i) => op(n, 0x11 + i));
  const rep = proveBifurcatedParity(corpus, { redundancyN: 8 });
  assert.equal(rep.total, corpus.length);
  assert.equal(rep.allConformant, true);
  assert.equal(rep.decisionDivergences, 0);
  assert.equal(rep.outOfTolerance, 0);
  // the max measured residual is the empirical band to record in the manifest ToleranceWitness
  assert.ok(rep.maxRelativeResidual > 0 && rep.maxRelativeResidual < 0.05, `residual ${rep.maxRelativeResidual} within the 0.05 budget`);
});

test("the corpus gate FAILS (not all conformant) when the lane cannot hold the tolerance", () => {
  const corpus = [128, 256, 512].map((n, i) => op(n, 0x33 + i));
  const rep = proveBifurcatedParity(corpus, { phys: NOISY, redundancyN: 4, tolerance: 0.001 });
  assert.equal(rep.allConformant, false);
  assert.ok(rep.outOfTolerance > 0, "the gate flags the out-of-tolerance ops — a NOISY -photonic package is inadmissible");
});

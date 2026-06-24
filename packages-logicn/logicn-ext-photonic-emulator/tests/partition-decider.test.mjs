// partition-decider.test.mjs — the D2 partition cost-model / router properties.
// Mirrors LogicN-R-AND-D/scripts/rd-photonic-ppu-cost-model-proof.mjs (25/25): an
// absolute-ns crossover, the "never a slowdown" exhaustive sweep, eligibility gating,
// and fail-closed defaults — all asserted against this package's compiled router.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PartitionDecider, meechRealizedRatio, requiredRedundancy, crossover, Tdigital, Tphotonic,
  PHOTONIC, NOISY,
} from "../dist/index.js";

const decider = new PartitionDecider();

// M1 — Meech tax reproduces ~9.4× ideal / ~1.9× realized; absolute crossover exists.
test("M1: Meech per-MAC advantage ~9.4× ideal / ~1.9× realized; crossover n* finite", () => {
  const { idealRatio, realizedRatio, retention } = meechRealizedRatio();
  assert.ok(Math.abs(idealRatio - 9.4) < 0.2, `ideal ${idealRatio.toFixed(2)}×`);
  assert.ok(realizedRatio > 1.6 && realizedRatio < 2.3, `realized ${realizedRatio.toFixed(2)}× (retention ${(100 * retention).toFixed(0)}%)`);
  const nStar = crossover(1);
  assert.ok(nStar > 0 && Number.isFinite(nStar), `n* = ${nStar.toFixed(1)}`);
  const below = Math.max(2, Math.floor(nStar * 0.5)), above = Math.ceil(nStar * 4);
  assert.ok(Tphotonic(below, 1) >= Tdigital(below), "below n*: digital cheaper");
  assert.ok(Tphotonic(above, 1) < Tdigital(above), "above n*: photonic cheaper");
});

// M2 — the router enforces "never a slowdown" over an exhaustive sweep.
test("M2: router refuses below n*, offloads above, 0 mis-routes / 0 slowdowns over the full sweep", () => {
  const nStar = crossover(1);
  assert.equal(decider.decide({ n: Math.max(2, Math.floor(nStar * 0.4)), redundancyN: 1, lane: "photonic" }).target, "digital");
  assert.equal(decider.decide({ n: Math.ceil(nStar * 4), redundancyN: 1, lane: "photonic" }).target, "photonic");

  let violations = 0, slowdowns = 0, photCount = 0;
  for (let n = 1; n <= 4096; n++) {
    for (const Nv of [1, 3, 9, 25]) {
      const r = decider.decide({ n, redundancyN: Nv, lane: "photonic" });
      const realised = r.target === "photonic" ? Tphotonic(n, Nv) : Tdigital(n);
      if (r.target === "photonic") { photCount++; if (Tphotonic(n, Nv) >= Tdigital(n)) violations++; }
      if (realised > Tdigital(n) + 1e-9) slowdowns++;
    }
  }
  assert.equal(violations, 0, "no photonic route is ever slower than digital");
  assert.equal(slowdowns, 0, "realised cost never exceeds digital (worst case = stayed digital)");
  assert.ok(photCount > 0, "the router DOES offload large kernels (not trivially all-digital)");
});

// M4 — redundancy from D1 raises the bar: a noisier lane needs more votes (or cannot vote).
test("M4: crossover grows with redundancy; clean lane votes into spec, noisy lane cannot", () => {
  assert.ok(crossover(9) > crossover(3) && crossover(3) > crossover(1), "n* increases with N");
  const Nclean = requiredRedundancy(256, PHOTONIC, 0.02);
  const Nnoisy = requiredRedundancy(256, NOISY, 0.02);
  assert.ok(Number.isFinite(Nclean), `clean lane feasible (N=${Nclean})`);
  assert.ok(!Number.isFinite(Nnoisy), "noisy lane INFEASIBLE (systematic ADC floor → Infinity)");
});

// M5 — eligibility gate: crypto / control-flow / lane:digital never offload (crypto-on-core).
test("M5: crypto / control-flow / lane:digital stay digital even when huge", () => {
  assert.equal(decider.decide({ n: 100000, redundancyN: 1, lane: "photonic", isCrypto: true }).target, "digital");
  assert.equal(decider.decide({ n: 100000, redundancyN: 1, lane: "photonic", isControlFlow: true }).target, "digital");
  assert.equal(decider.decide({ n: 100000, redundancyN: 1, lane: "digital" }).target, "digital");
});

// RD-0126 A-2 — crypto-eligibility is derived from the AUTHORITATIVE declared-effect footprint, so a
// caller cannot bypass the crypto→digital gate by passing isCrypto:false on a crypto kernel.
test("A-2: crypto declared via effects routes digital even with isCrypto:false (caller flag not trusted alone)", () => {
  // hostile/mis-wired: claims not-crypto, but the declared effects say otherwise -> still digital.
  const d = decider.decide({ n: 100000, redundancyN: 1, lane: "photonic", isCrypto: false, declaredEffects: ["crypto.sign"] });
  assert.equal(d.target, "digital");
  assert.ok(/derived from declared effects/.test(d.reason));
  // conservative superset: a future crypto.* effect (e.g. crypto.kem) is also caught.
  assert.equal(decider.decide({ n: 100000, redundancyN: 1, lane: "photonic", declaredEffects: ["crypto.kem"] }).target, "digital");
  // non-crypto effects on a large photonic kernel still offload (the gate didn't over-fire).
  assert.equal(decider.decide({ n: 100000, redundancyN: 1, lane: "photonic", declaredEffects: ["math.matmul"] }).target, "photonic");
});

// M6 — fail-closed on unknown cost.
test("M6: NaN/negative/infeasible inputs all fail closed → digital", () => {
  assert.equal(decider.decide({ n: 1024, redundancyN: NaN, lane: "photonic" }).target, "digital");
  assert.equal(decider.decide({ n: -5, redundancyN: 1, lane: "photonic" }).target, "digital");
  assert.equal(decider.decide({ n: 512, lane: "photonic", phys: NOISY, tolerance: 0.001 }).target, "digital");
});

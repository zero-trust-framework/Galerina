// partition-decider.ts — the `target.photonic` selector + net-win cost gate.
//
// Ported verbatim from the prove-own-maths artifact
//   LogicN-R-AND-D/scripts/rd-photonic-ppu-cost-model-proof.mjs   (D2, 25/25, exit 0)
// which ESM-imports D1 so it prices the REAL emulator numbers, not relative units.
//
// The decider sits between the router and the dispatch lookup. It routes an ELIGIBLE
// kernel to the photonic backend ONLY when an ABSOLUTE (ns) cost model proves a NET WIN;
// otherwise it DEFAULTS TO DIGITAL. The worst case is "stayed digital", never a slowdown.
//
// Posture (binding): per-op latencies are CONSERVATIVE ASPIRATIONAL ENVELOPES anchored to
// Meech 2023 (arXiv:2308.01719: ideal optical 9.4× / median realized 1.9× after DAC/ADC).
// They are LABELLED aspirational — the DECISION logic is exact and the "never a slowdown"
// guarantee is structural (the router enforces it). No measured speedup without a named PIC.

import { analogVarianceClosedForm, adcRange, quantStep, PHOTONIC, type PhysParams } from "./emulator.js";

export type Target = "digital" | "photonic";

/** Lane discriminator (mirrors substrate-inference.ts:28 SubstrateLane). */
export type Lane = "photonic" | "noisy" | "digital";

/** The cost inputs the decider reads off a kernel's substrate{} contract + its size. */
export interface KernelCost {
  /** Inner dimension / matrix side n (an n×n GEMM is O(n³) digital). */
  readonly n: number;
  /** Declared lane; only `photonic`/`noisy` are ever candidates. */
  readonly lane: Lane;
  /** Required voting redundancy. If omitted, derived from D1's closed-form variance. */
  readonly redundancyN?: number;
  /** Device-physics knobs for the lane (defaults to the clean PHOTONIC profile). */
  readonly phys?: PhysParams;
  /** Relative tolerance the kernel must meet (defaults to 0.05). */
  readonly tolerance?: number;
  /** Eligibility gates (crypto-on-core): crypto / control-flow NEVER offload. */
  readonly isCrypto?: boolean;
  readonly isControlFlow?: boolean;
  /**
   * The kernel's declared effect footprint. The crypto gate derives crypto-eligibility AUTHORITATIVELY
   * from this (any `crypto.*` effect), so a mis-wired or hostile caller passing isCrypto:false on a
   * crypto kernel cannot route crypto onto a noisy/photonic lane (RD-0126 A-2). Optional for back-compat;
   * when present it can only ADD to the gate (fail-safe), never relax it.
   */
  readonly declaredEffects?: readonly string[];
}

export interface Decision {
  readonly target: Target;
  readonly reason: string;
  /** Digital cost (ns) when computed. */
  readonly tdig?: number;
  /** Photonic cost (ns) when computed. */
  readonly tphot?: number;
  /** Required votes used in the decision when computed. */
  readonly N?: number;
}

// ── ABSOLUTE COST MODEL — nanoseconds per op (ASPIRATIONAL ENVELOPE, labelled) ─────────
export const NS = Object.freeze({
  c_d_ns:       0.30,        // digital MAC latency per multiply-accumulate (ns; ~3 GHz FMA-ish)
  c_opt_ns:     0.30 / 9.4,  // ideal optical MAC per element — Meech 9.4× ideal speedup
  c_convIn_ns:  2.5,         // DAC convert-IN per input element (ns) — the conversion tax
  c_convOut_ns: 2.5,         // ADC convert-OUT per output element (ns)
  c_verify_ns:  0.30,        // Freivalds probe MAC per element (ns; on the cheap digital core)
  k:            20,          // Freivalds probes (matches D1/E5; catch ≥ 1 − 2⁻²⁰)
  fixed_ns:     120,         // fixed per-offload handshake/setup latency (ns)
});

/** Representative inner-product width per conversion batch (Meech tax amortisation). */
export const W_REP = 40;

/** Per-MAC ideal vs realized advantage (Meech 2023) — the like-for-like statement. */
export function meechRealizedRatio(): { idealRatio: number; realizedRatio: number; retention: number } {
  const idealRatio = NS.c_d_ns / NS.c_opt_ns;                       // ~9.4× (ideal optical)
  const convertPerMac = (NS.c_convIn_ns + NS.c_convOut_ns) / W_REP; // boundary tax amortised over W_REP MACs
  const realizedRatio = NS.c_d_ns / (NS.c_opt_ns + convertPerMac);  // ~1.9× (after DAC/ADC)
  const retention = realizedRatio / idealRatio;                     // ~0.20 (Meech 1.9/9.4)
  return { idealRatio, realizedRatio, retention };
}

/**
 * Required voting redundancy N from D1's REAL emulator numbers. A lane meets a relative
 * tolerance `tol` once the voted analog error RMS / signal-span drops below tol; Var of
 * the vote = Var_closed_form / N. A degraded lane whose SYSTEMATIC ADC-quantization floor
 * alone exceeds the target returns Infinity (voting cannot beat a systematic floor) ⇒ refuse.
 */
export function requiredRedundancy(n: number, phys: PhysParams, tol: number): number {
  const span = adcRange(n);
  const w = new Int8Array(n).fill(1), a = new Int32Array(n).fill(3); // conservative all-active worst case
  const varCF = analogVarianceClosedForm(w, a, n, phys);
  const target = (tol * span) ** 2;
  const qFloor = (quantStep(n, phys.quantBits) / Math.sqrt(12)) ** 2; // uniform-quant variance (systematic)
  if (qFloor > target) return Infinity;                              // systematic floor — voting can't beat it
  if (varCF <= target) return 1;                                     // single read already in spec
  return Math.ceil(varCF / target);                                 // votes to cut random variance under target
}

/** O(n³) digital GEMM / T-MAC cost in ns. */
export function Tdigital(n: number): number { return NS.c_d_ns * n ** 3; }

/** Photonic cost in ns: (n² optical MACs + Freivalds k·n² verify) × N votes + O(n) convert + fixed. */
export function Tphotonic(n: number, N: number): number {
  const optical = NS.c_opt_ns * n * n;
  const verify = NS.c_verify_ns * NS.k * n * n;
  const convert = (NS.c_convIn_ns + NS.c_convOut_ns) * n;
  return (optical + verify) * N + convert + NS.fixed_ns;
}

/** Closed-form crossover: solve c_d·n³ = (c_opt + c_verify·k)·N·n² ⇒ n* = (c_opt + c_verify·k)·N / c_d. */
export function crossover(N: number): number { return (NS.c_opt_ns + NS.c_verify_ns * NS.k) * N / NS.c_d_ns; }

/**
 * The router. DEFAULT = digital. Routes photonic ONLY on a proven absolute-ns win.
 * Fail-closed everywhere: ineligible / no-net-win / cannot-vote / garbage-input → digital.
 */
export class PartitionDecider {
  decide(kernel: KernelCost): Decision {
    // (M5) eligibility gate FIRST — crypto / control-flow / explicitly-digital never offload.
    // Crypto-eligibility is derived from the AUTHORITATIVE declared-effect footprint, NOT just the
    // caller's self-reported isCrypto flag (RD-0126 A-2): a mis-wired/hostile caller passing
    // isCrypto:false on a crypto kernel must not be able to route crypto onto a noisy/photonic lane.
    // `crypto.` prefix is a deliberately CONSERVATIVE superset of substrate-inference.ts:65 CRYPTO_EFFECT
    // — fail-safe: it can only keep MORE work on the digital core, never less, even if a new crypto.*
    // effect is later added to the canonical set.
    const declaresCrypto = (kernel.declaredEffects ?? []).some((e) => e.startsWith("crypto."));
    if (kernel.isCrypto || declaresCrypto || kernel.isControlFlow) {
      const derived = declaresCrypto && !kernel.isCrypto ? " (crypto derived from declared effects — caller flag not trusted alone)" : "";
      return { target: "digital", reason: "INELIGIBLE: crypto/control-flow stays on the digital core (LLN-SUBSTRATE-001)" + derived };
    }
    if (kernel.lane === "digital") {
      return { target: "digital", reason: "declared lane:digital — inert" };
    }

    const n = kernel.n;
    // (M6) fail-closed on garbage input.
    if (!Number.isFinite(n) || n < 1) {
      return { target: "digital", reason: "FAIL-CLOSED: n missing/NaN/<1 → digital" };
    }

    // Required votes from D1's real variance (or supplied). Infeasible lane ⇒ refuse.
    const tol = kernel.tolerance ?? 0.05;
    const phys = kernel.phys ?? PHOTONIC;
    // The systematic ADC-quantization floor (LLN-SUBSTRATE-003) is a STRUCTURAL refusal the caller
    // cannot switch off by supplying redundancyN: re-derive feasibility regardless. A supplied
    // redundancyN only overrides the random-variance vote count, never the systematic-floor refusal.
    const feasibleN = requiredRedundancy(n, phys, tol);
    if (!Number.isFinite(feasibleN)) {
      return { target: "digital", reason: "FAIL-CLOSED: systematic ADC floor exceeds tolerance — lane infeasible regardless of redundancyN (LLN-SUBSTRATE-003)" };
    }
    const N = kernel.redundancyN ?? feasibleN;
    if (!Number.isFinite(N) || N < 1) {
      return { target: "digital", reason: `FAIL-CLOSED: lane cannot vote into tolerance (N=${N}) → digital (LLN-SUBSTRATE-003)` };
    }

    const tdig = Tdigital(n), tphot = Tphotonic(n, N);
    if (tphot < tdig) {
      return { target: "photonic", reason: `net win: photonic ${tphot.toFixed(0)}ns < digital ${tdig.toFixed(0)}ns (${(tdig / tphot).toFixed(2)}×)`, tdig, tphot, N };
    }
    return { target: "digital", reason: `REFUSE: photonic ${tphot.toFixed(0)}ns ≥ digital ${tdig.toFixed(0)}ns — no win, stay digital`, tdig, tphot, N };
  }
}

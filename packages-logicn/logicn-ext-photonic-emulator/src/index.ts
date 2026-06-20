// @logicn/ext-photonic-emulator — the photonic-PPU backend package.
//
// A physics-faithful (Rung-2) ternary-MAC emulator + the partition cost-model router,
// behind the neutral @logicn/inference-bridge-contract. Digital stays the default and is
// byte-unchanged; an eligible kernel routes to the emulator ONLY on a proven net win and
// is re-verified — fail-closed to digital. EMULATED, not silicon (no measured speedup).
//
// Ports the prove-own-maths artifacts:
//   D1 emulator  — rd-photonic-ppu-emulator-proof.mjs   (18/18)
//   D2 router    — rd-photonic-ppu-cost-model-proof.mjs (25/25)

// ── D1: the physics-faithful emulator ──────────────────────────────────────────────
export {
  type PhysParams,
  ACT_MAX, ENOB_CEILING, PHOTONIC, NOISY,
  Xorshift32,
  tmacExact, analogVarianceClosedForm, adcRange, quantStep,
  tmacPhotonic, tmacVoted,
  wdmCrosstalkMatrix, applyWdm,
  flipProbability, singleLaneErrorProbability, binom, nmrFailureProbability,
} from "./emulator.js";

// ── re-verify: verify-cheap, never re-execute ───────────────────────────────────────
export { freivaldsVerify, freivaldsVerifyCost, toleranceCheck } from "./freivalds.js";

// ── D2: the partition cost-model router (the `target.photonic` selector) ─────────────
export {
  type Target, type Lane, type KernelCost, type Decision,
  NS, W_REP, meechRealizedRatio, requiredRedundancy,
  Tdigital, Tphotonic, crossover,
  PartitionDecider,
} from "./partition-decider.js";

// ── the bridge (neutral contract) + the fail-closed runtime path ─────────────────────
export {
  type PhotonicBackend, type PhotonicBridgeConfig,
  PhotonicEmulatorBridge,
} from "./photonic-bridge.js";
export { type PhotonicRunResult, PhotonicRuntime, type PhotonicRouteHit, createPhotonicRouterPort } from "./runner.js";

// ── the Bifurcated Execution Invariant — semantic-parity conformance gate ────────────
export {
  type ParityOptions, type ParityResult, type ParityReport,
  checkParity, proveBifurcatedParity,
} from "./parity-conformance.js";

// @logicn/observability — actuator-style operational observability for a LogicN app.
//
// The APP-OPERATOR's ops view: a health/liveness/readiness surface, app metrics
// (request counts, latencies, error rates) and structured app logs — surfaced
// THROUGH the App Kernel as health routes + a metrics collector. Fail-closed,
// zero ambient authority, additive (it changes nothing in the kernel or core).
//
// DISTINCT from @logicn/governance-telemetry: that package exports governance
// STRUCTURE ("log the contract, not the payload") for Prometheus; THIS package is
// the app's own health/metrics/logs — the operational, not the governance, lens.
export * from "./metrics.js";
export * from "./health.js";
export * from "./logger.js";
export * from "./kernel-integration.js";
export * from "./observability.js";

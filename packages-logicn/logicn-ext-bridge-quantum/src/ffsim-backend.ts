// ffsim-backend.ts — the QuantumSimBackend.
//
// Phase 1 (this file): env-detect + the PRE-SPAWN governance gate (Hardened Border
// Stage 2). It does NOT execute ffsim yet — real out-of-process run is Phase 2. Every
// job still passes the full limit gate; a breach traps with LOAD→TRAP→ERASE and NO spawn.
import { createHash } from "node:crypto";
import { detectFfsim, type FfsimEnv } from "./env-detect.js";
import { checkJobLimits } from "./limits.js";
import type { QuantumJob, QuantumLimits, QuantumResult, QuantumSimBackend } from "./quantum-contract.js";
import type { AuditLogger } from "../../logicn-tower-citizen/dist/index.js";

const BACKEND_ID = "ffsim-quantum-v1";

function inputHash(job: QuantumJob): string {
  return createHash("sha256")
    .update(JSON.stringify([job.op, job.norb, job.nelec, job.seed, job.params]))
    .digest("hex");
}

export class FfsimBackend implements QuantumSimBackend {
  readonly backendId = BACKEND_ID;
  #env: FfsimEnv;
  #audit: AuditLogger | undefined;

  /** `env` is injectable for deterministic tests; defaults to a live `detectFfsim()` probe.
   *  `audit` (optional) wires the Tower LOAD→TRAP→ERASE audit trail (#199 Phase 1.5); when
   *  omitted the backend behaves exactly as before (no audit emission). */
  constructor(env?: FfsimEnv, audit?: AuditLogger) {
    this.#env = env ?? detectFfsim();
    this.#audit = audit;
  }

  get available(): boolean { return this.#env.available; }

  async initialize(): Promise<void> { /* per-call spawn (RATIFIED §13.6) — no warm pool to init. */ }
  async shutdown(): Promise<void> { /* no persistent worker in v1. */ }

  async run(job: QuantumJob, limits: QuantumLimits): Promise<QuantumResult> {
    const startedAt = Date.now();
    const provBase = {
      backendVersion: this.#env.ffsimVersion ?? "",
      backendArtifactHash: "", seed: job.seed, rayonThreads: limits.rayonThreads,
      tolerance: limits.tolerance, inputHash: inputHash(job), outputHash: "",
    };

    // Tower lifecycle (#199 Phase 1.5): LOAD now; TRAP+ERASE on breach; ERASE on admit.
    // artifactHash links the trail to this job's content hash. EXEC is emitted in Phase 2,
    // when a real out-of-process run actually executes (Phase 1 admits but does not execute).
    const art = provBase.inputHash;
    this.#audit?.load(job.correlationId, art, BACKEND_ID);

    // Stage 2 — Interrogate: the pre-spawn limit gate. A breach is LOAD→TRAP→ERASE, no spawn.
    const verdict = checkJobLimits(job, limits);
    if (!verdict.ok) {
      this.#audit?.trap(job.correlationId, art, BACKEND_ID, verdict.errorCode ?? "ERR_LIMIT", { reason: verdict.reason ?? "" });
      this.#audit?.erase(job.correlationId, art, BACKEND_ID, false);
      return {
        correlationId: job.correlationId, backendId: BACKEND_ID, executedNatively: false,
        scalars: {}, artifacts: [], provenance: provBase,
        latencyMs: Date.now() - startedAt, trapFired: true,
        errorCode: verdict.errorCode, reason: verdict.reason,
      };
    }

    // Stage 3 — Execute: the real out-of-process ffsim run is Phase 2. Phase 1 is honest:
    // it governs the job but does not execute it, and never fakes a result.
    const reason = this.#env.available
      ? "limits OK; ffsim present — real out-of-process execution is Phase 2 (not yet implemented)"
      : `ffsim unavailable: ${this.#env.reason ?? "not detected"}`;
    // Admitted: nothing executed in Phase 1, so ERASE (clean, no state) closes the trail.
    this.#audit?.erase(job.correlationId, art, BACKEND_ID, true, provBase.outputHash);
    return {
      correlationId: job.correlationId, backendId: BACKEND_ID, executedNatively: false,
      scalars: {}, artifacts: [], provenance: provBase,
      latencyMs: Date.now() - startedAt, trapFired: false, reason,
    };
  }
}

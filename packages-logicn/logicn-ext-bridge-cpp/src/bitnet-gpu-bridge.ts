/**
 * bitnet-gpu-bridge.ts — governed GPU ternary bridge (detection + CUDA seam)
 *
 * Detects an NVIDIA GPU (real, via nvidia-smi) and reports it. The actual CUDA
 * BitNet kernel (C:\wwwprojects\BitNet\gpu\) is a documented seam — until it is
 * compiled into the native addon, this bridge runs the simulator reference and
 * reports executedNatively=false with the detected GPU recorded, so callers know
 * the hardware exists but the kernel is pending.
 *
 * Same three Bridge Standards as the CPU bridge: determinism cross-check,
 * governance signal, zero-copy buffers.
 */

import {
  type InferenceBridge,
  type BridgeOp,
  type BridgeResult,
} from "@logicn/inference-bridge-contract";
import {
  StubTernaryBridge,
  GovernanceEnforcer,
  AuditLogger,
} from "@logicn/tower-citizen";
import { detectGpu, type GpuCapability } from "./hardware-detect.js";

export class BitNetGpuBridge implements InferenceBridge {
  readonly bridgeId = "bitnet-gpu";
  readonly technique = "ternary" as const;
  readonly nativeAvailable: boolean; // true only when a CUDA kernel is actually ready
  readonly gpu: GpuCapability;

  private readonly reference: StubTernaryBridge;
  private readonly governance: GovernanceEnforcer;

  constructor(logger?: AuditLogger, governance?: GovernanceEnforcer) {
    this.gpu = detectGpu();
    // Native is available only if a GPU is present AND its CUDA kernel is built.
    this.nativeAvailable = this.gpu.available && this.gpu.cudaKernelReady;
    this.governance = governance ?? new GovernanceEnforcer();
    this.reference = new StubTernaryBridge(logger, this.governance);
  }

  initialize(): void { /* CUDA context init happens here once the kernel is wired */ }
  shutdown(): void { /* CUDA context teardown */ }

  /** Whether a GPU was physically detected (independent of kernel readiness). */
  gpuDetected(): boolean { return this.gpu.available; }

  canCommit(): boolean {
    // Option A (CWE-863 fix): COMMIT gate = the 0 → +1 transition ONLY, deny-by-default.
    // The old `|| checkTransition(-1, 0)` disjunct was always-allowed → an inert gate.
    return this.governance.checkTransition(0, 1).allowed;
  }

  execute(op: BridgeOp): BridgeResult {
    const t0 = Date.now();
    // CUDA kernel pending — run the deterministic simulator reference.
    const ref = this.reference.execute(op);
    // Standard 2 — Governance Signal: when this bridge WOULD execute natively (CUDA kernel ready),
    // the COMMIT gate MUST pass first. Fail-closed. There is no live native path yet, so this wires
    // the gate AHEAD of the kernel — the documented Standard-2 now holds for the GPU bridge too (the
    // same fix as the CPU bridge); it is a no-op while nativeAvailable is false.
    if (this.nativeAvailable && !this.canCommit()) {
      throw new Error(
        "[CITIZEN_STANDARD_VIOLATION]: GovernanceEnforcer denied the COMMIT transition (0 -> +1) — " +
          "Standard 2 (Governance Signal) blocks native BitNet GPU execution. Fail-closed.",
      );
    }
    return {
      value: ref.value,
      executedNatively: this.nativeAvailable, // false until CUDA kernel is compiled
      bridgeId: this.bridgeId,
      technique: this.technique,
      latencyMs: Date.now() - t0,
      deterministic: true,
    };
  }
}

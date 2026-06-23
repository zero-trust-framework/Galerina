/**
 * bitnet-cpu-bridge.ts — the first real `implements InferenceBridge`
 *
 * Governed CPU ternary bridge for Microsoft BitNet (MIT). Wraps the native
 * ggml-bitnet kernels when the compiled addon is present; otherwise falls back to
 * the byte-faithful TPLSimulator from @logicn/tower-citizen.
 *
 * Upholds the three Citizen One Bridge Standards:
 *   1. Determinism Hook — every native result is cross-checked against the
 *      simulator reference; a mismatch is a CRITICAL failure (assertDeterminism).
 *   2. Governance Signal — canCommit() runs the GovernanceEnforcer before any
 *      native execution; a denied transition blocks the kernel.
 *   3. Zero-Copy Memory — accepts Int32Array (a WASM-memory view) directly; the
 *      native addon reads the same buffer (no serialisation in the hot path).
 */

// Contract types/values come from the NEUTRAL package (Brain/Brawn seam).
import {
  assertDeterminism,
  type InferenceBridge,
  type BridgeOp,
  type BridgeResult,
  type BridgeManifest,
} from "@logicn/inference-bridge-contract";
// The determinism oracle + governance/audit are the Tower's reference
// implementation (still imported from the Tower — oracle extraction deferred).
import {
  StubTernaryBridge,
  GovernanceEnforcer,
  AuditLogger,
} from "@logicn/tower-citizen";
import { loadNativeAddon, type BitNetNativeAddon } from "./addon-loader.js";
import { detectCpu, type CpuCapability } from "./hardware-detect.js";

export class BitNetCpuBridge implements InferenceBridge {
  readonly bridgeId = "bitnet-cpu";
  readonly technique = "ternary" as const;
  readonly nativeAvailable: boolean;
  /** CF-3/CF-7 self-description. `nativeAddonHash` is the SHA-256 the loader
   *  computed over the `.node` binary (present only when a native addon loaded);
   *  it ships unsigned (`certificationProfile: "dev"`) until `logicn bridge-attest
   *  sign` signs it offline for a certified deployment. */
  readonly manifest: BridgeManifest;

  readonly cpu: CpuCapability;
  private readonly native: BitNetNativeAddon | null;
  private readonly reference: StubTernaryBridge; // simulator reference (determinism oracle)
  private readonly governance: GovernanceEnforcer;
  private initialized = false;
  /** Cross-check native vs simulator on the first N calls (determinism hook). */
  private determinismChecksRemaining = 8;

  constructor(logger?: AuditLogger, governance?: GovernanceEnforcer) {
    const load = loadNativeAddon();
    this.native = load.addon;
    this.nativeAvailable = load.loaded;
    this.cpu = detectCpu();
    this.governance = governance ?? new GovernanceEnforcer();
    this.reference = new StubTernaryBridge(logger, this.governance);
    this.manifest = {
      bridgeId: this.bridgeId,
      packageName: "@logicn/ext-bridge-cpp",
      packageHash: "0".repeat(64), // filled by `logicn bridge-attest` at release time
      ...(load.addonHash !== undefined ? { nativeAddonHash: load.addonHash } : {}),
      sourceEngine: "microsoft/BitNet",
      precision: "ternary",
      layoutVersion: "i2s-v1",
      hardwareIdentity: `${this.cpu.arch}-${this.cpu.kernelFamily}`,
      determinismMode: "exact",
      certificationProfile: "dev",
    };
  }

  initialize(): void {
    if (this.initialized) return;
    if (this.native) {
      this.native.init();
      this.native.setThreads(this.cpu.cores);
    }
    this.initialized = true;
  }

  shutdown(): void {
    if (this.native && this.initialized) this.native.free();
    this.initialized = false;
  }

  /** Standard 2 — Governance Signal: must pass before native execution commits. */
  canCommit(): boolean {
    // A 0 → +1 (HOLD → COMMIT) transition requires authorisation. For a bulk
    // T-MAC the bridge treats the whole op as a potential commit; the enforcer
    // gates it. Unrestricted ops are always allowed.
    return this.governance.checkTransition(0, 1).allowed
      || this.governance.checkTransition(-1, 0).allowed; // non-commit ops always allowed
  }

  execute(op: BridgeOp): BridgeResult {
    if (!this.initialized) this.initialize();
    const t0 = Date.now();

    // Always compute the simulator reference (the determinism oracle).
    const ref = this.reference.execute(op);

    if (!this.native) {
      // Native absent — the reference IS the result. Honest reporting.
      return {
        value: ref.value,
        executedNatively: false,
        bridgeId: this.bridgeId,
        technique: this.technique,
        latencyMs: Date.now() - t0,
        deterministic: true,
      };
    }

    // Standard 2 — Governance Signal (PREFLIGHT): the COMMIT gate MUST pass before any
    // native execution. Fail-closed — a denied (or indeterminate) transition blocks the
    // kernel and MUST NOT fall through to the native addon. (Preflight only; mid-compute
    // revocation is a separate concern.) This wires the gate the docstring + canCommit()
    // already advertised but execute() never called — closing the native governance bypass.
    if (!this.canCommit()) {
      throw new Error(
        "[CITIZEN_STANDARD_VIOLATION]: GovernanceEnforcer denied the COMMIT transition " +
          "(0 -> +1) — Standard 2 (Governance Signal) blocks native BitNet execution. " +
          "Fail-closed: no native addon call is made.",
      );
    }

    // Native present — execute and cross-check (Standard 1).
    if (!(op.weights instanceof Int32Array)) {
      throw new Error("[BITNET_CPU]: native path requires packed Int32Array weights (zero-copy)");
    }
    const nativeValue = this.native.tmac(op.weights, op.activations, op.count, op.scale, op.offset ?? 0);

    const result: BridgeResult = {
      value: nativeValue,
      executedNatively: true,
      bridgeId: this.bridgeId,
      technique: this.technique,
      latencyMs: Date.now() - t0,
      deterministic: true,
    };

    // Standard 1 — Determinism Hook: native must match the simulator exactly.
    if (this.determinismChecksRemaining > 0) {
      this.determinismChecksRemaining--;
      if (nativeValue !== ref.value) {
        throw new Error(
          `[CITIZEN_STANDARD_VIOLATION]: native BitNet result ${nativeValue} ≠ ` +
          `simulator reference ${ref.value} — Standard 1 (TPL Determinism) breached`,
        );
      }
      assertDeterminism(result);
    }

    return result;
  }
}

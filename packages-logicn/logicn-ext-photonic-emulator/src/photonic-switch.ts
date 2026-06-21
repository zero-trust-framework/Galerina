// photonic-switch.ts — the photonic-HARDWARE switch (the owner's "switchable separate package; keep
// digital, add a photonic-hardware switch").
//
// The photonic LANE runs behind the `PhotonicBackend` seam. Today the only backend is the Rung-2 EMULATOR
// (software, physics-faithful, honest deterministic=false). This switch lets a deployment select a REAL
// silicon backend WITHOUT changing anything else — but it is FAIL-CLOSED and KEEP-DIGITAL:
//   • DEFAULT is the emulator (software). Real hardware is never the silent default.
//   • Real hardware is admitted ONLY when it is present, reports nativeAvailable=true, AND is ATTESTED
//     (a verified backend-artifact attestation). Any miss → fall back to the emulator. We never run an
//     unverified PIC.
//   • KEEP-DIGITAL: the switch only chooses the PHOTONIC compute backend. Crypto, K3 governance, and
//     control stay on the digital core (the PartitionDecider already keeps crypto-on-core); the switch
//     never routes them through photonics.
//
// This is the runtime seam for the photonic-PPU-virtualisation ladder: Rung 2 = emulator (here today),
// Rung 3+ = an attested real-hardware backend slotted in behind the same interface.

import type { PhotonicBackend } from "./photonic-bridge.js";
import { PhotonicEmulatorBridge } from "./photonic-bridge.js";

export type PhotonicMode = "emulator" | "hardware" | "auto";

/** A real-hardware photonic backend: the compute seam + the attestation surface the switch gates on. */
export interface PhotonicHardwareBackend extends PhotonicBackend {
  /** true ⇒ a real PIC is present and usable (an emulator reports false). */
  readonly nativeAvailable: boolean;
  /** Stable identity of the silicon (e.g. "lightmatter-mars-v2"). */
  readonly hardwareIdentity: string;
  /**
   * Admission flag: true asserts the backend artifact has been verified. HONEST SCOPE (audit): this selector
   * does NOT itself perform the cryptographic verification — `attested` is CALLER-ASSERTED, and the
   * verification that sets it is the deployment's responsibility (e.g. bridge-attestation / a signed manifest).
   * The switch refuses a backend whose caller did not assert it; a real verifyAttestation result gates it when
   * a Rung-3+ silicon backend lands.
   */
  readonly attested: boolean;
}

export interface PhotonicSwitchOptions {
  /** "emulator" (default, software), "hardware" (require real silicon), or "auto" (HW if attested, else emulator). */
  readonly mode?: PhotonicMode;
  /** The candidate real-hardware backend, if any. */
  readonly hardware?: PhotonicHardwareBackend;
  /** Override the software fallback (testing); defaults to a fresh PhotonicEmulatorBridge. */
  readonly emulator?: PhotonicBackend;
}

export interface PhotonicSwitchDecision {
  /** The selected backend — ALWAYS usable (emulator on any fail-closed path). */
  readonly backend: PhotonicBackend;
  readonly selected: "emulator" | "hardware";
  readonly reason: string;
  /** Set on a fail-closed fallback so the deployment can surface the misconfiguration. */
  readonly code?: string;
}

/**
 * Select the photonic backend, fail-closed. The returned `backend` is always usable; on any failure to
 * admit real hardware the emulator is returned (with a code), so the photonic lane never goes dark and never
 * runs an unverified PIC.
 */
export function selectPhotonicBackend(opts: PhotonicSwitchOptions = {}): PhotonicSwitchDecision {
  const emulator = opts.emulator ?? new PhotonicEmulatorBridge();
  const mode: PhotonicMode = opts.mode ?? "emulator";
  const hw = opts.hardware;

  if (mode === "emulator") {
    return { backend: emulator, selected: "emulator", reason: "mode=emulator — software backend (default)" };
  }

  // mode is "hardware" or "auto": consider the candidate, fail-closed on every miss.
  if (hw === undefined) {
    return mode === "hardware"
      ? { backend: emulator, selected: "emulator", reason: "mode=hardware but no hardware backend supplied — fail-closed to emulator", code: "LLN_PHOTONIC_NO_HARDWARE" }
      : { backend: emulator, selected: "emulator", reason: "mode=auto, no hardware backend — emulator" };
  }
  if (hw.nativeAvailable !== true) {
    return { backend: emulator, selected: "emulator", reason: `hardware backend '${hw.hardwareIdentity}' reports nativeAvailable=${hw.nativeAvailable} — fail-closed to emulator`, code: "LLN_PHOTONIC_HW_UNAVAILABLE" };
  }
  if (hw.attested !== true) {
    return { backend: emulator, selected: "emulator", reason: `hardware backend '${hw.hardwareIdentity}' is UNATTESTED — fail-closed to emulator (never run an unverified PIC)`, code: "LLN_PHOTONIC_HW_UNATTESTED" };
  }
  return { backend: hw, selected: "hardware", reason: `attested hardware backend '${hw.hardwareIdentity}' selected` };
}

/** Convenience: just the backend (emulator on any fail-closed path). */
export function resolvePhotonicBackend(opts: PhotonicSwitchOptions = {}): PhotonicBackend {
  return selectPhotonicBackend(opts).backend;
}

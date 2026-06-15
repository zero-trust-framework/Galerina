// manifest.ts — the signed-bridge-manifest schema (enables CF-3 attestation).
//
// This package defines the SHAPE and a canonical serialisation; the actual SHA-256
// hashing and signature verification live in the Tower (which has node:crypto), so
// the contract stays zero-dependency and neutral. The Tower computes
// `hash = sha256(canonicalManifestString(m))` and checks it against the active
// contract's allowed bridges before calling `bridge.execute()`.

import type { PrecisionTechnique } from "./precision-types.js";

/**
 * How a bridge's results are trusted to match the reference oracle.
 * `tolerance` (added for out-of-process float backends, e.g. the ffsim quantum bridge):
 * results are reproducible only to a numeric band, never bit-exact — admissible ONLY
 * when fully pinned (see validateManifestShape). Never claim "exact" for a noisy backend.
 */
export type DeterminismMode = "exact" | "sampled" | "unverified" | "tolerance";

/** Which runtime profile a bridge is attested for. */
export type CertificationProfile = "dev" | "certified";

/** Backend domain discriminator. `precision` (a ternary enum) is meaningful only for inference. */
export type BridgeDomain = "inference" | "quantum";

/**
 * A measured reproducibility/accuracy witness for a tolerance backend (#201 lane).
 * Binds the DECLARED `tolerance` to an empirically-measured (N, ε, std) curve and the
 * noise model it was measured under, so `tolerance` stops being an author-asserted
 * constant. (idea-mining #3 / SPDNN shot-budget precedent — see
 * docs/Knowledge-Bases/logicn-external-idea-mining-2026-06-15.md.)
 */
export interface ToleranceWitness {
  readonly redundancyN:     number; // votes / shots / runs the measurement averaged over (>= 1)
  readonly epsilonMeasured: number; // measured residual band achieved at redundancyN (> 0)
  readonly stdDev:          number; // residual std-dev at redundancyN (>= 0)
  readonly noiseModelId:    string; // identity of the noise model the witness was measured under
}

/**
 * A bridge's self-description. In certified mode the Tower refuses any bridge
 * whose manifest is missing, structurally invalid, or not on the active
 * contract's allow-list / hash-pin.
 */
export interface BridgeManifest {
  readonly bridgeId:           string;
  readonly packageName:        string;
  readonly packageHash:        string;            // sha256 hex of the bridge package
  readonly nativeAddonHash?:   string;            // sha256 hex of the .node addon, if any
  readonly sourceEngine:       string;            // "microsoft/BitNet", "NVIDIA/TransformerEngine", …
  readonly precision?:         PrecisionTechnique; // OPTIONAL — N/A for domain:"quantum"
  readonly layoutVersion:      string;            // packed-ternary layout version
  readonly hardwareIdentity:   string;            // "x86_64-avx2", "cuda-sm_80", "photonic-v0", …
  readonly determinismMode:    DeterminismMode;
  readonly certificationProfile: CertificationProfile;
  // ── extensions (out-of-process / tolerance backends; e.g. the ffsim quantum bridge) ──
  // Serialized into the canonical pre-image ONLY when present, so existing
  // inference-domain manifest hashes are byte-unaffected.
  readonly domain?:              BridgeDomain;     // default "inference" when absent
  readonly tolerance?:           number;           // REQUIRED iff determinismMode="tolerance"
  readonly pinnedEnvHash?:       string;           // sha256 of the pinned venv/env lock
  readonly backendArtifactHash?: string;           // sha256 of the out-of-process backend artifact (analog of nativeAddonHash)
  // ── measured "calibration-as-attestation" extension (#201 lane) ──
  // All optional; serialized into the canonical pre-image ONLY when present, so existing
  // inference/quantum manifest hashes are byte-unaffected. Turns the tolerance/determinism
  // model from "pinned environment hashes" into "pinned env hashes + a MEASURED witness".
  readonly comparabilityHash?: string;          // sha256 of the matched comparability set (prompt/template/gen-settings/sample-count/judge)
  readonly measuredFidelity?:  number;          // 0..1 closeness-to-reference oracle the bridge SUPPLIES (LogicN only thresholds it)
  readonly minFidelity?:       number;          // 0..1 declared floor; admission requires measuredFidelity >= this (fail-closed)
  readonly toleranceWitness?:  ToleranceWitness; // binds the declared `tolerance` to a measured (N, ε, std) curve
}

/** A manifest plus its detached signature (verified by the Tower's key authority). */
export interface BridgeAttestation {
  readonly manifest:  BridgeManifest;
  readonly signature?: string; // base64 detached signature over canonicalManifestString(manifest)
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Deterministic, field-ordered serialisation — the pre-image the Tower hashes and
 * signs. Stable ordering guarantees the same manifest always yields the same hash.
 */
export function canonicalManifestString(m: BridgeManifest): string {
  const fields: (string | number)[] = [
    m.bridgeId, m.packageName, m.packageHash, m.nativeAddonHash ?? "",
    m.sourceEngine, m.precision ?? "", m.layoutVersion, m.hardwareIdentity,
    m.determinismMode, m.certificationProfile,
  ];
  // Extension fields are appended in a FIXED order ONLY when the manifest uses any of
  // them — so an existing inference-domain manifest (none set, precision present)
  // serializes byte-for-byte as before, and its attested hash is unchanged.
  const hasOldExt = m.domain !== undefined || m.tolerance !== undefined ||
                    m.pinnedEnvHash !== undefined || m.backendArtifactHash !== undefined;
  const hasMeasuredExt = m.comparabilityHash !== undefined || m.measuredFidelity !== undefined ||
                         m.minFidelity !== undefined || m.toleranceWitness !== undefined;
  if (hasOldExt || hasMeasuredExt) {
    fields.push(m.domain ?? "", m.tolerance ?? "", m.pinnedEnvHash ?? "", m.backendArtifactHash ?? "");
  }
  // The measured block is appended AFTER the original extension block and ONLY when a
  // measured field is set — so manifests that don't opt in (including the existing ffsim
  // tolerance manifest) keep their exact pinned pre-image.
  if (hasMeasuredExt) {
    fields.push(
      m.comparabilityHash ?? "",
      m.measuredFidelity ?? "",
      m.minFidelity ?? "",
      m.toleranceWitness
        ? `${m.toleranceWitness.redundancyN}:${m.toleranceWitness.epsilonMeasured}:${m.toleranceWitness.stdDev}:${m.toleranceWitness.noiseModelId}`
        : "",
    );
  }
  return JSON.stringify(fields);
}

/**
 * Structural validation (no crypto). Confirms required fields are present and
 * well-formed (hashes are 64-hex), and that a certified manifest is not in
 * `unverified` determinism mode. Returns { ok, reason }.
 */
export function validateManifestShape(m: BridgeManifest): { ok: boolean; reason?: string } {
  if (!m.bridgeId) return { ok: false, reason: "missing bridgeId" };
  if (!m.packageName) return { ok: false, reason: "missing packageName" };
  if (!SHA256_HEX.test(m.packageHash)) return { ok: false, reason: "packageHash is not a sha256 hex digest" };
  if (m.nativeAddonHash !== undefined && !SHA256_HEX.test(m.nativeAddonHash)) {
    return { ok: false, reason: "nativeAddonHash is not a sha256 hex digest" };
  }
  if (m.pinnedEnvHash !== undefined && !SHA256_HEX.test(m.pinnedEnvHash)) {
    return { ok: false, reason: "pinnedEnvHash is not a sha256 hex digest" };
  }
  if (m.backendArtifactHash !== undefined && !SHA256_HEX.test(m.backendArtifactHash)) {
    return { ok: false, reason: "backendArtifactHash is not a sha256 hex digest" };
  }
  if (!m.layoutVersion) return { ok: false, reason: "missing layoutVersion" };
  if (m.certificationProfile === "certified" && m.determinismMode === "unverified") {
    return { ok: false, reason: "certified bridge cannot be determinismMode=unverified" };
  }
  // RATIFIED (ffsim §13.1) — a "tolerance" backend is admissible (incl. certified) ONLY when
  // FULLY PINNED. Fail-closed: any missing pin → invalid. This is what makes a non-bit-exact
  // backend safe under certified mode (integrity stays on the deterministic core; see
  // logicn-ext-bridge-quantum-design.md §9.2).
  if (m.determinismMode === "tolerance") {
    if (typeof m.tolerance !== "number" || !Number.isFinite(m.tolerance) || m.tolerance <= 0) {
      return { ok: false, reason: "determinismMode=tolerance requires a finite positive tolerance" };
    }
    if (m.pinnedEnvHash === undefined) {
      return { ok: false, reason: "determinismMode=tolerance requires pinnedEnvHash (env not pinned)" };
    }
    if (m.backendArtifactHash === undefined) {
      return { ok: false, reason: "determinismMode=tolerance requires backendArtifactHash (backend not pinned)" };
    }
  }
  // ── measured "calibration-as-attestation" checks (#201) — additive, fail-closed ──
  // Only constrain manifests that OPT IN by setting a measured field; existing manifests
  // (no measured fields) are unaffected.
  if (m.comparabilityHash !== undefined && !SHA256_HEX.test(m.comparabilityHash)) {
    return { ok: false, reason: "comparabilityHash is not a sha256 hex digest" };
  }
  if (m.measuredFidelity !== undefined &&
      !(typeof m.measuredFidelity === "number" && m.measuredFidelity >= 0 && m.measuredFidelity <= 1)) {
    return { ok: false, reason: "measuredFidelity must be a number in [0,1]" };
  }
  if (m.minFidelity !== undefined) {
    if (!(typeof m.minFidelity === "number" && m.minFidelity >= 0 && m.minFidelity <= 1)) {
      return { ok: false, reason: "minFidelity must be a number in [0,1]" };
    }
    // A declared fidelity FLOOR demands a measured value at or above it (fail-closed):
    // you cannot claim a floor you did not measure.
    if (m.measuredFidelity === undefined) {
      return { ok: false, reason: "minFidelity declared but measuredFidelity is missing (floor unproven)" };
    }
    if (m.measuredFidelity < m.minFidelity) {
      return { ok: false, reason: `measuredFidelity ${m.measuredFidelity} is below the declared minFidelity ${m.minFidelity}` };
    }
  }
  if (m.toleranceWitness !== undefined) {
    const w = m.toleranceWitness;
    if (!Number.isFinite(w.redundancyN) || w.redundancyN < 1) {
      return { ok: false, reason: "toleranceWitness.redundancyN must be a finite number >= 1" };
    }
    if (!Number.isFinite(w.epsilonMeasured) || w.epsilonMeasured <= 0) {
      return { ok: false, reason: "toleranceWitness.epsilonMeasured must be a finite number > 0" };
    }
    if (!Number.isFinite(w.stdDev) || w.stdDev < 0) {
      return { ok: false, reason: "toleranceWitness.stdDev must be a finite number >= 0" };
    }
    if (!w.noiseModelId) {
      return { ok: false, reason: "toleranceWitness.noiseModelId is required" };
    }
    // CORE INVARIANT (idea-mining #3): a tolerance backend may NOT claim a tighter band
    // than it measured — the declared `tolerance` must be >= the witnessed epsilon.
    if (m.determinismMode === "tolerance" && typeof m.tolerance === "number" &&
        m.tolerance < w.epsilonMeasured) {
      return {
        ok: false,
        reason: `declared tolerance ${m.tolerance} is tighter than the measured witness epsilon ${w.epsilonMeasured}`,
      };
    }
  }
  return { ok: true };
}

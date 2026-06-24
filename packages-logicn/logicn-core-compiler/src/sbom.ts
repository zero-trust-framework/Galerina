// sbom.ts — CycloneDX 1.5 SBOM emitter from resolved PackageManifests (R&D 0120-F3).
//
// The package-resolver already holds every SBOM field per dependency (name / version / sha256 content
// hash / signer / registry) but never aggregated them into a Software Bill of Materials. This emits a
// standard CycloneDX 1.5 `bom` so a consumer (or an auditor / supply-chain scanner) can enumerate the
// governed dependency set.
//
// FAIL-CLOSED, most-secure posture: an SBOM must NEVER claim integrity it does not have. A component
// without a well-formed `sha256:<64hex>` content hash is emitted WITHOUT a `hashes` entry, tagged
// `logicn:integrity = UNVERIFIED`, and raised as an LLN-SBOM-001 diagnostic; the whole BOM is marked
// `logicn:complete = false`. A consumer can gate on `result.complete` (reject an incomplete SBOM)
// instead of being lulled by a document that silently omits an unverifiable component. This is the
// SBOM analogue of the honest-posture fixes elsewhere in the tree — no overclaim of coverage.

import type { PackageManifest } from "./package-resolver.js";

/** Canonical content-hash shape (mirrors package-resolver.ts SHA256_RE): `sha256:` + exactly 64 hex. */
const SBOM_SHA256_RE = /^sha256:([0-9a-f]{64})$/i;

export interface SbomDiagnostic {
  readonly code: "LLN-SBOM-001";
  readonly severity: "error";
  readonly component: string;
  readonly message: string;
}

export interface SbomResult {
  /** The CycloneDX 1.5 document (safe to serialize). */
  readonly bom: Record<string, unknown>;
  /** Per-component integrity diagnostics (every UNVERIFIED component). */
  readonly diagnostics: readonly SbomDiagnostic[];
  /** True iff EVERY component has a verifiable sha256 content hash (gate on this — fail-closed). */
  readonly complete: boolean;
}

export interface SbomOptions {
  /** Optional ISO-8601 timestamp for `metadata.timestamp`. Omitted by default so the BOM is
   *  DETERMINISTIC (reproducible-build friendly); pass one only when a wall-clock stamp is wanted. */
  readonly timestamp?: string;
  /** Optional name of the application/root the BOM describes. */
  readonly rootName?: string;
}

function props(m: PackageManifest, verified: boolean): Array<{ name: string; value: string }> {
  // Governance footprint as CycloneDX properties — the value-add of a GOVERNED SBOM.
  const p: Array<{ name: string; value: string }> = [
    { name: "logicn:integrity", value: verified ? "VERIFIED" : "UNVERIFIED" },
  ];
  if (m.registry !== undefined) p.push({ name: "logicn:registry", value: m.registry });
  if (m.signerKeyId !== undefined) p.push({ name: "logicn:signerKeyId", value: m.signerKeyId });
  if (m.signature !== undefined) p.push({ name: "logicn:signed", value: "true" });
  if (m.effects && m.effects.length > 0) p.push({ name: "logicn:effects", value: [...m.effects].sort().join(",") });
  if (m.capabilities && m.capabilities.length > 0) p.push({ name: "logicn:capabilities", value: [...m.capabilities].sort().join(",") });
  if (m.installScript !== undefined) p.push({ name: "logicn:installScript", value: m.installScript });
  return p;
}

/**
 * Emit a CycloneDX 1.5 SBOM for a set of resolved package manifests, fail-closed on missing integrity.
 * Deterministic: component order = input order; no wall-clock unless `opts.timestamp` is supplied.
 */
export function generateCycloneDxSbom(
  components: readonly PackageManifest[],
  opts: SbomOptions = {},
): SbomResult {
  const diagnostics: SbomDiagnostic[] = [];

  const cdxComponents = components.map((m) => {
    const match = typeof m.hash === "string" ? m.hash.match(SBOM_SHA256_RE) : null;
    const verified = match !== null;
    if (!verified) {
      diagnostics.push({
        code: "LLN-SBOM-001",
        severity: "error",
        component: `${m.name}@${m.version}`,
        message:
          `Component '${m.name}@${m.version}' has no verifiable sha256 content hash` +
          `${m.hash !== undefined ? ` (got '${m.hash}')` : ""} — emitted as logicn:integrity=UNVERIFIED. ` +
          `A complete SBOM requires a 'sha256:<64hex>' hash per component; resolve/pin it before trusting this BOM.`,
      });
    }
    const comp: Record<string, unknown> = {
      type: "library",
      name: m.name,
      version: m.version,
      properties: props(m, verified),
    };
    const hex = match?.[1];
    if (verified && hex !== undefined) {
      comp.hashes = [{ alg: "SHA-256", content: hex.toLowerCase() }];
    }
    return comp;
  });

  const complete = diagnostics.length === 0;

  const metadata: Record<string, unknown> = {
    properties: [{ name: "logicn:complete", value: String(complete) }],
  };
  if (opts.timestamp !== undefined) metadata.timestamp = opts.timestamp;
  if (opts.rootName !== undefined) {
    metadata.component = { type: "application", name: opts.rootName };
  }

  const bom: Record<string, unknown> = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata,
    components: cdxComponents,
  };

  return { bom, diagnostics, complete };
}

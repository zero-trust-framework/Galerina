// =============================================================================
// lln-graph — ExecutionProofChain
//
// Tamper-evident 5-hash chain for LogicN execution proofs.
// schemaVersion: "spore.execution.proof.v1" (canonical from NOTES TO COVER / c)
// Uses Node.js crypto — no external dependency.
// =============================================================================

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionProofHashes {
  /** SHA-256 of the build manifest file. */
  readonly manifestSha256: string;
  /** SHA-256 of the runtime audit JSONL file. */
  readonly auditSha256: string;
  /** SHA-256 of the evidence report file. */
  readonly evidenceSha256: string;
  /** SHA-256 of the denial report file. */
  readonly denialSha256: string;
  /** SHA-256 of the build artefact file. */
  readonly artefactSha256: string;
}

export interface ExecutionProofV1 {
  readonly schemaVersion: "spore.execution.proof.v1";
  readonly proofId: string;
  readonly generatedAt: string;
  readonly hashes: ExecutionProofHashes;
}

export interface ExecutionProofSection {
  readonly name: string;
  readonly algorithm: "sha256" | "sha384" | "sha512";
  readonly hash: string;
  readonly path?: string;
  readonly contentType?: string;
}

export interface ExecutionProofReference {
  readonly proofId: string;
  readonly relation: "supersedes" | "extends" | "references";
}

export interface ExecutionProofV2 {
  readonly schemaVersion: "spore.execution.proof.v2";
  readonly proofId: string;
  readonly generatedAt: string;
  /** Retained from v1 for backward compatibility. */
  readonly hashes: ExecutionProofHashes;
  /** Optional extensible sections for additional proof material. */
  readonly sections?: readonly ExecutionProofSection[];
  /** Optional references to related proofs. */
  readonly references?: readonly ExecutionProofReference[];
}

// ---------------------------------------------------------------------------
// Hash computation
// ---------------------------------------------------------------------------

function sha256File(filePath: string): Promise<string> {
  return readFile(filePath).then((buf) =>
    createHash("sha256").update(buf).digest("hex"),
  );
}

function sha256Buffer(buf: Uint8Array | string): string {
  return createHash("sha256")
    .update(typeof buf === "string" ? Buffer.from(buf, "utf8") : buf)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Build functions
// ---------------------------------------------------------------------------

export interface ProofChainInputs {
  readonly manifestPath: string;
  readonly auditPath: string;
  readonly evidencePath: string;
  readonly denialPath: string;
  readonly artefactPath: string;
}

/**
 * Build an ExecutionProofV1 by hashing five report files.
 * All five files must exist and be readable.
 */
export async function buildProofChain(
  inputs: ProofChainInputs,
): Promise<ExecutionProofV1> {
  const [manifestSha256, auditSha256, evidenceSha256, denialSha256, artefactSha256] =
    await Promise.all([
      sha256File(inputs.manifestPath),
      sha256File(inputs.auditPath),
      sha256File(inputs.evidencePath),
      sha256File(inputs.denialPath),
      sha256File(inputs.artefactPath),
    ]);

  return {
    schemaVersion: "spore.execution.proof.v1",
    proofId: randomUUID(),
    generatedAt: new Date().toISOString(),
    hashes: {
      manifestSha256,
      auditSha256,
      evidenceSha256,
      denialSha256,
      artefactSha256,
    },
  };
}

/**
 * Build an ExecutionProofV1 from in-memory buffers (useful for testing
 * or when files are not yet written to disk).
 */
export function buildProofChainFromBuffers(inputs: {
  readonly manifest: Uint8Array | string;
  readonly audit: Uint8Array | string;
  readonly evidence: Uint8Array | string;
  readonly denial: Uint8Array | string;
  readonly artefact: Uint8Array | string;
}): ExecutionProofV1 {
  return {
    schemaVersion: "spore.execution.proof.v1",
    proofId: randomUUID(),
    generatedAt: new Date().toISOString(),
    hashes: {
      manifestSha256: sha256Buffer(inputs.manifest),
      auditSha256: sha256Buffer(inputs.audit),
      evidenceSha256: sha256Buffer(inputs.evidence),
      denialSha256: sha256Buffer(inputs.denial),
      artefactSha256: sha256Buffer(inputs.artefact),
    },
  };
}

// ---------------------------------------------------------------------------
// Upgrade path v1 → v2
// ---------------------------------------------------------------------------

/**
 * Upgrade an ExecutionProofV1 to ExecutionProofV2.
 * The original hashes are retained; each is also surfaced as a named section
 * so consumers can enumerate proof material without knowing the v1 field names.
 */
export function upgradeExecutionProofV1ToV2(proof: ExecutionProofV1): ExecutionProofV2 {
  return {
    schemaVersion: "spore.execution.proof.v2",
    proofId: proof.proofId,
    generatedAt: proof.generatedAt,
    hashes: proof.hashes,
    sections: [
      { name: "manifest",  algorithm: "sha256", hash: proof.hashes.manifestSha256,  path: "build/reports/runtime-manifest.json"    },
      { name: "audit",     algorithm: "sha256", hash: proof.hashes.auditSha256,     path: "build/reports/runtime-audit.jsonl"       },
      { name: "evidence",  algorithm: "sha256", hash: proof.hashes.evidenceSha256,  path: "build/reports/evidence-report.json"      },
      { name: "denial",    algorithm: "sha256", hash: proof.hashes.denialSha256,    path: "build/reports/denial-report.json"        },
      { name: "artefact",  algorithm: "sha256", hash: proof.hashes.artefactSha256,  path: "build/reports/artefact.json"             },
    ],
  };
}

/**
 * Validate that all five hashes are present and non-empty.
 */
export function validateProofChain(proof: ExecutionProofV1): boolean {
  const { manifestSha256, auditSha256, evidenceSha256, denialSha256, artefactSha256 } =
    proof.hashes;
  return (
    manifestSha256.length > 0 &&
    auditSha256.length > 0 &&
    evidenceSha256.length > 0 &&
    denialSha256.length > 0 &&
    artefactSha256.length > 0
  );
}

// =============================================================================
// LogicN Phase 10A — Signed Attestation
//
// Produces a tamper-evident signed artifact that proves:
// "This audit proof came from this exact source, contract, compiler,
//  target plan, and runtime."
//
// Stage 1: Ed25519 signing via node:crypto
// Stage 2 (planned): ML-DSA (FIPS 204), SLH-DSA (FIPS 205)
// =============================================================================

import { createHash, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface LogicNAttestation {
  readonly artifact: "logicn.audit.attestation";
  readonly schemaVersion: "1.0";
  readonly flow: string;
  readonly timestamp: string;
  readonly hashes: {
    readonly source?: string;           // sha256:hex of .lln source
    readonly gir?: string;              // sha256:hex of GIR JSON
    readonly contract?: string;         // sha256:hex of contract block source
    readonly runtimeReport?: string;    // sha256:hex of runtime report
    readonly auditProof?: string;       // sha256:hex of existing proof chain
    readonly executionPlan?: string;    // sha256:hex of PassiveExecutionPlan (Phase 15)
  };
  readonly signature?: {
    readonly algorithm: "Ed25519" | "Ed25519+ML-DSA-65";
    readonly keyId: string;
    readonly value: string;             // base64 signature; hybrid = "<ed25519-b64>|<ml-dsa-65-b64>"
  };
}

export interface AttestationInputs {
  readonly flowName: string;
  readonly sourceText?: string;
  readonly girJson?: string;
  readonly contractSource?: string;
  readonly runtimeReportJson?: string;
  readonly auditProofJson?: string;
  /** Phase 15: planHash string from PassiveExecutionPlan (plain hex, no sha256: prefix). */
  readonly executionPlanHash?: string;
}

export interface AttestationKeyPair {
  readonly keyId: string;
  readonly privateKey: string;   // PEM
  readonly publicKey: string;    // PEM
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** SHA-256 hash a string and return "sha256:<hexdigest>". */
function sha256hex(text: string): string {
  const hash = createHash("sha256").update(text, "utf8").digest("hex");
  return `sha256:${hash}`;
}

/**
 * Produce a canonical JSON string for an object (sorted keys).
 */
function canonicalJson(obj: object): string {
  return JSON.stringify(obj, sortKeysReplacer);
}

function sortKeysReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

// ---------------------------------------------------------------------------
// buildAttestation
// ---------------------------------------------------------------------------

/**
 * Build a LogicNAttestation from the provided inputs.
 * Each non-undefined field is SHA-256 hashed.
 * The returned attestation has no signature — call signAttestation() separately.
 */
export async function buildAttestation(
  inputs: AttestationInputs,
): Promise<LogicNAttestation> {
  const hashes: {
    source?: string;
    gir?: string;
    contract?: string;
    runtimeReport?: string;
    auditProof?: string;
    executionPlan?: string;
  } = {};

  if (inputs.sourceText !== undefined) {
    hashes.source = sha256hex(inputs.sourceText);
  }
  if (inputs.girJson !== undefined) {
    hashes.gir = sha256hex(inputs.girJson);
  }
  if (inputs.contractSource !== undefined) {
    hashes.contract = sha256hex(inputs.contractSource);
  }
  if (inputs.runtimeReportJson !== undefined) {
    hashes.runtimeReport = sha256hex(inputs.runtimeReportJson);
  }
  if (inputs.auditProofJson !== undefined) {
    hashes.auditProof = sha256hex(inputs.auditProofJson);
  }
  if (inputs.executionPlanHash !== undefined) {
    // planHash is already a raw hex digest; prefix it consistently
    hashes.executionPlan = `sha256:${inputs.executionPlanHash}`;
  }

  return {
    artifact: "logicn.audit.attestation",
    schemaVersion: "1.0",
    flow: inputs.flowName,
    timestamp: new Date().toISOString(),
    hashes,
  };
}

// ---------------------------------------------------------------------------
// signAttestation
// ---------------------------------------------------------------------------

/**
 * Sign an attestation using Ed25519 (via node:crypto).
 * The canonical JSON of the attestation WITHOUT the signature field is signed.
 * Returns a new attestation with the signature field populated.
 */
export function signAttestation(
  attestation: LogicNAttestation,
  keyPair: AttestationKeyPair,
): LogicNAttestation {
  // Build the object to sign: all fields except signature
  const { signature: _sig, ...withoutSig } = attestation;
  void _sig;
  const canonical = canonicalJson(withoutSig);

  try {
    const sigBuffer = cryptoSign(
      null,
      Buffer.from(canonical) as unknown as BufferSource,
      { key: keyPair.privateKey, dsaEncoding: "ieee-p1363" },
    );
    const sigValue = Buffer.from(sigBuffer).toString("base64");

    return {
      ...attestation,
      signature: {
        algorithm: "Ed25519",
        keyId: keyPair.keyId,
        value: sigValue,
      },
    };
  } catch (err) {
    throw new Error(
      `signAttestation: signing failed — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// verifyAttestation
// ---------------------------------------------------------------------------

/**
 * Verify a signed attestation against the provided public key.
 * Returns true if the signature is valid, false otherwise.
 */
export function verifyAttestation(
  attestation: LogicNAttestation,
  publicKey: string,
): boolean {
  if (attestation.signature === undefined) {
    return false;
  }

  const { signature, ...withoutSig } = attestation;
  const canonical = canonicalJson(withoutSig);

  try {
    return cryptoVerify(
      null,
      Buffer.from(canonical) as unknown as BufferSource,
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature.value, "base64") as unknown as BufferSource,
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// generateAttestationKey
// ---------------------------------------------------------------------------

/**
 * Generate a new Ed25519 key pair for use with signAttestation / verifyAttestation.
 */
export function generateAttestationKey(keyId: string): AttestationKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { keyId, privateKey, publicKey };
}

// ---------------------------------------------------------------------------
// Stage 2 — hybrid Ed25519 + ML-DSA-65 attestation (#34)
//
// The audit attestation's PQ upgrade: sign the SAME canonical pre-image with BOTH
// Ed25519 (node:crypto) and ML-DSA-65 (FIPS 204, @noble/post-quantum), encode both in
// signature.value as "<ed25519-b64>|<ml-dsa-65-b64>", algorithm "Ed25519+ML-DSA-65".
// Verification requires BOTH (logical AND) — secure if either primitive survives. The
// ML-DSA signature is bound to a FIPS-204 domain-separation context so this key cannot be
// cross-protocol-confused with the ProofGraph / bridge-manifest signing surfaces.
// ---------------------------------------------------------------------------

/** FIPS-204 domain-separation context for the audit attestation surface. */
const AUDIT_MLDSA_CONTEXT = new TextEncoder().encode("logicn.audit.attestation.v1");

export interface HybridAttestationKeyPair {
  readonly keyId: string;
  readonly privateKey: string;        // Ed25519 PEM (PKCS8)
  readonly publicKey: string;         // Ed25519 PEM (SPKI)
  readonly mlDsaPrivateKey: Uint8Array;
  readonly mlDsaPublicKey: Uint8Array;
}

/** Generate a hybrid Ed25519 + ML-DSA-65 attestation key pair. */
export async function generateHybridAttestationKey(keyId: string): Promise<HybridAttestationKeyPair> {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const { ml_dsa65 } = await import("@noble/post-quantum/ml-dsa.js") as {
    ml_dsa65: { keygen(seed: Uint8Array): { publicKey: Uint8Array; secretKey: Uint8Array } };
  };
  const seed = new Uint8Array(32);
  (globalThis.crypto as { getRandomValues(b: Uint8Array): Uint8Array }).getRandomValues(seed);
  const ml = ml_dsa65.keygen(seed);
  return { keyId, privateKey, publicKey, mlDsaPrivateKey: ml.secretKey, mlDsaPublicKey: ml.publicKey };
}

/**
 * Sign an attestation with a hybrid Ed25519 + ML-DSA-65 key. The canonical JSON of the
 * attestation WITHOUT the signature field is the pre-image for BOTH signatures.
 */
export async function signAttestationHybrid(
  attestation: LogicNAttestation,
  keyPair: HybridAttestationKeyPair,
): Promise<LogicNAttestation> {
  const { signature: _sig, ...withoutSig } = attestation;
  void _sig;
  const canonical = canonicalJson(withoutSig);
  const msg = Buffer.from(canonical, "utf8");

  const edSig = cryptoSign(null, msg as unknown as BufferSource, {
    key: keyPair.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  const { ml_dsa65 } = await import("@noble/post-quantum/ml-dsa.js") as {
    ml_dsa65: { sign(m: Uint8Array, sk: Uint8Array, opts?: { context?: Uint8Array }): Uint8Array };
  };
  const mlSig = ml_dsa65.sign(msg, keyPair.mlDsaPrivateKey, { context: AUDIT_MLDSA_CONTEXT });

  const value = `${Buffer.from(edSig).toString("base64")}|${Buffer.from(mlSig).toString("base64")}`;
  return {
    ...attestation,
    signature: { algorithm: "Ed25519+ML-DSA-65", keyId: keyPair.keyId, value },
  };
}

/**
 * Verify a hybrid attestation. BOTH the Ed25519 and the ML-DSA-65 signatures must verify
 * (logical AND) — no silent downgrade. Returns false on any missing/extra/invalid part.
 */
export async function verifyAttestationHybrid(
  attestation: LogicNAttestation,
  ed25519PublicKeyPem: string,
  mlDsaPublicKey: Uint8Array,
): Promise<boolean> {
  const sig = attestation.signature;
  if (sig === undefined || sig.algorithm !== "Ed25519+ML-DSA-65") return false;
  const parts = sig.value.split("|");
  if (parts.length !== 2) return false;
  const [edB64, mlB64] = parts;
  if (!edB64 || !mlB64) return false;

  const { signature: _sig, ...withoutSig } = attestation;
  void _sig;
  const canonical = canonicalJson(withoutSig);
  const msg = Buffer.from(canonical, "utf8");

  try {
    const edOk = cryptoVerify(
      null,
      msg as unknown as BufferSource,
      { key: ed25519PublicKeyPem, dsaEncoding: "ieee-p1363" },
      Buffer.from(edB64, "base64") as unknown as BufferSource,
    );
    if (!edOk) return false;
    const { ml_dsa65 } = await import("@noble/post-quantum/ml-dsa.js") as {
      ml_dsa65: { verify(s: Uint8Array, m: Uint8Array, pk: Uint8Array, opts?: { context?: Uint8Array }): boolean };
    };
    return ml_dsa65.verify(Buffer.from(mlB64, "base64"), msg, mlDsaPublicKey, { context: AUDIT_MLDSA_CONTEXT });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// attestationToYaml
// ---------------------------------------------------------------------------

/**
 * Serialize a LogicNAttestation to YAML format (manual, no external lib).
 */
export function attestationToYaml(attestation: LogicNAttestation): string {
  const lines: string[] = [];
  lines.push(`artifact: ${attestation.artifact}`);
  lines.push(`schemaVersion: "${attestation.schemaVersion}"`);
  lines.push(`flow: ${attestation.flow}`);
  lines.push(`timestamp: ${attestation.timestamp}`);
  lines.push("hashes:");

  const h = attestation.hashes;
  if (h.source !== undefined)         lines.push(`  source: ${h.source}`);
  if (h.gir !== undefined)            lines.push(`  gir: ${h.gir}`);
  if (h.contract !== undefined)       lines.push(`  contract: ${h.contract}`);
  if (h.runtimeReport !== undefined)  lines.push(`  runtimeReport: ${h.runtimeReport}`);
  if (h.auditProof !== undefined)     lines.push(`  auditProof: ${h.auditProof}`);
  if (h.executionPlan !== undefined)  lines.push(`  executionPlan: ${h.executionPlan}`);

  if (Object.keys(h).length === 0) {
    lines.push("  {}");
  }

  if (attestation.signature !== undefined) {
    lines.push("signature:");
    lines.push(`  algorithm: ${attestation.signature.algorithm}`);
    lines.push(`  keyId: ${attestation.signature.keyId}`);
    lines.push(`  value: ${attestation.signature.value}`);
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// attestationFromJson
// ---------------------------------------------------------------------------

/**
 * Parse a JSON string into a LogicNAttestation.
 * Validates that artifact and schemaVersion fields are correct.
 */
export function attestationFromJson(json: string): LogicNAttestation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`attestationFromJson: invalid JSON — ${err instanceof Error ? err.message : String(err)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("attestationFromJson: expected an object");
  }

  const obj = parsed as Record<string, unknown>;

  if (obj["artifact"] !== "logicn.audit.attestation") {
    throw new Error(
      `attestationFromJson: invalid artifact field "${String(obj["artifact"])}", expected "logicn.audit.attestation"`,
    );
  }

  if (obj["schemaVersion"] !== "1.0") {
    throw new Error(
      `attestationFromJson: unsupported schemaVersion "${String(obj["schemaVersion"])}", expected "1.0"`,
    );
  }

  return obj as unknown as LogicNAttestation;
}

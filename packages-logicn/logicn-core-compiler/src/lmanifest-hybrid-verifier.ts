// lmanifest-hybrid-verifier.ts — the #49 PRODUCTION hybrid (Ed25519+ML-DSA-65) verifier for the fuse loader.
//
// The app-kernel fuse loader exposes an INJECTED `hybridVerifier` seam (it stays PQ-crypto-free). This factory
// builds the verifier the LogicN CLI injects: it REUSES the compiler's single-source-of-truth helpers
// (`makeManifestEnvelope` + `verifyGovernanceSignatureHybrid`) so it cannot drift from the signer — never a
// reimplemented context/encoding (RD-0119: the .lmanifest v2 signature is over the ProofGraph governance
// envelope under context "logicn.proofgraph.governance.v1", base64url|base64url; using the bridge context or
// re-deriving the payload would silently break ALL verification).
//
// Verdict (the loader maps these): "verified" ⇒ admit; "invalid" ⇒ the loader THROWS (tamper); a THROWN error
// ⇒ the loader THROWS (a hard fail-closed deny). Fail-CLOSED throughout, with NO post-quantum downgrade: a v2
// (hybrid) manifest whose ML-DSA public key is absent/malformed is a hard DENY (throw), never treated as merely
// "unverifiable"/unsigned (RD-0119 (a)#6 / the H5 attack-6 + requireHybrid discipline).

import { createHash, createPublicKey } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeManifestEnvelope, verifyGovernanceSignatureHybrid, type ProofGraph } from "./proof-graph.js";

/** FIPS-204 ML-DSA-65 (NIST cat-3) raw public-key length, in bytes. */
const ML_DSA_65_PUBKEY_BYTES = 1952;

export type LmanifestHybridVerdict = "verified" | "invalid" | "unverifiable";

export interface LmanifestHybridVerifierInput {
  readonly keyId: string;
  readonly algorithm: string;
  /** The RFC-8785 canonical manifest body the loader reconstructed (the v2 sig is over the envelope of its sha256). */
  readonly signingInput: Uint8Array;
  /** The combined `<ed-b64url>|<mldsa-b64url>` signature string. */
  readonly signature: string;
  readonly governanceDir: string | undefined;
  readonly packageDir: string;
}

/** Resolve `<fileName>` in the governance dir, then walking up from the package dir's `governance/` (mirrors the loader). */
function resolveGovernanceFile(fileName: string, governanceDir: string | undefined, packageDir: string): string | undefined {
  const candidates: string[] = [];
  if (governanceDir !== undefined) candidates.push(join(governanceDir, fileName));
  let dir = packageDir;
  for (let i = 0; i < 6; i++) {
    candidates.push(join(dir, "governance", fileName));
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  for (const c of candidates) if (existsSync(c)) return c;
  return undefined;
}

/**
 * Build the production `.lmanifest` hybrid verifier for the fuse loader's `hybridVerifier` injection seam.
 * Resolves the hybrid key pair by the manifest's signerKeyId — `signing-key-<keyId>.pub.pem` (Ed25519 SPKI/PEM)
 * + `signing-key-<keyId>.mldsa.pub.b64` (raw ML-DSA-65, base64) — and verifies BOTH halves via the shipped
 * `verifyGovernanceSignatureHybrid` over the `makeManifestEnvelope` of sha256(signingInput).
 */
export function makeLmanifestHybridVerifier(): (input: LmanifestHybridVerifierInput) => Promise<LmanifestHybridVerdict> {
  return async (input: LmanifestHybridVerifierInput): Promise<LmanifestHybridVerdict> => {
    const { keyId, signingInput, signature, governanceDir, packageDir } = input;

    const edPath = resolveGovernanceFile(`signing-key-${keyId}.pub.pem`, governanceDir, packageDir);
    if (edPath === undefined) {
      // No public key at all for this signer ⇒ we cannot decide; treat as unsigned (the loader refuses it
      // under requireSignature). This is the classical no-pubkey case, not a present-but-unusable PQ key.
      return "unverifiable";
    }
    const mlPath = resolveGovernanceFile(`signing-key-${keyId}.mldsa.pub.b64`, governanceDir, packageDir);
    if (mlPath === undefined) {
      // NO PQ DOWNGRADE: a v2 hybrid manifest with a missing ML-DSA public key must be a HARD deny, never
      // silently weakened to Ed25519-only / unsigned. Throw ⇒ the loader fails closed.
      throw new Error(`LLN-FUSE-HYBRID-PQ-KEY-MISSING: hybrid manifest for keyId '${keyId}' but 'signing-key-${keyId}.mldsa.pub.b64' is absent — refusing (no PQ downgrade)`);
    }

    const mlRaw = new Uint8Array(Buffer.from(readFileSync(mlPath, "utf8").trim(), "base64"));
    if (mlRaw.length !== ML_DSA_65_PUBKEY_BYTES) {
      throw new Error(`LLN-FUSE-HYBRID-PQ-KEY-MALFORMED: ML-DSA public key for keyId '${keyId}' is ${mlRaw.length} bytes, expected ${ML_DSA_65_PUBKEY_BYTES}`);
    }
    const edDer = new Uint8Array(
      createPublicKey(readFileSync(edPath, "utf8")).export({ type: "spki", format: "der" }) as unknown as Uint8Array,
    );

    // Rebuild the EXACT envelope the signer bound (single source of truth). generatedAt is EXCLUDED from the
    // signed payload (RD-0119), so any value verifies; bodyHash binds the body.
    const bodyHash = createHash("sha256").update(signingInput).digest("hex");
    const base: ProofGraph = makeManifestEnvelope(bodyHash, "1970-01-01T00:00:00.000Z");
    const envelope: ProofGraph = {
      ...base,
      governanceSignature: { algorithm: "lln.gov.sig.v2", signerKeyId: keyId, signature, signedAt: "" },
    };
    const ok = await verifyGovernanceSignatureHybrid(envelope, edDer, mlRaw);
    return ok ? "verified" : "invalid";
  };
}

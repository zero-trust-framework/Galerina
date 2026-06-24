// inclusion.ts — TMX-256 inclusion (Merkle) proofs, v0.
//
// Selective disclosure / streaming verification: prove ONE section is bound under the signed `.tmf`
// root WITHOUT shipping the whole file. A verifier receives only header_core (24 B), the section's
// leaf_hash, and the sibling digests on the path to the root; it recomputes the root and checks it
// against a TRUSTED root (a pinned root, or the root the ML-DSA-65 signature verifies — that step is
// the caller's, in signature-custody). A proof alone is membership, never authenticity.
//
// Spec (frozen): spec/inclusion-proof-v0.md. Verified byte-for-byte against the published golden root
// 43386e64… (tests/inclusion.test.mjs). Crypto-on-core (LLN-SUBSTRATE-001): bit-exact SHAKE256 over the
// SAME tree shape as tmx256.topNode, fail-closed on any mismatch.
import { ABSENT, ARITY, H, leafHash, nodeHash, rootFromTopNode } from "./tmx256.js";

const HEADER_CORE_LEN = 24;

/** One level of the path: the target's position in its triple, and the two sibling digests (ascending). */
export interface InclusionPathEntry {
  readonly pos: number; // 0 | 1 | 2 — the target's index within this triple
  readonly sibA: Uint8Array; // digest at the LOWER non-pos position
  readonly sibB: Uint8Array; // digest at the HIGHER non-pos position
}

export interface InclusionProof {
  readonly version: number; // 0
  readonly tmxProfile: number; // 0 (SHAKE256)
  readonly leafIndex: number; // informational; security rests on root-match
  readonly leafCount: number; // total sections n
  readonly headerCore: Uint8Array; // 24 B, bound at the root
  readonly leafHash: Uint8Array; // 32 B, the target section's leaf digest
  readonly path: readonly InclusionPathEntry[];
}

// ── prover ──────────────────────────────────────────────────────────────────────────────────────
/**
 * Extract the inclusion path for `targetIndex` over the SAME 3-ary tree as tmx256.topNode (groups of
 * 3, short final triples padded with ABSENT, always ≥ 1 level). Fail-closed on bad inputs.
 */
export function proveInclusion(
  headerCore: Uint8Array,
  leafDigests: readonly Uint8Array[],
  targetIndex: number,
): InclusionProof {
  if (leafDigests.length === 0) throw new Error("TMX-inclusion: at least one leaf is required");
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= leafDigests.length)
    throw new Error(`TMX-inclusion: targetIndex ${targetIndex} out of range [0,${leafDigests.length})`);
  if (headerCore.length !== HEADER_CORE_LEN) throw new Error(`TMX-inclusion: header_core must be ${HEADER_CORE_LEN} bytes`);
  for (const d of leafDigests) if (d.length !== H) throw new Error("TMX-inclusion: every leaf digest must be 32 bytes");

  const leafHashD = leafDigests[targetIndex]!;
  let level: Uint8Array[] = leafDigests.slice();
  let idx = targetIndex;
  const path: InclusionPathEntry[] = [];

  do {
    // record this level's path entry for the current idx
    const base = Math.floor(idx / ARITY) * ARITY;
    const pos = idx - base;
    const triple = [level[base]!, level[base + 1] ?? ABSENT, level[base + 2] ?? ABSENT];
    const sibs: Uint8Array[] = [];
    for (let p = 0; p < ARITY; p++) if (p !== pos) sibs.push(triple[p]!);
    path.push({ pos, sibA: sibs[0]!, sibB: sibs[1]! });
    // reduce one level (identical to tmx256.topNode) and ascend
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += ARITY) next.push(nodeHash(level[i]!, level[i + 1] ?? ABSENT, level[i + 2] ?? ABSENT));
    level = next;
    idx = Math.floor(idx / ARITY);
  } while (level.length > 1);

  return {
    version: 0,
    tmxProfile: 0,
    leafIndex: targetIndex,
    leafCount: leafDigests.length,
    headerCore: headerCore.slice(),
    leafHash: leafHashD.slice(),
    path,
  };
}

// ── verifier (fail-closed) ──────────────────────────────────────────────────────────────────────
/** Fold a proof's path to its reconstructed root, or null if the proof is malformed (fail-closed). */
export function reconstructRoot(proof: InclusionProof): Uint8Array | null {
  if (proof.version !== 0 || proof.tmxProfile !== 0) return null;
  if (proof.headerCore.length !== HEADER_CORE_LEN || proof.leafHash.length !== H) return null;
  let cur = proof.leafHash;
  for (const e of proof.path) {
    if (e.pos < 0 || e.pos > 2 || e.sibA.length !== H || e.sibB.length !== H) return null;
    const triple: (Uint8Array | null)[] = [null, null, null];
    triple[e.pos] = cur;
    const sibs = [e.sibA, e.sibB];
    let s = 0;
    for (let p = 0; p < ARITY; p++) if (triple[p] === null) triple[p] = sibs[s++]!;
    cur = nodeHash(triple[0]!, triple[1]!, triple[2]!);
  }
  return rootFromTopNode(proof.headerCore, cur);
}

/** Constant-time equality for two digests. */
function ctEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * Verify a section's membership in a TRUSTED root (a pinned root, or the root whose ML-DSA-65 signature
 * the caller has already verified). Fail-closed: returns false on any malformed proof or root mismatch.
 * A proof is membership only relative to a trusted root — without `trustedRoot` this cannot be meaningful,
 * so an empty/mismatched root fails closed.
 */
export function verifyInclusion(proof: InclusionProof, trustedRoot: Uint8Array): boolean {
  if (trustedRoot.length !== H) return false;
  const r = reconstructRoot(proof);
  return r !== null && ctEqual(r, trustedRoot);
}

/** Optional: confirm the proof's leaf_hash actually covers the supplied section data. */
export function verifyLeafData(proof: InclusionProof, kind: number, modality: number, coord: Uint8Array, payload: Uint8Array): boolean {
  return ctEqual(proof.leafHash, leafHash(kind, modality, coord, payload));
}

// ── wire format (byte-precise, spec §2; all integers little-endian) ───────────────────────────────
/** 68 + 65·path_len bytes. */
export function serializeProof(proof: InclusionProof): Uint8Array {
  const pathLen = proof.path.length;
  if (pathLen > 0xff) throw new Error("TMX-inclusion: path too deep to serialize (path_len > 255)");
  const out = new Uint8Array(68 + 65 * pathLen);
  const dv = new DataView(out.buffer);
  out[0] = proof.version & 0xff;
  dv.setUint16(1, proof.tmxProfile & 0xffff, true);
  dv.setUint32(3, proof.leafIndex >>> 0, true);
  dv.setUint32(7, proof.leafCount >>> 0, true);
  out[11] = pathLen & 0xff;
  out.set(proof.headerCore, 12);
  out.set(proof.leafHash, 36);
  let o = 68;
  for (const e of proof.path) {
    out[o] = e.pos & 0xff;
    out.set(e.sibA, o + 1);
    out.set(e.sibB, o + 33);
    o += 65;
  }
  return out;
}

/** Parse a wire proof, or throw (fail-closed) on any malformed length/field. */
export function deserializeProof(bytes: Uint8Array): InclusionProof {
  if (bytes.length < 68) throw new Error("TMX-inclusion: proof too short");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[0]!;
  const tmxProfile = dv.getUint16(1, true);
  const leafIndex = dv.getUint32(3, true);
  const leafCount = dv.getUint32(7, true);
  const pathLen = bytes[11]!;
  if (bytes.length !== 68 + 65 * pathLen) throw new Error(`TMX-inclusion: proof length ${bytes.length} != 68 + 65·${pathLen}`);
  const headerCore = bytes.slice(12, 36);
  const leafHashD = bytes.slice(36, 68);
  const path: InclusionPathEntry[] = [];
  let o = 68;
  for (let i = 0; i < pathLen; i++) {
    const pos = bytes[o]!;
    if (pos > 2) throw new Error(`TMX-inclusion: path entry ${i} has invalid pos ${pos}`);
    path.push({ pos, sibA: bytes.slice(o + 1, o + 33), sibB: bytes.slice(o + 33, o + 65) });
    o += 65;
  }
  return { version, tmxProfile, leafIndex, leafCount, headerCore, leafHash: leafHashD, path };
}

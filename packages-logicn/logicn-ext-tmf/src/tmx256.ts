// tmx256.ts — TMX-256 (TriMerkle-XOF) integrity core, v0 (TMX-256-SHAKE profile).
//
// A 3-ary Merkle tree over coordinate-bound leaves; every node is a SHAKE256 XOF digest,
// and the root binds the container header_core. Crypto-on-core: bit-exact, deterministic,
// runs on a CPU via FIPS-202 SHAKE256 (node:crypto) — no photonic/ternary hardware, no
// performance claim (LLN-SUBSTRATE-001).
//
// Spec (frozen): LogicN-R-AND-D/tmf/spec/tmx-256-construction-v0.md. This implementation is
// verified byte-for-byte against that spec's golden vectors (tests/tmx256.test.mjs), i.e. it
// is cross-language-conformant with the Python stdlib reference generator.
//
// TMX-256 is a HASH (integrity / content-addressing / Merkle proofs). Authenticity is the
// ML-DSA-65 signature OVER the root — sign over the hash, never replace the hash — wired
// separately (#7). Readers MUST fail closed on any mismatch.
import { createHash } from "node:crypto";

/** Digest length in bytes (256-bit). */
export const H = 32;
/** Ternary Merkle fan-in. */
export const ARITY = 3;

const enc = new TextEncoder();

/** FIPS-202 SHAKE256, squeezed to `outLen` bytes (default 32). */
function shake256(msg: Uint8Array, outLen: number = H): Uint8Array {
  return new Uint8Array(createHash("shake256", { outputLength: outLen }).update(msg).digest());
}

function le16(x: number): Uint8Array { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, x & 0xffff, true); return b; }
function le32(x: number): Uint8Array { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, x >>> 0, true); return b; }

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Length-prefixed bytes: LE32(len) ∥ b — makes concatenation injective (domain separation). */
function lp(b: Uint8Array): Uint8Array { return concat([le32(b.length), b]); }

const TAG_ABSENT = enc.encode("TMX-ABSENT-v0");
const TAG_LEAF = enc.encode("TMX-LEAF-v0");
const TAG_NODE = enc.encode("TMX-NODE-v0");
const TAG_ROOT = enc.encode("TMX-ROOT-v0");

/** §3 fixed, public "nothing-up-my-sleeve" sentinel that pads short final triples. */
export const ABSENT: Uint8Array = shake256(lp(TAG_ABSENT));

/**
 * §2 leaf hash — binds (kind, modality, coord, payload). Position-bound: a valid leaf cannot
 * be lifted from one (coord, modality, kind) and replanted at another without changing the
 * hash (and thus breaking the root). `coord` is opaque length-prefixed bytes (any TVCID encoding).
 */
export function leafHash(kind: number, modality: number, coord: Uint8Array, payload: Uint8Array): Uint8Array {
  return shake256(concat([lp(TAG_LEAF), le16(kind), le16(modality), lp(coord), lp(payload)]));
}

/** §3 internal 3-ary node over three fixed 32-byte child digests (no inter-child length prefix). */
export function nodeHash(c0: Uint8Array, c1: Uint8Array, c2: Uint8Array): Uint8Array {
  return shake256(concat([lp(TAG_NODE), c0, c1, c2]));
}

/**
 * §4 deterministic tree shape for any n ≥ 1. Reduces in groups of 3, padding short final
 * triples with ABSENT, until one node remains. ALWAYS reduces at least once — a single leaf
 * becomes NODE(L0, ABSENT, ABSENT) — so top_node is always a NODE-domain digest (a raw leaf
 * can never be reinterpreted as an interior node). Section order is bound into the result.
 */
export function topNode(leafDigests: readonly Uint8Array[]): Uint8Array {
  if (leafDigests.length === 0) throw new Error("TMX-256: at least one leaf is required");
  let level: Uint8Array[] = leafDigests.slice();
  do {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += ARITY) {
      next.push(nodeHash(level[i]!, level[i + 1] ?? ABSENT, level[i + 2] ?? ABSENT));
    }
    level = next;
  } while (level.length > 1);
  return level[0]!;
}

/**
 * §5 root — binds header_core (the container's bytes [0..24): magic/version/profile/flags/
 * section_count) and top_node. It never binds itself (the stored integrity_root is excluded
 * from header_core), avoiding the circular-header bug. A logical content fingerprint: layout
 * (byte offsets) is deliberately NOT bound — caught instead when the file is signed.
 */
export function tmxRoot(headerCore: Uint8Array, leafDigests: readonly Uint8Array[]): Uint8Array {
  return rootFromTopNode(headerCore, topNode(leafDigests));
}

/**
 * §5 root from a precomputed top_node — the same SHAKE256(LP(TMX-ROOT) ∥ LP(header_core) ∥ top_node)
 * as `tmxRoot`, exposed so an inclusion proof (inclusion.ts) folds the path to a top_node and reuses
 * the ONE canonical root computation instead of duplicating it. `tmxRoot` delegates here.
 */
export function rootFromTopNode(headerCore: Uint8Array, top: Uint8Array): Uint8Array {
  return shake256(concat([lp(TAG_ROOT), lp(headerCore), top]));
}

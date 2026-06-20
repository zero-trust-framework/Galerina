// container.ts — .tmf container reader/writer, v0 (byte-precise).
//
// On-disk layout: HEADER(56) ∥ SECTION TABLE(count×56) ∥ PAYLOAD REGION ∥ [SIGNATURE BLOCK].
// header_core = bytes[0:24) (magic/version/profile/flags/section_count) is bound into the TMX-256
// root; integrity_root = bytes[24:56) is the root itself (never self-bound). All ints little-endian.
//
// Spec (frozen): LogicN-R-AND-D/tmf/spec/tmf-container-v0.md. Verified byte-for-byte against its
// golden container vector (tests/container.test.mjs) — writeTmf reproduces the exact 203 bytes, and
// the §6 fail-closed reader round-trips + rejects every tamper/bounds case.
import { timingSafeEqual } from "node:crypto";
import { leafHash, tmxRoot } from "./tmx256.js";

export const MAGIC = Uint8Array.from([0x89, 0x54, 0x4d, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
export const HEADER_SIZE = 56;
export const HEADER_CORE_SIZE = 24;
export const ENTRY_SIZE = 56;
export const TMX_PROFILE_SHAKE = 0;

export type TmfErrorCode =
  | "BadMagic" | "UnsupportedVersion" | "UnknownProfile" | "MalformedTable" | "IntegrityError" | "AuthError";

/** Typed, fail-closed container error (§7 taxonomy). */
export class TmfError extends Error {
  readonly code: TmfErrorCode;
  constructor(code: TmfErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = "TmfError";
  }
}

export interface TmfSection {
  readonly kind: number;
  readonly modality: number;
  readonly coord: Uint8Array;
  readonly payload: Uint8Array;
}

export interface TmfReadResult {
  readonly versionMajor: number;
  readonly versionMinor: number;
  readonly profile: number;
  readonly flags: number;
  readonly integrityRoot: Uint8Array;
  readonly sections: ReadonlyArray<TmfSection & { readonly leafHash: Uint8Array }>;
}

function wU16(v: number): Uint8Array { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v & 0xffff, true); return b; }
function wU32(v: number): Uint8Array { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return b; }
function wU64(v: number | bigint): Uint8Array { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v), true); return b; }

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let n = 0; for (const p of parts) n += p.length;
  const o = new Uint8Array(n); let k = 0;
  for (const p of parts) { o.set(p, k); k += p.length; }
  return o;
}

/** Constant-time digest comparison. 0033(c): routed through the VETTED `crypto.timingSafeEqual` (C++,
 *  guaranteed constant-time, immune to JIT de-opt) instead of a hand-rolled XOR loop — matching
 *  `kemdem.ts`. Used for integrity-root / leaf-hash verification (timing-sensitive) and the non-secret
 *  magic check. `timingSafeEqual` throws on unequal lengths, so the length pre-check (lengths are
 *  public for fixed-size digests) gates it. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The 24-byte header_core that the root binds (magic ∥ ver_major ∥ ver_minor ∥ profile ∥ flags ∥ count). */
export function headerCore(profile: number, flags: number, sectionCount: number | bigint): Uint8Array {
  return concat([MAGIC, wU16(0), wU16(0), wU16(profile), wU16(flags), wU64(sectionCount)]);
}

/**
 * Write an UNSIGNED v0 .tmf container. Reproduces the spec's golden bytes for the golden input.
 * (flags.signed stays 0 — real signing is slice 4 / #7; v0 never writes a fake signature.)
 */
export function writeTmf(sections: readonly TmfSection[]): Uint8Array {
  if (sections.length === 0) throw new TmfError("MalformedTable", "a .tmf must have at least one section (TMX requires ≥1 leaf)");
  const leaves: Uint8Array[] = [];
  const entries: Uint8Array[] = [];
  const region: Uint8Array[] = [];
  let blobOff = 0;
  for (const s of sections) {
    const leaf = leafHash(s.kind, s.modality, s.coord, s.payload);
    leaves.push(leaf);
    const blobLen = s.coord.length + s.payload.length;
    entries.push(concat([wU16(s.kind), wU16(s.modality), wU32(s.coord.length), wU64(blobOff), wU64(blobLen), leaf]));
    region.push(s.coord, s.payload);
    blobOff += blobLen;
  }
  const hc = headerCore(TMX_PROFILE_SHAKE, 0, sections.length);
  const root = tmxRoot(hc, leaves);
  return concat([hc, root, ...entries, ...region]);
}

/**
 * §6 fail-closed reader. Order: magic → version → profile → reserved-flag → §2b bounds (BEFORE any
 * hashing) → per-leaf recompute → root recompute → signed-reject. Any failure throws a typed TmfError;
 * never a partial accept, never a silent downgrade of a signed file.
 */
export function readTmf(buf: Uint8Array): TmfReadResult {
  const len = buf.length;
  if (len < HEADER_SIZE) throw new TmfError("MalformedTable", `file shorter than the ${HEADER_SIZE}-byte header`);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  if (!bytesEqual(buf.subarray(0, 8), MAGIC)) throw new TmfError("BadMagic", "magic mismatch");
  const versionMajor = dv.getUint16(8, true);
  const versionMinor = dv.getUint16(10, true);
  if (versionMajor !== 0) throw new TmfError("UnsupportedVersion", `version_major ${versionMajor} unsupported`);
  const profile = dv.getUint16(12, true);
  if (profile !== TMX_PROFILE_SHAKE) throw new TmfError("UnknownProfile", `tmx_profile ${profile} not implemented`);
  const flags = dv.getUint16(14, true);
  if ((flags & ~0x1) !== 0) throw new TmfError("MalformedTable", "reserved flags bits must be 0");
  const signed = (flags & 0x1) === 1;

  // §2b bounds — overflow-safe in BigInt, BEFORE any hashing.
  const countBig = dv.getBigUint64(16, true);
  if (countBig === 0n) throw new TmfError("MalformedTable", "section_count must be ≥ 1");
  const lenBig = BigInt(len);
  const regionOffBig = 56n + countBig * 56n;
  if (regionOffBig > lenBig) throw new TmfError("MalformedTable", "section table extends past EOF");
  const count = Number(countBig);
  const regionOff = Number(regionOffBig);
  const integrityRoot = buf.subarray(24, 56);

  interface Entry { kind: number; modality: number; coordLen: number; blobOff: bigint; blobLen: bigint; leaf: Uint8Array; }
  const parsed: Entry[] = [];
  let payloadRegionLen = 0n;
  for (let i = 0; i < count; i++) {
    const e = 56 + i * 56;
    const coordLen = dv.getUint32(e + 4, true);
    const blobOff = dv.getBigUint64(e + 8, true);
    const blobLen = dv.getBigUint64(e + 16, true);
    if (BigInt(coordLen) > blobLen) throw new TmfError("MalformedTable", `coord_len > blob_len at section ${i}`);
    const end = blobOff + blobLen;
    if (end > payloadRegionLen) payloadRegionLen = end;
    parsed.push({ kind: dv.getUint16(e, true), modality: dv.getUint16(e + 2, true), coordLen, blobOff, blobLen, leaf: buf.subarray(e + 24, e + 56) });
  }
  if (regionOffBig + payloadRegionLen > lenBig) throw new TmfError("MalformedTable", "payload region extends past EOF");
  if (!signed && regionOffBig + payloadRegionLen !== lenBig) throw new TmfError("MalformedTable", "unsigned file has trailing bytes");

  const leaves: Uint8Array[] = [];
  const sections: Array<TmfSection & { leafHash: Uint8Array }> = [];
  for (let i = 0; i < count; i++) {
    const p = parsed[i]!;
    const start = regionOff + Number(p.blobOff);
    const slice = buf.subarray(start, start + Number(p.blobLen));
    const coord = slice.subarray(0, p.coordLen);
    const payload = slice.subarray(p.coordLen);
    if (!bytesEqual(leafHash(p.kind, p.modality, coord, payload), p.leaf)) {
      throw new TmfError("IntegrityError", `leaf mismatch at section ${i}`);
    }
    leaves.push(p.leaf);
    sections.push({ kind: p.kind, modality: p.modality, coord, payload, leafHash: p.leaf });
  }

  if (!bytesEqual(tmxRoot(buf.subarray(0, 24), leaves), integrityRoot)) {
    throw new TmfError("IntegrityError", "integrity_root mismatch");
  }
  if (signed) {
    // §6 step 5: a reader with no vetted FIPS-204/Ed25519 verifier MUST reject every signed file —
    // never silently downgrade to unsigned. Real verification arrives in slice 4 (#7).
    throw new TmfError("AuthError", "signed .tmf rejected: no vetted signature verifier wired in v0 (no silent downgrade)");
  }
  return { versionMajor, versionMinor, profile, flags, integrityRoot, sections };
}

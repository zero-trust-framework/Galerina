// kemdem.ts — .tmf confidentiality layer (KEM-DEM), v0 (slice 3). Spec (frozen): spec/tmf-encryption-v0.md.
//
// Two halves, by design:
//   1. DETERMINISTIC key schedule / AAD / STREAM nonces / CTX commit — pure SHAKE256 byte-math (node:crypto),
//      verified BYTE-FOR-BYTE against the frozen golden vectors (gen_tmf_encryption.py / gen_cmt_ctx.py).
//      This half is the cross-language conformance contract and has NO @noble dependency.
//   2. REAL KEM/AEAD seal+open — hybrid X25519+ML-KEM-768 → SHAKE256 KDF → AES-256-GCM, with the §4
//      committing-AAD and the §8.5 CTX (CMT-4) committing tag. Verified by round-trip + tamper (no fixed
//      golden, since KEM/AEAD carry randomness). @noble is borrowed from the compiler's node_modules (no local
//      install — same pattern as the crypto-ops bench); @noble's own bare imports resolve from there.
//
// Crypto-on-core (LLN-SUBSTRATE-001): every primitive is bit-exact digital. No photonic crypto.
// Verify-before-decrypt (§7): this layer sits UNDER the TMX-256 + signature gate; the caller proves
// integrity+authenticity+ALLOW(+1) before any open(). seal/open here are the confidentiality step only.
//
// Follow-on (not in slice 3): aead_suite 0x03/0x04 (ChaCha/XChaCha) round-trip seal+open and kem_profile
// 0x03/0x04 (L5) — their deterministic goldens (streamNonce24, ctxCommitTag, registries) are already covered here.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ml_kem768 } from "../../logicn-core-compiler/node_modules/@noble/post-quantum/ml-kem.js";
import * as hybrid from "../../logicn-core-compiler/node_modules/@noble/post-quantum/hybrid.js";
import { gcm } from "../../logicn-core-compiler/node_modules/@noble/ciphers/aes.js";

// ── constants / registries (spec §2) ───────────────────────────────────────
export const AEAD_CONTEXT_SIZE = 36;
export const COMMIT_SIZE = 32;
export const KEM_PROFILE = {
  ML_KEM_768: 0x01,
  HYBRID_X25519_ML_KEM_768: 0x02,
} as const;
/** ct_kem byte sizes per kem_profile (§2.1, runtime-measured against @noble). */
export const KEM_CT_SIZE: Record<number, number> = { 0x01: 1088, 0x02: 1120, 0x03: 1568, 0x04: 1665 };
export const AEAD_SUITE = { AES_256_GCM: 0x01, CHACHA20_POLY1305: 0x03, XCHACHA20_POLY1305: 0x04 } as const;
export const DEM_MODE = { SINGLE_SHOT: 0x01, STREAM: 0x02 } as const;
/** conf_flags (§4 offset 29): bit0 encrypted; bits1-2 commit_mode (00 none / 01 CTX); bits3-7 reserved=0. */
export const COMMIT_MODE = { NONE: 0b00, CTX: 0b01 } as const;

export type TmfCryptoCode = "CryptoError" | "MalformedCrypto" | "NoCryptoLib" | "GovDeny";

/** Typed, fail-closed confidentiality error (spec §7.1). */
export class TmfCryptoError extends Error {
  readonly code: TmfCryptoCode;
  constructor(code: TmfCryptoCode, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = "TmfCryptoError";
  }
}

// ── byte helpers ────────────────────────────────────────────────────────────
function shake256(data: Uint8Array, outLen = 32): Uint8Array {
  return new Uint8Array(createHash("shake256", { outputLength: outLen }).update(data).digest());
}
function concat(parts: readonly Uint8Array[]): Uint8Array {
  let n = 0; for (const p of parts) n += p.length;
  const o = new Uint8Array(n); let k = 0;
  for (const p of parts) { o.set(p, k); k += p.length; }
  return o;
}
function u32le(v: number): Uint8Array { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return b; }
/** LP(x) = u32le(len) ‖ x — the TMX house length-prefix (spec §3). */
function lp(b: Uint8Array): Uint8Array { return concat([u32le(b.length), b]); }
/** Constant-time byte compare via the VETTED node:crypto primitive (spec §:298; 0033 fix — was a hand-rolled
 *  "constant-time-ish" XOR loop). timingSafeEqual throws on unequal lengths, so the length check (non-secret:
 *  tag sizes are protocol-fixed) guards it and short-circuits. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
const enc = new TextEncoder();
const DOM_KDF = enc.encode("tmf-dem-kdf-v0");
const DOM_COMMIT = enc.encode("tmf-dem-commit-v0");
const DOM_CTX = enc.encode("tmf-cmt-ctx-v0");

// ── §4: 36-byte AEAD context descriptor ─────────────────────────────────────
export interface AeadContextFields {
  readonly sectionId: number | bigint;
  readonly coord: Uint8Array;       // 16 bytes (128-bit, opaque/non-semantic — §5)
  readonly modality: number;        // u16
  readonly kemProfile: number;      // u8 §2.1
  readonly aeadSuite: number;       // u8 §2.2
  readonly demMode: number;         // u8 §2.3
  readonly confFlags: number;       // u8 §4 (bit0 encrypted, bits1-2 commit_mode)
  readonly epoch: number;           // u32
}
/** Build the 36-byte AEAD context (§4). Reproduces the golden 070000…0000. */
export function buildContext(f: AeadContextFields): Uint8Array {
  if (f.coord.length !== 16) throw new TmfCryptoError("MalformedCrypto", "coord must be 16 bytes (128-bit)");
  const ctx = new Uint8Array(AEAD_CONTEXT_SIZE);
  const dv = new DataView(ctx.buffer);
  dv.setBigUint64(0, BigInt(f.sectionId), true);   // [0:8]   section_id u64 LE
  ctx.set(f.coord, 8);                              // [8:24]  coord 16 B
  dv.setUint16(24, f.modality & 0xffff, true);     // [24:26] modality u16
  ctx[26] = f.kemProfile & 0xff;                    // [26] kem_profile
  ctx[27] = f.aeadSuite & 0xff;                     // [27] aead_suite
  ctx[28] = f.demMode & 0xff;                       // [28] dem_mode
  ctx[29] = f.confFlags & 0xff;                     // [29] conf_flags
  dv.setUint32(30, f.epoch >>> 0, true);            // [30:34] epoch u32
  dv.setUint16(34, 0, true);                        // [34:36] reserved u16 = 0
  return ctx;
}
/** commit_mode (conf_flags bits 1-2) read from a 36-byte context. */
export function commitModeOf(aeadContext: Uint8Array): number { return (aeadContext[29]! >> 1) & 0b11; }

// ── §3: DEM key schedule (SHAKE256) ─────────────────────────────────────────
/** K_aead = SHAKE256(LP("tmf-dem-kdf-v0") ‖ LP(shared_secret) ‖ LP(aead_context))[:32]. */
export function deriveKaead(sharedSecret: Uint8Array, aeadContext: Uint8Array): Uint8Array {
  return shake256(concat([lp(DOM_KDF), lp(sharedSecret), lp(aeadContext)]), 32);
}
/** key_commit = SHAKE256(LP("tmf-dem-commit-v0") ‖ LP(K_aead))[:32]. */
export function keyCommit(kaead: Uint8Array): Uint8Array {
  return shake256(concat([lp(DOM_COMMIT), lp(kaead)]), 32);
}
/** committed_aad = aead_context (36) ‖ key_commit (32) = 68 B fed to the AEAD (§4). */
export function committedAad(aeadContext: Uint8Array, kaead: Uint8Array): Uint8Array {
  return concat([aeadContext, keyCommit(kaead)]);
}

// ── §6 / §6.1: position-derived STREAM nonces ───────────────────────────────
/** 12-byte STREAM nonce: prefix8 ‖ BE-u32((index<<1)|last) (§6; suites 0x01-0x03). */
export function streamNonce12(prefix8: Uint8Array, index: number, last: boolean): Uint8Array {
  if (prefix8.length !== 8) throw new TmfCryptoError("MalformedCrypto", "prefix8 must be 8 bytes");
  if (!Number.isInteger(index) || index < 0 || index >= 2 ** 31) throw new TmfCryptoError("MalformedCrypto", "stream index out of 31-bit range");
  const n = new Uint8Array(12); n.set(prefix8, 0);
  new DataView(n.buffer).setUint32(8, ((index << 1) | (last ? 1 : 0)) >>> 0, false); // big-endian
  return n;
}
/** 24-byte STREAM nonce: prefix16 ‖ BE-u64((index<<1)|last) (§6.1; XChaCha 0x04). Rejects index ≥ 2^63 (nonce wrap). */
export function streamNonce24(prefix16: Uint8Array, index: number | bigint, last: boolean): Uint8Array {
  if (prefix16.length !== 16) throw new TmfCryptoError("MalformedCrypto", "prefix16 must be 16 bytes");
  const idx = BigInt(index);
  if (idx < 0n || idx >= (1n << 63n)) throw new TmfCryptoError("MalformedCrypto", "stream index ≥ 2^63 (nonce wrap)");
  const n = new Uint8Array(24); n.set(prefix16, 0);
  new DataView(n.buffer).setBigUint64(16, (idx << 1n) | (last ? 1n : 0n), false); // big-endian
  return n;
}

// ── §8.5: CTX (Chan–Rogaway) committing tag, H = SHAKE256 (CMT-4) ───────────
/** commit_tag = SHAKE256(LP("tmf-cmt-ctx-v0") ‖ LP(K) ‖ LP(nonce) ‖ LP(aad) ‖ LP(T))[:32]. */
export function ctxCommitTag(kaead: Uint8Array, nonce: Uint8Array, committed: Uint8Array, baseTag: Uint8Array): Uint8Array {
  return shake256(concat([lp(DOM_CTX), lp(kaead), lp(nonce), lp(committed), lp(baseTag)]), 32);
}

// ── real KEM (hybrid X25519+ML-KEM-768) ─────────────────────────────────────
function kemFor(profile: number): any {
  if (profile === KEM_PROFILE.ML_KEM_768) return ml_kem768;
  if (profile === KEM_PROFILE.HYBRID_X25519_ML_KEM_768) return (hybrid as any).ml_kem768_x25519;
  throw new TmfCryptoError("MalformedCrypto", `kem_profile 0x${profile.toString(16)} not implemented in v0 (slice 3 = 0x01/0x02)`);
}
export function keygen(profile: number): { publicKey: Uint8Array; secretKey: Uint8Array } {
  return kemFor(profile).keygen();
}

// ── §7: single-shot seal / open (AES-256-GCM; commit_mode 00 or 01/CTX) ─────
export interface SealResult {
  readonly kemProfile: number;
  readonly ctKem: Uint8Array;   // KEM ciphertext (recipient decapsulates)
  readonly nonce: Uint8Array;   // 12 B
  readonly body: Uint8Array;    // C‖T  (commit_mode 00)  |  C‖T‖commit_tag (commit_mode 01/CTX)
}
function requireAesGcm(aeadSuite: number): void {
  if (aeadSuite !== AEAD_SUITE.AES_256_GCM)
    throw new TmfCryptoError("MalformedCrypto", `slice 3 seal/open is AES-256-GCM (0x01) only; suite 0x${aeadSuite.toString(16)} is a follow-on`);
}
/**
 * Encrypt a single-shot section. `aeadContext` (36 B, §4) carries the profile selectors + commit_mode; the
 * commit_mode (conf_flags bits 1-2) selects §4 committing-AAD (00) or §8.5 CTX (01). No silent downgrade:
 * commit_mode is bound into the AAD, so a reader that derives a different mode fails the tag.
 */
export function seal(profile: number, recipientPub: Uint8Array, payload: Uint8Array, aeadContext: Uint8Array): SealResult {
  requireAesGcm(aeadContext[27]!);
  const mode = commitModeOf(aeadContext);
  if (mode !== COMMIT_MODE.NONE && mode !== COMMIT_MODE.CTX) throw new TmfCryptoError("MalformedCrypto", "reserved commit_mode");
  const { cipherText, sharedSecret } = kemFor(profile).encapsulate(recipientPub);
  const kaead = deriveKaead(sharedSecret, aeadContext);
  const caad = committedAad(aeadContext, kaead);
  try {
    const nonce = new Uint8Array(randomBytes(12));
    const ctTag = Uint8Array.from(gcm(kaead, nonce, caad).encrypt(payload)); // C‖T (T = last 16 B)
    let body: Uint8Array = ctTag;
    if (mode === COMMIT_MODE.CTX) {
      const T = ctTag.subarray(ctTag.length - 16);
      body = concat([ctTag, ctxCommitTag(kaead, nonce, caad, T)]);
    }
    return { kemProfile: profile, ctKem: cipherText, nonce, body };
  } finally {
    // spec §:249 zeroize derived secrets after use (0033 fix; best-effort on a GC VM — shrinks the remanence window).
    kaead.fill(0); sharedSecret.fill(0); caad.fill(0);
  }
}
/** Decrypt a single-shot section (fail-closed). Throws TmfCryptoError on any auth failure. */
export function open(profile: number, recipientSec: Uint8Array, ctKem: Uint8Array, nonce: Uint8Array, body: Uint8Array, aeadContext: Uint8Array): Uint8Array {
  requireAesGcm(aeadContext[27]!);
  const mode = commitModeOf(aeadContext);
  if (mode !== COMMIT_MODE.NONE && mode !== COMMIT_MODE.CTX) throw new TmfCryptoError("MalformedCrypto", "reserved commit_mode");
  let sharedSecret: Uint8Array;
  try { sharedSecret = kemFor(profile).decapsulate(ctKem, recipientSec); }
  catch (e) { throw new TmfCryptoError("CryptoError", `KEM decapsulation failed: ${(e as Error).message}`); }
  const kaead = deriveKaead(sharedSecret, aeadContext);
  const caad = committedAad(aeadContext, kaead);
  try {
    let ctTag = body;
    if (mode === COMMIT_MODE.CTX) {
      if (body.length < 16 + COMMIT_SIZE) throw new TmfCryptoError("MalformedCrypto", "CTX body shorter than tag+commit_tag");
      ctTag = body.subarray(0, body.length - COMMIT_SIZE);
      const received = body.subarray(body.length - COMMIT_SIZE);
      const T = ctTag.subarray(ctTag.length - 16);
      // recompute + constant-time compare BEFORE running the AEAD (§8.5 reader)
      if (!bytesEqual(ctxCommitTag(kaead, nonce, caad, T), received)) throw new TmfCryptoError("CryptoError", "CTX commit_tag mismatch");
    }
    try { return Uint8Array.from(gcm(kaead, nonce, caad).decrypt(ctTag)); }
    catch (e) { throw new TmfCryptoError("CryptoError", `AEAD open failed: ${(e as Error).message}`); }
  } finally {
    kaead.fill(0); sharedSecret.fill(0); caad.fill(0); // 0033 zeroize (best-effort, GC VM)
  }
}

// ── §6: segmented STREAM seal / open (AES-256-GCM, 12-byte nonce) ────────────
export interface StreamSealResult {
  readonly kemProfile: number;
  readonly ctKem: Uint8Array;
  readonly prefix8: Uint8Array;     // 8 B random cross-stream prefix
  readonly frames: Uint8Array[];    // each = C_i‖T_i
}
/** Seal a multi-segment payload. Each chunk gets a position-derived nonce; the final carries last_flag=1. */
export function streamSeal(profile: number, recipientPub: Uint8Array, segments: readonly Uint8Array[], aeadContext: Uint8Array): StreamSealResult {
  requireAesGcm(aeadContext[27]!);
  if (segments.length === 0) throw new TmfCryptoError("MalformedCrypto", "STREAM needs ≥ 1 segment");
  const { cipherText, sharedSecret } = kemFor(profile).encapsulate(recipientPub);
  const kaead = deriveKaead(sharedSecret, aeadContext);
  const caad = committedAad(aeadContext, kaead);
  try {
    const prefix8 = new Uint8Array(randomBytes(8));
    const frames: Uint8Array[] = [];
    for (let i = 0; i < segments.length; i++) {
      const nonce = streamNonce12(prefix8, i, i === segments.length - 1);
      frames.push(Uint8Array.from(gcm(kaead, nonce, caad).encrypt(segments[i]!)));
    }
    return { kemProfile: profile, ctKem: cipherText, prefix8, frames };
  } finally {
    kaead.fill(0); sharedSecret.fill(0); caad.fill(0); // 0033 zeroize (best-effort, GC VM)
  }
}
/**
 * Open a STREAM (fail-closed). The reader recomputes each nonce from position; because the final frame is
 * opened with last_flag=1, a silently dropped trailing chunk turns the new last frame's nonce invalid → the
 * tag fails (anti-truncation / §6 reader terminator obligation). Reorder/tamper likewise fail.
 */
export function streamOpen(profile: number, recipientSec: Uint8Array, ctKem: Uint8Array, prefix8: Uint8Array, frames: readonly Uint8Array[], aeadContext: Uint8Array): Uint8Array {
  requireAesGcm(aeadContext[27]!);
  if (frames.length === 0) throw new TmfCryptoError("CryptoError", "empty STREAM (no terminator)");
  let sharedSecret: Uint8Array;
  try { sharedSecret = kemFor(profile).decapsulate(ctKem, recipientSec); }
  catch (e) { throw new TmfCryptoError("CryptoError", `KEM decapsulation failed: ${(e as Error).message}`); }
  const kaead = deriveKaead(sharedSecret, aeadContext);
  const caad = committedAad(aeadContext, kaead);
  try {
    const out: Uint8Array[] = [];
    for (let i = 0; i < frames.length; i++) {
      const nonce = streamNonce12(prefix8, i, i === frames.length - 1);
      try { out.push(Uint8Array.from(gcm(kaead, nonce, caad).decrypt(frames[i]!))); }
      catch (e) { throw new TmfCryptoError("CryptoError", `STREAM frame ${i} open failed (drop/reorder/tamper/terminator): ${(e as Error).message}`); }
    }
    return concat(out);
  } finally {
    kaead.fill(0); sharedSecret.fill(0); caad.fill(0); // 0033 zeroize (best-effort, GC VM)
  }
}

// @logicn/ext-tmf — the .tmf format engine (Phase 2, roadmap #6).
//
// Build order (specs frozen in LogicN-R-AND-D/tmf/spec/*):
//   ✅ Slice 1 — TMX-256 integrity core (TriMerkle-XOF / SHAKE256)
//   ✅ Slice 2 — container reader/writer (header + 56-byte section table; §6 fail-closed reader)
//   ✅ Slice 3 — KEM-DEM confidentiality (hybrid X25519+ML-KEM-768 → SHAKE256 KDF → AES-256-GCM + CTX commit)
//   ⬜ Slice 4 — ML-DSA-65 signing over the root (#7), via @noble/post-quantum (hybrid Ed25519)
//   🟡 Slice 5 — inclusion proofs ✅ + history chain (G4: chain + §5 freshness) ✅ + Governed Trust Capsule (#12)
export { H, ARITY, ABSENT, leafHash, nodeHash, topNode, tmxRoot, rootFromTopNode } from "./tmx256.js";
// Slice 5 (inclusion) — TMX-256 Merkle inclusion proofs: prove ONE section under the signed root without
// shipping the file (selective disclosure / streaming verify). Membership only — authenticity is the
// ML-DSA-65 signature over the reconstructed root (caller's, slice 4). Fail-closed; spec inclusion-proof-v0.
export {
  proveInclusion, reconstructRoot, verifyInclusion, verifyLeafData, serializeProof, deserializeProof,
} from "./inclusion.js";
export type { InclusionProof, InclusionPathEntry } from "./inclusion.js";
export {
  MAGIC, HEADER_SIZE, HEADER_CORE_SIZE, ENTRY_SIZE, TMX_PROFILE_SHAKE,
  TmfError, headerCore, writeTmf, readTmf,
} from "./container.js";
export type { TmfErrorCode, TmfSection, TmfReadResult } from "./container.js";
export {
  AEAD_CONTEXT_SIZE, COMMIT_SIZE, KEM_PROFILE, KEM_CT_SIZE, AEAD_SUITE, DEM_MODE, COMMIT_MODE,
  TmfCryptoError, buildContext, commitModeOf, deriveKaead, keyCommit, committedAad,
  streamNonce12, streamNonce24, ctxCommitTag, keygen, seal, open, streamSeal, streamOpen,
} from "./kemdem.js";
export type { TmfCryptoCode, AeadContextFields, SealResult, StreamSealResult } from "./kemdem.js";
// Slice 5 (G4) — .tmf append-only history chain + §5 monotone-epoch / trusted-head freshness + §8 pack.
// Integrity/order/freshness layer (deterministic SHAKE256); the KEM/AEAD ratchet (slice 3) and the
// ML-DSA head signature (slice 4, FIPS-204-blocked) are out of scope — head_signed packs fail-close.
export {
  CHAIN_HEADER_SIZE, CHAIN_ID_SIZE, HISTORY_LINK_KIND, HISTORY_LINK_MODALITY, GENESIS_PREV_ROOT,
  HIST_FLAG, PACK_MAGIC, PACK_HEADER_SIZE, PACK_ENTRY_SIZE, PACK_FLAG, TmfHistoryError,
  chainHeader, parseChainHeader, linkLeaf, segmentRoot, appendSegment, verifyChain, enforceFreshness,
  encodePack, verifyPack,
} from "./history.js";
export type {
  TmfHistoryCode, HistorySegment, AppendedSegment, TrustedHead, FreshnessPolicy,
  VerifyChainResult, PackSegment, PackVerifyResult,
} from "./history.js";

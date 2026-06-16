// @logicn/ext-tmf — the .tmf format engine (Phase 2, roadmap #6).
//
// Build order (specs frozen in LogicN-R-AND-D/tmf/spec/*):
//   ✅ Slice 1 — TMX-256 integrity core (TriMerkle-XOF / SHAKE256)
//   ✅ Slice 2 — container reader/writer (header + 56-byte section table; §6 fail-closed reader)
//   ⬜ Slice 3 — KEM-DEM confidentiality (ML-KEM-768 hybrid → SHAKE/HKDF → AES-256-GCM)
//   ⬜ Slice 4 — ML-DSA-65 signing over the root (#7), via @noble/post-quantum (hybrid Ed25519)
//   ⬜ Slice 5 — inclusion proofs + history chain + Governed Trust Capsule (#12)
export { H, ARITY, ABSENT, leafHash, nodeHash, topNode, tmxRoot } from "./tmx256.js";
export {
  MAGIC, HEADER_SIZE, HEADER_CORE_SIZE, ENTRY_SIZE, TMX_PROFILE_SHAKE,
  TmfError, headerCore, writeTmf, readTmf,
} from "./container.js";
export type { TmfErrorCode, TmfSection, TmfReadResult } from "./container.js";

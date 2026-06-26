# `.tmf` engine specs — provenance & sync

These specs are **vendored copies** of the frozen `.tmf` format specs authored in the R&D repo.
They live here so the engine package is **self-contained**: the spec the code implements is versioned
with the code and the golden-vector conformance survives any cleanup of the scratch R&D repo.

| | |
|---|---|
| **Upstream (authoring repo)** | `C:\wwwprojects\Galerina-R-AND-D\tmf\spec\` |
| **Pinned at R&D commit** | `fb68d06` — "threshold (M-of-N) custody spec + reference; absorb hub handoff into state" (2026-06-16) |
| **Direction of truth** | R&D **authors** the spec; Galerina **consumes** it. Edit upstream, then re-vendor here — do **not** fork these copies. |
| **Binding conformance** | the inline golden vectors in `../tests/*.test.mjs` (e.g. the 203-byte container `89544d46…`, root `43386e64…685212`). The TS engine is verified byte-for-byte against them. |

## What was vendored, and the slice it backs

| Spec | Engine slice |
|---|---|
| `tmx-256-construction-v0.md` | Slice 1 — TMX-256 integrity core ✅ |
| `tmf-container-v0.md` | Slice 2 — container reader/writer ✅ |
| `tmf-modalities-v0.md` | Slice 2 — the leaf `modality` registry the container references |
| `tmf-encryption-v0.md` | Slice 3 — KEM-DEM confidentiality ✅ (`src/kemdem.ts`) |
| `signature-custody-v0.md` | Slice 4 — hybrid Ed25519+ML-DSA-65 signing ⬜ |
| `threshold-custody-v0.md` | Slice 4 — M-of-N custody extension ⬜ |
| `inclusion-proof-v0.md` | Slice 5 — inclusion (Merkle-path) proofs ⬜ |
| `tmf-history-chain-v0.md` | Slice 5 — append-only history chain ⬜ |
| `governed-trust-capsule-v0.md` | Slice 5 — Governed Trust Capsule (CWT/COSE) ⬜ |
| `nvfp4-codec-v0.md` | `Vector`-modality NVFP4 codec (used by `tmf-modalities`; opaque to TMX, not a crypto slice) |

## Deliberately **not** vendored (stay R&D-only)

- `research/*`, `notes/*`, `storage-and-query-v0.md` (DB/MeshQL — gated), and the photonic-lane research.
  These are absorbed into the KB instead — see `docs/Knowledge-Bases/galerina-rd-absorption-catalog.md`.
- `spec/_vectors/*.py` — the Python reference generators. They remain the upstream **authoring oracle**;
  the binding conformance for this package is the inline golden hex in `../tests/`. (Known residual: if
  the R&D repo is removed you cannot *re-derive* the vectors from scratch, but the pinned hex + the TS
  tests still fully verify the engine.)

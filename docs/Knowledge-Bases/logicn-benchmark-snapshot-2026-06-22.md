# LogicN — Full Benchmark Snapshot (2026-06-22)

Ran the full suite (`npm --prefix packages-logicn/logicn-devtools-benchmarks run run`, exit 0) at the close of the
transport/auth R&D phase. Full machine-readable results: `packages-logicn/logicn-devtools-benchmarks/results/latest.json`.
Machine: i9-9900K · win32 · Node v24.16.0.

## Honest scoreboard (LogicN vs the winner — the slowdown column is mandatory)
LogicN's **governed tree-walking interpreter** (`logicnPassive`) is, as expected, **orders of magnitude slower than
native runtimes** on raw compute — it pays for per-node governance, exact-arithmetic trapping, and K3 evaluation:

| Class | Winner | LogicN (governed) ×slower vs winner |
|---|---|---|
| Vectorizable compute (e.g. matrix/spectral) | Rust-AVX2 | **~1.5×10⁵× slower** (≈10²–10³ kops/s vs ~10⁹) |
| General compute (compute-mix, nbody, json) | Node / Rust | **~10³–10⁴× slower** |
| Allocation / collection pipelines | Rust-AVX2 | **~20–80× slower** |
| LogicN-specific governance/framework (framework-pipeline, tmf-container, call-chain, low-memory, record-alloc, …) | — | **sole runtime** (no cross-runtime baseline) |

This is the **expected** profile of a governed interpreter and is exactly why the **Stage-B WASM / AOT path** matters
(const-fold/branch-fold/DCE already proven 1.64×; the self-hosted WASM lowering is the real lever). No result here is
presented as competitive on raw throughput; the value proposition is governance, not speed.

## Unit-alignment integrity check
- **14 comparable benches PASS** (single matching unit): compute-mix, record-allocation, collection-pipeline,
  low-memory, gpu-compute, call-chain, nbody, json-parse, mandelbrot, spectral-norm, binary-trees, tmf-container,
  framework-pipeline, (+ data-query partial).
- **3 FLAGGED / excluded as incomparable** (honest, not hidden): **matrix-multiply** (workload size differs by
  runtime — n=32/64/128), **tri-logic** (incomparable workloads — bulk-N vs truth-table micro-benches),
  **data-query** (no single representative query). Each needs a unified workload before its cross-runtime numbers
  are apples-to-apples.
- Non-comparative dev-tool benches: intelligence-search **128,180 queries/s** (85 flows), provenance-trace
  **1,555 files/s** (27-file auth-service corpus).

## Verdict
Suite is green (exit 0) and unit-honest. The governed-interp slowdown is the known cost; the optimization roadmap
(WASM byte-parity, AOT elision) is where the speed work lives. Full per-runtime numbers: `results/latest.json`.

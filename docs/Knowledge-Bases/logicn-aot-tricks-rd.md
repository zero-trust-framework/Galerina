# R&D — AOT optimization tricks: which are real & adoptable, and the photonic tensor-precompute verdict

> **Status: hub R&D verdict, MACHINE-PROVEN (2026-06-19).** Proof: `scripts/rd-aot-tensor-precompute-proof.mjs`
> (5/5 vs ground truth, i9-9900K). **No photonic/HW number** — software-sim (README: WASM is production).
> The harness self-corrected twice while being written (an LCG low-bit RNG bug, then shared FLOP counters)
> — both caught by *running* it; recorded for honesty (don't-trust-check applies to our own proofs too).

## The ask
(1) What AOT tricks do Rust/C++/Zig/Go use, and which can LogicN adopt? (2) Can the tower-citizen
"pre-multiply the tree into tensors" AOT for a speed-up? (3) How are *dynamic* `where` params (a
user-input timestamp the compiler can't pre-multiply) handled? (4) Which trick fits the MeshQL bottleneck?

## Part A — classical AOT tricks → honest LogicN mapping (the genuinely adoptable set)
These are real and the right place to look. Confidence flagged; **VERIFY-BEFORE-BUILD** before any of them.

| Trick | Real? | LogicN today | Adopt? |
|---|---|---|---|
| **Constant folding / propagation** | ✅ | PARTIAL — `staticConsts` folds `static`/`bitfield` consts in the WAT/bytecode emitters | **Yes — highest value / lowest risk.** Extend to general const-prop + branch-folding (`if 1440 > 1000` → take-true). |
| **Dead-code elimination** | ✅ | PARTIAL — effect/value-state/governance verifiers prune; no general DCE pass confirmed | **Yes**, pairs with const-prop (fold → then the dead branch is provably unreachable → drop). |
| **Inlining** | ✅ | not confirmed in the WAT tier (flow calls emit calls) | Medium — inline small pure flows before the bytecode/WAT lowering; biggest tree-walker win is still *de-coloring* (~7.4×). |
| **Monomorphization** | ✅ | the WASM/bytecode tiers already emit monomorphic i32 code; the tree-walker is dynamically tagged | Partial — already monomorphic where it matters; full generic-flow specialization only if LogicN grows rich generics. |
| **Devirtualization** | ✅ | flows are statically resolved (no real vtables); the call-graph effect-checker already does whole-program analysis | Mostly already-have / N/A. |
| **LTO (cross-module)** | ✅ | per-flow lowering; the project graph already models cross-flow edges | Medium — whole-program inlining/DCE across flows once the single-flow passes exist. |
| **PGO (profile-guided)** | ✅ | the passive LRU result-cache is a runtime-memo cousin; no build-time reordering | Aspirational — needs a profile-capture + second-pass build; defer. |

**Recommendation (when you greenlight a build):** general **constant-folding + propagation + branch-folding + DCE** is the single best classical AOT lever for LogicN — high value, low risk, additive, and it composes with the production-tier lowering already underway (`forEachStmt`→WASM shipped `c6c2896`). It does NOT need new language surface.

## Part B — the photonic "pre-multiply the tree into tensors" claims (PROVEN to be the classic precompute trade, not a free lunch)
Each headline claim measured (i9-9900K):
- **D2 — "single O(1) hardware pulse" is FALSE.** Applying a precomputed reachability/path matrix is
  `V × dense-NxN` = **O(N²)** per query (measured ~4×/doubling). Matrix exponentiation `Aᵏ` does not
  "collapse time into geometry" for free — it relocates O(N²) work to every query.
- **D1/D3 — the precomputed `T_reach` is DENSE = O(N²) memory.** A connected graph's reachability closure
  is ~100% full (measured **64× blow-up** over the O(N+E) adjacency); building it is **O(N³)** AOT.
- **D4 — matrix-chain "fusion" `A₁·A₂·A₃` DENSIFIES** (measured **39× denser**). For sparse reachability
  matrices this is counterproductive (more memory + a denser runtime matmul), the opposite of a speed-up.
  (NB: this is *matrix-chain* fusion. **Element-wise** map→filter fusion / deforestation IS real — but
  that is the for/where data-mask, see [[logicn-for-where-mask-verdict]], not this.)
- **D5 — "superposition computes both paths in one cycle" is FALSE.** Computing both branches + masking is
  **exactly 2× the transform FLOPs** (measured) — the same "predication does the filtered work too" result
  as the for/where verdict. Not free on a sequential (or batched-sequential) substrate.
- **`ntt_mul` is a category error** (already recorded in 0035): NTT accelerates polynomial / big-integer
  multiplication, NOT matrix multiplication. There is no `ntt_mul` fast-path for `A·A`.

**The honest nuance:** the precompute is the textbook amortization trade — it **wins** for *all-pairs / many
repeated queries on a small-or-dense graph* (the O(N²) table pays off) and **loses** for *sparse /
single-source / large* graphs (sparse BFS is O(N+E); the table is O(N²) memory). This is precisely why the
**MeshQL shortest-path / reachability precompute is already PARKED** ([[logicn-tritmesh-meshql-shortest-path-parked]]):
it's a real technique with a known cost envelope, not a substrate magic trick.

## (3) Dynamic `where` (the user-timestamp question) — answer
**Not superposition** (D5: 2× work, and it must materialise both branches). The sound answer is the
data-oriented one: AOT-precompute the **static structure** (columnar/sparse layout, the static parts of the
query), and apply the **dynamic predicate as a cheap runtime mask** over that layout — computing the *taken*
path, not both. The dynamic `where` stays a one-pass O(n) masked scan (with a **separate presence channel**,
never overloading the K3 trit-0 = INDETERMINATE — see the for/where verdict). The compiler's AOT job is to
make that scan branchless and cache-aligned, not to pretend the dynamic value is knowable.

## (4) Which trick fits the MeshQL bottleneck — answer
The MeshQL bottleneck is graph-traversal tree-walker overhead. The aligned, *honest* levers are the genuine
ones above — **const-prop/DCE on the static query parts**, a **columnar/sparse layout + branchless masked
filter** for the dynamic parts, and **lowering traversal into the production tiers** (not the diagnostic
tree-walker). The matrix-exponentiation reframing is **not** the lever (parked; counterproductive for the
sparse single-source case MeshQL actually serves). A *materialised view* for a small set of known static,
hot queries is the one precompute worth considering — explicitly memory-budgeted (O(N²) per materialised
relationship), exactly like a database materialised view.

## Honest scope / EXCLUDED
- No photonic/optical/SIMD-lane number (HW-gated → 0028). All figures JS/CPU on the named machine.
- Nothing built — this is a verdict + adoptability map + proof. The recommended build (general const-fold +
  DCE) is a separate, owner-greenlit step.
- Harness self-corrections (v1 LCG-low-bit graph degeneracy; v1 shared FLOP counters) are documented in the
  script header — the v2 figures are the load-bearing ones.

## See also
`scripts/rd-aot-tensor-precompute-proof.mjs` · [[logicn-for-where-mask-verdict]] ·
[[logicn-treewalker-photonic-governance-rnd]] · `logicn-tritmesh-meshql-shortest-path-parked.md` ·
0025/0035 done-reports (ntt_mul category error already recorded).

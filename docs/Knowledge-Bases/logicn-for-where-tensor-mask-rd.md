# R&D — `for`/`where` tree-walker overhead → ternary tensor-mask (predicated execution)

> **Status: hub R&D verdict, MACHINE-PROVEN (2026-06-19).** Re-runnable proof:
> `scripts/rd-for-where-mask-proof.mjs` (exit 0, 6/6 assertions, computed vs ground truth).
> Machine: Intel i9-9900K @ 3.60GHz · node v24.16.0 · win32. **No photonic/HW number is claimed** —
> the substrate is software-simulated (README: WASM is the production path), so all optics/"bare-metal
> cycle"/"512-bit lane" claims are EXCLUDED, exactly as for 0028.
>
> **Worker-verified + extended (R&D 0037, 2026-06-19):** re-ran this harness (6/6) + the AOT one (5/5). Confirmed
> the branchless filter is MODEST (≈1.0× ± noise, inverts for expensive f). **Proved the SEPARATE-PRESENCE-CHANNEL
> correctness fix end-to-end** (trit-0-as-mask aliases 0=INDETERMINATE → fail-open/read; a distinct presence bit
> restores it, stays fail-closed) → **adoptable trick #1 (correctness, do first; one bit lane).** Dynamic-`where`
> = runtime mask over columnar layout (taken path, NOT superposition). Precompute envelope measured (WIN
> small+dense+repeated all-pairs; LOSE sparse/single-source/large). Nothing built; see the corpus-closure ledger.

## The ask
The `for`/`where` constructs incur tree-walker overhead (sequential, branch-heavy, pointer-chasing).
Proposal: convert them to a **Spatial Tensor Mask** — flatten the loop to a data shape, turn `where`
into a ternary mask vector (+1 keep / 0 drop), multiply data×mask in one pass → "zero-branch filtering,
same cycles for 10 or 10,000 items." Sub-question: "convert to `match` at runtime?" And the design
fork: after masking, leave the 0-gaps in place (alignment) or compact them out?

## Verdict — a genuine kernel inside the usual overclaim shell
**Keep:** the *intent* — kill the per-node async tree-walker tax on `for`/`where`. **Strip:** the
mechanism claims, which repeat this session's recurring pattern (O(1)/`ntt_mul`/bare-metal hype).

### Corrections (each proven or source-cited)
1. **"Convert to `match` at runtime" — no.** You already corrected this; confirming: `match` is *also*
   branchy (jump table), so converting `for/where`→`match` (at runtime OR compile time) does not remove
   the branch. The lever is **predication + compile-time fusion**, not `match`.
2. **"`ntt_mul`, 512-bit lanes" — `ntt_mul` is fabricated** (already recorded in 0035; the real op is
   `tmacVector`, an O(count) loop in `logicn-tower-citizen`). SIMD lanes are a HW property — EXCLUDED here.
3. **"Same cycles for 10 vs 10,000" (O(1)) — FALSE.** A mask-multiply touches every element: it is **O(n)**.
   Proven (**M1**): per-call work scaled **929×** going 10→10,000 items (O(1) would be ~1×). This is the
   same O(1)-via-interference overclaim refuted in 0030/the tree-walker doc.
4. **"Matrix multiplication" — it's element-wise (Hadamard), not GEMM.** Filtering is `data[i]*mask[i]`,
   an O(n) vector product, not an O(n³)/O(n²) matrix multiply.
5. **`where` is reserved-but-UNBUILT** (`lexer.ts:192`, with `trait`/`impl`/`loop`); there is no `where`
   clause and no map/filter chaining today (the collection-pipeline benchmark hand-writes a `while`+`if`).
   So this is forward-design, not an optimisation of shipped code.

### The genuine kernel (and its honest size)
**Branchless predicated filtering** is a real, legitimate, CPU-side technique (data-oriented design /
SIMD predication). But its win is **data-dependent, not universal** (**M2**, i9-9900K, 1M random items):
- branchless mask vs branchy `if`-filter: **1.04×** (cheap transform), **1.01×** (expensive transform).
- Because predication computes the transform for the **filtered-out** elements too, its advantage
  **shrinks as the transform gets more expensive** (1.04× → 1.01×). On the JS/tree-walker substrate V8
  already predicts/handles the branch well, so the masked form is ~neutral, not a step-change.

The real `for`/`where` speed lever is the one already on record: **de-color the interpreter** (the
~7.4× async-per-node tax) + **flat SoA AST** (2.22×) + lowering `for`/`where` in the **production tiers**
(bytecode/WASM), not the diagnostic tree-walker. The `forEachStmt`→WASM lowering shipped 2026-06-19
(`c6c2896`) is the concrete first step: for-in now runs as a real WASM counted loop, not a per-node walk.
See [[logicn-treewalker-photonic-governance-rnd]].

## Correctness flaw the proposal would introduce (M3)
Using **0 as the "filtered-out" mask value ALIASES the K3 trit `0 = INDETERMINATE`.** After
`verdict × whereMask`, a genuinely-INDETERMINATE node (verdict 0) and a filtered-out node (mask 0) are
**both 0 and indistinguishable** — information loss, a fail-OPEN/READ bug in any governance context.
**Fix (proven):** the mask must live on a **separate presence channel** (a boolean/bit), never overload
the verdict trit's 0. With a distinct presence bit, `0=INDETERMINATE` stays recoverable.

## The design question — leave 0-gaps vs compact (answered)
**Default: leave the gaps in place (dense masked vector), with the presence bit above — do NOT compact.**
- Compaction is **not free**: it adds a second O(n) scan + a data-dependent scatter + an allocation —
  **+431%** over leaving the 0s in place (**M4**, i9-9900K). On real parallel HW it needs a prefix-sum,
  which is the classic "parallel but not free" op.
- The dense form keeps **geometric alignment** so masks **compose** (chain `where`s as successive
  Hadamard products) and stays branchless/SIMD-friendly.
- **Only** run a compaction pass immediately before a consumer that cannot skip absent slots (e.g.
  emitting a dense external array, or a sink whose cost is per-stored-element). Treat it as an explicit,
  costed lowering step, not the default.

## Honest scope / EXCLUDED
- No photonic/optical latency or energy claim (HW-gated → 0028). All numbers are JS/CPU on the named machine.
- The masked-filter primitive is **not built**; `where` is unimplemented. This is a verdict + design +
  proof of the tradeoffs, not a feature.
- The governance-level associative fold (0025 governance-as-T-MAC, 0035 trit path-auth) is a DIFFERENT,
  already-proven kernel (verdict reduction), not this data-level filter — do not conflate them.

## See also
`scripts/rd-for-where-mask-proof.mjs` · [[logicn-treewalker-photonic-governance-rnd]] ·
`logicn-tree-walker-speed-and-photonic-governance.md` · 0025/0035 done-reports · `c6c2896` (forEach→WASM).

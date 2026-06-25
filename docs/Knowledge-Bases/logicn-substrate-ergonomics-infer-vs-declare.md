# Substrate-clause ergonomics — infer the mechanism, declare the guarantee, never infer the spec

Owner observed that the worked `substrate {}` example over-specifies — `tolerance: 5e-3`, `redundancy: 3`, the
explicit `resilience`/`invariant` blocks are **confusing for a human or AI** and invite cargo-culting (a magic
number copied without understanding is *worse* than an inferred one — it looks deliberate but isn't, so better
ergonomics here is also better security). The machinery to fix this already exists: the `substrate {}` block is
**optional** and part of the "#58 inferred-block family" (`substrate-inference.ts`); `tolerance` already defaults
(`DEFAULT_TOLERANCE = 1e-9`).

## The principle that decides what's safe to auto-infer
> **Infer the *mechanism* (how to meet the guarantee). Declare the *guarantee* (what's required) and the *spec*
> (what the result must satisfy). Never auto-infer the thing you're supposed to be checking *against*.**

| Field | What it really is | Verdict |
|---|---|---|
| `lane: photonic` | the developer's deployment **choice** | **declare** |
| `redundancy: N` | a **mechanism** — votes to hit the tolerance | **✅ auto-infer.** The compiler already has the NMR math (`substrate-math.ts`) and already checks N-meets-tolerance (LLN-SUBSTRATE-002/003) — it can compute the minimum N. Declaring it = an *override* for extra margin, never mandatory. |
| `resilience { on_substrate_fault fallback … }` | a **mechanism** — what to do on fault | **✅ auto-default.** Omitting it already fails **closed** (`OnIndeterminate` defaults to `trap`). Smart default: **auto-synthesize the digital twin** (same body, `lane: digital`) and wire it. Declare only for a custom fallback. |
| `tolerance: 5e-3` | the **required guarantee** — the app's precision need | **⚠️ keep declarable, don't infer the value** (the compiler can't know how precise your result must be). Improve readability: `tolerance: 0.5%` or named levels `strict\|balanced\|loose`; default from the deployment profile, not always the tightest. |
| `invariant { ensure result … }` | the **spec** — the contract of correctness | **❌ never auto-infer.** Deriving "result ∈ [0,1]" *from the body* makes a bug in the body the spec — a silent fail-open, the exact anti-pattern DbC exists to prevent. Ergonomic fix: lift it into the **type** (return `Probability`, a refined Float in [0,1]) so it reads naturally + is type-checked. Keep `ensure` for genuine post-conditions. |

## The friendly form (the common case should be one line)
```lln
guarded flow scoreBatch(features: Tensor<Float,[256]>) -> Probability
contract {
  intent    { "Score a batch on the photonic co-processor." }
  effects   {}
  substrate { lane: photonic }   // redundancy inferred (min-N for the profile tolerance),
}                                //  tolerance profile-defaulted, fallback = auto digital twin,
{ return Tensor.dot(features, weights) }  //  indeterminate → trap. `Probability` carries the [0,1] bound.
```
Add `tolerance:` / `redundancy:` / a custom `resilience` block **only** to override the compiler's safe defaults.

This aligns with existing inference (`economics {}` is auto-inferred; the #58 inferred-block family;
`substrate-inference.ts`) and is precisely the **"compiler intelligence" axis** of the
[syntax sweep](logicn-rd-syntax-7axis-sweep-2026-06-25.md). **Build candidate:** infer-redundancy +
auto-synthesize-digital-fallback + profile-default-and-rename-tolerance + lift-invariants-into-refined-types.

*Companion: [logicn-substrate-worked-example.md](logicn-substrate-worked-example.md).*

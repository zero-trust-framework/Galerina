# WASM Compilation Granularity — single- vs multi-module, packages OUTSIDE the app (R&D 0052)

**Status:** DESIGN / LANDSCAPE (production untouched) · **Date:** 2026-06-19 · **Source:** R&D 0052
(`LogicN-R-AND-D/wasm-granularity/WASM-COMPILATION-GRANULARITY-RND-0052.md`), grounding bench
`tri-encription/bench/wasm-artifact-model-grounding-verify.mjs` **exit 0, 15/15**.

## The owner question
For dev speed + very large apps: don't force everything into one `.wasm`. Want the OPTION of the **main app** as its
own `.wasm` (or **several sections** if large), with **packages kept OUTSIDE** as separate modules linked at load —
*what do current languages do when they compile, and what should LogicN do?*

## The landscape — six axes (web-verified against current primary sources)
| Axis | Strategy | Who | Trade |
|------|----------|-----|-------|
| 1 | **Whole-program → one `.wasm`** (static LTO merges the dep tree) | Rust `wasm32` lto, Go `GOOS=js`, Emscripten, AssemblyScript | Max cross-module inlining/DCE, one artifact; slow rebuilds, no independent packages. **= LogicN today.** |
| 2 | **Separate compile + static link** (`wasm-ld`/LLD `--gc-sections`) | LLD WebAssembly | Incremental-build win; still ONE final `.wasm`. Dynamic-link path still experimental/unfinalized. |
| 3 | **Dynamic link: MAIN_MODULE + SIDE_MODULE** (dlopen-style) | Emscripten | **Literally "main app + packages as separate `.wasm` linked at load."** Shares process memory (weak isolation), no cross-module inlining, ABI-fragile. |
| 4 | **Component Model + WASI + WIT** (`wac`/`wasm-tools compose`, Wasmtime host-link) | Bytecode Alliance | **Shared-nothing** (a component may not export memory; interacts only via imports/exports) + typed WIT. **= LogicN's reserved #102–104 path; a component boundary == a capability/trust boundary.** |
| 5 | **Split ONE program into several `.wasm`** (post-build, lazy cold sections) | Binaryen `wasm-split`, Emscripten Module Splitting, dart2wasm deferred | The owner's "broken into sections." Different axis from packages-outside. |
| 6 | **JS-bundler analog** (code-split + vendor chunk) | webpack/Rollup/esbuild | Correct mental model only; its WASM realizations ARE axes 3/4/5. |

**The ask maps onto a HYBRID:** mechanism **Axis 3** (closest shipping-today) → target **Axis 4** (Component Model,
where the module boundary *is* the governance boundary) for *packages-outside*; **Axis 5** for *splitting a large app*;
**Axis 1** (= today's AOT-fuse) as the *small-app default*.

## LogicN today (machine-proven, exit 0)
One signed `.wasm` per `--package` + `.lmanifest` + `<name>.fuse.json`, host-**fused** via `fusePackage` through **three
fail-closed gates** — Gate 1 hash, Gate 2 Ed25519 signature, Gate 3 deny-by-default capability — with a per-package
`behavioralFingerprint` (CFG-path hash). **No multi-module / side-module / compose path exists** (count 0 across 759 files).
So LogicN sits squarely in Axis 1.

## Recommendation
- **Default = AOT fuse (Axis 1).** Best whole-program opt, **simplest single attestation target** (one hash, one
  signature), no load-time boundary cost. Right for **small-to-medium** apps whose packages aren't independently redeployed.
- **Opt-in = multi-module / component mode.** Main-app `.wasm` + each package OUTSIDE as its own signed `.wasm`,
  host-linked at admission. Buys incremental builds, independent versioning/caching/deploy, shared-package reuse, and —
  uniquely for LogicN — **per-module signed admission + isolation**. Loses cross-module inlining/DCE + adds a per-call
  boundary cost. Right when the app is **large, OR packages are shared across apps, OR packages need independent
  deploy/revocation**.

### Sequencing — do NOT block on the Component Model
- **Phase A (interim, current fuse path):** the inter-module linker is **net-new host glue** over the existing
  `capabilityRegistry` hook (a `CapabilityImportFactory` delegates a consumer's *declared capability* to a producer's
  `invoke` → module→module routing is itself deny-by-default). The three fail-closed gates + per-module signed admission
  **already ship**. Valid **only for trusted/first-party packages** (no memory wall between co-resident instances yet).
- **Phase B (#102–104 lands):** swap host-link for Component-Model host-link/compose → shared-nothing memory isolation +
  typed WIT, **without changing the governance contract**. Only then is admitting an *untrusted* peer in-bounds. The
  Component Model is the **isolation upgrade, not the entry ticket.**
- **Phase C:** app-splitting (Axis 5) at flow/contract granularity riding the `#94` import DAG — behind the size/cost bench.

### Governance invariants hold across a module boundary (fail-closed)
A separate module is **not an escape hatch** — the boundary is a fail-closed **capability edge**. Per-module signed
admission holds (Gate 1 hash + Gate 2 sig per module; authoritative contract is the `fuse` block in the *signed*
`.lmanifest.json`; the unsigned `<name>.fuse.json` fails closed on drift). Deny-by-default imports hold per module
(Gate 3). **Set-level invariant:** a multi-module admission is "signed" iff **every** module verified — the host-linker
MUST refuse to compose if any module is `allowUnsigned`. Per-module `behavioralFingerprint`s **compose** as an ordered
tuple of independently-verified attestations — strictly **stronger** than one whole-program fingerprint (pinpoints which
module changed; supports per-module revocation).

## Honest tiers
- **Shipped + cited (proven exit 0):** one signed `.wasm`/package + `.lmanifest` + `.fuse.json`; `fusePackage` 3-gate
  fail-closed fusion; per-package `behavioralFingerprint`; `admitAndInstantiate` (#105, test/export-only); **no
  multi-module path ships** (negative control N1).
- **Net-new (design, owner-gated, NOT built):** the two-mode recommendation + when-each rule; the Phase-A interim
  host-linker over `capabilityRegistry` (trusted/first-party only) + the set-level signed invariant; per-module
  fingerprint composition; app-split at flow/contract granularity (Phase C).
- **Reserved/deferred (#102–104, externally blocked):** Component-Model host-link/compose (shared-nothing + WIT).
- **Corrected on verify:** the "67% Wasm-outside-browser" stat DROPPED (real ~52% non-browser; 67% = production-adoption);
  in-`.wasm` K3 *enforcement* down-tiered to knowledge-asserted (only the declared-effect *surface* is proven signed);
  "app-split rides #94 DAG" marked a design conjecture (no deferred-load seam ships).
- **NO perf/size numbers claimed** (owner: "no maths yet" — binding scope guard). The size-vs-build-speed-vs-boundary-cost
  bench is a **named later phase**; the grounding bench is a *surface/existence* check carrying zero timing/size data.

## Phase A — Slice 1 SHIPPED 2026-06-20 (owner green-lit the build)
`logicn-framework-app-kernel/src/fuse-loader.ts` — the multi-module host-linker, first-party only:
- **`fusePackages(dirs, opts)`** — composes MULTIPLE built packages: each runs the same Gates 1+2 (hash + signature)
  as `fusePackage` (refactored to share `loadAndVerifyPackage` + `instantiateComponent` — the 7 single-package tests
  still pass), then the set is planned and instantiated in **provider-before-consumer order**, wiring peer-backed
  capabilities through the existing `capabilityRegistry` hook.
- **`planComposition(members, knownCaps, opts)`** — PURE, fail-closed planner enforcing the Phase A invariants:
  **SET-SIGNED** (one unsigned member refuses the whole set — `LLN-FUSE-SET-UNSIGNED`), **DENY-BY-DEFAULT** routing
  (a consumed capability resolves to a peer provider or a host shim; unsatisfied → `LLN-FUSE-UNKNOWN-CAP`),
  **UNAMBIGUOUS** (`LLN-FUSE-SET-AMBIGUOUS`), **ACYCLIC** (Kahn topo-sort; `LLN-FUSE-SET-CYCLE`), no self-provision
  (`LLN-FUSE-SET-SELF`), and the closed-import-surface rule (a *consumed* provided capability must have a registered
  host-import shape — `LLN-FUSE-PROVIDES-UNKNOWN`). An **unconsumed `provides`** (a seam/protocol like `"rest"`) is
  inert metadata, not a capability link.
- **`makeProviderFactory(cap, registry, getProvider)`** — re-backs a capability by mirroring its registered host-import
  SHAPE and routing every function to the provider module's `invoke` (the closed shape IS the cross-module ABI).
- **Set-level signed invariant** = "signed iff EVERY module verified"; per-module fingerprints/admission unchanged.
  +13 tests (`fuse-compose.test.mjs`); app-kernel 51/51; SOT core 3705.

**Slice 2 (next):** an end-to-end producer→consumer cross-module CALL needs real `.wasm` fixtures (a provider exporting
the capability's shaped functions + a consumer importing them) — Slice 1 unit-tests the routing with a fake provider;
Slice 2 proves a real wasm→wasm call. **Phase B/C remain** (Component Model isolation when #102–104 land; app-split).

## Open / next
The two-mode design is **owner-gated** — **Phase A Slice 1 is now built** (above). Remaining order: Phase A Slice 2
(real cross-module wasm call) → Phase B (Component Model when #102–104 land) → Phase C (app-split) → the §7 size/cost
bench. See [[logicn-rd-corpus-closure-2026-06-18]] and the package/fuse docs
(`logicn-package-resolver-architecture.md`, `logicn-native-module-system.md`, `logicn-hybrid-wasm-architecture.md`).

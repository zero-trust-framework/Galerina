# LogicN memory-safety model — the stance, the all-stances survey, the honest verdict (2026-06-18)

> **Curated absorption** of R&D tasks 0033 (findings) + 0034 (stance) + the all-stances sweep (`w3elkh36a`).
> **Tier honesty:** every external paradigm below is **literature-from-knowledge** unless marked verified-fetched;
> the only **verified-fetched** facts are the five source files read this session (`tpl-simulator.ts`,
> `value-state-checker.ts`, `static-memory-pool.ts`, `memory-validator.ts`, `wat-emitter.ts` heap section).
> **No performance number is asserted** — any cost claim is gated on a bench + named machine. Photonic HW EXCLUDED.

## 1. The model (honest core)
LogicN's memory safety is **NOT a Rust borrow checker.** It is a **"Governed Capability + Ternary-Tagged Memory"** model:
- **(a) Substrate:** a GC-managed single-threaded TypeScript tree-walker for the live runtime — **no manual free** in the interpreter path; reclamation is the host (V8) tracing GC. Compiles toward WASM (a per-flow bump heap + a separately-managed fixed `StaticMemoryPool` arena).
- **(b) The enforced spine (already shipped):** the **value-state / taint** pass (`value-state-checker.ts`: Unsafe/Safe/Validated/Tainted/Protected/Redacted/Secret/ReadOnly; fail-closed deny-by-default origins; discharge only via `validate`/`sanitize`/`redact`/`seal`) + the **effect / capability** passes + the **K3 collapse** at the trust boundary. This proves what a borrow checker would, via dataflow over *trust/provenance* rather than aliasing/lifetimes.
- **(c) The ternary substrate primitives:** the `0b11` illegal-trit **corruption trap**, guard-page canaries, **REJECT-fill-on-erase** (zeroed/erased ⇒ REJECT(−1) ⇒ fail-closed), and `consensusTrit`.
- **(d) Kept from Rust (no borrow checker):** immutable-by-default, **move/`USE_AFTER_MOVE` linearity** (= affine typing), `Option<T>` over null. **Dropped:** the full lifetime/borrow checker (specced as `LLN-MEMORY-001..008` but **unbuilt** — only the unsafe-block scanner emits; the move/borrow examples don't even parse).

## 2. All-stances survey (every paradigm vs LogicN)
| Paradigm | What it gives | LogicN fit | Verdict |
|---|---|---|---|
| Tracing GC (+ gen/incremental/concurrent) | reachability reclaim, no manual free | have-equivalent (the tree-walker IS V8 GC) | keep as substrate |
| Naive reference counting | prompt reclaim, no cycles | inapplicable (pure overhead on GC'd; Vale measured RC +25%) | decline |
| **Perceus precise RC (Koka)** | compile-time precise drop-at-last-use, garbage-free, no pause | converges (the value-cousin of move-linearity + tombstone) | **track** — deterministic drop-insertion for *escaping* objects; "regions first, precise-RC for escapes, never tracing in production" |
| Linear/affine (Austral, ATS) | use-once; no UAF/double-free, no lifetimes | have-equivalent (move/`USE_AFTER_MOVE` = affine) | keep; gap = enforce *must-use* (linear) on secret/capability handles |
| **Region-based (Cyclone/MLKit/Verona)** | bulk O(1) free at region end | **already-have** (per-flow bump heap + `StaticMemoryPool` + `lockFlight`) | don't re-add; don't add Rust lifetimes |
| Rust full borrow checker | compile-time aliasing-XOR-mutation, zero-cost | inapplicable (mismatched to GC tree-walker; pervasive coloring vs the async-tax lesson) | **EXCLUDED** (the 0034 rejection) |
| **Pony ref-caps (iso/val/ref/box/tag/trn)** | per-reference alias/mutability/sendability → data-race freedom | converges (per-ref capability = LogicN's per-ref governed cap+taint shape; iso≈move, val≈immutable-default) | import ONE idea: an **iso-like isolation flag** for secret bindings + the **tag** opaque-handle concept; not the whole lattice |
| Verona regions + concurrent ownership | region = unit of ownership + concurrency | could-adopt (maps onto the Arena + future concurrency) | track (longer-term) |
| **Vale generational references** | per-alloc gen counter checked at deref → UAF trap (~+11%) | converges (= tombstoning generalized) | **ADOPT the gen-tag** (see §3) |
| CHERI (HW capabilities) | unforgeable fat pointers, base+bounds+tag | inapplicable (needs silicon) | inspiration only; software analogue = MSWasm handles |
| ARM MTE / SPARC ADI | HW lock-and-key tags | inapplicable (needs silicon) | emulate the IDEA via gen tags |
| Intel CET (shadow stack/IBT) | HW control-flow integrity | inapplicable (needs silicon; WASM resists ROP already) | out of scope |
| ASan shadow-memory + quarantine | redzones + delayed reuse | could-adopt (a quarantine delay is a cheaper partial mitigation) | prefer gen tags (deterministic, aerospace fit) |
| **MSWasm handles** | segment+offset+bounds+unique-id inside linear memory (the `isCorrupted` field mirrors `0b11`) | **could-adopt** | ADOPT for the WASM intra-module **spatial** gap; the handle id can BE the ternary generation word |
| **WasmGC struct/array refs** | VM-managed typed refs outside linear memory | could-adopt | ADOPT/track — the upstream way to close the intra-module gap for record types |
| Ternary tombstoning (REJECT-fill + `live(i):=getTrit(i)!==-1`) | fail-closed read of a still-free cell, native to the encoding | keep | KEEP for spatial/corruption + still-free reads; **does NOT cover reuse-after-realloc** |
| Separation logic / capability-machine (CHERI+Iris) | one unforgeable-capability invariant, machine-checkable | **missed framing** | track — see §3 unification |

## 3. The honest verdict — **amend-add-paradigm** (spine robust; one real add)
- **AMENDMENT 1 (load-bearing, grounded in shipped code):** ternary tombstoning catches a *still-free* read but **NOT free+reallocate** — after realloc the REJECT poison is overwritten by valid trits, so a stale handle reads plausible data and aliases the new object (ABA/type-confusion). **This is a real shipped surface:** `logicn-core-sentinel-memory/src/static-memory-pool.ts` `free()` (≈:147-157) returns blocks to a per-segment free-list and `allocate()` (≈:97-127) re-hands the same ptr, with **no** generation/tombstone/quarantine; `memory-validator.ts` checks only align+bounds (**no temporal check**) — and the pool targets mission-critical/aerospace. **Fix:** a **per-allocation generation tag** (Vale/MTE/MSWasm-id family) stored in `live` + embedded in the handle; deref checks `handle.gen === currentGen(block)`, mismatch ⇒ `SecurityTrap` (fail-closed). Keep REJECT-fill + `0b11` for the TPL substrate (spatial/corruption). Owner-gated; surfaced for a fix.
- **AMENDMENT 2 (scoping):** the WAT bump heap has **no free** (monotonic `$__lln_heap`; records never freed within a flow; host GC reclaims) ⇒ it is **spatially**-gapped (needs MSWasm/WasmGC) but **NOT temporally**-gapped — gen tags would be dead weight there. Keep the two surfaces separate (gen tags ⇒ the free-list pool only).
- **AMENDMENT 3 (keep, don't add):** region/arena lifetimes are already the de-facto model — do **not** add Rust lifetime annotations.
- **The unification framing (high-leverage, ties to note 40 / Z3):** REJECT-poison, the generation id, handle bounds, the effect permission, and the taint bit are all **fields of ONE capability** governed by one fail-closed invariant — *capabilities can only be narrowed, never forged or widened* (CHERI monotonicity ≈ LogicN's taint-monotonicity + domain-guard clamping). Expressing memory+taint+effect as a **single capability-monotonicity invariant** is exactly the kind of property an SMT solver proves cleanly — the highest-leverage unification, tracked as a framing (not a redesign).

## 4. Inapplicable-and-why
CHERI, ARM MTE, SPARC ADI, Intel CET all require **silicon LogicN does not target** (the ternary VPP is a software sim; photonic HW EXCLUDED) — their *ideas* are absorbed in software (gen tags emulate MTE lock/key; MSWasm handles emulate CHERI bounds/provenance). The Rust borrow checker is inapplicable because there is no compile-time aliasing-XOR-mutation regime in a GC tree-walker (and it's pervasive memory-coloring, against the measured async-coloring lesson).

## See also
R&D tasks 0033 (findings: WASM intra-module gap + crypto hygiene + tombstoning) · 0034 (the stance) ·
[logicn-formal-verification-direction.md](logicn-formal-verification-direction.md) (the capability-monotonicity-as-SMT unification) ·
[logicn-substrate-failure-model.md](logicn-substrate-failure-model.md) (NMR; degrade-to-deny) ·
[logicn-tree-walker-speed-and-photonic-governance.md](logicn-tree-walker-speed-and-photonic-governance.md) (the async-coloring lesson) ·
*beyond-safe (self-heal / index / the unifier): incoming from `wsrdam6ol`.*

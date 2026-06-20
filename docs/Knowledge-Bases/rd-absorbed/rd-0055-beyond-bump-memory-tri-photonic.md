# R&D 0055 — Beyond-bump memory architectures for LogicN (tri/photonic substrate)

**Absorbed:** 2026-06-21 · **Source:** `LogicN-R-AND-D/_session-bridge/tasks/0055-beyond-bump-memory-tri-photonic.md`
**Proof:** `scripts/rd-0055-gc-tri-photonic-proof.mjs` (35/35 PASS, exit 0, live-grep guarded)
**Adjudication:** 18-agent adversarial workflow (find → refute) + a focused beyond-bump pass.

## TL;DR
GC is settled — **LogicN compiled is already GC-free** (a monotone linear-memory bump allocator in
`wat-emitter.ts`; only the Stage-A TS tree-walker is GC'd, via V8/the host). Asking "what's *beyond* the
bump allocator with tri/photonic logic" yields: **every photonic-GC idea REFUTES** (there is no GC to
accelerate; the O(1) claims are category errors; reversible "uncompute" *conflicts with mandatory
secret-erasure*), and the genuine wins are all **digital governance hardening on the existing arena.**

## The finding that drives it
The bump allocator is **not yet a real arena**: the emitter emits **0 heap resets** (`$__lln_heap` grows
monotonically across every flow call → a process-lifetime leak that traps at 128 MB), and
`contract.memory { arena }` is **extracted but unwired** from the emitted `(memory min max)` (an 8 MB-declared
arena still ships a 128 MB module — a fail-OPEN: governed ≠ enforced ceiling). "Region per flow" is aspirational
until fixed.

## Verdicts (all proven in the script, computed vs ground truth)
- **REFUTE:** P1 ternary-radix GC addressing (+5.66% is a future-device fact, base-4 ties base-2, orthogonal to
  a GC that doesn't exist) · P2 photonic O(1) trace (readout is Θ(\|V\|), slope 1.0; baseline already O(1)) ·
  P3 reversible uncompute (Bennett retention → violates secret-erasure) · P4 WDM concurrent GC (Amdahl(f=0)=1.00×) ·
  P5 third *logical* state (aliases K3 0=INDETERMINATE → fail-open) · P6 photonic GC/MMU (saves a 0 pause;
  8-bit analog can't index a 64 KiB page) · P8 neuromorphic "no allocation" (finite mesh forces reconfiguration).
- **ADAPT / ADOPT (digital, in-scope):** P7 region/arena (safe + DRCM-deterministic, confirmed) → **B1 wire arena
  limits + B2 per-flow reset with secret-zeroing**; P5-digital → **B3 separate-channel generation tag**
  (CHERI/MTE-style use-after-reset detection). Beyond-bump: **secure-zero stays digital** (analog wipe bottoms
  out at the noise floor — a digital `memset(0)` is strictly more secure); **AI only at the compile-PROPOSE tier**
  (runtime free-predictor is fail-open, E[UAF]=ε·N; propose/verify → 0); **photonic CAM hash-cons** only under a
  digital exact-compare verifier.

## Build line (owner-gated production edits, all DIGITAL, one file)
B1 wire `contract.memory{arena}` → emitted pages (`wat-emitter.ts:2771,2938`; `arenaLimitMb` already extracted;
16× tighter). B2 per-flow `$__lln_heap` rebase + secret-slot zeroing. B3 separate-channel generation tag.
B4 keep WDM/photonic as the K3 governance-lane fold only (no perf claim). See the bridge task for line:cite detail.

## Tri-Pipe refactor answer
**No package refactor.** The shipped Tri-Pipe (`SubstrateLane`, `substrate-inference.ts:28`; `hybrid-engine.ts`;
execution-router) already IS the "hybrid zone"; GC/MMU is never a dense-linear kernel so the net-win/Freivalds
partition keeps it digital. The whole surface is 2 hardcoded lines + 1 hook in `wat-emitter.ts`. See
[[logicn-rd-0055-beyond-bump-memory]] in auto-memory.

## Related KB
`logicn-core-memory-model.md`, `logicn-data-layout-memory-hints.md`, `logicn-compiler-phase-memory-boundaries.md`,
`logicn-core-photonic-governance-architecture.md` (the photonic-as-co-processor / Freivalds-cheap-verify pattern).

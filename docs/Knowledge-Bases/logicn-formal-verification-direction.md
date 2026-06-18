# Formal verification as a "math compiler" — direction + fit assessment (2026-06-18)

> **Curated from the owner note** [`notes/40-finding-bugs`](../../notes/40-finding-bugs). The note asks:
> *"When building LogicN it is noticeable that there are some mathematical inconsistencies when checking…
> rather than going through each file, is there some sort of mathematical equation we could use, like a
> compiler, to check?"* — i.e. **formal verification** (Hoare logic `{P}C{Q}`, SMT solvers like Z3,
> Dafny/F\*/Prusti/Liquid Haskell, TLA+, S-matrix unitary checks, WASM↔photonic translation validation).
>
> **Verdict:** yes — for the **mathematical-inconsistency subset**, which is exactly where LogicN's
> load-bearing bugs live (the tri-tier i32 divergences). LogicN already runs a **hand-rolled version** of this
> (differential benches); the upgrade is from *sampling/testing* to *proof*. It is **not** a replacement for
> the spec-vs-shipped / doc-hygiene concerns — see the boundary in §3.

---

## 1. What fits — ranked by leverage

### 1a. Z3 / SMT bitvector proof of the **tri-tier i32 conformance** — do-first, highest leverage
Today `tri-encription/bench/i32-findings-verify.mjs` checks that the three execution tiers (tree-walker /
bytecode-VM / WASM) agree on integer semantics by throwing **3,000,000 random pairs** + an 18-element boundary
set at them (0 mismatch). That is *testing*, not proof — it samples a 2⁶⁴ space.

Z3's bitvector theory (**QF_BV**) is purpose-built for `i32.add/sub/mul/div_s/rem_s/neg` with
checked-overflow→trap semantics. Model `i32-arith.ts` (the single source of truth all three tiers consume)
once, then ask Z3 *"is there any 32-bit input where tier A ≠ tier B?"* — it answers over **all 2³² inputs in
milliseconds, or returns the counterexample.** This:
- upgrades the conformance from "0 mismatches in 3M samples" → a **closed proof over the whole domain**;
- would have *proven* (not sampled) the catalogued divergences — **D1** `-(INT32_MIN)=2147483648` no-trap,
  **D2** `-0` leak, the **`/0` three-way split** (walker error / bytecode returns 0 / WASM trap);
- directly backs the **0014 fidelity-differential harness** (the lean→WASM router gate, in-flight).

Decidable, fast, small. Closes several coverage-index rows (the "3M random pairs" / "verify in-harness" items)
more cheaply and more strongly than an agent fan-out.

### 1b. The note's "translation validation" **is the 0014 harness, formalized**
The note's commutative diagram `α(f(S_wasm)) = g(α(S_walker))` is the mathematical statement of what 0014
enforces: the fast tier ≡ the reference walker, fail-closed on divergence. Today 0014 is a **differential test**
over a corpus + fuzz budget. The note's upgrade path: extract the WASM CFG (Binaryen / `wasm2wat`) → symbolically
execute each basic block → discharge equivalence with SMT — turning "differential over a corpus" into
**proof per lowering**. This is the real certification of the lean→WASM router.

### 1c. Hoare logic `{P}C{Q}` — LogicN is **already** contract-first
A `contract {}` block (effects / preconditions / the K3 governance gate / the verifier) *is* `{P}C{Q}` applied
to **governance**. What Dafny/Prusti add is the same discipline for **functional correctness** (weakest-precondition
/ refinement types). Growth path for the verifier — longer-term, heavier; not a quick win.

### 1d. Z3 for the K3 calculus — modest, retires one caveat
The no-coercion / monotone-safety theorems were proven this session by **enumeration up to depth-3 (2,776
trees)** — see [logicn-prove-own-maths-roadmap.md](logicn-prove-own-maths-roadmap.md) §1b. Z3 with ternary-encoded
constraints proves them over **unbounded** expression trees, retiring the "depth≤3 only" footnote. Nice-to-have.

## 2. What does NOT fit (the honest half)

The **S-matrix / unitary `S†S = I` photonic-physics part does not map onto LogicN today.** That math verifies
*real optical hardware* — energy conservation and phase coherence across scattering channels. LogicN's photonics
is **digital simulation** (~3%, no real optics), and crypto-on-core (`LLN-SUBSTRATE-001`) deliberately keeps the
math on a deterministic digital core. The honest LogicN analog of "is the substrate physically consistent" is the
**substrate *noise* model** (NMR / tolerance, see [logicn-substrate-failure-model.md](logicn-substrate-failure-model.md)),
**not** unitary scattering matrices. Hardware-gated — track for bring-up, do not build now.

## 3. The boundary — what SMT can and cannot do here

Formal methods nail the **mathematical** subset: tier-conformance arithmetic, K3 logic, lowering equivalence —
where the load-bearing bugs are. They have **nothing to say** about the bulk of the verification-coverage
surface: the ~185 design-gaps, 29 stale-records, and doc-cite issues are *spec-vs-shipped* and *documentation*
problems ("the code doesn't match the doc", "this cite points at the wrong line"). So formal verification is a
powerful **complement** to the coverage index, **not** a replacement for file/spec checking.

## 4. First concrete step + ownership

A ~40-line **Z3 / QF_BV model of `i32-arith.ts`'s checked ops** asserting the three tiers are equivalent (or
emitting the counterexample). Natural home: a **LogicN devtool backing the 0014 harness**, or an R&D prototype
first (R&D owns proof artifacts — see [logicn-prove-own-maths-roadmap.md](logicn-prove-own-maths-roadmap.md) §3).
Prerequisite: a Z3 install (Python `z3-solver` or the standalone binary) — not currently in the toolchain.

## See also
[logicn-prove-own-maths-roadmap.md](logicn-prove-own-maths-roadmap.md) (the conformance benches + 0014 X1 handoff this would prove) ·
[logicn-roadmap-autonomous-queue-2026-06-17.md](logicn-roadmap-autonomous-queue-2026-06-17.md) (0014 fidelity harness = the in-flight gate) ·
[logicn-substrate-failure-model.md](logicn-substrate-failure-model.md) (the noise model = the real photonic-consistency analog) ·
source note: [`notes/40-finding-bugs`](../../notes/40-finding-bugs).

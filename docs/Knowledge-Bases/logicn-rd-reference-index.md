# LogicN R&D Reference Index — stable citation IDs for every study and outcome

**Purpose:** every R&D study and every named outcome inside it has a **stable reference ID** so it can be cited precisely (in code comments, commits, KB docs, the % audit, papers). "DB outcome" is now **`RD-0114-O2`**, not a loose phrase.

**Maintenance:** when a new R&D study lands a KB doc, add its row here and stamp its outcome headers with the IDs. The study ID is the 4-digit R&D number; outcome/guardrail/claim sub-IDs are assigned in document order.

---

## ID scheme

| Form | Meaning | Example |
|---|---|---|
| `RD-NNNN` | An R&D study (the 4-digit number; matches its KB doc + commit prefix) | `RD-0114` |
| `RD-NNNN-Ox` | **Outcome** — a named result/conclusion within the study | `RD-0114-O2` = the DB outcome |
| `RD-NNNN-Gx` | **Guardrail** — a "never design this in" rule the study establishes | `RD-0114-G2` = never a Grover/holographic DB |
| `RD-NNNN-Cxx` | **Claim** — a ledger entry in a claim-by-claim study | `RD-0111-C12` = the holographic-storage claim |
| `RD-NNNN-Fx` | **Finding** — an actionable/code-relevant finding | `RD-0112-F1` = the latent sync-fallback fail-open |
| `RD-NNNN-Ex` | **Extension** — a recommended next-step | `RD-0113-E1` = the Z3/Lean K3 proof |

**Citation format:** `RD-0114-O2` (the DB outcome) — or with the doc, `[RD-0114-O2](logicn-rd-0114-tmf-vs-db-comparison-2026-06-24.md)`.

---

## Active studies (public KB docs) — the photonic/substrate series + this session

### RD-0110 — Photonic O(1)-matmul refutation, deepened
Doc: [`logicn-rd-0110-photonic-matmul-refutation-deepened-2026-06-24.md`](logicn-rd-0110-photonic-matmul-refutation-deepened-2026-06-24.md) · Status: **REFUTE (defensive-pub)**
- `RD-0110-O1` — latency can be O(1) but **work/area/energy stay Θ(N²)** (the latency-vs-work conflation).
- `RD-0110-O2` — the cross-over inequality: **photonic wins iff `reuse·core_saving > conversion_overhead`**.
- `RD-0110-O3` — the DAC/ADC **conversion tax** is the dominating term at small/sparse/low-reuse; Meech ~1.94× realized.
- `RD-0110-E1` — measure the cross-over on a real workload (0110 action #8) → became RD-0115/RD-0117.

### RD-0111 — 52-3D photonic brief, rigorous recheck (28-claim ledger)
Doc: [`logicn-rd-0111-photonic-3d-brief-rigorous-2026-06-24.md`](logicn-rd-0111-photonic-3d-brief-rigorous-2026-06-24.md) · Status: **mixed ledger (mostly REFUTE/OVERSTATED, governance layer SOUND)**
- `RD-0111-C12` — holographic O(1)-read petabyte: **OVERSTATED** (~9.6 GB/cm³, page access not O(1)). → studied further as RD-0116.
- `RD-0111-C15/C16` — superdense bandwidth / "drop the MAC": **REFUTED** (Holevo; no EUF-CMA).
- `RD-0111-C17` — toleranceWitness/QBER as a **degrade-only** carried field (HW-gated).
- (Claims C1–C28 are numbered in the doc's ledger.)

### RD-0112 — Tree-walker, deepened
Doc: [`logicn-rd-0112-treewalker-deepened-2026-06-24.md`](logicn-rd-0112-treewalker-deepened-2026-06-24.md) · Status: **maths SOUND; one finding fixed**
- `RD-0112-O1` — integer core SOUND/exact/complete, **byte-identical across all three tiers** (walker == VM == WASM).
- `RD-0112-F1` — **latent sync-fallback fail-open** (`interpreter.ts:498`), proven dead-today; **FIXED** (commit `152dc0b`) + completeness lemma (commit `13276db`).
- `RD-0112-O2` — 0110 cross-compare: tree-as-tensor **is** RD-0110-O2's refuted trade; synergy = **depth-vs-work duality**.
- `RD-0112-E1` — Z3 QF_BV cross-tier conformance proof (the do-first extension).

### RD-0113 — Tower-citizen (K3 governance), deepened
Doc: [`logicn-rd-0113-tower-citizen-deepened-2026-06-24.md`](logicn-rd-0113-tower-citizen-deepened-2026-06-24.md) · Status: **maths SOUND, zero errors**
- `RD-0113-O1` — genuine strong-Kleene K3, 145/145 tests; `allOf([])=INDETERMINATE` deliberate fail-safe.
- `RD-0113-O2` — degrade-only substrate fold = a proved **availability-not-safety** theorem.
- `RD-0113-O3` — 0110 cross-compare: governance "T-MAC" is a **min-fold REDUCTION (work Θ(N))**, not a dense matmul → RD-0110-O1's Ω(N²) doesn't bind it.
- `RD-0113-F1` — **vocabulary hazard**: retire "T-MAC" for "associative ternary-semiring reduction (min-fold)".
- `RD-0113-E1` — Z3/Lean K3 soundness + No-Coercion proof (the do-first extension).

### RD-0114 — .tmf format vs TritMesh DB, compared
Doc: [`logicn-rd-0114-tmf-vs-db-comparison-2026-06-24.md`](logicn-rd-0114-tmf-vs-db-comparison-2026-06-24.md) · Status: **both digital + sound; positioning**
- `RD-0114-O1` — **the .tmf outcome**: a digital, fail-closed signed capability passport (the control plane; governance IS the value — *constructive* soundness).
- `RD-0114-O2` — **the DB outcome**: a digital Data-Oriented-Design engine (O(1) bump allocator + SoA + O(log N) classical index over digital CIDs; the photonic/quantum hype is what's stripped — *defensive* soundness).
- `RD-0114-O3` — **the decisive insight**: control-plane/data-plane split of one architecture; same seam (`admitPhotonicConfig`), mirror-image posture.
- `RD-0114-G1` — **Guardrail**: never a MAC-less .tmf (always Ed25519+ML-DSA over the 32-byte root).
- `RD-0114-G2` — **Guardrail**: never a Grover/holographic-dependent DB engine; integrity anchor stays digital.

### RD-0115 — Hybrid photonic/binary placement
Doc: [`logicn-rd-0115-hybrid-photonic-binary-placement-2026-06-24.md`](logicn-rd-0115-hybrid-photonic-binary-placement-2026-06-24.md) · Status: **shipped switch SOUND + fail-safe; gap diagnosed**
- `RD-0115-O1` — the shipped `ExecutionRouter`/`PartitionDecider` is a **real, fail-safe** 3-axis switch; **worst case == binary == today** (25/25 proof).
- `RD-0115-O2` — the router **DOES** count the DAC/ADC tax (suspected gap refuted).
- `RD-0115-O3` — the real gap is **REUSE** (shipped crossover is reuse=1); it is **SAFE** (can only leave wins unclaimed, never break the floor) → a safe lower bound on the optimal rule.
- `RD-0115-E1/E2/E3` — formalize the safe-floor theorem / wire the reuse crossover / measure on a real workload → being executed as **RD-0117**.

### RD-0116 — Holographic "O(1)-read petabyte" storage: worth more R&D? *(running)*
Doc: TBD · Status: **in progress** (workflow `w0qh5u5jl`) — extends `RD-0111-C12`.

### RD-0117 — The 0115 join (formalize safe-floor + wire reuse-crossover + measure) *(running)*
Doc: TBD · Status: **in progress** (workflow `w0w76fzt3`) — executes `RD-0115-E1/E2/E3`, joins `RD-0110-O2`.

---

## Notes

- **Older R&D (RD-0001 … RD-0109)** live primarily in the R&D corpus repo (`C:\wwwprojects\LogicN-R-AND-D`) and the auto-memory index, not all as public KB docs. They keep the same `RD-NNNN` study ID; assign `-Ox/-Gx/-Fx` sub-IDs lazily when one needs to be cited.
- The study ID **matches** the commit-message prefix convention (`rnd(0111): …`) and the KB doc filename, so a reference like `RD-0114-O2` traces to the commit, the doc, and this index uniformly.

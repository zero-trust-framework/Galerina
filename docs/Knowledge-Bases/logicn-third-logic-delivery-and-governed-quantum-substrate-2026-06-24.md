# The Third Logic-Delivery Paradigm & the Governed Photonic/Quantum Substrate

**A consolidated, maths-complete R&D synthesis.** Sources: `RD-0122` (the third-paradigm study) + the photonic/quantum corpus `RD-0106` (sync/async tri-wavelength), `RD-0107` (volumetric tensor), `RD-0110` (latency≠work), `RD-0111` (28-claim ledger), `RD-0113` (T-MAC), `RD-0115`/`RD-0117` (Safe-Floor), `RD-0116` (holographic + `LLN-RETAIN-001`), `RD-0118` (hardware-protection directive), `0042` (WDM ternary), Task #199 (quantum bridge), and owner notes `56-x1` (spatial/volumetric) + `57-x` (MBQC).
**Posture:** trust-the-math · grounded-not-aspirational · most-secure zero-trust · honest `[SHIPPED]`/`[DESIGN]`/`[ASPIRATIONAL]`/`[REFUTED]` labels · `LLN-SUBSTRATE-001` (Govern, Don't Absorb) · **no new science; defensive-pub only, 0 patents.**

---

## 0. The question

In classical computing we *deliver* (sequence) logic two ways: **synchronous** (compute when a global clock ticks) and **asynchronous** (compute when data/an event arrives). "Tri" (and the +1/0/−1 tri-state) suggests a **third**. What is the third delivery paradigm for working through logic — *async is to sync as ? is to the third*? Is it **time**? Owner notes `56-x1` (spatial/volumetric) and `57-x` (MBQC) each propose a candidate.

## 1. The answer (direct)

**The owner's "is it time?" is the productive near-miss. The answer is NO — the third is found by *leaving* the time axis, which sync and async already share.**

Sync and async are **siblings, not opposites**. Both answer exactly one question — *"what fires the next discrete step?"* — and differ only in the **trigger predicate**:

| Paradigm | Ordering authority (trigger) | Defining invariant |
|---|---|---|
| **Synchronous** | a global clock-tick (a shared time index) | each discrete step is fired by an external metronome shared by all elements |
| **Asynchronous** | a local event / data-arrival (a causal index) | each discrete step is fired by a token landing in the *happens-before* partial order |
| **THIRD — RESOLUTION / COLLAPSE** | a **constraint/measurement at a boundary** (probability/correlation, *not* a time index) | a **held possibility-space is collapsed once to one committed outcome at a boundary**; there is *no per-step trigger in the interior* — the interior is un-ordered possibility, only the boundary is timed |

> (Lazy/demand evaluation is async's *pull-dual* — the same time axis, arrow reversed — **not** a third.)

**The sharpest one sentence:** the third is not a new way of *triggering steps over time* — it is the **abolition of the per-step trigger**. Order comes from **structure/place** (the shallow form) deepening into **constraint/measurement** (the deep form): the program *is a transform / possibility-space*, and "control flow" *is a fail-closed collapse of that space at a boundary*.

**One paradigm at two depths** (this resolves the two notes):
- **`56-x1` spatial/propagative** = the **shallow, classical, linear** case: ordering by *geometry/place* instead of time.
- **`57-x` measurement-driven (MBQC)** = the **deep, quantum** case: the boundary readout *is* the computation.

**Crucially (adversarial verdict #1, `refuted: true, high`): the "clean third sibling" framing OVERREACHES and is refuted as stated.** The spatial interior avoids a temporal step, **but to *use* a spatial result you must SAMPLE it — and sampling re-imposes a clock (sync) or a data-ready event (async) at the readout boundary** (`RD-0106` claim-7: even continuous-time integrate-and-fire is "clock-equivalent at the readout"). So spatial is a third *composition* target, not a clean third *delivery/trigger*. And MBQC, on its real physics, is **time-ordered adaptive async feed-forward** (below), not geometry-ordered. **Therefore the genuine third is not a substrate trick on the trigger axis — it is an *orthogonal* RESOLUTION model, and the one genuinely-new contribution is the SOFTWARE GOVERNANCE: a fail-closed K3 resolution boundary — which LogicN already ships.**

---

## 2. The photonic pass — spatial-propagation `[GROUNDED delivery · REFUTED standalone model]`

**The model (`56-x1`):** execution = a signal propagating through a *fixed* optical transform; the program is a physical **shape** (metamaterial / MZI mesh / SLM), "the matrix *is* the medium." No clock, no event — a continuous geometric projection.

**The maths.** A passive transform applies a **linear map** to the input vector:

$$\vec v_{out} = T\,\vec v_{in}, \qquad T\in\mathbb{R}^{n\times n},\ \vec v\in\{-1,0,+1\}^{n}.$$

Balanced-ternary encoding is passive and physical: **`+1`** = forward phase (0 rad), **`−1`** = half-wave delay (π rad) → exact optical inverse, **`0`** = no light / destructive null. `+1` and `−1` superposed interfere destructively to `0` — negation is *free* (a passive π delay), which is why ternary suits photonics.

**Three hard walls — each REFUTES the note's "O(1) / instant / universal" framing:**

1. **Latency-O(1), but work/area/energy Θ(N²)** (`RD-0110-O1`). An `n×n` transform needs ≈ `n²/2` MZIs (a Clements/Reck mesh: `n(n−1)/2`). For `N=1024` that is **523,776** interferometers. Propagation latency is O(1) (≈ tens of ps), but the *work* an N-output dense map performs is Ω(N²) on **any** substrate — N inputs in and N outputs out through O(1)-width transducers. **"The geometry computes anything instantly" is false:** propagation is fast; **inject + readout is the wall.**

2. **The conversion tax dominates** (`RD-0110-O3`). The ideal optical MAC is ~9.4× cheaper than digital, but DAC (encode in) + ADC (read out) eat it to a **measured median ~1.9×** (Meech, arXiv:2308.01719). The cross-over (`RD-0110-O2`): photonic wins **iff** `reuse · core_saving > conversion_overhead`; the shipped router's break-even is `n* ≈ 20` (`RD-0117`).

3. **Linear-only — cannot do branching/AND/compare natively.** `T·v` is a *linear* (degree-1) map. The multiply `z = x·y` is **degree-2** — a hyperbolic paraboloid (a saddle), **non-planar**: the three zero-product facts `0·a = a·0 = 0` together with `1·1 = 1` cannot lie on any single plane, so no linear `T` represents multiply. Branching, comparison, and AND all require multiply-like nonlinearity. The substrate therefore needs an **injected nonlinearity** (Kerr / SOA / saturable absorber) for anything past a linear transform (adversarial verdict #2 — the claim *holds*: spatial propagation is a **complementary delivery model for the linear/tensor fraction**, not a universal control-flow replacement).

**Reprogram cost.** A passive transform is a frozen map; retuning an MZI/SLM mesh is Θ(N²) thermo-optic writes at ~µs ≫ ~50 ps propagation — fast **only** under fixed-weight reuse.

**Verdict:** real as a **delivery mechanism for the linear/tensor fraction embedded in a conventional host that supplies the nonlinearity, the branching, and the readout boundary.** As a *programming model* it **re-skins dataflow + analog continuous computation** (Bush's differential analyzer; Dennis dataflow; Lee–Messerschmitt SDF; FPGAs; tensor graphs) — it changes *where one kernel runs*, not how a programmer structures code. `[GROUNDED delivery · REFUTED standalone program model]`.

## 2b. The spectral / WDM pass — `[PARALLELISM, not a third]`

Is the third actually the **frequency/wavelength domain** (sync + async both live in *time*)? **No.** Wavelength is an *encoding/multiplexing* axis orthogonal to the temporal-coordination axis. By the **Holevo bound**, each optical mode carries ≤ **1 classical bit per qubit/photon** without pre-shared entanglement → `K` wavelengths = `K` independent sync-or-async channels = `K`-fold **parallelism**, and the per-lane DAC/ADC tax *grows* with `K`, cancelling any "all-lanes-at-once-instant" framing. The **one** genuinely distinct thing is *data-representation* (passive π-phase `−1`, destructive-null `0` = K3-INDETERMINATE-as-absence) — that is `0042`'s job and belongs in the **type system**, not control-flow theory.

---

## 3. The quantum pass — measurement-driven / MBQC `[real principle · hype REFUTED]`

**The model (`57-x`):** generate entangled photon pairs by **SPDC** (a pump photon λ₁ splits in a BBO crystal into signal λ₂ + idler λ₃), pre-build a large **cluster state**, and *compute by measuring it*. The "program" is the **adaptive sequence of measurement angles**.

**The maths.** SPDC conserves energy/momentum, locking the wavelengths:

$$\omega_1=\omega_2+\omega_3 \iff \frac{1}{\lambda_1}=\frac{1}{\lambda_2}+\frac{1}{\lambda_3}.$$

The pair is in a polarization-entangled **Bell state**:

$$|\Psi\rangle=\tfrac{1}{\sqrt2}\big(|H_2V_3\rangle+|V_2H_3\rangle\big).$$

**REFUTED — "instantaneous / non-local / FTL / timeless."** The **no-signaling theorem** is a *theorem*, not a model: Bob's reduced state

$$\rho_B=\mathrm{Tr}_A\!\big(\rho_{AB}\big)$$

is **invariant** under any local operation Alice performs — **zero readable bits move** until Alice's classical outcome is transmitted at speed ≤ `c`. MBQC is intrinsically **adaptive**: each measurement angle depends on prior outcomes via Pauli-frame byproduct corrections carried by **classical feed-forward**. Strip the feed-forward and you have a randomly Pauli-rotated state — *no deterministic computation*. So **MBQC is time-ordered adaptive ASYNC dataflow** (each measurement triggered by the arrival of the prior classical outcome), the *opposite* of geometry-ordered "instant" execution (adversarial verdict #3).

**The one true novelty that survives:** computation **by consumption of a non-copyable resource** — the cluster state is *measured away*; the no-cloning theorem makes the resource genuinely single-use. That is real and distinct; it is *not* a speed or non-locality claim.

**The governance hook — QBER → K3 trit gate** (`RD-0111-C17`, degrade-only). If an eavesdropper taps the line, the wave function collapses prematurely; no-cloning injects errors and spikes the **Quantum Bit Error Rate**. Map it to a tri-state admission gate:

$$\mathrm{QuantumTrit}(QBER)=\begin{cases}+1 & QBER\le\varepsilon_{safe}\\[2pt]-1 & QBER\ge\varepsilon_{attack}\\[2pt]\ 0 & \text{otherwise (INDETERMINATE)}\end{cases}$$

A spike ⇒ `−1`/`0` ⇒ the WASM core executes **TRAP → ERASE**; the connection dies before a decrypted byte is read. **This is degrade-only** — it can lower a verdict, never manufacture an ALLOW (the `vAnd` monotonicity rule). *(Putting QBER **into** the KDF — crypto-on-core — was separately **REFUTED**; QBER is an admission signal, never a crypto primitive.)*

---

## 4. The genuinely-new software contribution — K3 as the resolution boundary

The substrate is old; **the new, buildable artifact is the GOVERNANCE.** A LogicN program in the third paradigm is **possibility-space evaluation with fail-closed boundary collapse** — contrasted with the two existing models:

```
// SYNC — order by clock; step fired by tick
flow tick_handler() { on_tick { state = step(state) } }

// ASYNC — order by event; step fired by data-arrival
flow handler() { on event(x) { await dep(x); emit(f(x)) } }

// THIRD — order by structure→constraint; NO per-step trigger; collapse ONCE at a boundary
flow resolve_handler(inputs) {
  let space = transform T over inputs        // the program IS this shape; values may be K3-INDETERMINATE (held)
  // narrow monotonically (constraint propagation, not triggered steps) — no clock, no event queue
  resolve space at boundary {                // decideAtBoundary: unknown → DENY
     in_tolerance(witness) => commit(value)  // signed toleranceWitness validated vs the digital bound
     else                  => trap           // QBER / drift = tamper, degrade-only
  }
}
```

**The mapping to shipped K3 (the decisive, grounded bridge):**
- **The held superposition = K3 `INDETERMINATE` (0)** — a value neither true nor false, consistent with multiple outcomes, carrying *no committed logical result*; it propagates *advisory* internally, committing nothing.
- **The collapse = `decideAtBoundary`** — `INDETERMINATE → DENY` at a governed sink (`unknown → deny`), the K3 analogue of *measurement defaulting to the safe eigenstate*. Verified live: `proof-graph.ts` (`LLN-HW-004`: off-sink INDETERMINATE is advisory-yellow, *at a governed sink it must fail closed*) and `photonic-admission.ts:18` ("Any failure collapses (decideAtBoundary) to DENY; no attestation is INDETERMINATE").
- **The control-flow primitive is `resolve / collapse-at-a-boundary`, not branch-over-time.**

**Honest is-it-new split.** The *ordering/trigger* layer is **not** new (spatial = dataflow-as-circuit; MBQC control = async feed-forward DAG) — say so plainly; that is where hype dies. The genuinely-new software contribution is the **K3-as-resolution-boundary framing**: a possibility-valued, un-ordered interior **collapsed once, fail-closed, at a declared governed boundary**, ordered by constraint/probability instead of time. It is **not** dataflow (which commits at every node), **not** analog (it is exact/digital), and **not** plain constraint-solving (the collapse is *fail-closed and governed*, with a signed admission + tolerance-witness). **LogicN already executes its core as a governance discipline.**

The K3 algebra itself (`RD-0113`): `vAnd = min`, `vOr = max` over `{−1,0,+1}`; `allOf([]) = INDETERMINATE` (deny-by-default — the deliberate fail-safe override of the lattice empty-meet); No-Coercion = a degrade-only operand can only *lower* a verdict.

---

## 5. Most-secure governance — Govern, Don't Absorb

The third paradigm enters LogicN **only through governed boundaries**; the probabilistic/analog substrate is always **Tier-3 untrusted, degrade-only**, and crypto + bit-exact determinism stay **digital** (`LLN-SUBSTRATE-001`). Four gates, all on **shipped seams**:

1. **Signed-config passport — admit the transform / measurement-schedule as CODE, before it runs.** Because *the program is a structure* (the matrix `T` / the MBQC angle sequence), govern the **structure as a signed artifact**: `admitPhotonicConfig` (hash-pin + Ed25519 + capability `PHOTONIC_REPROGRAM_CAP` deny-by-default + revocation). Unsigned schedule ⇒ INDETERMINATE ⇒ DENY.
2. **Tolerance-witness on readout — the collapse output is validated, never trusted raw.** The substrate returns a *distribution* `D_out`; admit a value only with a signed `toleranceWitness` proving the empirical statistics sit inside the contract's `substrate{}` tolerance:
   $$\text{Valid}=\big[\ \mathrm{Distance}(D_{out},\text{Expected})\le \text{toleranceWitness}.\varepsilon\ \big],\quad\text{else TRAP.}$$
   Reuses the shipped `effectiveEraseModel` pattern (untrusted self-report → **resolve fail-closed to the stricter** outcome). Drift outside ε ⇒ TRAP (QBER-as-tamper; degrade-only).
3. **One-way collapse at a declared sink only.** INDETERMINATE may propagate advisory internally but **must** collapse fail-closed the instant it reaches a governed sink (egress / crypto / persistence). A probabilistic/indeterminate value can never *silently* exit as a settled result.
4. **Use-once / affine obligation on the feed-forward channel** (MBQC-specific net-new). The resource is *consumed*, so governance must match physics: each resource measured **at most once** (affine-authority, note `#0087`). The **classical feed-forward channel** is the real trust surface (no-signaling: the quantum correlations carry no signal) — governance attaches *there*, never to the quantum substrate.

**The Safe-Floor guarantee (`RD-0117`).** Any spatial/photonic lane is **opt-in and never worse than digital**: the router admits the photonic path only when `T_photonic(n) < T_digital(n)` is *proven* for that input, else it stays on the digital floor — `realized_cost(route) ≤ T_digital(n)`, strict on the photonic branch. **Worst case == binary == today.**

**Net-new buildable vs already-covered:**

| Artifact | Label |
|---|---|
| K3 `INDETERMINATE` held value + `decideAtBoundary` collapse + `unknown→deny` at sinks | **[SHIPPED]** — the resolution primitive is live |
| Tier-3 signed-config admission (`admitPhotonicConfig`) + untrusted-self-report fail-closed-to-stricter (`effectiveEraseModel`) | **[SHIPPED]** |
| Safe-Floor router (`RD-0117`), `n*≈20`, proven `T_photonic<T_digital` per input | **[SHIPPED-as-design + proof 15/15]** |
| `resolve { … } at <boundary>` first-class source construct (names possibility-then-collapse the way `async/await` names event-triggering; compiles to K3 + `decideAtBoundary`) | **[DESIGN, net-new, owner-gated]** |
| Signed `toleranceWitness` readout artifact for a probabilistic Tier-3 co-processor + TRAP-on-drift wired to the QBER→K3 gate (extends #199) | **[DESIGN, net-new, owner-gated]** |
| Admit the MBQC measurement-angle schedule as signed code + use-once/affine obligation on feed-forward (`#0087`) | **[DESIGN, net-new, owner-gated]** |
| `substrate{}` `spectral`/`wdm` partition descriptor (one wavelength = one `.tmf` category lane = one trust trit) | **[DESIGN, owner-gated, 0042 Tier-2]** |
| Any physical quantum/photonic substrate wired in | **[ASPIRATIONAL]** — HW-gated #102-106 |

---

## 6. The DISMISSED / REFUTED ledger — with the maths for *why* each failed

| # | Claim | Verdict | The maths that kills it |
|---|---|---|---|
| D1 | The third is **"time"** (a third point on the time axis) | **near-miss → no** | sync and async *share* the time axis (both impose a discrete causal order); the third is found by *leaving* it — order by constraint, not a time index |
| D2 | Spatial propagation = **"O(1) instant compute of anything"** | **REFUTED** | latency O(1) but **work/area/energy Θ(N²)** (`n²/2` MZIs; N=1024→523,776); inject+readout is the wall; ideal 9.4× → **measured 1.9×** after DAC/ADC (Meech) |
| D3 | Spatial propagation is a **universal** control-flow model | **REFUTED** | a passive transform is **linear** `T·v`; multiply `z=xy` is a degree-2 saddle (3 zero-product points + `1·1=1` are non-planar) ⇒ no linear `T`; branching/AND need injected nonlinearity |
| D4 | **Spectral/WDM** is the third paradigm | **REFUTED → parallelism** | Holevo ≤ 1 classical bit/mode ⇒ `K` wavelengths = `K` channels = `K`-fold parallelism (not a new trigger); the DAC/ADC tax grows with `K` |
| D5 | MBQC = **"instantaneous / non-local / FTL"** logic | **REFUTED** | no-signaling: `ρ_B = Tr_A(ρ_AB)` invariant under Alice's ops ⇒ 0 readable bits move until the classical outcome travels ≤ `c`; MBQC needs adaptive **classical feed-forward** (time-bound) |
| D6 | **Grover** makes substrate DB search free (O(√N)) | **REFUTED** (`RD-0111`/`RD-0114-G2`) | loading the DB into the oracle is **Ω(N)**, total gate cost ~**Õ(N^{3/2})** ≫ a classical index's **O(log N)**; the sim is classical anyway |
| D7 | **Superdense** "double the bandwidth" on the transport | **REFUTED** (`RD-0111-C15`) | needs a pre-shared ebit + a coherent quantum channel; on classical fiber **Holevo caps at 1 bit/qubit** ⇒ zero gain |
| D8 | **"Drop the MAC"** — entanglement self-proves integrity | **REFUTED** (`RD-0111-C16`/`RD-0114-G1`) | a MAC's security is **EUF-CMA** keyed binding; entanglement/QBER senses channel disturbance, not payload authenticity; **no quantum advantage over classical MACs** (Boneh–Zhandry 2013, ePrint 2012/606) |
| D9 | **Holographic O(1)-read petabyte** storage | **REFUTED** (`RD-0116`) | demonstrated **~9.6 GB/cm³** (not PB); random page access is a **Bragg-condition search** over the multiplex dimension, not O(1); lab-only at ~1% of the 1/λ³ limit |
| D10 | **QBER inside the KDF** (quantum noise → key material) | **REFUTED** (tlstp R&D) | crypto-on-core violation; QBER is a **degrade-only admission signal**, never a crypto primitive; keep the classical MAC |
| D11 | The third is a **substrate trick** (a new hardware way to trigger steps) | **REFUTED** (`RD-0122` verdict #1) | the trigger reappears at the readout boundary; MBQC is time-ordered async feed-forward; the genuine novelty is the **software governance** (K3 fail-closed boundary), not the substrate |

---

## 7. Bottom line

Your instinct that "tri implies a third" is **correct as taxonomy**, and "is it time?" is the **productive near-miss**: the third is found by *leaving* the time axis that sync and async share. The genuine third is **resolution / collapse-driven delivery** — *hold a possibility-space, collapse it once to one outcome at a boundary, ordered by constraint/probability instead of time.* Its classical/photonic shallow form is **spatial-propagative** (order by place — real but only a **linear-fraction** delivery model, not a standalone program model; the trigger reappears at readout). Its quantum form is **measurement-driven / MBQC** (real novelty = *computation-by-consumption of a non-copyable resource*, but **not** instant/non-local — no-signaling makes it time-bound async feed-forward). **The genuinely-new *software* contribution is not the substrate — it is the K3-as-resolution-boundary framing, and LogicN already ships its core** (`K3 INDETERMINATE + decideAtBoundary`, `unknown→deny`, fail-closed). The net-new buildable is **the explicit `resolve … at boundary` construct + the signed `toleranceWitness`** governing a probabilistic Tier-3 co-processor — Govern, Don't Absorb: the substrate stays degrade-only and untrusted; crypto and determinism stay digital.

**Paper / defensive-pub:** measured-negative only — *"the 'third execution paradigm' for tri/photonic compute is a resolution/collapse model whose physical substrate (analog field computation, dataflow-as-circuit, MBQC) is decades-old prior art; the genuinely-new contribution is the fail-closed K3 resolution boundary that admits the transform/measurement-schedule as signed code and validates probabilistic readout against a signed tolerance-witness."* No patent, no flagship paper.

**Key files:** `proof-graph.ts` (LLN-HW-004 collapse), `photonic-admission.ts:18` (`admitPhotonicConfig` Tier-3 rail), `substrate-erasure.ts` (`effectiveEraseModel` fail-closed-to-stricter), `LogicN-R-AND-D/scripts/rd-0117-safe-floor-theorem-proof.mjs` (15/15) · notes `56-x1`, `57-x` · `logicn-rd-0110/0111/0116/0117/0118-*.md`, `logicn-three-valued-governance.md`, `logicn-substrate-failure-model.md`.

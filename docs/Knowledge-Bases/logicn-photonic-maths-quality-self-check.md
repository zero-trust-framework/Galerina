# How LogicN guarantees the quality of maths run on `substrate { lane: photonic }`

Owner asked: when the maths runs on the untrusted, analog, non-bit-exact photonic lane, **how do we guarantee
the result's quality — is there a self-check?** Answer: **yes — a layered self-check, and the guarantee never
comes from *trusting* the photonic result; it comes from *checking* it with a computation cheaper than the maths
itself, plus a structural bound that makes any escaped error fail-safe.** "Govern, don't absorb." All of this is
**emulator-level / Rung-2** today (`executedNatively=false`, stated honestly — no real PIC; verify+witness+decider
run CPU-side against a physics-faithful emulator; hardware is TRACK-not-build, #102-106 gated).

## The six layers (with the real code)

**1. Before it runs — prove the lane CAN meet the tolerance, or refuse.**
`requiredRedundancy(n, phys, tol)` (`logicn-ext-photonic-emulator/src/partition-decider.ts:87`) computes the
votes needed for the declared `tolerance` given the lane's noise physics. If the **systematic ADC-quantization
floor exceeds the tolerance** (`qFloor > target`) it returns **`Infinity` → refuse** (voting can't beat a
systematic floor). Enforced at compile time as **LLN-SUBSTRATE-002/003** — you cannot declare a precision the lane
can't deliver. Backed by `nmrFailureProbability`/`singleLaneErrorProbability` (`logicn-substrate-math/src/index.ts:68,90`).

**2. Deciding to run it — net-win gate, fail-closed to digital.**
`PartitionDecider.decide()` (partition-decider.ts:117) is fail-closed at every branch: ineligible
(crypto/control-flow) / ADC-floor-too-high / can't-vote-into-tolerance / **no net time win** → `digital`. Routes to
photonic ONLY on a proven absolute net win; worst case is "stayed digital," never a slowdown or degraded answer.

**3. While it runs — N-modular redundancy.** `redundancy: N` runs the analog op N times and majority-votes to cut
random noise; `requiredRedundancy` picks the minimum N; `nmrFailureProbability(pBad, N)` gives the residual.

**4. After it returns — the cheap-verify self-check (THE mechanism).** (`freivalds.ts`)
- **Matrix products:** `freivaldsVerify(A,B,C,n,k,tol,rng)` runs *k* random 0/1 probe vectors checking
  `A·(B·r) == C·r`. A wrong product is caught with **P ≥ 1 − 2⁻ᵏ** (k=20 → false-accept < 1-in-a-million) at
  **O(k·n²)** cost instead of re-running the **O(n³)** product (measured 4.3× cheaper at n=256, 100% catch at k=20).
  The trusted core verifies the work *without redoing it*.
- **Scalar voted T-MAC:** `toleranceCheck(photonic, exact, tol, span)` checks `|photonic − exact| ≤ tol·span` and
  **fails closed on NaN/Infinity** (freivalds.ts:48 — note the photonic path *does* guard NaN, unlike the scalar
  Float path the syntax sweep flagged).
- **On failure: DENY + fall back to exact digital — it does NOT re-run on photonics to "try again."** Because the
  check is asymptotically cheaper than the op, verification never holds the software back.

**5. The structural backstop — No-Coercion.** Even if a wrong result slipped every check, the analog result enters
the core only as a **degrade-only K3 trit**, combined via `vAnd = min`. Since `min(v, t) ≤ v`, the lane can only
pull a verdict *down* (toward DENY) — **never manufacture a false-ALLOW.** Worst case is a **false-DENY (a safe
availability cost)**. Blast radius bounded *by algebra, not hope*.

**6. The attested record — `ToleranceWitness`.** `runParityConformance()`
(`logicn-ext-photonic-emulator/src/parity-conformance.ts`) runs the emulation against its **exact digital
reference** across a representative corpus, measures the **max residual + std-dev**, and binds that *measured* band
into the manifest's signed `ToleranceWitness` (`photonic-bridge.ts:81,122`). The guarantee is
**calibrated-and-attested, not asserted** — "calibration-as-attestation."

## One sentence
You guarantee the maths not by trusting the photonic result but by **(a) proving up front the lane can meet the
declared tolerance or refusing, (b) cheap-verifying every result with Freivalds — O(n²) check of an O(n³) product,
wrong-answer probability ≤ 2⁻ᵏ — and falling back to exact digital on failure, and (c) a No-Coercion algebra that
makes any escaped error a fail-safe false-DENY, never a false grant** — with the measured tolerance band signed
into the manifest as attestation. The Decision-vs-Work split made literal: the *work* (maths) runs untrusted on the
lane; the *decision* (is this result good enough?) stays in the exact digital core, behind a verification cheaper
than the work itself.

*Companion: [untrusted-governed-lane.md](untrusted-governed-lane.md), [logicn-substrate-worked-example.md](logicn-substrate-worked-example.md).*

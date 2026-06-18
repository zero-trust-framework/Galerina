# Prove-Own-Maths — verification ledger + proof-closure roadmap (2026-06-18)

> **Curated KB doc** (absorbs R&D bridge reports **0023**, the **PROVE-OWN-MATHS-AUDIT-2026-06-18**, and
> **0014-recheck**). Posture absorbed: `POSTURE-2026-06-18-prove-own-maths` — *every maths-bearing claim
> (proposed AND dismissed) is backed by a machine-checkable, re-runnable artifact computed vs an independent
> ground truth, OR honestly EXCLUDED with the reason a standalone artifact can't settle it.* Companion posture:
> `don't-trust-check` / `question-the-choice`.
>
> **What this doc is:** the hub-verified ledger of what the prove-own-maths campaign has PROVEN, what is
> EXCLUDED-by-nature (with its handoff), and the OWED proof-closure queue. **The OWED queue is owned by the R&D
> session, not the hub** (owner directive 2026-06-18: "the more checks in the pipeline are the R&D session, not
> your session working on these"). The hub's job for this campaign is: verify before absorbing, record the
> findings, and route the remaining proof-closures to R&D — *not* to write R&D's benches.
>
> **Provenance:** R&D repo `C:\wwwprojects\LogicN-R-AND-D` · reports under `_session-bridge/done/` (process
> docs, not mirrored verbatim per the absorption rules — knowledge curated here). Re-runnable artifacts under
> `tri-encription/bench/`. Named machine for every number: **i9-9900K / Node v24.16.0**.

---

## 1. PROVEN — hub-re-verified (did not trust the reports; re-ran + re-derived 2026-06-18)

The owner's `don't-trust-check` posture applies to the hub too. Before absorbing, the hub (a) re-ran the two
load-bearing benches itself, (b) **independently re-derived the load-bearing maths without importing the
bench**, and (c) adversarially re-audited every source-read claim against the shipped source (read-only).

### 1a. Benches re-run by the hub
| Bench (`tri-encription/bench/`) | Result (hub re-run, Node v24.16.0) | Ground truth |
|---|---|---|
| `tower-citizen-verify.mjs` | **27/27 PASS, exit 0** | shipped `@logicn/tower-citizen` `dist/*.js` vs an independent literal-Kleene-K3 oracle + raw `mem` read-back on the real `TPLSimulator` |
| `i32-findings-verify.mjs` | **25/25 PASS, exit 0** | BigInt/i64 oracle + 18-elem boundary set + 3,000,000 random pairs (0 mismatch) — backs 0014 |

### 1b. Maths re-derived independently (hub, throwaway computation — NOT the bench's own asserts)
| # | Claim | Hub-computed | Verdict |
|---|---|---|---|
| M1 | No-coercion tree count: `T(d)=1+T(d-1)+2·T(d-1)²`, `T(0)=1` | `T(0..3) = 1, 4, 37, **2776**` | ✓ matches 2776 |
| M2 | Total `(tree,assignment)` evals = Σ over the 2776 depth≤3 trees of `3^(leafcount)` | enumerated all 2776 trees, summed `3^L` = **2,781,264** (exact) | ✓ matches |
| M3 | K3 gates: `vNot=−a` (−0→+0), `vAnd=min`, `vOr=max` == strong-Kleene | all **21 cells** (3 unary + 9 + 9 binary) match the standard strong-Kleene reference, 0 mismatch | ✓ |
| M4 | Deny-by-default: `allOf([])=anyOf([])=INDET(0)`; `authorize` true **IFF** +1 | confirmed; reasoned fail-closed-correct (empty/absent evidence never authorizes; the *algebraic* min/max identities would vacuously ALLOW `allOf([])` — deliberately overridden to 0) | ✓ |
| M5 | The two **naive** no-coercion theorems are genuinely **FALSE** in K3 (correctly removed) | reproduced both counterexamples: `vNot(−1)=+1` manufactures ALLOW from a DENY leaf (kills "ALLOW must come from an ALLOW leaf"); refining a 0-leaf to −1 **under a NOT** raises `0→+1` (kills "refining 0→−1 never raises a verdict"). Driven by K3 NOT being **order-reversing**. | ✓ removal sound |

> **The self-catch is the posture working.** 0023's bench was first RED (25/27) on those two false theorems; it was
> rewritten to the negation-safe Kleene **information-monotonicity** forms (T1–T4) and is now green 27/27. The
> `0014-recheck` report had momentarily graded this "PROVEN — IN FLIGHT" while the bench was red — a posture
> violation that the audit caught and the recheck report self-corrected (line 19 now reads plain "PROVEN").

### 1c. Source-read claims adversarially re-audited (read-only; all **HONEST**, line-exact)
Shipped source under `packages-logicn/logicn-tower-citizen/src/` — verified, *not* edited.

| Claim | Verdict | Evidence (hub-verified) |
|---|---|---|
| **V1/V2** K3 gates exhaustive | honest | `negTrit` normalises −0 (`tpl-simulator.ts:103-106`); `minTrit/maxTrit` are the gates; full 3×3 + unary checked |
| **V3** `authorize` IFF +1; INDET→DENY; gates **delegate**, not re-impl | honest | `three-valued-governance.ts:28` imports `minTrit/maxTrit/negTrit`; `vAnd/vOr/vNot` (`:49-61`) call them; `authorize` (`:95-97`) = `v===ALLOW`(=1); `collapse` (`:90-92`) maps INDET+DENY→deny |
| **V9** no −0 survivor | honest | state buffer is `Int32Array` (`tpl-simulator.ts:188,206`) — cannot represent −0 |
| **V10** zeroed buffer decodes as **REJECT(−1)**, not HOLD(0) | honest | `ENC_REJECT=0b00` (`:61`); `decodeTrit` (`:78-86`) maps 0b00→−1; `ENC_HOLD=0b01` is non-zero. **erase deliberately leaves the buffer in the fail-closed REJECT state, not neutral HOLD.** |
| **V11** fill bound == state range; only out-of-fill words are the 2 re-stamped canaries | honest | `erase()` `mem.fill(0, stateWordStart=1, canaryTailIdx)` (`tpl-simulator.ts:354-357`); layout `[CANARY][state…][CANARY]` |
| **V12** `PluginSandbox.erase()` is a boolean no-op holding no buffer | honest | `plugin-sandbox.ts:30-32` fields = `{metadata, erased}`; `erase()` (`:58-60`) = `this.erased=true`. **The real wipe lives in the separate `TPLSimulator.erase()` (`tpl-simulator.ts:354`)** — a different class. |

**Architectural note worth keeping:** `PluginSandbox` is the *lifecycle gate* (validate + erased-flag, no secret
buffer); `TPLSimulator` is the *secret-holding trit machine* whose `erase()` does the real `mem.fill(0)`. The
completion-audit's "`PluginSandbox` is a validator, not isolation" (`logicn-roadmap-and-audit-2026-06-17.md` §3)
is the same fact from the design-criteria side.

---

## 2. EXCLUDED-by-nature — correct walls, with their handoff (NOT gaps)

A standalone artifact cannot settle these; each is honestly excluded with the reason. **X1 and X2\* are the
hub-relevant ones** — both gate on production runtime work the hub is already sequencing.

| # | Excluded claim | Why standalone can't settle it | Handoff |
|---|---|---|---|
| **X1** | Shipped interpreter/bytecode/WASM tiers actually **route** through these tri/erase ops in production | needs the real tiers in a differential harness; a clone/`dist`-import can't observe real-tier routing | **0014 fidelity-differential harness wired into the real tiers** — *in-flight on the hub* (`main` HEAD: "0014 fidelity harness slice 3/3 — started"). This is the gate for the lean→WASM router. |
| **X2\*** | erase-**on-TRAP** atomicity/wiring | `tower-runtime.execute()` has no try/finally (`tower-runtime.ts:87-110`) — but today its dispatch is a **Phase-1 stub** (`:104-106`), nothing throws mid-secret, and `execute()` doesn't call `erase()` (the caller does, `:114-118`). **Verified: a Phase-2 handoff, not a present bug.** | **Phase-2 live runtime** — wrap the real engine dispatch so a mid-execution throw still wipes; ties to Tower-Citizen completion criteria (`canCommit()` gating, real isolation, mid-compute revocation #0015). |
| X3 | JIT dead-store elimination of `mem.fill(0)` | needs a pinned engine + named-machine (i9-9900K) observation | pinned-engine bench (R&D / owner-gated) |
| X4 | trap-during-zeroize atomicity | needs the live runtime | live runtime |
| X5 | continuous substrate/noise engine determinism | tolerance-reproducible, **not bit-exact** — deliberately excluded from exact-equality asserts (honesty) | n/a (out of scope for exact proofs) |
| X6 | any throughput/latency number | needs a reproducible bench on the named machine | named-machine perf bench |

---

## 3. OWED proof-closure queue — **R&D-owned** (the "more checks in the pipeline")

Per owner directive, **the R&D session closes these**; the hub does not write benches in `tri-encription/bench`.
All 14 audit OWED items classify to **rnd-bench** (the cheap close in every case is "write/commit a bench or
vector under `tri-encription/bench`," or refresh an R&D done-note). **Zero are hub-actionable**, and none require
a LogicN code change (see §4). This table is the handoff manifest, not a hub work queue.

| Tier | OWED item | Cheap close (R&D bench) |
|---|---|---|
| T1 | **GAP-4 provenance drift** [0001] | pin the engine hash + snapshot the emitted `.wat` into the R&D boundary (the *fix* is already in LogicN — §4) |
| T1 | **NMR inequality has no bench** [0007/0009] | binomial-sum oracle vs shipped `nmrFailureProbability` over a `(pBad,N)` grid + monotonicity/limit asserts |
| T1 | **in-flight PROVEN label** [0014-recheck] | already corrected on disk (§4) — acknowledge only |
| T2 | opt-down monotone-safety [0011] | enumeration: no governance value grants a capability bit; stricter-wins precedence |
| T2 | checksum identities [0013] | `binary-trees=135854` (`Σ 2^(d+1)−1`), `spectral-norm=6647`, truncation-division identity |
| T2 | ~15 negative-existence/grep predicates [0016-0019] | one grep-assert harness over the LogicN tree |
| T2 | K3-meet / `vAnd` closures [0018,0019] | ~20-line import harness over shipped `three-valued-governance.ts`/`substrate-model.ts` |
| T2 | citation content-correctness [0020] | content-assert harness; refresh the stale 491/488 baseline (now ~598/595) |
| T3 | tri-tier gas counter [0022-A] | counter sim charging on back-edges/calls; `1≠3≠1` per-instruction, equal totals (full closure gated on 0014) |
| T3 | handoff rounding predicate [0009] | `delta_max < Δ/2` rounding-agreement bench (empirical `delta_max` stays EXCLUDED = named-HW) |
| T3 | `i32.rem_s` WAT module [0021] | commit a ~10-line WAT module; assert `rem_s(MIN,−1)=0`, `div_s(MIN,−1)` traps |
| T3 | ML-DSA norm-bound vector [0003 Row 8] | vector: bogus `M·D_root≡S` fails, real `‖z‖∞<γ₁−β` + `c̃==H(μ‖w₁')` passes (FIPS-204) |
| T3 | NIST vector transcription cite [0005] | cite exact CAVP `.rsp` file/line + PUD values |
| T3 | minor self-flagged [B6] | rollback-resistance verifier bench; lane-A native "f doesn't grow"; quantum-bridge −6.0 under pinned `uv.lock` (env-pin partly owner-gated, gate G3) |

> The audit's own bottom line: the genuine OWED gaps are *few and cheap* — freeze the GAP-4 artifact, one NMR
> binomial-sum bench, one grep-assert harness, and the (already-done) label correction would bring the corpus to
> full compliance. The **crypto/format/conformance core is the strongest part and is where the rule is already
> met** (`npm test` 11/11; TMX-256 root reproduced 3 independent ways; NIST CAVP HMAC_DRBG KAT byte-exact;
> revocation 28/28; threshold-custody 11/11; QKD-hybrid 9/9; selective-disclosure-ANN 17/17).

---

## 4. Already-applied — DO NOT re-do (verified present, 2026-06-18)

The reports surfaced things a reader might assume the hub still owes. All three are **already in place**;
re-applying them would be a no-op. Recorded here so the roadmap never routes phantom work.

- **0014-recheck line-19 label** — already reads `PROVEN (0023 now 27/27, re-run 2026-06-18)` with a self-catch
  note. (File is in the R&D `done/` tree regardless.)
- **GAP-4 wat-emitter fix** — the fail-closed `unreachable` trap for the unhandled stmt is already shipped at
  `wat-emitter.ts:1695-1708` (comment `task #128 · audit-phase1-2026-06-16`). The stale `sumList 3 4 5 → 3`
  numbers in the 0001 report no longer reproduce *because the fix landed* — structural claim holds, the cited
  artifact was just never frozen (that freeze is the R&D close above).
- **NMR formula in the KB** — `logicn-substrate-failure-model.md` + `substrate-math/src/index.ts:90-99` already
  carry the corrected closed-form `nmrFailureProbability` (LLN-SUBSTRATE-001..004 shipped). The broken note-38
  `n(R,τ)=⌈1/τ⌉·Complexity(R)` survives only in historical R&D notes.

---

## 5. Hub action summary (this absorption)

- **0023 absorbed** — its V1–V12 / X1–X6 ledger is curated into §1–§2 above (cross-referenced from
  `logicn-three-valued-governance.md` for the K3 half and `logicn-drcm.md` for the `TPLSimulator` erase half).
- **"Fix what is found" → no hub fix owed.** Verification (independent re-derivation + adversarial source
  re-audit + ownership classification) found **zero hub-actionable code or KB fixes**; the items the reports
  imply the hub should fix are already shipped (§4), and the remaining proof-gaps are R&D's pipeline (§3).
- **No production code touched** — the LogicN repo was treated read-only for verification; X2* is correctly a
  Phase-2 handoff, so `tower-runtime.ts` was *not* modified (wrapping a stub would be premature/cargo-cult).

## See also
`logicn-three-valued-governance.md` (K3 runtime-verified here) · `logicn-drcm.md` (TPLSimulator / DWI erase) ·
`logicn-roadmap-autonomous-queue-2026-06-17.md` (0014 harness = X1's handoff; the in-flight gate) ·
`logicn-roadmap-and-audit-2026-06-17.md` (Tower-Citizen completion criteria = X2*'s home) ·
`logicn-rd-absorption-catalog.md` (where this absorption is cataloged) ·
`logicn-substrate-failure-model.md` (NMR closed-form) · `logicn-rd-queue-drained-2026-06-18` (memory) ·
`logicn-formal-verification-direction.md` (Z3/SMT to PROVE the i32 conformance these benches currently sample — note 40).

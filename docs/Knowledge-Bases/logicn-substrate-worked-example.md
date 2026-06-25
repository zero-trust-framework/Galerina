# A real governed flow, clause by clause — `substrate {}` and the rest of the contract

This is a complete, realistic LogicN workflow that uses the **untrusted (photonic) lane for maths** *and* the
other contract components around it, so you can see what a production flow actually looks like — not just the
`substrate {}` block in isolation. Every clause is explained. The grammar matches what ships today
(`substrate-contracts.test.mjs`, `fault-handlers-0017.test.mjs`, `governance-verifier.test.mjs`).

**Scenario:** a fraud-risk service scores a batch of transaction feature-vectors. The *maths* (a big
multiply-accumulate) runs fast on the photonic co-processor; the *decision* (sign the verdict, write the audit
ledger) stays on the exact digital core. This is the [Untrusted Governed Lane](untrusted-governed-lane.md) split
made concrete: **work on the lane, decision in the core.**

---

## The full example

```lln
// ─────────────────────────────────────────────────────────────────────────────
// 1) THE WORK — runs on the photonic (untrusted, low-trust) lane. Value-only.
// ─────────────────────────────────────────────────────────────────────────────
guarded flow scoreBatch(features: Tensor<Float, [256]>) -> Result<Float, ScoreError>
contract {

  // intent {} — the human-readable purpose. Documentation the governance layer keeps
  // attached to the flow; an AI proposing this flow must state why it exists.
  intent { "Score one transaction batch on the photonic co-processor — value-only, governed." }

  // effects {} — the DECLARED effect footprint, deny-by-default. The compiler proves the body
  // does no more than this (LLN-EFFECT-001 if it does). This flow is pure compute: it reads no
  // secret, opens no socket, writes no ledger — so the set is empty. THAT is what lets it run on
  // an untrusted lane at all: it can never carry a key or a decision off the lane.
  effects {}

  // substrate {} — opt this flow's WORK onto a lane other than the default digital core.
  substrate {
    lane: photonic        // ← the UNTRUSTED lane. Admitted, never trusted. (digital | photonic | noisy)
    tolerance: 5e-3       // the numeric guarantee the runtime must cheap-verify (≤0.5% deviation).
    redundancy: 3         // N-modular redundancy: run it 3× and majority-vote the analog reads (NMR).
  }

  // resilience {} — first-class fault handlers. If the lane can't meet its guarantee at runtime
  // (noise spike, ADC floor exceeded), DON'T fail the request — DEGRADE to the exact digital flow.
  // This is the "degrade-only" half of No-Coercion: a bad lane can only lower the outcome, never fake one.
  resilience {
    on_substrate_fault fallback scoreBatchDigital
  }

  // invariant {} — Design-by-Contract. `ensure result …` is a POST-condition checked fail-closed at
  // the flow exit on EVERY tier (interpreter, VM, WASM). A score outside [0,1] never escapes — it traps.
  invariant {
    ensure result >= 0.0;
    ensure result <= 1.0;
  }
}
{
  // The body the photonic lane is good at: a dense fixed-weight multiply-accumulate.
  return Ok(Tensor.dot(features, riskWeights))
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) THE EXACT FALLBACK — pure digital. Same maths, bit-reproducible. The
//    on_substrate_fault handler degrades to this; it is also the ground truth the
//    core uses to cheap-verify the lane (Freivalds-style).
// ─────────────────────────────────────────────────────────────────────────────
pure flow scoreBatchDigital(features: Tensor<Float, [256]>) -> Result<Float, ScoreError>
contract {
  intent { "Exact digital reference + fallback for scoreBatch." }
  effects {}
  invariant { ensure result >= 0.0; ensure result <= 1.0; }
}
{
  return Ok(Tensor.dot(features, riskWeights))
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) THE DECISION — stays on the exact DIGITAL core. Signs the verdict + writes the
//    audit ledger. crypto.sign + audit.write are bit-exact obligations.
// ─────────────────────────────────────────────────────────────────────────────
secure flow sealDecision(score: Float, txnId: TxnId) -> Result<Receipt, ApiError>
contract {
  intent { "Bind the score to a signed, audited decision receipt." }
  effects { crypto.sign audit.write }      // ← real crypto + ledger effects, declared
  invariant { ensure result is Ok implies score >= 0.0; }
  // NOTE: there is NO substrate { lane: photonic } here. Crypto MUST stay on the digital lane.
}
{
  let receipt: Receipt = sign(makeReceipt(txnId, score))
  audit(receipt)
  return Ok(receipt)
}
```

---

## What each clause does (and why)

| Clause | Role | What the compiler enforces |
|---|---|---|
| **flow kind** (`guarded` / `secure` / `pure` / `flow`) | the trust tier of the flow | a `pure` flow may declare no effects; `secure` is the highest-obligation tier; `guarded` sits between. The **tier floor** (LLN-TIER-001) stops a low tier from doing high-tier work. |
| `intent { "…" }` | human/AI-readable purpose | kept attached as governance metadata; part of what an AI-proposed flow must supply. |
| `effects { … }` | **deny-by-default** effect footprint | the body may do **no more** than is declared (`LLN-EFFECT-001`). An empty set = pure compute = safe to offload. |
| `substrate { lane, tolerance, redundancy }` | opt the **work** onto a lane | `lane`: `digital` (default, exact) / `photonic` / `noisy`. `tolerance`: the deviation the runtime cheap-verifies. `redundancy`: N (or `tmr`) for majority-vote NMR. |
| `resilience { on_substrate_fault fallback <flow> }` | first-class fault handling | every fault class resolves to a handler, fail-closed; `fallback <flow>` degrades to an exact flow instead of failing. |
| `invariant { ensure …; }` | Design-by-Contract pre/post-conditions | `ensure result …` is checked **fail-closed at the flow exit on every tier**; a violated post-condition **traps**, the value never escapes. |

## The four `substrate {}` guard rails (what stops you misusing the lane)

These are the rules the compiler applies the moment a flow declares `substrate { lane: … }`:

| Rule | Fires when | Why |
|---|---|---|
| **LLN-SUBSTRATE-001** (crypto-on-core) | a `crypto.*` effect (`sign`/`encrypt`/`decrypt`/`seal`) shares a flow with a **non-digital** lane | crypto + bit-exact determinism must stay on the digital lane. *This is the one that makes `sealDecision` above refuse to compile if you add `substrate { lane: photonic }` — even with `redundancy: 3`.* |
| **LLN-SUBSTRATE-002** (tolerance unmet) | declared `tolerance` is tighter than `redundancy` can deliver on that lane (`nmr(pBad, N) > tolerance`) | a false promise of precision. Error in `production`, warning in `dev`. Raising `redundancy` (e.g. to `tmr`) clears it — *monotone*. |
| **LLN-SUBSTRATE-003** (voting won't converge) | more redundancy *would not* help — either you'd need an impractical N, or the lane's error rate ≥ 0.5 (`noisy`) so votes can't converge | no amount of voting fixes a coin-flip lane; don't pretend it does. |
| **LLN-SUBSTRATE-004** (un-voted analog → deterministic sink) | a raw, un-voted analog value flows into a bit-exact sink | an irreproducible value must never silently become a reproducible one. |

## The one line that will not compile (and that's the point)

If you move the decision onto the lane:

```lln
secure flow sealDecision(score: Float, txnId: TxnId) -> Result<Receipt, ApiError>
contract {
  effects { crypto.sign audit.write }
  substrate { lane: photonic  tolerance: 5e-3  redundancy: 3 }   // ← LLN-SUBSTRATE-001 (compile error)
}
{ … }
```

→ **`LLN-SUBSTRATE-001: crypto.sign requires a digital, bit-exact lane`** — and it's *profile-independent*
(an error in `dev` too, not just `production`), because this is a hard fence, not a tunable. That compile error
**is the security guarantee**: the language — not a convention, not a code review — proves the *decision* can
never follow the *maths* onto the untrusted lane. That is why a photonic component scores **low trust but high
ZT-alignment**: it is untrusted *by construction*, and the fail-closed border is the compiler.

---

*Companion: [untrusted-governed-lane.md](untrusted-governed-lane.md) (the Decision-vs-Work split + the maths) ·
[logicn-substrate-contracts](../Knowledge-Bases) (the verifier). Grammar verified against
`substrate-contracts.test.mjs`, `fault-handlers-0017.test.mjs`, `governance-verifier.test.mjs`.*

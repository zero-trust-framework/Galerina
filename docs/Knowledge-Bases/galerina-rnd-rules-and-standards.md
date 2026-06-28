# Galerina — R&D rules & standards

The binding process for how R&D is run and absorbed on Galerina/TritMesh. Companion to the governance-rule
registry ([galerina-rules-master-registry.md](galerina-rules-master-registry.md)) — that one is the *language's*
rules; **this one is how we do the research**. Source: owner directives 2026-06-18..28 + the `POSTURE-*.md` bridge
docs. SoT for the live rule set = the `feedback-*` memory files (this is the readable consolidation).

## 1 · Numbering & identity
- Every R&D note/branch gets a **unique `RD-NNNN` number** (4-digit, sequential). The owner may expect **separate
  RD numbers per branch** within one note — split accordingly.
- Next-free number = scan `galerina-rd-results-log.md` for the max; never reuse a number. Some numbers are
  **owner-/worker-reserved** (e.g. RD-0150 was worker-assigned) — do not reuse those.
- A byte-identical duplicate note gets **no separate verdict** — flag it as a delete candidate (e.g. RD-0148 = dup).

## 2 · Prove the maths (do NOT assume — check)
- Every claim you **adopt OR dismiss** needs a **machine-checkable, re-runnable proof** — not analysis/assertion.
- Proofs live at `scripts/rd-NNNN[-MMMM]-<slug>-proof.mjs`, **node built-ins only** (no npm, no repo imports unless
  citing the *shipped* calculus deliberately), `process.exitCode=1` on any FAIL, end with `N/N passed`.
- Prove the **refutations** too: demonstrate O(1) is false by showing work scales with N; demonstrate a forgery to
  refute "dot-product = auth"; etc. A refuted idea is recorded with **the reason** (the negative record is the point —
  it stops re-proposal; the corpus repeatedly finds ~⅔–⅘ of "new" ideas re-derive shipped architecture).
- Deep per-claim matrices go to the **encryption R&D worker** ("Logicn-Encriptions R&D", cwd `LogicN-TritMesh`).

## 3 · ZT score (0–10)
- Every branch gets a **0–10 Zero-Trust score** = *net zero-trust soundness after refutation* (↑ = safer / sounder /
  adds a real ZT guarantee). Low (0–3) = the branch's **core premise is a ZT anti-pattern** that had to be refuted.
- Keep it **consistent**: a sound-but-ZT-neutral engineering optimization is **mid (~5)**, not low — low is reserved
  for security-downgrade premises (e.g. "replace crypto with arithmetic/optics").

## 4 · Verdict taxonomy (results-log legend)
✅ **ADOPTED** (built/shipped) · 🧪 **DESIGNED** (KB design, build pending) · 🔭 **TRACKED** (track-not-build) ·
❌ **REFUTED** (+reason) · 🔀 **MIXED** (sound core + refuted overclaims) · ⏳ **PENDING** (dispatched) ·
🔒 **GATED** (owner/HW/infra-gated).

## 5 · Refusal pairs with a "work-with-it"
- Any zero-trust **refusal ships paired** with a govern-don't-absorb ("work with it") R&D — a refusal never stands
  alone. (e.g. "optical can't be the crypto" → "optical as a degrade-only K3 *hint* under the digital signature".)

## 6 · Hard NEVER-adopt list (most-secure default)
Never endorse: stripping runtime checks · `O(1)`/"beats silicon"/"one clock cycle" complexity claims ·
obfuscation-as-security · **photonic/analog as a crypto or auth authority** (the compute-only fence,
`SPORE-SUBSTRATE-001`) · replacing real crypto/PKI (TLS/mTLS/X.509/ML-DSA) with a dot-product or a wave ·
source-routing the public internet. Crypto/verdicts stay **digital/Binary**.

## 7 · Paper-worthiness (assess per item)
State **scientific paper / defensive publication / none** with a one-line reason. Most refutation + safe-pattern
write-ups are **defensive publications** (record prior-art, disclaim novelty); a *positive* novel result is rare.
Framework IP posture = 0 patents (defensive-pub + Apache-2.0) — see [[logicn-ip-paper-strategy]].

## 8 · Tri-Pipe consideration
For everything built, record a **Binary | Hybrid | Photonic** verdict (a checklist, not triplicate-everything).
**Binary is the default for crypto/governance.** Be more lenient on *future photonic-HW* perf envelopes (aspirational).

## 9 · Absorb (when R&D returns)
1. Add a **`galerina-rd-results-log.md` row** (adopted AND refuted, with the reason).
2. Write/append the **KB doc** (per-branch verdict table + what's proved + net-new + paper-worthiness).
3. Write the **memory child file** + a one-line `MEMORY.md` pointer (keep MEMORY.md lean — the graph indexes the rest).
4. Commit the **proof scripts** + KB + results-log (explicit pathspecs, never `-A`); push; **ping the bridge**.
5. Re-run the memory graph (`scripts/memory-graph.mjs`) and the **full suite** (`scripts/run-all-tests.cjs`).

## 10 · Approval & gating
- **Owner-gated → ASK** (explicit question, never silently park). **Owner-directed = GO.**
- New **RD-0086+** results (from re-scanning old/stale notes) are **surfaced for owner approval before absorb**.
- When unsure / owner away → take the **most-secure** path (deny-by-default; no push without OK).

## 11 · Cadence & leverage
- **Routinely use parallel workers** (multi-agent) for decomposable R&D — don't serialize on the main thread; the
  parent owns the shared-doc sync (results-log / KB index / memory).
- Prefer **building a dev tool** over repeated manual work when it saves tokens.
- **Verify by running** — a fail-closed claim is verified by RUNNING the behaviour, never by reading the trap text;
  fix the **class**, not the instance (grep siblings + add a lint).

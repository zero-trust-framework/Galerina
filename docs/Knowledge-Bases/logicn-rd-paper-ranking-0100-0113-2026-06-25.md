# R&D Paper-Worthiness Ranking — 0100–0113 (2026-06-25)

The 2026-06-23 full-corpus assessment cleared **0001–0099 = 0 papers / all defensive-pub**. This pass ranks
the **previously-unchecked** items **0100–0113** against the same strict 2-arm bar (genuinely **novel** vs
real cited prior art **AND** carries a **measured** result/negative). Produced by workflow `wf_1ed51b00-cf7`
(15 agents, one per item, each reading its done-record + grounding "are we using it" against the live tree).

**Headline: 0 papers · 0 workshop notes · 6 defensive-pub · 8 no.** The posture holds — solid, shipped,
often security-positive engineering, but **zero disproven-hypothesis-with-data and zero novel mechanism**.

## Ranking table

| R&D | Name | Description | Using it | ZT | Paper? |
|-----|------|-------------|----------|----|--------|
| 0100 | Pre-build fail-closed threat model of web-* stubs | Threat model of the 6 web-* stub packages → deny-by-default invariants (escape/sanitise/redirect/gesture) mapped to OWASP/CWE/NIST + the LLN-WEB-* series + SPEC acceptance skeletons | SHIPPED | 93 | **NO** |
| 0101 | DSS.wasm Wasmtime-TCB lowering contract | DESIGN-ONLY spec to lower the TS "Tower" into a real DSS.wasm Wasmtime TCB (in-WASM vs shim, host-as-byte-mover, 18 acceptance tests) | DESIGN-ONLY | 88 | **NO** |
| 0102 | .lmanifest hybrid Ed25519+ML-DSA-65 signing | Wires the hybrid signer into the .lmanifest build/verify/run path — both-halves-required classical+PQ admission signature, fail-closed in the certified profile | SHIPPED | 88 | defensive-pub |
| 0103 | secrets{} body retention + signed rotation obligation (#110) | Parser retains the secrets{} credential/rotation body; manifest emits a signed secret-rotation ProofObligation — closes the #110 fail-open body-drop | SHIPPED | 90 | **NO** |
| 0104 | env.tmf sealed secrets (`@logicn/ext-secrets-tmf`) | Secrets as encrypted-at-rest sections in the .tmf container (KEM-DEM X25519+ML-KEM-768 / AES-256-GCM), decrypt-in-zeroed-arena, fail-closed K3 loader | SHIPPED | 74 | defensive-pub |
| 0105 | Flow-kind tier floor (LLN-TIER-001) | Compile-time pass flooring a flow's governance tier to "secure" when its effects touch any of 21 secure-required effects — closes an under-tiered fail-open | SHIPPED | 93 | defensive-pub |
| 0106 | Photonic sync/async/third-type tri-wavelength assessment | Claim-by-claim grounding of an MBQC "third-type" tri-wavelength concept; classifies each claim grounded/aspirational-HW/debunked | DESIGN-ONLY | 88 | **NO** |
| 0107 | Volumetric/spatial balanced-ternary tensor computing | Honest grounding of the 3D phase-encoded tensor-optics note (holographic/MBQC/Grover) vs the shipped substrate corpus | ABSORBED | 88 | **NO** |
| 0108 | Data-types taxonomy & type-system coverage grounding | Adversarial grounding of a CS data-type taxonomy + "what LogicN ships vs omits" (verifies ~95% snapshot) | DESIGN-ONLY | 88 | **NO** |
| 0109 | Resolution/collapse — the "genuine third" delivery paradigm | Grounded model + red-team + hybrid benchmark of collapse-the-K3-possibility-space-at-the-boundary-first (the only *measured* row: N=200k, 100% leak-prevention, +2.2ns) | DESIGN-ONLY | 88 | defensive-pub |
| 0110 | WORK-WITH-IT corpus forward-design map (0001–0109) | Corpus-wide triage classifying every prior finding BUILDABLE-NOW / FORWARD / HARD-WALL under the two permanent fences | ABSORBED | 96 | **NO** |
| 0111 | Affine consume-once typestate passport | LLN-AFFINE-001 (consumed passport can't be re-used) + LLN-PASSPORT-002 (state-skip) on the value-state-checker; Raw→Verified→Authorized→Sealed | SHIPPED | 88 | defensive-pub |
| 0112 | Ternary tombstone + erase-on-trap + .lcache loader | Segment-correct trit REJECT-fill on free + erase-on-trap; .lcache loader spec-only (R1 deferred) | PARTIAL | 88 | **NO** |
| 0113 | Int64 differential vacuous-pass proof | rd-0113/0113b: proves a small-only Int64 0014 differential passes *vacuously*; the (2^53,2^63) slice is the sole discriminator (walker≡WASM≡BigInt 12/12) | DESIGN-ONLY | 88 | defensive-pub |

## Why 0 papers (the bar, applied)

- **defensive-pub (6):** 0102, 0104, 0105, 0109, 0111, 0113 — each has a real shipped/measured arm but
  **re-derives established art** (hybrid PQ composite sigs; SOPS/Sealed-Secrets; effect-inference +
  least-privilege lattice; authorize-before-act / PEP-deny-the-unknown; affine/typestate; boundary-value
  differential testing). A datapoint confirming a known law ⇒ at most defensive-pub.
- **no (8):** 0100/0101/0103/0106/0107/0108/0110/0112 — design/grounding/roadmap notes or fail-open fixes
  with **no measured arm at all** (and no novel mechanism).
- **Closest near-miss:** 0109 is the only item with a genuine *measured* arm against shipped code, but the
  measurement *confirms* NIST SP 800-207 / 2PC reserve-then-commit — caps at defensive-pub.

**Consolidated 0001–0113: 0 papers.** This is the *expected* outcome of the standing posture — LogicN adds
no new crypto/science by design, so the yield is a stack of timestamped defensive-pub notes, not papers.
The instrument everywhere remains **defensive-publication + Apache-2.0**.

*Source: workflow `wf_1ed51b00-cf7`; consistent with [logicn-paper-worthiness-assessment-2026-06-23.md] (0001–0099) and the standing [IP/paper strategy].*

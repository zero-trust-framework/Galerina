# TLSTP + B8 Build Guide — Index & the Hard Path to Go Through

The adopted 0065–0070 transport/auth findings, each written up as a standalone KB build-guide (maths in detail +
worked examples + a hard build path). This index ties them together and gives the **single ordered build path** —
with the genuinely hard parts called out — to take the cluster from R&D to a running governed transport.

**Binding posture (all docs):** crypto/KDF/cipher/signature/key bytes stay **Binary** (digital); photonics/analog
feed ONLY a K3 governance verdict via `vAnd` (degrade-only), never a key; fail-closed (unknown→DENY); no perf claim
without a named-machine bench; honest tiering (buildable-now / substrate-gated #102-106 / aspirational-HW).

## The per-finding build guides
| # | Doc | Core maths |
|---|---|---|
| S1 | [cert/channel-validation gate](logicn-tlstp-s1-cert-gate.md) | K3 lattice + `vAnd=min` truth table; `cert_verdict=min{pin,chain,expiry,revocation}`; fail-closed soundness proof; revocation-unknown→DENY |
| S2 | [asymmetric KEM-rekeying ratchet](logicn-tlstp-s2-kem-ratchet.md) | SHAKE256 forward-secret chain + X25519+ML-KEM-768 rekey for post-compromise security; the Ternary-Ratchet refutation |
| S3 | [digital FEC over opaque AEAD](logicn-tlstp-s3-digital-fec.md) | Reed–Solomon MDS over GF(2⁸); `recover from any k of n`; erasure budget `e≤m`; authenticate-then-repair |
| S4 | [Recovering FSM above K3](logicn-tlstp-s4-recovering-fsm.md) | the {Established/Recovering/Closed} FSM + transition table; one state ABOVE the single K3 trit (no parallel trit) |
| S5 | [opt-in morphing frames](logicn-tlstp-s5-morphing-frames.md) | keystream-driven length sampling; size/boundary obfuscation; honest limit (not timing/volume) |
| 0069 | [DTM degrade-only K3 telemetry](logicn-tlstp-0069-dtm-degrade-only.md) | the No-Coercion theorem `e=vAnd(t*,r)≤t*` in full; discretizer codomain `{−1,0}`; threshold-independence |
| 0070 | [photonic TamperTrust resolver](logicn-tlstp-0070-tampertrust.md) | deviation→trit; NMR tolerance voting; No-Coercion vs a spoofed signal; `cnf`-row under the digital sig |
| B8 | [governed HTTP transport adapter](logicn-b8-governed-transport.md) | the request path as a conjunction of K3 gate verdicts; tiering; the 0068 regular-API threat→mitigation table |

## The hard path to go through (ordered)

**Phase 0 — prerequisites (do before any transport code).**
- **Fix the capsule signing-spec contradiction** (§2 RFC-9964-direct vs §8 SHA-256-pre-hash) — bridge task **0071**.
  *Hard part:* it blocks any capsule-backed identity token reader; pick one method and reconcile before S1's `cnf`
  binding relies on it.
- Stand up the **0050 blind-observability exporter** (net-new) — the carrier 0069 rides on. *Hard part:* it's the
  one unbuilt prerequisite for DTM; keep it strictly read-only / structure-not-data.

**Phase 1 — the build-first (highest leverage, lowest risk).**
- **S1 — the K3 cert/channel-validation gate.** *Hard part:* consume a *library-validated* chain (no ASN.1/path
  re-impl); map "responder unreachable" to `revocation_fresh = 0` so the algebra (`min`) forces DENY; wire it to
  replace the `kernel.ts:307` presence-only auth. Works for both TLSTP and vanilla HTTPS — build it once.

**Phase 2 — the security core.**
- **S4 Recovering FSM** (cheap: one state above K3; timeout→Erase, →Established only on a fresh +1) **+**
  **S2 asymmetric KEM ratchet** (forward + post-compromise secrecy). *Hard part (S2):* the rekey secret is the KEM
  shared secret (Binary) — never analog entropy; mandatory key erasure after each step.

**Phase 3 — degrade-only governance + the live listener.**
- **0069 DTM** (float in telemetry → trit via `vAnd`, degrade-only) **+ #211 inbound-listener hardening**
  (timeout/rate-limit/body-cap/slowloris/SecurityPosture). *Hard part (0069):* the discretizer codomain must exclude
  `+1` so the No-Coercion bound holds for any threshold; a failed AEAD tag is a hard −1, never a "low score."

**Phase 4 — availability / metadata (each behind a named-machine bench).**
- **S3 digital FEC** (under the AEAD) **+ S5 morphing** (opt-in capability). *Hard part (S3):* FEC must sit strictly
  *under* the AEAD — repair ciphertext only, never "request missing entropy" (that re-opens `LLN-PRIVACY-002`).
  *Hard part (S5):* a morphed frame must *replace* any cleartext routing tag, never accompany it.

**Phase 5 — defense-in-depth (governance side buildable; sensing aspirational).**
- **0070 TamperTrust resolver** (deviation→trit→`vAnd`→`decideAtBoundary`, bound as a `cnf` row UNDER the digital
  signature). *Hard part:* keep it degrade-only and never sole; the optical front-end is aspirational-HW — build only
  the governance resolver (emulator-driven) now.

**B8 — the adapter that carries it all.** Build order (0066's first-3): (1) bind shipped content-addressed admission
to the handshake + S1; (2) the raw-byte host shim below the verdict + idempotency-gated 0-RTT; (3) Recovering FSM +
ECH/OHTTP for SNI. *Hard part:* the in-sandbox-termination **isolation guarantee** is **aspirational** until
`#102-106` (DRCM/DSS.wasm beyond the 115-byte stub) — do not claim it as settled; the shipped, citable half is the
kernel anti-middleware pipeline + one-time fail-closed admission.

**Across the whole path:** crypto stays Binary; every gate composes by `vAnd` (so adding a factor can only tighten,
never loosen); unknown→DENY everywhere. The closure/verification tasks (0071–0077) for the manual R&D session cover
the residual spec/proof/record threads.

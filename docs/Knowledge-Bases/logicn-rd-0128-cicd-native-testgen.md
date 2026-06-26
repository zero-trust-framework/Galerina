# RD-0128 — CI/CD-native auto-test-generation (owner note 67)

**Date:** 2026-06-26 · **Method:** prove + ZT-score workflow (`w7vbl61oj`, 8 agents) + runnable proof
`scripts/rd-0128-cicd-native-testgen-proof.mjs` (27/27) · **Verdict:** all four claims **TRACK** — note 67 is
~81% a re-derivation of shipped machinery dressed in refused-framing marketing. The one net-new, ZT-positive,
buildable-now seam is a **signed `TestWitness` receipt** bound through the *existing* attestation/fuse envelope.

This follows the owner methodology (every perf/feature note gets an **RD number + a runnable proof + a numeric
ZT score**, not a triage row — see [logicn-refused-and-partial-op-design]).

## Verdict table

| Claim | Shipped | Net-new (small) | ZT | Verdict |
|---|---|---|---|---|
| **1 — Ternary 3-lane fuzz** (+1 invariant / 0 friction / −1 breach) | 85% | Fill `renderFaultInjectionTAP`'s `# TODO inject fault` (test-generator.ts:326) with executable assertions; add a `logicn test --generate` CLI; wire the 0-lane noise to the shipped photonic-emulator. **No new generators, no symbolic engine.** | 6.5 | TRACK |
| **2 — Substrate mocks** from `substrate{}` | 80% | A `logicn test --generate` shim binding `substrate{}` → shipped `LANE_PROFILES` + `PhotonicEmulatorBridge` as a mock harness. **Correction:** mock at the FIXED noise floor and ASSERT the declared tolerance — deriving noise *from* tolerance inverts substrate-inference's fixed floor and is **fail-open**. | 5.0 | TRACK |
| **3 — AI-gen referee** (capability-intersection + no-coercion + feedback JSON) | 85% | Bind the shipped `CapabilityLeakProof` JSON as a signed receipt; thin `logicn validate --ai-module` loop (run governance-verifier → `buildLeakProof` → `canonicalLeakProof`). **All analysis already ships.** | 7.5 | TRACK |
| **4 — CI/CD proof-assert** (`logicn test --ci`) | 72% | A `logicn test` subcommand calling `generateContractTestSuite`; a `TestWitness` type signed through the existing bridge-attestation envelope; an OPTIONAL fuse-loader policy admitting bytecode only when a witness over the same `wasmSha256` verifies. **Sub-claim (1) O(1)-delta + incremental-AST-cache do not exist and are refuted.** | 6.0 | TRACK |

**Overall ≈ 81% shipped-vs-vision.** Shipped substrate that the claims re-derive: the three-lane generator +
`BOUNDARY_VALUES` table (test-generator.ts), the dual-substrate `parity-conformance.ts`, fuse-loader
refuse-to-boot, `governance-verifier.ts` capability intersection, the exhaustively-proven No-Coercion meet
(`governAiProposal`, effective = min(core, ai)), and deterministic `canonicalLeakProof`.

## Highest-value honest build (task #57's first increment)

**Bind a signed `TestWitness` receipt into the existing tower-citizen attestation / fuse-loader envelope** —
the Claim 3 + Claim 4 net-new intersection. Reuses 100% shipped crypto (hybrid Ed25519 + ML-DSA-65
`signManifest`/`verifyAttestation`/`attestationHash`) and shipped determinism (`canonicalLeakProof`,
`lln.leakproof.v1`). Extends fail-closed refuse-to-boot from *"bytecode is signed"* → *"bytecode is signed AND
its governance-test/leak receipt verifies over the same `wasmSha256`."* No new crypto, analysis, or coverage
claim invented — it banks the already-proven No-Coercion property into a non-repudiable, attestable artifact and
promotes the comment-only `TestWitness` aspiration (leak-proof.ts:12,145) into a real signed type.

**First increment (type + signing only; defer CLI/fuse/TAP-fill):**
1. `leak-proof.ts`: `interface TestWitness { schema: 'lln.testwitness.v1'; wasmSha256; leakProof: CapabilityLeakProof; suiteDigest }` + `buildTestWitness(wasmSha256, leak, suite)` where `suiteDigest` = sha256 over a stable-key-order serialization of `generateContractTestSuite` output (reuse the canonical serializer pattern; invent no new one).
2. `canonicalTestWitness(w)` (same stable-order discipline as `canonicalLeakProof`) as the signing pre-image.
3. Sign through the EXISTING envelope only — feed `canonicalTestWitness(w)` to `attestationHash`/`signManifest`; add NO new keys/crypto.
4. Tests: a tampered `suiteDigest`/`wasmSha256` MUST fail verification (deny-by-default); a malformed/empty `leakProof` MUST NOT silently verify as clean; sign→verify round-trip passes.

## Refused / overclaim items — keep OUT of all docs and copy

- **"O(1) Delta Test"** — REFUTED. An incremental signature diff is Θ(changed sub-graph + reverse-reachability closure); a single hash-equality probe is O(1) *per-probe* only, amortized over a Θ(|V|+|E|) precompute (latency ≠ work). Same family as the already-settled README L78 / rd-0055 P2 / rd-aot D2 refutations.
- **"cutting CI to milliseconds"** — unsubstantiated marketing on refused instant-framing. CI wall time has a compile + test + I/O floor (an I/O round-trip alone is ~tens of ms by seek/RTT) LogicN cannot remove; the substrate ceiling is ~1.9×. Say "replaces an expensive re-run with a cheap verification for governed steps."
- **"mathematically derive exact boundary conditions for 100% path coverage" / "no input guessing"** — UNDECIDABLE in general (path feasibility ⇒ halting; path count 2^k in branches / unbounded in loops; SMT over nonlinear Float/Decimal predicates non-computable). The shipped generator is finite **table lookup** over `BOUNDARY_VALUES` — principled, but it IS curated input guessing. Honest claim: *"exhaustive over DECLARED edges + 3 finite governance lanes."*
- **"symbolic execution auto-generates"** — no symbolic/SMT/Z3 engine ships; the lone "SMT" reference is governance-verifier's forward-looking *"Phase 4 (SMT solver) will handle…"* comment. Generation is table lookup + diagnostic projection.
- **"the runner tries privilege-escalation attacks"** — implies an active red-team/fuzz runner; the actual mechanism is STATIC diagnostic projection + K3 min-meet, and the lone inject path is `# TODO inject fault` (unimplemented). It is a static referee, not a runner.
- **"precise mathematical proof of the leak"** — the per-leak artifact is a normalized diagnostic projection, not a formal/SMT proof. Only the No-Coercion THEOREM is proven exhaustively.
- **"autonomous self-healing pipeline"** — undecidable that an LLM patch removes the leak without adding a new one; no loop is wired. LogicN guarantees the deny-by-default GATE, not convergence. Taken literally it is ZT-NEGATIVE (Goodharting a gate). State the gate, not the healing.
- **"production refuses to boot without a TestWitness.manifest"** — overstates scope: the shipped fuse-loader boot-gate attests BYTECODE; after this build the witness check is an OPTIONAL admission policy.
- **"Incremental AST Cache"** — NOT BUILT (zero signature/fingerprint/diff/cache code in `logicn-devtools-graph-project`). **`logicn test --ci`** — no such CLI exists.
- **0-lane / 0 = INDETERMINATE as a "coverage cell"** — the 0 lane is friction/fault-injection (a K3 deny verdict), NOT a path-coverage proof and NOT mask-0. Keep the presence channel separate; never alias.

## Recommendation

Build only the single thin integration seam (the signed `TestWitness` receipt). Everything headline is either
undecidable, unbuilt, or refused instant/O(1)/beats-silicon framing — shipping any of it as a guarantee would
itself be a fail-open. Document only the honest scope: exhaustive over DECLARED edges + 3 finite governance
lanes; a static referee (not a runner) emitting a deterministic diagnostic (not a proof); a deny-by-default gate
(not self-healing).

See also: [logicn-contract-driven-generation], [logicn-rd-0127-framework-friendly-runtime],
[logicn-refused-and-partial-op-design], [logicn-quantum-resistance-posture].

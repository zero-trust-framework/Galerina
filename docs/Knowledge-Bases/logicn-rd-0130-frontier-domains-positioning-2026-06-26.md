# RD-0130 — Frontier-domains positioning sweep (notes/63-recap-1..8)

**Date:** 2026-06-26 · **Source:** owner notes `notes/63-recap-1.md … 63-recap-8.md` (LLM market-positioning brainstorms; recap-5/6/7 substantially DUPLICATE recap-3/4/5) · **Method:** verify-before-build — every "LogicN natively dominates X" claim checked against ACTUAL shipped code by 3 parallel read-only agents, not taken from the notes. · **Verdict in one line:** ~⅓ re-derives shipped architecture, ~⅕ is sound net-new, ~⅓ is refused overclaim (CHERI-0-cycle / remote-self-destruct / photonic-physically-impossible), ~⅕ is honest-but-HW-gated positioning.

## Zero-trust score rubric (0–10, same convention as RD-0127)
- **7–10** SHIPPED & sound (it IS the deny-by-default architecture) · **5–7** NET-NEW, buildable, ZT-sound, in-bounds · **3–5** honest but HW-gated / no buildable artifact · **0–3** REFUTED / overclaim / fail-open / TCB-trap — keep OUT of docs & copy.

## The table

| # | Idea (owner's domain words) | Cluster | Verdict | ZT | Action |
|---|---|---|---|---|---|
| 1 | ZKP: native K3→R1CS / arithmetic-circuit compilation | Crypto/Privacy | **NET-NEW** (circuit codegen ABSENT; `logicn-ext-proof-snarkjs` is a sha256-commitment SCAFFOLD, no Groth16/R1CS); "ternary natively maps to finite fields → orders-of-magnitude" is UNVERIFIED (F_p ≠ balanced ternary) | 3 | TRACK. Honest path = finish the snarkjs Phase-2 Groth16 backend, NOT a ternary-circuit rewrite. Strip "orders of magnitude." |
| 2 | Capability-gated proof verification (`crypto.zkp.prove` token) | Crypto/Privacy | **RE-DERIVES SHIPPED** (effects{} + capability tokens + proof-graph already gate proof generation) | 7 | Mostly shipped; a `crypto.zkp.*` effect is a tiny add IF ZKP lands. |
| 3 | Side-channel: constant-time secret comparison | Crypto/Privacy | **SHIPPED** (`constantTimeStringEquals`, H7 regression, routes through `node:crypto.timingSafeEqual`) | 8 | Done. |
| 4 | Side-channel: jitter-free / power-uniform latency envelope, "side-channel physically impossible" | Crypto/Privacy | **NET-NEW + OVERCLAIM** (no envelope pass; "physically impossible" is the refused framing) | 4 | Buildable honest piece = a **constant-time lint** (flag secret-dependent branch/index, building on SealTaint+constantTimeEquals). Strip "physically impossible." |
| 5 | Clockless / asynchronous DITL silicon (+1/−1/0=NULL dual-rail) | Hardware | **POSITION, HW-GATED** (genuine vocabulary match; LogicN→WASM, no clockless target); "death of the global clock" = overclaim | 3 | Position in KB only; no build. Strip "death of the clock." |
| 6 | Hazard-free handshake / input-completeness invariants (clockless) | Hardware | **PARTIAL RE-DERIVE** (AST already does dependency/effect analysis) + HW-gated as a clockless guarantee | 3 | Track with #5. |
| 7 | CHERI VM-free multi-tenancy / "0-cycle enclave" / 60% cost cut | Hardware/Ops | **REFUTED** (CHERI is NOT a compile target — LogicN→WASM; layer-conflation per the CHERI R&D doc; "0-cycle"/"60%" = refused O(1)/beats-silicon). Real shipped thing = LLN-SUBSTRATE-005 compute-only fence | 1 | REFUTE. Keep the honest compute-only-fence framing; CHERI stays a below-LogicN host-TCB hardening NOTE. |
| 8 | CHERI zero-cost hardware bounds / "eliminate unsafe{}" | Hardware/Mem | **REFUTED** (same; "0-clock-cycle" = refused strip-checks/O(1) framing) | 1 | REFUTE/strip. |
| 9 | Radiation-resilient space computing (SEU→photonic failover) | Resilience | **POSITION + OVERCLAIM** (substrate-switch + NMR + photonic-emulator SHIPPED, but SEU/radiation handling is DESIGN-ONLY; "photons immune → mathematically guaranteed survival" = overclaim; emulator is software) | 3 | Position; strip "mathematically guaranteeing survival." Honest core = substrate-switch + NMR (shipped). |
| 10 | Active cyber-defence / decoy substrate / Moving-Target-Defence (return +1 "success" to the attacker) | Resilience/Sec | **TRACK** (re-derives the honeypot R&D #29 verdict; "route exploit to decoy lane" conflates K3 governance with deception; fail-open risk if the decoy leaks) | 3 | Cross-ref #29 honeypot verdict; deception is a separate layer, not core. |
| 11 | Energy-harvesting / precision-scale to available power | Resilience | **RE-DERIVE + HW-gated** (verified-approximation + degrade-only SHIPPED; power-monitoring trigger is net-new + needs a HW power input) | 4 | Position; shipped piece = verified approximation / substrate tolerance. |
| 12 | Kinetic-AI / cobot safety (AI-proposal vetted against geometric invariants) | Resilience | **RE-DERIVES SHIPPED** (AI-proposal safety + `invariant { ensure … }` LLN-INV-001..004 + ai.inference governance) | 6 | Buildable **example/demo** (like the gaming-substrate example). Good showcase. |
| 13 | Automated legal/compliance via compile-time invariants | Operational | **RE-DERIVES SHIPPED** (`invariant {}` enforced; governance graph; effects) — BUT data-residency/geofence rules are ABSENT | 7 | **BUILDABLE net-new:** a **data-residency / geofence policy** (`capability.data.<region>` + deny cross-region egress, on the shipped substrate+capability+invariant machinery). The standout. |
| 14 | Granular data monetisation / ephemeral data "rental" that self-destructs on the recipient's hardware | Operational | **REFUTED** (you cannot govern someone else's hardware — DRM-impossibility + cold-boot remanence per the ephemeral-secret R&D). Shipped piece = SealTaint + lease/TTL + arena-zero (host-side only) | 2 | REFUTE remote self-destruct; keep host-side ephemeral (shipped). |
| 15 | Continuous invisible DevSecOps / supply-chain audit via effects{} | Operational | **SHIPPED** (effect-checker deny-by-default, package-graph, attestation) | 8 | Positioning — already the reality. |
| 16 | Self-documenting topology / live governance graph export | Operational | **SHIPPED** (graph-command, project-graph, ProofGraph, signed LManifest) | 8 | Positioning — already the reality. |
| 17 | Continuous chaos engineering / deterministic friction injection | Resilience/Test | **SCAFFOLD** (test-generator emits fault OBLIGATIONS from `on_*_fault`; no RUNTIME injection harness) | 6 | **BUILDABLE net-new:** a deterministic runtime friction-injection harness (toggle a lane/node→timeout/trap in the test interpreter). Fail-closed test tool, in-bounds. |
| 18 | Linear/affine types matching Rust (move / use-after-free / double-free) | Memory-safety | **PARTIAL** — affine Passport consume-once SHIPPED (LLN-AFFINE-001/PASSPORT-002); general move/borrow/UAF = RESERVED codes LLN-MEMORY-001/002/003/007 with **NO emitter** (deferred) | 6 | The notes correctly name the gap. Honest: NOT yet Rust-parity on move/borrow. The move-checker is the real (large) build — already a tracked roadmap item. |
| 19 | Lattice-based lifetime / data-race prevention (ternary memory-state) | Memory-safety | **NET-NEW** (no borrow/lifetime checker; ternary-memory-state framing aspirational) | 4 | Part of #18's move-checker build. |
| 20 | Photonic particle-level immutability (Rowhammer-immune optical isolators) | Memory-safety | **DESIGN-ONLY + OVERCLAIM** ("physically impossible to subvert"; no photonic memory HW; WDM crosstalk is a software noise model) | 2 | Strip overclaim. |
| 21 | Zero-allocation WDM spatial memory splitting ("separated by laws of physics, zero overhead") | Memory-safety | **DESIGN-ONLY + OVERCLAIM** | 2 | Strip overclaim. |

## Overclaim register (must stay OUT of docs/copy — extends the two standing REFUSALS)
- "0-cycle enclave" / "0-clock-cycle bounds" (CHERI) → the refused **O(1)/beats-silicon** framing. CHERI is not a LogicN compile target.
- "data self-destructs on the recipient's hardware" → **DRM-impossibility**; cold-boot remanence; you cannot govern a remote TCB.
- "side-channel physically impossible" / "physically impossible to subvert" / "separated by the laws of physics" → photonic-magic; the emulator is software, ceiling ~1.9×.
- "death of the global clock" / "mathematically guaranteeing survival" through radiation → unbuildable certainty.
- "60% cloud cost cut" / "orders-of-magnitude ZKP compression" → unmeasured magnitude claims.

## Net-new buildable backlog (the real yield — ZT-sound, in-bounds)
1. **Data-residency / geofence policy** (#13) — `capability.data.<region>` + a verifier pass that denies region-tagged data reaching a cross-region effect/substrate. Highest value: a genuine compile-time-compliance win on already-shipped machinery. SECURITY/governance.
2. **Deterministic runtime friction-injection harness** (#17) — close the SCAFFOLD→real gap on chaos testing; build on shipped `on_*_fault` handlers + test-generator.
3. **Constant-time lint** (#4) — flag secret-dependent branching/indexing; build on shipped constantTimeEquals + SealTaint.
4. **Move/borrow checker** (#18/#19) — emit the RESERVED LLN-MEMORY-001/002/003/007 (the deferred Rust-parity gap; large).

## % audit (updated; anchors on the 2026-06-24-v2 audit = ~84% shippable / ~63% full-vision)

These 8 notes add **zero shippable code** — they inflate the *vision* denominator with frontier domains. So measuring "% of the notes' vision shipped" would mislead (it drops only because the goalposts moved). The honest, decision-useful numbers:

- **Shippable production core: unchanged at ~84%.** Nothing in RD-0130 is a regression or a newly-discovered core gap; the security fail-opens this session (GOV-019 single-source, limit/timeout/retry parser, #36 threat-model) are already folded into that figure.
- **RD-0130 frontier surface (21 deduped ideas): ~⅓ shipped/re-derive · ~⅕ net-new buildable · ~⅓ refused overclaim · ~⅕ HW-gated position.** Average ZT ≈ **4.0** (dragged down by the 7 overclaim/HW-gated rows; the buildable+shipped rows average ≈ 7).
- **Net new roadmap yield = 4 items** (data-residency policy · friction-injection harness · constant-time lint · move/borrow checker), of which **only the move/borrow checker is large**; the other three are small-to-medium and ZT-positive.
- **Biggest single honest gap surfaced:** memory-safety is **NOT yet Rust-parity** — only affine consume-once is enforced; LLN-MEMORY-001/002/003/007 (move/borrow/UAF) are reserved-with-no-emitter. The notes are right to flag it; it remains the largest deferred build.

**Roadmap delta:** add the 4 buildable items (below) to the backlog; everything else is position-or-strip. No change to the shippable-core %.

## Compliance with standing rules
- **Domain names kept** (aerospace / cyber-defence / ZKP / cobots / memory-safety), not relabelled to compute-primitive jargon.
- **Verify-before-build**: every shipped/refuted verdict carries file evidence (3 read-only agents).
- **Two REFUSALS honoured** + extended with the overclaim register above.
- **Duplicate notes flagged**: recap-5≡recap-6, recap-7 = recap-5+recap-4 concatenated.

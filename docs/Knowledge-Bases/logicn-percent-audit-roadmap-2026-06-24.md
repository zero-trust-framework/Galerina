# LogicN Completion Audit & Roadmap — 2026-06-24

**Method:** 12-subsystem parallel assessment + adversarial synthesis (workflow `wf_7988dfd9`, 13 agents).
**Snapshot:** graph 5,103 nodes / 5,757 edges / 2,570 files / 60 test-bearing packages · ~5,345 tests
(compiler 3,730/3,731 — the 1 fail is the env-local orphaned `.env.logicn-signing` keyId `9c2d7d45`, a
*correct* fail-closed verify, green on a clean checkout). Audits: **0 DEAD/RESERVED codes**; backlogs =
322 uncurated LLN-* / 473 doc-drift / 289 inline.

## Headline %-table

| Subsystem | Weight | % | One-line basis |
|---|---:|---:|---|
| stage-a-compiler | 5 | 92 | Full pipeline shipped+tested; `(unreachable)`-traps closed #167; WASM exec-parity beyond tokenize is #102-106-gated |
| runtime-tower-citizen | 5 | 88 | K3 + all G-gap primitives shipped (245+ tests); `tower-runtime.execute()` is a Phase-1 stub; sentinel wiring default-off |
| governance-rules-diagnostics | 4 | 72 | 51 rules enforced; **live false production-gate** (MEMORY-001/002/003/007 no emitter); 322 curation backlog |
| tmf-engine | 3 | 72 | Slices 1-3 + history-chain golden (49/49); **inclusion-proof unbuilt though fully unblocked**; slice-4 signing #34-gated |
| crypto-signing-custody | 5 | 82 | Hybrid Ed25519+ML-DSA-65 across 3 surfaces + revocation live; **fuse-loader runtime border is Ed25519-ONLY**; Shamir zero-impl |
| photonic-substrate-tripipe | 2 | 88 | A/B/C governance shipped+tested; rails have no live consumer; HW-gated by design |
| security-posture | 5 | 90 | value-state/taint + secret/privacy egress + tenant G1 shipped; Gate-6 sealed; TENANT-003 + medium backlog open; no CI |
| drcm-containment | 4 | 72 | 6 sentinels + Phases 1-4 (122 tests); not in a default-on path; vdpm.lln untested; Phases 5-7 #102-106-gated |
| devtools | 3 | 90 | Graph/benchmarks/audit-scripts shipped; gaps are stale artifacts + backlogs (mechanical) |
| framework-app-layer | 4 | 82 | Kernel 12-gate + fuse-loader + api-server + example-app (93/93); signed registry index unwired e2e; #102-106 makes isolation simulated |
| self-hosting-stageB | 5 | 78 | R6 parity + P9 tokenize real-WASM byte-parity; **real-WASM is tokenize-ONLY**, rest interpreted |
| docs-kb-provenance | 3 | 82 | 4-layer KB + machine-enforced diagnostic truthfulness; recurring count-drift + stale committed artifacts |

## Overall — two numbers
- **(a) Realistically-shippable software scope (excl. HW/#34/#102-106): ≈ 82.5%** (Σ weight×% = 3,962 ÷ 48).
- **(b) Toward the full long-term vision (incl. blocked scope): ≈ 63–66%.** The ~17-pt gap is the
  hardware/TCB/PQ-ceremony frontier — the hardest, last, 100%-blocked third (DSS.wasm under a Wasmtime TCB,
  in-sandbox isolation, real photonic/PPU, production PQ key-custody). Today these are 0–5% built (specs/comments).

> The *shippable* product is strong (~82%); the *"trust the math, down to a sealed WASM TCB"* end-state is
> ~two-thirds there, and the rest is gated on hardware/ceremony, not cleverer code.

## Roadmap — three horizons

### NOW (buildable, no hard blocker; ordered by value/effort)
1. **Fix the false production-gate** [S] — `production-check.ts` lists `LLN-MEMORY-001/002/003/007` as
   PRODUCTION_BLOCKERS but they have **no emitter** (verified: `index.ts` defines the constants only). The gate
   advertises memory-safety it never enforces. Mark RESERVED + drop from the blocker set (or wire detectors),
   and add a scanner cross-ref that fails when a production-blocking code is non-emittable. *Security credibility.*
2. **Run the regen trio + doc-count sync** [S] — `code-index → gen-code-registry → kb-index` clears the 3 STALE
   committed artifacts + 473 doc-drift hits.
3. **Build `ext-tmf/src/inclusion.ts`** [M] to `inclusion-proof-v0.md` + golden (verified absent) — completes the
   selective-disclosure half of slice 5; single highest-value *unblocked* tmf gap.
4. **Add ML-DSA verify to the fuse-loader runtime border** [M] — Ed25519-only today; mirror the proof-graph hybrid
   verify, gate on `LOGICN_MANIFEST_PROFILE=certified`. Closes the one place the *runtime* border lacks a PQ floor.
5. **Wire sentinel-egress + sentinel-time into AuditLogger by default** [M] (openTask #1) — makes the 6 sentinels
   live, not opt-in shelf-ware.
6. **Wire the signed central registry index e2e** [M] — generate+sign `registry-index.json`, inject `registryCheck`
   into the example-app host fuse path, add a "forked-but-signed pkg REFUSED" e2e test.
7. **R3 env-perf fix** [M] — replace `runtime.lln` O(n²) `envLookup` with a scoped map + perf regression.
8. **Taxonomy Stage E** [M] — split overloaded security codes one-code-one-fault (SECRET-002→004/005, etc.).

### NEXT (small owner decision / moderate effort)
- **LLN-TENANT-003** body-dataflow scope-threading (G1 proves effect-surface declaration only) — owner: promote
  `.tenant_scoped` marker → first-class `tenant_scoped {}` block.
- **Shamir M-of-N split/combine (G2-ext)** — algebra + 11/11 bench + frozen spec exist; **zero impl**. Completes
  the core-quorum/ext-execute custody pair.
- **Close host-fidelity parity hazards** #170 (UTF-16 vs codepoint) + #171 (in-band `-1` None sentinel) before
  extending P9 parity beyond tokenize.
- **Extend P9 real-WASM byte-parity tokenize → parser** [L].
- **Burn down the 322-entry curation backlog** + flip the #215 scanner to CI-enforcing.
- **Close #150** — template human-facing counts from `version.json` so prose can't drift.
- **Strip the kernel error-message leak** [S] + 401-vs-403 split.

### LATER (blocked by #34 / #102-106 / real HW / large effort)
- Production PQ key-custody ceremony (HSM/KMS, offline gen, PKI) — **#34** — unblocks tmf slice-4 signing, Governed
  Trust Capsule, mandatory-by-default hybrid.
- Real DSS.wasm under a Wasmtime TCB; DWI shared-nothing isolates; in-sandbox V_DPM/admission; Component-Model
  memory isolation (makes `fusePackages` admit untrusted peers) — **#102-106**.
- Real PPU reprogram seam consuming `admitPhotonicConfig`; measured throughput; epoch-attestation watchdog — **HW**.
- Full self-hosted-compiler-in-WASM (beyond tokenize); real B1→B2→B3 bootstrap ladder — **L + #102-106**.

## Adversarial findings — the claims NOT to repeat without an asterisk
1. **"Runs in WASM" is tokenize-ONLY.** Parser/type-checker/verifier/emitter/runtime run in the Stage-A TS
   interpreter. `verify-selfhost` is a GIR double-compile determinism check, *not* the B1→B2→B3 bootstrap.
2. **"PQ-signed end to end" — the runtime fusion border is Ed25519-only** (`fuse-loader.ts`). Hybrid is real on
   the *compiler* verify/run path + 3 attestation surfaces, but **not** at app fusion.
3. **"Enforces memory safety in production" is false** — the production gate's MEMORY blockers have no emitter.
4. **`tower-runtime.execute()` is a stub** — 88% is *governance-decision* completeness, not *execution*.
5. **DRCM sentinels + photonic rails are built+tested but unconsumed** (not on a default execution path).
6. **No CI exists (#149)** — every "gate runs clean" claim is manually enforced; the sealed Gate-6 audit tag is
   unpushed pending it. Highest-leverage single ops action.
7. **MISSED:** cross-flow / inter-procedural secret+taint propagation is fail-*loud* (warning), not fail-closed —
   a genuine residual zero-trust egress hole, not just a static-analysis footnote.

**Bottom line:** ~82% of the buildable software is real, tested, and mostly honest about its blockers. Fix #1–#3's
framing/code, wire CI (#149) to make every other green claim self-defending, and the headline is defensible
without caveats. Full per-subsystem detail: workflow output `wf_7988dfd9`.

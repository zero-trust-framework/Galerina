# TODO

Living task list. Authoritative forward view: `../ZTF-Knowledge-Bases/galerina-roadmap.md`.
Full continuation handoff: `RESUME-2026-07-01-continue.md`. Consistency rules + gates: `docs/CONSISTENCY_GATES.md`.

## ✅ Done — 2026-07-01 session (6 commits on `main`, local, NOT pushed)
- [x] Effect-vocabulary single-source-of-truth gate + internal reconcile — `3862ed8`
- [x] Muted-diagnostics gate (no security/gov code silenced silently) — `26e0d20`
- [x] Signing-boundary fail-open fix (plain `build` won't sign a violating artifact) — `c2a260d`
- [x] Inference-set SoT reconcile (dead non-canonical effect names) — `f2b04c4`
- [x] `.gate` IR reference example set (`docs/examples/gate/`) — `eee6c02`
- [x] Fix pre-existing `tests:patterns` failures + `docs/CONSISTENCY_GATES.md` — `452c9a7`
- [x] Roadmap refreshed (`galerina-roadmap.md`); RD-0231 absorbed (proofs 26/26 + 23/23)

## 🔲 Next (short-term)
- [ ] **Commit 2 — effect↔capability reconciliation** (security-core; see RESUME §NEXT + CONSISTENCY_GATES "pending"):
      add `ledger.*`/`storage.*` canonical families; assign V_DPM bits to `payment.charge`/`pii.*`/`phi.*`
      (today `vdpmBit -1` → not runtime-enforceable); reconcile `EFFECT_TO_CAPABILITY` + Stage-A/B `knownEffects`;
      fix KB registry + `.graph` SPEC `effect_fam` → `audit-effect-canonicality --strict` clean; extend the audit to gate them.
- [ ] Wire BOTH RD-0231 proofs into keep-green.
- [ ] `.graph` A/B fair re-run (parser `tools/graph-check.mjs` exists) → ship decision.
- [ ] Push the 6 commits to `origin/main` (owner OK required).

## 🔲 Owner-gated (surface; do not build without GO)
- [ ] RD-0231 build spike (~3–5d): unify GIR + GovernanceGraph into ONE signed IR (the `.gate` IR).
- [ ] OSS top-3: freivalds-verifier · k3-decision · signed-index-sidecar.
- [ ] `.gate` format refinements (protected params · contract-section fields · raw→redacted lifecycle · domain-effect bits).
- [ ] Runtime-planning roadmap: track the USES/USEDBY dep-graph (incremental recompute, lazy exec, cache-invalidation) — runtime axis, not security.

## 🔲 Long-term / carried forward (not re-verified 2026-07-01)
- [ ] DSS.wasm (#102–106); post-P9 enhancements; CI secret-scan (residual of the #149 revocation).

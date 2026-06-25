# Benchmark — does "supplying a graph alongside the WASM" help in production? (2026-06-25)

Owner asked R&D to run a **separate, isolated research test area** (a dedicated git worktree, not touching
the main checkout) to **measure the benefit of "Graph + WASM (production)"**. Done — a benchmark agent ported
the *real* production functions and measured with-graph vs without-graph admission across the real package-size
spectrum, honesty-bar enforced. Bench code preserved at
[`graph-wasm-admission-bench/`](https://github.com/zero-trust-framework/R-AND-D) in the R-AND-D repo
(`bench.mjs` + `lib-graph.mjs` + `results.json`); node v24.16.0 / win32, 200 iters/scenario, `hrtime.bigint()`,
medians + p10..p90.

> **One-line verdict:** as a **load-time** artifact the graph is **net-neutral-to-marginal** (production already
> uses the *signed manifest* as a precomputed capability lookup at load — it never re-scans), but as a **build/CI
> closure-check** artifact it is a **clean 6×–70× win that grows with size**, and for **policy-drift detection**
> it is an **O(1) lookup vs an O(source-bytes) re-scan**. Ship it **signed + hash-bound + fail-closed**, as a CI/
> admission-*policy* artifact — **not** as a load-time replacement for the wasm-hash gate.

---

## The grounding correction that reframes the whole question

The benchmark first read the *actual* load path — `loadAndVerifyPackage` in
`packages-logicn/logicn-framework-app-kernel/src/fuse-loader.ts` — and found:

**The production admission gate does NOT re-derive the import/capability closure at load.** It runs only:
- **Gate 1** — `sha256(wasm)` vs the signed manifest;
- **Gate 2** — one Ed25519 `verify(manifest)`;
- **Gate 2b** — revocation `Set.has`.

The capability closure comes from the **already-signed manifest's `fuse.capabilities`** — i.e. **it is already a
precomputed lookup today**, not a runtime re-scan. The expensive source re-scan (`scanPackage` → `buildGraph` →
boundary allowlist) is a **build-time / CI tool**, never on the load path. So "ship a precomputed graph to avoid
re-deriving the closure at load" is benchmarked honestly **as a model** (re-scan-from-source vs read-precomputed),
because the load path the owner pictured re-deriving *already doesn't*.

---

## Results

### H1 — admission/verification cost + H3 — the graph's own cost

| scenario | files | srcKB | extDeps | re-derive (WITHOUT) | read+1 sig (WITH) | speedup | graph bytes | +1 Ed25519 |
|---|---|---|---|---|---|---|---|---|
| tiny (auth) | 6 | 14.7 | 0 | 1.12 ms (1.08–1.26) | 0.184 ms | **6.1×** | 902 B | 0.10 ms |
| small (core-logic) | 21 | 57.0 | 0 | 4.00 ms (3.85–4.24) | 0.207 ms | **19.4×** | 5.8 KB | 0.12 ms |
| medium (tower-citizen) | 20 | 197.7 | 6 | 3.92 ms (3.74–4.25) | 0.209 ms | **18.7×** | 6.3 KB | 0.12 ms |
| large (core-compiler) | 79 | 1973.6 | 14 | 22.0 ms (21–27) | 0.318 ms | **~70×** | 25.3 KB | 0.16 ms |

Both paths produce **identical violation sets** (`agree=true`). Re-derive cost scales with source bytes scanned
(15 KB→1.1 ms … 2 MB→22 ms); the precomputed read+verify stays near-flat (0.18→0.32 ms). **H3 overhead is tiny:**
graph payload 0.9–25 KB; the extra signature verify is **~0.1–0.16 ms** (one Ed25519 op). **Crossover:** the graph
pays back its ~0.1 ms verify the moment scanned source exceeds a few KB — i.e. for every real package here.

### Runtime gate anchor (what production pays per module today, graph or not)
Real `greeting.wasm` (77 B) + real signed manifest (1433 B): Gate 1 sha256 = **0.0012 ms**, Gate 2 Ed25519 =
**0.091 ms**, Gate 2b revocation = **0.0001 ms** → **~0.1 ms/module, already cheap.**

### H2 — out-of-allowlist / drift detection
Injected a real out-of-allowlist import (`import _evil from "exfiltrate-net"`) into a temp copy of `core-logic/src`:
- **WITHOUT graph** (re-scan tampered source): caught = **true**, **4.18 ms**.
- **WITH graph** (set-difference over precomputed deps): caught = **true**, **0.0001 ms** — ~**40,000×** faster.
- **HONEST CAVEAT (capability, not just speed):** a precomputed graph only catches what was recorded **at build
  time**. A *post-build source tamper* is invisible to the graph lookup alone — that case is caught by the
  **wasm-hash gate (Gate 1)**, which production already runs. So the graph accelerates **policy** drift detection
  ("is this declared dep in the allowlist?"), **not tamper** detection.

---

## Honest verdict

- **Load-time optimization → net-neutral-to-marginal (a small net cost).** The real load gate already uses the
  signed manifest (a precomputed lookup) at ~0.1 ms/module and never runs the 1–22 ms re-scan. A *second* signed
  graph to verify at load **adds** ~0.1 ms + 1–25 KB and saves nothing the manifest doesn't already give.
- **Build/CI optimization → a clear win that grows with size.** Where the closure *is* re-derived from source
  (the `package-graph`/boundary CI gate, #149), reading a precomputed signed graph is **6×–70×** faster (biggest
  absolute win on `core-compiler`: ~21 ms/check saved).
- **H2 policy-drift → real and large** (O(1) vs O(source-bytes)), but **bounded to build-recorded facts.**
- **H3 cost → negligible** (≤0.16 ms + ≤25 KB).

**Recommendation:** the graph's production value is as a **signed, diffable CI/admission-*policy* artifact** that
makes the allowlist closure explicit — **directly the payoff that #149 (`graph --check` CI) would bank** — **not**
a load-time replacement for the manifest/wasm-hash gate.

## Security framing (most-secure lens)
Shipping the graph is **confidentiality-free** — it is derived metadata over already-public code (no secret). If
it is **signed and hash-bound to the same manifest/wasm**, it **shrinks** the load-time attack surface by turning
the allowlist closure into an explicit, verifiable, diffable artifact instead of an implicit re-derivation. The
**inverse is the danger**: an **unsigned or stale** graph *trusted at load* would *grow* surface (a build-time
snapshot the loader believes over the actual module). Non-negotiable rule: **bind the graph to the wasm hash, and
fail-closed on mismatch — never trust the graph in place of Gate 1.**

## Forward actions
1. Feed this into **#149** — the `graph --check` CI job is exactly where the 6×–70× re-derive win lands; have it
   read the precomputed signed graph and fail on out-of-allowlist imports (and gitignore the 2 *derived* reports
   only in that same PR — per the graph-hygiene decision, never before).
2. If a precomputed graph is ever surfaced at load, it MUST be Ed25519-signed + sha256-bound to the wasm and
   **fail-closed on mismatch** — additive to Gate 1, never a substitute.
3. Bench code (verbatim port of the real `scanner`/`graph`/`reporter` functions + the harness) is preserved in
   R-AND-D `graph-wasm-admission-bench/`; port into `logicn-devtools-benchmarks` only if #149 proceeds.

*Source: isolated worktree benchmark, 2026-06-25 (agent run, hub-verified numbers). Companion:
[`logicn-rd-photonic-quantum-paging-graph-grounding-2026-06-25.md`](logicn-rd-photonic-quantum-paging-graph-grounding-2026-06-25.md)
Thread 4 (.graph hygiene) + the prior graph/GraphCast R&D verdict.*

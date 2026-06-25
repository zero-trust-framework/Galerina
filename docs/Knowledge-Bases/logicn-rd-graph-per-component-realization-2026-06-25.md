# Boundary-Graph: per-component realization audit — is each component's graph an improvement lever + a ZT control? (2026-06-25)

Owner asked: for **each component** LogicN has, R&D whether — given it already has a graph — that graph **(1)
would/does improve it** and **(2) helps against standard security issues / ZT**. Ran a per-component-class
workflow (`wf_55094049-3ee`, 8 class assessors + synthesis), grounded in the [Graph+WASM benchmark]
(logicn-rd-graph-wasm-admission-benchmark-2026-06-25.md), the [TS self-audit](logicn-self-audit-ts-40-issues-2026-06-25.md),
and the [graph-hygiene grounding](logicn-rd-photonic-quantum-paging-graph-grounding-2026-06-25.md) (Thread 4).

> **Headline:** every one of the 8 component classes (all 93 packages) **already ships a `.graph/`** — the
> question was never "add a graph," it's "is the graph it already has *realized*?" **Almost never.** **6/8**
> classes rate it an **under-used improvement lever**; **8/8** find it a **legitimate ZT control** that is
> **NOT enforced today** (every class is diff-only). The graph is *"a correctly-built, correctly-scoped,
> deny-by-default ZT artifact that is wired to nothing."* Value is **build/CI + drift + boundary enforcement —
> explicitly not a load-time speedup** (benchmark-refuted: the fuse-loader admits on the signed manifest's
> precomputed `fuse.capabilities`).

## The two answers (owner's literal sub-questions)

**(1) Would a graph improve the component? — Yes, on the build/CI + drift axis, and it's under-realized.**
Net-neutral at load, but a **6–70× win for the build/CI closure check** and **O(1)-vs-O(source-bytes) for
policy-drift detection**, largest where the surface is largest/most sensitive (compiler-core: 79 files/228
edges, also surfaces orphan modules + the `parser.ts` hub for a layering lint; crypto/bridge: tiniest borders
where one new import is the whole signal). Real for **6/8** classes, *latent* for the **2 stub classes**.
Blocker: nothing downstream consumes `package-graph.json` programmatically — it's "present but only human-read
via PR diff."

**(2) Helps against standard security issues / ZT? — Yes; the per-package deny-by-default `boundary-policy.json`
is the precise mitigation for out-of-allowlist import drift — but it is NOT a real control today because it is
unenforced.** It directly mitigates **60-3 dependency-confusion** (a malicious same-named/typosquatted specifier
surfaces as an out-of-allowlist edge) and **import-drift toward 60-6**; it caps but doesn't solve **60-4**
transitive vulns (direct border only) and doesn't address versions/pinning. Value concentrates on the **toxic
Tier-3 bridges** and **crypto/secrets** packages (a stray import there IS a supply-chain event) and the **DB
stubs** (canonical typosquatted-driver entry point). **Two fail-opens keep it diff-only:** (a) `graph --check`
(**#149**) is UNWIRED — nothing fails a build; (b) `reporter.ts:60-69` **re-baselines permissively when the
policy is missing** — delete one ~250-byte JSON → `BASELINE_CREATED` (a PASS) re-blesses every present import
(delete-to-launder).

## Per-class table

| Component class | Graph | Improvement lever | ZT control / enforced? | Priority |
|---|---|---|---|---|
| **Compiler core** `logicn-core-*` | yes | **yes** — highest-value re-derive (79f/228e/14ext); surfaces orphans + `parser.ts` hub | **yes** widest border; mitigates 60-3 not 60-6 · **enforced: NO** · allowlist polluted w/ 3 junk tokens | **high** |
| **Runtime/Kernel/Tower** | yes | **partial** — strong build lever; kernel `[]`; load benefit NONE | **yes** kernel-pulls-in-nothing invariant · **NO** · `tower-citizen/BOUNDARY.md` committed at **FAIL** (inert) | **high** |
| **Crypto/secrets/proof** `ext-secrets-*`,`ext-tmf`,`ext-proof-snarkjs` | yes | **yes** — tightest borders; **live drift:** snarkjs `^0.7.0` declared but graph `thirdpartyCount:0` | **yes** stray import = supply-chain event · **NO** · delete-policy disarms a *crypto* package | **high** |
| **External/substrate bridges (Tier-3)** | yes | **yes** — most likely to gain native edges; **live drift:** `ext-bridge-cpp/BOUNDARY.md` committed at **FAIL** | **yes** highest-value ZT class (lanes must never import core); `photonic-emulator []` sealed · **NO** | **high** |
| **Devtools** | yes | **yes** — engine `reporter.ts:52-86`+`cli.ts:74` DO exit-1 (wired in ONE place) | **yes** · **NO** — not in CI; **scanner blind spot:** `.mjs`-shipping `devtools-benchmarks` scans Files:0 = vacuous PASS | **high** |
| **Web stubs** `logicn-web-*` | yes (all-zero) | **partial** — only the drift tripwire | **partial** `[]` = strongest posture · **NO** | **low** |
| **DB stubs** `logicn-db-*` | yes (all-zero) | **partial** — latent until a driver lands | **yes** canonical typosquatted-driver entry point · **NO** | **medium** |
| **Auth/governance/misc** | yes | **yes** — auth/kernel sealed; **`example-app` graph BLIND** (scanned `.lln` src/, reports Files:0, missed `host/server.ts`) | **yes** — example-app `host/server.ts` deep-imports siblings via `../../…/dist/` = the 60-3 path-reach an enforced graph catches · **NO** · false-clean graph `logicn new app` COPIES | **high** |

## Cross-cutting actions (ordered)

**ALREADY REALIZED (don't redo):** the `.graph/` artifacts exist + are committed for all 93 packages; the
enforcement ENGINE already exit-1s correctly (`reporter.ts:52-86` + `cli.ts:74`). The gap is the *trigger* + two
scanner blind spots, **not** the gate logic.

**BUILD NOW (by leverage):**
1. **Wire `graph --check` into CI fail-closed (#149)** — the single highest-leverage action. Add an enforcing job
   to `conventions.yml` (alongside `gate-injection`/`tier-boundary`/`web-stub-guard`) that runs `--check` over
   every package and fails the PR on any out-of-allowlist import or missing policy. Converts the committed
   `tower-citizen` + `ext-bridge-cpp` FAILs from inert to blocking; fix `graph-all.mjs`'s terminal `exit(0)`.
2. **Close `reporter.ts:60-69` missing-policy fail-open** — under `--check`, a missing/unreadable
   `boundary-policy.json` must **FAIL**, never `BASELINE_CREATED`; gate baseline creation behind an explicit
   `--init`. Inseparable from #1 (without it #149 is bypassable by deleting one file).
3. **Fix the two scanner blind spots (gate-passes-because-it-sees-nothing):** extend `scanner.ts` to `.mjs/.js`
   (so `devtools-benchmarks` isn't a vacuous PASS); fix the **`example-app` false-clean** scan scope (highest
   urgency — it propagates to every new app via `logicn new app`).
4. **Sign + sha256-hash-bind the committed `.graph` artifacts** — tamper-evident, matches the benchmark's
   "signed, hash-bound, fail-closed" target. No confidentiality cost (derived metadata over public code). After
   #1–#2.

**TRACK (additive/owner-gated):** cross-check source-import border vs runtime `fuse.capabilities` at admission;
declared-deps↔graph cross-check (catches the snarkjs gap before first import); class invariants (`ext-bridge-*`/
`ext-photonic-*` allowlists may not contain `@logicn/core-*`; `fileCount===0` CI invariant for stay-stub
`web-*`); scrub the 3 junk specifiers (`${fn.name}`,`${imp.module}`,`memory`) from the core-compiler allowlist +
fix the scanner so WAT-codegen strings aren't extracted as imports; repair the `ext-bridge-cpp` baseline.

## Where the graph is NOT worth more effort (don't gold-plate)
The **stub classes** (`logicn-web-*`/`logicn-db-*`): their all-zero `.graph` is already the strongest
deny-by-default posture — don't hand-widen, don't build closure tooling for an empty graph; the cross-cutting
#149+reporter fix arms them automatically when they first ship code (plus a one-line `fileCount===0` invariant).
The **load-time axis everywhere** (benchmark-refuted). And **don't rebuild the enforcement engine** — it exit-1s
correctly; spend effort on the trigger + the two scanner blind spots.

*Source: workflow `wf_55094049-3ee` (2026-06-25), grounded in this session's benchmark + TS audit.*

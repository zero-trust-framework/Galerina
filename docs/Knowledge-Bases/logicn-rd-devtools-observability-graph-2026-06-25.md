# R&D — a dev-tools (non-production) graph that visualises + logs + audits what each component does (2026-06-25)

Owner asked: should we have a **dev-tools, non-production** graph that actively **visualises + logs** what's
happening inside each component, with an **audit**, so we can spot issues/errors + find improvements (e.g. run a
benchmark or other code and **analyse the results later**)? Possibly a **live** version too (acknowledged as maybe
a lot).

> **Verdict: YES — build it, dev-only, phased. It is the *safe* version of the runtime-graph idea.** The non-prod
> scoping dissolves the side-channel objection that killed the production live-perf-graph, and **~70% of the data
> substrate already ships** — the net-new is a unified dev-only recorder + visualiser/analyser over existing hooks.

## Why "dev-only" flips refuse → build
The earlier [runtime-graph R&D](logicn-rd-graph-secrets-and-runtime-graph-2026-06-25.md) **refused** a *production*
live performance graph because to be useful it must observe runtime **values** (which branch a secret took, which
keys are hot) — a side channel that leaks the secret. In **dev/non-production you run synthetic/test data, not real
secrets**, so observing values is exactly what a debugger/profiler does, and it's safe. The provenance/observability
angle was already verdicted "track, build it" — this is that.

## What already ships (don't rebuild — ~70%)
- **`logicn-governance-telemetry`** (`exposition.ts` + `server.ts`): `buildGovernanceSnapshot()` already captures
  per-run the **K3 INDETERMINATE/deny count, audit statuses, execution tiers (cache/bytecode/sync/egraph/tree),
  effects-observed-by-family, governance flags, proof obligations, queue depth, behavioral_fingerprint CFG-hash**;
  `isSafeLabel()` already enforces structure-not-data; there's a **pull-model scrape endpoint** (`server.ts`).
- **`AuditLogger`**: an **HMAC-chained, tamper-evident** ledger of `LOAD/EXEC/ERASE/TRAP/VIOLATION` events with
  correlationId + artifactHash + governancePass.
- **`logicn-devtools-benchmarks`**: runner + mem-sampler + compare + snapshot + `results/` + cross-language checksum.
- The **static project graph** (component structure + boundaries).

## Net-new (the actual ask)
| Piece | What | Effort |
|---|---|---|
| **Dev-only recorder** | tap the existing telemetry + audit hooks; write a per-run trace (`build/dev-trace/<run-id>.jsonl`): per component → {effect fired, K3 verdict, tier transition, step-count, timing, memory delta, substrate-verify result} | small (consumption, not new instrumentation) |
| **Visualiser + analyser** ("analyse later") | trace → **flow timeline**, **project graph annotated with live execution counts** (heat-map of what ran + where K3 denied + where it trapped), **diff between two runs** (regression spotting) | medium |
| **Benchmark overlay** | the runner already emits results; overlay + flag perf/memory regressions correlated with the trace | small |

This directly serves the rest of the session: it would make the very bugs the R&D surfaced (record field-order
divergence, the gate fail-opens) *visible* as "what actually happened inside each component."

## The live version
Less than feared: `server.ts` already exposes a pull stream, so a live view is mostly a dev UI polling it + tailing
the audit ledger — not a from-scratch build. But it's the lowest value-per-effort piece (record-and-replay is
better for "analyse later" and needs no running UI), so **phase it last**.

## The one rule that keeps it a tool, not a vulnerability
**Non-production by construction:** gate it with the same `LOGICN_PROFILE` resolver so it *physically cannot attach
in production*; it observes values *only* in dev with synthetic data; its trace artifacts are dev-only and **never
ship**; it inherits the audit ledger's tamper-evidence. That single line separates a great dev tool from the
production side channel.

## Recommendation (phased)
1. Dev-only recorder + static analyser (timeline + annotated graph + run-diff) — highest value, lowest risk.
2. Benchmark overlay + regression spotting.
3. Optional live tap over the existing pull endpoint.
All under the dev-only / profile-gated / artifacts-never-ship ZT scope.

*Source: owner R&D 2026-06-25, grounded in the shipped telemetry/audit/benchmark infra + the runtime-graph R&D.*

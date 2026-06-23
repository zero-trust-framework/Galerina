# @logicn/observability

Actuator-style **operational observability** for a LogicN app — the app-operator's
health/metrics/logs view, surfaced **through the App Kernel**.

It ships the base "are we up, how busy are we, what happened" surface every shipping
framework provides (cf. Spring Boot's `spring-boot-starter-actuator`):

- **Health / liveness / readiness** — named checks, aggregated, served as kernel routes.
- **App metrics** — request counts, latencies (bucketed percentiles), and error rates,
  per route and in aggregate.
- **Structured app logs** — leveled, structured records to a pluggable sink, with
  redaction of sensitive fields.

## Not the same thing as `@logicn/governance-telemetry`

| | `@logicn/observability` (this package) | `@logicn/governance-telemetry` |
|---|---|---|
| Lens | **Operational** — the app operator's health/metrics/logs | **Governance** — the contract's structure |
| Question it answers | "Is my app up? How fast? How many errors?" | "What does this app's governance state look like?" |
| Emits | request counts, latencies, error rates, health, logs | governance flags, effect families, verdict counts, declared budgets |
| Namespace | `app_*` (Prometheus opt-in) + JSON | `logicn_*` (Prometheus) |
| Rule | counts/latencies, never request payloads | "log the contract, not the payload" |
| Surface | **through the App Kernel** (routes + collector) | a separate read-only exporter port |

They are complementary base starters, not duplicates.

## Design posture

- **Fail-closed (the observability sense).** A metrics-sink failure must **never** break
  the request path. `MetricsCollector.record()` never throws (malformed input is counted
  in `droppedObservations`); a throwing log sink is isolated and counted; instrumentation
  re-throws a handler's error unchanged so the kernel's own fail-closed 500 still runs.
- **Fail-closed (the health sense).** When health is **unknown** it is reported `DOWN`,
  never `UP` — a check that throws, returns garbage, or hangs past its timeout is `DOWN`,
  so a readiness probe sheds load and a liveness probe can trigger a restart.
- **Zero ambient authority.** Importing or constructing this starts no server, opens no
  file, reads no env. The default log sink is in-memory; the clock and timers are
  injectable. A host opts *into* output channels explicitly.
- **Additive.** Nothing in `@logicn/framework-app-kernel` or `logicn-core` changes. The
  integration consumes only the kernel's already-exported seams (`RouteDeclaration[]`,
  `HandlerDispatch`, `AuditSink`). Type-only imports resolve against the kernel's built
  `dist/` (the same relative-dist convention `kernel.ts` itself uses, pending workspaces #155).
- **Bounded cardinality.** Distinct `(method, route)` series are capped (default 1000);
  beyond the cap, routes fold into a `__overflow__` sentinel — a buggy or hostile caller
  cannot blow up memory with unbounded route labels.

## Wiring it into the App Kernel

```ts
import { createAppKernel } from "@logicn/framework-app-kernel";
import { createObservability } from "@logicn/observability";

const obs = createObservability();

// Register what "ready to serve traffic" means for this app.
obs.registry.registerReadiness("db", async () => db.ping());
obs.registry.registerLiveness("event-loop", () => true);

const kernel = createAppKernel({
  routes:   [...appRoutes,   ...obs.routes],     // adds /health/live, /health/ready, /health, /metrics
  dispatch: obs.instrument({ ...appDispatch, ...obs.dispatch }), // times every handler → latency + counts
});

// Use the structured logger anywhere in the app:
obs.logger.info("server started", { port: 8080 });
```

Endpoints added (under an optional `basePath`):

| Method | Path | Auth | Result |
|---|---|---|---|
| GET | `/health/live` | public | `200` UP / `503` DOWN |
| GET | `/health/ready` | public | `200` UP / `503` DOWN |
| GET | `/health` | public | combined `200` / `503` |
| GET | `/metrics` | **required** (secure-by-default) | JSON `MetricsSnapshot` |
| GET | `/metrics/prometheus` | required (opt-in via `includePrometheus`) | `app_*` exposition text |

### Two ways to feed the metrics collector — pick one

- **`obs.instrument(dispatch)`** (recommended) wraps each handler to time it: counts,
  error rates **and latency**.
- **`obs.auditSink`** feeds the collector off the kernel's audit pipe (Tri-Pipe, off the
  critical path): counts and error rates, **no latency**. Use this if you can't wrap dispatch.

Do not use both on the same collector — they would double-count.

## Layout

```
package.json            @logicn/observability (private, ESM, Apache-2.0)
tsconfig.json           strict, NodeNext, declaration output to dist/
src/
  metrics.ts            MetricsCollector + renderMetricsPrometheus (app_* namespace)
  health.ts             HealthRegistry (liveness/readiness, fail-closed, timeouts)
  logger.ts             Logger + MemoryLogSink / JsonLineSink + redaction
  kernel-integration.ts observabilityRoutes / instrumentDispatch / metricsAuditSink
  observability.ts      createObservability — the one-call "starter" bundle
  index.ts              public surface
tests/                  node:test suites (incl. real end-to-end against the App Kernel)
```

## Build & test

```sh
# With TypeScript installed locally:
npm test            # typecheck + build + node --test

# With the repo's vendored compiler (no local install):
node ../logicn-tower-citizen/node_modules/typescript/lib/tsc.js -p tsconfig.json
node --test tests/*.test.mjs
```

> The kernel-integration tests import the real `createAppKernel` from
> `../../logicn-framework-app-kernel/dist/index.js`, so build that sibling package first.

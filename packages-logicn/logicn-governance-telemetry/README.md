# @logicn/governance-telemetry

Blind-observability exporter for LogicN apps. It streams a service's **governance + operational
STATE** — governance-flag mask bits, permitted/observed effect *families*, K3-INDETERMINATE
(unknown→deny) counts, audit-event statuses, governed-surface counts, declared budgets, queue
depth — to **Prometheus/OpenMetrics**, and **never the data the app processes**.

> Log the contract, not the payload. Zero-PII by construction.

## Why not a normal metrics exporter
A service mesh already gives you RED metrics (rate/errors/duration) and 503 load-shedding by
observing only structure. This exporter leads with the **governance-native** signals a mesh can't
see — the mask bits, effect families, proof obligations, the unknown→deny stream, and declared-budget
headroom. That's the unique, non-duplicable value.

## Structure, not data (the egress fence)
`renderPrometheus(snapshot)` is fenced by construction:
- only metrics in the fixed schema are emitted;
- every label **value** must pass a safe-token check (charset + length) or the series is **dropped**
  and counted in `logicn_telemetry_dropped_series_total` — so a path, email, URL, or raw effect
  argument can never egress even if a caller passes one;
- effects are reduced to their **family** (`network.outbound('https://…')` → `network`);
- flag / status / tier labels outside the closed vocabularies are dropped.

## Usage
```ts
import { startExporter } from "@logicn/governance-telemetry";

const handle = await startExporter({
  port: 9090,                 // metrics port, isolated from the app's ingress (e.g. 8080)
  ready: () => kernel.healthy, // /readyz → 503 when false (pod-level load shed)
  snapshot: () => ({          // build from already-produced state — NEVER payload data
    governanceFlags: decodeMask(manifest.governanceFlagsMask),
    allowedEffectsCount: manifest.allowedEffects.length,
    effectsObserved: auditByEffectFamily,
    governanceIndeterminateTotal: k3DenyCount,
    auditEvents: auditCountsByStatus,
    surface: antiAbuse.surface,
    declared: { memoryLimitBytes, maxConcurrent, arenaLimitMb },
  }),
});
```

Endpoints (metrics port): `GET /metrics`, `GET /healthz`, `GET /readyz`. Non-GET → 405; render
error → 500 (fail-closed). For Kubernetes, scrape with `prometheus.io/scrape: "true"`,
`prometheus.io/port: "9090"`.

## Status
Read-only exporter (R&D 0050, Slice 1). The host-side **snapshot adapter** (real `RuntimeManifest` /
`ExecutionAuditRecord` / `AntiAbuseReport` → `GovernanceSnapshot`) and the OTLP exporter are
follow-up slices; the fail-closed **backpressure handshake** (`503 + X-LogicN-State`) needs the
net-new kernel→runtime governance-deny bridge and is deferred (security-sensitive).

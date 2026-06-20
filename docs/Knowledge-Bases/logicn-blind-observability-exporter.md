# Blind-observability governance exporter (R&D 0050)

**Status:** DESIGN over SHIPPED-and-CITED state; the exporter itself is **NET-NEW (unbuilt)** · **Date:** 2026-06-19
· **Source:** R&D 0050 (`LogicN-R-AND-D/cloud-native/TELEMETRY-SIDECAR-RND-0050.md`) · **Verdict:** SOUND-WITH-FIXES
(two verifiers; fixes applied + lead-re-verified) · **Grounding bench** `telemetry-state-grounding-verify.mjs` **exit 0,
42/42** (16/16 cited state producers confirmed; exporter absence confirmed N1/N2/N3).

> ✅ **NAME — OWNER DECISION 2026-06-20: `logicn-governance-telemetry`.** (The 4-lens hub panel had recommended
> `logicn-governance-exporter` — Prometheus `-exporter` convention; the owner chose to keep "telemetry" for recognition
> while adding the "governance" differentiator — a deliberate middle path.) **"sidecar" is dropped from the name** — it's a
> deployment descriptor only. The body below says "the exporter" generically; the shipping artifact is
> `logicn-governance-telemetry`.

## What it is
A thin **read-only exporter** that maps a LogicN app's **already-produced governance / audit / enforcement / surface
state** to **Prometheus/OpenMetrics + OTLP**, so a clustered app tells Docker/K8s/the load-balancer **how it is
operating without revealing what it processes** — *blind observability on structure (masks, verdicts, effect-families,
counts), never data*. "Log the contract, not the payload" — zero-PII by construction.

## Buildable design
- **Exporter + ports.** Port-split at boot for isolation: **8080 ingress / 9090 metrics** (separate listeners — saturating
  8080 can't kill telemetry on 9090). Endpoints `GET /metrics` (:9090), `GET /healthz` (liveness), `GET /readyz`
  (readiness — flips unhealthy under sustained pressure so **K8s sheds load at the POD level**; this, not the response
  header, is the load-shedding mechanism). Zero-config K8s scrape annotations; Dockerfile `EXPOSE 8080 9090`. Ships as a
  sidecar container (shared Pod netns, reads app state via in-process `AuditSink`/localhost IPC) OR compiled into the App
  Kernel as a second listener — **sidecar-first** to keep blast radius separate.
- **State→metric mapping (~24 rows, each cited to `file:line`).** Rule: where `InferredObservability` already names a
  metric, reuse that exact name; everything else gets a `logicn_` prefix; counters end `_total`; governance dimensions are
  **labels, never raw values**. Build-time/declared facts → near-static gauges; runtime facts → live counters. **Honesty
  rule:** never let a reader confuse a *declared budget* (promise) with a *runtime measurement* (outcome).
- **The unique, non-duplicable value = governance-native metrics** (a service mesh already gives RED metrics + 503
  shedding at HTTP granularity, so those are DEFERRED to the mesh): `logicn_governance_flag` (0/1 per RuntimeManifest mask
  bit), `logicn_proof_obligations`/`logicn_allowed_effects`, `logicn_effects_observed_total` (by **effect_family**, never
  args), `logicn_flow_execution_tier_total` (cache|bytecode|sync|egraph|tree), **`logicn_governance_indeterminate_total`**
  (the K3-INDETERMINATE / unknown→deny stream), `logicn_audit_events_total` (Success|Denied|Failed|Unsafe|Warning),
  `logicn_surface_unaudited_network_flows` (the risk gauge), `logicn_declared_*` budget gauges,
  `logicn_inflight_requests`/`logicn_queue_depth`, `logicn_behavioral_fingerprint_info`. CBOR tag **407 ObservabilitySpan**
  → OTLP trace span (reserved slot, structure only).
  - *Verifier correction:* `InferredObservability` ships metric **NAMES only** (no value field) — so `latency_p99 /
    error_rate / throughput` are **exporter-DERIVED** from `ExecutionAuditRecord` (start/complete deltas at FLOW
    granularity, ok/error ratio), NOT read from shipped state.
- **Fail-closed backpressure handshake.** Extends the kernel's fixed non-bypassable gate sequence. On capacity pressure →
  `503 + X-LogicN-State: capacity`; on governance deny (`collapse(0)=deny`; unknown→deny) → `503 + X-LogicN-State:
  governance_deny`. **503 not 429** because 429 = "you the caller are over rate" while 503+header = "this instance refuses
  this class of work on policy" (LB-actionable). Additive — never relaxes the existing 429. Closed header vocab =
  `{capacity, governance_deny}`, no payload.
  - *Two-layer correction (verifier):* the **capacity arm is grounded** (thin restatement of the shipped concurrency
    gate). The **governance_deny arm is NET-NEW wiring** — `KernelErrorCode` is pure HTTP vocabulary carrying no
    three-valued verdict; the denial stream lives in the compiler `AuditWriter`, a different layer. Surfacing it needs a
    **new runtime-denial→kernel-response bridge that does not exist**. And 503+header is per-request (doesn't pull the pod)
    — `/readyz` is the pod-level shed; the header is the optional L7 enhancement (Envoy `retry_policy` on 503+header).
- **Structure-not-data egress fence (mandatory — the exporter is a NEW governed egress).** EXPORT ONLY masks (bit→0/1),
  verdict enums, effect **families** (namespace before the dot — `network`/`database`, never
  `network.outbound('https://customer-x/...')`), and counts. **NEVER** export payloads, secrets, embeddings, PII, raw
  effect args, or the kernel `AuditEvent.path`/`requestId`/`appliedDefaults`/`relaxations` (path embeds data e.g.
  `/users/{email}` — a data-egress AND cardinality-explosion vector; use the route **template/name**). **Closed-vocabulary
  allowlist is PRIMARY**; a `checkNoSecrets`-derived per-string scan is the BACKUP (note: `checkNoSecrets` is NOT a
  drop-in egress gate — it's a 17-key blocklist on the compiler `AuditEvent.metadata`, and the kernel `AuditEvent` has no
  metadata field). `behavioralFingerprint` is a CFG-path hash (structural identity) — safe as one `_info` series joined by
  build/version, never per-flow (cardinality).

## Naming (4-lens hub panel — strong consensus)
All four lenses independently said: **drop "telemetry"** (most generic word in observability; connotes "we ship your data
out" — the opposite of LogicN's pitch; and the backpressure surface isn't even read-only telemetry) and **drop "sidecar"
from the name** (it's a deploy topology, not the component's identity — all four returned `sidecarInName: false`). Use the
Prometheus convention **`<source>-exporter`** (node-exporter, kube-state-metrics): the `-exporter` suffix advertises
"scrape `/metrics`, read-only, runs next to the app" for free, so spend the differentiating word on the **source =
governance state**. → **Recommended: `logicn-governance-exporter`.** Sell the privacy angle in the tagline ("log the
contract, not the payload — zero-PII by construction") and reserve **"blind observability"** for the docs page title /
launch narrative; the security lens's `Blind Governance Exporter` is the alternative if the privacy guarantee should lead
the name. "sidecar" → a deployment descriptor in the README/Helm chart, not the artifact name.

## Honest tiers
- **Shipped + cited (42/42 bench):** RuntimeManifest + GovernanceFlags mask vocab; CBOR 407 ObservabilitySpan (reserved);
  LManifest behavioralFingerprint/derivedConstraints; InferredObservability (names only); ExecutionAuditRecord;
  ContractEnforcementRecord; AuditWriter `checkNoSecrets`; App-Kernel AuditSink + fail-closed gate seq (concurrency→429);
  route-defaults declared budgets; AntiAbuseReport surface counts.
- **Net-new (unbuilt):** the `/metrics`+`/healthz`+`/readyz` listeners; the state→metric mapper; the latency/error/throughput
  derivation; prom-client/OTLP serialization (confirmed ABSENT — N1); the X-LogicN-State handshake **incl. the
  kernel→runtime governance-deny bridge**; a kernel inFlight export hook (the live count is closure-local, exposed
  nowhere); the per-label allowlist redactor; the K3-INDETERMINATE counter stream; K8s packaging.
- **Excluded/aspirational:** "exact Resource Mass foresight" (R&D 0044 reduced it to the AOT compile-time bound, NOT a live
  per-request projection — stream declared budgets + queue depth, let HPA/KEDA project); crypto-attested signatures (until
  #34 — `governanceSignature` is a placeholder, must expose as `_info attested='false'`, never as attested); **any
  throughput/overhead perf number** (until measured on a named machine against the http-throughput harness — none made).

## Open decisions
1. **Prometheus plaintext vs OTLP → BOTH, plaintext-FIRST** (zero-config K8s scrape + Grafana; OTLP additive for
   Datadog/Dynatrace). 2. **Pull vs Push → PULL-first** (K8s-native, inbound-only egress = smaller attack surface). 3.
   **`governanceSignature` → PLACEHOLDER (#34), never present as attested.**

## Slice 1 SHIPPED 2026-06-20 — read-only exporter (owner green-lit)
New package **`@logicn/governance-telemetry`** (`packages-logicn/logicn-governance-telemetry/`):
- **`renderPrometheus(snapshot)`** — PURE serializer of a `GovernanceSnapshot` → Prometheus/OpenMetrics text. Emits the
  governance-native metrics (`logicn_governance_flag` per mask bit, `logicn_effects_observed_total{effect_family}`,
  `logicn_flow_execution_tier_total`, **`logicn_governance_indeterminate_total`** = the unknown→deny stream,
  `logicn_audit_events_total{status}`, `logicn_surface_*`, `logicn_declared_*` budgets,
  `logicn_behavioral_fingerprint_info`).
- **The egress fence (the security heart, closed-by-construction):** every label value must pass a safe-token check
  (charset + ≤80 len) or the series is **dropped and counted in `logicn_telemetry_dropped_series_total`**; effects are
  reduced to their **family** (`network.outbound('https://customer-x/…')` → `network`); flag/status/tier labels outside
  the closed vocab are dropped; non-finite numbers dropped. So a path/email/URL/effect-arg can never egress.
- **`startExporter({port, snapshot, ready})`** — thin read-only HTTP shell: `GET /metrics` (fenced text),
  `/healthz`, `/readyz` (503 → pod-level load shed); non-GET → 405; render error → 500 (fail-closed). Metrics port
  (9090) isolated from the app ingress.
- **+14 tests** (exposition fence + server smoke), all green. No deps (pure TS + node:http duck-typed).

**Deferred (next slices):** the host-side **snapshot adapter** (real `RuntimeManifest`/`ExecutionAuditRecord`/
`AntiAbuseReport` → `GovernanceSnapshot`); **OTLP** export; and the **`503 + X-LogicN-State` backpressure handshake**
— which needs the net-new **kernel→runtime governance-deny bridge** (security-sensitive, intentionally held back).

## ⛔ BUILD-IT-CORRECTLY GATE — owner zero-trust audit (2026-06-20) — MUST be answered before "done"
Slice 1 shipped a working exporter with a strong OUTBOUND egress fence, but it is **NOT yet a proper
LogicN-governed border** (it's a TS sidecar; the inbound side is unhardened). When this is rebuilt "correctly",
**every one of these owner questions must be explicitly answered** — they are acceptance criteria, not suggestions.
Zero-trust: the OS/host is treated as potentially compromised.

| # | Owner question | Slice-1 status | Standard to apply when building correctly |
|---|---|---|---|
| 1 | Is the logic treated as a **border** (inbound AND outbound)? | outbound ✅ / inbound ❌ | Both directions hardened; the listener is a governed boundary, not a bare server. |
| 2 | Are there **declared** details of what info IS / ISN'T provided? | ❌ (allowlist is TS code) | A **declared egress schema / data-dictionary** in a `contract`, not hand-coded TS. |
| 3 | Is the API written in **`.lln`** (governed), not TS? | ❌ (TS) | `.lln` governed flow. **CORRECTION 2026-06-20: NOT blocked on #145** — type-aware String semantics (`+`→`__str_concat`, `Char.toString`) is SHIPPED (verified: `wat-p9-tokenize-parity` 21/21, `wat-emitter.ts:881`). So Prometheus string-building compiles to WASM today. The real open question is **HTTP-I/O as a governed flow** (host socket via the `network.inbound` capability — the fuse demo already uses it), not strings. |
| 4 | `/src` + build → a **fusable signed `.wasm`** so apps can require it? | ❌ (TS `/src`, JS `/dist`, no wasm) | `logicn build --package` → signed `.wasm` + `.lmanifest`, **fusable via the 0052 multi-module system** (`network.inbound` cap, deny-by-default). |
| 5 | `secure flow` border? | ❌ | Request handler = a `secure flow`. |
| 6 | `contract {}`? | ❌ | Declared `effects` (`network.inbound`), `intent`, `limits {}`, egress schema (#2). |
| 7 | Appropriate **comments**? | TS only ❌ | LogicN three-tier: `//` human · `//lln:` generated · `;;` govComment. |
| 8 | **`unsafe`** for the border variable? | ❌ | Inbound `url`/`method`/headers = untrusted boundary data → `unsafe`, flow-owned (`LLN-SYNTAX-008`). |
| 9 | **Timeout, rate-limit, sanitise incoming** (best practice)? | only 405/404/500 ❌ | Request timeout, rate-limit, request/header **size caps**, slowloris guard, inbound sanitisation. |
| 10 | Run **under the App Kernel**? | ❌ (bare `node:http`) | Host it on the kernel's fixed fail-closed gate pipeline + `route-defaults` `limits{}` (`timeoutMs`/`rate`/`maxConcurrent`/`memoryBytes`) so it inherits them. |
| 11 | **Auth / mTLS** on `/metrics`? | ❌ | **OWNER DECISION needed** — mTLS/bearer on the metrics port, or rely on K8s network-policy isolation. |
| 12 | Zero-trust host posture? | ❌ | Honor `SecurityPosture` (`distrustHostTime`/`sealEgress`/`zeroizeAfterUse`) for the border. |

**Why Slice 1 skipped these (honest):** R&D 0050 scoped it sidecar-first/TS; the egress fence was the priority. The
inbound-hardening omission (9/10) has **no** excuse and is the do-now fix. **Buildable now:** items 1/9/10/12 (inbound
hardening + run-under-kernel + posture). **The `.lln` rewrite (3/4/5/6) is NOT blocked on #145** (strings are shipped —
correction above); its real open piece is expressing the **HTTP-I/O border as a governed `secure flow`** with a
`network.inbound` capability (conceptually unblocked — the fuse demo uses `network.inbound` — but non-trivial: the host
must provide the socket + scrape-request bridge). Item 11 is an owner decision.

## Forward line
The structure-not-data egress rule IS the crypto-on-core fence (`LLN-SUBSTRATE-001`) projected onto the wire; the
K3-INDETERMINATE counter is governance-as-T-MAC made observable — the blind seam a future photonic T-MAC offload would be
observed through. Pairs with [[feedback-owner-gated-means-ask]], [[logicn-social-ecosystem-cloud-native]],
[[logicn-wasm-compilation-granularity]], [[logicn-rd-corpus-closure-2026-06-18]].

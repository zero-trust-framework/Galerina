// =============================================================================
// App Kernel integration — surface observability THROUGH the kernel, ADDITIVELY.
//
// This file changes NOTHING in @logicn/framework-app-kernel. It only consumes the
// kernel's already-exported, stable seams:
//   • RouteDeclaration[] + HandlerDispatch  → actuator endpoints (health probes + /metrics)
//   • AuditSink                              → counts/error-rates off the kernel's audit pipe
//   • HandlerDispatch wrapping               → precise per-handler LATENCY
// The kernel's fixed, non-bypassable pipeline is untouched; these are things a host
// passes INTO `createAppKernel({ routes, dispatch, auditSink })`.
//
// Type-only imports resolve against the kernel's built `dist/` .d.ts — the same
// relative-dist convention kernel.ts itself uses for @logicn/core-config (#155 will
// swap these for bare specifiers once workspaces land). No runtime dependency edge.
//
// FAIL-CLOSED: instrumentation never breaks a handler — a metrics fault is swallowed
// and a handler that throws is RE-THROWN unchanged so the kernel's own fail-closed
// 500 path still runs. Health endpoints answer 503 (not 200) whenever status is DOWN.
// =============================================================================

import type {
  AuditEvent,
  AuditSink,
  HandlerContext,
  HandlerDispatch,
  HandlerFn,
  HandlerResult,
  RouteDeclaration,
} from "../../logicn-framework-app-kernel/dist/index.js";
import { MetricsCollector } from "./metrics.js";
import { renderMetricsPrometheus } from "./metrics.js";
import { HealthRegistry, type HealthReport } from "./health.js";

// ── Metrics ⇐ kernel audit pipe (counts + error rates; NO latency) ────────────

/**
 * Adapt a MetricsCollector to the kernel's `AuditSink`. The kernel emits one audit
 * event per handled request OFF the critical path (Tri-Pipe), so feeding the
 * collector here can never delay or break a response. Provides request counts and
 * error rates — but NOT latency (the audit event carries no duration).
 *
 * Use this OR `instrumentDispatch` for a given collector, never both (they would
 * double-count). Prefer `instrumentDispatch` when you can wrap dispatch — it adds latency.
 */
export function metricsAuditSink(metrics: MetricsCollector): AuditSink {
  return {
    emit(event: AuditEvent): void {
      try {
        metrics.record({
          method: event.method,
          route: event.path,
          status: event.status,
        });
      } catch {
        // Fail-closed: the audit feed must never throw into the kernel.
      }
    },
  };
}

// ── Metrics ⇐ dispatch wrapping (counts + error rates + LATENCY) ──────────────

export interface InstrumentOptions {
  /** Injectable monotonic-ish clock (ms) for latency. Default Date.now. */
  readonly now?: () => number;
}

/**
 * Wrap a HandlerDispatch so each handler is TIMED and its outcome recorded into the
 * collector. Additive: the host passes the wrapped table as `dispatch` to the kernel.
 *
 * Fail-closed guarantees:
 *   • recording is best-effort and swallowed — a metrics fault never breaks a handler;
 *   • a handler that throws is recorded as a 5xx error then RE-THROWN unchanged, so the
 *     kernel still produces its safe, leak-free 500.
 */
export function instrumentDispatch(
  dispatch: HandlerDispatch,
  metrics: MetricsCollector,
  opts: InstrumentOptions = {},
): HandlerDispatch {
  const now = opts.now ?? ((): number => Date.now());
  const out: Record<string, HandlerFn> = {};
  for (const name of Object.keys(dispatch)) {
    const fn = dispatch[name];
    if (fn === undefined) continue;
    out[name] = async (ctx: HandlerContext): Promise<HandlerResult> => {
      const start = safeNow(now);
      try {
        const result = await fn(ctx);
        recordRequest(metrics, ctx, result.status ?? 200, start, now, false);
        return result;
      } catch (err) {
        // The kernel turns this throw into a fail-closed 500; record it as such, then re-throw.
        recordRequest(metrics, ctx, 500, start, now, true);
        throw err;
      }
    };
  }
  return out;
}

function safeNow(now: () => number): number {
  try {
    const n = now();
    return typeof n === "number" && Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function recordRequest(
  metrics: MetricsCollector,
  ctx: HandlerContext,
  status: number,
  start: number,
  now: () => number,
  errored: boolean,
): void {
  try {
    const durationMs = Math.max(0, safeNow(now) - start);
    metrics.record({
      method: ctx.request.method,
      route: ctx.policy.path,
      status,
      durationMs,
      errored,
    });
  } catch {
    // Recording must never mask a handler result or error.
  }
}

// ── Actuator endpoints surfaced as kernel routes ──────────────────────────────

export type MetricsAuth = "required" | "public";

export interface ObservabilityRouteOptions {
  readonly registry: HealthRegistry;
  readonly metrics: MetricsCollector;
  /** Prefix for every endpoint path (e.g. "/actuator"). Default "" → "/health/live", "/metrics", … */
  readonly basePath?: string;
  /** Prefix for handler dispatch keys (avoids collisions). Default "observability.". */
  readonly handlerPrefix?: string;
  /** Auth for /metrics. Default "required" (secure-by-default). Health probes are always public. */
  readonly metricsAuth?: MetricsAuth;
  /** Also expose Prometheus app-ops text at "{base}/metrics/prometheus". Default false. */
  readonly includePrometheus?: boolean;
}

/** The route declarations + dispatch handlers to spread into `createAppKernel(...)`. */
export interface ObservabilitySurface {
  readonly routes: readonly RouteDeclaration[];
  readonly dispatch: HandlerDispatch;
}

const TEXT_PLAIN: Readonly<Record<string, string>> = Object.freeze({
  "content-type": "text/plain; version=0.0.4; charset=utf-8",
});

function reportToResult(report: HealthReport): HandlerResult {
  return { status: report.status === "UP" ? 200 : 503, body: report };
}

/**
 * Build the actuator surface — health probes + a metrics endpoint — as kernel routes.
 * Spread `routes`/`dispatch` into your existing kernel construction:
 *
 *   const obs = observabilityRoutes({ registry, metrics });
 *   const kernel = createAppKernel({
 *     routes:   [...appRoutes,   ...obs.routes],
 *     dispatch: { ...appDispatch, ...obs.dispatch },
 *   });
 *
 * Endpoints (under `basePath`):
 *   GET /health/live   → liveness  (public)         200 UP / 503 DOWN
 *   GET /health/ready  → readiness (public)         200 UP / 503 DOWN
 *   GET /health        → combined  (public)         200 UP / 503 DOWN
 *   GET /metrics       → JSON snapshot (metricsAuth) 200
 *   GET /metrics/prometheus → app-ops text (metricsAuth, opt-in) 200
 */
export function observabilityRoutes(opts: ObservabilityRouteOptions): ObservabilitySurface {
  const base = normaliseBase(opts.basePath);
  const prefix = opts.handlerPrefix ?? "observability.";
  const metricsAuth: MetricsAuth = opts.metricsAuth ?? "required";
  const { registry, metrics } = opts;

  const liveName = `${prefix}live`;
  const readyName = `${prefix}ready`;
  const healthName = `${prefix}health`;
  const metricsName = `${prefix}metrics`;
  const promName = `${prefix}metrics.prometheus`;

  const dispatch: Record<string, HandlerFn> = {
    [liveName]: async (): Promise<HandlerResult> => failSafe(async () => reportToResult(await registry.liveness())),
    [readyName]: async (): Promise<HandlerResult> => failSafe(async () => reportToResult(await registry.readiness())),
    [healthName]: async (): Promise<HandlerResult> =>
      failSafe(async () => {
        const [liveness, readiness] = await Promise.all([registry.liveness(), registry.readiness()]);
        const status = liveness.status === "UP" && readiness.status === "UP" ? "UP" : "DOWN";
        return { status: status === "UP" ? 200 : 503, body: { status, liveness, readiness } };
      }),
    [metricsName]: (): HandlerResult => ({ status: 200, body: metrics.snapshot() }),
  };

  const routes: RouteDeclaration[] = [
    { method: "GET", path: `${base}/health/live`, handler: liveName, auth: { mode: "public" } },
    { method: "GET", path: `${base}/health/ready`, handler: readyName, auth: { mode: "public" } },
    { method: "GET", path: `${base}/health`, handler: healthName, auth: { mode: "public" } },
    {
      method: "GET",
      path: `${base}/metrics`,
      handler: metricsName,
      // Secure-by-default: omit `auth` → the kernel's required-auth default applies, unless made public.
      ...(metricsAuth === "public" ? { auth: { mode: "public" as const } } : {}),
    },
  ];

  if (opts.includePrometheus === true) {
    dispatch[promName] = (): HandlerResult => ({
      status: 200,
      headers: TEXT_PLAIN,
      // Encode as bytes so the kernel passes the text through verbatim (no JSON.stringify wrapping).
      body: new TextEncoder().encode(renderMetricsPrometheus(metrics.snapshot())),
    });
    routes.push({
      method: "GET",
      path: `${base}/metrics/prometheus`,
      handler: promName,
      ...(metricsAuth === "public" ? { auth: { mode: "public" as const } } : {}),
    });
  }

  return { routes, dispatch };
}

/** Run a health handler so that an unexpected fault becomes 503 DOWN (never a thrown error). */
async function failSafe(fn: () => Promise<HandlerResult>): Promise<HandlerResult> {
  try {
    return await fn();
  } catch {
    return { status: 503, body: { status: "DOWN", detail: "health evaluation failed" } };
  }
}

/** Normalise a base path: "" stays "", otherwise ensure a single leading slash and no trailing slash. */
function normaliseBase(base: string | undefined): string {
  if (base === undefined || base === "" || base === "/") return "";
  let b = base.trim();
  if (!b.startsWith("/")) b = `/${b}`;
  if (b.endsWith("/")) b = b.slice(0, -1);
  return b;
}

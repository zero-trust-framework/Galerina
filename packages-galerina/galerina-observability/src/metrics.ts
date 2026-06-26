// =============================================================================
// App metrics collector — the actuator-style operational view of request traffic:
// counts, latencies, and error rates, per route and in aggregate. PURE (no I/O,
// no node imports). This is the APP-OPERATOR's ops surface — NOT the governance
// structure exported by @galerina/governance-telemetry.
//
// FAIL-CLOSED, the observability sense: a metrics-sink failure must NEVER break
// the request path. `record()` therefore NEVER throws — a malformed observation
// is counted in `droppedObservations` and dropped, never propagated. The collector
// is the failure-isolating "sink"; the request path is the thing it must not harm.
//
// ZERO AMBIENT AUTHORITY: no clocks, no env, no globals are read here. Latency is
// supplied by the caller (who already measured it on the dispatch path); the
// collector only aggregates. Cardinality is bounded (a hostile or buggy caller
// cannot blow up memory with unbounded route labels).
// =============================================================================

/** HTTP status grouped into its class. The closed vocabulary the collector emits. */
export type StatusClass = "1xx" | "2xx" | "3xx" | "4xx" | "5xx";

const STATUS_CLASSES: readonly StatusClass[] = ["1xx", "2xx", "3xx", "4xx", "5xx"];

/** Default cap on distinct (method,route) series. Beyond it, routes fold into `__overflow__`. */
export const DEFAULT_MAX_ROUTES = 1000;

/** Sentinel route label used once the cardinality cap is hit (bounded memory, fail-safe). */
export const OVERFLOW_ROUTE = "__overflow__";

/** Max length of a route label kept verbatim; longer labels are truncated (cardinality/PII guard). */
const MAX_ROUTE_LEN = 200;

/**
 * Fixed latency histogram bucket upper bounds, in milliseconds (Prometheus-style).
 * Percentiles are ESTIMATED from these buckets (with min/max/sum/count kept exactly).
 */
export const LATENCY_BUCKETS_MS: readonly number[] = [
  1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
];

/** One observation of a handled request. Everything the collector needs, nothing it doesn't. */
export interface RequestObservation {
  readonly method: string;
  /** The matched route TEMPLATE (e.g. the kernel's `policy.path`), never the raw URL/query. */
  readonly route: string;
  readonly status: number;
  /** Wall-clock handler duration in ms. Omit (or pass a non-finite value) if not measured. */
  readonly durationMs?: number;
  /** Force-mark as an error even on a <500 status (e.g. a handler that threw). 5xx is always an error. */
  readonly errored?: boolean;
}

/** A latency distribution summary. Percentiles are bucket-estimated; count/sum/min/max are exact. */
export interface LatencySnapshot {
  readonly count: number;
  readonly sumMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p90Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  /** Cumulative histogram: each bucket's `le` upper bound (ms) → count of samples ≤ le. */
  readonly buckets: ReadonlyArray<{ readonly leMs: number; readonly count: number }>;
}

/** Per-route rollup. */
export interface RouteMetric {
  readonly method: string;
  readonly route: string;
  readonly total: number;
  readonly byStatusClass: Readonly<Record<StatusClass, number>>;
  readonly errors: number;
  readonly errorRate: number;
  readonly latency: LatencySnapshot;
}

/** The full metrics snapshot — the body served at the actuator /metrics endpoint. */
export interface MetricsSnapshot {
  readonly totalRequests: number;
  readonly byStatusClass: Readonly<Record<StatusClass, number>>;
  readonly errors: number;
  readonly errorRate: number;
  readonly latency: LatencySnapshot;
  readonly routes: readonly RouteMetric[];
  /** Observations rejected as malformed (bad status, non-object). The collector's own health. */
  readonly droppedObservations: number;
  /** True once the route-cardinality cap forced folding into `__overflow__`. */
  readonly routesOverflowed: boolean;
}

// ── Internal bounded histogram ───────────────────────────────────────────────

/** Non-cumulative latency bucketing + exact count/sum/min/max. Bounded memory. */
class Histogram {
  // counts[i] = samples in (buckets[i-1], buckets[i]]; overflow = samples > last bound.
  readonly #counts: number[] = LATENCY_BUCKETS_MS.map(() => 0);
  #overflow = 0;
  #count = 0;
  #sum = 0;
  #min = Number.POSITIVE_INFINITY;
  #max = 0;

  observe(ms: number): void {
    // Defensive: only finite, non-negative samples enter the distribution.
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return;
    this.#count += 1;
    this.#sum += ms;
    if (ms < this.#min) this.#min = ms;
    if (ms > this.#max) this.#max = ms;
    for (let i = 0; i < LATENCY_BUCKETS_MS.length; i++) {
      if (ms <= (LATENCY_BUCKETS_MS[i] as number)) {
        this.#counts[i] = (this.#counts[i] as number) + 1;
        return;
      }
    }
    this.#overflow += 1;
  }

  /** Estimate a percentile (0..100) by walking the cumulative buckets with linear interpolation. */
  #percentile(p: number): number {
    if (this.#count === 0) return 0;
    const target = (p / 100) * this.#count;
    let cumulative = 0;
    let lower = 0;
    for (let i = 0; i < LATENCY_BUCKETS_MS.length; i++) {
      const upper = LATENCY_BUCKETS_MS[i] as number;
      const c = this.#counts[i] as number;
      if (cumulative + c >= target) {
        const within = target - cumulative;
        const frac = c > 0 ? within / c : 0;
        const est = lower + (upper - lower) * frac;
        // Never report below the observed min or above the observed max.
        return clamp(est, this.#min, this.#max);
      }
      cumulative += c;
      lower = upper;
    }
    // Target lands in the overflow bucket (> last bound): the exact max is the best estimate.
    return this.#max;
  }

  snapshot(): LatencySnapshot {
    const count = this.#count;
    let cumulative = 0;
    const buckets = LATENCY_BUCKETS_MS.map((leMs, i) => {
      cumulative += this.#counts[i] as number;
      return { leMs, count: cumulative };
    });
    return {
      count,
      sumMs: round(this.#sum),
      minMs: count === 0 ? 0 : round(this.#min),
      maxMs: round(this.#max),
      meanMs: count === 0 ? 0 : round(this.#sum / count),
      p50Ms: round(this.#percentile(50)),
      p90Ms: round(this.#percentile(90)),
      p95Ms: round(this.#percentile(95)),
      p99Ms: round(this.#percentile(99)),
      buckets,
    };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/** Round to 3 decimal places — keeps JSON output tidy without losing sub-ms detail. */
function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function emptyStatusClasses(): Record<StatusClass, number> {
  return { "1xx": 0, "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
}

/** Per-route mutable accumulator. */
class RouteAccumulator {
  total = 0;
  readonly byStatusClass: Record<StatusClass, number> = emptyStatusClasses();
  errors = 0;
  readonly latency = new Histogram();

  constructor(readonly method: string, readonly route: string) {}

  snapshot(): RouteMetric {
    return {
      method: this.method,
      route: this.route,
      total: this.total,
      byStatusClass: { ...this.byStatusClass },
      errors: this.errors,
      errorRate: this.total === 0 ? 0 : round(this.errors / this.total),
      latency: this.latency.snapshot(),
    };
  }
}

/** Sanitise a route label: strip any query string, collapse whitespace, bound the length. */
function normaliseRoute(route: unknown): string {
  if (typeof route !== "string" || route.length === 0) return "unknown";
  let r = route;
  const q = r.indexOf("?");
  if (q !== -1) r = r.slice(0, q);
  r = r.replace(/\s+/g, "");
  if (r.length === 0) return "unknown";
  return r.length > MAX_ROUTE_LEN ? r.slice(0, MAX_ROUTE_LEN) : r;
}

function statusClassOf(status: number): StatusClass | undefined {
  if (!Number.isInteger(status)) return undefined;
  const hundreds = Math.floor(status / 100);
  switch (hundreds) {
    case 1: return "1xx";
    case 2: return "2xx";
    case 3: return "3xx";
    case 4: return "4xx";
    case 5: return "5xx";
    default: return undefined;
  }
}

export interface MetricsCollectorOptions {
  /** Cap on distinct (method,route) series; beyond it routes fold into `__overflow__`. Default 1000. */
  readonly maxRoutes?: number;
}

/**
 * In-memory, bounded, fail-closed collector of app request metrics.
 *
 * Wire it to the App Kernel two ways (see kernel-integration.ts):
 *   - `metricsAuditSink(collector)` feeds counts + error rates off the kernel's audit pipe;
 *   - `instrumentDispatch(dispatch, collector)` adds precise per-handler LATENCY.
 * Read it via `snapshot()` (the actuator /metrics body).
 */
export class MetricsCollector {
  readonly #routes = new Map<string, RouteAccumulator>();
  readonly #global = new Histogram();
  readonly #globalByStatusClass: Record<StatusClass, number> = emptyStatusClasses();
  #total = 0;
  #errors = 0;
  #dropped = 0;
  #overflowed = false;
  readonly #maxRoutes: number;

  constructor(opts: MetricsCollectorOptions = {}) {
    const m = opts.maxRoutes;
    this.#maxRoutes = typeof m === "number" && Number.isInteger(m) && m > 0 ? m : DEFAULT_MAX_ROUTES;
  }

  /**
   * Record one handled request. NEVER throws — a malformed observation is counted in
   * `droppedObservations` and dropped. This is the fail-closed guarantee: the request
   * path that calls this can never be broken by a metrics fault.
   */
  record(obs: RequestObservation): void {
    try {
      if (obs === null || typeof obs !== "object") {
        this.#dropped += 1;
        return;
      }
      const cls = statusClassOf(obs.status);
      if (cls === undefined) {
        // A status outside 1xx–5xx is not a real HTTP outcome — drop, don't guess.
        this.#dropped += 1;
        return;
      }
      const method = typeof obs.method === "string" && obs.method.length > 0 ? obs.method : "UNKNOWN";
      const route = normaliseRoute(obs.route);
      const isError = cls === "5xx" || obs.errored === true;

      this.#total += 1;
      this.#globalByStatusClass[cls] += 1;
      if (isError) this.#errors += 1;
      if (obs.durationMs !== undefined) this.#global.observe(obs.durationMs);

      const acc = this.#routeAccumulator(method, route);
      acc.total += 1;
      acc.byStatusClass[cls] += 1;
      if (isError) acc.errors += 1;
      if (obs.durationMs !== undefined) acc.latency.observe(obs.durationMs);
    } catch {
      // Belt-and-braces: any unexpected internal fault is contained, never propagated.
      this.#dropped += 1;
    }
  }

  /** Resolve (or create) the per-route accumulator, honouring the cardinality cap. */
  #routeAccumulator(method: string, route: string): RouteAccumulator {
    const key = `${method} ${route}`;
    const existing = this.#routes.get(key);
    if (existing !== undefined) return existing;
    if (this.#routes.size >= this.#maxRoutes) {
      // Cardinality cap hit: fold new routes into a per-method overflow series. The map can
      // grow only by one sentinel per HTTP method (a tiny, bounded set) — never unboundedly.
      this.#overflowed = true;
      const overflowKey = `${method} ${OVERFLOW_ROUTE}`;
      let overflow = this.#routes.get(overflowKey);
      if (overflow === undefined) {
        overflow = new RouteAccumulator(method, OVERFLOW_ROUTE);
        this.#routes.set(overflowKey, overflow);
      }
      return overflow;
    }
    const created = new RouteAccumulator(method, route);
    this.#routes.set(key, created);
    return created;
  }

  /** Read the current aggregate + per-route metrics. Pure — does not reset anything. */
  snapshot(): MetricsSnapshot {
    const routes = Array.from(this.#routes.values())
      .map((a) => a.snapshot())
      .sort((x, y) => (x.method === y.method ? cmp(x.route, y.route) : cmp(x.method, y.method)));
    return {
      totalRequests: this.#total,
      byStatusClass: { ...this.#globalByStatusClass },
      errors: this.#errors,
      errorRate: this.#total === 0 ? 0 : round(this.#errors / this.#total),
      latency: this.#global.snapshot(),
      routes,
      droppedObservations: this.#dropped,
      routesOverflowed: this.#overflowed,
    };
  }
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ── App-ops Prometheus rendering (distinct `app_` namespace) ──────────────────

const PROM_LABEL_UNSAFE = /[\\\n"]/g;
const SAFE_PROM_LABEL = /^[A-Za-z0-9_./:\- ]{1,200}$/;

function promLabel(value: string): string {
  return value.replace(PROM_LABEL_UNSAFE, "");
}

/**
 * Render a MetricsSnapshot as Prometheus/OpenMetrics text using the app-ops `app_*`
 * namespace (deliberately distinct from governance-telemetry's `galerina_*`). Pure.
 * A route label that is not a safe token is dropped from its series (defence in depth).
 */
export function renderMetricsPrometheus(snapshot: MetricsSnapshot): string {
  const lines: string[] = [];

  lines.push("# HELP app_requests_total Total handled requests by route, method and status class.");
  lines.push("# TYPE app_requests_total counter");
  for (const r of snapshot.routes) {
    if (!SAFE_PROM_LABEL.test(r.route) || !SAFE_PROM_LABEL.test(r.method)) continue;
    for (const cls of STATUS_CLASSES) {
      const v = r.byStatusClass[cls];
      if (v > 0) {
        lines.push(
          `app_requests_total{method="${promLabel(r.method)}",route="${promLabel(r.route)}",status_class="${cls}"} ${v}`,
        );
      }
    }
  }

  lines.push("# HELP app_request_errors_total Requests that errored (5xx or handler fault) by route.");
  lines.push("# TYPE app_request_errors_total counter");
  for (const r of snapshot.routes) {
    if (!SAFE_PROM_LABEL.test(r.route) || !SAFE_PROM_LABEL.test(r.method)) continue;
    lines.push(`app_request_errors_total{method="${promLabel(r.method)}",route="${promLabel(r.route)}"} ${r.errors}`);
  }

  lines.push("# HELP app_request_duration_ms Request handler latency distribution (ms).");
  lines.push("# TYPE app_request_duration_ms histogram");
  for (const b of snapshot.latency.buckets) {
    lines.push(`app_request_duration_ms_bucket{le="${b.leMs}"} ${b.count}`);
  }
  lines.push(`app_request_duration_ms_bucket{le="+Inf"} ${snapshot.latency.count}`);
  lines.push(`app_request_duration_ms_sum ${snapshot.latency.sumMs}`);
  lines.push(`app_request_duration_ms_count ${snapshot.latency.count}`);

  lines.push("# HELP app_requests_dropped_total Observations dropped as malformed by the collector.");
  lines.push("# TYPE app_requests_dropped_total counter");
  lines.push(`app_requests_dropped_total ${snapshot.droppedObservations}`);

  return lines.join("\n") + "\n";
}

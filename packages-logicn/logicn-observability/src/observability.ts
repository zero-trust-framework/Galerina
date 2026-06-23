// =============================================================================
// One-call wiring — the actuator "starter". Bundles a HealthRegistry, a
// MetricsCollector and a structured Logger, and hands back the kernel surface
// (routes + dispatch) plus the two metrics integration seams. PURE of ambient
// authority and side effects: constructing this starts nothing and reads nothing.
// =============================================================================

import type {
  AuditSink,
  HandlerDispatch,
  RouteDeclaration,
} from "../../logicn-framework-app-kernel/dist/index.js";
import { HealthRegistry, type HealthRegistryOptions } from "./health.js";
import { MetricsCollector, type MetricsCollectorOptions } from "./metrics.js";
import { createLogger, type Logger, type LoggerOptions } from "./logger.js";
import {
  instrumentDispatch,
  metricsAuditSink,
  observabilityRoutes,
  type InstrumentOptions,
  type ObservabilityRouteOptions,
} from "./kernel-integration.js";

export interface CreateObservabilityOptions {
  readonly health?: HealthRegistryOptions;
  readonly metrics?: MetricsCollectorOptions;
  readonly logger?: LoggerOptions;
  /** Endpoint/path/auth knobs forwarded to `observabilityRoutes` (registry+metrics injected for you). */
  readonly routes?: Omit<ObservabilityRouteOptions, "registry" | "metrics">;
}

/** The assembled observability surface, ready to compose into `createAppKernel(...)`. */
export interface Observability {
  readonly registry: HealthRegistry;
  readonly metrics: MetricsCollector;
  readonly logger: Logger;
  /** Actuator routes (health probes + /metrics) to merge into the kernel's `routes`. */
  readonly routes: readonly RouteDeclaration[];
  /** Handlers for those routes to merge into the kernel's `dispatch`. */
  readonly dispatch: HandlerDispatch;
  /**
   * An AuditSink that feeds the bundled collector (counts + error rates, NO latency).
   * Use this OR `instrument`, never both on this collector (they would double-count).
   */
  readonly auditSink: AuditSink;
  /** Wrap your app dispatch to record counts + error rates + LATENCY (the richer option). */
  instrument(dispatch: HandlerDispatch, opts?: InstrumentOptions): HandlerDispatch;
}

/**
 * Assemble health + metrics + logging + the kernel surface in one call.
 *
 *   const obs = createObservability();
 *   obs.registry.registerReadiness("db", () => db.ping());
 *   const kernel = createAppKernel({
 *     routes:   [...appRoutes,   ...obs.routes],
 *     dispatch: obs.instrument({ ...appDispatch, ...obs.dispatch }),
 *   });
 *   // obs.metrics.snapshot() is what the /metrics endpoint serves.
 */
export function createObservability(opts: CreateObservabilityOptions = {}): Observability {
  const registry = new HealthRegistry(opts.health ?? {});
  const metrics = new MetricsCollector(opts.metrics ?? {});
  const logger = createLogger(opts.logger ?? {});
  const surface = observabilityRoutes({ registry, metrics, ...(opts.routes ?? {}) });

  return {
    registry,
    metrics,
    logger,
    routes: surface.routes,
    dispatch: surface.dispatch,
    auditSink: metricsAuditSink(metrics),
    instrument: (dispatch, instrumentOpts) => instrumentDispatch(dispatch, metrics, instrumentOpts ?? {}),
  };
}

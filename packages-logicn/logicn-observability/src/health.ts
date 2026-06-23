// =============================================================================
// Health surface — liveness + readiness, actuator-style. PURE of ambient authority:
// the registry holds only the checks the host explicitly registers; it reads no
// clock, env, or global on its own.
//
// FAIL-CLOSED is the whole point of a health surface: when the answer is UNKNOWN
// it must be DOWN, never UP. A check that throws, returns garbage, or hangs past
// its timeout is reported DOWN — so a readiness probe sheds load and a liveness
// probe can trigger a restart, rather than a sick app falsely advertising health.
// Evaluating health NEVER throws into the caller (the probe handler stays safe).
//
// Liveness  = "is the process itself healthy / should it be restarted?" — UP by
//             default (the process is answering); DOWN only if a liveness check says so.
// Readiness = "should this instance receive traffic right now?" — aggregates the
//             readiness checks (dependencies, warm caches, migrations); any DOWN ⇒ DOWN.
// =============================================================================

export type HealthStatus = "UP" | "DOWN";
export type HealthKind = "liveness" | "readiness";

/** The result of one component check. `detail` is optional, safe, and length-bounded. */
export interface ComponentHealth {
  readonly status: HealthStatus;
  readonly detail?: string;
}

/**
 * A registered check. May be sync or async, and may return either a structured
 * `ComponentHealth` or a plain boolean (true = UP, false = DOWN) for convenience.
 */
export type HealthCheck = () =>
  | ComponentHealth
  | boolean
  | Promise<ComponentHealth | boolean>;

/** Aggregate report for one kind (liveness or readiness). */
export interface HealthReport {
  readonly status: HealthStatus;
  readonly kind: HealthKind;
  readonly components: Readonly<Record<string, ComponentHealth>>;
}

/** Max length of a component `detail` string retained (defence against accidental large/PII detail). */
const MAX_DETAIL_LEN = 240;

/** Default per-check timeout (ms). A check that does not settle in time is DOWN (fail-closed). */
export const DEFAULT_CHECK_TIMEOUT_MS = 1000;

export interface HealthRegistryOptions {
  /** Per-check timeout in ms (a hung check ⇒ DOWN). Default 1000. */
  readonly checkTimeoutMs?: number;
  /**
   * Injectable timer scheduler — keeps the registry free of ambient authority and
   * makes timeouts testable. Defaults to a bound `setTimeout` (only touched when a
   * check is actually evaluated, never at import time).
   */
  readonly setTimer?: (cb: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

function coerce(result: ComponentHealth | boolean): ComponentHealth {
  if (typeof result === "boolean") return { status: result ? "UP" : "DOWN" };
  if (result !== null && typeof result === "object" && (result.status === "UP" || result.status === "DOWN")) {
    const detail = result.detail;
    if (typeof detail === "string" && detail.length > 0) {
      return { status: result.status, detail: detail.length > MAX_DETAIL_LEN ? detail.slice(0, MAX_DETAIL_LEN) : detail };
    }
    return { status: result.status };
  }
  // Anything we cannot interpret is treated as unhealthy — fail-closed.
  return { status: "DOWN", detail: "malformed check result" };
}

/**
 * Registry of named liveness/readiness checks. Register at wiring time; the host
 * serves `liveness()` / `readiness()` from probe endpoints (see kernel-integration.ts).
 */
export class HealthRegistry {
  readonly #liveness = new Map<string, HealthCheck>();
  readonly #readiness = new Map<string, HealthCheck>();
  readonly #timeoutMs: number;
  readonly #setTimer: (cb: () => void, ms: number) => unknown;
  readonly #clearTimer: (handle: unknown) => void;

  constructor(opts: HealthRegistryOptions = {}) {
    const t = opts.checkTimeoutMs;
    this.#timeoutMs = typeof t === "number" && Number.isFinite(t) && t > 0 ? t : DEFAULT_CHECK_TIMEOUT_MS;
    this.#setTimer = opts.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
    this.#clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** Register (or replace) a liveness check. Returns `this` for chaining. */
  registerLiveness(name: string, check: HealthCheck): this {
    this.#liveness.set(name, check);
    return this;
  }

  /** Register (or replace) a readiness check. Returns `this` for chaining. */
  registerReadiness(name: string, check: HealthCheck): this {
    this.#readiness.set(name, check);
    return this;
  }

  /** Remove a check of either kind by name. */
  unregister(name: string): this {
    this.#liveness.delete(name);
    this.#readiness.delete(name);
    return this;
  }

  /** Evaluate liveness. UP when every liveness check is UP (and UP by default with none). */
  liveness(): Promise<HealthReport> {
    return this.#evaluate("liveness", this.#liveness);
  }

  /** Evaluate readiness. UP only when every readiness check is UP; any DOWN/unknown ⇒ DOWN. */
  readiness(): Promise<HealthReport> {
    return this.#evaluate("readiness", this.#readiness);
  }

  async #evaluate(kind: HealthKind, checks: Map<string, HealthCheck>): Promise<HealthReport> {
    const names = Array.from(checks.keys());
    const results = await Promise.all(
      names.map((name) => this.#runOne(checks.get(name) as HealthCheck)),
    );
    const components: Record<string, ComponentHealth> = {};
    let aggregate: HealthStatus = "UP";
    for (let i = 0; i < names.length; i++) {
      const name = names[i] as string;
      const health = results[i] as ComponentHealth;
      components[name] = health;
      if (health.status === "DOWN") aggregate = "DOWN";
    }
    return { status: aggregate, kind, components };
  }

  /** Run one check with a timeout, mapping every failure mode (throw, reject, hang) to DOWN. */
  async #runOne(check: HealthCheck): Promise<ComponentHealth> {
    let handle: unknown;
    const timeout = new Promise<ComponentHealth>((resolve) => {
      handle = this.#setTimer(() => resolve({ status: "DOWN", detail: "timeout" }), this.#timeoutMs);
    });
    try {
      // Invoking the check may itself throw synchronously — Promise.resolve(...).catch handles
      // the async path; the surrounding try/catch handles the sync path. Both map to DOWN.
      const evaluated = Promise.resolve()
        .then(() => check())
        .then((r) => coerce(r))
        .catch(() => ({ status: "DOWN" as const, detail: "check threw" }));
      return await Promise.race([evaluated, timeout]);
    } catch {
      return { status: "DOWN", detail: "check threw" };
    } finally {
      this.#clearTimer(handle);
    }
  }
}

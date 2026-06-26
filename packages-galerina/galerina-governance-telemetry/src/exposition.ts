// =============================================================================
// Blind-observability exposition — render a Galerina GovernanceSnapshot as Prometheus/
// OpenMetrics text. PURE (no I/O, no node imports). R&D 0050.
//
// THE GOVERNING RULE — structure, not data. Every emitted value is a mask bit, a verdict
// enum, an effect FAMILY, a count, or a declared budget — NEVER a payload, secret, PII, raw
// effect argument, request path, or requestId. The egress fence below is closed-by-construction:
//   • only metrics in the fixed schema are emitted;
//   • label VALUES must pass `sanitizeLabel` (a safe charset, bounded length) or the series is
//     DROPPED — so even if a caller accidentally passes a path/email/URL, it never egresses;
//   • effect families are reduced to the namespace before the first '.'/'(' (so
//     `network.outbound('https://customer-x/…')` becomes just `network`);
//   • unknown flag/status/tier label values (outside the closed vocab) are dropped.
// The number of dropped series is itself exported (galerina_telemetry_dropped_series_total) so the
// fence is observable. This is SPORE-SUBSTRATE-001 (crypto-on-core / no-cleartext-egress) projected
// onto the metrics wire.
// =============================================================================

/** GovernanceFlags bit→label vocabulary — the ONLY flag labels emitted (RuntimeManifest mask). */
export const GOVERNANCE_FLAGS = [
  "RequiresAudit",
  "DenyRemote",
  "ContainsPII",
  "AllowsNetwork",
  "RequiresActor",
  "ProductionStrict",
  "RequiresIntent",
  "HasPolicy",
] as const;

/** AuditEvent status union — the ONLY status labels emitted. */
export const AUDIT_STATUSES = ["Success", "Denied", "Failed", "Unsafe", "Warning"] as const;

/** ExecutionTier label values — the ONLY tier labels emitted. */
export const EXECUTION_TIERS = ["cache", "bytecode", "sync", "egraph", "tree"] as const;

/**
 * The structural facts the exporter consumes. The host populates this from already-produced
 * state (RuntimeManifest, ExecutionAuditRecord, ContractEnforcementRecord, AuditWriter events,
 * AntiAbuseReport, route-defaults budgets). NOTHING here is payload data.
 */
export interface GovernanceSnapshot {
  /** governanceFlagsMask decoded to flag→on. Names outside GOVERNANCE_FLAGS are dropped. */
  readonly governanceFlags?: Readonly<Record<string, boolean>>;
  readonly allowedEffectsCount?: number;
  readonly proofObligationsCount?: number;
  /** effect family (or full effect — reduced to its family) → observed count. */
  readonly effectsObserved?: Readonly<Record<string, number>>;
  /** execution tier → count. */
  readonly executionTiers?: Readonly<Record<string, number>>;
  /** K3 INDETERMINATE / unknown→deny count — the governance-deny stream. */
  readonly governanceIndeterminateTotal?: number;
  /** audit event status → count. */
  readonly auditEvents?: Readonly<Record<string, number>>;
  readonly surface?: {
    readonly networkFlows?: number;
    readonly unauditedNetworkFlows?: number;
    readonly piiFlows?: number;
    readonly processSpawnFlows?: number;
  };
  readonly declared?: {
    readonly memoryLimitBytes?: number;
    readonly maxConcurrent?: number;
    readonly arenaLimitMb?: number;
  };
  readonly inflightRequests?: number;
  readonly queueDepth?: number;
  /** A CFG-path hash (structural identity). Safe as ONE _info series; never per-flow. */
  readonly behavioralFingerprint?: string;
  /** Build/version identifier joined onto the _info series. */
  readonly build?: string;
}

// ── Egress fence ─────────────────────────────────────────────────────────────

const SAFE_LABEL = /^[A-Za-z0-9_.:\-]{1,80}$/;

/** A label value is emitted ONLY if it is a short, safe token; otherwise the series is dropped. */
export function isSafeLabel(value: string): boolean {
  return SAFE_LABEL.test(value);
}

/** Reduce an effect to its FAMILY — the namespace before the first '.' or '('. */
export function effectFamily(effect: string): string {
  const cut = effect.search(/[.(]/);
  return (cut === -1 ? effect : effect.slice(0, cut)).trim();
}

/** Finite, emittable number? (drops NaN/Infinity and non-numbers). */
function isFiniteNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

interface Series {
  readonly name: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly value: number;
}

/** Render `name{k="v",…} value`. Labels are pre-validated; values are escaped defensively. */
function renderSeries(s: Series): string {
  const labels = s.labels ?? {};
  const keys = Object.keys(labels);
  if (keys.length === 0) return `${s.name} ${s.value}`;
  const inner = keys.map((k) => `${k}="${(labels[k] as string).replace(/["\\\n]/g, "")}"`).join(",");
  return `${s.name}{${inner}} ${s.value}`;
}

interface Metric {
  readonly name: string;
  readonly type: "gauge" | "counter";
  readonly help: string;
  readonly series: readonly Series[];
}

/**
 * Render a GovernanceSnapshot as Prometheus/OpenMetrics exposition text. Pure + fail-closed:
 * any label value that is not a safe token is dropped (and counted in
 * `galerina_telemetry_dropped_series_total`), so payload-shaped data can never egress.
 */
// ── Producer (R&D 0120-F4): build a fail-closed snapshot from raw runtime state ──────────────────

/**
 * The raw governance state a host extracts from ALREADY-PRODUCED runtime artifacts (a RuntimeManifest's
 * `governanceFlagsMask`, AuditWriter event counts, ExecutionAuditRecord tiers, …). This is the input
 * the `/metrics` path was missing a producer for — nothing supplied the GovernanceSnapshot callback.
 */
export interface GovernanceStateInput {
  readonly governanceFlagsMask?: number;
  readonly allowedEffectsCount?: number;
  readonly proofObligationsCount?: number;
  readonly effectsObserved?: Readonly<Record<string, number>>;
  readonly executionTiers?: Readonly<Record<string, number>>;
  readonly auditEvents?: Readonly<Record<string, number>>;
  readonly governanceIndeterminateTotal?: number;
  readonly surface?: GovernanceSnapshot["surface"];
  readonly declared?: GovernanceSnapshot["declared"];
  readonly inflightRequests?: number;
  readonly queueDepth?: number;
  readonly behavioralFingerprint?: string;
  readonly build?: string;
}

/** Keep only counts whose key is in the `allowed` label set + whose value is finite (fail-closed). */
function allowListCounts(
  src: Readonly<Record<string, number>> | undefined,
  allowed: readonly string[],
): Record<string, number> | undefined {
  if (src === undefined) return undefined;
  const out: Record<string, number> = {};
  for (const k of allowed) {
    const v = src[k];
    if (isFiniteNum(v)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Project raw runtime governance state into a fail-closed GovernanceSnapshot (R&D 0120-F4): decode the
 * governance-flags mask to the known GOVERNANCE_FLAGS bits only, reduce effect names to FAMILIES (never
 * a full per-flow effect), and ALLOW-LIST the tier/status maps to the known label sets — so a host
 * cannot leak an arbitrary label or payload value through the exporter. A host wires:
 *   renderPrometheus(buildGovernanceSnapshot(state))
 */
export function buildGovernanceSnapshot(state: GovernanceStateInput): GovernanceSnapshot {
  const snap: Record<string, unknown> = {};

  if (isFiniteNum(state.governanceFlagsMask)) {
    const mask = state.governanceFlagsMask >>> 0;
    const flags: Record<string, boolean> = {};
    for (let i = 0; i < GOVERNANCE_FLAGS.length; i++) {
      flags[GOVERNANCE_FLAGS[i]!] = ((mask >>> i) & 1) === 1;
    }
    snap.governanceFlags = flags;
  }

  if (isFiniteNum(state.allowedEffectsCount)) snap.allowedEffectsCount = state.allowedEffectsCount;
  if (isFiniteNum(state.proofObligationsCount)) snap.proofObligationsCount = state.proofObligationsCount;
  if (isFiniteNum(state.governanceIndeterminateTotal)) snap.governanceIndeterminateTotal = state.governanceIndeterminateTotal;
  if (isFiniteNum(state.inflightRequests)) snap.inflightRequests = state.inflightRequests;
  if (isFiniteNum(state.queueDepth)) snap.queueDepth = state.queueDepth;

  // effectsObserved: reduce every key to its FAMILY (never a full effect), sum, drop unsafe labels.
  if (state.effectsObserved !== undefined) {
    const fam: Record<string, number> = {};
    for (const [k, v] of Object.entries(state.effectsObserved)) {
      if (!isFiniteNum(v)) continue;
      const f = effectFamily(k);
      if (!isSafeLabel(f)) continue;
      fam[f] = (fam[f] ?? 0) + v;
    }
    if (Object.keys(fam).length > 0) snap.effectsObserved = fam;
  }

  const tiers = allowListCounts(state.executionTiers, EXECUTION_TIERS);
  if (tiers !== undefined) snap.executionTiers = tiers;
  const audits = allowListCounts(state.auditEvents, AUDIT_STATUSES);
  if (audits !== undefined) snap.auditEvents = audits;

  if (state.surface !== undefined) snap.surface = state.surface;
  if (state.declared !== undefined) snap.declared = state.declared;
  if (typeof state.behavioralFingerprint === "string" && isSafeLabel(state.behavioralFingerprint)) snap.behavioralFingerprint = state.behavioralFingerprint;
  if (typeof state.build === "string" && isSafeLabel(state.build)) snap.build = state.build;

  return snap as GovernanceSnapshot;
}

export function renderPrometheus(snapshot: GovernanceSnapshot): string {
  let dropped = 0;
  const keep = (labels: Readonly<Record<string, string>>): boolean => {
    for (const v of Object.values(labels)) {
      if (!isSafeLabel(v)) {
        dropped++;
        return false;
      }
    }
    return true;
  };

  const metrics: Metric[] = [];

  // galerina_governance_flag — one 0/1 gauge per KNOWN flag (unknown flag names dropped silently).
  if (snapshot.governanceFlags) {
    const series: Series[] = [];
    for (const flag of GOVERNANCE_FLAGS) {
      const on = snapshot.governanceFlags[flag];
      if (on === undefined) continue;
      if (keep({ flag })) series.push({ name: "galerina_governance_flag", labels: { flag }, value: on ? 1 : 0 });
    }
    if (series.length) metrics.push({ name: "galerina_governance_flag", type: "gauge", help: "Governance flag state (1=on) from the RuntimeManifest mask.", series });
  }

  const scalarGauge = (name: string, help: string, v: unknown): void => {
    if (isFiniteNum(v)) metrics.push({ name, type: "gauge", help, series: [{ name, value: v }] });
  };
  scalarGauge("galerina_allowed_effects", "Count of effects the contract permits.", snapshot.allowedEffectsCount);
  scalarGauge("galerina_proof_obligations", "Count of outstanding proof obligations.", snapshot.proofObligationsCount);
  scalarGauge("galerina_inflight_requests", "In-flight governed requests.", snapshot.inflightRequests);
  scalarGauge("galerina_queue_depth", "Queued requests awaiting admission.", snapshot.queueDepth);

  // galerina_effects_observed_total — by FAMILY only (never effect arguments).
  if (snapshot.effectsObserved) {
    const byFamily = new Map<string, number>();
    for (const [effect, count] of Object.entries(snapshot.effectsObserved)) {
      if (!isFiniteNum(count)) continue;
      const fam = effectFamily(effect);
      byFamily.set(fam, (byFamily.get(fam) ?? 0) + count);
    }
    const series: Series[] = [];
    for (const [fam, count] of byFamily) {
      if (keep({ effect_family: fam })) series.push({ name: "galerina_effects_observed_total", labels: { effect_family: fam }, value: count });
    }
    if (series.length) metrics.push({ name: "galerina_effects_observed_total", type: "counter", help: "Effects observed, by family (counts only, never arguments).", series });
  }

  // galerina_flow_execution_tier_total — KNOWN tiers only.
  if (snapshot.executionTiers) {
    const series: Series[] = [];
    for (const tier of EXECUTION_TIERS) {
      const c = snapshot.executionTiers[tier];
      if (!isFiniteNum(c)) continue;
      if (keep({ tier })) series.push({ name: "galerina_flow_execution_tier_total", labels: { tier }, value: c });
    }
    if (series.length) metrics.push({ name: "galerina_flow_execution_tier_total", type: "counter", help: "Flow executions by execution tier.", series });
  }

  scalarGauge("galerina_governance_indeterminate_total", "K3-INDETERMINATE / unknown→deny verdicts (governance-deny stream).", snapshot.governanceIndeterminateTotal);

  // galerina_audit_events_total — KNOWN statuses only.
  if (snapshot.auditEvents) {
    const series: Series[] = [];
    for (const status of AUDIT_STATUSES) {
      const c = snapshot.auditEvents[status];
      if (!isFiniteNum(c)) continue;
      if (keep({ status })) series.push({ name: "galerina_audit_events_total", labels: { status }, value: c });
    }
    if (series.length) metrics.push({ name: "galerina_audit_events_total", type: "counter", help: "Audit events by status.", series });
  }

  // galerina_surface_* — governed-surface area counts (AntiAbuseReport).
  if (snapshot.surface) {
    const s = snapshot.surface;
    const rows: Array<[string, unknown]> = [
      ["galerina_surface_network_flows", s.networkFlows],
      ["galerina_surface_unaudited_network_flows", s.unauditedNetworkFlows],
      ["galerina_surface_pii_flows", s.piiFlows],
      ["galerina_surface_process_spawn_flows", s.processSpawnFlows],
    ];
    for (const [name, v] of rows) {
      if (isFiniteNum(v)) metrics.push({ name, type: "gauge", help: "Governed surface-area flow count.", series: [{ name, value: v }] });
    }
  }

  // galerina_declared_* — DECLARED budgets (promises), never measurements.
  if (snapshot.declared) {
    const d = snapshot.declared;
    scalarGauge("galerina_declared_memory_limit_bytes", "Declared memory budget (a promise, not a measurement).", d.memoryLimitBytes);
    scalarGauge("galerina_declared_max_concurrent", "Declared max concurrent requests (a promise).", d.maxConcurrent);
    scalarGauge("galerina_declared_arena_limit_mb", "Declared arena limit MB (a promise).", d.arenaLimitMb);
  }

  // galerina_behavioral_fingerprint_info — ONE info series (structural identity, never per-flow).
  if (snapshot.behavioralFingerprint !== undefined) {
    const labels: Record<string, string> = { fingerprint: snapshot.behavioralFingerprint };
    if (snapshot.build !== undefined) labels.build = snapshot.build;
    if (keep(labels)) {
      metrics.push({ name: "galerina_behavioral_fingerprint_info", type: "gauge", help: "Behavioral fingerprint (CFG-path hash) as an info series.", series: [{ name: "galerina_behavioral_fingerprint_info", labels, value: 1 }] });
    }
  }

  // The fence's own counter — ALWAYS emitted (proves the fence is active).
  const lines: string[] = [];
  for (const m of metrics) {
    lines.push(`# HELP ${m.name} ${m.help}`);
    lines.push(`# TYPE ${m.name} ${m.type}`);
    for (const s of m.series) lines.push(renderSeries(s));
  }
  lines.push(`# HELP galerina_telemetry_dropped_series_total Series dropped by the structure-not-data egress fence.`);
  lines.push(`# TYPE galerina_telemetry_dropped_series_total counter`);
  lines.push(`galerina_telemetry_dropped_series_total ${dropped}`);
  return lines.join("\n") + "\n";
}

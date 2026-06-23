/**
 * Secure-by-default route policy resolver (design-doc §10, framework P1).
 *
 * A minimal route declaration is a MAXIMALLY secure route. Omitting a block =
 * the secure default. Relaxing a default must be explicit, and every relaxation
 * is recorded for the security report. Under OS/HW posture `on` (#195, resolved
 * by @logicn/core-config), body + limit ceilings tighten further.
 */
import type {
  HttpMethod, RouteDeclaration, EffectiveRoutePolicy,
  AuthPolicy, BodyPolicy, IdempotencyPolicy, LimitsPolicy, AuditPolicy,
} from "./types.js";
import { MUTATING_METHODS } from "./types.js";

/** Effective posture as resolved by @logicn/core-config (#195). Only on/off matters here. */
export type EffectivePosture = "off" | "on";

const KB = 1024;
const MB = 1024 * 1024;

/** Deny-by-default secure baseline. */
export const SECURE_DEFAULTS = {
  auth: { mode: "required", scopes: [] } as AuthPolicy,
  body: { contentType: "application/json", maxSizeBytes: 256 * KB, unknownFields: "deny", duplicateKeys: "deny" } as BodyPolicy,
  limits: { rate: "60/minute", maxConcurrent: 10, memoryBytes: 32 * MB, timeoutMs: 10_000 } as LimitsPolicy,
  audit: { runtimeReport: true } as AuditPolicy,
} as const;

/** Hostile-host posture (`on`) tightens the body + limit ceilings. */
const HARDENED = {
  body: { contentType: "application/json", maxSizeBytes: 64 * KB, unknownFields: "deny", duplicateKeys: "deny" } as BodyPolicy,
  limits: { rate: "30/minute", maxConcurrent: 5, memoryBytes: 16 * MB, timeoutMs: 5_000 } as LimitsPolicy,
};

function methodAwareIdempotency(method: HttpMethod): IdempotencyPolicy {
  return {
    enabled: MUTATING_METHODS.has(method),   // on for POST/PUT/PATCH/DELETE
    header: "Idempotency-Key",
    ttlSeconds: 24 * 60 * 60,
    onDuplicate: "reject",
  };
}

export interface ResolveOptions {
  readonly posture?: EffectivePosture;
}

/**
 * Resolve a route declaration into the full policy the kernel enforces.
 * Returns the effective policy plus `appliedDefaults` (blocks taken from the
 * secure baseline) and `relaxations` (explicit weakenings, for the report).
 */
export function resolveEffectiveRoutePolicy(
  route: RouteDeclaration,
  opts: ResolveOptions = {},
): EffectiveRoutePolicy {
  const hardened = opts.posture === "on";
  const baseBody = hardened ? HARDENED.body : SECURE_DEFAULTS.body;
  const baseLimits = hardened ? HARDENED.limits : SECURE_DEFAULTS.limits;

  const appliedDefaults: string[] = [];
  const relaxations: string[] = [];

  // ── auth — deny-by-default ──
  let auth: AuthPolicy;
  if (route.auth === undefined) {
    auth = SECURE_DEFAULTS.auth;
    appliedDefaults.push("auth");
  } else {
    auth = {
      mode: route.auth.mode ?? "required",
      scopes: route.auth.scopes ?? [],
      // Carry the legacy presence-only opt-in through; default off (tightened/fail-closed).
      ...(route.auth.allowHeaderPresenceFallback === true ? { allowHeaderPresenceFallback: true } : {}),
    };
    if (auth.mode === "public") relaxations.push("auth:public");
    // An explicit relaxation worth surfacing in the security report — it weakens required-auth to
    // accept mere header presence as authentication.
    if (auth.allowHeaderPresenceFallback === true) relaxations.push("auth:header-presence-fallback");
  }

  // ── body ──
  let body: BodyPolicy;
  if (route.body === undefined) {
    body = baseBody;
    appliedDefaults.push("body");
  } else {
    body = {
      contentType: route.body.contentType ?? baseBody.contentType,
      maxSizeBytes: route.body.maxSizeBytes ?? baseBody.maxSizeBytes,
      unknownFields: route.body.unknownFields ?? baseBody.unknownFields,
      duplicateKeys: route.body.duplicateKeys ?? baseBody.duplicateKeys,
    };
    if (body.maxSizeBytes > baseBody.maxSizeBytes) relaxations.push(`body.maxSize:${body.maxSizeBytes}`);
    if (body.unknownFields !== "deny") relaxations.push(`body.unknownFields:${body.unknownFields}`);
    if (body.duplicateKeys !== "deny") relaxations.push(`body.duplicateKeys:${body.duplicateKeys}`);
  }

  // ── idempotency — method-aware default ──
  const idemDefault = methodAwareIdempotency(route.method);
  let idempotency: IdempotencyPolicy;
  if (route.idempotency === undefined) {
    idempotency = idemDefault;
    if (idemDefault.enabled) appliedDefaults.push("idempotency");
  } else if (route.idempotency === false) {
    idempotency = { ...idemDefault, enabled: false };
    if (MUTATING_METHODS.has(route.method)) relaxations.push("idempotency:disabled-on-mutating");
  } else {
    const o = route.idempotency;
    idempotency = {
      enabled: o.enabled ?? idemDefault.enabled,
      header: o.header ?? idemDefault.header,
      ttlSeconds: o.ttlSeconds ?? idemDefault.ttlSeconds,
      onDuplicate: o.onDuplicate ?? idemDefault.onDuplicate,
    };
    if (MUTATING_METHODS.has(route.method) && !idempotency.enabled) relaxations.push("idempotency:disabled-on-mutating");
  }

  // ── limits ──
  let limits: LimitsPolicy;
  if (route.limits === undefined) {
    limits = baseLimits;
    appliedDefaults.push("limits");
  } else {
    limits = {
      rate: route.limits.rate ?? baseLimits.rate,
      maxConcurrent: route.limits.maxConcurrent ?? baseLimits.maxConcurrent,
      memoryBytes: route.limits.memoryBytes ?? baseLimits.memoryBytes,
      timeoutMs: route.limits.timeoutMs ?? baseLimits.timeoutMs,
    };
    if (limits.maxConcurrent > baseLimits.maxConcurrent) relaxations.push(`limits.maxConcurrent:${limits.maxConcurrent}`);
  }

  // ── audit ──
  let audit: AuditPolicy;
  if (route.audit === undefined) {
    audit = SECURE_DEFAULTS.audit;
    appliedDefaults.push("audit");
  } else {
    audit = { runtimeReport: route.audit.runtimeReport ?? true };
    if (!audit.runtimeReport) relaxations.push("audit:off");
  }

  return {
    method: route.method,
    path: route.path,
    handler: route.handler,
    requestType: route.requestType,
    responseType: route.responseType,
    auth, body, idempotency, limits, audit,
    appliedDefaults,
    relaxations,
  };
}

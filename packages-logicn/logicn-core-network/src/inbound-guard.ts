// inbound-guard.ts — runtime INBOUND admission + rate limiting (the inbound complement to egress-guard.ts).
//
// The core-network package declares the inbound policy (endpoints, ports, rateLimits) and validates it, but
// — like egress before egress-guard — had no RUNTIME enforcement. This module is the building block a host
// uses to admit (or refuse) an inbound request against the declared policy. DENY-BY-DEFAULT and FAIL-CLOSED:
//   • a request whose port matches no allow rule is denied (unless defaultEffect = allow);
//   • a rate-limit rule that cannot be parsed is treated as EXCEEDED, never silently bypassed;
//   • a malformed request (bad port) is denied.
// Pure + deterministic: the rate limiter takes the clock (nowMs) as an argument, so it is fully testable.

export type InboundProtocol =
  | "https" | "http" | "tls" | "tcp" | "udp" | "websocket" | "rawSocket";

/** The minimal policy shape this guard needs — structurally compatible with NetworkPolicy. */
export interface InboundGuardPolicy {
  readonly defaultEffect: "allow" | "deny";
  readonly endpoints?: readonly {
    readonly direction: "inbound" | "outbound";
    readonly protocol: InboundProtocol;
    readonly effect: "allow" | "deny";
    readonly ports?: readonly number[];
  }[];
}

export interface InboundRequest {
  readonly port: number;
  readonly protocol?: InboundProtocol;
}

export interface InboundDecision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly code?: string;
}

// ── Rate-limit string parsing ────────────────────────────────────────────────────────────────────
const UNIT_MS: Readonly<Record<string, number>> = Object.freeze({
  s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
  m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000,
  h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000,
  d: 86_400_000, day: 86_400_000, days: 86_400_000,
});

/** Parse a rate-limit string like "100/min", "10/s", "1000/hour" → { count, windowMs }, or null if invalid. */
export function parseRateLimit(limit: string): { count: number; windowMs: number } | null {
  const m = /^\s*(\d+)\s*\/\s*(\d+)?\s*([a-z]+)\s*$/i.exec(limit ?? "");
  if (m === null) return null;
  const count = Number(m[1]);
  const unitCount = m[2] !== undefined ? Number(m[2]) : 1;   // "100/2min" ⇒ 100 per 2 minutes
  const windowMs = UNIT_MS[(m[3] ?? "").toLowerCase()];
  if (!Number.isFinite(count) || count <= 0) return null;
  if (windowMs === undefined || !Number.isFinite(unitCount) || unitCount <= 0) return null;
  const totalWindowMs = windowMs * unitCount;
  // AUDIT FIX: reject parseable-but-absurd limits. A gigantic count silently NEUTERS the throttle (a no-op
  // limiter that looks configured-and-valid); a window past ~1 year is almost certainly a misconfig. Treat
  // both as unparseable so the caller fails CLOSED rather than shipping an ineffective limit.
  if (count > 1_000_000_000 || totalWindowMs > 366 * 86_400_000) return null;
  return { count, windowMs: totalWindowMs };
}

/**
 * Admit (or refuse) an inbound request against the declared policy. Deny-by-default:
 *   • an explicit inbound DENY rule whose port/protocol match always wins;
 *   • otherwise an inbound ALLOW rule that matches admits it;
 *   • otherwise the policy's defaultEffect decides (deny unless explicitly "allow").
 * A rule with no `ports` (or empty) matches every port (an unrestricted rule, as authored).
 */
export function guardInboundRequest(req: InboundRequest, policy: InboundGuardPolicy): InboundDecision {
  if (!Number.isInteger(req.port) || req.port < 0 || req.port > 65535) {
    return { allowed: false, reason: `invalid inbound port ${req.port}`, code: "LogicN_NETWORK_INBOUND_BAD_PORT" };
  }
  const inbound = (policy.endpoints ?? []).filter((e) => e.direction === "inbound");
  const portMatches = (e: { ports?: readonly number[] }) =>
    e.ports === undefined || e.ports.length === 0 || e.ports.includes(req.port);
  const protoMatches = (e: { protocol: InboundProtocol }) =>
    req.protocol === undefined || e.protocol === req.protocol;
  const matches = (e: { ports?: readonly number[]; protocol: InboundProtocol }) => portMatches(e) && protoMatches(e);

  if (inbound.some((e) => e.effect === "deny" && matches(e))) {
    return { allowed: false, reason: `inbound port ${req.port} matched an explicit deny rule`, code: "LogicN_NETWORK_INBOUND_DENIED" };
  }
  if (inbound.some((e) => e.effect === "allow" && matches(e))) {
    return { allowed: true, reason: `inbound port ${req.port} admitted by an allow rule` };
  }
  if (policy.defaultEffect === "allow") {
    return { allowed: true, reason: `inbound port ${req.port}: no matching rule, defaultEffect=allow` };
  }
  return { allowed: false, reason: `inbound port ${req.port} matched no allow rule (deny-by-default)`, code: "LogicN_NETWORK_INBOUND_DENY_DEFAULT" };
}

export interface RateLimitRuleLike {
  readonly name: string;
  readonly limit: string;
  readonly scope: "ip" | "service" | "route" | "tenant" | "global";
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  /** Absolute ms at which the current window resets. */
  readonly resetMs: number;
  readonly code?: string;
}

/** Build the scoped counter key for a rule from the request context (the scope picks which field keys it). */
export function rateLimitKey(
  rule: RateLimitRuleLike,
  ctx: { ip?: string; service?: string; route?: string; tenant?: string } = {},
): string {
  const dim =
    rule.scope === "ip" ? (ctx.ip ?? "?") :
    rule.scope === "service" ? (ctx.service ?? "?") :
    rule.scope === "route" ? (ctx.route ?? "?") :
    rule.scope === "tenant" ? (ctx.tenant ?? "?") :
    "*"; // global
  // AUDIT FIX (delimiter injection): a raw `::` join lets an untrusted ctx field (e.g. ip "x::ip::y") span
  // fields and collide/fan-out counter buckets, evading the throttle. JSON-encode the components so the
  // separator can never be forged across parts.
  return JSON.stringify([rule.name, rule.scope, dim]);
}

/**
 * Deterministic fixed-window rate limiter. The clock (nowMs) is an argument so callers control time and
 * tests are reproducible. FAIL-CLOSED: an unparseable limit string is treated as immediately EXCEEDED — a
 * rate limit that cannot be evaluated must never be silently bypassed.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  consume(key: string, rule: RateLimitRuleLike, nowMs: number): RateLimitResult {
    const parsed = parseRateLimit(rule.limit);
    if (parsed === null) {
      return { allowed: false, remaining: 0, resetMs: nowMs, code: "LogicN_NETWORK_RATELIMIT_UNPARSEABLE" };
    }
    const { count, windowMs } = parsed;
    const w = this.windows.get(key);
    if (w === undefined || nowMs - w.start >= windowMs) {
      this.windows.set(key, { start: nowMs, count: 1 });
      return { allowed: true, remaining: count - 1, resetMs: nowMs + windowMs };
    }
    if (w.count >= count) {
      return { allowed: false, remaining: 0, resetMs: w.start + windowMs, code: "LogicN_NETWORK_RATELIMIT_EXCEEDED" };
    }
    w.count += 1;
    return { allowed: true, remaining: count - w.count, resetMs: w.start + windowMs };
  }

  /** Drop windows older than `nowMs - maxAgeMs` (optional housekeeping; never affects correctness). */
  prune(nowMs: number, maxAgeMs: number): void {
    for (const [k, w] of this.windows) if (nowMs - w.start > maxAgeMs) this.windows.delete(k);
  }
}

// =============================================================================
// Galerina Runtime — Capability Host (Phase 11C / R4)
//
// Routes all side-effectful host calls through governed capability checks.
// Every call checks: declared effect? contract allows it? context valid?
//
// The interpreter calls capabilityHost instead of direct stdlib calls for:
//   database.read/write
//   network.outbound
//   audit.write
//   ai.inference
//   storage.read/write
//   email.send
//   crypto.sign/verify
//
// R4A: FUNGI-NET-001/002 — network destination and private-range checks.
// R4C: Per-flow call counters (networkCallCount, dbCallCount) — soft warning.
// =============================================================================

import { type GalerinaValue } from "../interpreter.js";
import { type RuntimeContext } from "./runtimeContext.js";
import { type ContractEnforcer } from "./contractEnforcer.js";
import {
  isHostAllowed,
  parseNetworkDestinationPolicy,
  PRIVATE_IP_RANGES,
  FUNGI_NET_001,
  FUNGI_NET_002,
  type NetworkDestinationPolicy,
} from "../security-policy.js";

export interface CapabilityCheckResult {
  readonly allowed: boolean;
  readonly reason?: string; // if not allowed, why
}

export interface CapabilityCall {
  readonly capabilityId: string; // e.g. "host.database.read"
  readonly effect: string;       // e.g. "database.read"
  readonly args: readonly GalerinaValue[];
  readonly context: RuntimeContext;
}

export interface CapabilityResult {
  readonly value: GalerinaValue;
  readonly effectObserved: string;
  readonly durationMs: number;
}

// ---------------------------------------------------------------------------
// Private-range string-prefix checks (Phase R4A — full IP resolution in R4B)
// ---------------------------------------------------------------------------

const PRIVATE_PREFIXES = [
  "10.",
  "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.",
  "172.23.", "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.",
  "172.30.", "172.31.",
  "192.168.",
  "127.",
  "169.254.",
  "::1",
  "fc", "fd",
] as const;

function looksLikePrivateIp(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost") return true;
  return PRIVATE_PREFIXES.some((prefix) => h.startsWith(prefix));
}

function extractHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    // Fallback: simple regex for "scheme://host[/...]"
    const m = url.match(/^[a-z][a-z0-9+\-.]*:\/\/([^/:?#]+)/i);
    return m?.[1];
  }
}

// ---------------------------------------------------------------------------
// Per-flow rate-limit counters (R4C)
// ---------------------------------------------------------------------------

export interface FlowCallCounters {
  networkCallCount: number;
  dbCallCount: number;
}

export interface CapabilityHostConfig {
  readonly declaredEffects: ReadonlySet<string>;
  readonly enforcer: ContractEnforcer;
  /** Optional network destination policy parsed from the flow's contract. */
  readonly networkPolicy?: NetworkDestinationPolicy;
  /** Optional declared network request limit (for soft-warning in R4C). */
  readonly networkCallLimit?: number;
  /** Optional declared db call limit (for soft-warning in R4C). */
  readonly dbCallLimit?: number;
}

export interface CapabilityHost {
  // Check if a capability is allowed before executing
  check(call: CapabilityCall): CapabilityCheckResult;

  // Execute a capability call (checks first, then executes)
  execute(
    call: CapabilityCall,
    impl: (args: readonly GalerinaValue[]) => Promise<GalerinaValue>,
  ): Promise<CapabilityResult>;

  // Query which effects were actually observed
  readonly observedEffects: ReadonlySet<string>;

  // R4C: Per-flow call counters (read-only snapshot)
  readonly callCounters: Readonly<FlowCallCounters>;
}

export function createCapabilityHost(config: CapabilityHostConfig): CapabilityHost {
  const observed = new Set<string>();

  // R4C: mutable per-flow counters
  const counters: FlowCallCounters = {
    networkCallCount: 0,
    dbCallCount: 0,
  };

  // ---------------------------------------------------------------------------
  // R4A: Network outbound security check
  // Returns a denial result when the URL is blocked, or undefined if allowed.
  // ---------------------------------------------------------------------------
  function checkNetworkDestination(call: CapabilityCall): CapabilityCheckResult | undefined {
    if (call.effect !== "network.outbound") return undefined;

    // Extract URL from the first argument (if it's a string value)
    const firstArg = call.args[0];
    const urlStr = firstArg !== undefined && "__tag" in firstArg && firstArg.__tag === "string"
      ? (firstArg as { __tag: "string"; value: string }).value
      : undefined;

    if (urlStr === undefined) return undefined;

    const hostname = extractHostname(urlStr);
    if (hostname === undefined) return undefined;

    // Check 1: network destination policy (FUNGI-NET-001)
    if (config.networkPolicy !== undefined) {
      const allowed = isHostAllowed(hostname, config.networkPolicy);
      if (!allowed) {
        console.warn(
          `[CapabilityHost] ${FUNGI_NET_001.code}: network.outbound denied — hostname "${hostname}" is not in the allowed list.`,
          FUNGI_NET_001.suggestedFix,
        );
        return {
          allowed: false,
          reason: `${FUNGI_NET_001.code}: ${FUNGI_NET_001.message} Host: "${hostname}". ${FUNGI_NET_001.suggestedFix}`,
        };
      }
    }

    // Check 2: private/reserved IP ranges (FUNGI-NET-002, soft check — string prefix only)
    if (looksLikePrivateIp(hostname)) {
      console.warn(
        `[CapabilityHost] ${FUNGI_NET_002.code}: network.outbound denied — hostname "${hostname}" resolves to a private/reserved range.`,
        FUNGI_NET_002.suggestedFix,
      );
      return {
        allowed: false,
        reason: `${FUNGI_NET_002.code}: ${FUNGI_NET_002.message} Host: "${hostname}". ${FUNGI_NET_002.suggestedFix}`,
      };
    }

    return undefined; // allowed
  }

  // ---------------------------------------------------------------------------
  // R4B: Increment per-flow counters and DENY when limit exceeded (FUNGI-RUNTIME-006).
  // Returns a denial CapabilityCheckResult when limit is exceeded, undefined otherwise.
  // ---------------------------------------------------------------------------
  function trackCallCount(effect: string): CapabilityCheckResult | undefined {
    if (effect === "network.outbound" || effect === "email.send") {
      counters.networkCallCount += 1;
      if (
        config.networkCallLimit !== undefined &&
        counters.networkCallCount > config.networkCallLimit
      ) {
        return {
          allowed: false,
          reason: `FUNGI-RUNTIME-006: network call count ${counters.networkCallCount} exceeds declared limit ${config.networkCallLimit}`,
        };
      }
    }

    if (effect === "database.read" || effect === "database.write") {
      counters.dbCallCount += 1;
      if (
        config.dbCallLimit !== undefined &&
        counters.dbCallCount > config.dbCallLimit
      ) {
        return {
          allowed: false,
          reason: `FUNGI-RUNTIME-006: database call count ${counters.dbCallCount} exceeds declared limit ${config.dbCallLimit}`,
        };
      }
    }

    return undefined;
  }

  function check(call: CapabilityCall): CapabilityCheckResult {
    if (!config.declaredEffects.has(call.effect)) {
      return {
        allowed: false,
        reason: `Effect '${call.effect}' not declared on this flow`,
      };
    }

    try {
      config.enforcer.checkDeadline();
    } catch {
      return {
        allowed: false,
        reason: "Flow deadline exceeded",
      };
    }

    // R4A: network destination security check
    const netDenial = checkNetworkDestination(call);
    if (netDenial !== undefined) {
      return netDenial;
    }

    return { allowed: true };
  }

  async function execute(
    call: CapabilityCall,
    impl: (args: readonly GalerinaValue[]) => Promise<GalerinaValue>,
  ): Promise<CapabilityResult> {
    const start = Date.now();
    const checkResult = check(call);

    if (!checkResult.allowed) {
      const errValue: GalerinaValue = {
        __tag: "err",
        error: { __tag: "string", value: checkResult.reason ?? "Capability denied" },
      };
      return {
        value: errValue,
        effectObserved: call.effect,
        durationMs: Date.now() - start,
      };
    }

    // R4B: track counts and deny if limit exceeded
    const countDenial = trackCallCount(call.effect);
    if (countDenial !== undefined) {
      const errValue: GalerinaValue = {
        __tag: "err",
        error: { __tag: "string", value: countDenial.reason ?? "Rate limit exceeded" },
      };
      return {
        value: errValue,
        effectObserved: call.effect,
        durationMs: Date.now() - start,
      };
    }

    const value = await config.enforcer.withRetry(call.effect, () => impl(call.args));
    observed.add(call.effect);

    return {
      value,
      effectObserved: call.effect,
      durationMs: Date.now() - start,
    };
  }

  return {
    check,
    execute,
    get observedEffects(): ReadonlySet<string> {
      return observed;
    },
    get callCounters(): Readonly<FlowCallCounters> {
      return { ...counters };
    },
  };
}

// Re-export for consumers that need the policy type without importing security-policy directly.
export type { NetworkDestinationPolicy };
export { parseNetworkDestinationPolicy, PRIVATE_IP_RANGES };

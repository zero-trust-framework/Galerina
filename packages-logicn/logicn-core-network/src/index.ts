import type { EgressPolicy } from "./egress-guard.js";

export type NetworkDirection = "inbound" | "outbound";

export type NetworkProtocol =
  | "https"
  | "http"
  | "tls"
  | "tcp"
  | "udp"
  | "websocket"
  | "rawSocket";

export type NetworkEffect = "allow" | "deny";

export type TlsVersion = "TLS1.2" | "TLS1.3";

export type NetworkBackend =
  | "buffered"
  | "zeroCopy"
  | "ioUring"
  | "iocp"
  | "kqueue"
  | "xdp"
  | "dpdk";

export type NetworkDiagnosticSeverity = "warning" | "error";

export interface NetworkDiagnostic {
  readonly code: string;
  readonly severity: NetworkDiagnosticSeverity;
  readonly message: string;
  readonly path?: string;
}

export interface TlsPolicy {
  readonly requireTls: boolean;
  readonly minVersion: TlsVersion;
  readonly verifyCertificates: boolean;
  readonly verifyHostnames: boolean;
  readonly denySelfSignedInProduction: boolean;
  readonly allowPlaintextFallback: boolean;
  readonly allowDowngrade: boolean;
}

export interface NetworkEndpointRule {
  readonly direction: NetworkDirection;
  readonly protocol: NetworkProtocol;
  readonly effect: NetworkEffect;
  readonly hosts?: readonly string[];
  readonly ports?: readonly number[];
  readonly reason?: string;
}

export interface RateLimitRule {
  readonly name: string;
  readonly limit: string;
  readonly scope: "ip" | "service" | "route" | "tenant" | "global";
}

export interface NetworkPrivacyPolicy {
  readonly minimiseMetadata: boolean;
  readonly denyQueryStringSecrets: boolean;
  readonly redactSensitiveHeaders: boolean;
  readonly denySensitiveDataInUrls: boolean;
}

export interface NetworkPolicy {
  readonly name: string;
  readonly defaultEffect: NetworkEffect;
  readonly tls: TlsPolicy;
  readonly endpoints: readonly NetworkEndpointRule[];
  readonly rateLimits: readonly RateLimitRule[];
  readonly privacy: NetworkPrivacyPolicy;
  readonly denyRawSockets: boolean;
  readonly requireTimeouts: boolean;
  readonly requireBackpressure: boolean;
  /** Optional declarative outbound-egress posture (SSRF). Validated only when present. */
  readonly egress?: EgressPolicy;
}

export interface NetworkBackendCapability {
  readonly backend: NetworkBackend;
  readonly available: boolean;
  readonly platform?: "linux" | "windows" | "macos" | "portable";
  readonly zeroCopy: boolean;
  readonly requiresDedicatedCores?: boolean;
  readonly requiresElevatedPrivileges?: boolean;
}

export interface NetworkAutoPolicy {
  readonly prefer: readonly NetworkBackend[];
  readonly fallback: NetworkBackend;
  readonly requireSafeFallback: boolean;
}

export interface NetworkBackendSelection {
  readonly selected: NetworkBackend;
  readonly fallback: boolean;
  readonly satisfied: boolean;
  readonly reason: string;
  readonly warnings: readonly string[];
}

export interface NetworkReport {
  readonly policy: NetworkPolicy;
  readonly backendSelection?: NetworkBackendSelection;
  readonly diagnostics: readonly NetworkDiagnostic[];
  readonly warnings: readonly string[];
  readonly plaintextAllowed: boolean;
  readonly rawSocketsAllowed: boolean;
  readonly inboundPorts: readonly number[];
  readonly outboundHosts: readonly string[];
}

export const DEFAULT_TLS_POLICY: TlsPolicy = {
  requireTls: true,
  minVersion: "TLS1.3",
  verifyCertificates: true,
  verifyHostnames: true,
  denySelfSignedInProduction: true,
  allowPlaintextFallback: false,
  allowDowngrade: false,
};

export const DEFAULT_NETWORK_PRIVACY_POLICY: NetworkPrivacyPolicy = {
  minimiseMetadata: true,
  denyQueryStringSecrets: true,
  redactSensitiveHeaders: true,
  denySensitiveDataInUrls: true,
};

export function defineNetworkPolicy(
  name: string,
  input: Partial<Omit<NetworkPolicy, "name">> = {},
): NetworkPolicy {
  return {
    name,
    defaultEffect: input.defaultEffect ?? "deny",
    tls: input.tls ?? DEFAULT_TLS_POLICY,
    endpoints: input.endpoints ?? [],
    rateLimits: input.rateLimits ?? [],
    privacy: input.privacy ?? DEFAULT_NETWORK_PRIVACY_POLICY,
    denyRawSockets: input.denyRawSockets ?? true,
    requireTimeouts: input.requireTimeouts ?? true,
    requireBackpressure: input.requireBackpressure ?? true,
    ...(input.egress !== undefined ? { egress: input.egress } : {}),
  };
}

export function validateNetworkPolicy(
  policy: NetworkPolicy,
  options: { readonly production?: boolean } = {},
): readonly NetworkDiagnostic[] {
  const diagnostics: NetworkDiagnostic[] = [];

  if (policy.name.trim().length === 0) {
    diagnostics.push(createNetworkDiagnostic(
      "LogicN_NETWORK_POLICY_NAME_REQUIRED",
      "error",
      "Network policy requires a name.",
      "name",
    ));
  }

  if (policy.defaultEffect === "allow") {
    diagnostics.push(createNetworkDiagnostic(
      "LogicN_NETWORK_DEFAULT_ALLOW",
      "error",
      "Network policy must deny by default.",
      "defaultEffect",
    ));
  }

  diagnostics.push(...validateTlsPolicy(policy.tls, options));

  policy.endpoints.forEach((endpoint, index) => {
    diagnostics.push(...validateEndpointRule(endpoint, index, policy));
  });

  policy.rateLimits.forEach((rateLimit, index) => {
    if (rateLimit.name.trim().length === 0 || rateLimit.limit.trim().length === 0) {
      diagnostics.push(createNetworkDiagnostic(
        "LogicN_NETWORK_RATE_LIMIT_INVALID",
        "error",
        "Rate limits must declare a name and limit.",
        `rateLimits.${index}`,
      ));
    }
  });

  if (!policy.requireTimeouts) {
    diagnostics.push(createNetworkDiagnostic(
      "LogicN_NETWORK_TIMEOUT_REQUIRED",
      "warning",
      "Network policy should require timeouts for I/O.",
      "requireTimeouts",
    ));
  }

  if (!policy.requireBackpressure) {
    diagnostics.push(createNetworkDiagnostic(
      "LogicN_NETWORK_BACKPRESSURE_REQUIRED",
      "warning",
      "Network streams should require bounded backpressure.",
      "requireBackpressure",
    ));
  }

  if (policy.egress !== undefined) {
    diagnostics.push(...validateEgressPolicy(policy.egress, options));
  }

  return diagnostics;
}

export function selectNetworkBackend(
  policy: NetworkAutoPolicy,
  capabilities: readonly NetworkBackendCapability[],
): NetworkBackendSelection {
  for (const backend of policy.prefer) {
    const capability = capabilities.find((item) => item.backend === backend);
    if (capability?.available === true && !isUnsafeNetworkBackend(capability)) {
      return {
        selected: backend,
        fallback: backend !== policy.prefer[0],
        satisfied: true,
        reason: "Selected the first available safe network backend.",
        warnings: [],
      };
    }
  }

  const fallbackCapability = capabilities.find(
    (item) => item.backend === policy.fallback,
  );
  const fallbackSafe =
    fallbackCapability?.available === true &&
    !isUnsafeNetworkBackend(fallbackCapability);

  return {
    selected: policy.fallback,
    fallback: true,
    satisfied: policy.requireSafeFallback ? fallbackSafe : true,
    reason: fallbackSafe
      ? "Preferred network backends were unavailable; selected safe fallback."
      : "Preferred network backends were unavailable and fallback could not be proven safe.",
    warnings: fallbackSafe
      ? ["Network backend fallback was used."]
      : ["No safe network backend fallback is available."],
  };
}

export function createNetworkReport(input: {
  readonly policy: NetworkPolicy;
  readonly backendSelection?: NetworkBackendSelection;
  readonly production?: boolean;
}): NetworkReport {
  const diagnostics = validateNetworkPolicy(input.policy, {
    production: input.production ?? false,
  });

  return {
    policy: input.policy,
    ...(input.backendSelection === undefined
      ? {}
      : { backendSelection: input.backendSelection }),
    diagnostics,
    warnings: diagnostics
      .filter((diagnostic) => diagnostic.severity === "warning")
      .map((diagnostic) => diagnostic.message),
    plaintextAllowed: input.policy.endpoints.some(
      (endpoint) => endpoint.effect === "allow" && endpoint.protocol === "http",
    ),
    rawSocketsAllowed: input.policy.endpoints.some(
      (endpoint) =>
        endpoint.effect === "allow" && endpoint.protocol === "rawSocket",
    ),
    inboundPorts: uniqueNumbers(
      input.policy.endpoints
        .filter((endpoint) => endpoint.direction === "inbound")
        .flatMap((endpoint) => endpoint.ports ?? []),
    ),
    outboundHosts: uniqueStrings(
      input.policy.endpoints
        .filter((endpoint) => endpoint.direction === "outbound")
        .flatMap((endpoint) => endpoint.hosts ?? []),
    ),
  };
}

function validateTlsPolicy(
  tls: TlsPolicy,
  options: { readonly production?: boolean },
): readonly NetworkDiagnostic[] {
  const diagnostics: NetworkDiagnostic[] = [];

  if (!tls.requireTls || tls.allowPlaintextFallback) {
    diagnostics.push(createNetworkDiagnostic(
      "LogicN_NETWORK_TLS_REQUIRED",
      "error",
      "Network policy must require TLS and deny plaintext fallback.",
      "tls",
    ));
  }

  if (tls.allowDowngrade) {
    diagnostics.push(createNetworkDiagnostic(
      "LogicN_NETWORK_TLS_DOWNGRADE_DENIED",
      "error",
      "TLS downgrade must not be allowed.",
      "tls.allowDowngrade",
    ));
  }

  if (options.production === true && (!tls.verifyCertificates || !tls.verifyHostnames)) {
    diagnostics.push(createNetworkDiagnostic(
      "LogicN_NETWORK_PRODUCTION_CERTIFICATE_VALIDATION_REQUIRED",
      "error",
      "Production network policy must verify certificates and hostnames.",
      "tls",
    ));
  }

  return diagnostics;
}

function validateEndpointRule(
  endpoint: NetworkEndpointRule,
  index: number,
  policy: NetworkPolicy,
): readonly NetworkDiagnostic[] {
  const diagnostics: NetworkDiagnostic[] = [];
  const path = `endpoints.${index}`;

  if (endpoint.protocol === "http" && endpoint.effect === "allow") {
    diagnostics.push(createNetworkDiagnostic(
      "LogicN_NETWORK_PLAINTEXT_HTTP_ALLOWED",
      "error",
      "Plaintext HTTP must not be allowed in core network policy.",
      `${path}.protocol`,
    ));
  }

  if (
    endpoint.protocol === "rawSocket" &&
    endpoint.effect === "allow" &&
    policy.denyRawSockets
  ) {
    diagnostics.push(createNetworkDiagnostic(
      "LogicN_NETWORK_RAW_SOCKET_DENIED",
      "error",
      "Raw sockets require an explicit package-level exception.",
      `${path}.protocol`,
    ));
  }

  for (const [portIndex, port] of (endpoint.ports ?? []).entries()) {
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
      diagnostics.push(createNetworkDiagnostic(
        "LogicN_NETWORK_PORT_INVALID",
        "error",
        "Network ports must be integers from 1 to 65535.",
        `${path}.ports.${portIndex}`,
      ));
    }
  }

  for (const [hostIndex, host] of (endpoint.hosts ?? []).entries()) {
    if (host.trim().length === 0 || /[/?#]/.test(host)) {
      diagnostics.push(createNetworkDiagnostic(
        "LogicN_NETWORK_HOST_INVALID",
        "error",
        "Network hosts must be host names, not URLs or empty values.",
        `${path}.hosts.${hostIndex}`,
      ));
    }
  }

  return diagnostics;
}

function validateEgressPolicy(
  egress: EgressPolicy,
  options: { readonly production?: boolean },
): readonly NetworkDiagnostic[] {
  const diagnostics: NetworkDiagnostic[] = [];
  if (egress.allowMetadataEndpoint === true) {
    diagnostics.push(createNetworkDiagnostic(
      "LogicN_NETWORK_EGRESS_METADATA_ALLOWED",
      "error",
      "Egress policy allows the cloud metadata endpoint — a prime SSRF target; remove allowMetadataEndpoint.",
      "egress.allowMetadataEndpoint",
    ));
  }
  if (egress.allowUrlCredentials === true) {
    diagnostics.push(createNetworkDiagnostic(
      "LogicN_NETWORK_EGRESS_URL_CREDENTIALS_ALLOWED",
      "warning",
      "Egress policy permits embedded URL credentials (userinfo) — a parser-confusion SSRF vector.",
      "egress.allowUrlCredentials",
    ));
  }
  if (egress.allowNonPublicHosts === true) {
    diagnostics.push(createNetworkDiagnostic(
      "LogicN_NETWORK_EGRESS_NONPUBLIC_ALLOWED",
      options.production === true ? "error" : "warning",
      "Egress policy allows non-public (private/loopback/link-local) hosts; prefer an explicit allowedHosts list.",
      "egress.allowNonPublicHosts",
    ));
  }
  if ((egress.allowedSchemes ?? []).some((s) => s.toLowerCase().replace(/:$/, "") === "http")) {
    diagnostics.push(createNetworkDiagnostic(
      "LogicN_NETWORK_EGRESS_PLAINTEXT_SCHEME",
      options.production === true ? "error" : "warning",
      "Egress policy permits plaintext http; require https for outbound calls.",
      "egress.allowedSchemes",
    ));
  }
  return diagnostics;
}

function createNetworkDiagnostic(
  code: string,
  severity: NetworkDiagnosticSeverity,
  message: string,
  path?: string,
): NetworkDiagnostic {
  return {
    code,
    severity,
    message,
    ...(path === undefined ? {} : { path }),
  };
}

function isUnsafeNetworkBackend(capability: NetworkBackendCapability): boolean {
  return (
    capability.requiresElevatedPrivileges === true ||
    capability.backend === "dpdk" ||
    capability.backend === "xdp"
  );
}

function uniqueNumbers(values: readonly number[]): readonly number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

// Outbound SSRF / egress protection — the runtime counterpart to NetworkPolicy validation.
export {
  type HostCategory,
  type HostKind,
  type HostClassification,
  type EgressPolicy,
  type EgressDecision,
  classifyHost,
  guardOutboundHost,
  guardOutboundUrl,
  validateWebhookTarget,
  guardResolvedAddresses,
} from "./egress-guard.js";

// Inbound admission + rate limiting — the runtime counterpart for the inbound half of NetworkPolicy.
export {
  type InboundProtocol,
  type InboundGuardPolicy,
  type InboundRequest,
  type InboundDecision,
  type RateLimitRuleLike,
  type RateLimitResult,
  parseRateLimit,
  guardInboundRequest,
  rateLimitKey,
  RateLimiter,
} from "./inbound-guard.js";

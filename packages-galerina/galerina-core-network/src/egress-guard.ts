// egress-guard.ts — outbound SSRF / egress protection (runtime host classification + guard).
//
// The policy layer (index.ts) validates a DECLARED NetworkPolicy. This module is the RUNTIME
// counterpart: given an actual outbound target (a URL or a host), is it safe to dial? It is the
// defence against Server-Side Request Forgery (SSRF) — the attack where a user-supplied URL (a
// webhook, an image-fetch, a redirect target) is pointed at the deployment's own private network
// or the cloud metadata endpoint (169.254.169.254) to exfiltrate credentials.
//
// Design: deny-by-default, fail-closed. Anything that is not a provably-PUBLIC destination is denied
// unless the policy explicitly allow-lists it. Numeric-IP obfuscations that bypass naive string
// checks (decimal 2130706433, hex 0x7f000001, octal 0177.0.0.1, IPv4-mapped IPv6 ::ffff:127.0.0.1)
// are normalized before classification. No node:/DOM dependency — parsing uses the WHATWG URL global,
// declared minimally below.
//
// IMPORTANT (DNS rebinding): a HOSTNAME cannot be proven safe without resolution. classifyHost()
// flags hostnames with `requiresDnsRecheck` — the caller MUST re-run classifyHost() on EACH resolved
// IP address at connect time (and pin it), or a TOCTOU/rebinding attack defeats a name-only check.

/** Minimal structural type for the runtime URL parser (avoids a @types/node dependency). */
declare const URL: {
  new (input: string): {
    readonly protocol: string;
    readonly hostname: string;
    readonly port: string;
    readonly username: string;
    readonly password: string;
  };
};

export type HostCategory =
  | "loopback"      // 127.0.0.0/8, ::1, localhost
  | "private"       // 10/8, 172.16/12, 192.168/16, *.internal
  | "linkLocal"     // 169.254/16, fe80::/10, *.local (mDNS)
  | "uniqueLocal"   // fc00::/7 (IPv6 ULA)
  | "cgnat"         // 100.64/10 (carrier-grade NAT)
  | "metadata"      // 169.254.169.254 / fd00:ec2::254 / metadata.google.internal — the SSRF prize
  | "multicast"     // 224/4, ff00::/8
  | "unspecified"   // 0.0.0.0/8, ::
  | "reserved"      // 192.0.0/24, 240/4, TEST-NET, benchmarking, documentation
  | "broadcast"     // 255.255.255.255
  | "public"        // a globally-routable address — the only category dialled by default
  | "invalid";      // unparseable

export type HostKind = "ipv4" | "ipv6" | "hostname";

export interface HostClassification {
  readonly host: string;            // the input, trimmed/lowercased
  readonly category: HostCategory;
  readonly kind: HostKind;
  readonly isPublic: boolean;       // category === "public"
  /** true for hostnames: the caller MUST re-classify each resolved IP (DNS-rebinding defence). */
  readonly requiresDnsRecheck: boolean;
  readonly reason: string;
}

const cls = (host: string, category: HostCategory, kind: HostKind, reason: string, requiresDnsRecheck = false): HostClassification =>
  ({ host, category, kind, isPublic: category === "public", requiresDnsRecheck, reason });

// ── IPv4 parsing (handles the numeric SSRF bypasses) ─────────────────────────────────────────────
// Accepts: dotted (1–4 parts, each dec/hex/octal), and a single integer (dec/hex/octal) → 32-bit IP.
// Returns [a,b,c,d] octets or null. Mirrors inet_aton's permissive forms attackers exploit.
function parseOctet(part: string): number | null {
  let n: number;
  if (/^0x[0-9a-f]+$/i.test(part)) n = parseInt(part, 16);
  else if (/^0[0-7]+$/.test(part)) n = parseInt(part, 8);
  else if (/^(0|[1-9]\d*)$/.test(part)) n = parseInt(part, 10);
  else return null;
  return Number.isInteger(n) ? n : null;
}

function ipv4ToOctets(host: string): [number, number, number, number] | null {
  const parts = host.split(".");
  // Single integer form (e.g. 2130706433, 0x7f000001) → 32-bit big-endian.
  if (parts.length === 1) {
    const n = parseOctet(host);
    if (n === null || n < 0 || n > 0xffffffff) return null;
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  }
  if (parts.length < 2 || parts.length > 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    const n = parseOctet(p);
    if (n === null) return null;
    nums.push(n);
  }
  // inet_aton: the LAST part absorbs the remaining low-order bytes (a.b.c.d / a.b.c / a.b / a).
  const last = nums[nums.length - 1]!;
  const lead = nums.slice(0, -1);
  for (const x of lead) if (x < 0 || x > 0xff) return null;
  const lastMax = 0xffffffff >>> (8 * lead.length);
  if (last < 0 || last > lastMax) return null;
  const octets = [...lead];
  // expand the final part across the remaining octets
  const remaining = 4 - lead.length;
  for (let i = remaining - 1; i >= 0; i--) octets.push((last >>> (8 * i)) & 0xff);
  return [octets[0]!, octets[1]!, octets[2]!, octets[3]!];
}

function classifyIpv4(host: string, oct: [number, number, number, number]): HostClassification {
  const [a, b, c, d] = oct;
  const dotted = `${a}.${b}.${c}.${d}`;
  const note = host === dotted ? "" : ` (normalized from "${host}")`;
  // metadata FIRST — the single most important SSRF target, inside link-local.
  if (a === 169 && b === 254 && c === 169 && d === 254) return cls(host, "metadata", "ipv4", `cloud metadata endpoint ${dotted}${note}`);
  if (a === 0) return cls(host, "unspecified", "ipv4", `unspecified ${dotted}${note}`);
  if (a === 127) return cls(host, "loopback", "ipv4", `loopback ${dotted}${note}`);
  if (a === 10) return cls(host, "private", "ipv4", `private 10/8 ${dotted}${note}`);
  if (a === 172 && b >= 16 && b <= 31) return cls(host, "private", "ipv4", `private 172.16/12 ${dotted}${note}`);
  if (a === 192 && b === 168) return cls(host, "private", "ipv4", `private 192.168/16 ${dotted}${note}`);
  if (a === 169 && b === 254) return cls(host, "linkLocal", "ipv4", `link-local 169.254/16 ${dotted}${note}`);
  if (a === 100 && b >= 64 && b <= 127) return cls(host, "cgnat", "ipv4", `CGNAT 100.64/10 ${dotted}${note}`);
  if (a === 192 && b === 0 && c === 0) return cls(host, "reserved", "ipv4", `IETF protocol 192.0.0/24 ${dotted}${note}`);
  if (a === 198 && (b === 18 || b === 19)) return cls(host, "reserved", "ipv4", `benchmarking 198.18/15 ${dotted}${note}`);
  if ((a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return cls(host, "reserved", "ipv4", `documentation TEST-NET ${dotted}${note}`);
  if (a >= 224 && a <= 239) return cls(host, "multicast", "ipv4", `multicast 224/4 ${dotted}${note}`);
  if (a >= 240) return cls(host, a === 255 && b === 255 && c === 255 && d === 255 ? "broadcast" : "reserved", "ipv4", `reserved/broadcast ${dotted}${note}`);
  return cls(host, "public", "ipv4", `public ${dotted}${note}`);
}

// ── IPv6 ─────────────────────────────────────────────────────────────────────────────────────────
/**
 * Expand an IPv6 literal to its 8 16-bit hextets. Handles "::" compression, an embedded dotted-v4
 * tail, and a zone id (%eth0). Returns null for ANY malformed input — so the classifier can
 * fail-CLOSED (treat un-parseable IPv6 as non-public) rather than defaulting it to "public".
 */
function expandIpv6(input: string): number[] | null {
  let s = input;
  const pct = s.indexOf("%"); if (pct >= 0) s = s.slice(0, pct);   // strip a zone id (fe80::1%eth0)
  // Convert an embedded dotted-v4 tail (::ffff:127.0.0.1) into two hex groups first.
  const v4 = s.match(/^(.*:)((?:\d{1,3}\.){3}\d{1,3})$/);
  if (v4) {
    const oct = ipv4ToOctets(v4[2]!);
    if (!oct) return null;
    s = v4[1]! + ((oct[0] << 8) | oct[1]).toString(16) + ":" + ((oct[2] << 8) | oct[3]).toString(16);
  }
  if (s === "::") return [0, 0, 0, 0, 0, 0, 0, 0];
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const grp of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(grp)) return null;             // reject non-hex / over-long hextets
      out.push(parseInt(grp, 16));
    }
    return out;
  };
  const head = groups(halves[0] ?? "");
  const tail = halves.length === 2 ? groups(halves[1] ?? "") : [];
  if (head === null || tail === null) return null;
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;                                    // "::" must stand for ≥1 zero group
    return [...head, ...new Array<number>(fill).fill(0), ...tail];
  }
  return head.length === 8 ? head : null;                         // no "::" → exactly 8 groups
}

function classifyIpv6(host: string): HostClassification {
  let h = host.toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  const g = expandIpv6(h);
  if (g === null) return cls(host, "invalid", "ipv6", "malformed IPv6 literal");  // fail-closed default
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];

  // Embedded IPv4 → reclassify via the v4 ranges. This closes the hex-hextet bypass that the WHATWG
  // URL parser produces (new URL("https://[::ffff:169.254.169.254]/").hostname === "[::ffff:a9fe:a9fe]").
  const embedded = (hi: number, lo: number): HostClassification => {
    const oct: [number, number, number, number] = [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
    const v4 = classifyIpv4(host, oct);
    return cls(host, v4.category, "ipv6", `IPv4-in-IPv6 → ${v4.reason}`);
  };

  if (g.every((x) => x === 0)) return cls(host, "unspecified", "ipv6", "unspecified ::");
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return cls(host, "loopback", "ipv6", "loopback ::1");
  if (g0 === 0xfd00 && g1 === 0x0ec2 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 0x254) return cls(host, "metadata", "ipv6", "AWS IPv6 metadata fd00:ec2::254");
  // IPv4-mapped ::ffff:W:Z, IPv4-compatible ::W:Z, IPv4-translated ::ffff:0:W:Z — embedded v4 in the last two hextets.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && ((g4 === 0 && (g5 === 0xffff || g5 === 0)) || (g4 === 0xffff && g5 === 0)) && (g6 !== 0 || g7 !== 0)) return embedded(g6, g7);
  // NAT64 64:ff9b::/96 — embedded v4 in the last two hextets.
  if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return embedded(g6, g7);
  // 6to4 2002:V4::/16 — embedded v4 in hextets 1-2.
  if (g0 === 0x2002) return embedded(g1, g2);
  // Special-purpose IPv6 ranges (numeric prefix checks).
  if ((g0 & 0xffc0) === 0xfe80) return cls(host, "linkLocal", "ipv6", "link-local fe80::/10");
  if ((g0 & 0xfe00) === 0xfc00) return cls(host, "uniqueLocal", "ipv6", "unique-local fc00::/7");
  if ((g0 & 0xff00) === 0xff00) return cls(host, "multicast", "ipv6", "multicast ff00::/8");
  if (g0 === 0x2001 && g1 === 0x0db8) return cls(host, "reserved", "ipv6", "documentation 2001:db8::/32");
  // Fail-closed: the top 64 bits being zero is never a global-unicast address (2000::/3) — non-public.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0) return cls(host, "reserved", "ipv6", "low-range ::/64 (non-global)");
  return cls(host, "public", "ipv6", "global-unicast IPv6");
}

// ── hostnames ──────────────────────────────────────────────────────────────────────────────────
const METADATA_NAMES = new Set(["metadata", "metadata.google.internal", "instance-data", "metadata.goog"]);

function classifyHostname(host: string): HostClassification {
  const h = host.replace(/\.$/, ""); // drop a trailing root dot
  if (h === "localhost" || h.endsWith(".localhost")) return cls(host, "loopback", "hostname", "localhost");
  if (METADATA_NAMES.has(h)) return cls(host, "metadata", "hostname", "cloud metadata hostname");
  if (h.endsWith(".local")) return cls(host, "linkLocal", "hostname", "mDNS .local", true);
  if (h.endsWith(".internal") || h.endsWith(".intranet") || h.endsWith(".corp") || h.endsWith(".home.arpa")) return cls(host, "private", "hostname", "internal TLD", true);
  if (!h.includes(".")) return cls(host, "private", "hostname", "bare hostname (no dot) — likely internal", true);
  // A dotted FQDN: cannot be proven safe without DNS. Tentatively public, but flag the recheck.
  return cls(host, "public", "hostname", "FQDN — re-classify each resolved IP (DNS-rebinding defence)", true);
}

/** Classify a host string (IPv4 incl. numeric bypasses / IPv6 / hostname) into an egress category. */
export function classifyHost(rawHost: string): HostClassification {
  const host = rawHost.trim().toLowerCase();
  if (host.length === 0) return cls(rawHost, "invalid", "hostname", "empty host");
  // A host (no port — the URL parser strips it) containing ':' or brackets is IPv6.
  if (host.startsWith("[") || host.includes(":")) return classifyIpv6(host);
  // IPv4 (dotted or numeric)
  if (/^[0-9a-fx.]+$/i.test(host)) {
    const oct = ipv4ToOctets(host);
    if (oct) return classifyIpv4(host, oct);
  }
  // hostname
  if (/^[a-z0-9._-]+$/.test(host)) return classifyHostname(host);
  return cls(rawHost, "invalid", "hostname", "host contains illegal characters");
}

// ── the egress policy + guard ────────────────────────────────────────────────────────────────────
export interface EgressPolicy {
  /** Allow dialling private/loopback/linkLocal/etc. Default false (deny-by-default). */
  readonly allowNonPublicHosts?: boolean;
  /** Allow the cloud metadata endpoint. Default false — and you almost never want this true. */
  readonly allowMetadataEndpoint?: boolean;
  /** Exact host allow-list (case-insensitive). An allow-listed host is permitted regardless of category. */
  readonly allowedHosts?: readonly string[];
  /** Permitted URL schemes. Default ["https"]. */
  readonly allowedSchemes?: readonly string[];
  /** Permit credentials (userinfo) in the URL. Default false — userinfo enables parser-confusion SSRF. */
  readonly allowUrlCredentials?: boolean;
  /**
   * Require TLS — when true, an otherwise-allowed PLAINTEXT (http) host is denied so credentials and
   * payload never leave the process in the clear. Default false (the scheme allow-list governs alone).
   * This is the runtime half of `TlsPolicy.requireTls` (until now static-validator-only).
   */
  readonly requireTls?: boolean;
  /**
   * Effective-port allow-list (scheme default applied: https⇒443, http⇒80). When set, an otherwise-allowed
   * host on any other port is denied — egress filtering that stops exfiltration/SSRF to non-web service
   * ports (22/3306/6379/25/…) even on a public host. Undefined ⇒ no port restriction (back-compatible).
   * This is the runtime half of `NetworkEndpointRule.ports` (until now static-validator-only).
   */
  readonly allowedPorts?: readonly number[];
  /**
   * Permit LOOPBACK (localhost / 127.0.0.0/8 / ::1) for LOCAL DEVELOPMENT — and ONLY loopback, never private
   * LAN / metadata / link-local (those stay SSRF-denied). When a loopback host is admitted this way, the TLS
   * and port checks are also skipped for it (a localhost dev server is local IPC over http on an arbitrary
   * port — nothing leaves the machine). Default false (fail-secure). The dial enables this only on an explicit
   * development signal, never in production. Narrower + safer than `allowNonPublicHosts`.
   */
  readonly allowLoopback?: boolean;
}

export interface EgressDecision {
  readonly allowed: boolean;
  readonly code: string;
  readonly category: HostCategory;
  readonly host: string;
  readonly reason: string;
  /** true ⇒ the caller MUST re-run guardOutboundHost on each resolved IP before connecting. */
  readonly requiresDnsRecheck: boolean;
}

const DENY_CATEGORIES: ReadonlySet<HostCategory> = new Set<HostCategory>([
  "loopback", "private", "linkLocal", "uniqueLocal", "cgnat", "multicast", "unspecified", "reserved", "broadcast", "invalid",
]);

/** Guard a resolved host (no scheme check). Fail-closed: only a public host (or allow-listed) passes. */
export function guardOutboundHost(rawHost: string, policy: EgressPolicy = {}): EgressDecision {
  const c = classifyHost(rawHost);
  const host = c.host;
  const allowList = new Set((policy.allowedHosts ?? []).map((h) => h.trim().toLowerCase()));
  if (allowList.has(host)) {
    // Operator-trusted host: skip the DNS-rebind recheck (the allow-list IS the explicit trust decision, and
    // guardResolvedAddresses would admit it anyway) — so a proxy that isn't resolvable from this process still works.
    return { allowed: true, code: "Galerina_NETWORK_EGRESS_ALLOWLISTED", category: c.category, host, reason: "host is explicitly allow-listed", requiresDnsRecheck: false };
  }
  if (c.category === "metadata") {
    const allowed = policy.allowMetadataEndpoint === true;
    return { allowed, code: allowed ? "Galerina_NETWORK_EGRESS_METADATA_ALLOWED" : "Galerina_NETWORK_SSRF_METADATA_DENIED", category: c.category, host, reason: allowed ? "metadata endpoint explicitly allowed (dangerous)" : `SSRF: ${c.reason} denied`, requiresDnsRecheck: c.requiresDnsRecheck };
  }
  // Local-development loopback exception — ONLY loopback (localhost / 127/8 / ::1), nothing else. Local IPC
  // never leaves the machine, so a localhost dev server is admitted; private LAN / metadata / link-local stay
  // SSRF-denied below. The dial enables this only on an explicit development signal, never in production.
  if (c.category === "loopback" && policy.allowLoopback === true) {
    return { allowed: true, code: "Galerina_NETWORK_EGRESS_LOOPBACK_DEV", category: c.category, host, reason: "loopback permitted for local development (non-production)", requiresDnsRecheck: false };
  }
  if (DENY_CATEGORIES.has(c.category)) {
    const allowed = policy.allowNonPublicHosts === true && c.category !== "invalid";
    return { allowed, code: allowed ? "Galerina_NETWORK_EGRESS_NONPUBLIC_ALLOWED" : "Galerina_NETWORK_SSRF_NONPUBLIC_DENIED", category: c.category, host, reason: allowed ? `non-public ${c.reason} explicitly allowed` : `SSRF: ${c.reason} denied (deny-by-default)`, requiresDnsRecheck: c.requiresDnsRecheck };
  }
  // public (or an FQDN tentatively public)
  return { allowed: true, code: "Galerina_NETWORK_EGRESS_ALLOWED", category: c.category, host, reason: c.reason, requiresDnsRecheck: c.requiresDnsRecheck };
}

/** Guard an outbound URL: scheme + credentials + host (+ TLS/port), fail-closed on any parse/category failure. */
export function guardOutboundUrl(url: string, policy: EgressPolicy = {}): EgressDecision {
  const schemes = new Set((policy.allowedSchemes ?? ["https"]).map((s) => s.toLowerCase().replace(/:$/, "")));
  let parsed: { protocol: string; hostname: string; username: string; password: string; port: string };
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, code: "Galerina_NETWORK_EGRESS_URL_INVALID", category: "invalid", host: "", reason: "URL could not be parsed (fail-closed)", requiresDnsRecheck: false };
  }
  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (!schemes.has(scheme)) {
    return { allowed: false, code: "Galerina_NETWORK_EGRESS_SCHEME_DENIED", category: "invalid", host: parsed.hostname, reason: `scheme "${scheme}" not in allow-list [${[...schemes].join(",")}]`, requiresDnsRecheck: false };
  }
  if ((parsed.username !== "" || parsed.password !== "") && policy.allowUrlCredentials !== true) {
    return { allowed: false, code: "Galerina_NETWORK_SSRF_URL_CREDENTIALS_DENIED", category: "invalid", host: parsed.hostname, reason: "URL carries embedded credentials (userinfo) — parser-confusion SSRF vector, denied", requiresDnsRecheck: false };
  }
  const hostDecision = guardOutboundHost(parsed.hostname, policy);
  // TLS + port enforcement run ONLY on an otherwise-ALLOWED host, so SSRF/host-category denials keep their
  // exact code+reason (a plaintext URL to an internal host is still reported as the SSRF finding, not a TLS one).
  if (!hostDecision.allowed) return hostDecision;
  // Loopback admitted for local dev = local IPC: skip TLS/port (a localhost dev server is http on a dev port).
  if (hostDecision.category === "loopback") return hostDecision;
  // An explicitly allow-listed host (e.g. an internal egress PROXY) is operator-trusted in EVERY environment,
  // including production — admit it over plaintext / any port (skip TLS + port). The allow-list is exact-host
  // signed/operator config, so "even in production we work with an internal proxy" without relaxing force-HTTPS
  // for anything else. (allowedHosts already overrode the SSRF host-category denial in guardOutboundHost.)
  if (hostDecision.code === "Galerina_NETWORK_EGRESS_ALLOWLISTED") return hostDecision;
  if (policy.requireTls === true && scheme !== "https") {
    return { allowed: false, code: "Galerina_NETWORK_EGRESS_TLS_REQUIRED", category: hostDecision.category, host: hostDecision.host, reason: `plaintext scheme "${scheme}" denied — TLS (https) required (fail-closed)`, requiresDnsRecheck: false };
  }
  if (policy.allowedPorts !== undefined) {
    const effectivePort = parsed.port !== "" ? Number(parsed.port) : scheme === "https" ? 443 : scheme === "http" ? 80 : NaN;
    if (!Number.isInteger(effectivePort) || !policy.allowedPorts.includes(effectivePort)) {
      return { allowed: false, code: "Galerina_NETWORK_EGRESS_PORT_DENIED", category: hostDecision.category, host: hostDecision.host, reason: `port ${parsed.port !== "" ? parsed.port : effectivePort} not in allow-list [${policy.allowedPorts.join(",")}] (fail-closed)`, requiresDnsRecheck: false };
    }
  }
  return hostDecision;
}

/** Validate a user-supplied WEBHOOK target — the prime SSRF vector. https + public-only, no overrides. */
export function validateWebhookTarget(url: string, policy: EgressPolicy = {}): EgressDecision {
  // Webhooks force the strict posture regardless of caller policy: https only, no metadata, no
  // non-public, no credentials. An allow-list is still honoured (a known internal webhook receiver).
  const strict: EgressPolicy = {
    allowedSchemes: ["https"],
    allowMetadataEndpoint: false,
    allowNonPublicHosts: false,
    allowUrlCredentials: false,
    ...(policy.allowedHosts !== undefined ? { allowedHosts: policy.allowedHosts } : {}),
  };
  return guardOutboundUrl(url, strict);
}

/**
 * Connect-time DNS-rebinding defence. A hostname guard alone is TOCTOU-vulnerable: a name that
 * looked public at check time can resolve to a private IP at connect time (DNS rebinding), or
 * resolve to a MIX of public + private addresses. Re-classify EVERY resolved address and deny if
 * ANY is non-public — unless the host is explicitly allow-listed (a trusted internal receiver) or
 * the policy opts into non-public hosts. The caller passes the addresses its resolver returned and
 * MUST connect ONLY to a verified address (pin it; do not re-resolve). Fail-closed: no addresses
 * resolved ⇒ deny.
 */
export function guardResolvedAddresses(host: string, resolvedIps: readonly string[], policy: EgressPolicy = {}): EgressDecision {
  const h = host.trim().toLowerCase();
  if (resolvedIps.length === 0) {
    return { allowed: false, code: "Galerina_NETWORK_SSRF_NO_RESOLUTION", category: "invalid", host: h, reason: "no resolved addresses (fail-closed)", requiresDnsRecheck: false };
  }
  // An explicitly allow-listed host is trusted to reach its addresses (e.g. a known internal receiver).
  const allowList = new Set((policy.allowedHosts ?? []).map((x) => x.trim().toLowerCase()));
  if (allowList.has(h)) {
    return { allowed: true, code: "Galerina_NETWORK_EGRESS_ALLOWLISTED", category: "public", host: h, reason: "host is explicitly allow-listed", requiresDnsRecheck: false };
  }
  // Re-classify EVERY resolved address; deny on the FIRST non-public one (mixed resolution is an attack).
  for (const ip of resolvedIps) {
    const d = guardOutboundHost(ip, policy);
    if (!d.allowed) {
      return { allowed: false, code: "Galerina_NETWORK_SSRF_DNS_REBIND_DENIED", category: d.category, host: h, reason: `DNS-rebinding guard: resolved address ${ip} → ${d.reason}`, requiresDnsRecheck: false };
    }
  }
  return { allowed: true, code: "Galerina_NETWORK_EGRESS_ALLOWED", category: "public", host: h, reason: `all ${resolvedIps.length} resolved address(es) are public`, requiresDnsRecheck: false };
}

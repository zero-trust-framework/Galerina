/**
 * LogicN HTTP / HTTPS API-server adapter.
 *
 * A DELIBERATELY THIN node:http / node:https transport in front of the App Kernel.
 * Its only job is to turn a raw request into a normalised `LogicnKernelRequest`,
 * hand it to `kernel.handle()`, and write the kernel's typed response back onto
 * the socket. It is NOT a place for policy, middleware, auth, or routing — all
 * of that lives in the kernel's fixed, non-bypassable pipeline and MUST NOT be
 * pre-empted, re-ordered, or skipped here.
 *
 * There are two ADDITIVE exceptions — neither pre-empts, re-orders, or relaxes the
 * kernel's gate ordering; both are evaluated by the kernel, not the transport:
 *   1. A hard cap on how many body bytes the adapter will buffer before it even
 *      calls the kernel (DoS guard). The kernel ALSO enforces its own per-route,
 *      posture-aware body-size policy; this cap never removes or relaxes it. When
 *      the cap trips we respond 413 and destroy the socket WITHOUT buffering more.
 *   2. An OPTIONAL channel/identity verdict (TLSTP S1 cert-gate) fed to the kernel.
 *      The kernel folds it FAIL-CLOSED in its auth step as an authentication factor:
 *      only +1/ALLOW (e.g. a fully-validated, pinned, fresh-revocation client cert)
 *      authenticates the channel; 0/−1 deny. A verified channel authenticates in
 *      lieu of a bearer token (mutual-TLS semantics); it does not relax any other
 *      gate. There are two ways to supply it, in precedence order:
 *        a. an explicit `resolveChannelVerdict` hook (advanced / custom transports);
 *        b. the built-in `tls` mode — pass key/cert (+ optional `ca`, `pinnedDigests`,
 *           `checkRevocation`, …) and the adapter stands up an HTTPS server, reads the
 *           peer cert via `getPeerCertificate(true)`, maps the Node TLS library's
 *           outcomes into a `CertGateInput`, calls the shipped `certGate`, and sets
 *           `channelVerdict = decision.verdict`.
 *      Both are unset by default → no channel verdict is supplied → the adapter behaves
 *      exactly as before, leaving admission entirely to the kernel's own auth gate. A
 *      throwing resolver / unreadable cert factor DENIES (fail-closed).
 *
 * Binding posture: all crypto / TLS / X.509 path-building / signature math stays in
 * the Node TLS library (Binary / digital). This adapter performs NONE of it — it only
 * reads the library's already-decided outcomes and folds K3 trits via `certGate`.
 */
import http from "node:http";
import https from "node:https";
import { randomUUID, createHash } from "node:crypto";
import type { TLSSocket, DetailedPeerCertificate, SecureContextOptions } from "node:tls";
import type { AppKernel, LogicnKernelRequest, LogicnKernelResponse } from "../../logicn-framework-app-kernel/dist/index.js";
import type { HttpMethod } from "../../logicn-framework-app-kernel/dist/index.js";
import { Verdict } from "../../logicn-tower-citizen/dist/index.js";
// TLSTP S1 cert-gate (fail-closed K3 fold; revocation-unknown → DENY). The adapter feeds it the
// TLS library's outputs and forwards the folded verdict — it never re-implements any crypto/PKI.
import {
  certGate,
  type CertGateInput,
  type ChainValidationOutcome,
  type RevocationOutcome,
} from "../../logicn-core-network/dist/index.js";

/** Default hard cap on buffered body bytes (8 MiB). Additive to the kernel's own body-size gate. */
export const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024;
/** Default explicit transport timeouts (slowloris / idle-connection defence). Set so the guard is
 *  intentional, not dependent on the Node version's defaults. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_HEADERS_TIMEOUT_MS = 10_000;
export const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

/**
 * Outcome of a host-injected revocation check. A bare `RevocationOutcome` is also
 * accepted (treated as the current status, i.e. `producedAt = now`); the object form
 * lets a host supply the OCSP/CRL `producedAt` so the cert-gate can enforce freshness.
 */
export interface RevocationResolution {
  readonly outcome: RevocationOutcome;
  /** OCSP/CRL response production time (epoch ms). Omitted ⇒ treated as "now". */
  readonly producedAt?: number;
}

/**
 * Opt-in mutual-TLS mode. Supplying `tls` makes `createApiServer` stand up an HTTPS
 * server and derive the channel verdict from the peer certificate via the S1 cert-gate.
 *
 * Posture: the Node TLS library still performs ALL chain validation / signature math;
 * this adapter only reads its outcomes (`socket.authorized`, the parsed cert) and folds
 * them to a fail-closed K3 verdict. Defaults are mTLS-friendly and fail-closed:
 *   - `requestCert` defaults to `true` (ask the client for a cert);
 *   - `rejectUnauthorized` defaults to `false` so the handshake COMPLETES and an
 *     unauthorized/absent cert becomes a clean application-layer 401 (folded by the
 *     cert-gate) rather than a transport-level handshake reset. The cert-gate, not the
 *     TLS layer, is what decides admission.
 */
export interface ApiServerTlsOptions {
  /** PEM (or KeyObject-compatible) private key for the server's own TLS identity. */
  readonly key: string | Buffer;
  /** PEM certificate (chain) for the server's own TLS identity. */
  readonly cert: string | Buffer;
  /** Trusted CA(s) used by the Node TLS library to validate the CLIENT certificate chain. */
  readonly ca?: string | Buffer | Array<string | Buffer>;
  /** Request a client certificate during the handshake (mTLS). Default: `true`. */
  readonly requestCert?: boolean;
  /**
   * Whether the TLS layer itself aborts the handshake on an unauthorized client cert.
   * Default: `false` — the handshake completes so the cert-gate folds the outcome to a
   * fail-closed K3 verdict (clean 401), instead of resetting the connection. Set `true`
   * only if you want TLS-layer rejection in ADDITION to (before) the cert-gate.
   */
  readonly rejectUnauthorized?: boolean;
  /**
   * Pinned leaf-certificate sha256 digests (hex). Colons and case are ignored, so both
   * `"AB:CD:…"` (Node's `fingerprint256` form) and `"abcd…"` are accepted. When set, the
   * presented leaf's sha256(DER) must match one of these or the channel is DENIED (−1).
   */
  readonly pinnedDigests?: readonly string[];
  /** Freshness window (ms) a revocation "good" must fall within to count as +1. */
  readonly revocationFreshnessMs?: number;
  /**
   * Host-injected revocation predicate (mirrors fuse-loader's shape). Given the peer
   * cert, returns the revocation outcome (optionally with a `producedAt`). Absent /
   * `undefined` / a THROW all map to "unknown" → 0 (INDETERMINATE) → DENY — never +1.
   * This is the fail-closed seam: a missing or failed revocation check denies.
   */
  readonly checkRevocation?: (
    cert: DetailedPeerCertificate,
  ) => RevocationResolution | RevocationOutcome | undefined;
  /** Extra Node TLS secure-context options merged in verbatim (e.g. `minVersion`, `ciphers`). */
  readonly secureContextOptions?: SecureContextOptions;
}

export interface CreateApiServerOptions {
  readonly kernel: AppKernel;
  /** Hard cap on buffered body bytes before 413 + socket destroy. Default 8 MiB. */
  readonly maxBodyBytes?: number;
  /** Max ms for the whole request (slowloris body defence). Default 30s. */
  readonly requestTimeoutMs?: number;
  /** Max ms to receive the request headers. Default 10s. */
  readonly headersTimeoutMs?: number;
  /** Idle-socket timeout. Default 30s. */
  readonly idleTimeoutMs?: number;
  /**
   * Opt-in mutual-TLS mode. When set, the adapter creates an HTTPS server and derives
   * the channel verdict from the peer certificate via the shipped S1 cert-gate. Unset →
   * a plain `node:http` server (legacy, unchanged). See {@link ApiServerTlsOptions}.
   *
   * Precedence: an explicit `resolveChannelVerdict` (below), if supplied, OVERRIDES the
   * built-in cert-gate resolver (the `tls` server is still created, but you provide the
   * verdict). With `tls` set and no `resolveChannelVerdict`, the cert-gate resolver is used.
   */
  readonly tls?: ApiServerTlsOptions;
  /**
   * OPTIONAL resolver for the TLSTP S1 channel/identity verdict. Given the raw request
   * (e.g. its TLS socket's peer certificate), return a K3 `Verdict` that the kernel folds
   * into admission, FAIL-CLOSED (only +1/ALLOW admits; 0/−1 deny). This is the manual
   * escape hatch; for standard mTLS prefer the `tls` option above, which wires this to
   * `certGate` for you.
   *
   * This is the live end-to-end channel-verdict path: transport → cert-gate →
   * `channelVerdict` → kernel `decideAtBoundary` fold. The kernel folds it in its auth
   * step as a fail-closed authentication factor (a +1 channel authenticates in lieu of a
   * bearer token; 0/−1 deny). The transport never pre-empts the pipeline.
   *
   * Default: unset → no channel verdict is supplied → the adapter behaves exactly as
   * before, leaving admission entirely to the kernel's own auth gate (no behaviour change).
   *
   * Fail-closed contract: if the resolver THROWS, the channel is DENIED (−1) — it is never
   * silently downgraded to the header path. Returning `undefined` is the explicit "no
   * opinion → defer to the kernel's auth path" signal (distinct from throwing).
   */
  readonly resolveChannelVerdict?: (req: http.IncomingMessage) => Verdict | undefined;
}

/** A fail-closed 500 written when the kernel itself throws. Never leaks the error. */
const INTERNAL_ERROR_BODY = Buffer.from(
  JSON.stringify({ error: "internal_error" }),
  "utf8",
);

/** A 413 written by the adapter's own body cap (distinct from the kernel's 413). */
const PAYLOAD_TOO_LARGE_BODY = Buffer.from(
  JSON.stringify({ error: "payload_too_large" }),
  "utf8",
);

/** Buffer the request body up to `maxBodyBytes`. Resolves with the bytes, or
 *  rejects with a sentinel once the cap is exceeded (caller writes 413). */
class BodyCapExceeded extends Error {}

function bufferBody(
  req: http.IncomingMessage,
  maxBodyBytes: number,
): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const onData = (chunk: Buffer): void => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBodyBytes) {
        // Stop buffering immediately — do NOT push this chunk or any further bytes.
        settled = true;
        cleanup();
        reject(new BodyCapExceeded());
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(new Uint8Array(Buffer.concat(chunks, total)));
    };
    const onError = (err: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const cleanup = (): void => {
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

/** Lowercase every header name into a plain Record<string,string>. Array-valued
 *  headers (e.g. set-cookie on a request, repeated headers) are joined with ", ". */
function lowercaseHeaders(
  raw: http.IncomingHttpHeaders,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    const key = name.toLowerCase();
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

/** Parse `req.url` into a kernel path + flat query Record. */
function parseUrl(rawUrl: string | undefined): {
  path: string;
  query: Record<string, string>;
} {
  const url = new URL(rawUrl ?? "/", "http://x");
  const query: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) {
    // Last value wins for repeated keys — a flat Record cannot represent arrays.
    query[k] = v;
  }
  return { path: url.pathname, query };
}

function normaliseMethod(raw: string | undefined): HttpMethod {
  // Uppercase the verb. The kernel route-matches on method, so an unknown verb
  // simply fails to match (→ 404/405); we never need to reject it here.
  const upper = (raw ?? "GET").toUpperCase();
  return upper as HttpMethod;
}

function writeResponse(
  res: http.ServerResponse,
  resp: LogicnKernelResponse,
): void {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(resp.status, { ...resp.headers });
  if (resp.body && resp.body.length > 0) {
    res.end(Buffer.from(resp.body));
  } else {
    res.end();
  }
}

// ── TLSTP S1: peer-cert → CertGateInput mapping (pure trit-mapping; no crypto here) ──

/** Strip colons / whitespace and lowercase a hex sha256 digest for comparison. */
function normaliseDigest(d: string): string {
  return d.replace(/[\s:]/g, "").toLowerCase();
}

/** Node reports cert validity as e.g. "Jun 23 12:00:00 2026 GMT". Parse → epoch ms,
 *  or `undefined` if unparseable (→ the cert-gate defaults notExpired to 0). */
function parseCertDate(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
}

/** Duck-type a socket as a TLS socket (an HTTPS request's `req.socket`). */
function isTlsSocket(s: unknown): s is TLSSocket {
  return (
    typeof s === "object" &&
    s !== null &&
    typeof (s as { getPeerCertificate?: unknown }).getPeerCertificate === "function"
  );
}

/**
 * Map a COMPLETED TLS handshake's peer certificate into a `CertGateInput`.
 *
 * This is a pure trit-mapping. It reads what the Node TLS library already decided
 * (`socket.authorized`, the parsed `DetailedPeerCertificate`) and converts it to the
 * cert-gate's factor inputs. It performs NO ASN.1 parsing, path-building, signature
 * math, or OCSP/CRL parsing itself. Every missing / unreadable factor is left absent so
 * `certGate` defaults it to `0` (INDETERMINATE) — the fail-closed seam. Nothing here can
 * map a missing factor to +1.
 */
function certInputFromTlsSocket(
  socket: TLSSocket,
  tlsOpts: ApiServerTlsOptions,
  now: number,
): CertGateInput {
  const pins =
    tlsOpts.pinnedDigests !== undefined
      ? tlsOpts.pinnedDigests.map(normaliseDigest)
      : undefined;

  // getPeerCertificate(true) returns the full chain (leaf at top); `{}` when no cert
  // was presented. We treat an empty object / missing DER as "no client cert".
  const cert = socket.getPeerCertificate(true);
  const hasCert =
    cert !== null &&
    typeof cert === "object" &&
    cert.raw instanceof Buffer &&
    cert.raw.length > 0;

  if (!hasCert) {
    // No client cert: every factor is un-provable → all default to 0 → DENY. We still
    // forward the pins (so pinMatch is 0 "can't compare", never a spurious −1) and the clock.
    return {
      ...(pins !== undefined ? { pinnedDigests: pins } : {}),
      now,
    };
  }

  // chainOutcome comes from the LIBRARY's own verdict — we never re-validate the chain.
  //   authorized === true  → "valid" (+1)
  //   cert present, not authorized → "invalid" (−1)
  const chainOutcome: ChainValidationOutcome = socket.authorized ? "valid" : "invalid";

  // Presented digest = sha256 over the leaf's DER bytes (library-provided). Lowercase hex,
  // colon-free — matches `normaliseDigest(pin)`.
  const presentedDigest = createHash("sha256").update(cert.raw).digest("hex");

  const notBefore = parseCertDate(cert.valid_from);
  const notAfter = parseCertDate(cert.valid_to);

  // Optional revocation. Host-injected; a THROW or absent/undefined result ⇒ unknown ⇒ 0.
  let revocation: RevocationOutcome | undefined;
  let revocationProducedAt: number | undefined;
  if (tlsOpts.checkRevocation !== undefined) {
    try {
      const res = tlsOpts.checkRevocation(cert);
      if (typeof res === "string") {
        revocation = res;
        revocationProducedAt = now; // bare outcome = current status as of `now`
      } else if (res !== undefined) {
        revocation = res.outcome;
        revocationProducedAt = res.producedAt !== undefined ? res.producedAt : now;
      }
    } catch {
      // Fail-closed: a throwing revocation check is "unknown" (0), never +1.
      revocation = undefined;
      revocationProducedAt = undefined;
    }
  }

  return {
    ...(pins !== undefined ? { pinnedDigests: pins } : {}),
    presentedDigest,
    chainOutcome,
    ...(notBefore !== undefined ? { notBefore } : {}),
    ...(notAfter !== undefined ? { notAfter } : {}),
    now,
    ...(revocation !== undefined ? { revocation } : {}),
    ...(revocationProducedAt !== undefined ? { revocationProducedAt } : {}),
    ...(tlsOpts.revocationFreshnessMs !== undefined
      ? { revocationFreshnessMs: tlsOpts.revocationFreshnessMs }
      : {}),
  };
}

/**
 * Build the cert-gate-backed channel-verdict resolver for the `tls` mode. Reads the peer
 * cert off the request's TLS socket, maps it, folds via `certGate`, and returns the
 * verdict the kernel will collapse fail-closed. A non-TLS socket (should not happen on an
 * HTTPS server) DENIES rather than guessing. The handleRequest try/catch additionally
 * maps any throw to DENY, so this path is fail-closed end to end.
 */
function makeCertGateResolver(
  tlsOpts: ApiServerTlsOptions,
): (req: http.IncomingMessage) => Verdict {
  return (req) => {
    const socket: unknown = req.socket;
    if (!isTlsSocket(socket)) return Verdict.DENY;
    const input = certInputFromTlsSocket(socket, tlsOpts, Date.now());
    return certGate(input).verdict;
  };
}

/** Map `ApiServerTlsOptions` into Node `https.ServerOptions`. Named options take precedence
 *  over the generic `secureContextOptions` bag; mTLS defaults are fail-closed (see the type). */
function buildSecureContext(tlsOpts: ApiServerTlsOptions): https.ServerOptions {
  return {
    ...(tlsOpts.secureContextOptions ?? {}),
    key: tlsOpts.key,
    cert: tlsOpts.cert,
    ...(tlsOpts.ca !== undefined ? { ca: tlsOpts.ca } : {}),
    requestCert: tlsOpts.requestCert !== undefined ? tlsOpts.requestCert : true,
    rejectUnauthorized:
      tlsOpts.rejectUnauthorized !== undefined ? tlsOpts.rejectUnauthorized : false,
  };
}

/**
 * Create an HTTP (or, with `opts.tls`, HTTPS) server that funnels every request through
 * the App Kernel. The returned server is NOT yet listening — call `listen(server, port)`.
 */
export function createApiServer(opts: CreateApiServerOptions): http.Server {
  const { kernel } = opts;
  const maxBodyBytes =
    opts.maxBodyBytes !== undefined ? opts.maxBodyBytes : DEFAULT_MAX_BODY_BYTES;

  // Resolve the channel-verdict resolver. Precedence: an explicit resolveChannelVerdict
  // wins (advanced escape hatch); otherwise, if TLS is configured, derive the cert-gate
  // resolver; otherwise none (plain-http legacy path — kernel header auth, unchanged).
  const resolveChannelVerdict: ((req: http.IncomingMessage) => Verdict | undefined) | undefined =
    opts.resolveChannelVerdict !== undefined
      ? opts.resolveChannelVerdict
      : opts.tls !== undefined
        ? makeCertGateResolver(opts.tls)
        : undefined;

  const onRequest = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    void handleRequest(kernel, maxBodyBytes, resolveChannelVerdict, req, res);
  };

  // HTTPS when `tls` is set, else plain HTTP. https.Server is declared as `extends tls.Server`
  // in @types/node, so it is not statically assignable to http.Server even though it IS an
  // http server at runtime (same request semantics, same .listen/.close, and it carries the
  // requestTimeout/headersTimeout/timeout we set below). The one localized cast reflects that
  // runtime reality; callers use the returned value purely as a request-handling server.
  const server: http.Server =
    opts.tls !== undefined
      ? (https.createServer(buildSecureContext(opts.tls), onRequest) as unknown as http.Server)
      : http.createServer(onRequest);

  // Explicit transport timeouts — a slowloris / idle-connection defence at the toxic border, additive
  // to the body cap (the kernel cannot see transport-level stalls). Set intentionally rather than
  // inheriting the Node version's defaults (#211 inbound-listener hardening).
  server.requestTimeout = opts.requestTimeoutMs !== undefined ? opts.requestTimeoutMs : DEFAULT_REQUEST_TIMEOUT_MS;
  server.headersTimeout = opts.headersTimeoutMs !== undefined ? opts.headersTimeoutMs : DEFAULT_HEADERS_TIMEOUT_MS;
  server.timeout = opts.idleTimeoutMs !== undefined ? opts.idleTimeoutMs : DEFAULT_IDLE_TIMEOUT_MS;
  return server;
}

async function handleRequest(
  kernel: AppKernel,
  maxBodyBytes: number,
  resolveChannelVerdict: ((req: http.IncomingMessage) => Verdict | undefined) | undefined,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  // (1) Buffer the body under the hard adapter cap (additive DoS guard).
  let body: Uint8Array;
  try {
    body = await bufferBody(req, maxBodyBytes);
  } catch (err) {
    if (err instanceof BodyCapExceeded) {
      // 413 + destroy the socket WITHOUT buffering further bytes. Never reaches the kernel.
      if (!res.headersSent && !res.writableEnded) {
        res.writeHead(413, {
          "content-type": "application/json",
          connection: "close",
        });
        res.end(PAYLOAD_TOO_LARGE_BODY);
      }
      req.destroy();
      req.socket?.destroy();
      return;
    }
    // Transport error reading the body — fail closed, no leak.
    if (!res.headersSent && !res.writableEnded) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(INTERNAL_ERROR_BODY);
    }
    return;
  }

  // (2) Resolve the optional channel/identity verdict (TLSTP S1) — fail-closed.
  // A configured resolver that THROWS denies the channel (−1); it is never silently
  // downgraded to the kernel's header path. An unset resolver, or one returning
  // undefined, leaves channelVerdict absent → the kernel uses its own auth path.
  let channelVerdict: Verdict | undefined;
  if (resolveChannelVerdict !== undefined) {
    try {
      channelVerdict = resolveChannelVerdict(req);
    } catch {
      channelVerdict = Verdict.DENY;
    }
  }

  // (3) Normalise into a LogicnKernelRequest.
  const { path, query } = parseUrl(req.url);
  const kreq: LogicnKernelRequest = {
    method: normaliseMethod(req.method),
    path,
    headers: lowercaseHeaders(req.headers),
    body,
    query,
    requestId: randomUUID(),
    receivedAt: Date.now(),
    ...(channelVerdict !== undefined ? { channelVerdict } : {}),
  };

  // (4) Hand to the kernel's fixed, non-bypassable pipeline. (5) Write its response.
  let resp: LogicnKernelResponse;
  try {
    resp = await kernel.handle(kreq);
  } catch {
    // Fail CLOSED — never leak the underlying error to the client.
    if (!res.headersSent && !res.writableEnded) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(INTERNAL_ERROR_BODY);
    }
    return;
  }

  writeResponse(res, resp);
}

/** Start listening on `port` (0 = ephemeral). Resolves with the bound address. */
export function listen(
  server: http.Server,
  port: number,
): Promise<{ address: string; port: number }> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => {
      server.removeListener("error", onError);
      reject(err);
    };
    server.once("error", onError);
    server.listen(port, () => {
      server.removeListener("error", onError);
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve({ address: addr.address, port: addr.port });
      } else {
        resolve({ address: "127.0.0.1", port });
      }
    });
  });
}

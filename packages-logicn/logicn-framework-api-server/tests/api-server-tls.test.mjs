/**
 * End-to-end tests for the api-server's opt-in mutual-TLS mode (TLSTP S1 cert-gate).
 *
 * These drive a REAL kernel through a REAL HTTPS socket: createAppKernel → createApiServer
 * with `{ tls: {...} }` → listen(0) → fire HTTPS requests that present (or omit) a client
 * certificate. Nothing is mocked. The Node TLS library performs ALL chain validation; the
 * adapter only reads its outcomes (`socket.authorized`, the parsed cert) and folds them into
 * a fail-closed K3 verdict via the shipped `certGate`, which the kernel collapses at its auth
 * gate (only +1/ALLOW admits; 0/−1 → 401).
 *
 * Fixtures (committed under tests/fixtures/tls/, generated once with openssl — see
 * tests/fixtures/tls/gen-certs.sh):
 *   - ca.crt ................ the trusted CA the server validates client certs against
 *   - server.key/.crt ....... the server's own TLS identity (CN/SAN 127.0.0.1)
 *   - client-good.key/.crt .. signed by ca.crt  → Node sets socket.authorized === true
 *   - client-untrusted.* .... signed by a DIFFERENT (untrusted) CA → socket.authorized === false
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAppKernel } from "../../logicn-framework-app-kernel/dist/index.js";
import { createApiServer, listen } from "../dist/index.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "tls");
const read = (f) => fs.readFileSync(path.join(FIX, f));

const SERVER_KEY = read("server.key");
const SERVER_CERT = read("server.crt");
const CA_CERT = read("ca.crt");
const CLIENT_GOOD_CERT = read("client-good.crt");
const CLIENT_GOOD_KEY = read("client-good.key");
const CLIENT_UNTRUSTED_CERT = read("client-untrusted.crt");
const CLIENT_UNTRUSTED_KEY = read("client-untrusted.key");

/** A pin is sha256 over the leaf cert's DER bytes — EXACTLY what the adapter computes from
 *  getPeerCertificate(true).raw. Deriving it from the fixture keeps the test self-consistent. */
const pinOf = (certPem) =>
  crypto.createHash("sha256").update(new crypto.X509Certificate(certPem).raw).digest("hex");
const GOOD_PIN = pinOf(CLIENT_GOOD_CERT);
const UNTRUSTED_PIN = pinOf(CLIENT_UNTRUSTED_CERT);

/** A "good + fresh" revocation answer for the host-injected check; producedAt defaults to now. */
const REVOCATION_GOOD = () => "good";

/** auth-REQUIRED GET /secure kernel; records whether the handler actually ran so we can
 *  assert a denied channel blocks BEFORE dispatch (handler never reached). */
function buildSecureKernel(ran) {
  return createAppKernel({
    routes: [{ method: "GET", path: "/secure", handler: "secure" }], // default auth: required
    dispatch: { secure: () => { ran.value = true; return { status: 200, body: { ok: true } }; } },
  });
}

/** Spin up a TLS api-server with the given extra `tls` options merged over the base identity. */
async function withTlsServer(tlsExtra, fn) {
  const ran = { value: false };
  const server = createApiServer({
    kernel: buildSecureKernel(ran),
    tls: { key: SERVER_KEY, cert: SERVER_CERT, ca: CA_CERT, ...tlsExtra },
  });
  const { port } = await listen(server, 0);
  try {
    return await fn(port, ran);
  } finally {
    await new Promise((r) => server.close(() => r(undefined)));
  }
}

/**
 * Fire one HTTPS request, optionally presenting a client cert/key. `rejectUnauthorized:false`
 * makes the CLIENT skip validating the server cert — we are exercising the SERVER's validation
 * of the CLIENT, which is the whole point of mTLS here.
 */
function tlsRequest(port, { method = "GET", path: reqPath = "/secure", clientKey, clientCert } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: reqPath,
        rejectUnauthorized: false,
        ...(clientKey !== undefined ? { key: clientKey } : {}),
        ...(clientCert !== undefined ? { cert: clientCert } : {}),
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ── (a) valid pinned client cert → admitted (all four sub-verdicts +1) ──
test("(a) valid pinned client cert + fresh revocation → admits, handler runs (no Authorization header)", async () => {
  await withTlsServer(
    { pinnedDigests: [GOOD_PIN], checkRevocation: REVOCATION_GOOD, revocationFreshnessMs: 60_000 },
    async (port, ran) => {
      const res = await tlsRequest(port, { clientKey: CLIENT_GOOD_KEY, clientCert: CLIENT_GOOD_CERT });
      assert.equal(res.status, 200);
      assert.equal(ran.value, true);
      assert.deepEqual(JSON.parse(res.body), { ok: true });
    },
  );
});

// ── (b) revocation UNKNOWN → 401 (the headline soft-fail-closed case) ──
// Pin matches, chain valid, cert not expired — but the revocation answer is "unknown" (0).
// vAnd(+1,+1,+1,0) = 0 → DENY. A public browser would have soft-failed OPEN here; S1 does not.
test("(b) valid pinned cert but revocation UNKNOWN → 401 (fail-closed), handler NOT run", async () => {
  await withTlsServer(
    { pinnedDigests: [GOOD_PIN], checkRevocation: () => "unknown", revocationFreshnessMs: 60_000 },
    async (port, ran) => {
      const res = await tlsRequest(port, { clientKey: CLIENT_GOOD_KEY, clientCert: CLIENT_GOOD_CERT });
      assert.equal(res.status, 401);
      assert.equal(ran.value, false);
    },
  );
});

// ── (c) chain INVALID → 401 ──
// We pin the untrusted leaf's digest and give a fresh "good" revocation, so pin_match=+1,
// not_expired=+1, revocation_fresh=+1 and the ONLY failing factor is chain_valid=−1 (the cert
// is signed by a CA the server does not trust → socket.authorized === false). min{...} = −1 → DENY.
test("(c) client cert with an untrusted chain → 401 (chain_valid = −1), handler NOT run", async () => {
  await withTlsServer(
    { pinnedDigests: [UNTRUSTED_PIN], checkRevocation: REVOCATION_GOOD, revocationFreshnessMs: 60_000 },
    async (port, ran) => {
      const res = await tlsRequest(port, {
        clientKey: CLIENT_UNTRUSTED_KEY,
        clientCert: CLIENT_UNTRUSTED_CERT,
      });
      assert.equal(res.status, 401);
      assert.equal(ran.value, false);
    },
  );
});

// ── (d) no client cert on a required-auth route → 401 ──
// requestCert is on (default), rejectUnauthorized off (default) → the handshake completes with
// NO peer cert. Every factor is un-provable → all default to 0 → DENY. A configured good
// revocation cannot rescue a missing cert.
test("(d) no client certificate on an auth-required route → 401, handler NOT run", async () => {
  await withTlsServer(
    { pinnedDigests: [GOOD_PIN], checkRevocation: REVOCATION_GOOD, revocationFreshnessMs: 60_000 },
    async (port, ran) => {
      const res = await tlsRequest(port, {}); // present no client cert
      assert.equal(res.status, 401);
      assert.equal(ran.value, false);
    },
  );
});

// ── (bonus) pin MISMATCH on an otherwise fully-valid cert → 401 (MITM-with-valid-cert) ──
// The good client presents a library-valid, fresh cert, but the host pins a DIFFERENT digest.
// pin_match = −1 (hard DENY / annihilator) dominates even though the other three are +1.
test("(bonus) library-valid client cert whose digest is NOT pinned → 401 (pin_match = −1)", async () => {
  await withTlsServer(
    { pinnedDigests: [UNTRUSTED_PIN], checkRevocation: REVOCATION_GOOD, revocationFreshnessMs: 60_000 },
    async (port, ran) => {
      const res = await tlsRequest(port, { clientKey: CLIENT_GOOD_KEY, clientCert: CLIENT_GOOD_CERT });
      assert.equal(res.status, 401);
      assert.equal(ran.value, false);
    },
  );
});

// ── (bonus) a throwing revocation check fails closed → 401 (never +1) ──
test("(bonus) a THROWING revocation check → 401 (unknown → 0 → DENY), handler NOT run", async () => {
  await withTlsServer(
    {
      pinnedDigests: [GOOD_PIN],
      checkRevocation: () => { throw new Error("OCSP responder unreachable"); },
      revocationFreshnessMs: 60_000,
    },
    async (port, ran) => {
      const res = await tlsRequest(port, { clientKey: CLIENT_GOOD_KEY, clientCert: CLIENT_GOOD_CERT });
      assert.equal(res.status, 401);
      assert.equal(ran.value, false);
    },
  );
});

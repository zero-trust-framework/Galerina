/**
 * End-to-end tests for the LogicN HTTP API-server adapter.
 *
 * These drive a REAL kernel through a REAL socket: createAppKernel → createApiServer
 * → listen(0) → fire requests with node:http and assert the responses. Nothing is
 * mocked; the kernel's fixed pipeline produces the 404/405/422 statuses, and the
 * adapter's additive body cap produces the 413.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createAppKernel } from "../../logicn-framework-app-kernel/dist/index.js";
import { Verdict } from "../../logicn-tower-citizen/dist/index.js";
import { createApiServer, listen } from "../dist/index.js";

/** Build a kernel with one public POST /charge route → 200 {ok:true}. */
function buildKernel() {
  return createAppKernel({
    routes: [
      {
        method: "POST",
        path: "/charge",
        handler: "charge",
        auth: { mode: "public" },
      },
    ],
    dispatch: {
      charge: () => ({ status: 200, body: { ok: true } }),
    },
  });
}

/** Build a kernel with one auth-REQUIRED GET /secure route. Tracks whether the
 *  handler ran so we can assert it is blocked before dispatch on a denied channel. */
function buildSecureKernel(ran) {
  return createAppKernel({
    routes: [{ method: "GET", path: "/secure", handler: "secure" }], // default auth: required
    dispatch: { secure: () => { ran.value = true; return { status: 200, body: { ok: true } }; } },
  });
}

/** Spin up a secure-kernel adapter with the given options, run fn, always close. */
async function withSecureServer(opts, fn) {
  const ran = { value: false };
  const server = createApiServer({ kernel: buildSecureKernel(ran), ...opts });
  const { port } = await listen(server, 0);
  try {
    return await fn(port, ran);
  } finally {
    await new Promise((r) => server.close(() => r(undefined)));
  }
}

/** Fire a single request through the socket and collect the full response. */
function request(port, { method, path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** Spin up the adapter, run `fn(port)`, always close the server. */
async function withServer(opts, fn) {
  const server = createApiServer({ kernel: buildKernel(), ...opts });
  const { port } = await listen(server, 0);
  try {
    return await fn(port);
  } finally {
    await new Promise((r) => server.close(() => r(undefined)));
  }
}

const JSON_HEADERS = { "content-type": "application/json" };

test("POST /charge with valid JSON → 200 {ok:true}", async () => {
  await withServer({}, async (port) => {
    const res = await request(port, {
      method: "POST",
      path: "/charge",
      headers: JSON_HEADERS,
      body: JSON.stringify({ amount: 100 }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true });
  });
});

test("GET /charge (wrong method on a known path) → 405", async () => {
  await withServer({}, async (port) => {
    const res = await request(port, { method: "GET", path: "/charge" });
    assert.equal(res.status, 405);
  });
});

test("POST /nope (unknown path) → 404", async () => {
  await withServer({}, async (port) => {
    const res = await request(port, {
      method: "POST",
      path: "/nope",
      headers: JSON_HEADERS,
      body: "{}",
    });
    assert.equal(res.status, 404);
  });
});

test("oversized body (> adapter maxBodyBytes) → 413", async () => {
  // Configure a tiny adapter cap so the additive DoS guard trips before the kernel.
  await withServer({ maxBodyBytes: 64 }, async (port) => {
    const big = "x".repeat(4096);
    const res = await request(port, {
      method: "POST",
      path: "/charge",
      headers: JSON_HEADERS,
      body: big,
    });
    assert.equal(res.status, 413);
  });
});

test("malformed JSON body → 422", async () => {
  await withServer({}, async (port) => {
    const res = await request(port, {
      method: "POST",
      path: "/charge",
      headers: JSON_HEADERS,
      body: "{ not valid json ",
    });
    assert.equal(res.status, 422);
  });
});

// ── The live channel-verdict path: transport resolver → kernel fail-closed fold ──
// The TLSTP S1 cert-gate produces a K3 verdict the transport feeds to the kernel via
// resolveChannelVerdict. Only +1/ALLOW admits; 0/−1 deny; a throwing resolver denies.

test("channel verdict DENY (−1) → 401 on an auth-required route, handler NOT run", async () => {
  await withSecureServer({ resolveChannelVerdict: () => Verdict.DENY }, async (port, ran) => {
    const res = await request(port, { method: "GET", path: "/secure" });
    assert.equal(res.status, 401);
    assert.equal(ran.value, false);
  });
});

test("channel verdict INDETERMINATE (0) → 401 (fail-closed), handler NOT run", async () => {
  await withSecureServer({ resolveChannelVerdict: () => Verdict.INDETERMINATE }, async (port, ran) => {
    const res = await request(port, { method: "GET", path: "/secure" });
    assert.equal(res.status, 401);
    assert.equal(ran.value, false);
  });
});

test("channel verdict ALLOW (+1) → admits with NO Authorization header (handler runs)", async () => {
  await withSecureServer({ resolveChannelVerdict: () => Verdict.ALLOW }, async (port, ran) => {
    const res = await request(port, { method: "GET", path: "/secure" });
    assert.equal(res.status, 200);
    assert.equal(ran.value, true);
    assert.deepEqual(JSON.parse(res.body), { ok: true });
  });
});

test("a THROWING channel-verdict resolver → 401 (fail-closed to DENY), handler NOT run", async () => {
  await withSecureServer({
    resolveChannelVerdict: () => { throw new Error("peer-cert extraction failed"); },
  }, async (port, ran) => {
    const res = await request(port, { method: "GET", path: "/secure" });
    assert.equal(res.status, 401);
    assert.equal(ran.value, false);
  });
});

test("no resolver configured → unchanged header path (no auth header → 401)", async () => {
  await withSecureServer({}, async (port, ran) => {
    const res = await request(port, { method: "GET", path: "/secure" });
    assert.equal(res.status, 401); // kernel's own auth path: missing Authorization → 401
    assert.equal(ran.value, false);
  });
});

test("resolver returns undefined + header present → 401 (tightened: header presence is not authentication)", async () => {
  await withSecureServer({ resolveChannelVerdict: () => undefined }, async (port, ran) => {
    const res = await request(port, {
      method: "GET",
      path: "/secure",
      headers: { authorization: "Bearer tok" },
    });
    // Tightened default (owner 2026-06-23): with no channel verdict supplied, a required-auth route
    // does NOT admit on mere Authorization-header presence — the channel/identity verdict is the auth
    // signal. (A route may opt back into the legacy presence-only behaviour via allowHeaderPresenceFallback.)
    assert.equal(res.status, 401);
    assert.equal(ran.value, false);
  });
});

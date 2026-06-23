// App Kernel — FIXED, non-bypassable governed request pipeline (framework P1 slice 2).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createAppKernel } from "../dist/index.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

function req(over = {}) {
  return {
    method: "GET",
    path: "/health",
    headers: {},
    body: new Uint8Array(0),
    query: {},
    requestId: "rq-1",
    receivedAt: 0,
    ...over,
  };
}

function jsonBody(obj) {
  return enc.encode(JSON.stringify(obj));
}

function errorOf(res) {
  if (res.body === undefined) return undefined;
  return JSON.parse(dec.decode(res.body)).error;
}

test("auth-required route with no Authorization header -> 401, handler NOT run", async () => {
  let ran = false;
  const k = createAppKernel({
    routes: [{ method: "GET", path: "/secure", handler: "secure" }],
    dispatch: { secure: () => { ran = true; return { body: { ok: true } }; } },
  });
  const res = await k.handle(req({ method: "GET", path: "/secure" }));
  assert.equal(res.status, 401);
  assert.equal(errorOf(res), "unauthorized");
  assert.equal(ran, false);
  assert.equal(res.body !== undefined, true); // safe typed error body
});

// ── Channel/identity verdict (TLSTP S1 cert-gate) folded into auth, FAIL-CLOSED ──
// The transport may supply a K3 channelVerdict (e.g. certGate(input).verdict). Only an explicit
// ALLOW (+1) admits; INDETERMINATE (0) and DENY (−1) refuse — unknown → DENY by the algebra.

test("auth: channel verdict DENY (-1) refuses admission, handler NOT run", async () => {
  let ran = false;
  const k = createAppKernel({
    routes: [{ method: "GET", path: "/secure", handler: "secure" }],
    dispatch: { secure: () => { ran = true; return { body: { ok: true } }; } },
  });
  const res = await k.handle(req({ method: "GET", path: "/secure", channelVerdict: -1 }));
  assert.equal(res.status, 401);
  assert.equal(errorOf(res), "unauthorized");
  assert.equal(ran, false);
});

test("auth: channel verdict INDETERMINATE (0) refuses admission (fail-closed), handler NOT run", async () => {
  let ran = false;
  const k = createAppKernel({
    routes: [{ method: "GET", path: "/secure", handler: "secure" }],
    dispatch: { secure: () => { ran = true; return { body: { ok: true } }; } },
  });
  const res = await k.handle(req({ method: "GET", path: "/secure", channelVerdict: 0 }));
  assert.equal(res.status, 401);
  assert.equal(ran, false);
});

test("auth: channel verdict ALLOW (+1) admits even with NO Authorization header (handler runs)", async () => {
  let ran = false;
  const k = createAppKernel({
    routes: [{ method: "GET", path: "/secure", handler: "secure" }],
    dispatch: { secure: () => { ran = true; return { body: { ok: true } }; } },
  });
  const res = await k.handle(req({ method: "GET", path: "/secure", channelVerdict: 1 }));
  assert.equal(ran, true);            // the channel verdict (+1) authorised admission
  assert.notEqual(res.status, 401);
});

// ── Tightened header-presence fallback (owner decision 2026-06-23, fail-closed by default) ──
// A required-auth route with NO channelVerdict no longer admits on mere Authorization-header
// presence — presence is not authentication. Opt back in per-route via allowHeaderPresenceFallback.

test("auth: required + no verdict + header PRESENT but no opt-in → 401 (tightened default)", async () => {
  let ran = false;
  const k = createAppKernel({
    routes: [{ method: "GET", path: "/secure", handler: "secure" }], // default required, no fallback opt-in
    dispatch: { secure: () => { ran = true; return { body: { ok: true } }; } },
  });
  const res = await k.handle(req({ method: "GET", path: "/secure", headers: { authorization: "Bearer tok" } }));
  assert.equal(res.status, 401);
  assert.equal(errorOf(res), "unauthorized");
  assert.equal(ran, false); // header presence alone is NOT sufficient
});

test("auth: required + allowHeaderPresenceFallback + header PRESENT → admits (legacy opt-in)", async () => {
  let ran = false;
  const k = createAppKernel({
    routes: [{ method: "GET", path: "/secure", handler: "secure", auth: { mode: "required", allowHeaderPresenceFallback: true } }],
    dispatch: { secure: () => { ran = true; return { body: { ok: true } }; } },
  });
  const res = await k.handle(req({ method: "GET", path: "/secure", headers: { authorization: "Bearer tok" } }));
  assert.notEqual(res.status, 401);
  assert.equal(ran, true); // explicit opt-in restores the weaker presence-only behaviour
});

test("auth: allowHeaderPresenceFallback opt-in still 401s when NO header is present", async () => {
  let ran = false;
  const k = createAppKernel({
    routes: [{ method: "GET", path: "/secure", handler: "secure", auth: { mode: "required", allowHeaderPresenceFallback: true } }],
    dispatch: { secure: () => { ran = true; return { body: { ok: true } }; } },
  });
  const res = await k.handle(req({ method: "GET", path: "/secure" }));
  assert.equal(res.status, 401);
  assert.equal(ran, false);
});

test("public route is allowed without Authorization (handler runs)", async () => {
  let ran = false;
  const k = createAppKernel({
    routes: [{ method: "GET", path: "/health", handler: "health", auth: { mode: "public" } }],
    dispatch: { health: () => { ran = true; return { body: { status: "up" } }; } },
  });
  const res = await k.handle(req({ method: "GET", path: "/health" }));
  assert.equal(res.status, 200);
  assert.equal(ran, true);
  assert.deepEqual(JSON.parse(dec.decode(res.body)), { status: "up" });
});

test("unknown path -> 404", async () => {
  const k = createAppKernel({
    routes: [{ method: "GET", path: "/health", handler: "health", auth: { mode: "public" } }],
    dispatch: { health: () => ({ body: {} }) },
  });
  const res = await k.handle(req({ method: "GET", path: "/nope" }));
  assert.equal(res.status, 404);
  assert.equal(errorOf(res), "route_not_found");
});

test("known path, wrong method -> 405", async () => {
  const k = createAppKernel({
    routes: [{ method: "GET", path: "/health", handler: "health", auth: { mode: "public" } }],
    dispatch: { health: () => ({ body: {} }) },
  });
  const res = await k.handle(req({ method: "POST", path: "/health" }));
  assert.equal(res.status, 405);
  assert.equal(errorOf(res), "method_not_allowed");
});

test("oversize body -> 413, handler NOT run", async () => {
  let ran = false;
  const k = createAppKernel({
    routes: [{
      method: "POST", path: "/up", handler: "up", auth: { mode: "public" },
      body: { maxSizeBytes: 16 },
    }],
    dispatch: { up: () => { ran = true; return { body: {} }; } },
  });
  const big = new Uint8Array(64); // 64 > 16
  const res = await k.handle(req({
    method: "POST", path: "/up", body: big,
    headers: { "content-type": "application/json" },
  }));
  assert.equal(res.status, 413);
  assert.equal(errorOf(res), "payload_too_large");
  assert.equal(ran, false);
});

test("content-type mismatch -> 415", async () => {
  const k = createAppKernel({
    routes: [{ method: "POST", path: "/up", handler: "up", auth: { mode: "public" } }],
    dispatch: { up: () => ({ body: {} }) },
  });
  const res = await k.handle(req({
    method: "POST", path: "/up", body: jsonBody({ a: 1 }),
    headers: { "content-type": "text/plain" },
  }));
  assert.equal(res.status, 415);
  assert.equal(errorOf(res), "unsupported_media_type");
});

test("invalid JSON body -> 422", async () => {
  const k = createAppKernel({
    routes: [{ method: "POST", path: "/up", handler: "up", auth: { mode: "public" } }],
    dispatch: { up: () => ({ body: {} }) },
  });
  const res = await k.handle(req({
    method: "POST", path: "/up", body: enc.encode("{not json"),
    headers: { "content-type": "application/json" },
  }));
  assert.equal(res.status, 422);
  assert.equal(errorOf(res), "unprocessable_entity");
});

test("handler runs ONLY after all gates pass (correct ordering)", async () => {
  const seen = [];
  const k = createAppKernel({
    routes: [{ method: "POST", path: "/ok", handler: "ok", auth: { mode: "public" } }],
    dispatch: { ok: (ctx) => { seen.push("handler"); return { status: 201, body: { echo: ctx.json } }; } },
  });
  // Missing auth on a separate required route must short-circuit BEFORE handler.
  const kReq = createAppKernel({
    routes: [{ method: "POST", path: "/req", handler: "req" }],
    dispatch: { req: () => { seen.push("should-not-run"); return { body: {} }; } },
  });
  await kReq.handle(req({ method: "POST", path: "/req", body: jsonBody({ a: 1 }), headers: { "content-type": "application/json" } }));
  assert.deepEqual(seen, []); // auth gate blocked it before dispatch

  const res = await k.handle(req({
    method: "POST", path: "/ok", body: jsonBody({ a: 1 }),
    headers: { "content-type": "application/json" },
  }));
  assert.equal(res.status, 201);
  assert.deepEqual(seen, ["handler"]);
  assert.deepEqual(JSON.parse(dec.decode(res.body)), { echo: { a: 1 } });
});

test("handler that throws -> safe 500, no leak", async () => {
  const k = createAppKernel({
    routes: [{ method: "GET", path: "/boom", handler: "boom", auth: { mode: "public" } }],
    dispatch: { boom: () => { throw new Error("secret internal detail"); } },
  });
  const res = await k.handle(req({ method: "GET", path: "/boom" }));
  assert.equal(res.status, 500);
  assert.equal(errorOf(res), "internal_error");
  // The internal error message must not leak to the client.
  assert.equal(dec.decode(res.body).includes("secret internal detail"), false);
});

test("idempotency: duplicate key -> 409", async () => {
  const k = createAppKernel({
    routes: [{ method: "POST", path: "/pay", handler: "pay", auth: { mode: "public" } }],
    dispatch: { pay: () => ({ status: 200, body: { paid: true } }) },
  });
  const mk = () => req({
    method: "POST", path: "/pay", body: jsonBody({ amt: 1 }),
    headers: { "content-type": "application/json", "idempotency-key": "key-abc" },
  });
  const first = await k.handle(mk());
  assert.equal(first.status, 200);
  const second = await k.handle(mk());
  assert.equal(second.status, 409);
  assert.equal(errorOf(second), "conflict");
});

test("over concurrency limit -> 429", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const k = createAppKernel({
    routes: [{
      method: "GET", path: "/slow", handler: "slow", auth: { mode: "public" },
      limits: { maxConcurrent: 1 },
    }],
    dispatch: { slow: async () => { await gate; return { body: { done: true } }; } },
  });
  const p1 = k.handle(req({ method: "GET", path: "/slow" }));        // occupies the single slot
  const r2 = await k.handle(req({ method: "GET", path: "/slow" }));  // over the limit
  assert.equal(r2.status, 429);
  assert.equal(errorOf(r2), "too_many_requests");
  release();
  const r1 = await p1;
  assert.equal(r1.status, 200);
  // Slot released: a follow-up now succeeds.
  const r3 = await k.handle(req({ method: "GET", path: "/slow" }));
  assert.equal(r3.status, 200);
});

test("the pipeline order is fixed: there is no way to register middleware", async () => {
  const k = createAppKernel({
    routes: [{ method: "GET", path: "/x", handler: "x", auth: { mode: "public" } }],
    dispatch: { x: () => ({ body: { ok: true } }) },
  });
  // The kernel surface is just handle(); no use()/before()/after() hooks exist.
  assert.equal(typeof k.handle, "function");
  assert.equal(k.use, undefined);
  assert.equal(k.before, undefined);
  assert.equal(k.after, undefined);
});

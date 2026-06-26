import { performance } from "node:perf_hooks";
import { createAppKernel } from "../../../galerina-framework-app-kernel/dist/kernel.js";

// framework-pipeline — "native framework (no middleware)" vs "middleware chain".
//
// The Node.js column is Galerina's SHIPPED App Kernel: a FIXED, non-bypassable
// 12-gate request pipeline (route → policy → body-size → content-type → auth →
// JSON decode → idempotency → concurrency → dispatch → encode → audit). There is
// NO middleware chain — the order is compiled in and cannot be reordered/skipped.
//
// One operation = one full successful request through the pipeline to a handler.
// python.py runs an equivalent SYNC gate chain (the "middleware" approach) doing
// the SAME gates on the SAME request, so the work is identical and the comparison
// is honest. The App Kernel is async (Tri-Pipe audit) — that async cost is real
// and is included; see `architecture` below for a same-language sync breakdown.
//
// HONEST FRAMING: this is a tree-walker-free, plain-JS pipeline, so it is fast,
// but Rust/native would still win raw throughput. The structural win of "no
// middleware" is fewer deps + non-reorderable gates (scorecard in README), NOT
// raw speed. We report speed straight.

const te = new TextEncoder();
const td = new TextDecoder("utf-8", { fatal: true });

// ── The Galerina App Kernel (the framework) ────────────────────────────────────
let auditCount = 0;
const kernel = createAppKernel({
  routes: [{ method: "POST", path: "/orders", handler: "createOrder" }], // minimal = secure-by-default
  dispatch: { createOrder: (ctx) => ({ status: 200, body: { ok: true, id: ctx.json?.id ?? 0 } }) },
  auditSink: { emit() { auditCount++; } },   // non-retaining sink (real "emit to pipe" cost, no memory growth)
});

const BODY = te.encode(JSON.stringify({ id: 1, item: "widget", qty: 3 }));
function freshReq() {
  return {
    method: "POST", path: "/orders",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: BODY, query: {}, requestId: "r", receivedAt: 0,
  };
}

// ── Equivalent SYNC middleware chain (the "with middleware" baseline, same gates) ──
const POLICY = { maxSizeBytes: 256 * 1024, contentType: "application/json", maxConcurrent: 10 };
const ROUTES = new Map([["POST /orders", "createOrder"]]);
const DISPATCH = { createOrder: (json) => ({ status: 200, body: { ok: true, id: json?.id ?? 0 } }) };
const seenKeys = new Set();
let inFlight = 0, mwAudit = 0;
const hget = (h, n) => { const t = n.toLowerCase(); for (const k in h) if (k.toLowerCase() === t) return h[k]; return undefined; };
const baseCt = (v) => { const s = v.indexOf(";"); return (s === -1 ? v : v.slice(0, s)).trim().toLowerCase(); };

// Express-style chain: an ordered array of middleware, each may short-circuit.
const CHAIN = [
  (req, st) => { const h = ROUTES.get(`${req.method} ${req.path}`); if (!h) { st.res = { status: 404 }; return false; } st.handler = h; return true; },
  (req, st) => { if (req.body.byteLength > POLICY.maxSizeBytes) { st.res = { status: 413 }; return false; } return true; },
  (req, st) => { if (req.body.byteLength > 0) { const ct = hget(req.headers, "content-type"); if (!ct || baseCt(ct) !== POLICY.contentType) { st.res = { status: 415 }; return false; } } return true; },
  (req, st) => { if (hget(req.headers, "authorization") === undefined) { st.res = { status: 401 }; return false; } return true; },
  (req, st) => { if (req.body.byteLength > 0) { try { st.json = JSON.parse(td.decode(req.body)); } catch { st.res = { status: 422 }; return false; } } return true; },
  (req, st) => { const key = hget(req.headers, "idempotency-key"); if (key !== undefined) { const ck = `${req.method} ${req.path} ${key}`; if (seenKeys.has(ck)) { st.res = { status: 409 }; return false; } seenKeys.add(ck); } return true; },
  (req, st) => { if (inFlight >= POLICY.maxConcurrent) { st.res = { status: 429 }; return false; } return true; },
  (req, st) => { inFlight++; try { const r = DISPATCH[st.handler](st.json); st.res = { status: r.status, body: te.encode(JSON.stringify(r.body)) }; } finally { inFlight--; } return true; },
];
function middlewareChain(req) {
  const st = { res: null, handler: null, json: undefined };
  for (const mw of CHAIN) if (!mw(req, st)) break;
  mwAudit++;                                   // audit step
  return st.res;
}

// ── Raw floor: route + handler + encode, NO governance gates ──────────────────
function rawFloor(req) {
  const h = ROUTES.get(`${req.method} ${req.path}`);
  const json = JSON.parse(td.decode(req.body));
  const r = DISPATCH[h](json);
  return { status: r.status, body: te.encode(JSON.stringify(r.body)) };
}

async function timeAsync(fn, iterations, measureMem = false) {
  const r0 = freshReq();
  for (let i = 0; i < 2000; i++) await fn(r0);       // warmup
  let memBefore;
  if (measureMem) { if (typeof globalThis.gc === "function") globalThis.gc(); memBefore = process.memoryUsage(); }
  const t0 = performance.now();
  let ok = 0;
  for (let i = 0; i < iterations; i++) { const res = await fn(freshReq()); if (res.status === 200) ok++; }
  const ms = performance.now() - t0;
  const heapDelta = measureMem ? process.memoryUsage().heapUsed - memBefore.heapUsed : null;
  return { ms, ok, ops: iterations / (ms / 1000), heapDelta };
}
function timeSync(fn, iterations) {
  const r0 = freshReq();
  for (let i = 0; i < 2000; i++) fn(r0);             // warmup
  const t0 = performance.now();
  let ok = 0;
  for (let i = 0; i < iterations; i++) { const res = fn(freshReq()); if (res.status === 200) ok++; }
  const ms = performance.now() - t0;
  return { ms, ok, ops: iterations / (ms / 1000) };
}

async function main() {
  // Correctness gate: the kernel must reach the handler with a 200.
  const probe = await kernel.handle(freshReq());
  if (probe.status !== 200) { console.error(`framework-pipeline kernel probe failed: status ${probe.status}`); process.exit(1); }

  const iterations = parseIntFlag("--iterations", parseIntFlag("--operations", 200000));
  const cpu0 = process.cpuUsage();

  const kern = await timeAsync((req) => kernel.handle(req), iterations, true);
  const mw = timeSync(middlewareChain, iterations);
  const raw = timeSync(rawFloor, iterations);

  const cpu = process.cpuUsage(cpu0);
  const mem = process.memoryUsage();

  console.log(JSON.stringify({
    runtime: "nodejs", benchmark: "framework-pipeline-v1",
    note: "Node.js column = Galerina App Kernel (fixed 12-gate pipeline, no middleware)",
    iterations, handledOk: kern.ok,
    elapsedMs: Number(kern.ms.toFixed(3)),
    operationsPerSecond: Number(kern.ops.toFixed(0)),     // the App Kernel rate (the column)
    heapUsedDeltaKernel: kern.heapDelta,
    // Same-language architecture breakdown (sync): shows the "remove middleware" effect
    // without the kernel's async cost. Not separate runtime columns — informational.
    architecture: {
      galerinaAppKernel_async_opsPerSec: Number(kern.ops.toFixed(0)),
      handRolledMiddlewareChain_sync_opsPerSec: Number(mw.ops.toFixed(0)),
      rawNoGovernance_sync_opsPerSec: Number(raw.ops.toFixed(0)),
      auditEventsEmitted: auditCount,
    },
    cpu: { totalMs: Number(((cpu.user + cpu.system) / 1000).toFixed(3)) },
    memory: {
      rssBytes: mem.rss, heapUsedBytes: mem.heapUsed,
      heapUsedDelta: kern.heapDelta,
      bytesPerOperation: kern.heapDelta != null ? Number((kern.heapDelta / iterations).toFixed(2)) : null,  // per request
    },
    notes: [
      "One op = one full successful request through the fixed governed pipeline to a handler",
      "Kernel is async (Tri-Pipe audit off critical path); the sync architecture[] figures isolate gate cost",
    ],
  }, null, 2));
}

function parseIntFlag(name, fb) { const i = process.argv.indexOf(name); return i >= 0 ? parseInt(process.argv[i + 1] || "", 10) || fb : fb; }
main().catch((e) => { console.error(e); process.exit(1); });

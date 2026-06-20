// Exporter HTTP shell smoke test (R&D 0050) — /metrics, /healthz, /readyz, fail-closed verbs.
import assert from "node:assert/strict";
import { test, before, after } from "node:test";

import { startExporter } from "../dist/index.js";

const PORT = 39187; // uncommon port to avoid collisions
let handle;
let ready = true;

before(async () => {
  handle = await startExporter({
    port: PORT,
    ready: () => ready,
    snapshot: () => ({ governanceFlags: { RequiresAudit: true }, auditEvents: { Success: 7 } }),
  });
});

after(async () => {
  await handle.close();
});

test("GET /metrics → 200 fenced Prometheus text", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/metrics`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/plain/);
  const body = await res.text();
  assert.match(body, /logicn_governance_flag\{flag="RequiresAudit"\} 1/);
  assert.match(body, /logicn_audit_events_total\{status="Success"\} 7/);
  assert.match(body, /logicn_telemetry_dropped_series_total 0/);
});

test("GET /healthz → 200", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
  assert.equal(res.status, 200);
  assert.equal((await res.text()).trim(), "ok");
});

test("GET /readyz reflects readiness (200 → 503 when not ready)", async () => {
  ready = true;
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/readyz`)).status, 200);
  ready = false;
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/readyz`)).status, 503);
  ready = true;
});

test("a non-GET method is refused (405)", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/metrics`, { method: "POST" });
  assert.equal(res.status, 405);
});

test("an unknown path → 404", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/secret`);
  assert.equal(res.status, 404);
});

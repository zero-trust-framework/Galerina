// MetricsCollector — counts, latency, error rates; fail-closed + bounded cardinality.
import assert from "node:assert/strict";
import { test } from "node:test";

import { MetricsCollector, renderMetricsPrometheus } from "../dist/index.js";

test("empty collector: zeroed snapshot, no NaNs", () => {
  const m = new MetricsCollector();
  const s = m.snapshot();
  assert.equal(s.totalRequests, 0);
  assert.equal(s.errors, 0);
  assert.equal(s.errorRate, 0);
  assert.equal(s.latency.count, 0);
  assert.equal(s.latency.p95Ms, 0);
  assert.equal(s.routes.length, 0);
  assert.equal(s.droppedObservations, 0);
});

test("counts requests by status class and route", () => {
  const m = new MetricsCollector();
  m.record({ method: "GET", route: "/a", status: 200 });
  m.record({ method: "GET", route: "/a", status: 200 });
  m.record({ method: "GET", route: "/a", status: 404 });
  m.record({ method: "POST", route: "/b", status: 201 });
  const s = m.snapshot();
  assert.equal(s.totalRequests, 4);
  assert.equal(s.byStatusClass["2xx"], 3);
  assert.equal(s.byStatusClass["4xx"], 1);
  const a = s.routes.find((r) => r.route === "/a" && r.method === "GET");
  assert.equal(a.total, 3);
  assert.equal(a.byStatusClass["2xx"], 2);
  assert.equal(a.byStatusClass["4xx"], 1);
});

test("error rate counts 5xx and the explicit errored flag, never 4xx", () => {
  const m = new MetricsCollector();
  m.record({ method: "GET", route: "/x", status: 200 });
  m.record({ method: "GET", route: "/x", status: 404 });          // client error — NOT an error-rate error
  m.record({ method: "GET", route: "/x", status: 500 });          // server error
  m.record({ method: "GET", route: "/x", status: 200, errored: true }); // forced error
  const s = m.snapshot();
  assert.equal(s.totalRequests, 4);
  assert.equal(s.errors, 2);
  assert.equal(s.errorRate, 0.5);
});

test("latency: exact count/sum/min/max/mean and a plausible percentile", () => {
  const m = new MetricsCollector();
  for (const d of [10, 20, 30]) m.record({ method: "GET", route: "/l", status: 200, durationMs: d });
  const s = m.snapshot();
  assert.equal(s.latency.count, 3);
  assert.equal(s.latency.sumMs, 60);
  assert.equal(s.latency.minMs, 10);
  assert.equal(s.latency.maxMs, 30);
  assert.equal(s.latency.meanMs, 20);
  assert.ok(s.latency.p50Ms >= 10 && s.latency.p50Ms <= 30, `p50 ${s.latency.p50Ms} within [min,max]`);
  assert.ok(s.latency.p99Ms >= s.latency.p50Ms, "p99 >= p50");
});

test("requests without durationMs still count but add no latency sample", () => {
  const m = new MetricsCollector();
  m.record({ method: "GET", route: "/n", status: 200 });
  const s = m.snapshot();
  assert.equal(s.totalRequests, 1);
  assert.equal(s.latency.count, 0);
});

test("malformed observations are dropped, not thrown", () => {
  const m = new MetricsCollector();
  m.record({ method: "GET", route: "/m", status: 0 });    // out of 1xx-5xx
  m.record({ method: "GET", route: "/m", status: 700 });  // out of range
  m.record(null);                                          // not an object
  m.record({ method: "GET", route: "/m", status: 2.5 });  // non-integer
  const s = m.snapshot();
  assert.equal(s.totalRequests, 0);
  assert.equal(s.droppedObservations, 4);
});

test("record() NEVER throws even on hostile input (fail-closed)", () => {
  const m = new MetricsCollector();
  assert.doesNotThrow(() => m.record(undefined));
  assert.doesNotThrow(() => m.record({ method: 123, route: {}, status: "x", durationMs: "y" }));
  assert.doesNotThrow(() => m.record({ method: "GET", route: "/q", status: 200, durationMs: NaN }));
  // The last one is a valid request with an unusable duration: counted, no latency sample.
  const s = m.snapshot();
  assert.equal(s.totalRequests, 1);
  assert.equal(s.latency.count, 0);
});

test("route label is sanitised: query string stripped", () => {
  const m = new MetricsCollector();
  m.record({ method: "GET", route: "/users?token=abc123", status: 200 });
  const s = m.snapshot();
  const r = s.routes[0];
  assert.equal(r.route, "/users");
  assert.ok(!JSON.stringify(s).includes("abc123"), "query value must not be retained");
});

test("cardinality cap folds excess routes into __overflow__ (bounded memory)", () => {
  const m = new MetricsCollector({ maxRoutes: 3 });
  for (let i = 0; i < 50; i++) m.record({ method: "GET", route: `/r${i}`, status: 200 });
  const s = m.snapshot();
  assert.equal(s.routesOverflowed, true);
  // 3 distinct routes + one GET overflow sentinel = at most 4 series.
  assert.ok(s.routes.length <= 4, `bounded route count, got ${s.routes.length}`);
  const overflow = s.routes.find((r) => r.route === "__overflow__");
  assert.ok(overflow.total > 0, "overflow absorbed the excess");
  assert.equal(s.totalRequests, 50);
});

test("renderMetricsPrometheus uses the app_ namespace and exposes histogram + drops", () => {
  const m = new MetricsCollector();
  m.record({ method: "GET", route: "/p", status: 200, durationMs: 5 });
  m.record({ method: "GET", route: "/p", status: 500, durationMs: 50 });
  m.record({ method: "GET", route: "/p", status: 700 }); // dropped
  const text = renderMetricsPrometheus(m.snapshot());
  assert.match(text, /# TYPE app_requests_total counter/);
  assert.match(text, /app_requests_total\{method="GET",route="\/p",status_class="2xx"\} 1/);
  assert.match(text, /app_request_errors_total\{method="GET",route="\/p"\} 1/);
  assert.match(text, /app_request_duration_ms_bucket\{le="\+Inf"\} 2/);
  assert.match(text, /app_request_duration_ms_count 2/);
  assert.match(text, /app_requests_dropped_total 1/);
  // Distinct from governance-telemetry's namespace.
  assert.ok(!text.includes("logicn_"), "app-ops metrics use app_, not logicn_");
});

// Logger — leveled structured logs, redaction, fail-closed sink, injectable clock.
import assert from "node:assert/strict";
import { test } from "node:test";

import { createLogger, MemoryLogSink, JsonLineSink, safeStringify } from "../dist/index.js";

test("emits structured records to the sink with an injected clock", () => {
  const sink = new MemoryLogSink();
  const log = createLogger({ sink, clock: () => 12345 });
  log.info("hello", { a: 1 });
  const [rec] = sink.records();
  assert.equal(rec.level, "info");
  assert.equal(rec.msg, "hello");
  assert.equal(rec.at, 12345);
  assert.deepEqual(rec.fields, { a: 1 });
});

test("minLevel filters lower-severity records", () => {
  const sink = new MemoryLogSink();
  const log = createLogger({ sink, minLevel: "warn" });
  log.debug("d");
  log.info("i");
  log.warn("w");
  log.error("e");
  assert.deepEqual(sink.records().map((r) => r.level), ["warn", "error"]);
});

test("sensitive field keys are redacted before reaching the sink", () => {
  const sink = new MemoryLogSink();
  const log = createLogger({ sink });
  log.info("login", { user: "alice", password: "hunter2", token: "abc.def", note: "ok" });
  const [rec] = sink.records();
  assert.equal(rec.fields.user, "alice");
  assert.equal(rec.fields.note, "ok");
  assert.equal(rec.fields.password, "[redacted]");
  assert.equal(rec.fields.token, "[redacted]");
  assert.ok(!JSON.stringify(rec).includes("hunter2"), "secret value must not appear anywhere");
});

test("child loggers extend name and base fields and share the sink", () => {
  const sink = new MemoryLogSink();
  const root = createLogger({ sink, name: "app", baseFields: { svc: "orders" } });
  const child = root.child("worker", { shard: 3 });
  child.info("tick", { n: 1 });
  const [rec] = sink.records();
  assert.equal(rec.logger, "app.worker");
  assert.equal(rec.fields.svc, "orders");
  assert.equal(rec.fields.shard, 3);
  assert.equal(rec.fields.n, 1);
});

test("a throwing sink is isolated: logging never propagates, failures are counted", () => {
  const log = createLogger({
    sink: { write() { throw new Error("disk full"); } },
  });
  assert.doesNotThrow(() => log.error("boom"));
  assert.equal(log.sinkFailures(), 1);
});

test("safeStringify degrades unserialisable fields instead of throwing", () => {
  const circular = {};
  circular.self = circular;
  const out = safeStringify({ level: "info", msg: "x", at: 0, fields: circular });
  const parsed = JSON.parse(out); // must be valid JSON
  assert.equal(parsed.level, "info");
  assert.match(out, /not serialisable/);
});

test("JsonLineSink writes one JSON line per record to the supplied writer (no ambient I/O)", () => {
  const lines = [];
  const log = createLogger({ sink: new JsonLineSink((l) => lines.push(l)), clock: () => 7 });
  log.info("line", { k: "v" });
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.msg, "line");
  assert.equal(parsed.at, 7);
  assert.equal(parsed.fields.k, "v");
});

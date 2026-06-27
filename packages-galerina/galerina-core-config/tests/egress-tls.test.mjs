// Force-HTTPS egress boot setting + local-dev loopback exception (owner "force https on http",
// "be a bit smart and not block local development like http://localhost").
import { test } from "node:test";
import assert from "node:assert/strict";

const { resolveEgressTls, ALLOW_PLAINTEXT_EGRESS_ENV, ALLOW_LOCALHOST_ENV } = await import("../dist/index.js");

test("resolveEgressTls — default FORCES HTTPS (requireTls, port 443, not relaxed, no loopback)", () => {
  const s = resolveEgressTls({});
  assert.equal(s.requireTls, true);
  assert.deepEqual([...s.allowedPorts], [443]);
  assert.equal(s.relaxed, false);
  assert.equal(s.allowLoopback, false);
});

test("resolveEgressTls — explicit truthy plaintext env relaxes force-HTTPS (operator override)", () => {
  for (const v of ["true", "1"]) {
    const s = resolveEgressTls({ allowPlaintextEnv: v });
    assert.equal(s.requireTls, false, v);
    assert.equal(s.relaxed, true, v);
  }
});

test("resolveEgressTls — anything-but-truthy keeps force-HTTPS (fail-secure, case-sensitive)", () => {
  for (const v of ["false", "0", "", "TRUE", undefined]) {
    assert.equal(resolveEgressTls({ allowPlaintextEnv: v }).requireTls, true, String(v));
  }
});

test("loopback-dev: allowed on a development signal (NODE_ENV / GALERINA_PROFILE / GALERINA_ALLOW_LOCALHOST)", () => {
  assert.equal(resolveEgressTls({ nodeEnv: "development" }).allowLoopback, true);
  assert.equal(resolveEgressTls({ profile: "development" }).allowLoopback, true);
  assert.equal(resolveEgressTls({ allowLocalhostEnv: "true" }).allowLoopback, true);
  assert.equal(resolveEgressTls({ allowLocalhostEnv: "1" }).allowLoopback, true);
  // force-HTTPS for public is UNCHANGED even when loopback is allowed
  assert.equal(resolveEgressTls({ nodeEnv: "development" }).requireTls, true);
});

test("loopback-dev: FAIL-SECURE — denied on unset/unknown, and NEVER in production", () => {
  assert.equal(resolveEgressTls({}).allowLoopback, false);
  assert.equal(resolveEgressTls({ nodeEnv: "test" }).allowLoopback, false);
  // production wins even with an explicit localhost flag (never open loopback in prod)
  assert.equal(resolveEgressTls({ nodeEnv: "production", allowLocalhostEnv: "true" }).allowLoopback, false);
  assert.equal(resolveEgressTls({ profile: "production", nodeEnv: "development" }).allowLoopback, false);
});

test("internal-proxy allow-list parses from env and survives in production (force-HTTPS unchanged)", () => {
  const s = resolveEgressTls({ nodeEnv: "production", allowedHostsEnv: "proxy.internal, 10.0.0.8  proxy.internal" });
  assert.deepEqual([...s.allowedHosts], ["proxy.internal", "10.0.0.8"]); // trimmed, lower-cased, de-duped
  assert.equal(s.requireTls, true); // force-HTTPS still on for everything else
  assert.equal(s.allowLoopback, false); // production never opens loopback
});

test("parseAllowedHosts — empty/whitespace yields no hosts", async () => {
  const { parseAllowedHosts } = await import("../dist/index.js");
  assert.deepEqual([...parseAllowedHosts(undefined)], []);
  assert.deepEqual([...parseAllowedHosts("")], []);
  assert.deepEqual([...parseAllowedHosts("  ,  ")], []);
});

test("env name constants are documented", () => {
  assert.equal(ALLOW_PLAINTEXT_EGRESS_ENV, "GALERINA_ALLOW_PLAINTEXT_EGRESS");
  assert.equal(ALLOW_LOCALHOST_ENV, "GALERINA_ALLOW_LOCALHOST");
});

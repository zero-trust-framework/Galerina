// Inbound admission + rate limiting — fail-closed, deny-by-default (the inbound counterpart to egress-guard).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseRateLimit, guardInboundRequest, RateLimiter, rateLimitKey,
} from "../dist/index.js";

test("parseRateLimit: parses common forms; rejects malformed (fail-closed null)", () => {
  assert.deepEqual(parseRateLimit("100/min"), { count: 100, windowMs: 60_000 });
  assert.deepEqual(parseRateLimit("10/s"), { count: 10, windowMs: 1_000 });
  assert.deepEqual(parseRateLimit("1000/hour"), { count: 1000, windowMs: 3_600_000 });
  assert.deepEqual(parseRateLimit("100/2min"), { count: 100, windowMs: 120_000 }); // 100 per 2 minutes
  for (const bad of ["", "abc", "100", "/min", "100/", "0/min", "-5/s", "100/lightyear", "100/0min"]) {
    assert.equal(parseRateLimit(bad), null, `'${bad}' must be rejected`);
  }
});

const POLICY_DENY = {
  defaultEffect: "deny",
  endpoints: [
    { direction: "inbound", protocol: "https", effect: "allow", ports: [443] },
    { direction: "inbound", protocol: "tcp", effect: "deny", ports: [22] },
    { direction: "outbound", protocol: "https", effect: "allow", ports: [443] }, // must be ignored
  ],
};

test("guardInboundRequest: DENY-BY-DEFAULT — unmatched port is refused", () => {
  assert.equal(guardInboundRequest({ port: 8080 }, POLICY_DENY).allowed, false);
  assert.equal(guardInboundRequest({ port: 8080 }, POLICY_DENY).code, "LogicN_NETWORK_INBOUND_DENY_DEFAULT");
});

test("guardInboundRequest: an inbound allow rule admits its port; the outbound rule is ignored", () => {
  assert.equal(guardInboundRequest({ port: 443, protocol: "https" }, POLICY_DENY).allowed, true);
  // 443 is allowed inbound for https only; a tcp request on 443 has no matching allow rule → deny-by-default.
  assert.equal(guardInboundRequest({ port: 443, protocol: "tcp" }, POLICY_DENY).allowed, false);
});

test("guardInboundRequest: an explicit DENY rule wins even if an allow rule also matched", () => {
  const policy = {
    defaultEffect: "allow",
    endpoints: [
      { direction: "inbound", protocol: "tcp", effect: "allow", ports: [22] },
      { direction: "inbound", protocol: "tcp", effect: "deny", ports: [22] },
    ],
  };
  const d = guardInboundRequest({ port: 22, protocol: "tcp" }, policy);
  assert.equal(d.allowed, false);
  assert.equal(d.code, "LogicN_NETWORK_INBOUND_DENIED");
});

test("guardInboundRequest: defaultEffect=allow admits an unmatched port; a bad port is refused", () => {
  assert.equal(guardInboundRequest({ port: 9999 }, { defaultEffect: "allow", endpoints: [] }).allowed, true);
  assert.equal(guardInboundRequest({ port: 70000 }, { defaultEffect: "allow" }).allowed, false);
  assert.equal(guardInboundRequest({ port: -1 }, { defaultEffect: "allow" }).code, "LogicN_NETWORK_INBOUND_BAD_PORT");
});

test("RateLimiter: allows up to N in a window, denies N+1, resets after the window", () => {
  const rl = new RateLimiter();
  const rule = { name: "api", limit: "3/s", scope: "ip" };
  const key = rateLimitKey(rule, { ip: "1.2.3.4" });
  assert.equal(rl.consume(key, rule, 0).allowed, true);    // 1
  assert.equal(rl.consume(key, rule, 100).allowed, true);  // 2
  assert.equal(rl.consume(key, rule, 200).allowed, true);  // 3
  const over = rl.consume(key, rule, 300);                 // 4 → exceeded
  assert.equal(over.allowed, false);
  assert.equal(over.code, "LogicN_NETWORK_RATELIMIT_EXCEEDED");
  assert.equal(rl.consume(key, rule, 1000).allowed, true); // window rolled at 1000ms → allowed again
});

test("RateLimiter: scope keys isolate counters; an UNPARSEABLE limit fails CLOSED (deny)", () => {
  const rl = new RateLimiter();
  const rule = { name: "api", limit: "1/s", scope: "ip" };
  assert.equal(rl.consume(rateLimitKey(rule, { ip: "a" }), rule, 0).allowed, true);
  assert.equal(rl.consume(rateLimitKey(rule, { ip: "a" }), rule, 1).allowed, false); // a exhausted
  assert.equal(rl.consume(rateLimitKey(rule, { ip: "b" }), rule, 1).allowed, true);  // b independent
  // unparseable limit → NEVER silently bypassed.
  const bad = rl.consume("k", { name: "x", limit: "garbage", scope: "global" }, 0);
  assert.equal(bad.allowed, false);
  assert.equal(bad.code, "LogicN_NETWORK_RATELIMIT_UNPARSEABLE");
});

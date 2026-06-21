#!/usr/bin/env node
// prove-inbound-guard.mjs — re-runnable prove-own-maths for the inbound admission + rate limiter.
//
// Proves: (P1) rate-limit string parsing is correct + rejects malformed; (P2) the fixed-window limiter's
// core INVARIANT — it never admits more than `count` requests within any one window (fuzzed stream);
// (P3) inbound admission is total + DENY-BY-DEFAULT (no port is admitted without a matching allow rule);
// (P4) an unparseable limit FAILS CLOSED. Seeded PRNG, exit 0.
//
//   Run:  npm run prove   (or: node scripts/prove-inbound-guard.mjs)

import { parseRateLimit, guardInboundRequest, RateLimiter, rateLimitKey } from "../dist/index.js";

const results = [];
const ok = (name, cond, detail) => results.push({ name, ok: !!cond, detail });

// seeded PRNG — no Math.random
let seed = 0x1234abcd >>> 0;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 0xffffffff; };
const rint = (n) => Math.floor(rnd() * n);

// ── P1 — parseRateLimit correctness ────────────────────────────────────────────────────────────
{
  const cases = [
    ["100/min", 100, 60_000], ["10/s", 10, 1_000], ["1000/hour", 1000, 3_600_000],
    ["5/day", 5, 86_400_000], ["100/2min", 100, 120_000], ["1/sec", 1, 1_000],
  ];
  let good = 0;
  for (const [s, c, w] of cases) { const p = parseRateLimit(s); if (p && p.count === c && p.windowMs === w) good++; }
  ok("P1 valid rate-limit strings parse to the right (count, windowMs)", good === cases.length, `${good}/${cases.length}`);
  const bad = ["", "abc", "100", "/min", "100/", "0/min", "-5/s", "100/lightyear", "100/0min", "  ", "1/"];
  ok("P1b malformed rate-limit strings all reject (null)", bad.every((b) => parseRateLimit(b) === null), `${bad.length} rejected`);
}

// ── P2 — the fixed-window invariant: never more than `count` admitted per window ─────────────────
{
  const rule = { name: "api", limit: "50/s", scope: "ip" }; // 50 per 1000ms
  const { count, windowMs } = parseRateLimit(rule.limit);
  let worstPerWindow = 0;
  let totalAllowed = 0, totalDenied = 0;
  // Replay several independent keys; for each, a monotonic stream of ~4000 requests at random sub-windows.
  for (let key = 0; key < 25; key++) {
    const rl = new RateLimiter();
    const k = rateLimitKey(rule, { ip: `ip${key}` });
    const perWindow = new Map(); // window-start -> allowed count
    let now = rint(100);
    for (let i = 0; i < 4000; i++) {
      now += rint(40); // 0..39 ms between requests
      const r = rl.consume(k, rule, now);
      if (r.allowed) { totalAllowed++; const start = r.resetMs - windowMs; perWindow.set(start, (perWindow.get(start) ?? 0) + 1); }
      else totalDenied++;
    }
    for (const v of perWindow.values()) if (v > worstPerWindow) worstPerWindow = v;
  }
  ok("P2 fixed-window limiter NEVER admits more than count per window (25 keys × 4000 reqs)", worstPerWindow <= count,
    `worst admitted in a single window = ${worstPerWindow} (limit ${count}); ${totalAllowed} allowed, ${totalDenied} denied`);
}

// ── P3 — inbound admission is total + deny-by-default ────────────────────────────────────────────
{
  const PROTOS = ["https", "http", "tls", "tcp", "udp", "websocket", "rawSocket"];
  let throws = 0, admittedWithoutRule = 0, denials = 0, admits = 0;
  for (let i = 0; i < 20000; i++) {
    // random deny-default policy with a few random inbound allow rules
    const allowPorts = Array.from({ length: rint(4) }, () => rint(1024));
    const policy = {
      defaultEffect: "deny",
      endpoints: allowPorts.map((p) => ({ direction: "inbound", protocol: PROTOS[rint(PROTOS.length)], effect: "allow", ports: [p] }))
        .concat([{ direction: "outbound", protocol: "https", effect: "allow", ports: [rint(1024)] }]), // noise
    };
    const req = { port: rint(1100) - 10, protocol: PROTOS[rint(PROTOS.length)] }; // some out-of-range ports too
    let d; try { d = guardInboundRequest(req, policy); } catch { throws++; continue; }
    if (d.allowed) {
      admits++;
      // an admitted request MUST have a matching inbound allow rule (deny-by-default holds)
      const matched = policy.endpoints.some((e) =>
        e.direction === "inbound" && e.effect === "allow" &&
        (e.ports === undefined || e.ports.length === 0 || e.ports.includes(req.port)) &&
        (e.protocol === req.protocol));
      if (!matched) admittedWithoutRule++;
    } else denials++;
  }
  ok("P3 inbound guard is TOTAL (no throws) over 20k fuzzed requests", throws === 0, `${throws} throws`);
  ok("P3b DENY-BY-DEFAULT: every admitted request had a matching inbound allow rule", admittedWithoutRule === 0,
    `${admits} admitted, ${denials} denied, ${admittedWithoutRule} admitted-without-rule`);
}

// ── P4 — unparseable limit fails closed ──────────────────────────────────────────────────────────
{
  const rl = new RateLimiter();
  const garbage = ["", "abc", "100", "/min", "0/min", "x/y", "100/0s"];
  let bypassed = 0;
  for (const g of garbage) for (let i = 0; i < 100; i++) if (rl.consume("k", { name: "x", limit: g, scope: "global" }, i).allowed) bypassed++;
  ok("P4 an UNPARSEABLE rate limit is never silently bypassed (fail-closed)", bypassed === 0, `${bypassed} bypasses`);
}

// summary
let fails = 0;
console.log("\n-- @logicn/core-network inbound guard — prove-own-maths (admission + rate limiter, fail-closed) --");
for (const r of results) { if (!r.ok) fails++; console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name.padEnd(72)} ${r.detail}`); }
console.log(fails === 0
  ? `\n${results.length}/${results.length} PASS — rate-limit parsing is exact, the FIXED-window limiter never admits more than its limit per FIXED window (100k fuzzed requests; note a fixed window permits up to ~2*count across a window boundary by design — a sliding-window limiter would tighten that), inbound admission is total + deny-by-default (20k fuzz, 0 admitted-without-rule), and an unparseable limit fails closed.`
  : `\n${results.length - fails}/${results.length} PASS, ${fails} FAILED — review above.`);
process.exit(fails === 0 ? 0 : 1);

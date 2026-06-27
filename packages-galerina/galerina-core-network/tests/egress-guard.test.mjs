// egress-guard.test.mjs — outbound SSRF / egress protection.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyHost, guardOutboundHost, guardOutboundUrl, validateWebhookTarget,
  guardResolvedAddresses, defineNetworkPolicy, validateNetworkPolicy,
} from "../dist/index.js";

describe("classifyHost — IANA special-purpose ranges", () => {
  const cases = [
    ["127.0.0.1", "loopback"], ["127.255.255.254", "loopback"],
    ["10.1.2.3", "private"], ["172.16.5.5", "private"], ["172.31.255.1", "private"], ["192.168.0.1", "private"],
    ["172.15.0.1", "public"], ["172.32.0.1", "public"], // just outside 172.16/12
    ["169.254.169.254", "metadata"], ["169.254.1.1", "linkLocal"],
    ["100.64.0.1", "cgnat"], ["0.0.0.0", "unspecified"], ["255.255.255.255", "broadcast"],
    ["224.0.0.1", "multicast"], ["240.0.0.1", "reserved"], ["192.0.2.1", "reserved"], ["198.18.0.1", "reserved"],
    ["8.8.8.8", "public"], ["1.1.1.1", "public"],
    ["::1", "loopback"], ["::", "unspecified"], ["fe80::1", "linkLocal"], ["fc00::1", "uniqueLocal"],
    ["fd00:ec2::254", "metadata"], ["ff02::1", "multicast"], ["2606:4700::1111", "public"],
    ["localhost", "loopback"], ["api.localhost", "loopback"], ["metadata.google.internal", "metadata"],
    ["printer.local", "linkLocal"], ["db.internal", "private"], ["intranet", "private"], ["example.com", "public"],
  ];
  for (const [host, expected] of cases) {
    it(`${host} → ${expected}`, () => assert.equal(classifyHost(host).category, expected));
  }
});

describe("classifyHost — numeric-IP SSRF bypasses normalize to the real range", () => {
  // All of these are 127.0.0.1 in disguise — naive string checks miss them.
  for (const h of ["2130706433", "0x7f000001", "0177.0.0.1", "127.1", "127.0.1"]) {
    it(`${h} → loopback (normalized 127.0.0.1)`, () => assert.equal(classifyHost(h).category, "loopback"));
  }
  it("::ffff:127.0.0.1 (IPv4-mapped) → loopback", () => assert.equal(classifyHost("::ffff:127.0.0.1").category, "loopback"));
  it("0x0a000001 → private (10.0.0.1)", () => assert.equal(classifyHost("0x0a000001").category, "private"));
});

// AUDIT REGRESSION (critical SSRF): the HEX-hextet IPv4-mapped IPv6 form — which `new URL()` produces
// when canonicalizing the dotted form — must classify by its embedded v4, not fall through to "public".
describe("classifyHost — hex IPv4-mapped/embedded IPv6 (the URL-canonicalization bypass)", () => {
  const cases = [
    ["::ffff:a9fe:a9fe", "metadata"],            // 169.254.169.254 (the SSRF prize)
    ["::ffff:7f00:1", "loopback"],               // 127.0.0.1
    ["::ffff:0a00:1", "private"],                // 10.0.0.1
    ["::ffff:c0a8:1", "private"],                // 192.168.0.1
    ["[::ffff:a9fe:a9fe]", "metadata"],          // bracketed
    ["0:0:0:0:0:ffff:a9fe:a9fe", "metadata"],    // fully expanded
    ["64:ff9b::a9fe:a9fe", "metadata"],          // NAT64
    ["2002:a9fe:a9fe::", "metadata"],            // 6to4
    ["fe80::1%eth0", "linkLocal"],               // zone id stripped
    ["gggg::1", "invalid"],                      // malformed → fail-closed (not public)
    ["::1:", "invalid"],
    ["2606:4700::1111", "public"],               // a real global IPv6 still passes
  ];
  for (const [h, expected] of cases) {
    it(`${h} → ${expected}`, () => assert.equal(classifyHost(h).category, expected));
  }
});

describe("egress guards DENY hex IPv4-mapped IPv6 through the URL parser (end-to-end)", () => {
  it("validateWebhookTarget denies the dotted metadata URL (URL canonicalizes it to hex)", () => {
    assert.equal(validateWebhookTarget("https://[::ffff:169.254.169.254]/latest/meta-data/").allowed, false);
  });
  it("validateWebhookTarget denies hex loopback/private", () => {
    assert.equal(validateWebhookTarget("https://[::ffff:127.0.0.1]/").allowed, false);
    assert.equal(guardOutboundUrl("https://[::ffff:10.0.0.1]/").allowed, false);
  });
  it("guardResolvedAddresses denies a resolution containing a hex IPv4-mapped non-public addr", () => {
    assert.equal(guardResolvedAddresses("x.com", ["8.8.8.8", "::ffff:a9fe:a9fe"]).allowed, false);
  });
  it("a legitimate public host is still allowed (no over-blocking)", () => {
    assert.equal(validateWebhookTarget("https://hooks.example.com/x").allowed, true);
  });
});

describe("guardOutboundHost — fail-closed (deny-by-default)", () => {
  it("a public host is allowed", () => assert.equal(guardOutboundHost("example.com").allowed, true));
  it("private/loopback/linkLocal are denied by default", () => {
    for (const h of ["10.0.0.1", "127.0.0.1", "169.254.1.1", "::1", "192.168.1.1"]) {
      assert.equal(guardOutboundHost(h).allowed, false, `${h} denied`);
    }
  });
  it("the metadata endpoint is denied even with allowNonPublicHosts (needs its own explicit flag)", () => {
    assert.equal(guardOutboundHost("169.254.169.254", { allowNonPublicHosts: true }).allowed, false);
    assert.equal(guardOutboundHost("169.254.169.254", { allowMetadataEndpoint: true }).allowed, true);
  });
  it("allowNonPublicHosts opens private ranges (opt-in)", () => {
    assert.equal(guardOutboundHost("10.0.0.1", { allowNonPublicHosts: true }).allowed, true);
  });
  it("an explicit allow-list permits a specific internal host", () => {
    assert.equal(guardOutboundHost("10.0.0.5", { allowedHosts: ["10.0.0.5"] }).allowed, true);
  });
  it("invalid hosts are denied even with allowNonPublicHosts", () => {
    assert.equal(guardOutboundHost("bad host!", { allowNonPublicHosts: true }).allowed, false);
  });
  it("FQDNs flag requiresDnsRecheck (DNS-rebinding defence)", () => {
    assert.equal(guardOutboundHost("example.com").requiresDnsRecheck, true);
    assert.equal(guardOutboundHost("8.8.8.8").requiresDnsRecheck, false); // a literal IP needs no recheck
  });
});

describe("guardOutboundUrl — scheme + credentials + host", () => {
  it("https to a public host is allowed", () => assert.equal(guardOutboundUrl("https://example.com/p").allowed, true));
  it("plaintext http is denied (scheme allow-list = https)", () => assert.equal(guardOutboundUrl("http://example.com/").allowed, false));
  it("http allowed when explicitly permitted", () => assert.equal(guardOutboundUrl("http://example.com/", { allowedSchemes: ["https", "http"] }).allowed, true));
  it("non-http schemes denied (ftp/file/gopher)", () => {
    for (const u of ["ftp://example.com/", "file:///etc/passwd", "gopher://x/"]) assert.equal(guardOutboundUrl(u).allowed, false, u);
  });
  it("embedded credentials (userinfo) denied — parser-confusion SSRF", () => {
    assert.equal(guardOutboundUrl("https://user:pass@evil.com/").allowed, false);
    assert.equal(guardOutboundUrl("https://169.254.169.254@example.com/").code, "Galerina_NETWORK_SSRF_URL_CREDENTIALS_DENIED");
  });
  it("metadata via decimal-IP URL is denied", () => assert.equal(guardOutboundUrl("https://2852039166/").allowed, false)); // 169.254.169.254
  it("unparseable URL fails closed", () => assert.equal(guardOutboundUrl("http://[bad").allowed, false));
});

describe("guardOutboundUrl — requireTls (runtime half of TlsPolicy.requireTls)", () => {
  it("an otherwise-allowed plaintext http host is denied when requireTls", () => {
    const d = guardOutboundUrl("http://example.com/", { allowedSchemes: ["http", "https"], requireTls: true });
    assert.equal(d.allowed, false);
    assert.equal(d.code, "Galerina_NETWORK_EGRESS_TLS_REQUIRED");
  });
  it("https is allowed under requireTls", () => assert.equal(guardOutboundUrl("https://example.com/", { requireTls: true }).allowed, true));
  it("requireTls does NOT mask an SSRF host denial — an internal plaintext host keeps the SSRF code", () => {
    // ordering proof: host-category denial runs BEFORE the TLS check, so the finding is reported as SSRF, not TLS.
    const d = guardOutboundUrl("http://10.0.0.1/", { allowedSchemes: ["http", "https"], requireTls: true });
    assert.equal(d.allowed, false);
    assert.equal(d.code, "Galerina_NETWORK_SSRF_NONPUBLIC_DENIED");
  });
});

describe("guardOutboundUrl — allowedPorts (runtime half of NetworkEndpointRule.ports)", () => {
  it("a non-listed port on a public host is denied (fail-secure egress filtering)", () => {
    const d = guardOutboundUrl("https://example.com:8443/", { allowedPorts: [443] });
    assert.equal(d.allowed, false);
    assert.equal(d.code, "Galerina_NETWORK_EGRESS_PORT_DENIED");
  });
  it("the scheme-default port (implicit 443 for https) is matched", () => {
    assert.equal(guardOutboundUrl("https://example.com/", { allowedPorts: [443] }).allowed, true);
    assert.equal(guardOutboundUrl("https://example.com:443/", { allowedPorts: [443] }).allowed, true);
  });
  it("http default port 80 is matched when allow-listed", () => {
    assert.equal(guardOutboundUrl("http://example.com/", { allowedSchemes: ["http", "https"], allowedPorts: [80] }).allowed, true);
  });
  it("allowedPorts does NOT mask an SSRF host denial — internal host on a bad port keeps the SSRF code", () => {
    const d = guardOutboundUrl("https://10.0.0.1:8443/", { allowedPorts: [443] });
    assert.equal(d.allowed, false);
    assert.equal(d.code, "Galerina_NETWORK_SSRF_NONPUBLIC_DENIED");
  });
  it("the fail-secure dial posture (requireTls + ports:[443]) denies plaintext and odd ports, allows clean https", () => {
    const posture = { allowedSchemes: ["http", "https"], requireTls: true, allowedPorts: [443] };
    assert.equal(guardOutboundUrl("http://example.com/", posture).code, "Galerina_NETWORK_EGRESS_TLS_REQUIRED");
    assert.equal(guardOutboundUrl("https://example.com:8443/", posture).code, "Galerina_NETWORK_EGRESS_PORT_DENIED");
    assert.equal(guardOutboundUrl("https://example.com/", posture).allowed, true);
  });
});

describe("guardOutboundUrl — allowLoopback (local-dev exception, loopback ONLY)", () => {
  // a localhost dev server is http on an arbitrary port — admitted, and TLS/port checks skipped for it.
  const dev = { allowedSchemes: ["http", "https"], requireTls: true, allowedPorts: [443], allowLoopback: true };
  it("a localhost dev server (http, dev port) is allowed under allowLoopback", () => {
    assert.equal(guardOutboundUrl("http://localhost:3000/api", dev).allowed, true);
    assert.equal(guardOutboundUrl("http://127.0.0.1:8080/", dev).allowed, true);
    assert.equal(guardOutboundUrl("http://[::1]:5173/", dev).allowed, true);
    assert.equal(guardOutboundUrl("http://localhost:3000/api", dev).code, "Galerina_NETWORK_EGRESS_LOOPBACK_DEV");
  });
  it("allowLoopback opens ONLY loopback — private LAN / metadata / link-local stay SSRF-denied", () => {
    assert.equal(guardOutboundUrl("http://10.0.0.5/", dev).allowed, false);
    assert.equal(guardOutboundUrl("http://192.168.1.10/", dev).allowed, false);
    assert.equal(guardOutboundUrl("http://169.254.169.254/latest/meta-data/", dev).allowed, false);
    assert.equal(guardOutboundUrl("http://db.internal/", dev).allowed, false);
  });
  it("default (no allowLoopback): localhost is denied as loopback SSRF", () => {
    const d = guardOutboundUrl("http://localhost:3000/", { allowedSchemes: ["http", "https"] });
    assert.equal(d.allowed, false);
    assert.equal(d.category, "loopback");
  });
  it("guardOutboundHost: loopback allowed with the flag, denied without", () => {
    assert.equal(guardOutboundHost("127.0.0.1", { allowLoopback: true }).allowed, true);
    assert.equal(guardOutboundHost("localhost", { allowLoopback: true }).allowed, true);
    assert.equal(guardOutboundHost("127.0.0.1").allowed, false);
  });
});

describe("guardOutboundUrl — internal-proxy allow-list (production-valid, exact host)", () => {
  // an operator-trusted internal egress proxy is admitted in EVERY env (incl. force-HTTPS prod posture):
  // http + non-standard port + internal host all bypassed FOR THE ALLOW-LISTED HOST ONLY.
  const prod = { allowedSchemes: ["http", "https"], requireTls: true, allowedPorts: [443] };
  it("an allow-listed internal proxy (http, odd port, internal host) is admitted under force-HTTPS", () => {
    assert.equal(guardOutboundUrl("http://proxy.internal:8080/path", { ...prod, allowedHosts: ["proxy.internal"] }).allowed, true);
    assert.equal(guardOutboundUrl("http://10.0.0.8:3128/", { ...prod, allowedHosts: ["10.0.0.8"] }).allowed, true);
    assert.equal(guardOutboundUrl("http://proxy.internal:8080/", { ...prod, allowedHosts: ["proxy.internal"] }).code, "Galerina_NETWORK_EGRESS_ALLOWLISTED");
  });
  it("the allow-list opens ONLY the listed host — a sibling internal host stays SSRF-denied", () => {
    assert.equal(guardOutboundUrl("http://other.internal/", { ...prod, allowedHosts: ["proxy.internal"] }).allowed, false);
    assert.equal(guardOutboundUrl("http://169.254.169.254/", { ...prod, allowedHosts: ["proxy.internal"] }).allowed, false);
  });
  it("without the allow-list, the internal proxy host is denied", () => {
    assert.equal(guardOutboundUrl("http://proxy.internal:8080/", prod).allowed, false);
  });
});

describe("guardResolvedAddresses — connect-time DNS-rebinding defence", () => {
  it("all-public resolution is allowed", () => assert.equal(guardResolvedAddresses("good.com", ["8.8.8.8", "1.1.1.1"]).allowed, true));
  it("a public+private MIX is denied (rebinding / mixed resolution)", () => {
    const d = guardResolvedAddresses("evil.com", ["8.8.8.8", "127.0.0.1"]);
    assert.equal(d.allowed, false);
    assert.equal(d.code, "Galerina_NETWORK_SSRF_DNS_REBIND_DENIED");
  });
  it("all-private / metadata resolution is denied", () => {
    assert.equal(guardResolvedAddresses("intranet", ["10.0.0.1"]).allowed, false);
    assert.equal(guardResolvedAddresses("x", ["169.254.169.254"]).allowed, false);
  });
  it("no resolved addresses fails closed", () => {
    const d = guardResolvedAddresses("nxdomain", []);
    assert.equal(d.allowed, false);
    assert.equal(d.code, "Galerina_NETWORK_SSRF_NO_RESOLUTION");
  });
  it("an allow-listed host reaches its (private) addresses", () => {
    assert.equal(guardResolvedAddresses("internal.svc", ["10.0.0.5"], { allowedHosts: ["internal.svc"] }).allowed, true);
  });
  it("numeric-bypass addresses are still caught at resolution time", () => {
    assert.equal(guardResolvedAddresses("sneaky.com", ["8.8.8.8", "2130706433"]).allowed, false); // decimal 127.0.0.1
  });
});

describe("NetworkPolicy egress posture validation", () => {
  it("a safe egress policy produces no diagnostics", () => {
    assert.equal(validateNetworkPolicy(defineNetworkPolicy("p", { egress: { allowedSchemes: ["https"] } })).length, 0);
  });
  it("allowing the metadata endpoint is an error", () => {
    const codes = validateNetworkPolicy(defineNetworkPolicy("p", { egress: { allowMetadataEndpoint: true } })).map((d) => d.code);
    assert.ok(codes.includes("Galerina_NETWORK_EGRESS_METADATA_ALLOWED"));
  });
  it("plaintext http + non-public are errors in production", () => {
    const ds = validateNetworkPolicy(defineNetworkPolicy("p", { egress: { allowedSchemes: ["http"], allowNonPublicHosts: true } }), { production: true });
    assert.ok(ds.some((d) => d.code === "Galerina_NETWORK_EGRESS_PLAINTEXT_SCHEME" && d.severity === "error"));
    assert.ok(ds.some((d) => d.code === "Galerina_NETWORK_EGRESS_NONPUBLIC_ALLOWED" && d.severity === "error"));
  });
  it("a default policy (no egress) is unaffected — backward compatible", () => {
    assert.equal(validateNetworkPolicy(defineNetworkPolicy("default")).length, 0);
  });
});

describe("validateWebhookTarget — strict, ignores caller relaxations", () => {
  it("public https webhook allowed", () => assert.equal(validateWebhookTarget("https://hooks.example.com/x").allowed, true));
  it("private webhook denied even if caller passes allowNonPublicHosts", () => {
    assert.equal(validateWebhookTarget("https://10.0.0.5/hook", { allowNonPublicHosts: true }).allowed, false);
  });
  it("metadata webhook denied even if caller passes allowMetadataEndpoint", () => {
    assert.equal(validateWebhookTarget("https://169.254.169.254/", { allowMetadataEndpoint: true }).allowed, false);
  });
  it("plaintext webhook denied", () => assert.equal(validateWebhookTarget("http://hooks.example.com/").allowed, false));
  it("an allow-listed internal receiver is still honoured", () => {
    assert.equal(validateWebhookTarget("https://10.0.0.9/hook", { allowedHosts: ["10.0.0.9"] }).allowed, true);
  });
});

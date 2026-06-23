// kernel-integration.test.mjs — the thesis of this package, proven end to end:
// logicn-auth produces the auth FACTOR; the App Kernel still DECIDES admission, and
// keeps its existing fail-closed K3 fold. We do NOT modify the kernel — we feed its
// `channelVerdict` hook and assert the kernel's verdict-collapse is unchanged.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  channelIdentityVerdict,
  scopeVerdict,
  composeAuthVerdict,
} from "../dist/index.js";

// The kernel imports sibling dists (core-config, tower-citizen). When the kernel
// hasn't been built, skip cleanly rather than fail this package's suite.
let createAppKernel;
try {
  ({ createAppKernel } = await import("../../logicn-framework-app-kernel/dist/index.js"));
} catch {
  createAppKernel = undefined;
}
const skip = createAppKernel ? false : "@logicn/framework-app-kernel dist not built";

const NOW = 1_000_000;
function goodCert(over = {}) {
  return {
    pinnedDigests: ["sha256:abc"],
    presentedDigest: "sha256:abc",
    chainOutcome: "valid",
    notBefore: NOW - 1000,
    notAfter: NOW + 1000,
    now: NOW,
    revocation: "good",
    revocationProducedAt: NOW - 100,
    revocationFreshnessMs: 300_000,
    ...over,
  };
}

function req(over = {}) {
  return {
    method: "GET",
    path: "/secure",
    headers: {},
    body: new Uint8Array(0),
    query: {},
    requestId: "rq-1",
    receivedAt: 0,
    ...over,
  };
}

function kernelWithSecureRoute() {
  let ran = false;
  const kernel = createAppKernel({
    routes: [{ method: "GET", path: "/secure", handler: "secure" }], // default: required auth
    dispatch: { secure: () => { ran = true; return { body: { ok: true } }; } },
  });
  return { kernel, ran: () => ran };
}

test("channel factor ALLOW → kernel ADMITS (handler runs)", { skip }, async () => {
  const { kernel, ran } = kernelWithSecureRoute();
  const channelVerdict = channelIdentityVerdict(goodCert());
  assert.equal(channelVerdict, 1); // the factor is +1
  const res = await kernel.handle(req({ channelVerdict }));
  assert.notEqual(res.status, 401); // the KERNEL admitted on the +1 factor
  assert.equal(ran(), true);
});

test("channel factor INDETERMINATE (revocation unknown) → kernel REFUSES (401), handler NOT run", { skip }, async () => {
  const { kernel, ran } = kernelWithSecureRoute();
  const channelVerdict = channelIdentityVerdict(goodCert({ revocation: "unknown" }));
  assert.equal(channelVerdict, 0); // the factor is 0 — no positive proof
  const res = await kernel.handle(req({ channelVerdict }));
  assert.equal(res.status, 401); // the KERNEL's fail-closed fold denied it
  assert.equal(ran(), false);
});

test("channel factor DENY (revoked) → kernel REFUSES (401)", { skip }, async () => {
  const { kernel, ran } = kernelWithSecureRoute();
  const res = await kernel.handle(req({ channelVerdict: channelIdentityVerdict(goodCert({ revocation: "revoked" })) }));
  assert.equal(res.status, 401);
  assert.equal(ran(), false);
});

test("composed channel ∧ scope (both ALLOW) → kernel ADMITS", { skip }, async () => {
  const { kernel, ran } = kernelWithSecureRoute();
  const channelVerdict = composeAuthVerdict([
    channelIdentityVerdict(goodCert()),
    scopeVerdict(["secure.read"], ["secure.read", "other"]),
  ]);
  assert.equal(channelVerdict, 1);
  const res = await kernel.handle(req({ channelVerdict }));
  assert.notEqual(res.status, 401);
  assert.equal(ran(), true);
});

test("composed channel(ALLOW) ∧ scope(DENY: missing scope) → kernel REFUSES (401)", { skip }, async () => {
  const { kernel, ran } = kernelWithSecureRoute();
  const channelVerdict = composeAuthVerdict([
    channelIdentityVerdict(goodCert()),
    scopeVerdict(["admin"], ["user"]),
  ]);
  assert.equal(channelVerdict, -1); // scope DENY annihilates the composite
  const res = await kernel.handle(req({ channelVerdict }));
  assert.equal(res.status, 401);
  assert.equal(ran(), false);
});

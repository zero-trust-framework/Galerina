// Multi-module composition — R&D 0052 Phase A (interim host-linker, first-party only).
// Covers the PURE planner (planComposition: set-signed, deny-by-default, ambiguity, cycle,
// self-provision, provider-shape), the provider-backed factory routing, and the fusePackages
// orchestrator's set-level signed invariant against the real built demo package.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { planComposition, makeProviderFactory, fusePackages, fusePackage, buildImportClosure } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const DEMO_DIR = join(here, "..", "..", "..", "examples", "fuse-demo", "my-custom-api-rest");

const KNOWN = new Set(["network.inbound", "network.outbound", "clock.read", "log.write"]);
const member = (name, provides, capabilities, signature = "verified") => ({ name, provides, capabilities, signature });

// ─────────────────────────── planComposition (pure) ───────────────────────────

test("plan: a provider is ordered BEFORE the consumer that imports it", () => {
  const plan = planComposition(
    [member("app", null, ["network.inbound"]), member("netstack", "network.inbound", [])],
    KNOWN,
  );
  assert.deepEqual(plan.order, ["netstack", "app"], "provider netstack before consumer app");
  assert.deepEqual(plan.resolution.get("app").get("network.inbound"), { kind: "provider", provider: "netstack" });
});

test("plan: a declared capability with no provider falls back to the built-in host shim", () => {
  const plan = planComposition([member("app", null, ["clock.read"])], KNOWN);
  assert.deepEqual(plan.resolution.get("app").get("clock.read"), { kind: "builtin" });
  assert.deepEqual(plan.order, ["app"]);
});

test("plan: SET-SIGNED — one unsigned member refuses the whole set", () => {
  assert.throws(
    () => planComposition([member("a", null, []), member("b", null, [], "unsigned")], KNOWN),
    /FUNGI-FUSE-SET-UNSIGNED/,
  );
  // allowUnsigned overrides
  assert.doesNotThrow(() =>
    planComposition([member("a", null, []), member("b", null, [], "unsigned")], KNOWN, { allowUnsigned: true }),
  );
});

test("plan: DENY-BY-DEFAULT — an unsatisfied capability refuses the set", () => {
  assert.throws(
    () => planComposition([member("app", null, ["storage.write"])], KNOWN),
    /FUNGI-FUSE-UNKNOWN-CAP/,
  );
});

test("plan: ambiguous provider (two providers for a CONSUMED capability) is refused", () => {
  assert.throws(
    () =>
      planComposition(
        [member("p1", "log.write", []), member("p2", "log.write", []), member("c", null, ["log.write"])],
        KNOWN,
      ),
    /FUNGI-FUSE-SET-AMBIGUOUS/,
  );
});

test("plan: an unconsumed `provides` (a seam like 'rest') is inert — not required to have a shape", () => {
  // The demo's provides:'rest' has no peer consumer, so it must NOT trip PROVIDES-UNKNOWN.
  assert.doesNotThrow(() => planComposition([member("svc", "rest", ["network.inbound"])], KNOWN));
});

test("plan: a CONSUMED capability with a provider but no registered host-import shape is refused", () => {
  assert.throws(
    () =>
      planComposition(
        [member("p", "custom.unknown", []), member("c", null, ["custom.unknown"])],
        KNOWN,
      ),
    /FUNGI-FUSE-PROVIDES-UNKNOWN/,
  );
});

test("plan: a package that both provides AND declares the same capability is refused", () => {
  assert.throws(
    () => planComposition([member("p", "clock.read", ["clock.read"])], KNOWN),
    /FUNGI-FUSE-SET-SELF/,
  );
});

test("plan: a provider cycle is refused", () => {
  // A provides clock.read, consumes log.write; B provides log.write, consumes clock.read.
  assert.throws(
    () =>
      planComposition(
        [member("A", "clock.read", ["log.write"]), member("B", "log.write", ["clock.read"])],
        KNOWN,
      ),
    /FUNGI-FUSE-SET-CYCLE/,
  );
});

// ───────────────────────── makeProviderFactory (routing) ─────────────────────────

test("makeProviderFactory mirrors the capability shape and routes every function to the provider", () => {
  const registry = {
    "math.add": () => ({ namespace: "math_add", functions: { compute: () => 0, reset: () => 0 } }),
  };
  const calls = [];
  const fakeProvider = { name: "mathlib", seam: null, capabilities: [], invoke: (fn, ...a) => { calls.push([fn, a]); return 99; } };

  const group = makeProviderFactory("math.add", registry, () => fakeProvider)();
  assert.equal(group.namespace, "math_add", "namespace mirrors the registered shape");
  assert.deepEqual(Object.keys(group.functions).sort(), ["compute", "reset"], "function names mirror the shape");

  const ret = group.functions.compute(2, 3);
  assert.equal(ret, 99, "the routed call returns the provider's invoke() result");
  assert.deepEqual(calls, [["compute", [2, 3]]], "routed to provider.invoke('compute', 2, 3)");
});

// ───────────────────── fusePackages orchestrator (real demo) ─────────────────────

test("fusePackages: the set-signed invariant refuses a placeholder-signed package without allowUnsigned", async () => {
  await assert.rejects(() => fusePackages([DEMO_DIR], { warn: () => {} }), /FUNGI-FUSE-SET-UNSIGNED/);
});

test("fusePackages: a one-package set composes (allowUnsigned) and invoke('main') runs the governed wasm", async () => {
  const components = await fusePackages([DEMO_DIR], { allowUnsigned: true, warn: () => {} });
  assert.equal(components.size, 1);
  const demo = components.get("my-custom-api-rest");
  assert.ok(demo, "the demo component is present in the set");
  assert.equal(demo.invoke("main"), 200);
});

test("fusePackages: a duplicate package name in the set is refused", async () => {
  await assert.rejects(
    () => fusePackages([DEMO_DIR, DEMO_DIR], { allowUnsigned: true, warn: () => {} }),
    /FUNGI-FUSE-SET-DUPLICATE/,
  );
});

// ── Slice 2: a REAL producer→consumer wasm→wasm call across the module boundary ──
const PROVIDER_DIR = join(here, "fixtures", "compose", "clockprovider");
const CONSUMER_DIR = join(here, "fixtures", "compose", "clockconsumer");

test("fusePackages: a REAL cross-module call — consumer.main() routes through the provider (→ 42)", async () => {
  const components = await fusePackages([PROVIDER_DIR, CONSUMER_DIR], { allowUnsigned: true, warn: () => {} });
  assert.equal(components.size, 2);
  const consumer = components.get("clockconsumer");
  assert.ok(consumer, "consumer present in the set");
  // consumer.main() imports clock.__clock_now_ms; the linker backed that capability with the
  // clockprovider MODULE, so the 42 comes from clockprovider's exported wasm function across the
  // boundary — NOT from the built-in host shim (which returns 0).
  assert.equal(consumer.invoke("main"), 42, "wasm→wasm cross-module call returned the provider's value");
});

test("fusePackages: composition order is independent — consumer listed FIRST still links (topo sort)", async () => {
  const components = await fusePackages([CONSUMER_DIR, PROVIDER_DIR], { allowUnsigned: true, warn: () => {} });
  assert.equal(components.get("clockconsumer").invoke("main"), 42, "provider is instantiated before the consumer regardless of input order");
});

test("fusePackages: WITHOUT the provider, the consumer's clock.read falls back to the host shim (→ 0)", async () => {
  // Fusing the consumer ALONE resolves clock.read to the built-in shim (__clock_now_ms → 0),
  // proving the 42 above genuinely came from the provider module, not a coincidence.
  const components = await fusePackages([CONSUMER_DIR], { allowUnsigned: true, warn: () => {} });
  assert.equal(components.get("clockconsumer").invoke("main"), 0, "no provider → built-in host shim backs clock.read");
});

// ── R&D 0051: posture-derived import profile (requireSignature) + import-closure report ──
test("requireSignature OVERRIDES allowUnsigned (fail-secure) — fusePackages refuses an unsigned set", async () => {
  await assert.rejects(
    () => fusePackages([PROVIDER_DIR, CONSUMER_DIR], { allowUnsigned: true, requireSignature: true, warn: () => {} }),
    /FUNGI-FUSE-SET-UNSIGNED/,
    "posture 'on' (requireSignature) must refuse unsigned even when allowUnsigned was passed (set-signed invariant fires)",
  );
});

test("requireSignature OVERRIDES allowUnsigned for a single fusePackage too", async () => {
  await assert.rejects(
    () => fusePackage(DEMO_DIR, { allowUnsigned: true, requireSignature: true, warn: () => {} }),
    /posture requires a signature/,
  );
});

test("buildImportClosure: an UNTRUSTED inventory (trusted:false) with wasmSha256 + signature per module", async () => {
  const closure = await buildImportClosure([PROVIDER_DIR, CONSUMER_DIR], { warn: () => {} });
  assert.equal(closure.schemaVersion, "fungi.import-closure.v1");
  assert.equal(closure.trusted, false, "the closure is a report, NOT a trusted lockfile");
  assert.equal(closure.modules.length, 2);
  const byName = Object.fromEntries(closure.modules.map((m) => [m.name, m]));
  assert.match(byName.clockprovider.wasmSha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal(byName.clockprovider.signature, "unsigned", "the unsigned fixtures report as unsigned");
  assert.equal(byName.clockconsumer.keyId, null, "no keyId on an unsigned module");
});

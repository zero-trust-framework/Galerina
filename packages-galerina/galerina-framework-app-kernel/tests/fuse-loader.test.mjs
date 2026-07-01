// Fuse B2 — governed component loader + SIGNED fuse descriptor (Net a).
// Verifies: the built demo package fuses; a tampered .wasm (hash mismatch) is
// rejected; an undeclared capability gets NO host import; unsigned is fail-closed
// unless allowUnsigned; a real Ed25519 signature is verified and tamper is caught.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  mkdtempSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync, existsSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairSync, sign as cryptoSign, createPrivateKey } from "node:crypto";

import { fusePackage, fusePackages, buildCapabilityImports } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
// tests/  →  package dir  →  packages-galerina  →  repo root  →  examples/…
const DEMO_DIR = join(here, "..", "..", "..", "examples", "fuse-demo", "my-custom-api-rest");

// A loader-supplied warn sink so WARN output is captured, not printed.
function capturingWarn() {
  const lines = [];
  return { warn: (m) => lines.push(m), lines };
}

// Copy the built demo package into a throwaway dir so destructive tests don't touch
// the real artifacts. Returns the temp package dir (with dist/ populated).
function copyDemo() {
  const root = mkdtempSync(join(tmpdir(), "fungi-fuse-"));
  const pkg = join(root, "my-custom-api-rest");
  mkdirSync(pkg, { recursive: true });
  cpSync(DEMO_DIR, pkg, { recursive: true });
  return { root, pkg };
}

// ── B5a — central signed-registry gate (registryCheck), fail-closed ──────────
test("registryCheck DENY refuses the fuse even for an otherwise-admissible package", async () => {
  assert.ok(existsSync(join(DEMO_DIR, "dist", "my-custom-api-rest.wasm")), "demo must be built first");
  await assert.rejects(
    () => fusePackage(DEMO_DIR, {
      allowUnsigned: true,
      warn: () => {},
      registryCheck: () => ({ ok: false, code: "ERR_REGISTRY_PACKAGE_UNKNOWN", reason: "not in the certified index" }),
    }),
    /ERR_REGISTRY_PACKAGE_UNKNOWN|central registry refused/,
  );
});

test("registryCheck ALLOW lets the fuse proceed and receives the package identity", async () => {
  let seen;
  const component = await fusePackage(DEMO_DIR, {
    allowUnsigned: true,
    warn: () => {},
    registryCheck: (pkg) => { seen = pkg; return { ok: true }; },
  });
  assert.equal(component.name, "my-custom-api-rest");
  assert.equal(seen.name, "my-custom-api-rest");
  assert.equal(typeof seen.sourceHash, "string");
  assert.ok(seen.sourceHash.startsWith("sha256:"), "registry gate receives the pinned-style wasm hash");
});

test("fusePackages (multi-module) ALSO enforces registryCheck — an unlisted member refuses the whole set", async () => {
  assert.ok(existsSync(join(DEMO_DIR, "dist", "my-custom-api-rest.wasm")), "demo must be built first");
  await assert.rejects(
    () => fusePackages([DEMO_DIR], {
      allowUnsigned: true, warn: () => {},
      registryCheck: () => ({ ok: false, code: "ERR_REGISTRY_PACKAGE_UNKNOWN", reason: "not in the certified index" }),
    }),
    /ERR_REGISTRY_PACKAGE_UNKNOWN|central registry refused/,
  );
});

// ── 1 — the built demo package fuses, and invoke('main') runs the governed wasm ──
test("the built demo package fuses (allowUnsigned: placeholder-signed) and invokes main → 200", async () => {
  assert.ok(existsSync(join(DEMO_DIR, "dist", "my-custom-api-rest.wasm")), "demo must be built first");
  const { warn, lines } = capturingWarn();

  const component = await fusePackage(DEMO_DIR, { allowUnsigned: true, warn });

  assert.equal(component.name, "my-custom-api-rest");
  assert.equal(component.seam, "protocol.inbound");
  assert.deepEqual([...component.capabilities], ["network.inbound"]);
  // The demo's main() returns the HTTP status 200 directly (pure governed flow).
  assert.equal(component.invoke("main"), 200);
  // allowUnsigned must WARN that it admitted an unsigned manifest.
  assert.ok(lines.some((l) => l.includes("FUNGI-FUSE-UNSIGNED-ALLOWED")), "expected an unsigned-allowed warning");
});

// ── 2 — a tampered .wasm (hash ≠ signed descriptor) is rejected, fail-closed ──
test("a tampered .wasm (sha256 mismatch vs signed descriptor) is rejected", async () => {
  const { root, pkg } = copyDemo();
  try {
    // Corrupt the wasm: append a byte. The embedded (signed) descriptor's wasmSha256
    // no longer matches, so fusion must throw before instantiation.
    const wasmPath = join(pkg, "dist", "my-custom-api-rest.wasm");
    const original = readFileSync(wasmPath);
    writeFileSync(wasmPath, Buffer.concat([original, Buffer.from([0x00])]));

    await assert.rejects(
      () => fusePackage(pkg, { allowUnsigned: true }),
      /FUNGI-FUSE-HASH-MISMATCH/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── 3 — deny-by-default: a capability NOT declared gets NO host import ──
test("a host import for a NON-declared capability is absent (deny-by-default)", () => {
  // The demo declares ONLY network.inbound. Build its import object directly.
  const builtin = {
    "network.inbound": () => ({ namespace: "network_inbound", functions: { __net_in_accept: () => -1 } }),
    "network.outbound": () => ({ namespace: "network_outbound", functions: { __net_out_connect: () => -1 } }),
    "clock.read": () => ({ namespace: "clock", functions: { __clock_now_ms: () => 0 } }),
  };

  const { imports, grantedNamespaces } = buildCapabilityImports(["network.inbound"], builtin);

  // The declared capability IS present.
  assert.ok("network_inbound" in imports, "declared capability must be granted");
  assert.equal(typeof imports.network_inbound.__net_in_accept, "function");
  assert.deepEqual([...grantedNamespaces], ["network_inbound"]);

  // The UNDECLARED capabilities are entirely absent — no namespace, no function.
  assert.equal("network_outbound" in imports, false, "undeclared network.outbound must be absent");
  assert.equal("clock" in imports, false, "undeclared clock.read must be absent");
  assert.equal(imports.network_outbound, undefined);
  assert.equal(imports.clock, undefined);
});

// An undeclarable capability (no factory) is refused outright — deny-by-default.
test("a capability with no host-import factory is refused (FUNGI-FUSE-UNKNOWN-CAP)", () => {
  assert.throws(
    () => buildCapabilityImports(["storage.write"], { "network.inbound": () => ({ namespace: "n", functions: {} }) }),
    /FUNGI-FUSE-UNKNOWN-CAP/,
  );
});

// ── 4 — unsigned is fail-closed without allowUnsigned ──
test("an unsigned (placeholder) manifest is refused without allowUnsigned", async () => {
  await assert.rejects(
    () => fusePackage(DEMO_DIR, { /* allowUnsigned omitted */ warn: () => {} }),
    /FUNGI-FUSE-UNSIGNED/,
  );
});

// ── 5 — a REAL Ed25519 signature is verified; a flipped byte is caught ──
test("a real Ed25519-signed manifest is verified; tampering the body is rejected", async () => {
  const { root, pkg } = copyDemo();
  try {
    // Generate an Ed25519 keypair and a governance dir holding the public key.
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const keyId = "testkey00000001";
    const govDir = join(root, "governance");
    mkdirSync(govDir, { recursive: true });
    writeFileSync(join(govDir, `signing-key-${keyId}.pub.pem`), publicKey);

    // Re-sign the demo's manifest exactly the way `galerina build` does: strip the
    // signature field, JSON.stringify(.., null, 2), Ed25519 sign (verify(null,..)).
    const manifestPath = join(pkg, "dist", "my-custom-api-rest.lmanifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const { governanceSignature: _drop, ...withoutSig } = manifest;
    const bytes = Buffer.from(JSON.stringify(withoutSig, null, 2));
    const signature = cryptoSign(null, bytes, createPrivateKey(privateKey)).toString("base64");
    const signed = { ...withoutSig, governanceSignature: { algorithm: "Ed25519", keyId, signature, signedAt: new Date().toISOString() } };
    writeFileSync(manifestPath, JSON.stringify(signed, null, 2));

    // With a valid signature + matching pubkey, fusion succeeds WITHOUT allowUnsigned.
    const { warn, lines } = capturingWarn();
    const component = await fusePackage(pkg, { governanceDir: govDir, warn });
    assert.equal(component.invoke("main"), 200);
    assert.ok(!lines.some((l) => l.includes("FUNGI-FUSE-UNSIGNED")), "a verified manifest must not warn unsigned");

    // Now TAMPER the signed body (flip a field) without re-signing → verification fails.
    const tampered = JSON.parse(readFileSync(manifestPath, "utf8"));
    tampered.flowCount = (tampered.flowCount ?? 0) + 1; // a signed field changed
    writeFileSync(manifestPath, JSON.stringify(tampered, null, 2));

    await assert.rejects(
      () => fusePackage(pkg, { governanceDir: govDir, warn: () => {} }),
      /FUNGI-FUSE-SIG-INVALID/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── 5b — REVOCATION (audit fix): a validly-signed but REVOKED key is refused at the fuse gate ──
test("a validly-signed manifest whose signing key is REVOKED is refused (fail-closed)", async () => {
  const { root, pkg } = copyDemo();
  try {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const keyId = "revokedkey000001";
    const govDir = join(root, "governance");
    mkdirSync(govDir, { recursive: true });
    writeFileSync(join(govDir, `signing-key-${keyId}.pub.pem`), publicKey);

    const manifestPath = join(pkg, "dist", "my-custom-api-rest.lmanifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const { governanceSignature: _drop, ...withoutSig } = manifest;
    const signature = cryptoSign(null, Buffer.from(JSON.stringify(withoutSig, null, 2)), createPrivateKey(privateKey)).toString("base64");
    writeFileSync(manifestPath, JSON.stringify({ ...withoutSig, governanceSignature: { algorithm: "Ed25519", keyId, signature, signedAt: new Date().toISOString() } }, null, 2));

    // The signature is CRYPTOGRAPHICALLY VALID — but the key is revoked → refuse (the core audit gap).
    await assert.rejects(
      () => fusePackage(pkg, { governanceDir: govDir, warn: () => {}, revocationCheck: (k) => k === keyId }),
      /FUNGI-FUSE-KEY-REVOKED/,
    );
    // A revocation check that THROWS (e.g. an untrustworthy/tampered registry) is itself fail-closed.
    await assert.rejects(
      () => fusePackage(pkg, { governanceDir: govDir, warn: () => {}, revocationCheck: () => { throw new Error("registry untrusted"); } }),
      /FUNGI-FUSE-REVOCATION-UNVERIFIABLE/,
    );
    // A NON-revoked key still fuses — the gate blocks ONLY revoked keys.
    const ok = await fusePackage(pkg, { governanceDir: govDir, warn: () => {}, revocationCheck: () => false });
    assert.equal(ok.invoke("main"), 200);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── 5c — VERSIONED signing: a jcs (RFC 8785) signature verifies through the loader ──
// This doubles as a CONFORMANCE check: the manifest is signed over CORE-compiler's canonicalJson, then
// verified by the loader's OWN local canonicalJson. If the two implementations drifted by a single byte,
// the Ed25519 signature would fail to verify — so a pass proves they agree byte-for-byte.
test("a jcs (RFC 8785 canonical) Ed25519 signature verifies through the loader (legacy ⇄ jcs both work)", async () => {
  const { canonicalJson } = await import("../../galerina-core-compiler/dist/manifest-generator.js");
  const { root, pkg } = copyDemo();
  try {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const keyId = "jcskey000000001";
    const govDir = join(root, "governance");
    mkdirSync(govDir, { recursive: true });
    writeFileSync(join(govDir, `signing-key-${keyId}.pub.pem`), publicKey);

    const manifestPath = join(pkg, "dist", "my-custom-api-rest.lmanifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const { governanceSignature: _drop, ...withoutSig } = manifest;
    // Sign over RFC 8785 canonical JSON and TAG the signature canon: "jcs".
    const signature = cryptoSign(null, Buffer.from(canonicalJson(withoutSig)), createPrivateKey(privateKey)).toString("base64");
    writeFileSync(manifestPath, JSON.stringify(
      { ...withoutSig, governanceSignature: { algorithm: "Ed25519", keyId, signature, canon: "jcs", signedAt: new Date().toISOString() } },
      null, 2,
    ));

    // The loader reconstructs the jcs bytes with its own canonicalJson → must verify and fuse.
    const component = await fusePackage(pkg, { governanceDir: govDir, warn: () => {} });
    assert.equal(component.invoke("main"), 200);

    // Tamper a signed field without re-signing → the jcs signature must now FAIL (control).
    const tampered = JSON.parse(readFileSync(manifestPath, "utf8"));
    tampered.flowCount = (tampered.flowCount ?? 0) + 1;
    writeFileSync(manifestPath, JSON.stringify(tampered, null, 2));
    await assert.rejects(
      () => fusePackage(pkg, { governanceDir: govDir, warn: () => {} }),
      /FUNGI-FUSE-SIG-INVALID/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── 6 — the embedded fuse block is the source of truth: sidecar drift is caught ──
test("a .fuse.json whose wasmSha256 disagrees with the signed manifest is rejected", async () => {
  const { root, pkg } = copyDemo();
  try {
    const fuseJsonPath = join(pkg, "dist", "my-custom-api-rest.fuse.json");
    const sidecar = JSON.parse(readFileSync(fuseJsonPath, "utf8"));
    sidecar.wasmSha256 = "sha256:" + "0".repeat(64); // drift vs the signed manifest
    writeFileSync(fuseJsonPath, JSON.stringify(sidecar, null, 2));

    await assert.rejects(
      () => fusePackage(pkg, { allowUnsigned: true, warn: () => {} }),
      /FUNGI-FUSE-SIDECAR-DRIFT/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── 6 — H3/H4 (#49): an injected hybridVerifier verifies a HYBRID (Ed25519+ML-DSA-65) manifest at load ──
test("injected hybridVerifier is honored fail-closed for a HYBRID manifest", async () => {
  // Build a demo whose manifest carries a HYBRID signature (algorithm Ed25519+ML-DSA-65, signature ed|mldsa).
  // The verifier is INJECTED (the kernel stays PQ-crypto-free); the test drives the verdict it returns.
  const mkHybrid = () => {
    const { root, pkg } = copyDemo();
    const keyId = "hybridkey0000001";
    const manifestPath = join(pkg, "dist", "my-custom-api-rest.lmanifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const { governanceSignature: _drop, ...withoutSig } = manifest;
    const governanceSignature = { algorithm: "Ed25519+ML-DSA-65", keyId, signature: "ZWQ=|bWxkc2E=", signedAt: new Date().toISOString() };
    writeFileSync(manifestPath, JSON.stringify({ ...withoutSig, governanceSignature }, null, 2));
    return { root, pkg, keyId, withoutSig };
  };

  // (a) "verified" → admitted as SIGNED without allowUnsigned; verifier gets the exact canonical bytes + sig.
  { const { root, pkg, keyId, withoutSig } = mkHybrid();
    try {
      let seen;
      const component = await fusePackage(pkg, { warn: () => {}, hybridVerifier: (inp) => { seen = inp; return "verified"; } });
      assert.equal(component.invoke("main"), 200);
      assert.equal(seen.keyId, keyId);
      assert.equal(seen.signature, "ZWQ=|bWxkc2E=");
      assert.match(seen.algorithm, /ML-DSA/i);
      // BOTH halves signed the same RFC-8785 body — for an untagged sig that is the legacy pretty-JSON.
      assert.equal(Buffer.from(seen.signingInput).toString("utf8"), JSON.stringify(withoutSig, null, 2));
    } finally { rmSync(root, { recursive: true, force: true }); } }

  // (b) "invalid" → the loader THROWS (tamper), fail-closed.
  { const { root, pkg } = mkHybrid();
    try {
      await assert.rejects(() => fusePackage(pkg, { warn: () => {}, hybridVerifier: () => "invalid" }), /FUNGI-FUSE-HYBRID-INVALID/);
    } finally { rmSync(root, { recursive: true, force: true }); } }

  // (c) a THROWING verifier fails closed.
  { const { root, pkg } = mkHybrid();
    try {
      await assert.rejects(() => fusePackage(pkg, { warn: () => {}, hybridVerifier: () => { throw new Error("boom"); } }), /FUNGI-FUSE-HYBRID-ERROR/);
    } finally { rmSync(root, { recursive: true, force: true }); } }

  // (d) "unverifiable" → treated as UNSIGNED: refused without allowUnsigned, admitted with it.
  { const { root, pkg } = mkHybrid();
    try {
      await assert.rejects(() => fusePackage(pkg, { requireSignature: true, warn: () => {}, hybridVerifier: () => "unverifiable" }), /FUNGI-FUSE-UNSIGNED/);
      const c = await fusePackage(pkg, { allowUnsigned: true, warn: () => {}, hybridVerifier: () => "unverifiable" });
      assert.equal(c.invoke("main"), 200);
    } finally { rmSync(root, { recursive: true, force: true }); } }

  // (e) NO verifier injected → hybrid stays UNVERIFIED → unsigned (prior behaviour) + a loud warn.
  { const { root, pkg } = mkHybrid();
    try {
      const { warn, lines } = capturingWarn();
      await assert.rejects(() => fusePackage(pkg, { requireSignature: true, warn }), /FUNGI-FUSE-UNSIGNED/);
      assert.ok(lines.some((l) => l.includes("FUNGI-FUSE-HYBRID-UNVERIFIED")), "must warn hybrid-unverified when no verifier is injected");
    } finally { rmSync(root, { recursive: true, force: true }); } }

  // (f) an ASYNC verifier (the real reference verifier is async — verifyGovernanceSignatureHybrid dynamic-imports
  //     @noble/post-quantum) is AWAITED: a Promise<"verified"> admits, a rejecting Promise fails closed.
  { const { root, pkg } = mkHybrid();
    try {
      const c = await fusePackage(pkg, { warn: () => {}, hybridVerifier: async () => "verified" });
      assert.equal(c.invoke("main"), 200);
    } finally { rmSync(root, { recursive: true, force: true }); } }
  { const { root, pkg } = mkHybrid();
    try {
      await assert.rejects(() => fusePackage(pkg, { warn: () => {}, hybridVerifier: () => Promise.reject(new Error("async boom")) }), /FUNGI-FUSE-HYBRID-ERROR/);
    } finally { rmSync(root, { recursive: true, force: true }); } }
});

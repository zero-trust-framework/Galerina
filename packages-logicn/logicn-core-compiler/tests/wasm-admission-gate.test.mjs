/**
 * #105 — WASM execution harness as a SECURITY ADMISSION GATE.
 *
 * Proves the three locked disciplines:
 *   1. Attestation FIRST — a tampered/unsigned binary throws CRITICAL_SECURITY_VIOLATION
 *      BEFORE any host function is linked (onViolation fires; no instantiation).
 *   2. Closed-allowlist host imports — a flow that calls a host stdlib function runs
 *      in real WASM through the gate, reaching ONLY the runtime's host object.
 *   3. Enforcement invariant — the same gate runs in dev (with an Observer) and prod;
 *      only observability differs.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseProgram, checkEffects, emitGIR, buildWATModuleFromGIR, renderWAT, assembleWAT,
  generateRunnerKeypair, signWasm, verifyWasm, createHostRuntime, admitAndInstantiate,
} from "../dist/index.js";

// A flow that uses a host import: n.toStr() → host.__int_to_str
const HOST_FLOW = "pure flow numStr(n: Int) -> String contract { effects {} } { return n.toStr() }";

async function compileToWasm(src) {
  const prog = parseProgram(src, "t.lln");
  const errs = (prog.diagnostics ?? []).filter((d) => d.severity === "error");
  if (errs.length) throw new Error("parse: " + errs.map((d) => d.message).join("; "));
  const fx = checkEffects(prog.flows, prog.ast);
  const { gir } = emitGIR(prog.ast, prog.flows, fx);
  const wat = renderWAT(buildWATModuleFromGIR(gir, undefined, "t", prog.ast, true));
  const asm = await assembleWAT(wat);
  assert.equal(asm.valid, true, JSON.stringify(asm.diagnostics));
  return asm.wasm;
}

describe("#105 WASM admission gate", () => {
  it("admits a signed host-using flow and links ONLY the closed host imports", async () => {
    const wasm = await compileToWasm(HOST_FLOW);
    const { publicKeyPem, privateKeyPem } = generateRunnerKeypair();
    const attestation = signWasm(wasm, privateKeyPem, "dev");

    const calls = [];
    const host = createHostRuntime({ onHostCall: (n, a, r) => calls.push({ n, a, r }) });
    const { instance } = await admitAndInstantiate({
      wasm, attestation, policy: { requireSigned: true, publicKeyPem }, host,
      observe: { onHostCall: (n, a, r) => calls.push({ n, a, r }) },
    });

    const handle = instance.exports.numStr(42);   // returns a string handle
    assert.equal(host.readString(handle), "42", "host __int_to_str interned '42'");
    assert.ok(calls.some((c) => c.n === "__int_to_str"), "host call was observed");
  });

  it("REFUSES a tampered binary before any host linking (CRITICAL_SECURITY_VIOLATION)", async () => {
    const wasm = await compileToWasm(HOST_FLOW);
    const { publicKeyPem, privateKeyPem } = generateRunnerKeypair();
    const attestation = signWasm(wasm, privateKeyPem, "dev");

    // Flip a byte in the binary AFTER signing → hash + signature no longer match.
    const tampered = Uint8Array.from(wasm);
    tampered[tampered.length - 1] ^= 0xff;

    let violated = null;
    let linkedHost = false;
    const host = createHostRuntime();
    // Wrap a host fn to detect if linking was ever reached (it must NOT be).
    const origCreate = host.imports.host.__int_to_str;
    host.imports.host.__int_to_str = (...a) => { linkedHost = true; return origCreate(...a); };

    await assert.rejects(
      () => admitAndInstantiate({
        wasm: tampered, attestation, policy: { requireSigned: true, publicKeyPem }, host,
        observe: { onViolation: (reason) => { violated = reason; } },
      }),
      /CRITICAL_SECURITY_VIOLATION/,
    );
    assert.ok(violated, "onViolation fired before throwing");
    assert.equal(linkedHost, false, "host functions were NEVER linked for the rejected binary");
  });

  it("REFUSES an unsigned binary under requireSigned", async () => {
    const wasm = await compileToWasm(HOST_FLOW);
    const { publicKeyPem } = generateRunnerKeypair();
    await assert.rejects(
      () => admitAndInstantiate({
        wasm, attestation: undefined, policy: { requireSigned: true, publicKeyPem }, host: createHostRuntime(),
      }),
      /CRITICAL_SECURITY_VIOLATION/,
    );
  });

  it("production profile (requireCertifiedProfile) refuses a dev attestation", async () => {
    const wasm = await compileToWasm(HOST_FLOW);
    const { publicKeyPem, privateKeyPem } = generateRunnerKeypair();
    const devAtt = signWasm(wasm, privateKeyPem, "dev");
    const v = verifyWasm(wasm, devAtt, { requireSigned: true, publicKeyPem, requireCertifiedProfile: true });
    assert.equal(v.ok, false);
    assert.match(v.reason, /certified profile required/);
    // same binary signed as certified passes
    const certAtt = signWasm(wasm, privateKeyPem, "certified");
    assert.equal(verifyWasm(wasm, certAtt, { requireSigned: true, publicKeyPem, requireCertifiedProfile: true }).ok, true);
  });

  it("#173 REFUSES a dev attestation re-labeled 'certified' — profile is bound into the signature", async () => {
    const wasm = await compileToWasm(HOST_FLOW);
    const { publicKeyPem, privateKeyPem } = generateRunnerKeypair();
    const devAtt = signWasm(wasm, privateKeyPem, "dev");
    // Attacker flips ONLY the profile label — bytes + signature unchanged. Pre-#173 this passed (the
    // signature was over the raw bytes); now the pre-image (domain ∥ hash ∥ profile) no longer matches.
    const forged = { ...devAtt, profile: "certified" };
    const v = verifyWasm(wasm, forged, { requireSigned: true, publicKeyPem, requireCertifiedProfile: true });
    assert.equal(v.ok, false, "re-labeled certified attestation must be rejected (privilege escalation closed)");
    assert.match(v.reason, /signature/i);
  });

  it("hash pinning: only the pinned binary hash is admitted", async () => {
    const wasm = await compileToWasm(HOST_FLOW);
    const { privateKeyPem } = generateRunnerKeypair();
    const att = signWasm(wasm, privateKeyPem);
    assert.equal(verifyWasm(wasm, att, { allowedHashes: [att.sha256] }).ok, true);
    assert.equal(verifyWasm(wasm, att, { allowedHashes: ["b".repeat(64)] }).ok, false);
  });

  it("REFUSES a binary that imports a DISALLOWED host function — fail-closed at link (#105)", async () => {
    // A correctly-signed module that nonetheless declares a host import the closed
    // host set does NOT provide. The signature gate passes; the closed-allowlist gate
    // must then fail CLOSED at instantiation — a CRITICAL_SECURITY_VIOLATION, not a raw LinkError.
    const forbiddenWat = `(module
      (import "host" "__forbidden_syscall" (func $f (param i32) (result i32)))
      (func (export "main") (result i32) (call $f (i32.const 1))))`;
    const asm = await assembleWAT(forbiddenWat);
    assert.equal(asm.valid, true, JSON.stringify(asm.diagnostics));

    const { publicKeyPem, privateKeyPem } = generateRunnerKeypair();
    const attestation = signWasm(asm.wasm, privateKeyPem, "dev"); // VALID signature

    let violated = null;
    await assert.rejects(
      () => admitAndInstantiate({
        wasm: asm.wasm, attestation, policy: { requireSigned: true, publicKeyPem },
        host: createHostRuntime(),
        observe: { onViolation: (reason) => { violated = reason; } },
      }),
      /CRITICAL_SECURITY_VIOLATION.*disallowed host import/,
    );
    assert.ok(violated, "onViolation fired for the disallowed-import binary");
    assert.match(violated, /disallowed host import/);
  });
});

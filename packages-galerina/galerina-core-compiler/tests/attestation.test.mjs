import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAttestation,
  signAttestation,
  verifyAttestation,
  generateAttestationKey,
  attestationToYaml,
  attestationFromJson,
} from "../dist/index.js";
import { parseProgram } from "../dist/index.js";

describe("Attestation — buildAttestation", () => {
  it("produces correct artifact and schemaVersion fields", async () => {
    const att = await buildAttestation({ flowName: "testFlow" });
    assert.equal(att.artifact, "galerina.audit.attestation");
    assert.equal(att.schemaVersion, "1.0");
  });

  it("includes the flow name", async () => {
    const att = await buildAttestation({ flowName: "myFlow" });
    assert.equal(att.flow, "myFlow");
  });

  it("produces an ISO timestamp", async () => {
    const att = await buildAttestation({ flowName: "f" });
    assert.ok(att.timestamp.length > 0);
    assert.ok(!isNaN(Date.parse(att.timestamp)));
  });

  it("with source text produces sha256 hash", async () => {
    const att = await buildAttestation({
      flowName: "f",
      sourceText: "pure flow f() -> Void { return }",
    });
    assert.ok(att.hashes.source !== undefined);
    assert.ok(att.hashes.source.startsWith("sha256:"));
    // hex part is 64 chars
    const hex = att.hashes.source.slice("sha256:".length);
    assert.equal(hex.length, 64);
    assert.ok(/^[0-9a-f]+$/.test(hex));
  });

  it("with no inputs produces empty hashes object", async () => {
    const att = await buildAttestation({ flowName: "f" });
    assert.deepEqual(att.hashes, {});
  });

  it("hash format is sha256:... (64 hex chars)", async () => {
    const att = await buildAttestation({
      flowName: "f",
      sourceText: "x",
      girJson: "{}",
      auditProofJson: "[]",
    });
    const hashPattern = /^sha256:[0-9a-f]{64}$/;
    assert.ok(hashPattern.test(att.hashes.source ?? ""));
    assert.ok(hashPattern.test(att.hashes.gir ?? ""));
    assert.ok(hashPattern.test(att.hashes.auditProof ?? ""));
  });

  it("has no signature field by default", async () => {
    const att = await buildAttestation({ flowName: "f" });
    assert.equal(att.signature, undefined);
  });
});

describe("Attestation — attestationToYaml", () => {
  it("returns a string containing the flow name", async () => {
    const att = await buildAttestation({ flowName: "importantFlow" });
    const yaml = attestationToYaml(att);
    assert.ok(typeof yaml === "string");
    assert.ok(yaml.includes("importantFlow"));
  });

  it("contains artifact field", async () => {
    const att = await buildAttestation({ flowName: "f" });
    const yaml = attestationToYaml(att);
    assert.ok(yaml.includes("galerina.audit.attestation"));
  });

  it("contains schemaVersion field", async () => {
    const att = await buildAttestation({ flowName: "f" });
    const yaml = attestationToYaml(att);
    assert.ok(yaml.includes("schemaVersion"));
  });
});

describe("Attestation — generateAttestationKey", () => {
  it("returns an object with keyId, privateKey, publicKey", () => {
    const kp = generateAttestationKey("test-key-1");
    assert.equal(kp.keyId, "test-key-1");
    assert.ok(typeof kp.privateKey === "string");
    assert.ok(typeof kp.publicKey === "string");
    assert.ok(kp.privateKey.includes("PRIVATE KEY"));
    assert.ok(kp.publicKey.includes("PUBLIC KEY"));
  });
});

describe("Attestation — sign and verify roundtrip", () => {
  it("signAttestation + verifyAttestation roundtrip returns true", async () => {
    const kp = generateAttestationKey("key-1");
    const att = await buildAttestation({
      flowName: "secureFlow",
      sourceText: "secure flow f(readonly request: Req) -> Resp { return Resp }",
    });
    const signed = signAttestation(att, kp);
    assert.ok(signed.signature !== undefined);
    assert.equal(signed.signature.algorithm, "Ed25519");
    assert.equal(signed.signature.keyId, "key-1");

    const ok = verifyAttestation(signed, kp.publicKey);
    assert.equal(ok, true);
  });

  it("verifyAttestation with tampered hash returns false", async () => {
    const kp = generateAttestationKey("key-2");
    const att = await buildAttestation({
      flowName: "flow",
      sourceText: "pure flow f() -> Void { return }",
    });
    const signed = signAttestation(att, kp);

    // Tamper: change the source hash
    const tampered = {
      ...signed,
      hashes: {
        ...signed.hashes,
        source: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      },
    };
    const ok = verifyAttestation(tampered, kp.publicKey);
    assert.equal(ok, false);
  });

  it("verifyAttestation with no signature returns false", async () => {
    const kp = generateAttestationKey("key-3");
    const att = await buildAttestation({ flowName: "f" });
    const ok = verifyAttestation(att, kp.publicKey);
    assert.equal(ok, false);
  });
});

describe("Attestation — attestationFromJson", () => {
  it("parses valid JSON attestation", async () => {
    const att = await buildAttestation({ flowName: "jsonFlow", sourceText: "x" });
    const json = JSON.stringify(att);
    const parsed = attestationFromJson(json);
    assert.equal(parsed.artifact, "galerina.audit.attestation");
    assert.equal(parsed.schemaVersion, "1.0");
    assert.equal(parsed.flow, "jsonFlow");
  });

  it("throws on invalid artifact field", () => {
    assert.throws(
      () => attestationFromJson(JSON.stringify({ artifact: "wrong", schemaVersion: "1.0" })),
      /invalid artifact/,
    );
  });

  it("throws on invalid schemaVersion", () => {
    assert.throws(
      () => attestationFromJson(JSON.stringify({ artifact: "galerina.audit.attestation", schemaVersion: "2.0" })),
      /unsupported schemaVersion/,
    );
  });
});

describe("Contract section parsing — Phase 10A additions", () => {
  it("parses contract with request block without errors", () => {
    const src = `
contract {
  request {
    accepts PatientRequest
  }
}
`.trim();
    // Wrap in a flow to make it a valid program
    const wrapped = `pure flow f() -> Void
${src}
{ return }`;
    const result = parseProgram(wrapped, "test.spore");
    // Should have zero parse errors
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    assert.equal(errors.length, 0, `Unexpected errors: ${errors.map((e) => e.message).join(", ")}`);
  });

  it("parses contract with response block", () => {
    const src = `pure flow f() -> Void
contract {
  response {
    returns PatientResponse
    exposes { id name }
    denies { password }
  }
}
{ return }`;
    const result = parseProgram(src, "test.spore");
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    assert.equal(errors.length, 0, `Unexpected errors: ${errors.map((e) => e.message).join(", ")}`);
  });

  it("parses contract with model block", () => {
    const src = `pure flow f() -> Void
contract {
  model {
    uses PatientRecord
    reads AuditLog
  }
}
{ return }`;
    const result = parseProgram(src, "test.spore");
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    assert.equal(errors.length, 0, `Unexpected errors: ${errors.map((e) => e.message).join(", ")}`);
  });

  it("parses contract with context block", () => {
    const src = `pure flow f() -> Void
contract {
  context {
    require userId
  }
}
{ return }`;
    const result = parseProgram(src, "test.spore");
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    assert.equal(errors.length, 0, `Unexpected errors: ${errors.map((e) => e.message).join(", ")}`);
  });

  it("parses contract with effects block (canonical form)", () => {
    // Using canonical form: contract { effects {} } (with effects [...] was removed)
    const src = `guarded flow f() -> Void
contract {
  effects {
    database.write
  }
}
{ return }`;
    const result = parseProgram(src, "test.spore");
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    assert.equal(errors.length, 0, `Unexpected errors: ${errors.map((e) => e.message).join(", ")}`);
  });

  it("accepts: node stored with correct value", () => {
    const src = `pure flow f() -> Void
contract {
  request {
    accepts PatientRequest
  }
}
{ return }`;
    const result = parseProgram(src, "test.spore");
    // Find contractDecl node
    const program = result.ast;
    const flowNode = program.children?.find((n) => n.kind === "pureFlowDecl");
    const contractNode = flowNode?.children?.find((n) => n.kind === "contractDecl");
    const requestBlock = contractNode?.children?.find((n) => n.kind === "identifier" && n.value === "request:block");
    assert.ok(requestBlock !== undefined, "request:block not found");
    const acceptsNode = requestBlock.children?.find((n) => n.kind === "identifier" && (n.value ?? "").startsWith("accepts:"));
    assert.ok(acceptsNode !== undefined, "accepts:TypeName node not found");
    assert.equal(acceptsNode.value, "accepts:PatientRequest");
  });
});

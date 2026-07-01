// FUNGI-SUBSTRATE-005 — the compute-only fence (Direction B / B0).
// A noisy/photonic lane is an untrusted Tier-3 compute accelerator (degrade-only): it may declare ONLY
// compute effects (+ audit telemetry); ANY network/persistence/secret/process/sensitive-data reach makes
// the untrusted lane a confused deputy into trusted resources and is denied (deny-by-default, fail-closed).
// crypto/hash/sign stays owned by B1/FUNGI-SUBSTRATE-001. A digital lane (or no substrate block) is inert.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseProgram, checkEffects, verifyGovernance } from "../dist/index.js";

function verify(source, profile = "production") {
  const parsed = parseProgram(source, "test.fungi");
  const effects = checkEffects(parsed.flows, parsed.ast);
  return verifyGovernance(parsed.ast, parsed.flows, effects, profile);
}
const has = (r, code) => r.diagnostics.some((d) => d.code === code);
const subCount = (r) => r.diagnostics.filter((d) => d.code.startsWith("FUNGI-SUBSTRATE-")).length;

const flow = (effects, lane = "photonic") => `
secure flow f(request: Request) -> Result<Response, ApiError>
contract {
  effects { ${effects} }
  substrate { lane: ${lane}  tolerance: 5e-3  redundancy: 3 }
}
{ return Ok(Response.ok({})) }
`;

describe("FUNGI-SUBSTRATE-005 — compute-only fence", () => {
  it("DENIES a network effect on a photonic lane", () => {
    assert.ok(has(verify(flow("network.outbound")), "FUNGI-SUBSTRATE-005"));
  });
  it("DENIES a persistence effect (database.write) on a photonic lane", () => {
    assert.ok(has(verify(flow("database.write")), "FUNGI-SUBSTRATE-005"));
  });
  it("DENIES a persistence effect (storage.read) on a noisy lane", () => {
    assert.ok(has(verify(flow("storage.read", "noisy")), "FUNGI-SUBSTRATE-005"));
  });
  it("DENIES a secret effect on a photonic lane", () => {
    assert.ok(has(verify(flow("secret.read")), "FUNGI-SUBSTRATE-005"));
  });
  it("DENIES process.spawn (exec) on a photonic lane", () => {
    assert.ok(has(verify(flow("process.spawn")), "FUNGI-SUBSTRATE-005"));
  });
  it("DENIES sensitive-data reach (pii.read) on a photonic lane — fail-closed allowlist", () => {
    assert.ok(has(verify(flow("pii.read")), "FUNGI-SUBSTRATE-005"));
  });

  it("ALLOWS a pure compute effect (compute.gpu) on a photonic lane", () => {
    assert.equal(subCount(verify(flow("compute.gpu"))), 0);
  });
  it("ALLOWS ai.inference (the workload the lane accelerates) on a photonic lane", () => {
    assert.equal(subCount(verify(flow("ai.inference"))), 0);
  });
  it("ALLOWS audit.write (the governance observability channel) on a photonic lane", () => {
    assert.equal(subCount(verify(flow("audit.write"))), 0);
  });

  it("crypto stays owned by B1/001, not 005 (early return — only 001 reported)", () => {
    const r = verify(flow("crypto.sign network.outbound"));
    assert.ok(has(r, "FUNGI-SUBSTRATE-001"), "crypto → 001");
    assert.ok(!has(r, "FUNGI-SUBSTRATE-005"), "001 early-returns; 005 not double-reported");
  });

  it("a DIGITAL lane is inert — a network effect is fine there (fence only applies to noisy lanes)", () => {
    assert.equal(subCount(verify(flow("network.outbound", "digital"))), 0);
  });
  it("no substrate block at all is inert — reach effects unaffected", () => {
    const r = verify(`
secure flow g(request: Request) -> Result<Response, ApiError>
contract { effects { network.outbound database.write } }
{ return Ok(Response.ok({})) }
`);
    assert.equal(subCount(r), 0);
  });
});

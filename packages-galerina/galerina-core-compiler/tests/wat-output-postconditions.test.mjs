/**
 * 0040 / #70 — WASM single-exit OUTPUT post-conditions (R&D 0040 follow-up, 2026-06-19).
 *
 * For a STRAIGHT-LINE flow (no nested/early returns) the WAT emitter now captures the tail value into
 * $galerina_result, gates each result-referencing `ensure` against it (fail-closed: a violation traps via
 * `unreachable`), then returns it — so output post-conditions are enforced on the WASM tier too, not just
 * the interpreter. A flow with a nested/early return still DECLINES to the governed interpreter.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as L from "../dist/index.js";

function compileWAT(src) {
  const p = L.parseProgram(src, "op.spore");
  const errs = p.diagnostics.filter((d) => d.severity === "error");
  assert.equal(errs.length, 0, "parse: " + errs.map((e) => e.message).join("; "));
  const fx = L.checkEffects(p.flows, p.ast);
  const { gir } = L.emitGIR(p.ast, p.flows, fx);
  return { wat: L.renderWAT(L.buildWATModuleFromGIR(gir, undefined, "op", p.ast, true)), prog: p };
}
async function run(src, flow, args = []) {
  const { wat } = compileWAT(src);
  const asm = await L.assembleWAT(wat);
  assert.ok(asm.valid && asm.diagnostics.length === 0, `assembles: ${JSON.stringify(asm.diagnostics)}\n${wat}`);
  const kp = L.generateRunnerKeypair();
  const att = L.signWasm(asm.wasm, kp.privateKeyPem, "dev");
  const { instance } = await L.admitAndInstantiate({ wasm: asm.wasm, attestation: att, policy: { requireSigned: true, publicKeyPem: kp.publicKeyPem }, host: L.createHostRuntime() });
  let trapped = false, val;
  try { val = instance.exports[flow](...args); } catch { trapped = true; }
  return { wat, val, trapped };
}

const CLAMP = `pure flow clamp(a: Int) -> Int
contract { effects {} invariant { ensure result <= 100; } }
{ return a }`;

describe("0040 WASM single-exit output post-conditions", () => {
  it("emits the single-exit $galerina_result capture + output post-gate", () => {
    const { wat } = compileWAT(CLAMP);
    assert.ok(wat.includes("$galerina_result"), `single-exit result local present:\n${wat}`);
    assert.ok(wat.includes("local.set $galerina_result"), "captures the tail value into $galerina_result");
    assert.ok(/post: ensure.*output/.test(wat), "emits the output post-condition gate");
  });

  it("a satisfying result RETURNS on the WASM tier", async () => {
    const { val, trapped } = await run(CLAMP, "clamp", [50]);
    assert.equal(trapped, false, "a satisfying result must not trap");
    assert.equal(val, 50);
  });

  it("a VIOLATING result TRAPS on the WASM tier (fail-closed — never escapes)", async () => {
    const { trapped } = await run(CLAMP, "clamp", [200]);
    assert.equal(trapped, true, "result > 100 must trap (unreachable), not return the violating value");
  });

  it("WASM ≡ interpreter on the boundary: both pass at 100, both trap at 101", async () => {
    const parsed = L.parseProgram(CLAMP, "c.spore");
    for (const [a, expectTrap] of [[0, false], [100, false], [101, true], [200, true]]) {
      const { val, trapped } = await run(CLAMP, "clamp", [a]);
      const ref = await L.executeFlow("clamp", new Map([["a", { __tag: "int", value: a }]]), parsed.ast, parsed.flows);
      const refTrap = ref.value.__tag === "runtimeError";
      assert.equal(trapped, expectTrap, `a=${a}: WASM trap=${trapped} expected ${expectTrap}`);
      assert.equal(trapped, refTrap, `a=${a}: WASM trap must match interpreter (${refTrap})`);
      if (!trapped) assert.equal(val, ref.value.value, `a=${a}: WASM value ${val} == interp ${ref.value.value}`);
    }
  });

  it("a flow with an EARLY return (guard pattern) DECLINES to the interpreter (no WASM single-exit)", () => {
    const guard = `pure flow g(a: Int) -> Int
contract { effects {} invariant { ensure result <= 100; } }
{ if a > 50 { return 0 } return a }`;
    const { wat } = compileWAT(guard);
    // emitWATFromFlowAST returns null for a nested-return post-condition flow → the function body is the
    // fail-closed "cannot lower → falls back to walker" stub, NOT a single-exit capture.
    assert.ok(!wat.includes("local.set $galerina_result"), `early-return flow must decline, not emit single-exit:\n${wat}`);
  });
});

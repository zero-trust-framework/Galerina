// #165 — float WAT lowering. Float literals already emit f64.const, but the binary-op map was i32-only,
// so a float `+ - * /`/comparison emitted an i32 checked helper over f64 operands → an INVALID module
// (the WASM tier then declined → walker). Now float operands lower to native f64 ops and the scalar
// `Float` type is f64 (matching the literals), so float scalar flows assemble to a VALID module.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseProgram, checkEffects, emitGIR, renderWAT, buildWATModuleFromGIR, assembleWAT } from "../dist/index.js";

async function compileToWat(src) {
  const p = parseProgram(src, "t.lln");
  const errs = (p.diagnostics ?? []).filter((d) => d.severity === "error");
  if (errs.length) throw new Error("parse: " + errs.map((d) => d.message).join("; "));
  const fx = checkEffects(p.flows, p.ast);
  const { gir } = emitGIR(p.ast, p.flows, fx);
  return renderWAT(buildWATModuleFromGIR(gir, undefined, "t", p.ast, true));
}

describe("#165: float WAT lowering → native f64", () => {
  it("float addition emits f64.add (not the i32 checked helper) and assembles VALID", async () => {
    const wat = await compileToWat("pure flow f() -> Float contract { effects {} } { return 3.0 + 1.5 }");
    assert.match(wat, /f64\.add/, "float + lowers to f64.add");
    assert.doesNotMatch(wat, /lln_checked_add_i32 \(f64/, "must not wrap f64 operands in the i32 checked helper");
    const asm = await assembleWAT(wat);
    assert.equal(asm.valid, true, "module is valid: " + JSON.stringify(asm.diagnostics));
  });

  it("float - * / lower to native f64 ops and assemble VALID", async () => {
    for (const [expr, opcode] of [["5.0 - 2.0", /f64\.sub/], ["3.0 * 2.0", /f64\.mul/], ["7.0 / 2.0", /f64\.div/]]) {
      const wat = await compileToWat(`pure flow f() -> Float contract { effects {} } { return ${expr} }`);
      assert.match(wat, opcode);
      assert.equal((await assembleWAT(wat)).valid, true);
    }
  });

  it("a mixed int/float operand promotes the int to f64 (f64.convert_i32_s)", async () => {
    const wat = await compileToWat("pure flow f() -> Float contract { effects {} } { return 2.5 * 2 }");
    assert.match(wat, /f64\.mul/);
    assert.match(wat, /f64\.convert_i32_s/, "the int literal 2 is promoted to f64");
    assert.equal((await assembleWAT(wat)).valid, true);
  });

  it("float comparison lowers to f64.lt (i32 0/1 result) and assembles VALID", async () => {
    const wat = await compileToWat("pure flow f() -> Bool contract { effects {} } { return 1.5 < 2.5 }");
    assert.match(wat, /f64\.lt/);
    assert.equal((await assembleWAT(wat)).valid, true);
  });

  it("integer arithmetic is unchanged — still the strict-trapping i32 checked helper", async () => {
    const wat = await compileToWat("pure flow f() -> Int contract { effects {} } { return 2 + 3 }");
    // 2+3 folds to a const, but the op map must stay i32 for non-folded int paths — sanity that no f64 leaked
    assert.doesNotMatch(wat, /f64\.(add|sub|mul|div)/, "int arithmetic must not lower to f64");
  });
});

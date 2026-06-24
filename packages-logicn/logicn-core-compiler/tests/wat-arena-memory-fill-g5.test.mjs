// G5 (Intrusion-Triggered Arena Fill) — part (a): the arena/secret zeroing now uses the WASM bulk-memory
// `memory.fill` primitive (one atomic instruction) in place of the per-i32 `i32.store` loop. This test
// proves (1) the emitted WAT carries `memory.fill` and NO longer an `i32.store`-counter zeroing loop,
// (2) the assembled binary actually contains the bulk-memory opcode 0xFC 0x0B, and (3) zeroing STILL
// happens — wide's secret @1028/1032 is cleared on the next leaf entry, while the identical non-secret
// module leaves it host-readable (so the fill is what clears it). Mirrors wat-arena-secret-zero-b2b.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../dist/index.js";

// wide allocates a 3-field secret record across [1024,1036); narrow's 1-field record folds to a value, so
// narrow's leaf entry reclaims (and, in a secret module, zero-fills) the whole of wide's region.
const mk = (privacy) => `record Wide { a: Int, b: Int, c: Int }
record Narrow { v: Int }
pure flow wide(s: Int) -> Int
contract { intent { "wide" }${privacy ? " privacy { contains PII }" : ""} }
{ let w: Wide = Wide { a: s, b: s, c: s } return w.a }
pure flow narrow(s: Int) -> Int
contract { intent { "narrow" }${privacy ? " privacy { contains PII }" : ""} }
{ let n: Narrow = Narrow { v: s } return n.v }
`;

async function build(src) {
  const prog = L.parseProgram(src, "g5.lln");
  const errs = (prog.diagnostics ?? []).filter((d) => d.severity === "error");
  assert.equal(errs.length, 0, `parse errors: ${errs.map((d) => d.message).join("; ")}`);
  const fx = L.checkEffects(prog.flows, prog.ast);
  const { gir } = L.emitGIR(prog.ast, prog.flows, fx);
  const wat = L.renderWAT(L.buildWATModuleFromGIR(gir, undefined, "wasm-standalone", prog.ast, true));
  const asm = await L.assembleWAT(wat);
  assert.ok(asm.valid && asm.diagnostics.length === 0,
    `must assemble faithfully: ${asm.diagnostics.map((d) => d.message).join("; ")}`);
  const { instance } = await WebAssembly.instantiate(asm.wasm);
  return { wat, wasm: asm.wasm, instance };
}

test("G5(a): a secret module's zeroing uses `memory.fill`, not an i32.store loop", async () => {
  const { wat } = await build(mk(true));
  assert.ok(wat.includes("memory.fill"), `the bulk-memory primitive must be emitted:\n${wat}`);
  // The retained marker tokens still flag a secret-zeroing module (back-compat with the b2b checks).
  assert.ok(wat.includes("$__lln_zl"), "the $__lln_zl secret-zeroing marker is retained");
  // The old per-i32 zeroing loop (a guarded i32.store over a counter local) is GONE.
  assert.ok(!/\(i32\.store \(local\.get \$__lln_zero_i\)/.test(wat),
    "the per-i32 store zeroing loop must be replaced by memory.fill");
  assert.ok(!wat.includes("$__lln_zero_i"), "the now-unused zeroing counter local must be dropped");
});

test("G5(a): the assembled binary contains the bulk-memory opcode 0xFC 0x0B (memory.fill)", async () => {
  const { wasm } = await build(mk(true));
  let found = false;
  for (let i = 0; i < wasm.length - 1; i++) {
    if (wasm[i] === 0xFC && wasm[i + 1] === 0x0B) { found = true; break; }
  }
  assert.ok(found, "memory.fill (0xFC 0x0B) must be present in the assembled WASM");
});

test("G5(a): zeroing STILL clears host-readable secret remanence (memory.fill ≡ the old loop)", async () => {
  const SECRET = 0xAA11;
  const sec = await build(mk(true));
  const sMem = new Int32Array(sec.instance.exports.memory.buffer);
  sec.instance.exports.wide(SECRET);   // writes the secret across [1024,1036)
  sec.instance.exports.narrow(0xBB22); // leaf entry → memory.fill zeroes wide's reclaimed region
  assert.equal(sMem[257], 0, "wide's secret @1028 must be ZEROED by memory.fill");
  assert.equal(sMem[258], 0, "wide's secret @1032 must be ZEROED by memory.fill");

  // Control: identical flows with NO privacy block → no fill → the secret persists in exported memory.
  const ctl = await build(mk(false));
  const cMem = new Int32Array(ctl.instance.exports.memory.buffer);
  ctl.instance.exports.wide(SECRET);
  ctl.instance.exports.narrow(0xBB22);
  assert.ok(cMem[257] === SECRET && cMem[258] === SECRET,
    "control: without the fill, wide's secret stays host-readable (proves the fill is what clears it)");
});

test("G5(a): a non-secret module emits NO memory.fill zeroing (it pays nothing)", async () => {
  const { wat } = await build(mk(false));
  assert.ok(!wat.includes("$__lln_zl"), "no privacy/secrets ⇒ no secret-zeroing marker");
  // A non-secret module still does the B2 per-flow heap REBASE (global.set $__lln_heap) but no fill.
  assert.ok(!/memory\.fill .*\$__lln_heap/.test(wat),
    "non-secret modules must not pay for a secret zero-fill");
});

test("G5(a): the secret module still executes correctly under memory.fill", async () => {
  const { instance } = await build(mk(true));
  let r = 0;
  for (let i = 0; i < 5000; i++) r = instance.exports.wide(i);
  assert.equal(r, 4999, "wide(4999) returns w.a = 4999 — the fill doesn't corrupt results");
});

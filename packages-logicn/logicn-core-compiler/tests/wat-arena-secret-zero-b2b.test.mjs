// B2b (R&D 0055) — secret-slot zeroing on the per-flow reset. The WASM module EXPORTS its linear memory,
// so a reclaimed-but-unzeroed arena from a secret-handling flow is HOST-READABLE remanence. When the module
// contains a flow with a `privacy {}` / `secrets {}` block, every leaf-entry reset first zeroes the
// reclaimed region [WAT_HEAP_BASE, prev-heap) before rebasing. Non-secret modules pay nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../dist/index.js";

// wide allocates a 3-field secret record; narrow's 1-field record folds away (n.v → s), so after
// wide→narrow the whole of wide's region is reclaimed and (in a secret module) zeroed.
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
  const prog = L.parseProgram(src, "b2b.lln");
  const errs = (prog.diagnostics ?? []).filter((d) => d.severity === "error");
  assert.equal(errs.length, 0, `parse errors: ${errs.map((d) => d.message).join("; ")}`);
  const fx = L.checkEffects(prog.flows, prog.ast);
  const { gir } = L.emitGIR(prog.ast, prog.flows, fx);
  const wat = L.renderWAT(L.buildWATModuleFromGIR(gir, undefined, "wasm-standalone", prog.ast, true));
  const asm = await L.assembleWAT(wat);
  assert.ok(asm.valid, `must assemble: ${asm.valid ? "" : asm.diagnostics.map((d) => d.message).join("; ")}`);
  const { instance } = await WebAssembly.instantiate(asm.wasm);
  return { wat, instance };
}

// AUDIT REGRESSION: the BODY-LESS `privacy` / `secrets` shorthand (no braces) parses to value "privacy:" /
// "secrets:" (no ":block" suffix). The emitter previously exact-matched "…:block" and so SILENTLY skipped
// B2b zeroing for the body-less form — a fail-open. flowHandlesSecrets now uses startsWith, catching both.
test("B2b (audit fix): a BODY-LESS privacy/secrets block also triggers the zeroing loop (no fail-open)", async () => {
  for (const block of ["privacy", "secrets"]) {
    const src = `record Wide { a: Int, b: Int, c: Int }
pure flow wide(s: Int) -> Int
contract { intent { "bodyless ${block}" } ${block} }
{ let w: Wide = Wide { a: s, b: s, c: s } return w.a }
`;
    const { wat } = await build(src);
    assert.ok(wat.includes("$__lln_zl"), `a body-less \`${block}\` must still emit the secret-zeroing loop (was a fail-open)`);
  }
});

test("B2b: a privacy-marked module emits the secret-zeroing loop; a plain module does NOT", async () => {
  const secret = await build(mk(true));
  const plain = await build(mk(false));
  assert.ok(secret.wat.includes("$__lln_zl"), "privacy/secrets ⇒ zeroing loop emitted");
  assert.ok(!plain.wat.includes("$__lln_zl"), "no privacy/secrets ⇒ no zeroing (non-secret modules pay nothing)");
});

test("B2b: zeroing clears HOST-READABLE secret remanence — A/B vs the identical non-secret module", async () => {
  const SECRET = 0xAA11;
  // Secret module: wide writes its secret across [1024,1036); narrow's entry zeroes that region.
  const sec = await build(mk(true));
  const sMem = new Int32Array(sec.instance.exports.memory.buffer);
  sec.instance.exports.wide(SECRET);
  sec.instance.exports.narrow(0xBB22);
  assert.equal(sMem[257], 0, "wide's secret @1028 must be ZEROED in a privacy module");
  assert.equal(sMem[258], 0, "wide's secret @1032 must be ZEROED in a privacy module");

  // Control: identical flows with NO privacy block → no zeroing → the secret PERSISTS in exported memory.
  const ctl = await build(mk(false));
  const cMem = new Int32Array(ctl.instance.exports.memory.buffer);
  ctl.instance.exports.wide(SECRET);
  ctl.instance.exports.narrow(0xBB22);
  assert.ok(cMem[257] === SECRET && cMem[258] === SECRET,
    "control: without B2b, wide's secret remains host-readable (proves B2b is what clears it)");
});

// B2b ZERO-ON-EXIT (owner-chosen): a secret leaf returning a non-heap PRIMITIVE i32 with no early `(return …)`
// destroys its secret records BEFORE returning — so even a ONE-SHOT/last call leaves no host-readable
// remanence. Early-return and heap-returning secret flows stay on the lazy on-entry path (pending #70).
test("B2b zero-on-exit: a ONE-SHOT primitive secret flow has its secret cleared AFTER return (no next call)", async () => {
  const src = `record Sec { a: Int, b: Int }
pure flow leak(s: Int) -> Int
contract { intent { "primitive secret return" } privacy { contains PII } }
{ let w: Sec = Sec { a: s, b: s } return w.a + w.b }
`;
  const { wat, instance } = await build(src);
  assert.ok(wat.includes("$__lln_xl"), "a primitive-returning secret leaf must emit the on-EXIT zeroing loop");
  const mem = new Int32Array(instance.exports.memory.buffer);
  const r = instance.exports.leak(0xBEEF);            // a SINGLE call
  assert.equal(r, 0xBEEF * 2, "the primitive result must be correct (captured before zeroing)");
  assert.equal(mem[256], 0, "the secret record must be ZEROED after the single call (no next-call needed)");
  assert.equal(mem[257], 0, "…all of it");
});

test("B2b zero-on-exit: an EARLY-return secret flow falls back to lazy (no on-exit zeroing) — correct, no bypass", async () => {
  const src = `record Sec { a: Int }
pure flow g(s: Int) -> Int
contract { intent { "early return" } privacy { contains PII } }
{ let w: Sec = Sec { a: s } if s > 10 { return 1 } return w.a }
`;
  const { wat } = await build(src);
  assert.ok(!wat.includes("$__lln_xl"), "an early-return flow must NOT zero-on-exit (a block-wrap can't catch (return …))");
});

test("B2b zero-on-exit: a HEAP-returning secret flow does NOT zero-on-exit (the return IS in the heap)", async () => {
  const src = `record Sec { a: Int }
pure flow h(s: Int) -> Sec
contract { intent { "heap return" } privacy { contains PII } }
{ return Sec { a: s } }
`;
  const { wat } = await build(src);
  assert.ok(!wat.includes("$__lln_xl"), "a record/heap return must stay on the lazy path (can't zero the returned object)");
});

test("B2b: the secret module still executes correctly under the zeroing loop", async () => {
  const { instance } = await build(mk(true));
  let r = 0;
  for (let i = 0; i < 30000; i++) r = instance.exports.wide(i);
  assert.equal(r, 29999, "wide(29999) returns w.a = 29999 — zeroing doesn't corrupt results");
});

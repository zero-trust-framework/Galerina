// B1 (R&D 0055) — contract.memory{arena} is wired into the emitted WASM module.
//
// Before: every module shipped DEFAULT_WAT_MEMORY (2048 pages / 128 MB) regardless of the declared arena
// — a fail-OPEN where the GOVERNED ceiling (8 MB) was not the ENFORCED ceiling (128 MB). Now the emitted
// (memory min max) reflects the contract; an undeclared flow keeps the default ceiling (fail-safe).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../dist/index.js";

function emitMemory(src) {
  const prog = L.parseProgram(src, "b1.lln");
  const errs = (prog.diagnostics ?? []).filter((d) => d.severity === "error");
  assert.equal(errs.length, 0, `parse errors: ${errs.map((d) => d.message).join("; ")}`);
  const fx = L.checkEffects(prog.flows, prog.ast);
  const { gir } = L.emitGIR(prog.ast, prog.flows, fx);
  const module = L.buildWATModuleFromGIR(gir, undefined, "wasm-standalone", prog.ast, true);
  return module.memory;
}

const WITH_ARENA = `pure flow tiny(n: Int) -> Int
contract {
  intent { "tight arena" }
  memory { arena 8mb }
}
{
  return n + 1
}
`;

const NO_ARENA = `pure flow tiny(n: Int) -> Int
contract {
  intent { "no arena declared" }
}
{
  return n + 1
}
`;

const HUGE_ARENA = `pure flow tiny(n: Int) -> Int
contract {
  intent { "over-ceiling arena clamps" }
  memory { arena 9999mb }
}
{
  return n + 1
}
`;

test("B1: a declared 8mb arena tightens the emitted module to 128 pages (was a hardcoded 2048)", () => {
  const mem = emitMemory(WITH_ARENA);
  assert.equal(mem.maxPages, 128, "8 MB × 16 pages/MB = 128 pages — the governed ceiling");
  // governed == ENFORCED: the arena is COMMITTED (minPages == maxPages). LogicN emits no memory.grow, so the
  // usable memory == the committed pages; committing the arena makes a store past the budget trap AT the
  // arena boundary, not at an unrelated 128 KB default min. (Audit fix — minPages was left at 2.)
  assert.equal(mem.minPages, 128, "the declared arena must be COMMITTED (minPages == maxPages) so it is the enforced runtime bound");
});

test("B1: an UNDECLARED arena keeps the default ceiling (2048) — default path byte-unchanged", () => {
  const mem = emitMemory(NO_ARENA);
  assert.equal(mem.maxPages, 2048, "no arena ⇒ the default 128 MB ceiling (cannot tighten below an unbounded flow)");
  assert.equal(mem.minPages, 2);
});

test("B1: an arena larger than the default ceiling clamps to 2048 (never widens past policy)", () => {
  const mem = emitMemory(HUGE_ARENA);
  assert.equal(mem.maxPages, 2048, "9999 MB clamps to the 128 MB policy ceiling — wiring tightens, never widens");
});

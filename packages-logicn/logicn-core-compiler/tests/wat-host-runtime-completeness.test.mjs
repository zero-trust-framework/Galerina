// Regression guard for the #169 class of bug: the emitter lowers a stdlib method to a `(import "host"
// "__x" …)` call, but the host runtime that instantiates the module does not PROVIDE `__x` — so the
// module fails at WebAssembly.instantiate (a missing import). The #185 oracle pins each host function's
// truth table; this complements it by asserting COMPLETENESS — every host import a real compiled module
// declares is actually provided by the canonical createHostRuntime. Derives the import set from the
// emitted WAT (no internal list needed), so it tracks the emitter automatically.
//
// Tri-Pipe verdict: Binary-only (host stdlib bridge; no Hybrid/Photonic facet).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../dist/index.js";

// A spread of pure flows exercising string + char + array + option methods that lower to host imports.
const SRC = `pure flow sw(s: String) -> Bool contract { effects {} } { return s.startsWith("x") }
pure flow ew(s: String) -> Bool contract { effects {} } { return s.endsWith("y") }
pure flow ix(s: String) -> Int contract { effects {} } { return s.indexOf("z") }
pure flow tr(s: String) -> String contract { effects {} } { return s.trim() }
pure flow sl(s: String) -> String contract { effects {} } { return s.slice(0, 2) }
pure flow cc(a: String, b: String) -> String contract { effects {} } { return a + b }
pure flow up(c: Char) -> Bool contract { effects {} } { return c.isUpper() }
pure flow lo(c: Char) -> Bool contract { effects {} } { return c.isLower() }
pure flow ws(c: Char) -> Bool contract { effects {} } { return c.isWhitespace() }
pure flow le(c: Char) -> Bool contract { effects {} } { return c.isLetter() }
pure flow di(c: Char) -> Bool contract { effects {} } { return c.isDigit() }
`;

test("createHostRuntime provides every host import the emitter declares for a multi-method module", () => {
  const prog = L.parseProgram(SRC, "completeness.lln");
  const errs = (prog.diagnostics ?? []).filter((d) => d.severity === "error");
  assert.equal(errs.length, 0, `parse errors: ${errs.map((d) => d.message).join("; ")}`);
  const fx = L.checkEffects(prog.flows, prog.ast);
  const { gir } = L.emitGIR(prog.ast, prog.flows, fx);
  const wat = L.renderWAT(L.buildWATModuleFromGIR(gir, undefined, "wasm-standalone", prog.ast, true));

  // The emitter tree-shakes imports, so the WAT declares exactly the host functions this module uses.
  const declared = [...wat.matchAll(/\(import\s+"host"\s+"(__[A-Za-z0-9_]+)"/g)].map((m) => m[1]);
  const uniq = [...new Set(declared)];
  assert.ok(uniq.length >= 6, `expected the spread of methods to declare several host imports; got ${uniq.length}: ${uniq.join(", ")}`);

  const host = L.createHostRuntime().imports.host;
  const missing = uniq.filter((name) => typeof host[name] !== "function");
  assert.deepEqual(missing, [], `createHostRuntime is missing host imports the emitter declares: ${missing.join(", ")} (add the impl to createHostRuntime — the #169 class of bug)`);
});

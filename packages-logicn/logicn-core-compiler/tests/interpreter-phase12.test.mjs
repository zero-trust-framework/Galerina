import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseProgram, checkTypes, resolveSymbols, executeFlow } from "../dist/index.js";

async function parseAndRun(source, flowName, args = new Map()) {
  const parsed = parseProgram(source, "test.lln");
  resolveSymbols(parsed.ast);
  checkTypes(parsed.ast);
  return await executeFlow(flowName, args, parsed.ast);
}

// ── Phase 11A.4 — Assignment (assignStmt) ────────────────────────────────────

describe("Interpreter - assignStmt (Phase 11A.4)", () => {
  it("assigns to a mut binding and returns updated value", async () => {
    const result = await parseAndRun(`
guarded flow test() -> Int {
  mut x = 0
  x = 5
  return x
}
`, "test");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 5);
  });

  it("assigns accumulated value through multiple reassignments", async () => {
    const result = await parseAndRun(`
guarded flow test() -> Int {
  mut x = 10
  x = 20
  x = 30
  return x
}
`, "test");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 30);
  });

  it("assigns expression result to a mut binding", async () => {
    const result = await parseAndRun(`
guarded flow test(a: Int, b: Int) -> Int {
  mut result = 0
  result = a + b
  return result
}
`, "test", new Map([
      ["a", { __tag: "int", value: 7 }],
      ["b", { __tag: "int", value: 3 }],
    ]));
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 10);
  });

  it("assignment to undeclared binding produces runtime diagnostic", async () => {
    const result = await parseAndRun(`
guarded flow test() -> Int {
  x = 5
  return 0
}
`, "test");
    const hasRuntimeDiag = result.diagnostics.some(
      (d) => d.code === "LLN-RUNTIME-004",
    );
    assert.ok(hasRuntimeDiag, "Expected LLN-RUNTIME-004 diagnostic for undeclared binding assignment");
  });
});

// ── Phase 12A — While loops ───────────────────────────────────────────────────

describe("Interpreter - whileStmt (Phase 12A)", () => {
  it("counts up with while loop", async () => {
    const result = await parseAndRun(`
guarded flow test() -> Int {
  mut i = 0
  while i < 3 {
    i = i + 1
  }
  return i
}
`, "test");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 3);
  });

  it("while loop that never executes leaves value unchanged", async () => {
    const result = await parseAndRun(`
guarded flow test() -> Int {
  mut x = 42
  while false {
    x = 0
  }
  return x
}
`, "test");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 42);
  });

  it("while loop accumulates a sum", async () => {
    const result = await parseAndRun(`
guarded flow test() -> Int {
  mut total = 0
  mut i = 1
  while i <= 5 {
    total = total + i
    i = i + 1
  }
  return total
}
`, "test");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 15);
  });

  it("while loop FAIL-CLOSED: a non-terminating loop TRAPS (does not truncate-and-succeed)", async () => {
    const result = await parseAndRun(`
guarded flow test() -> Int {
  mut i = 0
  while true {
    i = i + 1
  }
  return i
}
`, "test");
    // FAIL-CLOSED (2026-06-18, hazard fix): previously this hit the 100k cap, pushed LLN-RUNTIME-005,
    // BROKE, and returned SUCCESS with partial state (a fail-open bug). It now TRAPS at the cap and the
    // flow returns a runtimeError — a non-terminating loop must never be reported as a successful run.
    assert.equal(result.value.__tag, "runtimeError", "infinite loop must fail closed (runtimeError), not succeed");
    assert.ok(
      /Loop exceeded/.test(result.value.message ?? "") ||
        result.diagnostics.some((d) => d.code === "LLN-RUNTIME-003"),
      "fail-closed loop trap should surface 'Loop exceeded' / LLN-RUNTIME-003",
    );
  });
});

// ── Phase 12A — For-each loops ────────────────────────────────────────────────

describe("Interpreter - forEachStmt (Phase 12A)", () => {
  it("iterates over a list and counts iterations", async () => {
    const result = await parseAndRun(`
guarded flow test() -> Int {
  mut count = 0
  for item in [1, 2, 3] {
    count = count + 1
  }
  return count
}
`, "test");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 3);
  });

  it("for-each loop over empty list executes zero times", async () => {
    const result = await parseAndRun(`
guarded flow test() -> Int {
  mut x = 99
  for item in [] {
    x = 0
  }
  return x
}
`, "test");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 99);
  });

  it("for-each loop can access loop variable", async () => {
    const result = await parseAndRun(`
guarded flow test() -> Int {
  mut total = 0
  for n in [10, 20, 30] {
    total = total + n
  }
  return total
}
`, "test");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 60);
  });

  it("for-each loop over a variable holding a list", async () => {
    const result = await parseAndRun(`
guarded flow test() -> Int {
  let nums = [1, 2, 3, 4, 5]
  mut sum = 0
  for n in nums {
    sum = sum + n
  }
  return sum
}
`, "test");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 15);
  });
});

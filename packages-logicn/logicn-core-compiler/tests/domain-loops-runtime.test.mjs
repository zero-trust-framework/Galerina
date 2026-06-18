// =============================================================================
// Phase 12A — Loop and Runtime Execution Tests
//
// Covers:
//  1.  while loop: count up from 0 to 10
//  2.  while loop: accumulate sum of list
//  3.  while loop: string building (char by char)
//  4.  for item in list: iterate array
//  5.  for item in list: filter items
//  6.  for item in list: transform/map
//  7.  Nested while in for
//  8.  while with mut inside loop body
//  9.  Loop with break-via-condition (count guard)
//  10. Infinite loop guard: LLN-RUNTIME-005 at 100k iterations
//  11. Assignment expression: mut x = x + 1
//  12. Multiple mut reassignments in one flow
//  13. mut in while loop body
//  14. Real-world: character frequency counter using while + Map
//  15. Real-world: list reverse using while + mut
//  16. Real-world: find first matching item using while
//  17. Fibonacci using while loop
//  18. Loop with early return
// =============================================================================

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseProgram, resolveSymbols, checkTypes, executeFlow, run } from "../dist/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function parseAndRun(source, flowName, args = new Map()) {
  const parsed = parseProgram(source, "test.lln");
  resolveSymbols(parsed.ast);
  checkTypes(parsed.ast);
  return await executeFlow(flowName, args, parsed.ast);
}

async function runFull(source, flowName, args = new Map()) {
  return await run(source, "test.lln", flowName, args);
}

// ---------------------------------------------------------------------------
// Section 1: while loop — count up
// ---------------------------------------------------------------------------

describe("Phase 12A — while loop: count up", () => {
  it("counts from 0 to 10 (exactly 10 iterations)", async () => {
    const result = await parseAndRun(`
guarded flow countUp() -> Int {
  mut i = 0
  while i < 10 {
    i = i + 1
  }
  return i
}
`, "countUp");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 10);
  });

  it("count starts from 0 and terminates at exact boundary", async () => {
    const result = await parseAndRun(`
guarded flow countBoundary() -> Int {
  mut i = 0
  while i <= 10 {
    i = i + 1
  }
  return i
}
`, "countBoundary");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 11);
  });

  it("counts by 2 up to 10", async () => {
    const result = await parseAndRun(`
guarded flow countByTwo() -> Int {
  mut i = 0
  while i < 10 {
    i = i + 2
  }
  return i
}
`, "countByTwo");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 10);
  });

  it("while loop with false condition executes zero times", async () => {
    const result = await parseAndRun(`
guarded flow neverRuns() -> Int {
  mut x = 42
  while false {
    x = 0
  }
  return x
}
`, "neverRuns");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 42);
  });
});

// ---------------------------------------------------------------------------
// Section 2: while loop — accumulate sum of list
// ---------------------------------------------------------------------------

describe("Phase 12A — while loop: accumulate sum of list", () => {
  it("sums [1..5] using index while loop", async () => {
    const result = await parseAndRun(`
guarded flow sumList() -> Int {
  let nums = [1, 2, 3, 4, 5]
  mut total = 0
  mut i = 1
  while i <= 5 {
    total = total + i
    i = i + 1
  }
  return total
}
`, "sumList");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 15);
  });

  it("sums [1..10] equals 55", async () => {
    const result = await parseAndRun(`
guarded flow sumToTen() -> Int {
  mut total = 0
  mut i = 1
  while i <= 10 {
    total = total + i
    i = i + 1
  }
  return total
}
`, "sumToTen");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 55);
  });

  it("accumulates product using while loop", async () => {
    const result = await parseAndRun(`
guarded flow factorial() -> Int {
  mut result = 1
  mut i = 1
  while i <= 5 {
    result = result * i
    i = i + 1
  }
  return result
}
`, "factorial");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 120);
  });
});

// ---------------------------------------------------------------------------
// Section 3: while loop — string building
// ---------------------------------------------------------------------------

describe("Phase 12A — while loop: string building", () => {
  it("builds a string by repeating a char using a counter", async () => {
    const result = await parseAndRun(`
guarded flow buildString() -> String {
  mut s = ""
  mut i = 0
  while i < 5 {
    s = s + "x"
    i = i + 1
  }
  return s
}
`, "buildString");
    assert.equal(result.value.__tag, "string");
    assert.equal(result.value.value, "xxxxx");
  });

  it("builds a numeric string representation via while loop", async () => {
    const result = await parseAndRun(`
guarded flow buildNums() -> String {
  mut s = ""
  mut i = 1
  while i <= 3 {
    s = s + "a"
    i = i + 1
  }
  return s
}
`, "buildNums");
    assert.equal(result.value.__tag, "string");
    assert.equal(result.value.value, "aaa");
  });

  it("appends separator between items using while loop", async () => {
    const result = await parseAndRun(`
guarded flow buildWithSep() -> String {
  mut out = "start"
  mut i = 0
  while i < 3 {
    out = out + "-"
    i = i + 1
  }
  return out
}
`, "buildWithSep");
    assert.equal(result.value.__tag, "string");
    assert.equal(result.value.value, "start---");
  });
});

// ---------------------------------------------------------------------------
// Section 4: for item in list — iterate array
// ---------------------------------------------------------------------------

describe("Phase 12A — for item in list: iterate array", () => {
  it("iterates over [1,2,3] and counts 3 iterations", async () => {
    const result = await parseAndRun(`
guarded flow countItems() -> Int {
  mut count = 0
  for item in [1, 2, 3] {
    count = count + 1
  }
  return count
}
`, "countItems");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 3);
  });

  it("iterates over empty list and executes zero times", async () => {
    const result = await parseAndRun(`
guarded flow countEmpty() -> Int {
  mut count = 99
  for item in [] {
    count = 0
  }
  return count
}
`, "countEmpty");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 99);
  });

  it("accesses loop variable in each iteration", async () => {
    const result = await parseAndRun(`
guarded flow sumArray() -> Int {
  mut total = 0
  for n in [10, 20, 30] {
    total = total + n
  }
  return total
}
`, "sumArray");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 60);
  });

  it("iterates over a let-bound list variable", async () => {
    const result = await parseAndRun(`
guarded flow sumBound() -> Int {
  let nums = [5, 10, 15]
  mut total = 0
  for n in nums {
    total = total + n
  }
  return total
}
`, "sumBound");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 30);
  });

  it("iterates over a string list and counts items", async () => {
    const result = await parseAndRun(`
guarded flow countWords() -> Int {
  mut count = 0
  for word in ["hello", "world", "foo"] {
    count = count + 1
  }
  return count
}
`, "countWords");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 3);
  });
});

// ---------------------------------------------------------------------------
// Section 5: for item in list — filter items
// ---------------------------------------------------------------------------

describe("Phase 12A — for item in list: filter items", () => {
  it("counts only even numbers from a list", async () => {
    const result = await parseAndRun(`
guarded flow countEvens() -> Int {
  mut count = 0
  for n in [1, 2, 3, 4, 5, 6] {
    if n == 2 {
      count = count + 1
    }
    if n == 4 {
      count = count + 1
    }
    if n == 6 {
      count = count + 1
    }
  }
  return count
}
`, "countEvens");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 3);
  });

  it("sums only values greater than 3", async () => {
    const result = await parseAndRun(`
guarded flow sumBigOnes() -> Int {
  mut total = 0
  for n in [1, 2, 3, 4, 5] {
    if n > 3 {
      total = total + n
    }
  }
  return total
}
`, "sumBigOnes");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 9);
  });

  it("filter produces correct count when all pass predicate", async () => {
    const result = await parseAndRun(`
guarded flow allPass() -> Int {
  mut count = 0
  for n in [5, 10, 15, 20] {
    if n > 0 {
      count = count + 1
    }
  }
  return count
}
`, "allPass");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 4);
  });

  it("filter produces zero count when nothing passes predicate", async () => {
    const result = await parseAndRun(`
guarded flow nonePass() -> Int {
  mut count = 0
  for n in [1, 2, 3] {
    if n > 100 {
      count = count + 1
    }
  }
  return count
}
`, "nonePass");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 0);
  });
});

// ---------------------------------------------------------------------------
// Section 6: for item in list — transform/map
// ---------------------------------------------------------------------------

describe("Phase 12A — for item in list: transform/map", () => {
  it("doubles each element by accumulating doubled values", async () => {
    const result = await parseAndRun(`
guarded flow doubleSum() -> Int {
  mut total = 0
  for n in [1, 2, 3] {
    total = total + n + n
  }
  return total
}
`, "doubleSum");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 12);
  });

  it("transforms strings by counting total characters", async () => {
    const result = await parseAndRun(`
guarded flow totalChars() -> Int {
  mut total = 0
  for word in ["hi", "bye", "ok"] {
    total = total + 1
  }
  return total
}
`, "totalChars");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 3);
  });

  it("squares values and accumulates sum (1+4+9=14)", async () => {
    const result = await parseAndRun(`
guarded flow sumSquares() -> Int {
  mut total = 0
  for n in [1, 2, 3] {
    total = total + n * n
  }
  return total
}
`, "sumSquares");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 14);
  });
});

// ---------------------------------------------------------------------------
// Section 7: Nested while in for
// ---------------------------------------------------------------------------

describe("Phase 12A — nested while in for", () => {
  it("for loop with nested while increments inner counter each outer iteration", async () => {
    const result = await parseAndRun(`
guarded flow nestedLoops() -> Int {
  mut total = 0
  for item in [1, 2, 3] {
    mut j = 0
    while j < 2 {
      total = total + 1
      j = j + 1
    }
  }
  return total
}
`, "nestedLoops");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 6);
  });

  it("nested while accumulates item*2 for each for-item", async () => {
    const result = await parseAndRun(`
guarded flow nestedAccum() -> Int {
  mut total = 0
  for n in [1, 2, 3] {
    mut i = 0
    while i < n {
      total = total + 1
      i = i + 1
    }
  }
  return total
}
`, "nestedAccum");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 6);
  });
});

// ---------------------------------------------------------------------------
// Section 8: while with mut inside loop body
// ---------------------------------------------------------------------------

describe("Phase 12A — while with mut inside loop body", () => {
  it("mut declared inside while body is local to each iteration", async () => {
    const result = await parseAndRun(`
guarded flow mutInLoop() -> Int {
  mut total = 0
  mut i = 0
  while i < 3 {
    mut local = i * 2
    total = total + local
    i = i + 1
  }
  return total
}
`, "mutInLoop");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 6);
  });

  it("reassigns outer mut from within while body", async () => {
    const result = await parseAndRun(`
guarded flow outerMutInLoop() -> Int {
  mut acc = 0
  mut i = 0
  while i < 5 {
    acc = acc + i
    i = i + 1
  }
  return acc
}
`, "outerMutInLoop");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 10);
  });
});

// ---------------------------------------------------------------------------
// Section 9: Loop with break-via-condition (count guard)
// ---------------------------------------------------------------------------

describe("Phase 12A — loop with break-via-condition", () => {
  it("loop uses conditional to stop incrementing after threshold", async () => {
    const result = await parseAndRun(`
guarded flow guardedCount() -> Int {
  mut i = 0
  mut running = true
  while running {
    i = i + 1
    if i >= 5 {
      running = false
    }
  }
  return i
}
`, "guardedCount");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 5);
  });

  it("loop stops when sentinel changes to false", async () => {
    const result = await parseAndRun(`
guarded flow sentinelLoop() -> Int {
  mut count = 0
  mut keepGoing = true
  while keepGoing {
    count = count + 1
    if count == 3 {
      keepGoing = false
    }
  }
  return count
}
`, "sentinelLoop");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 3);
  });

  it("max-10 guard: loop stops at 10 via conditional", async () => {
    const result = await parseAndRun(`
guarded flow max10Guard() -> Int {
  mut n = 0
  mut go = true
  while go {
    n = n + 1
    if n >= 10 {
      go = false
    }
  }
  return n
}
`, "max10Guard");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 10);
  });
});

// ---------------------------------------------------------------------------
// Section 10: Infinite loop guard — LLN-RUNTIME-005 at 100k iterations
// ---------------------------------------------------------------------------

describe("Phase 12A — infinite loop guard (LLN-RUNTIME-005)", () => {
  it("while true emits LLN-RUNTIME-005 diagnostic", async () => {
    const result = await parseAndRun(`
guarded flow infiniteTrue() -> Int {
  mut i = 0
  while true {
    i = i + 1
  }
  return i
}
`, "infiniteTrue");
    // FAIL-CLOSED (2026-06-18, hazard fix): an infinite loop now TRAPS — it does not truncate-and-succeed.
    assert.equal(result.value.__tag, "runtimeError", "infinite while true must fail closed (runtimeError)");
    assert.ok(
      /Loop exceeded/.test(result.value.message ?? "") || result.diagnostics.some((d) => d.code === "LLN-RUNTIME-003"),
      "fail-closed loop trap should surface 'Loop exceeded' / LLN-RUNTIME-003",
    );
  });

  it("while true TRAPS fail-closed at the iteration cap", async () => {
    const result = await parseAndRun(`
guarded flow infiniteCount() -> Int {
  mut i = 0
  while true {
    i = i + 1
  }
  return i
}
`, "infiniteCount");
    // FAIL-CLOSED (2026-06-18, hazard fix): was "truncate at 100k + return a partial int (success)".
    assert.equal(result.value.__tag, "runtimeError", "infinite loop must fail closed, not return a partial int");
    assert.ok(/Loop exceeded/.test(result.value.message ?? ""), "fail-closed loop trap message");
  });

  it("infinite loop FAILS CLOSED via the run() pipeline as well", async () => {
    const result = await runFull(`
guarded flow infiniteLoop() -> Int {
  mut x = 0
  while true {
    x = x + 1
  }
  return x
}
`, "infiniteLoop");
    // FAIL-CLOSED (2026-06-18, hazard fix): the run() pipeline also TRAPS, not emits-005-and-succeeds.
    assert.equal(result.value.__tag, "runtimeError", "run() pipeline infinite loop must fail closed");
    assert.ok(
      /Loop exceeded/.test(result.value.message ?? "") || result.diagnostics.some((d) => d.code === "LLN-RUNTIME-003"),
      "fail-closed loop trap via run()",
    );
  });

  it("non-infinite loop with 99999 iterations does NOT emit LLN-RUNTIME-005", async () => {
    const result = await parseAndRun(`
guarded flow nearLimit() -> Int {
  mut i = 0
  while i < 1000 {
    i = i + 1
  }
  return i
}
`, "nearLimit");
    const has005 = result.diagnostics.some((d) => d.code === "LLN-RUNTIME-005");
    assert.ok(!has005, "Well-bounded loop should not emit LLN-RUNTIME-005");
    assert.equal(result.value.value, 1000);
  });
});

// ---------------------------------------------------------------------------
// Section 11: Assignment expression: mut x = x + 1
// ---------------------------------------------------------------------------

describe("Phase 12A — assignment expression: mut x = x + 1", () => {
  it("increments mut binding by self-reference", async () => {
    const result = await parseAndRun(`
guarded flow selfIncrement() -> Int {
  mut x = 0
  x = x + 1
  x = x + 1
  x = x + 1
  return x
}
`, "selfIncrement");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 3);
  });

  it("self-reference accumulates product", async () => {
    const result = await parseAndRun(`
guarded flow selfProduct() -> Int {
  mut x = 2
  x = x * 2
  x = x * 2
  return x
}
`, "selfProduct");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 8);
  });

  it("mut string binding builds upon itself", async () => {
    const result = await parseAndRun(`
guarded flow stringSelf() -> String {
  mut s = "hello"
  s = s + " world"
  return s
}
`, "stringSelf");
    assert.equal(result.value.__tag, "string");
    assert.equal(result.value.value, "hello world");
  });
});

// ---------------------------------------------------------------------------
// Section 12: Multiple mut reassignments in one flow
// ---------------------------------------------------------------------------

describe("Phase 12A — multiple mut reassignments in one flow", () => {
  it("two independent mut bindings can be reassigned without conflict", async () => {
    const result = await parseAndRun(`
guarded flow twoMuts() -> Int {
  mut a = 1
  mut b = 10
  a = a + 1
  b = b + 1
  a = a + b
  return a
}
`, "twoMuts");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 13);
  });

  it("reassigning three muts in sequence produces correct final values", async () => {
    const result = await parseAndRun(`
guarded flow threeMuts() -> Int {
  mut x = 1
  mut y = 2
  mut z = 3
  x = x + y
  y = y + z
  z = x + y
  return z
}
`, "threeMuts");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 8);
  });

  it("multiple reassignments of same binding collapse to last value", async () => {
    const result = await parseAndRun(`
guarded flow collapseReassign() -> Int {
  mut x = 0
  x = 1
  x = 2
  x = 3
  x = 4
  x = 5
  return x
}
`, "collapseReassign");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 5);
  });
});

// ---------------------------------------------------------------------------
// Section 13: mut in while loop body
// ---------------------------------------------------------------------------

describe("Phase 12A — mut in while loop body", () => {
  it("outer mut is updated through each while iteration correctly", async () => {
    const result = await parseAndRun(`
guarded flow outerMutWhile() -> Int {
  mut sum = 0
  mut i = 0
  while i < 4 {
    sum = sum + i
    i = i + 1
  }
  return sum
}
`, "outerMutWhile");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 6);
  });

  it("mut string builds inside while loop body", async () => {
    const result = await parseAndRun(`
guarded flow buildInWhile() -> String {
  mut s = ""
  mut i = 0
  while i < 4 {
    s = s + "o"
    i = i + 1
  }
  return s
}
`, "buildInWhile");
    assert.equal(result.value.__tag, "string");
    assert.equal(result.value.value, "oooo");
  });

  it("two muts updated inside while — counter and accumulator", async () => {
    const result = await parseAndRun(`
guarded flow dualMutWhile() -> Int {
  mut counter = 0
  mut acc = 100
  while counter < 5 {
    acc = acc - 10
    counter = counter + 1
  }
  return acc
}
`, "dualMutWhile");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 50);
  });
});

// ---------------------------------------------------------------------------
// Section 14: Real-world — character frequency counter using while + Map
// ---------------------------------------------------------------------------

describe("Phase 12A — real-world: character frequency counter", () => {
  it("counts occurrences of a specific char in a list using while", async () => {
    const result = await parseAndRun(`
guarded flow charFreq() -> Int {
  let chars = ["a", "b", "a", "c", "a", "b"]
  mut countA = 0
  for ch in chars {
    if ch == "a" {
      countA = countA + 1
    }
  }
  return countA
}
`, "charFreq");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 3);
  });

  it("counts two different chars independently using for loop", async () => {
    const result = await parseAndRun(`
guarded flow twoCharFreq() -> Int {
  let chars = ["x", "y", "x", "x", "y"]
  mut cx = 0
  mut cy = 0
  for ch in chars {
    if ch == "x" {
      cx = cx + 1
    }
    if ch == "y" {
      cy = cy + 1
    }
  }
  return cx + cy
}
`, "twoCharFreq");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 5);
  });

  it("builds frequency map using Map.empty and while-style counting", async () => {
    const result = await parseAndRun(`
guarded flow freqMapSize() -> Int {
  let m = Map.empty()
  let m2 = m.set("a", 3)
  let m3 = m2.set("b", 2)
  return m3.size()
}
`, "freqMapSize");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 2);
  });

  it("Map.empty with set and get round-trips a frequency value", async () => {
    const result = await parseAndRun(`
guarded flow freqMapGet() -> Int {
  let m = Map.empty()
  let m2 = m.set("hello", 7)
  let got = m2.get("hello")
  if got == None {
    return 0
  }
  return 7
}
`, "freqMapGet");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 7);
  });
});

// ---------------------------------------------------------------------------
// Section 15: Real-world — list reverse using while + mut
// ---------------------------------------------------------------------------

describe("Phase 12A — real-world: list reverse using while + mut", () => {
  it("reverses a list by building a new accumulator via for loop", async () => {
    const result = await parseAndRun(`
guarded flow reverseCount() -> Int {
  let original = [1, 2, 3, 4, 5]
  mut count = 0
  for item in original {
    count = count + 1
  }
  return count
}
`, "reverseCount");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 5);
  });

  it("last element of original is tracked via while position tracking", async () => {
    const result = await parseAndRun(`
guarded flow trackLast() -> Int {
  mut last = 0
  mut i = 1
  while i <= 7 {
    last = i
    i = i + 1
  }
  return last
}
`, "trackLast");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 7);
  });

  it("accumulates items in descending order using index tracking", async () => {
    const result = await parseAndRun(`
guarded flow descendingSum() -> Int {
  mut total = 0
  mut i = 5
  while i > 0 {
    total = total + i
    i = i - 1
  }
  return total
}
`, "descendingSum");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 15);
  });
});

// ---------------------------------------------------------------------------
// Section 16: Real-world — find first matching item using while
// ---------------------------------------------------------------------------

describe("Phase 12A — real-world: find first matching item using while", () => {
  it("finds the first value greater than 3 in a sequence", async () => {
    const result = await parseAndRun(`
guarded flow findFirstBig() -> Int {
  mut found = 0
  mut searching = true
  mut i = 1
  while i <= 5 {
    if searching {
      if i > 3 {
        found = i
        searching = false
      }
    }
    i = i + 1
  }
  return found
}
`, "findFirstBig");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 4);
  });

  it("finds first even number in for loop using sentinel flag", async () => {
    const result = await parseAndRun(`
guarded flow findFirstEven() -> Int {
  mut result = 0
  mut found = false
  for n in [1, 3, 4, 6, 7] {
    if found == false {
      if n == 4 {
        result = n
        found = true
      }
    }
  }
  return result
}
`, "findFirstEven");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 4);
  });

  it("returns 0 when no matching element exists", async () => {
    const result = await parseAndRun(`
guarded flow findNone() -> Int {
  mut result = 0
  for n in [1, 3, 5] {
    if n == 2 {
      result = n
    }
  }
  return result
}
`, "findNone");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 0);
  });
});

// ---------------------------------------------------------------------------
// Section 17: Fibonacci using while loop
// ---------------------------------------------------------------------------

describe("Phase 12A — real-world: Fibonacci using while loop", () => {
  it("fib(0) = 0", async () => {
    const result = await parseAndRun(`
guarded flow fib0() -> Int {
  mut a = 0
  mut b = 1
  mut i = 0
  while i < 0 {
    mut tmp = a + b
    a = b
    b = tmp
    i = i + 1
  }
  return a
}
`, "fib0");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 0);
  });

  it("fib(5) = 5 using while loop", async () => {
    const result = await parseAndRun(`
guarded flow fib5() -> Int {
  mut a = 0
  mut b = 1
  mut i = 0
  while i < 5 {
    mut tmp = a + b
    a = b
    b = tmp
    i = i + 1
  }
  return a
}
`, "fib5");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 5);
  });

  it("fib(10) = 55 using while loop", async () => {
    const result = await parseAndRun(`
guarded flow fib10() -> Int {
  mut a = 0
  mut b = 1
  mut i = 0
  while i < 10 {
    mut tmp = a + b
    a = b
    b = tmp
    i = i + 1
  }
  return a
}
`, "fib10");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 55);
  });

  it("fib(7) = 13 using while loop", async () => {
    const result = await parseAndRun(`
guarded flow fib7() -> Int {
  mut a = 0
  mut b = 1
  mut i = 0
  while i < 7 {
    mut tmp = a + b
    a = b
    b = tmp
    i = i + 1
  }
  return a
}
`, "fib7");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 13);
  });
});

// ---------------------------------------------------------------------------
// Section 18: Loop with early return
//
// return statements inside while/for loop bodies propagate as flow-level
// early returns. executeBlock returns the value when a returnStmt is hit,
// and the whileStmt/forEachStmt handlers propagate it upward so the enclosing
// flow exits immediately.
// ---------------------------------------------------------------------------

describe("Phase 12A — loop with early return", () => {
  it("return at flow level after while loop completes is reached", async () => {
    const result = await parseAndRun(`
guarded flow returnAfterLoop() -> Int {
  mut i = 0
  while i < 5 {
    i = i + 1
  }
  return i
}
`, "returnAfterLoop");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 5);
  });

  it("direct return from inside for loop body exits early", async () => {
    const result = await parseAndRun(`
guarded flow directForReturn() -> Int {
  for n in [1, 2, 3, 4, 5] {
    if n == 3 {
      return n
    }
  }
  return 0
}
`, "directForReturn");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 3);
  });

  it("early return from nested while loops propagates correctly", async () => {
    const result = await parseAndRun(`
guarded flow nestedReturn() -> Int {
  mut total = 0
  mut i = 0
  while i < 3 {
    mut j = 0
    while j < 3 {
      total = total + 1
      j = j + 1
    }
    i = i + 1
  }
  return total
}
`, "nestedReturn");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 9);
  });

  it("direct return from inside while loop body exits early", async () => {
    const result = await parseAndRun(`
guarded flow directWhileReturn() -> Int {
  mut i = 1
  while i <= 10 {
    if i == 5 {
      return i
    }
    i = i + 1
  }
  return 0
}
`, "directWhileReturn");
    assert.equal(result.value.__tag, "int");
    assert.equal(result.value.value, 5);
  });

  it("return inside for loop skips remaining iterations and flow-level fallback", async () => {
    const result = await parseAndRun(`
guarded flow forEarlyExit() -> String {
  for word in ["alpha", "beta", "gamma"] {
    if word == "beta" {
      return word
    }
  }
  return "not_found"
}
`, "forEarlyExit");
    assert.equal(result.value.__tag, "string");
    assert.equal(result.value.value, "beta");
  });
});

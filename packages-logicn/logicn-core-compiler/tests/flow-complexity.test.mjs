// =============================================================================
// Cyclomatic complexity — //@COMPLEXITY (R&D 0045)
// complexity = 1 + decision points (if / while / for-each / match arm / && / ||); silent if trivial.
// =============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseProgram, cyclomaticComplexity, renderComplexityComment } from "../dist/index.js";

function flowNode(src) {
  const p = parseProgram(src, "cx.lln");
  const errs = p.diagnostics.filter((d) => d.severity === "error");
  assert.equal(errs.length, 0, "parse: " + errs.map((e) => e.message).join("; "));
  const FK = new Set(["pureFlowDecl", "flowDecl", "secureFlowDecl", "guardedFlowDecl"]);
  return (p.ast.children ?? []).find((c) => FK.has(c.kind));
}

describe("cyclomatic complexity", () => {
  it("a straight-line flow has complexity 1", () => {
    assert.equal(cyclomaticComplexity(flowNode("pure flow f(x: Int) -> Int { return x }")), 1);
  });

  it("each if/else adds a decision point", () => {
    const c = cyclomaticComplexity(flowNode(
      "pure flow f(x: Int) -> Int { if x > 0 { return 1 } return 0 }",
    ));
    assert.equal(c, 2, "one if → complexity 2");
  });

  it("a short-circuit && / || each add a decision point", () => {
    const c = cyclomaticComplexity(flowNode(
      "pure flow f(x: Int) -> Int { if x > 0 && x < 10 { return 1 } return 0 }",
    ));
    assert.equal(c, 3, "one if + one && → complexity 3");
  });

  it("a while loop adds a decision point", () => {
    const c = cyclomaticComplexity(flowNode(
      "pure flow f(n: Int) -> Int { mut i: Int = 0  while i < n { i = i + 1 } return i }",
    ));
    assert.equal(c, 2, "one while → complexity 2");
  });
});

describe("renderComplexityComment — silent when trivial", () => {
  it("emits nothing for a complexity-1 flow (low-noise rule)", () => {
    assert.deepEqual(renderComplexityComment(flowNode("pure flow f(x: Int) -> Int { return x }")), []);
  });

  it("emits //@COMPLEXITY for a branchy flow", () => {
    const lines = renderComplexityComment(flowNode(
      "pure flow f(x: Int) -> Int { if x > 0 { return 1 } return 0 }",
    ));
    assert.deepEqual(lines, ["//@COMPLEXITY: 2"]);
  });
});

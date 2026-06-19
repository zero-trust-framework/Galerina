// =============================================================================
// Cyclomatic complexity — the //@COMPLEXITY metric (R&D 0045)
//
// A whole-graph "hidden physics" metric a human cannot track by eye: how branchy a flow is.
// complexity = 1 + (decision points), where a decision point is an if / while / for-each / each
// match arm / a short-circuit `&&` or `||`. This is the generated-tier metric behind //@COMPLEXITY;
// per the owner's rule it is SILENT when trivial (complexity 1 — a straight-line, no-branch flow).
// =============================================================================

import type { AstNode } from "./parser.js";

/**
 * Cyclomatic complexity of a flow (or any AST subtree): 1 + the number of branch decision points.
 * Counts: ifStmt, whileStmt, forEachStmt, each matchArm, and short-circuit && / || operators.
 */
export function cyclomaticComplexity(node: AstNode): number {
  let decisions = 0;
  function walk(n: AstNode): void {
    switch (n.kind) {
      case "ifStmt":
      case "whileStmt":
      case "forEachStmt":
      case "matchArm":
        decisions += 1;
        break;
      case "binaryExpr": {
        const op = n.value ?? "";
        if (op === "&&" || op === "||") decisions += 1;
        break;
      }
      default:
        break;
    }
    for (const c of n.children ?? []) walk(c);
  }
  walk(node);
  return 1 + decisions;
}

/**
 * Render the `//@COMPLEXITY` line for a flow — SILENT (returns []) when trivial (complexity 1), per the
 * owner's low-noise rule. A short qualifier hints at the dominant branch source when the count is high.
 */
export function renderComplexityComment(node: AstNode): string[] {
  const c = cyclomaticComplexity(node);
  if (c <= 1) return []; // trivial straight-line flow — stay silent (no clutter)
  const qualifier = c >= 10 ? " (high — consider decomposing)" : "";
  return [`//@COMPLEXITY: ${c}${qualifier}`];
}

#!/usr/bin/env node
/**
 * cli.ts — logicn package-graph
 *
 * Usage:
 *   node dist/cli.js --scope <package-path>          scan + write .graph/ outputs
 *   node dist/cli.js --scope <package-path> --check  enforce the boundary policy (CI gate)
 *
 * Writes into <scope>/.graph/:
 *   package-graph.json · BOUNDARY.md · boundary-policy.json
 *
 * Exit codes:
 *   0  PASS or BASELINE_CREATED
 *   1  FAIL (boundary violation under --check)
 *   2  usage / scope error
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { scanPackage } from "./scanner.js";
import { buildGraph } from "./graph.js";
import { writeJson, writeBoundaryMarkdown, runBoundaryGate } from "./reporter.js";

function main(): void {
  const argv = process.argv.slice(2);
  const scopeIdx = argv.indexOf("--scope");
  const check = argv.includes("--check");

  if (scopeIdx < 0 || !argv[scopeIdx + 1]) {
    console.error("Usage: logicn package-graph --scope <package-path> [--check]");
    process.exit(2);
  }

  const scopePath = resolve(argv[scopeIdx + 1]!);
  if (!existsSync(scopePath)) {
    console.error(`Scope path not found: ${scopePath}`);
    process.exit(2);
  }

  const scan = scanPackage(scopePath);
  const graph = buildGraph(scan);
  const gate = runBoundaryGate(scopePath, graph, check);
  const jsonPath = writeJson(scopePath, graph);
  const mdPath = writeBoundaryMarkdown(scopePath, graph, gate);

  // ── Console summary ────────────────────────────────────────────────────────
  console.log(`\n  Package Boundary — ${graph.packageName}`);
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  Scanned roots:      ${graph.scannedRoots.join(", ") || "(none present)"} ` +
    `[${graph.scannedExtensions.join(", ")}]`);
  console.log(`  Files:              ${graph.stats.fileCount}`);
  if (graph.stats.fileCount === 0) {
    console.log(`  ⚠ zero files scanned — empty border means NOTHING was inspected, not "no deps".`);
  }
  console.log(`  Internal edges:     ${graph.stats.internalEdgeCount}`);
  console.log(`  External deps:      ${graph.stats.externalDepCount} ` +
    `(node:${graph.stats.nodeCoreCount} · @logicn:${graph.stats.workspaceCount} · 3rd-party:${graph.stats.thirdpartyCount})`);
  console.log(`  Orphan files:       ${graph.stats.orphanCount}`);

  if (graph.stats.thirdpartyCount > 0) {
    const tp = graph.externalDeps.filter((d) => d.kind === "thirdparty").map((d) => d.specifier);
    console.log(`  Third-party:        ${tp.join(", ")}`);
  }
  if (graph.orphans.length > 0) {
    console.log(`  ⚠ orphans:          ${graph.orphans.join(", ")}`);
  }

  const badge =
    gate.status === "PASS" ? "✅ PASS"
    : gate.status === "BASELINE_CREATED" ? "🆕 BASELINE CREATED"
    : "❌ FAIL";
  console.log(`\n  Boundary gate:      ${badge}`);
  if (gate.violations.length > 0) {
    for (const v of gate.violations) console.log(`     ❌ unlisted external dependency: ${v}`);
  }
  console.log(`\n  Written: ${jsonPath}`);
  console.log(`           ${mdPath}\n`);

  if (check && gate.status === "FAIL") process.exit(1);
  process.exit(0);
}

main();

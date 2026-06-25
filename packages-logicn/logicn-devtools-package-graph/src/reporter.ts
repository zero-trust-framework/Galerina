/**
 * reporter.ts — render the boundary graph + run the Hardened Border gate
 *
 * Outputs (written into the target package's .graph/ directory so dependency
 * changes appear in PR diffs):
 *   .graph/package-graph.json      — machine-readable nodes/edges/external surface
 *   .graph/BOUNDARY.md             — human-readable boundary report
 *   .graph/boundary-policy.json    — allowlist baseline for the --check gate
 *
 * The --check gate:
 *   - If no policy file exists, the current external surface is recorded as the
 *     baseline (first run establishes the Hardened Border) and the run PASSES.
 *   - If a policy exists, any external dependency NOT in the allowlist is a
 *     governance VIOLATION → the run FAILS (exit 1). This mirrors the
 *     governance:diff change-class gate, at the package-boundary level.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PackageGraph } from "./graph.js";

export interface BoundaryPolicy {
  readonly packageName: string;
  readonly allowedExternal: readonly string[]; // specifiers permitted across the border
  readonly note?: string;
}

export interface CheckResult {
  readonly status: "PASS" | "FAIL" | "BASELINE_CREATED";
  readonly violations: readonly string[]; // external deps not in the allowlist
  readonly orphanWarnings: readonly string[];
}

const GRAPH_DIR = ".graph";

function graphDir(scopePath: string): string {
  return join(scopePath, GRAPH_DIR);
}

export function writeJson(scopePath: string, graph: PackageGraph): string {
  const dir = graphDir(scopePath);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "package-graph.json");
  writeFileSync(path, JSON.stringify(graph, null, 2));
  return path;
}

/**
 * Run the boundary gate. With `check=false` it always reports PASS/BASELINE and
 * (re)writes the policy baseline. With `check=true` it enforces an existing policy.
 */
export function runBoundaryGate(scopePath: string, graph: PackageGraph, check: boolean): CheckResult {
  const dir = graphDir(scopePath);
  mkdirSync(dir, { recursive: true });
  const policyPath = join(dir, "boundary-policy.json");
  const currentExternal = graph.externalDeps.map((d) => d.specifier).sort();

  const orphanWarnings = graph.orphans.map((o) => `orphan: ${o} (no inbound internal import)`);

  if (!existsSync(policyPath)) {
    // FAIL-CLOSED on a MISSING policy under --check (delete-to-launder defence). If --check re-baselined a
    // missing policy, an attacker (or an accidental delete) could remove boundary-policy.json and the next
    // enforcing run would silently re-bless EVERY current import as the new allowlist — laundering drift into
    // a green baseline. So a missing policy under --check is a VIOLATION; only the non-enforcing
    // (generate/init) mode establishes the baseline.
    if (check) {
      return {
        status: "FAIL",
        violations: ["boundary-policy.json is missing — cannot enforce the Hardened Border under --check " +
                     "(run the generator without --check to establish a baseline)"],
        orphanWarnings,
      };
    }
    // First run / generate mode — establish the baseline (the Hardened Border).
    const policy: BoundaryPolicy = {
      packageName: graph.packageName,
      allowedExternal: currentExternal,
      note: "Baseline auto-generated. Edit allowedExternal to widen/narrow the border. " +
            "`--check` fails if an import appears that is not listed here.",
    };
    writeFileSync(policyPath, JSON.stringify(policy, null, 2));
    return { status: "BASELINE_CREATED", violations: [], orphanWarnings };
  }

  // Enforce existing policy.
  let policy: BoundaryPolicy;
  try {
    policy = JSON.parse(readFileSync(policyPath, "utf-8"));
  } catch {
    return { status: "FAIL", violations: ["boundary-policy.json is unreadable/corrupt"], orphanWarnings };
  }
  // A present-but-malformed allowlist is unknown → DENY (not allow-all). If `allowedExternal` is not a
  // string array, the allowlist is untrustworthy, so under --check fail-closed rather than letting
  // `new Set(<non-array>)` silently admit (or mis-admit) the current surface (0116 hardening).
  if (!Array.isArray(policy.allowedExternal) || !policy.allowedExternal.every((s) => typeof s === "string")) {
    return { status: "FAIL", violations: ["boundary-policy.json: allowedExternal is missing or malformed — refusing to enforce a non-array allowlist (unknown → deny)"], orphanWarnings };
  }
  const allowed = new Set(policy.allowedExternal);
  const violations = currentExternal.filter((spec) => !allowed.has(spec));

  if (check && violations.length > 0) {
    return { status: "FAIL", violations, orphanWarnings };
  }
  return { status: violations.length > 0 ? "FAIL" : "PASS", violations, orphanWarnings };
}

export function writeBoundaryMarkdown(
  scopePath: string,
  graph: PackageGraph,
  check: CheckResult,
): string {
  const dir = graphDir(scopePath);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "BOUNDARY.md");

  const group = (kind: string) => graph.externalDeps.filter((d) => d.kind === kind);
  const fmtDeps = (deps: ReturnType<typeof group>) =>
    deps.length === 0 ? "_none_" : deps.map((d) => `- \`${d.specifier}\``).join("\n");

  const statusBadge =
    check.status === "PASS" ? "✅ PASS"
    : check.status === "BASELINE_CREATED" ? "🆕 BASELINE CREATED"
    : "❌ FAIL";

  // A zero-file scan is the silent failure this report exists to prevent: a green
  // border over an UNSCANNED package. Make it loud rather than letting PASS imply coverage.
  const zeroFileNote = graph.stats.fileCount === 0
    ? `\n> ⚠️ **Zero source files scanned.** The roots/extensions below matched nothing — this ` +
      `border is empty because nothing was inspected, NOT because the package has no dependencies. ` +
      `Check the package's source layout against \`packageGraph.roots\`/\`extensions\` in its package.json.\n`
    : "";

  const md = `# Package Boundary Report: ${graph.packageName}

> Auto-generated by \`@logicn/devtools-package-graph\`. Commit this file — changes
> to the external boundary will appear in the PR diff (the Hardened Border).

**Status:** ${statusBadge}
${zeroFileNote}
**Scanned scope:** roots [${graph.scannedRoots.map((r) => `\`${r}\``).join(", ") || "_none present_"}] · extensions [${graph.scannedExtensions.map((e) => `\`${e}\``).join(", ")}]

## Summary

| Metric | Count |
|---|---|
| Files | ${graph.stats.fileCount} |
| Internal edges | ${graph.stats.internalEdgeCount} |
| External dependencies | ${graph.stats.externalDepCount} |
| ├─ Node core | ${graph.stats.nodeCoreCount} |
| ├─ Workspace (@logicn/*) | ${graph.stats.workspaceCount} |
| └─ Third-party | ${graph.stats.thirdpartyCount} |
| Orphan files | ${graph.stats.orphanCount} |

## External Dependencies (the Border)

### Node core
${fmtDeps(group("node_core"))}

### Workspace (@logicn/*)
${fmtDeps(group("workspace"))}

### Third-party
${fmtDeps(group("thirdparty"))}

## Governance${check.violations.length > 0 ? " — VIOLATIONS" : ""}
${check.violations.length === 0
  ? "No boundary violations. All external imports are within the allowlist."
  : check.violations.map((v) => `- ❌ Unlisted external dependency: \`${v}\``).join("\n")}

## Orphaned Files
${graph.orphans.length === 0
  ? "_none_ — every file is reachable from an internal import or entry point."
  : graph.orphans.map((o) => `- \`${o}\``).join("\n")}

## Entry Points
${graph.entryPoints.map((e) => `- \`${e}\``).join("\n") || "_none detected_"}
`;

  writeFileSync(path, md);
  return path;
}

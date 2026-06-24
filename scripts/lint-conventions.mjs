#!/usr/bin/env node
// lint-conventions.mjs — TASK-ENV-001: the umbrella convention linter (owner 2026-06-22, STRICT).
//
// PRINCIPLE: no convention is "binding" until a TOOL enforces it (else it's advisory and rots).
// This is the single gate that runs every registered convention check, aggregates the result, and
// exits with the total violation count — so a pre-commit hook / CI / run-phase-close can gate on it.
// New enforcers (TASK-SEC-002 mutation gate, TASK-DOC-004 doc↔source drift, #218 coverage cross-check)
// REGISTER here as they land — one place to see "are all conventions green?".
//
// Each check is a child script whose EXIT CODE = its violation count (0 = clean). Run from repo root.
//
// Flags:
//   --soft   always exit 0 (report-only) — for wiring into run-phase-close before the baseline hits 0.
//   --json   emit machine-readable JSON (for #218 coverage cross-check to consume).
import { spawnSync } from "node:child_process";

const CHECKS = [
  {
    name: "diagnostic-codes",
    script: "scripts/audit-diagnostic-codes.mjs",
    desc: "LLN-*/ERR_* code conventions (V1 overload · V2 collision · V3 sev-vocab · V4 multi-sev · V5 name-case)",
  },
  {
    name: "doc-drift",
    script: "scripts/audit-doc-drift.mjs",
    desc: "DOC-004: doc 'living metrics' (global test/package COUNTS) vs the version.json authority — v1 heuristic (living docs only; #150 auto-count is the real remedy)",
  },
  {
    name: "provenance",
    script: "scripts/audit-provenance.mjs",
    desc: "BLD-003 (folds #216): generated artifacts (code-index/code-registry/kb-index) must carry a provenance sidecar + be fresh vs sources (MISSING/UNSTAMPED/STALE)",
  },
  {
    name: "mutation",
    script: "scripts/audit-mutation.mjs",
    desc: "SEC-002: re-introduce each fail-closed gate's hole + assert its test catches it (Stryker-style; would have caught the B5a fail-open)",
    heavy: true, // rebuilds + runs tests per mutant (~40s) — only with --full (CI/security tier), skipped in the fast phase-close sweep
  },
  {
    name: "lln-quality",
    script: "scripts/lint-lln.mjs",
    desc: "owner .lln rules (2026-06-23): every flow has a human comment (rule 1) + a contract{intent} declaring clauses EXCEPT auto-settings (rule 2), and no AI slop / bad syntax (rule 3). Production src only — fixtures/examples/benchmarks whitelisted in governance/lln-lint-allow.json. Baseline > 0 (report-only until the self-hosted/.lln corpus is retrofitted).",
  },
  {
    name: "tier-boundary",
    script: "scripts/audit-tier-boundary.mjs",
    desc: "0056-ci-lint: open-core contamination guard — no NON-Apache license declaration in the package tree (PD-spec↛Apache) + no core→enterprise import (governance/tier-manifest.json, inert until /enterprise exists). Zero-baseline; also runs ENFORCING in conventions.yml.",
  },
  {
    name: "diagnostic-doc-drift",
    script: "scripts/audit-diagnostic-doc-drift.mjs",
    desc: "RD-0124: the canonical diagnostic doc (compiler-diagnostics.md) must not misdescribe a wired code — for any LLN-* with a structured name/message in source AND a doc description, the two must share ≥1 meaningful word (zero-overlap = drift). Caught the LLN-RUNTIME-006 'Audit event stream write failed' (really RateLimitExceeded) bug + 14 more. Zero-baseline; also runs ENFORCING in conventions.yml.",
  },
  {
    name: "graph-integrity",
    script: "scripts/audit-graph-integrity.mjs",
    desc: "RD-0121: structural validation of a GENERATED project graph — no dangling edge (from/to ref a real node), no duplicate node id, no stale sourcePath (node→nonexistent file), and the depends_on subgraph is a DAG (no cycle). Validate-IF-PRESENT: skips when build/graph/*.json (a ~3MB gitignored artifact) is absent, validates fail-closed when present. The detectors' --self-test runs ENFORCING in conventions.yml (build-free, anti-neuter).",
  },
  // #218 (coverage cross-check) runs separately as `audit-coverage.mjs`.
];

const soft = process.argv.includes("--soft");
const asJson = process.argv.includes("--json");
const full = process.argv.includes("--full"); // include heavy checks (mutation); default = fast tier only

const rows = [];
let total = 0;
let toolErrors = 0;
let skippedHeavy = 0;
for (const c of CHECKS) {
  if (c.heavy && !full) { skippedHeavy++; rows.push({ name: c.name, desc: c.desc, skipped: true }); continue; }
  const r = spawnSync(process.execPath, [c.script], { encoding: "utf8" });
  const stdout = r.stdout || "";
  // Each check MUST print a machine-readable `VIOLATIONS: N` line. Parse THAT, not the raw exit code —
  // so a child that crashes (uncaught → exit 1) or is killed by a signal (status null) is a TOOL ERROR,
  // not silently folded in as "1 violation" making the gate look almost-green.
  const vm = stdout.match(/^VIOLATIONS:\s*(\d+)\s*$/m);
  if (r.error || r.status === null || !vm) {
    toolErrors++;
    const why = r.error?.message || (r.status === null ? "killed by signal" : "no VIOLATIONS line (check crashed?)");
    rows.push({ name: c.name, desc: c.desc, error: true, why: why.split(/\r?\n/)[0], stderr: (r.stderr || "").split(/\r?\n/)[0] });
    continue;
  }
  const violations = Number(vm[1]);
  total += violations;
  const totalLine = stdout.split(/\r?\n/).filter((l) => /TOTAL/i.test(l)).pop()?.trim() ?? "";
  rows.push({ name: c.name, desc: c.desc, violations, totalLine });
}

if (asJson) {
  console.log(JSON.stringify({ total, toolErrors, skippedHeavy, checks: rows }, null, 2));
} else {
  const out = ["# LogicN convention lint (TASK-ENV-001)\n"];
  for (const row of rows) {
    if (row.skipped) { out.push(`⊘ ${row.name} — SKIPPED (heavy; pass --full to run)`); out.push(`    ${row.desc}`); continue; }
    if (row.error) { out.push(`⚠ ${row.name} — TOOL ERROR: ${row.why}${row.stderr ? " — " + row.stderr : ""}`); continue; }
    out.push(`${row.violations === 0 ? "✓" : "✗"} ${row.name} — ${row.violations} violation(s)`);
    out.push(`    ${row.desc}`);
    if (row.totalLine) out.push(`    ${row.totalLine}`);
  }
  const ran = CHECKS.length - toolErrors - skippedHeavy;
  out.push(`\nTOTAL: ${total} violation(s) across ${ran} ran check(s)` + (skippedHeavy ? `  ·  ⊘ ${skippedHeavy} heavy skipped (--full)` : "") + (toolErrors ? `  ·  ⚠ ${toolErrors} TOOL ERROR(s)` : ""));
  out.push(
    toolErrors > 0
      ? "GATE INCONCLUSIVE — a check failed to run (fix the tool error)."
      : total === 0
        ? "CONVENTIONS GREEN ✓"
        : `CONVENTIONS HAVE VIOLATIONS — a strict gate would FAIL${soft ? " (running --soft: reported, not enforced)" : ""}.`,
  );
  console.log(out.join("\n"));
}

// exit: tool error → distinct sentinel (255) so CI sees "broken gate" not "0/N violations"; else violation count.
process.exit(soft ? 0 : (toolErrors > 0 ? 255 : Math.min(total, 250)));

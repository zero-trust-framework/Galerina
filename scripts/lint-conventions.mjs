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
  // TASK-SEC-002 (mutation/red-team per gate), TASK-DOC-004 (doc↔source drift), and #218 (coverage
  // cross-check) register additional check scripts here as they are built.
];

const soft = process.argv.includes("--soft");
const asJson = process.argv.includes("--json");

const rows = [];
let total = 0;
for (const c of CHECKS) {
  const r = spawnSync(process.execPath, [c.script], { encoding: "utf8" });
  const violations = typeof r.status === "number" ? r.status : 1; // null status (signal) = treat as error
  const totalLine =
    (r.stdout || "").split(/\r?\n/).filter((l) => /TOTAL/i.test(l)).pop()?.trim() ?? "";
  total += violations;
  rows.push({ name: c.name, desc: c.desc, violations, totalLine, stderr: (r.stderr || "").split(/\r?\n/)[0] });
}

if (asJson) {
  console.log(JSON.stringify({ total, checks: rows }, null, 2));
} else {
  const out = ["# LogicN convention lint (TASK-ENV-001)\n"];
  for (const row of rows) {
    out.push(`${row.violations === 0 ? "✓" : "✗"} ${row.name} — ${row.violations} violation(s)`);
    out.push(`    ${row.desc}`);
    if (row.totalLine) out.push(`    ${row.totalLine}`);
    if (row.violations !== 0 && row.stderr) out.push(`    stderr: ${row.stderr}`);
  }
  out.push(`\nTOTAL: ${total} violation(s) across ${CHECKS.length} registered check(s)`);
  out.push(
    total === 0
      ? "CONVENTIONS GREEN ✓"
      : `CONVENTIONS HAVE VIOLATIONS — a strict gate would FAIL${soft ? " (running --soft: reported, not enforced)" : ""}.`,
  );
  console.log(out.join("\n"));
}

process.exit(soft ? 0 : Math.min(total, 250));

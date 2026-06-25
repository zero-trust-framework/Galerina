#!/usr/bin/env node
// audit-web-stub-guard.mjs — RD-0100 web-* fail-closed contract enforcer.
//
// The 6 logicn-web-* packages are deny-by-default BY DESIGN, but every README states that rule in
// PROSE only — it fails OPEN the moment an implementation lands (CWE-79 XSS, CWE-601 open-redirect,
// CWE-501 trust-boundary, CWE-862 missing-authz). This guard makes "born fail-closed" mechanical:
//
//   • A STUB package (no src/ and no dist/) is inert — it cannot fail open. PASS (contract pending).
//   • An IMPLEMENTED package (has src/ or dist/) MUST also ship a committed fail-closed acceptance test
//     (a file matching /(failclosed|acceptance)\.test\./i under the package) exercising its LLN-WEB-*
//     invariants. An impl WITHOUT that test is a VIOLATION — you cannot ship a web-* impl that hasn't
//     proven its unknown->DENY behaviour. The RD-0100 rule "do NOT promote to BUILD without committing
//     the acceptance tests" is thus enforced, not advisory.
//   • A web-* package on disk that is NOT in the contract is ungoverned — VIOLATION (manifest must be
//     complete). A contract package missing on disk is drift — VIOLATION.
//
// Zero-baseline today: all 6 are stubs, so 0 violations. The guard goes ENFORCING in CI, so the first
// PR that adds a web-* implementation is forced to add the acceptance tests in the SAME change.
//
// Build-free (reads the filesystem + the JSON contract directly). Pattern mirrors audit-production-
// blockers / audit-name-collisions: pure detectors + --self-test + `VIOLATIONS: N` + exit = count.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_PATH = join(ROOT, "governance", "web-failclosed-contract.json");
const PKG_ROOT = join(ROOT, "packages-logicn");
const ACCEPTANCE_RE = /(failclosed|acceptance)\.test\./i;

// ── Pure core: classify a package from its probed state (unit-testable, no FS) ─────────────────────
export function classifyPackage(pkgName, { exists, hasImpl, hasAcceptanceTest }) {
  if (!exists) {
    return { pkg: pkgName, status: "MISSING", violation: true,
      reason: "governed by the web fail-closed contract but absent on disk (contract drift)" };
  }
  if (!hasImpl) {
    return { pkg: pkgName, status: "STUB", violation: false,
      reason: "inert (no src/ or dist/) — fail-closed contract pending until impl lands" };
  }
  if (!hasAcceptanceTest) {
    return { pkg: pkgName, status: "IMPL_NO_TESTS", violation: true,
      reason: "implementation present (src/ or dist/) but NO fail-closed acceptance test (/(failclosed|acceptance).test./) " +
              "— a web-* impl must be born fail-closed; commit the LLN-WEB-* acceptance tests from governance/web-failclosed-contract.json in the same change" };
  }
  return { pkg: pkgName, status: "IMPL_GUARDED", violation: false,
    reason: "implementation + fail-closed acceptance test both present" };
}

// ── FS probe ───────────────────────────────────────────────────────────────────────────────────────
function findAcceptanceTest(dir, depth = 0) {
  if (depth > 4 || !existsSync(dir)) return false;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const full = join(dir, e.name);
    if (e.isFile() && ACCEPTANCE_RE.test(e.name)) return true;
    if (e.isDirectory() && findAcceptanceTest(full, depth + 1)) return true;
  }
  return false;
}

function probe(pkgDir) {
  if (!existsSync(pkgDir)) return { exists: false, hasImpl: false, hasAcceptanceTest: false };
  const hasImpl = existsSync(join(pkgDir, "src")) || existsSync(join(pkgDir, "dist"));
  return { exists: true, hasImpl, hasAcceptanceTest: findAcceptanceTest(pkgDir) };
}

// ── Scan: contract packages + any rogue on-disk web-* not in the contract ─────────────────────────
export function scan() {
  const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8"));
  const governed = Object.keys(contract.packages ?? {});
  const results = [];
  for (const pkg of governed) {
    results.push(classifyPackage(pkg, probe(join(PKG_ROOT, pkg))));
  }
  // Any logicn-web* directory on disk that the contract does not govern is a coverage hole.
  let onDisk = [];
  try {
    onDisk = readdirSync(PKG_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^logicn-web(\b|-|$)/.test(e.name))
      .map((e) => e.name);
  } catch { /* PKG_ROOT missing → no rogue scan */ }
  for (const name of onDisk) {
    if (!governed.includes(name)) {
      results.push({ pkg: name, status: "UNGOVERNED", violation: true,
        reason: "a logicn-web-* package exists on disk but is NOT in governance/web-failclosed-contract.json (add it + its LLN-WEB-* invariants)" });
    }
  }
  return results;
}

// ── Self-test: prove the detectors fire AND stay targeted (a neutered guard is itself a fail-open) ──
function selfTest() {
  const checks = [
    ["stub passes", classifyPackage("p", { exists: true, hasImpl: false, hasAcceptanceTest: false }).violation === false],
    ["impl without tests FIRES", classifyPackage("p", { exists: true, hasImpl: true, hasAcceptanceTest: false }).violation === true],
    ["impl with tests passes", classifyPackage("p", { exists: true, hasImpl: true, hasAcceptanceTest: true }).violation === false],
    ["missing package FIRES", classifyPackage("p", { exists: false, hasImpl: false, hasAcceptanceTest: false }).violation === true],
  ];
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`[self-test] ${ok ? "ok" : "FAIL"} — ${name}`);
  if (failed.length > 0) { console.log("[self-test] FAIL — a detector is neutered"); process.exit(1); }
  console.log("[self-test] PASS — stub inert, impl-without-tests + missing both fire, impl+tests passes");
}

function main() {
  if (process.argv.includes("--self-test")) { selfTest(); return; }
  const results = scan();
  const violations = results.filter((r) => r.violation);
  for (const r of results) {
    const mark = r.violation ? "✗" : "✓";
    console.log(`${mark} ${r.pkg} [${r.status}] — ${r.reason}`);
  }
  console.log(`\nVIOLATIONS: ${violations.length}`);
  console.log(`TOTAL: ${violations.length} web fail-closed contract violation(s) across ${results.length} governed/on-disk package(s)`);
  process.exit(Math.min(violations.length, 250));
}

// Import-safe: only run when executed directly (not when imported by a test).
if (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}

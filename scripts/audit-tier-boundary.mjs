#!/usr/bin/env node
// audit-tier-boundary.mjs — TASK 0056-ci-lint: cross-tier contamination guard (open-core "B7" lint).
//
// Zero-baseline invariant (GREEN today, a tripwire for the future — like secret-scan / no-NUL):
//
//  (1) LICENSE CONTAMINATION (enforced TODAY, PD-spec↛Apache). The repo ships under Apache-2.0.
//      No source file in the package tree may declare a NON-Apache license in its header
//      (Business Source License / BUSL / PolyForm / a non-Apache SPDX id) — that would leak
//      incompatible terms into the Apache-licensed core. This catches the contamination the
//      MOMENT a BSL/proprietary file is dropped into the open tree, before it can ride into a release.
//
//  (2) CORE → ENTERPRISE IMPORT (ready, inert until an /enterprise tier exists, core↛enterprise).
//      A `core`-tier package must not import from an `enterprise`-tier package (Apache core must not
//      take a build dependency on BSL code). Tiers are declared in governance/tier-manifest.json
//      (default = core). There is no enterprise package today, so this rule reports 0 — but it is
//      WIRED so the boundary becomes enforceable the instant the first enterprise package lands.
//
// Exit code = total violation count (0 = clean). Run from repo root.
//   node scripts/audit-tier-boundary.mjs            → lint the tree, exit = #violations
//   node scripts/audit-tier-boundary.mjs --self-test → prove BOTH detectors fire on synthetic
//                                                       contamination (catches a neutered lint), exit 0/1
//
// Allow-list: governance/tier-lint-allow.json { "files": ["<repo-rel path>", ...] } for vetted exceptions.

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const SCAN_ROOT = "packages-logicn";              // the package tree (scripts/ + root are tooling, Apache)
const SCAN_EXT = /\.(ts|mts|cts|mjs|cjs|js)$/;     // source files
const SKIP = /(^|\/)(node_modules|dist|build|\.graph|coverage)\//;
const HEADER_LINES = 30;                           // license headers live at the top

// ── pure detectors (also exercised by --self-test) ───────────────────────────────────────────────
const NON_APACHE_LICENSE = [
  { re: /Business Source License|BUSL-1|\bBSL-1\.\d/i, name: "Business Source License" },
  { re: /PolyForm\s+(Noncommercial|Perimeter|Shield|Strict|Internal-Use)/i, name: "PolyForm" },
  { re: /SPDX-License-Identifier:\s*(?!Apache-2\.0\b)([A-Za-z0-9.\-+]+)/i, name: "non-Apache SPDX id" },
];

/** Returns a contamination reason for a file HEADER, or null if it's clean (Apache / no declaration). */
export function detectLicenseContamination(headerText) {
  for (const { re, name } of NON_APACHE_LICENSE) {
    const m = headerText.match(re);
    if (m) {
      // For the SPDX rule, surface the offending id; otherwise the license name.
      const id = name === "non-Apache SPDX id" && m[1] ? ` (${m[1]})` : "";
      return `${name}${id}`;
    }
  }
  return null;
}

/** Returns the enterprise package specifiers a CORE file imports (empty = clean). */
export function detectEnterpriseImports(source, enterprisePkgs) {
  if (!enterprisePkgs.length) return [];
  const hits = [];
  // import ... from "spec"; / export ... from "spec"; / require("spec") / dynamic import("spec")
  const importRe = /(?:import|export)[^"'`]*?from\s*["'`]([^"'`]+)["'`]|require\(\s*["'`]([^"'`]+)["'`]\s*\)|import\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  let m;
  while ((m = importRe.exec(source)) !== null) {
    const spec = m[1] ?? m[2] ?? m[3] ?? "";
    if (enterprisePkgs.some((p) => spec === p || spec.startsWith(p + "/"))) hits.push(spec);
  }
  return hits;
}

// ── self-test: prove the detectors actually fire (a neutered lint is itself a fail-open) ──────────
if (process.argv.includes("--self-test")) {
  const c1 = detectLicenseContamination("// Licensed under the Business Source License 1.1\n");
  const c2 = detectLicenseContamination("// SPDX-License-Identifier: LicenseRef-Proprietary\n");
  const clean = detectLicenseContamination("// SPDX-License-Identifier: Apache-2.0\n// normal header\n");
  const imp = detectEnterpriseImports('import { x } from "@logicn/enterprise-foo";', ["@logicn/enterprise-foo"]);
  const impClean = detectEnterpriseImports('import { x } from "@logicn/core-bar";', ["@logicn/enterprise-foo"]);
  const ok = !!c1 && !!c2 && clean === null && imp.length === 1 && impClean.length === 0;
  console.log(`[self-test] BSL header detected: ${!!c1} | non-Apache SPDX detected: ${!!c2} | Apache clean: ${clean === null} | enterprise import detected: ${imp.length === 1} | core import clean: ${impClean.length === 0}`);
  console.log(ok ? "[self-test] PASS — both contamination detectors fire" : "[self-test] FAIL — a detector did not fire");
  process.exit(ok ? 0 : 1);
}

// ── load config ──────────────────────────────────────────────────────────────────────────────────
function readJson(path, fallback) {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback; }
  catch (e) { console.error(`[tier-boundary] could not read ${path}: ${e.message} — fail-closed (treat as empty)`); return fallback; }
}
const manifest = readJson("governance/tier-manifest.json", { enterprise: [] });
const enterprisePkgs = Array.isArray(manifest.enterprise) ? manifest.enterprise : [];
const allow = new Set((readJson("governance/tier-lint-allow.json", { files: [] }).files ?? []).map((f) => f.replace(/\\/g, "/")));

// ── enumerate git-tracked source files ───────────────────────────────────────────────────────────
const ls = spawnSync("git", ["ls-files", SCAN_ROOT], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (ls.status !== 0) { console.error("[tier-boundary] `git ls-files` failed — fail-closed (exit 1)"); process.exit(1); }
const files = ls.stdout.split("\n").map((f) => f.trim()).filter((f) => f && SCAN_EXT.test(f) && !SKIP.test(f) && !allow.has(f));

// map a file path → its package dir (packages-logicn/<pkg>) for the (inert) tier rule
const violations = [];
for (const file of files) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  const header = text.split("\n").slice(0, HEADER_LINES).join("\n");

  const lic = detectLicenseContamination(header);
  if (lic) violations.push(`${file}: NON-APACHE LICENSE in header — ${lic} (would contaminate the Apache-2.0 tree)`);

  // tier rule: only meaningful once enterprise packages exist. A core file importing one is a violation.
  // (All packages default to `core`; an enterprise package importing its own tier is fine — skip those.)
  const pkgMatch = file.match(/^packages-logicn\/([^/]+)\//);
  const pkgName = pkgMatch ? `@logicn/${pkgMatch[1]}` : "";
  const isEnterpriseFile = enterprisePkgs.includes(pkgName);
  if (!isEnterpriseFile) {
    for (const spec of detectEnterpriseImports(text, enterprisePkgs)) {
      violations.push(`${file}: CORE→ENTERPRISE import of '${spec}' (Apache core must not depend on a BSL/enterprise tier)`);
    }
  }
}

// ── report ───────────────────────────────────────────────────────────────────────────────────────
console.log(`tier-boundary: scanned ${files.length} source files in ${SCAN_ROOT}/ ; enterprise tiers declared: ${enterprisePkgs.length ? enterprisePkgs.join(", ") : "(none yet — license rule active, import rule inert)"}`);
for (const v of violations) console.log(`  ✖ ${v}`);
console.log(
  violations.length === 0
    ? "tier-boundary: open-core boundary clean (Apache tree uncontaminated)."
    : `tier-boundary: ${violations.length} cross-tier contamination(s).`,
);
// Machine-readable line for the lint-conventions umbrella (parses `VIOLATIONS: N`, not the exit code).
console.log(`VIOLATIONS: ${violations.length}`);
console.log(`TOTAL: ${violations.length} tier-boundary violation(s) across ${files.length} files`);
process.exit(violations.length);

#!/usr/bin/env node
// component-health.mjs — LogicN per-COMPONENT readiness matrix for v1.0 "full testing".
// Pure-read, zero-dep (node:fs/node:path only), never throws, exit 0 (1 only with --strict on gaps).
// Complements status.mjs (headline counts) with a per-package breakdown + gap detector:
//   which workspace packages have a test script, a tests/ dir + test files, a recorded test count,
//   and which packages-logicn/ dirs are ORPHANS (a package.json on disk but absent from the workspace).
//
//   node scripts/component-health.mjs            # full matrix, grouped by family
//   node scripts/component-health.mjs --gaps     # only rows with a readiness gap
//   node scripts/component-health.mjs --json     # machine-readable
//   node scripts/component-health.mjs --strict   # exit 1 if any gap/orphan (CI gate)
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_DIR = join(ROOT, "packages-logicn");

const argv = new Set(process.argv.slice(2));
const ONLY_GAPS = argv.has("--gaps");
const AS_JSON = argv.has("--json");
const STRICT = argv.has("--strict");

const readJSON = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const listDir = (p) => { try { return readdirSync(p); } catch { return null; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : String(n));

// ── inputs ───────────────────────────────────────────────────────────────────
const workspace = readJSON(join(ROOT, "logicn.workspace.json")) || {};
const wsPackages = Array.isArray(workspace.packages) ? workspace.packages : [];
const version = readJSON(join(ROOT, "version.json")) || {};
const testCounts = version.testCountByPackage || {};

// family bucket from the package directory-name head
const FAMILY = {
  core: "core", substrate: "core", auth: "framework", framework: "framework",
  api: "framework", registry: "framework", ai: "ai", data: "data", web: "web",
  db: "db", target: "target", cpu: "target", hardware: "target", photonic: "target",
  ext: "ext", inference: "ext", devtools: "devtools", governance: "governance",
  observability: "governance", tower: "runtime", tri: "runtime", docs: "docs",
  test: "tooling", tools: "tooling",
};
const familyOf = (dir) => FAMILY[dir.replace(/^logicn-/, "").split("-")[0]] || "other";

// ── per-component rows (driven by the workspace list) ─────────────────────────
const countTestFiles = (dir) => {
  let n = 0;
  const walk = (d) => {
    for (const e of listDir(d) || []) {
      const ep = join(d, e);
      if (isDir(ep)) walk(ep);
      else if (/\.test\.(mjs|cjs|js)$/.test(e)) n++;
    }
  };
  if (existsSync(dir)) walk(dir);
  return n;
};

const rows = wsPackages.map((rel) => {
  const abs = join(ROOT, rel);
  const dir = basename(rel);
  const pkg = readJSON(join(abs, "package.json"));
  const testsDir = join(abs, "tests");
  const hasTestsDir = existsSync(testsDir);
  return {
    dir, name: pkg?.name || dir, family: familyOf(dir),
    onDisk: isDir(abs), hasPkg: !!pkg, private: pkg?.private === true,
    version: pkg?.version || null,
    testScript: !!pkg?.scripts?.test, buildScript: !!pkg?.scripts?.build,
    hasTestsDir, testFiles: hasTestsDir ? countTestFiles(testsDir) : 0,
    recordedCount: Object.prototype.hasOwnProperty.call(testCounts, dir) ? testCounts[dir] : null,
  };
});

// ── gap rules ─────────────────────────────────────────────────────────────────
const gapsFor = (r) => {
  const g = [];
  if (!r.onDisk) { g.push("missing-on-disk"); return g; }
  if (!r.hasPkg) { g.push("no-package.json"); return g; }
  if (!r.testScript) g.push("no-test-script");
  if (r.testScript && !r.hasTestsDir) g.push("test-script-but-no-tests-dir");
  if (r.hasTestsDir && r.testFiles === 0) g.push("tests-dir-empty");
  if (r.testScript && r.testFiles > 0 && r.recordedCount == null) g.push("tested-but-not-in-counts");
  return g;
};
for (const r of rows) r.gaps = gapsFor(r);

// ── orphans: packages-logicn/ dirs with a package.json, absent from the workspace ─
const wsDirs = new Set(wsPackages.map((p) => basename(p)));
const orphans = [];
for (const e of listDir(PKG_DIR) || []) {
  if (e === "node_modules" || e.startsWith(".")) continue;
  const ep = join(PKG_DIR, e);
  if (isDir(ep) && existsSync(join(ep, "package.json")) && !wsDirs.has(e)) orphans.push(e);
}

// ── roll-up ────────────────────────────────────────────────────────────────────
const summary = {
  workspacePackages: rows.length,
  onDisk: rows.filter((r) => r.onDisk).length,
  withTestScript: rows.filter((r) => r.testScript).length,
  withTestFiles: rows.filter((r) => r.testFiles > 0).length,
  recordedTotal: rows.reduce((a, r) => a + (typeof r.recordedCount === "number" ? r.recordedCount : 0), 0),
  withGaps: rows.filter((r) => r.gaps.length).length,
  orphans: orphans.length,
};

if (AS_JSON) {
  console.log(JSON.stringify({ summary, rows, orphans }, null, 2));
  process.exit(STRICT && (summary.withGaps + summary.orphans) > 0 ? 1 : 0);
}

// ── render ───────────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n);
const out = [];
out.push(`LogicN component health — ${summary.workspacePackages} workspace packages · ${summary.withTestScript} test-bearing · ${fmt(summary.recordedTotal)} recorded tests`);
out.push("");
for (const fam of [...new Set(rows.map((r) => r.family))].sort()) {
  const famRows = rows.filter((r) => r.family === fam).sort((a, b) => a.dir.localeCompare(b.dir));
  const shown = ONLY_GAPS ? famRows.filter((r) => r.gaps.length) : famRows;
  if (!shown.length) continue;
  out.push(`  ${fam}/`);
  for (const r of shown) {
    const cnt = r.recordedCount != null ? `${fmt(r.recordedCount)}t` : (r.testFiles ? `${r.testFiles}f` : "—");
    const flags = r.gaps.length ? `  ⚠ ${r.gaps.join(", ")}` : "";
    out.push(`    ${pad(r.dir, 40)} ${pad(cnt, 9)}${flags}`);
  }
}
out.push("");
out.push(`  gaps    : ${summary.withGaps} package(s) with a readiness gap${ONLY_GAPS ? "" : "  (--gaps to isolate)"}`);
out.push(`  orphans : ${summary.orphans}${orphans.length ? "  -> " + orphans.sort().join(", ") : ""}`);
console.log(out.join("\n"));
process.exit(STRICT && (summary.withGaps + orphans.length) > 0 ? 1 : 0);

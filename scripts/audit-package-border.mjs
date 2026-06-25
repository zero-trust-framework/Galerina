#!/usr/bin/env node
/**
 * audit-package-border.mjs — Hardened Border CI gate (#149), ENFORCING + fail-closed.
 *
 * Re-scans EVERY package under packages-logicn/ FROM SOURCE with the real scanner and enforces that
 * package's committed `.graph/boundary-policy.json` allowlist. This is the zero-trust gate: it does NOT
 * trust the committed `.graph/package-graph.json` (the artifact a drift-introducer controls) — it
 * RE-DERIVES the external import surface from source, then FAILS the build on:
 *   • an external import not in allowedExternal           (drift past the Hardened Border)
 *   • a missing boundary-policy.json under enforcement    (delete-to-launder defence — see reporter.js)
 *   • a malformed/non-array allowlist                     (unknown → deny, never allow-all)
 *
 * Anti-neuter: a `--self-test` proves the gate still FIRES (on an unlisted external AND a missing policy)
 * before the enforcing sweep — a border gate that has been silently defanged is itself a fail-open.
 *
 * Requires the scanner to be BUILT first (`tsc` on logicn-devtools-package-graph — it is pure TS with no
 * third-party deps, so the CI build is just tsc, no `npm install` of package deps). If the scanner dist is
 * absent the gate EXITS NON-ZERO rather than skipping (a gate that can't run must not pass).
 *
 * Usage:
 *   node scripts/audit-package-border.mjs --self-test   # prove the detector fires, then exit 0
 *   node scripts/audit-package-border.mjs               # self-test + enforcing sweep (CI)
 *
 * Exit codes: 0 clean · 1 boundary violation(s) found · 2 gate could not run / detector neutered.
 *
 * Residual (honestly scoped): orphan-file findings are advisory here (parity with the CLI --check, which
 * exits 1 only on boundary FAIL). #40 tracks scanner bare-subpath vs relative-form border identity.
 */
import { readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "packages-logicn", "logicn-devtools-package-graph", "dist");
const PKG_ROOT = join(ROOT, "packages-logicn");

async function loadScanner() {
  for (const f of ["scanner.js", "graph.js", "reporter.js"]) {
    if (!existsSync(join(DIST, f))) {
      console.error(
        `FAIL: the package-graph scanner is not built (${join(DIST, f)} missing).\n` +
        `       Build it first:  npx -p typescript tsc -p packages-logicn/logicn-devtools-package-graph/tsconfig.json\n` +
        `       (A border gate that cannot run must not silently pass.)`,
      );
      process.exit(2);
    }
  }
  const { scanPackage } = await import(pathToFileURL(join(DIST, "scanner.js")).href);
  const { buildGraph } = await import(pathToFileURL(join(DIST, "graph.js")).href);
  const { runBoundaryGate } = await import(pathToFileURL(join(DIST, "reporter.js")).href);
  return { scanPackage, buildGraph, runBoundaryGate };
}

/** Re-scan a package from source and enforce its committed policy (check=true → never auto-baselines). */
function checkPkg(S, pkgPath) {
  const graph = S.buildGraph(S.scanPackage(pkgPath));
  return S.runBoundaryGate(pkgPath, graph, /* check */ true);
}

/** The gate must FIRE on (A) an unlisted external and (B) a missing policy. Else it is neutered. */
function selfTest(S) {
  const base = mkdtempSync(join(tmpdir(), "lln-border-selftest-"));
  try {
    // (A) source imports an unlisted external; policy allows nothing → must FAIL with that specifier.
    const a = join(base, "pkgA");
    mkdirSync(join(a, "src"), { recursive: true });
    mkdirSync(join(a, ".graph"), { recursive: true });
    writeFileSync(join(a, "package.json"), JSON.stringify({ name: "@selftest/a" }));
    writeFileSync(join(a, "src", "index.ts"), 'import x from "evil-unlisted-dep";\nexport const y = x;\n');
    writeFileSync(join(a, ".graph", "boundary-policy.json"), JSON.stringify({ packageName: "@selftest/a", allowedExternal: [] }));
    const ra = checkPkg(S, a);
    if (ra.status !== "FAIL" || !ra.violations.some((v) => String(v).includes("evil-unlisted-dep"))) {
      console.error("SELF-TEST FAIL: gate did not flag an unlisted external (detector neutered):", JSON.stringify(ra));
      process.exit(2);
    }
    // (B) source imports a dep but there is NO policy file → must FAIL closed (delete-to-launder defence).
    const b = join(base, "pkgB");
    mkdirSync(join(b, "src"), { recursive: true });
    writeFileSync(join(b, "package.json"), JSON.stringify({ name: "@selftest/b" }));
    writeFileSync(join(b, "src", "index.ts"), 'import z from "another-dep";\nexport const w = z;\n');
    const rb = checkPkg(S, b);
    if (rb.status !== "FAIL") {
      console.error("SELF-TEST FAIL: a missing policy did not fail-closed (delete-to-launder hole):", JSON.stringify(rb));
      process.exit(2);
    }
    console.log("  self-test: gate fires on unlisted-external AND missing-policy ✅");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

async function main() {
  const selfTestOnly = process.argv.includes("--self-test");
  const S = await loadScanner();

  selfTest(S);
  if (selfTestOnly) {
    console.log("Hardened Border gate: self-test only (detectors fire) — OK.");
    process.exit(0);
  }

  const pkgs = readdirSync(PKG_ROOT)
    .map((n) => join(PKG_ROOT, n))
    .filter((p) => existsSync(join(p, "package.json")));

  let pass = 0;
  const failures = [];
  for (const p of pkgs) {
    const r = checkPkg(S, p);
    if (r.status === "FAIL") failures.push({ pkg: p.slice(ROOT.length + 1), violations: r.violations });
    else pass++;
  }

  console.log(`\n  Hardened Border — re-scanned ${pkgs.length} packages: ${pass} PASS / ${failures.length} FAIL`);
  if (failures.length > 0) {
    console.error("\n  ❌ Hardened Border violations:");
    for (const f of failures) {
      console.error(`     ${f.pkg}`);
      for (const v of f.violations) console.error(`        - ${v}`);
    }
    console.error(
      "\n  Fix: add the new external to that package's .graph/boundary-policy.json (a deliberate widening,\n" +
      "  reviewable in the PR diff), or remove the import. Regenerate the report with the package-graph CLI.",
    );
    process.exit(1);
  }
  console.log("  ✅ every package's external surface is within its Hardened Border.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("FAIL: border gate crashed:", e?.stack || e);
  process.exit(2);
});

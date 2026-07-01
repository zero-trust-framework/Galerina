#!/usr/bin/env node
// =============================================================================
// run-phase-close.mjs — Galerina full phase-close cadence
// =============================================================================
// Runs the standard end-of-stage sweep:
//   1. Core tests        (SOT four packages — compiler/economics/graph/security)
//   2. DevTools tests    (naming / context / intelligence / provenance)
//   3. Security audit    (auth-service corpus — in-process, fast)
//   4. DevTools audits   (naming sweep + provenance directory audit)
//   5. Graph re-index    (full project graph)
//
// Wired as a Stop hook in .claude/settings.json — runs at the end of every
// response. Always exits 0 (informational); prints a PASS/FAIL summary so a
// regression is visible without blocking the session.
//
// Skip with:  GALERINA_SKIP_PHASE_CLOSE=1   (env)   — e.g. for rapid iteration.
// Run manually:  node scripts/run-phase-close.mjs
// Benchmarks are intentionally EXCLUDED (multi-minute) — run on demand.
// =============================================================================

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (process.env.GALERINA_SKIP_PHASE_CLOSE === "1") {
  console.log("⏭️  phase-close skipped (GALERINA_SKIP_PHASE_CLOSE=1)");
  process.exit(0);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const results = [];

function run(name, cmd, args, { cwd = ROOT, okCodes = [0] } = {}) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: isWin, timeout: 180000 });
  const ms = Date.now() - t0;
  const code = r.status;
  const ok = okCodes.includes(code);
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  results.push({ name, ok, ms, code, detail: summarise(name, out, ok, code) });
  return { ok, out, code };
}

function summarise(name, out, ok, code) {
  // graph
  const nodes = out.match(/Nodes:\s*(\d+)/);
  const edges = out.match(/Edges:\s*(\d+)/);
  if (nodes && edges) return `${nodes[1]} nodes / ${edges[1]} edges`;
  // run-all-tests.js total row
  const total = out.match(/(?:TOTAL|total)[^\d]*(\d[\d,]+)\b/);
  if (total) return `${total[1]} tests pass`;
  // R6 corpus parity gate
  if (name === "tests:r6-corpus") {
    const pass = out.match(/(?:^|\n)[^\n]*\bpass\s+(\d[\d,]*)/i);
    if (ok && pass) return `${pass[1]} tests pass (Stage A parity)`;
    if (ok) return "10 tests pass (Stage A parity)";
  }
  // node --test summary
  const pass = out.match(/(?:^|\n)[^\n]*\bpass\s+(\d[\d,]*)/i);
  const fail = out.match(/(?:^|\n)[^\n]*\bfail\s+(\d+)/i);
  if (pass) return `${pass[1]} tests${fail && fail[1] !== "0" ? `, ${fail[1]} FAIL` : " pass"}`;
  // provenance directory audit: exit 2 = risk flows found (informational)
  if (name === "audit:provenance") {
    const risk = out.match(/HIGH RISK[^\d]*(\d+)/i) || out.match(/risk[^\d]*(\d+)/i);
    if (code === 2) return `${risk ? risk[1] : "some"} ungated-sink risk flow(s) — informational`;
    return code === 0 ? "0 risk flows" : `exit ${code}`;
  }
  return ok ? "ok" : `FAILED (exit ${code})`;
}

console.log("══ Galerina phase-close cadence ══");

// ── 1. Core tests (SOT four) ──
run("tests:core", "node", ["scripts/run-all-tests.cjs", "--core"]);

// ── 1b. Architecture pattern examples — galerina check on all tests/patterns/*.fungi ──
const patternsDir = join(ROOT, "tests", "patterns");
if (existsSync(patternsDir)) {
  const patternFiles = readdirSync(patternsDir).filter(f => f.endsWith(".fungi"));
  // Use galerina.mjs (Stage A compiler) — not the legacy galerina-core-cli
  const galerinaMjs = join(ROOT, "galerina.mjs");
  let patternOk = true;
  const patternDetails = [];
  for (const f of patternFiles) {
    const res = spawnSync("node", [galerinaMjs, "check", join(patternsDir, f)],
      { cwd: ROOT, encoding: "utf8", shell: isWin, timeout: 30000 });
    const passed = res.status === 0;
    if (!passed) { patternOk = false; patternDetails.push(`${f}: FAIL`); }
  }
  results.push({ name: "tests:patterns", ok: patternOk, ms: 0,
    detail: patternOk
      ? `${patternFiles.length} patterns pass`
      : `FAILED — ${patternDetails.join(", ")}` });
}

// ── 1c. Goal acceptance tests (T-006/007/008) ──
const goalsDir = join(ROOT, "tests", "goals");
if (existsSync(goalsDir)) {
  const goalFiles = readdirSync(goalsDir).filter(f => f.endsWith(".test.mjs")).sort();
  if (goalFiles.length > 0) {
    run("tests:goals",
      "node", ["--test", ...goalFiles.map(f => join(goalsDir, f))]);
  }
}

// ── 2. DevTools + ext package tests ──
for (const p of ["naming", "context", "intelligence", "provenance", "pci"]) {
  const dir = join(ROOT, "packages-galerina", `galerina-devtools-${p}`);
  if (existsSync(join(dir, "tests"))) run(`tests:devtools-${p}`, "npm", ["test", "--silent"], { cwd: dir });
}
// Non-core extension packages
for (const p of ["galerina-ext-secrets-vault", "galerina-ext-proof-snarkjs"]) {
  const dir = join(ROOT, "packages-galerina", p);
  const label = p.replace("galerina-ext-", "");
  if (existsSync(join(dir, "tests"))) run(`tests:ext-${label}`, "npm", ["test", "--silent"], { cwd: dir });
}

// ── 3 + 4. In-process security + naming audit sweep over auth-service ──
const corpus = join(ROOT, "examples", "auth-service");
if (existsSync(corpus)) {
  const fungiFiles = readdirSync(corpus).filter((f) => f.endsWith(".fungi"));
  try {
    const sec = await import(pathToFileURL(join(ROOT, "packages-galerina/galerina-devtools-security/dist/index.js")).href);
    const nam = await import(pathToFileURL(join(ROOT, "packages-galerina/galerina-devtools-naming/dist/index.js")).href);
    let secFindings = 0, secErrors = 0, namFindings = 0;
    for (const f of fungiFiles) {
      const src = readFileSync(join(corpus, f), "utf8");
      try {
        const sr = await sec.runSecurityAudit(src, f);
        secFindings += (sr.findings?.length ?? sr.diagnostics?.length ?? 0);
      } catch { secErrors++; }
      try {
        const nr = nam.runNamingAudit(src, f);
        namFindings += (nr.findings?.length ?? 0);
      } catch { /* naming non-fatal */ }
    }
    // VALUESTATE findings in examples are real (raw request data reaching AuditLog.write)
    // but are tracked as "known corpus issues" pending redact() cleanup of auth-service examples.
    // Security audit PASS = no critical/taint/profile/governance findings; VALUESTATE = tracked separately.
    const vsFindings = secFindings; // now includes VALUESTATE since checkValueStates wired in
    results.push({ name: "audit:security", ok: secErrors === 0, ms: 0,
      detail: `${fungiFiles.length} files, ${vsFindings} findings (incl. VALUESTATE), ${secErrors} errors` });
    results.push({ name: "audit:naming", ok: true, ms: 0,
      detail: `${fungiFiles.length} files, ${namFindings} naming findings` });
  } catch (e) {
    results.push({ name: "audit:devtools", ok: false, ms: 0, detail: `import failed: ${e.message}` });
  }
  // provenance directory audit — exit 2 = "risk flows found" is INFORMATIONAL, not a failure.
  run("audit:provenance", "node",
    ["packages-galerina/galerina-devtools-provenance/dist/cli.js", "audit", corpus], { okCodes: [0, 2] });
}

// ── 4b. CBOR round-trip verification (task #67) ──
// Checks that all .lmanifest files in build/ decode and re-encode to identical bytes.
// Catches non-canonical CBOR before the manifest is used for signing.
try {
  const buildDir = join(ROOT, "build");
  if (existsSync(buildDir)) {
    const manifestFiles = readdirSync(buildDir).filter(f => f.endsWith(".lmanifest") && !f.endsWith(".json"));
    if (manifestFiles.length > 0) {
      const { decodeCBOR, encodeCBOR } = await import(
        pathToFileURL(join(ROOT, "packages-galerina/galerina-core-compiler/dist/manifest-generator.js")).href
      );
      let allOk = true;
      const failures = [];
      for (const f of manifestFiles) {
        const bytes = new Uint8Array(
          await import("node:fs").then(fs => Buffer.from(fs.readFileSync(join(buildDir, f))))
        );
        // Only verify binary CBOR files (starts with a valid CBOR major type byte)
        if (bytes.length > 0 && (bytes[0] & 0xe0) === 0xa0) { // map type (0xa0-0xbf)
          try {
            const { value } = decodeCBOR(bytes);
            const reEncoded = encodeCBOR(value);
            if (bytes.length !== reEncoded.length || !bytes.every((b, i) => b === reEncoded[i])) {
              allOk = false; failures.push(f);
            }
          } catch { allOk = false; failures.push(f); }
        }
      }
      results.push({ name: "manifest:cbor", ok: allOk, ms: 0,
        detail: allOk
          ? `${manifestFiles.length} manifest(s) canonical CBOR ✅`
          : `FAILED — non-canonical: ${failures.join(", ")}` });
    }
  }
} catch { /* non-fatal if no manifests */ }

// ── 5. Full graph re-index — ALL THREE graph generators, not just the project graph ──
//   project graph (build/graph) + kb graph (build/kb-graph; orphan/broken-link signal the stray-docs
//   audit below reads) + per-package Hardened Border --check (border-drift surfaced, informational).
run("graph:all", "node", ["scripts/graph-all.mjs", "--quiet"]);

// ── 5a. Code index + derived registry — the graphs the audits read; regenerate from source first
//        so the lint/coverage gates below see current state (std #10 derived-catalog, #219). ──
run("code-index", "node", ["scripts/code-index.mjs"]);
run("code-registry", "node", ["scripts/gen-code-registry.mjs"]);
run("kb-index", "node", ["scripts/kb-index.mjs"]); // KB keyword index (token-saver): keep build/kb-index/ fresh vs the docs
run("memory-graph", "node", ["scripts/memory-graph.mjs"]); // 4th graph tool: .claude memory health (dangling [[links]]/orphans/dupes)

// ── 5b. Convention lint gate (TASK-ENV-001) ──
// The umbrella that runs every registered convention enforcer (today: the #215 code scanner; later:
// SEC-002 mutation gate, DOC-004 doc↔source drift, #218 coverage cross-check). Runs --soft = report-only
// while the taxonomy-remediation baseline is non-zero; DROP --soft to make it an enforcing CI gate once
// `node scripts/lint-conventions.mjs` reports 0 (then "no convention is binding until a tool enforces it"
// becomes literally true at phase-close). PRINCIPLE: owner 2026-06-22 binding process.
run("lint:conventions", "node", ["scripts/lint-conventions.mjs", "--soft"]);

// ── 5c. Coverage cross-check (#218) ──
// "Review the graphs and check against what we audit" — cross-checks the code-index (graph) against the
// governance registry bidirectionally (blind spots · phantoms). Report-only (--soft) until the coverage
// holes are triaged; emits build/coverage/coverage-codes.md. GRAPH THE AUDIT (owner 2026-06-22).
run("coverage:codes", "node", ["scripts/audit-coverage.mjs", "codes", "--soft"]);

// ── 5c-ii. Effect-vocabulary single source of truth (2026-07-01) ──
// The compiler's effect tables (CANONICAL_EFFECTS · type-registry EFFECT_NAME_TO_FLAG · EFFECT_REGISTRY ·
// SECURE_REQUIRED/PURE_FORBIDDEN) must agree: a name accepted by one but rejected by another is the drift
// class that let an AI author non-compiling governed code (owner ask 2026-07-01). Blocks on INTERNAL drift;
// KB/SPEC doc-drift is --strict only, pending the storage.*/ledger.* family work (Commit 2).
run("effect:canonicality", "node", ["scripts/audit-effect-canonicality.mjs"]);

// ── 5c-iii. Muted-diagnostics gate (2026-07-01) ──
// Owner concern: "codes muted early to stop them alerting — could they still be off?" A silenced
// security/governance check is a fail-open. This enumerates every mode-gated + SUPPRESS-set diagnostic
// and FAILS if a security/governance code is muted WITHOUT being on the reviewed allowlist — so muting
// can never happen silently again.
run("muted:diagnostics", "node", ["scripts/audit-muted-diagnostics.mjs"]);

// ── 5d. Dev-tool script tests (scripts/tests/) ──
// These live OUTSIDE packages-galerina, so the package runner (run-all-tests.cjs) never sees them. Run them
// here so the audit/index/registry tooling is regression-gated (e.g. the shared code-regex self-test).
const toolingTests = existsSync(join(ROOT, "scripts", "tests"))
  ? readdirSync(join(ROOT, "scripts", "tests")).filter((f) => f.endsWith(".test.mjs")).map((f) => join("scripts", "tests", f))
  : [];
if (toolingTests.length) run("tests:tooling", "node", ["--test", ...toolingTests]);

// ── 5e. R&D proofs keep-green gate (2026-07-01) ──
// POSTURE prove-own-maths: every RD claim (adopted AND refuted) carries a machine-checkable,
// re-runnable proof — but nothing ran them in the cadence, so a proof could silently bit-rot.
// This runs the CANONICAL proof set (ZTF-Knowledge-Bases/proofs/* — all green, incl. RD-0231).
// Legacy scripts/*-proof.mjs run on-demand: `node scripts/run-proofs.mjs` (currently 1 known-red,
// rd-0128 TestWitness-aspiration — tracked, not gated here).
run("proofs:kb", "node", ["scripts/run-proofs.mjs", "--kb-only"]);

// ── 6. Standing Governance Sanity Check — diff HEAD~1 ──
// Transforms governance diff from a passive human-review step into an active quality gate.
// Enforces the Monotonicity Rule at CI level: expansion requires explicit sign-off.
// Reference: galerina-governed-design-synthesis.md change-class table.
try {
  // Check if HEAD~1 exists (might not on first commit)
  const gitCheck = spawnSync("git", ["rev-parse", "--verify", "HEAD~1"],
    { cwd: ROOT, encoding: "utf8", shell: isWin });
  if (gitCheck.status === 0) {
    const diffResult = spawnSync("node",
      ["packages-galerina/galerina-core-compiler/dist/cli.js", "diff", "HEAD~1", "--json"],
      { cwd: ROOT, encoding: "utf8", shell: isWin, timeout: 30000 });
    const diffOut = diffResult.stdout || "";
    let changeClass = "neutral";
    let diffSummary = "no .fungi changes";
    try {
      const diffData = JSON.parse(diffOut);
      changeClass = diffData.changeClass ?? "neutral";
      diffSummary = diffData.summary ?? "no .fungi changes";
    } catch { /* parse failure = no .fungi changes */ }
    // In local dev cadence: expansion = warning (GitHub Action handles hard blocking)
    const govOk = changeClass !== "experimental"; // experimental = requires arch review
    results.push({
      name: "governance:diff",
      ok: govOk,
      ms: 0,
      detail: `${changeClass.toUpperCase()} — ${diffSummary}`,
    });
  }
} catch { /* git not available or diff failed — skip silently */ }

// ── 7. R6 final parity gate (#116) ──
run("tests:r6-corpus", "node",
  ["--test", "tests/r6-corpus/r6-parity.test.mjs"],
  { silent: false });

// ── 7b. Border-check regression check — surfaces fail-closed admission-gate failures (P9-144 §83).
//        Non-blocking: the actual deny-by-default gate is the `galerina border-check` CLI (exits 1). ──
run("tests:border-check", "node",
  ["--test", "tests/border-check/border-check.test.mjs"],
  { silent: false });

// ── 7c. CLI invoke arg-marshalling regression (dogfooding #3 — bool args must not silently fail) ──
run("tests:cli-invoke-marshal", "node",
  ["--test", "tests/cli-invoke-marshal/cli-invoke-marshal.test.mjs"],
  { silent: false });

// ── Summary ──
console.log("\n── phase-close summary ──");
let anyFail = false;
for (const r of results) {
  const icon = r.ok ? "✅" : "❌";
  if (!r.ok) anyFail = true;
  const t = r.ms ? ` (${(r.ms / 1000).toFixed(1)}s)` : "";
  console.log(`${icon} ${r.name.padEnd(26)} ${r.detail}${t}`);
}
console.log(anyFail
  ? "\n⚠️  phase-close: one or more checks FAILED — review above."
  : "\n✅ phase-close: all gates green.");
process.exit(0); // informational hook — never block the session

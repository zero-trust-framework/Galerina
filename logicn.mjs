#!/usr/bin/env node
/**
 * logicn — LogicN program compiler and runner
 *
 * Usage:
 *   node logicn.mjs run <program.lln>           # compile + run via Node.js WebAssembly
 *   node logicn.mjs build <program.lln>         # compile to .wasm + .wat in build/
 *   node logicn.mjs check <program.lln>         # type-check + governance only
 *   node logicn.mjs run <program.lln> --invoke <flow> [args...]  # invoke a specific flow
 *
 * The WASM path:
 *   .lln source → parseProgram → emitGIR → buildWATModuleFromGIR → renderWAT
 *               → assembleWAT (wabt) → WebAssembly.instantiate → run
 *
 * To use with wasmtime instead of Node:
 *   node logicn.mjs build program.lln
 *   wasmtime --invoke main build/program.wasm
 *
 * Baseline (governance-cost, Stage-A tree-walker): 3,200 ops/sec
 * This WASM path:                                  ~1,880,000 ops/sec  (588×)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, appendFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execSync, spawnSync } from "node:child_process";
import { totalmem, freemem } from "node:os";

// ── Auto assimilation memory budget ──────────────────────────────────────────
// Called when boot.lln declares `assimilation_memory_budget: auto`
// OR when the governance block is omitted entirely (auto is the default).
//
// Formula: min(available_RAM * 0.20, 256MB)
// Conservative: 20% of currently free RAM, hard ceiling of 256MB.
//
// Tiers based on available RAM:
//   < 4GB  → 10% of free RAM, ceiling 50MB   (constrained / container)
//   4–16GB → 20% of free RAM, ceiling 128MB  (developer workstation)
//   > 16GB → 20% of free RAM, ceiling 256MB  (server / production)
//
// Developers can always override with an explicit value:
//   governance { assimilation_memory_budget: 50MB }  ← fixed ceiling
//   governance { assimilation_memory_budget: auto }  ← this function
//   governance { assimilation_memory_budget: auto max 100MB } ← auto with cap
function computeAutoAssimilationBudgetMB(explicitMaxMB = null) {
  const totalMB  = Math.round(totalmem()  / (1024 * 1024));
  const freeMB   = Math.round(freemem()   / (1024 * 1024));

  let ceilingMB;
  if (totalMB < 4096)       ceilingMB = 50;   // < 4GB  → 50MB ceiling
  else if (totalMB < 16384) ceilingMB = 128;  // 4–16GB → 128MB ceiling
  else                      ceilingMB = 256;  // > 16GB → 256MB ceiling

  // If explicit max provided, use the smaller of the two
  if (explicitMaxMB !== null) ceilingMB = Math.min(ceilingMB, explicitMaxMB);

  const autoBudgetMB = Math.round(freeMB * 0.20);
  return Math.min(autoBudgetMB, ceilingMB);
}

// ── Plugin blacklist (panic-as-security) ──────────────────────────────────
// Any plugin that fires an unexpected trap (not from a governed invariant)
// is blacklisted. The Tower refuses to load blacklisted plugin versions.
function loadPluginBlacklist() {
  const path = "build/plugin-blacklist.json";
  if (!existsSync(path)) return [];
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return []; }
}

function blacklistPlugin(pluginId, reason) {
  const path = "build/plugin-blacklist.json";
  mkdirSync("build", { recursive: true });
  const list = loadPluginBlacklist();
  if (!list.find(e => e.pluginId === pluginId)) {
    list.push({ pluginId, reason, blacklistedAt: new Date().toISOString() });
    writeFileSync(path, JSON.stringify(list, null, 2));
    console.log(`  [BLACKLISTED] Plugin blacklisted: ${pluginId} — ${reason}`);
  }
}

const __dir = dirname(fileURLToPath(import.meta.url));
const compilerPath = new URL("packages-logicn/logicn-core-compiler/dist/index.js", import.meta.url).href;

async function main() {
  const [, , command = "help", ...rest] = process.argv;

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(`logicn — LogicN compiler + runtime (Phase 27 WASM)

Commands:
  logicn run <file.lln> [--invoke <flow>] [args...]   compile .lln → WASM → run
                                                      (--invoke targets pure flows returning a primitive Int/Bool;
                                                       args are ints or true/false. Secure/effectful flows run in
                                                       the governed runtime, not the raw WASM --invoke surface.)
  logicn run <file.lln> --invoke <flow> --governed    run ANY flow through the GOVERNED runtime (#125): contract
                                                       enforcer + fail-closed capability host (only declared effects)
                                                       + audit. Required for secure/effectful flows; fail-closed.
  logicn build <file.lln>                             compile → build/<name>.wasm + .wat + .lmanifest
  logicn build --package <dir>                        compile a package's /src → governed .wasm in <dir>/dist/ (fusable, emits .fuse.json)
  logicn build --package <dir> --no-refresh           ...without refreshing the //lln: dependency metadata (reproducible CI)
  logicn fuse <dir...> [--invoke <pkg>:<export>]       host-link a SET of built packages (multi-module; deny-by-default, fail-closed)
  logicn deps <file.lln> [--flow <name>]              print generated //lln: USES/USEDBY/IMPACT/COMPLEXITY for a file
  logicn deps <file.lln> --write                      write the //lln: metadata into that file (machine-owned tier)
  logicn deps --all [dir] [--write]                   refresh //lln: across EVERY .lln in the app (cross-file; default dir = cwd)
  logicn deps --all [dir] --check                     CI gate: exit 1 if any //lln: is stale (don't write)
  logicn check <file.lln>                             type-check + governance verify
  logicn check <file.lln> --diff                      show change class vs HEAD~1 before pushing
  logicn check --what-if <policy.lln>                 shadow policy analysis (dry run)
  logicn check --what-if <policy.lln> <file.lln>      what-if against single file
  logicn verify <file.lln>                            DRCM Phase 3 admission gate — verify manifest
  logicn gen-tests <file.lln> [--tap]                 contract-driven test obligations (0016) — 5 dimensions; --tap = TAP plan
  logicn manifest-to-dot <file.lln>                   export manifest as Graphviz DOT for DAG audit
  logicn init-env                                      validate capabilities against root policy
  logicn keygen                                        generate Ed25519 signing keypair for manifests
  logicn deploy <file.lln> [--tag <image>]            run full deploy pipeline (check+build+verify+health)
  logicn budget                                        show auto assimilation_memory_budget for this machine
  logicn version                                      show version and runtime status
  logicn diagnostic                                    run diagnostic fault-injection benchmark suite
  logicn border-check                                  validate all plugin schemas in governance/plugins/
  logicn kb-graph [--all]                              scan docs/Knowledge-Bases/ cross-reference graph
  logicn ledger <egress-dir> [--json]                  build hash-linked compliance report from audit-egress
  logicn new <target-dir> [--name <pkg>]               scaffold an opinionated secure governed package
  logicn infer <file.lln> [--invoke F] [--prompt P] [--model M]   run governed AI inference from a flow's ai {} contract

Examples:
  logicn run   governance-cost.lln --invoke main
  logicn build governance-cost.lln
  logicn check examples/auth-service/verifyPassword.lln

  # After build, run the raw WASM binary without Node.js:
  wasmtime --invoke main build/governance-cost.wasm

Install (if logicn not yet on PATH):
  cd C:\\wwwprojects\\LogicN && npm link       (Windows cmd.exe)
  cd /c/wwwprojects/LogicN && npm link        (Git Bash / Linux)

Baseline comparison (governance-cost):
  Stage-A tree-walker (governed):  3,200 ops/sec
  This WASM path:                  ~1,880,000 ops/sec  (588×)
`);
    return;
  }

  // ── logicn version — show version and runtime status (#117) ─────────────────
  if (command === "version" || command === "--version" || command === "-v") {
    const v = JSON.parse(readFileSync("version.json", "utf-8"));
    console.log(`LogicN ${v.version} (${v.stage})`);
    console.log(`  Runtime:  ${v.runtime}`);
    console.log(`  DRCM:     ${v.drcmPhases}`);
    console.log(`  Tests:    ${v.testCount} tests / ${v.packageCount} packages`);
    console.log(`  Status:   ${v.milestone}`);
    process.exit(0);
  }

  // ── logicn deploy — full governed deploy pipeline (#112) ─────────────────────
  // Runs: governance check → build WASM → verify manifest → health check
  // Prints OCI packaging instructions for Dockerfile.logicn + deploy-linux.sh
  if (command === "deploy") {
    const llnFile = rest[0];
    if (!llnFile) {
      console.error("Usage: logicn deploy <file.lln> [--tag <image-tag>]");
      process.exit(1);
    }

    const tagIdx = rest.indexOf("--tag");
    const imageTag = tagIdx >= 0 ? rest[tagIdx + 1] : "logicn-app:latest";

    // SECURITY (2026-06-06): validate the user-supplied path and NEVER interpolate it
    // into a shell string. A `.lln` path containing shell metacharacters (backticks,
    // ;, |, $(), …) would otherwise be executed by the shell. We reject obviously
    // hostile input and dispatch via argv-based spawnSync with shell:false.
    if (!/^[A-Za-z0-9_./\\-]+\.lln$/.test(llnFile)) {
      console.error(`❌ Refusing to deploy: '${llnFile}' is not a safe .lln path (alphanumerics, _ . / \\ - only, must end in .lln).`);
      process.exit(2);
    }
    if (!existsSync(llnFile)) {
      console.error(`❌ Deploy target not found: ${llnFile}`);
      process.exit(2);
    }

    console.log(`\n🏰 LogicN Deploy — ${llnFile}`);
    console.log(`   Image tag: ${imageTag}\n`);

    const self = "logicn.mjs";
    // argv arrays — NOT shell strings. spawnSync(shell:false) passes each arg verbatim,
    // so path contents can never be interpreted as shell syntax.
    const steps = [
      { name: "Governance check", argv: [self, "check", llnFile] },
      { name: "Build WASM",       argv: [self, "build", llnFile] },
      { name: "Verify manifest",  argv: [self, "verify", llnFile] },
      { name: "Health check",     argv: [self, "run", "examples/deployment/health-check.lln", "--invoke", "getHealthStatus"] },
    ];

    for (const step of steps) {
      process.stdout.write(`  ⏳ ${step.name}...`);
      const r = spawnSync(process.execPath, step.argv, { cwd: process.cwd(), encoding: "utf-8", timeout: 60000, shell: false });
      if (r.status !== 0) {
        console.log(`  ❌ ${step.name} FAILED`);
        console.error((r.stderr || r.stdout || r.error?.message || "").toString());
        process.exit(1);
      }
      console.log(`  ✅ ${step.name}`);
    }

    console.log(`\n✅ Deploy pipeline complete`);
    console.log(`   WASM:     build/`);
    console.log(`   Receipts: build/receipt-ledger/receipts.jsonl`);
    console.log(`   Audit:    build/audit-log/audit-log.jsonl`);
    console.log(`\n   OCI packaging: see scripts/Dockerfile.logicn`);
    console.log(`   Deployment:     ./scripts/deploy-linux.sh ${llnFile}\n`);
    process.exit(0);
  }

  // ── logicn init-env — validate capabilities against root governance policy (#65) ─
  // Must be checked BEFORE llnFile requirement since it takes no file argument.
  if (command === "init-env") {
    const m2 = await import(compilerPath);
    const { readdirSync: rds } = await import("node:fs");
    const scanDir = (dir) => {
      try { return rds(dir).filter(f => f.endsWith(".lln")).map(f => `${dir}/${f}`); }
      catch { return []; }
    };
    const flowFiles = [...scanDir("flows"), ...scanDir("examples/auth-service"), ...scanDir("tests/patterns")];
    let allFlows = 0, violations = 0;
    console.log(`logicn init-env — scanning ${flowFiles.length} flow file(s) for policy violations`);
    for (const file of flowFiles) {
      try {
        const src = readFileSync(file, "utf8");
        const p = m2.parseProgram(src, file);
        const fx = m2.checkEffects(p.flows, p.ast);
        const g = m2.verifyGovernance(p.ast, p.flows, fx, "dev");
        allFlows += p.flows.length;
        const errs = g.diagnostics.filter(d => d.severity === "error");
        if (errs.length > 0) {
          violations += errs.length;
          errs.forEach(d => console.log(`  ❌ ${file}: ${d.code} — ${d.message.slice(0, 100)}`));
        }
      } catch { /* skip unparseable files */ }
    }
    if (violations === 0) {
      console.log(`✅ init-env: ${allFlows} flows scanned, 0 violations — clean baseline for diffing`);
    } else {
      console.log(`⚠️  init-env: ${allFlows} flows scanned, ${violations} violation(s) — review before committing`);
      process.exit(2);
    }
    return;
  }

  // ── logicn keygen — generate Ed25519 signing keypair for manifest governance (#107) ─
  // Stage A: Ed25519 (Node.js native crypto)
  // Stage B: ML-DSA-65 (NIST FIPS 204) — upgrade once Node.js adds FIPS 204 support
  if (command === "keygen") {
    const { generateKeyPairSync, randomBytes } = await import("node:crypto");
    const { writeFileSync: wfs, mkdirSync: mds, chmodSync: chm } = await import("node:fs");
    const { join: pjoin } = await import("node:path");

    // Generate Ed25519 keypair (Stage A — will upgrade to ML-DSA-65 in Stage B)
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    // Key ID = first 16 hex chars of random bytes
    const keyId = randomBytes(8).toString("hex");

    // Store public key in governance/ directory (safe to commit)
    mds("governance", { recursive: true });
    const pubKeyPath = pjoin("governance", `signing-key-${keyId}.pub.pem`);
    wfs(pubKeyPath, publicKey);

    // Store private key in .env.logicn-signing (never commit)
    const envPath = ".env.logicn-signing";
    const envContent = [
      `# LogicN governance signing key — NEVER COMMIT THIS FILE`,
      `# Key ID: ${keyId}`,
      `# Algorithm: Ed25519 (Stage A) → ML-DSA-65 NIST FIPS 204 (Stage B)`,
      `LOGICN_SIGNING_KEY_ID=${keyId}`,
      `LOGICN_SIGNING_KEY_CREATED=${new Date().toISOString()}`,
      `LOGICN_SIGNING_PRIVATE_KEY_B64=${Buffer.from(privateKey).toString("base64")}`,
      ``,
    ].join("\n");
    // #175: the private key file must not be group/world-readable. Create it 0o600 and
    // re-enforce on any pre-existing file (writeFileSync's mode only applies on creation).
    wfs(envPath, envContent, { mode: 0o600 });
    try { chm(envPath, 0o600); } catch { /* Windows / unsupported FS — mode is best-effort */ }

    console.log(`\n✅ LogicN governance signing keypair generated`);
    console.log(`   Algorithm:  Ed25519 (Stage A — ML-DSA-65 in Stage B)`);
    console.log(`   Key ID:     ${keyId}`);
    console.log(`   Public key: ${pubKeyPath}  (safe to commit)`);
    console.log(`   Private key: ${envPath}    (NEVER COMMIT — add to .gitignore)`);
    console.log(`\n   Add to .gitignore:`);
    console.log(`     .env.logicn-signing`);
    console.log(`\n   To start signing manifests:`);
    console.log(`     export LOGICN_SIGNING_KEY_ID=${keyId}`);
    console.log(`     source ${envPath}  # or add to your shell env`);
    console.log(`     logicn build <file.lln>  # will now sign the manifest\n`);

    process.exit(0);
  }

  // ── logicn check --what-if <policyFile> [targetFile]: Shadow Policy Analysis (#71) ─
  // Runs governance verification against a proposed policy WITHOUT applying it.
  // Shows which flows would fail, which effects would be denied, and change class.
  // Exit 0 = policy compatible, Exit 2 = expansion violations
  if (command === "check" && rest[0] === "--what-if" && rest[1]) {
    const policyFile = rest[1];
    const targetFile = rest[2]; // optional: target specific .lln file

    if (!existsSync(policyFile)) {
      console.error(`❌ Policy file not found: ${policyFile}`);
      process.exit(1);
    }

    console.log(`\n🔍 Shadow Policy Analysis — What-If Mode`);
    console.log(`   Policy:  ${policyFile}`);
    console.log(`   Target:  ${targetFile ?? "all .lln files in build/"}`);
    console.log(`   Status:  DRY RUN — no changes applied\n`);

    // Read the shadow policy file
    const shadowPolicyContent = readFileSync(policyFile, "utf-8");

    // Parse to extract policy name and permitted_effects
    const policyNameMatch = shadowPolicyContent.match(/policy\s+(\w+)\s*\{/);
    const policyName = policyNameMatch?.[1] ?? "ShadowPolicy";

    // Extract permitted_effects from shadow policy
    const permittedEffectsMatch = shadowPolicyContent.match(/permitted_effects\s*\{([^}]*)\}/s);
    const permittedEffects = permittedEffectsMatch?.[1]
      ?.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('//') && !l.startsWith(';'))
      ?? [];

    // Extract enforced_limits from shadow policy
    const enforcedLimitsMatch = shadowPolicyContent.match(/enforced_limits\s*\{([^}]*)\}/s);
    const enforcedLimits = enforcedLimitsMatch?.[1]
      ?.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('//') && !l.startsWith(';'))
      ?? [];

    // Find all .lln files to check
    const llnFiles = targetFile
      ? [targetFile]
      : readdirSync(".", { recursive: true })
          .filter(f => String(f).endsWith(".lln") && !String(f).includes("node_modules"))
          .map(f => String(f))
          .slice(0, 20); // cap at 20

    // Analyse each file against the shadow policy
    let violations = 0;
    let warnings = 0;
    let compatible = 0;
    const report = [];

    for (const llnFile of llnFiles) {
      if (!existsSync(llnFile)) continue;
      const src = readFileSync(llnFile, "utf-8");

      // Extract declared effects from the file
      const effectsMatches = [...src.matchAll(/effects\s*\{([^}]*)\}/sg)];
      const declaredEffects = effectsMatches.flatMap(m =>
        (m[1] ?? "").split('\n')
          .map(l => l.trim())
          .filter(l => l.length > 0 && !l.startsWith('//') && !l.startsWith(';'))
      );

      // Check which effects would be blocked by the shadow policy
      const blockedEffects = declaredEffects.filter(eff => {
        const effName = eff.replace(/^allow\s+/, "").trim();
        // If permitted_effects is empty, all are allowed (no restriction)
        if (permittedEffects.length === 0) return false;
        // Check if the effect is covered by the policy's permitted list
        return !permittedEffects.some(pe => {
          const peName = pe.replace(/^allow\s+/, "").trim();
          return peName === effName || peName === effName.split('.')[0] + '.*';
        });
      });

      if (blockedEffects.length > 0) {
        violations++;
        report.push({
          file: llnFile,
          status: "❌ VIOLATION",
          blocked: blockedEffects,
          allowed: declaredEffects.filter(e => !blockedEffects.includes(e)),
        });
      } else if (declaredEffects.length > 0) {
        compatible++;
        report.push({ file: llnFile, status: "✅ compatible", blocked: [], allowed: declaredEffects });
      }
    }

    // Print report
    for (const entry of report) {
      console.log(`  ${entry.status}  ${entry.file}`);
      if (entry.blocked.length > 0) {
        console.log(`    Would block: ${entry.blocked.join(', ')}`);
      }
    }

    // Summary
    const changeClass = violations > 0 ? "TIGHTENING" : "NEUTRAL";
    console.log(`\n─────────────────────────────────────────────────`);
    console.log(`  Shadow Policy: ${policyName}`);
    console.log(`  Change Class:  ${changeClass}`);
    console.log(`  Compatible:    ${compatible} file(s)`);
    console.log(`  Violations:    ${violations} file(s) — would fail under this policy`);
    console.log(`  Warnings:      ${warnings}`);
    console.log(`\n  📋 This is a DRY RUN — policy '${policyName}' has NOT been applied.`);
    console.log(`     To apply: cp ${policyFile} governance/${policyName}.lln && logicn init-env\n`);

    process.exit(violations > 0 ? 2 : 0);
  }

  // ── logicn budget — show auto assimilation_memory_budget for this machine ──
  if (command === "budget") {
    const totalMB = Math.round(totalmem() / (1024 * 1024));
    const freeMB  = Math.round(freemem()  / (1024 * 1024));
    const autoBudget = computeAutoAssimilationBudgetMB();
    console.log(`\n  🏰 LogicN Assimilation Memory Budget`);
    console.log(`  ─────────────────────────────────────`);
    console.log(`  Total RAM:          ${totalMB} MB`);
    console.log(`  Available RAM:      ${freeMB} MB`);
    console.log(`  Auto budget (20%):  ${Math.round(freeMB * 0.20)} MB (before ceiling)`);
    console.log(`  Resolved budget:    ${autoBudget} MB  ← what 'auto' uses`);
    console.log();
    console.log(`  boot.lln options:`);
    console.log(`    governance { }                                           → ${autoBudget} MB (omitted = auto)`);
    console.log(`    governance { assimilation_memory_budget: auto }         → ${autoBudget} MB`);
    console.log(`    governance { assimilation_memory_budget: auto max 50MB }→ ${computeAutoAssimilationBudgetMB(50)} MB`);
    console.log(`    governance { assimilation_memory_budget: 100MB }        → 100 MB (explicit)`);
    console.log();
    console.log(`  Ceiling tiers: <4GB RAM → 50MB · 4–16GB → 128MB · >16GB → 256MB\n`);
    process.exit(0);
  }

  // ── logicn border-check — FAIL-CLOSED plugin admission gate ──────────────────
  // SECURITY (2026-06-06): previously this only checked file presence and counted a
  // BLACKLISTED plugin as "clean". A plugin requesting real authority
  // (ai.inference / network.outbound / audit.write) with a placeholder
  // "sha256:pending-…" hash sailed through. The gate now DENIES by default and
  // validates: source-hash format (no pending/placeholder), blacklist state,
  // capability allowlist, resource-limit ranges, governance tier, and schema file.
  if (command === "border-check") {
    console.log("\n  Hardened Border Check");
    console.log("  ─────────────────────────");
    const pluginsDir = "governance/plugins";
    if (!existsSync(pluginsDir)) {
      console.log("  No plugins directory found at governance/plugins/");
      process.exit(0);
    }
    // Capability allow-list (deny anything not on it). High-authority caps demand a
    // real, signed, non-pending source hash.
    const KNOWN_CAPS = new Set([
      "ai.inference", "network.outbound", "network.inbound", "audit.write", "audit.read",
      "db.read", "db.write", "filesystem.read", "filesystem.write", "time.read",
      "crypto.sign", "crypto.verify", "state.read", "state.write", "memory.alloc",
    ]);
    const CEILINGS = { maxMemoryMB: 4096, maxCpuCycles: 1e10, maxWallMs: 60000 };
    const SHA256 = /^sha256:[0-9a-f]{64}$/;

    function validatePlugin(plugin) {
      const reasons = [];
      const manifestPath = join(pluginsDir, plugin, "manifest.json");
      const schemaPath = join(pluginsDir, plugin, "schemas/data_types.json");
      if (!existsSync(manifestPath)) return ["missing manifest.json"];
      if (!existsSync(schemaPath)) reasons.push("missing schemas/data_types.json");
      let m;
      try { m = JSON.parse(readFileSync(manifestPath, "utf-8")); }
      catch (e) { return [`unparseable manifest.json: ${e.message}`]; }
      try { JSON.parse(readFileSync(schemaPath, "utf-8")); }
      catch { reasons.push("unparseable schemas/data_types.json"); }
      // Source integrity pin — reject placeholders / malformed hashes.
      if (typeof m.sourceHash !== "string" || !SHA256.test(m.sourceHash)) {
        reasons.push(`invalid/placeholder sourceHash: ${JSON.stringify(m.sourceHash)} (must be sha256:<64 hex>)`);
      }
      // Deny-by-default blacklist.
      if (m.blacklisted === true) reasons.push("plugin is blacklisted");
      // Governance tier.
      if (![1, 2, 3].includes(m.governanceTier)) reasons.push(`invalid governanceTier: ${JSON.stringify(m.governanceTier)}`);
      // Capabilities: must be a non-empty array, each on the allow-list.
      if (!Array.isArray(m.capabilities) || m.capabilities.length === 0) {
        reasons.push("capabilities missing or empty");
      } else {
        for (const c of m.capabilities) {
          if (!KNOWN_CAPS.has(c)) reasons.push(`unknown/unpermitted capability: ${JSON.stringify(c)}`);
        }
      }
      // Resource limits within ceilings.
      const rl = m.resourceLimits ?? {};
      for (const k of ["maxMemoryMB", "maxCpuCycles", "maxWallMs"]) {
        const v = rl[k];
        if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > CEILINGS[k])) {
          reasons.push(`resourceLimits.${k} out of range: ${JSON.stringify(v)} (1..${CEILINGS[k]})`);
        }
      }
      return reasons;
    }

    const plugins = readdirSync(pluginsDir);
    let clean = 0, denied = 0;
    for (const plugin of plugins) {
      const reasons = validatePlugin(plugin);
      if (reasons.length === 0) {
        console.log(`  [ADMITTED]  ${plugin}`);
        clean++;
      } else {
        console.log(`  [DENIED]    ${plugin}`);
        for (const r of reasons) console.log(`              ↳ ${r}`);
        denied++;
      }
    }
    console.log(`\n  ${clean} admitted · ${denied} denied\n`);
    process.exit(denied > 0 ? 1 : 0);
  }

  // ── logicn kb-graph — scan docs/Knowledge-Bases/ cross-reference graph ──────
  if (command === "kb-graph") {
    // #174: pass argv as an array with shell:false — never interpolate user input
    // into a shell string (the prior execSync concatenation was a command-injection sink).
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(
      process.execPath,
      ["packages-logicn/logicn-devtools-kb-graph/dist/cli.js", ...(rest.length ? rest : ["--all"])],
      { stdio: "inherit", cwd: process.cwd(), shell: false }
    );
    process.exit(r.status ?? 0);
  }

  // ── logicn ledger — #146 hash-linked compliance report over audit-egress ────
  if (command === "ledger") {
    // #174-safe: argv array + shell:false, no shell interpolation of user input.
    const { spawnSync } = await import("node:child_process");
    if (!rest[0]) {
      process.stderr.write("Usage: logicn ledger <egress-dir> [--json]\n");
      process.exit(1);
    }
    const r = spawnSync(
      process.execPath,
      ["packages-logicn/logicn-devtools-pci/dist/cli.js", "ledger", ...rest],
      { stdio: "inherit", cwd: process.cwd(), shell: false }
    );
    process.exit(r.status ?? 0);
  }

  // ── logicn new — scaffold an opinionated secure governed package (#176) ─────
  if (command === "new") {
    // #174-safe: argv array + shell:false. Delegates to the standalone scaffolder.
    const { spawnSync } = await import("node:child_process");
    if (!rest[0]) {
      process.stderr.write("Usage: logicn new <target-dir> [--name <pkg>]\n");
      process.exit(1);
    }
    const r = spawnSync(
      process.execPath,
      ["scripts/logicn-new.mjs", ...rest],
      { stdio: "inherit", cwd: process.cwd(), shell: false }
    );
    process.exit(r.status ?? 0);
  }

  // ── logicn bridge-attest — sign / verify bridge manifests (CF-3/CF-7) ───────
  if (command === "bridge-attest") {
    const tc = await import(new URL("packages-logicn/logicn-tower-citizen/dist/index.js", import.meta.url).href);
    const sub = rest[0];
    if (sub === "keygen") {
      const { publicKeyPem, privateKeyPem } = tc.generateAttestationKeypair();
      console.log("# Ed25519 bridge-attestation keypair");
      console.log("# Keep the private key offline; pin the public key in the deployment's attestation policy.\n");
      console.log(publicKeyPem.trim());
      console.log(privateKeyPem.trim());
      process.exit(0);
    }
    if (sub === "hash" && rest[1]) {
      const manifest = JSON.parse(readFileSync(rest[1], "utf8"));
      console.log(tc.attestationHash(manifest));
      process.exit(0);
    }
    if (sub === "sign" && rest[1] && rest[2]) {
      const manifest = JSON.parse(readFileSync(rest[1], "utf8"));
      const privateKeyPem = readFileSync(rest[2], "utf8");
      const attestation = tc.signManifest(manifest, privateKeyPem);
      console.log(JSON.stringify(attestation, null, 2));
      process.exit(0);
    }
    console.error("Usage: logicn bridge-attest keygen | hash <manifest.json> | sign <manifest.json> <privkey.pem>");
    process.exit(2);
  }

  // ── logicn diagnostic — run diagnostic fault-injection benchmark suite ──────
  if (command === "diagnostic") {
    // #174: argv array + shell:false (no shell-string interpolation of user argv).
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(
      process.execPath,
      ["packages-logicn/logicn-devtools-benchmarks/src/diagnostic-runner.mjs", ...rest],
      { stdio: "inherit", cwd: process.cwd(), shell: false }
    );
    process.exit(r.status ?? 0);
  }

  const m = await import(compilerPath);

  // ── //lln: whole-app refresh helpers (R&D 0045 — `deps --all` and the build auto-refresh) ──────
  // Recursively collect every .lln source under a root (skipping build/vendor dirs), then run a
  // CROSS-FILE flow analysis so USES/USEDBY/IMPACT span files (a flow called from another file is
  // never mislabelled "safe to delete"). Returns per-file rewrite results; `write:true` persists them.
  const collectLlnFiles = (root) => {
    const SKIP = new Set(["node_modules", "dist", "build", ".git", ".logicn"]);
    const out = [];
    const walk = (dir) => {
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p); }
        else if (e.isFile() && e.name.endsWith(".lln")) out.push(p);
      }
    };
    try {
      const st = statSync(root);
      if (st.isFile()) { if (root.endsWith(".lln")) out.push(root); }
      else walk(root);
    } catch { /* missing root → no files */ }
    return out;
  };
  const refreshGeneratedComments = (root, { write }) => {
    const FK = new Set(["pureFlowDecl", "flowDecl", "secureFlowDecl", "guardedFlowDecl"]);
    const files = [];
    const sources = new Map();
    let parseErrors = 0;
    for (const f of collectLlnFiles(root)) {
      try {
        const src = readFileSync(f, "utf8");
        const p = m.parseProgram(src, f);
        // Fail-closed: never rewrite a file whose program does not parse cleanly.
        if ((p.diagnostics ?? []).some(d => d.severity === "error")) { parseErrors++; continue; }
        files.push({ file: f, ast: p.ast });
        sources.set(f, src);
      } catch { parseErrors++; }
    }
    const { deps } = m.analyzeProgramFlowDependencies(files);
    const results = [];
    for (const { file, ast } of files) {
      const genMap = new Map();
      for (const child of ast.children ?? []) {
        if (!FK.has(child.kind) || !child.value) continue;
        const d = deps.get(child.value);
        if (d === undefined) continue;
        genMap.set(child.value, [...m.renderDependencyComments(d), ...m.renderComplexityComment(child)]);
      }
      if (genMap.size === 0) continue;
      const before = sources.get(file);
      const after = m.rewriteGeneratedComments(before, genMap);
      const changed = after !== before;
      if (write && changed) writeFileSync(file, after);
      results.push({ file, flows: genMap.size, changed, genMap });
    }
    return { results, parseErrors, parsedCount: files.length };
  };

  // ── Package build mode: `logicn build --package <dir>` (#175, design-doc §11)
  // Compiles a package's /src entry (with its `import ./*.lln` DAG, #94) into one
  // governed, signed .wasm + .lmanifest written INTO the package's dist/, plus a
  // <name>.fuse.json fusion descriptor — ready to be FUSED into a host App Kernel.
  let packageBuild = null;
  let packageDescriptor = null;
  let llnFile = rest[0];
  {
    const pkgIdx = command === "build" ? rest.indexOf("--package") : -1;
    if (pkgIdx >= 0) {
      const pkgDir = rest[pkgIdx + 1];
      if (!pkgDir) { console.error("Error: --package requires a directory path"); process.exit(1); }
      const descPath = join(pkgDir, "package.lln.json");
      if (!existsSync(descPath)) { console.error(`Error: missing package descriptor: ${descPath}`); process.exit(1); }
      try { packageDescriptor = JSON.parse(readFileSync(descPath, "utf8")); }
      catch (e) { console.error(`Error: invalid package.lln.json — ${e.message}`); process.exit(1); }
      if (!packageDescriptor.name) { console.error('Error: package.lln.json must declare a "name"'); process.exit(1); }
      packageBuild = pkgDir;
      llnFile = join(pkgDir, packageDescriptor.entry || "src/index.lln");
    }
  }

  // ── logicn deps --all [dir] [--write] — refresh //lln: across EVERY .lln file in the app ──────
  // Cross-file: builds one whole-program flow graph so USES/USEDBY/IMPACT span files. Without
  // --write it prints a per-file preview; with --write it rewrites each file's //lln: block in place
  // (machine-owned tier, R&D 0045 #3 — touches only //lln: lines). Default root = the --package dir,
  // else a positional path, else the current directory. Must run BEFORE the single-file read below.
  if (command === "deps" && rest.includes("--all")) {
    const dirArg = rest.find(a => !a.startsWith("--"));
    const root = packageBuild ?? dirArg ?? ".";
    const write = rest.includes("--write");
    const check = rest.includes("--check");
    // --check never writes (even if --write is also passed) — it is the CI staleness GATE.
    const { results, parseErrors, parsedCount } = refreshGeneratedComments(root, { write: write && !check });
    if (check) {
      // A file whose generated block WOULD change is stale (the don't-trust-check rule applied to
      // the tool's own output). Exit non-zero so CI fails when someone forgot to refresh.
      const stale = results.filter(r => r.changed);
      for (const r of stale) console.log(`✗ ${r.file}: //lln: is STALE`);
      if (stale.length > 0) {
        console.log(`\n${stale.length}/${results.length} file(s) have stale //lln: metadata — run: logicn deps --all --write`);
        process.exit(1);
      }
      console.log(`✓ //lln: metadata current across ${parsedCount} file(s).`);
      process.exit(0);
    }
    if (write) {
      let changed = 0;
      for (const r of results) if (r.changed) { changed++; console.log(`✅ ${r.file}: refreshed //lln: on ${r.flows} flow(s)`); }
      console.log(`\n${changed}/${results.length} file(s) updated across ${parsedCount} parsed file(s)${parseErrors ? `, ${parseErrors} skipped (parse errors)` : ""}.`);
    } else {
      for (const r of results) {
        console.log(`# ${r.file}`);
        for (const [flow, lines] of r.genMap) { console.log(`flow ${flow}`); for (const l of lines) console.log(`  ${l}`); }
      }
      console.log(`\n(${parsedCount} file(s) analysed${parseErrors ? `, ${parseErrors} skipped` : ""}; re-run with --write to apply.)`);
    }
    process.exit(0);
  }

  // ── logicn fuse <dir...> — compose multiple built packages (R&D 0052 Phase A) ─────────────────
  // Host-links a SET of `logicn build --package` outputs: packages can live OUTSIDE the app as
  // separate signed .wasm and be wired at admission. Fail-closed (set-signed, deny-by-default,
  // acyclic). First-party/trusted only (shared memory; isolation is Phase B). Prints the resolved
  // composition; `--invoke <pkg>:<export>` runs an entry. Must run BEFORE the single-file read.
  if (command === "fuse") {
    let allowUnsigned = false, governanceDir, invokeSpec;
    const dirs = [];
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === "--allow-unsigned") allowUnsigned = true;
      else if (a === "--governance-dir") governanceDir = rest[++i];
      else if (a === "--invoke") invokeSpec = rest[++i];
      else if (!a.startsWith("--")) dirs.push(a);
    }
    if (dirs.length === 0) { console.error("Error: logicn fuse needs one or more package directories"); process.exit(1); }
    const ak = await import(new URL("packages-logicn/logicn-framework-app-kernel/dist/index.js", import.meta.url).href);
    try {
      const opts = { allowUnsigned, warn: (msg) => console.warn(`  ⚠ ${msg}`) };
      if (governanceDir) opts.governanceDir = governanceDir;
      const components = await ak.fusePackages(dirs, opts);
      console.log(`✅ Fused ${components.size} package(s) (host-linked, first-party):`);
      for (const [name, c] of components) {
        console.log(`   - ${name}  seam=${c.seam ?? "—"}  capabilities=[${[...c.capabilities].join(", ")}]`);
      }
      if (invokeSpec) {
        const [pkg, exp] = invokeSpec.split(":");
        const comp = components.get(pkg);
        if (!comp) { console.error(`Error: no fused package named '${pkg}' (have: ${[...components.keys()].join(", ")})`); process.exit(1); }
        console.log(`   invoke ${pkg}:${exp} → ${comp.invoke(exp)}`);
      }
      process.exit(0);
    } catch (e) {
      console.error(`❌ ${e.message}`); // fail-closed LLN-FUSE-* codes
      process.exit(1);
    }
  }

  if (!llnFile) { console.error("Error: no .lln file specified"); process.exit(1); }

  const source = readFileSync(llnFile, "utf8");
  const parsed = m.parseProgram(source, llnFile);
  const errors = (parsed.diagnostics ?? []).filter(d => d.severity === "error");

  // ── logicn infer — run a governed AI inference from a flow's ai {} contract ──
  // The Governed Inference Tower seam: reads the flow's `ai {}` block (approved
  // models, governance tier, call budget), builds the Hybrid Inference Engine
  // (Brain) wired to the BitNet CPU bridge (Brawn) from logicn-ext-bridge-cpp,
  // runs one governed inference, prints the receipt and writes the audit ledger.
  if (command === "infer") {
    const flag = (name, def) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : def; };
    const flowName = flag("--invoke", parsed.flows[0]?.name);
    const prompt = flag("--prompt", "Summarise the input document under governance.");
    let model = flag("--model", undefined);

    // Extract the `ai {}` contract sub-block for the target flow from the AST.
    const extractAiBlock = (ast, targetFlow) => {
      const out = { approvedModels: undefined, governanceTier: undefined, maxModelCalls: undefined, maxTokenCost: undefined };
      const flow = (ast.children ?? []).find(c => /FlowDecl$/.test(c.kind ?? "") && c.value === targetFlow)
        ?? (ast.children ?? []).find(c => /FlowDecl$/.test(c.kind ?? ""));
      if (!flow) return out;
      const contract = (flow.children ?? []).find(c => c.kind === "contractDecl");
      if (!contract) return out;
      const aiBlock = (contract.children ?? []).find(c => c.value === "ai:block");
      if (!aiBlock) return out;
      for (const child of aiBlock.children ?? []) {
        const v = String(child.value ?? "");
        if (v === "approved_models:block") {
          const models = (child.children ?? [])
            .flatMap(d => String(d.value ?? "").replace(/^decl:/, "").split(/\s+/))
            .filter(Boolean);
          if (models.length) out.approvedModels = models;
        } else if (v.startsWith("decl:")) {
          const body = v.replace(/^decl:/, "").split(";;")[0].trim(); // drop trailing govComment
          const [key, ...vals] = body.split(/\s+/);
          if (key === "governance_tier") {
            const t = parseInt(String(vals[0] ?? "").replace(/[^0-9]/g, ""), 10);
            if (t >= 1 && t <= 3) out.governanceTier = t;
          } else if (key === "max_model_calls") {
            const n = parseInt(vals[0] ?? "", 10);
            if (Number.isFinite(n)) out.maxModelCalls = n;
          } else if (key === "max_token_cost") {
            out.maxTokenCost = vals.join("").replace(/\s+/g, "");
          }
        }
      }
      return out;
    };

    const ai = extractAiBlock(parsed.ast, flowName);
    if (!model && ai.approvedModels?.length) model = ai.approvedModels[0];
    const tier = ai.governanceTier ?? 1;

    // Brain (engine) + Brawn (cpp BitNet bridge registry).
    const tc = await import(new URL("packages-logicn/logicn-tower-citizen/dist/index.js", import.meta.url).href);
    let registry;
    try {
      const cpp = await import(new URL("packages-logicn/logicn-ext-bridge-cpp/dist/index.js", import.meta.url).href);
      registry = cpp.createCppBridgeRegistry();
    } catch { registry = undefined; } // fall back to the in-package stub registry

    const engine = tc.createHybridEngine({
      governanceTier: tier,
      airGapped: tier === 1,
      ...(registry ? { bridges: registry } : {}),
      governance: {
        ...(ai.approvedModels ? { approvedModels: ai.approvedModels } : {}),
        ...(ai.maxModelCalls !== undefined ? { maxModelCalls: ai.maxModelCalls } : {}),
      },
    });

    const correlationId = `INFER-${flowName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const receipt = await engine.infer({ prompt, correlationId, ...(model ? { model } : {}) });

    console.log(`\n  Governed Inference — ${flowName}  (${llnFile})`);
    console.log("  ─────────────────────────────────────────────");
    console.log(`  governance_tier:   tier-${tier} ${tier === 1 ? "(air-gapped CPU · BitNet ternary)" : tier === 2 ? "(cloud)" : "(Blackwell GPU)"}`);
    console.log(`  approved_models:   ${ai.approvedModels ? ai.approvedModels.join(", ") : "(unrestricted)"}`);
    console.log(`  model invoked:     ${model ?? "(none specified)"}`);
    console.log(`  max_model_calls:   ${ai.maxModelCalls ?? "(unbounded)"}`);
    if (ai.maxTokenCost) console.log(`  max_token_cost:    ${ai.maxTokenCost}`);
    console.log("  ─────────────────────────────────────────────");
    if (receipt.trapFired) {
      console.log(`  ❌ TRAP: ${receipt.trapCode} — inference denied at the governance boundary (no compute ran)`);
    } else {
      console.log(`  ✅ ${receipt.text}`);
      console.log(`  engines blended:   ${receipt.enginesBlended.join(" + ")}`);
      console.log(`  bridges executed:  ${receipt.bridgesUsed.join(", ") || "(host-native only)"}`);
      console.log(`  executed natively: ${receipt.executedNatively} ${receipt.executedNatively ? "" : "(deterministic simulator — native addon not compiled)"}`);
      console.log(`  ternary checksum:  ${receipt.ternaryChecksum}  (bit-identical across CPU/GPU/photonic)`);
      console.log(`  avg bits/weight:   ${receipt.avgBitsPerWeight}`);
      console.log(`  latency:           ${receipt.latencyMs}ms`);
    }

    // Append-only audit ledger (one JSONL per inference, like the tower-log journal).
    try {
      const events = engine.getAudit().query({ correlationId });
      mkdirSync("build/tower-logs", { recursive: true });
      const ledgerPath = `build/tower-logs/infer-${correlationId}.jsonl`;
      writeFileSync(ledgerPath, events.map(e => JSON.stringify(e)).join("\n") + "\n");
      console.log(`  audit ledger:      ${ledgerPath} (${events.length} events)\n`);
    } catch { /* non-fatal */ }

    process.exit(receipt.trapFired ? 1 : 0);
  }

  // ── logicn deps — graph the app's flow→flow call graph (R&D 0045 //@ vocabulary) ──────────────
  // Read-only. Prints, per flow, the generated //@USES (upstream callees) / //@USEDBY (downstream
  // "dependants") / //@IMPACT (transitive blast-radius; 0 = safe to delete) comment lines. Does NOT
  // modify source — the source-writer (inject the //@ lines into the file) is a later phase. Scope
  // to one flow with `--flow <name>`.
  if (command === "deps") {
    if (errors.length > 0) {
      errors.forEach(d => console.log(`❌ ${d.code}: ${d.message}`));
      process.exit(1);
    }
    const depMap = m.analyzeFlowDependencies(parsed.ast);
    const FK = new Set(["pureFlowDecl", "flowDecl", "secureFlowDecl", "guardedFlowDecl"]);
    const flowNodeByName = new Map();
    for (const child of parsed.ast.children ?? []) {
      if (FK.has(child.kind) && child.value) flowNodeByName.set(child.value, child);
    }
    const flagIdx = rest.indexOf("--flow");
    const only = flagIdx >= 0 ? rest[flagIdx + 1] : undefined;
    if (only !== undefined && !depMap.has(only)) {
      console.error(`Error: no flow named '${only}' in ${llnFile}`);
      process.exit(1);
    }
    const names = only !== undefined ? [only] : [...depMap.keys()];

    // Build the generated //lln: lines per flow (USES/USEDBY/IMPACT + COMPLEXITY).
    const genLines = new Map();
    for (const name of names) {
      const d = depMap.get(name);
      if (d === undefined) continue;
      const lines = [...m.renderDependencyComments(d)];
      const node = flowNodeByName.get(name);
      if (node !== undefined) lines.push(...m.renderComplexityComment(node));
      genLines.set(name, lines);
    }

    // ── --write: silently overwrite the //lln: block above each flow IN THE SOURCE (R&D 0045 #3) ──
    // Touches ONLY //lln: lines — removes the old contiguous //lln: block immediately above each flow
    // declaration and inserts the fresh block; never modifies a human // line, a contract, or any code.
    // Processes bottom-up so line indices stay valid. Fail-closed: parse errors already exited above.
    if (rest.includes("--write")) {
      const out = m.rewriteGeneratedComments(source, genLines);
      if (out !== source) {
        writeFileSync(llnFile, out);
        console.log(`✅ ${llnFile}: refreshed //lln: metadata on ${genLines.size} flow(s)`);
      } else {
        console.log(`✓ ${llnFile}: //lln: metadata already current (${genLines.size} flow(s))`);
      }
      process.exit(0);
    }

    if (names.length === 0) console.log(`(${llnFile}: no flows)`);
    for (const name of names) {
      const lines = genLines.get(name);
      if (lines === undefined) continue;
      console.log(`flow ${name}`);
      for (const line of lines) console.log(`  ${line}`);
    }
    process.exit(0);
  }

  if (command === "check") {
    const fx = m.checkEffects(parsed.flows, parsed.ast);
    const gov = m.verifyGovernance(parsed.ast, parsed.flows, fx, "production");
    const allDiags = [...errors, ...gov.diagnostics];
    if (allDiags.length === 0) {
      console.log(`✅ ${llnFile}: 0 errors, 0 governance warnings`);
    } else {
      allDiags.forEach(d => console.log(`${d.severity === "error" ? "❌" : "⚠️"} ${d.code}: ${d.message}`));
    }

    // ── --diff flag: show change class vs HEAD~1 before pushing (#64) ─────────
    // Lets developers see governance impact before git push. Equivalent to running
    // `logicn diff HEAD~1` but scoped to a single file.
    if (rest.includes("--diff")) {
      try {
        const { spawnSync } = await import("node:child_process");
        const { diffGovernance, renderGovernanceDiff } = await import(
          new URL("packages-logicn/logicn-core-compiler/dist/governance-diff.js", import.meta.url).href
        );
        // Get the HEAD~1 version of this file from git
        const gitResult = spawnSync("git", ["show", `HEAD~1:${llnFile}`],
          { encoding: "utf8", cwd: process.cwd() });
        if (gitResult.status === 0) {
          const prevSource = gitResult.stdout;
          const prevParsed = m.parseProgram(prevSource, llnFile);
          const diff = diffGovernance(prevParsed.flows, parsed.flows);
          console.log("\n── Governance diff (HEAD~1 → current) ──");
          console.log(renderGovernanceDiff(diff));
          if (diff.changeClass === "expansion") {
            console.log("⚠️  EXPANSION — 2 reviewers required (security/governance owner)");
          } else if (diff.changeClass === "experimental") {
            console.log("🔴 EXPERIMENTAL — architecture review required");
          } else {
            console.log(`✅ Change class: ${diff.changeClass.toUpperCase()}`);
          }
        } else {
          console.log("\n── Governance diff: no HEAD~1 version found (new file)");
        }
      } catch { /* non-fatal */ }
    }

    process.exit(errors.length > 0 ? 1 : 0);
  }

  // ── logicn gen-tests <file.lln> [--tap] — contract-driven test obligations (0016) ──
  // Derives the fail-closed test obligations a flow's contract implies, across all five
  // generator dimensions (fault-injection / effect-egress / capability-denial / boundary /
  // substrate-violation), from the flow GIR. --tap prints a TAP plan for the fault dimension.
  if (command === "gen-tests") {
    const fx = m.checkEffects(parsed.flows, parsed.ast);
    const gir = m.emitGIR(parsed.ast, parsed.flows, fx).gir;
    const suite = m.generateContractTestSuite(gir.flows);
    const dims = [
      ["fault-injection",     suite.faultInjection],
      ["effect-egress",       suite.effectEgress],
      ["capability-denial",   suite.capabilityDenial],
      ["boundary/fuzz",       suite.boundary],
      ["substrate-violation", suite.substrateViolation],
    ];
    const total = dims.reduce((n, [, c]) => n + c.length, 0);
    console.log(`\n🧪 Contract-driven test obligations — ${llnFile}`);
    console.log(`   ${total} obligation(s) across ${gir.flows.length} flow(s) · 5 dimensions`);
    for (const [name, cases] of dims) {
      console.log(`\n── ${name} (${cases.length}) ──`);
      for (const c of cases) console.log(`  • ${c.id}\n      ${c.assertion}`);
    }
    if (rest.includes("--tap")) {
      console.log("\n" + m.renderFaultInjectionTAP(suite.faultInjection));
    }
    process.exit(0);
  }

  // ── logicn manifest-to-dot — export manifest DAG as Graphviz DOT ────────────
  if (command === "manifest-to-dot") {
    const name = basename(llnFile, ".lln");
    const manifestPath = `build/${name}.lmanifest`;
    if (!existsSync(manifestPath)) {
      console.error(`❌ No manifest at ${manifestPath}. Run 'logicn build ${llnFile}' first.`);
      process.exit(1);
    }
    try {
      const { decodeCBOR } = await import(
        new URL("packages-logicn/logicn-core-compiler/dist/manifest-generator.js", import.meta.url).href
      );
      const manifestBytes = new Uint8Array(readFileSync(manifestPath));
      const { value: manifest } = decodeCBOR(manifestBytes);
      const EFFECT_BIT_NAMES = { 0:"network.outbound", 1:"storage.write", 2:"secret.access", 3:"audit.write", 4:"database.write", 5:"ai.inference", 6:"shell.execute", 7:"native.call" };
      const allowedMask = manifest.policyResolutionDag?.allowedEffects ?? 0;
      const deniedMask  = manifest.policyResolutionDag?.deniedEffects  ?? 0;
      let dot = `digraph "${name}_manifest" {\n`;
      dot += `  graph [label="${name}.lmanifest — PolicyResolutionDAG\\nallowed=${allowedMask.toString(2).padStart(8,"0")} denied=${deniedMask.toString(2).padStart(8,"0")}" fontsize=12 labelloc=t]\n`;
      dot += `  node [shape=box fontname="Courier" fontsize=10]\n  rankdir=LR\n\n`;
      // Capability nodes
      for (let bit = 0; bit <= 7; bit++) {
        const effName = EFFECT_BIT_NAMES[bit];
        const allowed = (allowedMask >> bit) & 1;
        const denied  = (deniedMask  >> bit) & 1;
        const color = denied ? "lightcoral" : allowed ? "lightgreen" : "lightgray";
        dot += `  cap_${bit} [label="${effName}\\nbit${bit}${allowed?" ✓":denied?" ✗":" —"}" style=filled fillcolor=${color}]\n`;
      }
      // Flow nodes
      dot += `\n`;
      for (const ob of manifest.proofObligations ?? []) {
        const fid = (ob.flowName ?? "f").replace(/[^a-zA-Z0-9_]/g, "_");
        const desc = ob.description ?? "";
        const em = desc.match(/effects \[([^\]]*)\]/);
        const effs = em ? em[1].split(",").map(e=>e.trim()).filter(Boolean) : [];
        const isNet = effs.some(e=>e.startsWith("network"));
        const isMut = effs.some(e=>e.includes(".write")||e.includes(".mutate"));
        const col = isNet?"lightcoral":isMut?"lightyellow":"lightblue";
        dot += `  f_${fid} [label="${ob.flowName}\\n${effs.length} effect(s)" style=filled fillcolor=${col}]\n`;
        for (const eff of effs) {
          for (let bit=0; bit<=7; bit++) {
            if (EFFECT_BIT_NAMES[bit]===eff || eff.startsWith((EFFECT_BIT_NAMES[bit]??"").split(".")[0])) {
              dot += `  f_${fid} -> cap_${bit} [color=gray]\n`;
            }
          }
        }
      }
      // Topology nodes
      dot += `\n  dag_valid [label="dag_edge_valid\\nbit 8\\n(Topology FIRST)" style=filled fillcolor=gold shape=diamond]\n`;
      dot += `  quarantine [label="quarantine_engaged\\nbit 30" style=filled fillcolor=orange]\n`;
      dot += `  emergency_node [label="emergency_mode\\nbit 31" style=filled fillcolor=red fontcolor=white]\n`;
      dot += `  dag_valid -> quarantine [style=dashed label="violation"]\n`;
      dot += `  quarantine -> emergency_node [style=dashed label="escalate"]\n`;
      dot += `}\n`;
      const dotPath = `build/${name}.dot`;
      writeFileSync(dotPath, dot);
      console.log(`✅ ${dotPath} written`);
      console.log(`\nRender: dot -Tsvg ${dotPath} > build/${name}.svg`);
      console.log(`Colours: 🔴 network | 🟡 mutation | 🔵 pure | 🟢 allowed cap | ⬜ inactive cap`);
    } catch (e) { console.error(`❌ DOT generation failed: ${e.message}`); process.exit(1); }
    return;
  }

  // ── logicn init-env — validate capabilities against root governance policy (#65) ─
  // Scans all .lln files in /governance/ (or current directory) and validates
  // each flow's effects against the declared domain guard policy ceilings.
  // Used at CI start to establish a clean baseline before diffing.
  if (command === "init-env") {
    const { spawnSync } = await import("node:child_process");
    const { readdirSync } = await import("node:fs");
    const governanceDir = existsSync("governance") ? "governance" : ".";
    let allFlows = 0, violations = 0;
    const scanDir = (dir) => {
      try {
        return readdirSync(dir).filter(f => f.endsWith(".lln")).map(f => `${dir}/${f}`);
      } catch { return []; }
    };
    const policyFiles = scanDir(governanceDir);
    const flowFiles = [...scanDir("flows"), ...scanDir("examples"), ...scanDir("tests/patterns")];
    console.log(`logicn init-env — validating ${flowFiles.length} flow file(s) against ${policyFiles.length} policy file(s)`);
    for (const file of flowFiles.slice(0, 20)) { // limit to first 20 for now
      try {
        const src = readFileSync(file, "utf8");
        const p = m.parseProgram(src, file);
        const fx = m.checkEffects(p.flows, p.ast);
        const g = m.verifyGovernance(p.ast, p.flows, fx, "dev");
        allFlows += p.flows.length;
        const errs = g.diagnostics.filter(d => d.severity === "error");
        if (errs.length > 0) {
          violations += errs.length;
          errs.forEach(d => console.log(`  ❌ ${file}: ${d.code} — ${d.message.slice(0, 80)}`));
        }
      } catch { /* skip unparseable */ }
    }
    if (violations === 0) {
      console.log(`✅ init-env: ${allFlows} flows, 0 violations — clean baseline`);
    } else {
      console.log(`⚠️  init-env: ${allFlows} flows, ${violations} violation(s) found — review before diffing`);
    }
    return;
  }

  // ── logicn verify — DRCM Phase 3 admission gate (#37) ──────────────────────
  // Verifies the .lmanifest for a compiled .lln file:
  //   1. Checks the manifest exists (build/<name>.lmanifest)
  //   2. Decodes the binary CBOR manifest
  //   3. Computes SHA-256 of the source and compares to manifest.sourceHash
  //   4. Verifies CBOR round-trip (canonical encoding)
  //
  // LLN-MANIFEST-TAMPER: sourceHash mismatch — binary may have been modified
  // LLN-MANIFEST-MISSING: no .lmanifest found for this source file
  // ── logicn budget ─────────────────────────────────────────────────────────
  // Shows the auto-computed assimilation_memory_budget for this machine.
  // Helps developers understand what boot.lln `auto` will resolve to.
  if (command === "budget") {
    const totalMB = Math.round(totalmem() / (1024 * 1024));
    const freeMB  = Math.round(freemem()  / (1024 * 1024));
    const autoBudget = computeAutoAssimilationBudgetMB();

    console.log(`\n  🏰 LogicN Assimilation Memory Budget`);
    console.log(`  ─────────────────────────────────────`);
    console.log(`  Total RAM:          ${totalMB} MB`);
    console.log(`  Available RAM:      ${freeMB} MB`);
    console.log(`  Auto budget (20%):  ${Math.round(freeMB * 0.20)} MB (before ceiling)`);
    console.log(`  Resolved budget:    ${autoBudget} MB  ← what 'auto' uses`);
    console.log();
    console.log(`  boot.lln options:`);
    console.log(`    governance { assimilation_memory_budget: auto }        → ${autoBudget} MB`);
    console.log(`    governance { assimilation_memory_budget: auto max 50MB } → ${computeAutoAssimilationBudgetMB(50)} MB`);
    console.log(`    governance { }                                          → ${autoBudget} MB (omitted = auto)`);
    console.log(`    governance { assimilation_memory_budget: 100MB }       → 100 MB (explicit)`);
    console.log();
    console.log(`  Ceiling tiers: <4GB RAM → 50MB · 4–16GB → 128MB · >16GB → 256MB\n`);
    process.exit(0);
  }

  if (command === "verify") {
    const name = basename(llnFile, ".lln");
    const manifestPath = `build/${name}.lmanifest`;
    if (!existsSync(manifestPath)) {
      console.error(`❌ LLN-MANIFEST-MISSING: No manifest found at ${manifestPath}`);
      console.error(`   Run 'logicn build ${llnFile}' first to generate the manifest.`);
      process.exit(1);
    }
    try {
      const { decodeCBOR, encodeCBOR } = await import(
        new URL("packages-logicn/logicn-core-compiler/dist/manifest-generator.js", import.meta.url).href
      );
      const manifestBytes = new Uint8Array(readFileSync(manifestPath));
      const { value: manifest } = decodeCBOR(manifestBytes);

      // Check 1: sourceHash
      const actualHash = "sha256:" + createHash("sha256").update(source, "utf8").digest("hex");
      if (manifest.sourceHash !== actualHash) {
        console.error(`❌ LLN-MANIFEST-TAMPER: Source hash mismatch for '${llnFile}'`);
        console.error(`   Manifest has: ${manifest.sourceHash}`);
        console.error(`   Current file: ${actualHash}`);
        console.error(`   The source has been modified since the manifest was generated.`);
        console.error(`   Rebuild with: logicn build ${llnFile}`);
        process.exit(1);
      }

      // Check 2: CBOR round-trip canonicality
      const reEncoded = encodeCBOR(manifest);
      const canonical = manifestBytes.length === reEncoded.length &&
        manifestBytes.every((b, i) => b === reEncoded[i]);
      if (!canonical) {
        console.error(`❌ LLN-MANIFEST-NONCANONICAL: CBOR round-trip failed — manifest is non-canonical`);
        process.exit(1);
      }

      // Check 3: schema version
      if (manifest.schemaVersion !== "lln.manifest.v1") {
        console.error(`❌ LLN-MANIFEST-VERSION: Unknown schema version '${manifest.schemaVersion}'`);
        process.exit(1);
      }

      const proofCount = manifest.proofObligations?.length ?? 0;
      const constraintCount = manifest.derivedConstraints?.length ?? 0;
      console.log(`✅ ${llnFile}: manifest verified`);
      console.log(`   Source hash:         ${actualHash.slice(0, 30)}...`);
      console.log(`   CBOR size:           ${manifestBytes.length}B (canonical ✅)`);
      console.log(`   Schema version:      ${manifest.schemaVersion}`);
      console.log(`   Flow count:          ${manifest.flowCount}`);
      console.log(`   Proof obligations:   ${proofCount}`);
      console.log(`   Derived constraints: ${constraintCount}`);

      // ── Signature verification (#109) ────────────────────────────────────────
      // Stage A: Ed25519-SHA256 (Node.js native crypto)
      // Stage B: ML-DSA-65 (NIST FIPS 204) — upgrade once Node.js adds FIPS 204 support
      // Signature is stored in the .lmanifest.json (human-readable counterpart)
      const jsonManifestPath = `build/${name}.lmanifest.json`;
      if (existsSync(jsonManifestPath)) {
        try {
          const jsonManifestRaw = readFileSync(jsonManifestPath, "utf-8");
          const jsonManifest = JSON.parse(jsonManifestRaw);

          if (jsonManifest.governanceSignature && typeof jsonManifest.governanceSignature === "object") {
            const sig = jsonManifest.governanceSignature;

            if (sig.algorithm && sig.keyId && sig.signature) {
              // ── Key revocation pre-check (Gap B, zero-trust v(k) mandate) ──
              // A revoked key id is Deny even with a valid signature. The registry
              // is tamper-evident: fail closed if it is signed-but-invalid (edited
              // without re-signing) or unreadable; warn (but still enforce) while
              // it is unsigned.
              try {
                const reg = await import("./governance/revocation-registry.mjs");
                const trust = reg.assertRegistryTrustworthy("."); // throws on tamper / revoked signer
                if (trust.present && !trust.signed) {
                  console.warn(`   ⚠️  LLN-REVOCATION-UNSIGNED: governance/revocations.json is not signed (tamperable) — run: node governance/sign-revocations.mjs`);
                }
                if (reg.isKeyRevoked(sig.keyId)) {
                  console.error(`❌ LLN-MANIFEST-REVOKED-KEY: manifest signed by REVOKED key ${sig.keyId} — fail-closed (Deny). See security/revocations/REV-2026-06.md`);
                  process.exit(1);
                }
              } catch (revErr) {
                console.error(`❌ LLN-REVOCATION-REGISTRY: revocation registry untrustworthy — fail-closed (cannot confirm key is not revoked): ${revErr.message}`);
                process.exit(1);
              }
              // Look for the public key file
              const pubKeyPath = join("governance", `signing-key-${sig.keyId}.pub.pem`);
              if (existsSync(pubKeyPath)) {
                try {
                  const { verify: cryptoVerify, createPublicKey } = await import("node:crypto");
                  const pubKeyPem = readFileSync(pubKeyPath, "utf-8");
                  const publicKey = createPublicKey(pubKeyPem);

                  // Reconstruct the manifest without the signature field for verification
                  // (mirrors what was signed: prettyManifest(manifest) before signing was applied)
                  const { governanceSignature: _sig, ...manifestWithoutSig } = jsonManifest;
                  const manifestForVerification = JSON.stringify(manifestWithoutSig, null, 2);

                  // Ed25519 uses deterministic signing — pass null as algorithm (per RFC 8032)
                  const valid = cryptoVerify(null, Buffer.from(manifestForVerification), publicKey, Buffer.from(sig.signature, "base64"));

                  if (valid) {
                    console.log(`   🔐 Signature verified (${sig.algorithm}, keyId: ${sig.keyId.slice(0, 8)}...)`);
                  } else {
                    console.error(`❌ LLN-MANIFEST-TAMPER: Signature verification FAILED — manifest may be tampered`);
                    process.exit(1);
                  }
                } catch (err) {
                  console.warn(`   ⚠️  Signature verification error: ${err.message}`);
                }
              } else {
                console.warn(`   ⚠️  Public key not found: ${pubKeyPath} — skipping signature verification`);
              }
            }
          } else if (jsonManifest.governanceSignature === "placeholder") {
            console.log(`   ℹ️  Manifest is unsigned (placeholder). Run: logicn keygen && logicn build`);
          }
        } catch (err) {
          console.warn(`   ⚠️  Could not read .lmanifest.json for signature check: ${err.message}`);
        }
      } else {
        console.log(`   ℹ️  No .lmanifest.json found — signature check skipped`);
      }
    } catch (e) {
      console.error(`❌ LLN-MANIFEST-INVALID: Failed to parse manifest — ${e.message}`);
      process.exit(1);
    }
    return;
  }

  if (errors.length > 0) {
    errors.forEach(e => console.error(`❌ ${e.code}: ${e.message}`));
    process.exit(1);
  }

  // ── Admission gate check for run command ─────────────────────────────────
  // Before executing, verify the source matches its manifest (if one exists).
  // This is the Stage A equivalent of the DSS.wasm admission check in Phase 5.
  if (command === "run") {
    const name = basename(llnFile, ".lln");
    const manifestPath = `build/${name}.lmanifest`;
    if (existsSync(manifestPath)) {
      try {
        const { decodeCBOR } = await import(
          new URL("packages-logicn/logicn-core-compiler/dist/manifest-generator.js", import.meta.url).href
        );
        const manifestBytes = new Uint8Array(readFileSync(manifestPath));
        const { value: manifest } = decodeCBOR(manifestBytes);
        const actualHash = "sha256:" + createHash("sha256").update(source, "utf8").digest("hex");
        if (manifest.sourceHash && manifest.sourceHash !== actualHash) {
          console.error(`❌ LLN-MANIFEST-TAMPER: Source has changed since manifest was signed.`);
          console.error(`   Manifest: ${manifest.sourceHash}`);
          console.error(`   Current:  ${actualHash}`);
          console.error(`   Rebuild with: logicn build ${llnFile}`);
          process.exit(1);
        }
      } catch { /* non-fatal if manifest is unreadable */ }
    }

    // ── #125 secure-flow-run — run secure/effectful flows through the GOVERNED runtime ──
    // The raw WASM `--invoke` surface (below) only exports PURE flows returning a primitive.
    // Secure/effectful flows (effects, secrets, Result/Void returns) — and any flow the WASM
    // emitter can't yet lower — must run through the full governed pipeline: m.run() builds a
    // ContractEnforcer from the contract + a FAIL-CLOSED CapabilityHost granting ONLY the flow's
    // declared effects, then executes with audit + proof chain. `--governed` routes here and
    // returns BEFORE WASM assembly (which a secure flow may not compile through at all).
    if (rest.includes("--governed")) {
      const gflag = (n, d) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : d; };
      const gflow = gflag("--invoke", parsed.flows[0]?.name);
      const gmeta = (parsed.flows ?? []).find(f => f.name === gflow);
      if (!gmeta) {
        console.error(`No flow named '${gflow}'. Declared: ${(parsed.flows ?? []).map(f => f.name).join(", ") || "(none)"}`);
        process.exit(1);
      }
      // Marshal positional args to the flow's NAMED params (param text is "readonly x: T" / "n: Int"
      // / "n" — take the identifier before ':', last token strips qualifiers). Fail loud on junk.
      const gparamNames = (gmeta.params ?? []).map(p => {
        const toks = String(p).split(":")[0].trim().split(/\s+/);
        return toks[toks.length - 1];
      });
      const invokeAt = rest.indexOf("--invoke");
      const gposArgs = (invokeAt >= 0 ? rest.slice(invokeAt + 2) : []).filter(a => a !== "--governed");
      const gargs = new Map();
      gposArgs.forEach((a, i) => {
        const name = gparamNames[i];
        if (name === undefined) return; // extra positional arg with no param — ignore (flow decides)
        let v;
        if (a === "true") v = { __tag: "bool", value: true };
        else if (a === "false") v = { __tag: "bool", value: false };
        else if (a.trim() !== "" && Number.isFinite(Number(a))) v = { __tag: "int", value: Number(a) };
        else v = { __tag: "string", value: a };
        gargs.set(name, v);
      });

      const gres = await m.run(source, llnFile, gflow, gargs, { mode: "dev" });

      for (const d of gres.diagnostics ?? []) if (d.severity === "error") console.error(`  ✗ ${d.code}: ${d.message}`);
      for (const g of gres.governanceDiagnostics ?? []) if (g.severity === "error") console.error(`  ⛔ ${g.code}: ${g.message}`);

      if (!gres.ok) {
        console.error(`\n❌ Governed run of '${gflow}' FAILED (fail-closed) — see the LLN-* diagnostics above.`);
        process.exit(1);
      }

      const render = (val) => {
        if (!val) return "(void)";
        switch (val.__tag) {
          case "int": case "byte": case "float": return String(val.value);
          case "bool": return val.value ? "true" : "false";
          case "string": return JSON.stringify(val.value);
          case "void": return "(void)";
          case "runtimeError": case "error": return `<error: ${val.message ?? "runtime error"}>`;
          default: return JSON.stringify(val.value ?? val.__tag);
        }
      };
      const gexec = gres.execution;
      const geffects = gexec?.audit?.effectsObserved ?? gexec?.effectsObserved ?? [];
      console.log(render(gres.value));
      console.log(`\n🛡  governed · flow=${gflow} · tier=${gexec?.executionTier ?? "tree"} · effects=[${geffects.join(", ")}]`);
      return;
    }
  }

  // Compile to WASM
  const fx = m.checkEffects(parsed.flows, parsed.ast);
  const { gir } = m.emitGIR(parsed.ast, parsed.flows, fx);
  const watModule = m.buildWATModuleFromGIR(gir, undefined, "wasm-standalone", parsed.ast, true);
  const wat = m.renderWAT(watModule);
  const assembled = await m.assembleWAT(wat);

  if (!assembled.valid) {
    console.error("Compilation failed:", assembled.diagnostics.map(d => d.message).join("; "));
    process.exit(1);
  }

  if (command === "build") {
    const name = packageBuild ? packageDescriptor.name : basename(llnFile, ".lln");
    const outDir = packageBuild ? join(packageBuild, "dist") : "build";
    mkdirSync(outDir, { recursive: true });
    writeFileSync(`${outDir}/${name}.wasm`, assembled.wasm);
    writeFileSync(`${outDir}/${name}.wat`, wat);

    // .lmanifest generation (DRCM Phase 3 task #67 — binary CBOR RFC 8949)
    try {
      const { generateManifest, serializeManifest, serializeManifestCBOR, prettyManifest, verifyManifestRoundTrip } = await import(
        new URL("packages-logicn/logicn-core-compiler/dist/manifest-generator.js", import.meta.url).href
      );
      const govResult = m.verifyGovernance(parsed.ast, parsed.flows,
        m.checkEffects(parsed.flows, parsed.ast), "dev");
      const source = readFileSync(llnFile, "utf8");
      const baseManifest = generateManifest(source, llnFile, parsed.flows, govResult);

      // ── Net a: embed the fusion descriptor INTO the manifest BEFORE signing ──────
      // (Fuse B2 STEP A) The fuse fields (kind/provides/seam/capabilities) and the
      // .wasm sha256 are folded into the SIGNED manifest object so they are
      // tamper-evident: a host App Kernel verifies one signature over both the
      // governance facts AND the fusion contract. The standalone .fuse.json emitted
      // below is now just a convenience copy — the manifest's `fuse` block is the
      // authoritative, signed source of truth.
      const wasmSha256 = "sha256:" + createHash("sha256").update(Buffer.from(assembled.wasm)).digest("hex");
      const manifest = packageBuild
        ? {
            ...baseManifest,
            fuse: {
              schemaVersion: "lln.fuse.v1",
              name,
              version: packageDescriptor.version ?? "0.0.0",
              kind: packageDescriptor.kind ?? "capability",
              provides: packageDescriptor.provides ?? null,
              seam: packageDescriptor.seam ?? null,
              capabilities: packageDescriptor.capabilities ?? [],
              wasmSha256,
            },
          }
        : baseManifest;

      // Dual output (logicn-cbor-manifest-spec.md):
      //   .lmanifest      = Binary CBOR (RFC 8949) — signing target, DSS.wasm parses this
      //   .lmanifest.json = Pretty JSON — human inspection only
      const roundTripOk = verifyManifestRoundTrip(manifest);
      if (roundTripOk) {
        const cborBytes = serializeManifestCBOR(manifest);
        writeFileSync(`${outDir}/${name}.lmanifest`, Buffer.from(cborBytes));
        console.log(`   ${outDir}/${name}.lmanifest      (CBOR ${cborBytes.length}B — round-trip ✅)`);
      } else {
        // Safety fallback: CBOR round-trip failed, use canonical JSON
        writeFileSync(`${outDir}/${name}.lmanifest`, serializeManifest(manifest));
        console.log(`   ${outDir}/${name}.lmanifest      (JSON fallback — CBOR round-trip failed)`);
      }
      const manifestJsonPath = `${outDir}/${name}.lmanifest.json`;
      const manifestJson = prettyManifest(manifest);
      writeFileSync(manifestJsonPath, manifestJson);
      console.log(`   ${outDir}/${name}.lmanifest.json (human-readable)`);

      // ── Real manifest signing (#108) — ZERO-TOUCH key lifecycle ──────────────
      // Stage A: Ed25519 (Node.js native crypto). Stage B: ML-DSA-65 (FIPS 204).
      // A developer never handles keys: the dev signing key is auto-provisioned, healthy
      // keys sign silently, and a coded LLN-KEY-* diagnostic appears ONLY when action is
      // needed (stale → warn; revoked/tampered/prod-missing → fail-closed).
      let signingKeyId = process.env.LOGICN_SIGNING_KEY_ID;
      let signingKeyB64 = process.env.LOGICN_SIGNING_PRIVATE_KEY_B64;
      try {
        const kl = await import("./governance/key-lifecycle.mjs");
        const profile = process.env.LOGICN_PROFILE === "production" ? "production" : "dev";
        const assessment = kl.assessSigningKey({ rootDir: ".", profile });
        if (assessment.diagnostics.length > 0) console.log(kl.formatDiagnostics(assessment.diagnostics));
        if (assessment.fatal) {
          console.error(`❌ Refusing to sign (fail-closed) — resolve the LLN-KEY-* issue above and re-run.`);
          process.exit(1);
        }
        if (assessment.action === "auto-provision") {
          const newId = kl.provisionDevKey(".");
          console.log(`   🔑 Auto-provisioned a development signing key (${newId.slice(0, 8)}…) — zero-touch, no action needed.`);
        }
        // Auto-load from .env.logicn-signing so the developer never has to `source` it.
        if ((!signingKeyId || !signingKeyB64) && existsSync(".env.logicn-signing")) {
          for (const line of readFileSync(".env.logicn-signing", "utf-8").split(/\r?\n/)) {
            const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
            if (!m) continue;
            if (m[1] === "LOGICN_SIGNING_KEY_ID") signingKeyId = signingKeyId || m[2].trim();
            if (m[1] === "LOGICN_SIGNING_PRIVATE_KEY_B64") signingKeyB64 = signingKeyB64 || m[2].trim();
          }
        }
        // Final fail-safe: never sign with a revoked key, whatever its source (env or file).
        if (signingKeyId) {
          const { isKeyRevoked } = await import("./governance/revocation-registry.mjs");
          if (isKeyRevoked(signingKeyId)) {
            console.error(`❌ LLN-KEY-004 (error): signing key ${signingKeyId} is REVOKED — refusing to sign. Mint a fresh key.`);
            process.exit(1);
          }
        }
      } catch (klErr) {
        console.warn(`   ⚠️  key-lifecycle check skipped (${klErr.message}) — proceeding with existing env key if present.`);
      }

      if (signingKeyId && signingKeyB64) {
        try {
          const { sign: cryptoSign, createPrivateKey } = await import("node:crypto");
          const privateKeyPem = Buffer.from(signingKeyB64, "base64").toString("utf-8");
          const privateKey = createPrivateKey(privateKeyPem);

          // Sign the manifest without the governanceSignature field so verification
          // can reconstruct the exact same bytes by stripping the signature before checking.
          // Ed25519 uses deterministic signing — no external hash algorithm needed (RFC 8032).
          const manifestObjForSigning = JSON.parse(manifestJson);
          const { governanceSignature: _placeholder, ...manifestWithoutSig } = manifestObjForSigning;
          const manifestBytesForSigning = JSON.stringify(manifestWithoutSig, null, 2);
          const signature = cryptoSign(null, Buffer.from(manifestBytesForSigning), privateKey).toString("base64");

          // Update the .lmanifest.json with real signature
          const signedManifest = JSON.parse(manifestJson);
          signedManifest.governanceSignature = {
            algorithm: "Ed25519",  // Stage A; will be ML-DSA-65 (NIST FIPS 204) in Stage B
            keyId: signingKeyId,
            signature: signature,
            signedAt: new Date().toISOString(),
          };

          writeFileSync(manifestJsonPath, JSON.stringify(signedManifest, null, 2));
          console.log(`   🔐 Manifest signed (Ed25519, keyId: ${signingKeyId.slice(0, 8)}...)`);
        } catch (err) {
          console.warn(`   ⚠️  Signing failed (continuing unsigned): ${err.message}`);
        }
      }

      // governance-impact.json (#63) — security surface area artifact per build
      // Summarises effects, invariants, domain guards, change class, resilience
      // Used by AI agents to self-assess proposals, and by CI to post PR comments.
      try {
        const { diffGovernance, flowShape } = await import(
          new URL("packages-logicn/logicn-core-compiler/dist/governance-diff.js", import.meta.url).href
        );
        const impactArtifact = {
          schemaVersion: "lln.governance-impact.v1",
          sourceFile: llnFile.replace(/\\/g, "/"),
          sourceHash: manifest.sourceHash,
          generatedAt: manifest.generatedAt,
          flowCount: parsed.flows.length,
          flows: parsed.flows.map(f => ({
            name: f.name,
            qualifier: f.qualifier,
            effects: f.declaredEffects,
            hasInvariant: (f.declaredEffects.length > 0) || false,
          })),
          surfaceArea: {
            totalEffects: parsed.flows.flatMap(f => f.declaredEffects).length,
            uniqueEffects: [...new Set(parsed.flows.flatMap(f => f.declaredEffects))],
            networkFlows: parsed.flows.filter(f => f.declaredEffects.some(e => e.startsWith("network"))).map(f => f.name),
            secretFlows: parsed.flows.filter(f => f.declaredEffects.some(e => e.includes("secret"))).map(f => f.name),
            mutationFlows: parsed.flows.filter(f => f.declaredEffects.some(e => e.includes(".write") || e.includes(".mutate"))).map(f => f.name),
          },
          proofObligationCount: manifest.proofObligations?.length ?? 0,
          derivedConstraintCount: manifest.derivedConstraints?.length ?? 0,
        };
        writeFileSync(`${outDir}/${name}.governance-impact.json`, JSON.stringify(impactArtifact, null, 2));
        console.log(`   ${outDir}/${name}.governance-impact.json (security surface area)`);
      } catch { /* non-fatal */ }
    } catch { /* manifest generation non-fatal */ }

    // ── Fusion descriptor (#175, design-doc §11) ─────────────────────────────
    // In package mode, emit <name>.fuse.json so a host App Kernel can FUSE this
    // package's governed .wasm at its declared seam, capability-bounded by its
    // manifest (admission-gate verified, deny-by-default). This is the contract
    // between a fusable package and the App Kernel — never a runtime middleware.
    //
    // Net a (Fuse B2): the AUTHORITATIVE, tamper-evident fuse contract now lives
    // INSIDE the signed .lmanifest (`fuse` block, embedded above before signing).
    // This standalone file is a convenience copy — the loader cross-checks it
    // against the signed manifest and prefers the manifest on any disagreement.
    if (packageBuild) {
      // Recompute defensively so this block stays valid even if the manifest
      // embedding above was skipped (e.g. manifest generation threw, non-fatal).
      const fuseWasmSha256 = "sha256:" + createHash("sha256").update(Buffer.from(assembled.wasm)).digest("hex");
      const fuseDescriptor = {
        schemaVersion: "lln.fuse.v1",
        name,
        version: packageDescriptor.version ?? "0.0.0",
        kind: packageDescriptor.kind ?? "capability",
        provides: packageDescriptor.provides ?? null,
        seam: packageDescriptor.seam ?? null,
        capabilities: packageDescriptor.capabilities ?? [],
        artifacts: { wasm: `${name}.wasm`, manifest: `${name}.lmanifest` },
        wasmSha256: fuseWasmSha256,
        generatedAt: new Date().toISOString(),
      };
      writeFileSync(`${outDir}/${name}.fuse.json`, JSON.stringify(fuseDescriptor, null, 2));
      console.log(`   ${outDir}/${name}.fuse.json   (fusion descriptor — kind=${fuseDescriptor.kind}, seam=${fuseDescriptor.seam ?? "—"})`);
    }

    // ── //lln: auto-refresh (R&D 0045) ── a package build refreshes the generated dependency
    // metadata across the package's sources by DEFAULT, so `logicn build --package` keeps every
    // //lln: USES/USEDBY/IMPACT/COMPLEXITY block current (cross-file). Opt out with --no-refresh for
    // reproducible CI builds. Only //lln: lines are touched — human // comments and code are never
    // modified. Scoped to the package's own source tree, so it never rewrites files elsewhere.
    if (packageBuild && !rest.includes("--no-refresh")) {
      const { results } = refreshGeneratedComments(dirname(llnFile), { write: true });
      const changed = results.filter(r => r.changed);
      if (changed.length > 0) {
        const flows = changed.reduce((n, r) => n + r.flows, 0);
        console.log(`   refreshed //lln: metadata on ${flows} flow(s) in ${changed.length} file(s)  (--no-refresh to skip)`);
      }
    }

    console.log(`✅ Compiled ${packageBuild ? packageDescriptor.name + " (package)" : llnFile}`);
    console.log(`   ${outDir}/${name}.wasm  (${assembled.wasm.byteLength} bytes)`);
    console.log(`   ${outDir}/${name}.wat   (${wat.split("\n").length} lines)`);
    if (!packageBuild) {
      console.log(`\nRun with wasmtime:`);
      console.log(`   wasmtime --invoke main ${outDir}/${name}.wasm`);
    }
    return;
  }

  if (command === "run") {
    const invokeIdx = rest.indexOf("--invoke");
    const flowName = invokeIdx >= 0 ? rest[invokeIdx + 1] : "main";
    // Marshal CLI args to WASM i32. Bool literals → 1/0; numbers → themselves. Fail LOUDLY on
    // anything else — the old `.map(Number)` turned BOTH "true" and "false" into NaN→i32 0→false,
    // so a wrong-but-plausible Bool arg silently fizzled to `false` with no error (dogfooding #3).
    const args = (invokeIdx >= 0 ? rest.slice(invokeIdx + 2) : []).map((a, i) => {
      if (a === "true") return 1;
      if (a === "false") return 0;
      const n = Number(a);
      if (!Number.isFinite(n)) {
        console.error(`\n  ✗ invoke argument #${i + 1} = ${JSON.stringify(a)} is not a valid Int or Bool.`);
        console.error(`    Pass a number (e.g. 42, -3) or a Bool literal (true / false).\n`);
        process.exit(2);
      }
      return n;
    });

    // ── Host Runtime (P9.3) — array manager + string intern table ──────────────
    // Provides the bridge between WASM i32 opaque handles and host JS types.
    // The string intern table is reconstructed from WAT comment annotations.
    const _hostArrays = new Map();   // i32 ID → Array
    let _nextArrId = 1;
    const _hostStrings = new Map();  // i32 ID → string
    let _nextStrId = 1;
    _hostStrings.set(0, "");         // 0 = empty string (reserved)

    // Reconstruct string intern table from WAT ;; ID = "value" comments
    for (const line of (assembled.wat ?? "").split("\n")) {
      const m = line.match(/^;;\s+(\d+)\s*=\s*"(.*)"$/);
      if (m) { const id = parseInt(m[1]); if (id > 0) { _hostStrings.set(id, m[2]); if (id >= _nextStrId) _nextStrId = id + 1; } }
    }

    function _strFromId(id) { return _hostStrings.get(id) ?? ""; }
    function _strIntern(s) {
      for (const [id, v] of _hostStrings) { if (v === s) return id; }
      const id = _nextStrId++;
      _hostStrings.set(id, s);
      return id;
    }

    const hostRuntime = {
      host: {
        __array_create:   () => { const id = _nextArrId++; _hostArrays.set(id, []); return id; },
        __array_append:   (arr, item) => { _hostArrays.get(arr)?.push(item); },
        __array_get:      (arr, i) => _hostArrays.get(arr)?.[i] ?? 0,
        __array_length:   (arr) => _hostArrays.get(arr)?.length ?? 0,
        __array_contains: (arr, item) => (_hostArrays.get(arr)?.includes(item) ? 1 : 0),
        __array_first:    (arr) => _hostArrays.get(arr)?.[0] ?? 0,
        __array_last:     (arr) => { const a = _hostArrays.get(arr); return a?.length ? a[a.length-1] : 0; },
        __str_concat:     (a, b) => _strIntern(_strFromId(a) + _strFromId(b)),
        __str_length:     (id) => _strFromId(id).length,
        __str_char_at:    (id, pos) => _strFromId(id).charCodeAt(pos) || 0,
        __str_to_int:     (id) => parseInt(_strFromId(id), 10) || 0,
        __int_to_str:     (n) => _strIntern(String(n)),
        __str_eq:         (a, b) => (_strFromId(a) === _strFromId(b) ? 1 : 0),
        __char_is_letter: (c) => (/[a-zA-Z_]/.test(String.fromCharCode(c)) ? 1 : 0),
        __char_is_digit:  (c) => (c >= 48 && c <= 57 ? 1 : 0),
        __char_to_string: (c) => _strIntern(String.fromCharCode(c)),
        __unwrap_or:      (val, def) => val === 0 ? def : val,
        __option_some:    (val) => val,
        __option_none:    () => 0,
      }
    };

    const result = await WebAssembly.instantiate(assembled.wasm, hostRuntime);
    const fn = result.instance.exports[flowName];
    if (typeof fn !== "function") {
      const exported = Object.keys(result.instance.exports).filter(k => k !== "memory");
      const declared = (parsed.flows ?? []).some(f => f.name === flowName);
      if (declared) {
        // The flow EXISTS in the source but is not a WASM export. Only pure flows that return a
        // primitive are exported (exportAllPure); effectful/secure flows (e.g. `console.log`, returning
        // Result/Void) run in the governed runtime, not the raw WASM --invoke surface (dogfooding #2).
        console.error(`Flow '${flowName}' exists but is NOT in the WASM --invoke surface — only pure flows returning a primitive (Int/Bool) are exported.`);
        console.error(`('${flowName}' is likely a secure/effectful flow; those run in the governed runtime, not raw WASM --invoke.)`);
        console.error(`→ Run it under governance:  logicn run ${llnFile} --invoke ${flowName} --governed`);
        console.error(`Invokable here (raw WASM, pure only): ${exported.join(", ") || "(none)"}`);
      } else {
        console.error(`No flow named '${flowName}'. Invokable here: ${exported.join(", ") || "(none)"}`);
      }
      process.exit(1);
    }
    const rawOutput = fn(...args);
    // If output is an array ID, resolve it to a readable form
    let output = rawOutput;
    if (typeof rawOutput === "number" && _hostArrays.has(rawOutput)) {
      const arr = _hostArrays.get(rawOutput);
      output = "[" + arr.map(id => typeof id === "number" && _hostStrings.has(id) ? `"${_hostStrings.get(id)}"` : id).join(", ") + "]";
    } else if (typeof rawOutput === "number" && _hostStrings.has(rawOutput) && rawOutput > 0) {
      output = `"${_hostStrings.get(rawOutput)}"`;
    }
    console.log(output);
    return;
  }

  console.error(`Unknown command: ${command}. Run with --help.`);
  process.exit(1);
}

main().catch(e => { console.error(e.message); process.exit(1); });

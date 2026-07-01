#!/usr/bin/env node
// =============================================================================
// brand-audit.mjs — binary-safe residual-brand + @-scope audit (dev tool)
// =============================================================================
// WHY: ripgrep/grep SKIP files that contain a NUL byte (treated as "binary"),
// which is exactly how a straggler survived a brand sweep (kernel.ts had a
// legit NUL delimiter). And a word-boundary regex misses forms like `@spore`,
// `/spore`, `sporeFile`. This tool reads EVERY file as raw bytes (latin1) and
// substring-scans, so nothing is skipped, in any form or case.
//
// It reports, per old-brand token (logicn->galerina, spore->fungi, lln->fungi):
//   • every occurrence  file:line  <matched form>  context
//   • classified: STRAGGLER (fix) | ALLOWED (root-signed/historical, keep)
//     | GENERATED (dist/build/results — regenerable, low priority)
// Plus: every `@scope/pkg` reference, tallied, with non-@galerina scopes flagged
// so a broken/renamed import scope can't hide.
//
// Usage:  node scripts/brand-audit.mjs [root] [--json] [--all]
//   --all   include GENERATED (dist/build) occurrences in the detail list
// Exit 1 if any STRAGGLER is found (CI-usable), else 0.
// =============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.argv.find((a, i) => i >= 2 && !a.startsWith("--")) || process.cwd();
const JSON_OUT = process.argv.includes("--json");
const SHOW_ALL = process.argv.includes("--all");

const SKIP_DIRS = new Set(["node_modules", ".git"]);
// Old brand -> what it should have become. Distinctive enough for substring, EXCEPT
// `lln` (matches fullName/fullNode/…), which uses targeted forms only.
const TOKENS = [
  { key: "logicn", becomes: "galerina", re: /logicn/gi },
  { key: "spore",  becomes: "fungi",    re: /spore/gi },
  // lln only in brand forms: .lln, lln.<x>, LLN-CODE, @lln, /lln, lln/, _lln, lln_, standalone
  { key: "lln",    becomes: "fungi",    re: /\.lln\b|\blln\.[a-z]|\bLLN-[A-Z0-9]|@lln|\blln\/|\/lln\b|[_-]lln\b|\blln[_-]|\blln\b/gi },
];

// Occurrences here are EXPECTED old-brand and must NOT be "fixed":
//  - revocations.json: historical `.env.logicn-signing` inside the offline-root-signed payload
//  - greeting.lmanifest(.json): root-signed fixture (lln.manifest.v1) until the ab46f4c7 re-sign
//  - .env.*-signing: signing key filenames (logicn-era leak record kept deliberately)
//  - verify-artifacts.mjs: references the `../LogicN - Copy` pristine backup path
const ALLOW = [
  /governance[\\/]revocations\.json$/i,
  /greeting\.lmanifest(\.json)?$/i,
  /\.env\.(logicn|galerina)-signing/i,
  /verify-artifacts\.mjs$/i,
  /brand-audit\.mjs$/i,          // this tool contains the search tokens by definition
  /fix-logicn-brand\.mjs$/i,     // the paired codemod, likewise
  // documentation/history that legitimately QUOTES the old brand to record the rename:
  /(^|[\\/])CHANGELOG\.md$/i,
  /(^|[\\/])notes[\\/]/i,        // historical R&D scratch (note 77 documents the rename itself)
  /RESTART-PROMPT|RESUME-|HANDOFF|REBOOT/i,
];
// Generated / regenerable — reported separately, not a hard failure.
const GENERATED = [/(^|[\\/])(dist|build|results|coverage|_audit_tmp)[\\/]/i, /\.lindex$/i, /\.jsonl$/i, /-GRAPH_REPORT\.md$/i, /galerina-ai-map\.md$/i,
  // compiled / regenerable binaries + logs (embed the OLD build path; rebuild to refresh)
  /\.(wasm|pdb|exe|dll|so|dylib|o|a|lib|node)$/i, /bench-native-/i, /\.log$/i];
// Third-party @-scopes that are legitimately not @galerina.
const KNOWN_SCOPES = new Set(["@noble", "@types", "@modelcontextprotocol", "@napi-rs", "@ibm", "@babel", "@eslint", "@jest"]);

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith(".git") && e.isDirectory()) continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile()) out.push(full);
  }
  return out;
}

function classify(rel) {
  if (ALLOW.some((r) => r.test(rel))) return "ALLOWED";
  if (GENERATED.some((r) => r.test(rel))) return "GENERATED";
  return "STRAGGLER";
}

const files = walk(ROOT);
const findings = { STRAGGLER: [], ALLOWED: [], GENERATED: [] };
const scopeTally = new Map();
const nonGalerinaScopes = [];
const binaryScanned = [];
let scanned = 0;

for (const full of files) {
  let buf;
  try { buf = readFileSync(full); } catch { continue; }
  scanned++;
  const rel = relative(ROOT, full).replace(/\\/g, "/");
  const text = buf.toString("latin1"); // NUL-tolerant: nothing is skipped
  let nul = 0; for (let k = 0; k < buf.length; k++) if (buf[k] === 0) nul++;
  const hasNul = nul > 0;
  // Binary by NUL-RATIO, not mere presence (kernel.ts has 1 legit NUL delimiter and IS source).
  const isBinary = buf.length > 0 && nul / buf.length > 0.005;
  if (hasNul) binaryScanned.push(rel);
  const lines = text.split(/\r?\n/);

  // --- old-brand tokens ---
  const cls = isBinary ? "GENERATED" : classify(rel);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const t of TOKENS) {
      t.re.lastIndex = 0;
      let m;
      while ((m = t.re.exec(line)) !== null) {
        findings[cls].push({
          file: rel, line: i + 1, token: t.key, becomes: t.becomes,
          match: m[0], nul: hasNul,
          ctx: line.trim().slice(0, 120),
        });
        if (t.re.lastIndex === m.index) t.re.lastIndex++;
      }
    }
    // --- @scope/pkg refs ---
    const scoped = line.matchAll(/@[a-z0-9][\w.-]*\/[\w.-]+/gi);
    for (const s of scoped) {
      const scope = s[0].split("/")[0];
      scopeTally.set(scope, (scopeTally.get(scope) || 0) + 1);
      if (scope !== "@galerina" && !KNOWN_SCOPES.has(scope)) {
        nonGalerinaScopes.push({ file: rel, line: i + 1, ref: s[0] });
      }
    }
  }
}

// ---- report ----
const summary = {
  scanned, filesTotal: files.length,
  binaryFilesScanned: binaryScanned.length,
  stragglers: findings.STRAGGLER.length,
  allowed: findings.ALLOWED.length,
  generated: findings.GENERATED.length,
  distinctScopes: scopeTally.size,
  nonGalerinaScopeRefs: nonGalerinaScopes.length,
};

if (JSON_OUT) {
  console.log(JSON.stringify({ summary, findings, scopes: Object.fromEntries(scopeTally), nonGalerinaScopes, binaryScanned }, null, 2));
} else {
  const p = (s) => console.log(s);
  p(`\n🔎 Brand audit — ${ROOT}`);
  p(`   scanned ${scanned} files (${binaryScanned.length} contain NUL bytes = grep-invisible, scanned anyway)\n`);
  const group = (arr) => {
    const byFile = new Map();
    for (const f of arr) { (byFile.get(f.file) || byFile.set(f.file, []).get(f.file)).push(f); }
    for (const [file, fs] of byFile) {
      p(`  ${file}${fs[0].nul ? "  ⚠NUL(binary)" : ""}`);
      for (const f of fs) p(`     :${f.line}  ${f.token}->${f.becomes}  «${f.match}»   ${f.ctx}`);
    }
  };
  p(`── STRAGGLERS (unexpected old-brand — should be fixed): ${findings.STRAGGLER.length}`);
  group(findings.STRAGGLER);
  p(`\n── ALLOWED (root-signed / historical — keep verbatim): ${findings.ALLOWED.length}`);
  group(findings.ALLOWED);
  if (SHOW_ALL) { p(`\n── GENERATED (dist/build — regenerable): ${findings.GENERATED.length}`); group(findings.GENERATED); }
  else p(`\n── GENERATED (dist/build — regenerable, rerun with --all): ${findings.GENERATED.length}`);
  p(`\n── @-scope references (every scoped import/ref, to prove nothing is broken):`);
  for (const [scope, n] of [...scopeTally].sort((a, b) => b[1] - a[1])) {
    const flag = scope !== "@galerina" && !KNOWN_SCOPES.has(scope) ? "  ⚠ NON-STANDARD" : "";
    p(`     ${String(n).padStart(5)}  ${scope}${flag}`);
  }
  if (nonGalerinaScopes.length) {
    p(`\n  ⚠ Non-@galerina / non-known scoped refs (${nonGalerinaScopes.length}):`);
    for (const s of nonGalerinaScopes.slice(0, 40)) p(`     ${s.file}:${s.line}  ${s.ref}`);
  }
  p(`\n── SUMMARY ${JSON.stringify(summary)}`);
  p(findings.STRAGGLER.length ? `\n❌ ${findings.STRAGGLER.length} straggler occurrence(s) — review/fix.\n` : `\n✅ No stragglers.\n`);
}

process.exit(findings.STRAGGLER.length ? 1 : 0);

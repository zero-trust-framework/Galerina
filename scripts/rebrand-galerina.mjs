#!/usr/bin/env node
// rebrand-galerina.mjs — staged, category-aware LogicN→Galerina / .lln→.spore / LLN→SPORE codemod.
//
// DRY-RUN by default; pass --apply to write file edits + `git mv` renames (history preserved).
// Operates ONLY on git-tracked files (so node_modules / dist / gitignored build artifacts are out by
// construction). Case + WORD aware (avoids substring traps like "allnight" → "asporeight").
//
// Owner-locked scheme: EVERYTHING LLN → SPORE (codes LLN-→SPORE-, consts LLN_→SPORE_, bare LLN/lln→
// SPORE/spore, .lln→.spore), LogicN/logicn/LOGICN → Galerina/galerina/GALERINA, @logicn→@galerina.
// UNCHANGED: `.tmf` (compiled passport) and `TritMesh` (separate DB/umbrella brand) — both masked.
//
// The crypto wire-format strings — the 4 `logicn.*` domain-separation CONTEXTS and the `lln.*`
// signature/schema VERSION tags — are MASKED here (preserved verbatim) and migrated + re-signed in a
// dedicated crypto stage, so the bulk brand rename keeps every signing/verification test green.
//
// Usage:
//   node scripts/rebrand-galerina.mjs                  # dry-run, prints a categorized summary
//   node scripts/rebrand-galerina.mjs --report=PATH    # also write the full per-file report to PATH
//   node scripts/rebrand-galerina.mjs --apply          # APPLY: edit file contents + git mv renames
//   node scripts/rebrand-galerina.mjs --apply --text-only   # apply content edits, skip renames
//   node scripts/rebrand-galerina.mjs --apply --renames-only # apply git mv renames, skip edits
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");
const TEXT_ONLY = process.argv.includes("--text-only");
const RENAMES_ONLY = process.argv.includes("--renames-only");
const REPORT = (process.argv.find((a) => a.startsWith("--report=")) || "").split("=")[1] || null;

const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split(/\r?\n/).filter(Boolean);

// Never read/edit/rename these (integrity, volatile, vendored, binary, self).
const EXCLUDE = [
  /^build\//,                                              // generated catalogs/graph/coverage — REGENERATED after the rename (don't text-churn)
  /(^|\/)governance\/revocations\.json$/,                  // ROOT-SIGNED registry — renaming its content breaks the offline trust-anchor signature (re-sign = key ceremony)
  /(^|\/)package-lock\.json$/,
  /\.lock$/,
  /(^|\/)scripts\/rebrand-galerina\.mjs$/,                 // self
  /(^|\/)examples\/auth-service\/workspace\.lindex$/,      // volatile — regenerated post-rename
  /logicn-devtools-benchmarks\/results\/.*\.json$/,        // volatile benchmark output
  /(^|\/)logicn-ext-tmf\/spec\//,                          // vendored upstream spec — flag, don't rewrite
  /\.tmf$/,                                                // compiled/signed binary passports
  /\.(png|jpe?g|gif|ico|pdf|wasm|woff2?|ttf|eot|zip|gz)$/i, // binary assets
];
const isExcluded = (p) => EXCLUDE.some((re) => re.test(p));

// Spans PRESERVED verbatim in this pass:
//  - crypto wire-tags: the 4 logicn.* contexts + the lln.* sig/schema tags (migrated in the crypto stage)
//  - separate brands the owner said keep: TritMesh (DB/umbrella) and the literal .tmf extension token
const PRESERVE = /\b(?:logicn\.(?:proofgraph\.governance|bridge\.manifest|audit\.attestation|config\.environment)|lln\.(?:gov\.sig|runtime\.audit|runtime\.manifest|gir|govdiff))(?:\.v?\d+)?\b|TritMesh|tritmesh|TRITMESH/g;
const CRYPTO_ONLY = /\b(?:logicn\.(?:proofgraph\.governance|bridge\.manifest|audit\.attestation|config\.environment)|lln\.(?:gov\.sig|runtime\.audit|runtime\.manifest|gir|govdiff))/;
const UNMASK = /@@MASK(\d+)@@/g; // ASCII sentinel (vanishingly unlikely in source; brand rules can't touch it)

function transformText(s) {
  const masks = [];
  const masked = s.replace(PRESERVE, (m) => { masks.push(m); return `@@MASK${masks.length - 1}@@`; });
  let count = 0;
  let out = masked;
  for (const [re, to] of [
    [/LogicN/g, "Galerina"], [/LOGICN/g, "GALERINA"], [/\blogicn\b/g, "galerina"],
    [/LLN_/g, "SPORE_"], [/\bLLN\b/g, "SPORE"], [/\blln\b/g, "spore"], [/\blln_/g, "spore_"],
  ]) {
    out = out.replace(re, () => { count++; return to; });
  }
  out = out.replace(UNMASK, (_, i) => masks[+i]);
  return [out, count];
}

// Path/dir rename: logicn→galerina in any segment; *.lln → *.spore; bare lln/LLN segment → spore/SPORE.
function transformPath(p) {
  return p
    .replace(/LogicN/g, "Galerina").replace(/LOGICN/g, "GALERINA").replace(/logicn/g, "galerina")
    .replace(/\.lln$/, ".spore")
    .replace(/(^|[\/._-])LLN([\/._-]|$)/g, "$1SPORE$2")
    .replace(/(^|[\/._-])lln([\/._-]|$)/g, "$1spore$2");
}
// Binary = a HIGH null-byte ratio (real binaries are >>1% nulls). A source file with a stray \x00
// (e.g. a "\0" literal) round-trips safely through utf8 read→transform→write, so don't skip it.
const isBinary = (buf) => { const n = Math.min(buf.length, 8000); let z = 0; for (let i = 0; i < n; i++) if (buf[i] === 0) z++; return z > n * 0.01; };

const renames = [];     // {from,to,kind}
const edits = [];       // {path, n}
let excluded = 0, binarySkipped = 0, cryptoFiles = 0, tritmeshFiles = 0, tritmeshChanged = 0;

for (const p of tracked) {
  // RENAME is considered for EVERY file (incl. excluded ones) so a package never splits across the old
  // and new dir — excluded files MOVE with their package, they are only skipped for the text-EDIT.
  const np = transformPath(p);
  if (np !== p) {
    const kind = /\.lln$/.test(p) ? "ext(.lln->.spore)" : /logicn/i.test(p) ? "dir/pkg(logicn->galerina)" : "lln-name";
    renames.push({ from: p, to: np, kind });
  }
  if (isExcluded(p)) { excluded++; continue; }   // skip the text-edit only
  let buf; try { buf = readFileSync(join(ROOT, p)); } catch { continue; }
  if (isBinary(buf)) { binarySkipped++; continue; }
  const text = buf.toString("utf8");
  const [out, n] = transformText(text);
  if (CRYPTO_ONLY.test(text)) cryptoFiles++;
  if (/TritMesh/i.test(text)) { tritmeshFiles++; if (/TritMesh/i.test(out) === false || out.match(/TritMesh/gi)?.length !== text.match(/TritMesh/gi)?.length) tritmeshChanged++; }
  if (n > 0) {
    edits.push({ path: p, n });
    if (APPLY && !RENAMES_ONLY) writeFileSync(join(ROOT, p), out);
  }
}

// Apply renames last (git mv), longest-path first so nested files move cleanly.
let renamed = 0;
if (APPLY && !TEXT_ONLY) {
  for (const r of [...renames].sort((a, b) => b.from.length - a.from.length)) {
    try {
      mkdirSync(dirname(join(ROOT, r.to)), { recursive: true });
      execFileSync("git", ["mv", "-f", r.from, r.to], { cwd: ROOT });
      renamed++;
    } catch (e) { console.error(`git mv FAILED: ${r.from} -> ${r.to}: ${String(e).split("\n")[0]}`); }
  }
}

// report
const byKind = renames.reduce((m, r) => ((m[r.kind] = (m[r.kind] || 0) + 1), m), {});
const totalRepl = edits.reduce((s, e) => s + e.n, 0);
const lines = [
  `# Galerina rebrand codemod — ${APPLY ? "APPLIED" : "DRY-RUN"} (HEAD ${execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()})`,
  ``,
  `tracked scanned: ${tracked.length}   excluded: ${excluded}   binary skipped: ${binarySkipped}`,
  `RENAMES: ${renames.length}  ${JSON.stringify(byKind)}`,
  `CONTENT EDITS: ${edits.length} files, ${totalRepl} token replacements`,
  `CRYPTO-DEFERRED (logicn.*/lln.* tags preserved this pass): ${cryptoFiles} files`,
  `TRITMESH preserved: ${tritmeshFiles} files contain TritMesh, changed by codemod: ${tritmeshChanged} (MUST be 0)`,
  ``,
  `## Rename samples (first 30)`,
  ...renames.slice(0, 30).map((r) => `  ${r.kind.padEnd(26)} ${r.from}  ->  ${r.to}`),
  ``,
  `## Heaviest content edits (top 30 by replacement count)`,
  ...[...edits].sort((a, b) => b.n - a.n).slice(0, 30).map((e) => `  ${String(e.n).padStart(5)}  ${e.path}`),
];
const summary = lines.join("\n");
console.log(summary);
if (REPORT) {
  const full = [summary, ``, `## ALL renames (from<TAB>to)`, ...renames.map((r) => `${r.from}\t${r.to}`), ``,
    `## ALL edited files (file<TAB>replacements)`, ...edits.map((e) => `${e.path}\t${e.n}`)].join("\n");
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, full);
  console.log(`\n-> full report: ${REPORT}`);
}
if (APPLY) console.log(`\nAPPLIED: ${edits.length} edits, ${renamed}/${renames.length} renames`);

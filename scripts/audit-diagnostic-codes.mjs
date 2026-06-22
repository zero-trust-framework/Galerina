#!/usr/bin/env node
// audit-diagnostic-codes.mjs — re-runnable conformance scanner for LogicN's diagnostic-code
// namespaces (#215, the durable fix from logicn-diagnostic-code-taxonomy-audit-2026-06-22.md).
//
// THE INVARIANTS (one code = one fault = one name = one severity, single source of truth):
//   V1 OVERLOAD          one code emitted under >1 distinct `name`
//   V2 COLLISION         one `name` emitted under >1 distinct code
//   V3 SEVERITY-VOCAB    a `severity` value outside the canonical {error, warning, info}
//   V4 MULTI-SEVERITY    one code emitted at >1 distinct severity (candidate; legit dev/prod toggle excepted by review)
//
// Scope: packages-logicn/<pkg>/src/**/*.ts. Reports a concise baseline + exit code = #violations
// (so it can later gate CI). Pragmatic regex extraction — flags candidates for review, not a proof.
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CODE_TEST } from "./lib/codes.mjs";

const ROOT = join(process.cwd(), "packages-logicn");
const CANON_SEV = new Set(["error", "warning", "info"]);
// code-token validation comes from the SHARED module (scripts/lib/codes.mjs) — CODE_TEST (anchored).

function walk(dir) {
  const out = [];
  let ents;
  try { ents = readdirSync(dir); } catch { return out; }
  for (const e of ents) {
    if (e === "node_modules" || e === "dist" || e === "tests") continue;
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (e.endsWith(".ts") && !e.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

// (code -> Map<name, Set<"file:line">>), (name -> Set<code>), severity offenders, (code -> Set<severity>)
const codeToNames = new Map();
const nameToCodes = new Map();
const sevOffenders = [];
const codeToSevs = new Map();

const add = (m, k, v) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(v); };

for (const file of walk(ROOT)) {
  const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // V3: every severity literal
    const sev = line.match(/severity:\s*"([^"]+)"/);
    if (sev && !CANON_SEV.has(sev[1])) sevOffenders.push(`${sev[1].padEnd(16)} ${rel}:${i + 1}`);

    // Pattern A — object literal: code: "X" then name: "Y" / severity: "Z" within 8 lines
    const codeM = line.match(/code:\s*"([^"]+)"/);
    if (codeM && CODE_TEST.test(codeM[1])) {
      const code = codeM[1];
      let name, sevHere;
      for (let j = i; j < Math.min(i + 8, lines.length); j++) {
        const nm = lines[j].match(/name:\s*"([^"]+)"/); if (nm && !name) name = nm[1];
        const sv = lines[j].match(/severity:\s*"([^"]+)"/); if (sv && !sevHere) sevHere = sv[1];
      }
      if (name) { add(codeToNames, code, `${name}`); add(nameToCodes, name, code); }
      if (sevHere) add(codeToSevs, code, sevHere);
    }

    // Pattern B — make*Diag(code, name, ...) incl. multi-line calls: grab the first two quoted
    // args from the call onward. Gate arg[1] to an identifier (no spaces) so a (code, message)
    // helper can't register a message string as a "name".
    const mkIdx = line.search(/make\w*Diag\(/);
    if (mkIdx >= 0) {
      const win = line.slice(mkIdx) + " " + lines.slice(i + 1, Math.min(i + 4, lines.length)).join(" ");
      const args = [...win.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      if (args.length >= 2 && CODE_TEST.test(args[0]) && /^[A-Za-z][A-Za-z0-9_]*$/.test(args[1])) {
        add(codeToNames, args[0], args[1]); add(nameToCodes, args[1], args[0]);
        if (args[2] && CANON_SEV.has(args[2])) add(codeToSevs, args[0], args[2]);
      }
    }
  }
}

const overloaded = [...codeToNames].filter(([, names]) => names.size > 1);
const collisions = [...nameToCodes].filter(([, codes]) => codes.size > 1);
const multiSev = [...codeToSevs].filter(([, sevs]) => sevs.size > 1);

const out = [];
out.push("# LogicN diagnostic-code conformance baseline\n");
out.push(`codes-with-names: ${codeToNames.size} · names: ${nameToCodes.size}\n`);

out.push(`\n## V1 OVERLOAD — one code, >1 name (${overloaded.length})`);
for (const [code, names] of overloaded.sort()) out.push(`  ${code}  ->  ${[...names].join(" | ")}`);

out.push(`\n## V2 COLLISION — one name, >1 code (${collisions.length})`);
for (const [name, codes] of collisions.sort()) out.push(`  ${name}  ->  ${[...codes].join(" | ")}`);

// V3 — DIAGNOSTIC severity vocab only: a severity ATTACHED TO A CODE that is outside {error,warning,info}.
// Audit-event severity (tower-citizen) and risk-rating (ai-agent/devtools-pci/-security) are SEPARATE axes
// (conventions §4) and are NOT diagnostic severities, so they are excluded here.
const badSevCodes = [...codeToSevs.entries()].filter(([, sevs]) => [...sevs].some((s) => !CANON_SEV.has(s))).sort();
out.push(`\n## V3 SEVERITY-VOCAB — a code's severity outside {error,warning,info} (${badSevCodes.length})`);
for (const [code, sevs] of badSevCodes) out.push(`  ${code}  ->  ${[...sevs].join(" | ")}`);

out.push(`\n## V4 MULTI-SEVERITY — one code, >1 severity (${multiSev.length}; review for legit dev/prod toggles)`);
for (const [code, sevs] of multiSev.sort()) out.push(`  ${code}  ->  ${[...sevs].join(" | ")}`);

// V5 NAME-CASE — diagnostic `name` must be UPPER_SNAKE (conventions §3); flag PascalCase (a lowercase
// letter after a leading uppercase). All-lowercase names (metrics/report fields) are NOT diagnostic names → skip.
const isPascal = (n) => /^[A-Z]/.test(n) && /[a-z]/.test(n);
const badCase = [...nameToCodes.entries()].filter(([n]) => isPascal(n)).sort();
out.push(`\n## V5 NAME-CASE — PascalCase name, convention §3 requires UPPER_SNAKE (${badCase.length})`);
for (const [name, codes] of badCase) out.push(`  ${name}  (${[...codes].join(",")})`);

const v3n = badSevCodes.length;
const total = overloaded.length + collisions.length + v3n + multiSev.length + badCase.length;
out.push(`\n## TOTAL flagged: V1 ${overloaded.length} + V2 ${collisions.length} + V3 ${v3n} + V4 ${multiSev.length} + V5 ${badCase.length}`);
console.log(out.join("\n"));
process.exit(Math.min(total, 250));

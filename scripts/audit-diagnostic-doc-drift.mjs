#!/usr/bin/env node
// audit-diagnostic-doc-drift.mjs — catch the canonical diagnostic DOC describing a code as something
// the WIRED SOURCE does not (the LLN-RUNTIME-006 class, 2026-06-24).
//
// The bug this exists to prevent: compiler-diagnostics.md listed `LLN-RUNTIME-006   Audit event stream
// write failed`, but the wired emitter (security-policy.ts) defines it as `RateLimitExceeded` — "a
// declared contract limit was exceeded". A developer who hit a real LLN-RUNTIME-006 (you exceeded your
// request_time limit) and looked it up was MISDIRECTED by the canonical reference. That is a security
// concern: the document people trust to decode a governance/limit diagnostic must not lie about it.
//
// Sibling: audit-diagnostic-codes.mjs checks SOURCE-side invariants (one code = one name = one
// severity). THIS audit checks the orthogonal DOC↔SOURCE axis — the doc's human description must agree
// with the source's structured `name`/`message`.
//
// THE INVARIANT (high-signal, low-false-positive):
//   DESCRIPTION DRIFT — for any code that carries a structured `name`/`message` in source AND a
//   description line in the canonical doc, the two must share at least one meaningful word. ZERO
//   meaningful-token overlap (when both sides are substantive) means the doc is describing a different
//   fault entirely — exactly the RUNTIME-006 failure. Reported as a hard violation.
//
// Scope: source = packages-logicn/<pkg>/src/**/*.ts structured diagnostic objects (those with a
// `name:`); doc = docs/Knowledge-Bases/compiler-diagnostics.md fenced `CODE   description` lines.
// Exit code = violation count (0 = clean). Run from repo root.
//   node scripts/audit-diagnostic-doc-drift.mjs             → scan the committed doc + source
//   node scripts/audit-diagnostic-doc-drift.mjs --self-test → prove the drift detector fires
import { readdirSync, statSync, readFileSync, existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_ROOT = "packages-logicn";
const DOC = "docs/Knowledge-Bases/compiler-diagnostics.md";

// Words too generic to count as agreement between a doc description and a source name/message.
const STOP = new Set([
  "the", "was", "were", "has", "have", "had", "been", "and", "for", "that", "this", "with",
  "are", "its", "from", "not", "but", "you", "your", "a", "an", "of", "to", "in", "on", "or",
  "by", "at", "as", "it", "be", "is", "if", "no", "than", "when", "during", "into", "via",
]);

// ── tokenization: split camelCase names, lowercase, drop stopwords + sub-3-char tokens ─────────────
export function tokenize(text) {
  if (!text) return new Set();
  const spaced = String(text).replace(/([a-z0-9])([A-Z])/g, "$1 $2"); // RateLimitExceeded → Rate Limit Exceeded
  const out = new Set();
  for (const raw of spaced.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3 && !STOP.has(raw)) out.add(raw);
  }
  return out;
}

/** True when doc description and source name+message are BOTH substantive yet share NO meaningful word. */
export function isDrift(docDesc, srcName, srcMessage) {
  const docT = tokenize(docDesc);
  const srcT = new Set([...tokenize(srcName), ...tokenize(srcMessage)]);
  if (docT.size < 2 || srcT.size < 2) return false; // too thin to judge — don't false-positive
  for (const t of docT) if (srcT.has(t)) return false; // any shared meaningful word ⇒ agree
  return true; // zero overlap on two substantive descriptions ⇒ drift
}

// ── source: structured diagnostic objects (code + the name/message of the SAME object) ────────────
function walkTs(dir, acc) {
  let ents;
  try { ents = readdirSync(dir); } catch { return acc; }
  for (const e of ents) {
    if (e === "node_modules" || e === "dist" || e === ".graph" || e.startsWith(".")) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walkTs(p, acc);
    else if (e.endsWith(".ts") && !e.endsWith(".d.ts")) acc.push(p);
  }
  return acc;
}

/** Map code → {name, message} for every structured diagnostic object found in source. */
export function extractSourceDefs(files, read = readFileSync) {
  const defs = new Map();
  const codeRe = /code:\s*"(LLN-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]+[A-Z]?)"/g;
  for (const f of files) {
    let text;
    try { text = read(f, "utf8"); } catch { continue; }
    for (const m of text.matchAll(codeRe)) {
      const code = m[1];
      // window = from this `code:` up to the next `code:` (or +600 chars) = the same object literal
      const start = m.index;
      const nextCode = text.indexOf("code:", start + 5);
      const end = Math.min(text.length, nextCode === -1 ? start + 600 : Math.min(nextCode, start + 600));
      const win = text.slice(start, end);
      const name = win.match(/name:\s*"([^"]+)"/)?.[1] ?? "";
      const message = win.match(/message:\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? "";
      if (!name && !message) continue; // not a structured human-described def — skip (nothing to compare)
      // first structured def for a code wins (avoid clobbering with a re-emit that lacks name/message)
      if (!defs.has(code) || (!defs.get(code).name && name)) defs.set(code, { name, message, file: f });
    }
  }
  return defs;
}

// ── doc: `CODE   description` lines inside the taxonomy fences ─────────────────────────────────────
export function extractDocDescriptions(docText) {
  const out = new Map();
  const lineRe = /^(LLN-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]+[A-Z]?)\s{2,}(.+?)\s*$/;
  for (const line of docText.split(/\r?\n/)) {
    const m = line.match(lineRe);
    if (m && !out.has(m[1])) out.set(m[1], m[2]);
  }
  return out;
}

// Run the CLI only when executed directly — importing this module (tests, other audits) must be
// side-effect-free (the pure detectors above are the reusable surface).
const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

// ── self-test: prove the drift detector fires (a neutered audit is itself a fail-open) ────────────
if (isMain && process.argv.includes("--self-test")) {
  // the real RUNTIME-006 shapes
  const name = "RateLimitExceeded";
  const msg = "A declared contract limit was exceeded. The flow has been aborted.";
  const goodDoc = "Declared contract limit exceeded — request_time / network_requests (RateLimitExceeded)";
  const badDoc = "Audit event stream write failed"; // the bug that shipped
  const thinDoc = "Failed"; // too thin to judge — must NOT false-positive
  const goodDrift = isDrift(goodDoc, name, msg);       // expect false (they agree)
  const badDrift = isDrift(badDoc, name, msg);         // expect true  (zero overlap)
  const thinDrift = isDrift(thinDoc, name, msg);       // expect false (thin guard)
  // extraction round-trips
  const defs = extractSourceDefs(["x.ts"], () => `export const X = { code: "LLN-RUNTIME-006", name: "RateLimitExceeded", message: "A declared contract limit was exceeded." };`);
  const gotDef = defs.get("LLN-RUNTIME-006")?.name === "RateLimitExceeded";
  const docs = extractDocDescriptions("LLN-RUNTIME-006   Audit event stream write failed\nLLN-X-1   y");
  const gotDoc = docs.get("LLN-RUNTIME-006") === "Audit event stream write failed";
  const ok = !goodDrift && badDrift && !thinDrift && gotDef && gotDoc;
  console.log(`[self-test] agree→no-drift: ${!goodDrift} | mismatch→drift: ${badDrift} | thin→no-drift: ${!thinDrift} | src-extract: ${gotDef} | doc-extract: ${gotDoc}`);
  console.log(ok ? "[self-test] PASS — doc↔source drift detector fires on mismatch, silent on agreement" : "[self-test] FAIL");
  process.exit(ok ? 0 : 1);
}

// ── scan the committed doc + source ───────────────────────────────────────────────────────────────
if (isMain) {
  if (!existsSync(DOC)) {
    console.error(`[doc-drift] ${DOC} not found — fail-closed`);
    console.log("VIOLATIONS: 1");
    process.exit(1);
  }
  const srcDefs = extractSourceDefs(walkTs(SRC_ROOT, []));
  const docDesc = extractDocDescriptions(readFileSync(DOC, "utf8"));

  const violations = [];
  let compared = 0;
  for (const [code, { name, message, file }] of srcDefs) {
    const desc = docDesc.get(code);
    if (desc === undefined) continue; // not in the canonical doc taxonomy — out of scope for the drift check
    compared++;
    if (isDrift(desc, name, message)) {
      const srcLabel = name || message.slice(0, 40);
      violations.push(`${code}: doc says "${desc}" but source (${file.replace(/\\/g, "/")}) means "${srcLabel}" — zero shared meaning`);
    }
  }

  console.log(`diagnostic-doc-drift: compared ${compared} code(s) present in BOTH source (with name/message) and ${DOC}`);
  for (const v of violations) console.log(`  ✖ ${v}`);
  console.log(violations.length === 0 ? "diagnostic-doc-drift: doc descriptions agree with the wired source." : `diagnostic-doc-drift: ${violations.length} description(s) drifted from source.`);
  console.log(`VIOLATIONS: ${violations.length}`);
  console.log(`TOTAL: ${violations.length} diagnostic-doc-drift violation(s)`);
  process.exit(violations.length);
}

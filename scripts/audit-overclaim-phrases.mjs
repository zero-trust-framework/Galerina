#!/usr/bin/env node
// audit-overclaim-phrases.mjs — kill the recurring "O(1) / single-clock / constant-time zero-wipe"
// overclaim in prose + comments (RD-0126 overclaim-E, RD-0114-G2; 2026-06-25).
//
// The overclaim this exists to prevent: R&D notes and KB prose keep describing the intrusion / arena
// zero-wipe as "O(1) memory.fill", a "constant-time zero-wipe", or a "single-clock-cycle wipe". That is
// settled-false. `memory.fill(0)` is ONE WASM opcode (0xFC 0x0B) — but it does Θ(arena-size) work,
// linear in the number of bytes zeroed. One *instruction* is not one *clock*, and a single opcode over a
// region is not O(1). The SHIPPED emitter (packages-logicn/logicn-core-compiler/src/wat-emitter.ts) already
// phrases it correctly — "ONE atomic instruction" doing work "over [base, heap)". This lint stops the
// false complexity claim from re-entering the docs/source where the emitter got it right.
//
// THE INVARIANT (phrase-blocklist, proximity-scoped to stay high-signal):
//   In *.md, *.lln, and code COMMENTS, no complexity-boost token — "O(1)", "single-clock",
//   "constant-time" — may appear within ~8 words of a zeroing token — "fill", "wipe", "zero-wipe",
//   "zeroize arena", "memory.fill". A pairing is the false claim; the approved phrasing is
//   "one atomic instruction doing Θ(arena-size) work".
//
// NOT a violation (so the lint does not flag the docs that CORRECT the claim): a line that is debunking
// the overclaim — it carries the approved correction "Θ(arena-size)", or an explicit refutation marker
// ("overclaim", "settled-false", "debunk", "refute", "myth"), or an inline `lln-allow: overclaim-phrase`.
// The proximity window also means an unrelated "O(1) allocation … bump arena" (no fill/wipe nearby) is fine.
//
// Scope: walks from --root (default cwd). *.md / *.lln scanned whole; *.ts/.tsx/.mjs/.cjs/.js/.jsx scanned
// COMMENTS-ONLY (code + string literals are masked, so the emitter's literal `(memory.fill …)` instruction
// strings are not mistaken for prose). This file + *.test.* + node_modules/dist/build/.graph are skipped.
// Exit code = violation count (0 = clean). Run from repo root.
//   node scripts/audit-overclaim-phrases.mjs             → scan the tree
//   node scripts/audit-overclaim-phrases.mjs --json      → machine-readable findings
//   node scripts/audit-overclaim-phrases.mjs --self-test → prove the detector fires (and the exemption is targeted)
import { readdirSync, statSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// ── the blocklist (pure, exported) ──────────────────────────────────────────────────────────────────
export const APPROVED = "one atomic instruction doing Θ(arena-size) work"; // Θ(arena-size)
export const WINDOW = 8; // "within ~8 words"

// complexity-boost tokens: O(1) (word-boundaried so foo(1)/to(1) don't match), single-clock, constant-time.
export const BOOST_RE = /\bO\(\s*1\s*\)|single[-\s]?clock|constant[-\s]?time/gi;
// zeroing tokens: memory.fill / zero-wipe / zeroize arena listed explicitly; bare fill|wipe catch the rest.
export const TARGET_RE = /memory\.fill|zero[-\s]?wipe|zeroize\s+arena|\bfill\b|\bwipe\b/gi;
// a line is EXEMPT when it is correcting/quoting the overclaim, not asserting it. Markers: the approved
// correction (Θ(arena-size) or its big-O twin O(arena-size) / "linear work|time|in"), an explicit
// "not O(1)" negation, a refutation word (overclaim/settled-false/debunk/refute/myth), or the inline allow.
export const EXEMPT_RE = /[ΘOoΟθ]\s*\(\s*arena|theta\s*\(\s*arena|linear\s+(?:work|time|in\b)|not\s+["'“”]?O\s*\(\s*1\s*\)|overclaim|settled[-\s]?false|debunk|refut|\bmyth\b|lln-allow:\s*overclaim-phrase/i;

/** Number of whitespace-delimited words strictly between two character spans (0 if adjacent/overlapping). */
function wordsBetween(text, earlierEnd, laterStart) {
  if (laterStart <= earlierEnd) return 0;
  return text.slice(earlierEnd, laterStart).match(/\S+/g)?.length ?? 0;
}

/**
 * Find every boost↔target pairing within WINDOW words. Returns [{ boostOff, targetOff, boost, target, gap }].
 * Each boost is reported once, paired with its NEAREST qualifying target.
 */
export function scan(text) {
  const spans = (re) => [...text.matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length, t: m[0] }));
  const boosts = spans(BOOST_RE);
  const targets = spans(TARGET_RE);
  const out = [];
  for (const b of boosts) {
    let best = null;
    for (const tg of targets) {
      const [earlier, later] = b.start <= tg.start ? [b, tg] : [tg, b];
      const gap = wordsBetween(text, earlier.end, later.start);
      if (gap <= WINDOW && (best === null || gap < best.gap)) best = { gap, tg };
    }
    if (best) out.push({ boostOff: b.start, targetOff: best.tg.start, boost: b.t, target: best.tg.t, gap: best.gap });
  }
  return out;
}

/** Map character offsets → 1-based line numbers + the physical line text, for an entire document. */
function lineIndex(text) {
  const lines = text.split(/\n/);
  const starts = [];
  let acc = 0;
  for (const l of lines) { starts.push(acc); acc += l.length + 1; }
  const lineOf = (off) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; }
    return lo;
  };
  return { lines, lineOf };
}

/**
 * Violations in one document = scan() pairings whose boost-line AND target-line are BOTH non-exempt.
 * A debunking line (carries the correction or a refutation marker) is not a violation.
 */
export function findViolations(text) {
  const { lines, lineOf } = lineIndex(text);
  const out = [];
  for (const f of scan(text)) {
    const bLine = lineOf(f.boostOff);
    const tLine = lineOf(f.targetOff);
    if (EXEMPT_RE.test(lines[bLine] ?? "") || EXEMPT_RE.test(lines[tLine] ?? "")) continue;
    out.push({
      line: bLine + 1,
      boost: f.boost,
      target: f.target,
      gap: f.gap,
      snippet: (lines[bLine] ?? "").trim().slice(0, 120),
    });
  }
  return out;
}

/**
 * Mask a source file down to its COMMENTS: every non-comment character becomes a space (newlines kept), so
 * line numbers stay exact and code + string literals (e.g. the emitter's `(memory.fill …)`) can't match.
 * Handles // line comments, /* block *​/, and '…' "…" `…` string literals. A heuristic (no regex-literal
 * lexer); good enough — the overclaim lives in prose comments, not in regex bodies.
 */
export function maskToComments(src) {
  const out = new Array(src.length).fill(" ");
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "\n") { out[i] = "\n"; i++; continue; }
    if (c === "/" && d === "/") { // line comment → keep its text
      i += 2;
      while (i < n && src[i] !== "\n") { out[i] = src[i]; i++; }
      continue;
    }
    if (c === "/" && d === "*") { // block comment → keep its text (newlines preserved)
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { out[i] = src[i] === "\n" ? "\n" : src[i]; i++; }
      i += 2; // skip the closing */ (past EOF is harmless)
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { // string literal → blanked (keep newlines for line numbers)
      const q = c;
      i++;
      while (i < n && src[i] !== q) {
        if (src[i] === "\\") { if (src[i + 1] === "\n") out[i + 1] = "\n"; i += 2; continue; }
        if (src[i] === "\n") out[i] = "\n";
        i++;
      }
      i++;
      continue;
    }
    i++;
  }
  return out.join("");
}

// ── file walk ───────────────────────────────────────────────────────────────────────────────────────
const PROSE_EXT = new Set([".md", ".lln"]);
const CODE_EXT = new Set([".ts", ".tsx", ".mjs", ".cjs", ".js", ".jsx"]);
const SKIP_DIR = new Set(["node_modules", "dist", "build", ".graph", ".git", "coverage", "test-fixtures"]);
// path fragments that exclude a FILE: this audit itself (it spells the phrases out), any test, and the
// example/benchmark corpora (whitelisted like the other .lln lints — not where the overclaim lands).
const SKIP_FILE = ["audit-overclaim-phrases", ".test.", "/examples/", "\\examples\\", "/benchmarks/", "\\benchmarks\\"];

function walk(dir, acc) {
  let ents;
  try { ents = readdirSync(dir); } catch { return acc; }
  for (const e of ents) {
    if (SKIP_DIR.has(e) || e.startsWith(".")) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { walk(p, acc); continue; }
    const dot = e.lastIndexOf(".");
    const ext = dot < 0 ? "" : e.slice(dot).toLowerCase();
    const mode = PROSE_EXT.has(ext) ? "prose" : CODE_EXT.has(ext) ? "code" : null;
    if (!mode) continue;
    const norm = p.replace(/\\/g, "/");
    if (SKIP_FILE.some((s) => p.includes(s) || norm.includes(s))) continue;
    acc.push({ path: p, mode });
  }
  return acc;
}

// ── CLI guard ─────────────────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

// ── self-test: prove the detector fires AND the exemption is targeted (a neutered lint is a fail-open) ──
if (isMain && process.argv.includes("--self-test")) {
  const t = (s) => findViolations(s).length;
  const catchesBad = t("G5 zero-wipe is an O(1) memory.fill(0) zero-wipe") > 0;          // the canonical overclaim → flag
  const passesGood = t("the reset is one atomic memory.fill (Θ(arena-size) work)") === 0; // approved phrasing → clean
  const farIsFine = t("O(1) one two three four five six seven eight nine ten fill") === 0; // >8 words apart → not paired
  const nearFlags = t("O(1) one two three four fill") > 0;                                // <8 words apart → paired
  const exemptDebunk = t('the overclaim "O(1) memory.fill zero-wipe" is settled-false') === 0; // refutation line → exempt
  const exemptCorrection = t("not O(1): memory.fill is Θ(arena-size) per byte zeroed") === 0; // carries the correction → exempt
  const exemptIsTargeted = t('a plain "O(1) memory.fill" with no correction word') > 0;   // same pairing, no marker → still flags
  // comment masking: a boost+target inside CODE/strings is invisible; inside a // comment it is caught.
  const codeMasked = findViolations(maskToComments('const s = "O(1) memory.fill zero-wipe"; foo();')).length === 0;
  const commentCaught = findViolations(maskToComments("foo(); // O(1) memory.fill zero-wipe here")).length > 0;
  const ok = catchesBad && passesGood && farIsFine && nearFlags && exemptDebunk && exemptCorrection
    && exemptIsTargeted && codeMasked && commentCaught;
  console.log(`[self-test] bad→flag:${catchesBad} good→clean:${passesGood} far→clean:${farIsFine} near→flag:${nearFlags} `
    + `debunk-exempt:${exemptDebunk} correction-exempt:${exemptCorrection} exemption-targeted:${exemptIsTargeted} `
    + `code-masked:${codeMasked} comment-caught:${commentCaught}`);
  console.log(ok ? "[self-test] PASS — overclaim phrase-blocklist fires on the false claim, silent on the correction" : "[self-test] FAIL");
  process.exit(ok ? 0 : 1);
}

// ── scan the tree ─────────────────────────────────────────────────────────────────────────────────
if (isMain) {
  const rootArg = process.argv.indexOf("--root");
  const root = rootArg >= 0 ? process.argv[rootArg + 1] : ".";
  const asJson = process.argv.includes("--json");

  const files = walk(root, []);
  const violations = [];
  for (const { path, mode } of files) {
    let text;
    try { text = readFileSync(path, "utf8"); } catch { continue; }
    if (mode === "code") text = maskToComments(text);
    for (const v of findViolations(text)) {
      violations.push({ file: path.replace(/\\/g, "/"), ...v });
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ violations: violations.length, scanned: files.length, findings: violations, approved: APPROVED }, null, 2));
    process.exit(violations.length);
  }

  console.log(`overclaim-phrases: scanned ${files.length} doc/.lln/source file(s) for O(1)/single-clock/constant-time within ${WINDOW} words of fill/wipe/memory.fill`);
  for (const v of violations) {
    console.log(`  ✖ ${v.file}:${v.line}: "${v.boost}" ${v.gap} word(s) from "${v.target}" — ${v.snippet}`);
  }
  console.log(
    violations.length === 0
      ? "overclaim-phrases: no false O(1)/constant-time zeroing claim — memory.fill is correctly Θ(arena-size)."
      : `overclaim-phrases: ${violations.length} overclaim(s). memory.fill is ONE opcode doing Θ(arena-size) work. Approved phrasing: "${APPROVED}".`,
  );
  console.log(`VIOLATIONS: ${violations.length}`);
  console.log(`TOTAL: ${violations.length} overclaim-phrase violation(s)`);
  process.exit(violations.length);
}

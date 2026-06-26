#!/usr/bin/env node
// =============================================================================================
// lln-astshape — AST-SHAPE INSPECTOR for build-spec authors
// ---------------------------------------------------------------------------------------------
// WHY THIS EXISTS: build-spec diff-level patches that TRAVERSE the AST (children[i], receiver-vs-
// arg in `recv.method(arg)`, annotated-typeName vs inferred-binding) have shipped real bugs that
// only surfaced on APPLY (RD-0103 secret-zeroing, RD-0111 chain-recognition, RD-0112 segment shape).
// The fix: BEFORE you write a traversal patch, dump the REAL node shape from the SHIPPED parser and
// confirm your assumptions. This tool is that check. Run it; paste its output into the build-spec
// as evidence (the adopted process rule for any AST-traversing patch).
//
// THE RD-0111 LESSON IT CATCHES (try: `node scripts/lln-astshape.mjs` with no args):
//   `authorize.passport(v)` parses to  callExpr value="passport"  children=[ id "authorize", id "v" ]
//   -> children[0] is the RECEIVER namespace ("authorize"), NOT the arg. A patch doing
//      `init.children?.[0]` grabs the receiver. The arg is children[1..]. This tool makes that obvious.
//
// USAGE:
//   node scripts/lln-astshape.mjs '<lln snippet>'      # inspect an inline snippet
//   node scripts/lln-astshape.mjs --file path.lln      # inspect a file
//   node scripts/lln-astshape.mjs --kind callExpr ...  # only print nodes of a given kind
//   node scripts/lln-astshape.mjs --self-hosted '...'  # dump the Stage-B self-hosted parser shape (RD-0122)
//   node scripts/lln-astshape.mjs                      # demo: the RD-0111 construct + the lesson
//
// GROUNDING: imports the SHIPPED core-compiler parser (read-only), resolved relative to THIS script
// so it works from any checkout. Fail-closed: exit 2 if the dist is absent (build LogicN first).
// Deterministic, no writes, no network. crypto/substrate untouched.
// Productionized from R-AND-D tools/lln-astshape.mjs (worker, RD post-0112); path made relative.
// =============================================================================================
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "..", "packages-logicn", "logicn-core-compiler", "dist", "index.js");
let L, parseProgram;
try {
  L = await import(pathToFileURL(DIST).href);
  ({ parseProgram } = L);
  if (typeof parseProgram !== "function") throw new Error("dist did not export parseProgram");
} catch (e) {
  console.error("FAIL-CLOSED (exit 2): could not import the SHIPPED parser dist — build LogicN first.\n  " + e.message);
  process.exit(2);
}

// ---- --self-hosted: dump the Stage-B (src/self-hosted/parser.lln) shape the .lln checkers consume --
// The Stage-A host parser (the default dump below) is NOT what effect-checker.lln / governance-verifier.lln
// / type-checker.lln / gir-emitter.lln see — they consume the SELF-HOSTED parser's output. Auditing those
// against the host shape is the RD-0122 blind spot; this closes it. Reuses the self-hosted-pipeline path:
// host-parse lexer.lln + parser.lln, run their tokenize→parseFlows via the shipped walker, print the result.
const SH_DIR = join(HERE, "..", "packages-logicn", "logicn-core-compiler", "src", "self-hosted");
function loadSelfHosted(file) {
  const { resolveSymbols, checkTypes } = L;
  if (typeof resolveSymbols !== "function" || typeof checkTypes !== "function") {
    console.error("FAIL-CLOSED (exit 2): dist missing resolveSymbols/checkTypes for --self-hosted."); process.exit(2);
  }
  const p = parseProgram(readFileSync(join(SH_DIR, file), "utf8"), file);
  resolveSymbols(p.ast); checkTypes(p.ast);
  const errs = (p.diagnostics ?? []).filter((d) => d.severity === "error");
  if (errs.length) { console.error(`FAIL-CLOSED (exit 2): ${file} has errors: ${errs.map((e) => e.message).join("; ")}`); process.exit(2); }
  return p;
}
// Pretty-print a LogicNValue (the Stage-B AST): records→.fields(Map), lists→.items, tagged/primitive→.__tag/.value.
function printVal(v, indent = "", seen = new Set()) {
  if (v === null || v === undefined) return indent + "·null";
  if (typeof v !== "object") return indent + JSON.stringify(v);
  if (seen.has(v)) return indent + "<cycle>"; seen.add(v);
  const tag = v.__tag ? `[${v.__tag}]` : "";
  if (v.__tag === "ok" || v.__tag === "some") return indent + tag + "\n" + printVal(v.value, indent + "  ", seen);
  if (v.__tag === "err" || v.__tag === "none") return indent + tag + (v.value !== undefined ? "\n" + printVal(v.value, indent + "  ", seen) : "");
  if (Array.isArray(v.items)) {
    if (v.items.length === 0) return indent + `list${tag} []`;
    return indent + `list${tag} (${v.items.length})` + v.items.map((it) => "\n" + printVal(it, indent + "  ", seen)).join("");
  }
  if (v.fields instanceof Map) {
    const keys = [...v.fields.keys()];
    return indent + `record${tag} {${keys.join(", ")}}` +
      keys.map((k) => "\n" + indent + "  ." + k + ":\n" + printVal(v.fields.get(k), indent + "    ", seen)).join("");
  }
  if ("value" in v) return indent + `${tag} value=${JSON.stringify(v.value)}`;
  const keys = Object.keys(v).filter((k) => k !== "__tag");
  return indent + `obj${tag} {${keys.join(", ")}}` + keys.map((k) => "\n" + printVal(v[k], indent + "  ", seen).replace(/^(\s*)/, "$1." + k + "= ")).join("");
}
async function runSelfHosted(snippet) {
  const { executeFlow } = L;
  if (typeof executeFlow !== "function") { console.error("FAIL-CLOSED (exit 2): dist missing executeFlow for --self-hosted."); process.exit(2); }
  const SNIPPET = snippet || "secure flow charge(amount: Int) -> Int { dbWrite(amount)\nif ok { return 0 } else { auditWrite(amount) }\nreturn amount }";
  console.log("== lln-astshape --self-hosted :: Stage-B (src/self-hosted/parser.lln) shape ==");
  console.log("source: " + JSON.stringify(SNIPPET));
  const lexer = loadSelfHosted("lexer.lln");
  const parser = loadSelfHosted("parser.lln");
  const vStr = (s) => ({ __tag: "string", value: s });
  const lexRes = await executeFlow("tokenize", new Map([["source", vStr(SNIPPET)]]), lexer.ast);
  let toks = lexRes.value ?? lexRes; if (toks && toks.__tag === "ok") toks = toks.value;
  const parseRes = await executeFlow("parseFlows", new Map([["tokens", toks]]), parser.ast);
  const pr = parseRes.value ?? parseRes;
  console.log("\n--- ParseResult (the REAL self-hosted shape the .lln checkers consume) ---");
  console.log(printVal(pr));
  console.log("\nNOTE: Stage-B producer shape — the ground truth for auditing the self-hosted");
  console.log("effect/governance/type/gir checkers (the Stage-A host dump is NOT). RD-0122.");
}

// ---- arg parsing -----------------------------------------------------------------------------
const argv = process.argv.slice(2);
let onlyKind = null;
const ki = argv.indexOf("--kind");
if (ki !== -1) { onlyKind = argv[ki + 1]; argv.splice(ki, 2); }
const SELF_HOSTED = argv.includes("--self-hosted");
if (SELF_HOSTED) argv.splice(argv.indexOf("--self-hosted"), 1);
let src, label;
const fi = argv.indexOf("--file");
if (fi !== -1) { const p = argv[fi + 1]; src = readFileSync(p, "utf8"); label = p; }
else if (argv.length && argv[0] !== "--demo") { src = argv[0]; label = "(inline)"; }

// --self-hosted dumps the Stage-B producer shape and exits before the Stage-A host-parse path below.
if (SELF_HOSTED) { await runSelfHosted(src); process.exit(0); }

const DEMO = !src;
if (DEMO) {
  // wrap the bare expression in a minimal valid flow so the parser accepts it
  src = "flow demo(v: Int) -> Int contract { effects { network.outbound } } {\n  let a: Int = authorize.passport(verify.passport(v))\n  return a\n}";
  label = "(RD-0111 demo — authorize.passport(verify.passport(v)))";
}

// ---- parse (shipped) -------------------------------------------------------------------------
const prog = parseProgram(src, "astshape.lln");
const errs = (prog.diagnostics ?? []).filter((d) => d.severity === "error");
console.log("== lln-astshape :: " + label + " ==");
if (errs.length) {
  console.log("PARSE ERRORS (the snippet may need wrapping in a flow{} to parse):");
  for (const e of errs.slice(0, 6)) console.log("  " + (e.code ?? "?") + ": " + e.message);
  console.log("");
}

// ---- pretty-print the AST tree ---------------------------------------------------------------
// Member calls (callExpr with a receiver) are the #1 trap: children[0] = RECEIVER, children[1..] = args.
function isMemberCall(n) {
  return n && n.kind === "callExpr" && Array.isArray(n.children) && n.children.length >= 1 &&
    n.children[0] && n.children[0].kind === "identifier";
}
function annotate(node, idx, parent) {
  if (parent && parent.kind === "callExpr" && Array.isArray(parent.children)) {
    if (idx === 0) return "  ⟵ [0] RECEIVER (namespace, e.g. 'authorize'/'verify') — NOT the arg";
    return "  ⟵ [" + idx + "] arg " + (idx - 1);
  }
  return "";
}
function dump(node, depth, idx, parent) {
  if (!node || typeof node !== "object") return;
  const pad = "  ".repeat(depth);
  const v = node.value !== undefined ? " value=" + JSON.stringify(node.value) : "";
  const tn = node.typeName !== undefined ? " typeName=" + JSON.stringify(node.typeName) : " typeName=<none/inferred>";
  const show = !onlyKind || node.kind === onlyKind;
  if (show) console.log(pad + (node.kind ?? "?") + v + (node.kind === "identifier" || node.kind === "letDecl" ? tn : "") + annotate(node, idx, parent));
  const kids = node.children ?? [];
  for (let i = 0; i < kids.length; i++) dump(kids[i], depth + 1, i, node);
}
dump(prog.ast, 0, -1, null);

// ---- explicit member-call digest (the receiver-vs-arg trap, listed flat) ---------------------
const calls = [];
(function walk(n) { if (!n || typeof n !== "object") return; if (isMemberCall(n)) calls.push(n); for (const c of (n.children ?? [])) walk(c); })(prog.ast);
if (calls.length) {
  console.log("\n-- member-call digest (the receiver-vs-arg trap) --");
  for (const c of calls) {
    const recv = c.children[0];
    const args = c.children.slice(1);
    console.log("  " + JSON.stringify(recv.value) + "." + JSON.stringify(c.value) + "(" + args.map((a) => JSON.stringify(a.value)).join(", ") + ")");
    console.log("    method  = node.value            = " + JSON.stringify(c.value));
    console.log("    RECEIVER= children[0].value     = " + JSON.stringify(recv.value) + "   ← a patch doing children[0] grabs THIS, the namespace");
    console.log("    arg(s)  = children[1..].value   = [" + args.map((a) => JSON.stringify(a.value)).join(", ") + "]   ← the actual arguments");
  }
}

if (DEMO) {
  console.log("\nLESSON (RD-0111): the inflow passport is the ARG (children[1..]) and may be an UNANNOTATED");
  console.log("binding (typeName=<none>) carrying only a passportStage — recognize it by binding-resolution,");
  console.log("not by children[0] or typeName alone. Run this on YOUR construct before writing the traversal.");
}
process.exit(errs.length ? 1 : 0);

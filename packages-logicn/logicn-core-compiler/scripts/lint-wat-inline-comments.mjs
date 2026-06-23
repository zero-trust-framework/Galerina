#!/usr/bin/env node
// lint-wat-inline-comments.mjs — guards the #163 fail-open CLASS at the source.
//
// THE BUG CLASS (found twice today): a WAT emitter that `return`s an expression
// FRAGMENT (it gets spliced inline into a parent S-expression) must not end that
// fragment with a `;;` line comment — `;;` runs to end-of-line, so inline it swallows
// the enclosing `)`. wabt then rejects the module, assembleWAT falls back to a stub,
// and (historically) executeWASMFlow ran the stub and returned a WRONG VALUE instead
// of trapping. The author documented this rule in wat-emitter.ts:1038-1039 — yet the
// static-const (#1021), bitfield (#1035) and eight `(unreachable)` traps still violated
// it. Human vigilance failed; this lint enforces it mechanically.
//
// RULE: a `return` of a template literal that contains `;;` is forbidden in a WAT
// emitter. Use an inline-safe WAT BLOCK comment `(; ... ;)` instead (delimited; it does
// not run to end-of-line). Block comments contain no `;;`, so they pass.
//
// Exit 0 = clean. Exit 1 = at least one inline-`;;`-in-returned-fragment hazard.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// WAT-emitting sources whose `return`ed templates become inline expression fragments.
const TARGETS = ["src/wat-emitter.ts"];

// A returned single-line template literal that carries a `;;` line comment.
// (Multi-line WAT fragments are pushed to newline-joined arrays, not returned inline,
// so a line-scoped check covers the inline-return hazard precisely.)
const HAZARD = /return\s+`[^`]*;;[^`]*`/;

let violations = 0;
for (const rel of TARGETS) {
  const abs = join(ROOT, rel);
  const lines = readFileSync(abs, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    if (HAZARD.test(line)) {
      violations++;
      console.error(`✖ ${rel}:${i + 1}  inline-returned WAT fragment ends with a ';;' line comment`);
      console.error(`    ${line.trim()}`);
      console.error(`    → use an inline-safe block comment '(; ... ;)' (it can't swallow the enclosing ')').`);
    }
  });
}

if (violations > 0) {
  console.error(`\n${violations} inline-comment hazard(s) — #163 fail-open class. See wat-emitter.ts:1038-1039.`);
  process.exit(1);
}
console.log("lint-wat-inline-comments: clean — no inline-returned WAT fragment carries a ';;' line comment.");

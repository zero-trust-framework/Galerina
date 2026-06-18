// Regression for dogfooding #3: `logicn run <f> --invoke <flow> [args]` used to marshal CLI args
// with `.map(Number)`, so BOTH "true" and "false" became NaN → i32 0 → false — a wrong-but-plausible
// Bool argument silently fizzled to `false` with no error. The fix marshals Bool literals (true/false
// → 1/0) and fails LOUDLY (exit 2) on anything un-parseable, instead of silently coercing to 0.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE = join(ROOT, "build", "__cli_marshal_test.lln");

function run(...args) {
  const r = spawnSync(process.execPath, ["logicn.mjs", "run", FIXTURE, "--invoke", "boolToInt", ...args],
    { cwd: ROOT, encoding: "utf-8", timeout: 60000 });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

before(() => {
  mkdirSync(dirname(FIXTURE), { recursive: true });
  // Distinct, unlikely return values so the marshalled bool is unambiguous in the output.
  writeFileSync(FIXTURE, `pure flow boolToInt(b: Bool) -> Int {\n  if b { return 777 }\n  return 333\n}\n`);
});
after(() => { try { rmSync(FIXTURE, { force: true }); } catch { /* ignore */ } });

test("Bool literals marshal distinctly (true→1→777, false→0→333), not silently to one value", () => {
  const t = run("true");
  const f = run("false");
  assert.equal(t.status, 0, t.out);
  assert.equal(f.status, 0, f.out);
  assert.match(t.out, /777/, "true must marshal to 1 → boolToInt returns 777");
  assert.doesNotMatch(t.out, /333/, "true must NOT fall through to the false branch (the old silent bug)");
  assert.match(f.out, /333/, "false must marshal to 0 → boolToInt returns 333");
});

test("an un-parseable invoke arg fails LOUDLY (exit 2 + clear message), never silently to 0", () => {
  const r = run("garbage");
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /not a valid Int or Bool/);
});

// dogfooding #2: a flow that EXISTS but is not WASM-exportable (a secure/effectful flow) used to
// report "Flow 'main' not found" — implying it doesn't exist. Now it explains the WASM-surface limit.
test("a secure/effectful flow gives a CLEAR 'not in the WASM surface' diagnostic, not 'not found'", () => {
  const f2 = join(ROOT, "build", "__cli_marshal_secure.lln");
  writeFileSync(f2,
    `pure flow collapse(v: Int) -> Int { if v == 1 { return 1 } return -1 }\n\n` +
    `secure flow main() -> Result<Void, Error>\ncontract { intent { "demo" } }\n{\n` +
    `  console.log("x = " . collapse(1))\n  return Ok()\n}\n`);
  try {
    const r = spawnSync(process.execPath, ["logicn.mjs", "run", f2, "--invoke", "main"],
      { cwd: ROOT, encoding: "utf-8", timeout: 60000 });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    assert.equal(r.status, 1, out);
    assert.match(out, /NOT in the WASM --invoke surface/, "must explain main is not WASM-exportable");
    assert.match(out, /Invokable here.*collapse/, "must list the invokable pure flows");
    assert.match(out, /--governed/, "must point the user to the governed runtime (#125)");
    const r2 = spawnSync(process.execPath, ["logicn.mjs", "run", f2, "--invoke", "nope"],
      { cwd: ROOT, encoding: "utf-8", timeout: 60000 });
    assert.match(`${r2.stdout ?? ""}${r2.stderr ?? ""}`, /No flow named 'nope'/, "absent flow gets the other branch");
  } finally {
    try { rmSync(f2, { force: true }); } catch { /* ignore */ }
  }
});

// #125 secure-flow-run: `--governed` runs a flow through the FULL governed runtime (contract
// enforcer + fail-closed capability host granting only declared effects + audit), instead of the
// raw WASM --invoke surface. It is the path for secure/effectful flows the WASM surface rejects.
test("--governed runs a flow through the governed runtime and prints its value (exit 0)", () => {
  const f = join(ROOT, "build", "__g_clean.lln");
  writeFileSync(f, `pure flow answer() -> Int { return 42 }\n`);
  try {
    const r = spawnSync(process.execPath, ["logicn.mjs", "run", f, "--invoke", "answer", "--governed"],
      { cwd: ROOT, encoding: "utf-8", timeout: 60000 });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    assert.equal(r.status, 0, out);
    assert.match(out, /\b42\b/, "must print the flow's value");
    assert.match(out, /governed/, "must announce the governed runtime");
  } finally {
    try { rmSync(f, { force: true }); } catch { /* ignore */ }
  }
});

test("--governed is FAIL-CLOSED: a governance violation refuses to run (exit 1 + LLN diagnostic)", () => {
  const f = join(ROOT, "build", "__g_violation.lln");
  // console.log without an import → LLN-NAME-001; the governed run must refuse, not execute.
  writeFileSync(f, `flow leaky() -> Int {\n  console.log("hi")\n  return 1\n}\n`);
  try {
    const r = spawnSync(process.execPath, ["logicn.mjs", "run", f, "--invoke", "leaky", "--governed"],
      { cwd: ROOT, encoding: "utf-8", timeout: 60000 });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    assert.equal(r.status, 1, out);
    assert.match(out, /LLN-[A-Z]+-\d+/, "must surface the governance diagnostic");
    assert.match(out, /fail-closed/i, "must announce it refused fail-closed");
  } finally {
    try { rmSync(f, { force: true }); } catch { /* ignore */ }
  }
});

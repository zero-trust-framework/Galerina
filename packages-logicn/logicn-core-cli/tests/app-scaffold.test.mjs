// app-scaffold.test.mjs — B1: `logicn new app` app-layout scaffolder.
//
// Locks the app-framework layout convention + its zero-trust defaults:
//   App.lln + App.manifest + flows/ + deps/ + proofs/, deny-by-default,
//   fail-closed, refuse-to-overwrite. Structural/content assertions only (no
//   compile) so the test stays fast and toolchain-independent; the build path is
//   verified manually + by the compiler suite.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SCAFFOLDER = fileURLToPath(new URL("../../../scripts/logicn-new.mjs", import.meta.url));

function runScaffold(args) {
  return spawnSync(process.execPath, [SCAFFOLDER, ...args], {
    encoding: "utf8",
    shell: false,
  });
}

function withTempDir(fn) {
  const base = mkdtempSync(join(tmpdir(), "logicn-b1-"));
  try {
    return fn(base);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

test("logicn new app — emits the App.lln + App.manifest + flows/ deps/ proofs/ layout", () => {
  withTempDir((base) => {
    const target = join(base, "my-app");
    const r = runScaffold(["app", target]);
    assert.equal(r.status, 0, `scaffold should succeed:\n${r.stderr}`);

    for (const rel of [
      "App.lln",
      "App.manifest",
      "flows/example.lln",
      "deps/README.md",
      "proofs/README.md",
      "README.md",
      ".gitignore",
    ]) {
      assert.ok(existsSync(join(target, rel)), `expected ${rel} to be scaffolded`);
    }
    // The three convention dirs exist as directories.
    for (const d of ["flows", "deps", "proofs"]) {
      assert.ok(statSync(join(target, d)).isDirectory(), `${d}/ should be a directory`);
    }
  });
});

test("logicn new app — App.manifest is deny-by-default (no caps, no deps, kind=app)", () => {
  withTempDir((base) => {
    const target = join(base, "secure-app");
    const r = runScaffold(["app", target]);
    assert.equal(r.status, 0, r.stderr);

    const manifest = JSON.parse(readFileSync(join(target, "App.manifest"), "utf8"));
    assert.equal(manifest.kind, "app");
    assert.equal(manifest.schemaVersion, "lln.app.v1");
    assert.equal(manifest.entry, "App.lln");
    assert.equal(manifest.name, "secure-app");
    // Deny-by-default: nothing granted, nothing admitted.
    assert.deepEqual(manifest.capabilities, [], "capabilities must default to []");
    assert.deepEqual(manifest.deps, [], "deps must default to [] (admits nothing)");
    // Build target declared so the convention is self-describing.
    assert.equal(manifest.build.wasm, "build/App.wasm");
    assert.equal(manifest.build.manifest, "build/App.lmanifest");
  });
});

test("logicn new app — App.lln is pure (no effects) and fail-closed (mandatory wildcard)", () => {
  withTempDir((base) => {
    const target = join(base, "fc-app");
    const r = runScaffold(["app", target]);
    assert.equal(r.status, 0, r.stderr);

    const app = readFileSync(join(target, "App.lln"), "utf8");
    assert.match(app, /pure flow main\(\)\s*->\s*Int/, "entry must be a pure flow");
    // Check CODE only — the doc comment legitimately mentions `effects {}`.
    const code = app
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");
    assert.doesNotMatch(code, /\beffects\s*\{/, "scaffold must declare NO effects (deny-by-default)");
    assert.match(code, /_\s*=>/, "match must keep its mandatory fail-closed wildcard");
    // Capability binding lives in the signed manifest, never in a .tmf — the
    // scaffold teaches that explicitly.
    assert.match(app, /\.lmanifest/, "App.lln should point at the signed .lmanifest");
  });
});

test("logicn new app — refuses to overwrite an existing scaffold (fail-closed)", () => {
  withTempDir((base) => {
    const target = join(base, "twice");
    const first = runScaffold(["app", target]);
    assert.equal(first.status, 0, first.stderr);
    const second = runScaffold(["app", target]);
    assert.notEqual(second.status, 0, "second scaffold into the same dir must fail");
    assert.match(`${second.stdout}${second.stderr}`, /refusing to overwrite/);
  });
});

test("logicn new — package mode still works (backward compatible)", () => {
  withTempDir((base) => {
    const target = join(base, "pkg");
    const r = runScaffold([target]); // no mode token → package mode
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(target, "package.lln.json")), "package descriptor");
    assert.ok(existsSync(join(target, "src", "index.lln")), "package entry");
    assert.ok(!existsSync(join(target, "App.lln")), "package mode must NOT emit App.lln");
  });
});

test("logicn new app — bare mode token with no target dir is a usage error", () => {
  const r = runScaffold(["app"]);
  assert.notEqual(r.status, 0, "`new app` with no dir must fail, not silently make a package named 'app'");
  assert.match(`${r.stdout}${r.stderr}`, /missing <target-dir>/);
});

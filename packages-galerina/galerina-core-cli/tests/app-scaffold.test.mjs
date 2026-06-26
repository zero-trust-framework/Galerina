// app-scaffold.test.mjs — B1: `galerina new app` app-layout scaffolder.
//
// `galerina new app` copies the canonical golden template
// (packages-galerina/galerina-framework-example-app) with the app name substituted and
// build outputs excluded. This locks that contract: the runnable layout
// (src/App.spore + src/flows/ + App.manifest + config/ + host/ + packages/greeting/ +
// tests/ + package.json/tsconfig.json), its zero-trust defaults (deny-by-default,
// fail-closed), and refuse-to-overwrite. Structural/content assertions only (no
// compile) so the test stays fast and toolchain-independent; the build + run path is
// verified by the example app's own e2e suite and the compiler suite.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SCAFFOLDER = fileURLToPath(new URL("../../../scripts/galerina-new.mjs", import.meta.url));

function runScaffold(args) {
  return spawnSync(process.execPath, [SCAFFOLDER, ...args], {
    encoding: "utf8",
    shell: false,
  });
}

function withTempDir(fn) {
  const base = mkdtempSync(join(tmpdir(), "galerina-b1-"));
  try {
    return fn(base);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

test("galerina new app — emits the full runnable golden layout (name-substituted, no build outputs)", () => {
  withTempDir((base) => {
    const target = join(base, "my-app");
    const r = runScaffold(["app", target]);
    assert.equal(r.status, 0, `scaffold should succeed:\n${r.stderr}`);

    for (const rel of [
      "src/App.spore",
      "src/flows/greeting.spore",
      "App.manifest",
      "config/app.config.json",
      "host/server.ts",
      "host/config.ts",
      "packages/greeting/package.spore.json",
      "packages/greeting/src/index.spore",
      "tests/e2e.test.mjs",
      "package.json",
      "tsconfig.json",
      "deps/README.md",
      "proofs/README.md",
      "README.md",
      ".gitignore",
    ]) {
      assert.ok(existsSync(join(target, rel)), `expected ${rel} to be scaffolded`);
    }
    // The convention dirs exist as directories.
    for (const d of ["src", "src/flows", "config", "host", "packages/greeting", "deps", "proofs", "tests"]) {
      assert.ok(statSync(join(target, d)).isDirectory(), `${d}/ should be a directory`);
    }
    // Build outputs are NEVER copied — the new app rebuilds them.
    assert.ok(!existsSync(join(target, "packages/greeting/dist")), "greeting/dist must NOT be copied");
    assert.ok(!existsSync(join(target, "dist")), "host dist/ must NOT be copied");
  });
});

test("galerina new app — App.manifest is deny-by-default (no caps, kind=app, name substituted)", () => {
  withTempDir((base) => {
    const target = join(base, "secure-app");
    const r = runScaffold(["app", target]);
    assert.equal(r.status, 0, r.stderr);

    const manifest = JSON.parse(readFileSync(join(target, "App.manifest"), "utf8"));
    assert.equal(manifest.kind, "app");
    // A freshly-scaffolded app is unsigned, so galerina-new.mjs rewrites the golden (root-signed,
    // preserved) App.manifest's `lln.app.v1` -> the current `spore.app.v1`.
    assert.equal(manifest.schemaVersion, "spore.app.v1");
    assert.equal(manifest.entry, "src/App.spore");
    // The example app's identity string is replaced with the new app's name.
    assert.equal(manifest.name, "secure-app");
    // Deny-by-default: the app grants NO capabilities.
    assert.deepEqual(manifest.capabilities, [], "capabilities must default to []");
    // Build target declared so the convention is self-describing.
    assert.equal(manifest.build.wasm, "build/App.wasm");
    assert.equal(manifest.build.manifest, "build/App.lmanifest");

    // The app's own compute package is pure + grants nothing.
    const pkg = JSON.parse(readFileSync(join(target, "packages/greeting/package.spore.json"), "utf8"));
    assert.equal(pkg.name, "greeting", "the compute package keeps its own name (not the app name)");
    assert.deepEqual(pkg.capabilities, [], "greeting grants no capabilities");

    // package.json identity is the new app's name (unscoped).
    const npmPkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
    assert.equal(npmPkg.name, "secure-app");
  });
});

test("galerina new app — App.spore is pure (no effects) and fail-closed (mandatory wildcard)", () => {
  withTempDir((base) => {
    const target = join(base, "fc-app");
    const r = runScaffold(["app", target]);
    assert.equal(r.status, 0, r.stderr);

    const app = readFileSync(join(target, "src", "App.spore"), "utf8");
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
    assert.match(app, /\.lmanifest/, "App.spore should point at the signed .lmanifest");

    // The greeting compute is likewise pure and fail-closed.
    const greeting = readFileSync(join(target, "packages/greeting/src/index.spore"), "utf8");
    assert.match(greeting, /pure flow main\(\)\s*->\s*Int/, "greeting compute must be a pure flow");
    assert.match(greeting, /_\s*=>/, "greeting match must keep its fail-closed wildcard");
  });
});

test("galerina new app — refuses to overwrite an existing scaffold (fail-closed)", () => {
  withTempDir((base) => {
    const target = join(base, "twice");
    const first = runScaffold(["app", target]);
    assert.equal(first.status, 0, first.stderr);
    const second = runScaffold(["app", target]);
    assert.notEqual(second.status, 0, "second scaffold into the same dir must fail");
    assert.match(`${second.stdout}${second.stderr}`, /refusing to overwrite/);
  });
});

test("galerina new — package mode still works (backward compatible)", () => {
  withTempDir((base) => {
    const target = join(base, "pkg");
    const r = runScaffold([target]); // no mode token → package mode
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(target, "package.spore.json")), "package descriptor");
    assert.ok(existsSync(join(target, "src", "index.spore")), "package entry");
    assert.ok(!existsSync(join(target, "src", "App.spore")), "package mode must NOT emit the app entry src/App.spore");
  });
});

test("galerina new app — bare mode token with no target dir is a usage error", () => {
  const r = runScaffold(["app"]);
  assert.notEqual(r.status, 0, "`new app` with no dir must fail, not silently make a package named 'app'");
  assert.match(`${r.stdout}${r.stderr}`, /missing <target-dir>/);
});

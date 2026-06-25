import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanPackage, buildGraph, runBoundaryGate } from "../dist/index.js";

// Build a throwaway fixture package on disk.
function makeFixture(files, pkgName = "@logicn/fixture") {
  const root = mkdtempSync(join(tmpdir(), "pkg-graph-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: pkgName }));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

test("scanner classifies internal / node_core / workspace / thirdparty imports", () => {
  const root = makeFixture({
    "src/index.ts": `import { a } from "./a.js";\nimport { readFileSync } from "node:fs";\nimport { x } from "@logicn/other";\nimport axios from "axios";`,
    "src/a.ts": `export const a = 1;`,
  });
  const scan = scanPackage(root);
  const idx = scan.files.find(f => f.path === "src/index.ts");
  const kinds = idx.imports.map(i => `${i.specifier}:${i.kind}`).sort();
  assert.deepEqual(kinds, [
    "./a.js:internal",
    "@logicn/other:workspace",
    "axios:thirdparty",
    "node:fs:node_core",
  ]);
  rmSync(root, { recursive: true, force: true });
});

test("graph resolves internal edges and external surface", () => {
  const root = makeFixture({
    "src/index.ts": `import { a } from "./a.js";\nimport { readFileSync } from "node:fs";`,
    "src/a.ts": `export const a = 1;`,
  });
  const graph = buildGraph(scanPackage(root));
  assert.equal(graph.stats.fileCount, 2);
  assert.equal(graph.stats.internalEdgeCount, 1); // index -> a
  assert.equal(graph.stats.nodeCoreCount, 1);     // node:fs
  assert.equal(graph.stats.thirdpartyCount, 0);
  rmSync(root, { recursive: true, force: true });
});

test("orphan detection flags unreferenced non-entry files", () => {
  const root = makeFixture({
    "src/index.ts": `export const main = 1;`,
    "src/used.ts": `export const u = 1;`,
    "src/orphan.ts": `export const o = 1;`, // imported by nobody
    "src/consumer.ts": `import { u } from "./used.js";`, // also an orphan (nothing imports it)
  });
  const graph = buildGraph(scanPackage(root));
  // index.ts is an entry point (never orphan). used.ts is imported. orphan.ts + consumer.ts are orphans.
  assert.ok(graph.orphans.includes("src/orphan.ts"));
  assert.ok(graph.orphans.includes("src/consumer.ts"));
  assert.ok(!graph.orphans.includes("src/index.ts"));
  assert.ok(!graph.orphans.includes("src/used.ts"));
  rmSync(root, { recursive: true, force: true });
});

test("comments do not produce phantom imports", () => {
  const root = makeFixture({
    "src/index.ts": `// import axios from "axios";\n/* import lodash from "lodash"; */\nexport const x = 1;`,
  });
  const graph = buildGraph(scanPackage(root));
  assert.equal(graph.stats.thirdpartyCount, 0); // commented-out imports ignored
  rmSync(root, { recursive: true, force: true });
});

test("code-emitting template literals do not produce phantom imports", () => {
  // A WASM-text / code emitter builds import/export statements as STRINGS. The
  // scanner must not mistake those for the package's own ES import surface.
  const root = makeFixture({
    "src/emitter.ts":
      "export function emit(imp, fn) {\n" +
      "  const lines = [];\n" +
      '  lines.push(`  (import "${imp.module}" "${imp.name}" (func))`);\n' +
      '  lines.push(`  (export "memory" (memory 0))`);\n' +
      '  lines.push(`  (export "${fn.name}" (func $${fn.name}))`);\n' +
      "  return lines.join(String.fromCharCode(10));\n" +
      "}\n" +
      // A genuine side-effect import and dynamic import must still be detected.
      'import "node:fs";\n' +
      'const mod = await import("argon2");\n',
  });
  const graph = buildGraph(scanPackage(root));
  const specs = graph.externalDeps.map((d) => d.specifier).sort();
  // The three WAT-emitter strings (${imp.module}, memory, ${fn.name}) are excluded;
  // the real node:fs side-effect import and dynamic import("argon2") survive.
  assert.deepEqual(specs, ["argon2", "node:fs"]);
  rmSync(root, { recursive: true, force: true });
});

test("boundary gate: generation (no --check) creates a baseline", () => {
  const root = makeFixture({
    "src/index.ts": `import { readFileSync } from "node:fs";`,
  });
  const graph = buildGraph(scanPackage(root));
  const result = runBoundaryGate(root, graph, false); // generation mode establishes the baseline
  assert.equal(result.status, "BASELINE_CREATED");
  assert.ok(existsSync(join(root, ".graph", "boundary-policy.json")));
  rmSync(root, { recursive: true, force: true });
});

test("boundary gate: a MISSING policy under --check FAILS (no delete-to-launder)", () => {
  const root = makeFixture({
    "src/index.ts": `import { readFileSync } from "node:fs";`,
  });
  // Establish the baseline (generation mode).
  runBoundaryGate(root, buildGraph(scanPackage(root)), false);
  // Attacker (or accident) deletes the policy AND adds a forbidden import at the same time.
  rmSync(join(root, ".graph", "boundary-policy.json"), { force: true });
  writeFileSync(join(root, "src", "index.ts"),
    `import { readFileSync } from "node:fs";\nimport axios from "axios";`);
  const result = runBoundaryGate(root, buildGraph(scanPackage(root)), true); // enforce
  // MUST fail — never silently re-baseline a deleted policy (that would re-bless axios green).
  assert.equal(result.status, "FAIL");
  assert.ok(result.violations.some((v) => v.includes("missing")));
  // And it must NOT re-create the policy under --check (no laundering).
  assert.ok(!existsSync(join(root, ".graph", "boundary-policy.json")));
  rmSync(root, { recursive: true, force: true });
});

test("boundary gate: a malformed allowedExternal denies (unknown → deny, not allow-all)", () => {
  const root = makeFixture({
    "src/index.ts": `import { readFileSync } from "node:fs";\nimport axios from "axios";`,
  });
  // Write a policy whose allowedExternal is NOT a string array (corrupt/tampered shape).
  const dir = join(root, ".graph");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "boundary-policy.json"),
    JSON.stringify({ packageName: "@logicn/fixture", allowedExternal: "node:fs,axios" })); // string, not array
  const result = runBoundaryGate(root, buildGraph(scanPackage(root)), true);
  assert.equal(result.status, "FAIL"); // must NOT admit axios via a malformed allowlist
  assert.ok(result.violations.some((v) => v.includes("malformed") || v.includes("allowedExternal")));
  rmSync(root, { recursive: true, force: true });
});

test("boundary gate: new external dep fails --check after baseline", () => {
  const root = makeFixture({
    "src/index.ts": `import { readFileSync } from "node:fs";`,
  });
  // First run — baseline (generation) with only node:fs
  runBoundaryGate(root, buildGraph(scanPackage(root)), false);

  // Now add a forbidden third-party import
  writeFileSync(join(root, "src", "index.ts"),
    `import { readFileSync } from "node:fs";\nimport axios from "axios";`);
  const graph2 = buildGraph(scanPackage(root));
  const result = runBoundaryGate(root, graph2, true);

  assert.equal(result.status, "FAIL");
  assert.ok(result.violations.includes("axios"));
  rmSync(root, { recursive: true, force: true });
});

test("boundary gate: dep already in allowlist passes", () => {
  const root = makeFixture({
    "src/index.ts": `import { readFileSync } from "node:fs";`,
  });
  runBoundaryGate(root, buildGraph(scanPackage(root)), false); // baseline (generation) includes node:fs
  // Re-run --check with the same imports — should PASS
  const result = runBoundaryGate(root, buildGraph(scanPackage(root)), true);
  assert.equal(result.status, "PASS");
  assert.equal(result.violations.length, 0);
  rmSync(root, { recursive: true, force: true });
});

// ── Scope coverage: host/ root + .lln source (the example-app blind spot) ──────────────

test("scans host/ root AND .lln source — not just src/*.ts", () => {
  // Mirrors the framework example app: governed flows in src/*.lln, TS host in host/.
  // Before the fix this scanned to ZERO files (a green border over an unscanned package).
  const root = makeFixture({
    "src/App.lln": `pure flow main() -> Int\ncontract { intent { "x" } }\n{ return 0 }`,
    "host/server.ts": `import { readFileSync } from "node:fs";\nimport { c } from "./config.js";`,
    "host/config.ts": `export const c = 1;`,
  });
  const graph = buildGraph(scanPackage(root));
  const paths = graph.nodes.slice().sort();
  assert.deepEqual(paths, ["host/config.ts", "host/server.ts", "src/App.lln"]);
  assert.equal(graph.stats.fileCount, 3);             // .lln + host/*.ts all counted
  assert.equal(graph.stats.nodeCoreCount, 1);         // node:fs from host/server.ts
  assert.equal(graph.stats.internalEdgeCount, 1);     // host/server.ts -> host/config.ts
  assert.deepEqual(graph.scannedRoots, ["src", "host"]);
  assert.ok(graph.scannedExtensions.includes(".lln"));
  rmSync(root, { recursive: true, force: true });
});

test(".lln internal imports resolve as edges; ;;-comments + plugin form handled", () => {
  const root = makeFixture({
    "src/main.lln":
      `;; import "./commented-out.lln"   ;; a govComment — must NOT be counted\n` +
      `import "./util.lln"\n` +
      `import plugin safe "./plugins/pay.lln" as Pay {\n  contract { intent "pay" }\n}\n` +
      `pure flow main() -> Int\ncontract { intent { "x" } }\n{ return 0 }`,
    "src/util.lln": `pure flow u() -> Int\ncontract { intent { "x" } }\n{ return 0 }`,
    "src/plugins/pay.lln": `pure flow p() -> Int\ncontract { intent { "x" } }\n{ return 0 }`,
  });
  const graph = buildGraph(scanPackage(root));
  assert.equal(graph.stats.fileCount, 3);
  assert.equal(graph.stats.externalDepCount, 0);      // all imports are intra-package
  // main.lln -> util.lln  AND  main.lln -> plugins/pay.lln (the plugin path resolves inside)
  assert.equal(graph.stats.internalEdgeCount, 2);
  const froms = graph.internalEdges.map((e) => `${e.from}->${e.to}`).sort();
  assert.deepEqual(froms, ["src/main.lln->src/plugins/pay.lln", "src/main.lln->src/util.lln"]);
  // The ;;-commented import never produced a (dangling) edge.
  assert.ok(!froms.some((f) => f.includes("commented-out")));
  rmSync(root, { recursive: true, force: true });
});

// ── Escaping relative imports are a cross-package BORDER edge, not silently dropped ─────

// A mini monorepo: an app package whose host imports siblings by RELATIVE dist path
// (`../../sibling/dist/index.js`) — exactly how the example app reaches the app-kernel.
function makeMonorepo() {
  const parent = mkdtempSync(join(tmpdir(), "pkg-graph-mono-"));
  const mkPkg = (dir, json, files) => {
    mkdirSync(join(parent, dir), { recursive: true });
    writeFileSync(join(parent, dir, "package.json"), JSON.stringify(json));
    for (const [rel, content] of Object.entries(files)) {
      const full = join(parent, dir, rel);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, content);
    }
  };
  mkPkg("sibling", { name: "@logicn/sibling" }, { "dist/index.js": "export const x = 1;" });
  mkPkg("vendor", { name: "vendor-lib" }, { "dist/index.js": "export const v = 1;" });
  mkPkg("nameless", {}, { "dist/index.js": "export const n = 1;" }); // package.json with NO name
  mkPkg("app", { name: "@logicn/app" }, {
    "host/server.ts":
      `import { x } from "../../sibling/dist/index.js";\n` +     // → @logicn/sibling (workspace)
      `import { v } from "../../vendor/dist/index.js";\n` +      // → vendor-lib (thirdparty)
      `import { n } from "../../nameless/dist/index.js";\n` +    // → fail-closed raw specifier (thirdparty)
      `import { c } from "./config.js";\n` +                     // → internal edge
      `import { readFileSync } from "node:fs";`,                 // → node_core
    "host/config.ts": `export const c = 1;`,
  });
  return { parent, app: join(parent, "app") };
}

test("escaping relative import → cross-package border edge (workspace / thirdparty / fail-closed)", () => {
  const { parent, app } = makeMonorepo();
  const graph = buildGraph(scanPackage(app));

  const byKind = (k) => graph.externalDeps.filter((d) => d.kind === k).map((d) => d.specifier).sort();
  // The escaping sibling import is attributed to the OWNING package name (stable, not a path).
  assert.ok(byKind("workspace").includes("@logicn/sibling"), "sibling attributed to @logicn package name");
  // A non-@logicn sibling is thirdparty, keyed by its package name.
  assert.ok(byKind("thirdparty").includes("vendor-lib"), "non-@logicn sibling → thirdparty by name");
  // A sibling whose package.json has no name → cannot attribute → fail-closed: raw specifier surfaced.
  assert.ok(byKind("thirdparty").includes("../../nameless/dist/index.js"), "nameless → raw specifier, never dropped");
  // node:fs still classified; ./config.js stays a genuine internal edge.
  assert.equal(graph.stats.nodeCoreCount, 1);
  assert.equal(graph.stats.internalEdgeCount, 1); // host/server.ts -> host/config.ts
  rmSync(parent, { recursive: true, force: true });
});

// ── Configurable roots/extensions + scope visibility ───────────────────────────────────

test("packageGraph config overrides scanned roots/extensions", () => {
  const root = makeFixture({
    "package.json": JSON.stringify({ name: "@logicn/cfg", packageGraph: { roots: ["lib"], extensions: [".ts"] } }),
    "lib/index.ts": `import axios from "axios";`,   // scanned (configured root)
    "src/ignored.ts": `import lodash from "lodash";`, // NOT scanned (src excluded by config)
  });
  const graph = buildGraph(scanPackage(root));
  const specs = graph.externalDeps.map((d) => d.specifier);
  assert.ok(specs.includes("axios"), "configured root lib/ is scanned");
  assert.ok(!specs.includes("lodash"), "default src/ is excluded when config overrides roots");
  assert.deepEqual(graph.scannedRoots, ["lib"]);
  rmSync(root, { recursive: true, force: true });
});

test("scanned scope is reported even when zero files match (no silent empty border)", () => {
  const root = makeFixture({
    "package.json": JSON.stringify({ name: "@logicn/empty", packageGraph: { roots: ["does-not-exist"] } }),
  });
  const graph = buildGraph(scanPackage(root));
  assert.equal(graph.stats.fileCount, 0);
  assert.deepEqual(graph.scannedRoots, []);                 // configured root absent → nothing scanned
  assert.ok(graph.scannedExtensions.length > 0);            // extensions still recorded for the report
  rmSync(root, { recursive: true, force: true });
});

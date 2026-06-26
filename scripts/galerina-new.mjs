#!/usr/bin/env node
/**
 * galerina-new — opinionated SECURE scaffolder (DX, task #176; app mode = B1).
 *
 * Two modes:
 *   node scripts/galerina-new.mjs [package] <target-dir> [--name <pkg>]
 *     → a minimal governed PACKAGE (one fusable .wasm), ready for
 *       `galerina build --package <target-dir>`.
 *
 *   node scripts/galerina-new.mjs app <target-dir> [--name <app>]
 *     → a COMPLETE, runnable governed APPLICATION — a byte-for-byte copy (with the
 *       app name substituted) of the canonical golden template
 *       `packages-galerina/galerina-framework-example-app`. That single source of truth
 *       is the "hello, governed world" app: a governed flow compiled to a signed
 *       .wasm, fused into the App Kernel at a route, served over HTTP, with an
 *       end-to-end test. Build outputs (dist/, build/) are NOT copied — the new app
 *       rebuilds them (`npm run build:greeting`, then `npm test`).
 *
 * Design principles (Zero Trust), identical across both modes:
 *   - Deny-by-default: the scaffold declares NO capabilities and NO deps beyond the
 *     app's own pure compute. The entry is a `pure flow` with no `effects {}`.
 *   - Fail-closed: every generated `match` keeps its mandatory `_ =>` wildcard
 *     (SPORE-TYPE-023); an unrecognised state exits non-zero, never falls through.
 *   - VERIFY BEFORE BUILD: the entry compiles as-is (`galerina build`).
 *   - Capability binding lives in the SIGNED `.lmanifest` fuse{} block produced by
 *     the build — NEVER in a `.tmf` (which is integrity/confidentiality only).
 *
 * This is a STANDALONE script and deliberately does NOT touch galerina.mjs.
 */

import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const MODES = new Set(["app", "package"]);

// The canonical golden app `app` mode copies from. Resolved relative to this script
// so it works from any cwd in the repo. Kept as the SINGLE source of truth: edit the
// example app, and every newly-scaffolded app inherits the change (no template drift).
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_TEMPLATE_DIR = resolve(SCRIPT_DIR, "..", "packages-galerina", "galerina-framework-example-app");
// The example app's own identity strings, replaced with the new app's name on copy.
const TEMPLATE_PKG_NAME = "galerina-framework-example-app";
const TEMPLATE_SCOPED_NAME = "@galerina/framework-example-app";
// Directory names never copied into a new app — regenerated build artifacts, deps.
const COPY_SKIP_DIRS = new Set(["dist", "build", "node_modules", ".git"]);

// ── Argument parsing ────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(2);
  const positionals = [];
  let name = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--name") {
      name = args[++i];
      if (!name) fail("--name requires a value");
    } else if (a === "--help" || a === "-h") {
      printUsage();
      process.exit(0);
    } else if (a.startsWith("--")) {
      fail(`unknown flag: ${a}`);
    } else {
      positionals.push(a);
    }
  }

  // An explicit leading mode token ("app" | "package") selects the scaffold kind
  // and consumes the next positional as the target dir. A bare mode token with no
  // target is a usage error (don't silently scaffold a package literally named
  // "app" when the author meant `galerina new app <dir>`).
  let mode = "package";
  let targetDir = null;
  if (positionals.length && MODES.has(positionals[0])) {
    mode = positionals[0];
    if (positionals.length < 2) {
      printUsage();
      fail(`missing <target-dir> after "${mode}"`);
    }
    targetDir = positionals[1];
    if (positionals.length > 2) fail(`unexpected argument: ${positionals[2]}`);
  } else {
    if (!positionals.length) {
      printUsage();
      fail("missing <target-dir>");
    }
    targetDir = positionals[0];
    if (positionals.length > 1) fail(`unexpected argument: ${positionals[1]}`);
  }
  return { mode, targetDir, name };
}

function printUsage() {
  console.log(`galerina-new — scaffold an opinionated SECURE Galerina package or app

Usage:
  node scripts/galerina-new.mjs [package] <target-dir> [--name <pkg>]
  node scripts/galerina-new.mjs app       <target-dir> [--name <app>]

After scaffolding a package:
  node galerina.mjs build --package <target-dir>
  # → <target-dir>/dist/<name>.wasm

After scaffolding an app (the runnable "hello, governed world" golden template):
  cd <target-dir>
  npm run build:greeting   # → packages/greeting/dist/greeting.wasm (signed)
  npm test                 # scaffold → fuse → kernel → serve, end to end`);
}

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

// ── Name sanitisation ───────────────────────────────────────────────────────
// Names must be a safe, lowercase, kebab-case identifier so the emitted
// dist/<name>.wasm path and the manifest `name` are predictable and non-hostile.
function sanitizeName(raw) {
  const cleaned = String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-") // collapse anything unsafe to a dash
    .replace(/^[-._]+|[-._]+$/g, "") // trim leading/trailing separators
    .replace(/-{2,}/g, "-");        // collapse repeated dashes
  return cleaned;
}

// ── Package templates (unchanged) ────────────────────────────────────────────
function packageDescriptor(name) {
  // Deny-by-default: an empty capabilities array. Least-capability — the author
  // opts INTO each capability explicitly as the package grows.
  return JSON.stringify(
    {
      name,
      version: "0.1.0",
      kind: "pure-transform",
      provides: name,
      entry: "src/index.spore",
      seam: "compute.pure",
      capabilities: [],
    },
    null,
    2
  ) + "\n";
}

function indexLln(name) {
  return `// ${name} — opinionated SECURE Galerina package (scaffolded by galerina-new).
//
// Deny-by-default, fail-closed, least-capability:
//   - \`pure flow\` declares NO effects — it cannot touch network, storage,
//     secrets, the database, or run inference. Add an \`effects {}\` block AND
//     the matching capability in package.spore.json only when you truly need it.
//   - Every \`match\` MUST end with a mandatory \`_ =>\` wildcard (SPORE-TYPE-023):
//     undeclared inputs fail closed to a safe default, never fall through.
//
// Build:  node galerina.mjs build --package <this-dir>  →  dist/${name}.wasm

pure flow main() -> Int
contract {
  intent { "Entry point for the ${name} package. Replace with the real governed logic." }
}
{
  // Demonstration of the mandatory fail-closed wildcard on a match.
  let status: Int = 0
  match status {
    0 => return 0       // OK — nominal exit
    _ => return 1       // fail-closed: any other state is treated as an error
  }
}
`;
}

function readme(name) {
  return `# ${name}

A governed Galerina package scaffolded with \`galerina new\`.

## Build

\`\`\`sh
node galerina.mjs build --package .
# → dist/${name}.wasm  (+ .wat, .lmanifest, .fuse.json)
\`\`\`

## Security posture

This package is **secure by default**:

- **Deny-by-default capabilities.** \`package.spore.json\` declares an empty
  \`"capabilities": []\` list. The entry flow is \`pure\` with no \`effects {}\`
  block, so it cannot reach the network, storage, secrets, the database, or
  inference. Grant a capability only by adding it to both the \`effects {}\`
  block of a flow and the descriptor's \`capabilities\` array.
- **Fail-closed control flow.** Every \`match\` ends with a mandatory \`_ =>\`
  wildcard (SPORE-TYPE-023): an unrecognised input lands on a safe default
  instead of falling through.
- **Least capability.** Add only what the package provably needs, nothing more.

## Layout

\`\`\`
package.spore.json   descriptor: name / kind / provides / entry / seam / capabilities
src/index.spore      governed \`pure flow main() -> Int\` entry
tests/             your .spore tests
README.md          this file
\`\`\`
`;
}

// ── Scaffolding ─────────────────────────────────────────────────────────────
function writeFileStrict(path, content, what) {
  if (existsSync(path)) {
    fail(`refusing to overwrite existing ${what}: ${path}`);
  }
  writeFileSync(path, content);
  console.log(`   + ${path}`);
}

function scaffoldPackage(absTarget, name, targetDir) {
  mkdirSync(absTarget, { recursive: true });
  mkdirSync(join(absTarget, "src"), { recursive: true });
  mkdirSync(join(absTarget, "tests"), { recursive: true });

  console.log(`galerina-new — scaffolding secure package "${name}" into ${absTarget}`);
  writeFileStrict(join(absTarget, "package.spore.json"), packageDescriptor(name), "package.spore.json");
  writeFileStrict(join(absTarget, "src", "index.spore"), indexLln(name), "src/index.spore");
  writeFileStrict(join(absTarget, "README.md"), readme(name), "README.md");
  writeFileStrict(join(absTarget, "tests", ".gitkeep"), "", "tests/.gitkeep");

  console.log(`
✅ Scaffolded package "${name}".

Next:
  node galerina.mjs build --package ${targetDir}
  # → ${join(targetDir, "dist", name + ".wasm")}`);
}

// ── App mode: copy the canonical golden template, name-substituted ────────────
// Replace the example app's identity strings with the new app's name. Exact-string
// replacement (never a prefix), so unrelated names like `galerina-framework-app-kernel`
// or `galerina-framework-layer-design` are untouched.
function substituteName(text, name) {
  return text.split(TEMPLATE_SCOPED_NAME).join(name).split(TEMPLATE_PKG_NAME).join(name)
    // The golden App.manifest is root-SIGNED, so its content is PRESERVED at pre-rebrand values
    // (name `logicn-framework-example-app`, schemaVersion `lln.app.v1`, entry `src/App.lln`) — it
    // can't change without the offline re-sign ceremony, even though the example app's actual entry
    // file is now `src/App.spore`. A freshly-scaffolded app is UNSIGNED, so rewrite those stale refs
    // to current Galerina values so the new manifest + entry + name are consistent.
    .split("@logicn/framework-example-app").join(name)
    .split("logicn-framework-example-app").join(name)
    .split("lln.app.v1").join("spore.app.v1")
    .split("src/App.lln").join("src/App.spore");
}

// Recursively copy `srcDir` → `dstDir`, skipping build-output dirs, substituting the
// app name in every (text) file, and refusing to overwrite an existing file.
function copyTree(srcDir, dstDir, name) {
  mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name);
    const dstPath = join(dstDir, entry.name);
    if (entry.isDirectory()) {
      if (COPY_SKIP_DIRS.has(entry.name)) continue;
      copyTree(srcPath, dstPath, name);
    } else if (entry.isFile()) {
      const content = substituteName(readFileSync(srcPath, "utf8"), name);
      writeFileStrict(dstPath, content, relative(dstDir, dstPath) || entry.name);
    }
  }
}

function scaffoldApp(absTarget, name, targetDir) {
  if (!existsSync(APP_TEMPLATE_DIR) || !statSync(APP_TEMPLATE_DIR).isDirectory()) {
    fail(`golden app template not found at ${APP_TEMPLATE_DIR} (expected packages-galerina/galerina-framework-example-app)`);
  }
  console.log(`galerina-new — scaffolding secure app "${name}" into ${absTarget}`);
  console.log(`   (copying the golden template ${TEMPLATE_PKG_NAME}; build outputs excluded)`);
  copyTree(APP_TEMPLATE_DIR, absTarget, name);

  console.log(`
✅ Scaffolded app "${name}".

Next:
  cd ${targetDir}
  npm run build:greeting   # → packages/greeting/dist/greeting.wasm (signed)
  npm test                 # scaffold → fuse → kernel → serve, end to end`);
}

function main() {
  const { mode, targetDir, name: nameFlag } = parseArgs(process.argv);
  const absTarget = resolve(targetDir);

  // Derive the name from --name, else from the target directory name.
  const rawName = nameFlag ?? basename(absTarget);
  const name = sanitizeName(rawName);
  if (!name) {
    fail(`could not derive a valid name from "${rawName}" (use --name)`);
  }

  if (mode === "app") {
    scaffoldApp(absTarget, name, targetDir);
  } else {
    scaffoldPackage(absTarget, name, targetDir);
  }
}

main();

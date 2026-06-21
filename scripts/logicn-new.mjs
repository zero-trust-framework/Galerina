#!/usr/bin/env node
/**
 * logicn-new — opinionated SECURE scaffolder (DX, task #176; app mode = B1).
 *
 * Two modes:
 *   node scripts/logicn-new.mjs [package] <target-dir> [--name <pkg>]
 *     → a minimal governed PACKAGE (one fusable .wasm), ready for
 *       `logicn build --package <target-dir>`.
 *
 *   node scripts/logicn-new.mjs app <target-dir> [--name <app>]
 *     → a governed APPLICATION laid out by the app-framework convention (B1):
 *
 *         <target-dir>/
 *           App.lln          governed composition-root flow (the app entry)
 *           App.manifest     declarative app descriptor → folded into the SIGNED
 *                            build/App.lmanifest at build time (deny-by-default)
 *           flows/           application flows composed by App.lln
 *           deps/            signed governed components admitted at the fuse border
 *           proofs/          contract-driven generated test obligations
 *           README.md
 *           .gitignore
 *
 * Design principles (Zero Trust), identical across both modes:
 *   - Deny-by-default: the scaffold declares NO capabilities and NO deps. The
 *     entry is a `pure flow` with no `effects {}` — least-capability by default.
 *   - Fail-closed: every generated `match` keeps its mandatory `_ =>` wildcard
 *     (LLN-TYPE-023); an unrecognised state exits non-zero, never falls through.
 *   - VERIFY BEFORE BUILD: the entry compiles as-is (`logicn build`).
 *   - Capability binding lives in the SIGNED `.lmanifest` fuse{} block produced by
 *     the build — NEVER in a `.tmf` (which is integrity/confidentiality only).
 *
 * This is a STANDALONE script and deliberately does NOT touch logicn.mjs.
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, basename, resolve } from "node:path";

const MODES = new Set(["app", "package"]);

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
  // "app" when the author meant `logicn new app <dir>`).
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
  console.log(`logicn-new — scaffold an opinionated SECURE LogicN package or app

Usage:
  node scripts/logicn-new.mjs [package] <target-dir> [--name <pkg>]
  node scripts/logicn-new.mjs app       <target-dir> [--name <app>]

After scaffolding a package:
  node logicn.mjs build --package <target-dir>
  # → <target-dir>/dist/<name>.wasm

After scaffolding an app:
  node logicn.mjs build <target-dir>/App.lln
  # → build/App.wasm + build/App.lmanifest  (the signed admission artifact)`);
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
      entry: "src/index.lln",
      seam: "compute.pure",
      capabilities: [],
    },
    null,
    2
  ) + "\n";
}

function indexLln(name) {
  return `// ${name} — opinionated SECURE LogicN package (scaffolded by logicn-new).
//
// Deny-by-default, fail-closed, least-capability:
//   - \`pure flow\` declares NO effects — it cannot touch network, storage,
//     secrets, the database, or run inference. Add an \`effects {}\` block AND
//     the matching capability in package.lln.json only when you truly need it.
//   - Every \`match\` MUST end with a mandatory \`_ =>\` wildcard (LLN-TYPE-023):
//     undeclared inputs fail closed to a safe default, never fall through.
//
// Build:  node logicn.mjs build --package <this-dir>  →  dist/${name}.wasm

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

A governed LogicN package scaffolded with \`logicn new\`.

## Build

\`\`\`sh
node logicn.mjs build --package .
# → dist/${name}.wasm  (+ .wat, .lmanifest, .fuse.json)
\`\`\`

## Security posture

This package is **secure by default**:

- **Deny-by-default capabilities.** \`package.lln.json\` declares an empty
  \`"capabilities": []\` list. The entry flow is \`pure\` with no \`effects {}\`
  block, so it cannot reach the network, storage, secrets, the database, or
  inference. Grant a capability only by adding it to both the \`effects {}\`
  block of a flow and the descriptor's \`capabilities\` array.
- **Fail-closed control flow.** Every \`match\` ends with a mandatory \`_ =>\`
  wildcard (LLN-TYPE-023): an unrecognised input lands on a safe default
  instead of falling through.
- **Least capability.** Add only what the package provably needs, nothing more.

## Layout

\`\`\`
package.lln.json   descriptor: name / kind / provides / entry / seam / capabilities
src/index.lln      governed \`pure flow main() -> Int\` entry
tests/             your .lln tests
README.md          this file
\`\`\`
`;
}

// ── App templates (B1: app-layout convention) ────────────────────────────────
function appLln(name) {
  return `// ${name} — a governed LogicN application (scaffolded by \`logicn new app\`).
//
// App.lln is the application's composition ROOT. \`logicn build App.lln\` fuses it
// into ONE signed build/App.wasm plus a signed build/App.lmanifest (the admission
// artifact a host App Kernel verifies before it will run a single instruction).
//
// Zero-trust defaults:
//   - Deny-by-default: this entry is a \`pure flow\` with NO \`effects {}\` block,
//     so it cannot reach the network, storage, secrets, the database, or
//     inference. Opt into a capability by adding it to a flow's \`effects {}\` AND
//     to App.manifest's \`capabilities\` list — the build folds that into the
//     SIGNED .lmanifest fuse{} block. Capability binding lives there, NEVER in a
//     .tmf (which carries integrity/confidentiality only).
//   - Fail-closed: every \`match\` ends with a mandatory \`_ =>\` wildcard
//     (LLN-TYPE-023) — an unrecognised state exits non-zero, never falls through.
//
// Build:  node logicn.mjs build App.lln       →  build/App.wasm + build/App.lmanifest
// Run:    node logicn.mjs run   App.lln --invoke main
// Prove:  node logicn.mjs gen-tests App.lln    →  contract obligations (see proofs/)

pure flow main() -> Int
contract {
  intent { "Application entry point for ${name}. Compose flows from flows/ here." }
}
{
  // Demonstration of the mandatory fail-closed wildcard.
  let status: Int = 0
  match status {
    0 => return 0       // OK — nominal startup
    _ => return 1       // fail-closed: any other state exits non-zero
  }
}
`;
}

function appExampleFlow(name) {
  return `// flows/example.lln — an example application flow for ${name}.
//
// Application flows live in flows/ and are composed by App.lln (the root). Keep
// each flow least-capability: start \`pure\`, and add an \`effects {}\` block plus
// the matching capability in App.manifest only when the flow provably needs it.

pure flow exampleValue() -> Int
contract {
  intent { "Example flow — returns a constant. Replace with real governed logic." }
}
{
  return 0
}
`;
}

function appManifest(name) {
  // The DECLARATIVE app descriptor. At build time its fields are folded into the
  // SIGNED build/App.lmanifest fuse{} block (the authoritative, tamper-evident
  // source of truth). Deny-by-default: no capabilities, no deps.
  return JSON.stringify(
    {
      schemaVersion: "lln.app.v1",
      kind: "app",
      name,
      version: "0.1.0",
      entry: "App.lln",
      flows: "flows/",
      proofs: "proofs/",
      // Deny-by-default. Grant a capability only alongside a flow's effects {}.
      capabilities: [],
      // Signed governed components admitted at the fuse border. Each entry, when
      // added, is { name, wasm, sha256, signer } — see deps/README.md.
      deps: [],
      build: {
        wasm: "build/App.wasm",
        manifest: "build/App.lmanifest",
      },
    },
    null,
    2
  ) + "\n";
}

function appDepsReadme(name) {
  return `# deps/ — signed governed components

Third-party (or split-out) governed components for **${name}** live here as a
built \`<component>.wasm\` plus its \`<component>.fuse.json\` descriptor. They are
admitted at the **fuse border** — a deny-by-default, fail-closed gate — before
the App Kernel will compose them. Three independent gates must all pass:

1. **Hash pin** — the component's sha256 must match the \`sha256\` declared for it
   in \`App.manifest\` (\`deps[]\`). A changed binary is refused.
2. **Signature** — the component's manifest must carry a valid Ed25519 signature
   from an authorised \`signer\`. An unsigned or wrongly-signed component is refused.
3. **Revocation** — a revoked signing key (\`governance/revocations.json\`) is
   refused even if the signature is otherwise valid.

Capability imports are **closed / deny-by-default**: a component may only import a
capability the host explicitly provides at the seam. An unresolved import is a
link-time \`LinkError\`, not a silent fallthrough.

> Capability binding lives in the **signed \`.lmanifest\` fuse{} block**, never in a
> \`.tmf\`. \`.tmf\` carries integrity/confidentiality only.

## Declaring a dep

Add it to \`App.manifest\`:

\`\`\`json
"deps": [
  {
    "name": "example-component",
    "wasm": "deps/example-component.wasm",
    "sha256": "sha256:<digest-of-the-built-wasm>",
    "signer": "<authorised-ed25519-public-key-id>"
  }
]
\`\`\`

An empty \`deps[]\` admits nothing — that is the secure default.
`;
}

function appProofsReadme(name) {
  return `# proofs/ — contract-driven test obligations

LogicN derives test obligations from each flow's \`contract {}\` (intent,
pre/post-conditions, effects, fail-closed branches). Generate them for **${name}**:

\`\`\`sh
node logicn.mjs gen-tests App.lln          # human-readable obligations
node logicn.mjs gen-tests App.lln --tap    # TAP plan for CI
\`\`\`

Commit the generated proofs here so the governance surface of the app is checked
on every change. They are *obligations the contract implies*, not hand-written
assertions — which is why they belong with the app, under version control.
`;
}

function appReadme(name) {
  return `# ${name}

A governed LogicN **application**, scaffolded with \`logicn new app\`.

## Build & run

\`\`\`sh
node logicn.mjs build App.lln              # → build/App.wasm + build/App.lmanifest
node logicn.mjs run   App.lln --invoke main
node logicn.mjs gen-tests App.lln          # contract-driven proofs (see proofs/)
\`\`\`

\`logicn build\` fuses the app into **one signed \`build/App.wasm\`** and emits the
signed **\`build/App.lmanifest\`** — the admission artifact. A host App Kernel
verifies that manifest (signature → capability bounds → revocation) before it
will run the app: governance is part of execution, not a layer around it.

## Layout (app-framework convention)

\`\`\`
App.lln          governed composition-root flow (the app entry)
App.manifest     declarative descriptor → folded into the SIGNED build/App.lmanifest
flows/           application flows composed by App.lln
deps/            signed governed components admitted at the fuse border
proofs/          contract-driven generated test obligations
build/           generated, signed output (git-ignored)
\`\`\`

## Security posture

- **Deny-by-default.** \`App.manifest\` declares \`"capabilities": []\` and
  \`"deps": []\`. \`App.lln\` is \`pure\` with no \`effects {}\`, so the app cannot
  reach the network, storage, secrets, the database, or inference until you opt in.
- **Fail-closed.** Every \`match\` ends with a mandatory \`_ =>\` wildcard
  (LLN-TYPE-023): an unrecognised state exits non-zero, never falls through.
- **Capability binding is signed.** It lives in the \`.lmanifest\` fuse{} block the
  build signs — never in a \`.tmf\`.
- **Secrets are runtime-only.** \`.env\` is git-ignored and never compiled in; in
  production they come from a vault/KMS, not the binary.
`;
}

function appGitignore() {
  return `# Generated, signed build output — never committed (rebuild from source).
build/
dist/

# Secrets are runtime-only and MUST never be committed.
.env
.env.*
!.env.example
*.key
*.pem
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

  console.log(`logicn-new — scaffolding secure package "${name}" into ${absTarget}`);
  writeFileStrict(join(absTarget, "package.lln.json"), packageDescriptor(name), "package.lln.json");
  writeFileStrict(join(absTarget, "src", "index.lln"), indexLln(name), "src/index.lln");
  writeFileStrict(join(absTarget, "README.md"), readme(name), "README.md");
  writeFileStrict(join(absTarget, "tests", ".gitkeep"), "", "tests/.gitkeep");

  console.log(`
✅ Scaffolded package "${name}".

Next:
  node logicn.mjs build --package ${targetDir}
  # → ${join(targetDir, "dist", name + ".wasm")}`);
}

function scaffoldApp(absTarget, name, targetDir) {
  mkdirSync(absTarget, { recursive: true });
  mkdirSync(join(absTarget, "flows"), { recursive: true });
  mkdirSync(join(absTarget, "deps"), { recursive: true });
  mkdirSync(join(absTarget, "proofs"), { recursive: true });

  console.log(`logicn-new — scaffolding secure app "${name}" into ${absTarget}`);
  writeFileStrict(join(absTarget, "App.lln"), appLln(name), "App.lln");
  writeFileStrict(join(absTarget, "App.manifest"), appManifest(name), "App.manifest");
  writeFileStrict(join(absTarget, "flows", "example.lln"), appExampleFlow(name), "flows/example.lln");
  writeFileStrict(join(absTarget, "deps", "README.md"), appDepsReadme(name), "deps/README.md");
  writeFileStrict(join(absTarget, "proofs", "README.md"), appProofsReadme(name), "proofs/README.md");
  writeFileStrict(join(absTarget, "README.md"), appReadme(name), "README.md");
  writeFileStrict(join(absTarget, ".gitignore"), appGitignore(), ".gitignore");

  console.log(`
✅ Scaffolded app "${name}".

Next:
  node logicn.mjs build ${join(targetDir, "App.lln")}
  # → build/App.wasm + build/App.lmanifest  (the signed admission artifact)`);
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

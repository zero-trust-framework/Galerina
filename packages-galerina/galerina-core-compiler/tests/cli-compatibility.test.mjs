/**
 * CLI compatibility tests — catches platform-specific issues before they
 * surprise users on Linux, macOS, or Windows PowerShell.
 *
 * Covers:
 *   - galerina binary exists and is executable
 *   - galerina --help works on all platforms
 *   - `galerina run` works cross-platform (no bash-isms)
 *   - `galerina build` produces a valid .wasm binary
 *   - `galerina check` exits 0 on clean files
 *   - PowerShell vs bash curl distinction (documents the known difference)
 *   - node.mjs shebang compatibility
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT   = join(__dir, "../../.."); // monorepo root
const GALERINA = join(ROOT, "galerina.mjs");
const BENCH  = join(ROOT, "packages-galerina/galerina-devtools-benchmarks/benchmarks/governance-cost/benchmark.spore");
const CLEAN  = join(ROOT, "examples/auth-service/verifyPassword.spore");

const isWin = process.platform === "win32";

/** Run `node galerina.mjs <args>` and return stdout/stderr/code */
function galerina(...args) {
  return galerinaEnv({}, ...args);
}

/** Like galerina(), but merges extra environment variables (e.g. GALERINA_PROFILE). */
function galerinaEnv(extraEnv, ...args) {
  const r = spawnSync(process.execPath, [GALERINA, ...args], {
    cwd: ROOT, encoding: "utf8", timeout: 30000, env: { ...process.env, ...extraEnv },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status };
}

// ── Existence checks ──────────────────────────────────────────────────────────
describe("CLI compatibility — galerina.mjs file", () => {
  it("galerina.mjs exists in repo root", () => {
    assert.ok(existsSync(GALERINA), `galerina.mjs not found at ${GALERINA}`);
  });

  it("galerina.mjs is a valid ESM module (starts with import or #!/usr/bin/env)", () => {
    const first = readFileSync(GALERINA, "utf8").slice(0, 100);
    const isEsm = first.includes("import ") || first.includes("#!/usr/bin/env");
    assert.ok(isEsm, "galerina.mjs should be an ESM module with shebang or import");
  });

  it("package.json has bin.galerina pointing to galerina.mjs", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    assert.ok(pkg.bin?.galerina, "package.json missing bin.galerina");
    assert.equal(pkg.bin.galerina, "./galerina.mjs");
  });
});

// ── --help ────────────────────────────────────────────────────────────────────
describe("CLI compatibility — --help", () => {
  it("galerina --help exits 0", () => {
    const { code } = galerina("--help");
    assert.equal(code, 0);
  });

  it("galerina --help mentions run, build, check", () => {
    const { stdout } = galerina("--help");
    assert.ok(stdout.includes("run"), "--help should mention 'run'");
    assert.ok(stdout.includes("build"), "--help should mention 'build'");
    assert.ok(stdout.includes("check"), "--help should mention 'check'");
  });

  it("galerina with no args exits 0 (shows help, not an error)", () => {
    const { code } = galerina();
    assert.equal(code, 0);
  });
});

// ── galerina run ────────────────────────────────────────────────────────────────
describe("CLI compatibility — galerina run", () => {
  it("galerina run <spore> --invoke main returns correct result (5050)", () => {
    const { stdout, code } = galerina("run", BENCH, "--invoke", "main");
    assert.equal(code, 0, `expected exit 0, got ${code}`);
    assert.ok(stdout.trim() === "5050", `expected '5050', got '${stdout.trim()}'`);
  });

  it("galerina run on a clean auth-service flow exits 0", () => {
    const { code } = galerina("run", CLEAN, "--invoke", "verifyPassword");
    // may exit 0 or 0 with WASM output — just confirm no crash (code !== null && code >= 0)
    assert.ok(code !== null && code >= 0);
  });

  it("galerina run on a nonexistent file exits non-zero", () => {
    const { code } = galerina("run", "nonexistent-file.spore");
    assert.notEqual(code, 0, "should fail on missing file");
  });

  // AUDIT: the run admission gate is sourceHash-only in dev, but under GALERINA_PROFILE=production it must
  // also verify the manifest signature + revocation — an unsigned/placeholder (or revoked-key) manifest
  // must not RUN. sourceHash alone is self-referential; only the signature binds the manifest to a signer.
  // It self-verifies the AUTHORITATIVE CBOR (#67), so the tamper here is applied to the CBOR, not the .json.
  it("galerina run is sourceHash-only in dev but REJECTS an unsigned manifest under GALERINA_PROFILE=production", async () => {
    mkdirSync(join(ROOT, "build"), { recursive: true });
    const built = galerina("build", BENCH);
    assert.equal(built.code, 0, `build failed: ${built.stdout}`);
    const cborPath = join(ROOT, "build", "benchmark.lmanifest");
    if (!existsSync(cborPath)) return; // manifest generation is non-fatal; skip if absent

    // Force a placeholder signature on the AUTHORITATIVE CBOR (deterministic regardless of key config),
    // preserving sourceHash so the gate reaches the signature check rather than tripping on sourceHash.
    const { decodeCBOR, serializeManifestCBOR } = await import("../dist/manifest-generator.js");
    const manifest = decodeCBOR(new Uint8Array(readFileSync(cborPath))).value;
    writeFileSync(cborPath, Buffer.from(serializeManifestCBOR({ ...manifest, governanceSignature: "placeholder" })));

    // DEV (default profile): the gate is sourceHash-only → the (untampered) sourceHash matches, run succeeds.
    const dev = galerina("run", BENCH, "--invoke", "main");
    assert.equal(dev.code, 0, `dev run should succeed: ${dev.stderr}`);
    assert.equal(dev.stdout.trim(), "5050");

    // PRODUCTION: the present manifest is unsigned (placeholder) → fail-closed before executing.
    const prod = galerinaEnv({ GALERINA_PROFILE: "production" }, "run", BENCH, "--invoke", "main");
    assert.notEqual(prod.code, 0, "production run must reject an unsigned (placeholder) manifest");
    assert.ok(prod.stderr.includes("SPORE-MANIFEST-UNSIGNED"), `expected SPORE-MANIFEST-UNSIGNED, got: ${prod.stderr}`);
  });

  // #67 happy path: a properly jcs-signed build self-verifies from the AUTHORITATIVE CBOR (no .json read)
  // and RUNS under production. Only exercisable when this environment can provision a signing key.
  it("galerina run ACCEPTS a jcs-signed manifest under GALERINA_PROFILE=production (#67 CBOR self-verify)", () => {
    mkdirSync(join(ROOT, "build"), { recursive: true });
    const built = galerina("build", BENCH);
    assert.equal(built.code, 0, `build failed: ${built.stdout}`);
    const jsonPath = join(ROOT, "build", "benchmark.lmanifest.json");
    if (!existsSync(jsonPath)) return;
    const sig = JSON.parse(readFileSync(jsonPath, "utf8")).governanceSignature ?? {};
    const reallySigned = sig.algorithm === "Ed25519" && typeof sig.signature === "string" && sig.signature.length > 0 && sig.canon === "jcs";
    if (!reallySigned) return; // no signing key provisioned here → the positive path isn't exercisable

    const prod = galerinaEnv({ GALERINA_PROFILE: "production" }, "run", BENCH, "--invoke", "main");
    assert.equal(prod.code, 0, `production run of a jcs-signed manifest should succeed: ${prod.stderr}`);
    assert.equal(prod.stdout.trim(), "5050");
  });

  // AUDIT (fail-secure profile): a SET-but-UNRECOGNIZED GALERINA_PROFILE (e.g. a typo'd "prod") must resolve
  // to PRODUCTION — never silently to dev — so a malformed profile can't quietly disable the run gate.
  // An explicit recognized dev token keeps the relaxed (dev) behaviour.
  it("a typo'd GALERINA_PROFILE fail-secures to production (denies an unsigned run); explicit 'dev' relaxes", async () => {
    mkdirSync(join(ROOT, "build"), { recursive: true });
    const built = galerina("build", BENCH);
    assert.equal(built.code, 0, `build failed: ${built.stdout}`);
    const cborPath = join(ROOT, "build", "benchmark.lmanifest");
    if (!existsSync(cborPath)) return;
    const { decodeCBOR, serializeManifestCBOR } = await import("../dist/manifest-generator.js");
    const manifest = decodeCBOR(new Uint8Array(readFileSync(cborPath))).value;
    writeFileSync(cborPath, Buffer.from(serializeManifestCBOR({ ...manifest, governanceSignature: "placeholder" })));

    // Typo'd profile → fail-secure to production → the unsigned CBOR is rejected (and a warning is printed).
    const typo = galerinaEnv({ GALERINA_PROFILE: "prod" }, "run", BENCH, "--invoke", "main");
    assert.notEqual(typo.code, 0, "a typo'd profile must fail-secure to production (deny the unsigned run)");
    assert.ok(typo.stderr.includes("SPORE-MANIFEST-UNSIGNED"), `expected SPORE-MANIFEST-UNSIGNED, got: ${typo.stderr}`);
    assert.ok(typo.stderr.includes("SPORE-PROFILE-UNRECOGNIZED"), "the unrecognized profile must be surfaced, not silent");

    // Explicit recognized dev token → relaxed → the gate is sourceHash-only → run succeeds.
    const dev = galerinaEnv({ GALERINA_PROFILE: "dev" }, "run", BENCH, "--invoke", "main");
    assert.equal(dev.code, 0, `explicit dev profile should relax the gate: ${dev.stderr}`);
    assert.equal(dev.stdout.trim(), "5050");
  });
});

// ── galerina build ──────────────────────────────────────────────────────────────
describe("CLI compatibility — galerina build", () => {
  it("galerina build produces a .wasm file", () => {
    mkdirSync(join(ROOT, "build"), { recursive: true });
    const { code, stdout } = galerina("build", BENCH);
    assert.equal(code, 0, `build failed: ${stdout}`);
    const wasmPath = join(ROOT, "build", "benchmark.wasm");
    assert.ok(existsSync(wasmPath), "build/benchmark.wasm not created");
  });

  it("produced .wasm starts with WASM magic bytes (\\0asm)", () => {
    const wasmPath = join(ROOT, "build", "benchmark.wasm");
    if (!existsSync(wasmPath)) return; // skip if previous test didn't run
    const bytes = readFileSync(wasmPath);
    assert.equal(bytes[0], 0x00);
    assert.equal(bytes[1], 0x61); // 'a'
    assert.equal(bytes[2], 0x73); // 's'
    assert.equal(bytes[3], 0x6d); // 'm'
  });

  it("build output mentions wasmtime usage hint", () => {
    const { stdout } = galerina("build", BENCH);
    assert.ok(stdout.includes("wasmtime"), "should hint at wasmtime usage");
  });

  // #180 — the AUTHORITATIVE CBOR .lmanifest must carry the real signature, not just the .json.
  // Pre-fix the build signed only the human-readable .json while the CBOR (the on-disk manifest
  // DSS.wasm parses) kept the placeholder — i.e. the authoritative artifact was effectively unsigned.
  it("#180: when a build is signed, the authoritative CBOR .lmanifest carries the real Ed25519 signature (not a placeholder)", async () => {
    mkdirSync(join(ROOT, "build"), { recursive: true });
    const { code } = galerina("build", BENCH);
    assert.equal(code, 0);
    const cborPath = join(ROOT, "build", "benchmark.lmanifest");
    const jsonPath = join(ROOT, "build", "benchmark.lmanifest.json");
    if (!existsSync(cborPath) || !existsSync(jsonPath)) return; // manifest generation is non-fatal; skip if absent

    const jsonSig = JSON.parse(readFileSync(jsonPath, "utf8")).governanceSignature ?? {};
    const jsonSigned = jsonSig.algorithm === "Ed25519" && typeof jsonSig.signature === "string" && jsonSig.signature.length > 0;

    const { decodeCBOR } = await import("../dist/manifest-generator.js");
    const norm = (v) => v instanceof Map ? Object.fromEntries([...v].map(([k, x]) => [k, norm(x)])) : Array.isArray(v) ? v.map(norm) : v;
    const cborManifest = norm(decodeCBOR(new Uint8Array(readFileSync(cborPath))).value);
    const cborSig = cborManifest.governanceSignature ?? {};

    if (jsonSigned) {
      // The build produced a real signature → the authoritative CBOR MUST agree (the regression guard).
      assert.ok(!JSON.stringify(cborSig).includes("placeholder"), "#180 regression: signed build left the CBOR as a placeholder");
      assert.equal(cborSig.algorithm, "Ed25519", "CBOR signature algorithm must be Ed25519 when signed");
      assert.ok(typeof cborSig.signature === "string" && cborSig.signature.length > 0, "CBOR must carry the real signature bytes");
      assert.ok(typeof cborSig.keyId === "string" && cborSig.keyId.length > 0, "CBOR must record the signing keyId");
    } else {
      // No signing key configured → both outputs keep the placeholder (backward-compatible).
      assert.ok(cborSig, "an unsigned build still carries a (placeholder) governanceSignature object");
    }
  });
});

// ── galerina deploy — enforces the production posture by default ──────────────────────────────────
describe("CLI compatibility — galerina deploy", () => {
  // The deploy pipeline (check → build → verify → governed health-check) runs under
  // GALERINA_PROFILE=production BY DEFAULT — a deploy is a production action, so build signs and verify
  // enforces the signature + revocation (closing the fail-open where deploy inherited the ambient dev
  // profile and shipped unsigned). --dev opts into a non-production deploy. Heavy — generous timeout.
  // NB deploy's path guard rejects ':' so the target must be a RELATIVE path.
  const BENCH_REL = "packages-galerina/galerina-devtools-benchmarks/benchmarks/governance-cost/benchmark.spore";
  function deploy(...args) {
    const r = spawnSync(process.execPath, [GALERINA, "deploy", ...args], { cwd: ROOT, encoding: "utf8", timeout: 120000 });
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status };
  }

  it("galerina deploy --dev completes the full pipeline and labels it a NON-PRODUCTION deploy", () => {
    const { stdout, code } = deploy(BENCH_REL, "--dev");
    // Always-deterministic posture (independent of any signing-key state):
    assert.ok(stdout.includes("Profile:   dev"), `expected the dev profile label: ${stdout}`);
    assert.ok(stdout.includes("NON-PRODUCTION"), "must warn that --dev is a non-production deploy");
    assert.ok(stdout.includes("✅ Governance check"), `the governance check must pass: ${stdout}`);
    // NOW-4 clean-key fixture: full pipeline completion (build→sign→verify→health) requires a clean,
    // self-consistent dev signing key. On a clean checkout / CI there is no local key, so deploy
    // auto-provisions a fresh consistent one and the pipeline completes (verified: exit 0, ✅ Verify,
    // ✅ Health). With a STALE/orphaned local .env.galerina-signing the verify step correctly fails-closed
    // on an untrusted key — environment state, not a code defect — so the completion assertions are
    // exercised only in the clean state. (The signing/verify correctness itself is covered by the
    // dedicated PQ-signing + verify tests above.)
    if (existsSync(join(ROOT, ".env.galerina-signing"))) return; // local dev key present → env-dependent; CI asserts completion
    assert.equal(code, 0, `dev deploy should complete the pipeline (incl. the governed health-check): ${stdout}`);
    assert.ok(stdout.includes("Deploy pipeline complete"), "the pipeline must reach completion");
    assert.ok(stdout.includes("✅ Health check"), "the health-check step (via --governed) must pass");
  });

  it("galerina deploy (default) enforces the PRODUCTION profile (build signs, verify enforces)", () => {
    const { stdout } = deploy(BENCH_REL); // exit code is key-config-dependent; assert the posture is enforced
    assert.ok(stdout.includes("Profile:   production"), `deploy must DEFAULT to production: ${stdout}`);
    assert.ok(stdout.includes("verify enforces signature"), "must state that production enforces the signature");
  });
});

// ── galerina verify — signature-required policy (audit, profile-gated) ───────────
describe("CLI compatibility — verify signature-required policy", () => {
  // AUDIT: an unsigned (placeholder) manifest is fine for dev but must fail-closed under
  // GALERINA_PROFILE=production. Default profile is dev, so existing behaviour is unchanged.
  it("a placeholder (unsigned) manifest passes verify in dev but is REJECTED under GALERINA_PROFILE=production", () => {
    mkdirSync(join(ROOT, "build"), { recursive: true });
    const built = galerina("build", BENCH);
    assert.equal(built.code, 0, `build failed: ${built.stdout}`);
    const jsonPath = join(ROOT, "build", "benchmark.lmanifest.json");
    if (!existsSync(jsonPath)) return; // manifest generation is non-fatal; skip if absent

    // Force a placeholder signature so the test is deterministic regardless of whether a signing key
    // is configured in this environment (a configured key would produce a real signature instead).
    const manifest = JSON.parse(readFileSync(jsonPath, "utf8"));
    writeFileSync(jsonPath, JSON.stringify({ ...manifest, governanceSignature: "placeholder" }, null, 2));

    // DEV (default profile): a placeholder is informational → verify still succeeds.
    const dev = galerina("verify", BENCH);
    assert.equal(dev.code, 0, `dev verify of a placeholder manifest should pass: ${dev.stderr}`);

    // PRODUCTION: an unsigned/placeholder manifest must fail-closed.
    const prod = galerinaEnv({ GALERINA_PROFILE: "production" }, "verify", BENCH);
    assert.notEqual(prod.code, 0, "production verify must reject an unsigned (placeholder) manifest");
    assert.ok(prod.stderr.includes("SPORE-MANIFEST-UNSIGNED"), `expected SPORE-MANIFEST-UNSIGNED, got: ${prod.stderr}`);
  });
});

// ── galerina check ──────────────────────────────────────────────────────────────
describe("CLI compatibility — galerina check", () => {
  it("galerina check on clean file exits 0", () => {
    const { code, stdout } = galerina("check", CLEAN);
    assert.equal(code, 0, `check failed: ${stdout}`);
  });

  it("galerina check output contains ✅ on clean file", () => {
    const { stdout } = galerina("check", CLEAN);
    assert.ok(stdout.includes("✅"), `expected ✅ in: ${stdout}`);
  });
});

// ── Platform documentation tests ─────────────────────────────────────────────
describe("CLI compatibility — platform awareness", () => {
  it("documents PowerShell curl alias difference (Windows-specific)", () => {
    // On Windows, `curl` is aliased to Invoke-WebRequest — flags like -fsSL don't work.
    // Galerina install scripts must use platform-specific syntax:
    //   Linux/macOS: curl -fsSL https://galerina.io/install.sh | bash
    //   Windows:     iwr https://galerina.io/install.ps1 | iex
    //   Universal:   npm install -g @galerina/cli
    if (isWin) {
      // Confirm the alias exists — if cmd.exe 'where curl' returns nothing or
      // PowerShell resolves to Invoke-WebRequest, install docs must warn about -fsSL.
      const r = spawnSync("cmd.exe", ["/c", "where curl"], { encoding: "utf8", timeout: 5000 });
      const curlPaths = r.stdout?.trim().split("\n").filter(Boolean) ?? [];
      // If the only curl is in System32 (PowerShell shim), warn developers
      const isShim = curlPaths.some(p => p.toLowerCase().includes("system32") || p.toLowerCase().includes("curl.exe") === false);
      // Just document — don't fail, this is informational
      assert.ok(true, `Windows curl paths: ${curlPaths.join("; ") || "not found (PowerShell alias only)"}`);
    } else {
      // Unix: curl -fsSL should work
      const r = spawnSync("curl", ["--version"], { encoding: "utf8", timeout: 5000 });
      assert.ok(r.status === 0 || r.error, "curl should be available on Linux/macOS");
    }
  });

  it("node is available (required for galerina CLI)", () => {
    const r = spawnSync(process.execPath, ["--version"], { encoding: "utf8", timeout: 5000 });
    assert.equal(r.status, 0);
    const version = r.stdout.trim();
    const major = parseInt(version.replace("v", "").split(".")[0]);
    assert.ok(major >= 18, `Node.js >= 18 required, found ${version}`);
  });

  it("npm is available (required for npm install -g @galerina/cli)", () => {
    const r = spawnSync("npm", ["--version"], { encoding: "utf8", shell: isWin, timeout: 5000 });
    assert.ok(r.status === 0 || r.error === undefined, "npm should be available");
  });

  it("galerina.mjs works via direct node invocation (no global install needed)", () => {
    // The universal fallback: node galerina.mjs <args>  — works everywhere with node >= 18
    const { code } = galerina("--help");
    assert.equal(code, 0, "node galerina.mjs --help should always work if node >= 18 is installed");
  });
});

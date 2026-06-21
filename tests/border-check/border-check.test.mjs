// Integration tests for the `logicn border-check` fail-closed plugin admission gate
// (logicn.mjs:426-504, hardened 2026-06-06). P9-144 §83.
//
// APPROACH: spawn the real CLI and assert on per-plugin verdicts in its output.
// This locks in the gate's behaviour WITHOUT refactoring it (the gate reads the
// hardcoded `governance/plugins/` dir and exits 1 if ANY plugin is denied, so we
// assert on the per-plugin "[ADMITTED]/[DENIED] <name>" lines, not the global exit
// code — making each case independent of the other fixtures present).
//
// Landmine respected: this is the safety net that must exist BEFORE anyone extracts
// `validatePlugin` into a unit-testable module. Do not refactor the gate first.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PLUGINS = join(ROOT, "governance", "plugins");
const PREFIX = "__borchk_test_";
const VALID_HASH = "sha256:" + "ab".repeat(32); // 64 hex chars
const VALID_SCHEMA = { fields: [{ name: "prompt", type: "string", required: true, maxLength: 4096 }] };

// A fully-valid manifest; each case below mutates exactly one field to be denied.
function base() {
  return {
    name: "t", version: "1.0.0", governanceTier: 2, license: "MIT",
    sourceHash: VALID_HASH,
    resourceLimits: { maxMemoryMB: 64, maxCpuCycles: 1_000_000, maxWallMs: 5_000 },
    capabilities: ["ai.inference", "audit.write"],
    blacklisted: false,
  };
}

// key -> fixture spec. schema: object | "__OMIT__" | "__BADJSON__". manifestRaw overrides manifest.
const FIXTURES = {
  valid:             { manifest: base() },
  // B2: a coarse border spelling (db.read) is admitted via alias → database.read.
  aliasCap:          { manifest: { ...base(), capabilities: ["db.read", "audit.write"] } },
  // B2: a canonical compiler capability (shell.execute) is now recognised at the border.
  canonicalCap:      { manifest: { ...base(), capabilities: ["shell.execute"] } },
  placeholderHash:   { manifest: { ...base(), sourceHash: "sha256:pending-logicn-promote" } },
  shortHash:         { manifest: { ...base(), sourceHash: "sha256:abc" } },
  blacklisted:       { manifest: { ...base(), blacklisted: true } },
  unknownCap:        { manifest: { ...base(), capabilities: ["ai.inference", "evil.root"] } },
  emptyCaps:         { manifest: { ...base(), capabilities: [] } },
  overCeilingMem:    { manifest: { ...base(), resourceLimits: { maxMemoryMB: 999_999, maxCpuCycles: 1000, maxWallMs: 1000 } } },
  negativeLimit:     { manifest: { ...base(), resourceLimits: { maxMemoryMB: -1, maxCpuCycles: 1000, maxWallMs: 1000 } } },
  badTier:           { manifest: { ...base(), governanceTier: 9 } },
  missingSchema:     { manifest: base(), schema: "__OMIT__" },
  malformedSchema:   { manifest: base(), schema: "__BADJSON__" },
  malformedManifest: { manifestRaw: "{ not valid json " },
};

const created = [];
function writeFixture(key, spec) {
  const dir = join(PLUGINS, PREFIX + key);
  mkdirSync(join(dir, "schemas"), { recursive: true });
  created.push(dir);
  writeFileSync(join(dir, "manifest.json"),
    spec.manifestRaw !== undefined ? spec.manifestRaw : JSON.stringify(spec.manifest, null, 2));
  if (spec.schema === "__OMIT__") return;
  writeFileSync(join(dir, "schemas", "data_types.json"),
    spec.schema === "__BADJSON__" ? "{ bad json" : JSON.stringify(spec.schema ?? VALID_SCHEMA, null, 2));
}

let OUT = "";
let STATUS = null;

before(() => {
  for (const [k, spec] of Object.entries(FIXTURES)) writeFixture(k, spec);
  const r = spawnSync(process.execPath, ["logicn.mjs", "border-check"], { cwd: ROOT, encoding: "utf-8" });
  OUT = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  STATUS = r.status;
});

after(() => {
  for (const d of created) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
});

function verdict(key) {
  const m = OUT.match(new RegExp(`\\[(ADMITTED|DENIED)\\]\\s+${PREFIX}${key}\\b`));
  return m ? m[1] : null;
}

// Collect the indented "↳ <reason>" lines that follow a plugin's [DENIED] line.
function reasonsFor(key) {
  const name = PREFIX + key;
  const lines = OUT.split("\n");
  const idx = lines.findIndex((l) => new RegExp(`\\[DENIED\\]\\s+${name}\\b`).test(l));
  if (idx < 0) return "";
  const out = [];
  for (let i = idx + 1; i < lines.length; i++) {
    if (/\[(DENIED|ADMITTED)\]/.test(lines[i]) || lines[i].trim() === "") break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

test("a fully-valid plugin is ADMITTED (per-plugin, even when siblings are denied)", () => {
  assert.equal(verdict("valid"), "ADMITTED", OUT);
});

test("B2: an aliased capability (db.read) is ADMITTED via the unified vocabulary", () => {
  assert.equal(verdict("aliasCap"), "ADMITTED", OUT);
});

test("B2: a canonical compiler capability (shell.execute) is ADMITTED at the border", () => {
  assert.equal(verdict("canonicalCap"), "ADMITTED", OUT);
});

for (const key of [
  "placeholderHash", "shortHash", "blacklisted", "unknownCap", "emptyCaps",
  "overCeilingMem", "negativeLimit", "badTier", "missingSchema", "malformedSchema", "malformedManifest",
]) {
  test(`${key} is DENIED (fail-closed)`, () => {
    assert.equal(verdict(key), "DENIED", OUT);
  });
}

test("the gate exits non-zero when any plugin is denied (deny-by-default)", () => {
  assert.equal(STATUS, 1, `expected exit 1 with denied fixtures present; output:\n${OUT}`);
});

test("denial REASONS distinguish the branch (pins missing-vs-malformed-schema + the manifest-parse guard)", () => {
  // A verdict-only assertion cannot tell the missing-schema branch (existsSync) from the parse-catch
  // branch, and a mutated manifest-parse guard survives. The reason text pins each branch independently.
  assert.match(reasonsFor("missingSchema"), /missing schemas\/data_types\.json/);
  assert.match(reasonsFor("malformedSchema"), /unparseable schemas\/data_types\.json/);
  assert.match(reasonsFor("malformedManifest"), /unparseable manifest\.json/);
  assert.match(reasonsFor("placeholderHash"), /placeholder sourceHash/);
  assert.match(reasonsFor("unknownCap"), /unknown\/unpermitted capability/);
});

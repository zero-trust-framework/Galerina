// Diagnostic-namespace ownership — the CHECKED invariant (avoid semantic drift).
// Spec: docs/Knowledge-Bases/galerina-diagnostic-namespace-ownership.md
//
// Every FUNGI-* code emitted in the compiler source (`code: "FUNGI-..."` literals) must be REGISTERED
// in a registry doc (compiler-diagnostics.md OR governance-rules.md), OR be on the explicit
// PENDING_REGISTRATION allowlist (the baseline backlog captured at adoption). A NEW unregistered,
// non-allowlisted code fails this test — that is what makes namespace ownership machine-checked.
// The allowlist may only SHRINK: registering a code means removing it from the allowlist.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
// KB relocated out of the repo to sibling ../ZTF-Knowledge-Bases (IP protection).
// Resolve order: GALERINA_KB_DIR env → in-repo docs/ (if restored) → sibling KB.
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const KB_DIR = process.env.GALERINA_KB_DIR
  ? resolve(process.env.GALERINA_KB_DIR)
  : existsSync(join(REPO_ROOT, "docs", "Knowledge-Bases"))
    ? join(REPO_ROOT, "docs", "Knowledge-Bases")
    : join(REPO_ROOT, "..", "ZTF-Knowledge-Bases");
const REGISTRY_DOCS = ["compiler-diagnostics.md", "galerina-governance-rules.md"].map((f) => join(KB_DIR, f));
const ALLOWLIST_FILE = fileURLToPath(new URL("./fixtures/diagnostic-pending-registration.txt", import.meta.url));

function walkTs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = `${dir}/${name}`;
    if (statSync(full).isDirectory()) out.push(...walkTs(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function codesFrom(text, re) {
  const set = new Set();
  for (const m of text.matchAll(re)) set.add(m[1] ?? m[0]);
  return set;
}

const emitted = new Set();
for (const f of walkTs(SRC)) {
  for (const m of readFileSync(f, "utf8").matchAll(/code:\s*"(FUNGI-[A-Z0-9-]+)"/g)) emitted.add(m[1]);
}
const registered = new Set();
for (const d of REGISTRY_DOCS) {
  for (const c of codesFrom(readFileSync(d, "utf8"), /FUNGI-[A-Z0-9-]+/g)) registered.add(c);
}
const allowlist = new Set(
  readFileSync(ALLOWLIST_FILE, "utf8")
    .split(/\r?\n/).map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#")), // allow # comment lines in the fixture
);

describe("Diagnostic-namespace ownership (checked invariant)", () => {
  it("emits at least the expected number of FUNGI-* codes (sanity)", () => {
    assert.ok(emitted.size >= 150, `expected ≥150 emitted codes, found ${emitted.size}`);
  });

  it("every emitted code is registered OR on the PENDING_REGISTRATION allowlist (no NEW drift)", () => {
    const gap = [...emitted].filter((c) => !registered.has(c)).sort();
    const offenders = gap.filter((c) => !allowlist.has(c));
    assert.deepEqual(
      offenders, [],
      `New unregistered diagnostic code(s) — register in compiler-diagnostics.md (or governance-rules.md), ` +
      `or add to fixtures/diagnostic-pending-registration.txt with a reason:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("the allowlist is shrink-only (no entry that is already registered)", () => {
    const stale = [...allowlist].filter((c) => registered.has(c)).sort();
    assert.deepEqual(
      stale, [],
      `These codes are now registered — remove them from fixtures/diagnostic-pending-registration.txt:\n  ${stale.join("\n  ")}`,
    );
  });
});

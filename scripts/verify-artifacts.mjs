#!/usr/bin/env node
/**
 * scripts/verify-artifacts.mjs — opaque-artifact integrity scanner.
 *
 * Why this exists: a brand/find-replace sweep can silently corrupt files you can't
 * eyeball — signed manifests, the revocation registry, compiled .wasm, and the crypto
 * WIRE-FORMAT strings that are hashed into signatures. During the Galerina rebrand a
 * naive sweep edited text INSIDE the signed payload of governance/revocations.json
 * (invalidating its Ed25519 signature) and truncated the ML-DSA domain-separation
 * contexts (logicn.* -> galerin.*). Neither shows up as a syntax/type error; both are
 * the kind of thing this scanner surfaces.
 *
 * What it does (read-only — never writes, never signs):
 *   1. LIVE-verifies governance/revocations.json against the pinned trust anchor.
 *   2. DIFFS every opaque artifact (*.lmanifest[.json], *.manifest, *.wasm, *.pub.pem,
 *      trust-anchor.json) against a known-good pre-rebrand backup, classifying each:
 *      intact / formatting-only / SIGNATURE-STALE / re-signed / wasm-drift / no-backup.
 *   3. Cross-checks each manifest's recorded wasm sha256 against the real .wasm bytes.
 *   4. Scans compiler source for corrupted/renamed crypto wire-format constants
 *      (truncated `galerin.*` contexts; `spore.*` tags renamed from `lln.*`) that
 *      orphan pre-rebrand persisted signatures.
 *
 * Usage:
 *   node scripts/verify-artifacts.mjs [--backup "<path>"] [--json]
 *   (default backup: "../LogicN - Copy (2)"; pass --backup "" to skip the diff)
 *
 * Exit code: 0 = clean, 1 = at least one BROKEN/STALE artifact found.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { assertRegistryTrustworthy } from "../governance/revocation-registry.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, "..");

// ── args ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const backupIdx = argv.indexOf("--backup");
const BACKUP =
  backupIdx >= 0 ? argv[backupIdx + 1] : join(REPO, "..", "LogicN - Copy (2)");
const HAVE_BACKUP = BACKUP && existsSync(BACKUP);

// ── helpers ──────────────────────────────────────────────────────────────────
const SKIP_DIRS = new Set([".git", "node_modules"]);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** A path key with brand tokens collapsed, so packages-galerina/... maps to packages-logicn/... */
function brandKey(relPath) {
  return relPath
    .split(sep)
    .join("/")
    .toLowerCase()
    .replace(/galerina|galerin|logicn/g, "@");
}

function isArtifact(name) {
  return (
    name.endsWith(".lmanifest") ||
    name.endsWith(".lmanifest.json") ||
    name.endsWith(".manifest") ||
    name.endsWith(".wasm") ||
    name.endsWith(".pub.pem") ||
    name === "revocations.json" ||
    name === "trust-anchor.json"
  );
}

/** Recursively collect artifact full-paths under `root`. */
function collect(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name));
      } else if (isArtifact(e.name)) {
        out.push(join(dir, e.name));
      }
    }
  };
  walk(root);
  return out;
}

/** Strip the signature field(s) from a parsed manifest so we can compare the SIGNED payload. */
function stripSig(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  const clone = JSON.parse(JSON.stringify(obj));
  delete clone.signature;
  delete clone.governanceSignature;
  return clone;
}
function sigValue(obj) {
  if (obj === null || typeof obj !== "object") return undefined;
  return obj.signature?.value ?? obj.governanceSignature?.signature ?? undefined;
}

// ── build the backup index (brandKey -> fullPath) ────────────────────────────
const backupIndex = new Map();
if (HAVE_BACKUP) {
  for (const f of collect(BACKUP)) {
    backupIndex.set(brandKey(relative(BACKUP, f)), f);
  }
}

// ── classify one artifact vs its backup counterpart ──────────────────────────
function classify(cur) {
  const rel = relative(REPO, cur);
  const key = brandKey(rel);
  const back = HAVE_BACKUP ? backupIndex.get(key) : undefined;
  const curBuf = readFileSync(cur);

  if (HAVE_BACKUP && !back) return { rel, status: "no-backup", note: "new since backup" };
  if (!HAVE_BACKUP) return { rel, status: "skip-diff", note: "no backup supplied" };

  const backBuf = readFileSync(back);
  if (curBuf.equals(backBuf)) return { rel, status: "intact", note: "byte-identical to backup" };

  // .wasm (or any non-JSON): bytes differ -> drift
  if (cur.endsWith(".wasm")) {
    return { rel, status: "wasm-drift", note: `sha ${sha256(curBuf).slice(0, 12)} != backup ${sha256(backBuf).slice(0, 12)}` };
  }
  if (cur.endsWith(".pub.pem")) {
    return { rel, status: "BROKEN", note: "public key bytes changed (a sweep must never touch key PEM)" };
  }

  // JSON manifests / registry: compare signed payload vs signature
  let curObj, backObj;
  try {
    curObj = JSON.parse(curBuf.toString("utf8"));
    backObj = JSON.parse(backBuf.toString("utf8"));
  } catch {
    return { rel, status: "changed", note: "non-JSON bytes changed" };
  }
  const payloadChanged =
    JSON.stringify(stripSig(curObj)) !== JSON.stringify(stripSig(backObj));
  const sigChanged = sigValue(curObj) !== sigValue(backObj);
  const hasSig = sigValue(curObj) !== undefined || sigValue(backObj) !== undefined;

  if (!payloadChanged && !sigChanged) return { rel, status: "formatting", note: "whitespace/key-order only" };
  if (hasSig && payloadChanged && !sigChanged)
    return { rel, status: "SIGNATURE-STALE", note: "signed payload edited but signature NOT updated -> verification fails closed" };
  if (hasSig && sigChanged) return { rel, status: "re-signed", note: "signature value also changed (verify signer is authorized)" };
  return { rel, status: "changed", note: "payload changed (unsigned manifest)" };
}

// ── manifest -> wasm sha256 cross-check ──────────────────────────────────────
function wasmCrossCheck(cur) {
  const findings = [];
  let obj;
  try {
    obj = JSON.parse(readFileSync(cur, "utf8"));
  } catch {
    return findings;
  }
  // walk for { wasm | wasmPath, sha256 | wasmSha256 } pairs
  const visit = (node) => {
    if (node === null || typeof node !== "object") return;
    const wasmRef = node.wasm ?? node.wasmPath;
    const shaRef = node.sha256 ?? node.wasmSha256;
    if (typeof wasmRef === "string" && typeof shaRef === "string") {
      const wasmAbs = join(dirname(cur), wasmRef);
      const want = shaRef.replace(/^sha256:/, "");
      if (existsSync(wasmAbs)) {
        const got = sha256(readFileSync(wasmAbs));
        if (got !== want)
          findings.push({ rel: relative(REPO, cur), wasm: wasmRef, status: "WASM-HASH-MISMATCH", note: `manifest=${want.slice(0, 12)} file=${got.slice(0, 12)}` });
      }
    }
    for (const v of Array.isArray(node) ? node : Object.values(node)) visit(v);
  };
  visit(obj);
  return findings;
}

// ── crypto wire-format string scan (compiler source) ─────────────────────────
function wireScan() {
  const hits = [];
  const srcRoot = join(REPO, "packages-galerina");
  const RX = [
    { rx: /galerin\.(proofgraph|bridge|audit|config)\.[a-z.]+v\d/g, kind: "TRUNCATED-CONTEXT", why: "domain-sep context truncated logicn.*->galerin.* (orphans pre-rebrand hybrid sigs)" },
    { rx: /\bspore\.(gov\.sig|runtime\.audit|runtime\.manifest|gir|govdiff)\.v\d/g, kind: "RENAMED-WIRETAG", why: "wire/schema version tag renamed lln.*->spore.* (orphans pre-rebrand persisted sigs/audit chain)" },
  ];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name)); continue; }
      if (!e.name.endsWith(".ts") || e.name.endsWith(".d.ts")) continue;
      const p = join(dir, e.name);
      let text;
      try { text = readFileSync(p, "utf8"); } catch { continue; }
      for (const { rx, kind, why } of RX) {
        const found = new Set(text.match(rx));
        for (const tok of found) hits.push({ rel: relative(REPO, p), token: tok, kind, why });
      }
    }
  };
  if (existsSync(srcRoot)) walk(srcRoot);
  return hits;
}

// ── run ──────────────────────────────────────────────────────────────────────
const report = { registry: null, artifacts: [], wasmHash: [], wire: [] };

// 1. live registry verify
try {
  const r = assertRegistryTrustworthy(REPO);
  report.registry = { ok: r.valid === true, ...r };
} catch (e) {
  report.registry = { ok: false, error: String(e.message ?? e) };
}

// 2 + 3. artifact diff + wasm cross-check
const artifacts = collect(REPO);
for (const a of artifacts) {
  report.artifacts.push(classify(a));
  if (a.endsWith(".lmanifest.json") || a.endsWith(".manifest") || a.endsWith(".lmanifest"))
    report.wasmHash.push(...wasmCrossCheck(a));
}

// 4. wire-format scan
report.wire = wireScan();

// ── output ────────────────────────────────────────────────────────────────────
const BROKEN = new Set(["BROKEN", "SIGNATURE-STALE", "WASM-HASH-MISMATCH"]);
const counts = {};
for (const a of report.artifacts) counts[a.status] = (counts[a.status] ?? 0) + 1;

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const ICON = { intact: "✓", formatting: "≈", "no-backup": "•", "skip-diff": "•", changed: "·", "re-signed": "↻", "wasm-drift": "~", "SIGNATURE-STALE": "✗", BROKEN: "✗" };
  console.log(`\n🔎 Artifact integrity scan  (repo: ${REPO})`);
  console.log(`   backup: ${HAVE_BACKUP ? BACKUP : "(none — diff skipped)"}\n`);

  console.log(`1) Revocation registry (live verify): ${report.registry.ok ? "✓ trustworthy " + JSON.stringify({ keyId: report.registry.keyId, pinned: report.registry.pinned }) : "✗ FAIL — " + (report.registry.error ?? "invalid")}`);

  console.log(`\n2) Opaque artifacts vs backup (${report.artifacts.length} scanned):`);
  for (const a of report.artifacts.filter((x) => x.status !== "intact" && x.status !== "formatting")) {
    console.log(`   ${ICON[a.status] ?? "?"} [${a.status}] ${a.rel}  — ${a.note}`);
  }
  console.log(`   summary: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join("  ")}`);

  console.log(`\n3) Manifest→wasm sha256 cross-check: ${report.wasmHash.length === 0 ? "✓ all match" : report.wasmHash.length + " MISMATCH"}`);
  for (const w of report.wasmHash) console.log(`   ✗ ${w.rel} → ${w.wasm}: ${w.note}`);

  console.log(`\n4) Crypto wire-format strings changed by the rebrand: ${report.wire.length === 0 ? "✓ none" : report.wire.length + " occurrence(s)"}`);
  const byKind = {};
  for (const h of report.wire) (byKind[h.kind] ??= new Set()).add(`${h.token}  (${h.rel})`);
  for (const [kind, set] of Object.entries(byKind)) {
    console.log(`   ⚠ ${kind}:`);
    for (const s of set) console.log(`       ${s}`);
  }
}

const broken = report.artifacts.filter((a) => BROKEN.has(a.status)).length + report.wasmHash.length + (report.registry.ok ? 0 : 1);
process.exit(broken > 0 ? 1 : 0);

/**
 * governance/key-lifecycle.mjs — zero-touch signing-key lifecycle for app developers.
 *
 * GOAL: a developer building an app with LogicN never has to think about keys. The dev
 * signing key is provisioned AUTOMATICALLY, the toolchain stays SILENT in normal operation,
 * and a diagnostic appears ONLY when something needs attention — a stale key, a revoked key,
 * an untrusted revocation registry, or weak key-file permissions. Every diagnostic carries a
 * stable code, a severity, and concrete remediation instructions.
 *
 * Diagnostic codes (LLN-KEY-*) are documented in
 * docs/Knowledge-Bases/logicn-key-lifecycle-diagnostics.md.
 *
 * This is the developer-facing, zero-touch layer over the crypto-on-core primitives
 * (revocation-registry.mjs). Production key custody (HSM/KMS, auto-rotation) is #149.
 */
import {
  readFileSync, existsSync, statSync, writeFileSync, mkdirSync, chmodSync,
} from "node:fs";
import { join } from "node:path";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { isKeyRevoked, assertRegistryTrustworthy } from "./revocation-registry.mjs";

const DEFAULT_STALE_DAYS = 90;
const ENV_FILE = ".env.logicn-signing";

/** Stable code registry (severity may vary by profile; see assessSigningKey). */
export const KEY_DIAGNOSTICS = {
  "LLN-KEY-001": "No signing key found",
  "LLN-KEY-002": "Signing key is stale (past rotation age)",
  "LLN-KEY-004": "Signing key is revoked",
  "LLN-KEY-005": "Private-key file permissions too open",
  "LLN-KEY-010": "Revocation registry is untrusted",
};

function diag(code, severity, message, fix) {
  return { code, severity, message, fix };
}

function readSigningEnv(rootDir) {
  const path = join(rootDir, ENV_FILE);
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf-8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function keyAgeDays(rootDir, keyId, createdAt) {
  let ms = null;
  if (createdAt) {
    const t = Date.parse(createdAt);
    if (!Number.isNaN(t)) ms = Date.now() - t;
  }
  if (ms === null && keyId) {
    const pub = join(rootDir, "governance", `signing-key-${keyId}.pub.pem`);
    if (existsSync(pub)) ms = Date.now() - statSync(pub).mtimeMs;
  }
  return ms === null ? null : Math.floor(ms / 86_400_000);
}

/**
 * Assess the signing-key state and return developer-facing diagnostics.
 * @returns {{ keyId:string|null, diagnostics:Array, fatal:boolean, action:"ok"|"auto-provision"|"fail-closed", ageDays?:number }}
 */
export function assessSigningKey({ rootDir = ".", profile = "dev", staleDays = DEFAULT_STALE_DAYS } = {}) {
  const diagnostics = [];

  // 1. The revocation registry must itself be trustworthy before we trust what it says.
  try {
    assertRegistryTrustworthy(rootDir);
  } catch (e) {
    diagnostics.push(diag("LLN-KEY-010", "error",
      `Revocation registry is untrusted: ${e.message}`,
      "Do NOT proceed — a tampered registry could hide a revoked key. Restore governance/revocations.json from a trusted source and re-sign it: node governance/sign-revocations.mjs"));
    return { keyId: null, diagnostics, fatal: true, action: "fail-closed" };
  }

  // 2. Is there a signing key at all?
  const env = readSigningEnv(rootDir);
  const keyId = env.LOGICN_SIGNING_KEY_ID || null;
  if (!keyId) {
    if (profile === "production") {
      diagnostics.push(diag("LLN-KEY-001", "error",
        "No signing key found, and auto-provisioning is disabled in production.",
        "Provision the production signing key in your KMS/HSM and expose it as LOGICN_SIGNING_KEY_ID (private key via the keystore — never on disk or the command line). See #149."));
      return { keyId: null, diagnostics, fatal: true, action: "fail-closed" };
    }
    diagnostics.push(diag("LLN-KEY-001", "notice",
      "No signing key found — auto-provisioning a development signing key (zero-touch).",
      "Nothing to do for local development. For production, provision via KMS/HSM; never commit the private key (.env.logicn-signing is git-ignored)."));
    return { keyId: null, diagnostics, fatal: false, action: "auto-provision" };
  }

  // 3. Revoked? Never sign with a revoked key — fail closed.
  if (isKeyRevoked(keyId, rootDir)) {
    diagnostics.push(diag("LLN-KEY-004", "error",
      `Signing key ${keyId} is REVOKED — refusing to use it.`,
      "Mint a fresh key (run `logicn keygen`, or let the next build auto-provision one). The revoked key must never sign again; see security/revocations/."));
    return { keyId, diagnostics, fatal: true, action: "fail-closed" };
  }

  // 4. Private-key file permissions (POSIX; best-effort — Windows mode bits are not meaningful).
  if (process.platform !== "win32") {
    const p = join(rootDir, ENV_FILE);
    try {
      if (existsSync(p) && (statSync(p).mode & 0o077) !== 0) {
        diagnostics.push(diag("LLN-KEY-005", "warning",
          `${ENV_FILE} is group/world-accessible.`,
          `Restrict it: chmod 600 ${ENV_FILE}. Better: move the key into a KMS/HSM (#149).`));
      }
    } catch { /* best-effort */ }
  }

  // 5. Staleness — the ONE thing a developer is asked to act on (a warning, never a hard stop).
  const ageDays = keyAgeDays(rootDir, keyId, env.LOGICN_SIGNING_KEY_CREATED);
  if (ageDays !== null && ageDays > staleDays) {
    diagnostics.push(diag("LLN-KEY-002", "warning",
      `Signing key ${keyId} is STALE — ${ageDays} days old (rotate after ${staleDays}).`,
      "Rotate it: run `logicn keygen` to mint a new key, add the OLD key id to governance/revocations.json, then `node governance/sign-revocations.mjs`. (Automatic rotation is the roadmap — #149.)"));
  }

  return { keyId, diagnostics, fatal: false, action: "ok", ageDays };
}

/** Auto-provision a development signing key (zero-touch). Mirrors `logicn keygen`. */
export function provisionDevKey(rootDir = ".") {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const keyId = randomBytes(8).toString("hex");
  mkdirSync(join(rootDir, "governance"), { recursive: true });
  writeFileSync(join(rootDir, "governance", `signing-key-${keyId}.pub.pem`), publicKey);
  const envPath = join(rootDir, ENV_FILE);
  writeFileSync(envPath, [
    "# LogicN governance signing key — NEVER COMMIT THIS FILE (git-ignored)",
    `# Key ID: ${keyId}`,
    "# Ed25519, auto-provisioned (dev). Production: use a KMS/HSM (#149).",
    `LOGICN_SIGNING_KEY_ID=${keyId}`,
    `LOGICN_SIGNING_KEY_CREATED=${new Date().toISOString()}`,
    `LOGICN_SIGNING_PRIVATE_KEY_B64=${Buffer.from(privateKey).toString("base64")}`,
    "",
  ].join("\n"), { mode: 0o600 });
  try { chmodSync(envPath, 0o600); } catch { /* Windows best-effort */ }
  return keyId;
}

/** Render diagnostics for CLI output: code · severity · message · remediation. */
export function formatDiagnostics(diagnostics) {
  return diagnostics.map((d) => {
    const icon = d.severity === "error" ? "❌" : d.severity === "warning" ? "⚠️ " : "ℹ️ ";
    return `${icon} ${d.code} (${d.severity}): ${d.message}\n   → ${d.fix}`;
  }).join("\n");
}

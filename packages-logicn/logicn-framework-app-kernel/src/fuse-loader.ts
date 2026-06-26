/**
 * Governed component loader — fuses a built LogicN package's governed .wasm into
 * a host App Kernel (framework P1 slice 4 / Fuse B2, Net a).
 *
 * Fusion is the ONE-TIME, fail-closed admission of a separately-compiled package
 * at a declared seam. It is NOT a runtime middleware chain: the package is admitted
 * (hash + signature checked) and instantiated with a CLOSED, capability-bounded host
 * import object, then exposed as a {@link FusedComponent} the kernel calls directly.
 *
 * Three fail-closed gates, in order:
 *   1  .wasm sha256 MUST match the descriptor's wasmSha256 (else throw — tamper).
 *   2  the manifest signature MUST verify when a public key exists for its keyId
 *      (else throw). An unsigned / placeholder manifest is admitted ONLY when the
 *      caller passes `allowUnsigned: true`, and then only with a warning.
 *   3  the .wasm is instantiated with ONLY the host imports its DECLARED capabilities
 *      permit — deny-by-default. A capability the package did not declare gets NO
 *      host import (the import object simply has no entry for it).
 *
 * The AUTHORITATIVE fusion contract is the `fuse` block embedded inside the SIGNED
 * .lmanifest.json (Net a, Fuse B2 STEP A). The standalone <name>.fuse.json is a
 * convenience copy; when both exist the loader cross-checks them and treats the
 * signed manifest as the source of truth on any disagreement (fail-closed).
 */
// ── Node builtins, loaded WITHOUT @types/node ────────────────────────────────
// This package deliberately ships no @types/node (cf. kernel.ts, which duck-types
// `unref`). We therefore declare the minimal slices of node:crypto/fs/path we use
// and load them via a dynamically-typed import so the typechecker never resolves
// `node:*` modules. At runtime (node --test) the real builtins are present.
interface NodeHash {
  update(data: Uint8Array | string): NodeHash;
  digest(enc: "hex"): string;
}
interface NodePublicKey { readonly __brand: "PublicKey"; }
interface NodeCrypto {
  createHash(algo: "sha256"): NodeHash;
  createPublicKey(pem: string): NodePublicKey;
  verify(
    algorithm: null,
    data: Uint8Array,
    key: NodePublicKey,
    signature: Uint8Array,
  ): boolean;
}
interface NodeFs {
  readFileSync(path: string, enc: "utf8"): string;
  readFileSync(path: string): Uint8Array;
  existsSync(path: string): boolean;
  readdirSync(path: string): string[];
}
interface NodePath {
  join(...parts: string[]): string;
  basename(p: string, ext?: string): string;
}

const dynImport = (s: string): Promise<unknown> =>
  (Function("s", "return import(s)") as (s: string) => Promise<unknown>)(s);

async function loadNode(): Promise<{ crypto: NodeCrypto; fs: NodeFs; path: NodePath }> {
  const [crypto, fs, path] = await Promise.all([
    dynImport("node:crypto") as Promise<NodeCrypto>,
    dynImport("node:fs") as Promise<NodeFs>,
    dynImport("node:path") as Promise<NodePath>,
  ]);
  return { crypto, fs, path };
}

/** UTF-8 encode without depending on node:Buffer (TextEncoder is an ambient global). */
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Decode a base64 string to bytes without node:Buffer (atob is an ambient global). */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Manifest signature input (VERSIONED) ────────────────────────────────────────────────────────
// This MUST stay byte-identical to core-compiler's manifest-generator.{canonicalJson,manifestSigningInput};
// a conformance test (canonical-json-conformance.test.mjs) asserts that over a corpus so they cannot drift.
// Kept LOCAL so the app kernel stays self-contained (no core-compiler coupling, no node:* at module top).

/** RFC 8785 §3.2.2 string escaping. */
function canonStr(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) { out += '\\"'; continue; }
    if (c === 0x5c) { out += "\\\\"; continue; }
    if (c < 0x20) { out += "\\u" + c.toString(16).padStart(4, "0"); continue; }
    out += s[i];
  }
  return out + '"';
}

/** RFC 8785 canonical JSON (keys sorted lexicographically, no whitespace).
 *  Exported so the signed registry index (B5a, registry-index.ts) signs over the SAME canonical
 *  form as manifests — one canonicalizer, no drift (asserted by canonical-json-conformance.test.mjs). */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("RFC 8785: non-finite numbers not allowed");
    return String(value);
  }
  if (typeof value === "string") return canonStr(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return "{" + keys.map(k => canonStr(k) + ":" + canonicalJson((value as Record<string, unknown>)[k])).join(",") + "}";
  }
  throw new Error(`RFC 8785: unsupported type ${typeof value}`);
}

/** The exact bytes a manifest signature covers, dispatched on the signature's `canon` tag. */
function manifestSigningInput(manifestWithoutSig: unknown, sig: Record<string, unknown>): string {
  return sig["canon"] === "jcs"
    ? canonicalJson(manifestWithoutSig)               // RFC 8785 — new builds
    : JSON.stringify(manifestWithoutSig, null, 2);    // "legacy" pretty-JSON — untagged older sigs
}

/** The fuse fields, as embedded in the signed manifest and mirrored in <name>.fuse.json. */
export interface FuseDescriptor {
  readonly schemaVersion: string;
  readonly name: string;
  readonly version: string;
  readonly kind: string;
  readonly provides: string | null;
  readonly seam: string | null;
  readonly capabilities: readonly string[];
  /** `sha256:<64 hex>` of the package's .wasm — binds the descriptor to the binary. */
  readonly wasmSha256: string;
}

/** A package admitted into the kernel: its identity, granted capabilities, and a callable entry. */
export interface FusedComponent {
  readonly name: string;
  /** The declared seam this component attaches at (e.g. "protocol.inbound"); null if unseamed. */
  readonly seam: string | null;
  /** The capabilities the manifest declared — the ONLY host imports this component received. */
  readonly capabilities: readonly string[];
  /**
   * Invoke an exported function of the fused .wasm. Numeric args/return mirror the
   * LogicN WASM ABI (i32 handles / scalars). Throws if the export is absent.
   */
  invoke(exportName: string, ...args: number[]): number;
}

export interface FusePackageOptions {
  /**
   * Admit an unsigned (or placeholder-signed) manifest. Default `false` (fail-closed).
   * When true and the manifest is unsigned, a warning is emitted but fusion proceeds.
   */
  readonly allowUnsigned?: boolean;
  /**
   * Posture-derived import profile (R&D 0051): when `true`, an unsigned import is REFUSED even if
   * `allowUnsigned` was also passed — the security posture wins, fail-secure. The host derives this
   * from `deriveImportProfile(resolvePosture(...))` in `@logicn/core-config` (prod/mesh ⇒ true).
   * Tamper (hash/signature) is denied regardless of this flag.
   */
  readonly requireSignature?: boolean;
  /**
   * Directory holding `signing-key-<keyId>.pub.pem` public keys. Defaults to
   * `<repo>/governance` relative to the package dir's two parents is NOT assumed —
   * callers point this at their governance dir. When omitted, the loader looks for a
   * `governance` dir beside the package and walks up a couple of levels.
   */
  readonly governanceDir?: string;
  /** Override/extend the capability→host-import registry. Merged over the built-in registry. */
  readonly capabilityRegistry?: Readonly<Record<string, CapabilityImportFactory>>;
  /** Sink for warnings (default: console.warn). Lets tests capture WARN output. */
  readonly warn?: (message: string) => void;
  /**
   * Fail-closed revocation check. The host supplies a registry-backed predicate returning `true` if a
   * keyId has been revoked; a VALIDLY-SIGNED but REVOKED key is then REFUSED at the fuse gate (a throw
   * is itself treated as fail-closed). The kernel stays node-dependency-free — the CLI (`logicn fuse`)
   * injects this from `governance/revocation-registry.mjs`. When omitted, no revocation gate runs.
   */
  readonly revocationCheck?: (keyId: string) => boolean;

  /**
   * B5a — optional CENTRAL signed-registry admission gate. Mirrors {@link revocationCheck}: the host
   * injects a predicate (typically `(pkg) => admitFromRegistry(index, verify, pkg, policy)` from
   * registry-index.ts) that vets the package against a VALIDLY-SIGNED central index. A non-`ok` result
   * REFUSES the fuse, fail-closed — a central allow-list ON TOP of the per-manifest signature gate, so a
   * validly self-signed but unlisted / forked package is rejected. When omitted, no registry gate runs.
   */
  readonly registryCheck?: (pkg: {
    readonly name: string;
    readonly version: string;
    readonly sourceHash: string;
    readonly keyId?: string | undefined;
  }) => { readonly ok: boolean; readonly code?: string; readonly reason?: string };

  /**
   * H3/H4 (#49) — INJECTED hybrid (Ed25519+ML-DSA-65) manifest-signature verifier. The kernel verifies the
   * classical Ed25519 half itself but stays PQ-crypto-dependency-free (a lean load-bearing TCB), so a
   * deployment injects the post-quantum half — same pattern as {@link revocationCheck}. Called ONLY for a
   * manifest carrying a hybrid signature (algorithm `Ed25519+ML-DSA-65`, signature `<ed-b64>|<mldsa-b64>`).
   * The injected verifier MUST verify BOTH halves over `signingInput` (the exact canonical bytes the signer
   * covered — both halves sign the SAME RFC-8785 body, no ProofGraph envelope) against the trusted key(s) for
   * `keyId`, returning:
   *   - `"verified"`     — both halves verified ⇒ the manifest is admitted as signed;
   *   - `"invalid"`      — a present hybrid signature FAILED to verify (tamper) ⇒ the loader THROWS (fail-closed);
   *   - `"unverifiable"` — the verifier cannot decide (no key for keyId / malformed) ⇒ treated as UNSIGNED
   *                        (refused under requireSignature, admitted only where unsigned is already permitted).
   * When omitted, a hybrid signature stays UNVERIFIED-HERE → "unsigned" (the prior behaviour) with a loud warn.
   */
  readonly hybridVerifier?: HybridManifestVerifier;
}

export type HybridManifestVerdict = "verified" | "invalid" | "unverifiable";

/**
 * Injected post-quantum (hybrid) manifest-signature verifier — see {@link FusePackageOptions.hybridVerifier}.
 * MAY be async: the shipped reference verifier (`@logicn/core-compiler` `verifyGovernanceSignatureHybrid`)
 * dynamically imports `@noble/post-quantum`, so the verdict can be a Promise — the loader awaits it.
 *
 * NOTE on `signingInput`: it is the RFC-8785 canonical manifest body. The v2 hybrid signature the LogicN CLI
 * writes is over the ProofGraph ENVELOPE of `sha256(signingInput)` (compiler code), not over `signingInput`
 * directly — so a faithful injected verifier recomputes `bodyHash = sha256(signingInput)`, rebuilds the
 * envelope via `makeManifestEnvelope`, and calls `verifyGovernanceSignatureHybrid`. The loader hands over the
 * canonical body (+ the signature + keyId + dirs to resolve the `signing-key-<keyId>.{pub.pem,mldsa.pub.b64}`
 * key pair) and stays compiler-/PQ-crypto-free.
 */
export type HybridManifestVerifier = (input: {
  readonly keyId: string;
  readonly algorithm: string;
  /** The RFC-8785 canonical manifest body (the v2 signature is over the ProofGraph envelope of its sha256). */
  readonly signingInput: Uint8Array;
  /** The combined `<ed-b64>|<mldsa-b64>` signature string from `governanceSignature.signature`. */
  readonly signature: string;
  readonly governanceDir: string | undefined;
  readonly packageDir: string;
}) => HybridManifestVerdict | Promise<HybridManifestVerdict>;

/**
 * Builds the host import group a single capability grants. Returns a namespace name
 * and the functions exposed under it. Deny-by-default: a capability with no factory
 * grants NOTHING (and fusion throws — an undeclarable capability is a misconfiguration).
 */
export type CapabilityImportFactory = () => {
  readonly namespace: string;
  readonly functions: Readonly<Record<string, (...a: number[]) => number | void>>;
};

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;

/**
 * Built-in capability → host-import registry. Each capability maps to a NAMESPACED
 * group of host functions. A package that does not declare a capability never gets
 * its namespace in the import object — deny-by-default.
 *
 * These are deliberately minimal, side-effect-free shims at this slice: the point of
 * Fuse B2 is the GATING (which imports a component is allowed to see), not the I/O
 * implementation. Real network/clock/log backends are wired by the host at a later slice.
 */
const BUILTIN_CAPABILITY_REGISTRY: Readonly<Record<string, CapabilityImportFactory>> = Object.freeze({
  "network.inbound": () => ({
    namespace: "network_inbound",
    functions: {
      // Accept-side shims: a fused inbound-protocol component may read the next
      // queued request handle. No outbound reach — that is a different capability.
      __net_in_accept: () => -1,
      __net_in_peer: () => -1,
    },
  }),
  "network.outbound": () => ({
    namespace: "network_outbound",
    functions: {
      __net_out_connect: () => -1,
      __net_out_send: () => -1,
    },
  }),
  "clock.read": () => ({
    namespace: "clock",
    functions: {
      __clock_now_ms: () => 0,
    },
  }),
  "log.write": () => ({
    namespace: "log",
    functions: {
      __log_emit: () => 0,
    },
  }),
});

/**
 * The capability NAMES the built-in fusion registry exposes. Published so the
 * unified admission vocabulary (compiler `capability-types`, B2) can be
 * drift-checked against the fusion gate: every name here MUST be admissible under
 * the one canonical allow-list, so the two gates cannot silently diverge.
 */
export const BUILTIN_CAPABILITY_NAMES: readonly string[] = Object.freeze(
  Object.keys(BUILTIN_CAPABILITY_REGISTRY),
);

/** Throw a fail-closed fusion error with a stable `LLN-FUSE-*` code prefix. */
function fuseError(code: string, message: string): never {
  throw new Error(`${code}: ${message}`);
}

/** Read + parse a JSON file, or throw a fail-closed fusion error. */
function readJson(fs: NodeFs, filePath: string, code: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return fuseError(code, `missing or unreadable: ${filePath}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    return fuseError(code, `invalid JSON in ${filePath}: ${(e as Error).message}`);
  }
}

/** Extract + validate the embedded `fuse` block from the signed manifest object. */
function extractFuse(manifest: Record<string, unknown>, source: string): FuseDescriptor {
  const fuse = manifest["fuse"];
  if (fuse === undefined || fuse === null || typeof fuse !== "object") {
    return fuseError("LLN-FUSE-NO-DESCRIPTOR", `signed manifest ${source} has no embedded 'fuse' block`);
  }
  const f = fuse as Record<string, unknown>;
  const name = f["name"];
  const wasmSha256 = f["wasmSha256"];
  if (typeof name !== "string" || typeof wasmSha256 !== "string") {
    return fuseError("LLN-FUSE-BAD-DESCRIPTOR", `embedded fuse block in ${source} is missing name/wasmSha256`);
  }
  if (!SHA256_RE.test(wasmSha256)) {
    return fuseError("LLN-FUSE-BAD-DESCRIPTOR", `embedded fuse.wasmSha256 is not 'sha256:<64 hex>': ${wasmSha256}`);
  }
  const caps = f["capabilities"];
  const capabilities: string[] = Array.isArray(caps) ? caps.filter((c): c is string => typeof c === "string") : [];
  const provides = typeof f["provides"] === "string" ? (f["provides"] as string) : null;
  const seam = typeof f["seam"] === "string" ? (f["seam"] as string) : null;
  return {
    schemaVersion: typeof f["schemaVersion"] === "string" ? (f["schemaVersion"] as string) : "lln.fuse.v1",
    name,
    version: typeof f["version"] === "string" ? (f["version"] as string) : "0.0.0",
    kind: typeof f["kind"] === "string" ? (f["kind"] as string) : "capability",
    provides,
    seam,
    capabilities,
    wasmSha256,
  };
}

/**
 * Verify the manifest's Ed25519 governance signature, fail-closed.
 *
 * - A REAL signature (algorithm 'Ed25519', with keyId + base64 signature) whose
 *   public key exists MUST verify, or we throw.
 * - If the public key for its keyId is absent we cannot prove authenticity → treated
 *   as unsigned (fail-closed unless allowUnsigned).
 * - A placeholder / object-shaped governanceSignature without a real (keyId+signature)
 *   pair is treated as UNSIGNED.
 *
 * Mirrors the signing reconstruction in `logicn build`: sign over
 * `JSON.stringify(manifestWithoutSignature, null, 2)` with Ed25519 (verify(null, …)).
 *
 * @returns "verified" | "unsigned"
 */
async function verifyManifestSignature(
  node: { crypto: NodeCrypto; fs: NodeFs; path: NodePath },
  manifestObj: Record<string, unknown>,
  governanceDir: string | undefined,
  packageDir: string,
  warn: (m: string) => void,
  hybridVerifier?: HybridManifestVerifier,
): Promise<"verified" | "unsigned"> {
  const { crypto, fs, path } = node;
  const sigField = manifestObj["governanceSignature"];
  if (sigField === undefined || sigField === null || typeof sigField !== "object") {
    return "unsigned";
  }
  const sig = sigField as Record<string, unknown>;
  const algorithm = sig["algorithm"];
  const keyId = sig["keyId"];
  const signature = sig["signature"];

  // A real, verifiable Ed25519 signature needs an algorithm naming Ed25519, a keyId, and a base64
  // signature. A HYBRID v2 manifest (algorithm "Ed25519+ML-DSA-65", signature "<ed>|<mldsa>") is written
  // by the REAL hybrid signer (logicn.mjs:2125-2210) — NOT a placeholder (the old comment was stale). It
  // carries a genuine both-half signature this loader CANNOT verify without an injected hybrid (ML-DSA)
  // verifier + the ProofGraph envelope the signer used — both compiler code the app-kernel must not import
  // (no-core-compiler-coupling invariant). H3/H4 (TODO #36, tracked): the full fix INJECTS that verifier so
  // a hybrid manifest is verified at load. Until then a hybrid sig is treated as UNVERIFIED-HERE → "unsigned":
  // under requireSignature it is REFUSED (fail-closed — the secure production outcome; this is NOT a live
  // admission bypass), and under allowUnsigned it is admitted like any unsigned package (dev permissiveness).
  // The one improvement now: never do this SILENTLY — WARN loudly so a present-but-unverified hybrid
  // signature is visible in the trail, never ignored without a trace.
  const isRealEd25519 =
    typeof algorithm === "string" &&
    algorithm.toLowerCase() === "ed25519" &&
    typeof keyId === "string" &&
    typeof signature === "string";
  if (!isRealEd25519) {
    const algoStr = typeof algorithm === "string" ? algorithm.toLowerCase() : "";
    const sigStr = typeof signature === "string" ? signature : "";
    const sigAlgo = typeof sig["sigAlgorithm"] === "string" ? (sig["sigAlgorithm"] as string).toLowerCase() : "";
    const looksHybrid = algoStr.includes("ml-dsa") || algoStr.includes("mldsa") || sigStr.includes("|") || sigAlgo.includes("v2");
    if (looksHybrid) {
      // H3/H4 (#49): if the host injected a hybrid verifier, USE it — verify both halves over the exact
      // canonical bytes the signer covered (the same RFC-8785 body the Ed25519 path reconstructs). Fail-closed:
      // a present-but-INVALID hybrid signature THROWS (tamper), an UNVERIFIABLE one falls through to unsigned.
      if (hybridVerifier !== undefined && typeof keyId === "string" && typeof signature === "string") {
        const { governanceSignature: _omit, ...withoutSig } = manifestObj;
        const signingInput = utf8(manifestSigningInput(withoutSig, sig));
        let verdict: HybridManifestVerdict;
        try {
          verdict = await hybridVerifier({ keyId, algorithm: String(algorithm), signingInput, signature, governanceDir, packageDir });
        } catch (e) {
          return fuseError("LLN-FUSE-HYBRID-ERROR", `injected hybrid verifier errored for keyId '${keyId}': ${(e as Error).message}`);
        }
        if (verdict === "verified") return "verified";
        if (verdict === "invalid") {
          return fuseError("LLN-FUSE-HYBRID-INVALID", `HYBRID manifest signature FAILED to verify (keyId '${keyId}') — manifest may be tampered`);
        }
        // "unverifiable" → fall through to the warn + "unsigned" path below (no key / undecidable).
      }
      warn(hybridVerifier !== undefined
        ? `LLN-FUSE-HYBRID-UNVERIFIED: the injected verifier could not decide the HYBRID PQ signature (algorithm '${String(algorithm)}', keyId '${String(keyId)}') — e.g. no resolvable public key — treating as UNVERIFIED (REFUSED under requireSignature; admitted only where unsigned packages are already permitted).`
        : `LLN-FUSE-HYBRID-UNVERIFIED: manifest carries a HYBRID PQ signature (algorithm '${String(algorithm)}') that this loader cannot verify without an injected hybrid verifier — treating as UNVERIFIED (REFUSED under requireSignature; admitted only where unsigned packages are already permitted). Inject FusePackageOptions.hybridVerifier to verify it at load (#49).`);
    }
    return "unsigned";
  }

  const pubKeyPath = resolvePublicKey(fs, path, keyId as string, governanceDir, packageDir);
  if (pubKeyPath === undefined) {
    warn(`LLN-FUSE-NO-PUBKEY: public key for keyId '${keyId}' not found — cannot verify signature; treating manifest as unsigned`);
    return "unsigned";
  }

  // Reconstruct EXACTLY what `logicn build` signed: the manifest without its signature field, in the
  // canonicalization the signature names (`canon`: RFC 8785 JCS for new builds, pretty-JSON "legacy" for
  // older untagged signatures). Routed through the shared local helper so it can't drift from the signer.
  const { governanceSignature: _omit, ...withoutSig } = manifestObj;
  const bytesForVerification = utf8(manifestSigningInput(withoutSig, sig));

  let valid = false;
  try {
    const publicKey = crypto.createPublicKey(fs.readFileSync(pubKeyPath, "utf8"));
    // Ed25519 is deterministic — pass null as the hash algorithm (RFC 8032).
    valid = crypto.verify(null, bytesForVerification, publicKey, base64ToBytes(signature as string));
  } catch (e) {
    return fuseError("LLN-FUSE-SIG-ERROR", `signature verification errored for keyId '${keyId}': ${(e as Error).message}`);
  }
  if (!valid) {
    return fuseError("LLN-FUSE-SIG-INVALID", `manifest signature FAILED to verify (keyId '${keyId}') — manifest may be tampered`);
  }
  return "verified";
}

/** Find `signing-key-<keyId>.pub.pem` in the given governance dir, or walking up from the package. */
function resolvePublicKey(
  fs: NodeFs,
  path: NodePath,
  keyId: string,
  governanceDir: string | undefined,
  packageDir: string,
): string | undefined {
  const fileName = `signing-key-${keyId}.pub.pem`;
  const candidates: string[] = [];
  if (governanceDir !== undefined) candidates.push(path.join(governanceDir, fileName));
  // Walk up a few levels looking for a `governance` directory beside the project root.
  let dir = packageDir;
  for (let i = 0; i < 6; i++) {
    candidates.push(path.join(dir, "governance", fileName));
    const parent = path.join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

/** True if a `governance` dir with at least one `signing-key-*.pub.pem` is discoverable. */
function governanceKeysPresent(
  fs: NodeFs,
  path: NodePath,
  governanceDir: string | undefined,
  packageDir: string,
): boolean {
  const dirs: string[] = [];
  if (governanceDir !== undefined) dirs.push(governanceDir);
  let dir = packageDir;
  for (let i = 0; i < 6; i++) {
    dirs.push(path.join(dir, "governance"));
    const parent = path.join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  for (const d of dirs) {
    try {
      if (fs.existsSync(d) && fs.readdirSync(d).some((f) => /^signing-key-.*\.pub\.pem$/.test(f))) return true;
    } catch {
      // unreadable dir — keep looking
    }
  }
  return false;
}

/**
 * Build the CLOSED, capability-bounded host import object. Deny-by-default: only the
 * capabilities in `capabilities` contribute a namespace; everything else is absent.
 * Returns the import object AND the set of namespaces granted (for inspection/tests).
 */
export function buildCapabilityImports(
  capabilities: readonly string[],
  registry: Readonly<Record<string, CapabilityImportFactory>>,
): { readonly imports: WebAssembly.Imports; readonly grantedNamespaces: readonly string[] } {
  const imports: Record<string, Record<string, (...a: number[]) => number | void>> = {};
  const grantedNamespaces: string[] = [];
  for (const cap of capabilities) {
    const factory = registry[cap];
    if (factory === undefined) {
      return fuseError(
        "LLN-FUSE-UNKNOWN-CAP",
        `package declares capability '${cap}' with no host-import factory — refusing to fuse (deny-by-default)`,
      );
    }
    const group = factory();
    // A capability never silently shares another's namespace.
    imports[group.namespace] = { ...(imports[group.namespace] ?? {}), ...group.functions };
    grantedNamespaces.push(group.namespace);
  }
  return { imports: imports as unknown as WebAssembly.Imports, grantedNamespaces };
}

/** A package after Gates 1+2 (hash + signature) but BEFORE instantiation (Gate 3). */
interface AdmittedPackage {
  readonly name: string;
  readonly descriptor: FuseDescriptor;
  readonly wasmBytes: Uint8Array;
  readonly signature: "verified" | "unsigned";
  /** The signing keyId from the manifest's governanceSignature, if present (for the import closure). */
  readonly keyId?: string;
}

/**
 * Run Gates 1 (hash) + 2 (signature) for one package directory and return its verified
 * descriptor + bytes WITHOUT instantiating. Shared by {@link fusePackage} (single) and
 * {@link fusePackages} (multi-module). Fail-closed on hash mismatch / sidecar drift; the
 * unsigned POLICY decision (refuse vs allowUnsigned) is left to the caller — a multi-module
 * compose enforces the set-level invariant, a single fuse enforces it per package.
 */
async function loadAndVerifyPackage(
  node: { crypto: NodeCrypto; fs: NodeFs; path: NodePath },
  dir: string,
  opts: FusePackageOptions,
  warn: (m: string) => void,
): Promise<AdmittedPackage> {
  const { crypto, fs, path } = node;
  const pkgDescPath = path.join(dir, "package.lln.json");
  const pkgDesc = readJson(fs, pkgDescPath, "LLN-FUSE-NO-PACKAGE") as Record<string, unknown>;
  const name = typeof pkgDesc["name"] === "string" ? (pkgDesc["name"] as string) : path.basename(dir);

  const distDir = path.join(dir, "dist");
  const manifestJsonPath = path.join(distDir, `${name}.lmanifest.json`);
  const wasmPath = path.join(distDir, `${name}.wasm`);

  const manifestObj = readJson(fs, manifestJsonPath, "LLN-FUSE-NO-MANIFEST") as Record<string, unknown>;
  const descriptor = extractFuse(manifestObj, manifestJsonPath);

  // ── Gate 1: .wasm sha256 MUST match the (signed) descriptor — fail-closed ────
  let wasmBytes: Uint8Array;
  try {
    wasmBytes = new Uint8Array(fs.readFileSync(wasmPath));
  } catch {
    return fuseError("LLN-FUSE-NO-WASM", `missing .wasm artifact: ${wasmPath}`);
  }
  const actualSha = "sha256:" + crypto.createHash("sha256").update(wasmBytes).digest("hex");
  if (actualSha !== descriptor.wasmSha256) {
    return fuseError(
      "LLN-FUSE-HASH-MISMATCH",
      `.wasm sha256 ${actualSha} does not match signed descriptor ${descriptor.wasmSha256} — refusing to fuse (tamper)`,
    );
  }

  // ── Cross-check the convenience .fuse.json against the signed descriptor ─────
  const fuseJsonPath = path.join(distDir, `${name}.fuse.json`);
  if (fs.existsSync(fuseJsonPath)) {
    const sidecar = readJson(fs, fuseJsonPath, "LLN-FUSE-BAD-SIDECAR") as Record<string, unknown>;
    if (typeof sidecar["wasmSha256"] === "string" && sidecar["wasmSha256"] !== descriptor.wasmSha256) {
      return fuseError(
        "LLN-FUSE-SIDECAR-DRIFT",
        `${name}.fuse.json wasmSha256 disagrees with the SIGNED manifest — refusing to fuse`,
      );
    }
  }

  // ── Gate 2: signature state (caller decides the unsigned policy) ─────────────
  const signature = await verifyManifestSignature(node, manifestObj, opts.governanceDir, dir, warn, opts.hybridVerifier);
  const sigField = manifestObj["governanceSignature"];
  const keyId =
    sigField !== null && typeof sigField === "object" && typeof (sigField as Record<string, unknown>)["keyId"] === "string"
      ? ((sigField as Record<string, unknown>)["keyId"] as string)
      : undefined;

  // ── Gate 2b: REVOCATION — a validly-signed but REVOKED key must NOT be admitted (fail-closed) ──
  // verifyManifestSignature only proves the signature is cryptographically valid against a discoverable
  // public key; the revoked key's public key is shipped in-repo, so a forgery signed with the leaked
  // private key would otherwise pass. Consult the host-injected registry-backed check and refuse a
  // revoked key. A throwing check (e.g. an untrustworthy/tampered revocation registry) is fail-closed.
  if (signature === "verified" && keyId !== undefined && opts.revocationCheck !== undefined) {
    let revoked: boolean;
    try {
      revoked = opts.revocationCheck(keyId) === true;
    } catch (e) {
      return fuseError("LLN-FUSE-REVOCATION-UNVERIFIABLE", `revocation status for keyId '${keyId}' could not be determined (${(e as Error).message}) — refusing to fuse (fail-closed)`);
    }
    if (revoked) {
      return fuseError("LLN-FUSE-KEY-REVOKED", `keyId '${keyId}' is REVOKED — refusing to fuse (the signature is cryptographically valid but the signing key is revoked)`);
    }
  }

  return { name, descriptor, wasmBytes, signature, ...(keyId !== undefined ? { keyId } : {}) };
}

/** Gate 3: instantiate `wasmBytes` with the closed capability import object and wrap it. */
async function instantiateComponent(
  admitted: AdmittedPackage,
  imports: WebAssembly.Imports,
): Promise<FusedComponent> {
  const result: unknown = await WebAssembly.instantiate(admitted.wasmBytes as BufferSource, imports);
  const instance =
    (result as { instance?: WebAssembly.Instance }).instance ?? (result as WebAssembly.Instance);
  const exportsObj = instance.exports as Record<string, unknown>;
  const name = admitted.name;
  return {
    name,
    seam: admitted.descriptor.seam,
    capabilities: admitted.descriptor.capabilities,
    invoke(exportName: string, ...args: number[]): number {
      const fn = exportsObj[exportName];
      if (typeof fn !== "function") {
        return fuseError("LLN-FUSE-NO-EXPORT", `fused component '${name}' has no exported function '${exportName}'`);
      }
      const ret = (fn as (...a: number[]) => number | void)(...args);
      return typeof ret === "number" ? ret : 0;
    },
  };
}

/**
 * Fuse a built LogicN package directory into a host-callable component.
 *
 * Expects `<dir>` to contain (from `logicn build --package`):
 *   <name>.wasm, <name>.lmanifest.json (signed, with embedded `fuse` block),
 *   and optionally <name>.fuse.json (convenience copy).
 *
 * Fail-closed on: hash mismatch, invalid signature, unknown/undeclarable capability.
 */
export async function fusePackage(dir: string, opts: FusePackageOptions = {}): Promise<FusedComponent> {
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const node = await loadNode();
  const { fs, path } = node;
  const registry: Record<string, CapabilityImportFactory> = {
    ...BUILTIN_CAPABILITY_REGISTRY,
    ...(opts.capabilityRegistry ?? {}),
  };

  const admitted = await loadAndVerifyPackage(node, dir, opts, warn);

  // ── Gate 2 policy (single package): fail-closed unless allowUnsigned ──────────
  // Posture-derived import profile (R&D 0051): requireSignature overrides allowUnsigned (fail-secure).
  const allowUnsigned = opts.allowUnsigned === true && opts.requireSignature !== true;
  if (admitted.signature === "unsigned") {
    if (!allowUnsigned) {
      if (opts.requireSignature === true) {
        return fuseError(
          "LLN-FUSE-UNSIGNED",
          `manifest for '${admitted.name}' is unsigned but the security posture requires a signature — refusing (posture-derived import profile)`,
        );
      }
      const keysExist = governanceKeysPresent(fs, path, opts.governanceDir, dir);
      return fuseError(
        "LLN-FUSE-UNSIGNED",
        keysExist
          ? `manifest is unsigned but governance signing keys exist — refusing to fuse (pass allowUnsigned to override)`
          : `manifest is unsigned — refusing to fuse (pass allowUnsigned to override)`,
      );
    }
    warn(`LLN-FUSE-UNSIGNED-ALLOWED: fusing '${admitted.name}' from an UNSIGNED manifest because allowUnsigned was set`);
  }

  // ── Gate 2c (B5a): CENTRAL signed-registry admission — fail-closed ───────────
  // A package may be validly self-signed yet not be the certified, listed artifact. When a registry
  // gate is injected, the package must ALSO pass it (verified index + pinned-hash match + policy).
  if (opts.registryCheck !== undefined) {
    const verdict = opts.registryCheck({
      name: admitted.name,
      version: admitted.descriptor.version,
      sourceHash: admitted.descriptor.wasmSha256,
      keyId: admitted.keyId,
    });
    if (!verdict.ok) {
      return fuseError(
        verdict.code ?? "LLN-FUSE-REGISTRY-DENIED",
        `central registry refused '${admitted.name}@${admitted.descriptor.version}': ${verdict.reason ?? "not admissible"}`,
      );
    }
  }

  // ── Gate 3: instantiate with ONLY capability-permitted host imports ──────────
  const { imports } = buildCapabilityImports(admitted.descriptor.capabilities, registry);
  return instantiateComponent(admitted, imports);
}

// ═════════════════════════════════════════════════════════════════════════════
// Multi-module composition — R&D 0052 Phase A (interim host-linker, FIRST-PARTY ONLY)
//
// Packages can live OUTSIDE the app as separate signed .wasm modules and be composed
// at admission: a package that `provides` a capability backs another package's DECLARED
// capability, routed through the existing CapabilityImportFactory hook. Module→module
// routing is itself deny-by-default — a declared capability with neither a host shim nor
// a peer provider is refused.
//
// SECURITY MODEL (Phase A): capability SHAPES (namespace + function names) are host-defined
// (the built-in registry + opts.capabilityRegistry) — a closed import surface. A provider
// can only RE-BACK a capability whose shape is registered; it cannot invent new import
// surface. Per-module signed admission holds (each module runs Gates 1+2); the SET-LEVEL
// invariant: a multi-module admission is "signed" iff EVERY module verified — one unsigned
// member refuses the WHOLE set. Phase A shares process memory between co-resident modules,
// so it is valid for TRUSTED / FIRST-PARTY packages only; the memory-isolated upgrade is
// Phase B (Wasmtime Component Model, #102–104).
// ═════════════════════════════════════════════════════════════════════════════

/** One package's admission-relevant facts, for pure composition planning. */
export interface CompositionMember {
  readonly name: string;
  /** The capability this package PROVIDES to peers (FuseDescriptor.provides), or null. */
  readonly provides: string | null;
  /** The capabilities this package DECLARES / consumes (FuseDescriptor.capabilities). */
  readonly capabilities: readonly string[];
  /** Gate-2 outcome for this package's manifest. */
  readonly signature: "verified" | "unsigned";
}

/** How a consumer's declared capability is satisfied. */
export type CapabilitySource =
  | { readonly kind: "builtin" }
  | { readonly kind: "provider"; readonly provider: string };

export interface CompositionPlan {
  /** Instantiation order: every provider appears BEFORE the consumers that import it. */
  readonly order: readonly string[];
  /** Per package name → (declared capability → who satisfies it). */
  readonly resolution: ReadonlyMap<string, ReadonlyMap<string, CapabilitySource>>;
}

/**
 * Plan a multi-module composition, fail-closed. PURE — no I/O, no instantiation.
 *
 * Invariants (all fail-closed):
 *  - SET-SIGNED — every member must be "verified" unless `allowUnsigned`; one unsigned member
 *    refuses the whole set (LLN-FUSE-SET-UNSIGNED).
 *  - PROVIDER SHAPE — a `provides` capability must have a registered host-import shape, else the
 *    host cannot wire its import surface (LLN-FUSE-PROVIDES-UNKNOWN).
 *  - UNAMBIGUOUS — two members providing the same capability is refused (LLN-FUSE-SET-AMBIGUOUS).
 *  - DENY-BY-DEFAULT — each declared capability resolves to a peer provider (preferred) or a
 *    built-in host shim; anything unsatisfied refuses the set (LLN-FUSE-UNKNOWN-CAP). A package
 *    that both provides and declares the same capability is refused (LLN-FUSE-SET-SELF).
 *  - ACYCLIC — consumer→provider edges must form a DAG (LLN-FUSE-SET-CYCLE).
 *
 * @param knownCapabilities capabilities with a registered host-import shape (builtins + overrides).
 */
export function planComposition(
  members: readonly CompositionMember[],
  knownCapabilities: ReadonlySet<string>,
  opts: { readonly allowUnsigned?: boolean } = {},
): CompositionPlan {
  // 0 — SET-SIGNED invariant.
  if (opts.allowUnsigned !== true) {
    const unsigned = members.filter((m) => m.signature !== "verified").map((m) => m.name);
    if (unsigned.length > 0) {
      fuseError(
        "LLN-FUSE-SET-UNSIGNED",
        `refusing to compose: unsigned member(s) [${unsigned.join(", ")}] — a multi-module admission is signed only if EVERY module verified (pass allowUnsigned to override)`,
      );
    }
  }

  // 1 — provider map. A `provides` value is a cross-module link ONLY when a peer actually
  // CONSUMES it (declares it as a capability). An unconsumed `provides` is inert seam/protocol
  // metadata (e.g. "rest") — ignored here, not required to have a host-import shape.
  const consumed = new Set<string>();
  for (const m of members) for (const cap of m.capabilities) consumed.add(cap);
  const rawProviders = new Map<string, string[]>();
  for (const m of members) {
    if (m.provides === null) continue;
    const list = rawProviders.get(m.provides);
    if (list === undefined) rawProviders.set(m.provides, [m.name]);
    else list.push(m.name);
  }
  const providerOf = new Map<string, string>();
  for (const [cap, provs] of rawProviders) {
    if (!consumed.has(cap)) continue; // inert seam — no peer imports it
    // A provided+consumed capability must have a registered host-import SHAPE to be wireable.
    if (!knownCapabilities.has(cap)) {
      fuseError(
        "LLN-FUSE-PROVIDES-UNKNOWN",
        `capability '${cap}' is provided by [${provs.join(", ")}] and consumed by a peer, but has no registered host-import shape — cannot wire an unknown import surface`,
      );
    }
    if (provs.length > 1) {
      fuseError(
        "LLN-FUSE-SET-AMBIGUOUS",
        `capability '${cap}' is provided by multiple packages [${provs.join(", ")}] — refusing (ambiguous provider)`,
      );
    }
    providerOf.set(cap, provs[0] as string);
  }

  // 2 — resolve each declared capability, deny-by-default; collect consumer→provider edges.
  const resolution = new Map<string, Map<string, CapabilitySource>>();
  const dependsOn = new Map<string, Set<string>>(); // consumer → providers it imports
  for (const m of members) {
    const capMap = new Map<string, CapabilitySource>();
    const deps = new Set<string>();
    for (const cap of m.capabilities) {
      const provider = providerOf.get(cap);
      if (provider === m.name) {
        fuseError(
          "LLN-FUSE-SET-SELF",
          `package '${m.name}' both provides and declares '${cap}' — refusing (self-provision)`,
        );
      } else if (provider !== undefined) {
        capMap.set(cap, { kind: "provider", provider });
        deps.add(provider);
      } else if (knownCapabilities.has(cap)) {
        capMap.set(cap, { kind: "builtin" });
      } else {
        fuseError(
          "LLN-FUSE-UNKNOWN-CAP",
          `package '${m.name}' declares capability '${cap}' satisfied by neither a host shim nor a peer provider — refusing (deny-by-default)`,
        );
      }
    }
    resolution.set(m.name, capMap);
    dependsOn.set(m.name, deps);
  }

  // 3 — topological order (Kahn): providers before consumers; any cycle is refused.
  const order = topoOrder(members.map((m) => m.name), dependsOn);
  return { order, resolution };
}

/** Kahn topological sort over consumer→provider deps; providers emitted first. Cycle → throw. */
function topoOrder(names: readonly string[], dependsOn: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  const indeg = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // provider → consumers depending on it
  for (const n of names) {
    indeg.set(n, dependsOn.get(n)?.size ?? 0);
    dependents.set(n, []);
  }
  for (const n of names) {
    for (const dep of dependsOn.get(n) ?? []) {
      (dependents.get(dep) ?? (dependents.set(dep, []), dependents.get(dep)!)).push(n);
    }
  }
  const ready = names.filter((n) => (indeg.get(n) ?? 0) === 0);
  const out: string[] = [];
  while (ready.length > 0) {
    const n = ready.shift() as string;
    out.push(n);
    for (const consumer of dependents.get(n) ?? []) {
      const d = (indeg.get(consumer) ?? 0) - 1;
      indeg.set(consumer, d);
      if (d === 0) ready.push(consumer);
    }
  }
  if (out.length !== names.length) {
    const stuck = names.filter((n) => !out.includes(n));
    return fuseError(
      "LLN-FUSE-SET-CYCLE",
      `multi-module composition has a provider cycle among [${stuck.join(", ")}] — refusing`,
    );
  }
  return out;
}

/**
 * A CapabilityImportFactory that RE-BACKS capability `cap` with a peer module: it mirrors the
 * registered host-import SHAPE (namespace + function names) but routes every function to the
 * provider's `invoke`. The closed shape is the ABI contract — the provider must export a
 * function named like each host-import function of `cap`.
 */
export function makeProviderFactory(
  cap: string,
  registry: Readonly<Record<string, CapabilityImportFactory>>,
  getProvider: () => FusedComponent,
): CapabilityImportFactory {
  const shapeFactory = registry[cap];
  if (shapeFactory === undefined) {
    // Unreachable when called via planComposition (a provider cap is always known-shape),
    // but fail-closed if used directly.
    return fuseError("LLN-FUSE-PROVIDES-UNKNOWN", `cannot back capability '${cap}': no registered host-import shape`);
  }
  const shape = shapeFactory();
  return () => {
    const routed: Record<string, (...a: number[]) => number | void> = {};
    for (const fname of Object.keys(shape.functions)) {
      routed[fname] = (...a: number[]): number | void => getProvider().invoke(fname, ...a);
    }
    return { namespace: shape.namespace, functions: routed };
  };
}

/**
 * Compose MULTIPLE built LogicN packages into a host-linked set — R&D 0052 Phase A.
 *
 * Each package is admitted through the same fail-closed gates as {@link fusePackage} (hash +
 * signature), then the set is planned ({@link planComposition}: set-signed, deny-by-default,
 * unambiguous, acyclic) and instantiated in provider-before-consumer order, wiring each
 * provider-backed capability through {@link makeProviderFactory}.
 *
 * FIRST-PARTY / TRUSTED packages only (shared process memory; isolation is Phase B). Returns a
 * Map keyed by package name. Fail-closed throughout (LLN-FUSE-* codes).
 */
export async function fusePackages(
  dirs: readonly string[],
  opts: FusePackageOptions = {},
): Promise<Map<string, FusedComponent>> {
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const node = await loadNode();
  const registry: Record<string, CapabilityImportFactory> = {
    ...BUILTIN_CAPABILITY_REGISTRY,
    ...(opts.capabilityRegistry ?? {}),
  };
  const known = new Set(Object.keys(registry));

  // 1 — load + verify EVERY package (Gates 1+2), no instantiation yet.
  const admitted: AdmittedPackage[] = [];
  for (const dir of dirs) admitted.push(await loadAndVerifyPackage(node, dir, opts, warn));

  // Refuse a duplicate package name in the set (names key the plan + provider routing).
  const seen = new Set<string>();
  for (const a of admitted) {
    if (seen.has(a.name)) fuseError("LLN-FUSE-SET-DUPLICATE", `package '${a.name}' appears twice in the composition set — refusing`);
    seen.add(a.name);
  }

  // Gate 2c (B5a) for the SET: every member must ALSO pass the central registry. One unlisted/forked
  // member refuses the WHOLE composition (set-level fail-closed) — the multi-module path must not be a
  // bypass of the single-module allow-list.
  if (opts.registryCheck !== undefined) {
    for (const a of admitted) {
      const verdict = opts.registryCheck({
        name: a.name, version: a.descriptor.version, sourceHash: a.descriptor.wasmSha256, keyId: a.keyId,
      });
      if (!verdict.ok) {
        return fuseError(
          verdict.code ?? "LLN-FUSE-REGISTRY-DENIED",
          `central registry refused composition member '${a.name}@${a.descriptor.version}': ${verdict.reason ?? "not admissible"} — refusing the whole set`,
        );
      }
    }
  }

  // 2 — plan (set-signed invariant + deny-by-default routing + acyclic).
  const members: CompositionMember[] = admitted.map((a) => ({
    name: a.name,
    provides: a.descriptor.provides,
    capabilities: a.descriptor.capabilities,
    signature: a.signature,
  }));
  // Posture-derived import profile (R&D 0051): requireSignature overrides allowUnsigned (fail-secure).
  const allowUnsigned = opts.allowUnsigned === true && opts.requireSignature !== true;
  const plan = planComposition(members, known, { allowUnsigned });
  if (allowUnsigned) {
    for (const a of admitted) {
      if (a.signature === "unsigned") warn(`LLN-FUSE-UNSIGNED-ALLOWED: composing '${a.name}' from an UNSIGNED manifest because allowUnsigned was set`);
    }
  }

  // 3 — instantiate in provider-before-consumer order, wiring peer-backed capabilities.
  const byName = new Map(admitted.map((a) => [a.name, a]));
  const components = new Map<string, FusedComponent>();
  for (const name of plan.order) {
    const a = byName.get(name) as AdmittedPackage;
    const capMap = plan.resolution.get(name) as ReadonlyMap<string, CapabilitySource>;
    const consumerRegistry: Record<string, CapabilityImportFactory> = { ...registry };
    for (const [cap, src] of capMap) {
      if (src.kind === "provider") {
        // The provider was instantiated earlier (topo order guarantees it).
        consumerRegistry[cap] = makeProviderFactory(cap, registry, () => components.get(src.provider) as FusedComponent);
      }
    }
    const { imports } = buildCapabilityImports(a.descriptor.capabilities, consumerRegistry);
    components.set(name, await instantiateComponent(a, imports));
  }
  return components;
}

/** One module in the import closure report. */
export interface ImportClosureModule {
  readonly name: string;
  /** `sha256:<hex>` of the module's .wasm, as bound by the (signed) descriptor. */
  readonly wasmSha256: string;
  /** The signing keyId, or null when unsigned. */
  readonly keyId: string | null;
  readonly signature: "verified" | "unsigned";
}

/**
 * An UNTRUSTED import-closure report (R&D 0051) — NOT a lockfile. The trust already lives in each
 * signed manifest (the signature binds `wasmSha256` before signing); this is an informational
 * inventory of what was admitted (keyId + wasmSha256 per module). `trusted` is ALWAYS false.
 */
export interface ImportClosure {
  readonly schemaVersion: "lln.import-closure.v1";
  readonly trusted: false;
  readonly modules: readonly ImportClosureModule[];
}

/**
 * Build the import-closure report over a set of package dirs. Each is run through Gates 1+2
 * (hash + signature) — a tampered module throws (LLN-FUSE-HASH-MISMATCH), so the report only ever
 * describes modules whose bytes match their descriptor. This is a REPORT, not an admission decision.
 */
export async function buildImportClosure(
  dirs: readonly string[],
  opts: FusePackageOptions = {},
): Promise<ImportClosure> {
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const node = await loadNode();
  const modules: ImportClosureModule[] = [];
  for (const dir of dirs) {
    const a = await loadAndVerifyPackage(node, dir, opts, warn);
    modules.push({
      name: a.name,
      wasmSha256: a.descriptor.wasmSha256,
      keyId: a.keyId ?? null,
      signature: a.signature,
    });
  }
  return { schemaVersion: "lln.import-closure.v1", trusted: false, modules };
}

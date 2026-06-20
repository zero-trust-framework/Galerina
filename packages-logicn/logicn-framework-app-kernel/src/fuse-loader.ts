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
}

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
function verifyManifestSignature(
  node: { crypto: NodeCrypto; fs: NodeFs; path: NodePath },
  manifestObj: Record<string, unknown>,
  governanceDir: string | undefined,
  packageDir: string,
  warn: (m: string) => void,
): "verified" | "unsigned" {
  const { crypto, fs, path } = node;
  const sigField = manifestObj["governanceSignature"];
  if (sigField === undefined || sigField === null || typeof sigField !== "object") {
    return "unsigned";
  }
  const sig = sigField as Record<string, unknown>;
  const algorithm = sig["algorithm"];
  const keyId = sig["keyId"];
  const signature = sig["signature"];

  // A real, verifiable Ed25519 signature needs an algorithm naming Ed25519, a keyId,
  // and a base64 signature. Anything else (e.g. the "Ed25519+ML-DSA-65" placeholder
  // with ed25519/mlDsa65 'placeholder:…' fields) is treated as unsigned.
  const isRealEd25519 =
    typeof algorithm === "string" &&
    algorithm.toLowerCase() === "ed25519" &&
    typeof keyId === "string" &&
    typeof signature === "string";
  if (!isRealEd25519) {
    return "unsigned";
  }

  const pubKeyPath = resolvePublicKey(fs, path, keyId as string, governanceDir, packageDir);
  if (pubKeyPath === undefined) {
    warn(`LLN-FUSE-NO-PUBKEY: public key for keyId '${keyId}' not found — cannot verify signature; treating manifest as unsigned`);
    return "unsigned";
  }

  // Reconstruct EXACTLY what `logicn build` signed: the JSON without the signature field.
  const { governanceSignature: _omit, ...withoutSig } = manifestObj;
  const bytesForVerification = utf8(JSON.stringify(withoutSig, null, 2));

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
  const signature = verifyManifestSignature(node, manifestObj, opts.governanceDir, dir, warn);
  return { name, descriptor, wasmBytes, signature };
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

  // ── Gate 2 policy (single package): fail-closed unless allowUnsigned ─────────
  if (admitted.signature === "unsigned") {
    if (opts.allowUnsigned !== true) {
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

  // 2 — plan (set-signed invariant + deny-by-default routing + acyclic).
  const members: CompositionMember[] = admitted.map((a) => ({
    name: a.name,
    provides: a.descriptor.provides,
    capabilities: a.descriptor.capabilities,
    signature: a.signature,
  }));
  const plan = planComposition(members, known, { allowUnsigned: opts.allowUnsigned === true });
  if (opts.allowUnsigned === true) {
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

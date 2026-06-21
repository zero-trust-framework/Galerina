// =============================================================================
// LogicN Phase 17A — Package Manifest Resolver
//
// Resolves package.logicn.yaml manifest files from package directories.
// This allows user packages to declare their exported types, flows, events,
// effects, and capability requirements in a structured manifest format.
//
// No external YAML dependencies — uses a simple line-by-line parser
// that handles the subset of YAML used in package.logicn.yaml files.
// =============================================================================

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PackageTargets {
  readonly cpu?: string;
  readonly wasm?: string;
  readonly npu?: string;
  readonly gpu?: string;
  readonly apu?: string;
  readonly photonic?: string;
}

export interface PackageCompute {
  readonly tensor_shapes?: readonly string[];
  readonly supports?: readonly string[];
  readonly photonic_compatible?: boolean;
}

export interface PackageManifest {
  readonly name: string;
  readonly version: string;
  readonly exports: {
    readonly types?: readonly string[];
    readonly flows?: readonly string[];
    readonly events?: readonly string[];
  };
  readonly effects?: readonly string[];
  readonly capabilities?: readonly string[];
  /** SHA-256 content-addressable hash — identity is content, not name+version. */
  readonly hash?: string;
  /** Ed25519 or similar package signature — proves origin, prevents tampering. */
  readonly signature?: string;
  /** The keyId of the signing key — paired with a revocation predicate so a package
   *  signed by a REVOKED key is refused at resolution time (LLN-PKG-006). */
  readonly signerKeyId?: string;
  /** Source registry URL — auditable origin for every resolved package. */
  readonly registry?: string;
  /**
   * Install script policy — defaults to "deny".
   * Packages MUST NOT run code during installation unless the project's
   * resolver policy explicitly allows signed install scripts.
   */
  readonly installScript?: "deny" | "allow";
  /** Target variants — resolver selects based on project policy and availability. */
  readonly targets?: PackageTargets;
  /**
   * Compute compatibility metadata.
   * Passed through to SemanticGraph and ExecutionPlanner — resolver does not
   * plan hardware placement.
   */
  readonly compute?: PackageCompute;
}

// ---------------------------------------------------------------------------
// Package resolver diagnostic types
// ---------------------------------------------------------------------------

export interface PackageResolverDiagnostic {
  readonly code: string;
  readonly name: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly packageName?: string;
  readonly suggestedFix?: string;
}

// ---------------------------------------------------------------------------
// Capability expansion check
//
// Detects when a new package version declares more capabilities than the
// lockfile snapshot — a breaking security change that must be reviewed.
// Fires LLN-PKG-001.
// ---------------------------------------------------------------------------

export interface CapabilityExpansionResult {
  readonly expanded: boolean;
  readonly addedCapabilities: readonly string[];
  readonly diagnostics: readonly PackageResolverDiagnostic[];
}

/**
 * Compares a resolved manifest against the lockfile snapshot.
 * Returns LLN-PKG-001 if the new manifest declares capabilities
 * not present in the lockfile.
 */
export function checkPackageCapabilityExpansion(
  resolved: PackageManifest,
  lockfileCapabilities: readonly string[],
): CapabilityExpansionResult {
  const lockfileSet = new Set(lockfileCapabilities);
  const added = (resolved.capabilities ?? []).filter((c) => !lockfileSet.has(c));

  if (added.length === 0) {
    return { expanded: false, addedCapabilities: [], diagnostics: [] };
  }

  return {
    expanded: true,
    addedCapabilities: added,
    diagnostics: [{
      code: "LLN-PKG-001",
      name: "CapabilityExpanded",
      severity: "error",
      packageName: resolved.name,
      message: `Package '${resolved.name}@${resolved.version}' declares new capabilities not present in the lockfile: ${added.join(", ")}. This is a breaking security change — review and re-approve.`,
      suggestedFix: "Update the lockfile after explicitly reviewing the new capability declarations.",
    }],
  };
}

// ---------------------------------------------------------------------------
// Install script check
//
// All packages default to "deny" for install scripts.
// Fires LLN-PKG-004 if installScript is "allow" (or any non-deny value).
// ---------------------------------------------------------------------------

/**
 * Checks the install script policy for a package.
 * Default is deny — packages must not run code during installation.
 */
export function checkInstallScript(manifest: PackageManifest): readonly PackageResolverDiagnostic[] {
  if (manifest.installScript !== undefined && manifest.installScript !== "deny") {
    return [{
      code: "LLN-PKG-004",
      name: "InstallScriptDenied",
      severity: "error",
      packageName: manifest.name,
      message: `Package '${manifest.name}' attempts to declare an install script. LogicN denies install scripts by default. Only explicitly approved, signed packages may run install-time code.`,
      suggestedFix: "Remove the installScript declaration, or configure an explicit resolver policy with signature verification.",
    }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Package provenance check
//
// Warns when a package lacks a hash or signature.
// Fires LLN-PKG-003 (missing hash) and LLN-PKG-005 (missing signature).
// ---------------------------------------------------------------------------

/**
 * Checks that a package manifest has both a content hash and a signature.
 * Missing hash → LLN-PKG-003. Missing signature → LLN-PKG-005.
 */
/** Options for provenance checking — lets the host inject a revocation predicate. */
export interface ProvenanceCheckOptions {
  /**
   * Fail-closed signing-key revocation predicate (registry-backed). Returns true if a
   * keyId is revoked. The host injects this from `governance/revocation-registry.mjs`;
   * a throwing check (untrustworthy/tampered registry) is itself treated as revoked.
   */
  readonly isRevoked?: (keyId: string) => boolean;
}

export function checkPackageProvenance(
  manifest: PackageManifest,
  opts?: ProvenanceCheckOptions,
): readonly PackageResolverDiagnostic[] {
  const diags: PackageResolverDiagnostic[] = [];

  if (!manifest.hash || !manifest.hash.startsWith("sha256:")) {
    diags.push({
      code: "LLN-PKG-003",
      name: "MissingHash",
      severity: "warning",
      packageName: manifest.name,
      message: `Package '${manifest.name}@${manifest.version}' has no content-addressable hash. Without a hash, tamper detection and reproducible builds are not possible.`,
      suggestedFix: "Add 'hash: sha256:<hex>' to the package manifest. Run 'logicn package hash' to generate it.",
    });
  }

  if (!manifest.signature) {
    diags.push({
      code: "LLN-PKG-005",
      name: "MissingSignature",
      severity: "warning",
      packageName: manifest.name,
      message: `Package '${manifest.name}@${manifest.version}' has no signature. Origin cannot be cryptographically verified.`,
      suggestedFix: "Sign the package with 'logicn package sign' and add 'signature:' to the manifest.",
    });
  }

  // Revocation (defense-in-depth, mirrors the fuse admission gate): a package signed by a
  // REVOKED key is refused at RESOLUTION time — before it ever reaches admission. Fail-closed:
  // a throwing revocation check (untrustworthy/tampered registry) is treated as revoked.
  if (manifest.signerKeyId && opts?.isRevoked) {
    let revoked: boolean;
    try {
      revoked = opts.isRevoked(manifest.signerKeyId) === true;
    } catch {
      revoked = true; // fail-closed
    }
    if (revoked) {
      diags.push({
        code: "LLN-PKG-006",
        name: "RevokedSigner",
        severity: "error",
        packageName: manifest.name,
        message: `Package '${manifest.name}@${manifest.version}' is signed by REVOKED key '${manifest.signerKeyId}'. A revoked signing key cannot establish trusted origin.`,
        suggestedFix: "Re-sign the package with a current, non-revoked key and update 'signerKeyId:' in the manifest.",
      });
    }
  }

  return diags;
}

// ---------------------------------------------------------------------------
// Resolver report
//
// Generates structured output for AI tooling, CI, and audit.
// ---------------------------------------------------------------------------

export interface ResolverReport {
  readonly schemaVersion: "lln.resolver.report.v1";
  readonly generatedAt: string;
  readonly packages: readonly ResolvedPackageEntry[];
  readonly capabilities: readonly string[];
  readonly targets: readonly string[];
  readonly diagnostics: readonly PackageResolverDiagnostic[];
}

export interface ResolvedPackageEntry {
  readonly name: string;
  readonly version: string;
  readonly hash: string | undefined;
  readonly trusted: boolean;
  readonly effects: readonly string[];
  readonly capabilities: readonly string[];
  readonly targets: readonly string[];
  readonly photonic_compatible: boolean;
}

/**
 * Generates a resolver report from a list of resolved manifests.
 * Used by AI tooling, CI, and audit systems.
 *
 * The report is hardware-neutral: it lists target availability but does not
 * make hardware placement decisions. The SemanticGraph and ExecutionPlanner
 * decide which target to use for each flow.
 */
export function getResolverReport(
  manifests: readonly PackageManifest[],
  generatedAt: string,
  opts?: ProvenanceCheckOptions,
): ResolverReport {
  const allCapabilities = new Set<string>();
  const allTargets = new Set<string>();
  const allDiagnostics: PackageResolverDiagnostic[] = [];

  const packages: ResolvedPackageEntry[] = manifests.map((m) => {
    for (const cap of m.capabilities ?? []) allCapabilities.add(cap);

    const targets: string[] = [];
    if (m.targets) {
      for (const key of ["cpu", "wasm", "npu", "gpu", "apu", "photonic"] as const) {
        if (m.targets[key] !== undefined) {
          targets.push(key);
          allTargets.add(key);
        }
      }
    }
    if (targets.length === 0) {
      targets.push("cpu"); // default
      allTargets.add("cpu");
    }

    // Run provenance (incl. fail-closed revocation when a predicate is injected) and install script checks
    allDiagnostics.push(...checkPackageProvenance(m, opts));
    allDiagnostics.push(...checkInstallScript(m));

    return {
      name: m.name,
      version: m.version,
      hash: m.hash,
      trusted: !!m.hash && !!m.signature,
      effects: m.effects ?? [],
      capabilities: m.capabilities ?? [],
      targets,
      photonic_compatible: m.compute?.photonic_compatible ?? false,
    };
  });

  return {
    schemaVersion: "lln.resolver.report.v1",
    generatedAt,
    packages,
    capabilities: [...allCapabilities].sort(),
    targets: [...allTargets].sort(),
    diagnostics: allDiagnostics,
  };
}

// ---------------------------------------------------------------------------
// Minimal YAML parser
//
// Handles the strict subset used by package.logicn.yaml:
//
//   name: "@myorg/types"
//   version: "0.1.0"
//   exports:
//     types:
//       - UserId
//       - Email
//     flows:
//       - getUser
//     events:
//       - UserCreated
//   effects:
//     - db.read
//   capabilities:
//     - read.patients
//
// Rules:
//   - Top-level keys and one-level-deep section keys (exports, effects,
//     capabilities) are supported.
//   - String values are unquoted or quoted with " or '.
//   - List items start with "  - value" (indented dash).
//   - Lines starting with # are comments.
//   - Empty lines are ignored.
// ---------------------------------------------------------------------------

interface ParsedYaml {
  [key: string]: string | string[] | { [key: string]: string | string[] };
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function parseSimpleYaml(text: string): ParsedYaml {
  const result: ParsedYaml = {};
  const lines = text.split(/\r?\n/);

  // Tracks the current "context":
  //   - topKey: active top-level key (e.g. "exports", "effects")
  //   - subKey: active sub-key inside topKey (e.g. "types" inside "exports")
  //   - mode: "section" (topKey maps to an object), "top-list" (topKey maps to a list)
  //           "sub-list" (subKey inside topKey maps to a list)

  let topKey: string | null = null;
  let subKey: string | null = null;
  type Mode = "section" | "top-list" | "sub-list" | "scalar" | null;
  let mode: Mode = null;
  let pendingList: string[] = [];

  function flushPendingList(): void {
    if (mode === "top-list" && topKey !== null) {
      result[topKey] = pendingList.slice();
    } else if (mode === "sub-list" && topKey !== null && subKey !== null) {
      const section = result[topKey];
      if (typeof section === "object" && !Array.isArray(section)) {
        (section as Record<string, string | string[]>)[subKey] = pendingList.slice();
      }
    }
    pendingList = [];
  }

  function resetSubKey(): void {
    flushPendingList();
    subKey = null;
    mode = topKey !== null ? "section" : null;
  }

  function resetTopKey(newKey: string): void {
    flushPendingList();
    topKey = newKey;
    subKey = null;
    pendingList = [];
    mode = null;
  }

  for (const rawLine of lines) {
    // Skip blank lines and comments
    if (rawLine.trim() === "" || rawLine.trim().startsWith("#")) continue;

    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trimStart();

    // ── List item ──
    if (line.startsWith("- ") || line === "-") {
      const val = stripQuotes(line.startsWith("- ") ? line.slice(2).trim() : "");

      if (mode === "top-list" && topKey !== null) {
        // Continuing a top-level list (e.g. under "effects:")
        pendingList.push(val);
      } else if (mode === "sub-list" && subKey !== null) {
        // Continuing a sub-list (e.g. under "  types:")
        pendingList.push(val);
      } else if (mode === "section" || mode === null) {
        // First list item — figure out context from indent
        if (indent === 2 && subKey !== null) {
          // Sub-list for current subKey
          flushPendingList();
          mode = "sub-list";
          pendingList = [val];
        } else if (indent === 2 && topKey !== null) {
          // Top-level list (section with only list items, no sub-keys yet)
          flushPendingList();
          mode = "top-list";
          pendingList = [val];
        } else if (indent === 0 && topKey !== null) {
          // Bare top-level list (shouldn't normally appear but handle gracefully)
          flushPendingList();
          mode = "top-list";
          pendingList = [val];
        }
      }
      continue;
    }

    // ── Key: value or section header ──
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const rest = line.slice(colonIdx + 1).trim();

    if (indent === 0) {
      // Top-level key
      resetTopKey(key);

      if (rest === "") {
        // Section header — children follow (either mapping or list)
        result[key] = {};   // provisionally a mapping; may become a list
        mode = "section";
      } else {
        // Scalar top-level value
        result[key] = stripQuotes(rest);
        topKey = null;
        mode = "scalar";
      }
    } else if (indent === 2 && topKey !== null) {
      // Sub-key inside top-level section
      resetSubKey();
      subKey = key;

      const section = result[topKey];
      if (typeof section !== "object" || Array.isArray(section)) {
        result[topKey] = {};
      }

      if (rest === "") {
        // Sub-section header — list follows
        mode = "sub-list";
        pendingList = [];
      } else {
        // Scalar sub-value
        const target = result[topKey] as Record<string, string | string[]>;
        target[key] = stripQuotes(rest);
        mode = "section";
      }
    }
    // Deeper indentation (4+) is ignored — not needed for this format
  }

  // Flush any pending list at end of file
  flushPendingList();
  return result;
}

// ---------------------------------------------------------------------------
// Manifest extraction helpers
// ---------------------------------------------------------------------------

function asStringArray(val: unknown): readonly string[] {
  if (Array.isArray(val)) {
    return (val as unknown[]).filter((v): v is string => typeof v === "string");
  }
  return [];
}

function asSubObject(val: unknown): Record<string, unknown> {
  if (val !== null && typeof val === "object" && !Array.isArray(val)) {
    return val as Record<string, unknown>;
  }
  return {};
}

function parseManifest(yaml: ParsedYaml): PackageManifest | undefined {
  const name = typeof yaml["name"] === "string" ? yaml["name"] : "";
  const version = typeof yaml["version"] === "string" ? yaml["version"] : "";

  if (name === "" || version === "") return undefined;

  // exports: { types, flows, events }
  const exportsRaw = yaml["exports"];
  let types: readonly string[] = [];
  let flows: readonly string[] = [];
  let events: readonly string[] = [];

  if (exportsRaw !== null && typeof exportsRaw === "object" && !Array.isArray(exportsRaw)) {
    const exportsMap = exportsRaw as Record<string, unknown>;
    types = asStringArray(exportsMap["types"]);
    flows = asStringArray(exportsMap["flows"]);
    events = asStringArray(exportsMap["events"]);
  }

  const effects = asStringArray(yaml["effects"]);
  const capabilities = asStringArray(yaml["capabilities"]);

  // Provenance fields
  const hash = typeof yaml["hash"] === "string" ? yaml["hash"] : undefined;
  const signature = typeof yaml["signature"] === "string" ? yaml["signature"] : undefined;
  const signerKeyId = typeof yaml["signerKeyId"] === "string" ? yaml["signerKeyId"] : undefined;
  const registry = typeof yaml["registry"] === "string" ? yaml["registry"] : undefined;

  // Install script policy — explicit "allow" only; everything else is deny
  const rawInstallScript = typeof yaml["installScript"] === "string" ? yaml["installScript"] : undefined;
  const installScript: "deny" | "allow" | undefined =
    rawInstallScript === "allow" ? "allow" : rawInstallScript === "deny" ? "deny" : undefined;

  // targets: { cpu, wasm, npu, gpu, apu, photonic }
  let targets: PackageTargets | undefined;
  const targetsRaw = asSubObject(yaml["targets"]);
  const TARGET_KEYS = ["cpu", "wasm", "npu", "gpu", "apu", "photonic"] as const;
  const targetEntries: Partial<Record<typeof TARGET_KEYS[number], string>> = {};
  let hasTargets = false;
  for (const key of TARGET_KEYS) {
    const sub = asSubObject(targetsRaw[key]);
    const path = typeof sub["path"] === "string" ? sub["path"] : undefined;
    if (path !== undefined) {
      targetEntries[key] = path;
      hasTargets = true;
    }
  }
  if (hasTargets) targets = targetEntries as PackageTargets;

  // compute: { tensor_shapes, supports, photonic_compatible }
  let compute: PackageCompute | undefined;
  const computeRaw = asSubObject(yaml["compute"]);
  if (Object.keys(computeRaw).length > 0) {
    const tensor_shapes = asStringArray(computeRaw["tensor_shapes"]);
    const supports = asStringArray(computeRaw["supports"]);
    const pc = computeRaw["photonic_compatible"];
    const photonic_compatible =
      pc === true || pc === "true" ? true : pc === false || pc === "false" ? false : undefined;
    compute = {
      ...(tensor_shapes.length > 0 ? { tensor_shapes } : {}),
      ...(supports.length > 0 ? { supports } : {}),
      ...(photonic_compatible !== undefined ? { photonic_compatible } : {}),
    };
  }

  return {
    name,
    version,
    exports: { types, flows, events },
    effects,
    capabilities,
    ...(hash !== undefined ? { hash } : {}),
    ...(signature !== undefined ? { signature } : {}),
    ...(signerKeyId !== undefined ? { signerKeyId } : {}),
    ...(registry !== undefined ? { registry } : {}),
    ...(installScript !== undefined ? { installScript } : {}),
    ...(targets !== undefined ? { targets } : {}),
    ...(compute !== undefined ? { compute } : {}),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Loads and parses a package.logicn.yaml manifest from `packagePath`.
 *
 * Returns `undefined` if the file does not exist or cannot be parsed.
 */
export function loadPackageManifest(packagePath: string): PackageManifest | undefined {
  const manifestPath = join(packagePath, "package.logicn.yaml");

  if (!existsSync(manifestPath)) return undefined;

  let text: string;
  try {
    text = readFileSync(manifestPath, "utf8");
  } catch {
    return undefined;
  }

  try {
    const parsed = parseSimpleYaml(text);
    return parseManifest(parsed);
  } catch {
    return undefined;
  }
}

/**
 * Returns the list of type names exported by the manifest.
 * Equivalent to `manifest.exports.types ?? []`.
 */
export function resolvePackageTypes(manifest: PackageManifest): readonly string[] {
  return manifest.exports.types ?? [];
}

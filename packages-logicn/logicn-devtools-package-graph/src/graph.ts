/**
 * graph.ts — build the boundary graph from a scan result
 *
 * Produces:
 *   - internal edges  (file → file, within the package)
 *   - external surface (the set of node_core / workspace / thirdparty deps)
 *   - orphans         (files with no inbound internal edge, excluding entry points)
 *
 * The external surface is the governance-relevant output: it is the package's
 * Hardened Border. The `--check` gate compares it against an allowlist.
 */

import { dirname, join, normalize, sep } from "node:path";
import type { ScanResult, EdgeKind } from "./scanner.js";

export interface InternalEdge {
  readonly from: string; // package-relative path
  readonly to: string;   // package-relative path (resolved)
}

export interface ExternalDep {
  readonly specifier: string;
  readonly kind: Exclude<EdgeKind, "internal">;
  readonly importedBy: readonly string[]; // files that import it
}

export interface PackageGraph {
  readonly packageName: string;
  readonly scannedRoots: readonly string[];       // source roots actually scanned (those present on disk)
  readonly scannedExtensions: readonly string[];  // source extensions scanned
  readonly nodes: readonly string[];        // all package-relative file paths
  readonly internalEdges: readonly InternalEdge[];
  readonly externalDeps: readonly ExternalDep[];
  readonly orphans: readonly string[];
  readonly entryPoints: readonly string[];  // index.ts, cli.ts — never orphans
  readonly stats: {
    readonly fileCount: number;
    readonly internalEdgeCount: number;
    readonly externalDepCount: number;
    readonly nodeCoreCount: number;
    readonly workspaceCount: number;
    readonly thirdpartyCount: number;
    readonly orphanCount: number;
  };
}

// Conventional entry-point basenames (matched case-insensitively). Entry points are
// never orphans: nothing in a package is required to import its top-level runnable. This
// covers the TS host entries (index/cli/server/main) AND the LogicN composition roots
// (index.lln, main.lln, App.lln) so scanning host/ + .lln does not flag them as orphans.
const ENTRY_BASENAMES = new Set([
  "index.ts", "cli.ts", "server.ts", "main.ts",
  "index.lln", "main.lln", "app.lln",
]);

/** Resolve a relative import specifier to a package-relative source path (best effort). */
function resolveInternal(fromFile: string, specifier: string): string | null {
  const baseDir = dirname(fromFile);
  let target = normalize(join(baseDir, specifier)).split(sep).join("/");
  // TS imports use ".js" (ESM/NodeNext) but the source is ".ts". LogicN ".lln" imports
  // already name the source file, so they are left as-is; an extensionless TS import
  // (rare) falls back to ".ts".
  if (target.endsWith(".js")) target = target.slice(0, -3) + ".ts";
  else if (!target.endsWith(".ts") && !target.endsWith(".lln")) target = target + ".ts";
  return target;
}

export function buildGraph(scan: ScanResult): PackageGraph {
  const nodes = scan.files.map((f) => f.path).sort();
  const nodeSet = new Set(nodes);

  const internalEdges: InternalEdge[] = [];
  const inbound = new Map<string, number>();
  for (const n of nodes) inbound.set(n, 0);

  // External dependency accumulation
  const extMap = new Map<string, { kind: Exclude<EdgeKind, "internal">; importedBy: Set<string> }>();

  for (const file of scan.files) {
    for (const imp of file.imports) {
      if (imp.kind === "internal") {
        const resolved = resolveInternal(file.path, imp.specifier);
        if (resolved && nodeSet.has(resolved)) {
          internalEdges.push({ from: file.path, to: resolved });
          inbound.set(resolved, (inbound.get(resolved) ?? 0) + 1);
        }
        // unresolved internal imports are ignored (e.g. type-only or generated)
      } else {
        const entry = extMap.get(imp.specifier) ?? { kind: imp.kind, importedBy: new Set<string>() };
        entry.importedBy.add(file.path);
        extMap.set(imp.specifier, entry);
      }
    }
  }

  const entryPoints = nodes.filter((n) => {
    const base = (n.split("/").pop() ?? n).toLowerCase();
    return ENTRY_BASENAMES.has(base);
  });
  const entrySet = new Set(entryPoints);

  // Orphans: zero inbound internal edges AND not an entry point.
  const orphans = nodes.filter((n) => (inbound.get(n) ?? 0) === 0 && !entrySet.has(n));

  const externalDeps: ExternalDep[] = [...extMap.entries()]
    .map(([specifier, v]) => ({ specifier, kind: v.kind, importedBy: [...v.importedBy].sort() }))
    .sort((a, b) => a.specifier.localeCompare(b.specifier));

  const nodeCoreCount = externalDeps.filter((d) => d.kind === "node_core").length;
  const workspaceCount = externalDeps.filter((d) => d.kind === "workspace").length;
  const thirdpartyCount = externalDeps.filter((d) => d.kind === "thirdparty").length;

  return {
    packageName: scan.packageName,
    scannedRoots: scan.roots,
    scannedExtensions: scan.extensions,
    nodes,
    internalEdges,
    externalDeps,
    orphans,
    entryPoints,
    stats: {
      fileCount: nodes.length,
      internalEdgeCount: internalEdges.length,
      externalDepCount: externalDeps.length,
      nodeCoreCount,
      workspaceCount,
      thirdpartyCount,
      orphanCount: orphans.length,
    },
  };
}

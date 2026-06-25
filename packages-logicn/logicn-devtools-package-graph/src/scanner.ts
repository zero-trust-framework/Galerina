/**
 * scanner.ts — extract the import surface of a single package
 *
 * Walks the package's SOURCE ROOTS and, for each file, extracts every import/export
 * specifier. Each specifier is classified into one of four kinds so the graph can
 * separate INTERNAL structure from the EXTERNAL boundary:
 *
 *   internal   — relative path that resolves INSIDE the package  ("./x", "../y")
 *   node_core  — Node.js built-in                                ("node:fs", "fs")
 *   workspace  — sibling LogicN package                          ("@logicn/...")
 *   thirdparty — any other bare specifier                        ("axios", "lodash")
 *
 * Scope (roots × extensions):
 *   A LogicN package's real source is not always `src/**\/*.ts`. The canonical app
 *   template keeps its governed compute in `src/**\/*.lln` and its TypeScript host in
 *   `host/**\/*.ts` (see the framework example app). Hardcoding `src/*.ts` made those
 *   packages scan to ZERO files — a green Hardened Border over an UNSCANNED package,
 *   so import drift in `.lln` flows or in `host/` never reached the PR diff. So we
 *   walk a configurable set of roots (default `src`, `host`) and extensions
 *   (default `.ts`, `.lln`). A package may override either via a `packageGraph`
 *   block in its package.json:
 *       "packageGraph": { "roots": ["src", "host"], "extensions": [".ts", ".lln"] }
 *
 * Escaping relative imports are a BORDER edge, not internal:
 *   A relative import that resolves OUTSIDE the package root (e.g. host code importing
 *   `../../logicn-framework-app-kernel/dist/index.js`) crosses the package boundary.
 *   Classifying it `internal` would silently DROP it (it resolves to no node in this
 *   package) — the cross-package dependency would be invisible to the border gate. We
 *   resolve such an import to the sibling package that owns it and record it as a
 *   workspace/thirdparty border dependency keyed by that package's NAME (stable across
 *   the importing file's depth, and identical whether the import is written as a
 *   relative path or the bare `@logicn/...` specifier).
 *
 * Regex-based (no TypeScript-compiler dependency) to keep the tool dependency-light
 * and aligned with the existing scan-and-report devtools pattern. It recognises:
 *   import ... from "spec"      import "spec"      export ... from "spec"
 *   import("spec")  (dynamic)   import plugin <mode> "spec" as Name { … }  (.lln)
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export type EdgeKind = "internal" | "node_core" | "workspace" | "thirdparty";

export interface FileImport {
  readonly specifier: string;   // raw module specifier as written, OR — for an escaping
                                // relative import — the resolved sibling package name
  readonly kind: EdgeKind;
  readonly resolved?: string;   // for internal/escaping: normalised package-relative target (best-effort)
}

export interface ScannedFile {
  readonly path: string;        // package-relative posix path, e.g. "host/server.ts"
  readonly imports: readonly FileImport[];
  readonly exportsFrom: readonly string[]; // re-export specifiers (for index surface)
}

export interface ScanResult {
  readonly packageName: string;
  readonly scopePath: string;   // absolute scope root
  readonly roots: readonly string[];       // source roots actually scanned (those that exist)
  readonly extensions: readonly string[];  // source extensions scanned
  readonly files: readonly ScannedFile[];
}

/** Default source roots — the canonical app template puts governed source in src/ and its host in host/. */
const DEFAULT_ROOTS = ["src", "host"] as const;
/** Default source extensions — TypeScript host code AND governed LogicN flows. */
const DEFAULT_EXTENSIONS = [".ts", ".lln"] as const;

const NODE_BUILTINS = new Set([
  "assert", "buffer", "child_process", "cluster", "console", "crypto", "dgram",
  "dns", "events", "fs", "http", "http2", "https", "net", "os", "path", "perf_hooks",
  "process", "querystring", "readline", "stream", "string_decoder", "timers", "tls",
  "tty", "url", "util", "v8", "vm", "worker_threads", "zlib",
]);

/** First-pass, string-only classification. Relative specifiers are refined later (escape check). */
function classify(specifier: string): EdgeKind {
  if (specifier.startsWith("./") || specifier.startsWith("../")) return "internal";
  if (specifier.startsWith("node:")) return "node_core";
  const bare = specifier.split("/")[0] ?? specifier;
  if (NODE_BUILTINS.has(bare)) return "node_core";
  if (specifier.startsWith("@logicn/")) return "workspace";
  return "thirdparty";
}

// Matches: from "x" | import "x" | import("x") — single or double quotes.
const IMPORT_RE = /(?:import|export)\s+(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
// Re-export form specifically: export ... from "x"
const REEXPORT_RE = /export\s+(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/g;
// LogicN plugin import: import plugin safe|assimilate "spec" as Name { … } — IMPORT_RE does
// NOT match this (the `plugin <mode>` words sit between `import` and the quote).
const PLUGIN_IMPORT_RE = /import\s+plugin\s+\S+\s+["']([^"']+)["']/g;

/**
 * Reject false-positive "specifiers" that come from code that EMITS code rather
 * than from a real ES import. The scanner is deliberately regex-based (no TS
 * compiler), so it cannot tell a genuine `import`/`export` statement from one of
 * the same keywords sitting inside a template literal that generates source for
 * another target. The WASM-text emitter is the canonical offender, e.g.
 *   `(import "${imp.module}" "${imp.name}" ...)`   `(export "memory" (memory 0))`
 *   `(export "${fn.name}" (func $${fn.name}))`
 * which the regex would otherwise read as `import "…"` / `export "…"` specifiers
 * and leak into the boundary allowlist.
 *
 * Two discriminators, both of which only ever exclude non-ES strings:
 *   1. Unexpanded template interpolation (`${…}`) can never be a real specifier.
 *   2. A static `import "x"` / `export "x"` match (capture group 1) whose keyword
 *      is immediately preceded by `(` is a WAT/S-expression form — `(import …)` /
 *      `(export …)` — never an ES statement (ES has no bare `export "x"`, and a
 *      real side-effect `import "x"` is never written `(import`). The dynamic
 *      `import("x")` form (capture group 2) is left untouched.
 */
function isRealSpecifier(spec: string, m: RegExpExecArray, src: string): boolean {
  if (spec.includes("${")) return false;
  if (m[1] !== undefined && src[m.index - 1] === "(") return false;
  return true;
}

/** Recursively list source files under `dir` matching `extensions` (skipping node_modules/dist and .d.ts). */
function listSourceFiles(dir: string, extensions: readonly string[]): string[] {
  const out: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const full = join(dir, name);
    let s;
    try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      out.push(...listSourceFiles(full, extensions));
    } else if (isSourceFile(name, extensions)) {
      out.push(full);
    }
  }
  return out;
}

function isSourceFile(name: string, extensions: readonly string[]): boolean {
  if (name.endsWith(".d.ts")) return false; // declaration files are not the import surface
  return extensions.some((ext) => name.endsWith(ext));
}

interface PackageMeta {
  readonly name: string;
  readonly roots: readonly string[];
  readonly extensions: readonly string[];
}

/** Read the package name and (optional) `packageGraph` scan config. A provided config REPLACES the default. */
function readPackageMeta(scopePath: string): PackageMeta {
  try {
    const pkg = JSON.parse(readFileSync(join(scopePath, "package.json"), "utf-8"));
    const name: string = typeof pkg.name === "string" ? pkg.name : scopePath;
    const cfg = (pkg && typeof pkg.packageGraph === "object" && pkg.packageGraph) || {};
    const roots = stringArray(cfg.roots) ?? [...DEFAULT_ROOTS];
    const extensions = stringArray(cfg.extensions) ?? [...DEFAULT_EXTENSIONS];
    return { name, roots, extensions };
  } catch {
    return { name: scopePath, roots: [...DEFAULT_ROOTS], extensions: [...DEFAULT_EXTENSIONS] };
  }
}

/** A non-empty array of non-empty strings, or null (→ caller uses the default). Guards a malformed config. */
function stringArray(v: unknown): string[] | null {
  if (Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string" && s.length > 0)) {
    return v as string[];
  }
  return null;
}

/** Strip line and block comments so commented-out imports are not counted. `;;` is a LogicN line comment. */
function stripComments(src: string, isLln: boolean): string {
  let out = src
    .replace(/\/\*[\s\S]*?\*\//g, "")       // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");  // line comments (avoid eating "://")
  if (isLln) out = out.replace(/;;[^\n]*/g, ""); // LogicN govComment line comments
  return out;
}

/**
 * Walk up from `absTarget` to the nearest package.json and return the owning package's
 * border identity. Memoised by directory. Returns null if no named package.json is found
 * (caller fails CLOSED — surfaces the raw specifier as thirdparty rather than dropping it).
 */
function resolveOwningPackage(
  absTarget: string,
  cache: Map<string, OwningPackage | null>,
): OwningPackage | null {
  let dir = dirname(absTarget);
  const visited: string[] = [];
  for (let i = 0; i < 64; i++) {
    if (cache.has(dir)) {
      const hit = cache.get(dir)!;
      for (const v of visited) cache.set(v, hit);
      return hit;
    }
    visited.push(dir);
    const pj = join(dir, "package.json");
    if (existsSync(pj)) {
      let result: OwningPackage | null = null;
      try {
        const name = JSON.parse(readFileSync(pj, "utf-8")).name;
        if (typeof name === "string" && name.length > 0) {
          result = { name, kind: name.startsWith("@logicn/") ? "workspace" : "thirdparty" };
        }
      } catch { /* unreadable package.json → null (fail-closed in caller) */ }
      for (const v of visited) cache.set(v, result);
      return result;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const v of visited) cache.set(v, null);
  return null;
}

interface OwningPackage {
  readonly name: string;
  readonly kind: "workspace" | "thirdparty";
}

export function scanPackage(scopePath: string): ScanResult {
  const meta = readPackageMeta(scopePath);

  // Roots that actually exist on disk (a configured-but-absent root is simply skipped).
  const roots = meta.roots.filter((r) => existsSync(join(scopePath, r)));
  const sourceFiles = roots.flatMap((r) => listSourceFiles(join(scopePath, r), meta.extensions));
  const pkgCache = new Map<string, OwningPackage | null>();

  const files: ScannedFile[] = sourceFiles.map((abs) => {
    const isLln = abs.endsWith(".lln");
    const raw = stripComments(readFileSync(abs, "utf-8"), isLln);
    const relPath = relative(scopePath, abs).split(sep).join("/");

    const imports: FileImport[] = [];
    const seen = new Set<string>();

    // Dedup + classify a single specifier, refining a relative import into either an
    // internal edge (resolves inside the package) or a border edge (escapes it).
    const addSpec = (spec: string): void => {
      if (!spec || seen.has(spec)) return;
      seen.add(spec);

      const kind = classify(spec);
      if (kind !== "internal") {
        imports.push({ specifier: spec, kind });
        return;
      }

      const absTarget = resolve(dirname(abs), spec);
      const relTarget = relative(scopePath, absTarget).split(sep).join("/");
      const escapes = relTarget === ".." || relTarget.startsWith("../");
      if (!escapes) {
        imports.push({ specifier: spec, kind: "internal", resolved: relTarget });
        return;
      }

      // Border edge: attribute it to the sibling package that owns the target.
      const owner = resolveOwningPackage(absTarget, pkgCache);
      if (owner) {
        imports.push({ specifier: owner.name, kind: owner.kind, resolved: relTarget });
      } else {
        // Unknown escaping target — fail-closed: surface it (never drop a border-crossing import).
        imports.push({ specifier: spec, kind: "thirdparty", resolved: relTarget });
      }
    };

    let m: RegExpExecArray | null;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(raw)) !== null) {
      const spec = m[1] ?? m[2];
      if (!spec || !isRealSpecifier(spec, m, raw)) continue;
      addSpec(spec);
    }
    PLUGIN_IMPORT_RE.lastIndex = 0;
    while ((m = PLUGIN_IMPORT_RE.exec(raw)) !== null) {
      const spec = m[1];
      if (!spec || spec.includes("${")) continue;
      addSpec(spec);
    }

    const exportsFrom: string[] = [];
    REEXPORT_RE.lastIndex = 0;
    while ((m = REEXPORT_RE.exec(raw)) !== null) {
      if (m[1]) exportsFrom.push(m[1]);
    }

    return { path: relPath, imports, exportsFrom };
  });

  return { packageName: meta.name, scopePath, roots, extensions: meta.extensions, files };
}

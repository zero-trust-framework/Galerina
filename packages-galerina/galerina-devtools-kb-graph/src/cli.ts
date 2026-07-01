#!/usr/bin/env node
// =============================================================================
// cli.ts — entry point for the Galerina KB Graph scanner
//
// Usage:
//   node dist/cli.js                        scan + print summary
//   node dist/cli.js --json                 write build/kb-graph/kb-graph.json
//   node dist/cli.js --dot                  write build/kb-graph/kb-graph.dot
//   node dist/cli.js --report               write build/kb-graph/kb-report.md
//   node dist/cli.js --all                  all outputs
//   node dist/cli.js --check-staleness      flag docs with mtime > 7 days old
// =============================================================================

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanKBDirectory } from "./scanner.js";
import { buildKBGraph } from "./graph.js";
import { generateDOT, generateJSON, generateMarkdownReport } from "./reporter.js";

const __dir = dirname(fileURLToPath(import.meta.url));
// Resolve project root: cli.ts is at packages-galerina/galerina-devtools-kb-graph/dist/cli.js
// So project root is 3 levels up.
const PROJECT_ROOT = join(__dir, "..", "..", "..");
// KB was relocated out of the repo (to sibling ../ZTF-Knowledge-Bases) to protect
// pre-release IP. Resolve order: GALERINA_KB_DIR env → in-repo docs/ (if restored) → sibling KB.
const KB_DIR = process.env.GALERINA_KB_DIR
  ? resolve(process.env.GALERINA_KB_DIR)
  : existsSync(join(PROJECT_ROOT, "docs", "Knowledge-Bases"))
    ? join(PROJECT_ROOT, "docs", "Knowledge-Bases")
    : join(PROJECT_ROOT, "..", "ZTF-Knowledge-Bases");
const OUT_DIR = join(PROJECT_ROOT, "build", "kb-graph");

const STALE_DAYS = 7;
const MS_PER_DAY = 86_400_000;

function ensureOutDir(): void {
  mkdirSync(OUT_DIR, { recursive: true });
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const doJson    = args.includes("--json")    || args.includes("--all");
  const doDot     = args.includes("--dot")     || args.includes("--all");
  const doReport  = args.includes("--report")  || args.includes("--all");
  const doStale   = args.includes("--check-staleness");

  if (!existsSync(KB_DIR)) {
    console.error(`KB directory not found: ${KB_DIR}`);
    process.exit(1);
  }

  const scanResult = scanKBDirectory(KB_DIR);
  const graph = buildKBGraph(scanResult);
  const { stats } = graph;

  // ── Print summary ──────────────────────────────────────────────────────────
  console.log("Galerina KB Graph — docs/Knowledge-Bases/");
  console.log(`Scanned: ${stats.totalDocs} documents`);
  console.log(`Edges:   ${stats.totalEdges} cross-references`);
  if (stats.orphanCount > 0) {
    console.log(`Orphans: ${stats.orphanCount} (${graph.orphans.slice(0, 4).map(id => id + ".md").join(", ")}${graph.orphans.length > 4 ? ", …" : ""})`);
  } else {
    console.log(`Orphans: 0`);
  }
  console.log(`Stale:   ${stats.staleLinkCount} broken link${stats.staleLinkCount !== 1 ? "s" : ""}`);
  console.log(`FUNGI codes: ${stats.totalFungiCodes} unique`);

  // ── Staleness report ───────────────────────────────────────────────────────
  if (doStale) {
    const now = Date.now();
    const staleDocs = graph.nodes.filter(n => (now - n.lastModified.getTime()) > STALE_DAYS * MS_PER_DAY);
    if (staleDocs.length > 0) {
      console.log(`\nStale docs (mtime > ${STALE_DAYS} days):`);
      for (const doc of staleDocs) {
        const age = Math.floor((now - doc.lastModified.getTime()) / MS_PER_DAY);
        console.log(`  ${doc.id}.md — last modified ${age} days ago (${formatDate(doc.lastModified)})`);
      }
    } else {
      console.log(`\nNo stale docs found (all modified within ${STALE_DAYS} days).`);
    }
  }

  if (!doJson && !doDot && !doReport) return;

  ensureOutDir();
  const generatedAt = new Date().toISOString().slice(0, 10);

  if (doJson) {
    const jsonPath = join(OUT_DIR, "kb-graph.json");
    writeFileSync(jsonPath, generateJSON(graph), "utf8");
    console.log(`\nWritten: ${jsonPath}`);
  }

  if (doDot) {
    const dotPath = join(OUT_DIR, "kb-graph.dot");
    writeFileSync(dotPath, generateDOT(graph), "utf8");
    console.log(`Written: ${dotPath}`);
    console.log(`  Render: dot -Tsvg ${dotPath} > build/kb-graph/kb-graph.svg`);
  }

  if (doReport) {
    const reportPath = join(OUT_DIR, "kb-report.md");
    writeFileSync(reportPath, generateMarkdownReport(graph, generatedAt), "utf8");
    console.log(`Written: ${reportPath}`);
  }
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`kb-graph error: ${msg}`);
  process.exit(1);
});

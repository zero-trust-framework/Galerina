// @ts-check
// =============================================================================
// kb-graph.test.mjs — unit tests for the Galerina KB Graph scanner/builder
// =============================================================================

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dir = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dir, "..", "..", "..");
// KB relocated to sibling ../ZTF-Knowledge-Bases; env override wins, in-repo docs used if restored.
const KB_DIR = process.env.GALERINA_KB_DIR
  ? resolve(process.env.GALERINA_KB_DIR)
  : existsSync(join(PROJECT_ROOT, "docs", "Knowledge-Bases"))
    ? join(PROJECT_ROOT, "docs", "Knowledge-Bases")
    : join(PROJECT_ROOT, "..", "ZTF-Knowledge-Bases");

// Dynamic imports of compiled output (run after `npm run build`)
const { scanKBDirectory } = await import("../dist/scanner.js");
const { buildKBGraph }    = await import("../dist/graph.js");
const { generateDOT, generateJSON, generateMarkdownReport } = await import("../dist/reporter.js");

// ── Scan once, reuse ─────────────────────────────────────────────────────────
const scanResult = scanKBDirectory(KB_DIR);
const graph      = buildKBGraph(scanResult);

describe("scanner — basic discovery", () => {
  test("finds all .md files in KB directory (>=30)", () => {
    assert.ok(scanResult.docs.length >= 30,
      `expected >=30 docs, got ${scanResult.docs.length}`);
  });

  test("every doc has a non-empty id", () => {
    for (const doc of scanResult.docs) {
      assert.ok(doc.id.length > 0, `doc with empty id: ${doc.path}`);
    }
  });

  test("every doc has a non-empty path", () => {
    for (const doc of scanResult.docs) {
      assert.ok(doc.path.length > 0);
    }
  });

  test("word counts are positive", () => {
    for (const doc of scanResult.docs) {
      assert.ok(doc.wordCount > 0, `${doc.id} has 0 words`);
    }
  });
});

describe("scanner — metadata extraction", () => {
  test("extracts title from first # heading", () => {
    // KNOWLEDGE-BASE-INDEX.md or architecture-charter.md should have a title
    const titled = scanResult.docs.filter(d => d.title !== d.id);
    assert.ok(titled.length > 0, "no docs had a title extracted from headings");
  });

  test("extracts FUNGI codes from governance-rules doc (>=20 codes)", () => {
    const gov = scanResult.docs.find(d => d.id.includes("governance-rules"));
    if (!gov) {
      // Non-fatal: doc might not be present
      console.log("  (skipped — galerina-governance-rules.md not found)");
      return;
    }
    assert.ok(gov.lnlCodes.length >= 20,
      `expected >=20 FUNGI codes, got ${gov.lnlCodes.length}`);
  });

  test("FUNGI codes match expected pattern FUNGI-XXX-NNN", () => {
    const re = /^FUNGI-[A-Z]+-\d+$/;
    for (const doc of scanResult.docs) {
      for (const code of doc.lnlCodes) {
        assert.ok(re.test(code), `unexpected FUNGI code format: "${code}" in ${doc.id}`);
      }
    }
  });

  test("lastModified is a Date instance", () => {
    for (const doc of scanResult.docs) {
      assert.ok(doc.lastModified instanceof Date, `${doc.id}: lastModified is not a Date`);
    }
  });
});

describe("graph — structure", () => {
  test("graph has same number of nodes as scanned docs", () => {
    assert.equal(graph.nodes.length, scanResult.docs.length);
  });

  test("orphans array exists and is an array", () => {
    assert.ok(Array.isArray(graph.orphans));
  });

  test("staleLinks array exists and is an array", () => {
    assert.ok(Array.isArray(graph.staleLinks));
  });

  test("stats.totalDocs matches nodes length", () => {
    assert.equal(graph.stats.totalDocs, graph.nodes.length);
  });

  test("stats.totalEdges matches edges length", () => {
    assert.equal(graph.stats.totalEdges, graph.edges.length);
  });

  test("stats.orphanCount matches orphans array length", () => {
    assert.equal(graph.stats.orphanCount, graph.orphans.length);
  });

  test("all edge from/to ids are non-empty strings", () => {
    for (const edge of graph.edges) {
      assert.ok(edge.from.length > 0, "edge.from is empty");
      assert.ok(edge.to.length > 0,   "edge.to is empty");
    }
  });

  test("all edge targets exist in the node set (no stale edges in graph.edges)", () => {
    const nodeIds = new Set(graph.nodes.map(n => n.id));
    for (const edge of graph.edges) {
      assert.ok(nodeIds.has(edge.to),
        `edge to "${edge.to}" does not exist in nodes (from "${edge.from}")`);
    }
  });
});

describe("reporter — output formats", () => {
  test("generateDOT produces a digraph string", () => {
    const dot = generateDOT(graph);
    assert.ok(dot.startsWith("digraph KBGraph {"), "DOT missing digraph header");
    assert.ok(dot.includes("rankdir=LR"), "DOT missing rankdir");
    assert.ok(dot.trimEnd().endsWith("}"), "DOT missing closing brace");
  });

  test("generateJSON produces valid JSON with nodes and edges arrays", () => {
    const json = generateJSON(graph);
    const parsed = JSON.parse(json);
    assert.ok(Array.isArray(parsed.nodes), "JSON nodes is not an array");
    assert.ok(Array.isArray(parsed.edges), "JSON edges is not an array");
    assert.equal(parsed.nodes.length, graph.nodes.length);
  });

  test("generateMarkdownReport contains expected sections", () => {
    const md = generateMarkdownReport(graph, "2026-06-05");
    assert.ok(md.includes("# Galerina KB Graph Report"),       "missing title");
    assert.ok(md.includes("## Stats"),                       "missing Stats section");
    assert.ok(md.includes("## Document Registry"),           "missing Document Registry section");
    assert.ok(md.includes("## Orphaned Documents"),          "missing Orphaned Documents section");
    assert.ok(md.includes("## Stale Links"),                 "missing Stale Links section");
  });

  test("generateMarkdownReport stats line includes correct doc count", () => {
    const md = generateMarkdownReport(graph, "2026-06-05");
    assert.ok(md.includes(`Docs: ${graph.stats.totalDocs}`),
      `stats line does not show correct doc count ${graph.stats.totalDocs}`);
  });
});

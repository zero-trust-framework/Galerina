// leak-proof — the AI-code-gen referee's machine-consumable structural leak proof (lln.leakproof.v1).
// An autonomous LLM writer reads this to self-patch the exact capability leak the compiler proved.
// Fail-closed: ANY error-severity governance leak → module verdict 'leak'; non-leak codes are ignored.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLeakProof, canonicalLeakProof } from "../dist/leak-proof.js";

const diag = (o) => ({ name: "X", severity: "error", message: "", ...o });

test("a clean module (no governance leaks) → verdict 'clean'", () => {
  const p = buildLeakProof([
    diag({ code: "LLN-TYPE-001", message: "unknown type" }),       // not a capability leak
    diag({ code: "LLN-IMPORT-005", message: "traversal" }),        // not a capability leak
  ]);
  assert.equal(p.schema, "lln.leakproof.v1");
  assert.equal(p.verdict, "clean");
  assert.equal(p.leaks.length, 0);
});

test("a secret-egress error → verdict 'leak', category + capability + redact fix extracted", () => {
  const p = buildLeakProof([diag({
    code: "LLN-VALUESTATE-003", name: "SECRET_TO_SINK",
    message: "an unsafe value flows to network.outbound at the trust boundary",
    location: { file: "f.lln", line: 12, column: 3 },
    suggestedCode: "redact(value)", suggestedFix: "redact() the value before the sink",
    why: "a secret reaches a network sink", risk: "credential exfiltration",
  })]);
  assert.equal(p.verdict, "leak");
  assert.equal(p.leaks.length, 1);
  const f = p.leaks[0];
  assert.equal(f.category, "secret-egress");
  assert.equal(f.capability, "network.outbound");
  assert.equal(f.severity, "deny");
  assert.equal(f.site.line, 12);
  assert.equal(f.fix.kind, "redact-or-seal");
  assert.equal(f.fix.suggestedCode, "redact(value)");
  assert.equal(f.why, "a secret reaches a network sink");
});

test("category + fix mapping per LLN family", () => {
  const cases = [
    ["LLN-TENANT-002", "tenant-isolation", "bind-tenant-scope"],
    ["LLN-PRIVACY-002", "privacy-egress", "redact-or-seal"],
    ["LLN-EFFECT-001", "undeclared-effect", "declare-effect"],
    ["LLN-SUBSTRATE-005", "substrate-misuse", "move-to-digital-lane"],
  ];
  for (const [code, cat, kind] of cases) {
    const f = buildLeakProof([diag({ code, message: "uses database.write" })]).leaks[0];
    assert.equal(f.category, cat, code);
    assert.equal(f.fix.kind, kind, code);
  }
});

test("deny-by-default: a warning-only leak does NOT flip verdict to leak, but is still reported", () => {
  const p = buildLeakProof([diag({ code: "LLN-TENANT-001", severity: "warning", message: "dangling tenant.scope" })]);
  assert.equal(p.verdict, "clean");           // no DENY-severity finding
  assert.equal(p.leaks.length, 1);            // but still surfaced as a warn
  assert.equal(p.leaks[0].severity, "warn");
  assert.equal(p.summary.denies, 0);
});

test("info-severity is ignored entirely", () => {
  const p = buildLeakProof([diag({ code: "LLN-EFFECT-001", severity: "info", message: "fyi" })]);
  assert.equal(p.leaks.length, 0);
});

test("summary counts by category + denies", () => {
  const p = buildLeakProof([
    diag({ code: "LLN-SECRET-002", message: "secret.read leaks" }),
    diag({ code: "LLN-VALUESTATE-003", message: "value to database.write" }),
    diag({ code: "LLN-TENANT-002", message: "cross-tenant" }),
  ]);
  assert.equal(p.verdict, "leak");
  assert.equal(p.summary.total, 3);
  assert.equal(p.summary.denies, 3);
  assert.equal(p.summary.byCategory["secret-egress"], 2);
  assert.equal(p.summary.byCategory["tenant-isolation"], 1);
});

test("canonicalLeakProof is deterministic + order-independent (signable)", () => {
  const a = buildLeakProof([diag({ code: "LLN-SECRET-002", message: "x" }), diag({ code: "LLN-TENANT-002", message: "y" })]);
  const b = buildLeakProof([diag({ code: "LLN-TENANT-002", message: "y" }), diag({ code: "LLN-SECRET-002", message: "x" })]);
  assert.equal(canonicalLeakProof(a), canonicalLeakProof(b)); // sorted → input order doesn't matter
});

// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import {
  buildProofChainFromBuffers, upgradeExecutionProofV1ToV2, validateProofChain,
  buildEventDAG, eventsInTrace, eventsByStatus, denialEvents,
  serializeAuditEvent, JsonlWriterError, createInMemoryJsonlWriter,
  buildEffectGraph, propagateEffects,
  effectGraphToReport, eventDagToReport, proofChainToReport,
} from "../dist/index.js";

// ---------------------------------------------------------------------------
// ExecutionProofChain
// ---------------------------------------------------------------------------

const SAMPLE_BUFFERS = {
  manifest: "manifest content",
  audit: "audit content",
  evidence: "evidence content",
  denial: "denial content",
  artefact: "artefact content",
};

describe("buildProofChainFromBuffers", () => {
  it("produces a valid v1 proof chain", () => {
    const chain = buildProofChainFromBuffers(SAMPLE_BUFFERS);
    assert.equal(chain.schemaVersion, "spore.execution.proof.v1");
    assert.ok(chain.proofId.length > 0);
    assert.ok(chain.generatedAt.length > 0);
    assert.ok(chain.hashes.manifestSha256.length === 64); // hex sha256
    assert.ok(chain.hashes.auditSha256.length === 64);
    assert.ok(chain.hashes.evidenceSha256.length === 64);
    assert.ok(chain.hashes.denialSha256.length === 64);
    assert.ok(chain.hashes.artefactSha256.length === 64);
  });

  it("produces deterministic hashes for same input", () => {
    const c1 = buildProofChainFromBuffers(SAMPLE_BUFFERS);
    const c2 = buildProofChainFromBuffers(SAMPLE_BUFFERS);
    assert.equal(c1.hashes.manifestSha256, c2.hashes.manifestSha256);
    assert.equal(c1.hashes.auditSha256, c2.hashes.auditSha256);
  });

  it("produces different hashes for different input", () => {
    const c1 = buildProofChainFromBuffers(SAMPLE_BUFFERS);
    const c2 = buildProofChainFromBuffers({ ...SAMPLE_BUFFERS, manifest: "different" });
    assert.notEqual(c1.hashes.manifestSha256, c2.hashes.manifestSha256);
    // other hashes should be the same
    assert.equal(c1.hashes.auditSha256, c2.hashes.auditSha256);
  });

  it("validateProofChain returns true for valid chain", () => {
    const chain = buildProofChainFromBuffers(SAMPLE_BUFFERS);
    assert.ok(validateProofChain(chain));
  });
});

describe("upgradeExecutionProofV1ToV2", () => {
  it("produces schemaVersion v2 with 5 sections", () => {
    const v1 = buildProofChainFromBuffers(SAMPLE_BUFFERS);
    const v2 = upgradeExecutionProofV1ToV2(v1);
    assert.equal(v2.schemaVersion, "spore.execution.proof.v2");
    assert.equal(v2.proofId, v1.proofId);
    assert.ok(v2.sections !== undefined && v2.sections.length === 5);
  });

  it("retains v1 hashes in v2", () => {
    const v1 = buildProofChainFromBuffers(SAMPLE_BUFFERS);
    const v2 = upgradeExecutionProofV1ToV2(v1);
    assert.equal(v2.hashes.manifestSha256, v1.hashes.manifestSha256);
  });

  it("section hashes match the v1 hashes", () => {
    const v1 = buildProofChainFromBuffers(SAMPLE_BUFFERS);
    const v2 = upgradeExecutionProofV1ToV2(v1);
    const manifestSection = v2.sections?.find((s) => s.name === "manifest");
    assert.equal(manifestSection?.hash, v1.hashes.manifestSha256);
  });
});

// ---------------------------------------------------------------------------
// EventDAG
// ---------------------------------------------------------------------------

function makeEvent(id, status, traceId, spanId, parentSpanId, timestamp) {
  return {
    schemaVersion: "spore.runtime.audit.v1",
    eventId: id,
    timestamp: timestamp ?? `2026-05-27T12:00:0${id.charCodeAt(0) % 10}.000Z`,
    category: "effect",
    status,
    message: `Event ${id}`,
    traceId,
    spanId,
    parentSpanId,
  };
}

describe("buildEventDAG", () => {
  it("creates nodes for each event", () => {
    const dag = buildEventDAG([
      makeEvent("e1", "allowed", "t1", "s1"),
      makeEvent("e2", "allowed", "t1", "s2"),
    ]);
    assert.equal(dag.nodeCount, 2);
    assert.ok(dag.hasNode("e1"));
    assert.ok(dag.hasNode("e2"));
  });

  it("creates child-span edge when parentSpanId matches", () => {
    const dag = buildEventDAG([
      makeEvent("e1", "allowed", "t1", "s1", undefined, "2026-05-27T12:00:00.000Z"),
      makeEvent("e2", "allowed", "t1", "s2", "s1",     "2026-05-27T12:00:01.000Z"),
    ]);
    const edge = dag.outEdges("e1").find((e) => e.to === "e2");
    assert.ok(edge !== undefined);
    assert.equal(edge.data.relationKind, "child-span");
  });

  it("skips duplicate eventIds", () => {
    const dag = buildEventDAG([
      makeEvent("e1", "allowed", "t1", "s1"),
      makeEvent("e1", "denied",  "t1", "s1"),
    ]);
    assert.equal(dag.nodeCount, 1);
    assert.equal(dag.node("e1")?.data.status, "allowed"); // first wins
  });

  it("eventsInTrace returns events for a traceId sorted by timestamp", () => {
    const dag = buildEventDAG([
      makeEvent("b", "allowed", "trace-1", "sb", undefined, "2026-05-27T12:00:02.000Z"),
      makeEvent("a", "allowed", "trace-1", "sa", undefined, "2026-05-27T12:00:01.000Z"),
    ]);
    const inTrace = eventsInTrace(dag, "trace-1");
    assert.equal(inTrace[0]?.eventId, "a");
    assert.equal(inTrace[1]?.eventId, "b");
  });

  it("denialEvents returns only denied events", () => {
    const dag = buildEventDAG([
      makeEvent("ok1", "allowed", "t1", "s1"),
      makeEvent("bad1", "denied", "t1", "s2"),
      makeEvent("bad2", "denied", "t2", "s3"),
    ]);
    const denials = denialEvents(dag);
    assert.equal(denials.length, 2);
    assert.ok(denials.every((e) => e.status === "denied"));
  });

  it("eventsByStatus filters correctly", () => {
    const dag = buildEventDAG([
      makeEvent("e1", "allowed", "t1", "s1"),
      makeEvent("e2", "denied",  "t1", "s2"),
      makeEvent("e3", "allowed", "t2", "s3"),
    ]);
    const allowed = eventsByStatus(dag, "allowed");
    assert.equal(allowed.length, 2);
  });
});

// ---------------------------------------------------------------------------
// JsonlWriter
// ---------------------------------------------------------------------------

function makeAuditEvent(id, status = "allowed") {
  return {
    schemaVersion: "spore.runtime.audit.v1",
    eventId: id,
    timestamp: new Date().toISOString(),
    category: "effect",
    status,
    message: `Event ${id}`,
  };
}

describe("serializeAuditEvent", () => {
  it("serializes to a single JSON line ending with \\n", () => {
    const line = serializeAuditEvent(makeAuditEvent("evt_001"));
    assert.ok(!line.includes("\n\n"));
    assert.ok(line.endsWith("\n"));
    const parsed = JSON.parse(line);
    assert.equal(parsed.eventId, "evt_001");
  });

  it("throws JsonlWriterError for wrong schemaVersion", () => {
    const badEvent = { ...makeAuditEvent("x"), schemaVersion: "lln.runtime.audit.v0" };
    assert.throws(
      () => serializeAuditEvent(badEvent),
      (err) => err instanceof JsonlWriterError && err.code === "LLN-REPORT-001",
    );
  });

  it("throws JsonlWriterError when metadata contains a secret key", () => {
    const eventWithSecret = {
      ...makeAuditEvent("y"),
      metadata: { password: "hunter2" },
    };
    assert.throws(
      () => serializeAuditEvent(eventWithSecret),
      (err) => err instanceof JsonlWriterError && err.code === "LLN-AUDIT-003",
    );
  });

  it("does not throw for safe metadata keys", () => {
    const event = {
      ...makeAuditEvent("z"),
      metadata: { environment: "production", requestId: "req_001" },
    };
    assert.doesNotThrow(() => serializeAuditEvent(event));
  });
});

describe("InMemoryJsonlWriter", () => {
  it("appends events in order", async () => {
    const writer = createInMemoryJsonlWriter();
    await writer.append(makeAuditEvent("e1"));
    await writer.append(makeAuditEvent("e2"));
    await writer.append(makeAuditEvent("e3"));
    assert.equal(writer.events.length, 3);
    assert.equal(writer.events[0]?.eventId, "e1");
    assert.equal(writer.events[2]?.eventId, "e3");
  });

  it("toString() returns valid JSONL", async () => {
    const writer = createInMemoryJsonlWriter();
    await writer.append(makeAuditEvent("x1"));
    await writer.append(makeAuditEvent("x2"));
    const output = writer.toString();
    const lines = output.trim().split("\n");
    assert.equal(lines.length, 2);
    assert.ok(lines.every((l) => JSON.parse(l).schemaVersion === "spore.runtime.audit.v1"));
  });

  it("rejects appends after close()", async () => {
    const writer = createInMemoryJsonlWriter();
    await writer.close();
    await assert.rejects(() => writer.append(makeAuditEvent("late")));
  });
});

// ---------------------------------------------------------------------------
// Report builders
// ---------------------------------------------------------------------------

describe("Report builders", () => {
  it("effectGraphToReport returns correct shape", () => {
    const g = propagateEffects(buildEffectGraph([
      { flowName: "createOrder", safetyLevel: "guarded", declaredEffects: ["database.write"], inferredEffects: ["database.write"], calls: [] },
    ]));
    const report = effectGraphToReport(g);
    assert.equal(report.kind, "effect-graph");
    assert.equal(report.flowCount, 1);
    assert.ok(report.effectCount >= 1);
    assert.equal(report.flows[0]?.flowName, "createOrder");
  });

  it("eventDagToReport returns correct counts", () => {
    const dag = buildEventDAG([
      makeEvent("e1", "allowed", "t1", "s1"),
      makeEvent("e2", "denied",  "t1", "s2"),
    ]);
    const report = eventDagToReport(dag);
    assert.equal(report.kind, "audit-chain");
    assert.equal(report.eventCount, 2);
    assert.equal(report.denialCount, 1);
    assert.equal(report.statusSummary["allowed"], 1);
    assert.equal(report.statusSummary["denied"], 1);
  });

  it("proofChainToReport mirrors the chain", () => {
    const chain = buildProofChainFromBuffers(SAMPLE_BUFFERS);
    const report = proofChainToReport(chain);
    assert.equal(report.kind, "execution-proof");
    assert.equal(report.proofId, chain.proofId);
    assert.equal(report.hashes.manifestSha256, chain.hashes.manifestSha256);
  });
});

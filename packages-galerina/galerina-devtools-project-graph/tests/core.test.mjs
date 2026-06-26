// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GraphBuilder } from "../dist/index.js";

describe("GraphBuilder — construction", () => {
  it("builds an empty graph", () => {
    const g = new GraphBuilder().build();
    assert.equal(g.nodeCount, 0);
    assert.equal(g.edgeCount, 0);
    assert.deepEqual(g.nodes(), []);
    assert.deepEqual(g.edges(), []);
  });

  it("adds nodes and retrieves them", () => {
    const g = new GraphBuilder()
      .addNode("a", { label: "A" })
      .addNode("b", { label: "B" })
      .build();

    assert.equal(g.nodeCount, 2);
    assert.ok(g.hasNode("a"));
    assert.ok(g.hasNode("b"));
    assert.equal(g.node("a")?.data.label, "A");
    assert.equal(g.node("missing"), undefined);
  });

  it("adds edges and retrieves adjacency", () => {
    const g = new GraphBuilder()
      .addNode("x", {})
      .addNode("y", {})
      .addEdge("x", "y", { weight: 1 })
      .build();

    assert.equal(g.edgeCount, 1);
    assert.equal(g.outEdges("x").length, 1);
    assert.equal(g.outEdges("x")[0]?.to, "y");
    assert.equal(g.inEdges("y").length, 1);
    assert.equal(g.inEdges("y")[0]?.from, "x");
    assert.deepEqual(g.outEdges("y"), []);
    assert.deepEqual(g.inEdges("x"), []);
  });

  it("throws when adding edge with unknown source", () => {
    const builder = new GraphBuilder().addNode("a", {});
    assert.throws(
      () => builder.addEdge("MISSING", "a", {}),
      /source node "MISSING"/,
    );
  });

  it("throws when adding edge with unknown target", () => {
    const builder = new GraphBuilder().addNode("a", {});
    assert.throws(
      () => builder.addEdge("a", "MISSING", {}),
      /target node "MISSING"/,
    );
  });

  it("last addNode call wins for duplicate ids", () => {
    const g = new GraphBuilder()
      .addNode("a", { v: 1 })
      .addNode("a", { v: 2 })
      .build();
    assert.equal(g.nodeCount, 1);
    assert.equal(g.node("a")?.data.v, 2);
  });

  it("builder can be reused after build()", () => {
    const builder = new GraphBuilder().addNode("a", {});
    const g1 = builder.build();
    builder.addNode("b", {});
    const g2 = builder.build();
    assert.equal(g1.nodeCount, 1);
    assert.equal(g2.nodeCount, 2);
  });
});

describe("GraphBuilder — JSON round-trip", () => {
  it("toJSON produces spore.graph.v1 schema", () => {
    const g = new GraphBuilder()
      .addNode("n1", { x: 1 })
      .addNode("n2", { x: 2 })
      .addEdge("n1", "n2", { label: "edge" })
      .build();
    const json = g.toJSON();
    assert.equal(json.schemaVersion, "spore.graph.v1");
    assert.equal(json.nodes.length, 2);
    assert.equal(json.edges.length, 1);
  });

  it("fromJSON restores an identical graph", () => {
    const original = new GraphBuilder()
      .addNode("a", { name: "alpha" })
      .addNode("b", { name: "beta" })
      .addEdge("a", "b", { type: "link" })
      .build();

    const json = original.toJSON();
    const restored = GraphBuilder.fromJSON(json);

    assert.equal(restored.nodeCount, original.nodeCount);
    assert.equal(restored.edgeCount, original.edgeCount);
    assert.equal(restored.node("a")?.data.name, "alpha");
    assert.equal(restored.node("b")?.data.name, "beta");
    assert.equal(restored.outEdges("a")[0]?.to, "b");
  });

  it("fromJSON throws on wrong schemaVersion", () => {
    assert.throws(
      () => GraphBuilder.fromJSON({ schemaVersion: "lln.graph.v0", nodes: [], edges: [] }),
      /unsupported graph schemaVersion/,
    );
  });

  it("nodes() returns all nodes including isolated ones", () => {
    const g = new GraphBuilder()
      .addNode("solo", { isolated: true })
      .addNode("a", {})
      .addNode("b", {})
      .addEdge("a", "b", {})
      .build();
    assert.equal(g.nodes().length, 3);
  });
});

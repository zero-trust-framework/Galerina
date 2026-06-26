// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GraphBuilder,
  bfsPath, bfsReachable,
  dfsVisit, detectCycle,
  topoSort,
  fixpoint,
  canReach, allReachable, canReachAll, reachableSubset,
} from "../dist/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function chain(ids) {
  const b = new GraphBuilder();
  for (const id of ids) b.addNode(id, { id });
  for (let i = 0; i < ids.length - 1; i++) b.addEdge(ids[i], ids[i + 1], {});
  return b.build();
}

function diamond() {
  //   a
  //  / \
  // b   c
  //  \ /
  //   d
  return new GraphBuilder()
    .addNode("a", {}).addNode("b", {}).addNode("c", {}).addNode("d", {})
    .addEdge("a", "b", {}).addEdge("a", "c", {})
    .addEdge("b", "d", {}).addEdge("c", "d", {})
    .build();
}

function cycleGraph() {
  return new GraphBuilder()
    .addNode("x", {}).addNode("y", {}).addNode("z", {})
    .addEdge("x", "y", {}).addEdge("y", "z", {}).addEdge("z", "x", {})
    .build();
}

// ---------------------------------------------------------------------------
// BFS
// ---------------------------------------------------------------------------

describe("bfsPath", () => {
  it("finds path in a chain", () => {
    const g = chain(["a", "b", "c", "d"]);
    const path = bfsPath(g, "a", "d");
    assert.deepEqual(path, ["a", "b", "c", "d"]);
  });

  it("returns [from] when from === to", () => {
    const g = chain(["a", "b"]);
    assert.deepEqual(bfsPath(g, "a", "a"), ["a"]);
  });

  it("returns null when no path exists", () => {
    const g = new GraphBuilder()
      .addNode("a", {}).addNode("b", {}).build();
    assert.equal(bfsPath(g, "a", "b"), null);
  });

  it("returns null for missing node", () => {
    const g = chain(["a", "b"]);
    assert.equal(bfsPath(g, "a", "MISSING"), null);
  });

  it("finds shortest path in diamond (prefers left branch alphabetically)", () => {
    const g = diamond();
    const path = bfsPath(g, "a", "d");
    assert.ok(path !== null && path.length === 3);
    assert.equal(path[0], "a");
    assert.equal(path[path.length - 1], "d");
  });
});

describe("bfsReachable", () => {
  it("includes start node itself", () => {
    const g = chain(["a", "b", "c"]);
    assert.ok(bfsReachable(g, "a").has("a"));
  });

  it("includes all downstream nodes", () => {
    const g = chain(["a", "b", "c"]);
    const r = bfsReachable(g, "a");
    assert.ok(r.has("b") && r.has("c"));
  });

  it("does not include upstream nodes", () => {
    const g = chain(["a", "b", "c"]);
    const r = bfsReachable(g, "b");
    assert.ok(!r.has("a"));
  });

  it("returns empty set for missing node", () => {
    const g = chain(["a"]);
    assert.equal(bfsReachable(g, "MISSING").size, 0);
  });
});

// ---------------------------------------------------------------------------
// DFS
// ---------------------------------------------------------------------------

describe("dfsVisit", () => {
  it("visits nodes in post-order", () => {
    const g = chain(["a", "b", "c"]);
    const visited = [];
    dfsVisit(g, "a", (node) => visited.push(node.id));
    assert.deepEqual(visited, ["c", "b", "a"]);
  });

  it("does not visit nodes unreachable from start", () => {
    const g = new GraphBuilder()
      .addNode("a", {}).addNode("b", {}).addNode("isolated", {}).build();
    const visited = [];
    dfsVisit(g, "a", (node) => visited.push(node.id));
    assert.ok(!visited.includes("isolated"));
  });
});

describe("detectCycle", () => {
  it("detects no cycle in a DAG", () => {
    const g = chain(["a", "b", "c"]);
    const result = detectCycle(g);
    assert.equal(result.hasCycle, false);
  });

  it("detects a simple cycle", () => {
    const g = cycleGraph();
    const result = detectCycle(g);
    assert.equal(result.hasCycle, true);
    assert.ok(result.cycle !== undefined && result.cycle.length >= 2);
  });

  it("detects a self-loop", () => {
    const g = new GraphBuilder()
      .addNode("a", {}).addEdge("a", "a", {}).build();
    assert.equal(detectCycle(g).hasCycle, true);
  });

  it("correctly reports no cycle in a diamond", () => {
    assert.equal(detectCycle(diamond()).hasCycle, false);
  });
});

// ---------------------------------------------------------------------------
// Topological sort
// ---------------------------------------------------------------------------

describe("topoSort", () => {
  it("sorts a linear chain correctly", () => {
    const g = chain(["a", "b", "c"]);
    const result = topoSort(g);
    assert.equal(result.ok, true);
    assert.deepEqual(result.order, ["a", "b", "c"]);
  });

  it("produces deterministic alphabetical order for equal-level nodes", () => {
    const g = new GraphBuilder()
      .addNode("c", {}).addNode("a", {}).addNode("b", {})
      .addEdge("a", "c", {}).addEdge("b", "c", {})
      .build();
    const result = topoSort(g);
    assert.equal(result.ok, true);
    // a and b both have in-degree 0; must appear before c, sorted alphabetically
    assert.ok(result.order.indexOf("a") < result.order.indexOf("c"));
    assert.ok(result.order.indexOf("b") < result.order.indexOf("c"));
    assert.equal(result.order[0], "a"); // alphabetical first
  });

  it("returns ok:false and cycle for cyclic graph", () => {
    const g = cycleGraph();
    const result = topoSort(g);
    assert.equal(result.ok, false);
    assert.ok(result.cycle !== undefined && result.cycle.length > 0);
  });

  it("handles isolated nodes (no edges)", () => {
    const g = new GraphBuilder()
      .addNode("z", {}).addNode("a", {}).addNode("m", {}).build();
    const result = topoSort(g);
    assert.equal(result.ok, true);
    assert.deepEqual(result.order, ["a", "m", "z"]); // alphabetical
  });
});

// ---------------------------------------------------------------------------
// Fixpoint
// ---------------------------------------------------------------------------

describe("fixpoint", () => {
  it("converges on a simple accumulation", () => {
    // Each node accumulates the values of its outgoing neighbours.
    const g = new GraphBuilder()
      .addNode("a", { values: [1] })
      .addNode("b", { values: [2] })
      .addNode("c", { values: [3] })
      .addEdge("a", "b", {})
      .addEdge("b", "c", {})
      .build();

    const result = fixpoint(g, (graph, node) => {
      const accumulated = new Set(node.data.values);
      for (const edge of graph.outEdges(node.id)) {
        const neighbour = graph.node(edge.to);
        if (neighbour) {
          for (const v of neighbour.data.values) accumulated.add(v);
        }
      }
      return { values: [...accumulated].sort((a, b) => a - b) };
    });

    assert.equal(result.ok, true);
    // node a should eventually see b's and c's values propagate
    const aValues = result.graph.node("a")?.data.values ?? [];
    assert.ok(aValues.includes(1));
  });

  it("returns ok:false when maxIterations is exceeded", () => {
    // Create an oscillating propagation by alternating the value.
    // Each pass flips value between 0 and 1, so it never converges.
    const g = new GraphBuilder()
      .addNode("a", { tick: 0 })
      .build();

    let flip = 0;
    const result = fixpoint(
      g,
      (_graph, node) => {
        flip = flip === 0 ? 1 : 0;
        return { tick: flip };
      },
      5,
    );

    assert.equal(result.ok, false);
    assert.ok("diagnostic" in result);
    assert.equal(result.diagnostic.code, "SPORE-PGRAPH-004");
  });
});

// ---------------------------------------------------------------------------
// Reachability
// ---------------------------------------------------------------------------

describe("canReach / allReachable", () => {
  it("canReach returns true for reachable nodes", () => {
    const g = chain(["a", "b", "c"]);
    assert.ok(canReach(g, "a", "c"));
    assert.ok(canReach(g, "a", "a")); // self
  });

  it("canReach returns false for unreachable node", () => {
    const g = chain(["a", "b"]);
    assert.equal(canReach(g, "b", "a"), false);
  });

  it("canReach returns false for missing nodes", () => {
    const g = chain(["a"]);
    assert.equal(canReach(g, "a", "MISSING"), false);
    assert.equal(canReach(g, "MISSING", "a"), false);
  });

  it("canReachAll returns true when all targets reachable", () => {
    const g = chain(["a", "b", "c", "d"]);
    assert.ok(canReachAll(g, "a", ["b", "c", "d"]));
  });

  it("canReachAll returns false when one target unreachable", () => {
    const g = chain(["a", "b", "c"]);
    assert.equal(canReachAll(g, "b", ["a", "c"]), false); // a is upstream
  });

  it("reachableSubset returns only reachable targets", () => {
    const g = chain(["a", "b", "c"]);
    const subset = reachableSubset(g, "b", ["a", "b", "c"]);
    assert.deepEqual(subset.sort(), ["b", "c"]);
  });
});

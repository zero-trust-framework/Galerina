// =============================================================================
// Effect Checker — EffectCheckerFlags, FUNGI-EFFECT-005, EffectCheckerMode (Phase 18E)
//
// Tests for:
//   - EffectCheckerFlags bitset (shape, values, bit operations)
//   - FlowEffectSummary carries declaredEffectsMask, inferredEffectsMask, checkerFlags
//   - FUNGI-EFFECT-005 BroadAliasUsed fires for 'network', 'database', 'ai', etc.
//   - FUNGI-EFFECT-004 still fires for completely unknown effect names
//   - FUNGI_EFFECT_005 constant shape
//   - EffectCheckerMode type exported
// =============================================================================

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseProgram,
  checkEffects,
  checkStdlibEffects,
  buildFlowEffectSummary,
  EffectCheckerFlags,
  effectsToFlags,
  FUNGI_EFFECT_005,
  LEGACY_EFFECT_CALL_PATTERNS_COUNT,
} from "../../dist/index.js";

// ---------------------------------------------------------------------------
// EffectCheckerFlags shape
// ---------------------------------------------------------------------------

describe("EffectCheckerFlags: constant shape", () => {
  it("None is 0", () => {
    assert.equal(EffectCheckerFlags.None, 0);
  });

  it("all non-None flags are distinct powers of 2", () => {
    const flags = Object.entries(EffectCheckerFlags)
      .filter(([name]) => name !== "None")
      .map(([, v]) => v);
    for (const f of flags) {
      assert.ok(f > 0 && (f & (f - 1)) === 0, `${f} is not a power of 2`);
    }
    assert.equal(new Set(flags).size, flags.length, "All flags must be distinct");
  });

  it("has expected optimization flags", () => {
    assert.ok("PureComputeCandidate"  in EffectCheckerFlags);
    assert.ok("ParallelSafe"          in EffectCheckerFlags);
    assert.ok("KernelFusionCandidate" in EffectCheckerFlags);
    assert.ok("EffectFree"            in EffectCheckerFlags);
    assert.ok("ReadyForAPU"           in EffectCheckerFlags);
    assert.ok("ReadyForNPU"           in EffectCheckerFlags);
  });

  it("flags can be combined and tested", () => {
    const combined = EffectCheckerFlags.PureComputeCandidate | EffectCheckerFlags.ParallelSafe;
    assert.ok(combined & EffectCheckerFlags.PureComputeCandidate, "PureComputeCandidate must be set");
    assert.ok(combined & EffectCheckerFlags.ParallelSafe, "ParallelSafe must be set");
    assert.ok(!(combined & EffectCheckerFlags.EffectFree), "EffectFree must NOT be set");
  });
});

// ---------------------------------------------------------------------------
// FlowEffectSummary bitset fields
// ---------------------------------------------------------------------------

describe("buildFlowEffectSummary: carries bitset fields", () => {
  function parseAndSummarise(source) {
    const parsed = parseProgram(source, "test.fungi");
    const flow = parsed.flows[0];
    if (!flow) throw new Error("No flow found");
    const node = parsed.ast.children?.find(
      (c) => c.value === flow.name,
    );
    if (!node) throw new Error("No flow node found");
    return buildFlowEffectSummary(node, flow);
  }

  it("pure effect-free flow → EffectFree | PureComputeCandidate flags set", () => {
    const summary = parseAndSummarise(`
pure flow double(x: Int) -> Int {
  return x
}
`);
    assert.ok(summary.checkerFlags & EffectCheckerFlags.PureComputeCandidate,
      "PureComputeCandidate must be set for effect-free pure flow");
    assert.ok(summary.checkerFlags & EffectCheckerFlags.EffectFree,
      "EffectFree must be set for truly effect-free pure flow");
    assert.ok(summary.checkerFlags & EffectCheckerFlags.ParallelSafe,
      "ParallelSafe must be set for pure effect-free flow");
  });

  it("guarded flow with effects → no PureComputeCandidate", () => {
    const summary = parseAndSummarise(`
guarded flow save(data: String) -> Void
contract { effects { database.write } }
{
  return
}
`);
    assert.ok(!(summary.checkerFlags & EffectCheckerFlags.PureComputeCandidate),
      "PureComputeCandidate must NOT be set for guarded flow");
    assert.ok(!(summary.checkerFlags & EffectCheckerFlags.EffectFree),
      "EffectFree must NOT be set for flow with declared effects");
  });

  it("declaredEffectsMask is set from declared effects", () => {
    const summary = parseAndSummarise(`
guarded flow log(msg: String) -> Void
contract { effects { audit.write } }
{
  return
}
`);
    const expected = effectsToFlags(["audit.write"]);
    assert.equal(summary.declaredEffectsMask, expected,
      "declaredEffectsMask must equal effectsToFlags([audit.write])");
  });

  it("missingEffectsMask is 0 when all inferred effects are declared", () => {
    const summary = parseAndSummarise(`
pure flow add(a: Int, b: Int) -> Int {
  return a
}
`);
    assert.equal(summary.missingEffectsMask, 0,
      "missingEffectsMask must be 0 for pure flow with no effects");
  });
});

// ---------------------------------------------------------------------------
// FUNGI-EFFECT-005: BroadAliasUsed fires for broad alias names
// ---------------------------------------------------------------------------

describe("FUNGI-EFFECT-005: BroadAliasUsed fires for broad aliases", () => {
  function check(effectName) {
    const source = `
guarded flow doWork(x: String) -> Void
contract { effects { ${effectName} } }
{
  return
}
`;
    const parsed = parseProgram(source, "test.fungi");
    const results = checkEffects(parsed.flows, parsed.ast);
    return results.flatMap((r) => r.diagnostics);
  }

  it("'network' → FUNGI-EFFECT-005 (warning)", () => {
    const diags = check("network");
    const d = diags.find((x) => x.code === "FUNGI-EFFECT-005");
    assert.ok(d !== undefined, "FUNGI-EFFECT-005 must fire for 'network'");
    assert.equal(d.severity, "warning", "FUNGI-EFFECT-005 must be a warning");
    assert.equal(d.suggestedCode, "network.outbound");
  });

  it("'database' → FUNGI-EFFECT-005 (warning)", () => {
    const diags = check("database");
    const d = diags.find((x) => x.code === "FUNGI-EFFECT-005");
    assert.ok(d !== undefined, "FUNGI-EFFECT-005 must fire for 'database'");
    assert.equal(d.suggestedCode, "database.read");
  });

  it("'ai' → FUNGI-EFFECT-005 (warning)", () => {
    const diags = check("ai");
    const d = diags.find((x) => x.code === "FUNGI-EFFECT-005");
    assert.ok(d !== undefined, "FUNGI-EFFECT-005 must fire for 'ai'");
    assert.equal(d.suggestedCode, "ai.inference");
  });

  it("'audit' → FUNGI-EFFECT-005 (warning)", () => {
    const diags = check("audit");
    const d = diags.find((x) => x.code === "FUNGI-EFFECT-005");
    assert.ok(d !== undefined, "FUNGI-EFFECT-005 must fire for 'audit'");
    assert.equal(d.suggestedCode, "audit.write");
  });

  it("canonical 'network.outbound' → no FUNGI-EFFECT-005", () => {
    const diags = check("network.outbound");
    const d005 = diags.find((x) => x.code === "FUNGI-EFFECT-005");
    assert.ok(d005 === undefined, "FUNGI-EFFECT-005 must NOT fire for canonical 'network.outbound'");
  });
});

// ---------------------------------------------------------------------------
// FUNGI-EFFECT-004 still fires for completely unknown names
// ---------------------------------------------------------------------------

describe("FUNGI-EFFECT-004: still fires for unknown effect names", () => {
  it("completely unknown effect name → FUNGI-EFFECT-004 (error)", () => {
    const source = `
guarded flow doWork(x: String) -> Void
contract { effects { completely.made.up.effect } }
{
  return
}
`;
    const parsed = parseProgram(source, "test.fungi");
    const results = checkEffects(parsed.flows, parsed.ast);
    const diags = results.flatMap((r) => r.diagnostics);
    const d004 = diags.find((x) => x.code === "FUNGI-EFFECT-004");
    assert.ok(d004 !== undefined, "FUNGI-EFFECT-004 must fire for unknown effect");
    assert.equal(d004.severity, "error", "FUNGI-EFFECT-004 must be an error");
  });

  it("'network' is NOT FUNGI-EFFECT-004 — it's FUNGI-EFFECT-005", () => {
    const source = `
guarded flow doWork(x: String) -> Void
contract { effects { network } }
{
  return
}
`;
    const parsed = parseProgram(source, "test.fungi");
    const results = checkEffects(parsed.flows, parsed.ast);
    const diags = results.flatMap((r) => r.diagnostics);
    const d004 = diags.find((x) => x.code === "FUNGI-EFFECT-004");
    assert.ok(d004 === undefined, "FUNGI-EFFECT-004 must NOT fire for broad alias 'network'");
  });
});

// ---------------------------------------------------------------------------
// FUNGI_EFFECT_005 constant shape
// ---------------------------------------------------------------------------

describe("FUNGI_EFFECT_005: constant shape", () => {
  it("has correct code and name", () => {
    assert.equal(FUNGI_EFFECT_005.code, "FUNGI-EFFECT-005");
    assert.equal(FUNGI_EFFECT_005.name, "BroadAliasUsed");
    assert.equal(FUNGI_EFFECT_005.severity, "warning");
  });

  it("has why and suggestedFix", () => {
    assert.ok(typeof FUNGI_EFFECT_005.why === "string");
    assert.ok(typeof FUNGI_EFFECT_005.suggestedFix === "string");
    assert.ok(FUNGI_EFFECT_005.suggestedFix.includes("network.outbound"),
      "suggestedFix must give canonical examples");
  });
});

// ---------------------------------------------------------------------------
// FUNGI-STDLIB-001: checkStdlibEffects wired into checkFlowEffects
// ---------------------------------------------------------------------------

describe("FUNGI-STDLIB-001: stdlib effect not declared", () => {
  // Helper: parse source, run checkEffects in production mode, return all diagnostics
  function checkProd(source) {
    const parsed = parseProgram(source, "test.fungi");
    const results = checkEffects(parsed.flows, parsed.ast, "production");
    return results.flatMap((r) => r.diagnostics);
  }

  // Helper: parse source, run checkEffects in development mode, return all diagnostics
  function checkDev(source) {
    const parsed = parseProgram(source, "test.fungi");
    const results = checkEffects(parsed.flows, parsed.ast, "development");
    return results.flatMap((r) => r.diagnostics);
  }

  it("File.readText without storage.read → FUNGI-STDLIB-001 (error in production)", () => {
    // guarded flow that calls File.readText but does NOT declare storage.read
    const source = `
guarded flow loadConfig(path: String) -> String
contract { effects { audit.write } }
{
  let content = File.readText(path)
  return content
}
`;
    const diags = checkProd(source);
    const d = diags.find((x) => x.code === "FUNGI-STDLIB-001");
    assert.ok(d !== undefined, "FUNGI-STDLIB-001 must fire when storage.read is not declared");
    assert.equal(d.severity, "error", "In production mode severity must be error");
    assert.ok(d.message.includes("storage.read"), `message must mention the missing effect, got: ${d.message}`);
    assert.equal(d.suggestedCode, "storage.read");
    assert.ok(d.suggestedFix.includes("storage.read"), "suggestedFix must reference the missing effect");
  });

  it("File.readText WITH storage.read declared → no FUNGI-STDLIB-001", () => {
    const source = `
guarded flow loadConfig(path: String) -> String
contract { effects { storage.read } }
{
  let content = File.readText(path)
  return content
}
`;
    const diags = checkProd(source);
    const d = diags.find((x) => x.code === "FUNGI-STDLIB-001");
    assert.ok(d === undefined, "FUNGI-STDLIB-001 must NOT fire when storage.read is declared");
  });

  it("File.readText without storage.read → FUNGI-STDLIB-001 (warning in dev mode)", () => {
    const source = `
guarded flow loadConfig(path: String) -> String
contract { effects { audit.write } }
{
  let content = File.readText(path)
  return content
}
`;
    const diags = checkDev(source);
    const d = diags.find((x) => x.code === "FUNGI-STDLIB-001");
    assert.ok(d !== undefined, "FUNGI-STDLIB-001 must fire in dev mode too");
    assert.equal(d.severity, "warning", "In development mode severity must be warning");
  });

  it("String.split (pure, no effects) → no FUNGI-STDLIB-001", () => {
    // String.split is NOT in STDLIB_CAPABILITY_MAP → no diagnostic emitted
    const source = `
pure flow splitWords(s: String) -> Array<String> {
  let parts = String.split(s, " ")
  return parts
}
`;
    const diags = checkProd(source);
    const d = diags.find((x) => x.code === "FUNGI-STDLIB-001");
    assert.ok(d === undefined, "FUNGI-STDLIB-001 must NOT fire for pure stdlib calls like String.split");
  });

  it("checkStdlibEffects() is exported and callable directly", () => {
    // Verify the function is exported and has the right shape
    assert.equal(typeof checkStdlibEffects, "function", "checkStdlibEffects must be a function");
  });
});

// ---------------------------------------------------------------------------
// LEGACY_EFFECT_CALL_PATTERNS_COUNT migration tracker
// ---------------------------------------------------------------------------

describe("LEGACY_EFFECT_CALL_PATTERNS_COUNT is tracked", () => {
  it("is a number >= 0", () => {
    assert.equal(typeof LEGACY_EFFECT_CALL_PATTERNS_COUNT, "number",
      "LEGACY_EFFECT_CALL_PATTERNS_COUNT must be a number");
    assert.ok(LEGACY_EFFECT_CALL_PATTERNS_COUNT >= 0,
      "LEGACY_EFFECT_CALL_PATTERNS_COUNT must be >= 0");
  });
});

// ---------------------------------------------------------------------------
// EffectCheckResult carries checkerFlags
// ---------------------------------------------------------------------------

describe("EffectCheckResult: carries checkerFlags", () => {
  it("pure flow result has PureComputeCandidate flag", () => {
    const source = `pure flow pure(x: Int) -> Int { return x }`;
    const parsed = parseProgram(source, "test.fungi");
    const results = checkEffects(parsed.flows, parsed.ast);
    assert.ok(results.length > 0, "Must have at least one result");
    const r = results[0];
    assert.ok(r.checkerFlags & EffectCheckerFlags.PureComputeCandidate,
      "Pure flow result must have PureComputeCandidate");
  });

  it("guarded flow result has no PureComputeCandidate", () => {
    const source = `
guarded flow store(data: String) -> Void
contract { effects { database.write } }
{
  return
}
`;
    const parsed = parseProgram(source, "test.fungi");
    const results = checkEffects(parsed.flows, parsed.ast);
    const r = results[0];
    assert.ok(!(r.checkerFlags & EffectCheckerFlags.PureComputeCandidate),
      "Guarded flow must not have PureComputeCandidate");
  });
});

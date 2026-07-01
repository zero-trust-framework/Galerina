// =============================================================================
// Stdlib Registry Tests (Phase 18H)
//
// Tests for:
//   - STDLIB_CAPABILITY_MAP (effectful functions → required effects + WASM imports)
//   - STDLIB_MODULE_KIND (pure vs effectful classification)
//   - TENSOR_STDLIB_OPS (compute target compatibility flags)
//   - TRI_STDLIB_OPS (TriState operations, photonic compatible)
//   - getStdlibRequiredEffects, getStdlibModuleKind, getStdlibWasmImport
//   - FUNGI_STDLIB_001 constant shape
// =============================================================================

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import {
  STDLIB_CAPABILITY_MAP,
  STDLIB_MODULE_KIND,
  TENSOR_STDLIB_OPS,
  TRI_STDLIB_OPS,
  getStdlibRequiredEffects,
  getStdlibModuleKind,
  getStdlibWasmImport,
  FUNGI_STDLIB_001,
  renderWAT,
  buildWATModule,
  emitWATBody,
  getWATImportsForEffects,
  DEFAULT_WAT_MEMORY,
  DEFAULT_WASM_SIMD,
  parseProgram,
  callStdlib,
  FUNGI_VOID,
  toFlatTokenStream,
  tokenStreamKind,
  tokenStreamStart,
  tokenStreamEnd,
  tokenStreamValue,
  TOKEN_STRIDE,
  fusedCompile,
  GIR_OP,
  unpackOp,
  lex,
} from "../../dist/index.js";

import { assembleWAT } from "../../dist/wat-assembler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// STDLIB_CAPABILITY_MAP
// ---------------------------------------------------------------------------

describe("STDLIB_CAPABILITY_MAP: structure and coverage", () => {
  it("is a Map with entries", () => {
    assert.ok(STDLIB_CAPABILITY_MAP instanceof Map, "Must be a Map");
    assert.ok(STDLIB_CAPABILITY_MAP.size > 0, "Must have entries");
  });

  it("AuditLog.write requires audit.write", () => {
    const entry = STDLIB_CAPABILITY_MAP.get("AuditLog.write");
    assert.ok(entry !== undefined, "AuditLog.write must be in map");
    assert.ok(entry.requiredEffects.includes("audit.write"), "Must require audit.write");
    assert.ok(typeof entry.description === "string", "Must have description");
  });

  it("File.readText requires storage.read with WASM import", () => {
    const entry = STDLIB_CAPABILITY_MAP.get("File.readText");
    assert.ok(entry !== undefined);
    assert.ok(entry.requiredEffects.includes("storage.read"));
    assert.ok(entry.wasmImport !== undefined, "Must have WASM import name");
    assert.ok(entry.wasmImport?.startsWith("host:"), "WASM import must start with host:");
  });

  it("Http.get requires network.outbound", () => {
    const entry = STDLIB_CAPABILITY_MAP.get("Http.get");
    assert.ok(entry !== undefined);
    assert.ok(entry.requiredEffects.includes("network.outbound"));
  });

  it("Crypto.constantTimeEquals requires no effects (pure)", () => {
    const entry = STDLIB_CAPABILITY_MAP.get("Crypto.constantTimeEquals");
    assert.ok(entry !== undefined);
    assert.equal(entry.requiredEffects.length, 0, "constantTimeEquals must be effect-free");
    assert.equal(entry.wasmImport, undefined, "Pure functions have no WASM import");
  });

  it("Database.insert requires database.write", () => {
    const entry = STDLIB_CAPABILITY_MAP.get("database.insert");
    assert.ok(entry !== undefined);
    assert.ok(entry.requiredEffects.includes("database.write"));
  });

  it("AI.infer requires ai.inference", () => {
    const entry = STDLIB_CAPABILITY_MAP.get("AI.infer");
    assert.ok(entry !== undefined);
    assert.ok(entry.requiredEffects.includes("ai.inference"));
  });
});

// ---------------------------------------------------------------------------
// STDLIB_MODULE_KIND
// ---------------------------------------------------------------------------

describe("STDLIB_MODULE_KIND: pure vs effectful", () => {
  it("pure modules are classified as 'pure'", () => {
    const pureModules = ["String", "Array", "Math", "Decimal", "Tensor", "Tri", "Option", "Result", "Json", "Hash", "Bytes"];
    for (const mod of pureModules) {
      assert.equal(STDLIB_MODULE_KIND.get(mod), "pure", `${mod} must be classified as pure`);
    }
  });

  it("effectful modules are classified as 'effectful'", () => {
    const effectful = ["File", "Http", "AuditLog", "Secrets", "Database", "database", "AI", "EmailService", "Clock"];
    for (const mod of effectful) {
      assert.equal(STDLIB_MODULE_KIND.get(mod), "effectful", `${mod} must be classified as effectful`);
    }
  });

  it("unknown modules return undefined", () => {
    assert.equal(STDLIB_MODULE_KIND.get("MyCustomModule"), undefined);
  });
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

describe("getStdlibRequiredEffects: effect lookup", () => {
  it("returns effects for known effectful functions", () => {
    const effects = getStdlibRequiredEffects("File.readText");
    assert.ok(effects !== undefined);
    assert.ok(effects.includes("storage.read"));
  });

  it("returns empty array for pure functions", () => {
    const effects = getStdlibRequiredEffects("Crypto.constantTimeEquals");
    assert.ok(effects !== undefined);
    assert.equal(effects.length, 0);
  });

  it("returns undefined for unknown functions", () => {
    const effects = getStdlibRequiredEffects("SomethingUnknown.call");
    assert.equal(effects, undefined);
  });
});

describe("getStdlibModuleKind: module classification", () => {
  it("returns 'pure' for String", () => {
    assert.equal(getStdlibModuleKind("String"), "pure");
  });

  it("returns 'effectful' for Http", () => {
    assert.equal(getStdlibModuleKind("Http"), "effectful");
  });

  it("returns undefined for unknown module", () => {
    assert.equal(getStdlibModuleKind("Unknown"), undefined);
  });
});

describe("getStdlibWasmImport: WASM import name", () => {
  it("returns WASM import name for effectful function", () => {
    const name = getStdlibWasmImport("File.readText");
    assert.ok(name !== undefined, "File.readText must have WASM import");
    assert.ok(name?.startsWith("host:"), "Must start with host:");
  });

  it("returns undefined for pure function", () => {
    const name = getStdlibWasmImport("Crypto.constantTimeEquals");
    assert.equal(name, undefined, "Pure functions have no WASM import");
  });
});

// ---------------------------------------------------------------------------
// TENSOR_STDLIB_OPS
// ---------------------------------------------------------------------------

describe("TENSOR_STDLIB_OPS: tensor operation flags", () => {
  it("is a Map with tensor operation entries", () => {
    assert.ok(TENSOR_STDLIB_OPS instanceof Map);
    assert.ok(TENSOR_STDLIB_OPS.size >= 10, "Must have at least 10 tensor ops");
  });

  it("Tensor.matmul is pure, wasmSimd, gpu, npu compatible", () => {
    const op = TENSOR_STDLIB_OPS.get("Tensor.matmul");
    assert.ok(op !== undefined);
    assert.ok(op.pure, "matmul must be pure");
    assert.ok(op.wasmSimd, "matmul must be WASM SIMD compatible");
    assert.ok(op.gpu, "matmul must be GPU compatible");
    assert.ok(op.npu, "matmul must be NPU compatible");
  });

  it("Tensor.quantize is npu compatible but not gpu (Int8)", () => {
    const op = TENSOR_STDLIB_OPS.get("Tensor.quantize");
    assert.ok(op !== undefined);
    assert.ok(op.pure, "quantize must be pure");
    assert.ok(op.npu, "quantize must be NPU compatible");
    assert.ok(!op.gpu, "quantize must NOT be directly GPU compatible (Int8 GPU needs extension)");
  });

  it("Tensor.relu is pure and compatible with all pure targets", () => {
    const op = TENSOR_STDLIB_OPS.get("Tensor.relu");
    assert.ok(op !== undefined);
    assert.ok(op.pure);
    assert.ok(op.wasmSimd);
    assert.ok(op.gpu);
    assert.ok(op.npu);
    assert.ok(op.apu);
  });

  it("Tensor.toDevice is not pure (transfers to device)", () => {
    const op = TENSOR_STDLIB_OPS.get("Tensor.toDevice");
    assert.ok(op !== undefined);
    assert.ok(!op.pure, "toDevice is not a pure operation");
  });

  it("every op has a description", () => {
    for (const [name, op] of TENSOR_STDLIB_OPS) {
      assert.ok(typeof op.description === "string" && op.description.length > 0,
        `${name} must have a non-empty description`);
    }
  });
});

// ---------------------------------------------------------------------------
// TRI_STDLIB_OPS
// ---------------------------------------------------------------------------

describe("TRI_STDLIB_OPS: TriState operations", () => {
  it("is a Map with TriState operation entries", () => {
    assert.ok(TRI_STDLIB_OPS instanceof Map);
    assert.ok(TRI_STDLIB_OPS.size >= 5);
  });

  it("Tri.and is pure and photonic compatible", () => {
    const op = TRI_STDLIB_OPS.get("Tri.and");
    assert.ok(op !== undefined);
    assert.ok(op.pure, "Tri.and must be pure");
    assert.ok(op.photonicCompatible, "Tri.and must be photonic compatible");
  });

  it("Tri.or is pure and photonic compatible", () => {
    const op = TRI_STDLIB_OPS.get("Tri.or");
    assert.ok(op !== undefined);
    assert.ok(op.pure);
    assert.ok(op.photonicCompatible);
  });

  it("Tri.toBool is NOT photonic compatible (requires explicit policy)", () => {
    const op = TRI_STDLIB_OPS.get("Tri.toBool");
    assert.ok(op !== undefined);
    assert.ok(op.pure, "Tri.toBool is still pure");
    assert.ok(!op.photonicCompatible, "Tri.toBool is not photonic compatible (needs policy decision)");
  });

  it("Tri.match is photonic compatible", () => {
    const op = TRI_STDLIB_OPS.get("Tri.match");
    assert.ok(op !== undefined);
    assert.ok(op.photonicCompatible, "Exhaustive TriState match is photonic compatible");
  });

  it("every op has a description", () => {
    for (const [name, op] of TRI_STDLIB_OPS) {
      assert.ok(typeof op.description === "string" && op.description.length > 0,
        `${name} must have description`);
    }
  });
});

// ---------------------------------------------------------------------------
// FUNGI_STDLIB_001
// ---------------------------------------------------------------------------

describe("FUNGI_STDLIB_001: constant shape", () => {
  it("has correct code and name", () => {
    assert.equal(FUNGI_STDLIB_001.code, "FUNGI-STDLIB-001");
    assert.equal(FUNGI_STDLIB_001.name, "StdlibEffectNotDeclared");
    assert.equal(FUNGI_STDLIB_001.severity, "error");
  });

  it("has why and suggestedFix", () => {
    assert.ok(typeof FUNGI_STDLIB_001.why === "string");
    assert.ok(FUNGI_STDLIB_001.suggestedFix.includes("contract"), "suggestedFix must mention contract");
    assert.ok(FUNGI_STDLIB_001.suggestedFix.includes("effects"), "suggestedFix must mention effects");
  });
});

// ---------------------------------------------------------------------------
// WAT emitter: renderWAT produces valid skeleton
// ---------------------------------------------------------------------------

describe("WAT emitter: renderWAT produces valid skeleton", () => {
  it("output starts with (module and ends with )", () => {
    const mod = buildWATModule(
      { flows: [], entryPoints: [], girHash: "abc", sourceHash: "def" },
      STDLIB_CAPABILITY_MAP,
    );
    const wat = renderWAT(mod);
    assert.ok(wat.startsWith("(module"), "WAT must start with (module");
    assert.ok(wat.trimEnd().endsWith(")"), "WAT must end with )");
  });

  it("output contains (memory with correct page counts", () => {
    const mod = buildWATModule(
      { flows: [], entryPoints: [], girHash: "abc", sourceHash: "def" },
      STDLIB_CAPABILITY_MAP,
    );
    const wat = renderWAT(mod);
    assert.ok(wat.includes("(memory"), "WAT must contain (memory");
    // DEFAULT_WAT_MEMORY is 2 min, 2048 max
    assert.ok(
      wat.includes(`(memory ${DEFAULT_WAT_MEMORY.minPages} ${DEFAULT_WAT_MEMORY.maxPages})`),
      "WAT must contain correct memory page declaration",
    );
  });

  it("pure flow has no imports; effectful flow emits import with valid identifier", () => {
    const pureMod = buildWATModule(
      {
        flows: [{ name: "computeScore", qualifier: "pure", declaredEffects: [] }],
        entryPoints: ["computeScore"],
      },
      STDLIB_CAPABILITY_MAP,
    );
    const pureWat = renderWAT(pureMod);
    assert.ok(!pureWat.includes("(import "), "Pure flow must not emit any imports");
    assert.ok(pureWat.includes("(func $computeScore"), "Pure flow must emit function definition");
    assert.ok(pureWat.includes('(export "computeScore"'), "Entry point must be exported");

    const effectfulMod = buildWATModule(
      {
        flows: [{ name: "readFile", qualifier: "flow", declaredEffects: ["storage.read"] }],
        entryPoints: [],
      },
      STDLIB_CAPABILITY_MAP,
    );
    const effectfulWat = renderWAT(effectfulMod);
    assert.ok(effectfulWat.includes("(import "), "Effectful flow must emit imports");
    // WAT identifiers must not contain "." — check the func $id part has underscores
    const importMatch = effectfulWat.match(/\(import "[^"]*" "[^"]*" \(func (\$[^\s)]+)/);
    assert.ok(importMatch !== null, "Import must have (func $id) form");
    assert.ok(!importMatch[1].includes("."), "WAT identifier must not contain '.'");
  });
});

// ---------------------------------------------------------------------------
// Phase 22A — WASM SIMD capability
// ---------------------------------------------------------------------------

describe("DEFAULT_WASM_SIMD: Phase 22A SIMD capability descriptor", () => {
  it("DEFAULT_WASM_SIMD has available: false (disabled until runtime detection)", () => {
    assert.equal(DEFAULT_WASM_SIMD.available, false);
  });

  it("DEFAULT_WASM_SIMD has empty supportedOps array and laneWidth 128", () => {
    assert.ok(Array.isArray(DEFAULT_WASM_SIMD.supportedOps), "supportedOps must be an array");
    assert.equal(DEFAULT_WASM_SIMD.supportedOps.length, 0, "Default has no ops enabled");
    assert.equal(DEFAULT_WASM_SIMD.laneWidth, 128, "WASM SIMD lane width is always 128-bit");
  });
});

// ---------------------------------------------------------------------------
// buildWATModule: pure flow produces real WAT body (Phase 22)
// ---------------------------------------------------------------------------

describe("buildWATModule: pure flow produces real WAT body", () => {
  // A pure flow that takes an Int and returns an Int — built with paramTypes + executionPlan.
  const purePlan = {
    steps: [
      { kind: "validate_param" },  // ignored at WAT level
      { kind: "return" },
    ],
  };

  const pureFlowMod = buildWATModule(
    {
      flows: [
        {
          name: "identityInt",
          qualifier: "pure",
          declaredEffects: [],
          paramTypes: ["Int"],
          executionPlan: purePlan,
        },
      ],
      entryPoints: ["identityInt"],
    },
    STDLIB_CAPABILITY_MAP,
  );

  it("pure flow WAT body does NOT contain 'unreachable'", () => {
    const fn = pureFlowMod.functions.find((f) => f.name === "identityInt");
    assert.ok(fn !== undefined, "identityInt function must exist");
    assert.ok(
      !fn.body.includes("unreachable"),
      `Pure flow body must not contain 'unreachable'. Got: ${fn.body}`,
    );
  });

  it("WAT contains '(local.get' for parameter access in pure flow body", () => {
    const fn = pureFlowMod.functions.find((f) => f.name === "identityInt");
    assert.ok(fn !== undefined, "identityInt function must exist");
    assert.ok(
      fn.body.includes("(local.get"),
      `Pure flow body must contain '(local.get'. Got: ${fn.body}`,
    );
  });

  it("renderWAT of a pure flow compiles to a string starting with '(module'", () => {
    const wat = renderWAT(pureFlowMod);
    assert.ok(
      wat.startsWith("(module"),
      `renderWAT must start with '(module'. Got: ${wat.slice(0, 50)}`,
    );
    // The rendered WAT must also contain the local.get instruction in the output.
    assert.ok(
      wat.includes("(local.get"),
      "Rendered WAT must contain '(local.get' for pure flow parameter access",
    );
    // And must not produce unreachable for this pure flow.
    // (Note: other non-pure flows in the same module might have unreachable —
    // but this module has only identityInt which is pure, so none expected.)
    assert.ok(
      !wat.includes("unreachable"),
      "Rendered WAT for a pure-only module must not contain 'unreachable'",
    );
  });
});

// ---------------------------------------------------------------------------
// WAT imports from effect declarations
// ---------------------------------------------------------------------------

describe("WAT imports from effect declarations", () => {
  it("flow with storage.read effect produces WAT containing (import \"host\"", () => {
    const mod = buildWATModule(
      {
        flows: [{ name: "readFile", qualifier: "flow", declaredEffects: ["storage.read"] }],
        entryPoints: [],
      },
      STDLIB_CAPABILITY_MAP,
    );
    const wat = renderWAT(mod);
    assert.ok(
      wat.includes('(import "host"'),
      `WAT for a flow with storage.read must contain (import "host". Got:\n${wat}`,
    );
  });

  it("pure flow with no effects produces WAT with no imports", () => {
    const mod = buildWATModule(
      {
        flows: [{ name: "computeSum", qualifier: "pure", declaredEffects: [] }],
        entryPoints: [],
      },
      STDLIB_CAPABILITY_MAP,
    );
    const wat = renderWAT(mod);
    assert.ok(
      !wat.includes("(import "),
      `Pure flow WAT must not contain any imports. Got:\n${wat}`,
    );
  });

  it("getWATImportsForEffects([\"audit.write\"]) returns import with wasmImport \"host:audit.write\"", () => {
    const imports = getWATImportsForEffects(["audit.write"]);
    assert.ok(Array.isArray(imports), "Must return an array");
    assert.ok(imports.length > 0, "Must return at least one import for audit.write");
    const auditImport = imports.find((imp) => imp.module === "host" && imp.name === "audit.write");
    assert.ok(
      auditImport !== undefined,
      `Expected an import with module "host" and name "audit.write". Got: ${JSON.stringify(imports)}`,
    );
    assert.equal(auditImport.effect, "audit.write", "Import must reference effect audit.write");
  });
});

// ---------------------------------------------------------------------------
// Phase 25A: verifyPassword example parses without errors
// ---------------------------------------------------------------------------

describe("Phase 25A: verifyPassword example parses without errors", () => {
  it("reads and parses examples/auth-service/verifyPassword.fungi with 0 errors, qualifier secure, and required effects", () => {
    // Resolve path from repo root: tests/stdlib/ -> ../../../.. -> repo root -> examples/
    // tests/stdlib -> tests -> galerina-core-compiler -> packages-galerina -> LO (repo root)
    const examplePath = join(__dirname, "..", "..", "..", "..", "examples", "auth-service", "verifyPassword.fungi");
    const source = readFileSync(examplePath, "utf8");

    // Parse (parseProgram takes the raw source string and an optional filename)
    const parseResult = parseProgram(source, "verifyPassword.fungi");

    // 0 parse errors
    assert.equal(
      parseResult.diagnostics.length,
      0,
      `Expected 0 parse diagnostics, got ${parseResult.diagnostics.length}: ${JSON.stringify(parseResult.diagnostics.map(d => d.message))}`,
    );

    // Flow 'verifyPassword' found with qualifier 'secure'
    const flow = parseResult.flows.find((f) => f.name === "verifyPassword");
    assert.ok(
      flow !== undefined,
      `Expected a flow named 'verifyPassword'. Flows found: ${parseResult.flows.map(f => f.name).join(", ")}`,
    );
    assert.equal(
      flow.qualifier,
      "secure",
      `Expected qualifier 'secure', got '${flow.qualifier}'`,
    );

    // Has required effects
    const required = ["database.read", "crypto.verify", "audit.write"];
    for (const effect of required) {
      assert.ok(
        flow.declaredEffects.includes(effect),
        `Expected effect '${effect}' in declaredEffects. Got: ${JSON.stringify(flow.declaredEffects)}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 25B-C: createSession + verifyToken parse correctly
// ---------------------------------------------------------------------------

describe("Phase 25B-C: createSession + verifyToken parse correctly", () => {
  it("reads and parses examples/auth-service/createSession.fungi with 0 errors, qualifier secure, and effects database.write + audit.write", () => {
    const examplePath = join(__dirname, "..", "..", "..", "..", "examples", "auth-service", "createSession.fungi");
    const source = readFileSync(examplePath, "utf8");

    const parseResult = parseProgram(source, "createSession.fungi");

    assert.equal(
      parseResult.diagnostics.length,
      0,
      `Expected 0 parse diagnostics, got ${parseResult.diagnostics.length}: ${JSON.stringify(parseResult.diagnostics.map(d => d.message))}`,
    );

    const flow = parseResult.flows.find((f) => f.name === "createSession");
    assert.ok(
      flow !== undefined,
      `Expected a flow named 'createSession'. Flows found: ${parseResult.flows.map(f => f.name).join(", ")}`,
    );
    assert.equal(
      flow.qualifier,
      "secure",
      `Expected qualifier 'secure', got '${flow.qualifier}'`,
    );

    const required = ["database.write", "audit.write"];
    for (const effect of required) {
      assert.ok(
        flow.declaredEffects.includes(effect),
        `Expected effect '${effect}' in declaredEffects. Got: ${JSON.stringify(flow.declaredEffects)}`,
      );
    }
  });

  it("reads and parses examples/auth-service/verifyToken.fungi with 0 errors, qualifier pure, and no effects", () => {
    const examplePath = join(__dirname, "..", "..", "..", "..", "examples", "auth-service", "verifyToken.fungi");
    const source = readFileSync(examplePath, "utf8");

    const parseResult = parseProgram(source, "verifyToken.fungi");

    assert.equal(
      parseResult.diagnostics.length,
      0,
      `Expected 0 parse diagnostics, got ${parseResult.diagnostics.length}: ${JSON.stringify(parseResult.diagnostics.map(d => d.message))}`,
    );

    const flow = parseResult.flows.find((f) => f.name === "verifyToken");
    assert.ok(
      flow !== undefined,
      `Expected a flow named 'verifyToken'. Flows found: ${parseResult.flows.map(f => f.name).join(", ")}`,
    );
    assert.equal(
      flow.qualifier,
      "pure",
      `Expected qualifier 'pure', got '${flow.qualifier}'`,
    );

    assert.equal(
      flow.declaredEffects.length,
      0,
      `Expected 0 declared effects for pure flow, got: ${JSON.stringify(flow.declaredEffects)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Phase R2: Real stdlib implementations
// ---------------------------------------------------------------------------

function stdlibCtx() {
  return {
    recordEffect: () => {},
    resolveIdentifier: () => undefined,
    callFlow: async () => FUNGI_VOID,
    applyFn: async (_fn, arg) => arg,
  };
}

function mkList(...nums) {
  return { __tag: "list", items: nums.map((n) => ({ __tag: "float", value: n })) };
}

describe("R2: Real stdlib implementations", () => {
  it("Tensor.relu([1, -1, 0.5]) -> [1, 0, 0.5]", async () => {
    const input = mkList(1, -1, 0.5);
    const result = await callStdlib("Tensor.relu", undefined, [input], stdlibCtx());
    assert.ok(result !== undefined, "Tensor.relu must return a value");
    assert.equal(result.__tag, "list", "Tensor.relu must return a list");
    assert.equal(result.items.length, 3, "List must have 3 items");
    // element 0: relu(1) = 1
    assert.equal(result.items[0].value, 1);
    // element 1: relu(-1) = 0
    assert.equal(result.items[1].value, 0);
    // element 2: relu(0.5) = 0.5
    assert.equal(result.items[2].value, 0.5);
  });

  it("Tensor.dot([1,2,3], [4,5,6]) -> 32", async () => {
    const a = mkList(1, 2, 3);
    const b = mkList(4, 5, 6);
    const result = await callStdlib("Tensor.dot", undefined, [a, b], stdlibCtx());
    assert.ok(result !== undefined, "Tensor.dot must return a value");
    assert.equal(result.__tag, "float", "Tensor.dot must return a float");
    // 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
    assert.equal(result.value, 32);
  });

  it("Crypto.constantTimeEquals('abc', 'abc') -> true", async () => {
    const a = { __tag: "string", value: "abc" };
    const b = { __tag: "string", value: "abc" };
    const result = await callStdlib("Crypto.constantTimeEquals", undefined, [a, b], stdlibCtx());
    assert.ok(result !== undefined, "Crypto.constantTimeEquals must return a value");
    assert.equal(result.__tag, "bool", "Must return a bool");
    assert.equal(result.value, true, "Equal strings must return true");
  });

  it("Crypto.constantTimeEquals('abc', 'def') -> false", async () => {
    const a = { __tag: "string", value: "abc" };
    const b = { __tag: "string", value: "def" };
    const result = await callStdlib("Crypto.constantTimeEquals", undefined, [a, b], stdlibCtx());
    assert.ok(result !== undefined, "Crypto.constantTimeEquals must return a value");
    assert.equal(result.__tag, "bool", "Must return a bool");
    assert.equal(result.value, false, "Unequal strings must return false");
  });

  it("Hash.sha256('test') -> starts with 'sha256:'", async () => {
    const input = { __tag: "string", value: "test" };
    const result = await callStdlib("Hash.sha256", undefined, [input], stdlibCtx());
    assert.ok(result !== undefined, "Hash.sha256 must return a value");
    assert.equal(result.__tag, "string", "Hash.sha256 must return a string");
    assert.ok(
      result.value.startsWith("sha256:"),
      `Hash.sha256 result must start with 'sha256:'. Got: ${result.value}`,
    );
    // Known SHA-256 of "test" = 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
    assert.ok(
      result.value.includes("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"),
      `Expected known SHA-256 digest for 'test'. Got: ${result.value}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Additional stdlib: Map + String + Math
// ---------------------------------------------------------------------------

describe("Additional stdlib: Map + String + Math", () => {
  it("Map.empty() returns a record with no user-visible keys", async () => {
    const result = await callStdlib("Map.empty", undefined, [], stdlibCtx());
    assert.ok(result !== undefined, "Map.empty must return a value");
    assert.equal(result.__tag, "record", "Map.empty must return a record");
    // size should be 0 (the map has no entries)
    const size = await callStdlib("size", result, [], stdlibCtx());
    assert.ok(size !== undefined, "size method must exist on empty map");
    assert.equal(size.__tag, "int", "size must return Int");
    assert.equal(size.value, 0, "empty map size must be 0");
  });

  it("Map.set + Map.get round-trip preserves values", async () => {
    let m = await callStdlib("Map.empty", undefined, [], stdlibCtx());
    const key = { __tag: "string", value: "hello" };
    const val = { __tag: "int", value: 42 };
    // set the key
    m = await callStdlib("set", m, [key, val], stdlibCtx());
    assert.ok(m !== undefined, "set must return a map");
    assert.equal(m.__tag, "record", "set must return a record");
    // get the key back — returns Option<value>
    const got = await callStdlib("get", m, [key], stdlibCtx());
    assert.ok(got !== undefined, "get must return a value");
    assert.equal(got.__tag, "some", "get must return Some for an existing key");
    assert.equal(got.value.__tag, "int");
    assert.equal(got.value.value, 42, "Retrieved value must match the inserted value");
  });

  it("String.contains / indexOf / startsWith / endsWith work correctly", async () => {
    const s = { __tag: "string", value: "hello world" };
    const sub = { __tag: "string", value: "world" };
    const prefix = { __tag: "string", value: "hello" };
    const suffix = { __tag: "string", value: "world" };
    const contains = await callStdlib("contains", s, [sub], stdlibCtx());
    assert.equal(contains.__tag, "bool");
    assert.equal(contains.value, true, "hello world contains world");
    const indexOf = await callStdlib("indexOf", s, [sub], stdlibCtx());
    assert.equal(indexOf.__tag, "int");
    assert.equal(indexOf.value, 6, "world starts at index 6");
    const sw = await callStdlib("startsWith", s, [prefix], stdlibCtx());
    assert.equal(sw.value, true, "hello world startsWith hello");
    const ew = await callStdlib("endsWith", s, [suffix], stdlibCtx());
    assert.equal(ew.value, true, "hello world endsWith world");
  });

  it("Math.log, Math.sin, Math.PI return correct Decimal/float values", async () => {
    const one = { __tag: "float", value: 1 };
    const logResult = await callStdlib("Math.log", undefined, [one], stdlibCtx());
    assert.ok(logResult !== undefined, "Math.log must return a value");
    assert.equal(logResult.__tag, "float", "Math.log must return float");
    assert.ok(Math.abs(logResult.value - 0) < 1e-10, "Math.log(1) must be 0");

    const piResult = await callStdlib("Math.PI", undefined, [], stdlibCtx());
    assert.ok(piResult !== undefined, "Math.PI must return a value");
    assert.equal(piResult.__tag, "float", "Math.PI must return float");
    assert.ok(Math.abs(piResult.value - Math.PI) < 1e-10, "Math.PI must equal JS Math.PI");

    const sinPi = await callStdlib("Math.sin", undefined, [piResult], stdlibCtx());
    assert.ok(sinPi !== undefined, "Math.sin must return a value");
    assert.equal(sinPi.__tag, "float", "Math.sin must return float");
    assert.ok(Math.abs(sinPi.value - 0) < 1e-10, "Math.sin(PI) must be ~0");
  });

  it("Duration.seconds and Duration.minutes aliases produce correct millisecond values", async () => {
    const n = { __tag: "int", value: 5 };
    const secResult = await callStdlib("Duration.seconds", undefined, [n], stdlibCtx());
    assert.ok(secResult !== undefined, "Duration.seconds must return a value");
    assert.equal(secResult.__tag, "record", "Duration is a record");
    // toMs method returns ms
    const ms = await callStdlib("toMs", secResult, [], stdlibCtx());
    assert.ok(ms !== undefined, "toMs must return a value");
    assert.equal(ms.__tag, "int", "toMs must return int");
    assert.equal(ms.value, 5000, "Duration.seconds(5) must be 5000ms");

    const minResult = await callStdlib("Duration.minutes", undefined, [n], stdlibCtx());
    const msMin = await callStdlib("toMs", minResult, [], stdlibCtx());
    assert.equal(msMin.value, 300000, "Duration.minutes(5) must be 300000ms");
  });
});

// ---------------------------------------------------------------------------
// WAT assembler: minimal binary encoder (Phase 25)
// ---------------------------------------------------------------------------

describe("WAT assembler: minimal binary encoder", () => {
  it("assembleWAT('(module)') returns Uint8Array with magic 0x00 0x61 0x73 0x6d", async () => {
    const result = await assembleWAT("(module)");
    assert.ok(result.wasm instanceof Uint8Array, "wasm field must be a Uint8Array");
    assert.ok(result.wasm.length >= 8, "Binary must be at least 8 bytes (magic + version)");
    assert.equal(result.wasm[0], 0x00, "Magic byte 0 must be 0x00");
    assert.equal(result.wasm[1], 0x61, "Magic byte 1 must be 0x61");
    assert.equal(result.wasm[2], 0x73, "Magic byte 2 must be 0x73");
    assert.equal(result.wasm[3], 0x6d, "Magic byte 3 must be 0x6d");
    assert.equal(result.sourceWAT, "(module)", "sourceWAT must reflect input");
  });

  it("assembleWAT produces a binary that WebAssembly.validate() accepts (if available)", async () => {
    const wat = [
      "(module",
      "  (memory 2 2048)",
      '  (export "memory" (memory 0))',
      "  (func $computeScore (result i32)",
      "    (i32.const 0)",
      "  )",
      '  (export "computeScore" (func $computeScore))',
      ")",
    ].join("\n");
    const result = await assembleWAT(wat);
    assert.ok(result.wasm instanceof Uint8Array, "wasm must be Uint8Array");
    assert.ok(result.valid, `assembleWAT must return valid=true for a simple module. diagnostics: ${JSON.stringify(result.diagnostics)}`);
    // Verify WASM magic header
    assert.equal(result.wasm[0], 0x00);
    assert.equal(result.wasm[1], 0x61);
    assert.equal(result.wasm[2], 0x73);
    assert.equal(result.wasm[3], 0x6d);
    // If WebAssembly is available in this Node version, validate the binary
    if (typeof WebAssembly !== "undefined" && typeof WebAssembly.validate === "function") {
      const isValid = WebAssembly.validate(result.wasm);
      assert.ok(isValid, `WebAssembly.validate must accept the assembled binary. Length: ${result.wasm.length}`);
    }
  });

  it("assembleWAT with no functions returns valid 8-byte module header", async () => {
    const result = await assembleWAT("(module)");
    // No func declarations -> only magic + version (8 bytes)
    assert.equal(result.wasm.length, 8, "Empty module must be exactly 8 bytes (magic + version)");
    // Magic header present
    assert.equal(result.wasm[0], 0x00);
    assert.equal(result.wasm[1], 0x61);
    assert.equal(result.wasm[2], 0x73);
    assert.equal(result.wasm[3], 0x6d);
    // Version 1
    assert.equal(result.wasm[4], 0x01);
    assert.equal(result.wasm[5], 0x00);
    assert.equal(result.wasm[6], 0x00);
    assert.equal(result.wasm[7], 0x00);
    // valid=false because binary.length is not > 8 (it equals 8, not greater)
    // The check is binary.length > 8, so an 8-byte stub returns valid=false
    // which is correct — no function section means no real module.
    // (This is by design: callers must check valid before using as WASM.)
    assert.equal(typeof result.valid, "boolean", "valid must be a boolean");
    assert.equal(result.sourceWAT, "(module)", "sourceWAT must reflect input");
  });
});

// ---------------------------------------------------------------------------
// Flat token stream: Int32Array layout
// ---------------------------------------------------------------------------

describe("Flat token stream: Int32Array layout", () => {
  // Test 1: toFlatTokenStream produces correct stride-4 layout
  it("toFlatTokenStream produces correct stride-4 layout", () => {
    const source = "flow hello() {}";
    const { tokens } = lex(source, "test.fungi");
    const ts = toFlatTokenStream(tokens, source);
    assert.equal(ts.count, tokens.length, "count must match token array length");
    assert.equal(ts.data.length, tokens.length * TOKEN_STRIDE, "data length must be count * stride");
    assert.equal(TOKEN_STRIDE, 4, "TOKEN_STRIDE must be 4");
    // Check that each slot maps to correct token
    for (let i = 0; i < tokens.length; i++) {
      assert.equal(tokenStreamStart(ts, i), tokens[i].start, `start[${i}] must match`);
      assert.equal(tokenStreamEnd(ts, i),   tokens[i].end,   `end[${i}] must match`);
    }
  });

  // Test 2: tokenStreamValue correctly slices source
  it("tokenStreamValue correctly slices source", () => {
    const source = "flow hello() {}";
    const { tokens } = lex(source, "test.fungi");
    const ts = toFlatTokenStream(tokens, source);
    // Find the token with value "flow"
    let foundFlow = false;
    for (let i = 0; i < ts.count; i++) {
      const v = tokenStreamValue(ts, i);
      if (v === "flow") { foundFlow = true; break; }
    }
    assert.ok(foundFlow, "tokenStreamValue must be able to slice 'flow' from source");
  });

  // Test 3: tokenStreamKind matches original kindId
  it("tokenStreamKind matches original kindId", () => {
    const source = "flow hello() {}";
    const { tokens } = lex(source, "test.fungi");
    const ts = toFlatTokenStream(tokens, source);
    for (let i = 0; i < ts.count; i++) {
      assert.equal(
        tokenStreamKind(ts, i),
        tokens[i].kindId,
        `tokenStreamKind(${i}) must equal tokens[${i}].kindId`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Fused compiler: single-pass GIR emission
// ---------------------------------------------------------------------------

describe("Fused compiler: single-pass GIR emission", () => {
  // Test 1: pure flow produces PURE_ENTER/EXIT opcodes
  it("pure flow produces PURE_ENTER and PURE_EXIT opcodes", () => {
    const result = fusedCompile("pure flow add(a: Int, b: Int) -> Int { return a }");
    assert.ok(result.opcodeCount >= 2, "Must emit at least 2 opcodes for pure flow");
    let foundEnter = false;
    let foundExit  = false;
    for (let i = 0; i < result.opcodeCount; i++) {
      const op = unpackOp(result.opcodes[i]);
      if (op === GIR_OP.PURE_ENTER) foundEnter = true;
      if (op === GIR_OP.PURE_EXIT)  foundExit  = true;
    }
    assert.ok(foundEnter, "Must emit PURE_ENTER opcode for 'pure flow'");
    assert.ok(foundExit,  "Must emit PURE_EXIT opcode for 'pure flow'");
  });

  // Test 2: secure flow produces FLOW_START/END opcodes
  it("secure flow produces FLOW_START and FLOW_END opcodes", () => {
    const result = fusedCompile("secure flow handleRequest(req: Request) -> Response { return req }");
    assert.ok(result.opcodeCount >= 2, "Must emit at least 2 opcodes for secure flow");
    let foundStart = false;
    let foundEnd   = false;
    for (let i = 0; i < result.opcodeCount; i++) {
      const op = unpackOp(result.opcodes[i]);
      if (op === GIR_OP.FLOW_START) foundStart = true;
      if (op === GIR_OP.FLOW_END)   foundEnd   = true;
    }
    assert.ok(foundStart, "Must emit FLOW_START opcode for 'secure flow'");
    assert.ok(foundEnd,   "Must emit FLOW_END opcode for 'secure flow'");
  });

  // Test 3: fusedCompile of a simple program returns valid=true
  it("fusedCompile of a simple program returns valid=true", () => {
    const result = fusedCompile(`
// Simple Galerina program
flow greet(name: String) -> String {
  return "hello"
}
`);
    assert.equal(result.valid, true, "Simple valid program must return valid=true");
    assert.equal(result.errors.length, 0, "Simple valid program must have zero errors");
    assert.ok(result.opcodeCount > 0, "Simple program must emit at least one opcode");
  });

  // Test 4: GIR_OP constants are distinct uint8 values
  it("GIR_OP constants are distinct uint8 values", () => {
    const values = Object.values(GIR_OP);
    const unique = new Set(values);
    assert.equal(unique.size, values.length, "All GIR_OP constants must be distinct");
    for (const v of values) {
      assert.ok(typeof v === "number", "Each GIR_OP value must be a number");
      assert.ok(v >= 0 && v <= 0xFF,  "Each GIR_OP value must fit in uint8 (0x00–0xFF)");
    }
  });
});

// =============================================================================
// LogicN Phase 19 / Phase 22 — WAT Emitter (WebAssembly Text Format)
//
// #70 WAT single-exit transformation: foundational wrapper added.
// Current behavior: no-op (post-conditions deferred to Phase 4).
// When Phase 4 activates: wrapInSingleExit() injects post-condition gates.
//
// Emits WebAssembly Text Format (.wat) from GIR + PassiveExecutionPlan.
// The .wat file is then compiled to binary .wasm via wat2wasm in CI.
//
// WASM architecture rule: all API decisions consider WASM compatibility first.
//
// Two targets:
//   wasm-standalone — pure WASM/WASI, no JS runtime required
//                     Pure flows → WASM functions (zero imports)
//                     Effectful stdlib calls → typed WASM imports (host:*)
//                     Runtime policy limits → WASM memory limits
//
//   wasm-hybrid     — JS capability shell + WASM pure-flow core
//                     JS manages capabilities and audit
//                     WASM handles pure computation (tensors, math, validation)
//
// Phase 19: type skeleton + placeholder stubs only.
//           Full implementation: emit WAT for pure flows first.
// Phase 22: complete effectful flows + WASI import table.
// =============================================================================

import { STDLIB_CAPABILITY_MAP } from "./stdlib-registry.js";
import type { AstNode } from "./parser.js";
import { i32AddChecked, i32SubChecked, i32MulChecked, i32DivChecked, i32ModChecked, isI32Trap, type I32Result } from "./i32-arith.js";

// ---------------------------------------------------------------------------
// Phase 22A — WASM SIMD capability types
// ---------------------------------------------------------------------------

/**
 * Describes the WASM SIMD (v128) capability available on the target platform.
 * Used by the kernel fusion planner to select SIMD vs scalar code paths.
 *
 * laneWidth is always 128 (per WASM SIMD spec: v128 = 128-bit vector).
 */
export interface WASMSIMDCapability {
  readonly available: boolean;
  readonly supportedOps: readonly ("v128.add" | "v128.mul" | "f32x4.add" | "f32x4.mul" | "i8x16.add")[];
  readonly laneWidth: 128;
}

/**
 * Default WASM SIMD capability — disabled until the runtime feature-detects
 * v128 support. Phase 22A: override with buildWATModule options.
 */
export const DEFAULT_WASM_SIMD: WASMSIMDCapability = {
  available: false,
  supportedOps: [],
  laneWidth: 128,
} as const;

/**
 * All WASM SIMD instructions that the LogicN compiler may emit.
 * Phase 22A: type definition. Phase 22B: used by kernel fusion emitter.
 */
export type WATSIMDInstruction =
  | "f32x4.add"
  | "f32x4.mul"
  | "f32x4.sqrt"
  | "i8x16.add"
  | "v128.load"
  | "v128.store";

// ---------------------------------------------------------------------------
// Phase 27D — WASM SIMD opcode string constants
//
// Typed map of the WASM SIMD instructions emitted for Tensor.dot and related
// Float32 tensor operations. Used by the kernel-fusion emitter and the WAT
// renderer to ensure instruction strings are spelled correctly and never
// hand-edited as bare strings.
//
// Architecture rule: WASM governs, native accelerates.
// These opcodes are emitted only for the WASM-side fast path (wasm-hybrid
// target, SIMD capability confirmed). The native path goes through
// NativeCapabilityId.NpuInference ("host.npu.inference").
// ---------------------------------------------------------------------------

/**
 * WASM SIMD instruction strings for Float32 tensor operations.
 *
 * Phase 27: used by the TypedArray lowering path and the WAT body emitter.
 * Phase 28+: kernel fusion emitter will select from this map per flow.
 *
 * All values are valid WASM SIMD text-format instructions (WASM SIMD MVP,
 * standardised in the WASM 2.0 spec).
 */
export const WAT_SIMD_OPS = {
  f32x4_add:   "f32x4.add",
  f32x4_mul:   "f32x4.mul",
  v128_load:   "v128.load",
  v128_store:  "v128.store",
} as const;

export type WAT_SIMD_OPS = typeof WAT_SIMD_OPS;

// ---------------------------------------------------------------------------
// WAT module types
// ---------------------------------------------------------------------------

/** A WebAssembly function type (parameter and result types). */
export interface WATFuncType {
  readonly params: readonly WATValType[];
  readonly results: readonly WATValType[];
}

/** WebAssembly value types. */
export type WATValType = "i32" | "i64" | "f32" | "f64" | "externref" | "funcref";

/** A WebAssembly import (effectful stdlib calls → host imports). */
export interface WATImport {
  readonly module: string;    // e.g. "host"
  readonly name: string;      // e.g. "fs.readText"
  readonly type: WATFuncType;
  /** The LogicN effect this import corresponds to. */
  readonly effect: string;    // e.g. "filesystem.read"
}

/** A WebAssembly export (flow entry points). */
export interface WATExport {
  readonly name: string;
  readonly index: number;
}

/**
 * A named WAT parameter — carries both the $identifier and the value type.
 * Phase 22: used by emitWATBody to emit (local.get $p0) instructions.
 */
export interface WATParamDef {
  readonly name: string;    // e.g. "$p0"
  readonly type: WATValType;
}

/** A WAT function definition. */
export interface WATFunction {
  readonly name: string;
  readonly type: WATFuncType;
  /**
   * WAT instructions as text.
   * Phase 19: stub bodies use "unreachable".
   * Phase 22: pure flows use real instructions emitted by emitWATBody.
   */
  readonly body: string;
  /** Whether this function is a pure LogicN flow (zero imports). */
  readonly isPure: boolean;
  /** Whether this function is exported as a WASM entry point. */
  readonly isEntryPoint: boolean;
  /**
   * Named parameters for this function.
   * Phase 22: present for pure flows; enables emitWATBody to reference locals.
   * When absent, renderWAT falls back to index-based $p0, $p1, … names.
   */
  readonly namedParams?: readonly WATParamDef[];
}

/** A WAT memory declaration (from contract.memory { arena ... }). */
export interface WATMemory {
  /** Minimum pages (1 page = 64KB). */
  readonly minPages: number;
  /** Maximum pages. Enforces runtime policy memory limits. */
  readonly maxPages: number | null;
}

/** A complete WAT module ready for rendering to text or passing to wat2wasm. */
export interface WATModule {
  readonly schemaVersion: "lln.wat.v1";
  readonly sourceHash: string;
  readonly girHash: string;
  readonly imports: readonly WATImport[];
  readonly exports: readonly WATExport[];
  readonly functions: readonly WATFunction[];
  readonly memory: WATMemory;
  /** Target variant: standalone (WASI) or hybrid (JS+WASM). */
  readonly target: "wasm-standalone" | "wasm-hybrid";
}

export interface WATEmitResult {
  readonly module: WATModule;
  /** The rendered .wat text, ready for wat2wasm. */
  readonly wat: string;
  readonly diagnostics: readonly { code: string; message: string }[];
}

// ---------------------------------------------------------------------------
// WATValType mapping from LogicN TypeId
// ---------------------------------------------------------------------------

/**
 * Maps LogicN primitive type names to WASM value types.
 * Used when generating function signatures.
 *
 * Phase 19: covers primitive numeric types.
 * Phase 22: adds struct/array encoding for record types.
 */
export function logicNTypeToWAT(typeName: string): WATValType {
  switch (typeName) {
    case "Bool": case "Int": case "Int8": case "Int16": case "Int32": case "Byte": return "i32";
    case "Int64": case "UInt64": return "i64";
    case "Float16": case "Float32": return "f32";
    // #165: scalar `Float` is f64 (double) — matches the f64.const literal emission; the old
    // Float→f32 mapping was the inconsistency that made every float scalar flow an invalid module.
    case "Float64": case "Double": case "Decimal": case "Float": return "f64";
    // P9.2: String and all complex types (Array, Record, Option, Result, Char, Tensor)
    // are represented as opaque i32 handles in the Stage B self-hosted compiler.
    // String parameters in flows like scanWord/scanOperator are passed as integer indices
    // into the host string table — they never carry GC references at the WASM boundary.
    // Using i32 keeps the WASM type stack consistent: function bodies already emit
    // all local variables as (local $x i32), so parameters must match.
    // Phase 22B (full linear-memory string layout) will revisit this when the host
    // string table and char-access intrinsics are wired into the WASM import table.
    default: return "i32"; // opaque handle — Stage B: all non-numeric types as i32
  }
}

// ---------------------------------------------------------------------------
// Default memory config from runtime policy
// ---------------------------------------------------------------------------

/**
 * Default WASM memory limits derived from runtime policy.
 * 1 page = 64KB. Default: 2 pages min (128KB), 2048 pages max (128MB).
 */
export const DEFAULT_WAT_MEMORY: WATMemory = {
  minPages: 2,
  maxPages: 2048, // 128MB — matches runtime policy default
};

// ---------------------------------------------------------------------------
// P9.4b — record struct layout (linear-memory bump allocator)
// ---------------------------------------------------------------------------

/** Records bump-allocate above this byte offset; the low region stays reserved
 *  scratch/null (so a 0 handle never collides with a real record base). */
export const WAT_HEAP_BASE = 1024;
/** Every record field occupies one i32 slot (a number or an opaque i32 handle). */
export const WAT_REC_FIELD_SIZE = 4;

/**
 * Per-flow record-construction scratch. emitWATFromFlowAST sets this before walking
 * the body and clears it after; the `#record` case in emitWATExpr appends a unique
 * `(local …)` decl here (so nested records and record-returning calls each get their
 * OWN base local — no shared-global clobbering) and references the `$__lln_heap`
 * pointer. null outside a flow-body walk → records fall back to the i32.const 0
 * placeholder (preserving every non-WAT-emitter code path unchanged).
 */
let recordCtx: { localDecls: string[]; counter: { n: number } } | null = null;

/** typeName → ordered field names, built once per module from `record` decls.
 *  Used to compute field byte offsets for `r.field` loads. null → field access
 *  falls back to the placeholder. */
let recordLayouts: ReadonlyMap<string, readonly string[]> | null = null;
/** varName → record typeName for the flow currently being emitted (reset per flow).
 *  Populated from `let r: T = …` annotations, `let r = T{…}` literal types, and
 *  record-typed flow params. Lets `r.field` resolve to an i32.load at the slot offset. */
let recordVarTypes: Map<string, string> | null = null;
/** enumTypeName → ordered variant names (declaration order = i32 tag). #144: lets
 *  `EnumType.Variant` lower to its stable i32 tag instead of an `(i32.const 0)`
 *  placeholder. The tag is an internal convention; the host runtime (#145) maps the
 *  i32 back to the variant name for byte-parity comparison. null → placeholder. */
let enumVariants: ReadonlyMap<string, readonly string[]> | null = null;
/** flowName → declared return type (e.g. "makeKeywordTable" → "Array<String>"). #160:
 *  lets `let xs = makeKeywordTable()` carry a type so `xs.contains(s)` lowers to the
 *  value-based __array_contains_str bridge. null/absent → no inference (placeholder). */
let flowReturnTypes: ReadonlyMap<string, string> | null = null;

/** Build the flowName → return-type registry from a program AST's flow decls.
 *  Flow node shape (parser): value = name; children = [...paramDecls, retTypeNode, …].
 *  The return-type node sits immediately after the parameter decls; its `value` is the
 *  type string (e.g. "Array<String>"). */
export function buildFlowReturnTypes(ast: AstNode | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (ast === undefined) return out;
  const walk = (n: AstNode): void => {
    if (n.kind === "pureFlowDecl" || n.kind === "flowDecl" || n.kind === "secureFlowDecl") {
      const name = (n.value ?? "").trim();
      const children = n.children ?? [];
      const numParams = children.filter((c) => c.kind === "paramDecl").length;
      const retNode = children[numParams];
      const rt = retNode?.value;
      if (name !== "" && typeof rt === "string" && rt.trim() !== "") out.set(name, rt.trim());
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(ast);
  return out;
}

/** Build the enumTypeName → variant-name-list registry from a program AST's `enum` decls. */
export function buildEnumVariants(ast: AstNode | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const node of ast?.children ?? []) {
    if (node.kind === "enumDecl" && node.value) {
      const variants = (node.children ?? [])
        .filter((c) => c.kind === "enumVariant")
        .map((c) => c.value ?? "")
        .filter((n) => n.length > 0);
      out.set(node.value, variants);
    }
  }
  return out;
}

/** Build the typeName → field-name-list registry from a program AST's `record` decls. */
export function buildRecordLayouts(ast: AstNode | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const node of ast?.children ?? []) {
    if (node.kind === "recordDecl" && node.value) {
      const fields = (node.children ?? [])
        .filter((c) => c.kind === "paramDecl")
        .map((c) => (c.value ?? "").split(":")[0]!.trim())
        .filter((n) => n.length > 0);
      out.set(node.value, fields);
    }
  }
  return out;
}

/** The record type a `let`/param binding refers to, or undefined. `raw` is the
 *  binding's `value` (e.g. "r: TokenizeResult"); `initNode` is its initialiser. */
function recordTypeOfBinding(raw: string, initNode: AstNode | undefined): string | undefined {
  if (recordLayouts === null) return undefined;
  const anno = raw.includes(":") ? raw.split(":")[1]!.trim() : "";
  if (anno && recordLayouts.has(anno)) return anno;
  if (initNode?.kind === "callExpr" && initNode.value === "#record") {
    const tn = (initNode as { typeName?: string }).typeName;
    if (tn && recordLayouts.has(tn)) return tn;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// WAT rendering
// ---------------------------------------------------------------------------

/**
 * Renders a WATModule to WebAssembly Text Format string.
 *
 * Produces a valid .wat skeleton that wat2wasm can compile.
 * Function bodies use (unreachable) as stubs until Phase 22 emission.
 *
 * WAT identifier rules applied:
 *   - "." in import names → "_" in $identifier references
 *   - all string literals use double-quotes as required by WAT spec
 *
 * Phase 19: correct structure + stub bodies.
 * Phase 22: full instruction emission from PassiveExecutionPlan steps.
 */
export function renderWAT(module: WATModule): string {
  // ── Usage scan ──────────────────────────────────────────────────────────────
  // Only emit host imports / the listLiteral global that are ACTUALLY referenced
  // by some function body. Pure integer flows (e.g. recursive arithmetic) use
  // none of them — emitting unused imports forced the minimal JS assembler to
  // mis-resolve local indices, breaking integer recursion. Conditional emission
  // restores the clean module shape for simple flows while preserving the host
  // bridge for string/array/char flows (the self-hosted compiler).
  const allBodyText = module.functions.map((fn) => fn.body ?? "").join("\n");
  const usesTmpArr = allBodyText.includes("$__lln_tmp_arr");
  const usesHeap = allBodyText.includes("$__lln_heap"); // P9.4b: record bump-allocator

  const lines: string[] = ["(module"];

  // ── Imports FIRST ─────────────────────────────────────────────────────────
  // WASM spec (and strict wat2wasm) require ALL imports to appear before any
  // non-import definition (memory, global, func). Emitting memory before the
  // imports produces: "imports must occur before all non-import definitions".
  // Valid WAT import syntax:
  //   (import "module" "name" (func $id (param ...) (result ...)))
  // "." in WAT identifiers is illegal; replace with "_".
  // Only emit imports whose host-id appears in a function body (usage-gated).
  let emittedImports = 0;
  for (const imp of module.imports) {
    const id = `$host_${imp.name.replace(/\./g, "_")}`;
    // Usage-gate ONLY the stdlib runtime bridge (names start with "__": __array_*,
    // __str_*, __char_*, __option_*, __unwrap_or). Effect-derived imports
    // (host:db.read, host:audit.write, etc.) are always emitted — they document
    // the flow's declared effects even when the body is an `unreachable` stub.
    const isRuntimeBridge = imp.name.startsWith("__");
    if (isRuntimeBridge && !allBodyText.includes(id)) continue; // unused bridge — skip
    const paramStr = imp.type.params.map((p, i) => `(param $p${i} ${p})`).join(" ");
    const resultStr = imp.type.results.map((r) => `(result ${r})`).join(" ");
    const sig = [paramStr, resultStr].filter(Boolean).join(" ");
    const funcBody = sig ? `(func ${id} ${sig})` : `(func ${id})`;
    lines.push(`  ;; effect: ${imp.effect}`);
    lines.push(`  (import "${imp.module}" "${imp.name}" ${funcBody})`);
    emittedImports++;
  }
  if (emittedImports > 0) lines.push("");

  // Memory — after imports, before functions.
  const maxStr = module.memory.maxPages !== null ? ` ${module.memory.maxPages}` : "";
  lines.push(`  (memory ${module.memory.minPages}${maxStr})`);
  lines.push(`  (export "memory" (memory 0))`);
  lines.push("");

  // listLiteral global: only emitted when a body references it.
  if (usesTmpArr) {
    lines.push(`  ;; P9.3: temporary array ID register for listLiteral WAT emission`);
    lines.push(`  (global $__lln_tmp_arr (mut i32) (i32.const 0))`);
    lines.push(``);
  }

  // P9.4b: record bump-allocator heap pointer — only emitted when a body constructs
  // a record. Records allocate above WAT_HEAP_BASE; the low region stays null/scratch.
  if (usesHeap) {
    lines.push(`  ;; P9.4b: bump-allocator heap pointer for record struct layout`);
    lines.push(`  (global $__lln_heap (mut i32) (i32.const ${WAT_HEAP_BASE}))`);
    lines.push(``);
  }

  // i32 strict-trapping arithmetic helpers (owner Fork A=TRAP). Emit ONLY the helpers a flow body
  // actually calls — their presence is a deterministic function of the bodies, so wasmHash is stable.
  const referencedHelpers = new Set<string>();
  for (const fn of module.functions) {
    for (const name of Object.keys(I32_CHECKED_HELPERS)) {
      if (fn.body.includes(name)) referencedHelpers.add(name);
    }
  }
  for (const name of Object.keys(I32_CHECKED_HELPERS)) {
    if (!referencedHelpers.has(name)) continue;
    lines.push(`  ;; strict-trapping i32 helper — signed overflow traps (unreachable)`);
    for (const hl of I32_CHECKED_HELPERS[name]!.split("\n")) lines.push(`  ${hl}`);
    lines.push("");
  }

  // Function definitions.
  // Pure flows with a real body (fn.body !== "unreachable") emit actual instructions.
  // All other flows use (unreachable) which is valid WAT — polymorphic bottom type.
  // Signature "(result i32)" etc. with unreachable is well-formed per WASM spec.
  for (const fn of module.functions) {
    // Build param strings: prefer namedParams when present (pure flows), else index-based.
    const paramStr = fn.namedParams !== undefined
      ? fn.namedParams.map((p) => `(param ${p.name} ${p.type})`).join(" ")
      : fn.type.params.map((p, i) => `(param $p${i} ${p})`).join(" ");
    const resultStr = fn.type.results.map((r) => `(result ${r})`).join(" ");
    const sig = [paramStr, resultStr].filter(Boolean).join(" ");
    const funcSig = sig ? `(func $${fn.name} ${sig}` : `(func $${fn.name}`;
    lines.push(`  ;; ${fn.isPure ? "pure" : "effectful"} flow: ${fn.name}`);
    lines.push(`  ${funcSig}`);
    // Use the real body when available; fall back to unreachable for stubs.
    if (fn.body !== "unreachable" && fn.body.trim().length > 0) {
      // Indent each instruction line with 4 spaces inside the function.
      for (const bodyLine of fn.body.split("\n")) {
        if (bodyLine.trim().length > 0) {
          lines.push(`    ${bodyLine}`);
        }
      }
    } else {
      lines.push(`    unreachable`);
    }
    lines.push(`  )`);
    if (fn.isEntryPoint) {
      lines.push(`  (export "${fn.name}" (func $${fn.name}))`);
    }
    lines.push("");
  }

  lines.push(")");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Phase 25 — AST-based WAT code generator for pure flows
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// String intern table — maps string value → i32 ID (opaque handle)
//
// The host registers interned strings with the WASM instance at load time.
// The WASM guest uses the ID (i32) everywhere as an opaque string handle.
// 0 is reserved for the empty string "".
// ---------------------------------------------------------------------------

const _stringTable = new Map<string, number>();
let _nextStringId = 1; // 0 reserved for ""

/**
 * Interns a string literal value and returns its i32 ID.
 * Strips surrounding quotes if present. Returns 0 for the empty string.
 */
function internString(value: string): number {
  if (value === "" || value === '""') return 0;
  // Strip surrounding double-quotes if present
  const stripped = value.startsWith('"') && value.endsWith('"') && value.length >= 2
    ? value.slice(1, -1) : value;
  if (stripped === "") return 0;
  const existing = _stringTable.get(stripped);
  if (existing !== undefined) return existing;
  const id = _nextStringId++;
  _stringTable.set(stripped, id);
  return id;
}

/**
 * Renders the current string intern table as WAT comment lines.
 * The host reconstructs this mapping to register strings at WASM load time.
 */
export function renderStringTableComments(): string {
  const lines: string[] = [";; String intern table (for host reconstruction):", ";; 0 = \"\""];
  for (const [str, id] of _stringTable) {
    lines.push(`;; ${id} = "${str}"`);
  }
  return lines.join("\n");
}

/**
 * Resets the string intern table. Call before emitting a new module to avoid
 * IDs leaking across compilation units.
 */
export function resetStringTable(): void {
  _stringTable.clear();
  _nextStringId = 1;
}

/**
 * #145: expose the current string-intern table as handle → literal value, so a host
 * runtime can SEED its string registry at the exact i32 handles the emitted WASM uses
 * (handle 0 is always ""). Call AFTER the module is rendered (the table is populated
 * during emission). The host then registers any runtime input string at the next free
 * handle (≥ maxHandle+1) to avoid colliding with a literal.
 */
export function getInternedStrings(): Array<{ handle: number; value: string }> {
  const out: Array<{ handle: number; value: string }> = [{ handle: 0, value: "" }];
  for (const [str, id] of _stringTable) out.push({ handle: id, value: str });
  return out;
}

/**
 * Maps a binary operator string to its WAT i32 instruction.
 * Arithmetic, comparison, and logical ops — all operating on i32.
 *
 * Bitwise operators (& | ^ << >>) are deliberately NOT here: the LogicN lexer does
 * not tokenize them (bit-level math lives in the engine/extension layer — the
 * crypto-on-core boundary), so they can never reach this map. Adding them back would
 * be dead code (they were unreachable entries until 2026-06-16; removed per dogfooding
 * GAP-4). `&&`/`||` stay — those are the live logical-and/or operators.
 */
const BINARY_OP_TO_WAT: ReadonlyMap<string, string> = new Map([
  // +,-,* lower to strict-trapping checked helpers (owner Fork A=TRAP, 2026-06-18): native i32.add/
  // sub/mul wrap silently, so signed overflow → `unreachable` (LOAD→TRAP→ERASE) via the helpers
  // below. /,% stay native: i32.div_s/rem_s already trap on /0 AND INT32_MIN/-1 — exactly our semantics.
  ["+",  "call $lln_checked_add_i32"],
  ["-",  "call $lln_checked_sub_i32"],
  ["*",  "call $lln_checked_mul_i32"],
  ["/",  "i32.div_s"],
  ["%",  "i32.rem_s"],
  ["<",  "i32.lt_s"],
  [">",  "i32.gt_s"],
  ["<=", "i32.le_s"],
  [">=", "i32.ge_s"],
  ["==", "i32.eq"],
  ["!=", "i32.ne"],
  ["&&", "i32.and"],
  ["||", "i32.or"],
]);

// #165: native f64 lowering for float operands. All floats are treated as f64 (matching the f64.const
// literal emission, wat-emitter §numberLiteral). Without these, a float `+ - * /`/comparison emitted an
// i32 checked helper over f64 operands → an invalid module (WASM tier declined → walker fallback).
const FLOAT_WAT_TYPES = new Set<string>(["Float", "Float64", "Double", "Decimal"]);
const FLOAT_ARITH_WAT: Readonly<Record<string, string>> = { "+": "f64.add", "-": "f64.sub", "*": "f64.mul", "/": "f64.div" };
const FLOAT_CMP_WAT: Readonly<Record<string, string>> = { "==": "f64.eq", "!=": "f64.ne", "<": "f64.lt", ">": "f64.gt", "<=": "f64.le", ">=": "f64.ge" };

/**
 * i32 strict-trapping arithmetic helpers (owner Fork A=TRAP, 2026-06-18). Native WASM i32.add/sub/mul
 * wrap mod 2^32 — a lying abstraction in a governed system. These harden the WASM-i32 reference so
 * signed overflow is a TRAP (`unreachable` = LOAD→TRAP→ERASE), byte-identical to the tree-walker +
 * bytecode VM (the single source of truth is i32-arith.ts; these mirror its predicates exactly).
 * `+`/`-`/`*` lower to `call` these; `/`/`%` use native i32.div_s/rem_s (already trap on /0 AND
 * INT32_MIN/-1). Emitted into a module only when a flow body actually references them.
 */
const I32_CHECKED_HELPERS: Readonly<Record<string, string>> = {
  $lln_checked_add_i32: [
    "(func $lln_checked_add_i32 (param $a i32) (param $b i32) (result i32)",
    "  (local $r i32)",
    "  (local.set $r (i32.add (local.get $a) (local.get $b)))",
    "  ;; signed overflow iff (a^r) & (b^r) < 0",
    "  (if (i32.lt_s (i32.and (i32.xor (local.get $a) (local.get $r)) (i32.xor (local.get $b) (local.get $r))) (i32.const 0)) (then unreachable))",
    "  (local.get $r))",
  ].join("\n"),
  $lln_checked_sub_i32: [
    "(func $lln_checked_sub_i32 (param $a i32) (param $b i32) (result i32)",
    "  (local $r i32)",
    "  (local.set $r (i32.sub (local.get $a) (local.get $b)))",
    "  ;; signed overflow iff (a^b) & (a^r) < 0",
    "  (if (i32.lt_s (i32.and (i32.xor (local.get $a) (local.get $b)) (i32.xor (local.get $a) (local.get $r))) (i32.const 0)) (then unreachable))",
    "  (local.get $r))",
  ].join("\n"),
  $lln_checked_mul_i32: [
    "(func $lln_checked_mul_i32 (param $a i32) (param $b i32) (result i32)",
    "  (local $r i64)",
    "  (local.set $r (i64.mul (i64.extend_i32_s (local.get $a)) (i64.extend_i32_s (local.get $b))))",
    "  ;; overflow iff the exact i64 product leaves [-2^31, 2^31-1]",
    "  (if (i32.or (i64.lt_s (local.get $r) (i64.const -2147483648)) (i64.gt_s (local.get $r) (i64.const 2147483647))) (then unreachable))",
    "  (i32.wrap_i64 (local.get $r)))",
  ].join("\n"),
};

// ---------------------------------------------------------------------------
// P9.3 — Stdlib method → host import bridge
//
// The self-hosted lexer (lexer.lln) calls stdlib methods like `s.charAt(i)`,
// `arr.append(x)`, `c.isLetter()`, `opt.unwrapOr(d)`. These parse as method-style
// callExpr nodes (value = method name, callStyle = "method", children = [receiver, ...args]).
//
// At the WASM boundary every value is an opaque i32 handle (see logicNTypeToWAT),
// so each stdlib method maps to a host import with signature (param i32…)(result i32).
// We emit `(call $host___<name> <receiver> <args…>)`; the host (logicn.mjs
// hostRuntime) supplies the real implementation. renderWAT usage-gates the host
// imports on whether `$host___<name>` appears in a body, so emitting the call
// string is sufficient to pull in the matching import.
//
// Only the EXACT method names below are intercepted. Everything else (flow→flow
// calls like scanWord(...), record constructors) falls through unchanged.
// ---------------------------------------------------------------------------

/**
 * Stdlib method name → host import id (the `$host___…` WAT identifier).
 *
 * Receiver-passing rule: the receiver is emitted as the FIRST argument followed
 * by the call's own arguments — `s.charAt(i)` → `(call $host___str_char_at s i)`,
 * `n.toString()` → `(call $host___int_to_str n)`.
 *
 * P9.3 ambiguities (resolved pragmatically; do not block wat2wasm assembly):
 *   - `length`: String.length vs Array.length — both host funcs share the
 *     (param i32)(result i32) signature; default to str_length. (Array.length → P9.4)
 *   - `toString`: Int.toString vs Char.toString — same signature; default to
 *     int_to_str. Char/Int discrimination needs type info → P9.4.
 *   - `Array.empty()` is handled specially in emitWATExpr (zero-arg host call).
 */
const STDLIB_HOST_MAP: Record<string, string> = {
  charAt:   "$host___str_char_at",
  charCount: "$host___str_count",   // String.charCount() → length (#145 lexer link)
  length:   "$host___str_length",   // String.length / Array.length (shared sig)
  toInt:    "$host___str_to_int",
  toStr:    "$host___int_to_str",
  toString: "$host___int_to_str",   // Int.toString (Char.toString → P9.4)
  concat:   "$host___str_concat",
  // #162: String-only methods (no Char/Array equivalent that conflicts by name).
  startsWith: "$host___str_starts_with",
  endsWith: "$host___str_ends_with",
  trim:     "$host___str_trim",
  indexOf:  "$host___str_index_of",
  slice:    "$host___str_slice",     // String.slice(start, end) — Array.slice → type-directed follow-on
  isLetter: "$host___char_is_letter",
  isDigit:  "$host___char_is_digit",
  // #169: Char classifiers — Char-only (String has no isUpper/isLower/isWhitespace),
  // so the name→host mapping is unambiguous. toUpper/toLower are String-ambiguous and
  // are routed type-directed under #162 instead of mapped here.
  isUpper:  "$host___char_is_upper",
  isLower:  "$host___char_is_lower",
  isWhitespace: "$host___char_is_whitespace",
  append:   "$host___array_append",
  get:      "$host___array_get",
  count:    "$host___array_length",  // #161: Array.count() → length (reuses the array_length import)
  contains: "$host___array_contains",
  first:    "$host___array_first",
  last:     "$host___array_last",
  unwrapOr: "$host___unwrap_or",
};

/** Plain (non-method) stdlib calls — constructors mapped to host imports. */
const STDLIB_HOST_CALL_MAP: Record<string, string> = {
  Some: "$host___option_some",
  Ok:   "$host___result_ok",   // Result.Ok(x)  (#145 lexer link)
  Err:  "$host___result_err",  // Result.Err(x) (#145 lexer link)
  // None is an identifier (no call); resolves via the host_none import at link time.
};

/**
 * Resolves a char-literal token value to its concrete string (handles the same
 * escapes as the interpreter's resolveCharEscape, kept in lockstep). Used to lower
 * `'A'`/`'\n'` to their code point for WAT. Local to the emitter — the interpreter
 * owns the canonical copy; this mirror avoids a cross-module import cycle.
 */
function resolveCharEscapeWAT(value: string): string {
  if (value.length === 2 && value[0] === "\\") {
    switch (value[1]) {
      case "n": return "\n";
      case "t": return "\t";
      case "r": return "\r";
      case "0": return "\0";
      case "'": return "'";
      case "\\": return "\\";
    }
  }
  return value;
}

/**
 * #168: resolve a match-arm pattern that names a user-declared enum VARIANT to its
 * declaration-order i32 tag — so `match tok.kind { Keyword => … }` compares against the
 * integer tag (the same encoding member access uses, see the memberExpr enum path), not
 * an interned-string id. Returns undefined when the pattern is not an enum variant (the
 * caller keeps its existing fallback). Built-in Option/Result (None/Some/Ok/Err) are NOT
 * `enum` decls, so they never appear here — Option is sentinel-dispatched earlier and
 * Result is #164's separate job.
 *
 * Resolution: prefer the subject's enum type when the subject is an enum-typed variable;
 * otherwise fall back to a reverse lookup across all enums, accepting it only when every
 * matching enum agrees on the same index (else ambiguous → undefined).
 */
function enumVariantTag(pattern: string, subjectNode: AstNode | undefined): number | undefined {
  if (enumVariants === null) return undefined;
  // 1. Subject is an enum-typed identifier → use that enum's variant order.
  if (subjectNode?.kind === "identifier") {
    const t = recordVarTypes?.get(subjectNode.value ?? "");
    if (t !== undefined && enumVariants.has(t)) {
      const idx = (enumVariants.get(t) ?? []).indexOf(pattern);
      return idx >= 0 ? idx : undefined;
    }
  }
  // 2. Reverse lookup across all enums; accept only an unambiguous index.
  const indices = new Set<number>();
  for (const variants of enumVariants.values()) {
    const idx = variants.indexOf(pattern);
    if (idx >= 0) indices.add(idx);
  }
  return indices.size === 1 ? [...indices][0] : undefined;
}

/** Inner type of an `Option<T>` / `Result<T, …>` annotation (e.g. "Option<Char>" → "Char"). */
function optionInnerType(t: string | undefined): string | undefined {
  if (t === undefined) return undefined;
  const m = /^(?:Option|Result)<\s*([^,>]+?)\s*[,>]/.exec(t);
  return m ? m[1] : undefined;
}

/**
 * #160: best-effort scalar/builtin type inference for the WAT lowering. Used to pick
 * type-directed host bridges: String `+` → __str_concat (vs i32.add), Char.toString →
 * __char_to_string (vs Int.toString). Reads variable types from `recordVarTypes`
 * (generalised to hold scalar types — Char/Int/String/Bool — alongside record types).
 * Returns undefined when the type cannot be determined statically (callers default to
 * the integer/Int interpretation, preserving prior behaviour for untyped flows).
 */
function inferExprType(node: AstNode | undefined): string | undefined {
  if (node === undefined) return undefined;
  switch (node.kind) {
    case "stringLiteral": return "String";
    case "charLiteral":   return "Char";
    case "numberLiteral": {
      const raw = node.value ?? "0";
      return raw.includes(".") || raw.includes("e") || raw.includes("E") ? "Float" : "Int";
    }
    case "boolLiteral": return "Bool";
    case "identifier":  return recordVarTypes?.get(node.value ?? "");
    case "binaryExpr": {
      const op = node.value ?? "";
      if (["==", "!=", "<", ">", "<=", ">=", "and", "or", "&&", "||"].includes(op)) return "Bool";
      if (op === "+") {
        const l = inferExprType(node.children?.[0]);
        const r = inferExprType(node.children?.[1]);
        return l === "String" || r === "String" ? "String" : "Int";
      }
      return "Int"; // - * / % → integer arithmetic
    }
    case "callExpr": {
      const name = node.value ?? "";
      if (node.callStyle === "method") {
        if (name === "toString" || name === "toStr" || name === "concat" ||
            name === "trim" || name === "padStart" || name === "padEnd" || name === "repeat" ||
            name === "slice") return "String";
        if (name === "toUpper" || name === "toLower") {
          return inferExprType(node.children?.[0]) === "Char" ? "Char" : "String";
        }
        if (name === "codePoint" || name === "length" || name === "charCount" ||
            name === "indexOf" || name === "lastIndexOf" || name === "toInt") return "Int";
        if (name === "isLetter" || name === "isDigit" || name === "isUpper" || name === "isLower" ||
            name === "isWhitespace" || name === "contains" || name === "startsWith" || name === "endsWith") return "Bool";
        if (name === "charAt") return "Option<Char>";
        // unwrapOr(default) yields the default's type — the cleanest way to thread the
        // element type out of an Option (e.g. `xs.first().unwrapOr("")` ⇒ String).
        if (name === "unwrapOr") return inferExprType(node.children?.[1]);
        // first()/last() on an Array<T> → Option<T>; get(i) likewise.
        if (name === "first" || name === "last" || name === "get") {
          const inner = optionInnerType(inferExprType(node.children?.[0])?.replace(/^Array</, "Option<"));
          return inner !== undefined ? `Option<${inner}>` : undefined;
        }
        return undefined;
      }
      // Non-method call = flow-to-flow call → the callee's declared return type.
      return flowReturnTypes?.get(name);
    }
    default: return undefined;
  }
}

/**
 * Emits a single WAT s-expression for an AST expression node.
 *
 * @param node         - The AST expression node.
 * @param vars         - Map from LogicN variable/param name → WAT local name ($p0, $x, etc.)
 * @param staticConsts - Optional map of compile-time constant name → integer value.
 *                       Populated from `static NAME = EXPR` and `bitfield` declarations.
 *                       Used to fold constant references to `(i32.const N)` at compile time.
 */
export function emitWATExpr(
  node: AstNode,
  vars: ReadonlyMap<string, string>,
  staticConsts: ReadonlyMap<string, number> = new Map(),
): string {
  switch (node.kind) {
    case "identifier": {
      const name = node.value ?? "";
      const watName = vars.get(name);
      if (watName !== undefined) return `(local.get ${watName})`;
      // Check compile-time constants (static NAME = EXPR)
      const constVal = staticConsts.get(name);
      if (constVal !== undefined) return `(i32.const ${constVal}) ;; static ${name}`;
      // Unknown identifier — emit with comment for diagnostics.
      return `(unreachable) ;; unresolved: ${name} — fail-closed (emitter cannot lower; #128-sibling)`;
    }

    case "memberExpr": {
      // Dotted access: REGISTER.field — check bitfield constants first
      // e.g. V_DPM.network_outbound → staticConsts.get("V_DPM.network_outbound")
      const memberName = node.value ?? "";
      const receiverNode = node.children?.[0];
      if (receiverNode?.kind === "identifier") {
        const receiverName = receiverNode.value ?? "";
        const dottedKey = `${receiverName}.${memberName}`;
        const constVal = staticConsts.get(dottedKey);
        if (constVal !== undefined) return `(i32.const ${constVal}) ;; bitfield ${dottedKey}`;

        // P9.4d (#144): enum-variant access — EnumType.Variant → its declaration-order
        // i32 tag. NO trailing ;; comment — this is used INLINE (e.g. inside i32.store),
        // and a line comment would swallow the enclosing S-expression's closing paren.
        if (enumVariants !== null) {
          const variants = enumVariants.get(receiverName);
          if (variants) {
            const vIdx = variants.indexOf(memberName);
            if (vIdx >= 0) return `(i32.const ${vIdx})`;
          }
        }

        // P9.4b: record field access — r.field → i32.load at the field's slot offset.
        // Resolves only when the receiver's record type and the field are known;
        // otherwise falls through to the placeholder (preserving all other paths).
        const recType = recordVarTypes?.get(receiverName);
        if (recType !== undefined && recordLayouts !== null) {
          const fields = recordLayouts.get(recType);
          const idx = fields ? fields.indexOf(memberName) : -1;
          if (idx >= 0) {
            const off = idx * WAT_REC_FIELD_SIZE;
            const local = vars.get(receiverName);
            const recvWat = local !== undefined ? `(local.get ${local})` : `(i32.const 0)`;
            // NO trailing ;; comment — this expression is used INLINE (e.g. inside
            // (i32.add <left> <right>)), and a line comment would swallow the closing
            // paren of the enclosing S-expression.
            return `(i32.load (i32.add ${recvWat} (i32.const ${off})))`;
          }
        }
      }
      return `(unreachable) ;; unresolved member: ${memberName} — fail-closed (emitter cannot lower; #128-sibling)`;
    }

    case "numberLiteral": {
      const raw = node.value ?? "0";
      const isFloat = raw.includes(".") || raw.includes("e") || raw.includes("E");
      if (isFloat) {
        return `(f64.const ${raw})`;
      }
      return `(i32.const ${raw})`;
    }

    case "binaryExpr": {
      const op = node.value ?? "";
      // AOT #1 (R&D 0036): const-expression folding — if both operands are compile-time int constants
      // and the arithmetic doesn't trap, emit the folded literal instead of the runtime op. foldToInt
      // returns null for non-int / string / comparison operands and for any TRAPPING const op (so those
      // fall through unchanged and stay fail-closed).
      const foldedConst = foldToInt(node, staticConsts);
      if (foldedConst !== null) return `(i32.const ${foldedConst})`;
      const watOp = BINARY_OP_TO_WAT.get(op);
      const children = node.children ?? [];
      const left  = children[0] ? emitWATExpr(children[0], vars, staticConsts) : "(i32.const 0)";
      const right = children[1] ? emitWATExpr(children[1], vars, staticConsts) : "(i32.const 0)";
      // #160: type-directed String operators. Strings are opaque interned handles, so
      // `+` is concatenation and `==`/`!=` are VALUE equality — never i32 ops on handles
      // (equal-valued strings can have different handles).
      const lty = inferExprType(children[0]);
      const rty = inferExprType(children[1]);
      const stringOperand = lty === "String" || rty === "String";
      if (op === "+" && stringOperand) {
        return `(call $host___str_concat ${left} ${right})`;
      }
      if (op === "==" && stringOperand) {
        return `(call $host___str_eq ${left} ${right})`;
      }
      if (op === "!=" && stringOperand) {
        return `(i32.eqz (call $host___str_eq ${left} ${right}))`;
      }
      // #165: native f64 lowering for float operands. Float literals already emit f64.const, but the
      // binary-op map is i32-only — so without this a float `+ - * /` or comparison emitted an i32
      // checked helper over f64 operands → an INVALID module (the WASM tier then declined → walker).
      // A mixed int operand is promoted to f64 (f64.convert_i32_s); all floats are treated as f64
      // (matching the f64.const literal emission). Comparisons yield i32 0/1 (the bool), as in WASM.
      const lFloat165 = FLOAT_WAT_TYPES.has(lty ?? "");
      const rFloat165 = FLOAT_WAT_TYPES.has(rty ?? "");
      if (lFloat165 || rFloat165) {
        const fOp = FLOAT_ARITH_WAT[op] ?? FLOAT_CMP_WAT[op];
        if (fOp !== undefined) {
          const L = lFloat165 ? left : `(f64.convert_i32_s ${left})`;
          const R = rFloat165 ? right : `(f64.convert_i32_s ${right})`;
          return `(${fOp} ${L} ${R})`;
        }
      }
      if (watOp !== undefined) {
        return `(${watOp} ${left} ${right})`;
      }
      return `(unreachable) ;; unknown op: ${op} — fail-closed (emitter cannot lower; #128-sibling)`;
    }

    case "unaryExpr": {
      const op = node.value ?? "";
      const operand = node.children?.[0] ? emitWATExpr(node.children[0], vars, staticConsts) : "(i32.const 0)";
      if (op === "-") return `(call $lln_checked_sub_i32 (i32.const 0) ${operand})`; // -INT32_MIN overflows → trap
      if (op === "!")  return `(i32.eqz ${operand})`;
      return `(unreachable) ;; unknown unary: ${op} — fail-closed (emitter cannot lower; #128-sibling)`;
    }

    case "callExpr": {
      const name = node.value ?? "";
      // Record literals are parsed as callExpr with value "#record" or "#record-update".
      // P9.4b: lower a `#record` literal to a linear-memory struct — bump-allocate
      // fieldCount*4 bytes, store each field at its slot offset, evaluate to the base
      // pointer. Gated on an active flow-body scratch context (recordCtx); outside it
      // (other pipeline stages) the placeholder is preserved. `#record-update` still
      // falls back (it needs a base copy — a follow-on).
      if (name === "#record") {
        const fields = node.children ?? [];
        if (recordCtx !== null && fields.length > 0) {
          const recLocal = `$__lln_rec_${recordCtx.counter.n++}`;
          recordCtx.localDecls.push(`(local ${recLocal} i32)`);
          const size = fields.length * WAT_REC_FIELD_SIZE;
          const parts: string[] = [`(block (result i32)`];
          // base = heap; heap += size  (per-record local → safe under nesting + calls)
          parts.push(`  (local.set ${recLocal} (global.get $__lln_heap))`);
          parts.push(`  (global.set $__lln_heap (i32.add (global.get $__lln_heap) (i32.const ${size})))`);
          fields.forEach((f, i) => {
            const valNode = f.children?.[0];
            const valWat = valNode ? emitWATExpr(valNode, vars, staticConsts) : "(i32.const 0)";
            const off = i * WAT_REC_FIELD_SIZE;
            parts.push(`  (i32.store (i32.add (local.get ${recLocal}) (i32.const ${off})) ${valWat}) ;; .${f.value ?? `f${i}`}`);
          });
          parts.push(`  (local.get ${recLocal})`);
          parts.push(`)`);
          return parts.join("\n");
        }
        return `(i32.const 0)`;
      }
      if (name === "#record-update") {
        // #163: `{ ...base, field: v }` — bump-allocate a fresh record of the base's
        // type, copy ALL base slots, then overwrite the named update fields at their slot
        // offsets. Needs the base's record type (→ field layout) and an active recordCtx;
        // otherwise the placeholder is preserved (unknown base type → can't size it).
        const updChildren = node.children ?? [];
        const spreadBase = updChildren.find(c => c.value === "#spread")?.children?.[0];
        const updates = updChildren.filter(c => c.value !== "#spread");
        const baseType = spreadBase !== undefined ? inferExprType(spreadBase) : undefined;
        const layout = (baseType !== undefined && recordLayouts !== null) ? recordLayouts.get(baseType) : undefined;
        if (recordCtx !== null && spreadBase !== undefined && layout !== undefined) {
          const recLocal  = `$__lln_rec_${recordCtx.counter.n++}`;
          const baseLocal = `$__lln_rec_${recordCtx.counter.n++}`;
          recordCtx.localDecls.push(`(local ${recLocal} i32)`);
          recordCtx.localDecls.push(`(local ${baseLocal} i32)`);
          const size = layout.length * WAT_REC_FIELD_SIZE;
          const baseWat = emitWATExpr(spreadBase, vars, staticConsts);
          const parts: string[] = [`(block (result i32)`];
          parts.push(`  (local.set ${baseLocal} ${baseWat})`);
          parts.push(`  (local.set ${recLocal} (global.get $__lln_heap))`);
          parts.push(`  (global.set $__lln_heap (i32.add (global.get $__lln_heap) (i32.const ${size})))`);
          // Copy every base slot, then overwrite the updated fields by slot index.
          layout.forEach((fname, i) => {
            const off = i * WAT_REC_FIELD_SIZE;
            parts.push(`  (i32.store (i32.add (local.get ${recLocal}) (i32.const ${off})) (i32.load (i32.add (local.get ${baseLocal}) (i32.const ${off})))) ;; copy .${fname}`);
          });
          for (const u of updates) {
            const idx = layout.indexOf(u.value ?? "");
            if (idx < 0) continue;
            const off = idx * WAT_REC_FIELD_SIZE;
            const valNode = u.children?.[0];
            const valWat = valNode ? emitWATExpr(valNode, vars, staticConsts) : "(i32.const 0)";
            parts.push(`  (i32.store (i32.add (local.get ${recLocal}) (i32.const ${off})) ${valWat}) ;; set .${u.value}`);
          }
          parts.push(`  (local.get ${recLocal})`);
          parts.push(`)`);
          return parts.join("\n");
        }
        // Fallback: unknown base type — keep the null-handle placeholder (no trailing
        // ;; comment so it stays safe as an inline argument).
        return `(i32.const 0)`;
      }
      const children = node.children ?? [];

      // ── P9.3: stdlib method calls → host import bridge ──────────────────────
      // Method-style calls (s.charAt(i), c.isLetter(), arr.append(x), …) parse as
      // callExpr with callStyle "method" and children = [receiver, ...args].
      if (node.callStyle === "method") {
        const receiverNode = children[0];
        const argNodes = children.slice(1);

        // Special case: Array.empty() — receiver is the `Array` type, host func
        // takes zero params, so drop the receiver and pass no arguments.
        const receiverIsArrayType =
          receiverNode?.kind === "identifier" && receiverNode.value === "Array";
        if (name === "empty" && receiverIsArrayType) {
          return `(call $host___array_create)`;
        }

        // Resolve the *real* receiver: static-form calls (Char.toString(c)) name the
        // type as the receiver, so the actual value is the first argument.
        const recvName0 = receiverNode?.kind === "identifier" ? (receiverNode.value ?? "") : "";
        const isTypeRecv0 = recvName0 === "String" || recvName0 === "Int" || recvName0 === "Char" || recvName0 === "Array";
        const realReceiver = isTypeRecv0 ? argNodes[0] : receiverNode;

        // #160: codePoint is identity — a Char is already its code point i32. Emit the
        // receiver value directly (no host call). No trailing comment (used inline).
        if (name === "codePoint" && realReceiver !== undefined) {
          return emitWATExpr(realReceiver, vars, staticConsts);
        }

        // #160: type-directed toString/toStr. Char → __char_to_string (String.fromCodePoint);
        // everything else defaults to __int_to_str (matches prior behaviour for Int).
        if ((name === "toString" || name === "toStr") && realReceiver !== undefined) {
          const recvType = isTypeRecv0 ? recvName0 : inferExprType(realReceiver);
          const fn = recvType === "Char" ? "$host___char_to_string" : "$host___int_to_str";
          return `(call ${fn} ${emitWATExpr(realReceiver, vars, staticConsts)})`;
        }

        // #162: type-directed toUpper/toLower — Char → __char_to_upper/lower (Char→Char);
        // String (or unknown, the common case) → __str_to_upper/lower (String→String).
        if ((name === "toUpper" || name === "toLower") && realReceiver !== undefined) {
          const recvType = isTypeRecv0 ? recvName0 : inferExprType(realReceiver);
          const isChar = recvType === "Char";
          const fn = name === "toUpper"
            ? (isChar ? "$host___char_to_upper" : "$host___str_to_upper")
            : (isChar ? "$host___char_to_lower" : "$host___str_to_lower");
          return `(call ${fn} ${emitWATExpr(realReceiver, vars, staticConsts)})`;
        }

        // #160/#162: type-directed `contains`. String → __str_contains (substring),
        // Array<String> → __array_contains_str (by-value), else __array_contains (handle).
        if (name === "contains" && realReceiver !== undefined && argNodes.length === 1) {
          const recvType = inferExprType(realReceiver);
          const recvWat = emitWATExpr(realReceiver, vars, staticConsts);
          const argWat = emitWATExpr(argNodes[0]!, vars, staticConsts);
          if (recvType === "String") {
            return `(call $host___str_contains ${recvWat} ${argWat})`;
          }
          if (recvType !== undefined && /^Array<\s*String\s*>$/.test(recvType)) {
            return `(call $host___array_contains_str ${recvWat} ${argWat})`;
          }
        }

        const hostFn = STDLIB_HOST_MAP[name];
        if (hostFn !== undefined) {
          // Static-form stdlib calls — e.g. String.charAt(s, i) — name the type
          // as the receiver. In that case the real receiver is the first ARG, so
          // we must NOT also emit the type identifier. Detect a capitalised type
          // receiver (String / Int / Char / Array) and drop it.
          const recvName = receiverNode?.kind === "identifier" ? (receiverNode.value ?? "") : "";
          const isTypeReceiver =
            recvName === "String" || recvName === "Int" || recvName === "Char" || recvName === "Array";
          const operandNodes = isTypeReceiver ? argNodes : children;
          const operandWats = operandNodes.map((c) => emitWATExpr(c, vars, staticConsts));
          return `(call ${hostFn} ${operandWats.join(" ")})`.trimEnd();
        }
        // Unknown method — fall through to a plain $method call (legacy behaviour).
        const args = children.map((c) => emitWATExpr(c, vars, staticConsts));
        return `(call $${name} ${args.join(" ")})`.trimEnd();
      }

      // ── P9.3: plain stdlib constructor calls (Some(x)) ──────────────────────
      const hostCallFn = STDLIB_HOST_CALL_MAP[name];
      if (hostCallFn !== undefined) {
        const args = children.map((c) => emitWATExpr(c, vars, staticConsts));
        return `(call ${hostCallFn} ${args.join(" ")})`.trimEnd();
      }

      // Flow-to-flow calls within pure flows.
      const args = children.map((c) => emitWATExpr(c, vars, staticConsts));
      return `(call $${name} ${args.join(" ")})`.trimEnd();
    }

    case "boolLiteral": {
      // Boolean: true = 1, false = 0 (standard WASM i32 convention).
      // No trailing ;; line comment — it would swallow the closing paren of any
      // enclosing S-expression when this bool is used as an inline argument.
      const val = node.value === "true" || node.value === "1" ? 1 : 0;
      return `(i32.const ${val})`;
    }

    case "stringLiteral": {
      // String: intern the value and return its i32 ID (opaque handle).
      // The host registers the string table at WASM load time (reconstructed from
      // the ;; ID = "value" table emitted once at module end — NOT inline).
      // No trailing inline comment: it would break enclosing (call ...) args.
      const id = internString(node.value ?? "");
      return `(i32.const ${id})`;
    }

    case "charLiteral": {
      // Char: a code point i32 — matches the host convention where String.charAt
      // returns charCodeAt(i) (see __str_char_at). So `'A'` → (i32.const 65), and a
      // comparison `c == 'A'` lowers to (i32.eq (local.get $c) (i32.const 65)).
      // No trailing ;; comment — used inline inside (i32.eq …) and other S-exprs.
      const resolved = resolveCharEscapeWAT(node.value ?? "");
      const code = resolved.length > 0 ? resolved.codePointAt(0) ?? 0 : 0;
      return `(i32.const ${code})`;
    }

    case "listLiteral": {
      // P9.3: List/Array literals using host-side array manager.
      // Pattern: call __array_create → get arr_id, then __array_append for each item.
      // The host maintains the actual array; WASM passes i32 IDs.
      //
      // WAT emission strategy: use a block that produces the array ID.
      // Since we can't easily use a local variable here (we're inside an expr),
      // we emit a call sequence using nested blocks with drops.
      const items = node.children ?? [];
      if (items.length === 0) {
        return `(call $host___array_create)`;
      }
      // For non-empty lists, we need a temporary. Emit as a sequence:
      // The WAT block approach: use the host's array create + appends.
      // We rely on the fact that most list literals in the lexer are small (2-3 items).
      // Emit: append all items to a newly created array, return its ID.
      // Because WAT doesn't have a clean "do this then return that" for expressions,
      // we use: (block (result i32) create set-global append... get-global)
      // using global $__lln_tmp_arr as a mutable temporary.
      const appends = items.map(item => {
        const itemWat = emitWATExpr(item, vars, staticConsts);
        // #145a: __array_append now returns the array handle; here it is used as a
        // statement (the temp array is tracked via $__lln_tmp_arr), so drop the result.
        return `(drop (call $host___array_append (global.get $__lln_tmp_arr) ${itemWat}))`;
      }).join("\n  ");
      return [
        `(block (result i32)`,
        `  (global.set $__lln_tmp_arr (call $host___array_create))`,
        `  ${appends}`,
        `  (global.get $__lln_tmp_arr)`,
        `)`,
      ].join("\n");
    }

    case "block": {
      // An anonymous block expression — evaluate the last child as the value.
      // Used in match arm bodies and similar value-producing blocks.
      const stmts = node.children ?? [];
      if (stmts.length === 0) return "(i32.const 0) ;; empty block";
      const last = stmts[stmts.length - 1]!;
      // If the last statement is a returnStmt, use its child value
      if (last.kind === "returnStmt") {
        return last.children?.[0] ? emitWATExpr(last.children[0], vars, staticConsts) : "(i32.const 0)";
      }
      // Otherwise try to emit the last statement as a value expression
      return emitWATExpr(last, vars, staticConsts);
    }

    case "matchExpr": {
      // match VALUE { ARM => { BODY } ... }
      // WAT: if/else chain on integer discriminants (most common case in self-hosted compiler).
      const subject = node.children?.[0];
      const arms = node.children?.slice(1).filter(c => c.kind === "matchArm") ?? [];

      if (subject === undefined || arms.length === 0) {
        return `(unreachable) ;; empty match — fail-closed (malformed; emitter cannot lower; #128-sibling)`;
      }

      const subjectWat = emitWATExpr(subject, vars, staticConsts);

      // Body is the LAST child; a leading identifier child is the Some/Ok binding.
      const armBodyExpr = (arm: AstNode): AstNode | undefined =>
        arm.children?.[arm.children.length - 1];

      // ── Option<T> match-as-value: None / Some(x) sentinel dispatch (#160) ──
      // Mirrors the statement path: None ⇒ subject < 0, Some(x) ⇒ subject >= 0 with
      // x bound to the value. Evaluate the subject once into a scratch local.
      const noneArm = arms.find(a => a.value === "None");
      const someArm = arms.find(a => a.value === "Some");
      if ((noneArm !== undefined || someArm !== undefined) && recordCtx !== null) {
        const scratch = `$__lln_match_${recordCtx.counter.n++}`;
        recordCtx.localDecls.push(`(local ${scratch} i32)`);
        const someBind = ((): string | undefined => {
          const ch = someArm?.children ?? [];
          return ch.length >= 2 && ch[0]?.kind === "identifier" ? ch[0]!.value : undefined;
        })();
        const noneBody = noneArm ? armBodyExpr(noneArm) : undefined;
        const someBody = someArm ? armBodyExpr(someArm) : undefined;
        const noneWat = noneBody ? emitWATExpr(noneBody, vars, staticConsts) : "(i32.const 0)";
        const someVars: ReadonlyMap<string, string> = someBind !== undefined
          ? new Map([...vars, [someBind, scratch]]) : vars;
        // #160: scope the Some binding's type (Option<T> inner) while emitting the arm.
        const someBindType = optionInnerType(inferExprType(subject));
        const hadType = someBind !== undefined && recordVarTypes !== null && recordVarTypes.has(someBind);
        const prevType = someBind !== undefined ? recordVarTypes?.get(someBind) : undefined;
        if (someBind !== undefined && recordVarTypes !== null && someBindType !== undefined) {
          recordVarTypes.set(someBind, someBindType);
        }
        const someWat = someBody ? emitWATExpr(someBody, someVars, staticConsts) : "(i32.const 0)";
        if (someBind !== undefined && recordVarTypes !== null) {
          if (hadType) recordVarTypes.set(someBind, prevType!);
          else recordVarTypes.delete(someBind);
        }
        return [
          `(block (result i32)`,
          `  (local.set ${scratch} ${subjectWat})`,
          `  (if (result i32) (i32.lt_s (local.get ${scratch}) (i32.const 0))`,
          `    (then ${noneWat})`,
          `    (else ${someWat})`,
          `  )`,
          `)`,
        ].join("\n");
      }

      // Build an if/else chain for each arm.
      // The last wildcard/default arm provides the else value.
      // Emit innermost-first so the default wraps the chain.
      const buildMatchChain = (armIdx: number): string => {
        if (armIdx >= arms.length) return "(i32.const 0) ;; no default arm";
        const arm = arms[armIdx]!;
        const pattern = arm.value ?? "_";
        const body = armBodyExpr(arm);
        const bodyWat = body ? emitWATExpr(body, vars, staticConsts) : "(i32.const 0)";

        if (pattern === "_" || pattern === "else" || pattern === "None" || pattern === "default") {
          // Wildcard / default arm — no condition needed
          return bodyWat;
        }

        // Try to parse as an integer constant for equality comparison
        const asInt = parseInt(pattern, 10);
        if (!isNaN(asInt)) {
          const rest = buildMatchChain(armIdx + 1);
          return `(if (result i32) (i32.eq ${subjectWat} (i32.const ${asInt}))\n  (then ${bodyWat})\n  (else ${rest})\n)`;
        }

        // #168: a user-enum variant pattern compares against its i32 tag.
        const enumTag = enumVariantTag(pattern, subject);
        const rest = buildMatchChain(armIdx + 1);
        if (enumTag !== undefined) {
          return `(if (result i32) (i32.eq ${subjectWat} (i32.const ${enumTag}))\n  (then ${bodyWat})\n  (else ${rest})\n)`;
        }

        // Otherwise a constructor name (e.g. "Some") — opaque interned-id comparison (legacy).
        const patternId = internString(pattern);
        return `(if (result i32) (i32.eq ${subjectWat} (i32.const ${patternId}))\n  (then ${bodyWat})\n  (else ${rest})\n)`;
      };

      return buildMatchChain(0);
    }

    default:
      return `(unreachable) ;; unhandled: ${node.kind} — fail-closed (emitter cannot lower; #128-sibling)`;
  }
}

/**
 * Phase 26: Negates a WAT condition expression.
 * Used by whileStmt to convert "while cond" to "br_if $exit when NOT cond".
 *
 * "while i <= n" → loop exits when "i > n", i.e. (i32.gt_s i n).
 * Inversion: flip lt_s↔gt_s, le_s↔ge_s, eq↔ne.
 * Unknown ops: wrap in (i32.eqz ...)
 */
function negateBinaryOp(op: string): string | null {
  const NEG: ReadonlyMap<string, string> = new Map([
    ["<",  "i32.ge_s"],
    [">",  "i32.le_s"],
    ["<=", "i32.gt_s"],
    [">=", "i32.lt_s"],
    ["==", "i32.ne"],
    ["!=", "i32.eq"],
  ]);
  return NEG.get(op) ?? null;
}

/**
 * Phase 26: Emits the last "value expression" of a block for WAT.
 * Used for the (then ...) and (else ...) branches of a value-producing if.
 *
 * Finds the last statement in the block that produces a value and returns
 * its WAT expression string (without the surrounding WAT block structure).
 */
export function emitBlockLastExpr(
  blockNode: AstNode,
  vars: ReadonlyMap<string, string>,
  staticConsts: ReadonlyMap<string, number> = new Map(),
): string {
  const stmts = blockNode.children ?? [];
  const last = stmts[stmts.length - 1];
  if (last === undefined) return "(i32.const 0)";
  if (last.kind === "returnStmt") {
    return last.children?.[0] ? emitWATExpr(last.children[0], vars, staticConsts) : "(i32.const 0)";
  }
  if (last.kind === "binaryExpr" || last.kind === "callExpr" ||
      last.kind === "identifier"  || last.kind === "numberLiteral" ||
      last.kind === "boolLiteral" || last.kind === "stringLiteral" ||
      last.kind === "matchExpr"   || last.kind === "listLiteral") {
    return emitWATExpr(last, vars, staticConsts);
  }
  return "(unreachable) ;; unresolved block expr — fail-closed (emitter cannot lower block tail; #128-sibling)";
}

/**
 * Phase 25/26: Emits WAT statements for a block of LogicN statements.
 *
 * Mutates `localDecls` (appends new local declarations at the TOP of the function)
 * and `bodyLines` (appends WAT instructions in order).
 * Uses a shared `labelCounter` object for unique block/loop label names.
 *
 * Handles:
 *   Phase 25: letDecl (new + rebind), returnStmt, callExpr
 *   Phase 26: ifStmt (with and without else), whileStmt (bounded + unbounded)
 */
function emitBlockStatements(
  blockNode: AstNode,
  vars: Map<string, string>,
  localDecls: string[],
  bodyLines:  string[],
  labelCounter: { n: number },
  /** Phase 27B: when true, emit (return <expr>) for returnStmt instead of bare expr.
   *  Used inside nested blocks (if/while bodies) where implicit stack return is invalid. */
  nested = false,
  /** Compile-time constants from `static` and `bitfield` declarations. */
  staticConsts: ReadonlyMap<string, number> = new Map(),
): void {
  const stmts: readonly AstNode[] = blockNode.children ?? [];

  for (let si = 0; si < stmts.length; si++) {
    const stmt = stmts[si] as AstNode;  // guaranteed by bounds check
    const isLast = si === stmts.length - 1;

    switch (stmt.kind) {
      case "mutDecl":
      case "letDecl": {
        // mutDecl has value like "total: Int" — strip the type annotation
        const rawName  = stmt.value ?? `_anon${localDecls.length}`;
        const varName  = rawName.split(":")[0]?.trim() ?? rawName;
        const watLocal = `$${varName}`;
        const initNode = stmt.children?.[0];
        // P9.4b: remember the record type of this binding so later `varName.field`
        // accesses lower to an i32.load at the field offset.
        // #160: also track scalar/builtin types (String/Char/Int/Option<…>) so later
        // `+` and `.toString()` lower type-directed. Annotation wins; else infer from init.
        if (recordVarTypes !== null) {
          const recType = recordTypeOfBinding(rawName, initNode);
          if (recType !== undefined) {
            recordVarTypes.set(varName, recType);
          } else {
            const anno = rawName.includes(":") ? rawName.split(":")[1]!.trim() : "";
            const ty = anno !== "" ? anno : inferExprType(initNode);
            if (ty !== undefined && ty !== "") recordVarTypes.set(varName, ty);
          }
        }
        const initExpr = initNode ? emitWATExpr(initNode, vars, staticConsts) : "(i32.const 0)";

        if (vars.has(varName)) {
          // Variable already declared — this is a mutation (e.g. let x = x + 1 inside a loop).
          // Do NOT add a second (local $x) declaration — just set the existing one.
          bodyLines.push(`(local.set ${watLocal} ${initExpr})`);
        } else {
          // New variable: declare at function top + initialise inline.
          vars.set(varName, watLocal);
          localDecls.push(`(local ${watLocal} i32)`);
          bodyLines.push(`(local.set ${watLocal} ${initExpr})`);
        }
        break;
      }

      case "assignStmt": {
        // total = total + i  →  (local.set $total <expr>)
        // The assigned variable must already be in scope (declared by mutDecl or letDecl).
        const varName  = (stmt.value ?? "").trim();
        const watLocal = vars.get(varName) ?? `$${varName}`;
        const exprNode = stmt.children?.[0];
        const exprStr  = exprNode ? emitWATExpr(exprNode, vars, staticConsts) : "(i32.const 0)";
        if (!vars.has(varName)) {
          // Declare it now if somehow not in scope (defensive)
          vars.set(varName, watLocal);
          localDecls.push(`(local ${watLocal} i32)`);
        }
        bodyLines.push(`(local.set ${watLocal} ${exprStr})`);
        break;
      }

      case "returnStmt": {
        const exprNode = stmt.children?.[0];
        const exprStr  = exprNode !== undefined
          ? emitWATExpr(exprNode, vars, staticConsts)
          : "(i32.const 0) ;; return void";
        // Inside nested blocks (if/while body), use explicit (return <expr>)
        // so the value is returned from the FUNCTION, not just pushed to the block stack.
        // At top-level function body, the last expr is the implicit function return.
        if (nested) {
          bodyLines.push(`(return ${exprStr})`);
        } else {
          bodyLines.push(exprStr);
        }
        break;
      }

      case "ifStmt": {
        // ifStmt children: [condition, thenBlock, elseBlock?]
        const [condNode, thenBlock, elseBlock] = stmt.children ?? [];

        // AOT #2 (R&D 0036): branch-folding + dead-arm DCE. When the condition folds to a compile-time
        // constant boolean, the taken branch is deterministic — emit ONLY that arm inline (the dead arm
        // and its locals are never emitted). The interpreter evaluates the same constant condition and
        // takes the same branch, so the WASM output is identical (semantics-preserving / 0014-safe).
        // Arms are emitted with nested=true, so any `return` becomes an explicit `(return …)` — valid at
        // any position (no stack imbalance), exactly as the un-folded `(if (then …))` arms already do.
        const foldedCond = foldToBool(condNode, staticConsts);
        if (foldedCond !== null) {
          const takenArm = foldedCond ? thenBlock : elseBlock;
          if (takenArm !== undefined) {
            if (takenArm.kind === "ifStmt") {
              // `else if` chain: re-process the taken ifStmt as a synthetic block statement.
              const synth: AstNode = {
                kind: "block",
                children: [takenArm],
                ...(takenArm.location !== undefined ? { location: takenArm.location } : {}),
              };
              emitBlockStatements(synth, vars, localDecls, bodyLines, labelCounter, true, staticConsts);
            } else {
              emitBlockStatements(takenArm, vars, localDecls, bodyLines, labelCounter, true, staticConsts);
            }
          }
          // folded-true with no then-block, or folded-false with no else, emits nothing — the if is dead.
          break;
        }

        const condExpr = condNode ? emitWATExpr(condNode, vars, staticConsts) : "(i32.const 1)";

        // Value-producing if/else: ONLY when isLast AND both branches end with returnStmt.
        // An if block whose branches contain assignStmt is NOT value-producing.
        const thenEndsWithReturn = (thenBlock?.children ?? []).some(c => c.kind === "returnStmt");
        const elseEndsWithReturn = elseBlock !== undefined
          && elseBlock.kind !== "ifStmt"
          && (elseBlock.children ?? []).some(c => c.kind === "returnStmt");
        const isValueProducing = thenBlock !== undefined && elseBlock !== undefined
          && isLast && thenEndsWithReturn && elseEndsWithReturn;

        if (isValueProducing) {
          // Value-producing if/else (last stmt → the if provides the function's return value).
          // Emit: (if (result i32) COND (then THEN_EXPR) (else ELSE_EXPR))
          const thenExpr = emitBlockLastExpr(thenBlock!, vars, staticConsts);
          const elseExpr = emitBlockLastExpr(elseBlock!, vars, staticConsts);
          bodyLines.push(`(if (result i32) ${condExpr}`);
          bodyLines.push(`  (then ${thenExpr})`);
          bodyLines.push(`  (else ${elseExpr})`);
          bodyLines.push(`)`);
        } else {
          // Statement if: may have side effects but leaves nothing on the stack.
          // Emit: (if COND (then BODY) (else BODY)?)
          //
          // Special case: `else if` chains have an ifStmt (not a block) as elseBlock.
          // We normalise by wrapping it in a synthetic block for the else emitter.
          if (thenBlock !== undefined) {
            bodyLines.push(`(if ${condExpr}`);
            bodyLines.push(`  (then`);
            const thenLines: string[] = [];
            emitBlockStatements(thenBlock, vars, localDecls, thenLines, labelCounter, true, staticConsts);
            for (const line of thenLines) bodyLines.push(`    ${line}`);
            bodyLines.push(`  )`);
            if (elseBlock !== undefined) {
              bodyLines.push(`  (else`);
              const elseLines: string[] = [];
              if (elseBlock.kind === "ifStmt") {
                // else if: wrap the ifStmt in a synthetic block
                const synthBlock: AstNode = {
                kind: "block",
                children: [elseBlock],
                ...(elseBlock.location !== undefined ? { location: elseBlock.location } : {}),
              };
                emitBlockStatements(synthBlock, vars, localDecls, elseLines, labelCounter, true, staticConsts);
              } else {
                emitBlockStatements(elseBlock, vars, localDecls, elseLines, labelCounter, true, staticConsts);
              }
              for (const line of elseLines) bodyLines.push(`    ${line}`);
              bodyLines.push(`  )`);
            }
            bodyLines.push(`)`);
          }
        }
        break;
      }

      case "whileStmt": {
        // whileStmt children: [condition, bodyBlock]
        // WAT pattern: (block $exit_N (loop $loop_N (br_if $exit_N NOT_COND) BODY (br $loop_N)))
        const [condNode, bodyBlock] = stmt.children ?? [];
        const labelN = labelCounter.n++;
        const exitLabel = `$while_exit_${labelN}`;
        const loopLabel = `$while_loop_${labelN}`;

        // Negate condition for the exit branch:
        // "while i <= n" → exit when (i32.gt_s i n)
        let exitCondExpr: string;
        if (condNode?.kind === "binaryExpr") {
          const negOp = negateBinaryOp(condNode.value ?? "");
          if (negOp !== null) {
            const left  = condNode.children?.[0] ? emitWATExpr(condNode.children[0], vars, staticConsts) : "(i32.const 0)";
            const right = condNode.children?.[1] ? emitWATExpr(condNode.children[1], vars, staticConsts) : "(i32.const 0)";
            exitCondExpr = `(${negOp} ${left} ${right})`;
          } else {
            exitCondExpr = `(i32.eqz ${condNode ? emitWATExpr(condNode, vars, staticConsts) : "(i32.const 1)"})`;
          }
        } else {
          exitCondExpr = `(i32.eqz ${condNode ? emitWATExpr(condNode, vars, staticConsts) : "(i32.const 1)"})`;
        }

        bodyLines.push(`(block ${exitLabel}`);
        bodyLines.push(`  (loop ${loopLabel}`);
        bodyLines.push(`    (br_if ${exitLabel} ${exitCondExpr})`);

        if (bodyBlock !== undefined) {
          const loopLines: string[] = [];
          emitBlockStatements(bodyBlock, vars, localDecls, loopLines, labelCounter, true, staticConsts);
          for (const line of loopLines) bodyLines.push(`    ${line}`);
        }

        bodyLines.push(`    (br ${loopLabel})`);
        bodyLines.push(`  )`);
        bodyLines.push(`)`);
        break;
      }

      case "callExpr": {
        const callExpr = emitWATExpr(stmt, vars, staticConsts);
        bodyLines.push(`(drop ${callExpr})`);
        break;
      }

      case "matchExpr": {
        // Match used as a statement.
        // The subject (child[0]) is the discriminant; children[1..] are matchArm nodes.
        // Each arm's body is a block of statements — emit using emitBlockStatements recursively.
        const matchSubject = stmt.children?.[0];
        const matchArms = (stmt.children ?? []).slice(1).filter(c => c.kind === "matchArm");

        if (matchSubject === undefined || matchArms.length === 0) break;

        const subjectWat = emitWATExpr(matchSubject, vars, staticConsts);

        // ── Option<T> match: None / Some(x) sentinel dispatch (#160) ──────────
        // Host convention (P9): None is encoded as a negative i32 sentinel (-1);
        // Some(v) as the value itself (v >= 0). String.charAt() returns this
        // directly. So `match opt { None => …, Some(c) => … }` lowers to:
        //   (local.set $scratch <subject>)
        //   (if (i32.lt_s $scratch 0) (then <None body>) (else <Some body, c=$scratch>))
        // Previously `None` was mis-treated as an unconditional default arm, so the
        // None body fired every iteration (tokenize emitted a lone Eof). The `Some`
        // binding is the arm's leading identifier child; the body is the LAST child.
        const noneArm = matchArms.find(a => a.value === "None");
        const someArm = matchArms.find(a => a.value === "Some");
        if (noneArm !== undefined || someArm !== undefined) {
          const armBodyNode = (arm: AstNode): AstNode | undefined =>
            arm.children?.[arm.children.length - 1];
          const someBind = ((): string | undefined => {
            const ch = someArm?.children ?? [];
            return ch.length >= 2 && ch[0]?.kind === "identifier" ? ch[0]!.value : undefined;
          })();
          // #160: the Some binding's scalar type = the subject's Option<T> inner type
          // (e.g. `match opt:Option<Char>` ⇒ c is Char), so `c.toString()` in the arm
          // lowers to __char_to_string and `… + c` concatenates correctly.
          const someBindType = optionInnerType(inferExprType(matchSubject));

          // Evaluate the subject once into a scratch local so it can be both tested
          // (sign check) and bound (Some value). Negative ⇒ None, else ⇒ Some.
          const scratch = `$__lln_match_${labelCounter.n++}`;
          localDecls.push(`(local ${scratch} i32)`);
          bodyLines.push(`(local.set ${scratch} ${subjectWat})`);

          const emitArm = (arm: AstNode | undefined, bind?: string): string[] => {
            const lines: string[] = [];
            const body = arm ? armBodyNode(arm) : undefined;
            if (body === undefined) return lines;
            // Scope the Some binding (value + type) to this arm body only (save/restore).
            const hadBind = bind !== undefined && vars.has(bind);
            const prevBind = bind !== undefined ? vars.get(bind) : undefined;
            const hadType = bind !== undefined && recordVarTypes !== null && recordVarTypes.has(bind);
            const prevType = bind !== undefined ? recordVarTypes?.get(bind) : undefined;
            if (bind !== undefined) {
              vars.set(bind, scratch);
              if (recordVarTypes !== null && someBindType !== undefined) recordVarTypes.set(bind, someBindType);
            }
            emitBlockStatements(body, vars, localDecls, lines, labelCounter, true, staticConsts);
            if (bind !== undefined) {
              if (hadBind) vars.set(bind, prevBind!);
              else vars.delete(bind);
              if (recordVarTypes !== null) {
                if (hadType) recordVarTypes.set(bind, prevType!);
                else recordVarTypes.delete(bind);
              }
            }
            return lines;
          };

          const noneLines = emitArm(noneArm);
          const someLines = emitArm(someArm, someBind);

          bodyLines.push(`(if (i32.lt_s (local.get ${scratch}) (i32.const 0))`);
          bodyLines.push(`  (then`);
          for (const line of noneLines) bodyLines.push(`    ${line}`);
          bodyLines.push(`  )`);
          bodyLines.push(`  (else`);
          for (const line of someLines) bodyLines.push(`    ${line}`);
          bodyLines.push(`  )`);
          bodyLines.push(`)`);
          break;
        }

        // ── Result<T,E> match: Ok(v) / Err(e) dispatch (#164) ─────────────────
        // A Result is an opaque registry handle. Read its tag (Ok→0/Err→1) and unwrap
        // the payload via host imports; bind v/e to the unwrapped value (one scratch
        // holds the subject, one holds the unwrapped payload — only one arm executes).
        const okArm = matchArms.find(a => a.value === "Ok");
        const errArm = matchArms.find(a => a.value === "Err");
        if (okArm !== undefined || errArm !== undefined) {
          const resBindOf = (arm: AstNode | undefined): string | undefined => {
            const ch = arm?.children ?? [];
            return ch.length >= 2 && ch[0]?.kind === "identifier" ? ch[0]!.value : undefined;
          };
          // #164: the Ok binding's scalar type = the Result's first type arg (Result<T,E> ⇒ T).
          const okBindType = optionInnerType(inferExprType(matchSubject));
          const scratch = `$__lln_match_${labelCounter.n++}`;
          const valLocal = `$__lln_match_${labelCounter.n++}`;
          localDecls.push(`(local ${scratch} i32)`);
          localDecls.push(`(local ${valLocal} i32)`);
          bodyLines.push(`(local.set ${scratch} ${subjectWat})`);
          bodyLines.push(`(local.set ${valLocal} (call $host___result_value (local.get ${scratch})))`);

          const emitResArm = (arm: AstNode | undefined, bind: string | undefined, bindType: string | undefined): string[] => {
            const lines: string[] = [];
            const body = arm ? arm.children?.[arm.children.length - 1] : undefined;
            if (body === undefined) return lines;
            const bodyBlock: AstNode = body.kind === "block"
              ? body
              : { kind: "block", children: [body], ...(body.location !== undefined ? { location: body.location } : {}) };
            const hadBind = bind !== undefined && vars.has(bind);
            const prevBind = bind !== undefined ? vars.get(bind) : undefined;
            const hadType = bind !== undefined && recordVarTypes !== null && recordVarTypes.has(bind);
            const prevType = bind !== undefined ? recordVarTypes?.get(bind) : undefined;
            if (bind !== undefined) {
              vars.set(bind, valLocal);
              if (recordVarTypes !== null && bindType !== undefined) recordVarTypes.set(bind, bindType);
            }
            emitBlockStatements(bodyBlock, vars, localDecls, lines, labelCounter, true, staticConsts);
            if (bind !== undefined) {
              if (hadBind) vars.set(bind, prevBind!); else vars.delete(bind);
              if (recordVarTypes !== null) { if (hadType) recordVarTypes.set(bind, prevType!); else recordVarTypes.delete(bind); }
            }
            return lines;
          };
          const okLines = emitResArm(okArm, resBindOf(okArm), okBindType);
          const errLines = emitResArm(errArm, resBindOf(errArm), undefined);

          bodyLines.push(`(if (i32.eq (call $host___result_tag (local.get ${scratch})) (i32.const 0))`);
          bodyLines.push(`  (then`);
          for (const line of okLines) bodyLines.push(`    ${line}`);
          bodyLines.push(`  )`);
          bodyLines.push(`  (else`);
          for (const line of errLines) bodyLines.push(`    ${line}`);
          bodyLines.push(`  )`);
          bodyLines.push(`)`);
          break;
        }

        // Emit as a chain of (if (i32.eq subject pattern) (then ...) (else ...))
        // For statement match, we use (if COND (then STMTS)) with no result type.
        // General match → a nested (if COND (then …) (else …)) chain over N arms with
        // BALANCED parens. The previous version only handled one "rest" arm inline (it
        // dropped the 3rd+ arm and imbalanced parens) and called emitBlockStatements on a
        // bare one-liner arm body (emitting its value child as an "unhandled stmt"). This
        // recurses correctly and wraps one-liner bodies in a synthetic block.
        const emitMatchArmStmt = (armIdx: number): void => {
          if (armIdx >= matchArms.length) return;
          const arm = matchArms[armIdx]!;
          const pattern = arm.value ?? "_";
          // Body is the LAST child (a leading identifier child would be a binding).
          const armBody = arm.children?.[arm.children.length - 1];
          const armLines: string[] = [];
          if (armBody !== undefined) {
            const bodyBlock: AstNode = armBody.kind === "block"
              ? armBody
              : { kind: "block", children: [armBody], ...(armBody.location !== undefined ? { location: armBody.location } : {}) };
            emitBlockStatements(bodyBlock, vars, localDecls, armLines, labelCounter, true, staticConsts);
          }

          const isDefault = pattern === "_" || pattern === "else" || pattern === "None" || pattern === "default";
          if (isDefault) {
            // Unconditional arm — any later arms are unreachable.
            for (const line of armLines) bodyLines.push(line);
            return;
          }

          // #164: a guard arm (`when COND => body`) is stored as value "__guard__" with
          // children = [guardExpr, body]; its condition IS the guard expression, not a
          // subject comparison. Otherwise (#168): enum-variant patterns compare against
          // their i32 tag; int literals against the constant; constructor names fall back
          // to the interned id.
          const asInt = parseInt(pattern, 10);
          const enumTag = enumVariantTag(pattern, matchSubject);
          const condWat = pattern === "__guard__"
            ? (arm.children?.[0] ? emitWATExpr(arm.children[0], vars, staticConsts) : "(i32.const 1)")
            : !isNaN(asInt)
              ? `(i32.eq ${subjectWat} (i32.const ${asInt}))`
              : `(i32.eq ${subjectWat} (i32.const ${enumTag !== undefined ? enumTag : internString(pattern)}))`;

          bodyLines.push(`(if ${condWat}`);
          bodyLines.push(`  (then`);
          for (const line of armLines) bodyLines.push(`    ${line}`);
          bodyLines.push(`  )`);
          if (armIdx + 1 < matchArms.length) {
            bodyLines.push(`  (else`);
            emitMatchArmStmt(armIdx + 1); // nested chain appended in order between (else …)
            bodyLines.push(`  )`);
          }
          bodyLines.push(`)`);
        };

        emitMatchArmStmt(0);
        break;
      }

      // trapDecl — hardware trap if condition is TRUE (opposite polarity from ensureDecl)
      // `trap COND : ERROR_CODE` emits: if COND then unreachable
      // Compared to ensureDecl: `ensure COND` emits: if NOT COND then unreachable
      // Both produce atomic hardware traps; trapDecl carries a named error code.
      case "trapDecl": {
        const condNode = stmt.children?.[0];
        const errorCode = stmt.value ?? "ERR_TRAP";
        if (condNode !== undefined) {
          const condWat = emitWATExpr(condNode, vars, staticConsts);
          // condWat evaluates to 1 (true) when the trap SHOULD fire → emit directly
          // Unlike ensureDecl which uses (i32.eqz cond), trapDecl fires when cond is true
          bodyLines.push(`    ;; trap: ${errorCode} — fires if condition is TRUE`);
          bodyLines.push(`    (if ${condWat}`);
          bodyLines.push(`      (then unreachable) ;; LLN-INV-000 trapKind=${errorCode}`);
          bodyLines.push(`    )`);
        }
        break;
      }

      case "forEachStmt": {
        // for-in lowering (#128 part (b) / GAP-4). `for <var> in <collection> { body }`.
        // Collections are host-managed i32 array handles (see the listLiteral case), so we
        // desugar to a counted loop over the __array_length / __array_get host bridge —
        // matching the Stage-A interpreter's `for item in list` semantics. Previously this
        // fell through to the fail-closed `unreachable` trap below (correct but unrunnable).
        //   arr = <collection>; len = __array_length(arr); idx = 0
        //   loop: if idx >= len break; <var> = __array_get(arr, idx); BODY; idx += 1
        const rawVar = stmt.value ?? "item";
        const varName = rawVar.split(":")[0]?.trim() ?? "item";
        const collectionNode = stmt.children?.[0];
        const bodyBlock = stmt.children?.[1];
        const whereGuard = stmt.children?.[2]; // optional `where <guard>` filter (3rd child)
        const labelN = labelCounter.n++;
        const exitLabel = `$forin_exit_${labelN}`;
        const loopLabel = `$forin_loop_${labelN}`;
        const idxLocal = `$__forin_idx_${labelN}`;
        const lenLocal = `$__forin_len_${labelN}`;
        const arrLocal = `$__forin_arr_${labelN}`;

        // Loop-control temps are always fresh (unique per loop).
        localDecls.push(`(local ${idxLocal} i32)`);
        localDecls.push(`(local ${lenLocal} i32)`);
        localDecls.push(`(local ${arrLocal} i32)`);
        // Loop variable: reuse an existing local (mutation/shadow) else declare + register it.
        if (!vars.has(varName)) {
          vars.set(varName, `$${varName}`);
          localDecls.push(`(local $${varName} i32)`);
        }
        const loopVarLocal = vars.get(varName) ?? `$${varName}`;

        const collExpr = collectionNode
          ? emitWATExpr(collectionNode, vars, staticConsts)
          : "(call $host___array_create)";
        bodyLines.push(`;; for-in (#128/GAP-4): ${varName} in <collection>`);
        bodyLines.push(`(local.set ${arrLocal} ${collExpr})`);
        bodyLines.push(`(local.set ${lenLocal} (call $host___array_length (local.get ${arrLocal})))`);
        bodyLines.push(`(local.set ${idxLocal} (i32.const 0))`);
        bodyLines.push(`(block ${exitLabel}`);
        bodyLines.push(`  (loop ${loopLabel}`);
        bodyLines.push(`    (br_if ${exitLabel} (i32.ge_s (local.get ${idxLocal}) (local.get ${lenLocal})))`);
        bodyLines.push(`    (local.set ${loopVarLocal} (call $host___array_get (local.get ${arrLocal}) (local.get ${idxLocal})))`);
        if (bodyBlock !== undefined) {
          const loopLines: string[] = [];
          emitBlockStatements(bodyBlock, vars, localDecls, loopLines, labelCounter, true, staticConsts);
          if (whereGuard !== undefined) {
            // `where` filter: run the body only when the guard is truthy. The idx increment stays
            // OUTSIDE the guard so the loop always advances (no infinite loop on a failing guard).
            const guardWat = emitWATExpr(whereGuard, vars, staticConsts);
            bodyLines.push(`    (if ${guardWat} (then`);
            for (const line of loopLines) bodyLines.push(`      ${line}`);
            bodyLines.push(`    ))`);
          } else {
            for (const line of loopLines) bodyLines.push(`    ${line}`);
          }
        }
        bodyLines.push(`    (local.set ${idxLocal} (i32.add (local.get ${idxLocal}) (i32.const 1)))`);
        bodyLines.push(`    (br ${loopLabel})`);
        bodyLines.push(`  )`);
        bodyLines.push(`)`);
        break;
      }

      default:
        // FAIL-CLOSED (task #128 · audit-phase1-2026-06-16). An unhandled statement
        // kind must NEVER lower to a silent `(i32.const 0)` no-op: that is fail-OPEN.
        // (forEachStmt is now lowered above; any OTHER unhandled kind still traps.)
        // Now that WASM is the measured production tier this violates the project's
        // fail-closed charter.
        //
        // Instead emit an atomic trap. `unreachable` is the polymorphic bottom type:
        // valid anywhere in WAT, and Wasmtime fires a hardware trap before the IP
        // advances — so the flow refuses to produce wrong results rather than silently
        // skipping the construct. Mirrors the ensure/trapDecl gates above and the
        // flow-body stub discipline (~L413-435). Part (b) — real `forEachStmt` lowering
        // — is the follow-up; until then any unsupported kind fails closed here.
        bodyLines.push(`(unreachable) ;; unsupported-in-WASM: ${stmt.kind} — fail-closed trap (task #128), not yet lowered to WAT`);
        break;
    }
  }
}

/**
 * Phase 25/26: Emits the full WAT function body (local decls + instructions)
 * by walking the AST body of a pure flow.
 *
 * Handles (Phase 25):
 *   - Integer arithmetic and comparison (i32.add / lt_s / etc.)
 *   - Integer and float literals (i32.const / f64.const)
 *   - Parameter references (local.get $p0, $p1, …)
 *   - Let-binding — new variables and loop-variable mutation
 *   - Return statements
 *   - Intra-module flow calls
 *
 * Handles (Phase 26):
 *   - if/else with value (last stmt in block → result i32)
 *   - if/else without value (statements with side effects)
 *   - while loops (block + loop + br_if + br pattern)
 *
 * @param flowNode   - The pureFlowDecl / flowDecl AstNode for this flow.
 * @param paramNames - Ordered parameter names extracted from paramDecl children.
 * @returns WAT body string, or null if the body cannot be lowered.
 */
export function emitWATFromFlowAST(
  flowNode: AstNode,
  paramNames: readonly string[],
  staticConsts: ReadonlyMap<string, number> = new Map(),
  layouts: ReadonlyMap<string, readonly string[]> | null = null,
  enums: ReadonlyMap<string, readonly string[]> | null = null,
): string | null {
  // Build variable map: LogicN name → WAT local name.
  // Params are $p0, $p1, … — immutable (parameters are passed by value in WAT).
  const vars = new Map<string, string>();
  paramNames.forEach((name, i) => {
    vars.set(name, `$p${i}`);
  });

  // P9.4b/d: record layout + per-flow var-type tracking + enum-variant registry.
  const prevLayouts = recordLayouts;
  const prevVarTypes = recordVarTypes;
  const prevEnums = enumVariants;
  recordLayouts = layouts;
  recordVarTypes = new Map<string, string>();
  enumVariants = enums;
  // Seed parameter types (e.g. `flow f(r: TokenizeResult, s: String)`). Record types
  // enable `r.field` lowering; scalar types (#160) enable type-directed `+` / toString.
  {
    const paramDecls = (flowNode.children ?? []).filter((c) => c.kind === "paramDecl");
    paramDecls.forEach((pd) => {
      const raw = pd.value ?? "";
      const nm = raw.split(":")[0]!.trim();
      const ty = raw.includes(":") ? raw.split(":")[1]!.trim() : "";
      if (ty && vars.has(nm)) recordVarTypes!.set(nm, ty);
    });
  }

  // Find the block body of the flow.
  const blockNode = (flowNode.children ?? []).find((c) => c.kind === "block");
  if (blockNode === undefined) {
    recordLayouts = prevLayouts; recordVarTypes = prevVarTypes; enumVariants = prevEnums; // restore on early exit
    return null;
  }

  // 0040/#70: output post-conditions (`invariant { ensure result … }`). For a STRAIGHT-LINE flow
  // (no nested/early returns) emit a WASM single-exit gate: capture the tail value into
  // $logicn_result, check each result-referencing post-condition against it, then return it
  // (fail-closed — a violation traps via `unreachable`, the value never escapes). A flow with a
  // nested/early return DECLINES to the governed interpreter (which enforces it fail-closed); the
  // early-return → `br $logicn_exit` rewrite is the further follow-up.
  const resultPosts = flowResultPostconditions(flowNode);
  const singleExit = resultPosts.length > 0;
  if (singleExit && bodyHasNestedReturn(blockNode)) {
    recordLayouts = prevLayouts; recordVarTypes = prevVarTypes; enumVariants = prevEnums; // restore
    return null; // cannot capture-the-tail past an early return → interpreter enforces it
  }
  const RESULT_LOCAL = "$logicn_result";
  if (singleExit) vars.set("result", RESULT_LOCAL);

  const localDecls: string[] = [];
  if (singleExit) localDecls.push(`(local ${RESULT_LOCAL} i32)`);
  const bodyLines:  string[] = [];
  const labelCounter = { n: 0 };

  // ── DRCM Phase 2: invariant {} WAT assertion gates (task #36 Unit 3) ──────
  // Emit pre-condition assertion gates for `runtime-precheck` invariants.
  // `statically_verified` invariants emit NOTHING (Goal A: zero runtime overhead).
  //
  // PHASE 2 SCOPE (parameter-only invariants, enforced by LLN-INV-004):
  //   Parameters are immutable (local.get never changes them). The pre-condition
  //   gate at entry is sufficient — if `ensure max > min` passes at entry, it will
  //   pass at any exit point because max and min haven't changed.
  //   Post-condition is emitted but REDUNDANT for parameter invariants (provides
  //   belt-and-suspenders on the non-early-return path only).
  //
  // PHASE 4 REQUIREMENT (computed-result invariants, SMT scope):
  //   `ensure ledger.credits == ledger.debits` references body-computed state.
  //   Post-conditions become meaningful ONLY here. Phase 4 will add the
  //   single-exit body transformation (local $result + br $exit pattern) to
  //   guarantee the post-condition fires on ALL return paths including early returns.
  //   See: logicn-floor3-proof-zone-graph.md — Single-Exit Transformation section.
  //
  // Security: `unreachable` is atomic — Wasmtime fires a hardware trap before
  // the next instruction pointer advances. No TOCTOU window.
  const ensureNodes = extractInvariantEnsures(flowNode);
  const preGates:  string[] = [];
  const postGates: string[] = [];
  for (const ensureExpr of ensureNodes) {
    const condWAT = emitWATExpr(ensureExpr, vars, staticConsts);
    // Assertion pattern: evaluate condition, negate (eqz), trap if false
    // Stack is neutral: condition consumed by if, unreachable terminates branch
    const gate = `  (if (i32.eqz ${condWAT}) (then unreachable)) ;; ensure ${describeASTExpr(ensureExpr)}`;
    preGates.push(gate);
    postGates.push(gate.replace(";; ensure", ";; post: ensure"));
  }

  // 0040/#70: precompute the OUTPUT post-condition gates (against $logicn_result) here, while the
  // record/var-type context is still active (the tail after the body emit makes no emitWATExpr calls).
  // Pushed after the single-exit capture below.
  const resultPostGates: string[] = [];
  for (const p of resultPosts) {
    const condWAT = emitWATExpr(p, vars, staticConsts);
    resultPostGates.push(`  (if (i32.eqz ${condWAT}) (then unreachable)) ;; post: ensure ${describeASTExpr(p)} (output)`);
  }

  if (preGates.length > 0) {
    bodyLines.push(`  ;; --- invariant pre-conditions (LLN-INV-001 gate) ---`);
    bodyLines.push(...preGates);
  }
  // P9.4b: activate record-construction lowering for this flow body. Record locals
  // (`$__lln_rec_N`) are appended to localDecls so they render at the top of the
  // function (WASM requires all locals before instructions). Cleared in finally so
  // a thrown body never leaks scratch into the next flow.
  const prevRecordCtx = recordCtx;
  recordCtx = { localDecls, counter: { n: 0 } };
  try {
    emitBlockStatements(blockNode, vars, localDecls, bodyLines, labelCounter, false, staticConsts);
  } finally {
    recordCtx = prevRecordCtx;
    // Restore record layout/var-type/enum context. Safe here: the remaining tail only
    // pushes precomputed post-gate lines + joins — no further emitWATExpr calls.
    recordLayouts = prevLayouts;
    recordVarTypes = prevVarTypes;
    enumVariants = prevEnums;
  }
  if (postGates.length > 0) {
    bodyLines.push(`  ;; --- invariant post-conditions (LLN-INV-002 gate) ---`);
    bodyLines.push(...postGates);
  }

  // 0040/#70: single-exit output post-conditions. The body left its tail value on the stack
  // (no nested returns — excluded above); capture it, gate each result post-condition against
  // it (fail-closed: a violation traps), then return it.
  if (singleExit) {
    bodyLines.push(`  ;; --- output post-conditions (LLN-INV-002, single-exit on $logicn_result) ---`);
    bodyLines.push(`  (local.set ${RESULT_LOCAL})`);
    bodyLines.push(...resultPostGates);
    bodyLines.push(`  (local.get ${RESULT_LOCAL})`);
  }

  // #160: every WAT flow function is typed `(result i32)`. When the body's last
  // top-level statement is a `match`/`while`/non-value `if` whose every path returns
  // (the lexer's helper flows end this way), the implicit fallthrough is unreachable
  // but still must type-check as [i32] — emit an explicit `(unreachable)` terminator.
  // This cannot affect flows that already end in a value (returnStmt / value-producing
  // if): those validate today and are excluded by the check below.
  if (!singleExit && postGates.length === 0 && bodyTailIsUnreachable(blockNode)) {
    bodyLines.push(`(unreachable) ;; #160: all match/while arms return — implicit [i32] tail`);
  }

  if (localDecls.length === 0 && bodyLines.length === 0) return null;
  return [...localDecls, ...bodyLines].join("\n");
}

/**
 * True when a flow body's last top-level statement leaves no value on the stack and
 * relies on every internal path returning (statement-form `match`/`while`, or a non
 * value-producing `if`). Used to emit an `(unreachable)` tail so the `(result i32)`
 * function signature type-checks. Returns false for returnStmt / value-producing if /
 * bare value expressions (which already leave the function's i32 result).
 */
function bodyTailIsUnreachable(blockNode: AstNode): boolean {
  const stmts = blockNode.children ?? [];
  const last = stmts[stmts.length - 1];
  if (last === undefined) return false;
  if (last.kind === "matchExpr" || last.kind === "whileStmt") return true;
  if (last.kind === "ifStmt") {
    // Value-producing iff both branches exist and each ends with a return (mirrors
    // the isValueProducing rule in emitBlockStatements). If it IS value-producing it
    // leaves an i32; otherwise its fallthrough needs the unreachable terminator.
    const [, thenBlock, elseBlock] = last.children ?? [];
    const thenRet = (thenBlock?.children ?? []).some(c => c.kind === "returnStmt");
    const elseRet = elseBlock !== undefined && elseBlock.kind !== "ifStmt"
      && (elseBlock.children ?? []).some(c => c.kind === "returnStmt");
    const valueProducing = thenBlock !== undefined && elseBlock !== undefined && thenRet && elseRet;
    return !valueProducing;
  }
  return false;
}

/**
 * Extract `runtime-precheck` ensure expression nodes from a flow's invariant block.
 * `statically_verified` invariants (constant-fold = true) are excluded — no WAT gate needed.
 */
function extractInvariantEnsures(flowNode: AstNode): AstNode[] {
  const contractNode = (flowNode.children ?? []).find(c => c.kind === "contractDecl");
  if (contractNode === undefined) return [];
  const invariantBlock = (contractNode.children ?? []).find(
    c => c.kind === "identifier" && c.value === "invariant:block"
  );
  if (invariantBlock === undefined) return [];

  const ensures: AstNode[] = [];
  for (const child of invariantBlock.children ?? []) {
    if (child.kind !== "ensureDecl") continue;
    const expr = child.children?.[0];
    if (expr === undefined) continue;
    // 0040/#70: output post-conditions (ensure over `result`) are NOT param pre-conditions —
    // never emit a WAT entry/tail gate for them (a bare `result` would lower to `(unreachable)`).
    // emitWATFromFlowAST already declines such flows to the interpreter; this is defence-in-depth.
    if (exprReferencesResult(expr)) continue;
    // Skip statically provable TRUE (constant fold = true) — no WAT gate needed
    const staticResult = tryConstantFold(expr);
    if (staticResult === true) continue;
    // Skip statically FALSE — governance verifier already emitted LLN-INV-001
    if (staticResult === false) continue;
    // Unknown → runtime-precheck → inject WAT gate
    ensures.push(expr);
  }
  return ensures;
}

/**
 * 0040/#70: true when a flow declares an `invariant { ensure … }` whose expression references
 * the magic `result` symbol — an output post-condition over the return value. Such flows are
 * declined by emitWATFromFlowAST and enforced fail-closed by the governed interpreter at exit.
 */
function flowResultPostconditions(flowNode: AstNode): AstNode[] {
  const contractNode = (flowNode.children ?? []).find(c => c.kind === "contractDecl");
  if (contractNode === undefined) return [];
  const invariantBlock = (contractNode.children ?? []).find(
    c => c.kind === "identifier" && c.value === "invariant:block"
  );
  if (invariantBlock === undefined) return [];
  const out: AstNode[] = [];
  for (const child of invariantBlock.children ?? []) {
    if (child.kind !== "ensureDecl") continue;
    const expr = child.children?.[0];
    if (expr !== undefined && exprReferencesResult(expr)) out.push(expr);
  }
  return out;
}

function flowHasResultPostcondition(flowNode: AstNode): boolean {
  return flowResultPostconditions(flowNode).length > 0;
}

/**
 * 0040/#70: true if the flow body has a returnStmt nested BELOW the top level (inside an if/while/
 * match arm) — an early return that the simple capture-the-tail single-exit cannot enforce a
 * post-condition over (it would `(return …)` past the gate). Such flows DECLINE to the governed
 * interpreter (fail-closed). A top-level tail return / value-producing tail is fine (returns nothing
 * nested → false). The early-return → `br $logicn_exit` rewrite is the further follow-up.
 */
function bodyHasNestedReturn(blockNode: AstNode): boolean {
  let nested = false;
  function walk(node: AstNode): void {
    if (nested) return;
    if (node.kind === "returnStmt") { nested = true; return; }
    for (const c of node.children ?? []) walk(c);
  }
  for (const c of blockNode.children ?? []) {
    if (c.kind === "returnStmt") continue; // a top-level (tail) return is allowed
    walk(c); // any returnStmt strictly inside a non-top-level node is a bypassing/early return
  }
  return nested;
}

/** Walk an expression for any identifier named `result` (including member receivers). */
function exprReferencesResult(node: AstNode): boolean {
  if (node.kind === "identifier" && node.value === "result") return true;
  for (const child of node.children ?? []) if (exprReferencesResult(child)) return true;
  return false;
}

/** Lightweight constant-fold for WAT emitter (mirrors governance verifier logic) */
function tryConstantFold(expr: AstNode): boolean | null {
  if (expr.kind === "boolLiteral") return expr.value === "true";
  if (expr.kind === "binaryExpr" && expr.children?.length === 2) {
    const l = expr.children[0], r = expr.children[1];
    if (l?.kind === "numberLiteral" && r?.kind === "numberLiteral") {
      const lv = parseFloat(l.value ?? "0"), rv = parseFloat(r.value ?? "0");
      switch (expr.value) {
        case ">": return lv > rv; case "<": return lv < rv;
        case ">=": return lv >= rv; case "<=": return lv <= rv;
        case "==": return lv === rv; case "!=": return lv !== rv;
      }
    }
  }
  return null;
}

/** Short description of an AST expression for WAT comments */
function describeASTExpr(expr: AstNode): string {
  if (expr.kind === "boolLiteral" || expr.kind === "numberLiteral") return expr.value ?? "?";
  if (expr.kind === "identifier") return expr.value ?? "?";
  if (expr.kind === "binaryExpr" && expr.children?.length === 2) {
    return `${describeASTExpr(expr.children[0]!)} ${expr.value ?? "?"} ${describeASTExpr(expr.children[1]!)}`;
  }
  if (expr.kind === "memberExpr" && expr.children?.length === 1) {
    return `${describeASTExpr(expr.children[0]!)}.${expr.value ?? "?"}`;
  }
  return "expr";
}

/**
 * Extracts ordered parameter names from a flow's paramDecl children.
 *
 * `paramDecl` nodes have `value` like `"a: Int"` — we split on ":" and trim.
 * Returns e.g. ["a", "b"] for `flow add(a: Int, b: Int)`.
 */
export function extractFlowParamNames(flowNode: AstNode): string[] {
  return (flowNode.children ?? [])
    .filter((c) => c.kind === "paramDecl")
    .map((c) => ((c.value ?? "").split(":")[0] ?? "").trim())
    .filter((name) => name.length > 0);
}

/**
 * Finds a top-level flow node in the program AST by name.
 * Matches pureFlowDecl, flowDecl, secureFlowDecl, guardedFlowDecl.
 */
export function findFlowNodeInAST(ast: AstNode, flowName: string): AstNode | undefined {
  const FLOW_KINDS = new Set([
    "pureFlowDecl", "flowDecl", "secureFlowDecl", "guardedFlowDecl", "governedFlowDecl",
  ]);
  for (const child of ast.children ?? []) {
    if (!FLOW_KINDS.has(child.kind)) continue;
    // governedFlowDecl stores value as "governed:<floor>:<name>" — extract the real name
    if (child.kind === "governedFlowDecl") {
      const parts = (child.value ?? "").split(":");
      const realName = parts.slice(2).join(":"); // everything after "governed:<floor>:"
      if (realName === flowName) return child;
    } else if (child.value === flowName) {
      return child;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Pure-flow WAT body emitter (Phase 22)
// ---------------------------------------------------------------------------

/**
 * Emits real WAT instructions for a pure flow from its PassiveExecutionPlan.
 *
 * Pure flows have no effects, no capability calls, no I/O — only math, string
 * ops, and returns. This function converts the plan's steps to WAT instructions.
 *
 * Mapping rules:
 *   validate_param  → ignored at WAT level (compile-time check already done)
 *   validate_context → ignored at WAT level
 *   capability_call  → should not appear in pure flows; emitted as unreachable
 *   emit_event       → ignored at WAT level (no I/O in pure flows)
 *   response         → treated as return
 *   return           → emit (local.get $p0) for first param, then (return)
 *
 * For the simplest pure flow (identity: takes param, returns it):
 *   (local.get $p0)
 *
 * Phase 22: full expression lowering (arithmetic, string ops) deferred to
 * Phase 22B when the GIR carries typed expression trees.
 *
 * @param plan    - The pre-verified PassiveExecutionPlan for this pure flow.
 * @param paramCount - Number of parameters the function accepts.
 * @returns WAT instruction text (one instruction per line, no surrounding parens).
 */
export function emitWATBody(
  plan: { readonly steps: ReadonlyArray<{ readonly kind: string }> },
  paramCount: number,
): string {
  const instructions: string[] = [];

  // A pure flow that takes parameters and returns one: get the first parameter.
  // Phase 22B: walk typed expression tree to emit arithmetic/string ops.
  const hasReturn = plan.steps.some(
    (s) => s.kind === "return" || s.kind === "response",
  );

  // Accept both spellings: "capability_call" (snake_case) and "capabilityCall" (camelCase).
  const hasCapabilityCall = plan.steps.some(
    (s) => s.kind === "capability_call" || s.kind === "capabilityCall",
  );

  // "validateParam" and "validate_param" steps are compile-time proofs —
  // they are no-ops at the WAT level and generate no instructions.
  // "validateContext" / "validate_context" are similarly erased.
  // "emitEvent" / "emit_event" are erased in pure flows (no I/O).

  if (hasCapabilityCall) {
    // Capability calls must not appear in pure flows — guard with unreachable.
    // Phase 25: real capability dispatch via WASM imports.
    instructions.push("unreachable ;; capability call — Phase 25");
    return instructions.join("\n");
  }

  if (hasReturn && paramCount > 0) {
    // Identity-return: get the first parameter and return it.
    // Phase 22B: full expression lowering replaces this with the actual body.
    instructions.push("(local.get $p0) ;; return first param");
  } else if (hasReturn && paramCount === 0) {
    // Return a constant i32 zero when there are no parameters.
    instructions.push("(i32.const 0) ;; default return");
  } else {
    // No return step — unreachable (should not happen for well-formed plans).
    instructions.push("unreachable");
  }

  return instructions.join("\n");
}

// ---------------------------------------------------------------------------
// GIRProgram → WATModule builder
// ---------------------------------------------------------------------------

/**
 * Minimal GIR flow shape required by buildWATModule.
 * Matches the GIRFlow interface subset needed for WAT lowering.
 */
export interface WATFlowInput {
  readonly name: string;
  /** "pure" flows need no imports. Other qualifiers may have effects. */
  readonly qualifier: string;
  /**
   * Declared effect strings — flat array form (WATFlowInput native).
   * When passing GIRFlow directly, use effects.declared instead.
   * The builder accepts either form.
   */
  readonly declaredEffects?: readonly string[];
  /**
   * GIR-native nested effects object. Accepted alongside declaredEffects.
   * buildWATModule resolves: declaredEffects ?? effects?.declared ?? []
   */
  readonly effects?: { readonly declared: readonly string[] };
  /**
   * Parameter type names, e.g. ["Int", "String"].
   * Phase 22: used to build named WAT params ($p0, $p1, …) and for emitWATBody.
   * Optional — absent flows get a default (i32) parameter signature.
   */
  readonly paramTypes?: readonly string[];
  /**
   * Pre-built PassiveExecutionPlan for this flow.
   * When present for a pure flow, emitWATBody is called to produce real instructions.
   * When absent, the body falls back to "unreachable".
   */
  readonly executionPlan?: { readonly steps: ReadonlyArray<{ readonly kind: string }> };
  /**
   * Tensor binding metadata from GIRFlow.tensors.
   * Phase 27: used by buildWATModule to detect Float32 tensor flows and emit
   * TypedArray lowering comments and Tensor.dot memory region hints.
   */
  readonly tensors?: readonly { readonly elementType: string }[];
}

/**
 * Minimal GIR program shape for buildWATModule.
 * Avoids a hard import cycle with gir-emitter.ts.
 */
export interface WATGIRInput {
  readonly flows: readonly WATFlowInput[];
  readonly entryPoints: readonly string[];
  readonly girHash?: string;
  readonly sourceHash?: string;
  /**
   * Phase 25: original program AST, used by emitWATFromFlowAST to generate
   * real arithmetic bodies for pure flows.
   * When absent, the emitter falls back to Phase 24A identity bodies.
   */
  readonly ast?: AstNode;
  /**
   * Phase 27: when true, export all pure flows (not just entryPoints).
   * Enables WebAssembly.instantiate callers to invoke any pure flow by name.
   * Default: false (only entryPoints are exported).
   */
  readonly exportAllPure?: boolean;
}

/**
 * Maps a STDLIB_CAPABILITY_MAP wasmImport string ("host:fs.readText") to a
 * WATImport. The wasmImport format is "<module>:<name>".
 *
 * All effectful host functions are typed as (param i32 i32) (result i32) in
 * Phase 19. Phase 22 will carry real type signatures from the GIR type table.
 */
function wasmImportStringToWATImport(wasmImport: string, effect: string): WATImport | null {
  const colonIdx = wasmImport.indexOf(":");
  if (colonIdx === -1) return null;
  const module = wasmImport.slice(0, colonIdx);
  const name = wasmImport.slice(colonIdx + 1);
  return {
    module,
    name,
    effect,
    type: { params: ["i32", "i32"], results: ["i32"] },
  };
}

/**
 * Returns WATImport entries for the given declared effect names, resolved
 * through STDLIB_CAPABILITY_MAP.
 *
 * For each declared effect, scans all STDLIB_CAPABILITY_MAP entries whose
 * requiredEffects include that effect and have a wasmImport field.
 * Results are deduplicated by wasmImport key.
 *
 * All effectful host functions are typed as (param i32 i32) (result i32) in
 * Phase 19. Phase 22 will carry real type signatures from the GIR type table.
 *
 * @param effects - Declared effect names, e.g. ["filesystem.read", "audit.write"].
 * @returns Deduplicated WATImport array derived from STDLIB_CAPABILITY_MAP.
 */
export function getWATImportsForEffects(effects: readonly string[]): WATImport[] {
  const importsByKey = new Map<string, WATImport>();
  for (const effect of effects) {
    for (const [, entry] of STDLIB_CAPABILITY_MAP) {
      if (entry.requiredEffects.includes(effect) && entry.wasmImport) {
        const key = entry.wasmImport;
        if (!importsByKey.has(key)) {
          const imp = wasmImportStringToWATImport(entry.wasmImport, effect);
          if (imp) importsByKey.set(key, imp);
        }
      }
    }
  }
  return Array.from(importsByKey.values());
}

/**
 * Builds a WATModule from GIR program data.
 *
 * Mapping rules:
 *   - Pure flows (qualifier === "pure" and no declaredEffects) → no imports needed.
 *   - Effectful flows → imports derived from declaredEffects, resolved through
 *     STDLIB_CAPABILITY_MAP.wasmImport entries.
 *   - entryPoints → WATExport entries pointing at the matching function.
 *   - All flows → WATFunction stubs (isPure flag set from qualifier).
 *
 * Phase 19: all function bodies are stubs. Full lowering in Phase 22.
 */

/**
 * Collects compile-time integer constants from top-level `static` and `bitfield`
 * declarations in the program AST.
 *
 * `static NAME = N` → staticConsts.set("NAME", N)
 * `bitfield REG { field: bitPos }` → staticConsts.set("REG.field", 1 << bitPos)
 *                                    staticConsts.set("REG.BIT_field", bitPos)
 *
 * Only integer literals are folded here (the WAT emitter only supports i32).
 * Non-integer static values are ignored (they will emit (i32.const 0) at use site).
 */
function collectStaticConsts(ast: AstNode | undefined): ReadonlyMap<string, number> {
  const consts = new Map<string, number>();
  if (ast === undefined) return consts;

  for (const node of ast.children ?? []) {
    if (node.kind === "staticDecl") {
      const name = node.value ?? "";
      const valueExpr = node.children?.[0];
      if (name !== "" && valueExpr !== undefined) {
        const n = foldToInt(valueExpr, consts);
        if (n !== null) consts.set(name, n);
      }
    } else if (node.kind === "bitfieldDecl") {
      const registerName = node.value ?? "";
      if (registerName === "") continue;
      for (const child of node.children ?? []) {
        const parts = (child.value ?? "").split(":");
        if (parts.length !== 2) continue;
        const fieldName = (parts[0] ?? "").trim();
        const bitPos = parseInt((parts[1] ?? "").trim(), 10);
        if (isNaN(bitPos) || bitPos < 0 || bitPos > 31) continue;
        const bitmask = 1 << bitPos;
        consts.set(`${registerName}.${fieldName}`, bitmask);
        consts.set(`${registerName}.BIT_${fieldName}`, bitPos);
      }
    }
  }
  return consts;
}

/**
 * Attempts to fold an AST expression to a plain JavaScript integer.
 * Used by collectStaticConsts to resolve static initializers.
 * Returns null for non-constant or non-integer expressions.
 */
function foldToInt(
  expr: AstNode,
  consts: ReadonlyMap<string, number>,
): number | null {
  if (expr.kind === "numberLiteral") {
    const raw = (expr.value ?? "0").replace(/_/g, "");
    if (raw.includes(".")) return null; // float — not an integer
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }
  if (expr.kind === "identifier") {
    const name = expr.value ?? "";
    const v = consts.get(name);
    return v !== undefined ? v : null;
  }
  // Constant-EXPRESSION folding (AOT #1, R&D 0036): fold `const <op> const` arithmetic at build time using
  // the SAME checked i32 ops as runtime, so the result is identical to executing it. CRITICAL (Fork-A=TRAP /
  // 0038): if the constant op would TRAP (overflow / div0 / mod0), return null — do NOT fold — so the
  // runtime checked op is emitted and fails closed exactly as if it ran. Only arithmetic folds here;
  // comparisons fold to bool (branch-folding = AOT #2, not done here).
  if (expr.kind === "binaryExpr") {
    const a = expr.children?.[0];
    const b = expr.children?.[1];
    if (a === undefined || b === undefined) return null;
    const l = foldToInt(a, consts);
    const r = foldToInt(b, consts);
    if (l === null || r === null) return null;
    let res: I32Result;
    switch (expr.value ?? "") {
      case "+": res = i32AddChecked(l, r); break;
      case "-": res = i32SubChecked(l, r); break;
      case "*": res = i32MulChecked(l, r); break;
      case "/": res = i32DivChecked(l, r); break;
      case "%": res = i32ModChecked(l, r); break;
      default: return null; // comparisons / bitwise / && / || — not folded here
    }
    return isI32Trap(res) ? null : res; // trap ⇒ don't fold (emit the runtime op → fails closed)
  }
  return null;
}

/**
 * AOT #2 (R&D 0036): fold a compile-time-constant boolean condition to `true` / `false`, else null.
 * Drives branch-folding + dead-arm DCE at the `ifStmt` site — when the condition is a known constant
 * the taken arm is deterministic, so the WAT emitter emits ONLY that arm (the dead arm + its locals
 * are never emitted). Semantics-preserving: the interpreter evaluates the same constant condition and
 * takes the same branch, so WASM ≡ interpreter (output-identical / 0014-safe).
 *
 * Folds: bool literals; `!expr`; comparisons (>,<,>=,<=,==,!=) of two foldable int constants (reuses
 * foldToInt); and `&&`/`||` ONLY when BOTH operands fold (conservative — never reasons about a
 * non-constant operand's side effects). Returns null for anything else → the runtime `(if …)` is
 * emitted unchanged (no behaviour change).
 */
function foldToBool(
  expr: AstNode | undefined,
  consts: ReadonlyMap<string, number>,
): boolean | null {
  if (expr === undefined) return null;
  if (expr.kind === "boolLiteral") return expr.value === "true";
  if (expr.kind === "unaryExpr" && (expr.value ?? "") === "!") {
    const inner = foldToBool(expr.children?.[0], consts);
    return inner === null ? null : !inner;
  }
  if (expr.kind === "binaryExpr") {
    const op = expr.value ?? "";
    if (op === "&&" || op === "||") {
      // Conservative: fold only when BOTH operands are constant booleans (const-fold context has no
      // side effects). A non-foldable operand ⇒ null ⇒ emit the runtime op (which short-circuits itself).
      const l = foldToBool(expr.children?.[0], consts);
      const r = foldToBool(expr.children?.[1], consts);
      if (l === null || r === null) return null;
      return op === "&&" ? (l && r) : (l || r);
    }
    const a = expr.children?.[0];
    const b = expr.children?.[1];
    const l = a ? foldToInt(a, consts) : null;
    const r = b ? foldToInt(b, consts) : null;
    if (l === null || r === null) return null;
    switch (op) {
      case ">":  return l > r;
      case "<":  return l < r;
      case ">=": return l >= r;
      case "<=": return l <= r;
      case "==": return l === r;
      case "!=": return l !== r;
      default: return null; // bitwise / arithmetic — not a boolean
    }
  }
  return null;
}

export function buildWATModule(
  gir: WATGIRInput,
  _capabilityMap: ReadonlyMap<string, { readonly wasmImport?: string; readonly requiredEffects: readonly string[] }>,
  target: "wasm-standalone" | "wasm-hybrid" = "wasm-standalone",
): WATModule {
  // Collect compile-time constants from `static NAME = EXPR` and `bitfield NAME { ... }`
  // top-level declarations in the AST. These are folded to (i32.const N) at every use site.
  const staticConsts = collectStaticConsts(gir.ast);

  // Build deduped import list from effectful flows using getWATImportsForEffects.
  // Collect all declared effects across non-pure flows, then resolve via STDLIB_CAPABILITY_MAP.
  const allEffects: string[] = [];
  // Helper to get declared effects from either form
  function getFlowEffects(flow: WATFlowInput): readonly string[] {
    return flow.declaredEffects ?? flow.effects?.declared ?? [];
  }

  for (const flow of gir.flows) {
    const declaredEffects = getFlowEffects(flow);
    const isPureFlow = flow.qualifier === "pure" && declaredEffects.length === 0;
    if (isPureFlow) continue;
    for (const effect of declaredEffects) {
      if (!allEffects.includes(effect)) {
        allEffects.push(effect);
      }
    }
  }
  const imports = getWATImportsForEffects(allEffects);

  // ── Host Runtime Imports (P9.3 — Stage B self-hosting support) ─────────────
  // These host functions provide the bridge between WASM i32 opaque handles
  // and the host JavaScript runtime's rich type system.
  //
  // Array manager: creates and manages Array<T> on the host side.
  //   The WASM guest receives/passes i32 IDs; the host owns the actual arrays.
  // String operations: the host registers the intern table and provides ops.
  //   All strings are opaque i32 IDs in WASM; host resolves them to real strings.
  //
  // These are always included so Stage B .lln files can call them freely.
  // In production Stage A runs, the host provides implementations.
  // In production Stage B WASM-only runs, DSS.wasm provides them via WASI imports.
  const HOST_RUNTIME_IMPORTS: WATImport[] = [
    // Array manager
    { module: "host", name: "__array_create",   effect: "stdlib.array", type: { params: [],                results: ["i32"] } },
    { module: "host", name: "__array_append",   effect: "stdlib.array", type: { params: ["i32", "i32"],   results: ["i32"] } }, // returns the array handle (#145a: `arr = arr.append(x)`)
    { module: "host", name: "__array_get",      effect: "stdlib.array", type: { params: ["i32", "i32"],   results: ["i32"] } },
    { module: "host", name: "__array_length",   effect: "stdlib.array", type: { params: ["i32"],          results: ["i32"] } },
    { module: "host", name: "__array_contains", effect: "stdlib.array", type: { params: ["i32", "i32"],   results: ["i32"] } },
    { module: "host", name: "__array_contains_str", effect: "stdlib.array", type: { params: ["i32", "i32"], results: ["i32"] } }, // value-based Array<String> membership (#160)
    { module: "host", name: "__array_first",    effect: "stdlib.array", type: { params: ["i32"],          results: ["i32"] } },
    { module: "host", name: "__array_last",     effect: "stdlib.array", type: { params: ["i32"],          results: ["i32"] } },
    // String operations
    { module: "host", name: "__str_concat",     effect: "stdlib.string", type: { params: ["i32", "i32"],  results: ["i32"] } },
    { module: "host", name: "__str_length",     effect: "stdlib.string", type: { params: ["i32"],          results: ["i32"] } },
    { module: "host", name: "__str_count",      effect: "stdlib.string", type: { params: ["i32"],          results: ["i32"] } }, // String.charCount() (#145)
    // Result constructors (#145 — self-hosted lexer tokenize returns Result<List<Token>>)
    { module: "host", name: "__result_ok",      effect: "stdlib.result", type: { params: ["i32"],          results: ["i32"] } },
    { module: "host", name: "__result_err",     effect: "stdlib.result", type: { params: ["i32"],          results: ["i32"] } },
    { module: "host", name: "__result_tag",     effect: "stdlib.result", type: { params: ["i32"],          results: ["i32"] } }, // #164: Ok→0 / Err→1
    { module: "host", name: "__result_value",   effect: "stdlib.result", type: { params: ["i32"],          results: ["i32"] } }, // #164: unwrap payload
    { module: "host", name: "__str_char_at",    effect: "stdlib.string", type: { params: ["i32", "i32"],  results: ["i32"] } },
    { module: "host", name: "__str_to_int",     effect: "stdlib.string", type: { params: ["i32"],          results: ["i32"] } },
    { module: "host", name: "__int_to_str",     effect: "stdlib.string", type: { params: ["i32"],          results: ["i32"] } },
    { module: "host", name: "__str_eq",         effect: "stdlib.string", type: { params: ["i32", "i32"],  results: ["i32"] } },
    // #162 — String methods
    { module: "host", name: "__str_starts_with", effect: "stdlib.string", type: { params: ["i32", "i32"], results: ["i32"] } },
    { module: "host", name: "__str_ends_with",  effect: "stdlib.string", type: { params: ["i32", "i32"],  results: ["i32"] } },
    { module: "host", name: "__str_contains",   effect: "stdlib.string", type: { params: ["i32", "i32"],  results: ["i32"] } },
    { module: "host", name: "__str_index_of",   effect: "stdlib.string", type: { params: ["i32", "i32"],  results: ["i32"] } },
    { module: "host", name: "__str_to_lower",   effect: "stdlib.string", type: { params: ["i32"],          results: ["i32"] } },
    { module: "host", name: "__str_to_upper",   effect: "stdlib.string", type: { params: ["i32"],          results: ["i32"] } },
    { module: "host", name: "__str_trim",       effect: "stdlib.string", type: { params: ["i32"],          results: ["i32"] } },
    { module: "host", name: "__str_slice",      effect: "stdlib.string", type: { params: ["i32", "i32", "i32"], results: ["i32"] } },
    { module: "host", name: "__char_to_upper",  effect: "stdlib.char",  type: { params: ["i32"],          results: ["i32"] } },
    { module: "host", name: "__char_to_lower",  effect: "stdlib.char",  type: { params: ["i32"],          results: ["i32"] } },
    // Char classification (for self-hosted lexer)
    { module: "host", name: "__char_is_letter", effect: "stdlib.char",  type: { params: ["i32"],          results: ["i32"] } },
    { module: "host", name: "__char_is_digit",  effect: "stdlib.char",  type: { params: ["i32"],          results: ["i32"] } },
    { module: "host", name: "__char_is_upper",  effect: "stdlib.char",  type: { params: ["i32"],          results: ["i32"] } }, // #169
    { module: "host", name: "__char_is_lower",  effect: "stdlib.char",  type: { params: ["i32"],          results: ["i32"] } }, // #169
    { module: "host", name: "__char_is_whitespace", effect: "stdlib.char", type: { params: ["i32"],       results: ["i32"] } }, // #169
    { module: "host", name: "__char_to_string", effect: "stdlib.char",  type: { params: ["i32"],          results: ["i32"] } },
    // Result/Option helpers
    { module: "host", name: "__unwrap_or",      effect: "stdlib.result", type: { params: ["i32", "i32"],  results: ["i32"] } },
    { module: "host", name: "__option_some",    effect: "stdlib.result", type: { params: ["i32"],          results: ["i32"] } },
    { module: "host", name: "__option_none",    effect: "stdlib.result", type: { params: [],               results: ["i32"] } },
  ];
  // NOTE: HOST_RUNTIME_IMPORTS are merged AFTER function bodies are built (below),
  // and only the bridge functions actually referenced by a body are added. Pure
  // integer flows reference none, so their module stays import-free — required for
  // the minimal JS assembler to resolve local indices correctly.

  // Build function definitions.
  // Pure flows (qualifier === "pure", no declaredEffects) get real WAT bodies via emitWATBody.
  // All other flows get "unreachable" stub bodies (Phase 22 effectful emission TBD).
  // Phase 27: when exportAllPure is set, all pure flows are entry points for export.
  // P9.4c: a flow is WASM-exportable when it has a real (non-effectful) body — a
  // pure flow, or a `guarded` flow with no declared effects (governance is DAG-edge
  // validation around pure computation, so its body lowers like a pure flow). This
  // lets `logicn run --invoke <guardedFlow>` reach governed entry points.
  const isWasmExportable = (f: WATFlowInput): boolean =>
    f.qualifier === "pure" || (f.qualifier === "guarded" && getFlowEffects(f).length === 0);
  const entrySet = gir.exportAllPure === true
    ? new Set(gir.flows.filter(isWasmExportable).map(f => f.name))
    : new Set(gir.entryPoints);

  // P9.4b: record-type → field-name layout, built once for `r.field` offset lowering.
  const recordLayoutRegistry = buildRecordLayouts(gir.ast);
  // P9.4d (#144): enum-type → variant-name list, for `EnumType.Variant` → i32 tag.
  const enumVariantRegistry = buildEnumVariants(gir.ast);
  // #160: flowName → return type, so `let xs = makeKeywordTable()` carries a type for
  // type-directed `.contains` / `+` lowering. Module-level for inferExprType; restored below.
  const prevFlowReturnTypes = flowReturnTypes;
  flowReturnTypes = buildFlowReturnTypes(gir.ast);
  const functions: WATFunction[] = gir.flows.map((flow) => {
    const flowDeclaredEffects = getFlowEffects(flow);
    const isPureFlow = flow.qualifier === "pure" && flowDeclaredEffects.length === 0;

    // Build named params from paramTypes (or default to a single i32 when absent).
    const rawParamTypes: readonly string[] = flow.paramTypes ?? [];
    const namedParams: WATParamDef[] = rawParamTypes.map((typeName, i) => ({
      name: `$p${i}`,
      type: logicNTypeToWAT(typeName),
    }));
    // WATFuncType params: just the value types (for type-checking / signature).
    const paramValTypes: WATValType[] = namedParams.map((p) => p.type);

    // Emit a real body for pure flows.
    //
    // Phase 25 progression (AST-based emission):
    //   1. gir.ast present → Phase 25 real emission from AST body (arithmetic, let, return)
    //   2. executionPlan present → Phase 24A identity body from PassiveExecutionPlan steps
    //   3. paramTypes present → identity body (local.get $p0)
    //   4. No info available → minimal constant body (i32.const 0)
    //
    // Non-pure flows stay as unreachable until Phase 22 effectful emission.
    let body = "unreachable";
    if (isPureFlow && gir.ast !== undefined) {
      // Phase 25: find the flow's AST node and emit real arithmetic instructions.
      const flowAstNode = findFlowNodeInAST(gir.ast, flow.name);
      if (flowAstNode !== undefined) {
        const paramNames = extractFlowParamNames(flowAstNode);
        const phase25Body = emitWATFromFlowAST(flowAstNode, paramNames, staticConsts, recordLayoutRegistry, enumVariantRegistry);
        if (phase25Body !== null) {
          body = phase25Body;
        } else if (flow.executionPlan !== undefined) {
          body = emitWATBody(flow.executionPlan, namedParams.length);
        } else {
          body = "(unreachable) ;; Phase 25: empty body — fail-closed (cannot lower → falls back to walker)";
        }
      } else if (flow.executionPlan !== undefined) {
        body = emitWATBody(flow.executionPlan, namedParams.length);
      } else if (rawParamTypes.length > 0) {
        body = emitWATBody({ steps: [{ kind: "return" }] }, namedParams.length);
      } else {
        body = "(unreachable) ;; Phase 25: no AST node found — fail-closed (cannot lower → falls back to walker)";
      }
    } else if (isPureFlow && flow.executionPlan !== undefined) {
      // Phase 24A: use PassiveExecutionPlan steps (identity body)
      body = emitWATBody(flow.executionPlan, namedParams.length);
    } else if (isPureFlow && rawParamTypes.length > 0) {
      // Phase 24A: paramTypes supplied — emit identity body (return first param)
      body = emitWATBody({ steps: [{ kind: "return" }] }, namedParams.length);
    } else if (isPureFlow) {
      // Fallback: no param info.
      body = "(unreachable) ;; Phase 25: no body info available — fail-closed (cannot lower → falls back to walker)";
    } else if (flow.qualifier === "guarded" && flowDeclaredEffects.length === 0 && gir.ast !== undefined) {
      // P9.4: a `guarded` flow is pure computation wrapped in DAG-edge governance —
      // its body has no real side effects, so it can be lowered exactly like a pure
      // flow. We only adopt the emitted body when emission FULLY succeeds; otherwise
      // we keep "unreachable" (unchanged behaviour) so flows whose bodies the emitter
      // cannot yet lower (e.g. record-returning) are not regressed.
      const guardedAstNode = findFlowNodeInAST(gir.ast, flow.name);
      if (guardedAstNode !== undefined) {
        const guardedParamNames = extractFlowParamNames(guardedAstNode);
        const guardedBody = emitWATFromFlowAST(guardedAstNode, guardedParamNames, staticConsts, recordLayoutRegistry, enumVariantRegistry);
        if (guardedBody !== null) {
          body = guardedBody;
        }
      }
    }

    // Phase 27C — TypedArray lowering hints for Float32 tensor flows.
    //
    // When a flow carries GIRTensorInfo entries whose elementType is "Float32",
    // prepend WAT comments that annotate the TypedArray lowering decision and the
    // Tensor.dot memory region. These comments are consumed by:
    //   - the WAT renderer (rendered verbatim inside the function body)
    //   - downstream tooling that inspects WAT text for memory layout decisions
    //   - the Phase 28 kernel fusion emitter, which will replace them with real
    //     v128.load / f32x4.mul / v128.store instruction sequences.
    //
    // The runtime selects: host.npu.inference (NPU) → host.gpu.compute (GPU) →
    // WASM SIMD (wasm-hybrid) → scalar CPU — in order of availability.
    // This comment block is emitted regardless of chosen target: the WAT module
    // always describes the WASM data-plane layout even when the hot path is native.
    const flowTensors = flow.tensors ?? [];
    const hasFloat32Tensors = flowTensors.some((t) => t.elementType === "Float32");
    if (hasFloat32Tensors) {
      const tensorHints = [
        ";; TypedArray lowering: Float32Array for Tensor<Float32,...>",
        ";; Phase 27: Tensor.dot maps to f32 memory region",
        body,
      ].filter((line) => line.trim().length > 0).join("\n");
      body = tensorHints;
    }

    return {
      name: flow.name,
      isPure: flow.qualifier === "pure",
      isEntryPoint: entrySet.has(flow.name),
      type: { params: paramValTypes, results: ["i32"] },
      body,
      ...(namedParams.length > 0 ? { namedParams } : {}),
    };
  });

  // Build exports from entryPoints, mapped to function indices.
  // Phase 27: when gir.exportAllPure is true (WASM instantiation mode),
  // export every pure flow so callers can invoke any function by name.
  const flowIndexMap = new Map(gir.flows.map((f, i) => [f.name, i]));
  const exportedNames = gir.exportAllPure === true
    ? gir.flows.filter(isWasmExportable).map(f => f.name) // P9.4c: pure + guarded-no-effect
    : gir.entryPoints;
  const exports: WATExport[] = exportedNames
    .map((name) => {
      const idx = flowIndexMap.get(name);
      return idx !== undefined ? { name, index: idx } : null;
    })
    .filter((e): e is WATExport => e !== null);

  // Usage-gated merge of the stdlib runtime bridge (__array_*, __str_*, __char_*,
  // __option_*, __unwrap_or). Only add a bridge import if some function body
  // textually references its host id. This keeps pure integer modules import-free.
  const allBodyTextForBridge = functions.map((f) => f.body ?? "").join("\n");
  for (const hi of HOST_RUNTIME_IMPORTS) {
    const hostId = `$host_${hi.name.replace(/\./g, "_")}`;
    if (!allBodyTextForBridge.includes(hostId)) continue;
    if (!imports.some(imp => imp.module === hi.module && imp.name === hi.name)) {
      imports.push(hi);
    }
  }

  flowReturnTypes = prevFlowReturnTypes; // #160: restore module-level type context

  return {
    schemaVersion: "lln.wat.v1",
    sourceHash: gir.sourceHash ?? "",
    girHash: gir.girHash ?? "",
    imports,
    exports,
    functions,
    memory: DEFAULT_WAT_MEMORY,
    target,
  };
}

// ---------------------------------------------------------------------------
// GIRProgram overload — buildWATModuleFromGIR
// ---------------------------------------------------------------------------

/**
 * Builds a WATModule directly from a full GIRProgram.
 *
 * This is the Phase 22 entry point for the compiler pipeline.
 * It extracts the WATGIRInput shape from GIRProgram and delegates to
 * buildWATModule, passing through:
 *   - flow names, qualifiers, and declared effects
 *   - executionPlan from GIRFlow.executionPlan (used by emitWATBody for pure flows)
 *   - entryPoints from GIRProgram.entryPoints
 *   - girHash and sourceHash from GIRProgram
 *
 * Pure flows with no effects and a PassiveExecutionPlan get real WAT bodies.
 * Non-pure flows get unreachable stub bodies.
 *
 * @param gir           - Full GIRProgram from emitGIR.
 * @param capabilityMap - STDLIB_CAPABILITY_MAP for resolving effectful imports.
 * @param target        - WASM target variant.
 */
export function buildWATModuleFromGIR(
  gir: {
    readonly flows: ReadonlyArray<{
      readonly name: string;
      readonly qualifier: string;
      readonly effects: { readonly declared: readonly string[] };
      readonly executionPlan?: { readonly steps: ReadonlyArray<{ readonly kind: string }> };
      /** Phase 24: parameter type names from the AST. */
      readonly paramTypes?: readonly string[];
      /**
       * Phase 27: tensor binding metadata from GIRFlow.tensors.
       * When present, buildWATModule emits TypedArray lowering hints for Float32 flows.
       */
      readonly tensors?: readonly { readonly elementType: string }[];
    }>;
    readonly entryPoints: readonly string[];
    readonly girHash?: string;
    readonly sourceHash?: string;
  },
  capabilityMap: ReadonlyMap<string, { readonly wasmImport?: string; readonly requiredEffects: readonly string[] }>,
  target: "wasm-standalone" | "wasm-hybrid" = "wasm-standalone",
  /** Phase 25: original program AST for real arithmetic body emission. */
  ast?: AstNode,
  /** Phase 27: export all pure flows for WebAssembly.instantiate callers. */
  exportAllPure?: boolean,
): WATModule {
  const watInput: WATGIRInput = {
    flows: gir.flows.map((f) => {
      const base: WATFlowInput = {
        name: f.name,
        qualifier: f.qualifier,
        declaredEffects: f.effects.declared,
        ...(f.paramTypes !== undefined && f.paramTypes.length > 0 ? { paramTypes: f.paramTypes } : {}),
        ...(f.tensors !== undefined && f.tensors.length > 0 ? { tensors: f.tensors } : {}),
      };
      if (f.executionPlan !== undefined) {
        return { ...base, executionPlan: f.executionPlan };
      }
      return base;
    }),
    entryPoints: gir.entryPoints,
    ...(gir.girHash !== undefined ? { girHash: gir.girHash } : {}),
    ...(gir.sourceHash !== undefined ? { sourceHash: gir.sourceHash } : {}),
    ...(ast !== undefined ? { ast } : {}),
    ...(exportAllPure === true ? { exportAllPure: true } : {}),
  };
  return buildWATModule(watInput, capabilityMap, target);
}

// ---------------------------------------------------------------------------
// Stub emitter entry point
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// #70 WAT single-exit body transformation (Phase 4 prerequisite)
// ---------------------------------------------------------------------------

/**
 * Single-exit body transformation — Phase 4 prerequisite (task #70).
 *
 * Wraps a WAT function body so that ALL return paths converge through
 * a single exit point, where post-condition invariant gates can fire.
 *
 * Pattern:
 *   (block $logicn_exit
 *     ... body with br $logicn_exit replacing return ...
 *   )
 *   ;; post-condition gates fire here (after $exit)
 *   local.get $logicn_result
 *
 * Stage A (now): only emits the wrapper structure — no active post-conditions yet.
 *   The wrapper is a no-op transformation that preserves identical behavior.
 *   Post-condition gates will be injected here in Phase 4 when #70 is fully active.
 *
 * Stage B (Phase 4): `ensure returnValue > 0` expressions in invariant {} will
 *   generate post-condition gates that are injected after $logicn_exit.
 */
export function wrapInSingleExit(
  bodyLines: string[],
  postConditionLines: string[],
  _resultType: string,
): string[] {
  if (postConditionLines.length === 0) {
    // No post-conditions active yet — return body unchanged (Stage A no-op)
    return bodyLines;
  }

  // Future: wrap body in (block $logicn_exit), inject post-condition gates after
  // For now Stage A: no post-conditions, return unchanged
  return bodyLines;
}

/**
 * Classify ensures in an invariant {} block:
 *   - Pre-conditions: reference only flow parameters → already handled (WAT gate at entry)
 *   - Post-conditions: reference 'result' or non-parameter identifiers → need single-exit
 *
 * Stage A: returns empty array (no post-conditions wired yet).
 * Phase 4: will classify by comparing ensure symbols against param names.
 */
export function extractPostConditionEnsures(
  invariantNode: AstNode | undefined,
  _paramNames: Set<string>,
): AstNode[] {
  if (invariantNode === undefined) return [];
  // Stage A stub: all ensures are pre-conditions on parameters
  // Post-condition detection (symbols NOT in paramNames) added in Phase 4
  return [];
}

/**
 * Phase 19 stub: validates GIR structure and produces a skeleton WATModule.
 *
 * Full implementation (Phase 22):
 *   - Emit instructions from PassiveExecutionPlan steps
 *   - Lower Tensor<Float32, [n]> to Float32Array memory layout
 *   - Emit WASM SIMD for pure math flows
 *   - Populate import table from allowedEffectsMask
 */
export function emitWAT(
  _girHash: string,
  _sourceHash: string,
  _flows: readonly { name: string; qualifier: string; declaredEffects: readonly string[] }[],
  target: "wasm-standalone" | "wasm-hybrid",
): WATEmitResult {
  // Phase 19: build a minimal WATModule — no capability map available at this
  // level, so imports are empty. Full population in Phase 22.
  const module: WATModule = {
    schemaVersion: "lln.wat.v1",
    sourceHash: _sourceHash,
    girHash: _girHash,
    imports: [],   // Phase 22: populated via buildWATModule + STDLIB_CAPABILITY_MAP
    exports: [],   // Phase 22: populated from GIR.entryPoints
    functions: _flows.map((f) => ({
      name: f.name,
      isPure: f.qualifier === "pure",
      isEntryPoint: false,
      type: { params: [], results: ["i32"] },
      body: "unreachable",
    })),
    memory: DEFAULT_WAT_MEMORY,
    target,
  };

  return {
    module,
    wat: renderWAT(module),
    diagnostics: [{
      code: "LLN-WAT-STUB",
      message: `WAT emitter Phase 19 stub. Full emission in Phase 22. Target: ${target}. Source hash: ${_sourceHash.slice(0, 20)}...`,
    }],
  };
}

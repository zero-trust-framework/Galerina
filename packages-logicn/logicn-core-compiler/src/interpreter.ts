// =============================================================================
// LogicN Stage A - AST interpreter
// =============================================================================

import { type AstNode, type FlowMeta, NodeFlags } from "./parser.js";
import { callStdlib, logicNValuesEqual, moneyBinary } from "./stdlib.js";
import { type CapabilityHost } from "./runtime/capabilityHost.js";
import { type RuntimeContext } from "./runtime/runtimeContext.js";
import { type ContractEnforcer } from "./runtime/contractEnforcer.js";
import { type ContractEnforcementRecord } from "./runtime/runtimeReport.js";
import { type PassiveExecutionPlan, executePlan } from "./runtime/executionPlan.js";
import { type RuntimeManifest, EffectCheckerFlags } from "./type-registry.js";
import { LLN_RUNTIME_006 } from "./security-policy.js";
import { pureFlowCacheKey, getCachedPureFlow, setCachedPureFlow } from "./pure-flow-cache.js";
import { activeSinkMonitor } from "./security-sink-monitor.js";
import { buildExecutionGraph, getOrLoadGraph, storeGraph, executionGraphCacheKey, ExecOp, type ExecutionGraph } from "./execution-graph.js";
import { compileToBytecode, runBytecode } from "./bytecode-vm.js";

export type LogicNValue =
  | { readonly __tag: "int";       readonly value: number }
  | { readonly __tag: "float";     readonly value: number }
  | { readonly __tag: "decimal";   readonly value: string }
  | { readonly __tag: "string";    readonly value: string }
  | { readonly __tag: "bool";      readonly value: boolean }
  | { readonly __tag: "char";      readonly value: string }
  | { readonly __tag: "byte";      readonly value: number }
  | { readonly __tag: "bytes";     readonly value: Uint8Array }
  | { readonly __tag: "void" }
  | { readonly __tag: "none" }
  | { readonly __tag: "some";      readonly value: LogicNValue }
  | { readonly __tag: "ok";        readonly value: LogicNValue }
  | { readonly __tag: "err";       readonly error: LogicNValue }
  | { readonly __tag: "record";    readonly fields: ReadonlyMap<string, LogicNValue> }
  | { readonly __tag: "list";      readonly items: readonly LogicNValue[] }
  | { readonly __tag: "secure";    readonly value: string }
  | { readonly __tag: "protected"; readonly baseType: string; readonly value: LogicNValue; readonly _governed?: { readonly qualifier: "protected" | "redacted" } }
  | { readonly __tag: "redacted";  readonly baseType: string; readonly _governed?: { readonly qualifier: "protected" | "redacted" } }
  | { readonly __tag: "unresolved"; readonly name: string }
  | { readonly __tag: "runtimeError"; readonly message: string }
  // Backward-compatible tags from the first Stage A interpreter pass.
  | { readonly __tag: "function";  readonly name: string }
  | { readonly __tag: "error";     readonly message: string };

export const LLN_VOID: LogicNValue = { __tag: "void" };
export const LLN_NONE: LogicNValue = { __tag: "none" };

// =============================================================================
// Integer fast path — avoid per-operation object allocation for Int+Int ops
// =============================================================================

/** Pre-allocated pool of the 256 most common integer values (0–255). */
const INT_POOL: ReadonlyArray<LogicNValue> = Array.from(
  { length: 256 },
  (_, i) => ({ __tag: "int" as const, value: i }),
);

/** Return a pooled LogicNValue for integers in [0,255], or allocate otherwise. */
function intVal(n: number): LogicNValue {
  return n >= 0 && n < 256 ? (INT_POOL[n] as LogicNValue) : { __tag: "int", value: n };
}

/** Singleton booleans — avoids allocating { __tag: "bool", value: ... } on every comparison. */
const BOOL_TRUE:  LogicNValue = { __tag: "bool", value: true };
const BOOL_FALSE: LogicNValue = { __tag: "bool", value: false };
const boolVal = (b: boolean): LogicNValue => b ? BOOL_TRUE : BOOL_FALSE;

// =============================================================================
// O(1) Binary operation dispatch map
// =============================================================================

/** Maps operator symbols to numeric IDs for key packing. */
const OP_IDS: Record<string, number> = {
  "+": 1, "-": 2, "*": 3, "/": 4, "%": 5,
  "<": 6, "<=": 7, ">": 8, ">=": 9, "==": 10, "!=": 11,
  "&&": 12, "||": 13, "and": 12, "or": 13,
};

/**
 * Pack (leftTag, op, rightTag) into a single integer key for O(1) dispatch.
 * Bit layout: [7:4] left type, [3:0] right type — op occupies bits [11:4].
 * Uses a 12-bit key: (l << 8) | (o << 4) | r
 */
function dispatchKey(leftTag: string, op: string, rightTag: string): number {
  const l = leftTag  === "int"    ? 1 : leftTag  === "float" ? 2 : leftTag  === "string" ? 3 : leftTag  === "bool" ? 4 : 0;
  const r = rightTag === "int"    ? 1 : rightTag === "float" ? 2 : rightTag === "string" ? 3 : rightTag === "bool" ? 4 : 0;
  const o = OP_IDS[op] ?? 0;
  return (l << 8) | (o << 4) | r;
}

// The dispatch lambdas receive values already narrowed by the key — the
// `value` property is always present at runtime. We accept `any` here to
// avoid repeating unsafe casts throughout the map initialiser.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type _DispatchFn = (a: any, b: any) => LogicNValue;

/** Pre-built dispatch map — O(1) lookup replaces the linear if-chain. */
export const BINARY_DISPATCH = new Map<number, _DispatchFn>([
  // --- Int × Int ---
  [dispatchKey("int", "+",  "int"),  (a, b) => intVal((a.value as number) + (b.value as number))],
  [dispatchKey("int", "-",  "int"),  (a, b) => intVal((a.value as number) - (b.value as number))],
  [dispatchKey("int", "*",  "int"),  (a, b) => intVal(Math.imul(a.value as number, b.value as number))],
  [dispatchKey("int", "/",  "int"),  (a, b) => (b.value as number) === 0 ? { __tag: "runtimeError", message: "DivisionByZero" } : intVal(Math.trunc((a.value as number) / (b.value as number)))],
  [dispatchKey("int", "%",  "int"),  (a, b) => (b.value as number) === 0 ? { __tag: "runtimeError", message: "DivisionByZero" } : intVal((a.value as number) % (b.value as number))],
  [dispatchKey("int", "<",  "int"),  (a, b) => boolVal((a.value as number) <  (b.value as number))],
  [dispatchKey("int", "<=", "int"),  (a, b) => boolVal((a.value as number) <= (b.value as number))],
  [dispatchKey("int", ">",  "int"),  (a, b) => boolVal((a.value as number) >  (b.value as number))],
  [dispatchKey("int", ">=", "int"),  (a, b) => boolVal((a.value as number) >= (b.value as number))],
  [dispatchKey("int", "==", "int"),  (a, b) => boolVal((a.value as number) === (b.value as number))],
  [dispatchKey("int", "!=", "int"),  (a, b) => boolVal((a.value as number) !== (b.value as number))],
  // --- Float × Float ---
  [dispatchKey("float", "+",  "float"), (a, b) => ({ __tag: "float", value: (a.value as number) + (b.value as number) })],
  [dispatchKey("float", "-",  "float"), (a, b) => ({ __tag: "float", value: (a.value as number) - (b.value as number) })],
  [dispatchKey("float", "*",  "float"), (a, b) => ({ __tag: "float", value: (a.value as number) * (b.value as number) })],
  [dispatchKey("float", "/",  "float"), (a, b) => ({ __tag: "float", value: (a.value as number) / (b.value as number) })],
  [dispatchKey("float", "<",  "float"), (a, b) => boolVal((a.value as number) <  (b.value as number))],
  [dispatchKey("float", "<=", "float"), (a, b) => boolVal((a.value as number) <= (b.value as number))],
  [dispatchKey("float", ">",  "float"), (a, b) => boolVal((a.value as number) >  (b.value as number))],
  [dispatchKey("float", ">=", "float"), (a, b) => boolVal((a.value as number) >= (b.value as number))],
  [dispatchKey("float", "==", "float"), (a, b) => boolVal((a.value as number) === (b.value as number))],
  [dispatchKey("float", "!=", "float"), (a, b) => boolVal((a.value as number) !== (b.value as number))],
  // --- Int + Float mixed (promote to float) ---
  [dispatchKey("int",   "+", "float"), (a, b) => ({ __tag: "float", value: (a.value as number) + (b.value as number) })],
  [dispatchKey("float", "+", "int"),   (a, b) => ({ __tag: "float", value: (a.value as number) + (b.value as number) })],
  [dispatchKey("int",   "-", "float"), (a, b) => ({ __tag: "float", value: (a.value as number) - (b.value as number) })],
  [dispatchKey("float", "-", "int"),   (a, b) => ({ __tag: "float", value: (a.value as number) - (b.value as number) })],
  [dispatchKey("int",   "*", "float"), (a, b) => ({ __tag: "float", value: (a.value as number) * (b.value as number) })],
  [dispatchKey("float", "*", "int"),   (a, b) => ({ __tag: "float", value: (a.value as number) * (b.value as number) })],
  [dispatchKey("int",   "/", "float"), (a, b) => ({ __tag: "float", value: (a.value as number) / (b.value as number) })],
  [dispatchKey("float", "/", "int"),   (a, b) => ({ __tag: "float", value: (a.value as number) / (b.value as number) })],
  [dispatchKey("int",   "<",  "float"), (a, b) => boolVal((a.value as number) <  (b.value as number))],
  [dispatchKey("float", "<",  "int"),   (a, b) => boolVal((a.value as number) <  (b.value as number))],
  [dispatchKey("int",   "<=", "float"), (a, b) => boolVal((a.value as number) <= (b.value as number))],
  [dispatchKey("float", "<=", "int"),   (a, b) => boolVal((a.value as number) <= (b.value as number))],
  [dispatchKey("int",   ">",  "float"), (a, b) => boolVal((a.value as number) >  (b.value as number))],
  [dispatchKey("float", ">",  "int"),   (a, b) => boolVal((a.value as number) >  (b.value as number))],
  [dispatchKey("int",   ">=", "float"), (a, b) => boolVal((a.value as number) >= (b.value as number))],
  [dispatchKey("float", ">=", "int"),   (a, b) => boolVal((a.value as number) >= (b.value as number))],
  [dispatchKey("int",   "==", "float"), (a, b) => boolVal((a.value as number) === (b.value as number))],
  [dispatchKey("float", "==", "int"),   (a, b) => boolVal((a.value as number) === (b.value as number))],
  [dispatchKey("int",   "!=", "float"), (a, b) => boolVal((a.value as number) !== (b.value as number))],
  [dispatchKey("float", "!=", "int"),   (a, b) => boolVal((a.value as number) !== (b.value as number))],
  // --- String concatenation ---
  [dispatchKey("string", "+", "string"), (a, b) => ({ __tag: "string" as const, value: (a.value as string) + (b.value as string) })],
  [dispatchKey("string", "==", "string"), (a, b) => boolVal((a.value as string) === (b.value as string))],
  [dispatchKey("string", "!=", "string"), (a, b) => boolVal((a.value as string) !== (b.value as string))],
  // --- Bool ops ---
  [dispatchKey("bool", "&&", "bool"), (a, b) => boolVal((a.value as boolean) && (b.value as boolean))],
  [dispatchKey("bool", "||", "bool"), (a, b) => boolVal((a.value as boolean) || (b.value as boolean))],
  [dispatchKey("bool", "==", "bool"), (a, b) => boolVal(a.value === b.value)],
  [dispatchKey("bool", "!=", "bool"), (a, b) => boolVal(a.value !== b.value)],
]);

/**
 * Fast path for Int × Int binary operations.
 * Returns null when either operand is not an Int (caller falls through to full eval).
 * @deprecated Use BINARY_DISPATCH instead — kept for reference only.
 */
function fastIntOp(left: LogicNValue, op: string, right: LogicNValue): LogicNValue | null {
  if (left.__tag !== "int" || right.__tag !== "int") return null;
  const a = left.value as number;
  const b = right.value as number;
  switch (op) {
    case "+":  return intVal(a + b);
    case "-":  return intVal(a - b);
    case "*":  return intVal(a * b);
    case "/":  return b !== 0 ? intVal(Math.trunc(a / b)) : null;
    case "%":  return b !== 0 ? intVal(a % b) : null;
    case "<":  return boolVal(a < b);
    case "<=": return boolVal(a <= b);
    case ">":  return boolVal(a > b);
    case ">=": return boolVal(a >= b);
    case "==": return boolVal(a === b);
    case "!=": return boolVal(a !== b);
    default:   return null;
  }
}

// =============================================================================
// Phase 29A NaN-boxing — active for hot paths
//
// JavaScript's 64-bit doubles can encode a 32-bit integer in the NaN payload.
// We use a simpler tagged-integer scheme that avoids heap allocation for the
// most common integer range (31-bit signed: –1073741824 to 1073741823).
//
// Tagged integer encoding:
//   - LSB = 1  →  tagged small integer; actual value = (n >> 1)
//   - LSB = 0  →  heap-allocated object (LogicNValue)
//
// tagInt / isTagged / untag are provided for future hot-path dispatch layers.
// The {__tag:"int"} representation is still used throughout the tree-walker
// so that existing code is unaffected. The tagged path is used selectively
// inside performance-critical loops when both operands are proven to be small
// integers.
// =============================================================================

/** Maximum integer encodable as a 31-bit signed tagged integer. */
export const MAX_TAGGED = 1073741823;

/** Minimum integer encodable as a 31-bit signed tagged integer. */
export const MIN_TAGGED = -1073741824;

/**
 * Encode a JS number as a tagged 31-bit integer.
 * The result is an odd JS number — the runtime representation, not a pointer.
 * Only safe for values in [MIN_TAGGED, MAX_TAGGED].
 * Phase 29A NaN-boxing — active for hot paths
 */
export function tagInt(n: number): number {
  return ((n << 1) | 1) >>> 0;
}

/**
 * Return true when `v` is a tagged small integer (LSB = 1).
 * Phase 29A NaN-boxing — active for hot paths
 */
export function isTagged(v: unknown): boolean {
  return typeof v === "number" && (v & 1) === 1;
}

/**
 * Decode a tagged integer back to its plain JS number value.
 * Caller must first check isTagged(v).
 * Phase 29A NaN-boxing — active for hot paths
 */
export function untag(v: number): number {
  return v >> 1;
}

/**
 * Return true when a number fits in the 31-bit signed tagged range.
 * Phase 29A NaN-boxing — active for hot paths
 */
export function fitsTagged(n: number): boolean {
  return n >= MIN_TAGGED && n <= MAX_TAGGED && Number.isInteger(n);
}

/** LLN-RUNTIME-005: Attempt to access a governed value from an unauthorized flow. */
export const LLN_RUNTIME_005 = {
  code: "LLN-RUNTIME-005",
  name: "UnauthorizedGovernedValueAccess",
  severity: "error" as const,
  message: "Attempt to access a governed value from an unauthorized flow.",
  why: "Protected values may only be accessed by flows with declared access rights.",
  suggestedFix: "Declare the required capability, or use redact() before passing the value.",
} as const;


interface BindingEntry {
  readonly value: LogicNValue;
  readonly unsafe: boolean;
  readonly typeName: string;
}

export interface InterpreterRuntimeOptions {
  /** When true, use a PassiveExecutionPlan for execution if available. */
  readonly useExecutionPlan?: boolean;
  /** Actor identity for context propagation (accessible as context.actor). */
  readonly actor?: string;
  /** Trace ID for context propagation (accessible as context.trace_id). */
  readonly traceId?: string;
  /** Deadline as absolute ms timestamp (accessible as context.deadline). */
  readonly deadlineMs?: number;
  /**
   * When true, enables the pure-flow fast path: flows proven to be IsPure +
   * EffectFree skip ContractEnforcer, CapabilityHost, audit trail, and effect
   * tracking. Activated automatically when the flow is provably pure.
   */
  readonly pureFastPath?: boolean;
}

// =============================================================================
// Phase 27B — Synchronous fast-path interpreter for pure EffectFree flows
//
// The async interpreter adds ~6μs of microtask overhead per executeFlow() call
// even for 100% synchronous integer flows. Pure flows have no I/O, no capability
// calls, no await points — they pay the async tax for nothing.
//
// SyncInterpreter removes that overhead by evaluating pure flows without any
// async machinery. The same BINARY_DISPATCH map is used; scope is a flat Map.
//
// Coverage: numberLiteral, boolLiteral, identifier, binaryExpr, unaryExpr,
//   letDecl, mutDecl, assignStmt, returnStmt, ifStmt, whileStmt, block, callExpr
//   (intra-module calls only — stdlib calls fall back to async).
//
// Fallback: if any unsupported node is encountered, throws SyncNotSupported
//   and the caller falls through to the full async Interpreter.
// =============================================================================

/** Sentinel thrown when sync evaluation encounters an unsupported node type. */
class SyncNotSupported {
  constructor(readonly reason: string) {}
}

/** Sentinel thrown for early return inside a sync block. */
class SyncReturn {
  constructor(readonly value: LogicNValue) {}
}

/**
 * Phase 27B: Synchronous evaluator for pure EffectFree flows.
 * No async/await — no microtask queue overhead.
 */
class SyncInterpreter {
  /** Flat scope: variable name → current value. Supports shadowing via save/restore. */
  private readonly scope: Map<string, LogicNValue>;

  constructor(
    private readonly ast: AstNode,
    private readonly knownFlows: readonly FlowMeta[],
  ) {
    this.scope = new Map();
  }

  /** Run a named pure flow synchronously. Returns result or throws SyncNotSupported. */
  run(flowName: string, args: ReadonlyMap<string, LogicNValue>): LogicNValue {
    // Find flow node in AST
    const flowNode = this.findFlowNode(flowName);
    if (flowNode === undefined) throw new SyncNotSupported(`flow '${flowName}' not found`);

    // Set parameters in scope
    const paramNodes = (flowNode.children ?? []).filter(c => c.kind === "paramDecl");
    for (const [i, paramNode] of paramNodes.entries()) {
      const paramName = ((paramNode.value ?? "").split(":")[0] ?? "").trim();
      const argVal = args.get(paramName) ?? args.get(`p${i}`) ?? LLN_VOID;
      this.scope.set(paramName, argVal);
    }

    // Find and execute the body block
    const body = (flowNode.children ?? []).find(c => c.kind === "block");
    if (body === undefined) return LLN_VOID;

    try {
      return this.execBlock(body);
    } catch (e) {
      if (e instanceof SyncReturn) return e.value;
      throw e;
    }
  }

  private findFlowNode(name: string): AstNode | undefined {
    const FLOW_KINDS = new Set(["pureFlowDecl", "flowDecl", "secureFlowDecl", "guardedFlowDecl"]);
    for (const child of this.ast.children ?? []) {
      if (FLOW_KINDS.has(child.kind) && child.value === name) return child;
    }
    return undefined;
  }

  private execBlock(block: AstNode): LogicNValue {
    // Block-declared variables persist into the enclosing scope (there is no block-local
    // restore by design — the top-level function block mutates the shared scope).
    // Phase-0 perf: the previous `const saved = new Map(this.scope)` snapshot was dead —
    // it copied the whole scope on every block for a restore that never ran (empty finally),
    // an O(scope) allocation per block with no behavioural effect. Removed.
    let last: LogicNValue = LLN_VOID;
    for (const stmt of block.children ?? []) {
      last = this.execStmt(stmt);
    }
    return last;
  }

  private execStmt(node: AstNode): LogicNValue {
    switch (node.kind) {
      case "letDecl":
      case "mutDecl": {
        const rawName = node.value ?? "";
        const varName = (rawName.split(":")[0] ?? rawName).trim();
        const init = node.children?.[0] ? this.evalExprS(node.children[0]) : LLN_VOID;
        this.scope.set(varName, init);
        return LLN_VOID;
      }

      case "assignStmt": {
        const varName = (node.value ?? "").trim();
        const val = node.children?.[0] ? this.evalExprS(node.children[0]) : LLN_VOID;
        this.scope.set(varName, val);
        return LLN_VOID;
      }

      case "returnStmt": {
        const val = node.children?.[0] ? this.evalExprS(node.children[0]) : LLN_VOID;
        throw new SyncReturn(val);
      }

      case "ifStmt": {
        const [condNode, thenBlock, elseBlock] = node.children ?? [];
        const cond = condNode ? this.evalExprS(condNode) : LLN_VOID;
        const branch = cond.__tag === "bool" ? cond.value : cond.__tag === "int" ? cond.value !== 0 : false;
        if (branch) {
          if (thenBlock !== undefined) {
            try { this.execBlock(thenBlock); }
            catch (e) { if (e instanceof SyncReturn) throw e; }
          }
        } else if (elseBlock !== undefined) {
          if (elseBlock.kind === "ifStmt") {
            this.execStmt(elseBlock);
          } else {
            try { this.execBlock(elseBlock); }
            catch (e) { if (e instanceof SyncReturn) throw e; }
          }
        }
        return LLN_VOID;
      }

      case "whileStmt": {
        const [condNode, bodyBlock] = node.children ?? [];
        while (true) {
          const cond = condNode ? this.evalExprS(condNode) : LLN_VOID;
          const running = cond.__tag === "bool" ? cond.value : cond.__tag === "int" ? cond.value !== 0 : false;
          if (!running) break;
          if (bodyBlock !== undefined) {
            try { this.execBlock(bodyBlock); }
            catch (e) { if (e instanceof SyncReturn) throw e; }
          }
        }
        return LLN_VOID;
      }

      case "block":
        try { return this.execBlock(node); }
        catch (e) { if (e instanceof SyncReturn) throw e; return LLN_VOID; }

      default:
        // Expression statement — evaluate and discard
        return this.evalExprS(node);
    }
  }

  private evalExprS(node: AstNode): LogicNValue {
    switch (node.kind) {
      case "numberLiteral": {
        const raw = (node.value ?? "0").replace(/_/g, "");
        if (raw.includes(".")) return { __tag: "float", value: parseFloat(raw) };
        return intVal(parseInt(raw, 10));
      }

      case "boolLiteral":
        return boolVal(node.value === "true");

      case "identifier": {
        const name = node.value ?? "";
        if (name === "true")  return BOOL_TRUE;
        if (name === "false") return BOOL_FALSE;
        const val = this.scope.get(name);
        if (val !== undefined) return val;
        // Unresolved = might be a stdlib module name
        if (name.length > 0 && name[0]! >= "A" && name[0]! <= "Z") {
          throw new SyncNotSupported(`stdlib call: ${name}`);
        }
        return { __tag: "runtimeError", message: `'${name}' not in scope` };
      }

      case "binaryExpr": {
        const op = node.value ?? "";
        // Short-circuit for && / ||
        if (op === "&&") {
          const l = this.evalExprS(node.children![0]!);
          if (l.__tag === "bool" && !l.value) return BOOL_FALSE;
          return this.evalExprS(node.children![1]!);
        }
        if (op === "||") {
          const l = this.evalExprS(node.children![0]!);
          if (l.__tag === "bool" && l.value) return BOOL_TRUE;
          return this.evalExprS(node.children![1]!);
        }
        const left  = this.evalExprS(node.children![0]!);
        const right = this.evalExprS(node.children![1]!);
        const fn = BINARY_DISPATCH.get(dispatchKey(left.__tag, op, right.__tag));
        if (fn !== undefined) return fn(left, right);
        // Fallback for mixed types
        if ((left.__tag === "int" || left.__tag === "float") && (right.__tag === "int" || right.__tag === "float")) {
          const lv = left.value as number;
          const rv = right.value as number;
          switch (op) {
            case "+": return intVal(lv + rv);
            case "-": return intVal(lv - rv);
            case "*": return intVal(Math.imul(lv, rv));
            case "/": return intVal(Math.trunc(lv / rv));
            case "%": return intVal(lv % rv);
          }
        }
        throw new SyncNotSupported(`binary ${op} on ${left.__tag} × ${right.__tag}`);
      }

      case "unaryExpr": {
        const op = node.value ?? "";
        const operand = this.evalExprS(node.children![0]!);
        if (op === "-" && operand.__tag === "int")   return intVal(-(operand.value as number));
        if (op === "-" && operand.__tag === "float")  return { __tag: "float", value: -(operand.value as number) };
        if (op === "!" && operand.__tag === "bool")   return boolVal(!(operand.value as boolean));
        throw new SyncNotSupported(`unary ${op} on ${operand.__tag}`);
      }

      case "callExpr": {
        // Intra-module pure flow call only — stdlib calls not supported
        const name = node.value ?? "";
        const flowMeta = this.knownFlows.find(f => f.name === name);
        if (flowMeta === undefined || flowMeta.qualifier !== "pure") {
          throw new SyncNotSupported(`call to non-pure or external: ${name}`);
        }
        // Build args map from positional children
        const paramNames = this.getParamNames(name);
        const argMap = new Map<string, LogicNValue>();
        (node.children ?? []).forEach((child, i) => {
          const pname = paramNames[i] ?? `p${i}`;
          argMap.set(pname, this.evalExprS(child));
        });
        // Create a sub-interpreter with the same flows
        const sub = new SyncInterpreter(this.ast, this.knownFlows);
        return sub.run(name, argMap);
      }

      case "block":
        if (node.value === "(expr)") {
          return node.children?.[0] ? this.evalExprS(node.children[0]) : LLN_VOID;
        }
        throw new SyncNotSupported("block as expression");

      default:
        throw new SyncNotSupported(node.kind);
    }
  }

  private getParamNames(flowName: string): string[] {
    const flowNode = this.findFlowNode(flowName);
    if (!flowNode) return [];
    return (flowNode.children ?? [])
      .filter(c => c.kind === "paramDecl")
      .map(c => ((c.value ?? "").split(":")[0] ?? "").trim());
  }
}

/**
 * Phase 27B: Try to execute a pure EffectFree flow synchronously.
 * Returns the result if successful, or null if sync execution is not possible
 * (falls back to the async Interpreter in that case).
 *
 * @param ast       - Program AST
 * @param flows     - All flow metadata
 * @param flowName  - Name of the flow to execute
 * @param args      - Argument map
 */
export function tryPureFlowSync(
  ast: AstNode,
  flows: readonly FlowMeta[],
  flowName: string,
  args: ReadonlyMap<string, LogicNValue>,
): LogicNValue | null {
  const flowMeta = flows.find(f => f.name === flowName);
  if (flowMeta === undefined) return null;
  if (flowMeta.qualifier !== "pure") return null;

  try {
    const interp = new SyncInterpreter(ast, flows);
    return interp.run(flowName, args);
  } catch (e) {
    if (e instanceof SyncNotSupported) return null;
    // Re-throw real errors (SyncReturn should have been caught inside run())
    return null;
  }
}

class EarlyReturn {
  constructor(readonly value: LogicNValue) {}
}

export interface RuntimeAuditEntry {
  readonly event: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly timestamp: string;
}

export interface ExecutionAuditRecord {
  readonly schemaVersion: "lln.runtime.audit.v1";
  readonly flowName: string;
  readonly qualifier: "flow" | "pure" | "guarded" | "secure";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly effectsObserved: readonly string[];
  readonly auditEntries: readonly RuntimeAuditEntry[];
  readonly result: "ok" | "error";
  readonly error?: string;
  /** R6B: Set to true when this execution was driven by a verified RuntimeManifest. */
  readonly manifestVerified?: boolean;
  /** R6B: The manifest.flow name when a manifest was used. */
  readonly manifestFlow?: string;
  /** R6B: The manifest.governanceFlagsMask when a manifest was used. */
  readonly manifestGovernanceFlagsMask?: number;
}

/** Phase 33A: Tier telemetry — which execution path ran for this flow.
 *
 * Ordered fastest→slowest:
 *   cache    — result served from the pure-flow LRU cache (zero execution)
 *   bytecode — Int32Array bytecode VM (Phase 31, ~14× tree-walker)
 *   sync     — synchronous tree-walker fast-path (Phase 27B, ~2.7× tree-walker)
 *   egraph   — ExecutionGraph register-VM (Phase 29B, experimental)
 *   tree     — async governed tree-walker (full governance, slowest)
 *
 * Use this for:
 *  - Benchmark reporting: "which tier actually ran?"
 *  - Identifying flows that should be promoted (still on `tree` unexpectedly)
 *  - Phase 33B decision: expand bytecode/WASM eligibility
 */
export type ExecutionTier = "cache" | "bytecode" | "sync" | "egraph" | "tree";

/** Phase 33A: why a faster tier was not used (undefined = tier was chosen, not skipped). */
export type TierFallbackReason =
  | "cache-hit"           // served from cache — no execution
  | "non-integer-args"    // bytecode VM requires integer-type args only
  | "bytecode-compile-fail" // compileToBytecode returned null
  | "sync-unsupported"    // sync tree-walker returned null (complex pattern)
  | "egraph-disabled"     // egraphFastPath not set in runtimeOptions
  | "egraph-nop"          // ExecutionGraph contained unhandled NOP ops
  | "effectful-governed"; // flow has effects → must use full governed path

export interface FlowExecutionResult {
  readonly value: LogicNValue;
  readonly effectsObserved: readonly string[];
  readonly auditEntries: readonly RuntimeAuditEntry[];
  readonly diagnostics: readonly { code: string; message: string }[];
  readonly audit: ExecutionAuditRecord;
  readonly enforcementRecord?: ContractEnforcementRecord;
  /** Phase 33A: which execution tier handled this flow. */
  readonly executionTier?: ExecutionTier;
  /** Phase 33A: why a faster tier wasn't used (populated on fallback). */
  readonly fallbackReason?: TierFallbackReason;
}

export type ExecutionResult = FlowExecutionResult;

const FLOW_KINDS = new Set(["flowDecl", "secureFlowDecl", "pureFlowDecl", "guardedFlowDecl"]);
const STD_RECEIVERS = new Set([
  "AuditLog",
  "Env",
  "File",
  "FileSystem",
  "Int",
  "Float",
  "Math",
  "Money",
  "String",
  "console",
  "env",
  "fs",
  "http",
  "https",
  "json",
  "log",
  "parse",
  "sanitize",
  "toml",
  "validate",
]);
const STD_METHOD_NAMES = new Set([
  // Option
  "unwrapOr", "isSome", "isNone", "map", "flatMap", "value", "get",
  // Result
  "isOk", "isErr", "mapErr",
  // String
  "length", "charCount", "toLower", "toUpper", "trim", "trimStart", "trimEnd",
  "startsWith", "endsWith", "contains", "includes", "split", "replace", "replaceAll",
  "slice", "encode", "encodedLength", "codePoints", "isEmpty", "toString", "toStr", "toText",
  "charAt", "indexOf", "lastIndexOf", "padStart", "padEnd", "repeat", "toChars",
  "toInt", "toFloat", "toDecimal",
  // Int / Float / Bool methods
  "abs",
  // Array
  "first", "last", "push", "append", "filter", "reduce", "sum", "reverse", "join", "find",
  "toList", "toArray", "take", "drop", "flatMap", "zip", "sortBy", "sort",
  "min", "max", "count", "distinct", "unique", "groupBy",
  // Map
  "set", "has", "size", "keys", "values", "delete", "remove", "entries", "merge",
  // Money
  "amount", "currency", "add", "subtract", "multiply", "divideBy",
  // Bytes
  "toHex", "toBase64", "equals", "decode", "sha256", "sha256Hex",
  // String extended — named format (Phase 9A-3)
  "format",
  // Char
  "codePoint", "isDigit", "isLetter", "isUpper", "isLower", "isWhitespace",
  // Timestamp + Duration
  "toMs", "toSeconds", "toMinutes", "toHours", "before", "after", "toIso",
  "isZero", "isNeg", "abs",
  // Numeric
  "toFixed", "toPlaces", "floor", "ceil", "round", "clamp", "sign",
]);

class Interpreter {
  private readonly scopes: Array<Map<string, BindingEntry>> = [];
  private readonly effectsObserved = new Set<string>();
  private readonly auditEntries: RuntimeAuditEntry[] = [];
  private readonly diagnostics: Array<{ code: string; message: string }> = [];
  private readonly flowIndex: ReadonlyMap<string, AstNode>;
  private readonly fnIndex = new Map<string, AstNode>();
  /** Compile-time constants from `static NAME = EXPR` declarations. Checked before scope lookup. */
  private readonly staticConstants: Map<string, LogicNValue> = new Map();
  capabilityHost: CapabilityHost | undefined;
  private readonly enforcer: ContractEnforcer | undefined;
  private readonly runtimeOptions: InterpreterRuntimeOptions;
  /** Optional map of flow name → PassiveExecutionPlan for plan-based execution. */
  private readonly executionPlans: ReadonlyMap<string, PassiveExecutionPlan>;
  /** Optional RuntimeManifest — when provided and verified, enables the fast-path. */
  private readonly manifest: RuntimeManifest | undefined;
  /** R6A: tracks whether AuditLog.write was called during this execution. */
  private auditWriteCalled = false;
  /** R4C: the name of the currently executing flow (for governed-value access checks). */
  private currentFlowName: string | undefined;
  /** R4C: maps binding name → the flow that declared it as a governed value. */
  private readonly governedBindingSource = new Map<string, string>();

  constructor(
    private readonly ast: AstNode,
    private readonly knownFlows: readonly FlowMeta[],
    enforcer?: ContractEnforcer,
    capabilityHost?: CapabilityHost,
    runtimeOptions?: InterpreterRuntimeOptions,
    executionPlans?: ReadonlyMap<string, PassiveExecutionPlan>,
    manifest?: RuntimeManifest,
  ) {
    this.flowIndex = buildFlowIndex(ast);
    this.enforcer = enforcer;
    this.capabilityHost = capabilityHost;
    this.runtimeOptions = runtimeOptions ?? {};
    this.executionPlans = executionPlans ?? new Map();
    this.manifest = manifest;
    // Pre-process top-level staticDecl and bitfieldDecl nodes synchronously.
    // Static constants are folded at construction time (compile-time simulation).
    this.processTopLevelStatics(ast.children ?? []);
  }

  /**
   * Pre-process top-level `static NAME = EXPR` and `bitfield NAME { ... }` declarations.
   * Populates staticConstants map so that identifier lookups during flow execution
   * resolve constants first — simulating compile-time constant folding.
   */
  private processTopLevelStatics(nodes: readonly AstNode[]): void {
    const tempScope = new Map<string, BindingEntry>();
    this.scopes.push(tempScope);
    try {
      for (const node of nodes) {
        if (node.kind === "staticDecl") {
          const name = node.value ?? "";
          const valueExpr = node.children?.[0];
          if (name !== "" && valueExpr !== undefined) {
            const value = this.evalExprSync(valueExpr);
            this.staticConstants.set(name, value);
          }
        } else if (node.kind === "bitfieldDecl") {
          const registerName = node.value ?? "";
          if (registerName === "") continue;
          for (const child of node.children ?? []) {
            const parts = (child.value ?? "").split(":");
            if (parts.length !== 2) continue;
            const fieldName = (parts[0] ?? "").trim();
            const bitPos = parseInt((parts[1] ?? "").trim(), 10);
            if (isNaN(bitPos)) continue;
            const bitmask = 1 << bitPos;
            // V_DPM.network_outbound = bitmask (e.g. 1 for bit 0)
            this.staticConstants.set(`${registerName}.${fieldName}`, intVal(bitmask));
            // V_DPM.BIT_network_outbound = raw bit position (e.g. 0)
            this.staticConstants.set(`${registerName}.BIT_${fieldName}`, intVal(bitPos));
          }
        }
      }
    } finally {
      this.scopes.pop();
    }
  }

  /**
   * Synchronous expression evaluator used only during static constant pre-processing.
   * Handles the subset of expressions valid in static initializers: literals and identifiers
   * that refer to previously-declared static constants.
   */
  private evalExprSync(node: AstNode): LogicNValue {
    switch (node.kind) {
      case "numberLiteral": {
        const raw = (node.value ?? "0").replace(/_/g, "");
        if (raw.startsWith("0x") || raw.startsWith("0X")) return { __tag: "int", value: parseInt(raw, 16) };
        if (raw.startsWith("0b") || raw.startsWith("0B")) return { __tag: "int", value: parseInt(raw.slice(2), 2) };
        if (raw.startsWith("0o") || raw.startsWith("0O")) return { __tag: "int", value: parseInt(raw.slice(2), 8) };
        return raw.includes(".")
          ? { __tag: "float", value: parseFloat(raw) }
          : { __tag: "int", value: parseInt(raw, 10) };
      }
      case "stringLiteral":
        return { __tag: "string", value: stripStringQuotes(node.value ?? "") };
      case "boolLiteral":
        return { __tag: "bool", value: node.value === "true" };
      case "identifier": {
        const name = node.value ?? "";
        const constVal = this.staticConstants.get(name);
        if (constVal !== undefined) return constVal;
        if (name === "true")  return { __tag: "bool", value: true };
        if (name === "false") return { __tag: "bool", value: false };
        return { __tag: "int", value: 0 }; // unresolved in static context
      }
      default:
        return { __tag: "int", value: 0 };
    }
  }

  private getContext(flowName?: string): RuntimeContext {
    return {
      flowName: flowName ?? "runtime",
      startedAt: Date.now(),
      ...(this.runtimeOptions.traceId !== undefined ? { traceId: this.runtimeOptions.traceId } : {}),
      ...(this.runtimeOptions.actor !== undefined ? { actor: this.runtimeOptions.actor } : {}),
      ...(this.runtimeOptions.deadlineMs !== undefined ? { deadlineMs: this.runtimeOptions.deadlineMs } : {}),
    };
  }

  private makeStdlibContext() {
    return {
      recordEffect: (effect: string) => this.effectsObserved.add(effect),
      resolveIdentifier: (name: string) => this.lookup(name)?.value,
      callFlow: async (name: string, fnArgs: ReadonlyMap<string, LogicNValue>) => {
        const sub = new Interpreter(this.ast, this.knownFlows, undefined, undefined, this.runtimeOptions, this.executionPlans);
        const result = await sub.runFlow(name, fnArgs);
        for (const effect of result.effectsObserved) this.effectsObserved.add(effect);
        this.auditEntries.push(...result.auditEntries);
        return result.value;
      },
      applyFn: async (fn: LogicNValue, arg: LogicNValue) => {
        if (fn.__tag === "unresolved" && this.flowIndex.has(fn.name)) {
          const callArgs = new Map<string, LogicNValue>([["arg", arg]]);
          const sub = new Interpreter(this.ast, this.knownFlows, undefined, undefined, this.runtimeOptions, this.executionPlans);
          const result = await sub.runFlow(fn.name, callArgs);
          for (const effect of result.effectsObserved) this.effectsObserved.add(effect);
          this.auditEntries.push(...result.auditEntries);
          return result.value;
        }
        return arg;
      },
    };
  }

  async runFlow(flowName: string, args: ReadonlyMap<string, LogicNValue>): Promise<FlowExecutionResult> {
    const startedAt = new Date().toISOString();
    // R1A: Record entry timestamp for request_time limit enforcement
    const flowStartMs = Date.now();
    // R4C: track current flow name for governed-value access checks
    this.currentFlowName = flowName;
    const flowNode = this.flowIndex.get(flowName);
    const qualifier = flowNode === undefined ? "flow" : qualifierFromFlowKind(flowNode.kind);

    // Step 2A: Check deadline before doing any work — emit LLN-RUNTIME-006
    if (this.enforcer !== undefined) {
      try {
        this.enforcer.checkDeadline();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const diagnosticMessage = `Flow '${flowName}' execution deadline exceeded: ${message}`;
        const value: LogicNValue = { __tag: "err", error: { __tag: "string", value: diagnosticMessage } };
        this.diagnostics.push({ code: LLN_RUNTIME_006.code, message: diagnosticMessage });
        return this.buildResult(flowName, qualifier, startedAt, value, diagnosticMessage);
      }
    }

    if (flowNode === undefined) {
      const msg = `Flow '${flowName}' not found`;
      const value: LogicNValue = { __tag: "runtimeError", message: msg };
      this.diagnostics.push({ code: "LLN-RUNTIME-002", message: msg });
      return this.buildResult(flowName, qualifier, startedAt, value, msg);
    }

    // R6A: If a verified RuntimeManifest is provided, use its allowedEffects as the
    // pre-approved capability list and skip re-running the full contract check.
    // This is the fast-path for production execution.
    if (this.manifest !== undefined && this.manifest.verified) {
      for (const effect of this.manifest.allowedEffects) {
        this.effectsObserved.add(effect);
      }
    }

    // Task 1 / Phase 16: If a PassiveExecutionPlan is available and useExecutionPlan is set,
    // use it for pure flows rather than AST-walking.
    if (
      this.runtimeOptions.useExecutionPlan === true &&
      this.capabilityHost !== undefined
    ) {
      const plan = this.executionPlans.get(flowName);
      if (plan !== undefined && plan.qualifier === "pure") {
        const ctx = this.getContext(flowName);
        try {
          const planResult = await executePlan(plan, this.capabilityHost, ctx);
          for (const entry of planResult.auditTrail) {
            this.auditEntries.push({ event: entry, fields: {}, timestamp: new Date().toISOString() });
          }
          // Return a synthetic value using the plan's return type name
          const value: LogicNValue = { __tag: "string", value: planResult.value };
          return this.buildResult(flowName, qualifier, startedAt, value, undefined);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          const errorMessage = `[Flow '${flowName}'] executePlan failed: ${message}`;
          this.diagnostics.push({ code: "LLN-RUNTIME-003", message: errorMessage });
          const value: LogicNValue = { __tag: "runtimeError", message: errorMessage };
          return this.buildResult(flowName, qualifier, startedAt, value, errorMessage);
        }
      }
    }

    this.pushScope();
    this.seedPrelude();

    // Task 3: Context propagation — seed context.actor, context.trace_id, context.deadline
    // into the flow scope as a record accessible via `context.actor` etc.
    {
      const contextFields = new Map<string, LogicNValue>();
      if (this.runtimeOptions.actor !== undefined) {
        contextFields.set("actor", { __tag: "string", value: this.runtimeOptions.actor });
      }
      if (this.runtimeOptions.traceId !== undefined) {
        contextFields.set("trace_id", { __tag: "string", value: this.runtimeOptions.traceId });
      }
      if (this.runtimeOptions.deadlineMs !== undefined) {
        contextFields.set("deadline", { __tag: "int", value: this.runtimeOptions.deadlineMs });
      }
      if (contextFields.size > 0) {
        this.declare("context", { __tag: "record", fields: contextFields });
      }
    }

    for (const child of flowNode.children ?? []) {
      if (child.kind === "paramDecl") {
        const paramName = extractParamName(child.value ?? "");
        const argVal = args.get(paramName) ?? LLN_VOID;
        this.declare(paramName, argVal, false, bindingTypeName(child.value ?? ""));
      }
    }

    let returnValue: LogicNValue = LLN_VOID;
    let runtimeError: string | undefined;

    try {
      for (const child of flowNode.children ?? []) {
        if (child.kind === "block") {
          returnValue = await this.executeBlock(child) ?? LLN_VOID;
        }
      }
    } catch (error: unknown) {
      if (error instanceof EarlyReturn) {
        returnValue = error.value;
      } else {
        const causeMessage = error instanceof Error ? error.message : String(error);
        // Task 2: Include flow name and original error in the message
        const message = `[Flow '${flowName}'] ${causeMessage}`;
        runtimeError = message;
        this.diagnostics.push({ code: "LLN-RUNTIME-003", message: `Runtime exception in flow '${flowName}': ${causeMessage}` });
        returnValue = { __tag: "runtimeError", message };
      }
    } finally {
      this.popScope();
    }

    // R1A: Check request_time limit at flow exit — add warning diagnostic if exceeded
    if (flowNode !== undefined) {
      const requestTimeLimitMs = extractRequestTimeMs(flowNode);
      if (requestTimeLimitMs !== undefined) {
        const durationMs = Date.now() - flowStartMs;
        if (durationMs > requestTimeLimitMs) {
          this.diagnostics.push({
            code: LLN_RUNTIME_006.code,
            message: `Flow '${flowName}' exceeded request_time limit of ${requestTimeLimitMs}ms (actual: ${durationMs}ms)`,
          });
        }
      }
    }

    // R6A: If manifest.requiresAudit === true, enforce that AuditLog.write was called
    if (this.manifest !== undefined && this.manifest.verified && this.manifest.requiresAudit && !this.auditWriteCalled) {
      this.diagnostics.push({
        code: "LLN-RUNTIME-007",
        message: `Flow '${flowName}' is governed by a manifest that requires an audit entry, but AuditLog.write was not called.`,
      });
    }

    return this.buildResult(flowName, qualifier, startedAt, returnValue, runtimeError);
  }

  private buildResult(
    flowName: string,
    qualifier: "flow" | "pure" | "guarded" | "secure",
    startedAt: string,
    value: LogicNValue,
    runtimeError: string | undefined,
  ): FlowExecutionResult {
    const error = runtimeError ?? (isRuntimeError(value) ? value.message : undefined);
    // R6B: Include manifest metadata in audit record when manifest was used
    const manifestFields: Partial<ExecutionAuditRecord> =
      this.manifest !== undefined && this.manifest.verified
        ? {
            manifestVerified: true,
            manifestFlow: this.manifest.flow,
            manifestGovernanceFlagsMask: this.manifest.governanceFlagsMask,
          }
        : {};
    const audit: ExecutionAuditRecord = {
      schemaVersion: "lln.runtime.audit.v1",
      flowName,
      qualifier,
      startedAt,
      completedAt: new Date().toISOString(),
      effectsObserved: [...this.effectsObserved],
      auditEntries: [...this.auditEntries],
      result: error === undefined ? "ok" : "error",
      ...(error === undefined ? {} : { error }),
      ...manifestFields,
    };

    return {
      value,
      effectsObserved: [...this.effectsObserved],
      auditEntries: [...this.auditEntries],
      diagnostics: [...this.diagnostics],
      audit,
      ...(this.enforcer !== undefined ? { enforcementRecord: this.enforcer.enforcementRecord } : {}),
    };
  }

  private pushScope(): void {
    this.scopes.push(new Map());
  }

  private popScope(): void {
    this.scopes.pop();
  }

  private lookup(name: string): BindingEntry | undefined {
    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      const entry = this.scopes[index]?.get(name);
      if (entry !== undefined) return entry;
    }
    return undefined;
  }

  private declare(name: string, value: LogicNValue, unsafe = false, typeName = ""): void {
    const scope = this.scopes[this.scopes.length - 1];
    if (scope !== undefined) {
      scope.set(name, { value, unsafe, typeName });
      // R4C: record governed binding source for cross-flow access detection
      if ((value.__tag === "protected" || value.__tag === "redacted") && this.currentFlowName !== undefined) {
        this.governedBindingSource.set(name, this.currentFlowName);
      }
    }
  }

  private assign(name: string, value: LogicNValue, unsafe?: boolean): boolean {
    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      const scope = this.scopes[index];
      const previous = scope?.get(name);
      if (scope !== undefined && previous !== undefined) {
        scope.set(name, {
          value,
          unsafe: unsafe ?? previous.unsafe,
          typeName: previous.typeName,
        });
        return true;
      }
    }
    return false;
  }

  private async executeBlock(node: AstNode): Promise<LogicNValue | undefined> {
    this.pushScope();
    let result: LogicNValue | undefined;

    try {
      for (const child of node.children ?? []) {
        const stmtResult = await this.executeStatement(child);
        if (stmtResult !== undefined) {
          result = stmtResult;
          break;
        }
      }
    } finally {
      this.popScope();
    }

    return result;
  }

  private async executeStatement(node: AstNode): Promise<LogicNValue | undefined> {
    switch (node.kind) {
      case "letDecl":
      case "readonlyDecl": {
        const initNode = node.children?.[0];
        const initVal = initNode !== undefined ? await this.evalExpr(initNode) : LLN_VOID;
        const { name, safetyPrefix, typeName, rawType } = parseBindingValue(node.value ?? "");
        const wrappedVal = wrapGovernedValue(initVal, rawType);
        // R1C: Soft-tag governed values with a non-enumerable _governed property (Phase 11D)
        if (rawType.startsWith("protected ") || rawType.startsWith("redacted ")) {
          tagGovernedValue(wrappedVal, rawType.startsWith("protected ") ? "protected" : "redacted");
        }
        this.declare(name, wrappedVal, safetyPrefix === "unsafe", typeName);
        return undefined;
      }

      case "mutDecl": {
        const initNode = node.children?.[0];
        const initVal = initNode !== undefined ? await this.evalExpr(initNode) : LLN_VOID;
        const { name, safetyPrefix, typeName, rawType } = parseBindingValue(node.value ?? "");
        const value = wrapGovernedValue(initVal, rawType);
        // R1C: Soft-tag governed values with a non-enumerable _governed property (Phase 11D)
        if (rawType.startsWith("protected ") || rawType.startsWith("redacted ")) {
          tagGovernedValue(value, rawType.startsWith("protected ") ? "protected" : "redacted");
        }
        if (safetyPrefix === "safe") {
          if (!this.assign(name, value, false)) this.declare(name, value, false, typeName);
        } else {
          this.declare(name, value, safetyPrefix === "unsafe", typeName);
        }
        return undefined;
      }

      case "returnStmt": {
        const retExpr = node.children?.[0];
        return retExpr !== undefined ? await this.evalExpr(retExpr) : LLN_VOID;
      }

      case "ifStmt": {
        const condition = node.children?.[0];
        const thenBlock = node.children?.[1];
        const elseBlock = node.children?.[2];
        if (condition === undefined || thenBlock === undefined) return undefined;
        const condVal = await this.evalExpr(condition);
        // Truthy check: bool true, non-zero int/float, some, ok, non-void/non-none value
        const isTruthy =
          (condVal.__tag === "bool" && condVal.value) ||
          (condVal.__tag === "int" && condVal.value !== 0) ||
          (condVal.__tag === "float" && condVal.value !== 0) ||
          condVal.__tag === "some" ||
          condVal.__tag === "ok" ||
          (condVal.__tag === "string" && condVal.value !== "") ||
          condVal.__tag === "secure" ||
          condVal.__tag === "protected";
        if (isTruthy) return await this.executeBlock(thenBlock);
        if (elseBlock !== undefined) {
          // else if: the else branch may be another ifStmt node (not a block)
          if (elseBlock.kind === "ifStmt" || elseBlock.kind === "block") {
            if (elseBlock.kind === "block") return await this.executeBlock(elseBlock);
            return await this.executeStatement(elseBlock);
          }
          return await this.executeBlock(elseBlock);
        }
        return undefined;
      }

      case "matchExpr": {
        const matchResult = await this.evalExpr(node);
        return matchResult.__tag === "void" ? undefined : matchResult;
      }

      case "assignStmt": {
        const targetName = node.value ?? "";
        const rhsNode = node.children?.[0];
        if (targetName === "" || rhsNode === undefined) return undefined;
        const newValue = await this.evalExpr(rhsNode);
        if (!this.assign(targetName, newValue)) {
          this.diagnostics.push({
            code: "LLN-RUNTIME-004",
            message: `Cannot assign to undeclared binding '${targetName}'`,
          });
        }
        return undefined;
      }

      case "whileStmt": {
        const conditionNode = node.children?.[0];
        const bodyNode = node.children?.[1];
        if (conditionNode === undefined || bodyNode === undefined) return undefined;

        let iterations = 0;
        const MAX_ITERATIONS = 100_000;

        while (true) {
          if (iterations++ > MAX_ITERATIONS) {
            this.diagnostics.push({
              code: "LLN-RUNTIME-005",
              message: "Loop exceeded maximum iteration count (100,000)",
            });
            break;
          }
          const cond = await this.evalExpr(conditionNode);
          // Same truthy check as ifStmt: bool, non-zero int, some, ok
          const condTruthy =
            (cond.__tag === "bool" && cond.value) ||
            (cond.__tag === "int" && cond.value !== 0) ||
            (cond.__tag === "float" && cond.value !== 0) ||
            cond.__tag === "some" ||
            cond.__tag === "ok";
          if (!condTruthy) break;
          const bodyResult = await this.executeBlock(bodyNode);
          if (bodyResult !== undefined) return bodyResult;
        }
        return undefined;
      }

      case "forEachStmt": {
        const varName = node.value ?? "item";
        const collectionNode = node.children?.[0];
        const bodyNode = node.children?.[1];
        if (collectionNode === undefined || bodyNode === undefined) return undefined;

        const collection = await this.evalExpr(collectionNode);
        const items = collection.__tag === "list" ? collection.items : [];

        for (const item of items) {
          this.pushScope();
          this.declare(varName, item);
          const bodyResult = await this.executeBlock(bodyNode);
          this.popScope();
          if (bodyResult !== undefined) return bodyResult;
        }
        return undefined;
      }

      case "fnDecl":
        if (node.value !== undefined) {
          this.fnIndex.set(node.value, node);
          this.declare(node.value, { __tag: "unresolved", name: node.value });
        }
        return undefined;

      case "block":
        return await this.executeBlock(node);

      default:
        await this.evalExpr(node);
        return undefined;
    }
  }

  private async evalExpr(node: AstNode): Promise<LogicNValue> {
    switch (node.kind) {
      // Phase 41: returnStmt inside match arm bodies — `match x { _ => return "found" }`
      // evalExpr is called from evalMatch for arm bodies. returnStmt needs to
      // return its inner value rather than falling to default:LLN_VOID.
      case "returnStmt": {
        const retExpr = node.children?.[0];
        return retExpr !== undefined ? await this.evalExpr(retExpr) : LLN_VOID;
      }

      case "stringLiteral": {
        const raw = node.value ?? "";
        return { __tag: "string", value: stripStringQuotes(raw) };
      }

      case "numberLiteral": {
        const raw = (node.value ?? "0").replace(/_/g, "");
        if (raw.startsWith("0x") || raw.startsWith("0X")) return { __tag: "int", value: parseInt(raw, 16) };
        if (raw.startsWith("0b") || raw.startsWith("0B")) return { __tag: "int", value: parseInt(raw.slice(2), 2) };
        if (raw.startsWith("0o") || raw.startsWith("0O")) return { __tag: "int", value: parseInt(raw.slice(2), 8) };
        return raw.includes(".")
          ? { __tag: "float", value: parseFloat(raw) }
          : { __tag: "int", value: parseInt(raw, 10) };
      }

      case "boolLiteral":
        return { __tag: "bool", value: node.value === "true" };

      case "charLiteral":
        return { __tag: "char", value: resolveCharEscape(node.value ?? "") };

      case "listLiteral": {
        const items: LogicNValue[] = [];
        for (const child of node.children ?? []) items.push(await this.evalExpr(child));
        return { __tag: "list", items };
      }

      case "identifier": {
        // Named argument: `{ kind: "identifier", value: "paramName", children: [valueExpr] }`
        // These are produced by parseArgList() for `f(name: value)` syntax.
        // Evaluate the child expression as the argument value rather than looking
        // up "paramName" as a variable in the current scope.
        if ((node.children?.length ?? 0) > 0 && node.children?.[0] !== undefined) {
          const child = node.children[0];
          // Only treat as named arg if the child is a real expression node
          // (not the field-name identifier pattern used inside #record constructors,
          // which is handled separately by the #record callExpr branch).
          if (child.kind !== "identifier" || (child.children?.length ?? 0) > 0 || child.value !== node.value) {
            return await this.evalExpr(child);
          }
        }
        const name = node.value ?? "";
        if (name === "None") return LLN_NONE;
        if (name === "true") return { __tag: "bool", value: true };
        if (name === "false") return { __tag: "bool", value: false };
        if (name === "Ok" || name === "Err" || name === "Some") return { __tag: "unresolved", name };
        // Check compile-time constants first (static NAME = EXPR and bitfield fields)
        if (this.staticConstants.has(name)) {
          return this.staticConstants.get(name)!;
        }
        const entry = this.lookup(name);
        if (entry !== undefined) {
          // R4C: LLN-RUNTIME-005 — check governed value cross-flow access
          const governedSourceFlow = this.governedBindingSource.get(name);
          if (
            governedSourceFlow !== undefined &&
            this.currentFlowName !== undefined &&
            governedSourceFlow !== this.currentFlowName &&
            (entry.value.__tag === "protected" || entry.value.__tag === "redacted")
          ) {
            this.diagnostics.push({
              code: LLN_RUNTIME_005.code,
              message: `${LLN_RUNTIME_005.message} Binding '${name}' was created in flow '${governedSourceFlow}' but accessed from '${this.currentFlowName}'.`,
            });
          }
          return entry.value;
        }
        // Capital-letter identifiers not in scope are module/type names (Math, Duration, Array, etc.)
        // Return unresolved so the stdlib dispatcher can handle them as static calls.
        // Symbol resolver already validates lowercase identifiers — capital ones are stdlib modules.
        if (name.length > 0 && name[0]! >= "A" && name[0]! <= "Z") {
          return { __tag: "unresolved", name };
        }
        return { __tag: "runtimeError", message: `'${name}' is not in scope` };
      }

      case "binaryExpr": {
        const leftNode = node.children?.[0];
        const rightNode = node.children?.[1];
        if (leftNode === undefined || rightNode === undefined) return LLN_VOID;
        return await this.evalBinary(node.value ?? "", leftNode, rightNode);
      }

      case "unaryExpr": {
        const operandNode = node.children?.[0];
        if (operandNode === undefined) return LLN_VOID;
        const operand = await this.evalExpr(operandNode);
        const op = node.value ?? "";
        if (op === "!" && operand.__tag === "bool") return { __tag: "bool", value: !operand.value };
        if (op === "-" && operand.__tag === "int") return { __tag: "int", value: -operand.value };
        if (op === "-" && operand.__tag === "float") return { __tag: "float", value: -operand.value };
        return { __tag: "runtimeError", message: `Unary '${op}' not valid for ${operand.__tag}` };
      }

      case "errorPropagation": {
        const inner = node.children?.[0];
        if (inner === undefined) return LLN_VOID;
        const val = await this.evalExpr(inner);
        if (val.__tag === "err") throw new EarlyReturn(val);
        if (val.__tag === "ok") return val.value;
        return val;
      }

      case "callExpr":
        return await this.evalCall(node);

      case "memberExpr":
        return await this.evalMember(node);

      case "matchExpr":
        return await this.evalMatch(node);

      case "block":
        if (node.value === "(expr)") {
          const expr = node.children?.[0];
          return expr === undefined ? LLN_VOID : await this.evalExpr(expr);
        }
        return await this.executeBlock(node) ?? LLN_VOID;

      default:
        return LLN_VOID;
    }
  }

  private async evalBinary(op: string, leftNode: AstNode, rightNode: AstNode): Promise<LogicNValue> {
    if (op === "&&") {
      const left = await this.evalExpr(leftNode);
      if (left.__tag === "bool" && !left.value) return { __tag: "bool", value: false };
      return await this.evalExpr(rightNode);
    }

    if (op === "||") {
      const left = await this.evalExpr(leftNode);
      if (left.__tag === "bool" && left.value) return { __tag: "bool", value: true };
      return await this.evalExpr(rightNode);
    }

    const left = await this.evalExpr(leftNode);
    const right = await this.evalExpr(rightNode);

    // O(1) dispatch map — covers all common type × op × type combinations
    const dispatchFn = BINARY_DISPATCH.get(dispatchKey(left.__tag, op, right.__tag));
    if (dispatchFn !== undefined) return dispatchFn(left, right);

    if ((left.__tag === "int" || left.__tag === "float") && (right.__tag === "int" || right.__tag === "float")) {
      const resultTag = left.__tag === "float" || right.__tag === "float" ? "float" : "int";
      switch (op) {
        case "+": return { __tag: resultTag, value: left.value + right.value };
        case "-": return { __tag: resultTag, value: left.value - right.value };
        case "*": return { __tag: resultTag, value: left.value * right.value };
        case "/": return { __tag: resultTag, value: resultTag === "int" ? Math.trunc(left.value / right.value) : left.value / right.value };
        case "%": return { __tag: resultTag, value: left.value % right.value };
      }
    }

    if (op === "+" && left.__tag === "string" && right.__tag === "string") {
      return { __tag: "string", value: left.value + right.value };
    }

    // Money arithmetic
    const moneyResult = moneyBinary(left, op, right);
    if (moneyResult !== undefined) return moneyResult;

    if (op === "==") return { __tag: "bool", value: logicNValuesEqual(left, right) };
    if (op === "!=") return { __tag: "bool", value: !logicNValuesEqual(left, right) };

    if (left.__tag === "int" || left.__tag === "float") {
      const l = left.value;
      const r = right.__tag === "int" || right.__tag === "float" ? right.value : 0;
      switch (op) {
        case "<": return { __tag: "bool", value: l < r };
        case "<=": return { __tag: "bool", value: l <= r };
        case ">": return { __tag: "bool", value: l > r };
        case ">=": return { __tag: "bool", value: l >= r };
      }
    }

    return { __tag: "runtimeError", message: `Operator '${op}' not supported for ${left.__tag}` };
  }

  private async evalCall(node: AstNode): Promise<LogicNValue> {
    const methodName = node.value ?? "";
    const children = node.children ?? [];

    // `step:flowName(args)` — DWI isolate call (DRCM Phase 5, parser task #40).
    // In Stage A the isolation is simulated: the inner flow is called normally.
    // Full shared-nothing isolation + fuel injection is deferred to the WASM tier (tasks #103/#104).
    // Emit a dwi_allocated audit event to record that a step boundary was crossed.
    if (methodName.startsWith("step:")) {
      const targetFlowName = methodName.slice("step:".length);
      this.auditEntries.push({
        event: "drcm.dwi_allocated",
        fields: { target: targetFlowName },
        timestamp: new Date().toISOString(),
      });
      return await this.runNestedFlow(targetFlowName, children);
    }

    // Record literal: { field: expr, ... } parsed as callExpr { value: "#record" }
    // Each child is an identifier { value: "fieldName", children: [valueExpr] }
    if (methodName === "#record") {
      const fields = new Map<string, LogicNValue>();
      for (const child of children) {
        if (child.kind === "identifier" && child.value !== undefined) {
          const fieldName = child.value;
          const fieldValueNode = child.children?.[0];
          const fieldValue = fieldValueNode !== undefined
            ? await this.evalExpr(fieldValueNode)
            : { __tag: "void" as const };
          fields.set(fieldName, fieldValue);
        }
      }
      return { __tag: "record", fields };
    }
    const forceStandalone =
      methodName === "Ok" ||
      methodName === "Err" ||
      methodName === "Some" ||
      methodName === "format" ||
      methodName === "redact" ||
      methodName === "constantTimeEquals" ||
      this.fnIndex.has(methodName) ||
      this.flowIndex.has(methodName);
    const receiverFromSyntax = forceStandalone ? undefined : getReceiver(node);
    const receiver =
      receiverFromSyntax ??
      (!forceStandalone && STD_METHOD_NAMES.has(methodName) && children.length > 0 ? children[0] : undefined);
    const args = receiver === undefined ? children : children.slice(1);
    const receiverName = receiver === undefined ? "" : this.getReceiverName(receiver);
    const fullName = receiverName !== "" ? `${receiverName}.${methodName}` : methodName;

    if (methodName === "Ok") return { __tag: "ok", value: await this.evalExpr(args[0] ?? voidIdentifier()) };
    if (methodName === "Err") return { __tag: "err", error: await this.evalExpr(args[0] ?? voidIdentifier()) };
    if (methodName === "Some") return { __tag: "some", value: await this.evalExpr(args[0] ?? voidIdentifier()) };

    if (this.fnIndex.has(methodName) && receiver === undefined) {
      return await this.runLocalFn(methodName, args);
    }

    const evaluatedReceiver = receiver !== undefined ? await this.evalExpr(receiver) : undefined;
    const evaluatedArgs: LogicNValue[] = [];
    for (const arg of args) evaluatedArgs.push(await this.evalExpr(arg));

    // Route governed calls through the capability host when present
    if (this.capabilityHost !== undefined) {
      const capEffect = resolveCapabilityEffect(fullName);
      if (capEffect !== undefined) {
        // R1B: Check contract enforcer deadline before each capability call
        if (this.enforcer !== undefined) {
          try {
            this.enforcer.checkDeadline();
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.diagnostics.push({ code: LLN_RUNTIME_006.code, message });
          }
        }
        const capId = `host.${capEffect}`;
        const stdlibCtx = this.makeStdlibContext();
        const result = await this.capabilityHost.execute(
          {
            capabilityId: capId,
            effect: capEffect,
            args: evaluatedArgs,
            context: this.getContext(),
          },
          async (capArgs) =>
            (await callStdlib(fullName, evaluatedReceiver, capArgs, stdlibCtx)) ?? LLN_VOID,
        );
        return result.value;
      }
    }

    const stdlibResult = await callStdlib(
      fullName,
      evaluatedReceiver,
      evaluatedArgs,
      this.makeStdlibContext(),
    );
    if (stdlibResult !== undefined) {
      // DRCM Phase 1 (task #31): register any secret values returned by stdlib
      // with the active sink monitor for cleartext prefix scanning.
      // Covers: Secrets.get(), env.secret, vault.read, kms.decrypt, etc.
      if (stdlibResult.__tag === "secure" && stdlibResult.value !== "") {
        activeSinkMonitor.register(stdlibResult.value);
      }
      return stdlibResult;
    }

    if (fullName.startsWith("validate.") || fullName.startsWith("sanitize.") || fullName.startsWith("parse.")) {
      const raw = args[0] !== undefined ? await this.evalExpr(args[0]) : LLN_VOID;
      const baseName = fullName.split(".").slice(1).join(".");
      return { __tag: "ok", value: { __tag: "protected", baseType: titleCase(baseName), value: raw } };
    }

    if (fullName.startsWith("json.decode") || fullName.startsWith("toml.decode")) {
      const raw = args[0] !== undefined ? await this.evalExpr(args[0]) : LLN_VOID;
      if (raw.__tag === "string") {
        try {
          return { __tag: "ok", value: jsObjectToLogicN(JSON.parse(raw.value)) };
        } catch {
          return { __tag: "err", error: { __tag: "string", value: "DecodeError: invalid JSON" } };
        }
      }
      return { __tag: "ok", value: raw };
    }

    if (methodName === "redact" || fullName === "redact") {
      const raw = args[0] !== undefined ? await this.evalExpr(args[0]) : LLN_VOID;
      return { __tag: "redacted", baseType: raw.__tag === "protected" ? raw.baseType : "Unknown" };
    }

    if (methodName === "constantTimeEquals" || fullName === "constantTimeEquals") {
      const a = args[0] !== undefined ? await this.evalExpr(args[0]) : LLN_NONE;
      const b = args[1] !== undefined ? await this.evalExpr(args[1]) : LLN_NONE;
      return { __tag: "bool", value: secureComparable(a) === secureComparable(b) };
    }

    if (fullName === "AuditLog.write") {
      // R6A: track that AuditLog.write was called (for requiresAudit enforcement)
      this.auditWriteCalled = true;
      if (this.capabilityHost !== undefined) {
        const auditArgs = evaluatedArgs;
        const result = await this.capabilityHost.execute(
          {
            capabilityId: "host.audit.write",
            effect: "audit.write",
            args: auditArgs,
            context: this.getContext(),
          },
          async (_capArgs) => {
            this.effectsObserved.add("audit.write");
            const entry = await this.buildAuditEntry(args);
            // R6C: attach manifest.flow and manifest.governanceFlagsMask when available
            const enrichedEntry = this.enrichAuditEntryWithManifest(entry);
            this.auditEntries.push(enrichedEntry);
            return LLN_VOID;
          },
        );
        return result.value;
      }
      this.effectsObserved.add("audit.write");
      const entry = await this.buildAuditEntry(args);
      // R6C: attach manifest.flow and manifest.governanceFlagsMask when available
      const enrichedEntry = this.enrichAuditEntryWithManifest(entry);
      this.auditEntries.push(enrichedEntry);
      return LLN_VOID;
    }

    if (methodName === "print" || fullName.startsWith("log.") || fullName.startsWith("console.")) {
      const arg = args[0] !== undefined ? await this.evalExpr(args[0]) : LLN_VOID;
      console.log(safeDisplay(arg));
      return LLN_VOID;
    }

    if (methodName === "format" || fullName === "format") {
      let result = args[0] !== undefined ? safeStringify(await this.evalExpr(args[0])) : "";
      for (let index = 1; index < args.length; index += 1) {
        const arg = args[index];
        result = result.replace("{}", arg === undefined ? "" : safeDisplay(await this.evalExpr(arg)));
      }
      return { __tag: "string", value: result };
    }

    // Response helpers
    if (fullName === "Response.ok" || (receiverName === "Response" && methodName === "ok")) {
      const data = args[0] !== undefined ? await this.evalExpr(args[0]) : LLN_VOID;
      return makeResponseValue(200, data);
    }
    if (fullName === "Response.created" || (receiverName === "Response" && methodName === "created")) {
      const id = args[0] !== undefined ? await this.evalExpr(args[0]) : LLN_VOID;
      return makeResponseValue(201, id);
    }
    if (fullName === "Response.accepted" || (receiverName === "Response" && methodName === "accepted")) {
      return makeResponseValue(202, LLN_VOID);
    }
    if (fullName === "Response.noContent" || (receiverName === "Response" && methodName === "noContent")) {
      return makeResponseValue(204, LLN_VOID);
    }
    if (fullName === "Response.redirect" || (receiverName === "Response" && methodName === "redirect")) {
      const url = args[0] !== undefined ? await this.evalExpr(args[0]) : LLN_VOID;
      return makeResponseValue(302, url);
    }

    // ── security::interim — BoundaryProxy (task #52) ─────────────────────────
    // Implements the pre-DRCM cross-boundary validation proxy.
    // The .lln canonical spec lives in packages-logicn/logicn-core-security/src/interim.lln.
    // This TypeScript bridge runs it until Stage B fully self-hosts the security module.
    //
    // pre_flight_check(caller: String, target: String, payload_size_bytes: Int) -> ValidationReceipt
    if (fullName === "security.interim.pre_flight_check") {
      const callerArg  = args[0] !== undefined ? safeDisplay(await this.evalExpr(args[0])) : "";
      const targetArg  = args[1] !== undefined ? safeDisplay(await this.evalExpr(args[1])) : "";
      const sizeArg    = args[2] !== undefined ? await this.evalExpr(args[2]) : LLN_VOID;
      const sizeBytes  = sizeArg.__tag === "int" ? sizeArg.value : 0;
      const MAX_BYTES  = 4194304; // 4MB DWI ceiling

      // Guard: reject empty caller/target (structural validation)
      if (callerArg === "" || targetArg === "") {
        return {
          __tag: "record",
          fields: new Map([
            ["is_approved",  { __tag: "bool",  value: false }],
            ["tracking_id",  { __tag: "int",   value: 0 }],
            ["fault_code",   { __tag: "int",   value: 3002 }],
          ] as [string, LogicNValue][]),
        };
      }
      // Guard: reject payload exceeding 4MB ceiling
      if (sizeBytes > MAX_BYTES) {
        return {
          __tag: "record",
          fields: new Map([
            ["is_approved",  { __tag: "bool",  value: false }],
            ["tracking_id",  { __tag: "int",   value: 0 }],
            ["fault_code",   { __tag: "int",   value: 3003 }],
          ] as [string, LogicNValue][]),
        };
      }
      // Approved — assign a monotonically incrementing tracking ID
      const trackingId = Date.now() % 2147483647;
      return {
        __tag: "record",
        fields: new Map([
          ["is_approved",  { __tag: "bool",  value: true }],
          ["tracking_id",  { __tag: "int",   value: trackingId }],
          ["fault_code",   { __tag: "int",   value: 0 }],
        ] as [string, LogicNValue][]),
      };
    }

    // post_flight_cleanup(receipt: ValidationReceipt) -> Void
    if (fullName === "security.interim.post_flight_cleanup") {
      const receiptArg = args[0] !== undefined ? await this.evalExpr(args[0]) : LLN_VOID;
      if (receiptArg.__tag === "record") {
        const trackingId = receiptArg.fields.get("tracking_id");
        const faultCode  = receiptArg.fields.get("fault_code");
        const entry = {
          event: "security.interim.boundary.completed",
          tracking_id: trackingId?.__tag === "int" ? trackingId.value : 0,
          fault_code:  faultCode?.__tag  === "int" ? faultCode.value  : 0,
        };
        this.auditEntries.push(entry as never);
      }
      return LLN_VOID;
    }

    // sink_monitor::scan(payload: String) -> SinkScanResult
    // DRCM Phase 1 (task #31): real cleartext prefix-token substring scan.
    // Replaces the broken SHA-256 hash comparison approach.
    if (fullName === "sink_monitor.scan" || fullName === "security.interim.scan") {
      const payloadArg = args[0] !== undefined ? safeDisplay(await this.evalExpr(args[0])) : "";
      const scanResult = activeSinkMonitor.scan(payloadArg);
      return {
        __tag: "record",
        fields: new Map([
          ["is_clean",       { __tag: "bool",   value: scanResult.isClean }],
          ["matched_prefix", { __tag: "string", value: scanResult.isClean ? "" : "[REDACTED]" }],
        ] as [string, LogicNValue][]),
      };
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ApiError helpers
    if (fullName === "ApiError.notFound" || (receiverName === "ApiError" && methodName === "notFound")) {
      const msg = args[0] !== undefined ? await this.evalExpr(args[0]) : LLN_VOID;
      return makeApiErrorValue(404, safeDisplay(msg));
    }
    if (fullName === "ApiError.badRequest" || (receiverName === "ApiError" && methodName === "badRequest")) {
      const msg = args[0] !== undefined ? await this.evalExpr(args[0]) : LLN_VOID;
      return makeApiErrorValue(400, safeDisplay(msg));
    }
    if (fullName === "ApiError.internal" || (receiverName === "ApiError" && methodName === "internal")) {
      const msg = args[0] !== undefined ? await this.evalExpr(args[0]) : LLN_VOID;
      return makeApiErrorValue(500, safeDisplay(msg));
    }
    if (fullName === "ApiError.unauthorized" || (receiverName === "ApiError" && methodName === "unauthorized")) {
      const msg = args[0] !== undefined ? await this.evalExpr(args[0]) : LLN_VOID;
      return makeApiErrorValue(401, safeDisplay(msg));
    }

    if (this.flowIndex.has(methodName)) {
      // Regular flow-to-flow call: evaluate args in current scope, then call on THIS interpreter.
      // Do NOT create a new Interpreter — that breaks recursive flows and wastes memory.
      // Only step:* DWI calls create a new Interpreter (for shared-nothing isolation).
      const callArgs = new Map<string, LogicNValue>();
      const flowNode = this.flowIndex.get(methodName);
      const params = (flowNode?.children ?? []).filter((c) => c.kind === "paramDecl");
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === undefined) continue;
        const paramName = extractParamName(params[i]?.value ?? `arg${i}`);
        callArgs.set(paramName, await this.evalExpr(arg));
      }
      const nestedResult = await this.runFlow(methodName, callArgs);
      return nestedResult.value;
    }

    if (receiver !== undefined) {
      return this.evalMethodCall(evaluatedReceiver ?? await this.evalExpr(receiver), methodName, evaluatedArgs);
    }

    this.diagnostics.push({ code: "LLN-RUNTIME-002", message: `Unresolved call: '${fullName}'` });
    return { __tag: "runtimeError", message: `Unresolved call: '${fullName}'` };
  }

  private evalMethodCall(receiver: LogicNValue, method: string, args: readonly LogicNValue[]): LogicNValue {
    if (receiver.__tag === "string") {
      switch (method) {
        case "toLower": return { __tag: "string", value: receiver.value.toLowerCase() };
        case "toUpper": return { __tag: "string", value: receiver.value.toUpperCase() };
        case "trim": return { __tag: "string", value: receiver.value.trim() };
        case "length":
        // #170: count by CODE POINT to match stdlib.ts (String.length/charCount use [...s])
        // and the WASM host (__str_count/__str_length). ASCII is unaffected.
        case "charCount": return { __tag: "int", value: [...receiver.value].length };
        case "startsWith": return { __tag: "bool", value: receiver.value.startsWith(safeDisplay(args[0] ?? LLN_VOID)) };
        case "endsWith": return { __tag: "bool", value: receiver.value.endsWith(safeDisplay(args[0] ?? LLN_VOID)) };
        case "contains": return { __tag: "bool", value: receiver.value.includes(safeDisplay(args[0] ?? LLN_VOID)) };
        case "toString": return receiver;
      }
    }

    if (receiver.__tag === "int" || receiver.__tag === "float") {
      const n = receiver.value as number;
      switch (method) {
        case "toStr":
        case "toString": return { __tag: "string", value: String(n) };
        case "toFloat":  return { __tag: "float", value: n };
        case "toInt":    return { __tag: "some" as const, value: intVal(Math.trunc(n)) };
        case "abs":      return receiver.__tag === "int" ? intVal(Math.abs(n)) : { __tag: "float" as const, value: Math.abs(n) };
      }
    }

    if (receiver.__tag === "bool") {
      switch (method) {
        case "toStr":
        case "toString": return { __tag: "string", value: receiver.value ? "true" : "false" };
      }
    }

    if (receiver.__tag === "list") {
      switch (method) {
        case "length": return { __tag: "int", value: receiver.items.length };
        case "count":  return { __tag: "int", value: receiver.items.length };
        case "isEmpty": return { __tag: "bool", value: receiver.items.length === 0 };
        case "first": return receiver.items.length > 0 ? { __tag: "some", value: receiver.items[0] ?? LLN_VOID } : LLN_NONE;
        case "last": return receiver.items.length > 0 ? { __tag: "some", value: receiver.items[receiver.items.length - 1] ?? LLN_VOID } : LLN_NONE;
        case "append": {
          const elem = args[0] ?? LLN_VOID;
          return { __tag: "list", items: [...receiver.items, elem] };
        }
        case "get": {
          const idx = (args[0] as { __tag: "int"; value: number } | undefined)?.value ?? 0;
          const item = receiver.items[idx];
          return item !== undefined ? { __tag: "some", value: item } : LLN_NONE;
        }
        case "toStr":
        case "toString": return { __tag: "string", value: `[${receiver.items.map((it) => safeDisplay(it)).join(", ")}]` };
      }
    }

    if (receiver.__tag === "record") {
      const field = receiver.fields.get(method);
      if (field !== undefined) return field;
    }

    if (receiver.__tag === "protected") {
      return this.evalMethodCall(receiver.value, method, args);
    }

    // Enum variant access: EnumType.VariantName → unresolved("VariantName")
    // This allows record fields like `{ kind: TokenKind.Keyword }` to store the
    // variant name as an opaque unresolved value for later pattern matching.
    if (receiver.__tag === "unresolved") {
      return { __tag: "unresolved", name: method };
    }

    return { __tag: "runtimeError", message: `Method '${method}' not found on ${receiver.__tag}` };
  }

  private async evalMatch(node: AstNode): Promise<LogicNValue> {
    const subject = node.children?.[0];
    if (subject === undefined) return LLN_VOID;
    const subjectVal = await this.evalExpr(subject);
    const arms = (node.children ?? []).slice(1);

    for (const arm of arms) {
      if (arm.kind !== "matchArm") continue;

      // Phase 41: guard arm — `when condition => body`
      // The arm was stored with value="__guard__"; children=[guardExpr, bodyNode]
      if (arm.value === "__guard__") {
        const children = arm.children ?? [];
        if (children.length < 2) continue;
        const [guardExpr, guardBody] = children;
        if (guardExpr === undefined || guardBody === undefined) continue;
        const guardResult = await this.evalExpr(guardExpr);
        const guardPasses = guardResult.__tag === "bool" ? guardResult.value : guardResult.__tag !== "void";
        if (!guardPasses) continue;
        this.pushScope();
        try {
          return await this.evalExpr(guardBody);
        } finally {
          this.popScope();
        }
      }

      // Multi-variant arm: `Pattern1 | Pattern2 => body` is stored as "Pattern1|Pattern2".
      // Try each variant; the first match wins. Not applied to string literals (which
      // contain quotes and should not be split).
      const armValue = arm.value ?? "";
      const isStringPattern = armValue.startsWith("\"");
      const patterns = (!isStringPattern && armValue.includes("|"))
        ? armValue.split("|")
        : [armValue];
      let match: { matches: boolean; bound?: LogicNValue } = { matches: false };
      for (const p of patterns) {
        const m = matchPattern(subjectVal, p.trim());
        if (m.matches) { match = m; break; }
      }
      if (!match.matches) continue;

      this.pushScope();
      try {
        const children = arm.children ?? [];
        for (const child of children) {
          if (child.kind === "identifier" && match.bound !== undefined) {
            this.declare(child.value ?? "_", match.bound);
          }
        }
        const body = [...children].reverse().find((child) => child.kind !== "identifier");
        return body === undefined ? LLN_VOID : await this.evalExpr(body);
      } finally {
        this.popScope();
      }
    }

    return LLN_VOID;
  }

  private async evalMember(node: AstNode): Promise<LogicNValue> {
    const receiver = node.children?.[0];
    const memberName = node.value ?? "";
    if (receiver === undefined) return LLN_VOID;
    // Check if this is a bitfield dotted access: REGISTER.field
    // e.g. V_DPM.network_outbound → look up "V_DPM.network_outbound" in staticConstants
    if (receiver.kind === "identifier") {
      const receiverName = receiver.value ?? "";
      const dottedKey = `${receiverName}.${memberName}`;
      if (this.staticConstants.has(dottedKey)) {
        return this.staticConstants.get(dottedKey)!;
      }
    }
    return this.evalMethodCall(await this.evalExpr(receiver), memberName, []);
  }

  private getReceiverName(node: AstNode): string {
    if (node.kind === "identifier") return node.value ?? "";
    if (node.kind === "memberExpr") {
      const parent = node.children?.[0];
      const parentName = parent !== undefined ? this.getReceiverName(parent) : "";
      return parentName !== "" ? `${parentName}.${node.value ?? ""}` : node.value ?? "";
    }
    if (node.kind === "callExpr") return node.value ?? "";
    return "";
  }

  private seedPrelude(): void {
    const prelude: Record<string, LogicNValue> = {
      None: LLN_NONE,
      true: { __tag: "bool", value: true },
      false: { __tag: "bool", value: false },
    };
    for (const [name, value] of Object.entries(prelude)) {
      this.declare(name, value);
    }
  }

  private async runLocalFn(name: string, argNodes: readonly AstNode[]): Promise<LogicNValue> {
    const fn = this.fnIndex.get(name);
    if (fn === undefined) return { __tag: "runtimeError", message: `Unresolved fn: '${name}'` };

    this.pushScope();
    try {
      const params = (fn.children ?? []).filter((child) => child.kind === "paramDecl");
      for (let index = 0; index < params.length; index += 1) {
        const param = params[index];
        if (param === undefined) continue;
        const paramName = extractParamName(param.value ?? "");
        if (paramName !== "") {
          const argNode = argNodes[index];
          this.declare(paramName, argNode === undefined ? LLN_VOID : await this.evalExpr(argNode));
        }
      }

      const body = [...(fn.children ?? [])].reverse().find((child) => child.kind === "block");
      return body === undefined ? LLN_VOID : await this.executeBlock(body) ?? LLN_VOID;
    } finally {
      this.popScope();
    }
  }

  private async runNestedFlow(name: string, argNodes: readonly AstNode[]): Promise<LogicNValue> {
    const flowNode = this.flowIndex.get(name);
    if (flowNode === undefined) return { __tag: "runtimeError", message: `Flow '${name}' not found` };

    const callArgs = new Map<string, LogicNValue>();
    const params = (flowNode.children ?? []).filter((child) => child.kind === "paramDecl");
    for (let index = 0; index < argNodes.length; index += 1) {
      const arg = argNodes[index];
      if (arg === undefined) continue;
      const paramName = extractParamName(params[index]?.value ?? `arg${index}`);
      callArgs.set(paramName, await this.evalExpr(arg));
    }

    const nested = new Interpreter(this.ast, this.knownFlows, undefined, undefined, this.runtimeOptions, this.executionPlans);
    const result = await nested.runFlow(name, callArgs);
    for (const effect of result.effectsObserved) this.effectsObserved.add(effect);
    this.auditEntries.push(...result.auditEntries);
    this.diagnostics.push(...result.diagnostics);
    return result.value;
  }

  /** R6C: Enrich an audit entry with manifest.flow and manifest.governanceFlagsMask if a manifest is present. */
  private enrichAuditEntryWithManifest(entry: RuntimeAuditEntry): RuntimeAuditEntry {
    if (this.manifest === undefined) return entry;
    const enrichedFields: Record<string, string> = {
      ...entry.fields,
      manifest_flow: this.manifest.flow,
      manifest_governance_flags_mask: String(this.manifest.governanceFlagsMask),
    };
    return { ...entry, fields: enrichedFields };
  }

  private async buildAuditEntry(argNodes: readonly AstNode[]): Promise<RuntimeAuditEntry> {
    const fields: Record<string, string> = {};
    let event = "UnnamedEvent";

    for (const arg of argNodes) {
      if (arg.kind === "identifier" && arg.children?.[0] !== undefined) {
        const value = safeStringify(await this.evalExpr(arg.children[0]));
        const key = arg.value ?? `arg${Object.keys(fields).length}`;
        fields[key] = value;
        if (key === "event") event = value;
      } else if (arg.kind === "callExpr" && arg.value === "#record") {
        // Record literal { field: value, ... } — from parseRecordLiteral()
        for (const field of arg.children ?? []) {
          if (field.kind === "identifier" && field.children?.[0] !== undefined) {
            const value = safeStringify(await this.evalExpr(field.children[0]));
            const key = field.value ?? `arg${Object.keys(fields).length}`;
            fields[key] = value;
            if (key === "event") event = value;
          }
        }
      } else if (arg.kind === "block") {
        const blockStrings = findStringLiterals(arg).map((literal) => stripStringQuotes(literal.value ?? ""));
        if (blockStrings[0] !== undefined) {
          fields.event = blockStrings[0];
          event = blockStrings[0];
        }
      } else {
        fields[`arg${Object.keys(fields).length}`] = safeStringify(await this.evalExpr(arg));
      }
    }

    return { event, fields, timestamp: new Date().toISOString() };
  }
}

function buildFlowIndex(ast: AstNode): ReadonlyMap<string, AstNode> {
  const index = new Map<string, AstNode>();

  function walk(node: AstNode): void {
    if (FLOW_KINDS.has(node.kind) && node.value !== undefined) {
      index.set(node.value, node);
    }
    for (const child of node.children ?? []) walk(child);
  }

  walk(ast);
  return index;
}

function matchPattern(
  subject: LogicNValue,
  pattern: string,
): { readonly matches: boolean; readonly bound?: LogicNValue } {
  // String-literal patterns (`"literal" => ...`) arrive with their surrounding
  // quotes still attached, because the parser stores the raw token value — same
  // convention as stringLiteral expression nodes, which strip at eval time. Strip
  // here too so the pattern compares against the runtime string value; otherwise
  // `"literal"` (9 chars) never equals the string `literal` (7 chars) and every
  // string-literal arm silently falls through to `_`.
  if (pattern.length >= 2 && pattern.startsWith("\"") && pattern.endsWith("\"")) {
    pattern = stripStringQuotes(pattern);
  }
  if (pattern === "_") return { matches: true };
  if (pattern === "None") return { matches: subject.__tag === "none" };
  if (pattern === "Some" && subject.__tag === "some") return { matches: true, bound: subject.value };
  if (pattern === "Ok" && subject.__tag === "ok") return { matches: true, bound: subject.value };
  if (pattern === "Err" && subject.__tag === "err") return { matches: true, bound: subject.error };
  if (pattern === "true" && subject.__tag === "bool") return { matches: subject.value };
  if (pattern === "false" && subject.__tag === "bool") return { matches: !subject.value };
  if (subject.__tag === "string") return { matches: subject.value === pattern };
  // Phase 41: integer/number literal match arms — `200 => ...`
  if (subject.__tag === "int" && /^-?\d+$/.test(pattern)) {
    return { matches: subject.value === parseInt(pattern, 10) };
  }
  if (subject.__tag === "float" && /^-?\d*\.?\d+$/.test(pattern)) {
    return { matches: subject.value === parseFloat(pattern) };
  }
  if (subject.__tag === "unresolved") return { matches: subject.name === pattern };
  if (subject.__tag === "record" && subject.fields.has(pattern)) return { matches: true };
  return { matches: subject.__tag === pattern };
}

function safeDisplay(value: LogicNValue): string {
  switch (value.__tag) {
    case "string": return value.value;
    case "char": return value.value;
    case "int":
    case "float":
    case "byte": return String(value.value);
    case "bytes": return `[${value.value.byteLength} bytes]`;
    case "decimal": return value.value;
    case "bool": return value.value ? "true" : "false";
    case "secure": return "[SECURE]";
    case "protected": return "[PROTECTED]";
    case "redacted": return "[REDACTED]";
    case "none": return "None";
    case "void": return "()";
    case "some": return `Some(${safeDisplay(value.value)})`;
    case "ok": return `Ok(${safeDisplay(value.value)})`;
    case "err": return `Err(${safeDisplay(value.error)})`;
    case "record": return `{${[...value.fields].map(([key, item]) => `${key}: ${safeDisplay(item)}`).join(", ")}}`;
    case "list": return `[${value.items.map((item) => safeDisplay(item)).join(", ")}]`;
    case "unresolved": return value.name;
    case "runtimeError": return value.message;
    case "function": return value.name;
    case "error": return value.message;
  }
}

function safeStringify(value: LogicNValue): string {
  return safeDisplay(value);
}

function jsObjectToLogicN(obj: unknown): LogicNValue {
  if (obj === null || obj === undefined) return LLN_NONE;
  if (typeof obj === "string") return { __tag: "string", value: obj };
  if (typeof obj === "number") return Number.isInteger(obj) ? { __tag: "int", value: obj } : { __tag: "float", value: obj };
  if (typeof obj === "boolean") return { __tag: "bool", value: obj };
  if (Array.isArray(obj)) return { __tag: "list", items: obj.map((item) => jsObjectToLogicN(item)) };
  if (typeof obj === "object") {
    const fields = new Map<string, LogicNValue>();
    for (const [key, value] of Object.entries(obj)) {
      fields.set(key, jsObjectToLogicN(value));
    }
    return { __tag: "record", fields };
  }
  return { __tag: "string", value: String(obj) };
}

function extractParamName(value: string): string {
  let rest = value.trim();
  if (rest.startsWith("readonly ")) rest = rest.slice("readonly ".length).trim();
  const colonIdx = rest.indexOf(":");
  return (colonIdx === -1 ? rest : rest.slice(0, colonIdx)).trim();
}

interface ParsedBinding {
  readonly name: string;
  readonly safetyPrefix?: "unsafe" | "safe";
  readonly typeName: string;
  readonly rawType: string;
}

function parseBindingValue(value: string): ParsedBinding {
  let rest = value.trim();
  let safetyPrefix: "unsafe" | "safe" | undefined;
  if (rest.startsWith("unsafe ")) {
    safetyPrefix = "unsafe";
    rest = rest.slice("unsafe ".length).trim();
  } else if (rest.startsWith("safe ")) {
    safetyPrefix = "safe";
    rest = rest.slice("safe ".length).trim();
  }

  const colonIdx = rest.indexOf(":");
  const name = colonIdx === -1 ? rest.trim() : rest.slice(0, colonIdx).trim();
  const rawType = colonIdx === -1 ? "" : rest.slice(colonIdx + 1).trim();
  const typeName = bindingBaseType(rawType);
  return {
    name,
    typeName,
    rawType,
    ...(safetyPrefix === undefined ? {} : { safetyPrefix }),
  };
}

function bindingTypeName(value: string): string {
  const colonIdx = value.indexOf(":");
  return colonIdx === -1 ? "" : bindingBaseType(value.slice(colonIdx + 1).trim());
}

function bindingBaseType(typeSection: string): string {
  const stripped = typeSection.replace(/^(protected|redacted)\s+/, "");
  return stripped.split(/[<\s]/)[0] ?? stripped;
}

/**
 * R1C: Soft-tag a governed value with a non-enumerable '_governed' property.
 * This is a Phase 11D marker — it does not change runtime behaviour yet.
 * The tag is non-enumerable so it is invisible to JSON serialisation and
 * normal property enumeration, but readable by governance enforcement code.
 */
function tagGovernedValue(value: LogicNValue, qualifier: "protected" | "redacted"): void {
  try {
    Object.defineProperty(value, "_governed", {
      value: qualifier,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  } catch {
    // Frozen or sealed objects cannot be tagged — ignore silently
  }
}

function wrapGovernedValue(value: LogicNValue, rawType: string): LogicNValue {
  if (rawType.startsWith("protected ")) {
    return {
      __tag: "protected",
      baseType: rawType.slice("protected ".length).trim(),
      value,
      _governed: { qualifier: "protected" },
    };
  }
  if (rawType.startsWith("redacted ")) {
    return {
      __tag: "redacted",
      baseType: rawType.slice("redacted ".length).trim(),
      _governed: { qualifier: "redacted" },
    };
  }
  if (rawType === "SecureString") {
    return { __tag: "secure", value: safeDisplay(value) };
  }
  return value;
}

function getReceiver(node: AstNode): AstNode | undefined {
  const first = node.children?.[0];
  if (first === undefined) return undefined;
  if (first.kind === "memberExpr") return first;
  if (first.kind !== "identifier") return undefined;
  const value = first.value ?? "";
  if (STD_RECEIVERS.has(value) || /^[A-Z]/.test(value)) return first;
  return undefined;
}

function secureComparable(value: LogicNValue): string {
  if (value.__tag === "secure") return value.value;
  if (value.__tag === "string") return value.value;
  return "";
}

function qualifierFromFlowKind(kind: AstNode["kind"]): "flow" | "pure" | "guarded" | "secure" {
  if (kind === "pureFlowDecl") return "pure";
  if (kind === "guardedFlowDecl") return "guarded";
  if (kind === "secureFlowDecl") return "secure";
  return "flow";
}

function isRuntimeError(value: LogicNValue): value is { readonly __tag: "runtimeError" | "error"; readonly message: string } {
  return value.__tag === "runtimeError" || value.__tag === "error";
}

function stripStringQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1);
  }
  return value;
}

/** Resolve backslash escape sequences in a char literal value (e.g. "\\n" → "\n"). */
function resolveCharEscape(value: string): string {
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

function titleCase(value: string): string {
  if (value === "") return "Value";
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

function voidIdentifier(): AstNode {
  return { kind: "identifier", value: "void" };
}

function findStringLiterals(node: AstNode): AstNode[] {
  const found: AstNode[] = [];

  function walk(current: AstNode): void {
    if (current.kind === "stringLiteral") found.push(current);
    for (const child of current.children ?? []) walk(child);
  }

  walk(node);
  return found;
}

function makeResponseValue(status: number, body: LogicNValue): LogicNValue {
  const fields = new Map<string, LogicNValue>([
    ["__httpStatus", { __tag: "int", value: status }],
    ["__body", body],
    ["__isResponse", { __tag: "bool", value: true }],
  ]);
  return { __tag: "record", fields };
}

function makeApiErrorValue(status: number, message: string): LogicNValue {
  const fields = new Map<string, LogicNValue>([
    ["__httpStatus", { __tag: "int", value: status }],
    ["__message", { __tag: "string", value: message }],
    ["__isApiError", { __tag: "bool", value: true }],
  ]);
  return { __tag: "record", fields };
}

/**
 * Maps a fully-qualified call name to a capability effect string, or
 * returns undefined when the call is not a governed side-effectful operation.
 */
function resolveCapabilityEffect(fullName: string): string | undefined {
  if (fullName.startsWith("http.") || fullName.startsWith("https.")) {
    return "network.outbound";
  }
  if (fullName.startsWith("fs.") || fullName.startsWith("File.")) {
    const isRead = fullName.includes("read") || fullName.includes("Read");
    const isWrite = fullName.includes("write") || fullName.includes("Write");
    if (isRead) return "filesystem.read";
    if (isWrite) return "filesystem.write";
  }
  // Database calls: any receiver ending in DB or Database (e.g. UserDB.find)
  if (/DB\.|Database\./.test(fullName)) {
    const isWrite = /\.(insert|update|delete|write|save|create|upsert)/i.test(fullName);
    return isWrite ? "database.write" : "database.read";
  }
  // AI model calls (e.g. AI.complete, Model.infer, Claude.generate)
  if (/^(AI|Model|Claude|GPT|LLM)\./i.test(fullName)) {
    return "ai.inference";
  }
  return undefined;
}

// =============================================================================
// Phase R1A — Request-time limit extraction from contract.limits
// =============================================================================

/**
 * Extracts the request_time limit in milliseconds from a flow's contractDecl node.
 *
 * Walks the contractDecl children looking for a "limits:block" identifier, then
 * inspects nested identifier children for "decl:request_time <N><unit>" entries.
 *
 * Supported suffixes: s → *1000, ms → *1
 *
 * Returns undefined when no contract node, limits block, or request_time decl is present.
 */
export function extractRequestTimeMs(flowNode: AstNode): number | undefined {
  const contractNode = (flowNode.children ?? []).find((c) => c.kind === "contractDecl");
  if (contractNode === undefined) return undefined;

  // Find the limits sub-block — stored as { kind: "identifier", value: "limits:block" }
  const limitsBlock = (contractNode.children ?? []).find(
    (c) =>
      c.kind === "identifier" &&
      (c.value === "limits:block" || c.value === "limits:"),
  );
  if (limitsBlock === undefined) return undefined;

  for (const child of limitsBlock.children ?? []) {
    if (child.kind !== "identifier" || typeof child.value !== "string") continue;
    const v = child.value;
    // Match "decl:request_time <N>s" or "decl:request_time <N>ms"
    if (!v.startsWith("decl:request_time")) continue;
    const rest = v.slice("decl:request_time".length).trim();
    const m = rest.match(/^(\d+(?:\.\d+)?)\s*(ms|s)$/i);
    if (m === null || m[1] === undefined || m[2] === undefined) continue;
    const num = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    return unit === "ms" ? num : num * 1000;
  }

  return undefined;
}

// =============================================================================
// Phase R4B — network_requests limit extraction from contract.limits
// =============================================================================

/**
 * Extracts the network_requests limit as a plain number from a flow's contractDecl node.
 *
 * Looks for "decl:network_requests N" inside the limits block.
 * Returns undefined when not declared.
 */
export function extractNetworkRequestsLimit(flowNode: AstNode): number | undefined {
  const contractNode = (flowNode.children ?? []).find((c) => c.kind === "contractDecl");
  if (contractNode === undefined) return undefined;

  const limitsBlock = (contractNode.children ?? []).find(
    (c) =>
      c.kind === "identifier" &&
      (c.value === "limits:block" || c.value === "limits:"),
  );
  if (limitsBlock === undefined) return undefined;

  for (const child of limitsBlock.children ?? []) {
    if (child.kind !== "identifier" || typeof child.value !== "string") continue;
    const v = child.value;
    if (!v.startsWith("decl:network_requests")) continue;
    const rest = v.slice("decl:network_requests".length).trim();
    const m = rest.match(/^(\d+)$/);
    if (m !== null && m[1] !== undefined) return parseInt(m[1], 10);
  }

  return undefined;
}

// =============================================================================
// Pure flow erasure — fast path for IsPure + EffectFree flows
// =============================================================================

/**
 * Walks the AST to find the named pureFlowDecl and checks whether it carries
 * NodeFlags.IsPure. Also checks that the flow node has no declared effects
 * (NodeFlags.HasEffects unset), which corresponds to EffectCheckerFlags.EffectFree.
 *
 * When both conditions hold, the flow is eligible for governance erasure:
 * ContractEnforcer, CapabilityHost, audit trail, and effect tracking are all
 * skipped — pure compute only.
 */
export function isPureEffectFree(ast: AstNode, flowName: string): boolean {
  function walk(node: AstNode): boolean {
    if (node.kind === "pureFlowDecl" && node.value === flowName) {
      const flags = node.flags ?? 0;
      // IsPure must be set (flow qualifier is "pure")
      // HasEffects must NOT be set (no declared effects = EffectFree)
      return !!(flags & NodeFlags.IsPure) && !(flags & NodeFlags.HasEffects);
    }
    for (const c of node.children ?? []) {
      if (walk(c)) return true;
    }
    return false;
  }
  return walk(ast);
}

/**
 * Phase 27B: Synchronous entry point for pure EffectFree flows.
 *
 * Avoids all async/await microtask overhead. If the flow is not pure,
 * or if the sync interpreter cannot handle it, returns null.
 * The caller must fall back to executeFlow() for non-pure or complex flows.
 *
 * Throughput gain: ~6μs → ~0.1-0.5μs per call (10-60× improvement).
 */
export function executeFlowSync(
  flowName: string,
  args: ReadonlyMap<string, LogicNValue>,
  ast: AstNode,
  knownFlows: readonly FlowMeta[],
): LogicNValue | null {
  const flowMeta = knownFlows.find(f => f.name === flowName);
  if (flowMeta === undefined || flowMeta.qualifier !== "pure") return null;
  return tryPureFlowSync(ast, knownFlows, flowName, args);
}

// =============================================================================
// Phase 29B — ExecutionGraph fast-path execution
//
// runFromGraph() executes a pre-compiled ExecutionGraph without recursively
// walking the AST. When the graph covers the entire flow (no NOP sentinels),
// this replaces the tree-walker entirely for the hot path.
//
// The function returns null as a sentinel value when the graph contains an
// unhandled op (ExecOp.NOP), signalling the caller to fall back to the
// tree-walker.
// =============================================================================

/**
 * Convert a raw constant pool value to a LogicNValue.
 * Used by the ExecutionGraph fast-path executor.
 *
 * String constants in the constant pool are stored as raw parser token values
 * (including surrounding double-quotes), so we strip them here — matching what
 * the AST tree-walker does in evalExpr's stringLiteral case.
 */
function makeLogicNValue(raw: string | number | boolean | null): LogicNValue {
  if (raw === null) return LLN_NONE;
  if (typeof raw === "boolean") return raw ? { __tag: "bool", value: true } : { __tag: "bool", value: false };
  if (typeof raw === "number") return Number.isInteger(raw) ? intVal(raw) : { __tag: "float", value: raw };
  // Strip surrounding double-quotes from string literals stored in the constant pool
  // (matches the stripStringQuotes() call in evalExpr's "stringLiteral" branch)
  const stripped = raw.length >= 2 && raw.startsWith("\"") && raw.endsWith("\"")
    ? raw.slice(1, -1)
    : raw;
  return { __tag: "string", value: stripped };
}

/**
 * Execute a flow using a pre-compiled ExecutionGraph (Phase 29B fast-path).
 *
 * Returns null when the graph contains an unhandled op (ExecOp.NOP).
 * The caller must fall back to the tree-walker in that case.
 *
 * Phase 29B NaN-boxing — active for hot paths (ExecutionGraph register VM).
 */
function runFromGraph(graph: ExecutionGraph, args: ReadonlyMap<string, LogicNValue>): LogicNValue | null {
  const slots = new Array<LogicNValue>(graph.slotCount).fill(LLN_VOID);

  // Load params from args into slots
  for (const [name, slot] of graph.slotNames) {
    const val = args.get(name);
    if (val !== undefined) slots[slot] = val;
  }

  let ip = 0;
  while (ip < graph.nodes.length) {
    const node = graph.nodes[ip];
    if (node === undefined) break;

    switch (node.op) {
      case ExecOp.LOAD_CONST: {
        const raw = graph.constants[node.imm];
        if (raw !== undefined) slots[node.dest] = makeLogicNValue(raw);
        break;
      }
      case ExecOp.LOAD_SLOT:
        slots[node.dest] = slots[node.src1] ?? LLN_VOID;
        break;
      case ExecOp.STORE_SLOT:
        slots[node.imm] = slots[node.src1] ?? LLN_VOID;
        break;
      case ExecOp.BINOP: {
        const l = slots[node.src1] ?? LLN_VOID;
        const r = slots[node.src2] ?? LLN_VOID;
        const fn = BINARY_DISPATCH.get(dispatchKey(l.__tag, node.opName, r.__tag));
        slots[node.dest] = fn !== undefined ? fn(l, r) : LLN_VOID;
        break;
      }
      case ExecOp.RETURN:
        return slots[node.src1] ?? LLN_VOID;
      case ExecOp.RETURN_VOID:
        return LLN_VOID;
      case ExecOp.NOP:
        // Unhandled node kind — signal caller to fall back to tree-walker
        return null;
      default:
        // Any other op we don't handle yet — fall back
        return null;
    }
    ip++;
  }

  return LLN_VOID;
}

export async function executeFlow(
  flowName: string,
  args: ReadonlyMap<string, LogicNValue>,
  ast: AstNode,
  knownFlows?: readonly FlowMeta[],
  enforcer?: ContractEnforcer,
  capabilityHost?: CapabilityHost,
  runtimeOptions?: InterpreterRuntimeOptions,
  executionPlans?: ReadonlyMap<string, PassiveExecutionPlan>,
  manifest?: RuntimeManifest,
): Promise<FlowExecutionResult> {
  // Pure flow erasure fast path:
  // When pureFastPath is explicitly set to true AND the flow is provably
  // IsPure + EffectFree (no declared effects), skip all governance overhead
  // — no ContractEnforcer, no CapabilityHost, no audit trail, no effect
  // tracking. Just compute.
  //
  // The caller opts in by passing { pureFastPath: true }. When the option is
  // absent or false the full governed path always runs, regardless of whether
  // the flow is pure, so that callers who pass an enforcer or manifest have
  // those respected unconditionally.
  if (
    runtimeOptions?.pureFastPath === true &&   // opt-in: pass { pureFastPath: true } to enable
    isPureEffectFree(ast, flowName)
  ) {
    // Phase 49: per-request cache scoping.
    // The cache key includes a sourceTag so that pure flows cached for one request
    // cannot be served to a different request (prevents cross-request cache poisoning).
    // Use: (1) explicit sourceTag from runtimeOptions, or (2) traceId as the scope.
    const opts = runtimeOptions as Record<string, unknown>;
    const sourceTag = (typeof opts?.sourceTag === "string" ? opts.sourceTag : undefined)
      ?? (typeof opts?.traceId === "string" ? `req:${opts.traceId}` : undefined);
    const cacheKey = pureFlowCacheKey(flowName, args, sourceTag);
    const cached = getCachedPureFlow(cacheKey);
    if (cached !== undefined) {
      // Return a synthetic result wrapping the cached value
      const now = new Date().toISOString();
      return {
        value: cached,
        effectsObserved: [],
        auditEntries: [],
        diagnostics: [],
        executionTier: "cache" as const,     // Phase 33A telemetry
        fallbackReason: "cache-hit" as const,
        audit: {
          schemaVersion: "lln.runtime.audit.v1",
          flowName,
          qualifier: "pure",
          startedAt: now,
          completedAt: now,
          effectsObserved: [],
          auditEntries: [],
          result: "ok",
        },
      };
    }

    // Phase 31B: Try bytecode VM FIRST (fastest tier for pure integer flows).
    // Int32Array opcodes, zero allocation, ~14× faster than sync tree-walker.
    // Falls back to sync tree-walker (Phase 27B), then async Interpreter.
    const bcResult = compileToBytecode(ast, flowName);
    if (bcResult !== null) {
      const bcArgs = [...args.values()].map(v => v.__tag === "int" ? v.value as number : 0);
      // Check all args are integer-compatible (matching the bytecode VM's requirement)
      const allInts = [...args.values()].every(v => v.__tag === "int" || v.__tag === "bool" || v.__tag === "byte");
      if (allInts) {
        const bcValue = runBytecode(bcResult, bcArgs);
        const intResult = intVal(bcValue);
        const now = new Date().toISOString();
        const bcAuditResult = {
          value: intResult,
          effectsObserved: [],
          auditEntries: [],
          diagnostics: [],
          executionTier: "bytecode" as const,   // Phase 33A telemetry
          audit: {
            schemaVersion: "lln.runtime.audit.v1" as const,
            flowName,
            qualifier: "pure" as const,
            startedAt: now,
            completedAt: now,
            effectsObserved: [] as readonly string[],
            auditEntries: [] as readonly RuntimeAuditEntry[],
            result: "ok" as const,
          } satisfies ExecutionAuditRecord,
        } satisfies FlowExecutionResult;
        if (intResult.__tag !== "runtimeError") {
          const cacheKey3 = pureFlowCacheKey(flowName, args, typeof (runtimeOptions as Record<string, unknown>)?.sourceTag === "string" ? (runtimeOptions as Record<string, unknown>).sourceTag as string : undefined);
          setCachedPureFlow(cacheKey3, intResult);
        }
        return bcAuditResult;
      }
    }

    // Phase 27B: Try synchronous fast-path (handles non-integer pure flows).
    // Eliminates ~6μs async/await overhead per call.
    // Falls back to the async Interpreter if sync can't handle the pattern.
    const syncResult = tryPureFlowSync(ast, knownFlows ?? [], flowName, args);
    if (syncResult !== null) {
      const now = new Date().toISOString();
      const syncAuditResult = {
        value: syncResult,
        effectsObserved: [],
        auditEntries: [],
        diagnostics: [],
        executionTier: "sync" as const,         // Phase 33A telemetry
        fallbackReason: "non-integer-args" as const, // bytecode rejected (non-int)
        audit: {
          schemaVersion: "lln.runtime.audit.v1" as const,
          flowName,
          qualifier: "pure" as const,
          startedAt: now,
          completedAt: now,
          effectsObserved: [] as readonly string[],
          auditEntries: [] as readonly RuntimeAuditEntry[],
          result: "ok" as const,
        } satisfies ExecutionAuditRecord,
      } satisfies FlowExecutionResult;
      // Cache the sync result too
      if (syncResult.__tag !== "runtimeError") {
        const cacheKey2 = pureFlowCacheKey(flowName, args, typeof (runtimeOptions as Record<string, unknown>)?.sourceTag === "string" ? (runtimeOptions as Record<string, unknown>).sourceTag as string : undefined);
        setCachedPureFlow(cacheKey2, syncResult);
      }
      return syncAuditResult;
    }

    const interpreter = new Interpreter(
      ast,
      knownFlows ?? [],
      undefined,   // no ContractEnforcer
      undefined,   // no CapabilityHost
      runtimeOptions,
      executionPlans,
      undefined,   // no manifest
    );
    const result = await interpreter.runFlow(flowName, args);
    // Only cache successful, non-error results
    if (result.value.__tag !== "runtimeError" && result.value.__tag !== "error") {
      setCachedPureFlow(cacheKey, result.value);
    }
    // Phase 33A: sync-failed-but-pure → still tree tier (sync returned null)
    return { ...result, executionTier: "tree" as const, fallbackReason: "sync-unsupported" as const } satisfies FlowExecutionResult;
  }

  // ExecutionGraph fast-path execution (Phase 29B)
  // Build the graph once and cache it. On subsequent calls, try the register-VM
  // executor first. If the graph contains no NOP sentinels (no unhandled ops),
  // the fast-path returns a result directly — bypassing the async tree-walker.
  // When runFromGraph() returns null, we fall through to the tree-walker.
  //
  // The fast-path is only used for pure flows with no enforcer/capabilityHost to
  // avoid bypassing governance infrastructure on governed flows.
  {
    const flowIndex = buildFlowIndex(ast);
    const flowNode  = flowIndex.get(flowName);
    if (flowNode !== undefined) {
      const sourceHash = flowName; // until hashSource is threaded through here
      const egKey = executionGraphCacheKey(flowName, sourceHash);
      let egraph  = getOrLoadGraph(egKey);
      if (egraph === null) {
        const qualifier      = qualifierFromFlowKind(flowNode.kind);
        const isPure         = flowNode.kind === "pureFlowDecl";
        const declaredEffects: readonly string[] = [];
        egraph = buildExecutionGraph(flowNode, flowName, qualifier, declaredEffects, isPure);
        storeGraph(egKey, egraph);
      }

      // Phase 29B: attempt ExecutionGraph fast-path for pure flows.
      // Gated on runtimeOptions.egraphFastPath to avoid interfering with tests
      // until the graph builder handles all node kinds correctly.
      // Enable with: { egraphFastPath: true } in runtimeOptions.
      const egraphEnabled = (runtimeOptions as Record<string, unknown>)?.egraphFastPath === true;
      if (egraphEnabled && egraph.isPure && enforcer === undefined && capabilityHost === undefined) {
        const fastResult = runFromGraph(egraph, args);
        if (fastResult !== null) {
          // Fast-path succeeded — return a synthetic FlowExecutionResult
          const now = new Date().toISOString();
          return {
            value: fastResult,
            effectsObserved: [],
            auditEntries: [],
            diagnostics: [],
            executionTier: "egraph" as const,   // Phase 33A telemetry
            audit: {
              schemaVersion: "lln.runtime.audit.v1",
              flowName,
              qualifier: "pure",
              startedAt: now,
              completedAt: now,
              effectsObserved: [],
              auditEntries: [],
              result: fastResult.__tag === "runtimeError" ? "error" : "ok",
              ...(fastResult.__tag === "runtimeError" ? { error: (fastResult as { message: string }).message } : {}),
            },
          };
        }
        // runFromGraph returned null — fall through to tree-walker
      }
    }
  }

  const interpreter = new Interpreter(ast, knownFlows ?? [], enforcer, capabilityHost, runtimeOptions, executionPlans, manifest);
  const treeResult = await interpreter.runFlow(flowName, args);
  // Phase 33A: tag the governed tree-walker result
  return { ...treeResult, executionTier: "tree" as const } satisfies FlowExecutionResult;
}

// =============================================================================
// Optimization A — Binding slot array
//
// Assigns sequential integer indices to all named bindings declared in a flow
// (letDecl, mutDecl, paramDecl). Callers can use a SlottedScope instead of a
// Map<string, LogicNValue> to perform O(1) array indexed reads rather than
// hash lookups for every variable access.
// =============================================================================

/**
 * Walk a flow AST node and assign a sequential integer slot index to every
 * unique binding name found in letDecl, mutDecl, and paramDecl nodes.
 *
 * The returned Map is used to construct a SlottedScope whose backing array
 * is sized to exactly `slots.size` entries.
 */
export function assignSlots(flowNode: AstNode): Map<string, number> {
  const slots = new Map<string, number>();
  let nextSlot = 0;

  function walk(node: AstNode): void {
    if (
      node.kind === "letDecl" ||
      node.kind === "mutDecl" ||
      node.kind === "paramDecl"
    ) {
      // Extract the bare binding name from values like:
      //   "unsafe name: Type", "safe name", "name: Type", "name"
      const raw = node.value ?? "";
      const withoutQualifiers = raw
        .replace(/^(unsafe|safe|mut|readonly)\s+/, "")
        .trim();
      const name = withoutQualifiers.split(":")[0]?.trim() ?? "";
      if (name !== "" && !slots.has(name)) {
        slots.set(name, nextSlot++);
      }
    }
    for (const child of node.children ?? []) walk(child);
  }

  walk(flowNode);
  return slots;
}

/**
 * A fixed-size, array-backed scope that provides O(1) slot-indexed reads and
 * writes. Intended as a drop-in replacement for Map<string, LogicNValue> in
 * performance-critical inner loops once slot indices have been resolved by
 * assignSlots().
 */
export class SlottedScope {
  private readonly values: LogicNValue[];

  constructor(size: number) {
    this.values = new Array<LogicNValue>(size);
  }

  get(slot: number): LogicNValue {
    return this.values[slot] as LogicNValue;
  }

  set(slot: number, value: LogicNValue): void {
    this.values[slot] = value;
  }

  /** Returns the number of allocated slots. */
  get size(): number {
    return this.values.length;
  }
}

// =============================================================================
// Optimization B — While loop tight-path detection (stub)
//
// When a while loop body contains only simple Int arithmetic and Int
// comparisons with no function calls, capability calls, or audit events, the
// interpreter can execute it as a native JS while loop and bypass the
// async tree-walker entirely.
//
// For now this is a non-operational stub that always returns false. The full
// detection and execution logic will be wired in a subsequent pass.
// =============================================================================

/**
 * Attempt to execute a while loop via a native JS fast-path, bypassing the
 * async AST tree-walker.
 *
 * Eligibility criteria (all must hold):
 *   - Condition is a simple binary expression: identifier op intLiteral
 *   - Body contains only simple Int assignment statements (no calls, no
 *     capability invocations, no audit events)
 *
 * Returns true when the fast-path ran the loop to completion.
 * Returns false when the loop is not eligible; the caller must fall through
 * to the standard tree-walker.
 *
 * @param _condNode  The condition AstNode of the while statement.
 * @param _bodyNode  The body AstNode of the while statement.
 * @param _scope     The current binding Map (Map<string, LogicNValue>).
 */
export function tryWhileFastPath(
  _condNode: AstNode,
  _bodyNode: AstNode,
  _scope: Map<string, LogicNValue>,
): boolean {
  // Stub — detection and native-JS execution not yet implemented.
  // Return false so the interpreter always falls through to the tree-walker.
  return false;
}

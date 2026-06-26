/**
 * numeric-lowering.ts — shared numeric type/literal utilities for faithful 64-bit lowering.
 *
 * Two pure helpers consulted across the value-state gate, the interpreter, the WASM emitter, and the
 * type-checker so every tier agrees on (a) the BASE type of an annotation string and (b) the exact
 * bigint value + range edges of an integer LITERAL. Per the verified i64-lowering plan
 * (docs/Knowledge-Bases/logicn-i64-lowering-plan-verified-2026-06-25.md) Step 0: ONE `numericBaseType`
 * + ONE `parseI64Literal` feeding two tier-specific origination hooks, so the I64_MIN/I64_MAX literal
 * edges can never DIVERGE between tiers — a divergence is a silent 64→32 truncation fail-open (CWE-704),
 * exactly what `LLN-NUMERIC-001` gates against.
 *
 * NEVER parse an Int64 literal with `parseInt()` / `Number()` — they round above 2^53, which is the
 * precise fail-open. `BigInt` is exact across the whole i64 range.
 */
import { I64_MIN, I64_MAX } from "./i64-arith.js";
import { U64_MIN, U64_MAX } from "./u64-arith.js";
import { type AstNode } from "./parser.js";

/**
 * The scalar 64-bit widths the LLN-NUMERIC-001 GATE rejects: a value the *compile/admit* pipeline cannot
 * carry faithfully, so declaring one fails closed at check / build / governed-run (value-state-checker).
 *
 * Int64 has been LIFTED (owner-gated, 2026-06-25): the WASM emitter now lowers it faithfully (i64.const /
 * checked $lln_*_i64 / native i64.div_s|rem_s / i64 comparisons) and the tree-walker carries it as a
 * bigint — proven byte-exact, walker ≡ WASM, over the full (2^53,2^63) corpus (wat-i64-differential). So
 * the gate no longer rejects Int64; only UInt64 remains, because faithful *unsigned* 64-bit arithmetic
 * (u64 div/compare/overflow differ from the signed i64.* ops) has no layer yet. Int8/Int16 widen to i32
 * and Float32 widens to f64 (no value loss) — deliberately NOT here.
 *
 * DELIBERATELY SPLIT from FAST_TIER_UNLOWERABLE_SCALAR below: the two concerns diverged at the lift. The
 * GATE asks "can the pipeline as a whole carry this width?" The fast-tier bail asks "can the *i32-only* fast
 * tiers carry it?" (Int64/UInt64: NO — they would silently truncate). Folding them back into one set would
 * either re-gate the 64-bit types or let a fast tier truncate one — both fail-open.
 *
 * NOW EMPTY (UInt64 lifted, owner-authorized): the tree-walker carries UInt64 as a NON-NEGATIVE bigint via
 * the exact-trapping u64-arith layer (overflow/underflow/÷0 TRAP, no silent 2^64 wrap), and the fast tiers
 * still bail on it (it stays in FAST_TIER_UNLOWERABLE_SCALAR). Int64 was lifted earlier (0cb6190); both 64-bit
 * scalars now compile and run faithfully on the walker. A future i64/u64 WASM emitter would lower them too.
 */
export const BACKEND_UNLOWERABLE_SCALAR: ReadonlySet<string> = new Set([]);

/**
 * The scalar 64-bit widths the i32-only FAST execution tiers (bytecode VM, sync fast-path) cannot carry —
 * they store into a JS `number` / an Int32Array and would SILENTLY TRUNCATE 64→32 (CWE-704). A flow
 * declaring any of these (param, return, OR an internal `let y: Int64` the bytecode per-param check misses)
 * bails to the faithful tree-walker (which carries int64 as a bigint) / the i64-faithful WASM emitter.
 *
 * SUPERSET of the (now-empty) gate set above: it pins Int64 AND UInt64, neither of which is GATE-rejected
 * any longer (the walker lowers both faithfully via the exact bigint i64/u64 layers) but both are still
 * unsafe on the i32-only tiers. `flowDeclaresUnlowerable64` consults THIS set; the LLN-NUMERIC-001 gate
 * consults BACKEND_UNLOWERABLE_SCALAR. Invariant: anything the gate rejects must also be here (fast-tier
 * unsafe) — vacuously true now the gate is empty, but it must hold if a width is ever re-gated.
 */
// `Decimal` is here too (but NOT in the gate set — Decimal is a valid type, it must still compile): the
// fast i32-only tiers and the WASM f64 path cannot represent exact base-10 money, so a Decimal flow must
// bail to the tree-walker. Without this the WASM tier silently computed f64 money (0.1+0.2=0.30000…004).
export const FAST_TIER_UNLOWERABLE_SCALAR: ReadonlySet<string> = new Set(["Int64", "UInt64", "Decimal"]);

/**
 * Base type identifier from a type-annotation string: strips leading governance/safety qualifiers
 * and any generic/array suffix. "protected Int64"→"Int64", "Tensor<Int64,[4]>"→"Tensor", "Int64"→"Int64".
 * The EXACT base match is load-bearing: a generic position like `Tensor<Int64,[4]>` is an opaque i32
 * handle whose base is "Tensor" and must NOT be treated as a scalar Int64. A bare `=== "Int64"` compare
 * (the forbidden shortcut) would both miss `protected Int64` and mis-flag `Tensor<Int64>`.
 */
export function numericBaseType(typeSection: string): string {
  let s = typeSection.trim();
  for (const q of ["protected ", "redacted ", "unsafe ", "safe "]) {
    if (s.startsWith(q)) s = s.slice(q.length).trim();
  }
  const m = s.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
  return m?.[1] ?? "";
}

/** A parsed integer literal (exact bigint in i64 range) or a fail-closed reason. Callers MUST handle both arms. */
export type I64LiteralResult = bigint | "OutOfRange" | "NotIntegral";

export function isI64LiteralError(r: I64LiteralResult): r is "OutOfRange" | "NotIntegral" {
  return typeof r === "string";
}

/**
 * Parse an integer literal's RAW SOURCE TEXT to an exact bigint in [I64_MIN, I64_MAX], or a fail-closed
 * reason. Handles:
 *  - an optional leading sign — REQUIRED to accept I64_MIN = -2^63, whose magnitude 2^63 is itself ONE
 *    past the positive range (so the sign must be parsed here, not composed after a range check);
 *  - `_` digit-group separators;
 *  - `0x` / `0o` / `0b` radix prefixes (decimal otherwise).
 *
 * A fractional / scientific / otherwise non-integer form is "NotIntegral" (an Int64 slot rejects a Float
 * literal, fail-closed). A magnitude outside the i64 range is "OutOfRange". NEVER uses parseInt/Number.
 */
export function parseI64Literal(rawText: string): I64LiteralResult {
  let s = rawText.trim();
  if (s.length === 0) return "NotIntegral";
  // optional leading sign (parsed HERE so -9223372036854775808 = I64_MIN is accepted)
  let neg = false;
  if (s[0] === "+" || s[0] === "-") {
    neg = s[0] === "-";
    s = s.slice(1).trim();
  }
  // strip digit-group separators
  s = s.replace(/_/g, "");
  if (s.length === 0) return "NotIntegral";
  // a fractional / scientific form is not an integer literal (the hex guard avoids rejecting 0xE…)
  if (/[.eE]/.test(s) && !/^0[xX]/.test(s)) return "NotIntegral";
  let magnitude: bigint;
  try {
    if (/^0[xX][0-9a-fA-F]+$/.test(s)) magnitude = BigInt(s);
    else if (/^0[oO][0-7]+$/.test(s)) magnitude = BigInt(s);
    else if (/^0[bB][01]+$/.test(s)) magnitude = BigInt(s);
    else if (/^[0-9]+$/.test(s)) magnitude = BigInt(s);
    else return "NotIntegral";
  } catch {
    return "NotIntegral";
  }
  const value = neg ? -magnitude : magnitude;
  if (value < I64_MIN || value > I64_MAX) return "OutOfRange";
  return value;
}

/**
 * Parse an integer literal's RAW SOURCE TEXT to an exact bigint in [U64_MIN, U64_MAX] (UNSIGNED), or a
 * fail-closed reason. Mirrors parseI64Literal but unsigned: a leading '-' on a NONZERO magnitude is
 * "OutOfRange" (a negative cannot be a UInt64; '-0' is 0). Same `_` / `0x`/`0o`/`0b` handling; a
 * fractional/scientific form is "NotIntegral". NEVER uses parseInt/Number (the >2^53 precision fail-open).
 */
export function parseU64Literal(rawText: string): I64LiteralResult {
  let s = rawText.trim();
  if (s.length === 0) return "NotIntegral";
  let neg = false;
  if (s[0] === "+" || s[0] === "-") { neg = s[0] === "-"; s = s.slice(1).trim(); }
  s = s.replace(/_/g, "");
  if (s.length === 0) return "NotIntegral";
  if (/[.eE]/.test(s) && !/^0[xX]/.test(s)) return "NotIntegral";
  let magnitude: bigint;
  try {
    if (/^0[xX][0-9a-fA-F]+$/.test(s)) magnitude = BigInt(s);
    else if (/^0[oO][0-7]+$/.test(s)) magnitude = BigInt(s);
    else if (/^0[bB][01]+$/.test(s)) magnitude = BigInt(s);
    else if (/^[0-9]+$/.test(s)) magnitude = BigInt(s);
    else return "NotIntegral";
  } catch {
    return "NotIntegral";
  }
  if (neg && magnitude !== 0n) return "OutOfRange";       // unsigned: a negative literal is out of range
  if (magnitude < U64_MIN || magnitude > U64_MAX) return "OutOfRange";
  return magnitude;
}

const NUMERIC_BIND_KINDS: ReadonlySet<string> = new Set(["letDecl", "mutDecl", "readonlyDecl"]);

/** The base type of a `name: Type` binding-value string, after stripping a leading safety prefix. */
function bindingDeclaredBase(bindingValue: string): string {
  let rest = bindingValue;
  if (rest.startsWith("unsafe ")) rest = rest.slice("unsafe ".length).trim();
  else if (rest.startsWith("safe ")) rest = rest.slice("safe ".length).trim();
  const colon = rest.indexOf(":");
  return colon === -1 ? "" : numericBaseType(rest.slice(colon + 1));
}

/**
 * Does a flow DECLARE any unlowerable 64-bit scalar (param, return, or a binding anywhere in its body)?
 * The fast execution tiers (bytecode VM, sync fast-path) are i32-only and would SILENTLY TRUNCATE such a
 * value — so they bail on a `true` here and defer to the faithful tree-walker (which carries int64 as a
 * bigint). Consults `FAST_TIER_UNLOWERABLE_SCALAR` (NOT the LLN-NUMERIC-001 gate set): post-lift, Int64 is
 * admitted by the gate (WASM + walker lower it faithfully) yet STILL must bail off the i32-only fast tiers,
 * so the bail set is a superset of the gate set. Param Int64 already bails in the bytecode VM via its
 * INTEGER_TYPES check; this also catches an INTERNAL `let y: Int64` in an int-param flow (the
 * silent-truncation gap, the verified plan's R1) that the per-param check does NOT see.
 */
// Memoized per flow node — the result is pure over a stable AST, and this runs on the HOT sync fast-path
// entry (once per nested-flow call); an uncached per-call AST walk would regress tight call-chain loops.
const unlowerable64Cache = new WeakMap<AstNode, boolean>();

export function flowDeclaresUnlowerable64(flowNode: AstNode): boolean {
  const cached = unlowerable64Cache.get(flowNode);
  if (cached !== undefined) return cached;
  const result = scanFlowFor64(flowNode);
  unlowerable64Cache.set(flowNode, result);
  return result;
}

function scanFlowFor64(flowNode: AstNode): boolean {
  for (const c of flowNode.children ?? []) {
    // Return type = a direct typeRef child of the flow.
    if (c.kind === "typeRef" && typeof c.value === "string" && FAST_TIER_UNLOWERABLE_SCALAR.has(numericBaseType(c.value))) return true;
    // Param type = the typeRef nested in a paramDecl.
    if (c.kind === "paramDecl") {
      const tr = (c.children ?? []).find((t) => t.kind === "typeRef");
      if (typeof tr?.value === "string" && FAST_TIER_UNLOWERABLE_SCALAR.has(numericBaseType(tr.value))) return true;
    }
  }
  // Bindings anywhere in the body.
  let found = false;
  const visit = (n: AstNode | undefined): void => {
    if (n === undefined || found) return;
    if (NUMERIC_BIND_KINDS.has(n.kind) && typeof n.value === "string" && FAST_TIER_UNLOWERABLE_SCALAR.has(bindingDeclaredBase(n.value))) {
      found = true;
      return;
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(flowNode);
  return found;
}

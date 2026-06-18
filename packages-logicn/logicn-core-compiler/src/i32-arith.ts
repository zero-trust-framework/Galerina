/**
 * i32-arith.ts — strict-trapping 32-bit integer arithmetic: the SINGLE source of truth for
 * LogicN's integer overflow / divide-by-zero TRAP semantics.
 *
 * Owner decision 2026-06-18 (Fork A = TRAP): integer overflow must NEVER silently wrap. Native
 * WebAssembly `i32.add/sub/mul` wrap mod 2^32 (a lying abstraction in a governed system — an
 * overflow that wraps past a bounds check is a capability-gate exploit), so LogicN HARDENS the
 * WASM-i32 reference: every add/sub/mul that leaves [-2^31, 2^31-1], every divide/modulo by zero,
 * and the one signed-division overflow (INT32_MIN / -1 = 2^31) is a `LOAD → TRAP → ERASE` event.
 *
 * Every execution tier funnels through this ONE definition so they are byte-identical (the 0014
 * fidelity differential requires it): the tree-walker maps a trap to `runtimeError{message}`, the
 * bytecode VM throws (caught at the call site → the same `runtimeError`), and the WASM emitter's
 * checked-arithmetic helpers mirror these exact predicates. If this file changes, all three change.
 *
 * Inputs MUST already be i32 (the callers hold i32 operands). The `+`/`-` results are exact as JS
 * doubles (|a±b| < 2^32 < 2^53); `*` can reach 2^62 > 2^53, so the multiply check uses BigInt for
 * exactness — correctness over speed is the owner's mandated premium for absolute math safety.
 */

export const I32_MIN = -2147483648;
export const I32_MAX = 2147483647;

/** The two trap kinds. Surfaced as `runtimeError.message` (walker) or a thrown `Error.message` (VM). */
export type I32TrapKind = "IntegerOverflow" | "DivisionByZero";

/** A checked op returns the i32 result, or a trap-kind string when it must trap. */
export type I32Result = number | I32TrapKind;

export function isI32Trap(r: I32Result): r is I32TrapKind {
  return typeof r === "string";
}

// Every value return is normalized with `| 0` to canonical i32: identity for an in-range integer,
// but it maps JS `-0` (which `Math.trunc(-0.5)` and `-2^31 % -1` produce) to `0` — matching WASM's
// i32, which has no negative zero. Without it the walker would carry a `-0` that Object.is-diverges
// from WASM's `0`: a byte-level differential failure. (The range check runs first, so `| 0` only
// ever sees an already-in-range value and never itself wraps.)
export function i32AddChecked(a: number, b: number): I32Result {
  const r = a + b; // exact: |a+b| < 2^32 < 2^53
  return r < I32_MIN || r > I32_MAX ? "IntegerOverflow" : r | 0;
}

export function i32SubChecked(a: number, b: number): I32Result {
  const r = a - b;
  return r < I32_MIN || r > I32_MAX ? "IntegerOverflow" : r | 0;
}

export function i32MulChecked(a: number, b: number): I32Result {
  // Fast path: if |a| <= 46340 AND |b| <= 46340 then |a*b| <= 46340^2 = 2_147_395_600 < I32_MAX,
  // so the product is exact (< 2^53) and in-range — a plain multiply, no BigInt allocation. This
  // covers the overwhelming majority of real multiplies; only genuinely large operands take the
  // exact BigInt range-check below. (46341^2 = 2_147_488_281 > I32_MAX, so 46340 is the safe bound.)
  if (a >= -46340 && a <= 46340 && b >= -46340 && b <= 46340) return (a * b) | 0;
  // Slow path: operands large enough to possibly overflow i32 (product can reach 2^62 > 2^53) —
  // BigInt for an exact check. Same result/trap semantics as the fast path, just exact for big values.
  const p = BigInt(a) * BigInt(b);
  return p < -2147483648n || p > 2147483647n ? "IntegerOverflow" : Number(p) | 0;
}

export function i32DivChecked(a: number, b: number): I32Result {
  if (b === 0) return "DivisionByZero";
  if (a === I32_MIN && b === -1) return "IntegerOverflow"; // 2^31 overflows i32 (the one signed-div overflow)
  return Math.trunc(a / b) | 0;
}

export function i32ModChecked(a: number, b: number): I32Result {
  if (b === 0) return "DivisionByZero";
  return (a % b) | 0; // |a % b| < |b| <= I32_MAX — never overflows; `| 0` canonicalizes `-0` → `0`
}

/** Unary negation as 0 - x, so `-INT32_MIN` traps (it would overflow i32). */
export function i32NegChecked(a: number): I32Result {
  return i32SubChecked(0, a);
}

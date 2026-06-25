/**
 * decimal-arith.ts — EXACT base-10 fixed-point arithmetic for the `Decimal` type. Sibling of i64/u64-arith.
 *
 * Why this exists: `Decimal` is a STRING-backed value (`{ __tag: "decimal", value: "0.1" }`), chosen so a
 * monetary/tax amount is never an IEEE-754 double (`0.1 + 0.2 === 0.30000000000000004` is the classic
 * "wrong VAT"). But until now the interpreter had NO decimal arithmetic — `Decimal + Decimal` type-checked
 * as `Decimal` yet TRAPPED at runtime ("Operator '+' not supported for decimal"): a compile-passes /
 * runtime-traps mismatch. This layer makes `+ - *` EXACT by computing on BigInt unscaled integers (no
 * float ever touches a decimal), so 0.1 + 0.2 = "0.3", exactly.
 *
 * Representation: a decimal D = unscaled · 10^(−scale), with `unscaled: bigint` and `scale: number ≥ 0`.
 * "0.1" → (1, 1); "12.34" → (1234, 2); "-5" → (-5, 0). Add/sub align to the larger scale; multiply adds
 * scales. The result scale is a deterministic function of the inputs (no silent truncation, no rounding).
 *
 * Fail-closed: malformed input returns `"MalformedDecimal"` (never a guessed value). Division/modulo are
 * deliberately NOT here — exact decimal division is generally non-terminating (1/3) and needs an EXPLICIT
 * rounding policy + precision; offering it silently would re-introduce a lossy fail-open. Those ops stay
 * unsupported (fail-closed) until a rounding policy is designed. NOT for crypto/verdict (Decimal is a value
 * type, governance decisions stay on the K3 trit).
 */

export type DecTrapKind = "MalformedDecimal";
export type DecResult = string | DecTrapKind;
export type DecCompare = -1 | 0 | 1 | DecTrapKind;

export function isDecTrap(r: DecResult | DecCompare): r is DecTrapKind {
  return r === "MalformedDecimal";
}

interface Dec { readonly unscaled: bigint; readonly scale: number; }

/** Parse a canonical decimal string into (unscaled, scale). Returns null on any malformed input. */
function parseDecimal(s: string): Dec | null {
  if (typeof s !== "string") return null;
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s.trim());
  if (!m) return null;
  const sign = m[1] === "-" ? -1n : 1n;
  const intPart = m[2] ?? "";
  const fracPart = m[3] ?? "";
  if (intPart === "" && fracPart === "") return null; // "", ".", "+", "-" are not numbers
  const digits = intPart + fracPart;
  const unscaled = sign * BigInt(digits === "" ? "0" : digits);
  return { unscaled, scale: fracPart.length };
}

const TEN = 10n;
const pow10 = (n: number): bigint => TEN ** BigInt(n);

/** Format (unscaled, scale) back to a canonical decimal string. Preserves the computed scale (no stripping). */
function formatDecimal(unscaled: bigint, scale: number): string {
  const neg = unscaled < 0n;
  let digits = (neg ? -unscaled : unscaled).toString();
  if (scale === 0) return (neg ? "-" : "") + digits;
  while (digits.length <= scale) digits = "0" + digits; // ensure at least one integer digit
  const cut = digits.length - scale;
  const out = digits.slice(0, cut) + "." + digits.slice(cut);
  return (neg ? "-" : "") + out;
}

/** Align two decimals to a common (larger) scale, returning their unscaled values at that scale. */
function align(a: Dec, b: Dec): { ua: bigint; ub: bigint; scale: number } {
  const scale = Math.max(a.scale, b.scale);
  return {
    ua: a.unscaled * pow10(scale - a.scale),
    ub: b.unscaled * pow10(scale - b.scale),
    scale,
  };
}

export function decAdd(a: string, b: string): DecResult {
  const da = parseDecimal(a), db = parseDecimal(b);
  if (!da || !db) return "MalformedDecimal";
  const { ua, ub, scale } = align(da, db);
  return formatDecimal(ua + ub, scale);
}

export function decSub(a: string, b: string): DecResult {
  const da = parseDecimal(a), db = parseDecimal(b);
  if (!da || !db) return "MalformedDecimal";
  const { ua, ub, scale } = align(da, db);
  return formatDecimal(ua - ub, scale);
}

export function decMul(a: string, b: string): DecResult {
  const da = parseDecimal(a), db = parseDecimal(b);
  if (!da || !db) return "MalformedDecimal";
  return formatDecimal(da.unscaled * db.unscaled, da.scale + db.scale);
}

/** Compare by VALUE (not string): -1 if a<b, 0 if equal, 1 if a>b. "0.1" and "0.10" compare EQUAL. */
export function decCompare(a: string, b: string): DecCompare {
  const da = parseDecimal(a), db = parseDecimal(b);
  if (!da || !db) return "MalformedDecimal";
  const { ua, ub } = align(da, db);
  return ua < ub ? -1 : ua > ub ? 1 : 0;
}

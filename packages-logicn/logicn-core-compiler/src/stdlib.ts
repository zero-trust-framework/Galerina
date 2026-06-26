// =============================================================================
// LogicN Standard Library — Stage 1
//
// DECIMAL PRECISION NOTE (Stage 1):
//   Decimal arithmetic uses JavaScript parseFloat() internally.
//   This is NOT suitable for financial/money calculations requiring exact
//   decimal arithmetic. Money<C> * Decimal is marked experimental at this stage.
//
//   Stage 2 will replace with arbitrary-precision decimal arithmetic before
//   Money<C> arithmetic is considered production-valid.
//
//   Decision: docs/Knowledge-Bases/logicn-architecture-layers.md
// =============================================================================

import { LLN_NONE, LLN_VOID, type LogicNValue } from "./interpreter.js";
import { createHash as _nodeCryptoCreateHash, timingSafeEqual as _nodeCryptoTimingSafeEqual } from "node:crypto";
import { createRequire as _createRequire } from "node:module";
// SSRF egress protection — the hardened, deny-by-default outbound guard (normalizes numeric-IP /
// IPv4-in-IPv6 / CGNAT / *.corp bypasses + DNS-rebind recheck). Wiring the EXISTING guard rather than
// re-cloning the inline regex (self-audit 61-9). egress-guard is pure — no node/tower-citizen load.
import { guardOutboundUrl, guardResolvedAddresses } from "@logicn/core-network";
import bcrypt from "bcryptjs";  // Phase 34: real bcrypt ($2b$) for BCrypt.verify / BCrypt.hash
// Phase 36: Argon2id (OWASP preferred memory-hard KDF) — async, imported lazily
// to avoid startup cost when Password API is not used.
const _argon2Import = import("argon2") as Promise<{
  hash(plain: string, opts?: { type?: number }): Promise<string>;
  verify(hash: string, plain: string): Promise<boolean>;
  argon2id: number;
}>;
// Phase 33: segment-safe path helpers.
// Import resolve from node:path (named export works in TS); implement relative and
// isAbsolute inline to avoid TypeScript's ESM named-export limitation.
import { resolve as pathResolve } from "node:path";

function pathRelative(from: string, to: string): string {
  // Normalise separators (Windows backslash → forward slash)
  const f = from.replace(/\\/g, "/").replace(/\/$/, "");
  const t = to.replace(/\\/g, "/");
  if (t === f) return "";
  if (t.startsWith(f + "/")) return t.slice(f.length + 1);
  return "../" + t;  // simple escape detection (not full rel-path, just used for escape check)
}

function pathIsAbsolute(p: string): boolean {
  return /^(\/|[A-Za-z]:[/\\]|\\\\)/.test(p);
}
// process is globally available in Node.js — cast to any to access Node-specific methods
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _proc = process as any;

// =============================================================================
// BigInt-based decimal arithmetic helpers (Phase 9A-3)
//
// Replaces parseFloat() for Money and Decimal arithmetic to avoid IEEE-754
// rounding errors in financial calculations.
//
// Strategy: represent a decimal string as (scaled_bigint, scale) where
//   value = scaled_bigint / 10^scale
//
// e.g. "19.99" → { n: 1999n, scale: 2 }
//      "0.1"   → { n: 1n,    scale: 1 }
// =============================================================================

interface ScaledDecimal { n: bigint; scale: number }

function decimalToBigInt(s: string): ScaledDecimal {
  const clean = (s ?? "0").toString().trim().replace(/_/g, "");
  const neg = clean.startsWith("-");
  const abs = neg ? clean.slice(1) : clean;
  const dotIdx = abs.indexOf(".");
  if (dotIdx === -1) {
    const n = BigInt(abs || "0");
    return { n: neg ? -n : n, scale: 0 };
  }
  const intPart = abs.slice(0, dotIdx) || "0";
  const fracPart = abs.slice(dotIdx + 1);
  const combined = intPart + fracPart;
  const n = BigInt(combined || "0");
  return { n: neg ? -n : n, scale: fracPart.length };
}

function bigIntToDecimalStr(n: bigint, scale: number): string {
  if (scale === 0) return n.toString();
  const neg = n < BigInt(0);
  const abs = neg ? -n : n;
  const str = abs.toString().padStart(scale + 1, "0");
  const intPart = str.slice(0, str.length - scale) || "0";
  const fracPart = str.slice(str.length - scale);
  const result = `${intPart}.${fracPart}`;
  return neg ? `-${result}` : result;
}

/** Normalise two ScaledDecimals to the same scale. */
function alignScale(a: ScaledDecimal, b: ScaledDecimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  const ten = BigInt(10);
  const na = a.n * (ten ** BigInt(scale - a.scale));
  const nb = b.n * (ten ** BigInt(scale - b.scale));
  return [na, nb, scale];
}

export function bigIntDecimalAdd(a: string, b: string): string {
  const [na, nb, scale] = alignScale(decimalToBigInt(a), decimalToBigInt(b));
  return bigIntToDecimalStr(na + nb, scale);
}

export function bigIntDecimalSub(a: string, b: string): string {
  const [na, nb, scale] = alignScale(decimalToBigInt(a), decimalToBigInt(b));
  return bigIntToDecimalStr(na - nb, scale);
}

export function bigIntDecimalCmp(a: string, b: string): number {
  const [na, nb] = alignScale(decimalToBigInt(a), decimalToBigInt(b));
  return na < nb ? -1 : na > nb ? 1 : 0;
}

/** Multiply a decimal string by a JavaScript number (for rate/factor scaling). */
export function bigIntDecimalMulNumber(a: string, factor: number): string {
  // Convert factor to a decimal string, then use BigInt multiply
  // Use toFixed(10) for precision, then trim trailing zeros
  const factorStr = factor.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  const pa = decimalToBigInt(a);
  const pf = decimalToBigInt(factorStr);
  const scale = pa.scale + pf.scale;
  return bigIntToDecimalStr(pa.n * pf.n, scale);
}

/** Round a decimal string to N decimal places. */
export function bigIntDecimalRound(a: string, places: number): string {
  const pa = decimalToBigInt(a);
  if (pa.scale <= places) {
    // Already has fewer decimal places than requested — just pad
    return bigIntToDecimalStr(pa.n * (BigInt(10) ** BigInt(places - pa.scale)), places);
  }
  const diff = pa.scale - places;
  const ten = BigInt(10);
  const divisor = ten ** BigInt(diff);
  // Round half-up
  const abs = pa.n < BigInt(0) ? -pa.n : pa.n;
  const half = divisor / BigInt(2);
  const rounded = (abs + half) / divisor;
  const result = pa.n < BigInt(0) ? -rounded : rounded;
  return bigIntToDecimalStr(result, places);
}

// The dist is ESM ("type":"module"), where the CommonJS `require` is NOT defined at runtime. Several node:
// builtins are pulled in lazily via require() (node:crypto, node:dns/promises, node:url) — without a real
// require they throw "require is not defined" the moment that path runs (latent until the SSRF redirect-hop
// re-guard exercised node:url). createRequire(import.meta.url) gives a working require for ALL of them.
const require = _createRequire(import.meta.url);
declare const process: { env?: Record<string, string | undefined> };

export interface StdlibContext {
  readonly recordEffect: (effect: string) => void;
  readonly resolveIdentifier: (name: string) => LogicNValue | undefined;
  readonly callFlow: (name: string, args: ReadonlyMap<string, LogicNValue>) => Promise<LogicNValue>;
  readonly applyFn: (fn: LogicNValue, arg: LogicNValue) => Promise<LogicNValue>;
}

function safeDisplay(v: LogicNValue): string {
  switch (v.__tag) {
    case "string":
    case "char":
    case "decimal":
      return v.value;
    case "int":
    case "int64":
    case "uint64":
    case "float":
    case "byte":
      return String(v.value);
    case "bool":
      return v.value ? "true" : "false";
    case "bytes":
      return `[${v.value.byteLength} bytes]`;
    case "none":
      return "None";
    case "void":
      return "()";
    case "secure":
      return "[SECURE]";
    case "protected":
      return "[PROTECTED]";
    case "redacted":
      return "[REDACTED]";
    case "some":
      return `Some(${safeDisplay(v.value)})`;
    case "ok":
      return `Ok(${safeDisplay(v.value)})`;
    case "err":
      return `Err(${safeDisplay(v.error)})`;
    case "record":
      return "{...}";
    case "list":
      return `[${v.items.map((item) => safeDisplay(item)).join(", ")}]`;
    case "unresolved":
      return v.name;
    case "runtimeError":
    case "error":
      return v.message;
    case "function":
      return v.name;
  }
}

function strVal(v: LogicNValue): string {
  return v.__tag === "string" ? v.value : safeDisplay(v);
}

function numVal(v: LogicNValue): number {
  return v.__tag === "int" || v.__tag === "float" ? v.value : 0;
}

/**
 * Float constructor for stdlib minters that can produce a NON-FINITE result — Math.sqrt(-1)→NaN,
 * Math.log(0)→-Inf, Math.pow overflow→+Inf, an empty-list stddev / all-(-Inf) softmax→NaN. A non-finite
 * float must NOT escape as a value: it passes EVERY range guard (every NaN comparison is false) and could be
 * signed into a manifest. Returns a fail-closed trap (NonFiniteFloat / LLN-FLOAT-NAN-001) that the tree-walker
 * propagates exactly like 0.0/0.0. Mirrors interpreter.ts mkFloat. (#55.)
 */
function floatVal(n: number): LogicNValue {
  return Number.isFinite(n) ? { __tag: "float", value: n } : { __tag: "runtimeError", message: "NonFiniteFloat" };
}

function asList(v: LogicNValue): readonly LogicNValue[] {
  return v.__tag === "list" ? v.items : [];
}

/**
 * SECURITY (Finding 8): Validate a regex pattern before compiling it from runtime input.
 * Returns an error string if the pattern is dangerous, null if safe.
 *
 * Limits:
 *   - Max 500 characters (prevents huge patterns)
 *   - Blocks known catastrophic patterns: nested quantifiers (a+)+, {n,m} in groups
 *   - Blocks character class explosions: [^...]{n,}
 *   - Does NOT block all ReDoS — that requires a full automata analysis.
 *     For full safety, use Regex.escapeLiteral() for user input → LITERAL matching.
 */
function validateRegexPattern(pattern: string): string | null {
  if (pattern.length > 500) {
    return "RegexError: pattern exceeds maximum length (500 chars) — ReDoS prevention";
  }
  // Detect common catastrophic backtracking patterns
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) {
    return "RegexError: nested quantifier detected (e.g. (a+)+ ) — ReDoS prevention";
  }
  return null;
}

function ok(value: LogicNValue): LogicNValue {
  return { __tag: "ok", value };
}

function err(message: string): LogicNValue {
  return { __tag: "err", error: { __tag: "string", value: message } };
}

function mkSome(v: LogicNValue): LogicNValue {
  return { __tag: "some", value: v };
}

async function optionMethod(
  receiver: LogicNValue,
  method: string,
  args: readonly LogicNValue[],
  ctx: StdlibContext,
): Promise<LogicNValue | undefined> {
  if (receiver.__tag !== "some" && receiver.__tag !== "none") return undefined;
  switch (method) {
    case "unwrapOr":
      return receiver.__tag === "some" ? receiver.value : (args[0] ?? LLN_VOID);
    case "isSome":
      return { __tag: "bool", value: receiver.__tag === "some" };
    case "isNone":
      return { __tag: "bool", value: receiver.__tag === "none" };
    case "map":
      if (receiver.__tag === "none") return LLN_NONE;
      return args[0] !== undefined ? mkSome(await ctx.applyFn(args[0], receiver.value)) : LLN_NONE;
    case "flatMap":
      if (receiver.__tag === "none") return LLN_NONE;
      return args[0] !== undefined ? await ctx.applyFn(args[0], receiver.value) : LLN_NONE;
    case "value":
    case "get":
      return receiver.__tag === "some" ? receiver.value : LLN_NONE;
    default:
      return undefined;
  }
}

async function resultMethod(
  receiver: LogicNValue,
  method: string,
  args: readonly LogicNValue[],
  ctx: StdlibContext,
): Promise<LogicNValue | undefined> {
  if (receiver.__tag !== "ok" && receiver.__tag !== "err") return undefined;
  switch (method) {
    case "unwrapOr":
      return receiver.__tag === "ok" ? receiver.value : (args[0] ?? LLN_VOID);
    case "isOk":
      return { __tag: "bool", value: receiver.__tag === "ok" };
    case "isErr":
      return { __tag: "bool", value: receiver.__tag === "err" };
    case "map":
      if (receiver.__tag === "err") return receiver;
      return args[0] !== undefined ? ok(await ctx.applyFn(args[0], receiver.value)) : receiver;
    case "mapErr":
      if (receiver.__tag === "ok") return receiver;
      return args[0] !== undefined ? { __tag: "err", error: await ctx.applyFn(args[0], receiver.error) } : receiver;
    case "value":
    case "get":
      return receiver.__tag === "ok" ? mkSome(receiver.value) : LLN_NONE;
    default:
      return undefined;
  }
}

function stringMethod(receiver: LogicNValue, method: string, args: readonly LogicNValue[]): LogicNValue | undefined {
  if (receiver.__tag !== "string") return undefined;
  const s = receiver.value;
  switch (method) {
    case "length":
    case "charCount":
      return { __tag: "int", value: [...s].length };
    case "toLower":
      return { __tag: "string", value: s.toLowerCase() };
    case "toUpper":
      return { __tag: "string", value: s.toUpperCase() };
    case "trim":
      return { __tag: "string", value: s.trim() };
    case "trimStart":
      return { __tag: "string", value: s.trimStart() };
    case "trimEnd":
      return { __tag: "string", value: s.trimEnd() };
    case "toString":
      return receiver;
    case "isEmpty":
      return { __tag: "bool", value: s.length === 0 };
    case "startsWith":
      return { __tag: "bool", value: s.startsWith(strVal(args[0] ?? LLN_VOID)) };
    case "endsWith":
      return { __tag: "bool", value: s.endsWith(strVal(args[0] ?? LLN_VOID)) };
    case "contains":
    case "includes":
      return { __tag: "bool", value: s.includes(strVal(args[0] ?? LLN_VOID)) };
    case "split":
      return {
        __tag: "list",
        items: s.split(strVal(args[0] ?? { __tag: "string", value: "" })).map((p): LogicNValue => ({ __tag: "string", value: p })),
      };
    case "replace":
      return { __tag: "string", value: s.replace(strVal(args[0] ?? LLN_VOID), strVal(args[1] ?? { __tag: "string", value: "" })) };
    case "replaceAll":
      return { __tag: "string", value: s.replaceAll(strVal(args[0] ?? LLN_VOID), strVal(args[1] ?? { __tag: "string", value: "" })) };
    case "slice": {
      const start = numVal(args[0] ?? { __tag: "int", value: 0 });
      const end = args[1] !== undefined ? numVal(args[1]) : undefined;
      return { __tag: "string", value: end === undefined ? s.slice(start) : s.slice(start, end) };
    }
    case "encode":
      return { __tag: "bytes", value: new TextEncoder().encode(s) };
    case "encodedLength":
      return { __tag: "int", value: new TextEncoder().encode(s).length };
    case "codePoints":
      return { __tag: "list", items: [...s].map((c): LogicNValue => ({ __tag: "int", value: c.codePointAt(0) ?? 0 })) };
    case "toChars":
      return { __tag: "list", items: [...s].map((c): LogicNValue => ({ __tag: "char", value: c })) };
    case "charAt": {
      const idx = numVal(args[0] ?? { __tag: "int", value: 0 });
      const ch = [...s][idx];
      return ch !== undefined ? mkSome({ __tag: "char", value: ch }) : LLN_NONE;
    }
    case "indexOf":
      return { __tag: "int", value: s.indexOf(strVal(args[0] ?? LLN_VOID)) };
    case "lastIndexOf":
      return { __tag: "int", value: s.lastIndexOf(strVal(args[0] ?? LLN_VOID)) };
    case "padStart": {
      const len = numVal(args[0] ?? { __tag: "int", value: 0 });
      const pad = args[1]?.__tag === "string" ? args[1].value : " ";
      return { __tag: "string", value: s.padStart(len, pad) };
    }
    case "padEnd": {
      const len = numVal(args[0] ?? { __tag: "int", value: 0 });
      const pad = args[1]?.__tag === "string" ? args[1].value : " ";
      return { __tag: "string", value: s.padEnd(len, pad) };
    }
    case "repeat": {
      const n = Math.max(0, numVal(args[0] ?? { __tag: "int", value: 0 }));
      return { __tag: "string", value: s.repeat(n) };
    }
    case "toInt": {
      const n = parseInt(s, 10);
      return isNaN(n) ? err("ParseError: not a valid integer") : ok({ __tag: "int", value: n });
    }
    case "toFloat": {
      const n = parseFloat(s);
      // #55: reject NON-finite too — parseFloat("Infinity")/"1e400" → ±Inf, which isNaN() lets through.
      return !Number.isFinite(n) ? err("ParseError: not a valid finite float") : ok({ __tag: "float", value: n });
    }
    case "toDecimal": {
      const n = parseFloat(s);
      return !Number.isFinite(n) ? err("ParseError: not a valid decimal") : ok({ __tag: "decimal", value: s });
    }

    case "matchesPattern": {
      const pattern = strVal(args[0] ?? { __tag: "string", value: "" });
      // SECURITY (Finding 8 — MEDIUM): ReDoS via dynamic regex from runtime input.
      // Apply pattern length + complexity limits before compiling.
      const regexErr = validateRegexPattern(pattern);
      if (regexErr !== null) return err(regexErr);
      try {
        return { __tag: "bool", value: new RegExp(pattern).test(s) };
      } catch {
        return err(`RegexError: invalid pattern`);
      }
    }

    case "extractGroups": {
      const pattern = strVal(args[0] ?? { __tag: "string", value: "" });
      const regexErr2 = validateRegexPattern(pattern);
      if (regexErr2 !== null) return err(regexErr2);
      try {
        const match = new RegExp(pattern).exec(s);
        if (!match) return { __tag: "list", items: [] };
        const groups = match.slice(1).map((g): LogicNValue =>
          g === undefined ? LLN_NONE : { __tag: "string", value: g }
        );
        return { __tag: "list", items: groups };
      } catch {
        return err(`RegexError: invalid pattern`);
      }
    }

    case "replacePattern": {
      const pattern = strVal(args[0] ?? { __tag: "string", value: "" });
      const replacement = strVal(args[1] ?? { __tag: "string", value: "" });
      const regexErr3 = validateRegexPattern(pattern);
      if (regexErr3 !== null) return err(regexErr3);
      try {
        return { __tag: "string", value: s.replace(new RegExp(pattern, "g"), replacement) };
      } catch {
        return err(`RegexError: invalid pattern`);
      }
    }

    // Phase 9A-3: named interpolation — "Hello {name}".format({ name: "World" })
    // Also supports positional "Hello {}".format("World", ...) as fallback.
    case "format": {
      const firstArg = args[0];
      if (firstArg?.__tag === "record") {
        // Named interpolation: replace {fieldName} with the record's field value
        let result = s;
        for (const [key, val] of firstArg.fields) {
          if (key.startsWith("__")) continue; // skip internal bookkeeping fields
          result = result.replaceAll(`{${key}}`, safeDisplay(val));
        }
        return { __tag: "string", value: result };
      }
      // Positional interpolation: replace {} in left-to-right order
      let result = s;
      for (const arg of args) {
        result = result.replace("{}", safeDisplay(arg));
      }
      return { __tag: "string", value: result };
    }

    default:
      return undefined;
  }
}

function stringStaticMethod(method: string, args: readonly LogicNValue[]): LogicNValue | undefined {
  if (method === "fromChar") {
    const ch = args[0];
    if (ch?.__tag === "char") return { __tag: "string", value: ch.value };
    return { __tag: "string", value: strVal(ch ?? LLN_VOID) };
  }
  if (method === "fromChars") {
    const chars = asList(args[0] ?? LLN_VOID);
    const s = chars.map((c) => c.__tag === "char" ? c.value : strVal(c)).join("");
    return { __tag: "string", value: s };
  }
  if (method === "repeat") {
    const s = strVal(args[0] ?? LLN_VOID);
    const n = Math.max(0, numVal(args[1] ?? { __tag: "int", value: 0 }));
    return { __tag: "string", value: s.repeat(n) };
  }
  if (method !== "decode") return undefined;
  const input = args[0];
  if (input === undefined) return err("DecodeError: no input provided");
  if (input.__tag === "string") return ok(input);
  if (input.__tag === "bytes") {
    try {
      return ok({ __tag: "string", value: new TextDecoder("utf-8", { fatal: true }).decode(input.value) });
    } catch {
      return err("DecodeError: invalid UTF-8 sequence");
    }
  }
  return err("DecodeError: expected Bytes");
}

async function listMethod(
  receiver: LogicNValue,
  method: string,
  args: readonly LogicNValue[],
  ctx: StdlibContext,
): Promise<LogicNValue | undefined> {
  if (receiver.__tag !== "list") return undefined;
  const items = receiver.items;
  switch (method) {
    case "length":
    case "count":
      return { __tag: "int", value: items.length };
    case "isEmpty":
      return { __tag: "bool", value: items.length === 0 };
    case "first":
      return items.length > 0 ? mkSome(items[0] ?? LLN_VOID) : LLN_NONE;
    case "last":
      return items.length > 0 ? mkSome(items[items.length - 1] ?? LLN_VOID) : LLN_NONE;
    case "get": {
      const idx = numVal(args[0] ?? { __tag: "int", value: -1 });
      const item = items[idx];
      return item === undefined ? LLN_NONE : mkSome(item);
    }
    case "push":
    case "append":
      return { __tag: "list", items: [...items, args[0] ?? LLN_VOID] };
    case "filter": {
      const fn = args[0];
      if (fn === undefined) return receiver;
      const filtered: LogicNValue[] = [];
      for (const item of items) {
        const result = await ctx.applyFn(fn, item);
        if (result.__tag === "bool" && result.value) filtered.push(item);
      }
      return { __tag: "list", items: filtered };
    }
    case "map": {
      const fn = args[0];
      if (fn === undefined) return receiver;
      const mapped: LogicNValue[] = [];
      for (const item of items) mapped.push(await ctx.applyFn(fn, item));
      return { __tag: "list", items: mapped };
    }
    case "reduce": {
      const init = args[0] ?? LLN_VOID;
      const fn = args[1];
      if (fn === undefined) return init;
      let acc = init;
      for (const item of items) {
        acc = await ctx.applyFn(fn, {
          __tag: "record",
          fields: new Map<string, LogicNValue>([["acc", acc], ["item", item]]),
        });
      }
      return acc;
    }
    case "sum": {
      if (items.length === 0) return { __tag: "int", value: 0 };
      const isFloat = items.some((i) => i.__tag === "float");
      const total = items.reduce((acc, item) => acc + numVal(item), 0);
      return isFloat ? { __tag: "float", value: total } : { __tag: "int", value: total };
    }
    case "contains":
      return { __tag: "bool", value: items.some((item) => logicNValuesEqual(item, args[0] ?? LLN_VOID)) };
    case "reverse":
      return { __tag: "list", items: [...items].reverse() };
    case "slice": {
      const start = numVal(args[0] ?? { __tag: "int", value: 0 });
      const end = args[1] !== undefined ? numVal(args[1]) : undefined;
      return { __tag: "list", items: end === undefined ? items.slice(start) : items.slice(start, end) };
    }
    case "join":
      return { __tag: "string", value: items.map((i) => strVal(i)).join(strVal(args[0] ?? { __tag: "string", value: "" })) };
    case "find": {
      const fn = args[0];
      if (fn === undefined) return LLN_NONE;
      for (const item of items) {
        const result = await ctx.applyFn(fn, item);
        if (result.__tag === "bool" && result.value) return mkSome(item);
      }
      return LLN_NONE;
    }
    case "toList":
    case "toArray":
      return receiver;

    case "take":
      return { __tag: "list", items: items.slice(0, numVal(args[0] ?? { __tag: "int", value: 0 })) };
    case "drop":
      return { __tag: "list", items: items.slice(numVal(args[0] ?? { __tag: "int", value: 0 })) };

    case "flatMap": {
      const fn = args[0];
      if (fn === undefined) return receiver;
      const flat: LogicNValue[] = [];
      for (const item of items) {
        const r = await ctx.applyFn(fn, item);
        if (r.__tag === "list") flat.push(...r.items);
        else flat.push(r);
      }
      return { __tag: "list", items: flat };
    }

    case "zip": {
      const other = asList(args[0] ?? LLN_VOID);
      const len = Math.min(items.length, other.length);
      const zipped = Array.from({ length: len }, (_, i): LogicNValue => {
        const fields = new Map<string, LogicNValue>([
          ["first",  items[i]!],
          ["second", other[i]!],
        ]);
        return { __tag: "record", fields };
      });
      return { __tag: "list", items: zipped };
    }

    case "sortBy": {
      const fn = args[0];
      if (fn === undefined) return receiver;
      // For sortBy, we need to resolve keys first then sort
      const withKeys = await Promise.all(items.map(async (item) => ({ item, key: await ctx.applyFn(fn, item) })));
      withKeys.sort((a, b) => numVal(a.key) - numVal(b.key));
      return { __tag: "list", items: withKeys.map((e) => e.item) };
    }

    case "sort": {
      const sorted = [...items].sort((a, b) => {
        if (a.__tag === "string" && b.__tag === "string") return a.value.localeCompare(b.value);
        return numVal(a) - numVal(b);
      });
      return { __tag: "list", items: sorted };
    }

    case "min": {
      if (items.length === 0) return LLN_NONE;
      const m = items.reduce((a, b) => numVal(a) < numVal(b) ? a : b);
      return mkSome(m);
    }
    case "max": {
      if (items.length === 0) return LLN_NONE;
      const m = items.reduce((a, b) => numVal(a) > numVal(b) ? a : b);
      return mkSome(m);
    }

    case "count": {
      const fn = args[0];
      if (fn === undefined) return { __tag: "int", value: items.length };
      let c = 0;
      for (const i of items) {
        const r = await ctx.applyFn(fn, i);
        if (r.__tag === "bool" && r.value) c += 1;
      }
      return { __tag: "int", value: c };
    }

    case "distinct":
    case "unique": {
      const seen = new Set<string>();
      const unique = items.filter((i) => {
        const k = JSON.stringify(i);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return { __tag: "list", items: unique };
    }

    case "groupBy": {
      const fn = args[0];
      if (fn === undefined) return receiver;
      const groups = new Map<string, LogicNValue[]>();
      for (const item of items) {
        const key = strVal(await ctx.applyFn(fn, item));
        const g = groups.get(key) ?? [];
        g.push(item);
        groups.set(key, g);
      }
      const fields = new Map<string, LogicNValue>();
      for (const [k, v] of groups) fields.set(k, { __tag: "list", items: v });
      return { __tag: "record", fields };
    }

    case "chunk": {
      const size = Math.max(1, numVal(args[0] ?? { __tag: "int", value: 1 }));
      const chunks: LogicNValue[] = [];
      for (let i = 0; i < items.length; i += size) {
        chunks.push({ __tag: "list", items: items.slice(i, i + size) });
      }
      return { __tag: "list", items: chunks };
    }

    case "flatten": {
      const flat: LogicNValue[] = [];
      for (const item of items) {
        if (item.__tag === "list") flat.push(...item.items);
        else flat.push(item);
      }
      return { __tag: "list", items: flat };
    }

    case "partition": {
      const fn = args[0];
      if (fn === undefined) return { __tag: "list", items: [receiver, { __tag: "list", items: [] }] };
      const passing: LogicNValue[] = [];
      const failing: LogicNValue[] = [];
      for (const item of items) {
        const result = await ctx.applyFn(fn, item);
        if (result.__tag === "bool" && result.value) passing.push(item);
        else failing.push(item);
      }
      return { __tag: "list", items: [{ __tag: "list", items: passing }, { __tag: "list", items: failing }] };
    }

    case "tally": {
      const counts = new Map<string, number>();
      const originals = new Map<string, LogicNValue>();
      for (const item of items) {
        const k = JSON.stringify(item);
        counts.set(k, (counts.get(k) ?? 0) + 1);
        originals.set(k, item);
      }
      const fields = new Map<string, LogicNValue>();
      for (const [k, count] of counts) {
        const orig = originals.get(k)!;
        const displayKey = strVal(orig);
        fields.set(displayKey, { __tag: "int", value: count });
      }
      return { __tag: "record", fields };
    }

    case "average": {
      if (items.length === 0) return err("average: empty list");
      const total = items.reduce((acc, item) => acc + numVal(item), 0);
      return { __tag: "float", value: total / items.length };
    }

    case "median": {
      if (items.length === 0) return err("median: empty list");
      const sorted = [...items].sort((a, b) => numVal(a) - numVal(b));
      const mid = Math.floor(sorted.length / 2);
      if (sorted.length % 2 === 1) {
        return sorted[mid]!;
      }
      const lo = numVal(sorted[mid - 1]!);
      const hi = numVal(sorted[mid]!);
      return { __tag: "float", value: (lo + hi) / 2 };
    }

    default:
      return undefined;
  }
}

function isSpecialRecord(v: LogicNValue): boolean {
  if (v.__tag !== "record") return false;
  const f = v.fields;
  return (f.get("__isSet") as { __tag: string; value: boolean } | undefined)?.value === true
    || (f.get("__isTimestamp") as { __tag: string; value: boolean } | undefined)?.value === true
    || (f.get("__isDuration") as { __tag: string; value: boolean } | undefined)?.value === true
    || (f.get("__isMoney") as { __tag: string; value: boolean } | undefined)?.value === true;
}

async function mapMethod(
  receiver: LogicNValue,
  method: string,
  args: readonly LogicNValue[],
  ctx: StdlibContext,
): Promise<LogicNValue | undefined> {
  if (receiver.__tag !== "record") return undefined;
  if (isSpecialRecord(receiver)) return undefined;
  const fields = receiver.fields;
  switch (method) {
    case "get": {
      const key = strVal(args[0] ?? LLN_VOID);
      const value = fields.get(key);
      return value === undefined ? LLN_NONE : mkSome(value);
    }
    case "set": {
      const updated = new Map(fields);
      updated.set(strVal(args[0] ?? LLN_VOID), args[1] ?? LLN_VOID);
      return { __tag: "record", fields: updated };
    }
    case "has":
      return { __tag: "bool", value: fields.has(strVal(args[0] ?? LLN_VOID)) };
    case "size":
    case "length":
      return { __tag: "int", value: fields.size };
    case "isEmpty":
      return { __tag: "bool", value: fields.size === 0 };
    case "keys":
      return { __tag: "list", items: [...fields.keys()].map((k): LogicNValue => ({ __tag: "string", value: k })) };
    case "values":
      return { __tag: "list", items: [...fields.values()] };
    case "delete":
    case "remove": {
      const updated = new Map(fields);
      updated.delete(strVal(args[0] ?? LLN_VOID));
      return { __tag: "record", fields: updated };
    }
    case "entries": {
      const entries = [...fields.entries()].map(([k, v]): LogicNValue => {
        const ef = new Map<string, LogicNValue>([["key", { __tag: "string", value: k }], ["value", v]]);
        return { __tag: "record", fields: ef };
      });
      return { __tag: "list", items: entries };
    }
    case "merge": {
      const other = args[0];
      if (other?.__tag !== "record") return receiver;
      const merged = new Map(fields);
      for (const [k, v] of other.fields) merged.set(k, v);
      return { __tag: "record", fields: merged };
    }
    case "filter": {
      const fn = args[0];
      if (fn === undefined) return receiver;
      const filtered = new Map<string, LogicNValue>();
      for (const [k, v] of fields) {
        if (k.startsWith("__")) { filtered.set(k, v); continue; }
        const entryRecord: LogicNValue = {
          __tag: "record",
          fields: new Map<string, LogicNValue>([["key", { __tag: "string", value: k }], ["value", v]]),
        };
        const result = await ctx.applyFn(fn, entryRecord);
        if (result.__tag === "bool" && result.value) filtered.set(k, v);
      }
      return { __tag: "record", fields: filtered };
    }
    case "mapValues": {
      const fn = args[0];
      if (fn === undefined) return receiver;
      const transformed = new Map<string, LogicNValue>();
      for (const [k, v] of fields) {
        if (k.startsWith("__")) { transformed.set(k, v); continue; }
        transformed.set(k, await ctx.applyFn(fn, v));
      }
      return { __tag: "record", fields: transformed };
    }
    case "toList": {
      const entries = [...fields.entries()]
        .filter(([k]) => !k.startsWith("__"))
        .map(([k, v]): LogicNValue => {
          const ef = new Map<string, LogicNValue>([["key", { __tag: "string", value: k }], ["value", v]]);
          return { __tag: "record", fields: ef };
        });
      return { __tag: "list", items: entries };
    }
    default:
      return undefined;
  }
}

export function makeMoney(amount: string, currency: string): LogicNValue {
  return {
    __tag: "record",
    fields: new Map<string, LogicNValue>([
      ["__amount", { __tag: "decimal", value: amount }],
      ["__currency", { __tag: "string", value: currency }],
      ["__isMoney", { __tag: "bool", value: true }],
    ]),
  };
}

export function isMoney(v: LogicNValue): boolean {
  if (v.__tag !== "record") return false;
  const flag = v.fields.get("__isMoney");
  return flag?.__tag === "bool" && flag.value;
}

function moneyAmount(v: LogicNValue): number {
  const amount = v.__tag === "record" ? v.fields.get("__amount") : undefined;
  // Use parseFloat only for display/comparison — arithmetic now uses BigInt
  return amount?.__tag === "decimal" ? parseFloat(amount.value) : 0;
}

function moneyAmountStr(v: LogicNValue): string {
  const amount = v.__tag === "record" ? v.fields.get("__amount") : undefined;
  return amount?.__tag === "decimal" ? amount.value : "0";
}

function moneyCurrency(v: LogicNValue): string {
  const currency = v.__tag === "record" ? v.fields.get("__currency") : undefined;
  return currency?.__tag === "string" ? currency.value : "";
}

function moneyStatic(method: string, args: readonly LogicNValue[]): LogicNValue | undefined {
  switch (method) {
    case "gbp":
      return makeMoney(strVal(args[0] ?? { __tag: "string", value: "0.00" }), "GBP");
    case "usd":
      return makeMoney(strVal(args[0] ?? { __tag: "string", value: "0.00" }), "USD");
    case "eur":
      return makeMoney(strVal(args[0] ?? { __tag: "string", value: "0.00" }), "EUR");
    case "jpy":
      return makeMoney(strVal(args[0] ?? { __tag: "string", value: "0.00" }), "JPY");
    case "of":
      return makeMoney(args[0]?.__tag === "decimal" ? args[0].value : strVal(args[0] ?? { __tag: "string", value: "0.00" }), strVal(args[1] ?? { __tag: "string", value: "GBP" }));
    default:
      return undefined;
  }
}

function moneyMethod(receiver: LogicNValue, method: string, args: readonly LogicNValue[]): LogicNValue | undefined {
  if (!isMoney(receiver)) return undefined;
  const amountStr = moneyAmountStr(receiver);
  const currency = moneyCurrency(receiver);
  switch (method) {
    case "amount":
      // Return amount rounded to 2 decimal places for display
      return { __tag: "decimal", value: bigIntDecimalRound(amountStr, 2) };
    case "currency":
      return { __tag: "string", value: currency };
    case "toString":
      return { __tag: "string", value: `${currency} ${bigIntDecimalRound(amountStr, 2)}` };
    case "add": {
      const other = args[0];
      if (other === undefined || !isMoney(other)) return { __tag: "runtimeError", message: "Money.add requires Money argument" };
      if (moneyCurrency(other) !== currency) return err(`Cannot add ${currency} and ${moneyCurrency(other)}`);
      // Phase 9A-3: exact BigInt arithmetic — no floating-point rounding
      return makeMoney(bigIntDecimalRound(bigIntDecimalAdd(amountStr, moneyAmountStr(other)), 2), currency);
    }
    case "subtract": {
      const other = args[0];
      if (other === undefined || !isMoney(other)) return { __tag: "runtimeError", message: "Money.subtract requires Money argument" };
      if (moneyCurrency(other) !== currency) return err(`Cannot subtract ${moneyCurrency(other)} from ${currency}`);
      // Phase 9A-3: exact BigInt arithmetic
      return makeMoney(bigIntDecimalRound(bigIntDecimalSub(amountStr, moneyAmountStr(other)), 2), currency);
    }
    case "multiply": {
      // Money<C> * Decimal (or number) — scale by a factor
      // Stage 1 experimental warning preserved; BigInt multiply avoids FP errors
      const factorArg = args[0];
      const factorStr = factorArg?.__tag === "decimal" ? factorArg.value
                      : factorArg?.__tag === "int" || factorArg?.__tag === "float"
                        ? factorArg.value.toString()
                        : "1";
      return makeMoney(bigIntDecimalRound(bigIntDecimalMulNumber(amountStr, parseFloat(factorStr)), 2), currency);
    }
    case "divideBy": {
      const rhs = args[0];
      if (rhs === undefined) return err("Division by zero");
      if (isMoney(rhs)) {
        // Money<C> / Money<C> → Decimal ratio; use parseFloat for the ratio only
        const divisor = moneyAmount(rhs);
        if (divisor === 0) return err("Division by zero");
        return { __tag: "decimal", value: (moneyAmount(receiver) / divisor).toString() };
      }
      const divisorVal = rhs.__tag === "decimal" ? parseFloat(rhs.value) : numVal(rhs);
      if (divisorVal === 0) return err("Division by zero");
      return makeMoney(bigIntDecimalRound(bigIntDecimalMulNumber(amountStr, 1 / divisorVal), 2), currency);
    }
    default:
      return undefined;
  }
}

export function moneyBinary(left: LogicNValue, op: string, right: LogicNValue): LogicNValue | undefined {
  if (isMoney(left) && isMoney(right)) {
    if (op === "+") return moneyMethod(left, "add", [right]);
    if (op === "-") return moneyMethod(left, "subtract", [right]);
    if (op === "/") return moneyMethod(left, "divideBy", [right]);
  }
  if (isMoney(left) && (right.__tag === "decimal" || right.__tag === "int" || right.__tag === "float")) {
    if (op === "*") return moneyMethod(left, "multiply", [right]);
    if (op === "/") return moneyMethod(left, "divideBy", [right]);
  }
  return undefined;
}

function numericStatic(receiver: string, method: string, args: readonly LogicNValue[]): LogicNValue | undefined {
  switch (`${receiver}.${method}`) {
    case "Int.parse": {
      const n = parseInt(strVal(args[0] ?? LLN_VOID), 10);
      return Number.isNaN(n) ? err("ParseError: not a valid integer") : ok({ __tag: "int", value: n });
    }
    case "Int.bitAnd": {
      // Bitwise AND for bitmask operations (e.g. V_DPM capability checks).
      // Uses BigInt to avoid sign-extension on bit 31 for 32-bit unsigned masks.
      const a = BigInt(Math.trunc(numVal(args[0] ?? LLN_VOID)));
      const b = BigInt(Math.trunc(numVal(args[1] ?? LLN_VOID)));
      return { __tag: "int", value: Number(a & b) };
    }
    case "Int.bitOr": {
      // Bitwise OR for bitmask operations (e.g. V_DPM quarantine/emergency set).
      const a = BigInt(Math.trunc(numVal(args[0] ?? LLN_VOID)));
      const b = BigInt(Math.trunc(numVal(args[1] ?? LLN_VOID)));
      return { __tag: "int", value: Number(a | b) };
    }
    case "Float.parse": {
      const n = parseFloat(strVal(args[0] ?? LLN_VOID));
      return !Number.isFinite(n) ? err("ParseError: not a valid finite float") : ok({ __tag: "float", value: n });
    }
    case "Decimal.parse": {
      const s = strVal(args[0] ?? LLN_VOID);
      const n = parseFloat(s);
      return !Number.isFinite(n) ? err("ParseError: not a valid decimal") : ok({ __tag: "decimal", value: s });
    }
    case "Math.abs": {
      const n = numVal(args[0] ?? LLN_VOID);
      const v = args[0] ?? { __tag: "int", value: 0 };
      return v.__tag === "float" ? { __tag: "float", value: Math.abs(n) } : { __tag: "int", value: Math.abs(n) };
    }
    case "Math.min": {
      const a = numVal(args[0] ?? LLN_VOID);
      const b = numVal(args[1] ?? LLN_VOID);
      const isFloat = args[0]?.__tag === "float" || args[1]?.__tag === "float";
      return isFloat ? { __tag: "float", value: Math.min(a, b) } : { __tag: "int", value: Math.min(a, b) };
    }
    case "Math.max": {
      const a = numVal(args[0] ?? LLN_VOID);
      const b = numVal(args[1] ?? LLN_VOID);
      const isFloat = args[0]?.__tag === "float" || args[1]?.__tag === "float";
      return isFloat ? { __tag: "float", value: Math.max(a, b) } : { __tag: "int", value: Math.max(a, b) };
    }
    case "Math.floor":
      return { __tag: "int", value: Math.floor(numVal(args[0] ?? LLN_VOID)) };
    case "Math.ceil":
      return { __tag: "int", value: Math.ceil(numVal(args[0] ?? LLN_VOID)) };
    case "Math.round":
      return { __tag: "int", value: Math.round(numVal(args[0] ?? LLN_VOID)) };
    case "Math.log":
      return floatVal(Math.log(numVal(args[0] ?? LLN_VOID)));  // #55: log(0)→-Inf, log(neg)→NaN ⇒ fail-closed
    case "Math.log2":
      return floatVal(Math.log2(numVal(args[0] ?? LLN_VOID)));
    case "Math.sin":
      return { __tag: "float", value: Math.sin(numVal(args[0] ?? LLN_VOID)) };
    case "Math.cos":
      return { __tag: "float", value: Math.cos(numVal(args[0] ?? LLN_VOID)) };
    case "Math.tan":
      return floatVal(Math.tan(numVal(args[0] ?? LLN_VOID)));  // #55: tan(±Inf)→NaN ⇒ fail-closed
    case "Math.PI":
      return { __tag: "float", value: Math.PI };
    default:
      return undefined;
  }
}

function decimalConstructor(args: readonly LogicNValue[]): LogicNValue {
  return { __tag: "decimal", value: strVal(args[0] ?? { __tag: "string", value: "0" }) };
}

function validateValue(gateName: string, value: LogicNValue): boolean {
  if (value.__tag !== "string") return value.__tag !== "void";
  const s = value.value.trim();
  if (s === "") return false;
  switch (gateName) {
    case "email":
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
    case "url":
      try {
        new URL(s);
        return true;
      } catch {
        return false;
      }
    default:
      return s.length > 0;
  }
}

function sanitizeValue(value: LogicNValue): LogicNValue {
  if (value.__tag !== "string") return value;
  return {
    __tag: "string",
    value: value.value.replace(/<[^>]*>/g, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ""),
  };
}

function gateFunction(fullName: string, args: readonly LogicNValue[]): LogicNValue | undefined {
  const arg0 = args[0] ?? LLN_VOID;
  if (fullName.startsWith("validate.")) {
    const gateName = fullName.slice("validate.".length);
    const raw = arg0.__tag === "protected" ? arg0.value : arg0;
    if (!validateValue(gateName, raw)) return err(`ValidationError: invalid ${gateName}`);
    return ok({ __tag: "protected", baseType: gateName.charAt(0).toUpperCase() + gateName.slice(1), value: raw });
  }
  if (fullName.startsWith("sanitize.")) {
    const raw = arg0.__tag === "protected" ? arg0.value : arg0;
    return ok({ __tag: "protected", baseType: "String", value: sanitizeValue(raw) });
  }
  if (fullName.startsWith("parse.")) {
    const raw = arg0.__tag === "string" ? arg0.value : strVal(arg0);
    if (raw === "") return err("ParseError: empty input");
    return ok({ __tag: "protected", baseType: "String", value: arg0 });
  }
  if (fullName === "redact") {
    const baseType = arg0.__tag === "protected" ? arg0.baseType : arg0.__tag === "string" ? "String" : "Unknown";
    return { __tag: "redacted", baseType };
  }
  if (fullName === "constantTimeEquals") {
    const a = arg0.__tag === "secure" ? arg0.value : strVal(arg0);
    const bArg = args[1] ?? LLN_VOID;
    const b = bArg.__tag === "secure" ? bArg.value : strVal(bArg);
    return { __tag: "bool", value: constantTimeStringEquals(a, b) }; // H7: timing-safe, never ===
  }
  return undefined;
}

export function jsObjectToLogicN(v: unknown): LogicNValue {
  return jsValueToLogicN(v);
}

function jsValueToLogicN(v: unknown): LogicNValue {
  if (v === null || v === undefined) return LLN_NONE;
  if (typeof v === "string") return { __tag: "string", value: v };
  if (typeof v === "number") return Number.isInteger(v) ? { __tag: "int", value: v } : { __tag: "float", value: v };
  if (typeof v === "boolean") return { __tag: "bool", value: v };
  if (Array.isArray(v)) return { __tag: "list", items: v.map((item) => jsValueToLogicN(item)) };
  if (typeof v === "object") {
    const fields = new Map<string, LogicNValue>();
    for (const [key, value] of Object.entries(v)) fields.set(key, jsValueToLogicN(value));
    return { __tag: "record", fields };
  }
  return { __tag: "string", value: String(v) };
}

function logicNToJsValue(v: LogicNValue): unknown {
  switch (v.__tag) {
    case "string":
      return v.value;
    case "int":
    case "float":
      return v.value;
    case "decimal":
      return parseFloat(v.value);
    case "bool":
      return v.value;
    case "void":
    case "none":
      return null;
    case "some":
      return logicNToJsValue(v.value);
    case "ok":
      return logicNToJsValue(v.value);
    case "err":
      return { error: logicNToJsValue(v.error) };
    case "list":
      return v.items.map((item) => logicNToJsValue(item));
    case "secure":
    case "protected":
    case "redacted":
      return null;
    case "record": {
      const out: Record<string, unknown> = {};
      for (const [k, val] of v.fields) {
        if (!k.startsWith("__")) out[k] = logicNToJsValue(val);
      }
      return out;
    }
    default:
      return null;
  }
}

function serialization(fullName: string, args: readonly LogicNValue[]): LogicNValue | undefined {
  if (fullName === "json.decode" || fullName.startsWith("json.decode<")) {
    const input = args[0] ?? LLN_VOID;
    let raw: string;
    if (input.__tag === "string") {
      raw = input.value;
    } else if (input.__tag === "bytes") {
      try {
        raw = new TextDecoder().decode(input.value);
      } catch {
        return err("DecodeError: invalid UTF-8");
      }
    } else {
      return err("DecodeError: expected String or Bytes");
    }
    try {
      return ok(jsValueToLogicN(JSON.parse(raw)));
    } catch {
      return err("DecodeError: invalid JSON");
    }
  }

  if (fullName === "json.encode") {
    try {
      return { __tag: "string", value: JSON.stringify(logicNToJsValue(args[0] ?? LLN_VOID)) };
    } catch {
      return err("EncodeError: value cannot be serialized");
    }
  }

  if (fullName === "toml.decode" || fullName.startsWith("toml.decode<")) {
    const raw = strVal(args[0] ?? LLN_VOID);
    try {
      const fields = new Map<string, LogicNValue>();
      for (const line of raw.split("\n")) {
        const eq = line.indexOf("=");
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim().replace(/^"|"$/g, "");
        if (key !== "") fields.set(key, { __tag: "string", value });
      }
      return ok({ __tag: "record", fields });
    } catch {
      return err("DecodeError: invalid TOML");
    }
  }
  return undefined;
}

async function networkAsync(fullName: string, args: readonly LogicNValue[], ctx: StdlibContext): Promise<LogicNValue | undefined> {
  if (!fullName.startsWith("http.")) return undefined;
  ctx.recordEffect("network.outbound");
  const method = fullName.slice("http.".length).toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) return undefined;

  const url = strVal(args[0] ?? LLN_VOID);
  if (!url) return err("NetworkError: empty URL");

  // OWASP F2: SSRF — deny-by-default egress guard (@logicn/core-network). guardHop normalizes + denies the
  // numeric-IP / IPv4-in-IPv6 / CGNAT / *.internal / embedded-credential bypasses, plus a DNS-rebind recheck.
  // It is applied to the ORIGINAL url AND to EVERY redirect hop — a guard-approved public URL can return
  // `302 Location: http://169.254.169.254/`, and a guard that only checks the original URL is bypassed by the
  // redirect (DevSecOps pentest finding). Returns an error string, or null if the hop is permitted.
  const guardHop = async (u: string): Promise<string | null> => {
    const eg = guardOutboundUrl(u, { allowedSchemes: ["http", "https"] });
    if (!eg.allowed) return `NetworkError: SSRF — ${eg.reason} (LLN-NET-001 · ${eg.code})`;
    if (eg.requiresDnsRecheck) {
      let ips: string[];
      try {
        // require (not import) — the compiler intentionally ships no @types/node; mirror the existing
        // node:crypto require pattern in this file and type the slice we use.
        const dns = require("node:dns/promises") as {
          lookup(host: string, opts: { all: true }): Promise<ReadonlyArray<{ address: string }>>;
        };
        ips = (await dns.lookup(eg.host, { all: true })).map((r) => r.address);
      } catch {
        return `NetworkError: SSRF — DNS resolution failed for '${eg.host}' (LLN-NET-001, fail-closed)`;
      }
      const rebind = guardResolvedAddresses(eg.host, ips);
      if (!rebind.allowed) return `NetworkError: SSRF — ${rebind.reason} (LLN-NET-001 · ${rebind.code})`;
    }
    return null;
  };

  const firstGuard = await guardHop(url);
  if (firstGuard !== null) return err(firstGuard);

  try {
    const bodyArg = args[1];
    // redirect: "manual" — NEVER let fetch auto-follow. fetch/undici defaults to redirect:"follow", which
    // would transparently follow a 302 to an internal/metadata host the guard never saw. We re-guard each
    // Location ourselves before following, with a hop cap.
    const init: RequestInit = { method, redirect: "manual" };
    if (bodyArg !== undefined && bodyArg.__tag !== "void") {
      if (bodyArg.__tag === "bytes") {
        init.body = bodyArg.value as unknown as BodyInit;
      } else if (bodyArg.__tag === "string") {
        init.body = bodyArg.value;
        (init.headers as Record<string, string>) = { "Content-Type": "application/json" };
      }
    }
    const { URL: NodeURL } = require("node:url") as { URL: new (input: string, base?: string) => { href: string } };
    const MAX_REDIRECTS = 5;
    let currentUrl = url;
    for (let hop = 0; ; hop++) {
      const response = await fetch(currentUrl, init);
      if (response.status >= 300 && response.status < 400) {
        if (hop >= MAX_REDIRECTS) return err(`NetworkError: too many redirects (>${MAX_REDIRECTS}) from ${url}`);
        const loc = response.headers.get("location");
        if (!loc) return err(`NetworkError: HTTP ${response.status} redirect with no Location from ${currentUrl}`);
        let nextUrl: string;
        try { nextUrl = new NodeURL(loc, currentUrl).href; } // resolve a relative Location against the current URL
        catch { return err(`NetworkError: SSRF — invalid redirect target '${loc}' (LLN-NET-001)`); }
        const hopErr = await guardHop(nextUrl); // RE-GUARD the redirect destination before following
        if (hopErr !== null) return err(hopErr);
        currentUrl = nextUrl;
        continue;
      }
      if (!response.ok) {
        return err(`NetworkError: HTTP ${response.status} from ${currentUrl}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      return ok({ __tag: "bytes", value: bytes });
    }
  } catch (e) {
    return err(`NetworkError: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function filesystemAsync(fullName: string, args: readonly LogicNValue[], ctx: StdlibContext): Promise<LogicNValue | undefined> {
  if (!fullName.startsWith("fs.") && !fullName.startsWith("File.")) return undefined;
  const isRead = fullName.includes("read") || fullName.includes("Read");
  const isWrite = fullName.includes("write") || fullName.includes("Write");
  if (isRead) ctx.recordEffect("filesystem.read");
  if (isWrite) ctx.recordEffect("filesystem.write");

  const path = strVal(args[0] ?? LLN_VOID);
  if (path === "") return err("FileError: empty path");

  // OWASP F3 (fully hardened — OWASP review pass): segment-safe + symlink-safe confinement.
  //
  // Three-layer defence:
  //   1. path.relative() — segment-safe (blocks ../  and sibling-prefix bypasses)
  //   2. realpathSync() on the existing parent — resolves symlinks that point outside root
  //   3. Both layers must agree — either alone is bypassable
  const _proc = process as unknown as { env: Record<string, string>; cwd(): string };
  const fsRootRaw = _proc.env["LOGICN_FS_ROOT"] ?? _proc.cwd();
  const fsRoot    = pathResolve(fsRootRaw);
  const safePath  = pathResolve(fsRoot, path);

  // Layer 1: segment-safe check
  const rel = pathRelative(fsRoot, safePath);
  if (rel.startsWith("..") || pathIsAbsolute(rel)) {
    return err(`FileError: path '${path}' escapes the allowed root '${fsRootRaw}'`);
  }

  // Layer 2: symlink canonicalization via realpathSync on the existing ancestor
  {
    const fsModule = await import("node:fs") as unknown as {
      realpathSync(p: string): string; existsSync(p: string): boolean;
    };
    try {
      const { realpathSync, existsSync } = fsModule;
      const realRoot = realpathSync(fsRoot);
      // Resolve whichever ancestor exists (file itself, parent, or root)
      const checkPath = existsSync(safePath) ? safePath
        : existsSync(pathResolve(safePath, "..")) ? pathResolve(safePath, "..") : fsRoot;
      const realTarget = realpathSync(checkPath);
      const realRel    = pathRelative(realRoot, realTarget);
      if (realRel.startsWith("..") || pathIsAbsolute(realRel)) {
        return err(`FileError: path '${path}' escapes sandbox via symlink`);
      }
    } catch {
      return err(`FileError: path '${path}' could not be canonicalized (access denied)`);
    }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeFs = await import("node:fs/promises") as any;
    if (fullName === "fs.readText" || fullName === "File.readText") {
      const text: string = await nodeFs.readFile(safePath, "utf8");
      return ok({ __tag: "string", value: String(text) });
    }
    if (fullName === "fs.readBytes" || fullName === "File.readBytes") {
      const buffer: Uint8Array = await nodeFs.readFile(safePath);
      return ok({ __tag: "bytes", value: new Uint8Array(buffer) });
    }
    if (fullName === "fs.writeText" || fullName === "File.writeText") {
      await nodeFs.writeFile(safePath, strVal(args[1] ?? LLN_VOID), "utf8");
      return ok(LLN_VOID);
    }
    if (fullName === "fs.writeBytes" || fullName === "File.writeBytes") {
      const bytes = args[1]?.__tag === "bytes" ? args[1].value : new Uint8Array();
      await nodeFs.writeFile(safePath, bytes);
      return ok(LLN_VOID);
    }
  } catch (error) {
    return err(`FileError: ${error instanceof Error ? error.message : String(error)}`);
  }
  return undefined;
}

function environmentFn(fullName: string, args: readonly LogicNValue[], ctx: StdlibContext): LogicNValue | undefined {
  if (!fullName.startsWith("Env.") && !fullName.startsWith("env.")) return undefined;
  ctx.recordEffect("secret.read");
  const env = process?.env ?? {};
  const key = strVal(args[0] ?? LLN_VOID);
  if (fullName === "Env.get" || fullName === "env.get") {
    const value = env[key];
    return value !== undefined ? ok({ __tag: "string", value }) : err(`EnvError: '${key}' not set`);
  }
  if (fullName === "env.secret") {
    return { __tag: "secure", value: env[key] ?? "" };
  }
  if (fullName === "env.optional" || fullName === "Env.optional") {
    const value = env[key];
    return value !== undefined ? mkSome({ __tag: "string", value }) : LLN_NONE;
  }
  return undefined;
}

function formatString(args: readonly LogicNValue[]): LogicNValue {
  const template = args[0];
  if (template?.__tag !== "string") return { __tag: "string", value: "" };
  let output = template.value;
  for (let i = 1; i < args.length; i += 1) {
    output = output.replace("{}", safeDisplay(args[i] ?? LLN_VOID));
  }
  return { __tag: "string", value: output };
}

export function logicNValuesEqual(a: LogicNValue, b: LogicNValue): boolean {
  if (a.__tag !== b.__tag) return false;
  if (a.__tag === "string" && b.__tag === "string") return a.value === b.value;
  if (a.__tag === "int" && b.__tag === "int") return a.value === b.value;
  // Step 1g: int64 equality via bigint === so List.contains / Set / dedup of >2^53 values are exact (no
  // round). Same-tag only (the tag guard above already separates int vs int64); mixed int/int64 equality
  // is an owner policy decision (promote-and-compare vs same-tag-only) deferred per the verified plan.
  if (a.__tag === "int64" && b.__tag === "int64") return a.value === b.value;
  if (a.__tag === "float" && b.__tag === "float") return a.value === b.value;
  if (a.__tag === "decimal" && b.__tag === "decimal") return bigIntDecimalCmp(a.value, b.value) === 0;
  if (a.__tag === "bool" && b.__tag === "bool") return a.value === b.value;
  if (a.__tag === "char" && b.__tag === "char") return a.value === b.value;
  if (a.__tag === "none" && b.__tag === "none") return true;
  if (a.__tag === "void" && b.__tag === "void") return true;
  return false;
}

// ---------------------------------------------------------------------------
// Statistics module
// ---------------------------------------------------------------------------

function statisticsModule(method: string, args: readonly LogicNValue[]): LogicNValue | undefined {
  const items = asList(args[0] ?? LLN_VOID);
  if (items.length === 0) {
    if (method === "sum") return { __tag: "int", value: 0 };
    return err(`Statistics.${method}: empty list`);
  }
  switch (method) {
    case "mean": {
      const total = items.reduce((acc, item) => acc + numVal(item), 0);
      return { __tag: "float", value: total / items.length };
    }
    case "median": {
      const sorted = [...items].sort((a, b) => numVal(a) - numVal(b));
      const mid = Math.floor(sorted.length / 2);
      if (sorted.length % 2 === 1) return sorted[mid]!;
      const lo = numVal(sorted[mid - 1]!);
      const hi = numVal(sorted[mid]!);
      return { __tag: "float", value: (lo + hi) / 2 };
    }
    case "stddev": {
      const n = items.length;
      const mean = items.reduce((acc, item) => acc + numVal(item), 0) / n;
      const variance = items.reduce((acc, item) => acc + Math.pow(numVal(item) - mean, 2), 0) / n;
      return floatVal(Math.sqrt(variance));  // #55: empty list → n=0 → NaN ⇒ fail-closed (not a silent NaN stddev)
    }
    case "min": {
      const m = items.reduce((a, b) => numVal(a) < numVal(b) ? a : b);
      return mkSome(m);
    }
    case "max": {
      const m = items.reduce((a, b) => numVal(a) > numVal(b) ? a : b);
      return mkSome(m);
    }
    case "sum": {
      const isFloat = items.some((i) => i.__tag === "float");
      const total = items.reduce((acc, item) => acc + numVal(item), 0);
      return isFloat ? { __tag: "float", value: total } : { __tag: "int", value: total };
    }
    default:
      return undefined;
  }
}

export async function callStdlib(
  fullName: string,
  receiver: LogicNValue | undefined,
  args: readonly LogicNValue[],
  ctx: StdlibContext,
): Promise<LogicNValue | undefined> {
  if (receiver === undefined) {
    if (fullName === "format") return formatString(args);
    if (fullName === "Decimal") return decimalConstructor(args);

    // Runtime.cpuUsage() / Runtime.memoryUsage() — for benchmark resource reporting
    if (fullName === "Runtime.cpuUsage" || fullName === "cpuUsage") {
      const cpu = _proc.cpuUsage();
      return {
        __tag: "record",
        fields: new Map([
          ["userMs",   { __tag: "float", value: cpu.user   / 1000 }],
          ["systemMs", { __tag: "float", value: cpu.system / 1000 }],
        ]),
      } as LogicNValue;
    }
    if (fullName === "Runtime.cpuUsageSince" || fullName === "cpuUsageSince") {
      const baseline = args[0];
      const userBase   = baseline?.__tag === "record" ? (numVal(baseline.fields?.get("userMs")   ?? { __tag: "int", value: 0 }) * 1000) : 0;
      const systemBase = baseline?.__tag === "record" ? (numVal(baseline.fields?.get("systemMs") ?? { __tag: "int", value: 0 }) * 1000) : 0;
      const cpu = _proc.cpuUsage({ user: Math.round(userBase), system: Math.round(systemBase) });
      return {
        __tag: "record",
        fields: new Map([
          ["userMs",   { __tag: "float", value: cpu.user   / 1000 }],
          ["systemMs", { __tag: "float", value: cpu.system / 1000 }],
        ]),
      } as LogicNValue;
    }
    if (fullName === "Runtime.memoryUsage" || fullName === "memoryUsage") {
      const mem = _proc.memoryUsage();
      return {
        __tag: "record",
        fields: new Map([
          ["rssBytes",       { __tag: "int", value: mem.rss }],
          ["heapUsedBytes",  { __tag: "int", value: mem.heapUsed }],
          ["heapTotalBytes", { __tag: "int", value: mem.heapTotal }],
        ]),
      } as LogicNValue;
    }

    // Time.nowMs() — high-resolution wall-clock milliseconds (for benchmarks and timing)
    // Used by: compute-mix-throughput-benchmark.lln and other timed flows
    if (fullName === "Time.nowMs" || fullName === "nowMs") {
      // Use hrtime for high-resolution timing (available in all Node.js environments)
      const [sec, ns] = _proc.hrtime();
      return { __tag: "float", value: sec * 1000 + ns / 1_000_000 };
    }

    // Timestamp.now() and Timestamp.fromMs(n)
    if (fullName === "Timestamp.now") return makeTimestamp(Date.now());
    if (fullName === "Timestamp.fromMs") return makeTimestamp(numVal(args[0] ?? { __tag: "int", value: 0 }));
    if (fullName === "Timestamp.fromIso") {
      const s = strVal(args[0] ?? LLN_VOID);
      const ms = Date.parse(s);
      return isNaN(ms) ? err("ParseError: invalid ISO timestamp") : ok(makeTimestamp(ms));
    }

    // Set.empty() / Set.from([...])
    if (fullName === "Set.empty") return makeSet([]);
    if (fullName === "Set.from") return makeSet([...(args[0]?.__tag === "list" ? args[0].items : [])]);

    // Bytes static constructors
    if (fullName === "Bytes.fromHex") {
      const hex = strVal(args[0] ?? LLN_VOID).replace(/\s/g, "");
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      return { __tag: "bytes", value: bytes };
    }
    if (fullName === "Bytes.empty")  return { __tag: "bytes", value: new Uint8Array(0) };
    if (fullName === "Bytes.of")     return { __tag: "bytes", value: new Uint8Array(args.map(numVal)) };
    if (fullName === "Bytes.fromString") {
      const s = strVal(args[0] ?? LLN_VOID);
      return { __tag: "bytes", value: new TextEncoder().encode(s) };
    }

    // Duration static constructors
    if (fullName.startsWith("Duration.")) {
      const method = fullName.slice("Duration.".length);
      const r = durationStatic(method, args);
      if (r !== undefined) return r;
    }

    // Array static constructors
    if (fullName === "Array.empty")  return { __tag: "list", items: [] };
    if (fullName === "Array.of")     return { __tag: "list", items: [...args] };
    if (fullName === "Array.range") {
      const from = numVal(args[0] ?? { __tag: "int", value: 0 });
      const to   = numVal(args[1] ?? { __tag: "int", value: 0 });
      const step = args[2] !== undefined ? numVal(args[2]) : 1;
      const items: LogicNValue[] = [];
      for (let i = from; i < to; i += step) items.push({ __tag: "int", value: i });
      return { __tag: "list", items };
    }

    // Map static constructors
    if (fullName === "Map.empty")  return { __tag: "record", fields: new Map() };
    if (fullName === "Map.from" || fullName === "Map.fromList") {
      const entries = asList(args[0] ?? LLN_VOID);
      const fields = new Map<string, LogicNValue>();
      for (const entry of entries) {
        if (entry.__tag === "record") {
          const k = entry.fields.get("key") ?? entry.fields.get("0");
          const v = entry.fields.get("value") ?? entry.fields.get("1");
          if (k?.__tag === "string" && v !== undefined) fields.set(k.value, v);
        }
      }
      return { __tag: "record", fields };
    }

    // Char static
    if (fullName === "Char.fromCode") {
      const code = numVal(args[0] ?? { __tag: "int", value: 0 });
      return { __tag: "char", value: String.fromCodePoint(code) };
    }

    // Result/Option combinators (static form: Result.sequence, Option.sequence)
    if (fullName.startsWith("Result.")) {
      const m = fullName.slice("Result.".length);
      const r = await resultCombinator(m, args, ctx);
      if (r !== undefined) return r;
    }
    if (fullName.startsWith("Option.")) {
      const m = fullName.slice("Option.".length);
      const r = await optionCombinator(m, args, ctx);
      if (r !== undefined) return r;
    }

    // Error type constructors: ApiError.notFound("msg"), ValidationError.badRequest("msg"), etc.
    const errorTypes = ["ApiError","ValidationError","EmailError","PaymentError","WebhookError","DecodeError","NetworkError","DbError","FileError","EnvError","ParseError","AuthError","RateError","SyncError","OrderError","UserError","SaveError","ProcessError"];
    for (const errType of errorTypes) {
      if (fullName.startsWith(`${errType}.`)) {
        return errorConstructor(errType, fullName.slice(errType.length + 1), args);
      }
    }

    // Math extended
    if (fullName === "Math.pow") {
      const base = numVal(args[0] ?? { __tag: "int", value: 0 });
      const exp  = numVal(args[1] ?? { __tag: "int", value: 0 });
      const result = Math.pow(base, exp);
      return Number.isInteger(result) && Number.isInteger(base) && Number.isInteger(exp)
        ? { __tag: "int", value: result }
        : floatVal(result);  // #55: overflow→+Inf, pow(neg,frac)→NaN, pow(0,-1)→+Inf ⇒ fail-closed
    }
    if (fullName === "Math.sqrt") {
      return floatVal(Math.sqrt(numVal(args[0] ?? { __tag: "int", value: 0 })));  // #55: sqrt(neg)→NaN ⇒ fail-closed
    }
    if (fullName === "Math.clamp") {
      const n  = numVal(args[0] ?? { __tag: "int", value: 0 });
      const lo = numVal(args[1] ?? { __tag: "int", value: 0 });
      const hi = numVal(args[2] ?? { __tag: "int", value: 100 });
      return { __tag: "int", value: Math.min(Math.max(n, lo), hi) };
    }
    if (fullName === "Math.sign") {
      const n = numVal(args[0] ?? { __tag: "int", value: 0 });
      return { __tag: "int", value: n > 0 ? 1 : n < 0 ? -1 : 0 };
    }

    // Statistics module
    if (fullName.startsWith("Statistics.")) {
      const statMethod = fullName.slice("Statistics.".length);
      const statResult = statisticsModule(statMethod, args);
      if (statResult !== undefined) return statResult;
    }

    // ---------------------------------------------------------------------------
    // Tensor module (Phase R2A) — real TypedArray-backed operations
    // ---------------------------------------------------------------------------
    if (fullName.startsWith("Tensor.")) {
      const tensorMethod = fullName.slice("Tensor.".length);
      const tensorResult = tensorModule(tensorMethod, args);
      if (tensorResult !== undefined) return tensorResult;
    }

    // ---------------------------------------------------------------------------
    // Hash module (Phase R2C) — real SHA-256/SHA-512 via node:crypto
    // ---------------------------------------------------------------------------
    if (fullName.startsWith("Hash.")) {
      const hashMethod = fullName.slice("Hash.".length);
      const hashResult = hashModule(hashMethod, args);
      if (hashResult !== undefined) return hashResult;
    }

    // ---------------------------------------------------------------------------
    // Crypto module (Phase R2B) — constant-time equality via node:crypto
    // ---------------------------------------------------------------------------
    if (fullName.startsWith("Crypto.")) {
      const cryptoMethod = fullName.slice("Crypto.".length);
      const cryptoResult = cryptoModule(cryptoMethod, args);
      if (cryptoResult !== undefined) return cryptoResult;
    }

    if (fullName.startsWith("BCrypt.")) {
      const bcryptMethod = fullName.slice("BCrypt.".length);
      const bcryptResult = bcryptModule(bcryptMethod, args);
      if (bcryptResult !== undefined) return bcryptResult;
    }

    // Phase 35/36: Password API (async — Argon2id is async) + Argon2 module
    if (fullName.startsWith("Password.")) {
      const pwMethod = fullName.slice("Password.".length);
      const pwResult = await passwordModule(pwMethod, args);
      if (pwResult !== undefined) return pwResult;
    }
    if (fullName.startsWith("Argon2.")) {
      const a2Method = fullName.slice("Argon2.".length);
      const a2Result = await argon2Module(a2Method, args);
      if (a2Result !== undefined) return a2Result;
    }

    const gateResult = gateFunction(fullName, args);
    if (gateResult !== undefined) return gateResult;

    const serialResult = serialization(fullName, args);
    if (serialResult !== undefined) return serialResult;

    const dotIdx = fullName.lastIndexOf(".");
    if (dotIdx !== -1) {
      const receiverName = fullName.slice(0, dotIdx);
      const method = fullName.slice(dotIdx + 1);

      if (receiverName === "Money") return moneyStatic(method, args);
      if (receiverName === "String") return stringStaticMethod(method, args);

      const numeric = numericStatic(receiverName, method, args);
      if (numeric !== undefined) return numeric;

      const net = await networkAsync(fullName, args, ctx);
      if (net !== undefined) return net;

      const fsResult = await filesystemAsync(fullName, args, ctx);
      if (fsResult !== undefined) return fsResult;

      const env = environmentFn(fullName, args, ctx);
      if (env !== undefined) return env;
    }

    return undefined;
  }

  const method = fullName.includes(".") ? fullName.slice(fullName.lastIndexOf(".") + 1) : fullName;

  // When the receiver is an unresolved identifier (e.g. Duration, Array, Result),
  // treat it as a static/module call and re-dispatch through the static path.
  if (receiver.__tag === "unresolved" || receiver.__tag === "function") {
    return callStdlib(fullName, undefined, args, ctx);
  }

  const option = await optionMethod(receiver, method, args, ctx);
  if (option !== undefined) return option;

  const result = await resultMethod(receiver, method, args, ctx);
  if (result !== undefined) return result;

  const string = stringMethod(receiver, method, args);
  if (string !== undefined) return string;

  const list = await listMethod(receiver, method, args, ctx);
  if (list !== undefined) return list;

  const map = await mapMethod(receiver, method, args, ctx);
  if (map !== undefined) return map;

  const money = moneyMethod(receiver, method, args);
  if (money !== undefined) return money;

  const bytes = bytesMethod(receiver, method, args);
  if (bytes !== undefined) return bytes;

  const char = charMethod(receiver, method, args);
  if (char !== undefined) return char;

  const set = await setMethod(receiver, method, args, ctx);
  if (set !== undefined) return set;

  const ts = timestampMethod(receiver, method, args);
  if (ts !== undefined) return ts;

  const dur = durationMethod(receiver, method, args);
  if (dur !== undefined) return dur;

  const num = numericMethod(receiver, method, args);
  if (num !== undefined) return num;

  return undefined;
}

// ---------------------------------------------------------------------------
// Bytes operations
// ---------------------------------------------------------------------------

function bytesMethod(
  receiver: LogicNValue,
  method: string,
  args: readonly LogicNValue[],
): LogicNValue | undefined {
  if (receiver.__tag !== "bytes") return undefined;
  const buf = receiver.value;

  switch (method) {
    case "length":
    case "size":     return { __tag: "int", value: buf.length };
    case "isEmpty":  return { __tag: "bool", value: buf.length === 0 };

    case "get": {
      const idx = numVal(args[0] ?? { __tag: "int", value: -1 });
      return idx >= 0 && idx < buf.length
        ? mkSome({ __tag: "byte", value: buf[idx]! })
        : LLN_NONE;
    }

    case "slice": {
      const start = numVal(args[0] ?? { __tag: "int", value: 0 });
      const end   = args[1] !== undefined ? numVal(args[1]) : buf.length;
      return { __tag: "bytes", value: buf.slice(start, end) };
    }

    case "toHex": {
      const hex = Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
      return { __tag: "string", value: hex };
    }

    case "toBase64": {
      // Base64 encoding without Buffer dependency
      const b64 = typeof btoa !== "undefined"
        ? btoa(String.fromCharCode(...buf))
        : Array.from(buf).map((b) => String.fromCharCode(b)).join("");
      return { __tag: "string", value: b64 };
    }

    case "equals": {
      const other = args[0];
      if (other?.__tag !== "bytes") return { __tag: "bool", value: false };
      if (buf.length !== other.value.length) return { __tag: "bool", value: false };
      const equal = buf.every((b, i) => b === other.value[i]);
      return { __tag: "bool", value: equal };
    }

    case "append": {
      const other = args[0];
      if (other?.__tag !== "bytes") return receiver;
      const merged = new Uint8Array(buf.length + other.value.length);
      merged.set(buf, 0);
      merged.set(other.value, buf.length);
      return { __tag: "bytes", value: merged };
    }

    case "decode":
    case "toString": {
      // Attempt UTF-8 decode
      try {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        return ok({ __tag: "string", value: decoder.decode(buf) });
      } catch {
        return err("DecodeError: invalid UTF-8");
      }
    }

    // Phase 9A-3: SHA-256 hash via node:crypto
    case "sha256": {
      try {
        const nodeCrypto = require("node:crypto") as {
          createHash: (alg: string) => { update: (data: Uint8Array) => { digest: (enc?: string) => Uint8Array | string } };
        };
        const hashBytes = nodeCrypto.createHash("sha256").update(buf).digest() as Uint8Array;
        return { __tag: "bytes", value: new Uint8Array(hashBytes) };
      } catch {
        return err("sha256: node:crypto not available in this environment");
      }
    }

    // Hex-encode the SHA-256 hash (convenience method)
    case "sha256Hex": {
      try {
        const nodeCrypto = require("node:crypto") as {
          createHash: (alg: string) => { update: (data: Uint8Array) => { digest: (enc: string) => string } };
        };
        const hex = nodeCrypto.createHash("sha256").update(buf).digest("hex") as string;
        return { __tag: "string", value: hex };
      } catch {
        return err("sha256Hex: node:crypto not available in this environment");
      }
    }

    default: return undefined;
  }
}

// ---------------------------------------------------------------------------
// Char operations
// ---------------------------------------------------------------------------

function charMethod(
  receiver: LogicNValue,
  method: string,
  _args: readonly LogicNValue[],
): LogicNValue | undefined {
  if (receiver.__tag !== "char") return undefined;
  const ch = receiver.value;
  const code = ch.codePointAt(0) ?? 0;

  switch (method) {
    case "codePoint":  return { __tag: "int", value: code };
    case "toString":   return { __tag: "string", value: ch };
    case "isDigit":    return { __tag: "bool", value: ch >= "0" && ch <= "9" };
    case "isLetter":   return { __tag: "bool", value: /\p{L}/u.test(ch) };
    case "isUpper":    return { __tag: "bool", value: ch === ch.toUpperCase() && ch !== ch.toLowerCase() };
    case "isLower":    return { __tag: "bool", value: ch === ch.toLowerCase() && ch !== ch.toUpperCase() };
    case "isWhitespace": return { __tag: "bool", value: /\s/.test(ch) };
    case "toUpper":    return { __tag: "char", value: ch.toUpperCase() };
    case "toLower":    return { __tag: "char", value: ch.toLowerCase() };
    default: return undefined;
  }
}

// ---------------------------------------------------------------------------
// Set<T> operations
// ---------------------------------------------------------------------------

function makeSet(items: LogicNValue[]): LogicNValue {
  // Represent Set as a record with __isSet marker and items list
  const fields = new Map<string, LogicNValue>([
    ["__isSet",  { __tag: "bool", value: true }],
    ["__items",  { __tag: "list", items }],
  ]);
  return { __tag: "record", fields };
}

function isSet(v: LogicNValue): boolean {
  return v.__tag === "record" && (v.fields.get("__isSet") as { __tag: "bool"; value: boolean } | undefined)?.value === true;
}

function setItems(v: LogicNValue): readonly LogicNValue[] {
  if (v.__tag === "record") {
    const items = v.fields.get("__items");
    if (items?.__tag === "list") return items.items;
  }
  return [];
}

async function setMethod(
  receiver: LogicNValue,
  method: string,
  args: readonly LogicNValue[],
  ctx: StdlibContext,
): Promise<LogicNValue | undefined> {
  if (!isSet(receiver)) return undefined;
  const items = [...setItems(receiver)];

  switch (method) {
    case "size":
    case "length":  return { __tag: "int", value: items.length };
    case "isEmpty": return { __tag: "bool", value: items.length === 0 };

    case "contains": {
      const target = args[0] ?? LLN_VOID;
      return { __tag: "bool", value: items.some((i) => logicNValuesEqual(i, target)) };
    }

    case "add": {
      const item = args[0] ?? LLN_VOID;
      if (items.some((i) => logicNValuesEqual(i, item))) return receiver;
      return makeSet([...items, item]);
    }

    case "remove": {
      const target = args[0] ?? LLN_VOID;
      return makeSet(items.filter((i) => !logicNValuesEqual(i, target)));
    }

    case "toList":
    case "toArray": return { __tag: "list", items };

    case "union": {
      const other = setItems(args[0] ?? LLN_VOID);
      const merged = [...items];
      for (const item of other) {
        if (!merged.some((i) => logicNValuesEqual(i, item))) merged.push(item);
      }
      return makeSet(merged);
    }

    case "intersection": {
      const other = setItems(args[0] ?? LLN_VOID);
      return makeSet(items.filter((i) => other.some((o) => logicNValuesEqual(i, o))));
    }

    case "difference": {
      const other = setItems(args[0] ?? LLN_VOID);
      return makeSet(items.filter((i) => !other.some((o) => logicNValuesEqual(i, o))));
    }

    case "map": {
      const fn = args[0];
      if (fn === undefined) return receiver;
      const mapped: LogicNValue[] = [];
      for (const item of items) mapped.push(await ctx.applyFn(fn, item));
      return makeSet(mapped);
    }

    case "filter": {
      const fn = args[0];
      if (fn === undefined) return receiver;
      const filtered: LogicNValue[] = [];
      for (const item of items) {
        const r = await ctx.applyFn(fn, item);
        if (r.__tag === "bool" && r.value) filtered.push(item);
      }
      return makeSet(filtered);
    }

    default: return undefined;
  }
}

// ---------------------------------------------------------------------------
// Timestamp and Duration operations
// ---------------------------------------------------------------------------

/** Stage 1: Timestamp is a record wrapping a JS Date millisecond value. */
function makeTimestamp(ms: number): LogicNValue {
  const fields = new Map<string, LogicNValue>([
    ["__isTimestamp", { __tag: "bool", value: true }],
    ["__ms",          { __tag: "int",  value: ms }],
  ]);
  return { __tag: "record", fields };
}

function isTimestamp(v: LogicNValue): boolean {
  return v.__tag === "record" && (v.fields.get("__isTimestamp") as { __tag: "bool"; value: boolean } | undefined)?.value === true;
}

function tsMs(v: LogicNValue): number {
  if (v.__tag === "record") {
    const ms = v.fields.get("__ms");
    if (ms?.__tag === "int") return ms.value;
  }
  return 0;
}

function timestampMethod(
  receiver: LogicNValue,
  method: string,
  args: readonly LogicNValue[],
): LogicNValue | undefined {
  if (!isTimestamp(receiver)) return undefined;
  const ms = tsMs(receiver);

  switch (method) {
    case "toIso":
    case "toString":  return { __tag: "string", value: new Date(ms).toISOString() };
    case "toMs":      return { __tag: "int",    value: ms };
    case "toSeconds": return { __tag: "int",    value: Math.floor(ms / 1000) };

    case "add": {
      // Timestamp + Duration (duration is int ms)
      const dur = numVal(args[0] ?? { __tag: "int", value: 0 });
      return makeTimestamp(ms + dur);
    }

    case "subtract": {
      const other = args[0] ?? LLN_VOID;
      if (isTimestamp(other)) {
        // Timestamp - Timestamp = Duration (ms)
        return { __tag: "int", value: ms - tsMs(other) };
      }
      // Timestamp - Duration
      return makeTimestamp(ms - numVal(other));
    }

    case "before":    return { __tag: "bool", value: ms <  tsMs(args[0] ?? LLN_VOID) };
    case "after":     return { __tag: "bool", value: ms >  tsMs(args[0] ?? LLN_VOID) };
    case "equals":    return { __tag: "bool", value: ms === tsMs(args[0] ?? LLN_VOID) };

    // Phase 9A-3: Timestamp.format(pattern) — basic pattern formatting
    // Supported tokens: YYYY MM DD HH mm ss (UTC)
    case "format": {
      const pattern = args[0]?.__tag === "string" ? args[0].value : "YYYY-MM-DD";
      const date = new Date(ms);
      const formatted = pattern
        .replace("YYYY", date.getUTCFullYear().toString().padStart(4, "0"))
        .replace("MM",   (date.getUTCMonth() + 1).toString().padStart(2, "0"))
        .replace("DD",   date.getUTCDate().toString().padStart(2, "0"))
        .replace("HH",   date.getUTCHours().toString().padStart(2, "0"))
        .replace("mm",   date.getUTCMinutes().toString().padStart(2, "0"))
        .replace("ss",   date.getUTCSeconds().toString().padStart(2, "0"))
        .replace("SSS",  date.getUTCMilliseconds().toString().padStart(3, "0"));
      return { __tag: "string", value: formatted };
    }

    default: return undefined;
  }
}

// ---------------------------------------------------------------------------
// Duration operations (Stage 1: Duration is milliseconds as Int)
// ---------------------------------------------------------------------------

export function makeDuration(ms: number): LogicNValue {
  const fields = new Map<string, LogicNValue>([
    ["__isDuration", { __tag: "bool", value: true }],
    ["__ms",         { __tag: "int",  value: Math.round(ms) }],
  ]);
  return { __tag: "record", fields };
}

function isDuration(v: LogicNValue): boolean {
  return v.__tag === "record" && (v.fields.get("__isDuration") as { __tag: "bool"; value: boolean } | undefined)?.value === true;
}

function durMs(v: LogicNValue): number {
  if (v.__tag === "record") {
    const ms = v.fields.get("__ms");
    if (ms?.__tag === "int") return ms.value;
  }
  return 0;
}

function durationStatic(method: string, args: readonly LogicNValue[]): LogicNValue | undefined {
  const n = numVal(args[0] ?? { __tag: "int", value: 0 });
  switch (method) {
    case "ofMs":
    case "ms":         return makeDuration(n);
    case "ofSeconds":
    case "seconds":    return makeDuration(n * 1000);
    case "ofMinutes":
    case "minutes":    return makeDuration(n * 60000);
    case "ofHours":
    case "hours":      return makeDuration(n * 3600000);
    case "ofDays":
    case "days":       return makeDuration(n * 86400000);
    case "zero":       return makeDuration(0);
    default:           return undefined;
  }
}

function durationMethod(
  receiver: LogicNValue,
  method: string,
  args: readonly LogicNValue[],
): LogicNValue | undefined {
  if (!isDuration(receiver)) return undefined;
  const ms = durMs(receiver);

  switch (method) {
    case "toMs":        return { __tag: "int", value: ms };
    case "toSeconds":   return { __tag: "int", value: Math.floor(ms / 1000) };
    case "toMinutes":   return { __tag: "int", value: Math.floor(ms / 60000) };
    case "toHours":     return { __tag: "int", value: Math.floor(ms / 3600000) };
    case "toString": {
      if (ms < 1000) return { __tag: "string", value: `${ms}ms` };
      if (ms < 60000) return { __tag: "string", value: `${(ms / 1000).toFixed(1)}s` };
      if (ms < 3600000) return { __tag: "string", value: `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s` };
      return { __tag: "string", value: `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m` };
    }
    case "add": {
      const other = args[0] ?? LLN_VOID;
      const otherMs = isDuration(other) ? durMs(other) : numVal(other);
      return makeDuration(ms + otherMs);
    }
    case "subtract": {
      const other = args[0] ?? LLN_VOID;
      const otherMs = isDuration(other) ? durMs(other) : numVal(other);
      return makeDuration(ms - otherMs);
    }
    case "isZero":  return { __tag: "bool", value: ms === 0 };
    case "isNeg":   return { __tag: "bool", value: ms < 0 };
    case "abs":     return makeDuration(Math.abs(ms));
    default:        return undefined;
  }
}

// ---------------------------------------------------------------------------
// Error type constructors (ApiError, ValidationError, etc.)
// ---------------------------------------------------------------------------

function errorConstructor(typeName: string, method: string, args: readonly LogicNValue[]): LogicNValue {
  const msg = strVal(args[0] ?? { __tag: "string", value: method });
  const code = method === "notFound" ? 404
    : method === "badRequest" ? 400
    : method === "unauthorized" ? 401
    : method === "forbidden" ? 403
    : method === "internal" ? 500
    : method === "conflict" ? 409
    : method === "tooManyRequests" ? 429
    : 500;

  const fields = new Map<string, LogicNValue>([
    ["__isError",    { __tag: "bool",   value: true }],
    ["__errorType",  { __tag: "string", value: typeName }],
    ["__httpStatus", { __tag: "int",    value: code }],
    ["message",      { __tag: "string", value: msg }],
    ["type",         { __tag: "string", value: method }],
  ]);
  return { __tag: "record", fields };
}

// ---------------------------------------------------------------------------
// Result/Option higher-order combinators
// ---------------------------------------------------------------------------

async function resultCombinator(method: string, args: readonly LogicNValue[], ctx: StdlibContext): Promise<LogicNValue | undefined> {
  switch (method) {
    case "sequence": {
      // Result.sequence(arr: Array<Result<T,E>>) -> Result<Array<T>, E>
      const arr = asList(args[0] ?? LLN_VOID);
      const values: LogicNValue[] = [];
      for (const item of arr) {
        if (item.__tag === "err") return item;  // first error short-circuits
        if (item.__tag === "ok") values.push(item.value);
        else values.push(item);  // bare value
      }
      return ok({ __tag: "list", items: values });
    }
    case "fromNullable": {
      const v = args[0] ?? LLN_NONE;
      const errVal = args[1] ?? { __tag: "string", value: "null value" };
      if (v.__tag === "none" || v.__tag === "void") return { __tag: "err", error: errVal };
      return ok(v);
    }
    case "all": {
      // alias for sequence
      return resultCombinator("sequence", args, ctx);
    }
    default: return undefined;
  }
}

async function optionCombinator(method: string, args: readonly LogicNValue[], ctx: StdlibContext): Promise<LogicNValue | undefined> {
  switch (method) {
    case "sequence": {
      // Option.sequence(arr: Array<Option<T>>) -> Option<Array<T>>
      const arr = asList(args[0] ?? LLN_VOID);
      const values: LogicNValue[] = [];
      for (const item of arr) {
        if (item.__tag === "none") return LLN_NONE;
        if (item.__tag === "some") values.push(item.value);
        else values.push(item);
      }
      return mkSome({ __tag: "list", items: values });
    }
    case "fromNullable": {
      const v = args[0] ?? LLN_NONE;
      if (v.__tag === "none" || v.__tag === "void") return LLN_NONE;
      return mkSome(v);
    }
    case "zip": {
      // Option.zip(a, b) -> Option<{first, second}>
      const a = args[0] ?? LLN_NONE;
      const b = args[1] ?? LLN_NONE;
      if (a.__tag === "none" || b.__tag === "none") return LLN_NONE;
      const aVal = a.__tag === "some" ? a.value : a;
      const bVal = b.__tag === "some" ? b.value : b;
      const fields = new Map<string, LogicNValue>([["first", aVal], ["second", bVal]]);
      return mkSome({ __tag: "record", fields });
    }
    default: return undefined;
  }
}

// ---------------------------------------------------------------------------
// Numeric formatting (missing: Int.toString, Float.toString, Decimal.toFixed)
// ---------------------------------------------------------------------------

function numericMethod(
  receiver: LogicNValue,
  method: string,
  args: readonly LogicNValue[],
): LogicNValue | undefined {
  if (receiver.__tag !== "int" && receiver.__tag !== "float" && receiver.__tag !== "decimal") return undefined;

  switch (method) {
    case "toString":
    case "toText": {
      if (receiver.__tag === "int") return { __tag: "string", value: receiver.value.toString() };
      if (receiver.__tag === "float") return { __tag: "string", value: receiver.value.toString() };
      return { __tag: "string", value: receiver.value };  // decimal already string
    }
    case "toFixed": {
      const places = numVal(args[0] ?? { __tag: "int", value: 2 });
      const n = receiver.__tag === "decimal" ? parseFloat(receiver.value) : (receiver.value as number);
      return { __tag: "string", value: n.toFixed(places) };
    }
    case "toPlaces": {
      const places = numVal(args[0] ?? { __tag: "int", value: 2 });
      const n = receiver.__tag === "decimal" ? parseFloat(receiver.value) : (receiver.value as number);
      return { __tag: "decimal", value: n.toFixed(places) };
    }
    case "abs": {
      if (receiver.__tag === "int")     return { __tag: "int",     value: Math.abs(receiver.value) };
      if (receiver.__tag === "float")   return { __tag: "float",   value: Math.abs(receiver.value) };
      if (receiver.__tag === "decimal") return { __tag: "decimal", value: Math.abs(parseFloat(receiver.value)).toString() };
      return receiver;
    }
    case "floor":   return { __tag: "int", value: Math.floor(numVal(receiver)) };
    case "ceil":    return { __tag: "int", value: Math.ceil(numVal(receiver)) };
    case "round":   return { __tag: "int", value: Math.round(numVal(receiver)) };
    case "clamp": {
      const lo = numVal(args[0] ?? { __tag: "int", value: 0 });
      const hi = numVal(args[1] ?? { __tag: "int", value: 100 });
      const n  = numVal(receiver);
      const clamped = Math.min(Math.max(n, lo), hi);
      return receiver.__tag === "float" ? { __tag: "float", value: clamped } : { __tag: "int", value: clamped };
    }
    case "sign": {
      const n = numVal(receiver);
      return { __tag: "int", value: n > 0 ? 1 : n < 0 ? -1 : 0 };
    }
    default: return undefined;
  }
}

// ---------------------------------------------------------------------------
// Phase R2A — Tensor module: real TypedArray-backed operations
//
// Tensors are represented as LogicNValue with __tag "list" (or "array" alias).
// Each element is expected to be an int or float LogicNValue.
// ---------------------------------------------------------------------------

function getNumericItems(v: LogicNValue): number[] | undefined {
  if (v.__tag !== "list") return undefined;
  return v.items.map((item) => numVal(item));
}

function tensorModule(method: string, args: readonly LogicNValue[]): LogicNValue | undefined {
  const v = args[0];
  if (v === undefined) return undefined;

  switch (method) {
    // Tensor.relu(v) — max(0, x) element-wise
    case "relu": {
      const nums = getNumericItems(v);
      if (nums === undefined) return undefined;
      const buf = new Float64Array(nums);
      const result: LogicNValue[] = [];
      for (let i = 0; i < buf.length; i++) {
        const x = buf[i]!;
        result.push({ __tag: "float", value: x > 0 ? x : 0 });
      }
      return { __tag: "list", items: result };
    }

    // Tensor.dot(a, b) — sum of element-wise products
    case "dot": {
      const a = getNumericItems(v);
      const bArg = args[1];
      if (a === undefined || bArg === undefined) return undefined;
      const b = getNumericItems(bArg);
      if (b === undefined) return undefined;
      const len = Math.min(a.length, b.length);
      const bufA = new Float64Array(a);
      const bufB = new Float64Array(b);
      let sum = 0;
      for (let i = 0; i < len; i++) {
        sum += (bufA[i]!) * (bufB[i]!);
      }
      return { __tag: "float", value: sum };
    }

    // Tensor.softmax(v) — exp(x_i) / sum(exp(x_j))
    case "softmax": {
      const nums = getNumericItems(v);
      if (nums === undefined) return undefined;
      const buf = new Float64Array(nums);
      // Numerical stability: subtract max before exp
      let maxVal = -Infinity;
      for (let i = 0; i < buf.length; i++) {
        if ((buf[i]!) > maxVal) maxVal = buf[i]!;
      }
      const expBuf = new Float64Array(buf.length);
      let expSum = 0;
      for (let i = 0; i < buf.length; i++) {
        expBuf[i] = Math.exp((buf[i]!) - maxVal);
        expSum += expBuf[i]!;
      }
      // #55: an empty / all-(-Inf) input gives expSum 0 → x/0 = NaN; fail closed rather than return a list of
      // silent NaN "probabilities" that pass every guard.
      if (expSum === 0 || !Number.isFinite(expSum)) return { __tag: "runtimeError", message: "NonFiniteFloat" };
      const result: LogicNValue[] = [];
      for (let i = 0; i < expBuf.length; i++) {
        result.push(floatVal((expBuf[i]!) / expSum));
      }
      return { __tag: "list", items: result };
    }

    // Tensor.scale(v, factor) — multiply each element by scalar factor
    case "scale": {
      const nums = getNumericItems(v);
      const factorArg = args[1];
      if (nums === undefined || factorArg === undefined) return undefined;
      const factor = numVal(factorArg);
      const buf = new Float64Array(nums);
      const result: LogicNValue[] = [];
      for (let i = 0; i < buf.length; i++) {
        result.push({ __tag: "float", value: (buf[i]!) * factor });
      }
      return { __tag: "list", items: result };
    }

    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Phase R2B — Crypto module: real constant-time equality via node:crypto
// ---------------------------------------------------------------------------

/**
 * Constant-time string equality via node:crypto `timingSafeEqual` — the SINGLE source of truth
 * for `constantTimeEquals` everywhere (the interpreter + both stdlib dispatch paths). The bare
 * `constantTimeEquals` impls used a short-circuiting `===` (threat-model H7 timing side-channel),
 * which is doubly wrong because LLN-TYPE-013 actively tells authors to "Use constantTimeEquals()
 * for equality" on secrets — the recommended path MUST actually be constant-time. Both inputs are
 * padded to equal length so the compare time is independent of where they first differ AND of
 * their lengths; a true length difference still yields false, checked AFTER the timing-safe compare
 * (never as an early short-circuit). Fail-closed: any error → not-equal, never a `===` fallback.
 */
export function constantTimeStringEquals(aStr: string, bStr: string): boolean {
  try {
    const maxLen = Math.max(aStr.length, bStr.length);
    const enc = new TextEncoder();
    const bufA = enc.encode(aStr.padEnd(maxLen, "\0"));
    const bufB = enc.encode(bStr.padEnd(maxLen, "\0"));
    // Equal-length buffers → timingSafeEqual cannot throw on length; constant-time over the bytes.
    const timingEqual = _nodeCryptoTimingSafeEqual(bufA, bufB);
    return timingEqual && aStr.length === bStr.length;
  } catch {
    return false; // fail closed — never fall back to a non-constant-time `===`
  }
}

function cryptoModule(method: string, args: readonly LogicNValue[]): LogicNValue | undefined {
  switch (method) {
    case "constantTimeEquals": {
      const aArg = args[0] ?? LLN_VOID;
      const bArg = args[1] ?? LLN_VOID;
      const aStr = aArg.__tag === "secure" ? aArg.value : strVal(aArg);
      const bStr = bArg.__tag === "secure" ? bArg.value : strVal(bArg);
      return { __tag: "bool", value: constantTimeStringEquals(aStr, bStr) };
    }
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Phase 34 — BCrypt module: real bcrypt password verification via bcryptjs
//
// BCrypt.verify(plaintext, hash) -> Bool   — constant-time bcrypt comparison
// BCrypt.hash(plaintext, rounds?) -> String — produce a $2b$ hash (for fixtures/tools)
//
// SECURITY: BCrypt.verify is registered as an untaint boundary for password
// comparison — it accepts a raw (tainted) plaintext password by design, since
// comparing against a stored hash is the whole point. The plaintext never
// reaches any other sink. bcryptjs.compareSync is constant-time internally.
// ---------------------------------------------------------------------------

function bcryptModule(method: string, args: readonly LogicNValue[]): LogicNValue | undefined {
  switch (method) {
    case "verify": {
      // verify(plaintext, hash) -> Bool
      const plainArg = args[0] ?? LLN_VOID;
      const hashArg  = args[1] ?? LLN_VOID;
      const plain = plainArg.__tag === "secure" ? plainArg.value : strVal(plainArg);
      const hash  = hashArg.__tag === "secure"  ? hashArg.value  : strVal(hashArg);
      try {
        return { __tag: "bool", value: bcrypt.compareSync(plain, hash) };
      } catch {
        // Malformed hash → not a match (never throw out of the sink)
        return { __tag: "bool", value: false };
      }
    }
    case "hash": {
      // hash(plaintext, rounds?) -> String
      const plainArg = args[0] ?? LLN_VOID;
      const plain = plainArg.__tag === "secure" ? plainArg.value : strVal(plainArg);
      const rounds = args[1]?.__tag === "int" ? Number(args[1].value) : 10;
      try {
        return { __tag: "string", value: bcrypt.hashSync(plain, rounds) };
      } catch (e) {
        return err(`BCryptError: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Phase 36 — Argon2 module: Argon2id (OWASP preferred) password hashing
// ---------------------------------------------------------------------------

async function argon2Module(method: string, args: readonly LogicNValue[]): Promise<LogicNValue | undefined> {
  const a2 = await _argon2Import;
  switch (method) {
    case "verify": {
      const plainArg = args[0] ?? LLN_VOID;
      const hashArg  = args[1] ?? LLN_VOID;
      const plain = plainArg.__tag === "secure" ? plainArg.value : strVal(plainArg);
      const hash  = hashArg.__tag === "secure"  ? hashArg.value  : strVal(hashArg);
      try {
        return { __tag: "bool", value: await a2.verify(hash, plain) };
      } catch {
        return { __tag: "bool", value: false };
      }
    }
    case "hash": {
      const plainArg = args[0] ?? LLN_VOID;
      const plain = plainArg.__tag === "secure" ? plainArg.value : strVal(plainArg);
      try {
        return { __tag: "string", value: await a2.hash(plain, { type: a2.argon2id }) };
      } catch (e) {
        return err(`Argon2Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Phase 35 — Password module: stable facade over the hash backend.
//
// Password.verify(plain, hash) -> Bool    — detects algo from hash prefix, delegates
// Password.hash(plain)         -> String  — hashes with the current preferred algo
// Password.needsMigration(hash) -> Bool   — true when hash uses a weaker algo
//
// Phase 34: backend = bcrypt    ($2b$...)
// Phase 36: preferred = Argon2id ($argon2id$...) — bcrypt still verified for migration
// Phase 37: Password.migrate(plain, oldHash) re-hashes to current preferred algo
//
// This is the stable call site: flows written with Password.* never change across phases.
// ---------------------------------------------------------------------------

async function passwordModule(method: string, args: readonly LogicNValue[]): Promise<LogicNValue | undefined> {
  switch (method) {
    case "verify": {
      const plainArg = args[0] ?? LLN_VOID;
      const hashArg  = args[1] ?? LLN_VOID;
      const plain = plainArg.__tag === "secure" ? plainArg.value : strVal(plainArg);
      const hash  = hashArg.__tag === "secure"  ? hashArg.value  : strVal(hashArg);
      // Route by hash prefix
      if (hash.startsWith("$argon2")) {
        return argon2Module("verify", [{ __tag: "string", value: plain }, { __tag: "string", value: hash }]);
      }
      // Default: bcrypt ($2b$, $2a$, $2y$)
      return bcryptModule("verify", [{ __tag: "string", value: plain }, { __tag: "string", value: hash }]);
    }
    case "hash": {
      // Phase 36: default to Argon2id (OWASP preferred)
      const plainArg = args[0] ?? LLN_VOID;
      return argon2Module("hash", [plainArg]);
    }
    case "needsMigration": {
      // Returns true when the stored hash uses a weaker algorithm (bcrypt) vs current preferred
      const hashArg = args[0] ?? LLN_VOID;
      const hash = hashArg.__tag === "secure" ? hashArg.value : strVal(hashArg);
      const isBcrypt = hash.startsWith("$2");
      return { __tag: "bool", value: isBcrypt };
    }
    case "migrate": {
      // Phase 37: verify with old hash, then re-hash with current preferred if valid.
      // Returns { migrated: Bool, newHash: String }
      const plainArg = args[0] ?? LLN_VOID;
      const oldHashArg = args[1] ?? LLN_VOID;
      const plain   = plainArg.__tag === "secure" ? plainArg.value : strVal(plainArg);
      const oldHash = oldHashArg.__tag === "secure" ? oldHashArg.value : strVal(oldHashArg);
      // Verify against old hash
      let verified = false;
      if (oldHash.startsWith("$argon2")) {
        const v = await argon2Module("verify", [{ __tag: "string", value: plain }, { __tag: "string", value: oldHash }]);
        verified = v?.__tag === "bool" ? v.value : false;
      } else {
        try { verified = bcrypt.compareSync(plain, oldHash); } catch { verified = false; }
      }
      if (!verified) {
        const fields = new Map<string, LogicNValue>([
          ["migrated", { __tag: "bool", value: false }],
          ["newHash",  { __tag: "string", value: "" }],
        ]);
        return { __tag: "record", fields };
      }
      // Hash with new preferred algorithm (Argon2id)
      const newHashResult = await argon2Module("hash", [{ __tag: "string", value: plain }]);
      const newHash = newHashResult?.__tag === "string" ? newHashResult.value : oldHash;
      const fields = new Map<string, LogicNValue>([
        ["migrated", { __tag: "bool", value: true }],
        ["newHash",  { __tag: "string", value: newHash }],
      ]);
      return { __tag: "record", fields };
    }
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Phase R2C — Hash module: real SHA-256/SHA-512 via node:crypto
// ---------------------------------------------------------------------------

function hashModule(method: string, args: readonly LogicNValue[]): LogicNValue | undefined {
  switch (method) {
    case "sha256": {
      const input = args[0] ?? LLN_VOID;
      const data = input.__tag === "bytes"
        ? input.value
        : new TextEncoder().encode(strVal(input));
      const hex = _nodeCryptoCreateHash("sha256").update(data).digest("hex");
      return { __tag: "string", value: `sha256:${hex}` };
    }

    case "sha512": {
      const input = args[0] ?? LLN_VOID;
      const data = input.__tag === "bytes"
        ? input.value
        : new TextEncoder().encode(strVal(input));
      const hex = _nodeCryptoCreateHash("sha512").update(data).digest("hex");
      return { __tag: "string", value: `sha512:${hex}` };
    }

    default:
      return undefined;
  }
}

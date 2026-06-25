# Faithful Int64 lowering — exhaustive site map + phased plan (2026-06-25)

**Goal:** lift scalar `Int64` from the `LLN-NUMERIC-001` fail-close gate by making it faithfully
lowered end-to-end (no silent 64→32 truncation, CWE-704). `UInt64` stays gated (distinct unsigned
div/compare semantics) until its own layer lands.

**Status:** Increment 1 SHIPPED — `i64-arith.ts` (checked bigint add/sub/mul/div_s/rem_s/neg, traps on
overflow / div-0 / INT64_MIN÷-1; matches WASM `i64.div_s`/`rem_s`). Tests `i64-arith.test.mjs` 10/10.
Increments 2–3 below are pending.

**Load-bearing rule:** every site is a potential fail-open. A missed emitter/interpreter site silently
truncates an Int64 to 32 bits. So **keep `LLN-NUMERIC-001` rejecting `Int64` until BOTH the interpreter
and the emitter are faithful** (verified by integration tests). Lift the gate LAST.

**The hard part (literal typing):** a bare `5` in `let x: Int64 = 5` is a plain `numberLiteral` with no
syntactic marker. Int64 literals are **type-annotation-driven**: the let-decl / param / return handlers
must coerce/extend the value (interpreter: tag as `int64`/`bigint`; emitter: emit `i64.const` or
`i64.extend_i32_s`) based on the declared type. Threading the declared type to the literal site is the
core of the work.

## Increment 2a — interpreter (tree-walker) faithful Int64

| Site | File:line | Change |
|------|-----------|--------|
| value tag | interpreter.ts:20-43 | add `{ __tag:"int64", value: bigint }` |
| imports | interpreter.ts:~18 | import i64-arith (`i64AddChecked`…`isI64Trap`, `I64Result`) |
| result helper | interpreter.ts (near `i32R` ~68) | add `i64R(r)` → trap→runtimeError, else int64 tag |
| literal creation | interpreter.ts:462-465, 821-828, 1380-1387 | type-annotation-driven: Int64 binding/param → `BigInt(raw)` int64 tag |
| dispatchKey | interpreter.ts:96-100 | add an int64 tag id (e.g. 5) |
| BINARY_DISPATCH | interpreter.ts:110-167 | int64×int64 entries (+ − * / % < ≤ > ≥ == !=) via i64-arith; mixed int×int64 promote int→bigint |
| fallback arith | interpreter.ts:513-517 | `bothInt64` branch → i64 checked ops |
| unary neg | interpreter.ts:527 | int64 case → `i64NegChecked` |
| display/coerce | interpreter.ts (toString / Number) | int64 → decimal string; NEVER `Number()` a bigint |

## Increment 2b — WASM emitter faithful Int64

| Site | File:line | Change |
|------|-----------|--------|
| return valtype | wat-emitter.ts:2996 | use `logicNTypeToWAT(declaredReturn)` (already maps Int64→i64) not the hardcoded i32 default |
| local valtype | wat-emitter.ts:1627 | Int64 annotation → `i64` local |
| param valtype | wat-emitter.ts:2898-2901 | **already correct** (uses logicNTypeToWAT) ✓ |
| binary-op routing | wat-emitter.ts:1120-1162 | add `INT64_WAT_TYPES` check before the float check; route to i64 ops |
| i64 op maps | wat-emitter.ts:746-765 (sibling) | `INT64_ARITH_WAT` (+−* → `$lln_checked_*_i64`, / % → `i64.div_s`/`i64.rem_s`) + `INT64_CMP_WAT` (lt_s/…/eq/ne → result i32) |
| integer literal | wat-emitter.ts:1103-1109 | Int64-typed literal → `i64.const` (needs the inferred/declared type at the node) |
| checked helpers | wat-emitter.ts:803-828 | add `$lln_checked_add/sub/mul_i64` (overflow via sign-bit test, mirror i64-arith) |
| mixed-width | wat-emitter.ts:1122-1160 | int operand mixed with int64 → `i64.extend_i32_s`; i64→i32 only via explicit truncation (fail-closed) |
| watStackType | wat-emitter.ts:783-792 | already returns i64 for `i64.*`; add a rule so `(call $lln_checked_*_i64 …)` → i64 |
| inferExprType | wat-emitter.ts:~975 | currently `Int`/`Float` only — must discriminate Int64 to drive literal + op selection |

## Increment 3 — gate lift + type-checker promotion

| Site | File:line | Change |
|------|-----------|--------|
| gate set | value-state-checker.ts:~1990 | remove `"Int64"` from `BACKEND_UNLOWERABLE_SCALAR` (KEEP `"UInt64"`); update comment + LLN-NUMERIC-001 doc/tests |
| mixed-width promotion | type-checker.ts:880-883 | add `if (leftType==="Int64" \|\| rightType==="Int64") return "Int64"` so Int+Int64 widens to Int64 |
| `NUMERIC_TYPES` | type-checker.ts:153-157 | Int64 already present ✓ |

**Lift criteria (all must hold before removing Int64 from the gate):** interpreter Int64 literal/arith/mixed/neg/compare correct; emitter Int64 param/local/return/literal/binop/mixed all emit i64 (not i32); checked i64 helpers injected; a fused Int64 module validates + runs; 0014 walker≡WASM differential holds for an Int64 corpus.

**UInt64 stays deferred** — unsigned needs `i64.div_u`/`lt_u` + a `u64-arith.ts` (0..2^64-1 wrap); it remains fail-closed under LLN-NUMERIC-001 until then.

Source: exhaustive read-only mapping pass 2026-06-25 (verified against live src).

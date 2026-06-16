# LogicN — Operator Precedence

## Status

```
Phase 5 prerequisite
Source of truth for the expression parser
```

This document is the authoritative table for LogicN operator precedence and
associativity. The Phase 5 expression parser must be built from this table.
No operator may be added without a corresponding entry here.

---

## Rules at a Glance

- Higher precedence number = tighter binding (e.g. `*` at 60 binds tighter than `+` at 50)
- All infix operators are **left-associative** except unary prefix operators (right-associative)
- `||`=10 · `&&`=20 · `==`/`!=`=30 · comparisons=40 · `+`/`-`=50 · `*`/`/`/`%`=60 · unary=70 · postfix=80
- `<` and `>` are comparison operators in expression position; in type position they are generic brackets
- `?` is a postfix error-propagation operator — binds tighter than all infix operators
- No `++`/`--`, no ternary `? :`, no assignment expressions (only assignment statements)
- `|>` pipeline operator is reserved but not active in v1

---

## Design Decision: Table-Driven Pratt Parser

Phase 5 uses a **table-driven Pratt (top-down operator precedence) parser**
for all expression parsing.

Reasons:

- Precedence is auditable from a single table rather than scattered across
  recursive-descent call depth.
- Adding new operators only requires a new table entry — no parser restructuring.
- Pratt parsing composes cleanly with prefix/infix/postfix categories.
- The table is machine-readable, making it available for AI context and
  generated documentation.

The Phase 4 expression parser uses an ad-hoc call hierarchy
(`parseComparison → parseAdditive → parseUnary → parsePostfix → parsePrimary`).
Phase 5 replaces that with a single `parseExpression(minPrecedence)` loop
driven by this table.

---

## Precedence Levels

Higher number = tighter binding. Operators at the same level use the stated
associativity to resolve ties.

| Level | Operator(s) | Associativity | AST node kind | Notes |
|---|---|---|---|---|
| 10 | `\|\|` | left | `binaryExpr` (op=`\|\|`) | Logical OR |
| 20 | `&&` | left | `binaryExpr` (op=`&&`) | Logical AND |
| 30 | `==` `!=` | left | `binaryExpr` | Equality |
| 40 | `<` `<=` `>` `>=` | left | `binaryExpr` | Comparison |
| 50 | `+` `-` | left | `binaryExpr` | Additive |
| 60 | `*` `/` `%` | left | `binaryExpr` | Multiplicative |
| 70 | `!` `-` (unary) | right (prefix) | `unaryExpr` | Unary prefix |
| 80 | `.` (member) `()` (call) `?` (error-prop) | left (postfix) | `memberExpr` / `callExpr` / `errorPropagation` | Postfix |

---

## TypeScript Table (source of truth for the parser)

```typescript
export type Associativity = "left" | "right";

export interface OperatorEntry {
  readonly precedence: number;
  readonly associativity: Associativity;
  readonly astKind: string;
}

export const INFIX_OPERATOR_TABLE: Readonly<Record<string, OperatorEntry>> = {
  "||": { precedence: 10, associativity: "left",  astKind: "binaryExpr" },
  "&&": { precedence: 20, associativity: "left",  astKind: "binaryExpr" },
  "==": { precedence: 30, associativity: "left",  astKind: "binaryExpr" },
  "!=": { precedence: 30, associativity: "left",  astKind: "binaryExpr" },
  "<":  { precedence: 40, associativity: "left",  astKind: "binaryExpr" },
  "<=": { precedence: 40, associativity: "left",  astKind: "binaryExpr" },
  ">":  { precedence: 40, associativity: "left",  astKind: "binaryExpr" },
  ">=": { precedence: 40, associativity: "left",  astKind: "binaryExpr" },
  "+":  { precedence: 50, associativity: "left",  astKind: "binaryExpr" },
  "-":  { precedence: 50, associativity: "left",  astKind: "binaryExpr" },
  "*":  { precedence: 60, associativity: "left",  astKind: "binaryExpr" },
  "/":  { precedence: 60, associativity: "left",  astKind: "binaryExpr" },
  "%":  { precedence: 60, associativity: "left",  astKind: "binaryExpr" },
} as const;

export const PREFIX_OPERATOR_TABLE: Readonly<Record<string, OperatorEntry>> = {
  "!":  { precedence: 70, associativity: "right", astKind: "unaryExpr" },
  "-":  { precedence: 70, associativity: "right", astKind: "unaryExpr" },
} as const;
```

Postfix operators (`.`, `()`, `?`) are handled separately in `parsePostfix()`
because they bind to the left side of an already-parsed expression and do
not fit a simple precedence integer.

---

## Precedence Examples

### Multiplicative tighter than additive

```logicn
a + b * c
```

Parses as:

```
a + (b * c)
```

### Parentheses override precedence

```logicn
(a + b) * c
```

Parses as:

```
(a + b) * c
```

### Logical AND tighter than logical OR

```logicn
a || b && c
```

Parses as:

```
a || (b && c)
```

### Comparison tighter than equality

```logicn
a == b < c
```

Parses as:

```
a == (b < c)
```

### Unary minus

```logicn
-a * b
```

Parses as:

```
(-a) * b
```

### Error propagation binds tightest

```logicn
validate.email(raw)?
```

Parses as:

```
(validate.email(raw))?
```

### Member access chain

```logicn
user.profile.email
```

Parses as:

```
(user.profile).email
```

---

## Pratt Parser Algorithm

The Pratt loop in pseudocode:

```
parseExpression(minPrecedence):
  left = parsePrimary()     // or parsePrefix() for unary operators

  loop:
    op = currentToken()
    entry = INFIX_OPERATOR_TABLE[op.value]
    if entry is undefined: break
    if entry.precedence < minPrecedence: break

    advance()               // consume operator

    // Right-associative: recurse with same level
    // Left-associative: recurse with level + 1
    nextMin = entry.associativity == "left"
                ? entry.precedence + 1
                : entry.precedence
    right = parseExpression(nextMin)

    left = { kind: entry.astKind, value: op.value, children: [left, right] }

  return left
```

---

## Currently Excluded Operators (Phase 5)

These operators are NOT in the Phase 5 table. They are reserved for later phases:

| Operator | Reserved use |
|---|---|
| `=` | Assignment (statement-level, not expression) |
| `->` | Flow return type arrow (declaration-level) |
| `=>` | Match arm arrow (match expression-level) |
| `..` | Range operator (future) |
| `&` `\|` `^` `~` `<<` `>>` | **Bitwise — permanently excluded from `.lln` (NOT "future").** Bit-level math lives in the engine/extension layer (the crypto-on-core boundary); the lexer rejects `^`/`~` with a descriptive hint (`lexer.ts:790`). See `logicn-issues/0002` reframed as a design boundary, not a pending feature. |
| `%` | Present in table but not in Phase 4 lexer ONE_CHAR_OPERATORS — add when needed |

---

## Edge Cases

### Generic type arguments vs comparison

`<` and `>` also appear in type references (`Result<T, E>`). The parser must
distinguish context:

- After a type-position token (identifier following `->`, `:`, or `as`):
  parse as generic arguments.
- After a value-position expression: parse as comparison operator.

The Phase 4 `parseTypeRef()` handles this by counting angle-bracket depth
separately. The Pratt expression parser must not treat `<` as a comparison
operator inside a type reference.

### Unary minus vs subtraction

`-` appears in both the prefix table (unary minus) and the infix table
(subtraction). The parser disambiguates by position: if the previous token
was an operator, `(`, `,`, or start-of-expression, treat `-` as prefix.
Otherwise treat it as infix subtraction.

### Error propagation inside complex expressions

```logicn
let email = validate.email(raw)? || fallback
```

`?` binds tighter than `||`, so this parses as:

```
(validate.email(raw)?) || fallback
```

---

## Relationship to Phase 4

Phase 4 implemented a simplified ad-hoc precedence hierarchy sufficient to
parse the test suite. Phase 5 replaces that with the Pratt loop above.

The existing AST node kinds (`binaryExpr`, `unaryExpr`, `callExpr`,
`memberExpr`, `errorPropagation`) are preserved. Only the parsing mechanism
changes.

---

## Expression Diagnostics (LLN-EXPR-* series)

| Code | Name | Description |
|---|---|---|
| `LLN-EXPR-001` | `OperatorNotDefined` | Operator `op` is not defined for operand type(s) |
| `LLN-EXPR-002` | `InvalidPrefixOperand` | Prefix operator `op` cannot be applied to this operand type |
| `LLN-EXPR-003` | `SecretEqualityDenied` | `==` cannot be used on `secret protected` values; use `constantTimeEquals()` |
| `LLN-EXPR-004` | `UnsafeStatePropagation` | Result of expression is `unsafe` because operand `x` is `unsafe unvalidated` |
| `LLN-EXPR-005` | `PipelineTypeMismatch` | Pipeline stage output type does not match next stage input type |
| `LLN-EXPR-006` | `AssignmentInCondition` | Assignment `=` is not allowed inside `if`/`while` conditions; use `==` |
| `LLN-EXPR-007` | `EffectfulExpressionInPureFlow` | Effectful call inside a `pure flow` expression |

---

## Governance Implications of Operator Precedence

Operator precedence is not only a syntactic concern in LogicN — it affects
semantic legality, value-state propagation, and audit proof.

### Unsafe state propagation

If an `unsafe unvalidated` value is used in a binary expression, the result
inherits the unsafe state:

```logicn
let sql = "SELECT " + rawInput   // rawInput: String unsafe unvalidated
// sql is now: String unsafe tainted
// → LLN-EXPR-004 emitted, cannot reach database.write
```

### Short-circuit semantics

`&&` and `||` short-circuit. The right side only executes when the left
permits it. This is significant for effect ordering:

```logicn
validate.email(raw) && saveCustomer(email)
```

If `validate.email()` returns `false`, `saveCustomer()` never executes.
The audit system records which branch was taken.

### No assignment in conditionals

```logicn
if x = y { ... }   // LLN-EXPR-006 — did you mean ==?
```

Requires the explicit equality operator. This prevents accidental assignment
bugs that could bypass security conditions.

### No `++` / `--`

LogicN does not include increment/decrement operators. Explicit mutation is
required:

```logicn
mut count: Int = 0
count = count + 1   // clear mutation, auditable
```

### Pipeline operator (future)

The `|>` operator is reserved (not in Phase 5). When introduced, it will bind
lower than all arithmetic and comparison operators:

```logicn
input |> sanitize.text |> validate.email |> saveCustomer
```

The compiler will verify value-state transitions through the pipeline:
`unsafe unvalidated → safe validated → governed sink`.

---

## Restrictions in v1

- No user-defined operator overloading
- No `++` or `--`
- No assignment expressions (only assignment statements)
- No ternary operator `? :` (use `if/else` or `match`)
- `|>` pipeline is reserved, not yet active

---

## See Also

- `docs/Knowledge-Bases/parser-error-recovery.md` — sync token policy
- `docs/Knowledge-Bases/formal-type-system-spec.md` — types used in expressions
- `docs/Knowledge-Bases/value-state-annotations.md` — unsafe state propagation rules
- `packages-logicn/logicn-core-compiler/src/parser.ts` — Phase 4 implementation

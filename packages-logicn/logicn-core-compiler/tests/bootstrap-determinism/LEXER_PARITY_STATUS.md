# Stage B Lexer Parity Status

**Source under test:** `pure flow add(a: Int, b: Int) -> Int { return a }`
**Date assessed:** 2026-06-01 (updated Phase 25)
**Phase:** Phase 25 / R7A
**PARITY_ACHIEVED flag:** `true`

---

## ⭐ Current state (2026-06-06 · P9 #143/#189 — supersedes the Phase-25 framing below)

The "Remaining gaps (Gaps 2–5)" deferred below were **CLOSED** by the P9 tokenize byte-parity work:
`tokenize` now produces a **byte-for-byte identical token stream in the Stage-A interpreter AND in real
WASM** (through the #105 admission gate) over a **21-input corpus** exercising identifiers, keywords,
symbols, operators, numbers, **string literals, char literals, line/block comments, and escape sequences**
(`scanString` / `scanCharLit` / `scanComment` — #189). Proven by `tests/wat-p9-tokenize-parity.test.mjs`
(hard `deepEqual` assertions). So `PARITY_ACHIEVED=true` reflects the **full token-class corpus**, not just
the single `add` source the body below documents. Scope note: this is **`tokenize` only** — parser /
type-checker / governance-verifier WASM parity remain (they execute in Stage-A).

---

## Phase 25 Update (2026-06-01)

No regression. Parity status unchanged from R7A final:

- `PARITY_ACHIEVED = true` — all parity tests are hard assertions.
- All 19 token positions continue to match for the canonical test source.
- The lexer-parity test suite (`lexer-parity.test.mjs`) runs in the standard `npm test` pass.
- **No new token types tested in Phase 25** — Phase 25 focus was WASM auth scaffold (25A/25B).

Remaining gaps (Gaps 2–5, tracked below) are deferred to Phase 26 (parser.lln parity work).

---

---

## 1. TypeScript Lexer Output

Running `lex(source, "parity.lln")` on the source above produces **18 significant tokens**
(excluding the trailing `eof`), **19 total**:

| idx | kind       | value    |
|-----|------------|----------|
| 0   | keyword    | pure     |
| 1   | keyword    | flow     |
| 2   | identifier | add      |
| 3   | symbol     | (        |
| 4   | identifier | a        |
| 5   | symbol     | :        |
| 6   | identifier | Int      |
| 7   | symbol     | ,        |
| 8   | identifier | b        |
| 9   | symbol     | :        |
| 10  | identifier | Int      |
| 11  | symbol     | )        |
| 12  | **operator** | **->** |
| 13  | identifier | Int      |
| 14  | symbol     | {        |
| 15  | keyword    | return   |
| 16  | identifier | a        |
| 17  | symbol     | }        |
| 18  | eof        | (empty)  |

Total: **19 tokens** (18 significant + 1 eof).

Key observations:
- Kind names are **lowercase** (`keyword`, `identifier`, `symbol`, `operator`, `eof`).
- Multi-character operators such as `->`, `=>`, `==`, `!=`, `<=`, `>=`, `&&`, `||`
  are emitted as a **single `operator` token**.
- Number literals use kind `number` (not `NumberLiteral`).
- String literals use kind `string`; char literals use kind `char`.

---

## 2. lexer.lln Current Output

Running `tokenize(source)` via the interpreter on the same source produces
**18 significant tokens** (excluding the trailing `Eof`), **19 total**:

| idx | kind        | value    |
|-----|-------------|----------|
| 0   | Keyword     | pure     |
| 1   | Keyword     | flow     |
| 2   | Identifier  | add      |
| 3   | Symbol      | (        |
| 4   | Identifier  | a        |
| 5   | Symbol      | :        |
| 6   | Identifier  | Int      |
| 7   | Symbol      | ,        |
| 8   | Identifier  | b        |
| 9   | Symbol      | :        |
| 10  | Identifier  | Int      |
| 11  | Symbol      | )        |
| 12  | **Operator** | **->** |
| 13  | Identifier  | Int      |
| 14  | Symbol      | {        |
| 15  | Keyword     | return   |
| 16  | Identifier  | a        |
| 17  | Symbol      | }        |
| 18  | Eof         | (empty)  |

Total: **19 tokens** (18 significant + 1 Eof).

Status:
- lexer.lln **parses with zero errors**.
- lexer.lln **executes without runtime errors**.
- Output is an `Ok(Array<Token>)` as specified.
- **All 19 positions match the TypeScript lexer.**

---

## 3. Side-by-Side Comparison (from test run, Phase R7A final)

```
idx | TS lexer              | lexer.lln             | match?
----+----------------------+----------------------+-------
  0 | keyword:"pure"        | Keyword:"pure"        | OK
  1 | keyword:"flow"        | Keyword:"flow"        | OK
  2 | identifier:"add"      | Identifier:"add"      | OK
  3 | symbol:"("            | Symbol:"("            | OK
  4 | identifier:"a"        | Identifier:"a"        | OK
  5 | symbol:":"            | Symbol:":"            | OK
  6 | identifier:"Int"      | Identifier:"Int"      | OK
  7 | symbol:","            | Symbol:","            | OK
  8 | identifier:"b"        | Identifier:"b"        | OK
  9 | symbol:":"            | Symbol:":"            | OK
 10 | identifier:"Int"      | Identifier:"Int"      | OK
 11 | symbol:")"            | Symbol:")"            | OK
 12 | operator:"->"         | Operator:"->"         | OK
 13 | identifier:"Int"      | Identifier:"Int"      | OK
 14 | symbol:"{"            | Symbol:"{"            | OK
 15 | keyword:"return"      | Keyword:"return"      | OK
 16 | identifier:"a"        | Identifier:"a"        | OK
 17 | symbol:"}"            | Symbol:"}"            | OK
 18 | eof:""                | Eof:""                | OK

Summary: 19 matches, 0 mismatches out of 19 total positions
```

---

## 4. Fix Applied (Phase R7A)

### Root cause fixed: Multi-character operator splicing

**Was:** The `else` catch-all in `tokenize` emitted every non-alphanumeric,
non-whitespace character as a single `Symbol` token.  This caused `->` to
become `Symbol("-") + Symbol(">")`, shifting all subsequent positions by one
and producing 8 apparent mismatches from a single missing token.

**Fix:** Added `scanOperator(source, pos, srcLen) -> Array<String>` helper flow
to `lexer.lln`.  It peeks at the current and next character, checks against the
known two-char operator set (`->`, `=>`, `==`, `!=`, `<=`, `>=`, `&&`, `||`,
`..`, `::`, `//`, `/*`), and returns `[opString, endPos, isMultiChar]`.

The `else` branch in `tokenize` now calls `scanOperator` and emits `Operator`
kind for two-char matches, `Symbol` for single characters.

---

## 5. Remaining Known Gaps (not blocking parity for Level 1)

These gaps exist but do not affect the Level 1 test source and are deferred
to later phases:

### Gap 1 — Kind name casing (COSMETIC, normalised by test harness)

**Severity:** None for parity — the test normalises TS kinds to PascalCase.

The TS lexer uses lowercase kind names (`keyword`, `identifier`, `symbol`,
`operator`, `number`, `string`, `char`, `newline`, `eof`), while `lexer.lln`
uses PascalCase (`Keyword`, `Identifier`, `Symbol`, `Operator`, `NumberLiteral`,
`StringLiteral`, `CharLiteral`, `Newline`, `Eof`).

The PascalCase convention in `lexer.lln` is acceptable as the self-hosted
compiler defines its own IR.

### Gap 2 — String literals (NOT YET TESTED with this input)

**Severity:** Medium — `lexer.lln` has no string-scanning branch.

The `else` catch-all in `tokenize` would emit `Symbol('"')` for the opening
quote rather than scanning a full `StringLiteral`.  A `scanString()` helper
is needed.

### Gap 3 — Char literals (NOT YET TESTED with this input)

**Severity:** Medium — similar to Gap 2.

The single-quote character `'` would fall through to `Symbol("'")`.  A
`scanCharLiteral()` helper is needed.

### Gap 4 — Comment stripping (NOT YET TESTED with this input)

**Severity:** Low for basic parity, medium for full bootstrap.

The TS lexer strips `//` line comments and `/* */` block comments.  `lexer.lln`
would now emit `Operator("//")` and `Operator("/*")` for comment delimiters
rather than skipping the content.

### Gap 5 — Underscore in identifiers (NOT YET TESTED with this input)

**Severity:** Low.

The TS lexer allows `_` in identifiers (e.g. `my_var`).  `lexer.lln`'s
`scanWord` only advances on `isLetter() or isDigit()`, so an underscore would
terminate an identifier early.

---

## 6. What Works (Phase R7A complete)

- `lexer.lln` successfully parses and executes end-to-end.
- Keywords are correctly classified (`pure`, `flow`, `return` all detected).
- Identifiers are correctly scanned (`add`, `a`, `b`, `Int`).
- Number literals are correctly scanned with `scanDigits()`.
- Two-character operators are correctly detected with `scanOperator()`.
- `->` is emitted as a single `Operator` token, matching the TS lexer.
- Whitespace (space, tab, CR) is correctly skipped.
- Comma symbol `,` is correctly emitted.
- Newlines are correctly emitted as `Newline` tokens.
- EOF handling is correct in both code paths.
- Line/column tracking is implemented and carried through to each token.
- The `Result<Array<Token>, LexError>` return type is correctly constructed.
- **All 19 token positions (indices 0–18) match exactly with the TS lexer.**
- `PARITY_ACHIEVED = true` — all parity checks are now hard assertions.

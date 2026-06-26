// =============================================================================
// Galerina Phase 4 — Lexer
//
// Tokenises Galerina .spore source text using the v1 keyword table.
// Source of truth: docs/Knowledge-Bases/v1-reserved-keywords.md
//
// Types declared locally mirror @galerina/core — structurally compatible.
// Replace with workspace imports once package links are in place.
//
// Diagnostics emitted by this module:
//   SPORE-LEX-001  ExcessiveNesting      — generic type nesting depth > 8
//   SPORE-LEX-002  OversizedToken        — string literal or identifier > 10,000 chars
//   SPORE-LEX-003  InvalidUnicodeEscape  — invalid \u or \u{} in string literal
//   SPORE-LEX-004  FileTooLarge          — source file exceeds 10 MB
//   SPORE-LEX-005  LineTooLong           — a single line exceeds 10,000 characters
// =============================================================================

// ---------------------------------------------------------------------------
// Token types (mirrors @galerina/core)
// ---------------------------------------------------------------------------

export type TokenKind =
  | "identifier"
  | "keyword"
  | "string"
  | "char"
  | "number"
  | "boolean"
  | "operator"
  | "symbol"
  | "comment"
  | "docComment"
  | "govComment"   // ;; governance/system annotation — scanned by verifier + included in manifest
  | "genComment"   // //spore: CLI/compiler-GENERATED metadata (USES/USEDBY/COMPLEXITY/VOLATILITY/WARN) — tooling-owned, overwritable
  | "newline"
  | "eof";

/**
 * Numeric token kind IDs for fast internal comparison.
 *
 * The parser can compare `token.kindId === TokenKindId.Keyword` instead of
 * `token.kind === "keyword"` — avoids repeated string allocation and speeds up
 * the hot parser loop. The readable `kind` string is kept for diagnostics and
 * external API compatibility.
 *
 * Phase 19: parser will switch hot-path comparisons to kindId.
 * Phase 20: compact Int32Array token stream will use these IDs directly.
 */
export const TokenKindId = {
  Identifier: 0,
  Keyword:    1,
  String:     2,
  Char:       3,
  Number:     4,
  Boolean:    5,
  Operator:   6,
  Symbol:     7,
  Comment:    8,
  DocComment: 9,
  GovComment: 10,  // ;; system/governance annotation
  Newline:    11,
  Eof:        12,
  GenComment: 13,  // //spore: CLI/compiler-generated metadata (appended to preserve Newline=11/Eof=12 IDs)
} as const;
export type TokenKindIdValue = typeof TokenKindId[keyof typeof TokenKindId];

const TOKEN_KIND_ID_MAP: Readonly<Record<TokenKind, TokenKindIdValue>> = {
  identifier: TokenKindId.Identifier,
  keyword:    TokenKindId.Keyword,
  string:     TokenKindId.String,
  char:       TokenKindId.Char,
  number:     TokenKindId.Number,
  boolean:    TokenKindId.Boolean,
  operator:   TokenKindId.Operator,
  symbol:     TokenKindId.Symbol,
  comment:    TokenKindId.Comment,
  docComment: TokenKindId.DocComment,
  govComment: TokenKindId.GovComment,
  genComment: TokenKindId.GenComment,
  newline:    TokenKindId.Newline,
  eof:        TokenKindId.Eof,
};

export interface Token {
  readonly kind: TokenKind;
  /** Numeric token kind ID for fast parser comparisons. See TokenKindId. */
  readonly kindId: TokenKindIdValue;
  readonly value: string;
  /** 1-based start line number. */
  readonly line: number;
  /** 1-based start column number. */
  readonly column: number;
  /** 1-based end line number (inclusive). */
  readonly endLine: number;
  /** 1-based end column number (exclusive — points after last char). */
  readonly endColumn: number;
  /** Byte offset of token start (inclusive). */
  readonly start: number;
  /**
   * Byte offset of token end (exclusive — points after last character).
   * Equivalent to endOffset: the offset immediately after the last byte of this token.
   * Use `source.slice(token.start, token.end)` to recover the raw source text.
   */
  readonly end: number;
}

export interface LexerDiagnostic {
  readonly code: string;
  readonly name: string;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
  readonly location?: {
    readonly file: string;
    readonly line: number;
    readonly column: number;
  };
  readonly suggestedFix?: string;
}

export interface LexResult {
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly LexerDiagnostic[];
}

// ---------------------------------------------------------------------------
// V1 keyword sets
// Source: docs/Knowledge-Bases/v1-reserved-keywords.md
// ---------------------------------------------------------------------------

/** Keywords that are active in v0.1 and cannot be used as identifiers. */
export const V1_ACTIVE_KEYWORDS: ReadonlySet<string> = new Set([
  // Flow qualifiers + declaration
  "flow", "secure", "pure", "guarded", "privileged", "unsafe", "experimental",
  // Local helpers + external entry points
  "fn", "route",
  // Flow sub-declarations
  "effects", "with", "intent", "governance", "api", "package",
  // Governance declarations
  "authority", "policy", "guard",
  // v2.1 Tower-native declarations (#86)
  // `access {}` — inline capability negotiation block at the flow boundary (replaces inline `policy {}`)
  // `gate(cond) {}` — flow admission guard (V_DPM bit 8 = dag_edge_valid)
  // `static NAME = EXPR` — compile-time constant (zero memory overhead)
  // `bitfield NAME { field: BIT }` — type-safe V_DPM capability register
  "access", "gate", "static", "bitfield",
  // Binding
  "let", "mut", "readonly",
  // Control flow
  "match", "if", "else", "return", "while", "for", "where",
  // Declarations
  "type", "record", "enum", "import", "use",
  // Booleans
  "true", "false",
  // Memory keywords (Phase 3–4)
  "borrow", "move", "pinned",
  // Safety keywords
  "block", "fallback", "reason",
  // Value-state keywords (Phase 4)
  "safe", "validated", "unvalidated",
  // Value-state trust/secrecy markers (v1)
  "tainted", "secret", "protected", "redacted",
  // Compute target declarations and hardware preference hints (Phase 18)
  // Targets: npu, gpu, apu, wasm, photonic are tokenized as identifiers when
  // used as values (e.g. prefer [npu]) — they are NOT keywords.
  // Only the declaration forms are keywords.
  "compute", "target", "prefer",
  // Flow Contracts (Pilot Candidate) — docs/Knowledge-Bases/galerina-flow-contracts.md
  "contract", "emit", "emits", "event", "types",
  // Resource declarations (Phase 17)
  "resource",
  // Compile-time constants (allowed at top level; ordinary let/mut are not)
  "const",
  // Readable Logic Forms (Phase 9C) — promoted from future-reserved
  // See: docs/Knowledge-Bases/galerina-readable-logic-forms.md
  "and", "or", "unless", "is",
  // Guard match arms (Phase 41 syntax) — `when condition => body`
  "when",
  // Tower-native syntax primitives (task #76/#77 foundation)
  // `trap COND : ERR_CODE` — hardware trap if condition is TRUE
  "trap",
  // `governed <floor> flow ...` — Tower floor qualifier for DAG_CHECK (bit 8)
  "governed",
  // Note: "rules", "audit", "set" are intentionally NOT keywords — they are too
  // common as identifier names and are handled contextually in the contract parser.
  // import plugin assimilate — Hot-Code Residency directive
  "assimilate",
]);

/** Words reserved for post-v1 grammar — produce SPORE-SYNTAX-003 if used as identifiers. */
export const V1_FUTURE_RESERVED: ReadonlySet<string> = new Set([
  // Note: "remote" is intentionally NOT in this set — it is a valid compute-target
  // capability name used in: compute target best { deny [remote.execution] }
  "shared", "transfer", "atomic", "barrier",
  "async", "await", "yield", "comptime", "macro",
  "trait", "impl", "loop",
  "break", "continue",
  // Readable Logic Forms (proposal) — "until" still reserved for future use
  // See: docs/Knowledge-Bases/galerina-readable-logic-forms.md
  // Note: "and", "or", "unless", "is" promoted to V1_ACTIVE_KEYWORDS in Phase 9C
  "until",
]);

/**
 * Words that will NEVER become Galerina keywords because they conflict with the
 * governance model, no-monkey-patching rule, or deterministic execution model.
 *
 * These are NOT reserved by the lexer — they remain valid identifiers.
 * This list exists as documentation for reviewers and AI tools:
 *   "Do not propose these as future keywords."
 *
 * hot_reload        — implies mutable runtime behaviour; conflicts with SPORE-SEC-020/021
 * global_mutation   — implies shared mutable state; forbidden in Galerina
 * spill             — implies hidden memory side-effect
 * checkpoint        — implies implicit execution state mutation
 * map_manifest      — too implementation-specific; conflicts with governed manifest model
 */
export const V1_DEPRECATED_RESERVED: ReadonlySet<string> = new Set([
  "hot_reload",
  "global_mutation",
  "spill",
  "checkpoint",
  "map_manifest",
]);

// ---------------------------------------------------------------------------
// Flow Contract keywords (Pilot Candidate)
// See: docs/Knowledge-Bases/galerina-flow-contracts.md
// ---------------------------------------------------------------------------
// contract, emit, emits, event, types are added to V1_ACTIVE_KEYWORDS above.

// Two-character operators are handled by direct character-pair checks inside lex().
// This avoids an array allocation and an O(n) includes() search on every token boundary.

// Single-character operators
const ONE_CHAR_OPERATORS = new Set(["+", "-", "*", "/", "%", "=", "<", ">", "!", "&", "|", "?"]);

// Punctuation / symbols
const SYMBOLS = new Set(["(", ")", "{", "}", "[", "]", ",", ":", ";", ".", "@"]);

// ---------------------------------------------------------------------------
// Lexer implementation
// ---------------------------------------------------------------------------

/**
 * Tokenises a Galerina source string.
 *
 * @param source  Full source text of the .spore file.
 * @param file    File path used in diagnostic locations.
 * @returns       LexResult with tokens array (always ends with an `eof` token)
 *                and any diagnostics.
 */
export function lex(source: string, file: string): LexResult {
  // Strip a leading UTF-8 BOM (U+FEFF / EF BB BF) before anything else. A BOM is common from Windows
  // editors and re-saved files; without this it lexes as "Unexpected character U+FEFF" (SPORE-PARSE-001) at
  // byte 0, aborting the file before any intended diagnostic. A BOM is only meaningful at the start, so an
  // interior U+FEFF is left untouched. Silent strip (standard behaviour) — a leading BOM is not an error.
  if (source.charCodeAt(0) === 0xFEFF) source = source.slice(1);

  // ── SPORE-LEX-004 / SPORE-LEX-005 / SPORE-LEX-006 safety limits ─────────────────
  const MAX_FILE_SIZE  = 10 * 1024 * 1024; // 10 MB (SPORE-LEX-004)
  const MAX_LINE_LENGTH = 10_000;           // chars (SPORE-LEX-005)
  const MAX_TOKEN_COUNT = 1_000_000;        // tokens (internal guard)
  const MAX_DIAGNOSTICS = 100;              // SPORE-LEX-006: stop emitting after this many errors

  const tokens: Token[] = [];
  const diagnostics: LexerDiagnostic[] = [];

  // SPORE-LEX-004: Reject files that exceed the maximum size limit.
  if (source.length > MAX_FILE_SIZE) {
    const sizeError: LexerDiagnostic = {
      code: "SPORE-LEX-004",
      name: "FileTooLarge",
      severity: "error",
      message: "File exceeds maximum size (10MB). Split into smaller files.",
      location: { file, line: 1, column: 1 },
    };
    const eofToken: Token = { kind: "eof", kindId: TokenKindId.Eof, value: "", line: 1, column: 1, endLine: 1, endColumn: 1, start: 0, end: 0 };
    return { tokens: [eofToken], diagnostics: [sizeError] };
  }

  let pos = 0;
  let line = 1;
  let col = 1;

  /** Current < nesting depth for generic types. */
  let genericDepth = 0;

  /** Tracks the byte offset where the current line started (for SPORE-LEX-005). */
  let lineStartPos = 0;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function peek(offset = 0): string {
    return source[pos + offset] ?? "";
  }

  function advance(): string {
    const ch = source[pos] ?? "";
    pos++;
    if (ch === "\n") {
      line++;
      col = 1;
      lineStartPos = pos;
    } else {
      col++;
    }
    return ch;
  }

  function tok(kind: TokenKind, value: string, startPos: number, startLine: number, startCol: number): Token {
    return { kind, kindId: TOKEN_KIND_ID_MAP[kind], value, line: startLine, column: startCol, endLine: line, endColumn: col, start: startPos, end: pos };
  }

  function diag(
    code: string,
    name: string,
    message: string,
    diagLine: number,
    diagCol: number,
    suggestedFix?: string,
  ): void {
    // SPORE-LEX-006: stop emitting diagnostics after MAX_DIAGNOSTICS to prevent
    // denial-of-service via maliciously crafted source with thousands of errors.
    if (diagnostics.length >= MAX_DIAGNOSTICS) {
      if (diagnostics.length === MAX_DIAGNOSTICS) {
        diagnostics.push({
          code: "SPORE-LEX-006",
          name: "TooManyDiagnostics",
          severity: "error",
          message: `Lexer emitted ${MAX_DIAGNOSTICS} diagnostics. Further errors suppressed. Fix the first errors and re-compile.`,
          location: { file, line: diagLine, column: diagCol },
        });
      }
      return; // suppress further diagnostics
    }
    const d: LexerDiagnostic = {
      code,
      name,
      severity: "error",
      message,
      location: { file, line: diagLine, column: diagCol },
      ...(suggestedFix === undefined ? {} : { suggestedFix }),
    };
    diagnostics.push(d);
  }

  // ── Main scan loop ─────────────────────────────────────────────────────────

  while (pos < source.length) {
    const startPos = pos;
    const startLine = line;
    const startCol = col;
    const ch = peek();

    // ── Whitespace (space, tab, carriage return) ───────────────────────────
    if (ch === " " || ch === "\t" || ch === "\r") {
      advance();
      continue;
    }

    // ── Newline ────────────────────────────────────────────────────────────
    if (ch === "\n") {
      // SPORE-LEX-005: Check if the line just completed exceeds MAX_LINE_LENGTH.
      const lineLength = startPos - lineStartPos;
      if (lineLength > MAX_LINE_LENGTH) {
        diagnostics.push({
          code: "SPORE-LEX-005",
          name: "LineTooLong",
          severity: "warning",
          message: `Line ${startLine} exceeds maximum length (10,000 characters).`,
          location: { file, line: startLine, column: 1 },
        });
      }
      advance();
      // SPORE-LEX-001: A generic type expression never spans a newline, but a
      // comparison `<` (e.g. `while i < n`) does. Reset the generic-nesting
      // counter at every newline so unmatched `<` comparisons across separate
      // lines cannot accumulate into a spurious "nesting exceeds depth" error.
      // A genuinely deep single-line generic (>8 `<` before any newline) still
      // trips the threshold, so detection is preserved.
      genericDepth = 0;
      tokens.push(tok("newline", "\n", startPos, startLine, startCol));
      // SPORE-LEX-004: Guard against token count overflow.
      if (tokens.length > MAX_TOKEN_COUNT) {
        diagnostics.push({
          code: "SPORE-LEX-004",
          name: "FileTooLarge",
          severity: "error",
          message: "Token count exceeds maximum limit (1,000,000). Split into smaller files.",
          location: { file, line, column: col },
        });
        break;
      }
      continue;
    }

    // ── Block comment /* ... */ ────────────────────────────────────────────
    // Multi-line. Tracks newlines inside so line/col counts stay accurate.
    // Not nested: the first */ closes the comment regardless of inner /**.
    // SPORE comment style 3 of 3 — all three are accepted, // is canonical.
    if (ch === "/" && peek(1) === "*") {
      const scanStart = pos;
      advance(); // consume /
      advance(); // consume *
      while (pos < source.length) {
        if (peek() === "*" && peek(1) === "/") {
          advance(); // consume *
          advance(); // consume /
          break;
        }
        if (peek() === "\n") {
          // Keep line/col tracking accurate inside block comments
          advance();
          tokens.push(tok("newline", "\n", pos - 1, line - 1, 0));
          lineStartPos = pos;
        } else {
          advance();
        }
      }
      // Emit a single comment token for the whole block (value is the raw text)
      tokens.push(tok("comment", source.slice(scanStart, pos), startPos, startLine, startCol));
      continue;
    }

    // ── Doc comment /// ────────────────────────────────────────────────────
    if (ch === "/" && peek(1) === "/" && peek(2) === "/") {
      const scanStart = pos;
      while (pos < source.length && peek() !== "\n") {
        advance();
      }
      const value = source.slice(scanStart, pos);
      tokens.push(tok("docComment", value, startPos, startLine, startCol));
      continue;
    }

    // ── Generated comment //spore: ─────────────────────────────────────────────
    // CLI/compiler-GENERATED metadata (//spore: USES, //spore: USEDBY, //spore: COMPLEXITY, //spore: WARN, …).
    // The `//spore:` marker mirrors the .spore file prefix. Checked BEFORE the plain `//` branch so a
    // `//spore:` line can NEVER fall through to a human `comment` token (fail-closed tier separation).
    // Tooling OWNS these lines and overwrites them on every run; humans keep `//`. Only the exact
    // prefix `//spore:` is generated — `// spore` (with a space) or `//spore` (no colon) stays a human comment.
    if (ch === "/" && peek(1) === "/" && peek(2) === "s" && peek(3) === "p" && peek(4) === "o" && peek(5) === "r" && peek(6) === "e" && peek(7) === ":") {
      const scanStart = pos;
      while (pos < source.length && peek() !== "\n") {
        advance();
      }
      const value = source.slice(scanStart, pos);
      tokens.push(tok("genComment", value, startPos, startLine, startCol));
      continue;
    }

    // ── Line comment // ────────────────────────────────────────────────────
    if (ch === "/" && peek(1) === "/") {
      const scanStart = pos;
      while (pos < source.length && peek() !== "\n") {
        advance();
      }
      const value = source.slice(scanStart, pos);
      tokens.push(tok("comment", value, startPos, startLine, startCol));
      continue;
    }

    // ── Char literal 'x' ───────────────────────────────────────────────────
    if (ch === "'") {
      advance(); // consume opening single quote
      let value = "";
      if (peek() === "\\" && pos < source.length) {
        value += advance(); // backslash
        if (pos < source.length) value += advance(); // escaped char
      } else if (peek() !== "'" && peek() !== "\n") {
        value += advance(); // single character
      }
      if (peek() === "'") {
        if (value === "") {
          diag(
            "SPORE-CHAR-003",
            "MULTI_CHAR_LITERAL",
            "Char literal must contain exactly one character unit.",
            startLine,
            startCol,
            `Provide one character, or use an empty string: ""`,
          );
        }
        advance(); // consume closing single quote
      } else {
        diag(
          "SPORE-CHAR-003",
          "MULTI_CHAR_LITERAL",
          "Char literal must contain exactly one character unit.",
          startLine,
          startCol,
          `Use double quotes for strings: "${value}"`,
        );
      }
      tokens.push(tok("char", value, startPos, startLine, startCol));
      continue;
    }

    // ── String literal "..." ───────────────────────────────────────────────
    if (ch === '"') {
      advance(); // consume opening quote
      let value = '"';
      let oversized = false;
      while (pos < source.length && peek() !== '"' && peek() !== "\n") {
        if (peek() === "\\") {
          const bslash = advance(); // backslash
          if (peek() === "u" && pos < source.length) {
            // Unicode escape: \u{XXXXXX} or \uXXXX
            advance(); // consume 'u'
            if (peek() === "{") {
              // \u{...} form
              advance(); // consume '{'
              let hexStr = "";
              while (pos < source.length && peek() !== "}" && peek() !== "\n") {
                hexStr += advance();
              }
              if (peek() === "}") {
                advance(); // consume '}'
                const isValidHex = /^[0-9a-fA-F]{1,6}$/.test(hexStr);
                const codePoint = parseInt(hexStr, 16);
                if (!isValidHex || codePoint > 0x10FFFF) {
                  diag(
                    "SPORE-LEX-003",
                    "InvalidUnicodeEscape",
                    "Invalid unicode escape sequence in string literal.",
                    startLine,
                    startCol,
                    "Use \\u{XXXXXX} with 1-6 hex digits, or \\uXXXX with exactly 4.",
                  );
                  value += bslash + "u{" + hexStr + "}";
                } else {
                  value += String.fromCodePoint(codePoint);
                }
              } else {
                diag(
                  "SPORE-LEX-003",
                  "InvalidUnicodeEscape",
                  "Invalid unicode escape sequence in string literal.",
                  startLine,
                  startCol,
                  "Use \\u{XXXXXX} with 1-6 hex digits, or \\uXXXX with exactly 4.",
                );
                value += bslash + "u{" + hexStr;
              }
            } else {
              // \uXXXX form — exactly 4 hex digits
              let hexStr = "";
              for (let i = 0; i < 4 && pos < source.length; i++) {
                const hc = peek();
                if ((hc >= "0" && hc <= "9") || (hc >= "a" && hc <= "f") || (hc >= "A" && hc <= "F")) {
                  hexStr += advance();
                } else {
                  break;
                }
              }
              if (hexStr.length === 4) {
                value += String.fromCodePoint(parseInt(hexStr, 16));
              } else {
                diag(
                  "SPORE-LEX-003",
                  "InvalidUnicodeEscape",
                  "Invalid unicode escape sequence in string literal.",
                  startLine,
                  startCol,
                  "Use \\u{XXXXXX} with 1-6 hex digits, or \\uXXXX with exactly 4.",
                );
                value += bslash + "u" + hexStr;
              }
            }
          } else if (pos < source.length) {
            value += bslash + advance(); // other escape: \n \t \r \" \\ etc.
          } else {
            value += bslash;
          }
        } else {
          value += advance();
        }
        if (!oversized && value.length > 10_000) {
          oversized = true;
          diag(
            "SPORE-LEX-002",
            "OversizedToken",
            "String literal or identifier exceeds maximum length (10,000 characters).",
            startLine,
            startCol,
            "Split large string literals or shorten identifier names.",
          );
        }
      }
      if (peek() === '"') {
        value += advance(); // closing quote
      } else {
        diag(
          "SPORE-PARSE-003",
          "UNTERMINATED_STRING",
          "Unterminated string literal.",
          startLine,
          startCol,
          `Close the string with a double-quote character.`,
        );
      }
      tokens.push(tok("string", value, startPos, startLine, startCol));
      continue;
    }

    // ── Number literal (integer, decimal, base-prefixed, separators) ───────
    if (ch >= "0" && ch <= "9") {
      // Hex: 0x...
      if (ch === "0" && (peek(1) === "x" || peek(1) === "X")) {
        advance(); // 0
        advance(); // x
        while (
          pos < source.length &&
          ((peek() >= "0" && peek() <= "9") ||
            (peek() >= "a" && peek() <= "f") ||
            (peek() >= "A" && peek() <= "F"))
        ) {
          advance();
        }
        tokens.push(tok("number", source.slice(startPos, pos), startPos, startLine, startCol));
        continue;
      }

      // Binary: 0b...
      if (ch === "0" && (peek(1) === "b" || peek(1) === "B")) {
        advance(); // 0
        advance(); // b
        while (pos < source.length && (peek() === "0" || peek() === "1")) {
          advance();
        }
        tokens.push(tok("number", source.slice(startPos, pos), startPos, startLine, startCol));
        continue;
      }

      // Octal: 0o...
      if (ch === "0" && (peek(1) === "o" || peek(1) === "O")) {
        advance(); // 0
        advance(); // o
        while (pos < source.length && peek() >= "0" && peek() <= "7") {
          advance();
        }
        tokens.push(tok("number", source.slice(startPos, pos), startPos, startLine, startCol));
        continue;
      }

      // Decimal (keep underscore support)
      while (pos < source.length && ((peek() >= "0" && peek() <= "9") || peek() === "_")) {
        advance();
      }
      // Decimal part
      if (peek() === "." && peek(1) >= "0" && peek(1) <= "9") {
        advance(); // dot
        while (pos < source.length && (peek() >= "0" && peek() <= "9")) {
          advance();
        }
      }
      // Scientific-notation exponent: e/E, optional sign, ≥1 digit. Only consumed when a
      // digit actually follows, so a trailing `e` stays an identifier (`1e-6` → one number
      // token; `1e` / `1e-` → number `1` then `e`/operator). Lets tolerances like `1e-6`
      // be a single numeric literal across the language.
      if (
        (peek() === "e" || peek() === "E") &&
        (((peek(1) === "+" || peek(1) === "-") && peek(2) >= "0" && peek(2) <= "9") ||
          (peek(1) >= "0" && peek(1) <= "9"))
      ) {
        advance(); // e/E
        if (peek() === "+" || peek() === "-") advance(); // sign
        while (pos < source.length && peek() >= "0" && peek() <= "9") {
          advance();
        }
      }
      tokens.push(tok("number", source.slice(startPos, pos), startPos, startLine, startCol));
      continue;
    }

    // ── Two-character operators ────────────────────────────────────────────
    // Direct character-pair checks avoid array allocation and O(n) includes().
    {
      const next = peek(1);
      let twoChar: string | undefined;
      if      (ch === "-" && next === ">") twoChar = "->";
      else if (ch === "=" && next === ">") twoChar = "=>";
      else if (ch === "=" && next === "=") twoChar = "==";
      else if (ch === "!" && next === "=") twoChar = "!=";
      else if (ch === "<" && next === "=") twoChar = "<=";
      else if (ch === ">" && next === "=") twoChar = ">=";
      else if (ch === "&" && next === "&") twoChar = "&&";
      else if (ch === "|" && next === "|") twoChar = "||";
      else if (ch === "." && next === ".") twoChar = "..";
      if (twoChar !== undefined) {
        advance();
        advance();
        tokens.push(tok("operator", twoChar, startPos, startLine, startCol));
        continue;
      }
    }

    // ── Single-character operators ─────────────────────────────────────────
    if (ONE_CHAR_OPERATORS.has(ch)) {
      advance();
      // Track generic nesting depth for < / >
      if (ch === "<") {
        genericDepth++;
        if (genericDepth > 8) {
          diag(
            "SPORE-LEX-001",
            "ExcessiveNesting",
            "Generic type nesting exceeds maximum depth (8 levels). Simplify the type.",
            startLine,
            startCol,
            "Use a type alias to break up deeply nested generics.",
          );
        }
      } else if (ch === ">") {
        if (genericDepth > 0) genericDepth--;
      }
      tokens.push(tok("operator", ch, startPos, startLine, startCol));
      continue;
    }

    // ── Governance/system annotation ;; ───────────────────────────────────
    // ;; is a FIRST-CLASS governance annotation, not just an alternate comment.
    // It produces a "govComment" token (distinct from "comment") so that:
    //   - The governance verifier can scan ;; text for proof hints and intent
    //   - The manifest generator can include ;; annotations in the .lmanifest
    //     narrative context (ProofObligation human-readable rationale)
    //   - Future tooling can distinguish "why it's secure" from "what it does"
    //
    // Semantic intent:
    //   ;; amount is validated — safe to proceed    ← govComment: security reasoning
    //   // process the payment                      ← comment: code reasoning
    //
    // Must be checked BEFORE the general symbol handler so ;; is never split
    // into two separate ";" symbol tokens.
    if (ch === ";" && peek(1) === ";") {
      const scanStart = pos;
      while (pos < source.length && peek() !== "\n") {
        advance();
      }
      tokens.push(tok("govComment", source.slice(scanStart, pos), startPos, startLine, startCol));
      continue;
    }

    // ── Punctuation / symbols ──────────────────────────────────────────────
    if (SYMBOLS.has(ch)) {
      advance();
      // SPORE-LEX-001: A generic type expression never crosses a statement or
      // block boundary, so reset the generic-nesting counter at `{`, `}` and
      // `;`. Together with the newline reset above this bounds the counter to a
      // single line/statement, preventing comparison `<` operators spread
      // across statements from accumulating into a spurious depth error while
      // still catching a genuinely deep single-line generic.
      if (ch === "{" || ch === "}" || ch === ";") {
        genericDepth = 0;
      }
      // ── Optional statement separator ; ──────────────────────────────────
      // A lone `;` is treated as a newline — it acts as an optional statement
      // terminator for developers coming from TypeScript/C/Java backgrounds.
      // `;;` is handled above as a comment, so this only fires for single `;`.
      // Emitting "newline" (not "symbol") means the parser never sees it as
      // a syntax element — it just ends the current statement cleanly.
      if (ch === ";") {
        tokens.push(tok("newline", ";", startPos, startLine, startCol));
        continue;
      }
      tokens.push(tok("symbol", ch, startPos, startLine, startCol));
      continue;
    }

    // ── Identifiers and keywords ───────────────────────────────────────────
    if (isIdentStart(ch)) {
      const identStart = pos;
      // advance() tracks line/col; we collect the value via slice afterwards.
      while (pos < source.length && isIdentContinue(peek())) {
        advance();
      }
      const value = source.slice(identStart, pos);

      // SPORE-LEX-002: Oversized identifier check.
      if (value.length > 10_000) {
        diag(
          "SPORE-LEX-002",
          "OversizedToken",
          "String literal or identifier exceeds maximum length (10,000 characters).",
          startLine,
          startCol,
          "Split large string literals or shorten identifier names.",
        );
      }

      if (V1_ACTIVE_KEYWORDS.has(value)) {
        tokens.push(tok("keyword", value, startPos, startLine, startCol));
      } else if (V1_FUTURE_RESERVED.has(value)) {
        diag(
          "SPORE-SYNTAX-003",
          "FUTURE_RESERVED_KEYWORD",
          `"${value}" is reserved for future use and cannot be used as an identifier.`,
          startLine,
          startCol,
          `Rename the identifier. "${value}" is reserved for a planned Galerina feature.`,
        );
        // Emit as keyword so the parser can skip gracefully
        tokens.push(tok("keyword", value, startPos, startLine, startCol));
      } else {
        tokens.push(tok("identifier", value, startPos, startLine, startCol));
      }
      continue;
    }

    // ── Bitwise operators are intentionally not Galerina operators ─────────────
    // Bit-level math (XOR/NOT/shift) lives in the engine/extension layer, not in
    // .spore (the crypto-on-core boundary). Give a clear hint rather than a bare
    // "unexpected character" (dogfooding GAP-4). `&`/`|`/`<<`/`>>` are caught at the
    // parser; `^` and `~` reach here because the lexer never tokenizes them.
    if (ch === "^" || ch === "~") {
      diag(
        "SPORE-PARSE-001",
        "UNEXPECTED_TOKEN",
        `Bitwise operator '${ch}' is not a Galerina operator — bit-level operations (XOR/shift/NOT) live in the engine/extension layer, not in .spore (the crypto-on-core boundary).`,
        startLine,
        startCol,
        ".spore has arithmetic (+ - * / %), comparison, and logical (and / or) operators only — move bit-twiddling into a governed engine extension.",
      );
      advance();
      continue;
    }

    // ── Unknown character ──────────────────────────────────────────────────
    diag(
      "SPORE-PARSE-001",
      "UNEXPECTED_TOKEN",
      `Unexpected character: '${ch}' (U+${ch.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}).`,
      startLine,
      startCol,
    );
    advance(); // skip unknown character to continue scanning
  }

  // ── EOF sentinel ───────────────────────────────────────────────────────────
  tokens.push({ kind: "eof", kindId: TokenKindId.Eof, value: "", line, column: col, endLine: line, endColumn: col, start: pos, end: pos });

  return { tokens, diagnostics };
}

// ---------------------------------------------------------------------------
// Character classification helpers
// ---------------------------------------------------------------------------

function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isIdentContinue(ch: string): boolean {
  return isIdentStart(ch) || (ch >= "0" && ch <= "9");
}

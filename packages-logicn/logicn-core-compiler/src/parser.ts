// =============================================================================
// LogicN Phase 4 — Recursive Descent Parser
//
// Parses LogicN .lln source text into an AstNode tree.
// Grammar: docs/Knowledge-Bases/phase-4-parser-ast-plan.md
//
// Entry point: parseProgram(source, file)
//
// AstNodeKind values mirror @logicn/core — structurally compatible.
// FlowDeclarationMetadata mirrors @logicn/core FlowDeclarationMetadata.
// =============================================================================

import { lex, type Token, type LexerDiagnostic } from "./lexer.js";

// ---------------------------------------------------------------------------
// AST types (mirrors @logicn/core)
// ---------------------------------------------------------------------------

/**
 * All AST node kinds used by the Phase 4 parser.
 * Subset of the full AstNodeKind union in @logicn/core.
 */
export type AstNodeKind =
  | "program"
  | "importDecl"
  | "typeDecl"
  | "recordDecl"
  | "enumDecl"
  | "enumVariant"
  | "intentDecl"
  | "governanceDecl"
  | "apiDecl"
  // Flow declarations
  | "flowDecl"
  | "secureFlowDecl"
  | "pureFlowDecl"
  | "guardedFlowDecl"
  | "fnDecl"
  // Flow sub-nodes
  | "paramDecl"
  | "typeRef"
  | "effectsDecl"
  | "effectRef"
  | "ensureDecl"    // invariant { ensure expr; } — DRCM Phase 2 (#36)
  | "block"
  // Statements
  | "letDecl"
  | "mutDecl"
  | "readonlyDecl"
  | "assignStmt"
  | "returnStmt"
  | "ifStmt"
  | "whileStmt"
  | "forEachStmt"
  | "matchExpr"
  | "matchArm"
  // Expressions
  | "callExpr"
  | "memberExpr"
  | "binaryExpr"
  | "unaryExpr"
  | "identifier"
  | "stringLiteral"
  | "numberLiteral"
  | "boolLiteral"
  | "errorPropagation"
  | "computeTargetBlock"
  // Route declarations
  | "routeDecl"
  // Flow Contract (Pilot Candidate)
  | "contractDecl"
  | "contractSetDecl"
  // Governance blocks
  | "authorityDecl"
  | "policyDecl"
  // v2.2 canonical domain ceiling declaration (replaces top-level named `policy Name {}`)
  | "guardDecl"
  // Resource declarations (Phase 17)
  | "resourceDecl"
  // Literal expression nodes
  | "charLiteral"
  | "listLiteral"
  // Hardware hints (Phase 18) — parser preserves, backend decides
  | "preferHint"
  // Feature-gate attribute (task #51) — first-class AST node for @experimental_profile(...)
  // Grammar: @Identifier(key: "val", ...) { ... }
  // In --release: parsed + grammar-checked; verification/emission skipped
  // In --enable-experimental-profile=X: full pipeline applies to inner block
  | "attributeDecl"
  // Proof-tracing block (task #73) — assuming(flowRef, "claim") { ... }
  // Declares that a proof established in a parent/sibling flow is being borrowed.
  // The governance verifier (task #74) looks up the referenced flow's .lmanifest,
  // checks the proof obligation exists + is signed, then elides the WAT gate.
  | "assumingDecl"
  // DRCM Phase 4 (task #39) — emergency transition declaration inside emergency {} block.
  // Produced by parseEmergencyBlock(); validated by LLN-MONO-001/002.
  // { kind: "emergencyTransitionDecl", value: signalName, children: [deny/action nodes] }
  | "emergencyTransitionDecl"
  // Tower-native syntax primitives
  // trapDecl — hardware trap if condition is TRUE (inverted ensure). task #76 foundation.
  // { kind: "trapDecl", value: errorCode, children: [conditionExpr] }
  | "trapDecl"
  // governedFlowDecl — flow qualified with a Tower floor constraint. DAG_CHECK (bit 8).
  // { kind: "governedFlowDecl", value: "governed:<floor>:<flowName>", children: [...] }
  | "governedFlowDecl"
  // v2.1 Tower-native syntax (#86)
  // accessDecl — inline capability negotiation block at the flow boundary (v2.1 replacement for inline policy {})
  // { kind: "accessDecl", value: "access", children: [purpose/allow/deny/require nodes] }
  | "accessDecl"
  // staticDecl — compile-time constant declaration: static NAME = EXPR
  // { kind: "staticDecl", value: "NAME", children: [valueExpr] }
  | "staticDecl"
  // bitfieldDecl — type-safe V_DPM capability register: bitfield NAME { field: BIT_POSITION }
  // { kind: "bitfieldDecl", value: "NAME", children: [identifier nodes "field:bitpos"] }
  | "bitfieldDecl"
  // gateDecl — flow admission guard: gate(condition) { flow ... }
  // { kind: "gateDecl", value: "conditionName", children: [flowDecl nodes] }
  | "gateDecl"
  // importPluginDecl — Standard bridged plugin (isolated, demand-loaded, transient)
  // { kind: "importPluginDecl", value: "Alias", children: [path identifier, contractDecl?] }
  | "importPluginDecl"
  // assimilatedPluginDecl — Hot-Code Residency (pre-compiled, always-hot, stateless data)
  // { kind: "assimilatedPluginDecl", value: "Alias", children: [path identifier, contractDecl?] }
  // assimilate implies safe — deep DAG audit performed automatically
  // governed by boot.lln assimilation_memory_budget
  | "assimilatedPluginDecl";

export interface SourceLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  /** Byte offset of the first character of this token (= token.start). */
  readonly offset?: number;
  /** Line of the last character of this token. */
  readonly endLine?: number;
  /** Column of the last character of this token. */
  readonly endColumn?: number;
  /** Byte offset after the last character (= token.end). Used for IDE squiggles and AI patch ranges. */
  readonly endOffset?: number;
  /** endOffset - offset. Convenient for source-map and AI repair tools. */
  readonly length?: number;
}

export interface AstNode {
  readonly kind: AstNodeKind;
  readonly location?: SourceLocation;
  readonly children?: readonly AstNode[];
  readonly value?: string;
  /**
   * Stores the original readable form used by the developer when
   * Readable Logic Forms are adopted (see logicn-readable-logic-forms.md).
   * Example: binaryExpr with value ">" may have readableForm "is greater than".
   * The formatter preserves this style; the compiler uses value (canonical).
   */
  readonly readableForm?: string;
  /**
   * Optional call-style marker set by the parser.
   * "method" indicates this callExpr was parsed as receiver.method(args) —
   * children[0] is the receiver expression, children[1..] are the arguments.
   * Absent or undefined means a plain call: all children are arguments.
   */
  readonly callStyle?: "method";
  /**
   * Optional type name for named record constructors: `TypeName { field: val }`.
   * Set on `#record` callExpr nodes that were parsed with an explicit type prefix.
   * Used by the type checker for structural validation; the interpreter ignores it
   * (evaluates identically to an anonymous `{ field: val }` record).
   */
  readonly typeName?: string;
  /**
   * Optional domain guard policy name for `contract [conforms_to: PolicyName] { }`.
   * Set on `contractDecl` nodes when the `[conforms_to: ...]` attribute is present.
   * Used by the governance verifier to perform the Differential Proof pass (#56).
   */
  readonly conformsTo?: string;
  /**
   * Proof-tracing block (task #73): the name of the flow whose .lmanifest is borrowed.
   * Set on `assumingDecl` nodes — corresponds to the first argument of assuming(flowRef, "claim").
   */
  readonly flowRef?: string;
  /**
   * Proof-tracing block (task #73): the proof obligation claim string.
   * Set on `assumingDecl` nodes — corresponds to the second argument of assuming(flowRef, "claim").
   * Must match a ProofObligation entry in the referenced flow's .lmanifest.
   */
  readonly claim?: string;
  /**
   * Structural bitmask set by the parser on flow/fn declaration nodes.
   * Encodes: HasContract, HasEffects, HasCompute, TensorCandidate, ReadonlyInputs.
   *
   * Downstream passes (SemanticGraph, ExecutionPlanner, Backend) use this to
   * skip re-analysis. Hardware meaning (GPU/NPU/Photonic) is assigned by the
   * backend, not the parser.
   *
   * @see NodeFlags
   */
  readonly flags?: NodeFlagsMask;
}

export interface ParseDiagnostic {
  readonly code: string;
  readonly name: string;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
  readonly location?: SourceLocation;
  readonly suggestedFix?: string;
  /** Machine-applicable fix — the exact LogicN snippet to insert/replace, without prose. */
  readonly suggestedCode?: string;
  /** Rust-style: secondary source locations giving context. */
  readonly relatedLocations?: readonly { message: string; location: SourceLocation }[];
  /** Elm-style: why this is a problem. */
  readonly why?: string;
  /** Elm-style: what goes wrong if ignored. */
  readonly risk?: string;
  /**
   * Exact byte range [startOffset, endOffset] of the offending token or span.
   * Enables AI agents and IDE integrations to make safe, non-overlapping edits.
   */
  readonly byteSpan?: readonly [number, number];
}

/** Metadata extracted from a flow declaration header. */
export interface FlowMeta {
  readonly name: string;
  readonly qualifier: "flow" | "secure" | "pure" | "guarded";
  readonly params: readonly string[];
  readonly returnType: string;
  readonly declaredEffects: readonly string[];
  readonly location: SourceLocation;
  /**
   * Optional termination metric declared with the `decreases` keyword after
   * the return type arrow. Example: `-> Int decreases n`
   * Stored as the raw metric expression string, e.g. "n" or "(m - n)".
   * Undefined when the annotation is absent.
   */
  readonly decreasesMetric?: string;
}

export interface ParseResult {
  /** Root program node. Present even when there are diagnostics. */
  readonly ast: AstNode;
  readonly diagnostics: readonly ParseDiagnostic[];
  /** Extracted flow metadata — available even with partial parse errors. */
  readonly flows: readonly FlowMeta[];
}

// ---------------------------------------------------------------------------
// Pratt operator table
//
// Each infix operator maps to its binding precedence and associativity.
// Higher precedence binds tighter: * (60) > + (50) > == (30) > && (20) > || (10).
// Ref: docs/Knowledge-Bases/operator-precedence.md
// ---------------------------------------------------------------------------

interface InfixEntry {
  readonly precedence: number;
  readonly associativity: "left" | "right";
}

const INFIX_OPERATOR_TABLE: ReadonlyMap<string, InfixEntry> = new Map([
  ["||", { precedence: 10, associativity: "left" }],
  ["&&", { precedence: 20, associativity: "left" }],
  ["==", { precedence: 30, associativity: "left" }],
  ["!=", { precedence: 30, associativity: "left" }],
  ["<",  { precedence: 40, associativity: "left" }],
  ["<=", { precedence: 40, associativity: "left" }],
  [">",  { precedence: 40, associativity: "left" }],
  [">=", { precedence: 40, associativity: "left" }],
  ["+",  { precedence: 50, associativity: "left" }],
  ["-",  { precedence: 50, associativity: "left" }],
  ["*",  { precedence: 60, associativity: "left" }],
  ["/",  { precedence: 60, associativity: "left" }],
  ["%",  { precedence: 60, associativity: "left" }],
]);

// ---------------------------------------------------------------------------
// NodeFlags — structural bitmask attached to flow/fn AST nodes
//
// Purpose: let downstream passes (SemanticGraph, ExecutionPlanner, Backend)
//   skip costly re-analysis. Flags are structural-only and hardware-neutral:
//   the backend decides what TensorCandidate means for GPU vs NPU vs Photonic.
//
// Rule: parser sets flags; compiler/SemanticGraph validates compatibility.
//   LLN-COMPUTE-001 (incompatible pattern for compute target) is a compiler
//   diagnostic, NOT a parser diagnostic.
// ---------------------------------------------------------------------------

export const NodeFlags = {
  None:            0,
  HasContract:     1 << 0,   // flow declares a contract { } block
  HasEffects:      1 << 1,   // flow declares at least one effect
  HasCompute:      1 << 2,   // flow declares a compute { } or prefer [...] block
  TensorCandidate: 1 << 3,   // flow has Tensor<> in params or return type
  ReadonlyInputs:  1 << 4,   // all parameters are readonly-qualified
  IsPure:          1 << 5,   // flow qualifier is "pure"
  IsSecure:        1 << 6,   // flow qualifier is "secure"
  HasPrivacy:      1 << 7,   // flow contract declares a privacy block
} as const;
export type NodeFlagsMask = number;

// ---------------------------------------------------------------------------
// AST node factory
//
// Creates AstNode objects with a consistent property layout (kind, location,
// value, children, readableForm, flags) so all instances share the same V8
// hidden class. Use for all new node construction; retrofit existing inline
// literals opportunistically.
//
// flags defaults to 0 (NodeFlags.None) and is omitted from the object when 0,
// preserving the existing shape for nodes that carry no flags.
// ---------------------------------------------------------------------------

function makeNode(
  kind: AstNodeKind,
  location: SourceLocation,
  value = "",
  children: readonly AstNode[] = [],
  readableForm = "",
  flags = 0,
): AstNode {
  if (flags !== 0) {
    return { kind, location, value, children, readableForm, flags };
  }
  return { kind, location, value, children, readableForm };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class Parser {
  private pos = 0;
  private readonly diagnostics: ParseDiagnostic[] = [];
  private readonly flows: FlowMeta[] = [];

  constructor(
    private readonly tokens: readonly Token[],
    private readonly file: string,
  ) {}

  parse(): { ast: AstNode; diagnostics: readonly ParseDiagnostic[]; flows: readonly FlowMeta[] } {
    const program = this.parseProgram();
    return {
      ast: program,
      diagnostics: [...this.diagnostics],
      flows: [...this.flows],
    };
  }

  // ── Top-level ─────────────────────────────────────────────────────────────

  private parseProgram(): AstNode {
    const children: AstNode[] = [];
    const loc = this.loc();

    while (!this.isEof()) {
      this.skipNewlines();
      if (this.isEof()) break;

      const decl = this.parseDeclaration();
      if (decl !== undefined) {
        children.push(decl);
      }
    }

    return { kind: "program", location: loc, children };
  }

  private parseDeclaration(): AstNode | undefined {
    const tok = this.current();

    if (tok.kind === "keyword") {
      switch (tok.value) {
        case "import":   return this.parseImportStatement();
        case "type":     return this.parseTypeDecl();
        case "record":   return this.parseRecordDecl();
        case "enum":     return this.parseEnumDecl();
        case "flow":     return this.parseFlowDecl("flow");
        case "secure":   return this.parseSecureOrPureFlow();
        case "pure":     return this.parsePureFlow();
        case "guarded":  return this.parseGuardedFlow();
        case "governed": return this.parseGovernedFlow();
        case "intent":   return this.parseIntentDecl();
        case "governance": return this.parseGenericBlock("governanceDecl");
        case "api":      return this.parseGenericBlock("apiDecl");
        case "authority": return this.parseAuthorityBlock();
        case "access":   return this.parseAccessBlock();
        case "policy":   return this.parsePolicyBlock();
        case "static":   return this.parseStaticDecl();
        case "bitfield": return this.parseBitfieldDecl();
        case "gate":     return this.parseGateBlock();
        case "compute":  return this.parseComputeTarget();
        case "prefer":   return this.parsePreferHint();
        case "route":    return this.parseRouteDecl();
        case "contract": {
          // contract set Name { } — reusable contract template (peek at next token)
          // contract { } — flow-attached contract block
          const nextTok = this.peek(1);
          if ((nextTok.kind === "identifier" || nextTok.kind === "keyword") && nextTok.value === "set") {
            return this.parseContractSetDecl();
          }
          return this.parseContractDecl();
        }
        case "event":    return this.parseEventDecl();
        case "resource": return this.parseResourceDecl();
        case "let": {
          // LLN-SYNTAX-006: let at top level is not allowed
          this.emit(
            "LLN-SYNTAX-006",
            "LET_AT_TOP_LEVEL",
            `Top-level 'let' bindings are not allowed. Move this inside a flow, or declare a compile-time 'const' if the value is immutable.`,
            this.loc(),
            `Move into a flow: pure flow name() -> T { let ... }`,
          );
          this.skipTopLevelStatement();
          return undefined;
        }
        case "mut": {
          // LLN-SYNTAX-007: mut at top level is not allowed
          this.emit(
            "LLN-SYNTAX-007",
            "MUT_AT_TOP_LEVEL",
            `Top-level 'mut' bindings are not allowed. Mutable state must be flow-local.`,
            this.loc(),
            `Move into a flow: guarded flow name(...) { mut ... }`,
          );
          this.skipTopLevelStatement();
          return undefined;
        }
        case "readonly": {
          // LLN-SYNTAX-006 variant: readonly at top level is not allowed as an executable binding
          this.emit(
            "LLN-SYNTAX-006",
            "LET_AT_TOP_LEVEL",
            `Top-level 'readonly' bindings are not allowed. Move inside a flow.`,
            this.loc(),
          );
          this.skipTopLevelStatement();
          return undefined;
        }
        // LLN-SYNTAX-LEGACY-002: deprecated flow qualifiers — emit advisory, fall through to flow parse
        case "safe": {
          const legacyQual = tok.value;
          const nextPeek = this.peek(1);
          if (nextPeek.kind === "keyword" && nextPeek.value === "flow") {
            // `safe flow` — emit advisory and parse as `flow`
            this.emitWarning(
              "LLN-SYNTAX-LEGACY-002",
              "LegacyFlowQualifier",
              `'${legacyQual} flow' is a legacy qualifier. Use 'guarded flow' (for '${legacyQual} flow'). This will become an error in a future version.`,
              this.loc(),
              `Replace '${legacyQual} flow' with 'guarded flow'.`,
            );
            this.advance(); // consume the legacy qualifier, leave "flow" for parseFlowDecl
            return this.parseFlowDecl("flow");
          }
          // Not followed by "flow" — fall through to unsafe handling
          this.emitUnexpected(`Unexpected '${legacyQual}' at top level.`);
          this.skipTopLevelStatement();
          return undefined;
        }
        // `guard Name { ... }` — v2.2 canonical domain ceiling declaration
        // `guard flow ...`     — legacy flow qualifier (emit advisory, fall through)
        case "guard": {
          const nextPeek = this.peek(1);
          if (nextPeek.kind === "keyword" && nextPeek.value === "flow") {
            // `guard flow` — legacy qualifier; emit advisory and parse as `flow`
            this.emitWarning(
              "LLN-SYNTAX-LEGACY-002",
              "LegacyFlowQualifier",
              `'guard flow' is a legacy qualifier. Use 'guarded flow'. This will become an error in a future version.`,
              this.loc(),
              `Replace 'guard flow' with 'guarded flow'.`,
            );
            this.advance(); // consume "guard", leave "flow" for parseFlowDecl
            return this.parseFlowDecl("flow");
          }
          // Otherwise: `guard Name { ... }` — domain ceiling declaration
          return this.parseGuardDecl();
        }
        case "unsafe": {
          // LLN-SYNTAX-008: unsafe let at top level — boundary data must be flow-owned
          const peek = this.peek(1);
          if (peek.kind === "keyword" && (peek.value === "let" || peek.value === "mut")) {
            this.emit(
              "LLN-SYNTAX-008",
              "UNSAFE_LET_AT_TOP_LEVEL",
              `'unsafe let' is only allowed inside a secure flow. Boundary data must be owned by a governed flow.`,
              this.loc(),
              `Move into a secure flow: secure flow name(readonly request: Request) { unsafe let ... }`,
            );
          } else {
            this.emitUnexpected(`Unexpected 'unsafe' at top level.`);
          }
          this.skipTopLevelStatement();
          return undefined;
        }
        case "emit": {
          // LLN-SYNTAX-009: emit at top level is not allowed
          this.emit(
            "LLN-SYNTAX-009",
            "EMIT_AT_TOP_LEVEL",
            `Events may only be emitted inside flows. Declare events globally, emit them inside governed execution.`,
            this.loc(),
          );
          this.skipTopLevelStatement();
          return undefined;
        }
        case "fn": {
          // fn at top level is a compiler error — fn is only valid inside a flow body
          this.emit(
            "LLN-SYNTAX-005",
            "FN_AT_TOP_LEVEL",
            `Top-level fn declarations are not permitted. Use pure flow, guarded flow, or secure flow instead.`,
            this.loc(),
            `Replace with: pure flow ${this.peek(1)?.value ?? "name"}(...) -> ReturnType { ... }`,
          );
          // Skip fn body to recover
          while (!this.isEof() && !this.currentIs("symbol", "{")) this.advance();
          if (this.currentIs("symbol", "{")) this.skipBalancedBraces();
          return undefined;
        }
        case "match":
        case "if":
        case "unless":
        case "while":
        case "for":
        case "return": {
          // Statement keywords at top level — pedagogical snippets.
          // Emit ONE error then skip the entire statement (including block body).
          this.emitUnexpected(`Unexpected keyword "${tok.value}" at top level.`);
          // Skip to the opening brace (if any), then skip the balanced block.
          while (!this.isEof() && !this.currentIs("symbol", "{") && this.current().kind !== "newline") {
            this.advance();
          }
          if (this.currentIs("symbol", "{")) this.skipBalancedBraces();
          return undefined;
        }
        // Skip unknown keywords at top level
        default:
          this.emitUnexpected(`Unexpected keyword "${tok.value}" at top level.`);
          this.skipToNextDeclaration();
          return undefined;
      }
    }

    if (tok.kind === "newline") {
      this.advance();
      return undefined;
    }

    // Unknown token at top level — could be a top-level expression statement
    // (e.g. a bare function call like AuditLog.write({...}) in a pedagogical snippet).
    // Emit ONE error then skip the whole statement to avoid cascading PARSE-001s.
    this.emitUnexpected(`Unexpected token "${tok.value}" at top level.`);
    this.skipTopLevelStatement();
    return undefined;
  }

  // ── Flow declarations ─────────────────────────────────────────────────────

  /**
   * Parses a plain `flow name(params) -> ret [effects [...]] { body }`.
   * `qualifier` is "flow" | "secure" | "pure" | "guarded" (caller has consumed the qualifier).
   */
  private parseFlowDecl(qualifier: "flow" | "secure" | "pure" | "guarded"): AstNode {
    const loc = this.loc();
    const kind: AstNodeKind =
      qualifier === "secure" ? "secureFlowDecl"
      : qualifier === "pure" ? "pureFlowDecl"
      : qualifier === "guarded" ? "guardedFlowDecl"
      : "flowDecl";

    // Consume "flow" keyword
    this.expect("keyword", "flow");

    // Flow name
    const nameTok = this.expect("identifier");
    const name = nameTok?.value ?? "<unknown>";

    // Parameters
    this.expect("symbol", "(");
    const params = this.parseParamList();
    this.expect("symbol", ")");

    // Return type — dual syntax (v1-current supports both):
    //   `->`  canonical form:      `pure flow add(a: Int, b: Int) -> Int`
    //   `:`   TS-readable proposal: `pure flow add(a: Int, b: Int): Int`
    // Allow the return type separator on the next line.
    this.skipNewlines();
    if (this.currentIs("symbol", ":")) {
      // proposal/vNext colon form — accepted, no diagnostic yet
      this.advance();
    } else {
      this.expect("operator", "->");
    }
    const retTypeNode = this.parseTypeRef();
    const returnType = retTypeNode.value ?? "";

    // Optional `decreases <metric>` termination annotation.
    // Appears on the same line immediately after the return type:
    //   pure flow countdown(n: Int) -> Int decreases n { ... }
    //   secure flow process(m: Int, n: Int) -> Bool decreases (m - n) { ... }
    let decreasesMetric: string | undefined;
    {
      // Peek at the next non-newline token without consuming newlines yet.
      // `decreases` is not a keyword — it is an identifier.
      // Only treat it as a decreases annotation when it appears on the same
      // logical line as the return type (i.e. before the first newline).
      const nextTok = this.current();
      if (nextTok.kind === "identifier" && nextTok.value === "decreases") {
        this.advance(); // consume "decreases"
        // Collect the metric: either a parenthesised expression or an identifier.
        if (this.currentIs("symbol", "(")) {
          // Parenthesised metric: (m - n)
          let depth = 0;
          const metricParts: string[] = [];
          while (!this.isEof()) {
            const t = this.current();
            if (t.kind === "symbol" && t.value === "(") { depth++; metricParts.push("("); this.advance(); }
            else if (t.kind === "symbol" && t.value === ")") {
              depth--;
              metricParts.push(")");
              this.advance();
              if (depth <= 0) break;
            } else if (t.kind === "newline") break;
            else { metricParts.push(t.value); this.advance(); }
          }
          decreasesMetric = metricParts.join(" ").trim();
        } else {
          // Simple identifier metric
          const metTok = this.current();
          if (metTok.kind === "identifier" || metTok.kind === "keyword") {
            decreasesMetric = metTok.value;
            this.advance();
          }
        }
      }
    }

    // Optional effects declaration on the next line(s)
    this.skipNewlines();
    let effectsNode: AstNode | undefined;
    let effectNames: string[] = [];
    if (this.currentIs("keyword", "with") && this.peek(1).kind === "keyword" && this.peek(1).value === "effects") {
      // LLN-SYNTAX-LEGACY-001: 'with effects [...]' was removed in v1-current.
      // Hard error: use 'contract { effects { ... } }' instead.
      this.emit(
        "LLN-SYNTAX-LEGACY-001",
        "LegacyEffectsSyntax",
        "'with effects [...]' was removed. Use 'contract { effects { ... } }' instead.",
        this.loc(),
        "Replace 'with effects [database.write]' with:\n  contract {\n    effects {\n      database.write\n    }\n  }",
      );
      this.advance(); // consume "with"
      const result = this.parseEffectsDecl();
      effectsNode = result.node;
      effectNames = result.names;
    } else if (this.currentIs("keyword", "effects")) {
      const result = this.parseEffectsDecl();
      effectsNode = result.node;
      effectNames = result.names;
    }

    // Optional governance/runtime clauses before the body.
    const flowClauses: AstNode[] = [];
    while (true) {
      this.skipNewlines();
      if (this.currentIs("keyword", "intent")) {
        flowClauses.push(this.parseIntentDecl());
        continue;
      }
      if (this.currentIs("keyword", "compute")) {
        flowClauses.push(this.parseComputeTarget());
        continue;
      }
      if (this.currentIs("keyword", "contract")) {
        flowClauses.push(this.parseContractDecl());
        continue;
      }
      if (this.currentIs("keyword", "prefer")) {
        flowClauses.push(this.parsePreferHint());
        continue;
      }
      // `with effects [...]` may also appear AFTER the contract block
      if (this.currentIs("keyword", "with") && this.peek(1).kind === "keyword" && this.peek(1).value === "effects") {
        if (effectsNode === undefined) {
          this.emitWarning(
            "LLN-SYNTAX-LEGACY-001",
            "LegacyEffectsSyntax",
            "'with effects [...]' is legacy syntax. Use 'contract { effects { ... } }' instead.",
            this.loc(),
            "Replace 'with effects [database.write]' with:\n  contract {\n    effects {\n      database.write\n    }\n  }",
          );
          this.advance(); // consume "with"
          const result = this.parseEffectsDecl();
          effectsNode = result.node;
          effectNames = result.names;
        } else {
          // Duplicate effects clause — skip it gracefully
          this.advance();
          this.advance();
          while (!this.currentIs("symbol", "]") && !this.isEof()) this.advance();
          if (this.currentIs("symbol", "]")) this.advance();
        }
        continue;
      }
      // `with compute target <kind> { ... }` — shorthand for inline compute hint
      if (
        this.currentIs("keyword", "with") &&
        this.peek(1).kind === "keyword" && this.peek(1).value === "compute"
      ) {
        this.advance(); // consume "with"
        flowClauses.push(this.parseComputeTarget());
        continue;
      }
      // `authority { ... }` — governance authority block (post-v1); parse structurally
      if (this.currentIs("keyword", "authority")) {
        flowClauses.push(this.parseAuthorityBlock());
        continue;
      }
      // `access { ... }` — capability negotiation block at the flow boundary (v2.1 spec)
      // Declares: purpose, allow X to "action", deny Y, require effect.name
      // Replaces the deprecated inline `policy {}` block between contract and body.
      // Represents the ACTIVE NEGOTIATION of rights at the call boundary —
      // distinct from `contract {}` (static governance declarations).
      if (this.currentIs("keyword", "access") || this.currentIs("identifier", "access")) {
        flowClauses.push(this.parseAccessBlock());
        continue;
      }
      // `policy { ... }` — DEPRECATED alias for `access {}` (v2.1: policy keyword reserved)
      // Will emit LLN-SYNTAX-LEGACY-003 advisory in a future version.
      // For now: silently accept and delegate to parsePolicyBlock().
      if (this.currentIs("keyword", "policy")) {
        flowClauses.push(this.parsePolicyBlock()); // existing handler, kept for compat
        continue;
      }
      // Bare `effects [...]` after contract block
      if (this.currentIs("keyword", "effects") && effectsNode === undefined) {
        const result = this.parseEffectsDecl();
        effectsNode = result.node;
        effectNames = result.names;
        continue;
      }
      break;
    }

    // Body block — supports TWO styles:
    //   Classic (external contract before body):  `flow f(): T  contract { ... }  { body }`
    //   Modern (inline contract first in body):   `flow f(): T { contract { ... }  body }`
    // Both produce identical AST. The inline style makes flows self-contained.
    this.skipNewlines();
    const body = this.parseBlock();

    // Hoist any contractDecl that appeared as the first statement in the body (inline style).
    // parseBlock() treats it as a statement — we lift it out to flowClauses so the rest of
    // the flow parsing pipeline (effects extraction, meta building) sees it normally.
    if (body.kind === "block") {
      const bodyChildren: AstNode[] = (body.children as AstNode[] | undefined) ?? [];
      const inlineIdx = bodyChildren.findIndex(c => c.kind === "contractDecl");
      if (inlineIdx >= 0) {
        const [inlineContract] = bodyChildren.splice(inlineIdx, 1);
        if (inlineContract !== undefined && !flowClauses.some(c => c.kind === "contractDecl")) {
          flowClauses.push(inlineContract);
        }
      }
    }

    // If no inline effects were declared, check the contract block's effects sub-section.
    // (canonical contract style: `contract { effects { database.write audit.write } }`)
    // parseContractSubBlock("effects") returns:
    //   { kind: "identifier", value: "effects:block", children: [{ value: "effect:<name>" }...] }
    // when braces are present, or "effects:" (no-brace) when absent.
    if (effectNames.length === 0) {
      for (const clause of flowClauses) {
        if (clause.kind !== "contractDecl") continue;
        const effectsSubBlock = (clause.children ?? []).find(
          (c) => c.kind === "identifier" && typeof c.value === "string" &&
            (c.value === "effects:block" || c.value === "effects:"),
        );
        if (effectsSubBlock !== undefined) {
          for (const effectChild of effectsSubBlock.children ?? []) {
            if (effectChild.kind === "identifier" && typeof effectChild.value === "string" && effectChild.value.startsWith("effect:")) {
              effectNames.push(effectChild.value.slice("effect:".length));
            }
          }
        }
      }
    }

    // Extract metadata
    const meta: FlowMeta = {
      name,
      qualifier,
      params: params.map((p) => p.value ?? ""),
      returnType,
      declaredEffects: effectNames,
      location: loc,
      ...(decreasesMetric !== undefined ? { decreasesMetric } : {}),
    };
    this.flows.push(meta);

    const children: AstNode[] = [
      ...params,
      retTypeNode,
      ...(effectsNode !== undefined ? [effectsNode] : []),
      ...flowClauses,
      body,
    ];

    // Compute structural NodeFlags for downstream passes.
    // Flags are hardware-neutral: TensorCandidate does not imply a target —
    // the backend (SemanticGraph → ExecutionPlanner) maps that later.
    const contractNode    = flowClauses.find((c) => c.kind === "contractDecl");
    const hasContractFlag = contractNode !== undefined;
    // HasCompute: explicit compute { } block OR prefer [...] hint
    const hasComputeFlag  = flowClauses.some(
      (c) => c.kind === "computeTargetBlock" || c.kind === "preferHint",
    );
    const hasEffectsFlag  = effectNames.length > 0;
    const tensorCandidate = returnType.includes("Tensor") ||
      params.some((p) => (p.value ?? "").includes("Tensor"));
    const readonlyInputs  = params.length > 0 &&
      params.every((p) => (p.value ?? "").startsWith("readonly "));
    // HasPrivacy: contract block contains a privacy sub-block
    const hasPrivacyFlag  = hasContractFlag && (contractNode?.children ?? []).some(
      (c) => c.kind === "identifier" &&
        (typeof c.value === "string") &&
        (c.value === "privacy:block" || c.value.startsWith("privacy:")),
    );

    const flags: NodeFlagsMask =
      (hasContractFlag ? NodeFlags.HasContract     : NodeFlags.None) |
      (hasEffectsFlag  ? NodeFlags.HasEffects      : NodeFlags.None) |
      (hasComputeFlag  ? NodeFlags.HasCompute      : NodeFlags.None) |
      (tensorCandidate ? NodeFlags.TensorCandidate : NodeFlags.None) |
      (readonlyInputs  ? NodeFlags.ReadonlyInputs  : NodeFlags.None) |
      (qualifier === "pure"   ? NodeFlags.IsPure   : NodeFlags.None) |
      (qualifier === "secure" ? NodeFlags.IsSecure : NodeFlags.None) |
      (hasPrivacyFlag  ? NodeFlags.HasPrivacy      : NodeFlags.None);

    return { kind, value: name, location: loc, children, ...(flags !== 0 ? { flags } : {}) };
  }

  private parseSecureOrPureFlow(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "secure"

    if (!this.currentIs("keyword", "flow")) {
      this.emit(
        "LLN-PARSE-002",
        "EXPECTED_FLOW_KEYWORD",
        `Expected "flow" after "secure".`,
        loc,
        `Write: secure flow name(params) -> ReturnType { ... }`,
      );
      // Try to recover by treating as plain flow if "flow" is next
    }

    return this.parseFlowDecl("secure");
  }

  private parsePureFlow(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "pure"

    if (!this.currentIs("keyword", "flow")) {
      this.emit(
        "LLN-PARSE-002",
        "EXPECTED_FLOW_KEYWORD",
        `Expected "flow" after "pure".`,
        loc,
        `Write: pure flow name(params) -> ReturnType { ... }`,
      );
    }

    return this.parseFlowDecl("pure");
  }

  private parseGuardedFlow(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "guarded"

    if (!this.currentIs("keyword", "flow")) {
      this.emit(
        "LLN-PARSE-002",
        "EXPECTED_FLOW_KEYWORD",
        `Expected "flow" after "guarded".`,
        loc,
        `Write: guarded flow name(params) -> ReturnType with effects [...] { ... }`,
      );
    }

    return this.parseFlowDecl("guarded");
  }

  /**
   * Parse: governed <floor_name> flow <name>(...) -> T contract { ... } { body }
   *
   * `governed` is a flow qualifier that declares which Tower floor this flow
   * is authorized to execute in. The compiler:
   *   1. Records the floor constraint in the manifest
   *   2. Emits a DAG_CHECK (bit 8 = dag_edge_valid) as a WAT comment placeholder
   *      (real enforcement is DRCM Phase 5 — DSS.wasm checks bit 8 at runtime)
   *
   * Valid floor names: floor_1, floor_2, floor_3, floor_4
   * Also accepts short names: execution, containment, proof, attestation
   *
   * Example:
   *   governed floor_3 flow verifyTransaction(tx: Transaction) -> Hash
   *   contract { intent "Verify tx in the Proof Zone" }
   *   { return tx.hash() }
   */
  private parseGovernedFlow(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "governed"
    this.skipNewlines();

    // Parse floor name (optional — defaults to "floor_3" if omitted and "flow" follows)
    let floorName = "floor_3";
    if ((this.current().kind === "identifier" || this.current().kind === "keyword")
        && this.current().value !== "flow") {
      floorName = this.current().value;
      this.advance();
      this.skipNewlines();
    }

    // Expect "flow" keyword
    if (!this.currentIs("keyword", "flow") && !this.currentIs("identifier", "flow")) {
      this.emit(
        "LLN-PARSE-002",
        "EXPECTED_FLOW_KEYWORD",
        `Expected "flow" after "governed ${floorName}".`,
        loc,
        `Write: governed floor_3 flow name(params) -> ReturnType { ... }`,
      );
      return { kind: "identifier", value: "governed:error", location: loc };
    }

    // Parse the actual flow as a guarded flow, then attach floor metadata
    const flowNode = this.parseFlowDecl("guarded");

    // Re-tag as governedFlowDecl and encode floor in value:
    // value = "governed:<floorName>:<originalFlowName>"
    return {
      ...flowNode,
      kind: "governedFlowDecl" as AstNodeKind,
      value: `governed:${floorName}:${flowNode.value ?? ""}`,
    };
  }

  // ── Parameters ────────────────────────────────────────────────────────────

  private parseParamList(): AstNode[] {
    const params: AstNode[] = [];

    while (!this.currentIs("symbol", ")") && !this.isEof()) {
      this.skipNewlines();
      if (this.currentIs("symbol", ")")) break;

      const prevPos = this.pos;
      const param = this.parseParam();
      if (param !== undefined) params.push(param);
      // Safety guard: force progress if parseParam didn't consume any tokens
      // (prevents infinite loops when parseParam emits an error and returns undefined)
      if (this.pos === prevPos && !this.isEof()) {
        this.advance();
      }

      this.skipNewlines();
      if (this.currentIs("symbol", ",")) {
        this.advance(); // consume comma
      }
    }

    return params;
  }

  /**
   * Error recovery: after a malformed parameter, skip tokens up to the next ',' or ')'
   * (the parameter boundary), tracking `<>` generic depth so commas inside a generic type
   * don't end the skip early. Stops at a newline/EOF to avoid crossing the declaration.
   */
  private skipMalformedParam(): void {
    let depth = 0;
    while (!this.isEof()) {
      const t = this.current();
      if (t.kind === "symbol" && t.value === "<") depth++;
      else if (t.kind === "symbol" && t.value === ">") { if (depth > 0) depth--; }
      else if (depth === 0 && t.kind === "symbol" && (t.value === "," || t.value === ")")) break;
      else if (t.kind === "newline") break;
      this.advance();
    }
  }

  private parseParam(): AstNode | undefined {
    const loc = this.loc();

    // Optional readonly prefix on parameters: readonly req: Request
    let isReadonly = false;
    if (this.currentIs("keyword", "readonly")) {
      isReadonly = true;
      this.advance();
      this.skipNewlines();
    }

    const nameTok = this.current();
    if (nameTok.kind !== "identifier") {
      if (nameTok.kind === "keyword") {
        // DX: a reserved LogicN keyword (e.g. `governance`, `policy`, `authority`) in parameter
        // position would otherwise raise the generic "Expected parameter name" without saying WHY.
        this.emitUnexpected(
          `Expected a parameter name, but "${nameTok.value}" is a reserved LogicN keyword and ` +
          `cannot be used as an identifier. Rename the parameter (e.g. "${nameTok.value}_").`,
        );
      } else {
        this.emitUnexpected(`Expected parameter name, got "${nameTok.value}".`);
      }
      // Recovery: consume the rest of this malformed parameter up to the next ',' or ')'
      // so the parser resumes cleanly instead of re-parsing ':'/type as more params and
      // cascading follow-on errors (dogfooding GAP-1 polish).
      this.skipMalformedParam();
      return undefined;
    }

    this.advance(); // name
    this.expect("symbol", ":");
    const typeRef = this.parseTypeRef();

    const prefix = isReadonly ? "readonly " : "";

    // Phase 4.4: optional `source_from Origin` annotation after the type.
    // `source_from` is an identifier token (not a keyword) so we peek at the
    // current token and consume the annotation when present.
    let sourceFromSuffix = "";
    if (this.current().kind === "identifier" && this.current().value === "source_from") {
      this.advance(); // consume "source_from"
      // Consume the origin: one or more identifier/dot tokens e.g. Network.ClientSocket
      let origin = "";
      while (!this.isEof() && (this.current().kind === "identifier" || (this.current().kind === "symbol" && this.current().value === "."))) {
        origin += this.current().value;
        this.advance();
      }
      if (origin !== "") {
        sourceFromSuffix = ` source_from ${origin}`;
      }
    }

    const paramText = `${prefix}${nameTok.value}: ${typeRef.value ?? ""}${sourceFromSuffix}`;
    return { kind: "paramDecl", value: paramText, location: loc, children: [typeRef] };
  }

  // ── Type references ────────────────────────────────────────────────────────

  /**
   * Parses a type reference such as `Int`, `String`, `Result<T, E>`,
   * `ApiResponse<OrderStatusResponse>`.
   *
   * Handles nested angle-bracket generics with a depth counter.
   */
  private parseTypeRef(): AstNode {
    const loc = this.loc();
    let value = "";

    // view(cap1 | cap2) — MMCP capability-masked pointer type (task #78 foundation)
    // Parses: view(read | secret) → typeRef with value "view:read|secret"
    // The pipe | separates capability names inside view().
    const base = this.current();
    if ((base.kind === "identifier" || base.kind === "keyword") && base.value === "view") {
      this.advance(); // consume "view"
      let capMask = "read";  // default: read-only
      if (this.currentIs("symbol", "(")) {
        this.advance(); // consume (
        this.skipNewlines();
        const caps: string[] = [];
        while (!this.currentIs("symbol", ")") && !this.isEof()) {
          const capTok = this.current();
          if (capTok.kind === "identifier" || capTok.kind === "keyword") {
            caps.push(capTok.value);
            this.advance();
          }
          this.skipNewlines();
          // consume | separator (may be operator or symbol depending on lexer)
          if (this.currentIs("operator", "|") || this.currentIs("symbol", "|")) {
            this.advance();
            this.skipNewlines();
          } else {
            break; // no more caps
          }
        }
        if (this.currentIs("symbol", ")")) this.advance(); // consume )
        if (caps.length > 0) capMask = caps.join("|");
      }
      return { kind: "typeRef", value: `view:${capMask}`, location: loc };
    }

    // Base type name
    if (base.kind === "identifier" || base.kind === "keyword") {
      value += base.value;
      this.advance();
      if ((base.value === "protected" || base.value === "redacted") && (this.current().kind === "identifier" || this.current().kind === "keyword")) {
        value += " " + this.current().value;
        this.advance();
      }
    } else {
      this.emitUnexpected(`Expected type name, got "${base.value}".`);
      return { kind: "typeRef", value: "<unknown>", location: loc };
    }

    // Optional generic arguments
    if (this.currentIs("operator", "<")) {
      value += "<";
      this.advance();
      let depth = 1;

      while (!this.isEof() && depth > 0) {
        const t = this.current();
        if (t.kind === "operator" && t.value === "<") {
          depth++;
          value += "<";
          this.advance();
        } else if (t.kind === "operator" && t.value === ">") {
          depth--;
          value += ">";
          this.advance();
        } else if (t.kind === "newline") {
          this.advance(); // allow newlines inside generics
        } else {
          value += t.value;
          this.advance();
        }
      }
    }

    return { kind: "typeRef", value, location: loc };
  }

  // ── Effects declaration ────────────────────────────────────────────────────

  private parseEffectsDecl(): { node: AstNode; names: string[] } {
    const loc = this.loc();
    const names: string[] = [];

    this.advance(); // consume "effects"
    this.expect("symbol", "[");

    while (!this.currentIs("symbol", "]") && !this.isEof()) {
      this.skipNewlines();
      if (this.currentIs("symbol", "]")) break;

      const prevPos = this.pos;
      const effectNode = this.parseEffectRef();
      if (effectNode !== undefined) {
        names.push(effectNode.value ?? "");
      }
      // Safety guard: force progress if parseEffectRef didn't consume any tokens
      if (this.pos === prevPos && !this.isEof()) {
        this.advance();
      }

      this.skipNewlines();
      if (this.currentIs("symbol", ",")) {
        this.advance();
      }
    }

    this.expect("symbol", "]");

    const children: AstNode[] = names.map((n) => ({
      kind: "effectRef" as AstNodeKind,
      value: n,
    }));

    return {
      node: { kind: "effectsDecl", location: loc, children, value: names.join(", ") },
      names,
    };
  }

  private parseEffectRef(): AstNode | undefined {
    const loc = this.loc();
    let value = "";
    const tok = this.current();

    if (tok.kind !== "identifier" && tok.kind !== "keyword") {
      this.emitUnexpected(`Expected effect name, got "${tok.value}".`);
      return undefined;
    }

    value += tok.value;
    this.advance();

    // Dot-path: database.read, audit.write, etc.
    // Also capture wildcards: network.* — preserved in the effect name so
    // the governance verifier can emit LLN-CAP-001 (wildcard ban, task #30).
    while (this.currentIs("symbol", ".")) {
      this.advance(); // consume dot
      const next = this.current();
      if (next.kind === "identifier" || next.kind === "keyword") {
        value += "." + next.value;
        this.advance();
      } else if (next.kind === "operator" && next.value === "*") {
        // Wildcard — include in name so governance verifier can detect and reject it
        value += ".*";
        this.advance();
      } else {
        break;
      }
    }

    // Standalone `*` as an effect name (e.g. `effects { * }`)
    // Also capture for wildcard detection in governance verifier.
    if (value === "" && this.current().kind === "operator" && this.current().value === "*") {
      value = "*";
      this.advance();
    }

    return { kind: "effectRef", value, location: loc };
  }

  // ── Block and statements ───────────────────────────────────────────────────

  private parseBlock(): AstNode {
    const loc = this.loc();
    const children: AstNode[] = [];

    this.expect("symbol", "{");
    this.skipNewlines();

    while (!this.currentIs("symbol", "}") && !this.isEof()) {
      const stmt = this.parseStatement();
      if (stmt !== undefined) {
        children.push(stmt);
      }
      this.skipNewlines();
    }

    this.expect("symbol", "}");
    return { kind: "block", location: loc, children };
  }

  private parseStatement(): AstNode | undefined {
    this.skipNewlines();
    const tok = this.current();

    // @attribute_name(key: "val", ...) { ... } — feature-gate directive (task #51)
    // First-class AST node; grammar validated; verification/emission skipped in --release.
    if (tok.kind === "symbol" && tok.value === "@") {
      return this.parseAttributeDirective();
    }

    if (tok.kind === "keyword") {
      switch (tok.value) {
        case "let":      return this.parseLetDecl();
        case "mut":      return this.parseMutDecl();
        case "readonly": return this.parseReadonlyDecl();
        case "return":   return this.parseReturnStmt();
        case "if":       return this.parseIfStmt();
        case "unless":   return this.parseUnlessStmt();
        case "match":    return this.parseMatchExpr();
        case "compute":  return this.parseComputeTarget();
        case "fn":       return this.parseFnDecl();
        case "emit":     return this.parseEmitStmt();
        // Inline contract block (modern style: contract inside flow body)
        // `flow f(): T { contract { effects {} }  body... }`
        case "contract": return this.parseContractDecl();
        case "while":    return this.parseWhileStmt();
        case "for":      return this.parseForEachStmt();
        // Safety-prefix binding forms:
        //   unsafe let name: Type = expr
        //   unsafe mut name: Type = expr
        //   safe   let name: Type = expr
        //   safe   mut name       = gate(name)?
        case "unsafe":
        case "safe": {
          const safetyPrefix = tok.value as "unsafe" | "safe";
          this.advance(); // consume "unsafe" / "safe"
          this.skipNewlines();
          const next = this.current();
          if (next.kind === "keyword" && next.value === "let") {
            return this.parseLetDecl(safetyPrefix);
          }
          if (next.kind === "keyword" && next.value === "mut") {
            return this.parseMutDecl(safetyPrefix);
          }
          // Not a binding — fall through and emit diagnostic
          this.emitUnexpected(`Expected 'let' or 'mut' after '${safetyPrefix}'.`);
          return undefined;
        }
        // `trap CONDITION : ERROR_CODE` — hardware trap if condition is TRUE (task #76 foundation)
        case "trap": return this.parseTrapStmt();
        // `static NAME = EXPR` — compile-time constant (also valid inside flow bodies)
        case "static": return this.parseStaticDecl();
        // `fallback <target>` inside compute blocks — consume silently as a hint node.
        case "fallback": {
          this.advance(); // consume "fallback"
          this.skipNewlines();
          // Consume the fallback target (e.g. "cpu", "gpu")
          const targetTok = this.current();
          const target = (targetTok.kind === "identifier" || targetTok.kind === "keyword") ? targetTok.value : "";
          if (target) this.advance();
          return { kind: "identifier", value: `fallback:${target}`, location: this.loc() };
        }
        // `prefer [list]` inside compute blocks — consume the keyword and list.
        case "prefer":
        case "deny": {
          const kw = tok.value;
          const loc2 = this.loc();
          this.advance(); // consume "prefer" / "deny"
          this.skipNewlines();
          // Consume optional [...] list
          if (this.currentIs("symbol", "[")) {
            this.advance(); // consume [
            while (!this.isEof() && !this.currentIs("symbol", "]")) this.advance();
            if (this.currentIs("symbol", "]")) this.advance();
          }
          return { kind: "identifier", value: `${kw}:hint`, location: loc2 };
        }
        // `runtime <mode>` or `runtime <mode> { ... }` inside flow bodies — consume as a hint node.
        case "runtime": {
          const runtimeLoc = this.loc();
          this.advance(); // consume "runtime"
          this.skipNewlines();
          const modeTok = this.current();
          const mode = (modeTok.kind === "identifier" || modeTok.kind === "keyword") ? modeTok.value : "";
          if (mode) this.advance();
          this.skipNewlines();
          // Optional block body: runtime adaptive { ... }
          if (this.currentIs("symbol", "{")) this.skipBalancedBraces();
          return { kind: "identifier", value: `runtime:${mode}`, location: runtimeLoc };
        }
        default: break;
      }
    }

    if (tok.kind === "identifier") {
      // Identifiers used as compute-block or runtime hint directives:
      //   prefer [npu, gpu, cpu]           — followed by [...]
      //   deny   [remote.execution]         — followed by [...]
      //   runtime adaptive { ... }          — followed by ident { }
      //   runtime deterministic              — single word
      //   learn from intent                  — multiple words (no block)
      //   optimise [batching, warmup]        — followed by [...]
      //   preserve [security, effects]       — followed by [...]
      // Consume them silently to avoid cascading PARSE-001 errors.
      const HINT_LIST_DIRECTIVES = new Set(["prefer", "deny", "optimise", "preserve"]);
      const HINT_RUNTIME_DIRECTIVES = new Set(["runtime"]);
      const HINT_PHRASE_DIRECTIVES = new Set(["learn"]); // "learn from X"

      if (HINT_LIST_DIRECTIVES.has(tok.value)) {
        const hintLoc = this.loc();
        const hintName = tok.value;
        this.advance(); // consume directive name
        this.skipNewlines();
        if (this.currentIs("symbol", "[")) {
          this.advance(); // consume [
          // Consume everything until ] — may contain reserved keywords like "remote"
          while (!this.isEof() && !this.currentIs("symbol", "]")) this.advance();
          if (this.currentIs("symbol", "]")) this.advance();
        }
        return { kind: "identifier", value: `${hintName}:hint`, location: hintLoc };
      }

      if (HINT_RUNTIME_DIRECTIVES.has(tok.value)) {
        const hintLoc = this.loc();
        this.advance(); // consume "runtime"
        this.skipNewlines();
        // Consume optional mode word (e.g. "adaptive", "deterministic")
        if (this.current().kind === "identifier" || this.current().kind === "keyword") {
          this.advance();
        }
        this.skipNewlines();
        // Consume optional block body
        if (this.currentIs("symbol", "{")) this.skipBalancedBraces();
        return { kind: "identifier", value: "runtime:hint", location: hintLoc };
      }

      if (HINT_PHRASE_DIRECTIVES.has(tok.value)) {
        const hintLoc = this.loc();
        this.advance(); // consume "learn"
        // Consume until end of line (e.g. "from intent")
        while (!this.isEof() && this.current().kind !== "newline") this.advance();
        return { kind: "identifier", value: "learn:hint", location: hintLoc };
      }

      return this.parseExprStatement();
    }

    if (
      tok.kind === "number" ||
      tok.kind === "string" ||
      tok.kind === "char" ||
      tok.kind === "boolean"
    ) {
      return this.parseExprStatement();
    }

    if (tok.kind === "comment" || tok.kind === "docComment") {
      this.advance();
      return undefined;
    }

    if (tok.kind === "newline") {
      this.advance();
      return undefined;
    }

    // Unexpected token in statement position
    this.emitUnexpected(`Unexpected token "${tok.value}" in statement position.`);
    this.advance();
    return undefined;
  }

  private parseLetDecl(safetyPrefix?: "unsafe" | "safe"): AstNode {
    const loc = this.loc();
    this.advance(); // consume "let"

    // Accept keywords as binding names (e.g. `let record = ...`) since
    // several common keywords are also valid variable names in context.
    const nameTokCur = this.current();
    let nameTok;
    if (nameTokCur.kind === "identifier") {
      nameTok = this.expect("identifier");
    } else if (nameTokCur.kind === "keyword") {
      nameTok = this.advance(); // consume the keyword used as a binding name
    } else {
      nameTok = this.expect("identifier"); // will emit diagnostic
    }
    const name = nameTok?.value ?? "<unknown>";

    // Optional type annotation
    let typeValue = "";
    if (this.currentIs("symbol", ":")) {
      this.advance();
      // Consume type ref with optional postfix value-state annotations
      const typeNode = this.parseTypeRefWithValueState();
      typeValue = typeNode.value ?? "";
    }

    this.expect("operator", "=");
    this.skipNewlines(); // allow initializer on next line: let x: T =\n  expr
    const init = this.parseExpression();

    // Encode safety prefix in the value field as a leading qualifier
    // e.g. "unsafe rawEmail: String" or just "rawEmail: String"
    const nameWithType = typeValue !== "" ? `${name}: ${typeValue}` : name;
    const value = safetyPrefix ? `${safetyPrefix} ${nameWithType}` : nameWithType;
    return { kind: "letDecl", value, location: loc, children: [init] };
  }

  private parseMutDecl(safetyPrefix?: "unsafe" | "safe"): AstNode {
    const loc = this.loc();
    this.advance(); // consume "mut"

    const mutNameCur = this.current();
    let nameTok;
    if (mutNameCur.kind === "identifier") {
      nameTok = this.expect("identifier");
    } else if (mutNameCur.kind === "keyword") {
      nameTok = this.advance();
    } else {
      nameTok = this.expect("identifier");
    }
    const name = nameTok?.value ?? "<unknown>";

    let typeValue = "";
    if (this.currentIs("symbol", ":")) {
      this.advance();
      const typeNode = this.parseTypeRefWithValueState();
      typeValue = typeNode.value ?? "";
    }

    this.expect("operator", "=");
    this.skipNewlines(); // allow initializer on next line: mut x: T =\n  expr
    const init = this.parseExpression();

    const nameWithType = typeValue !== "" ? `${name}: ${typeValue}` : name;
    const value = safetyPrefix ? `${safetyPrefix} ${nameWithType}` : nameWithType;
    return { kind: "mutDecl", value, location: loc, children: [init] };
  }

  /**
   * Parses a type reference that may include postfix value-state annotations.
   *
   * Primary syntax (v1):
   *   `unsafe let name: Type = expr`   — safety prefix before binding keyword
   *   `safe   mut name = gate(name)?`  — upgrade prefix before mut
   *
   * Postfix annotations (tainted, secret, protected, tainted) still supported
   * for secondary qualifiers after the type:
   *   `SecureString secret`
   *   `Bytes tainted`
   */
  private parseTypeRefWithValueState(): AstNode {
    const loc = this.loc();
    const typeRef = this.parseTypeRef();
    let value = typeRef.value ?? "";

    // Postfix secondary qualifiers: secret, protected, tainted
    // Note: safe/unsafe as prefixes are handled by parseStatement() before
    // reaching here. If they appear postfix (legacy/backward compat), still
    // consume them to avoid parser confusion.
    const postfixStates = new Set([
      "secret", "protected", "tainted", "readonly",
      // backward-compat: also consume safe/unsafe in postfix position
      "safe", "unsafe", "validated", "unvalidated",
    ]);
    while (this.current().kind === "keyword" && postfixStates.has(this.current().value)) {
      value += " " + this.current().value;
      this.advance();
    }

    return { kind: "typeRef", value, location: loc };
  }

  private parseReturnStmt(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "return"

    const children: AstNode[] = [];
    // Return with no value if followed by newline or }
    if (!this.currentIs("newline", "\n") && !this.currentIs("symbol", "}") && !this.isEof()) {
      children.push(this.parseExpression());
    }

    return { kind: "returnStmt", location: loc, children };
  }

  private parseIfStmt(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "if"

    const condition = this.parseExpression();
    const thenBlock = this.parseBlock();
    const children: AstNode[] = [condition, thenBlock];

    this.skipNewlines();
    if (this.currentIs("keyword", "else")) {
      this.advance();
      this.skipNewlines();
      // `else if` is NOT allowed in LogicN. Use `match` for multi-branch logic.
      // Rationale: `else if` is TypeScript/JavaScript baggage. LogicN uses `match`
      // which is exhaustive, readable, and explicit — no fallthrough, no hidden paths.
      if (this.currentIs("keyword", "if") || this.currentIs("keyword", "unless")) {
        this.emit(
          "LLN-SYNTAX-010",
          "ElseIfNotAllowed",
          "'else if' is not allowed in LogicN. Use 'match' for multi-branch logic — it is exhaustive and has no hidden fallthrough.",
          this.loc(),
          "Replace:\n  if a { ... } else if b { ... } else { ... }\nWith:\n  match someValue {\n    CaseA => ...\n    CaseB => ...\n    _     => ...\n  }",
        );
        // Still parse the branch to recover and continue — don't leave the parser stuck
        const branch = this.parseStatement();
        if (branch !== undefined) children.push(branch);
      } else {
        const elseBlock = this.parseBlock();
        children.push(elseBlock);
      }
    }

    return { kind: "ifStmt", location: loc, children };
  }

  /**
   * Parse: trap CONDITION : ERROR_CODE
   *
   * Syntax: trap <condition_expr> : <ErrorIdentifier>
   *
   * Semantics: "If CONDITION is TRUE, fire a hardware trap immediately."
   * This is the INVERSE of `ensure` — trap fires when the condition holds (failure case).
   *
   * Differences from `ensure`:
   *  - `ensure X > 0`         → trap if X <= 0 (test the positive; fires on negative)
   *  - `trap X <= 0 : ERR_X`  → trap if X <= 0 (test the negative; fires on positive)
   * Both produce identical WAT, but `trap` carries a named error code for AuditEvent emission.
   *
   * The error code is stored in the trapDecl node and flows into:
   *  - ProofObligation record (CBOR Tag 403) as trapKind
   *  - AuditEvent (CBOR Tag 410) trapKind field when the trap fires at runtime
   *
   * Example:
   *   trap amount > balance : ERR_INSUFFICIENT_FUNDS
   *   trap userId == "" : ERR_EMPTY_USER_ID
   *   trap !isValid : ERR_VALIDATION_FAILURE
   */
  private parseTrapStmt(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "trap"
    this.skipNewlines();

    // Parse the failure condition expression (same as any expression)
    const condition = this.parseExpression();
    this.skipNewlines();

    // Parse optional ": ERROR_CODE" suffix
    let errorCode = "ERR_TRAP";
    if (this.currentIs("symbol", ":")) {
      this.advance(); // consume ":"
      this.skipNewlines();
      const errTok = this.current();
      if (errTok.kind === "identifier" || errTok.kind === "keyword") {
        errorCode = errTok.value;
        this.advance();
        // Allow compound error codes: ERR_INSUFFICIENT_FUNDS (single identifier for now)
      }
    }

    return {
      kind: "trapDecl",
      value: errorCode,
      location: loc,
      children: [condition],
    };
  }

  private parseUnlessStmt(): AstNode {
    // unless CONDITION { } → semantically equivalent to if !CONDITION { }
    const loc = this.loc();
    this.advance(); // consume "unless"
    const condition = this.parseExpression();
    const thenBlock = this.parseBlock();
    const negated: AstNode = { kind: "unaryExpr", value: "!", location: loc, children: [condition] };
    const children: AstNode[] = [negated, thenBlock];

    this.skipNewlines();
    if (this.currentIs("keyword", "else")) {
      this.advance();
      this.skipNewlines();
      if (this.currentIs("keyword", "if") || this.currentIs("keyword", "unless")) {
        const branch = this.parseStatement();
        if (branch !== undefined) children.push(branch);
      } else {
        children.push(this.parseBlock());
      }
    }

    return { kind: "ifStmt", value: "unless", location: loc, children, readableForm: "unless" };
  }

  private parseMatchExpr(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "match"

    const subject = this.parseExpression();
    this.skipNewlines();
    this.expect("symbol", "{");

    const arms: AstNode[] = [];
    this.skipNewlines();

    while (!this.currentIs("symbol", "}") && !this.isEof()) {
      const arm = this.parseMatchArm();
      if (arm !== undefined) arms.push(arm);
      this.skipNewlines();
    }

    this.expect("symbol", "}");
    return { kind: "matchExpr", location: loc, children: [subject, ...arms] };
  }

  private parseMatchArm(): AstNode | undefined {
    const loc = this.loc();
    const pattern = this.current();

    // Guard arm: `when condition => body`
    // Used for ordered threshold matching — LogicN alternative to else-if chains.
    //   match score {
    //     when score >= 90 => return "critical"
    //     when score >= 70 => return "high"
    //     _                => return "low"
    //   }
    if (pattern.kind === "keyword" && pattern.value === "when") {
      this.advance(); // consume "when"
      const guard = this.parseExpression(); // the boolean guard condition
      this.expect("operator", "=>");
      this.skipNewlines();
      let guardBody: AstNode;
      if (this.currentIs("symbol", "{")) {
        guardBody = this.parseBlock();
      } else {
        // parseStatement handles `return expr` as a one-liner arm body
        guardBody = this.parseStatement() ?? { kind: "block", location: loc };
      }
      return {
        kind: "matchArm",
        value: "__guard__",     // sentinel: guard arm (not a named constructor pattern)
        location: loc,
        children: [guard, guardBody],
      };
    }

    // Wildcard arm: _ => body
    const isWildcard = pattern.kind === "identifier" && pattern.value === "_";

    if (pattern.kind !== "identifier" && pattern.kind !== "keyword" &&
        pattern.kind !== "string" && pattern.kind !== "number") {
      this.emitUnexpected(`Expected match arm pattern, got "${pattern.value}".`);
      this.advance();
      return undefined;
    }

    const patternValue = pattern.value;
    this.advance();

    // Multi-variant match arm: `Pattern1 | Pattern2 => body`
    // Collect additional | alternatives (no binding allowed on multi-variant arms).
    // Stored as value="Pattern1|Pattern2" — the interpreter splits on | to try each.
    const allPatterns: string[] = [patternValue];
    while (!isWildcard && this.currentIs("operator", "|")) {
      this.advance(); // consume |
      this.skipNewlines();
      const altTok = this.current();
      if (altTok.kind === "identifier" || altTok.kind === "keyword" ||
          altTok.kind === "number"     || altTok.kind === "string") {
        allPatterns.push(altTok.value);
        this.advance();
      } else {
        break;
      }
    }
    const combinedPattern = allPatterns.join("|");

    // Capture optional binding variable: Some(user), Ok(value), Err(e)
    // The binding name is stored as an identifier child so downstream passes
    // can register it in scope.
    const bindingChildren: AstNode[] = [];
    if (!isWildcard && allPatterns.length === 1 && this.currentIs("symbol", "(")) {
      this.advance(); // consume (
      this.skipNewlines();
      if (this.current().kind === "identifier") {
        const bindingLoc = this.loc();
        const bindingName = this.current().value;
        this.advance();
        bindingChildren.push({ kind: "identifier", value: bindingName, location: bindingLoc });
      }
      this.skipNewlines();
      this.expect("symbol", ")");
    }

    this.expect("operator", "=>");

    let body: AstNode;
    this.skipNewlines();
    if (this.currentIs("symbol", "{")) {
      body = this.parseBlock();
    } else {
      // parseStatement handles `return expr`, assignments, etc. as one-liner arm bodies
      body = this.parseStatement() ?? { kind: "block", location: loc };
    }

    return {
      kind: "matchArm",
      value: combinedPattern,  // "Pattern1" or "Pattern1|Pattern2" for multi-variant
      location: loc,
      children: [...bindingChildren, body],
    };
  }

  private parseExprStatement(): AstNode | undefined {
    const loc = this.loc();

    // Detect bare assignment: `name = expr` (no binding keyword).
    // This is the canonical mutation of a `mut` binding; `let` and `readonly`
    // bindings will be rejected by the binding checker (LLN-BINDING-005).
    if (this.current().kind === "identifier") {
      const peek1 = this.peek(1);
      if (peek1?.kind === "operator" && peek1.value === "=") {
        const nameTok = this.current();
        this.advance(); // consume identifier
        this.advance(); // consume "="
        this.skipNewlines(); // allow RHS on next line: x =\n  expr
        const rhs = this.parseExpression();
        return { kind: "assignStmt", value: nameTok.value, location: loc, children: [rhs] };
      }
    }

    // Detect `emit EventName` in expression-statement position (e.g. a match arm body).
    // Without this, `emit` is consumed as an identifier keyword and the event name
    // is left in the stream, causing cascading PARSE-001 errors.
    if (this.currentIs("keyword", "emit")) {
      return this.parseEmitStmt();
    }

    const expr = this.parseExpression();
    return { kind: "block", value: "(expr)", location: loc, children: [expr] };
  }

  // ── Expressions ────────────────────────────────────────────────────────────

  /**
   * Pratt expression parser (Phase 6).
   *
   * Replaces the Phase 4 ad-hoc `parseComparison → parseAdditive → parseUnary`
   * chain with a table-driven precedence-climbing loop.
   *
   * Precedence table: INFIX_OPERATOR_TABLE (module level)
   * Ref: docs/Knowledge-Bases/operator-precedence.md
   *
   * @param minPrecedence  Minimum precedence for the next infix operator.
   *                       Callers pass 0 (the default) to parse a full expression.
   */
  private parseExpression(minPrecedence = 0): AstNode {
    let left = this.parsePrefixExpression();

    while (true) {
      const tok = this.current();

      // Handle readable keyword operators (Phase 9C): and / or / is
      if (tok.kind === "keyword") {
        if (tok.value === "and" && 20 >= minPrecedence) {
          const loc = this.loc();
          this.advance();
          const right = this.parseExpression(21);
          left = { kind: "binaryExpr", value: "&&", location: loc, children: [left, right], readableForm: "and" };
          continue;
        }
        if (tok.value === "or" && 10 >= minPrecedence) {
          const loc = this.loc();
          this.advance();
          const right = this.parseExpression(11);
          left = { kind: "binaryExpr", value: "||", location: loc, children: [left, right], readableForm: "or" };
          continue;
        }
        if (tok.value === "is" && 30 >= minPrecedence) {
          const loc = this.loc();
          left = this.parseIsForm(left, loc);
          continue;
        }
        break;
      }

      if (tok.kind !== "operator") break;
      const entry = INFIX_OPERATOR_TABLE.get(tok.value);
      if (entry === undefined || entry.precedence < minPrecedence) break;

      const op = tok.value;
      const loc = this.loc();
      this.advance();

      // Left-associative: next call requires strictly higher precedence.
      // Right-associative: same precedence is allowed.
      const nextMin = entry.associativity === "left"
        ? entry.precedence + 1
        : entry.precedence;
      const right = this.parseExpression(nextMin);

      left = { kind: "binaryExpr", value: op, location: loc, children: [left, right] };
    }

    return left;
  }

  /**
   * Parses the `is` readable form: `a is X`, `a is not X`, `a is greater than X`, etc.
   * Called from parseExpression() after consuming the left-hand side.
   * The `is` keyword has not been consumed yet when this method is called.
   */
  private parseIsForm(left: AstNode, _outerLoc: SourceLocation): AstNode {
    const loc = this.loc();
    this.advance(); // consume "is"
    const next = this.current();

    // "is not [greater/less/equal to] X"
    if (next.kind === "identifier" && next.value === "not") {
      this.advance(); // "not"
      const nn = this.current();
      if (nn.kind === "identifier") {
        if (nn.value === "greater") {
          this.advance();
          if (this.current().value === "than") this.advance();
          const right = this.parseExpression(41);
          return { kind: "binaryExpr", value: "<=", location: loc, children: [left, right], readableForm: "is not greater than" };
        }
        if (nn.value === "less") {
          this.advance();
          if (this.current().value === "than") this.advance();
          const right = this.parseExpression(41);
          return { kind: "binaryExpr", value: ">=", location: loc, children: [left, right], readableForm: "is not less than" };
        }
        if (nn.value === "equal") {
          this.advance();
          if (this.current().value === "to") this.advance();
          const right = this.parseExpression(31);
          return { kind: "binaryExpr", value: "!=", location: loc, children: [left, right], readableForm: "is not equal to" };
        }
      }
      // "is not X" → != X
      const right = this.parseExpression(31);
      return { kind: "binaryExpr", value: "!=", location: loc, children: [left, right], readableForm: "is not" };
    }

    // "is greater than [or equal to]"
    if (next.kind === "identifier" && next.value === "greater") {
      this.advance(); // "greater"
      if (this.current().value === "than") this.advance(); // "than"
      if (this.current().kind === "keyword" && this.current().value === "or") {
        this.advance(); // "or"
        if (this.current().value === "equal") this.advance();
        if (this.current().value === "to") this.advance();
        const right = this.parseExpression(41);
        return { kind: "binaryExpr", value: ">=", location: loc, children: [left, right], readableForm: "is greater than or equal to" };
      }
      const right = this.parseExpression(41);
      return { kind: "binaryExpr", value: ">", location: loc, children: [left, right], readableForm: "is greater than" };
    }

    // "is less than [or equal to]"
    if (next.kind === "identifier" && next.value === "less") {
      this.advance(); // "less"
      if (this.current().value === "than") this.advance(); // "than"
      if (this.current().kind === "keyword" && this.current().value === "or") {
        this.advance(); // "or"
        if (this.current().value === "equal") this.advance();
        if (this.current().value === "to") this.advance();
        const right = this.parseExpression(41);
        return { kind: "binaryExpr", value: "<=", location: loc, children: [left, right], readableForm: "is less than or equal to" };
      }
      const right = this.parseExpression(41);
      return { kind: "binaryExpr", value: "<", location: loc, children: [left, right], readableForm: "is less than" };
    }

    // "is equal to"
    if (next.kind === "identifier" && next.value === "equal") {
      this.advance(); // "equal"
      if (this.current().value === "to") this.advance(); // "to"
      const right = this.parseExpression(31);
      return { kind: "binaryExpr", value: "==", location: loc, children: [left, right], readableForm: "is equal to" };
    }

    // "is X" → left == X (catch-all equality)
    const right = this.parseExpression(31);
    return { kind: "binaryExpr", value: "==", location: loc, children: [left, right], readableForm: "is" };
  }

  /**
   * Handles prefix operators (`!`, unary `-`) before delegating to postfix.
   * Right-associative: `!(!x)` and `-(-(x))` both parse correctly.
   */
  private parsePrefixExpression(): AstNode {
    if (this.currentIs("operator", "!") || this.currentIs("operator", "-")) {
      const loc = this.loc();
      const op = this.current().value;
      this.advance();
      // Recursive for chained prefix ops: !!x, --x
      const operand = this.parsePrefixExpression();
      return { kind: "unaryExpr", value: op, location: loc, children: [operand] };
    }
    return this.parsePostfix();
  }

  /** Handles postfix `?` (error propagation) and method chains. */
  private parsePostfix(): AstNode {
    let expr = this.parsePrimary();

    while (true) {
      // `.` member access: `receiver.member` or `receiver.method(args)`
      // `::` path separator: `module::submodule::symbol` — canonical LogicN module path syntax.
      // `::` is lexed as two consecutive `:` symbol tokens. We detect and consume both here,
      // treating `::` as structurally identical to `.` for member access resolution.
      const isDot        = this.currentIs("symbol", ".");
      const isColonColon = this.currentIs("symbol", ":") && this.peek(1).kind === "symbol" && this.peek(1).value === ":";

      if (isDot || isColonColon) {
        // Member access or method call
        const loc = this.loc();
        if (isDot) {
          this.advance(); // consume .
        } else {
          this.advance(); // consume first :
          this.advance(); // consume second :
        }
        const memberTok = this.current();
        const member = memberTok.value;
        this.advance();

        if (this.currentIs("symbol", "(")) {
          // Method/path call: receiver.method(args) or module::fn(args)
          this.advance(); // (
          const args = this.parseArgList();
          this.expect("symbol", ")");
          expr = {
            kind: "callExpr",
            value: member,
            location: loc,
            children: [expr, ...args],
            callStyle: "method",
          };
        } else {
          expr = { kind: "memberExpr", value: member, location: loc, children: [expr] };
        }
      } else if (this.currentIs("operator", "?")) {
        // Error propagation: expr?
        const loc = this.loc();
        this.advance();
        expr = { kind: "errorPropagation", location: loc, children: [expr] };
      } else {
        break;
      }
    }

    return expr;
  }

  private parsePrimary(): AstNode {
    const loc = this.loc();
    const tok = this.current();

    // Grouped expression
    if (tok.kind === "symbol" && tok.value === "(") {
      this.advance();
      const inner = this.parseExpression();
      this.expect("symbol", ")");
      return inner;
    }

    // String literal
    if (tok.kind === "string") {
      this.advance();
      return { kind: "stringLiteral", value: tok.value, location: loc };
    }

    // Char literal 'A'
    if (tok.kind === "char") {
      this.advance();
      return { kind: "charLiteral", value: tok.value, location: loc };
    }

    // Number literal (decimal, hex 0xFF, binary 0b1010, octal 0o755)
    if (tok.kind === "number") {
      this.advance();
      return { kind: "numberLiteral", value: tok.value, location: loc };
    }

    // List / array literal: [a, b, c] or []
    if (tok.kind === "symbol" && tok.value === "[") {
      this.advance(); // consume [
      const elements: AstNode[] = [];
      this.skipNewlines();
      while (!this.currentIs("symbol", "]") && !this.isEof()) {
        elements.push(this.parseExpression());
        this.skipNewlines();
        if (this.currentIs("symbol", ",")) {
          this.advance();
          this.skipNewlines();
        } else {
          break;
        }
      }
      this.expect("symbol", "]");
      return { kind: "listLiteral", value: "", location: loc, children: elements };
    }

    // Boolean literal
    if (tok.kind === "keyword" && (tok.value === "true" || tok.value === "false")) {
      this.advance();
      return { kind: "boolLiteral", value: tok.value, location: loc };
    }

    // Object/record literal or block statement.
    // Disambiguate by lookahead: if after { (skipping newlines) we see
    // `identifier :` or `keyword :`, it is a record literal { field: value, ... }.
    // `... identifier` (spread) makes it a record-update { ...base, field: value }.
    // Otherwise it is a block statement { stmt; ... }.
    if (tok.kind === "symbol" && tok.value === "{") {
      // Look ahead past newlines to find the first real token after {
      let peekOff = 1;
      while (this.peek(peekOff).kind === "newline") peekOff++;
      const firstReal = this.peek(peekOff);
      const secondReal = this.peek(peekOff + 1);

      // Empty {} → empty record literal
      const isEmpty = firstReal.kind === "symbol" && firstReal.value === "}";
      const isRecord = !isEmpty &&
        (firstReal.kind === "identifier" || firstReal.kind === "keyword") &&
        secondReal.kind === "symbol" && secondReal.value === ":";
      // { ...identifier ... } → record update / spread syntax
      // The lexer produces ".." (operator) + "." (symbol) for "..."
      const isSpread = !isEmpty && (
        // lexer emits ".." then "." for "..."
        ((firstReal.kind === "operator" && firstReal.value === "..") &&
          (secondReal.kind === "symbol" && secondReal.value === ".")) ||
        // fallback: single "..." operator token
        (firstReal.kind === "operator" && firstReal.value === "...")
      );

      if (isEmpty || isRecord) {
        return this.parseRecordLiteral(loc);
      }
      if (isSpread) {
        return this.parseRecordUpdateLiteral(loc);
      }
      return this.parseBlock();
    }

    // Identifier or function call
    if (tok.kind === "identifier") {
      this.advance();
      const name = tok.value;

      // `step flowName(args)` — DWI isolate call (DRCM Phase 5, task #40).
      // `step` is an identifier (not a keyword) followed by a flow call.
      // Parsed as: { kind: "callExpr", value: "step:<flowName>", children: args }
      // The interpreter executes the inner call normally and returns its result.
      // Full DWI isolation (fuel, shared-nothing) is WASM-tier only (task #103/#104).
      if (name === "step") {
        this.skipNewlines();
        const targetTok = this.current();
        if (targetTok.kind === "identifier") {
          const targetName = targetTok.value;
          this.advance(); // consume flow name
          if (this.currentIs("symbol", "(")) {
            this.advance(); // consume (
            const stepArgs = this.parseArgList();
            this.expect("symbol", ")");
            return { kind: "callExpr", value: `step:${targetName}`, location: loc, children: stepArgs };
          }
          // Not a call — put back by returning both as identifiers chained
          // (fallback: just return step as identifier, next token re-parsed)
          // This case is unusual; emit the target as a memberExpr of step.
          return { kind: "identifier", value: "step", location: loc };
        }
        return { kind: "identifier", value: "step", location: loc };
      }

      if (this.currentIs("symbol", "(")) {
        // Function call
        this.advance(); // (
        const args = this.parseArgList();
        this.expect("symbol", ")");
        return { kind: "callExpr", value: name, location: loc, children: args };
      }

      // Named record constructor: TypeName { field: val, ... } or TypeName {}
      // Disambiguate by lookahead: only treat as constructor if contents look
      // like `field :` pairs (same heuristic as anonymous record literals above).
      // This allows `let x = TypeName { a: 1, b: 2 }` in any expression position.
      if (this.currentIs("symbol", "{")) {
        let peekOff = 1;
        while (this.peek(peekOff).kind === "newline") peekOff++;
        const firstInside  = this.peek(peekOff);
        const secondInside = this.peek(peekOff + 1);
        const isEmptyCtor  = firstInside.kind === "symbol" && firstInside.value === "}";
        const isNamedCtor  = !isEmptyCtor &&
          (firstInside.kind === "identifier" || firstInside.kind === "keyword") &&
          secondInside.kind === "symbol" && secondInside.value === ":";

        if (isEmptyCtor || isNamedCtor) {
          const ctorLoc = this.loc();
          this.advance(); // consume {
          this.skipNewlines();
          const fields: AstNode[] = [];
          while (!this.currentIs("symbol", "}") && !this.isEof()) {
            this.skipNewlines();
            if (this.currentIs("symbol", "}")) break;
            const fieldLoc  = this.loc();
            const fieldTok  = this.current();
            const fieldName = (fieldTok.kind === "identifier" || fieldTok.kind === "keyword")
              ? fieldTok.value : "<field>";
            this.advance(); // field name
            this.expect("symbol", ":");
            this.skipNewlines();
            const fieldValue = this.parseExpression();
            fields.push({ kind: "identifier", value: fieldName, location: fieldLoc, children: [fieldValue] });
            this.skipNewlines();
            if (this.currentIs("symbol", ",")) {
              this.advance();
              this.skipNewlines();
            }
          }
          this.expect("symbol", "}");
          // Emitted as a #record node — identical to anonymous record in the interpreter.
          // typeName is stored as metadata for future type-checker use (task #57).
          return { kind: "callExpr", value: "#record", typeName: name, location: ctorLoc, children: fields };
        }
      }

      return { kind: "identifier", value: name, location: loc };
    }

    // Fallback for keywords used in expression position (e.g. Ok, Err, enum variants)
    if (tok.kind === "keyword") {
      this.advance();
      return { kind: "identifier", value: tok.value, location: loc };
    }

    this.emitUnexpected(`Expected expression, got "${tok.value}".`);
    this.advance();
    return { kind: "identifier", value: "<error>", location: loc };
  }

  /**
   * Parses a record/object literal: `{ field: expr, field2: expr2 }`.
   *
   * Records are stored as a callExpr with value "#record" and field children.
   * Each field is an identifier node whose value is the field name and whose
   * first child is the field value expression.
   *
   * This mirrors how named arguments are stored in call expressions, letting
   * the interpreter evaluate both forms with the same logic.
   *
   * Called when parsePrimary() detects `{ identifier :` or `{ }`.
   */
  private parseRecordLiteral(loc: SourceLocation): AstNode {
    this.advance(); // consume {
    this.skipNewlines();

    const fields: AstNode[] = [];

    while (!this.currentIs("symbol", "}") && !this.isEof()) {
      this.skipNewlines();
      if (this.currentIs("symbol", "}")) break;

      const fieldLoc = this.loc();
      const fieldTok = this.current();
      const fieldName = fieldTok.kind === "identifier" || fieldTok.kind === "keyword"
        ? fieldTok.value : "<field>";
      this.advance(); // consume field name

      this.expect("symbol", ":");
      this.skipNewlines();

      const fieldValue = this.parseExpression();
      fields.push({
        kind: "identifier",
        value: fieldName,
        location: fieldLoc,
        children: [fieldValue],
      });

      this.skipNewlines();
      if (this.currentIs("symbol", ",")) {
        this.advance();
        this.skipNewlines();
      }
    }

    this.expect("symbol", "}");
    return { kind: "callExpr", value: "#record", location: loc, children: fields };
  }

  /**
   * Parses a record update / spread literal: `{ ...base, field: value, ... }`.
   *
   * Stored as a callExpr with value "#record-update".
   * The first child is the spread expression (the base record).
   * Subsequent children are field nodes, each an identifier whose value is
   * the field name and whose first child is the field value expression.
   *
   * This mirrors the "#record" handling in parseRecordLiteral().
   */
  /** Returns true and advances if current position has a spread operator `...`. */
  private consumeSpreadIfPresent(): boolean {
    // The lexer emits ".." (operator) then "." (symbol) for "..."
    if (this.currentIs("operator", "..") && this.peek(1).kind === "symbol" && this.peek(1).value === ".") {
      this.advance(); // consume ".."
      this.advance(); // consume "."
      return true;
    }
    // Fallback: in case lexer ever emits "..." as a single token
    if (this.currentIs("operator", "...")) {
      this.advance();
      return true;
    }
    return false;
  }

  private parseRecordUpdateLiteral(loc: SourceLocation): AstNode {
    this.advance(); // consume {
    this.skipNewlines();

    const children: AstNode[] = [];

    // Parse the leading spread: ...base
    if (this.consumeSpreadIfPresent()) {
      const spreadLoc = this.loc();
      const spreadExpr = this.parsePrimary();
      children.push({ kind: "identifier", value: "#spread", location: spreadLoc, children: [spreadExpr] });
      this.skipNewlines();
      if (this.currentIs("symbol", ",")) {
        this.advance();
        this.skipNewlines();
      }
    }

    // Parse remaining field assignments: field: value
    while (!this.currentIs("symbol", "}") && !this.isEof()) {
      this.skipNewlines();
      if (this.currentIs("symbol", "}")) break;

      // Additional spreads are allowed: { ...a, ...b, field: v }
      if (this.consumeSpreadIfPresent()) {
        const spreadLoc = this.loc();
        const spreadExpr = this.parsePrimary();
        children.push({ kind: "identifier", value: "#spread", location: spreadLoc, children: [spreadExpr] });
        this.skipNewlines();
        if (this.currentIs("symbol", ",")) {
          this.advance();
          this.skipNewlines();
        }
        continue;
      }

      const fieldLoc = this.loc();
      const fieldTok = this.current();
      const fieldName = fieldTok.kind === "identifier" || fieldTok.kind === "keyword"
        ? fieldTok.value : "<field>";
      this.advance(); // consume field name

      this.expect("symbol", ":");
      this.skipNewlines();

      const fieldValue = this.parseExpression();
      children.push({
        kind: "identifier",
        value: fieldName,
        location: fieldLoc,
        children: [fieldValue],
      });

      this.skipNewlines();
      if (this.currentIs("symbol", ",")) {
        this.advance();
        this.skipNewlines();
      }
    }

    this.expect("symbol", "}");
    return { kind: "callExpr", value: "#record-update", location: loc, children };
  }

  private parseArgList(): AstNode[] {
    const args: AstNode[] = [];

    while (!this.currentIs("symbol", ")") && !this.isEof()) {
      this.skipNewlines();
      if (this.currentIs("symbol", ")")) break;

      // Named argument: name: value
      // Also accept keyword tokens as labels (e.g. AuditLog.write(event: "Test"))
      if (
        (this.current().kind === "identifier" || this.current().kind === "keyword") &&
        this.peek(1).kind === "symbol" &&
        this.peek(1).value === ":"
      ) {
        const loc = this.loc();
        const label = this.current().value;
        this.advance(); // name
        this.advance(); // :
        const val = this.parseExpression();
        args.push({ kind: "identifier", value: label, location: loc, children: [val] });
      } else {
        args.push(this.parseExpression());
      }

      this.skipNewlines();
      if (this.currentIs("symbol", ",")) {
        this.advance();
      }
    }

    return args;
  }

  // ── Generic block parser (for intent, governance, api) ────────────────────

  /**
   * Parses a named block declaration that is not yet fully specified.
   * Consumes until the matching closing `}`.
   */
  /**
   * Parses a feature-gate attribute directive:
   *   @experimental_profile(name: "drcm_core_v1", status: "planned_phase_5") { ... }
   *
   * First-class AST node (attributeDecl) — grammar is fully validated.
   * In --release mode: inner block is stored as children but verification/emission skipped.
   * In --enable-experimental-profile=X: full pipeline applies to inner block.
   *
   * AST: { kind: "attributeDecl", value: "experimental_profile",
   *        children: [arg1, arg2, ..., blockNode] }
   * Each arg: { kind: "identifier", value: "key", children: [stringLiteral("val")] }
   */
  private parseAttributeDirective(): AstNode {
    const loc = this.loc();
    this.advance(); // consume @

    // Read attribute name (e.g. "experimental_profile")
    const nameTok = this.current();
    const attrName = (nameTok.kind === "identifier" || nameTok.kind === "keyword")
      ? nameTok.value : "unknown";
    if (nameTok.kind === "identifier" || nameTok.kind === "keyword") this.advance();
    this.skipNewlines();

    // Parse attribute argument list: (key: "val", key: "val")
    const args: AstNode[] = [];
    if (this.currentIs("symbol", "(")) {
      this.advance(); // consume (
      this.skipNewlines();
      while (!this.currentIs("symbol", ")") && !this.isEof()) {
        this.skipNewlines();
        if (this.currentIs("symbol", ")")) break;
        const argLoc = this.loc();
        const keyTok = this.current();
        const key = (keyTok.kind === "identifier" || keyTok.kind === "keyword")
          ? keyTok.value : "";
        if (keyTok.kind === "identifier" || keyTok.kind === "keyword") this.advance();
        if (this.currentIs("symbol", ":")) this.advance();
        this.skipNewlines();
        // Value: string literal
        const valTok = this.current();
        let val = "";
        if (valTok.kind === "string") {
          val = valTok.value;
          this.advance();
        } else if (valTok.kind === "identifier" || valTok.kind === "keyword") {
          val = `"${valTok.value}"`;
          this.advance();
        }
        if (key !== "") {
          args.push({
            kind: "identifier",
            value: key,
            location: argLoc,
            children: [{ kind: "stringLiteral", value: val, location: argLoc }],
          });
        }
        this.skipNewlines();
        if (this.currentIs("symbol", ",")) this.advance();
      }
      this.expect("symbol", ")");
      this.skipNewlines();
    }

    // Parse the body block { ... }.
    // The inner content may contain forward-looking DRCM keywords (step, invariant, etc.)
    // that aren't implemented yet. We skip the content with brace-counting and store it
    // as a raw "block" placeholder. When each DRCM phase ships, the inner block will be
    // fully parsed. Grammar errors in the outer structure (@, name, args, braces) ARE caught.
    let body: AstNode = { kind: "block", location: loc };
    if (this.currentIs("symbol", "{")) {
      const blockLoc = this.loc();
      this.skipBalancedBraces(); // skip inner content — forward-looking syntax not yet parsed
      body = { kind: "block", value: "__experimental__", location: blockLoc };
    }

    return {
      kind: "attributeDecl",
      value: attrName,
      location: loc,
      children: [...args, body],
    };
  }

  private parseGenericBlock(kind: AstNodeKind): AstNode {
    const loc = this.loc();
    const keyword = this.current().value;
    this.advance(); // consume keyword

    let name = "";
    if (this.current().kind === "identifier") {
      name = this.current().value;
      this.advance();
    }

    // Skip to opening brace
    while (!this.currentIs("symbol", "{") && !this.isEof()) {
      this.advance();
    }

    if (this.currentIs("symbol", "{")) {
      this.skipBalancedBraces();
    }

    return { kind, value: `${keyword} ${name}`.trim(), location: loc };
  }

  private parseIntentDecl(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "intent"

    let value = "";

    // Block form: `intent { "string literal" }` — extract the string content.
    // This form is used inside `contract { intent { "..." } }` blocks.
    if (this.currentIs("symbol", "{")) {
      this.advance(); // consume {
      this.skipNewlines();
      if (this.current().kind === "string") {
        const raw = this.current().value;
        value = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
        this.advance();
      }
      // Consume any remaining tokens up to closing brace
      while (!this.currentIs("symbol", "}") && !this.isEof()) {
        this.advance();
      }
      this.expect("symbol", "}");
      return { kind: "intentDecl", value, location: loc };
    }

    if (this.current().kind === "string") {
      // Strip surrounding double-quotes from the string literal
      const raw = this.current().value;
      value = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
      this.advance();
    } else if (this.current().kind === "identifier") {
      value = this.current().value;
      this.advance();
    }

    return { kind: "intentDecl", value, location: loc };
  }

  /**
   * Parses an `authority { kind target reason "..." audit required/optional require effect.name }` block.
   *
   * Syntax:
   *   authority share Payments.processor {
   *     reason "needed for processing"
   *     audit required
   *     require payment.write
   *   }
   *
   * Stored as: { kind: "authorityDecl", value: "<authority-kind>", children: [...clauses] }
   * where authority-kind is share | delegate | grant | <identifier>
   */
  private parseAuthorityBlock(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "authority"
    this.skipNewlines();

    // Authority kind: share | delegate | grant | identifier
    let authorityKind = "";
    if (this.current().kind === "keyword" || this.current().kind === "identifier") {
      authorityKind = this.current().value;
      this.advance();
      this.skipNewlines();
    }

    // Optional authority target: qualified name (e.g. Payments.processor)
    let target = "";
    if (this.current().kind === "identifier") {
      target = this.current().value;
      this.advance();
      // Consume dot-path continuations
      while (this.currentIs("symbol", ".")) {
        this.advance();
        if (this.current().kind === "identifier" || this.current().kind === "keyword") {
          target += "." + this.current().value;
          this.advance();
        } else break;
      }
      this.skipNewlines();
    }

    const children: AstNode[] = [];
    if (target !== "") {
      children.push({ kind: "identifier", value: `target:${target}`, location: loc });
    }

    if (!this.currentIs("symbol", "{")) {
      return { kind: "authorityDecl", value: authorityKind || "authority", location: loc, children };
    }

    this.advance(); // consume {
    this.skipNewlines();

    while (!this.currentIs("symbol", "}") && !this.isEof()) {
      const tok = this.current();
      const clauseLoc = this.loc();

      // reason "string"
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "reason") {
        this.advance();
        this.skipNewlines();
        let reasonText = "";
        if (this.current().kind === "string") {
          const raw = this.current().value;
          reasonText = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
          this.advance();
        }
        children.push({ kind: "stringLiteral", value: reasonText, location: clauseLoc });
        this.skipNewlines();
        continue;
      }

      // audit required | optional
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "audit") {
        this.advance();
        this.skipNewlines();
        let auditLevel = "required";
        if (this.current().kind === "keyword" || this.current().kind === "identifier") {
          auditLevel = this.current().value;
          this.advance();
        }
        children.push({ kind: "identifier", value: `audit:${auditLevel}`, location: clauseLoc });
        this.skipNewlines();
        continue;
      }

      // require effect.name
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "require") {
        this.advance();
        this.skipNewlines();
        let req = "";
        // Consume a dot-path identifier (e.g. payment.write → "payment" "." "write")
        if (this.current().kind === "identifier" || this.current().kind === "keyword") {
          req = this.current().value;
          this.advance();
          while (this.currentIs("symbol", ".")) {
            this.advance(); // consume "."
            if (this.current().kind === "identifier" || this.current().kind === "keyword") {
              req += "." + this.current().value;
              this.advance();
            } else break;
          }
        }
        children.push({ kind: "effectRef", value: req.trim(), location: clauseLoc });
        this.skipNewlines();
        continue;
      }

      // Skip unrecognised content
      if (this.currentIs("symbol", "{")) {
        this.skipBalancedBraces();
      } else {
        this.advance();
      }
      this.skipNewlines();
    }

    this.expect("symbol", "}");
    return { kind: "authorityDecl", value: authorityKind || "authority", location: loc, children };
  }

  /**
   * Parses a `policy { purpose "tag" allow TypeRef to "action" deny TypeRef require effectName }` block.
   *
   * @deprecated Use `access {}` for inline capability negotiation blocks.
   *
   * NOTE: The `policy` keyword is RESERVED for future State Mutation Governance
   * (permitted transitions on `mut` variables — how state is allowed to change over time).
   * See: logicn-build-roadmap.md — Tower-Native Syntax v2.1 spec.
   *
   * For now: accepted silently as an alias for `access {}`. Will become LLN-SYNTAX-LEGACY-003
   * in a future version.
   *
   * Syntax:
   *   policy {
   *     purpose "data-processing"
   *     allow Payment to "process"
   *     deny RawCard
   *     require payment.write
   *   }
   *
   * Stored as: { kind: "policyDecl", value: "policy", children: [...clauses] }
   */
  private parsePolicyBlock(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "policy"
    this.skipNewlines();

    const children: AstNode[] = [];

    // Optional name after keyword
    let policyName = "policy";
    if (this.current().kind === "identifier") {
      policyName = this.current().value;
      this.advance();
      this.skipNewlines();
    }

    if (!this.currentIs("symbol", "{")) {
      return { kind: "policyDecl", value: policyName, location: loc, children };
    }

    this.advance(); // consume {
    this.skipNewlines();

    while (!this.currentIs("symbol", "}") && !this.isEof()) {
      const tok = this.current();
      const clauseLoc = this.loc();

      // purpose "machine-readable-tag"
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "purpose") {
        this.advance();
        this.skipNewlines();
        let purposeText = "";
        if (this.current().kind === "string") {
          const raw = this.current().value;
          purposeText = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
          this.advance();
        } else if (this.current().kind === "identifier" || this.current().kind === "keyword") {
          purposeText = this.current().value;
          this.advance();
        }
        children.push({ kind: "identifier", value: `purpose:${purposeText}`, location: clauseLoc });
        this.skipNewlines();
        continue;
      }

      // allow TypeRef [to "action"]
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "allow") {
        this.advance();
        this.skipNewlines();
        const typeRef = this.parseTypeRef();
        let action = "";
        this.skipNewlines();
        if ((this.current().kind === "keyword" || this.current().kind === "identifier") && this.current().value === "to") {
          this.advance();
          this.skipNewlines();
          if (this.current().kind === "string") {
            const raw = this.current().value;
            action = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
            this.advance();
          }
        }
        children.push({ kind: "typeRef", value: `allow:${typeRef.value ?? ""}${action !== "" ? ` to ${action}` : ""}`, location: clauseLoc });
        this.skipNewlines();
        continue;
      }

      // deny TypeRef
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "deny") {
        this.advance();
        this.skipNewlines();
        const typeRef = this.parseTypeRef();
        children.push({ kind: "typeRef", value: `deny:${typeRef.value ?? ""}`, location: clauseLoc });
        this.skipNewlines();
        continue;
      }

      // require effectName
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "require") {
        this.advance();
        this.skipNewlines();
        let req = "";
        // Consume a dot-path identifier (e.g. payment.write → "payment" "." "write")
        if (this.current().kind === "identifier" || this.current().kind === "keyword") {
          req = this.current().value;
          this.advance();
          while (this.currentIs("symbol", ".")) {
            this.advance(); // consume "."
            if (this.current().kind === "identifier" || this.current().kind === "keyword") {
              req += "." + this.current().value;
              this.advance();
            } else break;
          }
        }
        children.push({ kind: "effectRef", value: req.trim(), location: clauseLoc });
        this.skipNewlines();
        continue;
      }

      // Hierarchical Policy Inheritance: parent_policy: ParentPolicyName (task #72)
      // Declares that this policy INHERITS from a parent policy ceiling.
      // The governance verifier enforces: child permitted_effects ⊆ parent permitted_effects.
      // This prevents privilege escalation through policy derivation.
      // Syntax: parent_policy: FinanceDomainGuard
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "parent_policy") {
        this.advance(); // consume "parent_policy"
        this.skipNewlines();
        // consume optional colon
        if (this.currentIs("symbol", ":")) {
          this.advance();
          this.skipNewlines();
        }
        let parentName = "";
        if (this.current().kind === "identifier") {
          parentName = this.current().value;
          this.advance();
        }
        children.push({ kind: "identifier", value: `parent_policy:${parentName}`, location: clauseLoc });
        this.skipNewlines();
        continue;
      }

      // Domain Guard Policy: permitted_effects { effect.name, ... }
      // Stores each effect name as an effectRef child of a "permitted_effects" sub-block.
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "permitted_effects") {
        children.push(this.parseDomainGuardList("permitted_effects"));
        this.skipNewlines();
        continue;
      }

      // Domain Guard Policy: permitted_capabilities { SystemCapability.X(...) }
      // Stored as a generic sub-block for now; full structured parsing in DRCM Phase 4.
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "permitted_capabilities") {
        children.push(this.parseContractSubBlock("permitted_capabilities"));
        this.skipNewlines();
        continue;
      }

      // Domain Guard Policy: enforced_limits { max_memory_ceiling: 4MB, ... }
      // Stores each limit as an identifier child: "max_memory_ceiling:4MB" etc.
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "enforced_limits") {
        children.push(this.parseDomainGuardLimits());
        this.skipNewlines();
        continue;
      }

      // Emergency overlay: emergency { on X { deny Y } }
      // DRCM Phase 4 (task #39): delegate to parseEmergencyBlock() for structured AST.
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "emergency") {
        children.push(this.parseEmergencyBlock());
        this.skipNewlines();
        continue;
      }

      // Skip unrecognised content
      if (this.currentIs("symbol", "{")) {
        this.skipBalancedBraces();
      } else {
        this.advance();
      }
      this.skipNewlines();
    }

    this.expect("symbol", "}");
    return { kind: "policyDecl", value: policyName, location: loc, children };
  }

  /**
   * Parse: guard Name { permitted_effects {} enforced_limits {} parent_policy: X emergency {} }
   *
   * `guard` is the v2.2 canonical name for top-level domain ceiling declarations.
   * Replaces the `policy Name {}` form. The governance verifier performs the
   * Differential Proof: contract [conforms_to: Name] effects ⊆ guard.permitted_effects.
   *
   * Accepts all the same sub-blocks as parsePolicyBlock() for named policies.
   * Stored as: { kind: "guardDecl", value: guardName, children: [...clauses] }
   */
  private parseGuardDecl(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "guard"
    this.skipNewlines();

    let guardName = "guard";
    if (this.current().kind === "identifier") {
      guardName = this.current().value;
      this.advance();
      this.skipNewlines();
    }

    // Delegate to the same sub-block parsing as parsePolicyBlock but produce guardDecl
    const children: AstNode[] = [];

    if (!this.currentIs("symbol", "{")) {
      return { kind: "guardDecl", value: guardName, location: loc, children };
    }

    this.advance(); // consume {
    this.skipNewlines();

    while (!this.currentIs("symbol", "}") && !this.isEof()) {
      const tok = this.current();
      const clauseLoc = this.loc();

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "parent_policy") {
        this.advance();
        this.skipNewlines();
        if (this.currentIs("symbol", ":")) { this.advance(); this.skipNewlines(); }
        let parentName = "";
        if (this.current().kind === "identifier") { parentName = this.current().value; this.advance(); }
        children.push({ kind: "identifier", value: `parent_policy:${parentName}`, location: clauseLoc });
        this.skipNewlines();
        continue;
      }

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "permitted_effects") {
        children.push(this.parseDomainGuardList("permitted_effects"));
        this.skipNewlines();
        continue;
      }

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "permitted_capabilities") {
        children.push(this.parseContractSubBlock("permitted_capabilities"));
        this.skipNewlines();
        continue;
      }

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "enforced_limits") {
        children.push(this.parseDomainGuardLimits());
        this.skipNewlines();
        continue;
      }

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "emergency") {
        children.push(this.parseEmergencyBlock());
        this.skipNewlines();
        continue;
      }

      if (this.currentIs("symbol", "{")) this.skipBalancedBraces();
      else this.advance();
      this.skipNewlines();
    }

    this.expect("symbol", "}");
    return { kind: "guardDecl", value: guardName, location: loc, children };
  }

  /**
   * Parse `access { purpose allow deny require }` — capability negotiation at the flow boundary.
   *
   * This is the v2.1 replacement for inline `policy {}`. Position: between `contract {}` and `{ body }`.
   *
   * Syntax:
   *   access {
   *     purpose "data-processing"
   *     allow String to "process"
   *     deny RawInput
   *     require effect.name
   *   }
   *
   * Stored as: { kind: "accessDecl", value: "access", children: [...clauses] }
   *
   * Distinct from top-level named Domain Guard policies:
   *   - No `parent_policy:` clause (that's for named policies only)
   *   - No `emergency {}` sub-block (that's for named policies only)
   *   - Just: purpose, allow X to "action", deny Y, require effect.name
   */
  private parseAccessBlock(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "access"
    this.skipNewlines();

    const children: AstNode[] = [];

    if (!this.currentIs("symbol", "{")) {
      return { kind: "accessDecl", value: "access", location: loc, children };
    }

    this.advance(); // consume {
    this.skipNewlines();

    while (!this.currentIs("symbol", "}") && !this.isEof()) {
      const tok = this.current();
      const clauseLoc = this.loc();

      // purpose "machine-readable-tag"
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "purpose") {
        this.advance();
        this.skipNewlines();
        let purposeText = "";
        if (this.current().kind === "string") {
          const raw = this.current().value;
          purposeText = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
          this.advance();
        } else if (this.current().kind === "identifier" || this.current().kind === "keyword") {
          purposeText = this.current().value;
          this.advance();
        }
        children.push({ kind: "identifier", value: `purpose:${purposeText}`, location: clauseLoc });
        this.skipNewlines();
        continue;
      }

      // allow TypeRef [to "action"]
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "allow") {
        this.advance();
        this.skipNewlines();
        const typeRef = this.parseTypeRef();
        let action = "";
        this.skipNewlines();
        if ((this.current().kind === "keyword" || this.current().kind === "identifier") && this.current().value === "to") {
          this.advance();
          this.skipNewlines();
          if (this.current().kind === "string") {
            const raw = this.current().value;
            action = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
            this.advance();
          }
        }
        children.push({ kind: "typeRef", value: `allow:${typeRef.value ?? ""}${action !== "" ? ` to ${action}` : ""}`, location: clauseLoc });
        this.skipNewlines();
        continue;
      }

      // deny TypeRef
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "deny") {
        this.advance();
        this.skipNewlines();
        const typeRef = this.parseTypeRef();
        children.push({ kind: "typeRef", value: `deny:${typeRef.value ?? ""}`, location: clauseLoc });
        this.skipNewlines();
        continue;
      }

      // require effectName (dot-path)
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "require") {
        this.advance();
        this.skipNewlines();
        let req = "";
        if (this.current().kind === "identifier" || this.current().kind === "keyword") {
          req = this.current().value;
          this.advance();
          while (this.currentIs("symbol", ".")) {
            this.advance();
            if (this.current().kind === "identifier" || this.current().kind === "keyword") {
              req += "." + this.current().value;
              this.advance();
            } else break;
          }
        }
        children.push({ kind: "effectRef", value: req.trim(), location: clauseLoc });
        this.skipNewlines();
        continue;
      }

      // grant capability.name — Hot-Code Residency / assimilate plugin capability grant.
      // Declares a V_DPM bit to pre-warm at boot. Stored as identifier with "grant:" prefix.
      // Syntax: grant network.outbound  → identifier { value: "grant:network.outbound" }
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "grant") {
        this.advance(); // consume "grant"
        this.skipNewlines();
        let cap = "";
        if (this.current().kind === "identifier" || this.current().kind === "keyword") {
          cap = this.current().value;
          this.advance();
          while (this.currentIs("symbol", ".")) {
            this.advance();
            if (this.current().kind === "identifier" || this.current().kind === "keyword") {
              cap += "." + this.current().value;
              this.advance();
            } else break;
          }
        }
        children.push({ kind: "identifier", value: `grant:${cap}`, location: clauseLoc });
        this.skipNewlines();
        continue;
      }

      // Skip unrecognised content
      if (this.currentIs("symbol", "{")) {
        this.skipBalancedBraces();
      } else {
        this.advance();
      }
      this.skipNewlines();
    }

    this.expect("symbol", "}");
    return { kind: "accessDecl", value: "access", location: loc, children };
  }

  /**
   * Parse: static NAME = EXPR
   *
   * Defines a compile-time constant. The compiler substitutes the value everywhere
   * NAME appears — zero memory overhead, O(1) lookup.
   *
   * Used for: topology constants (MAX_NODES, FLOOR_PROOF), bitmask values (V_DPM bit positions).
   *
   * Syntax:
   *   static MAX_NODES = 2867
   *   static FLOOR_PROOF = 3
   */
  private parseStaticDecl(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "static"
    this.skipNewlines();

    let name = "";
    if (this.current().kind === "identifier") {
      name = this.current().value;
      this.advance();
    }
    this.skipNewlines();

    // consume "="
    if (this.currentIs("operator", "=") || this.currentIs("symbol", "=")) {
      this.advance();
      this.skipNewlines();
    }

    const valueExpr = this.parseExpression();

    return {
      kind: "staticDecl",
      value: name,
      location: loc,
      children: [valueExpr],
    };
  }

  /**
   * Parse: bitfield NAME { field: BIT_POSITION, ... }
   *
   * Defines a type-safe V_DPM capability register. The compiler generates:
   *   NAME.field_name = (1 << BIT_POSITION)   for bitmask values
   *   NAME.BIT_field_name = BIT_POSITION        for bit positions
   *
   * Example:
   *   bitfield V_DPM {
   *     network_outbound: 0
   *     storage_write: 1
   *     secret_access: 2
   *   }
   *   // Usage: V_DPM.network_outbound = 1, V_DPM.storage_write = 2
   *
   * Used for: V_DPM governance registers, MMCP capability masks.
   * Replaces the verbose `pure flow VDPM_BIT_*() -> Int { return N }` pattern.
   */
  private parseBitfieldDecl(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "bitfield"
    this.skipNewlines();

    let name = "";
    if (this.current().kind === "identifier") {
      name = this.current().value;
      this.advance();
      this.skipNewlines();
    }

    const fields: AstNode[] = [];

    if (!this.currentIs("symbol", "{")) {
      return { kind: "bitfieldDecl", value: name, location: loc, children: fields };
    }

    this.advance(); // consume {
    this.skipNewlines();

    while (!this.currentIs("symbol", "}") && !this.isEof()) {
      const fieldLoc = this.loc();
      const tok = this.current();

      if (tok.kind === "identifier" || tok.kind === "keyword") {
        const fieldName = tok.value;
        this.advance();
        this.skipNewlines();

        // consume optional ":"
        if (this.currentIs("symbol", ":")) {
          this.advance();
          this.skipNewlines();
        }

        // bit position (integer literal)
        let bitPos = 0;
        if (this.current().kind === "number") {
          bitPos = parseInt(this.current().value, 10);
          this.advance();
        }

        fields.push({
          kind: "identifier",
          value: `${fieldName}:${bitPos}`,
          location: fieldLoc,
        });
      } else {
        this.advance(); // skip unknown
      }

      // optional comma
      if (this.currentIs("symbol", ",")) this.advance();
      this.skipNewlines();
    }

    if (this.currentIs("symbol", "}")) this.advance();

    return { kind: "bitfieldDecl", value: name, location: loc, children: fields };
  }

  /**
   * Parse: gate(condition) { flow ... }
   *
   * Wraps a flow with an admission guard. The compiler inserts a V_DPM capability
   * check (bit 8 = dag_edge_valid) at flow dispatch time. Only flows inside a gate
   * block are reachable from specific caller contexts.
   *
   * Syntax:
   *   gate(admin_only) {
   *     flow withdraw(amount: Int) -> Result
   *     contract { ... }
   *     { body }
   *   }
   *
   * The condition (e.g. admin_only) maps to a Domain Guard Policy name or a
   * V_DPM capability bit. Verified at compile time via the knownDomainGuards registry.
   *
   * Multiple flows may be wrapped in a single gate block.
   */
  private parseGateBlock(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "gate"
    this.skipNewlines();

    // Optional (condition) — gate predicate / Domain Guard name
    let condition = "";
    if (this.currentIs("symbol", "(")) {
      this.advance(); // consume (
      this.skipNewlines();
      while (!this.currentIs("symbol", ")") && !this.isEof()) {
        if (this.current().kind === "identifier" || this.current().kind === "keyword") {
          condition += this.current().value;
          this.advance();
        } else {
          this.advance();
        }
        this.skipNewlines();
      }
      if (this.currentIs("symbol", ")")) this.advance(); // consume )
      this.skipNewlines();
    }

    const children: AstNode[] = [];

    if (!this.currentIs("symbol", "{")) {
      return { kind: "gateDecl", value: condition, location: loc, children };
    }

    this.advance(); // consume {
    this.skipNewlines();

    // Parse flows inside the gate block
    while (!this.currentIs("symbol", "}") && !this.isEof()) {
      this.skipNewlines();
      const tok = this.current();

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "flow") {
        // parseFlowDecl() expects to consume "flow" itself via this.expect("keyword", "flow")
        children.push(this.parseFlowDecl("flow"));
        this.skipNewlines();
        continue;
      }
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "secure") {
        children.push(this.parseSecureOrPureFlow());
        this.skipNewlines();
        continue;
      }
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "guarded") {
        children.push(this.parseGuardedFlow());
        this.skipNewlines();
        continue;
      }
      // Unknown — skip
      if (this.currentIs("symbol", "{")) this.skipBalancedBraces();
      else this.advance();
      this.skipNewlines();
    }

    if (this.currentIs("symbol", "}")) this.advance(); // consume }

    return { kind: "gateDecl", value: condition, location: loc, children };
  }

  /**
   * Parse: emergency { on signalName { deny cap, quarantine, emergency } ... }
   *
   * Produces: { kind: "identifier", value: "emergency:block", children: [
   *   { kind: "emergencyTransitionDecl", value: "invariant_failure", children: [
   *     { kind: "identifier", value: "deny:network.outbound" },
   *     { kind: "identifier", value: "action:quarantine" },
   *   ] },
   *   ...
   * ]}
   *
   * Called from parsePolicyBlock() for the `emergency { }` sub-block.
   * The governance verifier (LLN-MONO-001/002) validates the transitions.
   *
   * DRCM Phase 4 (task #39).
   */
  private parseEmergencyBlock(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "emergency"
    this.skipNewlines();

    const transitions: AstNode[] = [];

    if (!this.currentIs("symbol", "{")) {
      return { kind: "identifier", value: "emergency:block", location: loc, children: transitions };
    }

    this.advance(); // consume {
    this.skipNewlines();

    while (!this.currentIs("symbol", "}") && !this.isEof()) {
      const tok = this.current();

      // on signalName { deny X, quarantine, emergency }
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "on") {
        const transLoc = this.loc();
        this.advance(); // consume "on"
        this.skipNewlines();

        // signal name
        let signal = "any_failure";
        if (this.current().kind === "identifier" || this.current().kind === "keyword") {
          signal = this.current().value;
          this.advance();
          // Handle compound signals like "invariant_failure" (already single identifier)
        }
        this.skipNewlines();

        const actions: AstNode[] = [];

        if (this.currentIs("symbol", "{")) {
          this.advance(); // consume {
          this.skipNewlines();

          while (!this.currentIs("symbol", "}") && !this.isEof()) {
            const actionTok = this.current();
            const actionLoc = this.loc();

            // deny effectName
            if ((actionTok.kind === "keyword" || actionTok.kind === "identifier") && actionTok.value === "deny") {
              this.advance(); // consume "deny"
              this.skipNewlines();
              let effName = "";
              // dot-path effect name
              if (this.current().kind === "identifier" || this.current().kind === "keyword") {
                effName = this.current().value;
                this.advance();
                while (this.currentIs("symbol", ".")) {
                  this.advance();
                  if (this.current().kind === "identifier" || this.current().kind === "keyword") {
                    effName += "." + this.current().value;
                    this.advance();
                  } else break;
                }
              }
              actions.push({ kind: "identifier", value: `deny:${effName}`, location: actionLoc });
              this.skipNewlines();
              continue;
            }

            // quarantine — set quarantine_engaged flag
            if ((actionTok.kind === "keyword" || actionTok.kind === "identifier") && actionTok.value === "quarantine") {
              this.advance();
              actions.push({ kind: "identifier", value: "action:quarantine", location: actionLoc });
              this.skipNewlines();
              continue;
            }

            // emergency — set emergency_mode flag
            if ((actionTok.kind === "keyword" || actionTok.kind === "identifier") && actionTok.value === "emergency") {
              this.advance();
              actions.push({ kind: "identifier", value: "action:emergency_mode", location: actionLoc });
              this.skipNewlines();
              continue;
            }

            // halt — block all further execution
            if ((actionTok.kind === "keyword" || actionTok.kind === "identifier") && actionTok.value === "halt") {
              this.advance();
              actions.push({ kind: "identifier", value: "action:halt", location: actionLoc });
              this.skipNewlines();
              continue;
            }

            // Unknown action — consume and skip
            this.advance();
            this.skipNewlines();
          }

          if (this.currentIs("symbol", "}")) this.advance(); // consume }
        }

        transitions.push({
          kind: "emergencyTransitionDecl",
          value: signal,
          location: transLoc,
          children: actions,
        });
        this.skipNewlines();
        continue;
      }

      // Unknown content — skip
      if (this.currentIs("symbol", "{")) this.skipBalancedBraces();
      else this.advance();
      this.skipNewlines();
    }

    if (this.currentIs("symbol", "}")) this.advance(); // consume outer }

    return { kind: "identifier", value: "emergency:block", location: loc, children: transitions };
  }

  /**
   * Parses a Domain Guard list block: `permitted_effects { effect.name, effect2.name }`.
   * Returns a node with kind = the blockName and children = effectRef nodes (one per entry).
   */
  private parseDomainGuardList(blockName: string): AstNode {
    const loc = this.loc();
    this.advance(); // consume block name
    this.skipNewlines();

    const entries: AstNode[] = [];

    if (!this.currentIs("symbol", "{")) {
      return { kind: "identifier", value: blockName, location: loc, children: entries };
    }

    this.advance(); // consume {
    this.skipNewlines();

    while (!this.currentIs("symbol", "}") && !this.isEof()) {
      this.skipNewlines();
      if (this.currentIs("symbol", "}")) break;

      // Consume a dot-path effect name: e.g. gateway.charge, ledger.mutate
      const entryLoc = this.loc();
      let name = "";
      if (this.current().kind === "identifier" || this.current().kind === "keyword") {
        name = this.current().value;
        this.advance();
        while (this.currentIs("symbol", ".")) {
          this.advance();
          if (this.current().kind === "identifier" || this.current().kind === "keyword") {
            name += "." + this.current().value;
            this.advance();
          } else break;
        }
      }
      if (name !== "") {
        entries.push({ kind: "effectRef", value: name, location: entryLoc });
      }

      this.skipNewlines();
      if (this.currentIs("symbol", ",")) {
        this.advance();
        this.skipNewlines();
      }
    }

    this.expect("symbol", "}");
    return { kind: "identifier", value: blockName, location: loc, children: entries };
  }

  /**
   * Parses `enforced_limits { max_memory_ceiling: 4MB, max_instructions_ceiling: 5_000_000 }`.
   * Each entry is stored as `identifier { value: "max_memory_ceiling", children: [stringLiteral("4MB")] }`.
   */
  private parseDomainGuardLimits(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "enforced_limits"
    this.skipNewlines();

    const entries: AstNode[] = [];

    if (!this.currentIs("symbol", "{")) {
      return { kind: "identifier", value: "enforced_limits", location: loc, children: entries };
    }

    this.advance(); // consume {
    this.skipNewlines();

    while (!this.currentIs("symbol", "}") && !this.isEof()) {
      this.skipNewlines();
      if (this.currentIs("symbol", "}")) break;

      const keyLoc = this.loc();
      // Key: identifier
      let key = "";
      if (this.current().kind === "identifier" || this.current().kind === "keyword") {
        key = this.current().value;
        this.advance();
      }

      this.skipNewlines();
      if (this.currentIs("symbol", ":")) {
        this.advance(); // consume :
        this.skipNewlines();
      }

      // Value: could be "4MB", an identifier, or a number
      let val = "";
      if (this.current().kind === "string") {
        const raw = this.current().value;
        val = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
        this.advance();
      } else if (this.current().kind === "number") {
        val = this.current().value;
        this.advance();
        // Allow a suffix like MB, GB etc.
        if (this.current().kind === "identifier") {
          val += this.current().value;
          this.advance();
        }
      } else if (this.current().kind === "identifier") {
        val = this.current().value;
        this.advance();
      }

      if (key !== "") {
        entries.push({
          kind: "identifier",
          value: key,
          location: keyLoc,
          children: [{ kind: "stringLiteral", value: val, location: keyLoc }],
        });
      }

      this.skipNewlines();
      if (this.currentIs("symbol", ",")) {
        this.advance();
        this.skipNewlines();
      }
    }

    this.expect("symbol", "}");
    return { kind: "identifier", value: "enforced_limits", location: loc, children: entries };
  }

  /** Skips a balanced `{ ... }` block without parsing the interior. */
  private skipBalancedBraces(): void {
    let depth = 0;
    while (!this.isEof()) {
      const tok = this.current();
      if (tok.kind === "symbol" && tok.value === "{") {
        depth++;
        this.advance();
      } else if (tok.kind === "symbol" && tok.value === "}") {
        depth--;
        this.advance();
        if (depth <= 0) break;
      } else {
        this.advance();
      }
    }
  }

  // ── Compute target block ──────────────────────────────────────────────────

  /**
   * Parses a `compute target <kind> { ... }` block.
   *
   * Syntax: compute target (cpu | gpu | npu | best) { body }
   *
   * This is a post-v1 runtime feature. The parser accepts the syntax now so
   * that LogicN source files with compute blocks can be parsed without errors.
   * Semantic enforcement (effect routing, tensor type checking) is Phase 7+.
   *
   * Ref: docs/Knowledge-Bases/governed-compute-chain.md
   */
  private parseComputeTarget(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "compute"
    this.skipNewlines();

    // Expect "target" as a reserved keyword in v1.
    if (
      (this.current().kind === "identifier" || this.current().kind === "keyword") &&
      this.current().value === "target"
    ) {
      this.advance();
    } else {
      this.emitUnexpected(`Expected "target" after "compute", got "${this.current().value}".`);
    }

    this.skipNewlines();

    // Target kind: cpu | gpu | npu | best — identifiers or keywords
    let targetKind = "cpu";
    if (this.current().kind === "identifier" || this.current().kind === "keyword") {
      targetKind = this.current().value;
      this.advance();
    } else {
      this.emitUnexpected(`Expected compute target kind (cpu, gpu, npu, best), got "${this.current().value}".`);
    }

    this.skipNewlines();
    const body = this.parseBlock();

    return {
      kind: "computeTargetBlock",
      value: targetKind,
      location: loc,
      children: [body],
    };
  }

  // ── Hardware hint (prefer [...]) ─────────────────────────────────────────

  /**
   * Parses `prefer [gpu]`, `prefer [npu]`, `prefer [apu]`, `prefer [cpu]`,
   * or `prefer [npu, gpu, cpu]` (priority list).
   *
   * This is a hardware preference hint only. The parser preserves it as a
   * `preferHint` AST node. The SemanticGraph and ExecutionPlanner decide
   * what the hint means for each backend. The parser does NOT validate
   * hardware compatibility — that is a compiler/planner concern.
   *
   * Sets NodeFlags.HasCompute on the enclosing flow declaration.
   */
  private parsePreferHint(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "prefer"
    this.skipNewlines();

    const targets: string[] = [];

    if (this.currentIs("symbol", "[")) {
      this.advance(); // consume [
      while (!this.currentIs("symbol", "]") && !this.isEof()) {
        this.skipNewlines();
        const tok = this.current();
        if (tok.kind === "identifier" || tok.kind === "keyword") {
          targets.push(tok.value);
          this.advance();
        } else if (this.currentIs("symbol", ",")) {
          this.advance();
        } else {
          this.advance(); // skip unexpected
        }
      }
      if (this.currentIs("symbol", "]")) this.advance(); // consume ]
    } else {
      // Bare `prefer gpu` (no brackets) — accept as shorthand
      const tok = this.current();
      if (tok.kind === "identifier" || tok.kind === "keyword") {
        targets.push(tok.value);
        this.advance();
      }
    }

    // Encode targets as value string: "npu,gpu,cpu"
    const value = targets.join(",") || "cpu";
    return { kind: "preferHint", value, location: loc };
  }

  // ── fn helper declaration (inside flow body only) ─────────────────────────

  /**
   * Parses `fn name(params) -> ReturnType { body }` inside a flow body.
   *
   * Rules:
   *   - fn cannot declare effects — emits LLN-SEC-014 if found
   *   - fn cannot request authority
   *   - fn is always synchronous
   *   - Binding variables from fn params are registered in the fn's own scope
   */
  private parseFnDecl(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "fn"
    this.skipNewlines();

    const nameTok = this.expect("identifier");
    const name = nameTok?.value ?? "<unknown>";

    this.expect("symbol", "(");
    const params = this.parseParamList();
    this.expect("symbol", ")");

    // Optional return type
    let retTypeNode: AstNode | undefined;
    this.skipNewlines();
    if (this.currentIs("operator", "->")) {
      this.advance();
      retTypeNode = this.parseTypeRef();
    }

    // fn CANNOT declare effects — emit LLN-SEC-014 and skip the clause
    this.skipNewlines();
    const hasEffects =
      this.currentIs("keyword", "effects") ||
      (this.currentIs("keyword", "with") &&
        this.peek(1).kind === "keyword" &&
        this.peek(1).value === "effects");

    if (hasEffects) {
      this.emit(
        "LLN-SEC-014",
        "FN_CANNOT_DECLARE_EFFECTS",
        `Local fn '${name}' cannot declare effects. Effects belong to the containing flow.`,
        this.loc(),
        `Remove the effects clause from fn '${name}' and declare the effect on the enclosing flow.`,
      );
      // Skip the effects clause to recover
      while (!this.isEof() && !this.currentIs("symbol", "{")) this.advance();
    }

    this.skipNewlines();
    const body = this.parseBlock();

    const children: AstNode[] = [
      ...params,
      ...(retTypeNode !== undefined ? [retTypeNode] : []),
      body,
    ];

    return { kind: "fnDecl", value: name, location: loc, children };
  }

  // ── Route declaration ─────────────────────────────────────────────────────

  /**
   * Parses `route METHOD "path" { request T response T flow name }`.
   *
   * Routes contain no business logic — they declare the contract and delegate
   * entirely to a named flow.
   */
  private parseRouteDecl(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "route"
    this.skipNewlines();

    // HTTP method: GET POST PUT PATCH DELETE (identifier or keyword)
    let method = "";
    if (this.current().kind === "identifier" || this.current().kind === "keyword") {
      method = this.current().value.toUpperCase();
      this.advance();
    }
    this.skipNewlines();

    // Path string: "/orders" or "/users/{id}"
    let path = "";
    if (this.current().kind === "string") {
      path = this.current().value.replace(/^"|"$/g, "");
      this.advance();
    }

    const value = `${method} ${path}`.trim();

    // Route body: { request T response T flow f [permission ...] }
    this.skipNewlines();
    let requestType = "";
    let responseType = "";
    let flowName = "";
    if (this.currentIs("symbol", "{")) {
      this.advance(); // consume {
      this.skipNewlines();

      while (!this.currentIs("symbol", "}") && !this.isEof()) {
        const tok = this.current();
        const clauseName = tok.value;
        const isClauseToken = tok.kind === "identifier" || tok.kind === "keyword";

        if (isClauseToken && clauseName === "request") {
          this.advance();
          this.skipNewlines();
          if (this.current().kind === "identifier") {
            requestType = this.current().value;
            this.advance();
          }
        } else if (isClauseToken && clauseName === "response") {
          this.advance();
          this.skipNewlines();
          if (this.current().kind === "identifier") {
            responseType = this.current().value;
            this.advance();
          }
        } else if (isClauseToken && clauseName === "flow") {
          this.advance();
          this.skipNewlines();
          if (this.current().kind === "identifier") {
            flowName = this.current().value;
            this.advance();
          }
        } else if (isClauseToken && clauseName === "permission") {
          // Skip permission clause for now.
          while (!this.currentIs("newline", "\n") && !this.currentIs("symbol", "}") && !this.isEof()) {
            this.advance();
          }
        } else {
          this.advance();
        }

        this.skipNewlines();
      }

      this.expect("symbol", "}");
    }

    const children: AstNode[] = [];
    if (flowName !== "") {
      children.push({ kind: "identifier", value: `flow:${flowName}`, location: loc });
    }
    if (requestType !== "") {
      children.push({ kind: "typeRef", value: requestType, location: loc });
    }
    if (responseType !== "") {
      children.push({ kind: "identifier", value: `response:${responseType}`, location: loc });
    }

    return { kind: "routeDecl", value, location: loc, children };
  }

  // ── readonly binding declaration ──────────────────────────────────────────

  /**
   * Parses `readonly name: Type = expr` — a binding that cannot be reassigned.
   */
  private parseReadonlyDecl(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "readonly"

    const nameTok = this.expect("identifier");
    const name = nameTok?.value ?? "<unknown>";

    let typeValue = "";
    if (this.currentIs("symbol", ":")) {
      this.advance();
      const typeNode = this.parseTypeRefWithValueState();
      typeValue = typeNode.value ?? "";
    }

    this.expect("operator", "=");
    this.skipNewlines(); // allow initializer on next line: readonly x: T =\n  expr
    const init = this.parseExpression();

    const nameWithType = typeValue !== "" ? `${name}: ${typeValue}` : name;
    return { kind: "readonlyDecl", value: nameWithType, location: loc, children: [init] };
  }

  // ── Flow Contract (Pilot Candidate) ──────────────────────────────────────

  /**
   * Parses a `contract { types { } intent { } events { } }` block.
   *
   * In Stage 1 the body is stored as children of the contractDecl node.
   * Sub-blocks (types, intent, events) are parsed into identifier/intentDecl
   * children. Full semantic checking is Phase 9B+.
   *
   * The contract block may appear:
   *   - Attached to a flow (between signature and body)
   *   - As a top-level declaration (rare, for shared contract templates)
   */
  private parseContractDecl(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "contract"
    this.skipNewlines();

    const children: AstNode[] = [];

    // Optional [conforms_to: PolicyName] attribute on the contract block header.
    // Binds this contract to a domain guard policy (task #56 — Static Manifest Clamping).
    // The governance verifier performs a Differential Proof: contract ⊆ policy ceiling.
    let conformsTo: string | undefined;
    if (this.currentIs("symbol", "[")) {
      this.advance(); // consume [
      this.skipNewlines();
      if (
        (this.current().kind === "identifier" || this.current().kind === "keyword") &&
        this.current().value === "conforms_to"
      ) {
        this.advance(); // consume "conforms_to"
        this.skipNewlines();
        if (this.currentIs("symbol", ":")) {
          this.advance(); // consume :
          this.skipNewlines();
        }
        if (this.current().kind === "identifier") {
          conformsTo = this.current().value;
          this.advance();
        }
      }
      this.skipNewlines();
      this.expect("symbol", "]");
      this.skipNewlines();
    }

    if (!this.currentIs("symbol", "{")) {
      return { kind: "contractDecl", location: loc, children, ...(conformsTo !== undefined && { conformsTo }) };
    }

    this.advance(); // consume {
    this.skipNewlines();

    while (!this.currentIs("symbol", "}") && !this.isEof()) {
      const tok = this.current();

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "types") {
        children.push(this.parseContractSubBlock("types"));
        this.skipNewlines();
        continue;
      }

      if (tok.kind === "keyword" && tok.value === "intent") {
        children.push(this.parseIntentDecl());
        this.skipNewlines();
        continue;
      }

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "events") {
        children.push(this.parseContractSubBlock("events"));
        this.skipNewlines();
        continue;
      }

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "governance") {
        children.push(this.parseGenericBlock("governanceDecl"));
        this.skipNewlines();
        continue;
      }

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "rules") {
        children.push(this.parseContractSubBlock("rules"));
        this.skipNewlines();
        continue;
      }

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "audit") {
        children.push(this.parseContractSubBlock("audit"));
        this.skipNewlines();
        continue;
      }

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "use") {
        // use ContractSetName — reference a contract set
        this.advance(); // consume "use"
        this.skipNewlines();
        const setName = this.current().kind === "identifier" ? this.current().value : "<unknown>";
        if (this.current().kind === "identifier") this.advance();
        children.push({ kind: "identifier", value: `use:${setName}`, location: this.loc() });
        this.skipNewlines();
        continue;
      }

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "targets") {
        children.push(this.parseContractSubBlock("targets"));
        this.skipNewlines();
        continue;
      }

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "examples") {
        children.push(this.parseContractSubBlock("examples"));
        this.skipNewlines();
        continue;
      }

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "request") {
        children.push(this.parseContractSubBlock("request"));
        this.skipNewlines();
        continue;
      }

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "response") {
        children.push(this.parseContractSubBlock("response"));
        this.skipNewlines();
        continue;
      }

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "model") {
        children.push(this.parseContractSubBlock("model"));
        this.skipNewlines();
        continue;
      }

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "context") {
        children.push(this.parseContractSubBlock("context"));
        this.skipNewlines();
        continue;
      }

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "effects") {
        children.push(this.parseContractSubBlock("effects"));
        this.skipNewlines();
        continue;
      }

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "errors") {
        children.push(this.parseContractSubBlock("errors"));
        this.skipNewlines();
        continue;
      }

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "timeouts") {
        children.push(this.parseContractSubBlock("timeouts"));
        this.skipNewlines();
        continue;
      }

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "retries") {
        children.push(this.parseContractSubBlock("retries"));
        this.skipNewlines();
        continue;
      }

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "limits") {
        children.push(this.parseContractSubBlock("limits"));
        this.skipNewlines();
        continue;
      }

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "privacy") {
        children.push(this.parseContractSubBlock("privacy"));
        this.skipNewlines();
        continue;
      }

      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "observability") {
        children.push(this.parseContractSubBlock("observability"));
        this.skipNewlines();
        continue;
      }

      // `resilience { retry N times with_backoff X fallback Y quarantine_after N ... }`
      // Auto-by-default (omitted = inferred from effects profile). Task #58.
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "resilience") {
        children.push(this.parseContractSubBlock("resilience"));
        this.skipNewlines();
        continue;
      }

      // `invariant { ensure expr; ensure expr; }` — DRCM Phase 2 (#36)
      // Parses each `ensure` as a structured ensureDecl node for static evaluation.
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "invariant") {
        children.push(this.parseContractSubBlock("invariant"));
        this.skipNewlines();
        continue;
      }

      // `substrate { lane: photonic; tolerance: 1e-6; redundancy: 3 }` — Direction B.
      // Optional, peer to resilience/observability. Read by substrate-inference.ts;
      // a flow without it (or lane: digital) is inert. (#58 inferred-block family.)
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "substrate") {
        children.push(this.parseContractSubBlock("substrate"));
        this.skipNewlines();
        continue;
      }

      // `@experimental_profile(name: "drcm_core_v1", status: "planned_phaseN") { ... }`
      // Feature-gate attribute — wraps forward-looking DRCM syntax inside contract {}.
      // Parsed as a first-class attributeDecl AST node (task #51).
      if (tok.kind === "symbol" && tok.value === "@") {
        children.push(this.parseAttributeDirective());
        this.skipNewlines();
        continue;
      }

      // `memory { arena <size> }` — explicit memory budget declaration.
      // Compiler infers arena lifetime automatically; developer declares the bound.
      // Feeds: PassiveExecutionPlan, WASM memory limits, Arena allocation decisions.
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "memory") {
        children.push(this.parseContractSubBlock("memory"));
        this.skipNewlines();
        continue;
      }

      // `economics { target_latency target_cost max_compute_budget preferred_execution ... }`
      // Cost-aware scheduling contract. Feeds: CostGraph (Phase 30), runtime scheduler.
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "economics") {
        children.push(this.parseContractSubBlock("economics"));
        this.skipNewlines();
        continue;
      }

      // `lineage { source owner retention }` — data lineage declaration.
      // Enables automated regulatory reporting (GDPR Article 30, CCPA).
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "lineage") {
        children.push(this.parseContractSubBlock("lineage"));
        this.skipNewlines();
        continue;
      }

      // `ai { max_token_cost max_model_calls approved_models }` — AI governance.
      // Governs which AI models may be called and at what cost ceiling.
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "ai") {
        children.push(this.parseContractSubBlock("ai"));
        this.skipNewlines();
        continue;
      }

      // `value { classification safety_critical domain aerospace estimated_loss_per_incident ... }`
      // Asset consequence classification for High Consequence Systems (aerospace, defence, space, etc.)
      // Governance scope extends beyond PII to any system where failure has significant consequence.
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "value") {
        children.push(this.parseContractSubBlock("value"));
        this.skipNewlines();
        continue;
      }

      // `safety { require deterministic_execution require bounded_runtime require fallback ... }`
      // Safety requirements for safety_critical and mission_critical systems.
      // Applies: aerospace, industrial control, medical devices, infrastructure.
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "safety") {
        children.push(this.parseContractSubBlock("safety"));
        this.skipNewlines();
        continue;
      }

      // `hardware { target arm.sve2 require mte require pac allow google.tpu.inference }`
      // Hardware execution target and security feature requirements.
      // CostGraph uses these hints to route execution to the appropriate hardware.
      // Hardware may NEVER grant authority — it only affects execution cost/path.
      // Applies: ARM SVE2/SME2/MTE/PAC, AMD Zen4/RDNA/CDNA, Google Axion/TPU, Intel AVX2/AVX-512.
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "hardware") {
        children.push(this.parseContractSubBlock("hardware"));
        this.skipNewlines();
        continue;
      }

      // `cyber_physical_hardening { enclosure_shielding active_mesh fault_mitigation lockstep
      //   side_channel_protection constant_row on_tamper_signal zeroize }` —
      // Physical ASIC shielding directives. AUTO-BY-DEFAULT: the runtime selects the
      // appropriate shielding tier from the ValueGraph risk classification. Only declare
      // explicitly for sovereign/defense-grade flows with high economics.max_risk_liability.
      // Both AI and human authors should omit this block unless operating on Tier 1
      // hardware (active shielding mesh) with proven physical-breach risk.
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "cyber_physical_hardening") {
        children.push(this.parseContractSubBlock("cyber_physical_hardening"));
        this.skipNewlines();
        continue;
      }

      // `liability {}` — auto-calculated max legal/financial exposure from the ValueGraph
      // breach-risk matrix. NEVER written in source — the governance verifier computes and
      // stores it in the ProofGraph. If a developer writes it manually a LLN-GOV warning fires.
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "liability") {
        children.push(this.parseContractSubBlock("liability"));
        this.skipNewlines();
        continue;
      }

      // `secrets { credential <name> { provider ... } rotation { ... } }` — sealed
      // credentials topology. Optional + AUTO-by-default: when omitted, the runtime
      // handles config via standard env mapping (no sealed block). When declared, the
      // core parses + retains the block and stamps secret taint; vault/KMS mechanics
      // live in a non-core `logicn-ext-*` driver. See logicn-design-secrets-epilogue-blocks.md.
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "secrets") {
        children.push(this.parseContractSubBlock("secrets"));
        this.skipNewlines();
        continue;
      }

      // `epilogue { generate_proof <strategy> on_verification_failure <action> }` — post-
      // execution proof strategy. Optional + AUTO-by-default: when omitted, the runtime
      // selects the proof tier from the CostGraph/ValueGraph (sha256_seal vs zk_snark_receipt),
      // mirroring `economics`. When declared, the explicit strategy is enforced.
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "epilogue") {
        children.push(this.parseContractSubBlock("epilogue"));
        this.skipNewlines();
        continue;
      }

      // `assuming(flowRef, "claim") { ... }` — explicit proof-tracing assertion (#73).
      // Declares that a proof established in a parent/sibling flow is being borrowed.
      // The governance verifier (task #74) looks up the referenced flow's .lmanifest,
      // checks the proof obligation exists + is signed, then elides the WAT gate.
      // Syntax: assuming(flowName, "ensure condition") { optional_notes }
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "assuming") {
        children.push(this.parseAssumingDecl());
        this.skipNewlines();
        continue;
      }

      // `access { grant X grant Y ... }` — capability negotiation block inside contract.
      // Used by import plugin assimilate contracts to declare pre-warmed V_DPM bits.
      // Parsed as an accessDecl child so verifiers can locate grant declarations.
      if ((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "access") {
        children.push(this.parseAccessBlock());
        this.skipNewlines();
        continue;
      }

      // Skip unrecognised content gracefully
      if (this.currentIs("symbol", "{")) {
        this.skipBalancedBraces();
      } else {
        this.advance();
      }
      this.skipNewlines();
    }

    this.expect("symbol", "}");
    return { kind: "contractDecl", location: loc, children, ...(conformsTo !== undefined && { conformsTo }) };
  }

  /**
   * Parse: assuming(flowRef, "claim") { optional body }
   *
   * Produces: { kind: "assumingDecl", flowRef: string, claim: string, children: [] }
   *
   * flowRef  — the name of the flow whose .lmanifest we look up
   * claim    — the proof obligation claim string (must match ProofObligation in manifest)
   *
   * Used by governance verifier (task #74) to perform manifest-lookup proof verification.
   * On success: WAT gate is elided (zero overhead). On failure: LLN-ASSUME-001.
   */
  private parseAssumingDecl(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "assuming"
    this.skipNewlines();

    let flowRef = "";
    let claim = "";

    // Parse (flowRef, "claim") argument list
    if (this.currentIs("symbol", "(")) {
      this.advance(); // consume (
      this.skipNewlines();

      // flowRef — identifier
      if (this.current().kind === "identifier") {
        flowRef = this.current().value;
        this.advance();
      }
      this.skipNewlines();

      // comma separator
      if (this.currentIs("symbol", ",")) {
        this.advance();
        this.skipNewlines();
      }

      // claim — string literal
      if (this.current().kind === "string") {
        claim = this.current().value;
        this.advance();
      }
      this.skipNewlines();

      if (this.currentIs("symbol", ")")) {
        this.advance(); // consume )
        this.skipNewlines();
      }
    }

    // Optional body block { notes or sub-expressions }
    const children: AstNode[] = [];
    if (this.currentIs("symbol", "{")) {
      this.advance(); // consume {
      this.skipNewlines();
      while (!this.currentIs("symbol", "}") && !this.isEof()) {
        // Consume any content inside the body as plain identifiers/strings
        children.push({ kind: "identifier", value: this.current().value ?? "", location: this.loc() });
        this.advance();
        this.skipNewlines();
      }
      if (this.currentIs("symbol", "}")) {
        this.advance(); // consume }
      }
    }

    return {
      kind: "assumingDecl",
      flowRef,
      claim,
      location: loc,
      children,
    };
  }

  /**
   * Parses a named sub-block inside a contract:
   *   types { ... } / events { ... } / targets { ... } / examples { ... }
   *
   * The content is stored as identifier children (names of types/events).
   * Full parsing of sub-block content is Phase 9B+.
   */
  private parseContractSubBlock(subBlockName: string): AstNode {
    const loc = this.loc();
    this.advance(); // consume the sub-block keyword
    this.skipNewlines();

    const children: AstNode[] = [];

    if (!this.currentIs("symbol", "{")) {
      return { kind: "identifier", value: `${subBlockName}:`, location: loc, children };
    }

    this.advance(); // consume {
    this.skipNewlines();

    while (!this.currentIs("symbol", "}") && !this.isEof()) {
      const tok = this.current();

      if (tok.kind === "keyword" && tok.value === "type") {
        // Type alias inside contract.types — parse like a normal typeDecl
        const typeNode = this.parseTypeDecl();
        children.push(typeNode);
        this.skipNewlines();
        continue;
      }

      if (tok.kind === "keyword" && tok.value === "emits") {
        // Event emission declaration: emits EventName
        this.advance(); // consume "emits"
        this.skipNewlines();
        if (this.current().kind === "identifier") {
          children.push({
            kind: "identifier",
            value: `emits:${this.current().value}`,
            location: this.loc(),
          });
          this.advance();
        }
        this.skipNewlines();
        continue;
      }

      // `require effectName` inside audit/rules/context blocks (Phase 9B+)
      if ((tok.kind === "identifier" || tok.kind === "keyword") && tok.value === "require") {
        const loc = this.loc();
        this.advance(); // consume "require"
        let req = "";
        while (!this.isEof() && this.current().kind !== "newline" && !this.currentIs("symbol", "}")) {
          req += (req === "" ? "" : ".") + this.current().value;
          this.advance();
        }
        children.push({ kind: "identifier", value: `require:${req.trim()}`, location: loc });
        this.skipNewlines();
        continue;
      }

      // `accepts TypeName` inside request blocks
      if ((tok.kind === "identifier" || tok.kind === "keyword") && tok.value === "accepts") {
        const loc = this.loc();
        this.advance(); // consume "accepts"
        this.skipNewlines();
        const typeName = (this.current().kind === "identifier" || this.current().kind === "keyword")
          ? this.current().value : "";
        if (typeName !== "") this.advance();
        children.push({ kind: "identifier", value: `accepts:${typeName}`, location: loc });
        this.skipNewlines();
        continue;
      }

      // `params { ... }` inside request blocks
      if ((tok.kind === "identifier" || tok.kind === "keyword") && tok.value === "params") {
        const subLoc = this.loc();
        this.advance(); // consume "params"
        this.skipNewlines();
        const paramChildren: AstNode[] = [];
        if (this.currentIs("symbol", "{")) {
          this.advance(); // consume {
          this.skipNewlines();
          while (!this.currentIs("symbol", "}") && !this.isEof()) {
            const inner = this.current();
            if ((inner.kind === "identifier" || inner.kind === "keyword") && inner.value === "require") {
              const reqLoc = this.loc();
              this.advance();
              let req = "";
              while (!this.isEof() && this.current().kind !== "newline" && !this.currentIs("symbol", "}")) {
                req += (req === "" ? "" : ".") + this.current().value;
                this.advance();
              }
              paramChildren.push({ kind: "identifier", value: `require:${req.trim()}`, location: reqLoc });
            } else {
              this.advance();
            }
            this.skipNewlines();
          }
          this.expect("symbol", "}");
        }
        children.push({ kind: "identifier", value: "params:block", location: subLoc, children: paramChildren });
        this.skipNewlines();
        continue;
      }

      // `returns TypeName` or `returns { ... }` inside response/errors blocks
      if ((tok.kind === "identifier" || tok.kind === "keyword") && tok.value === "returns") {
        const loc = this.loc();
        this.advance(); // consume "returns"
        this.skipNewlines();
        if (this.currentIs("symbol", "{")) {
          // Block form: returns { Variant1, Variant2, ... }
          const returnChildren: AstNode[] = [];
          this.advance(); // consume {
          this.skipNewlines();
          while (!this.currentIs("symbol", "}") && !this.isEof()) {
            const rt = this.current();
            if (rt.kind === "identifier" || rt.kind === "keyword") {
              // Collect the full dot-path or qualified name on this line
              let variantName = rt.value;
              this.advance();
              while (this.currentIs("symbol", ".")) {
                this.advance();
                const next = this.current();
                if (next.kind === "identifier" || next.kind === "keyword") {
                  variantName += "." + next.value;
                  this.advance();
                } else break;
              }
              returnChildren.push({ kind: "identifier", value: `returns:${variantName}`, location: this.loc() });
            } else {
              this.advance();
            }
            this.skipNewlines();
          }
          this.expect("symbol", "}");
          children.push({ kind: "identifier", value: "returns:block", location: loc, children: returnChildren });
        } else {
          const typeName = (this.current().kind === "identifier" || this.current().kind === "keyword")
            ? this.current().value : "";
          if (typeName !== "") this.advance();
          children.push({ kind: "identifier", value: `returns:${typeName}`, location: loc });
        }
        this.skipNewlines();
        continue;
      }

      // `exposes { field field }` inside response blocks
      if ((tok.kind === "identifier" || tok.kind === "keyword") && tok.value === "exposes") {
        const subLoc = this.loc();
        this.advance(); // consume "exposes"
        this.skipNewlines();
        const exposeChildren: AstNode[] = [];
        if (this.currentIs("symbol", "{")) {
          this.advance(); // consume {
          this.skipNewlines();
          while (!this.currentIs("symbol", "}") && !this.isEof()) {
            const ft = this.current();
            if (ft.kind === "identifier" || ft.kind === "keyword") {
              exposeChildren.push({ kind: "identifier", value: `exposes:${ft.value}`, location: this.loc() });
              this.advance();
            } else {
              this.advance();
            }
            this.skipNewlines();
          }
          this.expect("symbol", "}");
        }
        children.push(...exposeChildren);
        this.skipNewlines();
        continue;
      }

      // `denies { field field }` inside response blocks
      if ((tok.kind === "identifier" || tok.kind === "keyword") && tok.value === "denies") {
        const subLoc = this.loc();
        this.advance(); // consume "denies"
        this.skipNewlines();
        const denyChildren: AstNode[] = [];
        if (this.currentIs("symbol", "{")) {
          this.advance(); // consume {
          this.skipNewlines();
          while (!this.currentIs("symbol", "}") && !this.isEof()) {
            const ft = this.current();
            if (ft.kind === "identifier" || ft.kind === "keyword") {
              denyChildren.push({ kind: "identifier", value: `denies:${ft.value}`, location: this.loc() });
              this.advance();
            } else {
              this.advance();
            }
            this.skipNewlines();
          }
          this.expect("symbol", "}");
        }
        children.push(...denyChildren);
        this.skipNewlines();
        void subLoc;
        continue;
      }

      // `uses TypeName` inside model blocks
      if ((tok.kind === "identifier" || tok.kind === "keyword") && tok.value === "uses") {
        const loc = this.loc();
        this.advance(); // consume "uses"
        this.skipNewlines();
        const typeName = (this.current().kind === "identifier" || this.current().kind === "keyword")
          ? this.current().value : "";
        if (typeName !== "") this.advance();
        children.push({ kind: "identifier", value: `uses:${typeName}`, location: loc });
        this.skipNewlines();
        continue;
      }

      // `reads TypeName` inside model blocks
      if ((tok.kind === "identifier" || tok.kind === "keyword") && tok.value === "reads") {
        const loc = this.loc();
        this.advance(); // consume "reads"
        this.skipNewlines();
        const typeName = (this.current().kind === "identifier" || this.current().kind === "keyword")
          ? this.current().value : "";
        if (typeName !== "") this.advance();
        children.push({ kind: "identifier", value: `reads:${typeName}`, location: loc });
        this.skipNewlines();
        continue;
      }

      // `constraints { ... }` inside model blocks
      if ((tok.kind === "identifier" || tok.kind === "keyword") && tok.value === "constraints") {
        const subLoc = this.loc();
        this.advance(); // consume "constraints"
        this.skipNewlines();
        const constraintChildren: AstNode[] = [];
        if (this.currentIs("symbol", "{")) {
          this.advance(); // consume {
          this.skipNewlines();
          while (!this.currentIs("symbol", "}") && !this.isEof()) {
            const ct = this.current();
            if (ct.kind === "identifier" || ct.kind === "keyword") {
              constraintChildren.push({ kind: "identifier", value: ct.value, location: this.loc() });
              this.advance();
            } else {
              this.advance();
            }
            this.skipNewlines();
          }
          this.expect("symbol", "}");
        }
        children.push({ kind: "identifier", value: "constraints:block", location: subLoc, children: constraintChildren });
        this.skipNewlines();
        continue;
      }

      // For invariant sub-blocks: parse `ensure expr;` as structured nodes (DRCM Phase 2 — #36)
      // Each `ensure expr` becomes an { kind: "ensureDecl", children: [exprNode] } node.
      // The governance verifier attempts static constant-fold evaluation:
      //   - Provably true  → statically_verified in ProofGraph, no WAT gate
      //   - Provably false → LLN-INV-001 (error — invariant cannot be satisfied)
      //   - Unknown        → runtime-precheck in ProofGraph, WAT assertion gate injected
      if (subBlockName === "invariant" && (tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "ensure") {
        const ensureLoc = this.loc();
        this.advance(); // consume "ensure"
        this.skipNewlines();
        const ensureExpr = this.parseExpression();
        // Consume trailing semicolon if present
        this.skipNewlines();
        if (this.currentIs("symbol", ";")) this.advance();
        children.push({ kind: "ensureDecl", location: ensureLoc, children: [ensureExpr] });
        this.skipNewlines();
        continue;
      }

      // For effects sub-blocks: capture dot-path effect names
      // Wildcards (network.*) are preserved so LLN-CAP-001 can detect them (task #30).
      if (subBlockName === "effects" && (tok.kind === "identifier" || tok.kind === "keyword")) {
        const effectLoc = this.loc();
        let effectName = tok.value;
        this.advance();
        // Consume dot-path continuations (e.g. database.write) and wildcards (network.*)
        while (this.currentIs("symbol", ".")) {
          this.advance(); // consume dot
          const next = this.current();
          if (next.kind === "identifier" || next.kind === "keyword") {
            effectName += "." + next.value;
            this.advance();
          } else if (next.kind === "operator" && next.value === "*") {
            // Wildcard — include so governance verifier can emit LLN-CAP-001
            effectName += ".*";
            this.advance();
          } else {
            break;
          }
        }
        // Comma separator
        this.skipNewlines();
        if (this.currentIs("symbol", ",")) this.advance();
        children.push({ kind: "identifier", value: `effect:${effectName}`, location: effectLoc });
        this.skipNewlines();
        continue;
      }

      // Standalone wildcard `*` in effects block (e.g. effects { * })
      if (subBlockName === "effects" && tok.kind === "operator" && tok.value === "*") {
        const effectLoc = this.loc();
        this.advance();
        children.push({ kind: "identifier", value: "effect:*", location: effectLoc });
        this.skipNewlines();
        continue;
      }

      // Generic declaration line: for errors, timeouts, retries, limits, privacy, observability, etc.
      // Recognise nested named sub-blocks (identifier followed by {}) or collect tokens on one line.
      if (tok.kind === "identifier" || tok.kind === "keyword") {
        const stmtLoc = this.loc();
        // Peek ahead — if an opening brace follows on the same or next "logical" token, parse as sub-block
        // Look ahead past one identifier to see if there is a {
        const afterIdent = this.peek(1);
        if (afterIdent.kind === "symbol" && afterIdent.value === "{") {
          // Named nested block: keyword/ident { ... }
          const blockName = tok.value;
          this.advance(); // consume the block name
          const nestedChildren: AstNode[] = [];
          this.advance(); // consume {
          this.skipNewlines();
          while (!this.currentIs("symbol", "}") && !this.isEof()) {
            const inner = this.current();
            if ((inner.kind === "identifier" || inner.kind === "keyword") && !this.currentIs("symbol", "}")) {
              // Collect tokens on this line
              const lineParts: string[] = [];
              while (!this.isEof() && this.current().kind !== "newline" && !this.currentIs("symbol", "}")) {
                if (this.currentIs("symbol", "{")) {
                  // Nested further — skip balanced
                  this.skipBalancedBraces();
                  break;
                }
                lineParts.push(this.current().value);
                this.advance();
              }
              if (lineParts.length > 0) {
                nestedChildren.push({ kind: "identifier", value: `decl:${lineParts.join(" ")}`, location: this.loc() });
              }
            } else {
              this.advance();
            }
            this.skipNewlines();
          }
          this.expect("symbol", "}");
          children.push({ kind: "identifier", value: `${blockName}:block`, location: stmtLoc, children: nestedChildren });
          this.skipNewlines();
          continue;
        }

        // No brace follows — collect all tokens on this line as a single decl node
        const parts: string[] = [];
        while (!this.isEof() && this.current().kind !== "newline" && !this.currentIs("symbol", "}")) {
          if (this.currentIs("symbol", "{")) {
            // Nested block mid-line — skip it and stop
            this.skipBalancedBraces();
            break;
          }
          parts.push(this.current().value);
          this.advance();
        }
        if (parts.length > 0) {
          children.push({ kind: "identifier", value: `decl:${parts.join(" ")}`, location: stmtLoc });
        }
        this.skipNewlines();
        continue;
      }

      // Skip unrecognised content
      this.advance();
      this.skipNewlines();
    }

    this.expect("symbol", "}");
    return { kind: "identifier", value: `${subBlockName}:block`, location: loc, children };
  }

  /**
   * Parses a `contract set Name { rules { } events { } audit { } }` declaration.
   * Contract sets are reusable governance templates that flows apply with `use Name`.
   *
   * Key rule: a contract set may REQUIRE behaviour (e.g. audit.write) but may NOT
   * silently grant authority or add effects. Flows must still declare effects explicitly.
   */
  private parseContractSetDecl(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "contract"
    this.skipNewlines();
    // consume "set"
    if ((this.current().kind === "identifier" || this.current().kind === "keyword") && this.current().value === "set") {
      this.advance();
    }
    this.skipNewlines();

    // Contract set name
    const name = this.current().kind === "identifier" ? this.current().value : "<unknown>";
    if (this.current().kind === "identifier") this.advance();
    this.skipNewlines();

    // Parse body — same sub-block structure as contractDecl
    const children: AstNode[] = [];
    if (this.currentIs("symbol", "{")) {
      this.advance(); // consume {
      this.skipNewlines();
      while (!this.currentIs("symbol", "}") && !this.isEof()) {
        const tok = this.current();
        const v = tok.value;
        if ((tok.kind === "keyword" || tok.kind === "identifier") &&
            (v === "rules" || v === "events" || v === "audit" || v === "types")) {
          children.push(this.parseContractSubBlock(v));
        } else if (this.currentIs("symbol", "{")) {
          this.skipBalancedBraces();
        } else {
          this.advance();
        }
        this.skipNewlines();
      }
      this.expect("symbol", "}");
    }

    return { kind: "contractSetDecl", value: name, location: loc, children };
  }

  // ── Resource declaration (Phase 17) ──────────────────────────────────────

  /**
   * Parses a `resource Name { fields operations { } policy { } }` declaration.
   *
   * Syntax:
   *   resource UserProfile {
   *     id: UserId
   *     email: protected Email
   *     name: String
   *
   *     operations {
   *       create effects [database.write, audit.write]
   *       read   effects [database.read]
   *     }
   *
   *     policy {
   *       require audit on create, update, delete
   *       deny delete unless role.admin
   *     }
   *   }
   *
   * Phase 17 semantics (enforcement) are deferred; this parser captures all
   * sections structurally.
   *
   * Returns: { kind: "resourceDecl", value: name, location, children: [...fields, operationsBlock?, policyBlock?] }
   */
  private parseResourceDecl(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "resource"
    this.skipNewlines();

    // Resource name
    const nameTok = this.current();
    const name = nameTok.kind === "identifier" ? nameTok.value : "<unknown>";
    if (nameTok.kind === "identifier") this.advance();
    this.skipNewlines();

    const children: AstNode[] = [];

    if (!this.currentIs("symbol", "{")) {
      return { kind: "resourceDecl", value: name, location: loc, children };
    }

    this.advance(); // consume {
    this.skipNewlines();

    while (!this.currentIs("symbol", "}") && !this.isEof()) {
      const tok = this.current();

      // operations { ... }
      if ((tok.kind === "identifier" || tok.kind === "keyword") && tok.value === "operations") {
        const opLoc = this.loc();
        this.advance(); // consume "operations"
        this.skipNewlines();
        const opChildren: AstNode[] = [];

        if (this.currentIs("symbol", "{")) {
          this.advance(); // consume {
          this.skipNewlines();

          while (!this.currentIs("symbol", "}") && !this.isEof()) {
            const opTok = this.current();
            if (opTok.kind === "identifier" || opTok.kind === "keyword") {
              const opName = opTok.value;
              const opChildLoc = this.loc();
              this.advance(); // consume operation name (create, read, update, delete)
              this.skipNewlines();

              // effects [a, b, ...]
              let effectsList = "";
              if ((this.current().kind === "keyword" || this.current().kind === "identifier") &&
                  this.current().value === "effects") {
                this.advance(); // consume "effects"
                this.skipNewlines();
                if (this.currentIs("symbol", "[")) {
                  this.advance(); // consume [
                  const parts: string[] = [];
                  while (!this.currentIs("symbol", "]") && !this.isEof()) {
                    const et = this.current();
                    if (et.kind === "identifier" || et.kind === "keyword") {
                      let effectName = et.value;
                      this.advance();
                      // Consume dot-path
                      while (this.currentIs("symbol", ".")) {
                        this.advance();
                        const next = this.current();
                        if (next.kind === "identifier" || next.kind === "keyword") {
                          effectName += "." + next.value;
                          this.advance();
                        } else break;
                      }
                      parts.push(effectName);
                    } else if (this.currentIs("symbol", ",")) {
                      this.advance();
                    } else {
                      this.advance();
                    }
                    this.skipNewlines();
                  }
                  if (this.currentIs("symbol", "]")) this.advance(); // consume ]
                  effectsList = parts.join(",");
                }
              }

              opChildren.push({
                kind: "identifier",
                value: `op:${opName}${effectsList !== "" ? `:${effectsList}` : ""}`,
                location: opChildLoc,
              });
            } else {
              this.advance();
            }
            this.skipNewlines();
          }

          if (this.currentIs("symbol", "}")) this.advance(); // consume }
        }

        children.push({ kind: "identifier", value: "operations:block", location: opLoc, children: opChildren });
        this.skipNewlines();
        continue;
      }

      // policy { ... } — resource-specific policy (separate from top-level policy keyword)
      if ((tok.kind === "identifier" || tok.kind === "keyword") && tok.value === "policy") {
        const polLoc = this.loc();
        this.advance(); // consume "policy"
        this.skipNewlines();
        const polChildren: AstNode[] = [];

        if (this.currentIs("symbol", "{")) {
          this.advance(); // consume {
          this.skipNewlines();

          while (!this.currentIs("symbol", "}") && !this.isEof()) {
            const polTok = this.current();

            // require | deny clause — consume the rest of the line
            if ((polTok.kind === "identifier" || polTok.kind === "keyword") &&
                (polTok.value === "require" || polTok.value === "deny")) {
              const clauseKind = polTok.value;
              const clauseLoc = this.loc();
              this.advance(); // consume "require" / "deny"
              const parts: string[] = [];
              while (!this.isEof() && this.current().kind !== "newline" && !this.currentIs("symbol", "}")) {
                parts.push(this.current().value);
                this.advance();
              }
              polChildren.push({
                kind: "identifier",
                value: `policy:${clauseKind} ${parts.join(" ")}`.trimEnd(),
                location: clauseLoc,
              });
            } else {
              this.advance();
            }
            this.skipNewlines();
          }

          if (this.currentIs("symbol", "}")) this.advance(); // consume }
        }

        children.push({ kind: "identifier", value: "policy:block", location: polLoc, children: polChildren });
        this.skipNewlines();
        continue;
      }

      // Field declaration: name: [qualifier] TypeRef
      // A field line starts with an identifier followed by ":"
      if ((tok.kind === "identifier" || tok.kind === "keyword") &&
          this.peek(1).kind === "symbol" && this.peek(1).value === ":") {
        const fieldLoc = this.loc();
        const fieldName = tok.value;
        this.advance(); // consume field name
        this.advance(); // consume ":"
        this.skipNewlines();
        const typeRef = this.parseTypeRef();
        children.push({
          kind: "paramDecl",
          value: `${fieldName}: ${typeRef.value ?? ""}`,
          location: fieldLoc,
        });
        this.skipNewlines();
        continue;
      }

      // Skip anything else (newlines already handled by skipNewlines)
      if (this.currentIs("symbol", "{")) {
        this.skipBalancedBraces();
      } else {
        this.advance();
      }
      this.skipNewlines();
    }

    this.expect("symbol", "}");
    return { kind: "resourceDecl", value: name, location: loc, children };
  }

  /**
   * Parses a top-level `event EventName` declaration.
   * Global event declarations are referenced in contract.events blocks.
   */
  private parseEventDecl(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "event"
    this.skipNewlines();
    const name = this.current().kind === "identifier" ? this.current().value : "<unknown>";
    if (this.current().kind === "identifier") this.advance();
    return { kind: "intentDecl", value: `event:${name}`, location: loc };
  }

  /**
   * Parses an `emit EventName` statement inside a flow body.
   * In Stage 1 this is a no-op at runtime but recorded in the AST.
   */
  private parseEmitStmt(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "emit"
    this.skipNewlines();
    const name = this.current().kind === "identifier" ? this.current().value : "<unknown>";
    if (this.current().kind === "identifier") this.advance();
    return { kind: "identifier", value: `emit:${name}`, location: loc };
  }

  private parseWhileStmt(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "while"
    const condition = this.parseExpression();
    const body = this.parseBlock();
    return { kind: "whileStmt", location: loc, children: [condition, body] };
  }

  private parseForEachStmt(): AstNode {
    // for name in expr { }
    const loc = this.loc();
    this.advance(); // consume "for"
    this.skipNewlines();
    const varName = this.current().kind === "identifier" ? this.current().value : "<item>";
    if (this.current().kind === "identifier") this.advance();
    this.skipNewlines();
    // consume "in" (identifier, not keyword)
    if (this.current().kind === "identifier" && this.current().value === "in") this.advance();
    this.skipNewlines();
    const collection = this.parseExpression();
    const body = this.parseBlock();
    return { kind: "forEachStmt", value: varName, location: loc, children: [collection, body] };
  }

  // ── Import / type / enum stubs ────────────────────────────────────────────

  /**
   * Parse all import forms:
   *
   *   import "./path.lln"
   *     → DAG merge (app file, same security context as boot.lln)
   *     → importDecl node (existing)
   *
   *   import plugin safe "./path.lln" as Alias { contract { access { grant X } } }
   *     → Standard bridged plugin (isolated, demand-loaded, transient)
   *     → importPluginDecl node
   *
   *   import plugin assimilate "./path.lln" as Alias { contract { ... } }
   *     → Hot-Code Residency (pre-compiled, always-hot, stateless data)
   *     → assimilatedPluginDecl node
   *     → assimilate implies safe — deep DAG audit performed automatically
   *     → governed by boot.lln assimilation_memory_budget
   *
   * The `as Alias` name is stored in node.value.
   * The plugin path is stored as the first child (identifier node).
   * The contract block is parsed as a contractDecl child.
   */
  private parseImportStatement(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "import"
    this.skipNewlines();

    // Check for "plugin" modifier
    const tok = this.current();
    if (!((tok.kind === "keyword" || tok.kind === "identifier") && tok.value === "plugin")) {
      // Plain import "./path" — existing DAG merge form
      let value = "";
      while (!this.isEof() && this.current().kind !== "newline") {
        value += this.current().value + " ";
        this.advance();
      }
      return { kind: "importDecl", value: value.trim(), location: loc };
    }

    this.advance(); // consume "plugin"
    this.skipNewlines();

    // Determine plugin kind: safe | assimilate
    let pluginKind: "importPluginDecl" | "assimilatedPluginDecl" = "importPluginDecl";
    const modTok = this.current();
    if ((modTok.kind === "keyword" || modTok.kind === "identifier") && modTok.value === "assimilate") {
      pluginKind = "assimilatedPluginDecl";
      this.advance(); // consume "assimilate"
      this.skipNewlines();
    } else if ((modTok.kind === "keyword" || modTok.kind === "identifier") && modTok.value === "safe") {
      pluginKind = "importPluginDecl";
      this.advance(); // consume "safe"
      this.skipNewlines();
    }

    // Plugin file path (string literal)
    let pluginPath = "";
    if (this.current().kind === "string") {
      const raw = this.current().value;
      pluginPath = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
      this.advance();
      this.skipNewlines();
    }

    // `as Alias` name
    let alias = "";
    if ((this.current().kind === "keyword" || this.current().kind === "identifier") && this.current().value === "as") {
      this.advance(); // consume "as"
      this.skipNewlines();
      if (this.current().kind === "identifier") {
        alias = this.current().value;
        this.advance();
        this.skipNewlines();
      }
    }

    const children: AstNode[] = [];
    // Store path as first child
    children.push({ kind: "identifier", value: `path:${pluginPath}`, location: loc });

    // Parse optional contract block { contract { ... } }
    if (this.currentIs("symbol", "{")) {
      this.advance(); // consume {
      this.skipNewlines();
      while (!this.currentIs("symbol", "}") && !this.isEof()) {
        if ((this.current().kind === "keyword" || this.current().kind === "identifier") && this.current().value === "contract") {
          children.push(this.parseContractDecl());
          this.skipNewlines();
          continue;
        }
        // Skip unknown content
        if (this.currentIs("symbol", "{")) this.skipBalancedBraces();
        else this.advance();
        this.skipNewlines();
      }
      if (this.currentIs("symbol", "}")) this.advance();
    }

    return { kind: pluginKind, value: alias, location: loc, children };
  }

  private parseImportDecl(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "import"
    let value = "";
    while (!this.isEof() && this.current().kind !== "newline") {
      value += this.current().value + " ";
      this.advance();
    }
    return { kind: "importDecl", value: value.trim(), location: loc };
  }

  private parseTypeDecl(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "type"
    const name = this.current().kind === "identifier" ? this.current().value : "<unknown>";
    if (this.current().kind === "identifier") this.advance();

    // `type Name { ... }` — record-style type body
    if (this.currentIs("symbol", "{")) {
      this.skipBalancedBraces();
      return { kind: "typeDecl", value: name, location: loc };
    }

    // `type Name = TypeRef` — alias form; capture the RHS as a child typeRef
    // This is critical for Phase 9A-2 branded type detection:
    //   type CustomerId = Brand<String, "CustomerId">
    if (this.currentIs("operator", "=")) {
      this.advance(); // consume "="
      this.skipNewlines();
      const aliasType = this.parseTypeRef();
      // Skip any remaining tokens on this line (trailing comments, etc.)
      while (!this.isEof() && this.current().kind !== "newline") {
        this.advance();
      }
      return { kind: "typeDecl", value: name, location: loc, children: [aliasType] };
    }

    // Fallback: skip to end of line
    while (!this.isEof() && this.current().kind !== "newline") {
      this.advance();
    }
    return { kind: "typeDecl", value: name, location: loc };
  }

  private parseRecordDecl(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "record"
    this.skipNewlines();
    const name = this.current().kind === "identifier" ? this.current().value : "<unknown>";
    if (this.current().kind === "identifier") this.advance();
    this.skipNewlines();

    const fields: AstNode[] = [];
    if (this.currentIs("symbol", "{")) {
      this.advance(); // consume {
      this.skipNewlines();
      while (!this.currentIs("symbol", "}") && !this.isEof()) {
        if (this.current().kind === "identifier") {
          const fLoc = this.loc();
          const fName = this.current().value;
          this.advance();
          let typeAnnotation = "";
          if (this.currentIs("symbol", ":")) {
            this.advance();
            const typeNode = this.parseTypeRef();
            typeAnnotation = typeNode.value ?? "";
          }
          fields.push({
            kind: "paramDecl",
            value: typeAnnotation !== "" ? `${fName}: ${typeAnnotation}` : fName,
            location: fLoc,
          });
        } else if (this.currentIs("symbol", ",")) {
          this.advance();
        } else {
          this.advance(); // skip unexpected tokens gracefully
        }
        this.skipNewlines();
      }
      this.expect("symbol", "}");
    }

    return { kind: "recordDecl", value: name, location: loc, children: fields };
  }

  private parseEnumDecl(): AstNode {
    const loc = this.loc();
    this.advance(); // consume "enum"
    const name = this.current().kind === "identifier" ? this.current().value : "<unknown>";
    if (this.current().kind === "identifier") this.advance();
    const variants: AstNode[] = [];
    if (this.currentIs("symbol", "{")) {
      this.advance();
      this.skipNewlines();
      while (!this.currentIs("symbol", "}") && !this.isEof()) {
        const variant = this.current();
        if (variant.kind === "identifier" || variant.kind === "keyword") {
          variants.push({
            kind: "enumVariant",
            value: variant.value,
            location: this.loc(),
          });
          this.advance();
          this.skipNewlines();
          if (this.currentIs("symbol", ",")) {
            this.advance();
          }
        } else if (variant.kind === "symbol" && variant.value === ",") {
          this.advance();
        } else {
          this.emitUnexpected(`Expected enum variant, got "${variant.value}".`);
          this.advance();
        }
        this.skipNewlines();
      }
      this.expect("symbol", "}");
    }
    return { kind: "enumDecl", value: name, location: loc, children: variants };
  }

  // ── Diagnostic helpers ────────────────────────────────────────────────────

  private emit(
    code: string,
    name: string,
    message: string,
    location: SourceLocation,
    suggestedFix?: string,
    suggestedCode?: string,
  ): void {
    const byteSpan: readonly [number, number] | undefined =
      location.offset !== undefined && location.endOffset !== undefined
        ? [location.offset, location.endOffset]
        : undefined;
    const d: ParseDiagnostic = {
      code, name, severity: "error", message, location,
      ...(suggestedFix === undefined ? {} : { suggestedFix }),
      ...(suggestedCode === undefined ? {} : { suggestedCode }),
      ...(byteSpan === undefined ? {} : { byteSpan }),
    };
    this.diagnostics.push(d);
  }

  private emitWarning(
    code: string,
    name: string,
    message: string,
    location: SourceLocation,
    suggestedFix?: string,
  ): void {
    const byteSpan: readonly [number, number] | undefined =
      location.offset !== undefined && location.endOffset !== undefined
        ? [location.offset, location.endOffset]
        : undefined;
    this.diagnostics.push({
      code, name, severity: "warning", message, location,
      ...(suggestedFix === undefined ? {} : { suggestedFix }),
      ...(byteSpan === undefined ? {} : { byteSpan }),
    });
  }

  private emitUnexpected(message: string): void {
    this.emit("LLN-PARSE-001", "UNEXPECTED_TOKEN", message, this.loc());
  }

  // ── Token stream helpers ───────────────────────────────────────────────────

  private current(): Token {
    return this.tokens[this.pos] ?? { kind: "eof", kindId: 11, value: "", line: 0, column: 0, endLine: 0, endColumn: 0, start: 0, end: 0 };
  }

  private peek(offset: number): Token {
    return this.tokens[this.pos + offset] ?? { kind: "eof", kindId: 11, value: "", line: 0, column: 0, endLine: 0, endColumn: 0, start: 0, end: 0 };
  }

  private advance(): Token {
    const tok = this.current();
    if (!this.isEof()) this.pos++;
    return tok;
  }

  private isEof(): boolean {
    return this.current().kind === "eof";
  }

  private currentIs(kind: Token["kind"], value: string): boolean {
    const tok = this.current();
    return tok.kind === kind && tok.value === value;
  }

  private currentIsOneOf(kind: Token["kind"], values: string[]): boolean {
    const tok = this.current();
    return tok.kind === kind && values.includes(tok.value);
  }

  private skipNewlines(): void {
    while (
      this.current().kind === "newline" ||
      this.current().kind === "comment" ||
      this.current().kind === "docComment" ||
      this.current().kind === "govComment"   // ;; governance annotations — skip during parse, preserved in token stream for manifest
    ) {
      this.pos++;
    }
  }

  // ── Panic-mode recovery helpers ───────────────────────────────────────────
  //
  // One syntax error must not cascade into many LLN-PARSE-001 diagnostics.
  // Each helper advances to a safe resynchronisation point:
  //
  //   recoverToStatement()       — newline, ";", or "}"  (within a block)
  //   recoverToBlock()           — opening "{"           (before a body)
  //   recoverToContractSection() — next known contract section keyword
  //   skipToNextDeclaration()    — next top-level keyword (existing)
  //   skipTopLevelStatement()    — skip past continuation lines (existing)
  //
  // These are NOT wired to every parse site yet — they are added as tools
  // for new parser code and progressive retrofit.

  /**
   * Advances past tokens until a statement boundary: newline, ";", or "}".
   * Does not consume the boundary token. Safe to call inside a flow body.
   */
  private recoverToStatement(): void {
    while (!this.isEof()) {
      const tok = this.current();
      if (tok.kind === "newline" || this.currentIs("symbol", ";") || this.currentIs("symbol", "}")) {
        break;
      }
      this.advance();
    }
  }

  /**
   * Advances past tokens until the opening "{" of the next block.
   * Use when the parser expected a block but got something else.
   */
  private recoverToBlock(): void {
    while (!this.isEof()) {
      if (this.currentIs("symbol", "{")) break;
      // Also stop at top-level flow keywords so we don't consume the next flow
      const tok = this.current();
      if (tok.kind === "keyword" && (
        tok.value === "flow" || tok.value === "pure" || tok.value === "secure" ||
        tok.value === "guarded" || tok.value === "contract"
      )) break;
      this.advance();
    }
  }

  /**
   * Advances to the next known contract section keyword or closing "}" of the
   * contract block. Use when an unknown token is encountered inside a contract.
   *
   * Known sections: intent, effects, request, response, context, model,
   * timeouts, retries, limits, privacy, errors, rules, observability,
   * events, audit, types, targets, governance, use.
   */
  private recoverToContractSection(): void {
    const CONTRACT_SECTIONS = new Set([
      "intent", "effects", "request", "response", "context", "model",
      "timeouts", "retries", "limits", "privacy", "errors", "rules",
      "observability", "events", "audit", "types", "targets", "governance", "use",
      "memory",    // contract.memory { arena 8.mb } — explicit memory budget
      "economics", // contract.economics { target_cost max_compute_budget preferred_execution }
      "lineage",   // contract.lineage { source owner retention } — data lineage
      "ai",        // contract.ai { max_token_cost approved_models }
      "value",     // contract.value { classification safety_critical domain aerospace }
      "safety",    // contract.safety { require deterministic_execution }
      "hardware",  // contract.hardware { target arm.sve2 require mte require pac }
    ]);
    while (!this.isEof()) {
      if (this.currentIs("symbol", "}")) break;
      const tok = this.current();
      if ((tok.kind === "keyword" || tok.kind === "identifier") && CONTRACT_SECTIONS.has(tok.value)) break;
      this.advance();
    }
  }

  /**
   * Advances the token stream forward until a top-level declaration keyword is
   * found (or EOF), preventing cascading LLN-PARSE-001 errors from one bad
   * declaration.
   *
   * Top-level boundary keywords: flow, secure, pure, guarded, type, record,
   * enum, import, route, contract, event, authority, policy, intent,
   * governance, api, compute.
   */
  private skipToNextDeclaration(): void {
    const TOP_LEVEL_BOUNDARIES = new Set([
      "flow", "secure", "pure", "guarded",
      "type", "record", "enum", "import",
      "route", "contract", "event",
      "authority", "policy",
      "intent", "governance", "api", "compute",
      "resource",
    ]);

    while (!this.isEof()) {
      const tok = this.current();
      // Stop when we reach a top-level keyword at column 1 (not indented)
      if (tok.kind === "keyword" && TOP_LEVEL_BOUNDARIES.has(tok.value) && tok.column <= 1) {
        break;
      }
      // Also stop if we're at a top-level keyword regardless of column (robustness)
      if (tok.kind === "keyword" && TOP_LEVEL_BOUNDARIES.has(tok.value)) {
        break;
      }
      // Skip balanced braces so we don't mistake inner keywords for boundaries
      if (tok.kind === "symbol" && tok.value === "{") {
        this.skipBalancedBraces();
        continue;
      }
      this.advance();
    }
  }

  /**
   * Skips a disallowed top-level statement including any multi-line continuation.
   *
   * After emitting the diagnostic, we skip:
   *   1. The current line (up to the first newline).
   *   2. Any subsequent continuation lines whose first real token is NOT a
   *      top-level keyword (flow, pure, guarded, secure, type, record, enum,
   *      import, intent, governance, api, compute, route, contract, event).
   *
   * This avoids spurious LLN-PARSE-001 cascades when a binding initializer
   * is written on the next line:
   *     let email: protected Email =
   *       validate.email(rawEmail)?      ← without this fix: PARSE-001 here
   */
  private skipTopLevelStatement(): void {
    // Step 1: skip to end of current line
    while (!this.isEof() && this.current().kind !== "newline") this.advance();

    // Step 2: peek ahead — if the next non-newline token is a top-level keyword,
    // stop here. Otherwise consume the continuation line(s).
    const TOP_LEVEL_KW = new Set([
      "flow", "pure", "guarded", "secure", "type", "record", "enum",
      "import", "intent", "governance", "api", "compute", "route",
      "contract", "event", "let", "mut", "readonly", "unsafe", "safe", "fn",
    ]);

    while (!this.isEof()) {
      // Save position so we can revert if we hit a top-level keyword
      const savedPos = this.pos;

      // Skip blank lines / comments
      while (
        !this.isEof() &&
        (this.current().kind === "newline" ||
         this.current().kind === "comment" ||
         this.current().kind === "docComment")
      ) {
        this.pos++;
      }

      if (this.isEof()) break;

      const tok = this.current();
      // If the first real token is a top-level keyword or a { at column 0
      // (which starts a block for a flow), stop consuming.
      if (tok.kind === "keyword" && TOP_LEVEL_KW.has(tok.value)) {
        this.pos = savedPos; // revert so the outer loop sees the keyword
        break;
      }
      // If the token is at column 1 (not indented), it's a new statement — stop.
      if (tok.column <= 1) {
        this.pos = savedPos;
        break;
      }

      // The line is a continuation — consume it
      while (!this.isEof() && this.current().kind !== "newline") this.advance();
    }
  }

  private loc(): SourceLocation {
    const tok = this.current();
    return {
      file: this.file,
      line: tok.line,
      column: tok.column,
      offset: tok.start,
      endLine: tok.endLine,
      endColumn: tok.endColumn,
      endOffset: tok.end,
      length: tok.end - tok.start,
    };
  }

  /**
   * Expects a specific token. Returns the token if found, emits a diagnostic
   * and returns undefined otherwise. Advances past the token.
   */
  private expect(kind: Token["kind"], value?: string): Token | undefined {
    const tok = this.current();
    if (tok.kind !== kind || (value !== undefined && tok.value !== value)) {
      const expected = value !== undefined ? `"${value}"` : kind;
      this.emit(
        "LLN-PARSE-001",
        "UNEXPECTED_TOKEN",
        `Expected ${expected}, got "${tok.value}" (${tok.kind}).`,
        this.loc(),
      );
      return undefined;
    }
    this.advance();
    return tok;
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Parses a LogicN source file.
 *
 * @param source  Full source text of the .lln file.
 * @param file    File path used in diagnostic locations.
 * @returns       ParseResult containing the AST, diagnostics, and flow metadata.
 */
export function parseProgram(source: string, file: string): ParseResult {
  const lexResult = lex(source, file);

  // Convert lexer diagnostics to parser diagnostics (structurally compatible)
  const lexDiagnostics: ParseDiagnostic[] = lexResult.diagnostics.map((d: LexerDiagnostic) => ({
    code: d.code,
    name: d.name,
    severity: d.severity,
    message: d.message,
    ...(d.location !== undefined ? { location: d.location } : {}),
    ...(d.suggestedFix !== undefined ? { suggestedFix: d.suggestedFix } : {}),
  }));

  // Filter out newline tokens for simpler parsing (tracked via line numbers)
  const tokens = lexResult.tokens;
  const parser = new Parser(tokens, file);
  const result = parser.parse();

  return {
    ast: result.ast,
    diagnostics: [...lexDiagnostics, ...result.diagnostics],
    flows: result.flows,
  };
}

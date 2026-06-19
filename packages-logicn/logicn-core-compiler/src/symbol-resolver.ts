// =============================================================================
// LogicN Phase 6 — Symbol Resolver
//
// Resolves names after parsing and before type checking.
//
// Implemented diagnostics:
//   LLN-NAME-001  UndeclaredName
//   LLN-NAME-002  DuplicateName
//   LLN-NAME-003  CrossModuleShadow  — local binding shadows a built-in domain type
// =============================================================================

import { type AstNode, type SourceLocation } from "./parser.js";
import { resolveImportedTypes } from "./package-type-registry.js";

export interface SymbolDiagnostic {
  readonly code: string;
  readonly name: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly location?: SourceLocation;
  readonly suggestedFix?: string;
  readonly suggestedCode?: string;
}

// ---------------------------------------------------------------------------
// Task 4 — SymbolTable for tooling
// ---------------------------------------------------------------------------

export interface SymbolTable {
  readonly flows: Map<string, SourceLocation>;
  readonly types: Map<string, { kind: "type" | "record" | "enum"; location: SourceLocation }>;
  readonly events: Map<string, SourceLocation>;
}

export interface SymbolResolveResult {
  readonly diagnostics: readonly SymbolDiagnostic[];
  readonly symbolTable?: SymbolTable;
}

// ---------------------------------------------------------------------------
// Task 1 — Module Export Registry
// ---------------------------------------------------------------------------

export type ExportKind =
  | "flow"
  | "type"
  | "record"
  | "enum"
  | "brand"
  | "event"
  | "contractSet";

export interface ExportedSymbol {
  readonly name: string;
  readonly kind: ExportKind;
  readonly sourceFile: string;
  readonly location: SourceLocation;
}

/**
 * Maps exported names from a module to their declarations.
 * Supports:
 *   - flow names     → FlowMeta
 *   - type names     → kind (type | record | enum | brand)
 *   - event names    → declaration location
 *   - contractSet    → definition location
 */
export class ModuleExportRegistry {
  private readonly registry: Map<string, ExportedSymbol> = new Map();

  register(
    symbol: string,
    kind: ExportKind,
    sourceFile: string,
    location: SourceLocation,
  ): void {
    this.registry.set(symbol, { name: symbol, kind, sourceFile, location });
  }

  lookup(symbol: string): ExportedSymbol | undefined {
    return this.registry.get(symbol);
  }

  /** Return all registered exports (useful for cross-module tooling). */
  all(): readonly ExportedSymbol[] {
    return [...this.registry.values()];
  }
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const FLOW_DECL_KINDS = new Set<AstNode["kind"]>([
  "flowDecl",
  "secureFlowDecl",
  "pureFlowDecl",
  "guardedFlowDecl",
]);

const TYPE_DECL_KINDS = new Set<AstNode["kind"]>([
  "typeDecl",
  "enumDecl",
  "recordDecl",
]);

const BINDING_DECL_KINDS = new Set<AstNode["kind"]>([
  "letDecl",
  "mutDecl",
  "readonlyDecl",
]);

const BUILT_IN_VALUE_NAMES = new Set([
  "None",
  "Some",
  "Ok",
  "Err",
  "true",
  "false",
  "unit",  // LogicN unit value — the singleton of type Unit (like () in Haskell/Rust)
]);

const STANDARD_PRELUDE = new Set([
  // Core stdlib
  "constantTimeEquals",
  "redact",
  "validate",
  "sanitize",
  "context",
  "json",
  "toml",
  "parse",
  "http",
  "fs",
  "AuditLog",
  "ApiError",
  "Env",
  "File",
  "Money",
  "Response",
  // ── Phase 11E: Domain databases ────────────────────────────────────────
  "UsersDB", "PatientsDB", "PatientDB", "OrdersDB", "PaymentsDB", "AccountsDB",
  // ── Phase 11E: AI models ────────────────────────────────────────────────
  "ClassifierModel", "RiskModel", "EmbeddingModel",
  // ── Phase 11E: Services ─────────────────────────────────────────────────
  "PaymentService", "EmailService", "NotificationService",
  // ── Phase 11E: Lowercase module names that appear as identifiers ────────
  // (upper-case names like PatientId are suppressed by the capital-letter rule,
  //  but lower-case module references need explicit prelude entries)
  "patients", "orders", "payments", "accounts", "users",
  // ── Standard library modules ─────────────────────────────────────────────
  "Statistics", "Physics", "Chemistry", "Probability",
  // ── Temporal constructors used as identifiers ────────────────────────────
  "Date", "Time", "DateTime",
  // ── Security constructors ────────────────────────────────────────────────
  "Hash", "Signature",
  // ── AI / ML constructors ─────────────────────────────────────────────────
  "Classification", "Embedding", "Prompt",
  // ── Common resource names (Phase 17) ─────────────────────────────────────
  // These are common PascalCase resource names. PascalCase is already suppressed
  // in checkIdentifierUse(), but operation call forms like User.create are
  // also suppressed by the PascalCase rule on the receiver.
  "User", "Patient", "Order", "Product", "Invoice", "Record",
]);

// ---------------------------------------------------------------------------
// Task 2 — Built-in domain types for cross-module shadow detection (LLN-NAME-003)
//
// Mirrors a subset of BUILT_IN_TYPES from type-checker.ts that are domain-specific
// named types (not primitives/generics). A local binding sharing one of these
// names is a probable mistake and should receive a warning.
// ---------------------------------------------------------------------------

const BUILT_IN_DOMAIN_TYPES = new Set([
  // Domain / identity types
  "Email", "Url", "Path", "Hostname", "Port", "CurrencyCode", "Reference",
  // Healthcare domain
  "PatientId", "NhsNumber", "PatientName", "DateOfBirth",
  // Financial domain
  "AccountId", "CardNumber", "SortCode", "TransactionId", "CustomerId",
  "OrderId",
  // Identity / access domain
  "UserId", "Actor", "TraceId", "TenantId", "Deadline",
  // Error types
  "Error", "ApiError", "EmailError", "PaymentError", "ValidationError", "WebhookError",
  "DecodeError", "ParseError",
  // Security types
  "Secret",
  // AI / ML types
  "Prompt", "Embedding", "Classification", "ModelOutput", "Token",
  // Enterprise / governance types
  "Policy", "AuditRecord", "AuditProof", "ExecutionPlan", "RuntimeReport",
  // AI / ML result types
  "Label", "ClassificationResult", "EmbeddingResult", "RiskScore", "Score",
  // Record / request / response types
  "PatientRecord", "HealthRecord", "ClinicalActor", "FinancialActor",
]);

// ---------------------------------------------------------------------------
// Resolver implementation
// ---------------------------------------------------------------------------

class SymbolResolver {
  private readonly diagnostics: SymbolDiagnostic[] = [];
  private readonly scopes: Array<Map<string, AstNode>> = [];
  private readonly importedNames: ReadonlySet<string>;

  // Task 4 — accumulate symbol table entries
  private readonly flowTable: Map<string, SourceLocation> = new Map();
  private readonly typeTable: Map<string, { kind: "type" | "record" | "enum"; location: SourceLocation }> = new Map();
  private readonly eventTable: Map<string, SourceLocation> = new Map();

  // Track whether we are currently inside a flow body (not a param) for NAME-003
  private insideFlowScope = false;

  constructor(importedNames: readonly string[] = []) {
    this.importedNames = new Set(importedNames);
  }

  resolve(ast: AstNode): void {
    this.pushScope();
    this.seedPrelude();
    this.collectTopLevelDeclarations(ast);
    this.walkNode(ast, "normal");
    this.popScope();
  }

  getResult(): SymbolResolveResult {
    const symbolTable: SymbolTable = {
      flows: new Map(this.flowTable),
      types: new Map(this.typeTable),
      events: new Map(this.eventTable),
    };
    return { diagnostics: [...this.diagnostics], symbolTable };
  }

  private pushScope(): void {
    this.scopes.push(new Map());
  }

  private popScope(): void {
    this.scopes.pop();
  }

  private currentScope(): Map<string, AstNode> {
    const current = this.scopes[this.scopes.length - 1];
    if (current === undefined) {
      const scope = new Map<string, AstNode>();
      this.scopes.push(scope);
      return scope;
    }
    return current;
  }

  private seedPrelude(): void {
    for (const name of [...BUILT_IN_VALUE_NAMES, ...STANDARD_PRELUDE, ...this.importedNames]) {
      this.currentScope().set(name, { kind: "identifier", value: name });
    }
  }

  private collectTopLevelDeclarations(node: AstNode): void {
    // R3: Package type injection — seed types from known @logicn/* packages
    if (node.kind === "importDecl" && node.value !== undefined) {
      const packageMatch = node.value.match(/from\s+["']([^"']+)["']/);
      if (packageMatch?.[1] !== undefined) {
        const packageName = packageMatch[1];
        const injectedTypes = resolveImportedTypes(packageName);
        for (const typeName of injectedTypes) {
          this.currentScope().set(typeName, { kind: "identifier", value: typeName });
        }
      }
    }

    if (FLOW_DECL_KINDS.has(node.kind) && node.value !== undefined) {
      const flowName = node.value.trim();
      this.currentScope().set(flowName, node);
      // Task 4 — populate flow table
      if (node.location !== undefined) {
        this.flowTable.set(flowName, node.location);
      }
    } else if (TYPE_DECL_KINDS.has(node.kind) && node.value !== undefined) {
      const typeName = node.value.trim();
      this.currentScope().set(typeName, node);
      // Task 4 — populate type table
      if (node.location !== undefined) {
        const kind =
          node.kind === "recordDecl"
            ? "record"
            : node.kind === "enumDecl"
            ? "enum"
            : "type";
        this.typeTable.set(typeName, { kind, location: node.location });
      }
    } else if (node.kind === "resourceDecl" && node.value !== undefined) {
      // Register resource names as type-like declarations so they can be referenced
      const resourceName = node.value.trim();
      this.currentScope().set(resourceName, node);
      if (node.location !== undefined) {
        this.typeTable.set(resourceName, { kind: "type", location: node.location });
      }
    } else if (node.kind === "intentDecl" && node.value !== undefined && node.value.startsWith("event:")) {
      // Events are stored as intentDecl with value "event:<name>" by the parser
      const eventName = node.value.slice("event:".length).trim();
      this.currentScope().set(eventName, node);
      // Task 4 — populate event table
      if (node.location !== undefined) {
        this.eventTable.set(eventName, node.location);
      }
    }

    for (const child of node.children ?? []) {
      this.collectTopLevelDeclarations(child);
    }
  }

  private lookup(name: string): AstNode | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const found = this.scopes[i]!.get(name);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  private declareInCurrentScope(name: string, node: AstNode): void {
    if (name === "") return;

    const current = this.currentScope();
    if (current.has(name)) {
      this.diagnostics.push({
        code: "LLN-NAME-002",
        name: "DuplicateName",
        severity: "error",
        message: `'${name}' is already declared in this scope.`,
        ...(node.location !== undefined ? { location: node.location } : {}),
        suggestedFix: `Rename this binding or remove the duplicate declaration.`,
      });
      return;
    }

    current.set(name, node);
  }

  // ---------------------------------------------------------------------------
  // Task 2 — LLN-NAME-003: CrossModuleShadow
  //
  // Emit a warning when a letDecl/mutDecl in flow scope has the same name as a
  // built-in domain type. Param shadowing is expected and NOT warned.
  // ---------------------------------------------------------------------------

  private checkCrossModuleShadow(name: string, node: AstNode): void {
    if (!this.insideFlowScope) return;
    if (!BUILT_IN_DOMAIN_TYPES.has(name)) return;

    this.diagnostics.push({
      code: "LLN-NAME-003",
      name: "CrossModuleShadow",
      severity: "warning",
      message: `Binding '${name}' shadows the built-in domain type '${name}'. Consider renaming to avoid confusion.`,
      ...(node.location !== undefined ? { location: node.location } : {}),
      suggestedFix: `Rename the binding to avoid shadowing the built-in '${name}' type.`,
    });
  }

  private checkIdentifierUse(node: AstNode): void {
    const name = node.value ?? "";
    if (name === "" || name === "<error>" || name === "_") return;
    if (name.includes(":")) return;

    // Capital-letter identifiers are type constructors or stdlib module names.
    // SECURITY (Finding 6 — MEDIUM): The original suppression was unconditional
    // for ALL capitalised identifiers. A typo like `FsytexDB.query()` (instead
    // of `FilesystemDB.query()`) would silently pass symbol resolution, potentially
    // executing an unexpected code path if a module with that name exists at runtime.
    //
    // Narrowed: suppress ONLY known stdlib module prefixes from STDLIB_MODULE_KINDS
    // and type names from the type registry. Unknown capitalised names fall through
    // to the existing type-checker diagnostic (LLN-TYPE-001) rather than being
    // silently ignored here.
    //
    // Note: this may increase noise slightly during development. That is acceptable
    // — the alternative (silently ignoring typo-squatted identifiers) is worse.
    const KNOWN_STDLIB_PREFIXES = new Set([
      "AuditLog", "BCrypt", "Csv", "Css", "Database", "Db", "Dom", "Duration",
      "Env", "FileName", "File", "FileSystem", "Html", "Http", "Int", "Float",
      "Js", "Json", "Ldap", "Log", "Math", "Money", "Network", "NoSql",
      "Ok", "Err", "Path", "Process", "Regex", "Request", "Response",
      "Shell", "Sql", "String", "Tensor", "TPU", "Url", "Xml",
      // User-defined type constructors (single-word capitalized) are fine
    ]);
    if (name[0] !== undefined && name[0] >= "A" && name[0] <= "Z") {
      // Allow known stdlib modules and simple type constructor names (no dots)
      const prefix = name.split(".")[0] ?? name;
      if (KNOWN_STDLIB_PREFIXES.has(prefix) || !name.includes(".")) return;
      // Unknown capitalised module reference (e.g. "FraudModel.analyse") —
      // fall through to the lookup check rather than suppressing silently.
    }

    // Numeric placeholders
    if (/^\d/.test(name)) return;

    if (this.lookup(name) !== undefined) return;

    this.diagnostics.push({
      code: "LLN-NAME-001",
      name: "UndeclaredName",
      severity: "error",
      message: `'${name}' is not declared in the current scope.`,
      ...(node.location !== undefined ? { location: node.location } : {}),
      suggestedFix: `Declare '${name}' before using it, or pass it as a parameter.`,
    });
  }

  private walkNode(node: AstNode, context: "normal" | "type" | "pattern"): void {
    switch (node.kind) {
      case "program":
        this.walkChildren(node, "normal");
        return;

      case "importDecl":
        // Types from known packages were already injected in collectTopLevelDeclarations
        return;

      case "typeRef":
      case "effectRef":
      case "enumVariant":
        return;

      case "paramDecl":
        this.declareInCurrentScope(parseParamName(node.value ?? ""), node);
        return;

      case "flowDecl":
      case "secureFlowDecl":
      case "pureFlowDecl":
      case "guardedFlowDecl": {
        this.pushScope();
        for (const child of node.children ?? []) {
          if (child.kind === "paramDecl") this.walkNode(child, "normal");
        }
        const wasInsideFlow = this.insideFlowScope;
        this.insideFlowScope = true;
        for (const child of node.children ?? []) {
          if (child.kind !== "paramDecl") this.walkNode(child, "normal");
        }
        this.insideFlowScope = wasInsideFlow;
        this.popScope();
        return;
      }

      case "block":
        this.pushScope();
        this.walkChildren(node, "normal");
        this.popScope();
        return;

      case "fnDecl":
        this.declareInCurrentScope(node.value ?? "", node);
        this.pushScope();
        this.walkChildren(node, "normal");
        this.popScope();
        return;

      case "letDecl":
      case "mutDecl":
      case "readonlyDecl": {
        // Walk the initializer BEFORE declaring the name to catch use-before-declaration
        const initNode = node.children?.[0];
        if (initNode !== undefined) this.walkNode(initNode, "normal");
        const bindingName = parseBindingName(node.value ?? "");
        // Task 2 — check for cross-module shadow before declaring
        if (node.kind === "letDecl" || node.kind === "mutDecl") {
          this.checkCrossModuleShadow(bindingName, node);
        }
        this.declareInCurrentScope(bindingName, node);
        // Walk remaining children (type refs etc.) after declaration
        for (const child of (node.children ?? []).slice(1)) {
          this.walkNode(child, "normal");
        }
        return;
      }

      case "matchArm":
        for (const child of node.children ?? []) {
          this.walkNode(child, "normal");
        }
        return;

      case "ensureDecl":
        // 0040/#70: inside an `invariant { ensure … }` clause the magic `result` symbol (the
        // flow's output value) is in scope — an output post-condition. Scope it to JUST the
        // ensure expression (a nested scope) so parameters still resolve via the parent flow
        // scope, the body is unaffected, and genuine typos are still flagged LLN-NAME-001.
        this.pushScope();
        this.declareInCurrentScope("result", node);
        this.walkChildren(node, "normal");
        this.popScope();
        return;

      case "identifier":
        if (context === "normal") {
          if ((node.children?.length ?? 0) > 0) {
            this.walkChildren(node, "normal");
          } else {
            this.checkIdentifierUse(node);
          }
        }
        return;

      case "callExpr":
        this.checkCallTarget(node);
        this.walkChildren(node, "normal");
        return;

      case "typeDecl":
      case "enumDecl":
        this.walkChildren(node, "type");
        return;

      case "recordDecl":
        // Task 3 — Record fields are scoped to the record — push a fresh scope so that
        // field names from different records don't conflict with each other.
        this.pushScope();
        this.walkChildren(node, "type");
        this.popScope();
        return;

      case "resourceDecl":
        // Resource declarations have fields (paramDecl) and sub-blocks (operations, policy).
        // Walk children in type context so field typeRefs are not checked as identifiers.
        this.pushScope();
        this.walkChildren(node, "type");
        this.popScope();
        return;

      default:
        this.walkChildren(node, context);
        return;
    }
  }

  private checkCallTarget(node: AstNode): void {
    const name = node.value ?? "";
    if (name === "" || BUILT_IN_VALUE_NAMES.has(name)) return;

    // Internal parser tokens (e.g. #record for anonymous record literals) are not user-defined names
    if (name.startsWith("#")) return;

    // Capital-letter call targets are stdlib or user-defined constructors
    if (name[0] !== undefined && name[0] >= "A" && name[0] <= "Z") return;

    if (STANDARD_PRELUDE.has(name) || this.lookup(name) !== undefined) return;

    // Method call on a receiver — receiver check suppresses the call target
    if (isReceiverCall(node)) return;

    this.diagnostics.push({
      code: "LLN-NAME-001",
      name: "UndeclaredName",
      severity: "error",
      message: `'${name}' is not declared in the current scope.`,
      ...(node.location !== undefined ? { location: node.location } : {}),
      suggestedFix: `Declare '${name}' before using it, or import it from a module.`,
    });
  }

  private walkChildren(node: AstNode, context: "normal" | "type" | "pattern"): void {
    for (const child of node.children ?? []) {
      this.walkNode(child, context);
    }
  }
}

function isReceiverCall(node: AstNode): boolean {
  const first = node.children?.[0];
  return first?.kind === "identifier" || first?.kind === "memberExpr" || first?.kind === "callExpr";
}

function parseParamName(value: string): string {
  let rest = value.trim();
  // Strip leading qualifiers: readonly, unsafe, safe
  if (rest.startsWith("readonly ")) rest = rest.slice("readonly ".length).trim();
  else if (rest.startsWith("unsafe ")) rest = rest.slice("unsafe ".length).trim();
  else if (rest.startsWith("safe "))   rest = rest.slice("safe ".length).trim();
  const colonIdx = rest.indexOf(":");
  return (colonIdx === -1 ? rest : rest.slice(0, colonIdx)).trim();
}

function parseBindingName(value: string): string {
  let rest = value.trim();
  if (rest.startsWith("unsafe ")) rest = rest.slice("unsafe ".length).trim();
  else if (rest.startsWith("safe ")) rest = rest.slice("safe ".length).trim();

  const colonIdx = rest.indexOf(":");
  return (colonIdx === -1 ? rest : rest.slice(0, colonIdx)).trim();
}

export function resolveSymbols(ast: AstNode, importedNames?: readonly string[]): SymbolResolveResult {
  const resolver = new SymbolResolver(importedNames ?? []);
  resolver.resolve(ast);
  return resolver.getResult();
}

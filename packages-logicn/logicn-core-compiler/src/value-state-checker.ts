// =============================================================================
// LogicN Phase 6 — Value-State Checker
//
// Enforces value-state annotation rules on the parsed AST.
// Runs after the parser, before the effect checker.
//
// Spec: docs/Knowledge-Bases/value-state-checker.md
//
// Implemented rules:
//   Rule 1/3 — unsafe bindings cannot reach governed sinks
//              (LLN-VALUESTATE-003: UnsafeValueReachedGovernedSink)
//   Rule 2   — safe mut requires a recognised gate function
//              (LLN-VALUESTATE-001: UnsafeToSafeTransitionDenied)
//   Rule 2B  — safe mut inside if/else where one branch has a gate and
//              the other doesn't
//              (LLN-VALUESTATE-002: UnsafeConditionalUpgrade)
//   Rule 4   — SecureString cannot use == or be passed to log functions
//              (LLN-SECRET-001: SecretValueLogged)
//              (LLN-SECRET-002: SecretComparisonDenied)
//              (LLN-SECRET-003: SecretSerializationDenied)
//              Extended: SecureString in AuditLog.write or record literal at sink
//   Rule 5   — protected value passed to AuditLog.write without redact()
//              (LLN-VALUESTATE-006: ProtectedValueAtAuditLog)
//              (distinct from LLN-VALUESTATE-003 for unsafe-at-sink)
//   Phase 8B — String taint propagation
//              (LLN-VALUESTATE-004: TaintedValuePropagation)
//   Phase 11B.1 — Two-hop taint propagation
//              (LLN-VALUESTATE-005: DerivedUnsafeValueAtSink)
//   Phase 11B.2 — User-defined gate functions
//              Functions whose names start with recognised gate prefixes
//              (validate*, sanitize*, check*, verify*, parse*, decode*)
//              automatically break the taint chain, just like stdlib gates.
//   Cross-conditional taint — unsafe bindings used as if-condition values
//              do NOT clear taint; taint propagates into both branches.
// =============================================================================

import { type AstNode, type SourceLocation } from "./parser.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A secondary source location that gives context for a diagnostic.
 * Used for Rust-style "declared here... used here" error messages.
 */
export interface DiagnosticRelatedLocation {
  readonly message: string;
  readonly location: SourceLocation;
}

export interface ValueStateDiagnostic {
  readonly code: string;
  readonly name: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly location?: SourceLocation;
  readonly suggestedFix?: string;
  /** Machine-applicable fix — the exact LogicN snippet to insert/replace, without prose. */
  readonly suggestedCode?: string;
  /** Rust-style: secondary locations (e.g. where unsafe value was declared). */
  readonly relatedLocations?: readonly DiagnosticRelatedLocation[];
  /** Elm-style: why this is a problem. */
  readonly why?: string;
  /** Elm-style: what goes wrong if ignored. */
  readonly risk?: string;
}

export interface ValueStateCheckResult {
  readonly diagnostics: readonly ValueStateDiagnostic[];
}

// ---------------------------------------------------------------------------
// Diagnostic factory
//
// Branches explicitly on location to satisfy exactOptionalPropertyTypes.
// ---------------------------------------------------------------------------

function makeVSDiag(
  code: string,
  name: string,
  message: string,
  location: SourceLocation | undefined,
  suggestedFix: string,
  suggestedCode?: string,
  opts?: {
    relatedLocations?: readonly DiagnosticRelatedLocation[];
    why?: string;
    risk?: string;
  },
): ValueStateDiagnostic {
  const sc   = suggestedCode !== undefined ? { suggestedCode } : {};
  const rel  = opts?.relatedLocations !== undefined ? { relatedLocations: opts.relatedLocations } : {};
  const why  = opts?.why  !== undefined ? { why:  opts.why  } : {};
  const risk = opts?.risk !== undefined ? { risk: opts.risk } : {};
  const extras = { ...sc, ...rel, ...why, ...risk };
  if (location !== undefined) {
    return { code, name, severity: "error", message, location, suggestedFix, ...extras };
  }
  return { code, name, severity: "error", message, suggestedFix, ...extras };
}

// ---------------------------------------------------------------------------
// ValueStateFlags — internal bitset for fast value-state checks
//
// Downstream passes (SemanticGraph, ExecutionPlanner, Backend) can use bit
// operations instead of string comparisons:
//   if (flags & ValueStateFlags.Unsafe && !(flags & ValueStateFlags.Safe)) → error
//
// These flags describe how trusted the data is (value-state).
// Protected/Redacted/Secret describe sensitivity (privacy qualifier).
// Both can apply to the same binding.
//
// Usage: assign flags during binding analysis; check at sink sites.
// Phase 19: BindingInfo gains a `flags` field replacing string safetyPrefix.
// ---------------------------------------------------------------------------

export const ValueStateFlags = {
  None:      0,
  Unsafe:    1 << 0,  // from request.body / params — untrusted boundary input
  Safe:      1 << 1,  // after a recognised gate function
  Validated: 1 << 2,  // explicitly validated — subset of Safe
  Tainted:   1 << 3,  // derived from Unsafe via non-gate expression
  Protected: 1 << 4,  // protected qualifier — may be used internally, not raw
  Redacted:  1 << 5,  // redacted qualifier — may be logged/audited, not reversed
  Secret:    1 << 6,  // SecureString — approved operations only
  ReadOnly:  1 << 7,  // readonly binding — APU shared-memory candidate
} as const;
export type ValueStateFlagsMask = number;

// ---------------------------------------------------------------------------
// SinkRequirement — structured requirement per governed sink
//
// Each governed sink declares what value-state its arguments must have.
// This is the authoritative machine-readable sink registry. Diagnostics,
// AI tooling, and the SemanticGraph all consume this directly.
//
// Canonical source: docs/Knowledge-Bases/stdlib-gates.yaml §sinks
// When adding a sink, update stdlib-gates.yaml first, then mirror here.
// ---------------------------------------------------------------------------

export interface SinkRequirement {
  /** Minimum required state: any value that does NOT satisfy this is a violation. */
  readonly requiredState: "safe" | "validated" | "redacted" | "nonPII";
  /** Human-readable policy note for diagnostics and AI tools. */
  readonly policyNote: string;
  /** Matching strategy: exact full name, or pattern (checked separately). */
  readonly match: "exact" | "pattern";
}

/**
 * Named sink requirements — exact-match entries only.
 * Pattern-matched sinks (wildcards like *DB.write) are handled by isGovernedSink().
 * Use getSinkRequirement() to query both.
 */
export const SINK_REQUIREMENTS: ReadonlyMap<string, SinkRequirement> = new Map<string, SinkRequirement>([
  ["AuditLog.write",     { requiredState: "redacted",  policyNote: "Audit logs must not contain raw PII. Use redact() before logging.", match: "exact" }],
  ["database.write",     { requiredState: "validated", policyNote: "All database writes require validated data.", match: "exact" }],
  ["network.outbound",   { requiredState: "validated", policyNote: "Network output must be validated before transmission.", match: "exact" }],
  ["response.body",      { requiredState: "safe",      policyNote: "API response bodies must use safe, validated values.", match: "exact" }],
  ["log.write",          { requiredState: "redacted",  policyNote: "Log writes must not include secrets or raw PII.", match: "exact" }],
  ["ai.remoteInference", { requiredState: "validated", policyNote: "AI calls must use validated, governed inputs.", match: "exact" }],
  ["shell.exec",         { requiredState: "validated", policyNote: "Shell commands must use validated arguments to prevent injection.", match: "exact" }],
  ["FileSystem.write",   { requiredState: "safe",      policyNote: "Filesystem writes require safe values.", match: "exact" }],
]);

/**
 * Returns the SinkRequirement for a given call name, or undefined if not a
 * governed sink. Checks exact-match registry first, then falls back to pattern
 * matching for wildcard sinks (e.g. *DB.insert).
 */
export function getSinkRequirement(fullCallName: string): SinkRequirement | undefined {
  const exact = SINK_REQUIREMENTS.get(fullCallName);
  if (exact !== undefined) return exact;

  // Pattern-matched sinks — require validated state
  if (/\w*DB\.(insert|update\w*|delete|write|query|find|select\w*)$/.test(fullCallName)) {
    return { requiredState: "validated", policyNote: "Database operations require validated data.", match: "pattern" };
  }
  if (/^https?\.(post|put|patch|delete)$/.test(fullCallName)) {
    return { requiredState: "validated", policyNote: "HTTP write methods require validated data.", match: "pattern" };
  }
  if (/^EmailService\.(send\w*|deliver)$/.test(fullCallName)) {
    return { requiredState: "validated", policyNote: "Email sends require validated data.", match: "pattern" };
  }
  if (/\w+Payment\.(charge|process|submit)$/.test(fullCallName)) {
    return { requiredState: "validated", policyNote: "Payment operations require validated data.", match: "pattern" };
  }
  if (/^fs\.write\w*$/.test(fullCallName)) {
    return { requiredState: "safe", policyNote: "Filesystem writes require safe values.", match: "pattern" };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Governed sinks
//
// Calls whose arguments must not be unsafe bindings.
// Matched on the reconstructed full call name (receiver.method or method).
//
// Canonical registry (source of truth):
//   docs/Knowledge-Bases/stdlib-gates.yaml  §sinks
//
// When adding a new sink, update stdlib-gates.yaml first, then mirror here.
// ---------------------------------------------------------------------------

function isGovernedSink(node: AstNode): boolean {
  const methodName = node.value ?? "";
  const receiver = node.children?.[0];
  const receiverName =
    receiver?.kind === "identifier" ? (receiver.value ?? "")
    : receiver?.kind === "memberExpr" ? getNodeName(receiver)
    : "";
  const fullName =
    receiverName !== "" ? `${receiverName}.${methodName}` : methodName;

  // Database patterns: *DB.insert / update / delete / write / query / find / select
  if (/\w*DB\.(insert|update\w*|delete|write|query|find|select\w*)$/.test(fullName)) return true;
  // Audit log
  if (fullName === "AuditLog.write") return true;
  // Shell and filesystem
  if (/^(shell\.exec|FileSystem\.write|fs\.write\w*)$/.test(fullName)) return true;
  // HTTP write methods — unsafe data must not cross network boundary unvalidated
  if (/^https?\.(post|put|patch|delete)$/.test(fullName)) return true;
  // Email / payment sinks
  if (/^EmailService\.(send\w*|deliver)$/.test(fullName)) return true;
  if (/\w+Payment\.(charge|process|submit)$/.test(fullName)) return true;

  // Single source of truth (audit VSC-001): any sink in the SINK_REQUIREMENTS registry —
  // exact OR pattern — is governed. This keeps isGovernedSink a strict SUPERSET so the two
  // registries can't silently diverge. Previously response.body / ai.remoteInference /
  // network.outbound / log.write / bare database.write / http(s).get were enforced by NEITHER
  // path, so unsafe/tainted values escaped the trust boundary with no diagnostic.
  if (getSinkRequirement(fullName) !== undefined) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Log / print functions
//
// Calls whose arguments must not include SecureString bindings.
//
// Canonical registry (source of truth):
//   docs/Knowledge-Bases/stdlib-gates.yaml  §sinks  (log_receiver, print_output)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Serialization functions
//
// Calls whose arguments must not include SecureString bindings.
// Serializing a secret value would expose it in the output stream.
// ---------------------------------------------------------------------------

function isSerializationCall(node: AstNode): boolean {
  const methodName = node.value ?? "";
  if (methodName === "serialize" || methodName === "stringify") return true;
  const receiver = node.children?.[0];
  const receiverName = receiver?.kind === "identifier" ? (receiver.value ?? "") : "";
  const fullName = receiverName !== "" ? `${receiverName}.${methodName}` : methodName;
  return /^(json\.encode|json\.stringify|JSON\.stringify|toml\.encode|xml\.encode|serialize)$/.test(fullName);
}

function isLogCall(node: AstNode): boolean {
  const methodName = node.value ?? "";
  // Standalone: print(...)
  if (methodName === "print") return true;
  // Method: log.info / log.error / log.warn / log.write, Logger.*, console.*
  const receiver = node.children?.[0];
  if (receiver?.kind === "identifier") {
    const rcvName = receiver.value ?? "";
    if (rcvName === "log" || rcvName === "Logger" || rcvName === "console") return true;
  }
  return false;
}

// Network / egress sinks — a raw secret transmitted off-host is an exfiltration path.
// Recognised: http.* / https.* / net.* / socket.* / ws.* / websocket.* method calls,
// standalone fetch(...), and email/EmailService.send.
function isNetworkSink(node: AstNode): boolean {
  const methodName = node.value ?? "";
  if (methodName === "fetch") return true;
  const receiver = node.children?.[0];
  if (receiver?.kind !== "identifier") return false;
  const r = (receiver.value ?? "").toLowerCase();
  if (r === "http" || r === "https" || r === "net" || r === "socket" || r === "ws" || r === "websocket") return true;
  if ((r === "email" || r === "emailservice") && methodName === "send") return true;
  // Egress beyond raw network transport: the HTTP response body leaves the trust
  // boundary; remote inference ships the payload to a third-party model; a vector
  // store persists the (invertible) embedding. All are exfiltration paths.
  if (r === "response" && methodName === "body") return true;
  if (r === "ai" && (methodName === "remoteInference" || methodName === "remote")) return true;
  if (/vectordb$/.test(r) && /^(write|insert|upsert|add|index)$/.test(methodName)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Governance qualifier helpers
//
// Used for LLN-VALUESTATE-006 / LLN-VALUESTATE-007 boundary checks.
// ---------------------------------------------------------------------------

/**
 * Returns true when the AST node produces a protected value.
 *
 * Mirrors the type-checker's inferType protected-value inference:
 *   protect(x)                              → "protected X"
 *   validate.email(x) [receiver=validate]   → "protected Email"
 *   method.startsWith("validate.")          → "protected String" (qualified method name)
 *
 * Note: validate.sanitize(x), validate.text(x) etc. have unqualified method names
 * ("sanitize", "text") so they do NOT produce a protected type and must not fire
 * this check.
 *
 * Also: errorPropagation (?) wrapping any of the above is unwrapped.
 */
function isProtectedValueExpression(node: AstNode): boolean {
  // Unwrap errorPropagation (?)
  if (node.kind === "errorPropagation") {
    const inner = node.children?.[0];
    return inner !== undefined && isProtectedValueExpression(inner);
  }
  if (node.kind !== "callExpr") return false;
  const methodName = node.value ?? "";
  // protect(x) → protected X
  if (methodName === "protect") return true;
  // validate.email(x) — method is "email", receiver is identifier "validate"
  // or method starts with "validate." (fully-qualified method name)
  const receiver = node.children?.[0];
  const receiverIsValidateNamespace =
    receiver?.kind === "identifier" && receiver.value === "validate";
  if (receiverIsValidateNamespace && methodName === "email") return true;
  // Fully-qualified validate method names (method itself starts with "validate.")
  if (methodName.startsWith("validate.")) return true;
  return false;
}

/**
 * Returns true when the node reads a value out of a `secrets {}`-declared credential —
 * a secret SOURCE. A binding initialised from such a source is treated as a secret
 * (SecureString-equivalent), so the existing LLN-SECRET-001 (logging) and LLN-SECRET-003
 * (serialization) sink guards fire if that binding ever reaches a log / serialize / audit
 * sink. Recognised accessors (receiver namespace . method):
 *   secret.get / secret.read / vault.read / vault.get / kms.decrypt / secrets.get  (any case)
 */
function isSecretSourceExpression(node: AstNode): boolean {
  if (node.kind === "errorPropagation") {
    const inner = node.children?.[0];
    return inner !== undefined && isSecretSourceExpression(inner);
  }
  if (node.kind !== "callExpr") return false;
  const receiver = node.children?.[0];
  if (receiver?.kind !== "identifier") return false;
  const ns = (receiver.value ?? "").toLowerCase();
  return ns === "secret" || ns === "secrets" || ns === "vault" || ns === "kms";
}

/**
 * Returns true when the AST node is a `redact(...)` call expression (or wrapped in ?).
 * Assigning redact(x) to a plain binding is a LLN-VALUESTATE-007 violation.
 */
function isRedactCall(node: AstNode): boolean {
  // Unwrap errorPropagation (?)
  if (node.kind === "errorPropagation") {
    const inner = node.children?.[0];
    return inner !== undefined && isRedactCall(inner);
  }
  return node.kind === "callExpr" && (node.value === "redact");
}

/**
 * Extract every identifier referenced inside `${...}` interpolation holes of a string
 * literal. The lexer keeps an interpolated string as a single token (e.g. `"tok=${k}"`),
 * so without this the dataflow walkers can't see `k`. Conservative/fail-closed: returns
 * ALL identifiers in each hole (a method name that isn't a binding simply resolves to
 * undefined). Closes the interpolation laundering path for secrets/embeddings/taint.
 */
function interpolatedNames(node: AstNode): string[] {
  if (node.kind !== "stringLiteral" || typeof node.value !== "string") return [];
  const out: string[] = [];
  const holes = /\$\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = holes.exec(node.value)) !== null) {
    const ids = (m[1] ?? "").match(/[A-Za-z_]\w*/g);
    if (ids) out.push(...ids);
  }
  return out;
}

/**
 * Returns true when `node` reads from — OR is DERIVED from — a `secrets {}` credential.
 * This is the propagating form of isSecretSourceExpression: a secret carried through a
 * transform (slice, concat, member access, record field, a non-redacting call/helper)
 * is STILL secret. The ONLY declassifier is redact() (irreversible) — a parsed, decoded,
 * validated, or otherwise transformed secret remains a secret for sink purposes.
 *
 * Closes the LLN-SECRET-002 derived-secret fail-open: previously only a binding whose
 * init was a DIRECT secret accessor got tagged SecureString, so `let p = key.slice(0,5)`
 * (or `key + x`, or `{ tok: key }`) laundered the credential past the egress guard.
 * Tagging derived bindings here also hardens LLN-SECRET-001 (logging) and LLN-SECRET-003
 * (serialization), which key on the same SecureString tag.
 */
function derivesFromSecret(
  node: AstNode,
  lookupBinding: (name: string) => BindingInfo | undefined,
): boolean {
  // redact(...) is the sole declassifier — it breaks the chain.
  if (isRedactCall(node)) return false;
  // A direct secret accessor (secret.get / vault.read / kms.decrypt / secrets.get), incl. `?`.
  if (isSecretSourceExpression(node)) return true;

  switch (node.kind) {
    case "identifier": {
      const binding = lookupBinding(node.value ?? "");
      return binding?.typeName === "SecureString";
    }
    case "memberExpr": {
      const receiver = node.children?.[0];
      return receiver !== undefined && derivesFromSecret(receiver, lookupBinding);
    }
    case "callExpr": {
      // Record literal "#record" AND spread/update "#record-update" (`{ ...base, tok: k }`):
      // each child is a field (value = child[0]) or a #spread (source = child[0]).
      if (node.value === "#record" || node.value === "#record-update") {
        return (node.children ?? []).some((field) => {
          const value = field.children?.[0] ?? field;
          return derivesFromSecret(value, lookupBinding);
        });
      }
      // Any non-redacting call carrying a secret through receiver or args stays secret
      // (NOTE: unlike the taint chain, validate/parse/decode do NOT declassify a secret).
      return (node.children ?? []).some((child) => derivesFromSecret(child, lookupBinding));
    }
    case "stringLiteral":
      // Interpolated secret: `"Authorization: ${key}"` keeps the secret.
      return interpolatedNames(node).some(
        (n) => lookupBinding(n)?.typeName === "SecureString",
      );
    case "binaryExpr":
    case "listLiteral":
    case "errorPropagation":
      return (node.children ?? []).some((child) => derivesFromSecret(child, lookupBinding));
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// U2/#204 — semantic-embedding confidentiality (LLN-PRIVACY-002)
//
// A semantic embedding vector can be inverted back to its source text
// (embedding-inversion / vec2text recovers ~90%+), so a CLEARTEXT embedding
// crossing a trust boundary is a confidentiality leak equivalent to leaking the
// text. We model the same source→derive→sink dataflow as secrets, with seal()/
// encrypt() (engine-side AEAD, govern-don't-absorb) as the sole declassifier.
// ---------------------------------------------------------------------------

/** A type annotation that denotes a semantic embedding vector. */
function isEmbeddingTypeName(typeName: string | undefined): boolean {
  return typeName === "Embedding" || typeName === "EmbeddingResult";
}

/**
 * Returns true when `node` reads a semantic embedding from a model — the embedding
 * SOURCE. Keyed on the REAL shipped symbols (the EmbeddingModel value from
 * @logicn/ai-types, canonical call `EmbeddingModel.run(...)`), the common
 * embed / embedQuery / embedDocuments method names, AND any receiver whose name
 * contains "embed" (case-insensitive) — so a constructed instance var like
 * `embeddingModel.run(req)` or `myEmbedder.infer(x)` is recognized, not just the
 * exact-case type value. Unwraps `?`.
 */
function isEmbeddingSourceExpression(node: AstNode): boolean {
  if (node.kind === "errorPropagation") {
    const inner = node.children?.[0];
    return inner !== undefined && isEmbeddingSourceExpression(inner);
  }
  if (node.kind !== "callExpr") return false;
  const method = (node.value ?? "").toLowerCase();
  if (method === "embed" || method === "embedquery" || method === "embeddocuments") return true;
  const receiver = node.children?.[0];
  if (receiver?.kind === "identifier" && /embed/i.test(receiver.value ?? "")) return true;
  return false;
}

/** seal(...) / encrypt(...) — the sole declassifier for an embedding (incl. `?`). */
function isSealCall(node: AstNode): boolean {
  if (node.kind === "errorPropagation") {
    const inner = node.children?.[0];
    return inner !== undefined && isSealCall(inner);
  }
  return node.kind === "callExpr" && (node.value === "seal" || node.value === "encrypt");
}

/**
 * Propagating form of isEmbeddingSourceExpression: a cleartext embedding carried
 * through slice/concat/normalize/reshape/member/record/non-sealing call STAYS a
 * cleartext embedding (this is what holds the line against vec2text laundering).
 * The ONLY declassifier is seal()/encrypt() — mirrors derivesFromSecret's redact().
 */
function derivesFromEmbedding(
  node: AstNode,
  lookupBinding: (name: string) => BindingInfo | undefined,
): boolean {
  if (isSealCall(node)) return false;
  if (isEmbeddingSourceExpression(node)) return true;

  switch (node.kind) {
    case "identifier": {
      const binding = lookupBinding(node.value ?? "");
      return binding?.embeddingDerived === true;
    }
    case "memberExpr": {
      const receiver = node.children?.[0];
      return receiver !== undefined && derivesFromEmbedding(receiver, lookupBinding);
    }
    case "callExpr": {
      // "#record" literal AND "#record-update" spread (`{ ...base, v: e }`).
      if (node.value === "#record" || node.value === "#record-update") {
        return (node.children ?? []).some((field) => {
          const value = field.children?.[0] ?? field;
          return derivesFromEmbedding(value, lookupBinding);
        });
      }
      return (node.children ?? []).some((child) => derivesFromEmbedding(child, lookupBinding));
    }
    case "stringLiteral":
      // Interpolated embedding: `"vec=${e}"` keeps the embedding cleartext.
      return interpolatedNames(node).some(
        (n) => lookupBinding(n)?.embeddingDerived === true,
      );
    case "binaryExpr":
    case "listLiteral":
    case "errorPropagation":
      return (node.children ?? []).some((child) => derivesFromEmbedding(child, lookupBinding));
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Gate function recognition
//
// The right-hand side of `safe mut name = gate(name)?` must match one of these.
//
// Canonical registry (source of truth):
//   docs/Knowledge-Bases/stdlib-gates.yaml  §gates
//
// Phase 6 uses prefix-based matching. Phase 7+ should load from the registry.
// When adding a new gate, update stdlib-gates.yaml first, then mirror here.
// ---------------------------------------------------------------------------

const GATE_PREFIXES = [
  "validate.",
  "sanitize.",
  "json.decode",
  "toml.decode",
  "parse.",
  "constantTimeEquals",
  "redact",
] as const;

// ---------------------------------------------------------------------------
// Phase 11B.2 — User-defined gate function prefixes
//
// Functions whose names start with any of these prefixes are automatically
// treated as gate functions that break the taint chain. This covers the common
// naming conventions for validation helpers (validateAge, sanitizeHtml, etc.)
// without requiring explicit @gate annotations in the AST.
// ---------------------------------------------------------------------------

const USER_GATE_NAME_PREFIXES = [
  "validate",
  "sanitize",
  "check",
  "verify",
  "parse",
  "decode",
] as const;

/**
 * Phase 11B.2: Walk the AST and collect user-defined gate function names.
 *
 * A function is a user gate if its unqualified name starts with one of the
 * recognised gate name prefixes (validate*, sanitize*, check*, verify*,
 * parse*, decode*). This mirrors the stdlib gate convention and requires no
 * additional annotation syntax.
 *
 * In addition to name-prefix matching, the set contains ALL fnDecl names that
 * appear at the top level of the program so that call-site checks can find
 * them by simple Set lookup.
 */
function collectUserGates(ast: AstNode): Set<string> {
  const gates = new Set<string>();

  function walk(node: AstNode): void {
    if (node.kind === "fnDecl") {
      const fnName = node.value ?? "";
      if (
        fnName !== "" &&
        USER_GATE_NAME_PREFIXES.some((prefix) => fnName.startsWith(prefix))
      ) {
        gates.add(fnName);
      }
    }
    for (const child of node.children ?? []) walk(child);
  }

  walk(ast);
  return gates;
}

function isGateCallName(fullName: string, userGates?: ReadonlySet<string>): boolean {
  if (GATE_PREFIXES.some((prefix) => fullName.startsWith(prefix))) return true;
  // Phase 11B.2: user-defined gate by name prefix (e.g. validateAge)
  if (USER_GATE_NAME_PREFIXES.some((prefix) => fullName.startsWith(prefix))) return true;
  // Phase 11B.2: user-defined gate by explicit registry
  if (userGates !== undefined && userGates.has(fullName)) return true;
  return false;
}

/**
 * Phase 4.3: Walk the AST and collect user-defined flow names.
 * Includes flowDecl, secureFlowDecl, pureFlowDecl, guardedFlowDecl kinds.
 * Used for inter-flow call-site taint warnings.
 */
function collectUserFlows(ast: AstNode): Set<string> {
  const flows = new Set<string>();

  function walk(node: AstNode): void {
    if (
      node.kind === "flowDecl" ||
      node.kind === "secureFlowDecl" ||
      node.kind === "pureFlowDecl" ||
      node.kind === "guardedFlowDecl"
    ) {
      const flowName = node.value ?? "";
      if (flowName !== "") flows.add(flowName);
    }
    for (const child of node.children ?? []) walk(child);
  }

  walk(ast);
  return flows;
}

// ---------------------------------------------------------------------------
// AST name reconstruction helpers
// ---------------------------------------------------------------------------

function getNodeName(node: AstNode): string {
  if (node.kind === "identifier") return node.value ?? "";
  if (node.kind === "memberExpr") {
    const parent = node.children?.[0];
    const parentName = parent !== undefined ? getNodeName(parent) : "";
    const memberName = node.value ?? "";
    return parentName !== "" ? `${parentName}.${memberName}` : memberName;
  }
  return "";
}

function buildFullCallName(node: AstNode): string {
  const methodName = node.value ?? "";
  const receiver = node.children?.[0];
  if (receiver === undefined) return methodName;
  const receiverName = getNodeName(receiver);
  return receiverName !== "" ? `${receiverName}.${methodName}` : methodName;
}

// ---------------------------------------------------------------------------
// Binding value parser
//
// Parses the encoded `value` field of letDecl / mutDecl AST nodes.
// Format: [safetyPrefix " "] name [":" " " typeName [...postfixQualifiers]]
// ---------------------------------------------------------------------------

interface BindingInfo {
  readonly name: string;
  readonly safetyPrefix: "unsafe" | "safe" | undefined;
  readonly typeName: string;
  /** Location where this binding was declared — used for Rust-style related diagnostics. */
  readonly declaredAt?: SourceLocation;
  /**
   * Phase 11B.1 — Two-hop taint propagation.
   * True when this binding was derived from an unsafe or tainted binding via
   * a non-gate expression (e.g. rawQuery.trim()). Such bindings emit
   * LLN-VALUESTATE-005 when they reach governed sinks.
   */
  readonly tainted?: boolean;
  /** The original unsafe binding name this taint was derived from (for diagnostics). */
  readonly taintSource?: string;
  /**
   * U2/#204 — SemanticVector confidentiality (LLN-PRIVACY-002).
   * True when this binding holds, or is DERIVED from, a semantic embedding vector
   * (EmbeddingModel.run/.embed, or an Embedding/EmbeddingResult-typed binding) and has
   * NOT been sealed/encrypted. A cleartext embedding is inversion-bearing (vec2text), so
   * it must not cross a trust boundary in cleartext; reaching a network sink emits
   * LLN-PRIVACY-002. seal()/encrypt() is the sole declassifier. Propagates like `tainted`.
   */
  readonly embeddingDerived?: boolean;
}

function parseBindingValue(value: string): BindingInfo {
  let rest = value.trim();
  let safetyPrefix: "unsafe" | "safe" | undefined;

  if (rest.startsWith("unsafe ")) {
    safetyPrefix = "unsafe";
    rest = rest.slice("unsafe ".length).trim();
  } else if (rest.startsWith("safe ")) {
    safetyPrefix = "safe";
    rest = rest.slice("safe ".length).trim();
  }

  // rest = "name: Type [qualifiers]" or "name"
  const colonIdx = rest.indexOf(":");
  if (colonIdx === -1) {
    return { safetyPrefix, name: rest.trim(), typeName: "" };
  }

  const name = rest.slice(0, colonIdx).trim();
  const typeSection = rest.slice(colonIdx + 1).trim();
  // Base type name is the first space-delimited or angle-bracket-delimited token
  const baseName = typeSection.split(/[<\s]/)[0] ?? typeSection;

  return { safetyPrefix, name, typeName: baseName };
}

// ---------------------------------------------------------------------------
// Phase 4: Source-from origin taint map
//
// Maps recognised `source_from` origin prefixes to taint status.
// "tainted" origins produce bindings equivalent to `unsafe let`.
// "clean" origins produce plain (untainted) bindings.
// ---------------------------------------------------------------------------

const SOURCE_FROM_TAINTED_PREFIXES = [
  "Network.",
  "External.",
] as const;

const SOURCE_FROM_CLEAN_PREFIXES = [
  "InternalService.",
  "Config.",
] as const;

const SOURCE_FROM_TAINTED_EXACT = new Set([
  "Network.ClientSocket",
  "Network.HttpRequest",
  "Network.WebSocket",
]);

const SOURCE_FROM_CLEAN_EXACT = new Set([
  "Database.PrimaryKey",
]);

/**
 * Returns true if a `source_from` origin string denotes an untrusted source
 * (equivalent to `unsafe let` taint).
 *
 * FAIL-CLOSED (#153): an unknown / unrecognised origin is treated as TAINTED.
 * Only an origin that is explicitly allow-listed as clean (exact or prefix)
 * is trusted. This makes the taint-origin classifier deny-by-default: a
 * developer who introduces a new data source must register it as clean
 * before its values may flow into an injection sink unsanitised. The old
 * behaviour ("only flag what is known-bad") let any unregistered origin —
 * including a freshly-added external boundary — silently bypass taint
 * tracking.
 */
function isUntrustedSourceFromOrigin(origin: string): boolean {
  // An empty / absent origin carries no provenance evidence → tainted.
  if (origin.trim() === "") return true;
  // Explicit allow-list wins (exact match) so a clean leaf under an otherwise
  // tainted prefix can still be trusted.
  if (SOURCE_FROM_CLEAN_EXACT.has(origin)) return false;
  if (SOURCE_FROM_TAINTED_EXACT.has(origin)) return true;
  // Prefix matching — Network.* and External.* are tainted
  if (SOURCE_FROM_TAINTED_PREFIXES.some((p) => origin.startsWith(p))) return true;
  // InternalService.* and Config.* are clean
  if (SOURCE_FROM_CLEAN_PREFIXES.some((p) => origin.startsWith(p))) return false;
  // Unknown origins: FAIL CLOSED — treat as tainted (deny-by-default).
  return true;
}

// ---------------------------------------------------------------------------
// Phase 11B.1 — Taint expression analysis
//
// Determines whether an expression tree is derived from an unsafe or
// tainted binding. Validation / redaction calls break the taint chain.
// ---------------------------------------------------------------------------

/**
 * Returns true if `expr` references an unsafe or tainted binding anywhere in
 * its tree, UNLESS the expression is a recognised validation/redaction gate
 * (which breaks the taint chain).
 *
 * Phase 11B.2: accepts an optional `userGates` set so that user-defined gate
 * functions also break the taint chain.
 */
function isTaintedExpression(
  expr: AstNode,
  lookupBinding: (name: string) => BindingInfo | undefined,
  userGates?: ReadonlySet<string>,
): boolean {
  if (expr.kind === "identifier" && expr.value) {
    const binding = lookupBinding(expr.value);
    if (binding === undefined) return false;
    return binding.safetyPrefix === "unsafe" || (binding.tainted === true);
  }

  if (expr.kind === "memberExpr") {
    const receiver = expr.children?.[0];
    return receiver !== undefined && isTaintedExpression(receiver, lookupBinding, userGates);
  }

  // Phase 4.1: list/array literals — tainted if any element is tainted
  if (expr.kind === "listLiteral") {
    return (expr.children ?? []).some((element) =>
      isTaintedExpression(element, lookupBinding, userGates),
    );
  }

  if (expr.kind === "callExpr") {
    // Reconstruct the full qualified call name (e.g. "validate.searchQuery")
    // by combining the receiver identifier/memberExpr name with the method name.
    const fullCallName = buildFullCallName(expr);
    const methodNameOnly = expr.value ?? "";
    // Gate calls break the taint chain — validate.*, sanitize.*, redact*, etc.
    // Phase 11B.2: also check user-defined gates.
    // Also check the unqualified method name because buildFullCallName may incorrectly
    // treat the first argument as the receiver for standalone function calls like
    // validateAge(rawAge) → builds "rawAge.validateAge" instead of just "validateAge".
    if (isGateCallName(fullCallName, userGates) || isGateCallName(methodNameOnly, userGates)) return false;

    // Record literals parse as callExpr "#record" whose children are field-name
    // identifiers, each holding the field VALUE as its own child. A tainted field
    // value must keep the record tainted — otherwise `let m = { id: unsafeInput }`
    // followed by a sink call on `m` silently launders the taint (injection path).
    // Recurse on each field's value via isTaintedExpression so gate calls are honored.
    if (expr.value === "#record") {
      return (expr.children ?? []).some((field) => {
        const valueNode = field.children?.[0];
        return valueNode !== undefined && isTaintedExpression(valueNode, lookupBinding, userGates);
      });
    }

    // Phase 4.1: append(list, value) — if any non-receiver arg is tainted, result is tainted
    if (methodNameOnly === "append") {
      const args = expr.children?.slice(1) ?? [];
      // Also handle method-style call: receiver.append(taintedArg)
      // receiver is children[0] — only check args for taint in append
      if (args.some((a) => isTaintedExpression(a, lookupBinding, userGates))) return true;
      // Also check if this is standalone append(list, taintedVal) — all children are args
      const allArgs = expr.children ?? [];
      if (allArgs.some((a) => isTaintedExpression(a, lookupBinding, userGates))) return true;
      return false;
    }

    // For non-gate calls, check whether the receiver binding is itself tainted/unsafe,
    // OR whether any of the call arguments are tainted.
    // Note: the first child is the receiver (could be a namespace identifier or binding).
    const firstChild = expr.children?.[0];
    const args = expr.children?.slice(1) ?? [];

    // Check if receiver is a tainted/unsafe BINDING (not a namespace like "UsersDB")
    const receiverIsTainted =
      firstChild !== undefined &&
      firstChild.kind === "identifier" &&
      (() => {
        const b = lookupBinding(firstChild.value ?? "");
        return b?.safetyPrefix === "unsafe" || b?.tainted === true;
      })();

    // Also recurse into memberExpr receivers (e.g. obj.prop.method())
    const receiverMemberTainted =
      firstChild !== undefined &&
      firstChild.kind === "memberExpr" &&
      isTaintedExpression(firstChild, lookupBinding, userGates);

    const argsTainted = args.some((a) => isTaintedExpression(a, lookupBinding, userGates));
    return receiverIsTainted || receiverMemberTainted || argsTainted;
  }

  if (expr.kind === "binaryExpr") {
    const [left, right] = expr.children ?? [];
    return (
      (left !== undefined && isTaintedExpression(left, lookupBinding, userGates)) ||
      (right !== undefined && isTaintedExpression(right, lookupBinding, userGates))
    );
  }

  // errorPropagation (?) — the wrapped expression might be tainted
  if (expr.kind === "errorPropagation") {
    const inner = expr.children?.[0];
    return inner !== undefined && isTaintedExpression(inner, lookupBinding, userGates);
  }

  return false;
}

/**
 * Walks an expression tree to find the name of the first unsafe or tainted
 * binding identifier it references. Used for building diagnostic messages.
 */
function findTaintSourceName(
  expr: AstNode,
  lookupBinding: (name: string) => BindingInfo | undefined,
): string | undefined {
  if (expr.kind === "identifier" && expr.value) {
    const binding = lookupBinding(expr.value);
    if (binding?.safetyPrefix === "unsafe") return binding.name;
    if (binding?.tainted === true) return binding.taintSource ?? binding.name;
  }
  for (const child of expr.children ?? []) {
    const found = findTaintSourceName(child, lookupBinding);
    if (found !== undefined) return found;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Value-state checker implementation
// ---------------------------------------------------------------------------

class ValueStateChecker {
  private readonly diagnostics: ValueStateDiagnostic[] = [];
  // Binding scope stack — innermost scope is last
  private readonly scopes: Array<Map<string, BindingInfo>> = [];
  // Phase 11B.2: user-defined gate function names (collected from fnDecl nodes)
  private readonly userGates: ReadonlySet<string>;
  // Phase 4.3: user-defined flow names (collected from *flowDecl nodes)
  private readonly userFlows: ReadonlySet<string>;

  constructor(userGates: ReadonlySet<string> = new Set(), userFlows: ReadonlySet<string> = new Set()) {
    this.userGates = userGates;
    this.userFlows = userFlows;
  }

  check(ast: AstNode): void {
    this.pushScope();
    this.walkNode(ast);
    this.popScope();
  }

  getResult(): ValueStateCheckResult {
    return { diagnostics: [...this.diagnostics] };
  }

  // ── Scope management ─────────────────────────────────────────────────────

  private pushScope(): void {
    this.scopes.push(new Map());
  }

  private popScope(): void {
    this.scopes.pop();
  }

  private currentScope(): Map<string, BindingInfo> {
    return this.scopes[this.scopes.length - 1] ?? new Map();
  }

  private lookupBinding(name: string): BindingInfo | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const info = this.scopes[i]!.get(name);
      if (info !== undefined) return info;
    }
    return undefined;
  }

  private registerBinding(info: BindingInfo): void {
    this.currentScope().set(info.name, info);
  }

  /**
   * Update an existing binding in the nearest scope where it is defined.
   * Used to re-derive a binding's value-state flags (e.g. on reassignment / derivation).
   */
  private updateBinding(name: string, patch: Partial<BindingInfo>): void {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const scope = this.scopes[i]!;
      const existing = scope.get(name);
      if (existing !== undefined) {
        scope.set(name, { ...existing, ...patch });
        return;
      }
    }
  }

  // ── AST walker ───────────────────────────────────────────────────────────

  private walkNode(node: AstNode): void {
    switch (node.kind) {
      case "program":
        this.walkChildren(node);
        break;

      case "flowDecl":
      case "secureFlowDecl":
      case "pureFlowDecl":
        this.pushScope();
        // Register parameter bindings so SecureString params are tracked
        for (const child of node.children ?? []) {
          if (child.kind === "paramDecl") {
            this.registerParamBinding(child);
          }
        }
        this.walkChildren(node);
        this.popScope();
        break;

      case "block":
        this.pushScope();
        this.walkChildren(node);
        this.popScope();
        break;

      case "letDecl":
        this.handleLetDecl(node);
        break;

      case "mutDecl":
        this.handleMutDecl(node);
        break;

      case "assignStmt":
        this.handleAssignStmt(node);
        break;

      case "trapDecl":
        // VSC-002 (owner decision A, 2026-06-16): `trap` does NOT declassify — it is a runtime
        // guard/invariant with no value-state effect. Declassification requires an explicit
        // validate.* / sanitize.* / redact() gate (the only fail-closed contract).
        break;

      case "callExpr":
        this.handleCallExpr(node);
        // Walk children to catch nested governed-sink / log calls
        this.walkChildren(node);
        break;

      case "binaryExpr":
        this.handleBinaryExpr(node);
        this.walkChildren(node);
        break;

      case "ifStmt":
        this.handleIfStmt(node);
        break;

      default:
        this.walkChildren(node);
        break;
    }
  }

  /**
   * Handle if/else statements:
   *
   * 1. Task 1 (VALUESTATE-002): detect when one branch uses `safe mut` with a
   *    gate and the other uses `safe mut` without a gate — UnsafeConditionalUpgrade.
   *
   * 2. Task 2 (cross-conditional taint): if the condition references an unsafe
   *    binding via a non-gate expression, taint propagates into both branches
   *    regardless (only gate calls in the RHS of a binding clear taint).
   */
  private handleIfStmt(node: AstNode): void {
    const [_condition, thenBlock, elseBlock] = node.children ?? [];

    // Walk the condition expression first (does NOT clear taint).
    if (_condition !== undefined) this.walkNode(_condition);

    // Walk then/else branches and collect safe-mut declarations from each.
    if (thenBlock !== undefined && elseBlock !== undefined) {
      // Collect safe-mut declarations in then-branch
      const thenSafeMuts = this.collectSafeMutDecls(thenBlock);
      // Collect safe-mut declarations in else-branch
      const elseSafeMuts = this.collectSafeMutDecls(elseBlock);

      // Check for asymmetric gate usage (VALUESTATE-002).
      for (const [name, thenHasGate] of thenSafeMuts) {
        const elseHasGate = elseSafeMuts.get(name);
        if (elseHasGate !== undefined) {
          // Same name appears in both branches as safe mut.
          if (thenHasGate && !elseHasGate) {
            // then-branch has gate, else doesn't
            this.diagnostics.push(makeVSDiag(
              "LLN-VALUESTATE-002",
              "UnsafeConditionalUpgrade",
              `'safe mut ${name}' is used in both branches of an if/else, but only the 'if' branch uses a recognised gate. Both branches must validate before upgrading to safe.`,
              elseBlock.location,
              `Add a gate in the else branch: safe mut ${name} = validate.${name}(${name})?`,
              `safe mut ${name} = validate.${name}(${name})?`,
            ));
          } else if (!thenHasGate && elseHasGate) {
            // else-branch has gate, then doesn't
            this.diagnostics.push(makeVSDiag(
              "LLN-VALUESTATE-002",
              "UnsafeConditionalUpgrade",
              `'safe mut ${name}' is used in both branches of an if/else, but only the 'else' branch uses a recognised gate. Both branches must validate before upgrading to safe.`,
              thenBlock.location,
              `Add a gate in the if branch: safe mut ${name} = validate.${name}(${name})?`,
              `safe mut ${name} = validate.${name}(${name})?`,
            ));
          }
        }
      }
    }

    // Walk both branches normally to apply all other checks.
    if (thenBlock !== undefined) this.walkNode(thenBlock);
    if (elseBlock !== undefined) this.walkNode(elseBlock);
  }

  /**
   * Shallowly scan a block or node for `mutDecl` nodes with `safe` prefix,
   * returning a map of binding name → whether the RHS is a gate expression.
   * Only looks one level deep (direct children of the block).
   */
  private collectSafeMutDecls(block: AstNode): Map<string, boolean> {
    const result = new Map<string, boolean>();
    const stmts = block.kind === "block" ? (block.children ?? []) : [block];
    for (const stmt of stmts) {
      if (stmt.kind === "mutDecl") {
        const info = parseBindingValue(stmt.value ?? "");
        if (info.safetyPrefix === "safe") {
          const init = stmt.children?.[0];
          const hasGate = init !== undefined && this.isGateExpression(init);
          result.set(info.name, hasGate);
        }
      }
    }
    return result;
  }

  private walkChildren(node: AstNode): void {
    for (const child of node.children ?? []) {
      this.walkNode(child);
    }
  }

  // ── Binding handlers ─────────────────────────────────────────────────────

  private registerParamBinding(node: AstNode): void {
    // paramDecl.value = "name: Type" or "name: Type source_from Origin"
    const paramValue = node.value ?? "";
    const colonIdx = paramValue.indexOf(":");
    if (colonIdx === -1) return;
    const name = paramValue.slice(0, colonIdx).trim();
    const typeSection = paramValue.slice(colonIdx + 1).trim();

    // Phase 4.4: detect `source_from` annotation in the type section
    // Format: "Type source_from Origin" (e.g. "String source_from Network.ClientSocket")
    const sourceFromIdx = typeSection.indexOf("source_from");
    let typeName: string;
    let sourceFromOrigin: string | undefined;
    if (sourceFromIdx !== -1) {
      typeName = typeSection.slice(0, sourceFromIdx).trim().split(/[<\s]/)[0] ?? "";
      sourceFromOrigin = typeSection.slice(sourceFromIdx + "source_from".length).trim();
    } else {
      typeName = typeSection.split(/[<\s]/)[0] ?? typeSection;
    }

    const locField = node.location !== undefined ? { declaredAt: node.location } : {};

    // Phase 4.4: auto-taint params from untrusted source_from origins
    // Treat them as `unsafe`-equivalent (safetyPrefix = "unsafe") so existing
    // VALUESTATE-003 and VALUESTATE-005 sink guards fire normally.
    if (sourceFromOrigin !== undefined && isUntrustedSourceFromOrigin(sourceFromOrigin)) {
      this.registerBinding({ name, safetyPrefix: "unsafe", typeName, ...locField });
    } else {
      this.registerBinding({ name, safetyPrefix: undefined, typeName, ...locField });
    }
  }

  private handleLetDecl(node: AstNode): void {
    const info = parseBindingValue(node.value ?? "");
    // Attach declaration location for Rust-style "declared here" diagnostics
    const locField = node.location !== undefined ? { declaredAt: node.location } : {};

    // Phase 11B.1: propagate taint — if the init expression references an
    // unsafe or tainted binding (via a non-gate call), the new binding is tainted.
    // Phase 11B.2: user-defined gate functions also break the taint chain.
    const init = node.children?.[0];
    const taintField: { tainted?: boolean; taintSource?: string } = {};
    if (init !== undefined && info.safetyPrefix !== "unsafe") {
      // unsafe bindings already have safetyPrefix tracking; we only need taint
      // propagation for plain let bindings derived from unsafe/tainted ones.
      if (isTaintedExpression(init, (name) => this.lookupBinding(name), this.userGates)) {
        const sourceName = findTaintSourceName(init, (name) => this.lookupBinding(name));
        taintField.tainted = true;
        if (sourceName !== undefined) taintField.taintSource = sourceName;
      }
    }

    // LLN-VALUESTATE-006: protected value assigned to plain binding
    // LLN-VALUESTATE-007: redacted value assigned to plain binding
    // Only fire when:
    //   1. The binding has an explicit type annotation (colonIdx present in value string)
    //   2. The declared type annotation is plain — no "protected" or "redacted" anywhere in the type
    const rawNodeValue = (node.value ?? "").trim();
    const colonIdx2 = rawNodeValue.indexOf(":");
    const hasExplicitType = colonIdx2 !== -1;
    // Extract the full type annotation section (after the colon)
    const typeAnnotationSection = hasExplicitType ? rawNodeValue.slice(colonIdx2 + 1).trim() : "";
    const hasGovernanceQualifier =
      typeAnnotationSection.includes("protected") || typeAnnotationSection.includes("redacted");
    if (hasExplicitType && !hasGovernanceQualifier && info.typeName !== "" && init !== undefined) {
      if (isProtectedValueExpression(init)) {
        this.diagnostics.push(makeVSDiag(
          "LLN-VALUESTATE-006",
          "ProtectedBoundaryViolation",
          `Cannot assign a 'protected' value to plain binding '${info.name}'. Declare the binding as 'protected ${info.typeName}', or pass the value through an authorised access gate.`,
          node.location,
          `Change the type annotation to: protected ${info.typeName}`,
          `protected ${info.typeName}`,
        ));
      } else if (isRedactCall(init)) {
        this.diagnostics.push(makeVSDiag(
          "LLN-VALUESTATE-007",
          "RedactedBoundaryViolation",
          `Cannot assign a 'redacted' value to plain binding '${info.name}'. Redaction is irreversible — a redacted value cannot be converted back to its original type.`,
          node.location,
          `Use the redacted value as-is with type 'redacted ${info.typeName}', or do not redact before this point.`,
        ));
      }
    }

    // Secret-source inference: a binding read from a `secrets {}` credential accessor
    // (secret.get / vault.read / kms.decrypt …) is a secret. Tag it as SecureString so the
    // existing LLN-SECRET-001/003 sink guards block it from logs/serialization/audit output.
    const secretField =
      init !== undefined &&
      info.typeName !== "SecureString" &&
      derivesFromSecret(init, (name) => this.lookupBinding(name))
        ? { typeName: "SecureString" }
        : {};
    // U2/#204: a binding that holds or derives a cleartext embedding (and isn't sealed)
    // carries SemanticVector confidentiality — propagates like taint/secret.
    const embeddingField =
      isEmbeddingTypeName(info.typeName) ||
      (init !== undefined && derivesFromEmbedding(init, (name) => this.lookupBinding(name)))
        ? { embeddingDerived: true }
        : {};
    this.registerBinding({ ...info, ...locField, ...taintField, ...secretField, ...embeddingField });
    // Walk the init expression
    if (init !== undefined) this.walkNode(init);
  }

  private handleMutDecl(node: AstNode): void {
    const info = parseBindingValue(node.value ?? "");
    const init = node.children?.[0];

    // Rule 2: safe mut upgrade must use a recognised gate
    if (info.safetyPrefix === "safe" && init !== undefined) {
      if (!this.isGateExpression(init)) {
        this.diagnostics.push(makeVSDiag(
          "LLN-VALUESTATE-001",
          "UnsafeToSafeTransitionDenied",
          `'safe mut ${info.name}' requires a recognised gate function on the right-hand side (validate.*, sanitize.*, json.decode<T>, parse.*).`,
          node.location,
          `Use: safe mut ${info.name} = validate.${info.name}(${info.name})?`,
          `safe mut ${info.name} = validate.${info.name}(${info.name})?`,
        ));
      }
    }

    // Overwrite the previous unsafe registration with the new (possibly safe) one.
    // Phase 11B.1: propagate taint unless a gate clears it.
    // Phase 11B.2: user-defined gate functions also break the taint chain.
    const mutLocField = node.location !== undefined ? { declaredAt: node.location } : {};
    const mutTaintField: { tainted?: boolean; taintSource?: string } = {};
    if (init !== undefined && info.safetyPrefix !== "safe" && info.safetyPrefix !== "unsafe") {
      if (isTaintedExpression(init, (name) => this.lookupBinding(name), this.userGates)) {
        const sourceName = findTaintSourceName(init, (name) => this.lookupBinding(name));
        mutTaintField.tainted = true;
        if (sourceName !== undefined) mutTaintField.taintSource = sourceName;
      }
    }
    // When safetyPrefix is "safe" and a gate is used, taint is intentionally cleared
    // (the gate call gates are already excluded by isTaintedExpression).
    // Secret-origin propagates through a mut reassignment too (a derived secret stays
    // SecureString unless re-bound to a non-secret), closing the mut laundering path.
    const mutSecretField =
      init !== undefined &&
      info.typeName !== "SecureString" &&
      derivesFromSecret(init, (name) => this.lookupBinding(name))
        ? { typeName: "SecureString" }
        : {};
    const mutEmbeddingField =
      isEmbeddingTypeName(info.typeName) ||
      (init !== undefined && derivesFromEmbedding(init, (name) => this.lookupBinding(name)))
        ? { embeddingDerived: true }
        : {};
    this.registerBinding({ ...info, ...mutLocField, ...mutTaintField, ...mutSecretField, ...mutEmbeddingField });

    if (init !== undefined) this.walkNode(init);
  }

  /**
   * Bare reassignment `name = rhs` (no binding keyword). Without this, `walkNode` fell
   * to `default` and never re-evaluated the target's value-state — so `mut s = "x";
   * s = secret.get("k"); http.post(u, s)` laundered the secret (and likewise embeddings
   * and ordinary taint). Recompute the target's flags from the RHS (mirrors handleMutDecl):
   * a dirty RHS taints/marks the target; a clean RHS — including a redact()/seal()
   * discharge — clears it. The update lands in the binding's declaring scope.
   */
  private handleAssignStmt(node: AstNode): void {
    const target = node.value ?? "";
    const rhs = node.children?.[0];
    if (target !== "" && rhs !== undefined && this.lookupBinding(target) !== undefined) {
      const lookup = (n: string) => this.lookupBinding(n);
      const existing = this.lookupBinding(target)!;
      const isSecret = derivesFromSecret(rhs, lookup);
      const isEmbedding = derivesFromEmbedding(rhs, lookup);
      const isTainted = isTaintedExpression(rhs, lookup, this.userGates);
      const taintSrc = isTainted ? findTaintSourceName(rhs, lookup) : undefined;
      const patch: Partial<BindingInfo> = {
        tainted: isTainted,
        embeddingDerived: isEmbedding,
        // Recompute the secret marker: a secret RHS marks SecureString; a clean RHS
        // (incl. redact()) clears it without clobbering a real declared type.
        typeName: isSecret
          ? "SecureString"
          : existing.typeName === "SecureString" ? "" : existing.typeName,
        ...(taintSrc !== undefined ? { taintSource: taintSrc } : {}),
      };
      this.updateBinding(target, patch);
    }
    // Walk the RHS so a sink call on its right-hand side is still checked.
    this.walkChildren(node);
  }

  // ── Gate recognition ─────────────────────────────────────────────────────

  private isGateExpression(node: AstNode): boolean {
    // Accept `gate(args)?` — errorPropagation wrapping a callExpr
    if (node.kind === "errorPropagation") {
      const inner = node.children?.[0];
      return inner !== undefined && this.isGateExpression(inner);
    }
    // Accept `gate(args)` — callExpr with a recognised gate name
    // Phase 11B.2: also check user-defined gates.
    // Also check the unqualified method name (node.value) because buildFullCallName
    // may treat the first argument as the receiver for standalone calls like
    // validateEmail(rawEmail) → "rawEmail.validateEmail" instead of "validateEmail".
    if (node.kind === "callExpr") {
      const methodNameOnly = node.value ?? "";
      return (
        isGateCallName(buildFullCallName(node), this.userGates) ||
        isGateCallName(methodNameOnly, this.userGates)
      );
    }
    return false;
  }

  // ── Trap declaration ──────────────────────────────────────────────────────
  // VSC-002 (owner decision A, 2026-06-16): a `trap` is NOT a declassifier. The previous
  // handler cleared taint on any binding merely *referenced* in a trap condition — but a bare
  // mention (or a non-constraining guard like `trap x.length < 3 : ERR`) validates nothing for
  // injection sinks, so it laundered unsafe/tainted values. Declassification now requires an
  // explicit validate.* / sanitize.* / redact() gate. `trap` remains a runtime guard/invariant
  // (parser + governance + WAT), but carries no value-state effect (trapDecl dispatch is a no-op).

  // ── Call expression rules ────────────────────────────────────────────────

  private handleCallExpr(node: AstNode): void {
    const sinkName = buildFullCallName(node);
    const isAuditLog = sinkName === "AuditLog.write";

    // Rule 1/3: governed sink — check all argument children for unsafe bindings.
    // Task 4: distinguish protected-without-redact at AuditLog (VALUESTATE-006)
    // from plain unsafe-at-sink (VALUESTATE-003).
    if (isGovernedSink(node)) {
      for (const child of node.children ?? []) {
        if (isAuditLog) {
          // For AuditLog.write, check for protected values without redact first.
          this.checkArgForProtectedAtAuditLog(child, sinkName, node.location);
        }
        // Then check for unsafe bindings (VALUESTATE-003) — but not for
        // protected values at AuditLog, which already get VALUESTATE-006.
        this.checkArgForUnsafeBinding(child, sinkName, node.location);
      }
    }

    // Rule 4 (log side): log call — check for SecureString arguments
    if (isLogCall(node)) {
      const callName = buildFullCallName(node);
      for (const child of node.children ?? []) {
        this.checkArgForSecretLogging(child, callName, node.location);
      }
    }

    // Rule 4 (serialization side): LLN-SECRET-003 — SecureString in json.encode / serialize
    if (isSerializationCall(node)) {
      const callName = buildFullCallName(node);
      for (const child of node.children ?? []) {
        this.checkArgForSecretSerialization(child, callName, node.location);
      }
    }

    // Task 3 extended: SECRET-003 for AuditLog.write with SecureString fields
    if (isAuditLog) {
      for (const child of node.children ?? []) {
        this.checkArgForSecretSerialization(child, sinkName, node.location);
      }
    }

    // Secret → network egress: LLN-SECRET-002 — a raw secret transmitted off-host.
    if (isNetworkSink(node)) {
      const callName = buildFullCallName(node);
      for (const child of node.children ?? []) {
        this.checkArgForSecretNetwork(child, callName, node.location);
        this.checkArgForEmbeddingNetwork(child, callName, node.location);
      }
    }

    // Phase 4.3: Inter-flow taint — warn when a tainted argument is passed to a
    // user-defined flow. This is a call-site warning (LLN-VALUESTATE-004), NOT
    // full inter-procedural analysis. We do not follow into the callee body.
    const calleeName = node.value ?? "";
    if (this.userFlows.has(calleeName)) {
      // All children are arguments (no "method" style for user flow calls)
      const callArgs = node.children ?? [];
      for (const arg of callArgs) {
        if (isTaintedExpression(arg, (n) => this.lookupBinding(n), this.userGates)) {
          const taintName = findTaintSourceName(arg, (n) => this.lookupBinding(n))
            ?? (arg.kind === "identifier" ? (arg.value ?? "?") : "?");
          // Bool-typed bindings cannot carry injection payloads — exempt from VALUESTATE-004.
          // A Bool is structurally a single bit (true/false); it has no string-injection
          // surface even when derived from an unsafe boundary source.
          const argBinding =
            arg.kind === "identifier"
              ? this.lookupBinding(arg.value ?? "")
              : this.lookupBinding(taintName);
          if (
            argBinding !== undefined &&
            (argBinding.typeName === "Bool" || argBinding.typeName === "boolean")
          ) {
            continue;
          }
          this.diagnostics.push({
            code: "LLN-VALUESTATE-004",
            name: "TaintedValuePropagation",
            severity: "error",
            message: `Tainted value '${taintName}' passed to '${calleeName}'. Validate before passing to another flow.`,
            ...(node.location !== undefined ? { location: node.location } : {}),
            suggestedFix: `Validate '${taintName}' before the call: let safe${taintName.charAt(0).toUpperCase() + taintName.slice(1)} = validate.${taintName}(${taintName})?`,
            suggestedCode: `validate.${taintName}(${taintName})?`,
            why: `'${taintName}' is tainted — it came from an untrusted boundary source and has not been validated.`,
            risk: `Passing unvalidated input to '${calleeName}' can propagate taint across flow boundaries.`,
          });
          break; // One diagnostic per call site is enough
        }
      }
      // Inter-flow secret / embedding propagation (intra-procedural checker can't follow
      // into the callee body, so a sealed/redacted handoff can't be proven here). Surface
      // it as a WARNING — fail-loud without breaking legitimate secret-helper patterns.
      for (const arg of callArgs) {
        const lookup = (n: string) => this.lookupBinding(n);
        if (derivesFromSecret(arg, lookup)) {
          this.diagnostics.push({
            code: "LLN-SECRET-002",
            name: "SecretCrossesFlowBoundary",
            severity: "warning",
            message: `A secret value is passed to flow '${calleeName}', which may transmit it off-host. The checker does not follow into the callee — seal/redact it or confirm '${calleeName}' keeps it within a trusted boundary.`,
            ...(node.location !== undefined ? { location: node.location } : {}),
            suggestedFix: `Pass redact(...) instead, or audit '${calleeName}' for egress.`,
            why: `Cross-flow propagation is not inter-procedurally verified; a secret crossing a flow boundary unsealed is a potential exfiltration path.`,
            risk: `If '${calleeName}' egresses the value, the credential leaks.`,
          });
          break;
        }
      }
      for (const arg of callArgs) {
        const lookup = (n: string) => this.lookupBinding(n);
        if (derivesFromEmbedding(arg, lookup)) {
          this.diagnostics.push({
            code: "LLN-PRIVACY-002",
            name: "EmbeddingCrossesFlowBoundary",
            severity: "warning",
            message: `A cleartext semantic embedding is passed to flow '${calleeName}', which may egress it. The checker does not follow into the callee — seal() it or confirm '${calleeName}' keeps it within a trusted boundary.`,
            ...(node.location !== undefined ? { location: node.location } : {}),
            suggestedFix: `Pass seal(...) instead, or audit '${calleeName}' for egress.`,
            why: `Cross-flow propagation is not inter-procedurally verified; a cleartext (vec2text-invertible) embedding crossing a flow boundary is a potential leak.`,
            risk: `If '${calleeName}' egresses the vector, the source content is recoverable.`,
          });
          break;
        }
      }
    }
  }

  /**
   * LLN-SECRET-002: a SecureString (incl. a value read from a `secrets {}` credential)
   * must not be transmitted to a network/egress sink — that is an exfiltration path.
   * `redact()` / sealing breaks the chain. Mirrors checkArgForSecretLogging.
   */
  private checkArgForSecretNetwork(
    node: AstNode,
    callName: string,
    location: SourceLocation | undefined,
  ): void {
    if (node.kind === "callExpr" && isRedactCall(node)) return;
    if (node.kind === "identifier") {
      const binding = this.lookupBinding(node.value ?? "");
      if (binding?.typeName === "SecureString") {
        this.diagnostics.push(makeVSDiag(
          "LLN-SECRET-002",
          "SecretSentToNetwork",
          `SecureString binding '${binding.name}' must not be transmitted to network sink '${callName}'.`,
          location,
          `Send a sealed/redacted form instead, e.g. redact(${binding.name}), or use a capability-scoped secret channel.`,
          `redact(${binding.name})`,
          {
            why: `'${binding.name}' is a secret — transmitting its raw value off-host is an exfiltration path.`,
            risk: `Sending credentials/keys/tokens to a network egress in plaintext leaks them to anyone observing the channel or endpoint.`,
          },
        ));
      }
      return;
    }
    for (const child of node.children ?? []) {
      this.checkArgForSecretNetwork(child, callName, location);
    }
  }

  /**
   * LLN-PRIVACY-002 (U2/#204): a cleartext semantic embedding (an Embedding/EmbeddingResult
   * value, or anything derived from EmbeddingModel.run/.embed) must not be transmitted to a
   * network/egress sink — an embedding is invertible (vec2text), so sending it cleartext leaks
   * the source text across the trust boundary. seal()/encrypt() breaks the chain. Filtering on
   * the vector must happen at a trusted endpoint AFTER decryption (composes with the pattern-10
   * verify-before-decrypt gate). Mirrors checkArgForSecretNetwork.
   */
  private checkArgForEmbeddingNetwork(
    node: AstNode,
    callName: string,
    location: SourceLocation | undefined,
  ): void {
    if (isSealCall(node)) return; // a sealed/encrypted vector may cross — the cleartext may not
    if (node.kind === "identifier") {
      const binding = this.lookupBinding(node.value ?? "");
      if (binding?.embeddingDerived === true) {
        this.diagnostics.push(makeVSDiag(
          "LLN-PRIVACY-002",
          "EmbeddingEgressDenied",
          `Cleartext semantic embedding '${binding.name}' must not be transmitted to network sink '${callName}'.`,
          location,
          `Seal the vector before egress, e.g. seal(${binding.name}), and filter only at a trusted endpoint after decryption.`,
          `seal(${binding.name})`,
          {
            why: `'${binding.name}' is a semantic embedding — embedding-inversion (vec2text) reconstructs the source text from a cleartext vector, so egressing it is equivalent to leaking the text.`,
            risk: `A router/intermediary that receives a cleartext embedding can recover the original content; only an encrypted vector may cross an untrusted boundary.`,
          },
        ));
      }
      return;
    }
    // Inline embedding source passed straight to the sink, e.g. http.post(u, EmbeddingModel.run(x)).
    if (isEmbeddingSourceExpression(node)) {
      this.diagnostics.push(makeVSDiag(
        "LLN-PRIVACY-002",
        "EmbeddingEgressDenied",
        `A cleartext semantic embedding must not be transmitted to network sink '${callName}'.`,
        location,
        `Bind and seal the vector before egress: let v = seal(<embedding>), and filter only at a trusted endpoint after decryption.`,
        undefined,
        {
          why: `An embedding produced inline is still cleartext — embedding-inversion (vec2text) reconstructs the source text from it.`,
          risk: `Sending a cleartext embedding to a network egress leaks the source content to anyone observing the channel or endpoint.`,
        },
      ));
      return;
    }
    for (const child of node.children ?? []) {
      this.checkArgForEmbeddingNetwork(child, callName, location);
    }
  }

  /**
   * Recursively checks whether `node` or any of its descendants is an
   * identifier that resolves to an `unsafe` binding (LLN-VALUESTATE-003) or
   * a tainted-but-not-directly-unsafe binding (LLN-VALUESTATE-005).
   */
  private checkArgForUnsafeBinding(
    node: AstNode,
    sinkName: string,
    location: SourceLocation | undefined,
  ): void {
    if (node.kind === "identifier") {
      const binding = this.lookupBinding(node.value ?? "");
      if (binding?.safetyPrefix === "unsafe") {
        // Rust-style: show where the unsafe binding was declared AND where it reaches the sink
        const related: DiagnosticRelatedLocation[] = [];
        if (binding.declaredAt !== undefined) {
          related.push({
            message: `'${binding.name}' declared as unsafe here`,
            location: binding.declaredAt,
          });
        }
        this.diagnostics.push(makeVSDiag(
          "LLN-VALUESTATE-003",
          "UnsafeValueReachedGovernedSink",
          `Unsafe binding '${binding.name}' cannot flow into governed sink '${sinkName}'.`,
          location,
          `Add before the sink call: safe mut ${binding.name} = validate.${binding.name}(${binding.name})?`,
          `safe mut ${binding.name} = validate.${binding.name}(${binding.name})?`,
          {
            ...(related.length > 0 ? { relatedLocations: related } : {}),
            why: `'${binding.name}' was declared with 'unsafe let', meaning its value comes from an untrusted boundary source and has not been validated.`,
            risk: `Sending unvalidated boundary data to '${sinkName}' can cause injection attacks, data corruption, or governance violations.`,
          },
        ));
      } else if (binding?.tainted === true) {
        // Phase 11B.1 — LLN-VALUESTATE-005: derived unsafe value at sink
        const sourceName = binding.taintSource ?? binding.name;
        const related: DiagnosticRelatedLocation[] = [];
        if (binding.declaredAt !== undefined) {
          related.push({
            message: `'${binding.name}' derived from unsafe binding '${sourceName}' here`,
            location: binding.declaredAt,
          });
        }
        this.diagnostics.push(makeVSDiag(
          "LLN-VALUESTATE-005",
          "DerivedUnsafeValueAtSink",
          `Binding '${binding.name}' is derived from unsafe binding '${sourceName}' and cannot flow into governed sink '${sinkName}'. Even after transformation (e.g. .trim()), a value derived from unsafe input is still tainted.`,
          location,
          `Use a validation gate before the sink: let safe${binding.name.charAt(0).toUpperCase() + binding.name.slice(1)} = validate.${sourceName}(${sourceName})?`,
          `validate.${sourceName}(${sourceName})?`,
          {
            ...(related.length > 0 ? { relatedLocations: related } : {}),
            why: `'${binding.name}' was derived from '${sourceName}', which was declared with 'unsafe let'. String methods like .trim() and .toLower() do not remove taint.`,
            risk: `Sending a transformed-but-tainted value to '${sinkName}' can cause injection attacks. Taint can only be removed by a validate.* or sanitize.* gate.`,
          },
        ));
      }
    }
    // Recurse into nested children (e.g. named-argument wrappers, blocks)
    for (const child of node.children ?? []) {
      this.checkArgForUnsafeBinding(child, sinkName, location);
    }
  }

  /**
   * Recursively checks whether `node` or any of its descendants is an
   * identifier that resolves to a `SecureString` binding.
   */
  private checkArgForSecretLogging(
    node: AstNode,
    callName: string,
    location: SourceLocation | undefined,
  ): void {
    // A redact(...) wrapper produces a safe '[REDACTED]' placeholder — honor it at log
    // sinks just as checkArgForSecretSerialization does (do not recurse into its child).
    if (node.kind === "callExpr" && isRedactCall(node)) return;
    if (node.kind === "identifier") {
      const binding = this.lookupBinding(node.value ?? "");
      if (binding?.typeName === "SecureString") {
        const related: DiagnosticRelatedLocation[] = [];
        if (binding.declaredAt !== undefined) {
          related.push({
            message: `'${binding.name}' declared as SecureString here`,
            location: binding.declaredAt,
          });
        }
        this.diagnostics.push(makeVSDiag(
          "LLN-SECRET-001",
          "SecretValueLogged",
          `SecureString binding '${binding.name}' must not be passed to '${callName}'.`,
          location,
          `Replace with: log.info("...", { key: redact(${binding.name}) })`,
          `redact(${binding.name})`,
          {
            ...(related.length > 0 ? { relatedLocations: related } : {}),
            why: `'${binding.name}' is a SecureString — its raw value must never appear in logs, audit output, or error messages.`,
            risk: `Logging a secret exposes credentials, tokens, or keys in plaintext. Use redact() to produce a safe '[REDACTED]' placeholder.`,
          },
        ));
      }
    }
    for (const child of node.children ?? []) {
      this.checkArgForSecretLogging(child, callName, location);
    }
  }

  /**
   * LLN-SECRET-003: SecureString must not be passed to serialization functions.
   * Serializing a secret value would expose it in the output stream.
   * Extended (Task 3): also fires for SecureString in AuditLog.write and
   * SecureString field values in record literals passed to governed sinks.
   */
  private checkArgForSecretSerialization(
    node: AstNode,
    callName: string,
    location: SourceLocation | undefined,
  ): void {
    // A redact() call wrapping the value is safe — do not recurse into it.
    if (node.kind === "callExpr" && isRedactCall(node)) return;

    if (node.kind === "identifier") {
      const binding = this.lookupBinding(node.value ?? "");
      if (binding?.typeName === "SecureString") {
        this.diagnostics.push(makeVSDiag(
          "LLN-SECRET-003",
          "SecretSerializationDenied",
          `SecureString binding '${binding.name}' must not be passed to '${callName}'. Secrets must not appear in serialized or audit output.`,
          location,
          `Use redact(${binding.name}) to produce a safe placeholder before passing to '${callName}'.`,
          `redact(${binding.name})`,
        ));
      }
      return;
    }
    // Task 3: check record literals — fire SECRET-003 for any SecureString field value
    // Record literals appear as children of call arguments in some AST shapes.
    for (const child of node.children ?? []) {
      this.checkArgForSecretSerialization(child, callName, location);
    }
  }

  /**
   * Task 4: LLN-VALUESTATE-006 (distinct from VALUESTATE-003) — fires when a
   * protected value (e.g. protected Email) is passed to AuditLog.write without
   * going through redact(). This is more specific than VALUESTATE-003 (unsafe-at-sink).
   *
   * A value is considered "protected" if:
   *   - Its type annotation contains "protected" (e.g. protected Email, protected String)
   *
   * Only fires for AuditLog.write, not other governed sinks.
   */
  private checkArgForProtectedAtAuditLog(
    node: AstNode,
    sinkName: string,
    location: SourceLocation | undefined,
  ): void {
    // A redact() call wrapping the value is the correct pattern — do not recurse into it.
    if (node.kind === "callExpr" && isRedactCall(node)) return;

    if (node.kind === "identifier") {
      const binding = this.lookupBinding(node.value ?? "");
      if (binding !== undefined) {
        // Check if this is a protected value (typeName is "protected" — the first token
        // of an annotation like "protected Email" when parsed via parseBindingValue).
        const isProtected = binding.typeName === "protected" ||
          binding.typeName.startsWith("protected ");
        if (isProtected) {
          this.diagnostics.push(makeVSDiag(
            "LLN-VALUESTATE-006",
            "ProtectedValueAtAuditLog",
            `Protected binding '${binding.name}' passed to '${sinkName}' without redaction. Protected values must be redacted before appearing in audit logs.`,
            location,
            `Wrap with redact: AuditLog.write({ ..., ${binding.name}: redact(${binding.name}) })`,
            `redact(${binding.name})`,
            {
              why: `'${binding.name}' is a protected value. Audit logs are often accessible to operators and must not contain raw protected data.`,
              risk: `Unredacted protected values in audit logs can leak sensitive data such as email addresses, user IDs, or PII.`,
            },
          ));
        }
      }
      return;
    }
    for (const child of node.children ?? []) {
      this.checkArgForProtectedAtAuditLog(child, sinkName, location);
    }
  }

  // ── Binary expression rules ──────────────────────────────────────────────

  private handleBinaryExpr(node: AstNode): void {
    // Rule 4 (equality side): SecureString == or != is forbidden
    if (node.value === "==" || node.value === "!=") {
      const left = node.children?.[0];
      const right = node.children?.[1];
      if (left !== undefined) this.checkSecureStringEquality(left, node.location);
      if (right !== undefined) this.checkSecureStringEquality(right, node.location);
    }

    // Phase 8B: String taint propagation — LLN-VALUESTATE-004
    // "SELECT " + rawInput produces a tainted string that must not reach sinks
    // Partial implementation: detect when string + contains an unsafe binding
    if (node.value === "+") {
      const left  = node.children?.[0];
      const right = node.children?.[1];
      if (left !== undefined && right !== undefined) {
        this.checkStringConcatTaint(left, right, node.location);
      }
    }
  }

  /**
   * Phase 8B: LLN-VALUESTATE-004 — String taint propagation.
   * If a string concatenation includes an unsafe binding, the result is tainted.
   * This is the SQL injection pattern: "SELECT " + rawInput.
   */
  private checkStringConcatTaint(
    left: AstNode,
    right: AstNode,
    location: SourceLocation | undefined,
  ): void {
    // Find any unsafe identifier in either operand
    const unsafeLeft  = this.findUnsafeIdentifier(left);
    const unsafeRight = this.findUnsafeIdentifier(right);
    const unsafeBinding = unsafeLeft ?? unsafeRight;

    if (unsafeBinding === undefined) return;

    const related: DiagnosticRelatedLocation[] = [];
    if (unsafeBinding.declaredAt !== undefined) {
      related.push({
        message: `'${unsafeBinding.name}' declared as unsafe here`,
        location: unsafeBinding.declaredAt,
      });
    }

    this.diagnostics.push(makeVSDiag(
      "LLN-VALUESTATE-004",
      "TaintedValuePropagation",
      `String concatenation includes unsafe binding '${unsafeBinding.name}'. The result is tainted and must not reach governed sinks.`,
      location,
      `Validate '${unsafeBinding.name}' before concatenation: let safe = validate.${unsafeBinding.name}(${unsafeBinding.name})?`,
      `validate.${unsafeBinding.name}(${unsafeBinding.name})?`,
      {
        ...(related.length > 0 ? { relatedLocations: related } : {}),
        why: `'${unsafeBinding.name}' is unsafe — it came from an untrusted boundary and has not been validated.`,
        risk: `Concatenating unsafe input into strings sent to databases, shells, or HTML produces injection vulnerabilities.`,
      },
    ));
  }

  /**
   * Recursively finds the first unsafe binding identifier in an expression tree.
   */
  private findUnsafeIdentifier(node: AstNode): BindingInfo | undefined {
    if (node.kind === "identifier") {
      const binding = this.lookupBinding(node.value ?? "");
      if (binding?.safetyPrefix === "unsafe") return binding;
    }
    for (const child of node.children ?? []) {
      const found = this.findUnsafeIdentifier(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  private checkSecureStringEquality(
    node: AstNode,
    location: SourceLocation | undefined,
  ): void {
    if (node.kind === "identifier") {
      const binding = this.lookupBinding(node.value ?? "");
      if (binding?.typeName === "SecureString") {
        this.diagnostics.push(makeVSDiag(
          "LLN-SECRET-002",
          "SecretComparisonDenied",
          `SecureString binding '${binding.name}' must not be compared with == / !=. Use constantTimeEquals(${binding.name}, other) instead.`,
          location,
          `Replace with: let valid: Bool = constantTimeEquals(${binding.name}, other)`,
          `constantTimeEquals(${binding.name}, other)`,
        ));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Runs the value-state checker on a parsed LogicN AST.
 *
 * Call this after `parseProgram()`. The checker enforces:
 *   - `unsafe let` bindings cannot reach governed sinks without a gate upgrade
 *   - `safe mut` upgrades must use a recognised gate function
 *   - `SecureString` bindings must not appear in log calls or equality comparisons
 *
 * Phase 11B.2: user-defined gate functions are collected from fnDecl nodes
 * before checking. Functions whose names start with validate*, sanitize*,
 * check*, verify*, parse*, or decode* automatically break the taint chain.
 *
 * @param ast  The root `program` node from `parseProgram()`.
 * @returns    A result object containing all value-state diagnostics.
 */
export function checkValueStates(ast: AstNode): ValueStateCheckResult {
  // Phase 11B.2: collect user-defined gate functions before running the checker
  const userGates = collectUserGates(ast);
  // Phase 4.3: collect user-defined flow names for inter-flow call-site warnings
  const userFlows = collectUserFlows(ast);
  const checker = new ValueStateChecker(userGates, userFlows);
  checker.check(ast);
  return checker.getResult();
}

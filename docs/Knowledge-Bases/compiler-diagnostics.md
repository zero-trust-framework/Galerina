# Compiler Diagnostics

## Definition

LogicN compiler and runtime diagnostics are machine-readable and human-readable.
Every warning, error, and fatal diagnostic has a structured code, source location,
problem description, and suggested fix. Diagnostics are designed for both human
developers and AI tooling.

## Diagnostic Format

Every diagnostic includes:

```json
{
  "code": "LNN-ERR-TYPE-001",
  "severity": "error",
  "file": "src/orders.lln",
  "line": 14,
  "column": 22,
  "expected": "Int",
  "actual": "String",
  "problem": "Cannot add String and Int.",
  "suggestedFix": "Use toInt() to convert the String explicitly.",
  "safeExample": "let total: Int = toInt(raw_count) + 5"
}
```

Diagnostics must not include:

```text
raw secrets
real tokens
private keys
full .env contents
production data
```

## Severity Levels

```text
WARN  — non-fatal, execution can continue
ERR   — recoverable error, compilation or execution blocked
FATAL — unrecoverable, runtime must halt
```

## Code Ranges

| Range | Category |
| --- | --- |
| `LNN-WARN-MEM-*` | Memory warnings |
| `LNN-ERR-MEM-*` | Recoverable memory errors |
| `LNN-FATAL-MEM-*` | Unrecoverable memory errors |
| `LNN-WARN-DISK-*` | Disk warnings |
| `LNN-ERR-DISK-*` | Disk errors |
| `LNN-FATAL-DISK-*` | Unrecoverable disk errors |
| `LNN-WARN-CACHE-*` | Cache warnings |
| `LNN-ERR-CACHE-*` | Cache errors |
| `LNN-WARN-LOGIC-*` | Logic-width warnings |
| `LNN-ERR-LOGIC-*` | Logic-width errors |
| `LNN-WARN-TARGET-*` | Target support warnings |
| `LNN-ERR-TARGET-*` | Target support errors |
| `LNN-ERR-TYPE-*` | Type errors |
| `LNN-ERR-NULL-*` | Null / None errors |
| `LNN-WARN-BUILD-*` | Build warnings |
| `LNN-ERR-SEC-*` | Security errors |
| `LNN-WARN-SEC-*` | Security warnings |
| `LNN-WARN-API-*` | API warnings |
| `LNN-SEC-*` | Security rule violations (compiler) |
| `LNN-MEM-*` | Memory model violations (compiler) |
| `LNN-STYLE-*` | Code style violations (compiler) |
| `LNN-TRUST-*` | Trust/signing violations (runtime) |
| `LNN-AI-*` | AI-generated code risk (runtime) |

## Core Compiler Codes

### Type Errors

```text
LNN-ERR-TYPE-001: Type mismatch — expected X, got Y
LNN-ERR-TYPE-002: Field X is not a member of type Y
LNN-ERR-TYPE-003: Non-exhaustive match — missing enum case: X
LNN-ERR-NULL-001: Null is not a valid value — use Option<T>
LNN-ERR-NULL-002: None used where a value is required — unwrap or handle None
```

### Security Errors

```text
LNN-SEC-014: fn declarations cannot request runtime authority.
             Move this operation into a flow or pass the required value as an argument.
LNN-SEC-041: Cannot use unsafe value in expression.
             Validate first: validate.X(value) -> safe X
```

### Memory Errors

```text
LNN-MEM-021: Use after release — variable was released on line N.
LNN-MEM-022: Release of borrowed value — can only release owned local values.
```

### Style Warnings

```text
LNN-STYLE-012: Nesting depth exceeds 2. Consider extracting to a named fn or flow.
```

### Trust Errors (runtime)

```text
LNN-TRUST-041: Local self-signed artifact cannot run in production profile.
               Use CI/OIDC, trusted registry, or organisation signing.
```

### AI Risk Codes

```text
LNN-AI-PRIV-001: AI-generated high-risk flow requires production approval.
```

## Implemented Prototype Codes

These codes are emitted by the current Node.js prototype:

```text
LNN-ERR-TARGET-002   — target not available
LNN-WARN-TARGET-003  — accelerator fallback to CPU
LNN-WARN-LOGIC-001   — logic width simulation
LNN-ERR-LOGIC-001    — unsupported logic width
LNN-WARN-DISK-003    — disk space warning
LNN-ERR-DISK-001     — disk write failure
LNN-WARN-MEM-002     — memory limit approaching
LNN-WARN-MEM-005     — cache memory warning
LNN-ERR-MEM-006      — memory integrity check failed
LNN-ERR-TYPE-001     — type mismatch
LNN-ERR-TYPE-002     — unknown field
LNN-ERR-TYPE-003     — non-exhaustive match
LNN-ERR-NULL-001     — null not allowed
LNN-ERR-NULL-002     — unexpected None
LNN-WARN-BUILD-002   — build warning
LNN-ERR-SEC-001      — security policy violation
LNN-WARN-SEC-002     — security warning
LNN-WARN-API-001     — API configuration warning
```

## Source Mapping

Diagnostics map to original `.lln` source files even when compiled output runs:

```text
Type error:
Cannot add String and Int.

Original source:
  src/orders.lln:14:22

Suggestion:
  Convert the String explicitly using toInt().
```

## Report Files

The build system generates:

```text
app.security-report.json  — security settings, permissions, unsafe usage
app.build-manifest.json   — source hash, output hash, dependency hashes, timestamp
app.failure-report.json   — error type, source location, target, suggested fix
```

The build manifest includes:

```text
source hash
output hash
dependency hashes
compiler version
build mode
target outputs
created timestamp
```

## CI Rules

CI should fail if:

```text
unsafe code introduced without explicit profile allowance
secret logging detected
webhooks lack verification
API routes lack timeouts
JSON policies missing
dependencies request risky permissions
target fallback is unsafe
```

## Core Principle

```text
Every diagnostic is structured, source-mapped, and actionable.
Diagnostics never expose secrets.
Both humans and AI tools can act on diagnostics.
```

---

## LLN-Series Diagnostic Codes

All Phase 4+ diagnostics use the `LLN-CATEGORY-NNN` format. These replace and extend the
older `LNN-*` codes as the compiler matures.

| LLN Series | Purpose |
|---|---|
| `LLN-PARSE-*` | Parser: unexpected tokens, malformed syntax |
| `LLN-AST-*` | AST schema validation |
| `LLN-INTENT-GRAPH-*` | Intent graph structural errors |
| `LLN-TYPE-*` | Core type checker (Phase 5) |
| `LLN-NAME-*` | Name resolution (Phase 5) |
| `LLN-MATCH-*` | Match exhaustiveness (Phase 5) |
| `LLN-EFFECT-*` | Effect checker |
| `LLN-SEC-*` | Security and authority rule violations |
| `LLN-INTENT-*` | Intent declaration errors |
| `LLN-PIPELINE-*` | Pipeline chain type errors |
| `LLN-BINDING-*` | Binding mutability |
| `LLN-MEMORY-*` | Memory model |
| `LLN-SAFETY-*` | Safety rule violations |
| `LLN-SYNTAX-*` | Syntax rule violations |
| `LLN-RAWPTR-*` | Raw pointer ban |
| `LLN-FUSE-*` | Pipeline fusion optimisation reports |
| `LLN-GRAPH-*` | lln-graph library (graph structure) |
| `LLN-GOV-3VL-*` | Three-valued governance verdict collapse (runtime, fail-closed) |
| `LLN-SUBSTRATE-*` | Substrate failure-mode guarantees vs a seeded noise model (Direction C, fail-closed) |
| `LLN-RUNTIME-*` | Runtime enforcement |

### Parser (Phase 4)

```text
LLN-PARSE-001   Unexpected token
LLN-PARSE-002   Expected declaration keyword
LLN-PARSE-003   Unterminated string literal
LLN-PARSE-004   Invalid numeric literal
LLN-PARSE-005   Unclosed block or bracket
LLN-PARSE-006   Missing return type annotation
LLN-PARSE-007   Duplicate declaration in same scope
LLN-PARSE-008   Invalid escape sequence
LLN-PARSE-009   Reserved keyword used as identifier
LLN-PARSE-010   Placement hint on non-flow/non-alloc context
LLN-PARSE-011   Ownership expression outside allowed context
LLN-PARSE-012   GPU stream used in non-compute context
LLN-PARSE-013   Atomic operation on non-atomic memory region (parse-level)
LLN-PARSE-014   Quantized type used outside neural/AI context
```

### Published AST Schema

```text
LLN-AST-001     AST schema version not recognized
LLN-AST-002     Node kind missing required span
LLN-AST-003     Invalid discriminant in union node
LLN-AST-004     Schema export contains unresolved reference
LLN-AST-005     AST truncated at syntax error boundary
LLN-AST-006     --resolved mode requires prior --syntax-only pass
```

### Intent Graph

```text
LLN-INTENT-GRAPH-001   Intent graph node references unknown flow
LLN-INTENT-GRAPH-002   Intent graph edge has unknown source node
LLN-INTENT-GRAPH-003   Transitive edge conflicts with declared edge
LLN-INTENT-GRAPH-004   Privacy redaction removed required node
LLN-INTENT-GRAPH-005   Intent graph schema version mismatch
LLN-INTENT-GRAPH-006   Source map entry refers to unknown file
```

### Effect Checker

```text
LLN-EFFECT-001   Undeclared effect used inside flow
LLN-EFFECT-002   Effect propagation: transitive effect not declared
LLN-EFFECT-003   Effect boundary violation
LLN-EFFECT-004   Forbidden effect inside compute-restricted flow
```

### Security and Authority

```text
LLN-SEC-014      FN_AUTHORITY_OR_EFFECTS_DENIED  fn declarations cannot request
                 runtime authority, declare effects, or spawn governed work
```

### Capability Checker

```text
LLN-TARGET-CAP-001   Effect forbidden inside GPU-targeted flow
LLN-TARGET-CAP-002   Deterministic flow cannot use nondeterministic effect
```

### Capability Imports

```text
LLN-CAPABILITY-IMPORT-001   Import introduces undeclared capability
LLN-CAPABILITY-IMPORT-002   Import introduces network effect not declared in project
LLN-CAPABILITY-IMPORT-003   Import introduces secret access
LLN-CAPABILITY-IMPORT-004   Transitive dependency widens authority
LLN-CAPABILITY-IMPORT-005   Package manifest missing export-level capability declarations
LLN-CAPABILITY-IMPORT-006   Package capability changed since last review
LLN-CAPABILITY-IMPORT-007   Calling flow does not inherit required capabilities
```

### Memory Safety (canonical series: LLN-MEMORY-*)

The `LLN-MEMORY-*` series is canonical. The former `LLN-OWN-*` series is
retired — see `logicn-memory-borrow-move-pinned.md` for the mapping.

```text
LLN-MEMORY-001   USE_AFTER_MOVE              Moved value used after ownership transferred
LLN-MEMORY-002   BORROW_AFTER_MOVE           Cannot borrow a value after ownership has moved
LLN-MEMORY-003   BORROW_ESCAPES_SCOPE        Borrowed reference cannot outlive its owner
LLN-MEMORY-004   READONLY_MUTATION           Cannot mutate a value through a readonly reference
LLN-MEMORY-005   MUTABLE_ALIAS               Mutable borrow cannot coexist with another active borrow
LLN-MEMORY-006   BOUNDS_VIOLATION            Index may be outside collection bounds
LLN-MEMORY-007   UNCHECKED_ACCESS_OUTSIDE_UNSAFE  Unchecked access outside approved unsafe block
LLN-MEMORY-008   UNSAFE_MEMORY_REQUIRES_FALLBACK  Unsafe memory op must declare a safe fallback
```

### Safety (canonical series: LLN-SAFETY-*)

Replaces the deprecated `LogicN_COMPILER_*` codes from the Stage 1 scanner.
All new safety-checker diagnostics must use this series. `LogicN_COMPILER_*`
codes are frozen — do not extend them.

```text
LLN-SAFETY-001   TRI_BRANCH_CONDITION        Tri used directly as a branch condition
LLN-SAFETY-002   UNSAFE_LOGIC_ASSIGNMENT     Implicit conversion between Tri/Bool/Decision
LLN-SAFETY-003   TRI_UNKNOWN_AS_TRUE         Tri unknown mapped to true without policy
LLN-SAFETY-004   SECRET_LITERAL              Raw secret literal detected in source
LLN-SAFETY-005   UNSAFE_DYNAMIC_CODE         eval/Function/unsafe_exec in LogicN source
LLN-SAFETY-006   TRI_MATCH_NOT_EXHAUSTIVE    Tri match missing one or more cases
```

#### Deprecated — Stage 1 Legacy (LogicN_COMPILER_*)

These codes are emitted by the Stage 1 `validateCoreSyntaxSafety` scanner and
are frozen for compatibility. They must not be extended. All new diagnostics
must use `LLN-SAFETY-*` or another canonical `LLN-SERIES-NNN` family.

```text
LogicN_COMPILER_TRI_BRANCH_CONDITION       → LLN-SAFETY-001 (canonical)
LogicN_COMPILER_UNSAFE_LOGIC_ASSIGNMENT   → LLN-SAFETY-002 (canonical)
LogicN_COMPILER_TRI_UNKNOWN_AS_TRUE        → LLN-SAFETY-003 (canonical)
LogicN_COMPILER_SECRET_LITERAL             → LLN-SAFETY-004 (canonical)
LogicN_COMPILER_UNSAFE_DYNAMIC_CODE        → LLN-SAFETY-005 (canonical)
LogicN_COMPILER_TRI_MATCH_NOT_EXHAUSTIVE   → LLN-SAFETY-006 (canonical)
```

### Syntax (canonical series: LLN-SYNTAX-*)

```text
LLN-SYNTAX-001   VAR_NOT_SUPPORTED           var is not a valid LogicN keyword
LLN-SYNTAX-002   CONST_NOT_SUPPORTED         const is not a valid LogicN keyword
LLN-SYNTAX-003   FUTURE_RESERVED_KEYWORD     Future-reserved keyword used as identifier
LLN-SYNTAX-004   ACTIVE_KEYWORD_AS_IDENT     Active keyword used as identifier
LLN-SYNTAX-005   TOP_LEVEL_FN_DENIED         fn may only appear inside a flow body
LLN-SYNTAX-006   INVALID_BINDING_PREFIX      Unrecognised binding prefix (not let/mut/unsafe let/safe mut)
LLN-SYNTAX-007   MISSING_RETURN_TYPE         Flow or fn declaration is missing a return type annotation
LLN-SYNTAX-008   INVALID_ROUTE_METHOD        Route declaration uses an unrecognised HTTP method
LLN-SYNTAX-009   DUPLICATE_CONTRACT_SECTION  Contract block contains a duplicate section key
LLN-SYNTAX-010   ELSE_IF_DENIED              'else if' is not valid LogicN syntax; use 'match' or sequential 'if'
```

Legacy syntax errors (hard errors):

```text
LLN-SYNTAX-LEGACY-001   WITH_EFFECTS_REMOVED   'with effects [...]' is no longer valid; use contract { effects {} }
LLN-SYNTAX-LEGACY-002   REMOVED_FLOW_QUALIFIER  'safe flow', 'unsafe flow', 'guard flow' are removed qualifiers
```

### Style (canonical series: LLN-STYLE-*)

Advisory diagnostics for code style. These are warnings, not errors (unless a strict
profile upgrades them).

```text
LLN-STYLE-001   ELSE_IF_CHAIN_ADVISORY   Advisory: 'else if' chain detected; prefer 'match' or sequential 'if'
                                          (Note: in v1 this is now elevated to LLN-SYNTAX-010 hard error)
LLN-STYLE-002   DEEP_NESTING             Nesting depth exceeds 3; consider extracting to a named fn or flow
```

### Taint (canonical series: LLN-TAINT-*)

Taint diagnostics enforce that external/untrusted data does not reach governed sinks
without an explicit sanitiser boundary. Introduced in Phase 28.

```text
LLN-TAINT-001   INJECTION_SINK_TAINTED       Tainted value at injection sink (database.query, html.render, shell.exec)
                                              — use a named stdlib sanitiser (Sql.escape, Html.escape, Shell.quote)
LLN-TAINT-002   LOGIC_SINK_UNVALIDATED       Unvalidated value at business-logic sink — validate before use
LLN-TAINT-003   TAINT_PROPAGATION            Taint propagated from source X to Y without sanitiser boundary
LLN-TAINT-004   UNTAINT_BOUNDARY_REQUIRED    Tainted value used in context requiring explicit untaint
LLN-TAINT-005   TAINTED_RETURN               Tainted value returned from flow without explicit declassification
LLN-TAINT-006   CROSS_BOUNDARY_TAINT         Tainted value crosses a trust boundary without sanitiser
LLN-TAINT-007   UNTRUSTED_HTTP_PARAM         Route param used without sanitiser (auto-taint at HTTP boundary)
```

### Profile (canonical series: LLN-PROFILE-*)

Profile enforcement diagnostics. Emitted when a flow's behaviour violates the
active compilation profile (strict, high_integrity, etc.). Introduced in Phase 28.

```text
LLN-PROFILE-001   STRICT_EFFECT_DENIED        Effect not permitted in 'strict' profile
LLN-PROFILE-002   HIGH_INTEGRITY_SINK_DENIED  Governed sink not permitted in 'high_integrity' profile
LLN-PROFILE-003   PROFILE_CAPABILITY_MISSING  Required capability not declared for this profile
LLN-PROFILE-004   PROFILE_UNSAFE_BINDING      unsafe let binding not permitted in this profile without gateway
LLN-PROFILE-005   PROFILE_AUDIT_REQUIRED      Profile requires audit.write effect; flow does not declare it
LLN-PROFILE-005B  PROFILE_AUDIT_INCOMPLETE    Audit event produced but missing required fields for this profile
LLN-PROFILE-006   PROFILE_TAINT_CHECK_DENIED  Profile requires taint checking; flow bypasses it
LLN-PROFILE-007   PROFILE_SIGNATURE_REQUIRED  Profile requires governance signature; proof not provided
```

### Hardware Trust (canonical series: LLN-HW-*)

Hardware trust profile diagnostics (Phase 13+) and post-quantum attestation
diagnostics (Phase 55+). See `logicn-post-quantum-hardware-security.md`.

```text
LLN-HW-001   HARDWARE_CLASS_MISMATCH        Flow requires hardware class X; target provides class Y
LLN-HW-002   PROOF_LEVEL_INSUFFICIENT       Flow requires proof level X; current level is Y
LLN-HW-003   IMMUTABLE_SEAL_VIOLATED        ImmutableInputSeal constraint violated by flow
LLN-HW-004   UNKNOWN_HARDWARE_TARGET        Target not in the hardware-trust registry — yellow uncertainty (K3 INDETERMINATE), build proceeds; auto-clears once registered (R&D 0045 tier D)
LLN-HW-101   MISSING_REQUIRED_ATTESTATION   High-trust flow requires attestation; none provided
LLN-HW-102   UNSUPPORTED_ATTESTATION_ALG    Attestation algorithm not accepted by target trust profile
LLN-HW-103   HYBRID_ATTESTATION_INCOMPLETE  Hybrid mode requires both ed25519 and ML-DSA signatures; one missing
LLN-HW-104   ATTESTATION_EVIDENCE_STALE     Attestation evidence schema version is outdated for this profile
```

> Phase 55: ML-DSA-65 (NIST FIPS 204) is the post-quantum signature algorithm.
> `lln.gov.sig.v2` artifact format carries dual signatures (ed25519 + ml-dsa-65)
> in hybrid mode. `generateHybridGovernanceKeyPair` produces the key pair.
> Attestation policy profiles: `compat` (ed25519 or ML-DSA), `hybrid` (both required),
> `pq_strict` (ML-DSA only). See `logicn-roadmap-phases-41-60.md §Phase 55`.

### Binding (canonical series: LLN-BINDING-*)

```text
LLN-BINDING-001   IMMUTABLE_LET_REASSIGNMENT     Cannot reassign immutable let binding
LLN-BINDING-002   READONLY_REASSIGNMENT          Cannot reassign readonly binding
LLN-BINDING-003   READONLY_PROPERTY_MUTATION     Cannot mutate through a readonly binding
LLN-BINDING-004   MUT_IN_PURE_CONTEXT            mut binding used in a pure flow or safe context
```

### Intent (canonical series: LLN-INTENT-*)

```text
LLN-INTENT-001   INTENT_BEHAVIOR_MISMATCH        Declared intent conflicts with inferred behavior
LLN-INTENT-002   MISSING_REQUIRED_INTENT         Governed surface requires an intent declaration
LLN-INTENT-003   UNSAFE_MISSING_REASON_OR_FALLBACK  Unsafe block must declare reason and fallback
LLN-INTENT-004   PRIVILEGED_MISSING_CAPABILITY   Privileged flow must declare its required capability
LLN-INTENT-005   EXPERIMENTAL_IN_PRODUCTION      Experimental code in a production build target
```

### Type Checker (canonical series: LLN-TYPE-*)

> **Canonical source for `LLN-TYPE-*` diagnostic numbering and semantics:**
> `docs/Knowledge-Bases/formal-type-system-spec.md`
>
> This document provides an operational summary only. It does **not** redefine
> or duplicate `LLN-TYPE-*` numbering. The formal type-system spec is the single
> source of truth for all `LLN-TYPE-*` codes — 22 codes defined there, not here.
> See `docs/Knowledge-Bases/logicn-diagnostic-numbering-strategy.md` for the
> ownership rationale.

The `LNN-ERR-TYPE-*` codes (older series) are frozen — do not extend.
`LLN-TYPE-NUMERIC-*` remains a separate sub-series for GPU/tensor numeric types.

Summary of key codes — full definitions in `formal-type-system-spec.md`:

```text
LLN-TYPE-001   UnknownType                  Referenced type not in scope
LLN-TYPE-002   TypeMismatch                 Cannot assign/convert type X to type Y
LLN-TYPE-003   InvalidNominalConversion     Implicit nominal alias conversion denied
LLN-TYPE-004   InvalidBinaryOperation       Operator not valid for these operand types
LLN-TYPE-005   InvalidUnaryOperation        Unary operator requires different operand type
LLN-TYPE-006   InvalidCallArgument          Argument type mismatch at call site
LLN-TYPE-007   InvalidArgumentCount         Wrong number of arguments
LLN-TYPE-008   InvalidReturnType            Return type does not match declaration
LLN-TYPE-009   InvalidGenericInstantiation  Wrong number of generic type arguments
LLN-TYPE-020   ShadowedBinding              Binding shadows outer-scope name (warning)
LLN-TYPE-021   NonExhaustiveMatch           (retired) superseded by LLN-TYPE-023 mandatory wildcard
LLN-TYPE-022   UnreachablePattern           Pattern already covered by an earlier `_`/`else` arm
LLN-TYPE-023   MissingWildcardArm           every match must end with a mandatory `_ =>` (or `else =>`) catch-all
```

### Name Resolution (canonical series: LLN-NAME-*)

```text
LLN-NAME-001   UNDECLARED_NAME          Name not defined in current scope
LLN-NAME-002   DUPLICATE_NAME           Name already declared in this scope
LLN-NAME-003   USE_BEFORE_DECLARATION   Name referenced before its declaration point
LLN-NAME-004   PRIVATE_ACCESS           Name is not exported from its defining package
LLN-NAME-005   AMBIGUOUS_NAME           Name resolves to multiple candidates
```

### Match Exhaustiveness (canonical series: LLN-MATCH-*)

```text
LLN-MATCH-001   NON_EXHAUSTIVE_MATCH    match is missing case(s): X
LLN-MATCH-002   UNREACHABLE_PATTERN     Pattern is unreachable — already covered by earlier arm
LLN-MATCH-003   INVALID_PATTERN_TYPE    Pattern cannot match against this type
LLN-MATCH-004   CATCH_ALL_HIDES_CASES   Wildcard _ arm prevents exhaustiveness check of remaining cases
```

Note: as of task #174 every `match` must end with a **mandatory wildcard** `_ =>` (or `else =>`) —
`LLN-TYPE-023 MissingWildcardArm` (fail-closed, deny-by-default). This supersedes variant-coverage
exhaustiveness (`LLN-TYPE-021` retired). `LLN-SAFETY-006` still covers Tri-specific match safety
(`TRI_MATCH_NOT_EXHAUSTIVE`); `LLN-MATCH-001` remains as the general coverage diagnostic alias.

### Value-State (canonical series: LLN-SAFETY-*, extended)

```text
LLN-SAFETY-007   UNSAFE_VALUE_IN_SAFE_CONTEXT     unsafe unvalidated value used where safe validated required
LLN-SAFETY-008   BOUNDARY_VALUE_NOT_VALIDATED     Value from external boundary used before validation
```

### Pipeline (canonical series: LLN-PIPELINE-*)

```text
LLN-PIPELINE-001   UNKNOWN_PIPELINE_METHOD         Unknown method in pipeline chain
LLN-PIPELINE-002   PIPELINE_TYPE_MISMATCH          Stage output type does not match next stage input
LLN-PIPELINE-003   UNHANDLED_FALLIBLE_PIPELINE     Fallible stage produces unhandled Result
LLN-PIPELINE-004   PIPELINE_UNDECLARED_EFFECT      Stage requires effect not declared on enclosing flow
LLN-PIPELINE-005   PIPELINE_READONLY_MUTATION      Stage attempts to mutate a readonly receiver
```

### Typed Content Blocks (canonical series: LLN-BLOCK-*)

```text
LLN-BLOCK-001   UNKNOWN_CONTENT_BLOCK_TYPE    Unknown typed block type (valid: html, dom, script, css)
LLN-BLOCK-002   UNCLOSED_CONTENT_BLOCK        Typed content block opened but never closed
LLN-BLOCK-003   MISMATCHED_CONTENT_BLOCK_MARKER  Closing marker does not match opening marker
LLN-BLOCK-004   SECRET_IN_CONTENT_BLOCK       ProtectedSecret emitted into a typed content block
```

### String (canonical series: LLN-STRING-*)

```text
LLN-STRING-001   INVALID_UTF8_DECODE             decode produced invalid UTF-8
LLN-STRING-002   SECRET_STORED_AS_STRING         Secret value stored in plain String
LLN-STRING-003   IMPLICIT_STRING_BYTE_CONVERSION Bytes assigned to String without explicit decode
LLN-STRING-004   AMBIGUOUS_STRING_LENGTH         .length without charCount() or encodedLength()
```

### Char (canonical series: LLN-CHAR-*)

```text
LLN-CHAR-001   CHAR_BYTE_CONFUSION             Char assigned to Byte without explicit conversion
LLN-CHAR-002   INVALID_CHAR_LITERAL            Character literal contains invalid Unicode scalar
LLN-CHAR-003   MULTI_CHAR_LITERAL              Char literal contains more than one character unit
LLN-CHAR-004   IMPLICIT_CHAR_NUMBER_CONVERSION Char used as integer without .codePoint()
```

### Byte (canonical series: LLN-BYTE-*)

```text
LLN-BYTE-001   BYTE_OUT_OF_RANGE              Byte literal outside 0–255 range
LLN-BYTE-002   BYTE_OVERFLOW                  Byte arithmetic result may exceed 255
LLN-BYTE-003   IMPLICIT_BYTE_STRING_CONVERSION  Bytes assigned to String without explicit decode
LLN-BYTE-004   RAW_BYTES_LOGGED               Raw Bytes passed to log sink without redaction
LLN-BYTE-005   UNBOUNDED_BYTES_READ           Bytes read without declared memory limit
```

### Raw Pointer (canonical series: LLN-RAWPTR-*)

Raw pointer access is banned in normal LogicN code. The `LLN-RAWPTR-*` series
covers violations of the raw pointer ban introduced in Phase 3.

```text
LLN-RAWPTR-001   RAW_POINTER_OUTSIDE_UNSAFE    Raw pointer access outside approved unsafe block
```

### Data Layout

```text
LN-LAYOUT-001   Invalid alignment value (not a supported power-of-two)
LN-LAYOUT-002   Packed/SIMD conflict
LN-LAYOUT-003   Unsupported SIMD field type
LN-LAYOUT-004   GPU transfer requires stable layout
LN-LAYOUT-005   Target does not support requested alignment
LN-LAYOUT-006   Layout conversion requires explicit copy
LN-LAYOUT-007   Dynamic field prevents zero-copy
LN-LAYOUT-008   Native ABI layout is unstable
```

### Type System

```text
LLN-TYPE-NUMERIC-001   Float16 not supported by target
LLN-TYPE-NUMERIC-002   Implicit narrowing conversion rejected
LLN-TYPE-NUMERIC-003   Tensor shape mismatch
LLN-TYPE-NUMERIC-004   Quantized type used where full precision required
LLN-TYPE-NUMERIC-005   SIMD vector width incompatible with target
```

### Neural IR / Tensors

```text
LLN-TENSOR-001   Matrix dimensions do not align
LLN-TENSOR-002   Incompatible tensor ranks
LLN-TENSOR-003   Dtype mismatch
LLN-TENSOR-004   Layout mismatch
LLN-TENSOR-005   Broadcast rule failed
LLN-TENSOR-006   Dynamic dimension requires runtime guard
LLN-TENSOR-007   Backend does not support operator
LLN-TENSOR-008   Backend does not support dtype/layout combination
LLN-TENSOR-009   Precision policy would be violated
LLN-TENSOR-010   Native neural call lacks shape contract
```

### Quantization

```text
LLN-QUANT-001   Quantized value used where full precision required
LLN-QUANT-002   Full-precision value used where quantized required
LLN-QUANT-003   Incompatible quantization schemes
LLN-QUANT-004   Missing calibration profile
LLN-QUANT-005   Implicit dequantization forbidden
LLN-QUANT-006   Implicit quantization forbidden
LLN-QUANT-007   Backend does not support quantization scheme
LLN-QUANT-008   Accuracy evidence required by policy
LLN-QUANT-009   Quantized accumulation type mismatch
LLN-QUANT-010   Precision downgrade not approved
```

### NPU Targets

```text
LLN-NPU-001   NPU target unavailable for deployment platform
LLN-NPU-002   Operator unsupported by selected NPU provider
LLN-NPU-003   Dtype unsupported by selected NPU provider
LLN-NPU-004   Dynamic shape unsupported by selected NPU provider
LLN-NPU-005   Quantization required for NPU target
LLN-NPU-006   Fallback required but not declared
LLN-NPU-007   Selected provider would violate precision policy
LLN-NPU-008   Selected provider cannot satisfy memory budget
LLN-NPU-009   Runtime fallback occurred and was reported
LLN-NPU-010   NPU target requested but neural IR is opaque native call
```

### GPU Synchronisation

```text
LLN-GPU-SYNC-001   Shared memory written without barrier before read
LLN-GPU-SYNC-002   Atomic operation on non-atomic memory region
LLN-GPU-SYNC-003   Stream awaited after stream was already completed
LLN-GPU-SYNC-004   Concurrent kernels on same stream must be sequential
LLN-GPU-SYNC-005   Memory fence required before cross-stream visibility
```

### Cross-Target Verification

```text
LLN-VERIFY-001   Cross-target verification failed within tolerance
LLN-VERIFY-002   Verification tolerance not declared for this target
```

### Compute Resource Budgets

```text
LLN-BUDGET-001   Flow exceeds declared VRAM budget
LLN-BUDGET-002   Register usage exceeds declared limit
LLN-BUDGET-003   Occupancy constraint cannot be met for this kernel
LLN-BUDGET-004   Timeout budget exceeded
```

### Compiler Optimizations

```text
LLN-COMPTIME-001   Effectful flow cannot execute at compile time
LLN-COMPTIME-002   Nondeterministic operation in comptime flow
LLN-COMPTIME-003   Compile-time evaluation exceeded resource budget
LLN-COMPTIME-004   Comptime flow attempted forbidden runtime access
LLN-COMPTIME-005   Secret value cannot be embedded into compile-time constant
LLN-COMPTIME-006   Target-dependent comptime result detected
LLN-COMPTIME-007   Recursive comptime evaluation exceeded limit
LLN-COMPTIME-008   Unsupported type for compile-time serialization

LLN-FUSE-001   Pipeline fused successfully (report)
LLN-FUSE-002   Fusion skipped — effect ordering conflict
LLN-FUSE-003   Fusion skipped — intermediate materialisation required
LLN-FUSE-004   Fusion skipped — lifetime escape
LLN-FUSE-005   Fusion skipped — error order ambiguity
LLN-FUSE-006   Fusion would change short-circuit behavior

LLN-BOUNDS-001   Bounds check eliminated by range proof
LLN-BOUNDS-002   Bounds check retained — collection may mutate
LLN-BOUNDS-003   Bounds check retained — index range is unknown
LLN-BOUNDS-004   Bounds check retained — alias may resize collection
LLN-BOUNDS-005   Bounds check retained — integer overflow proof failed
LLN-BOUNDS-006   Unsafe unchecked access rejected
```

### Profile-Guided Optimization

```text
LLN-PGO-001   Profile evidence ignored — workload hash changed
LLN-PGO-002   Profile evidence ignored — target is not approved
LLN-PGO-003   Profile evidence stale for current backend version
LLN-PGO-004   Tuned launch exceeds memory budget
LLN-PGO-005   Tuned launch failed correctness verification
LLN-PGO-006   Profile requested forbidden precision relaxation
LLN-PGO-007   No profile evidence available; using baseline planner
LLN-PGO-008   Tuned launch selected from trusted profile evidence
```

### Backend

```text
LLN-BACKEND-001   Target backend not available
LLN-BACKEND-002   Feature not lowerable to selected backend
LLN-BACKEND-003   Runtime ABI mismatch
LLN-BACKEND-004   Unsafe native lowering requires explicit permission
LLN-BACKEND-005   Source map unavailable for optimised output
LLN-BACKEND-006   Backend optimisation would violate security boundary
LLN-BACKEND-007   Target fallback denied by policy
```

### Incremental Compilation

```text
LLN-INCR-001   Semantic hash mismatch — recompile required
LLN-INCR-002   Dependency graph changed — partial invalidation
LLN-INCR-003   Cached artefact expired
LLN-INCR-004   Incremental build skipped security-sensitive change
```

### Native Module System

```text
LLN-MODULE-001   Package governance manifest missing
LLN-MODULE-002   Package install scripts are forbidden
LLN-MODULE-003   Package authority not accepted
LLN-MODULE-004   Package manifest hash changed
LLN-MODULE-005   Package requested undeclared capability
LLN-MODULE-006   Package used effect not declared in manifest
LLN-MODULE-007   Package signature verification failed
LLN-MODULE-008   Package version is floating in production profile
LLN-MODULE-009   Transitive dependency authority changed
LLN-MODULE-010   Package export requires ungranted capability
```

### Constraint-Complete Signatures

```text
LLN-CONSTRAINT-001   Caller does not declare required effects
LLN-CONSTRAINT-002   Caller missing required capability
LLN-CONSTRAINT-003   Caller does not handle declared error type
LLN-CONSTRAINT-004   Transitive constraint not covered by caller
LLN-CONSTRAINT-005   Signature export missing from package manifest
```

### Test Generation

```text
LLN-GEN-TEST-001   No public API or flow contracts found for test generation
LLN-GEN-TEST-002   Generated test references missing type
LLN-GEN-TEST-003   Effect mock type mismatch
LLN-GEN-TEST-004   Capability not grantable in test context
LLN-GEN-TEST-005   Generated test file would overwrite developer changes
LLN-GEN-TEST-006   Flow has no declared effects — no mocks generated
LLN-GEN-TEST-007   Boundary test missing for declared external boundary
```

### Governance Summary

```text
LLN-GOV-SUMMARY-001   Governance summary missing required fact
LLN-GOV-SUMMARY-002   Profile context unknown for summary generation
LLN-GOV-SUMMARY-003   Summary references unpublished capability
LLN-GOV-SUMMARY-004   Uncertainty level too high to emit summary
LLN-GOV-SUMMARY-005   Summary template missing for this profile
```

### Three-Valued Governance (canonical series: LLN-GOV-3VL-*)

Runtime governance verdicts are three-valued (Kleene K3): `ALLOW +1 / DENY -1 /
INDETERMINATE 0`. Verdicts compose with `vAnd`(∧)/`vOr`(∨)/`vNot`(¬) and collapse at
the trust boundary — `INDETERMINATE` and `DENY` both deny; only `ALLOW` authorizes
(`authorize(v) ⇔ v=+1`, proved fail-closed). When an `INDETERMINATE` verdict reaches a
boundary it is collapsed to `deny` **and audited** (never silent). Implemented in
`logicn-tower-citizen/src/three-valued-governance.ts`. Spec + soundness proof:
`docs/Knowledge-Bases/logicn-three-valued-governance.md`.

```text
LLN-GOV-3VL-001   INDETERMINATE_COLLAPSED_TO_DENY   Indeterminate governance verdict reached a
                  trust boundary → collapsed to deny (severity: warning; fail-safe, audited).
```

> Complements the **compile-time** `LLN-SAFETY-003 TRI_UNKNOWN_AS_TRUE` (which bans mapping
> `Tri.unknown → true` without a policy in source). `LLN-GOV-3VL-001` is the runtime trust-boundary
> counterpart: the policy is "unknown → deny, audited." Same fail-closed, deny-by-default spirit.

### REPL

```text
LLN-REPL-001   Effect not permitted in current REPL profile
LLN-REPL-002   Secret cannot be revealed in REPL session
LLN-REPL-003   Capability not granted for this REPL session
LLN-REPL-004   Expression would cross a boundary not permitted in session
LLN-REPL-005   REPL session audit write failed
LLN-REPL-006   Session capability grant would exceed profile maximum
LLN-REPL-007   Interactive session requires --profile flag
LLN-REPL-008   Session audit report could not be generated
```

### Compliance

```text
LLN-PII-001    PII data used without explicit pii.read or pii.write effect
LLN-PHI-001    PHI data used without phi.read or phi.write effect (HIPAA)
LLN-PCI-001    PCI data used without pci.read or pci.write effect (PCI-DSS)
LLN-AUDIT-001  Audit-required flow did not produce audit.write effect
LLN-CONSENT-001  User consent check required before PII processing
```

### Photonic Compute

```text
LLN-PHOTONIC-001   Photonic op used outside photonic compute block
LLN-PHOTONIC-002   Wavelength out of supported range for target device
LLN-PHOTONIC-003   Phase value exceeds device precision
LLN-PHOTONIC-004   Delay line exceeds device buffer capacity
LLN-PHOTONIC-005   Optical signal loss exceeds tolerance threshold
LLN-PHOTONIC-006   O/E conversion required but not declared
LLN-PHOTONIC-007   Photonic target requires classical fallback declaration
LLN-PHOTONIC-008   Interference pattern cannot be resolved statically
LLN-PHOTONIC-009   Photonic effect used in non-photonic flow
LLN-PHOTONIC-010   Wavelength domain parallelism requires explicit route declaration
```

### Substrate Failure-Mode (canonical series: LLN-SUBSTRATE-*)

Semantic-guarantee codes proven against a **seeded software noise model** (Direction C). Distinct from
and complementary to `LLN-PHOTONIC-*` (which are *hardware-capability* codes — static device
properties): `LLN-SUBSTRATE-*` assert *tolerance / redundancy / determinism* guarantees against the
modeled phase-drift / crosstalk / lane-failure / readout noise. The model is fail-closed — substrate
noise can cost availability, never safety (`effectiveVerdict = vAnd(ideal, reading)` can never upgrade
a `0`/`-1` into `+1`; inherits the Direction A No-Coercion theorem). Implemented in
`logicn-tower-citizen/src/substrate-model.ts`. Spec: `docs/Knowledge-Bases/logicn-substrate-failure-model.md`.

```text
LLN-SUBSTRATE-001   CRYPTO_ON_NOISY_LANE                Hash/Sign/crypto effect on a noisy lane —
                    integrity needs bit-exactness, cannot be tolerance-bounded (error, always; the
                    durable Direction B1 invariant, registered now).
LLN-SUBSTRATE-002   TOLERANCE_UNACHIEVABLE_UNDER_NOISE  Declared tolerance not provable under the modeled
                    noise at the declared redundancy (error in production/deterministic; warning in dev).
LLN-SUBSTRATE-003   REDUNDANCY_INSUFFICIENT             Declared redundancy cannot meet tolerance under the
                    model, incl. the pBad ≥ 0.5 "voting won't converge" case (error, always).
LLN-SUBSTRATE-004   UNVOTED_ANALOG_INTO_DETERMINISTIC   Un-voted (N=1) noisy result feeds a context
                    requiring determinism (strict profile / crypto boundary) (error, always).
```

> These are a higher-severity category than the runtime `LLN-GOV-3VL-001` (warning): that flags an
> expected, safe runtime collapse (indeterminate → deny, audited); `LLN-SUBSTRATE-*` are compile-time
> *unproven-guarantee* assertions — correctness, not information. The compiler verifier pass that
> emits these from a parsed `substrate { lane, tolerance, redundancy }` block is **Direction B**
> (deferred); Direction C ships the model + checker + codes as a self-contained library.

### Runtime

```text
LLN-RUNTIME-001   Native runtime ABI version mismatch
LLN-RUNTIME-002   MIR bridge contract violated
LLN-RUNTIME-003   Runtime enforcement rule failed
LLN-RUNTIME-004   Resource scope closed before awaited task completed
LLN-RUNTIME-005   Proof chain generation failed
LLN-RUNTIME-006   Audit event stream write failed
LLN-RUNTIME-007   Runtime fallback to JS prototype occurred
```

### Graph Structure (lln-graph library)

```text
LLN-GRAPH-001   Graph contains a cycle where a DAG is required
LLN-GRAPH-002   Referenced node does not exist in graph
LLN-GRAPH-003   A declared dependency was not found
LLN-GRAPH-004   Iterative fixpoint did not converge within max iterations
LLN-GRAPH-005   Resource lifecycle state transition is not permitted
```

### Supply Chain

```text
LLN-SUPPLY-001   Dependency content hash mismatch
LLN-SUPPLY-002   Package signature verification failed
LLN-SUPPLY-003   Unsigned package rejected by policy
LLN-SUPPLY-004   Dependency graph hash mismatch
LLN-SUPPLY-005   Known vulnerability in dependency
```

## Reconciled emitted codes (2026-06-16)

Codes that were emitted by the compiler but not yet documented here at the time the
diagnostic-namespace conformance test was added (see `logicn-diagnostic-namespace-ownership.md`).
Descriptions taken from each code's actual emission site. This shrinks the `PENDING_REGISTRATION`
allowlist from 65 → 1.

### Lexer

```text
LLN-LEX-001   Generic type nesting exceeds maximum depth (8 levels)
LLN-LEX-002   String literal / identifier exceeds maximum length (10,000 chars)
LLN-LEX-003   Invalid unicode escape sequence in a string literal
LLN-LEX-004   File exceeds maximum size (10MB)
LLN-LEX-005   Line exceeds maximum length (10,000 chars)
LLN-LEX-006   Lexer hit the maximum diagnostic count (100); further errors suppressed
```

### Type checker

```text
LLN-TYPE-010   Type does not satisfy the required generic constraint
LLN-TYPE-011   Collection element type does not match the declared element type
LLN-TYPE-012   Ok/Err branch type does not match the declared Result<T,E>
LLN-TYPE-013   Protected secret value cannot use this operator (use constantTimeEquals())
LLN-TYPE-014   Calling this function requires an effect the current flow does not declare
LLN-TYPE-015   Governed sink requires a safe/validated binding; received an unsafe binding
LLN-TYPE-016   Tensor shapes are incompatible for this operation
LLN-TYPE-017   Cannot mix quantized (Int8) and float (Float32) without explicit dequantize()
LLN-TYPE-018   This type cannot exist in the selected compute target
LLN-TYPE-019   Symbol is not defined in the current scope
LLN-TYPE-030   Tensor element types do not match (Float32 vs Int8)
LLN-TYPE-031   Tensor dimension/rank counts do not match
```

### Binding / value-state

```text
LLN-BINDING-005       Cannot reassign an immutable 'let' binding (use 'mut')
LLN-BINDING-006       Cannot change the type of a 'mut' binding on reassignment (type-stable)
LLN-VALUESTATE-005    A value derived from an unsafe binding reached a governed sink (taint survives transformation, e.g. .trim())
LLN-VALUESTATE-006    A protected value used where the plain type is required (declare 'protected X' or pass an authorised gate)
LLN-VALUESTATE-007    A redacted value cannot be converted back to its original type (redaction is irreversible)
```

### Effect / stdlib

```text
LLN-EFFECT-005    Effect is a broad alias; use the canonical effect name to precisely declare authority
LLN-STDLIB-001    A stdlib call requires an effect not declared in the contract
LLN-STDLIB-002    Unrecognised method on an effectful module — deny-by-default; declare the effect or use a recognised operation
```

### Governance / value classification

```text
LLN-GOV-006   Secure flow has high max_risk_liability but no epilogue {} proof strategy
LLN-GOV-007   Privileged flow declares no effects or capabilities (should explicitly declare authority)
LLN-GOV-009   Privileged flow declares no effects or capabilities (should explicitly declare authority)
LLN-GOV-011   Contract set referenced with 'use' is not declared at program scope
LLN-GOV-012   Contract set requires audit.write but the flow does not declare it
LLN-GOV-013   A pure flow calls a flow with effects (pure flows cannot cross into governed boundaries)
LLN-GOV-014   Flow declares prefer [...] compute targets but no fallback target (native crash → unrecoverable failure)
LLN-ARCH-001  contract.architecture volatility must be LOW, MED, or HIGH (invalid token — R&D 0045 fail-closed value check)
LLN-ARCH-002  Stable-Dependencies violation: a more-stable flow must not depend on a more-volatile one (R&D 0045, always a hard error)
LLN-VAL-001   A safety_critical flow must declare audit.write
LLN-VAL-002   A safety_critical flow must declare 'require deterministic_execution'
LLN-VAL-003   Unrecognised classification in contract.value
```

### Security / anti-abuse

```text
LLN-SEC-020            Runtime behaviour modification (monkey-patching) is prohibited; use adapters/interfaces/mocks
LLN-SEC-021            Prototype/object mutation after definition is prohibited
LLN-SOURCE-ESCAPE-001  Source calls eval()/dynamic code loading — bypasses governance and capability checks
LLN-STYLE-SEC-001      Binding name looks sensitive; use SecureString or protected String
LLN-ANTI-ABUSE-001     Background execution (process/worker.spawn, event.schedule) requires an explicit effect declaration
```

### Network / package supply

```text
LLN-NET-001   Network call target is not in the flow's declared allowlist
LLN-NET-002   Network call resolved to a private/reserved IP (SSRF prevention)
LLN-PKG-001   Package declares capabilities not present in the lockfile (breaking security change)
LLN-PKG-002   Package from an unregistered/unverified registry
LLN-PKG-003   Package has no content-addressable hash (no tamper detection / reproducible build)
LLN-PKG-004   Package declares an install script (denied by default)
LLN-PKG-005   Package has no signature (origin cannot be cryptographically verified)
LLN-PKG-006   Package is signed by a REVOKED key (revocation refused at resolution time, defense-in-depth)
```

### Border (plugin input validation) / economics / misc

```text
LLN-BORDER-001   Plugin input is required but missing
LLN-BORDER-002   Plugin input type mismatch (expected vs actual)
LLN-BORDER-003   Plugin input length exceeds the declared maximum
LLN-BORDER-004   Plugin input value below the declared minimum
LLN-ECON-001     Flow execution may exceed the declared economic budget
LLN-ECON-002     Protected data binding has no lineage declaration
LLN-ECON-003     AI model call uses a model not in the contract's approved_models list
LLN-EVENT-001    Event emitted but not declared at program scope
LLN-EVENT-002    Event declared but never emitted
LLN-EVENT-003    Contract declares 'emits X' but no global 'event X' declaration exists
LLN-EVENT-004    Event emitted more than once in a flow (possibly unintentional)
LLN-EVENT-005    Event emitted but not declared in contract.events
LLN-COMPUTE-001  Pattern may not map efficiently to the declared compute target (NPU/GPU/TPU)
LLN-CONTEXT-001  A required context field (contract.context) is never accessed in the flow body
LLN-BUILD-001    Non-deterministic build: identical source produced different output on recompilation
LLN-WAT-STUB     WAT emitter stub (a target path not yet fully emitted)
```

### Runtime governance codes

```text
LLN-RUNTIME-EFFECT-GATE   Runtime denial: a dispatched flow declares effects disallowed in the active deployment profile (route-dispatcher)
```


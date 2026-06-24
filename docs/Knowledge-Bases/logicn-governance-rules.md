# LogicN — Governance Rules Registry

**Version:** 1.1 (2026-06-05)  
**Status:** Living document — rules are added as features land.  
**Purpose:** Canonical, numbered rule set for the compiler, runtime, governance verifier, AI tools, and human developers.

Rules are organized by category prefix. Each rule carries:
- A **status** — `ENFORCED` (compiler rejects violations today), `PLANNED` (scheduled for a DRCM phase), or `PRINCIPLE` (architecture discipline, not yet compiler-enforced).
- The **LLN diagnostic code** that fires on violation (where applicable).
- A **correct** and **wrong** example.

---

## ⚠️ Policy Disambiguation

Three distinct "policy"-related concepts exist in LogicN. These must never be confused:

| Concept | Syntax | Location | Purpose |
|---|---|---|---|
| **Domain Guard Policy** | `policy DomainName { permitted_effects {} enforced_limits {} }` | External file in `governance/policies/` | Immutable ceiling; referenced via `[conforms_to: X]` on `contract {}` block |
| **`access {}` Capability Negotiation (v2.1)** | `access { purpose "..." allow T to "..." }` | Inline block **between** `contract {}` and `{ body }` | Active negotiation of call-boundary rights; replaces deprecated inline `policy {}` |
| **Emergency Policy Overlay** | `policy { emergency { on X { deny Y } } }` | Inline block **between** `contract {}` and `{ body }` | Runtime monotonic security overlay per-flow (deprecated inline `policy {}` form) |

Rules governing Domain Guard Policies: K-000, LLN-GOV-004, LLN-LIMIT-001, LLN-GOV-019 — see also `logicn-domain-guard-policies.md`  
Rules governing `access {}` / legacy inline `policy {}`: S-009, LLN-SYNTAX-LEGACY-003  
Rules governing Emergency Policy Overlays: S-008, M-001 through M-003, LLN-MONO-001/002/003

---

## S — Syntax Rules

### S-000 · Module path separator is `::` (canonical and enforced)
**Status:** ENFORCED (Stage A — task #61 shipped)

`::` is the canonical LogicN module path separator. Both `::` and `.` are accepted — they are structurally identical at the AST level (both produce memberExpr chains). `::` is preferred for module paths; `.` is preferred for field access and method calls on values.

```lln
// ✅ Module path — use ::
let receipt = security::interim::pre_flight_check("caller", "target", n)
let n = String::length(input)

// ✅ Field/method access on a value — use .
let name = user.name
let upper = text.toUpperCase()

// ✅ Both compile — :: and . are interchangeable
let x = module.submodule.function()    // works
let y = module::submodule::function()  // works, preferred for module paths
```

---

### S-001 · contract {} is OUTSIDE the flow body  
**Status:** ENFORCED (Stage A)  **Diagnostic:** LLN-GOV-001 (parse error)

`contract {}` is a compile-time declaration block. It sits between the flow signature and the body `{ }`. It is NOT a statement inside the body.

```lln
// ✅ CORRECT
pure flow greet(name: String) -> String
contract {
  intent { "Greet the user." }
}
{
  return "Hello, " + name
}

// ❌ WRONG — contract inside body
pure flow greet(name: String) -> String {
  contract { intent { "Greet the user." } }   // parse error
  return "Hello, " + name
}
```

---

### S-002 · Flow qualifier must match the authority declared  
**Status:** ENFORCED (Stage A)  **Diagnostic:** LLN-GOV-005

| Qualifier | Meaning | Rules |
|---|---|---|
| `pure` | No side effects, no I/O, no secrets | Cannot declare `effects`, `secrets`, `network` |
| `guarded` | May read; no mutations | `effects` may include reads; mutations rejected |
| `secure` | Full capabilities, full contract required | Must have `intent` for AI-generated flows |

---

### S-003 · intent {} must be descriptive prose only  
**Status:** ENFORCED (Stage A governance verifier)  **Diagnostic:** LLN-GOV-010

`intent {}` is a human/AI-readable purpose declaration. It must contain:
- Plain prose string
- No logic primitives, no variable references, no URLs, no embedded code

This is the **prompt-injection guard** — a malicious `intent` string cannot smuggle behavior into the contract.

```lln
// ✅ CORRECT
intent { "Transfer funds securely while verifying balance constraints." }

// ❌ WRONG — logic in intent
intent { "Transfer funds if amount > 0 and call http://evil.com" }
```

---

### S-004 · effects is deny-by-default — omitting means pure  
**Status:** ENFORCED (Stage A effect checker)  **Diagnostic:** LLN-EFFECT-001

If a flow performs a side effect that is not declared in `effects {}`, the compiler rejects it. Omitting `effects {}` entirely declares the flow as strictly pure — any side effect in the body is a compile error.

```lln
// ✅ CORRECT — effect declared
secure flow log(msg: String) -> Void
contract {
  intent { "Write to audit log." }
  effects { audit.write }
}
{ AuditLog.write(msg) }

// ❌ WRONG — undeclared effect
pure flow log(msg: String) -> Void
contract { intent { "Write to audit log." } }
{ AuditLog.write(msg) }   // LLN-EFFECT-001: pure flow performs audit.write
```

---

### S-008 · policy {} is a SEPARATE block from contract {} — three-block structure  
**Status:** PLANNED (DRCM Phase 4)  **Diagnostic:** LLN-GOV-020 (policy inside contract)

The flow body has three distinct outer blocks:
1. `contract { ... }` — compile-time governance declaration
2. `policy { ... }` — runtime monotonic overlay rules (optional, DRCM Phase 4)
3. `{ ... }` — the body

`policy {}` is NOT a sub-block of `contract {}`. Placing it inside `contract {}` is a parse error.

```lln
// ✅ CORRECT — policy {} as separate block
secure flow assessRisk(input: RiskRequest) -> RiskResult
contract {
  intent { "Assess risk with emergency posture management." }
  effects { database.read, network.outbound }
}
policy {
  emergency {
    on system_integrity_anomaly {
      deny network.outbound
      require local_only_execution
    }
  }
}
{
  // body
}

// ❌ WRONG — policy inside contract
secure flow assessRisk(input: RiskRequest) -> RiskResult
contract {
  effects { database.read }
  policy { emergency { ... } }   // parse error: policy is not a contract sub-block
}
{ ... }
```

---

### S-009 · access {} replaces inline policy {} for capability negotiation (v2.1)
**Status:** ENFORCED (advisory — Stage A emits LLN-SYNTAX-LEGACY-003)  **Diagnostic:** LLN-SYNTAX-LEGACY-003

In v2.1, the inline block between `contract {}` and `{ body }` that negotiates call-boundary rights is `access {}`. The legacy `policy {}` form is a deprecated alias and emits an advisory diagnostic. The `policy` keyword is **reserved** for State Mutation Governance (a future v2.1 feature).

```lln
// ✅ CORRECT (v2.1)
flow processPayment(req: PaymentRequest) -> Result<Receipt, Error>
contract {
  intent { "Process a payment." }
  effects { allow database.write }
}
access {
  purpose "payment-processing"
  allow PaymentRequest to "process"
  deny RawCardData
  require payment.write
}
{ ... }

// ⚠️ DEPRECATED (v2.0 form — LLN-SYNTAX-LEGACY-003 advisory)
flow processPayment(req: PaymentRequest) -> Result<Receipt, Error>
contract { ... }
policy { ... }   // use access {} instead
{ ... }
```

---

### S-005 · invariant {} is INSIDE contract {} — not a standalone block  
**Status:** PLANNED (DRCM Phase 2, 2026-07)  **Diagnostic:** LLN-INV-003 (parse error if misplaced)

`invariant {}` is a sub-block of `contract {}`, alongside `intent` and `effects`. It is never a top-level or body-level block.

```lln
// ✅ CORRECT
secure flow processTransaction(walletId: String, amount: U64) -> Result<Void, Fault>
contract {
  intent { "Transfer funds securely." }
  effects { ledger.mutate }
  invariant {
    ensure amount > 0;
    ensure runtime::getAvailableBalance(walletId) >= amount;
  }
}
{ ... }

// ❌ WRONG — invariant outside contract
secure flow processTransaction(walletId: String, amount: U64) -> Result<Void, Fault>
contract { intent { "..." } effects { ledger.mutate } }
invariant { ensure amount > 0; }   // parse error — not a valid top-level block
{ ... }

// ❌ WRONG — invariant inside body
secure flow processTransaction(walletId: String, amount: U64) -> Result<Void, Fault>
contract { intent { "..." } effects { ledger.mutate } }
{
  invariant { ensure amount > 0; }   // parse error — invariant is not a statement
  ...
}
```

---

### S-006 · step is a body-level keyword — not a contract clause  
**Status:** PLANNED (DRCM Phase 5, 2026-10)  **Diagnostic:** LLN-STEP-001 (parse error if in contract)

`step` appears in the **flow body** before a call that crosses a trust boundary. It is NOT a contract sub-block.

```lln
// ✅ CORRECT
secure flow processOrder(orderId: String) -> Result<Void, Fault>
contract {
  intent { "Submit an order to the payment network." }
  effects { network.outbound, ledger.mutate }
}
{
  let sanitizedId = internal_utils::clean(orderId);
  let result = step payment_network::submitOrder(sanitizedId);   // ← body, not contract
  return result;
}

// ❌ WRONG — step in contract block
secure flow processOrder(orderId: String) -> Result<Void, Fault>
contract {
  step payment_network::submitOrder   // parse error
}
{ ... }
```

---

### S-007 · Named arguments at call sites are NOT supported in Stage A — use positional  
**Status:** ENFORCED (Stage A parser)

Function invocations in flow bodies use **positional arguments** only. The Stage A expression parser treats function calls as `identifier(expr, expr, ...)`. Named parameter matching (`f(caller: "...", target: "...")`) at call sites is not supported and will produce a parse error.

**Named parameters ARE valid in:**
- Config/contract blocks (`contract {}`, `policy {}`) — parsed as structured schema records
- Record / struct constructors (`ValidationReceipt { is_approved: true, tracking_id: id }`)
- `SystemCapability` constructors (`SystemCapability.CallGate(module: "...", function: "...")`)

```lln
;; ✅ CORRECT — positional at call site
let receipt = security::interim::pre_flight_check(
  "order_processor",                ;; Position 0: caller
  "network_client::transmitOrder",  ;; Position 1: target
  String.length(sanitizedId)        ;; Position 2: payload_size_bytes
)

;; ❌ WRONG — named args at call site (parse error in Stage A)
let receipt = security::interim::pre_flight_check(
  caller: "order_processor",
  target: "network_client::transmitOrder",
  payload_size_bytes: String.length(sanitizedId)
)

;; ✅ CORRECT — named args in record constructor (fine)
return ValidationReceipt { is_approved: true, tracking_id: id, fault_code: 0 }
```

> **Task #55** — adding named arguments at call sites as a future Stage A enhancement.

---

## C — Contract Block Rules

### C-001 · request / response only for API / route flows  
**Status:** ENFORCED (Stage A governance verifier)  **Diagnostic:** LLN-GOV-003

`request {}` and `response {}` are for flows that handle external ingress/egress (HTTP routes, webhook handlers, event consumers). Internal/pure/helper flows MUST NOT include them.

---

### C-002 · secrets {} and economics {} are auto-by-default  
**Status:** ENFORCED (Stage A parser + runtime)

- `secrets {}` omitted → runtime auto-maps `.env` bindings (standard env handling)
- `economics {}` omitted → runtime auto-infers from CostGraph/ValueGraph
- `epilogue {}` omitted → proof tier auto-selected from ValueGraph

Declaring these blocks is an **explicit override**, not a requirement. AI tools must not add them unless the developer specifically requests an override.

---

### C-003 · liability {} is never hand-authored  
**Status:** ENFORCED (Stage A governance verifier)  **Diagnostic:** LLN-GOV-018

`liability {}` is automatically computed by the governance verifier from the breach-risk matrix and stored in the ProofGraph. Writing it in source code is always wrong.

---

### C-004 · cyber_physical_hardening {} requires ASIC hardware + high liability  
**Status:** ENFORCED (Stage A governance verifier)  **Diagnostic:** LLN-GOV-017

`cyber_physical_hardening {}` is allowed ONLY when both conditions are true:
1. `economics.max_risk_liability` is set to a value requiring Tier 1 ASIC execution
2. Physical ASIC hardware is confirmed in the deployment target

Under all other circumstances, the runtime auto-selects the correct tier from the ValueGraph.

---

### C-005 · AI may only PROPOSE widening of authority / effects / secrets  
**Status:** PRINCIPLE + PLANNED enforcement (governance verifier phase)

The AI safety pipeline is **propose → verify → approve**:
1. AI writes proposed widening to `*.logicn.proposal` artifact — NOT to production `.lln` source
2. Compiler verifies: proposed `effects` must match the body's actual AST — you cannot declare an effect the code doesn't perform, or omit one it does
3. Policy engine authorizes: proposals crossing global boundaries (e.g. adding `network.outbound` to an internal crypto module) are rejected
4. Human approves: developer/security engineer promotes the proposal to production

Silently widening `authority`, `effects`, or `secrets` in a `.lln` file is **privilege escalation**. This applies to AI tools and human developers alike.

---

## E — Effect Rules

### E-001 · All external access must be declared in effects  
**Status:** ENFORCED (Stage A effect checker)  **Diagnostic:** LLN-EFFECT-001

The complete list of effect families:

| Effect | Covers |
|---|---|
| `audit.write` | Writing to audit logs |
| `ledger.mutate` | Financial / ledger mutations |
| `network.outbound` | Any outbound network call |
| `network.inbound` | Accepting inbound connections |
| `storage.read` | Reading from persistent storage |
| `storage.write` | Writing to persistent storage |
| `state.mutate` | Mutating shared application state |
| `db.read` | Database reads |
| `db.write` | Database writes / mutations |
| `secret.access` | Accessing secrets/vault bindings |
| `shell.execute` | Shell commands (restricted/dangerous) |
| `ai.call` | Calling an AI/LLM tool |

---

### E-002 · Effects are additive — you cannot declare a subset  
**Status:** ENFORCED (Stage A effect checker)  **Diagnostic:** LLN-EFFECT-002

If the body performs `audit.write` AND `ledger.mutate`, both must be declared. Declaring only `ledger.mutate` is a compile error — the undeclared `audit.write` is flagged.

---

### E-003 · Undeclared effects on `pure` flows are always fatal  
**Status:** ENFORCED (Stage A)  **Diagnostic:** LLN-EFFECT-003

A `pure` flow with any effect in the body — even logging — is rejected at compile time. There is no warning; it is always a hard error.

---

## K — Capability / Security Rules

### K-000 · Capability declarations must use typed SystemCapability objects — no raw strings  
**Status:** PLANNED (DRCM Phase 4)  **Diagnostic:** LLN-CAP-001

String-based capability declarations (`allow_call: "module::function"`) are **banned**. Raw strings in permission statements can trigger parsing exploits — a malformed or injected string can bypass string-matching logic and drop ambient privileges to the guest isolate.

All capability declarations use typed algebraic `SystemCapability` objects:

```lln
;; ✅ CORRECT — typed, compiler-verifiable
requires {
  SystemCapability.CallGate(
    module: "gateway",
    function: "charge_endpoint",
    enforce_tls: true
  ),
  SystemCapability.NetworkEgress(
    target: NetworkTarget.ExplicitHost("api.gateway.internal"),
    port: 443
  )
}

;; ❌ BANNED — LLN-CAP-001
authority {
  allow_call: "gateway::charge_endpoint"   ;; raw string — parsing exploit risk
}
```

**Validation pipeline:** Grammar compliance → Governance Verifier static proof (cross-references `.lmanifest`) → WAT Emitter (converts variants to 32-bit V_DPM bitmask) → DSS Runtime single-cycle AND gate.

**Note on named arguments:** `SystemCapability.CallGate(module: "...", function: "...", enforce_tls: true)` uses named constructor arguments — this is valid in config/contract contexts where structured record schemas are expected. Named arguments at regular **call sites** in flow bodies are NOT supported in Stage A (see S-007).

---

### K-001 · NetworkTarget must use algebraic variants — no wildcards  
**Status:** PLANNED (DRCM Phase 4)  **Diagnostic:** LLN-CAP-001

String wildcards (`"*"`) in network capability declarations are banned. All network targets must be:

```lln
type NetworkTarget =
  | ExplicitHost(String)   ;; exact FQDN or literal IP
  | UnrestrictedInternet   ;; requires explicit policy authorization + audit
```

```lln
// ✅ CORRECT
effects { network.outbound to ExplicitHost("api.stripe.com") }

// ❌ WRONG
effects { network.outbound to "*" }   // LLN-CAP-001: wildcard banned
```

---

### K-002 · UnrestrictedInternet requires explicit policy authorization  
**Status:** PLANNED (DRCM Phase 4)  **Diagnostic:** LLN-CAP-002

Using `UnrestrictedInternet` as a network target is a high-risk declaration. It must be accompanied by an explicit `authority {}` grant and produces a high-risk audit entry. It is never valid in `pure` or standard `guarded` flows.

---

### K-003 · Filesystem paths use canonical form — no traversal  
**Status:** PLANNED (DRCM Phase 4)  **Diagnostic:** LLN-CAP-003

File system capability paths are canonicalized at compile time. Relative path components (`../`), symlinks outside the declared root, and Unicode normalization bypasses are all rejected.

---

### K-004 · Secrets are SecureString — cannot flow to log / network / serialize sinks  
**Status:** ENFORCED (Stage A value-state checker)

| Sink | Diagnostic | Override |
|---|---|---|
| Log / audit output | LLN-SECRET-001 | `redact()` |
| Network / egress (http/https/fetch/email) | LLN-SECRET-002 | `redact()` |
| Serialize / JSON / audit record | LLN-SECRET-003 | `redact()` |

Any value that **reads from OR is derived from** `secret.get()`, `vault.read()`, `kms.decrypt()`, or `secrets.*` is classified `SecureString` and inherits all sink restrictions. Derivation propagates: a secret carried through `slice` / concatenation / member access / record field / a non-redacting call STAYS `SecureString` (`derivesFromSecret`). **`redact()` is the sole declassifier.**

> **Security fix 2026-06-16 (commit ea6163d).** This propagation was *previously documented but NOT enforced* — the guard keyed on the binding's direct type only, so a transformed secret (`let p = key.slice(0,5); http.post(url, p)`) reached the sink with **no diagnostic** (a verified credential-exfiltration fail-open). Now closed and regression-tested; the claim above is enforced, not aspirational.

**Bool-typed variables are exempt from LLN-VALUESTATE-004.** A `Bool` result derived from a secret comparison (e.g., `secret == expected`) has no injection surface — a boolean cannot carry secret content. The value-state checker does not propagate taint through Boolean derivations.

**`trap` statements clear the taint chain in the value-state checker.** A `trap COND : ERR` that fires before a tainted value reaches a sink acts as a hard abort — the checker treats the taint path as terminated at the trap point.

---

### P-002 · No cleartext semantic embedding across a trust boundary (LLN-PRIVACY-002)
**Status:** ENFORCED (Stage A value-state checker, 2026-06-16 — commit aeb420d). KB: [[logicn-privacy-embedding-egress]].

A semantic embedding vector is **invertible** — embedding-inversion (vec2text) reconstructs ~90%+ of the source text from a cleartext vector — so transmitting one to a network/egress sink leaks the source content. This is the confidentiality dual of `LLN-SECRET-002`.

| Sink | Diagnostic | Override |
|---|---|---|
| Network / egress (http/https/fetch/email) | LLN-PRIVACY-002 | `seal()` / `encrypt()` |

Any value typed `Embedding`/`EmbeddingResult`, produced by `EmbeddingModel.run`/`.infer`/`.embed` (or `embed`/`embedQuery`/`embedDocuments`), or **derived** from such a value, carries `embeddingDerived` and propagates through `slice`/concat/member/record (`derivesFromEmbedding`). **`seal()` / `encrypt()` is the sole declassifier** — unlike the generic taint chain, `validate`/`parse`/`decode` do NOT declassify an embedding (a decoded vector is still invertible). Crypto stays engine-side (govern-don't-absorb); the compiler recognizes the state transition. Composes with the pattern-10 verify-before-decrypt gate (cleartext may only be filtered at a trusted, post-decryption endpoint).

`LLN-PRIVACY-001` (distinct) is reserved for the declarative `privacy {}` block `deny protected X to Y` clause (parsed, Phase 10C+, not yet enforced).

---

### K-005 · Secret prefix scan uses cleartext tokens — not hash comparison  
**Status:** PLANNED (DRCM Phase 1)  **Diagnostic:** LLN-SECRET-BREACH (runtime trap 3001)

The DSS sink monitor stores 8-character cleartext prefix tokens (from secrets ≥ 12 chars) in a write-only `SecretSinkCache`. Stream matching uses direct substring search. SHA-256 hash comparison against streaming cleartext is architecturally broken and is never used.

---

## I — Isolation Rules (DRCM)

### I-001 · step allocates a new DWI isolate — no live pointers cross the boundary  
**Status:** PLANNED (DRCM Phase 5)  **Diagnostic:** LLN-STEP-002

Every `step` call:
1. Allocates a new DWI (Deterministic Workflow Isolate) — shared-nothing, max 4MB linear memory
2. Transfers input as an **immutable serialised snapshot** — no live pointers, no shared references
3. Injects a fuel budget computed from `policy::calculateStepFuelLimit`
4. Returns output as a new typed value — no shared state leaks back

Using `step` for a pure internal helper function is valid but wasteful. Use `step` only when crossing a trust boundary.

---

### I-002 · DSS owns V_DPM exclusively — guest isolates never mutate it  
**Status:** PLANNED (DRCM Phase 5)  **Diagnostic:** LLN-CAP-004 (if violation attempted)

The V_DPM 32-bit capability register lives in the DSS's own linear memory. Guest DWI isolates access current capability state ONLY through a bound read-only WASI import function. No guest module can address or mutate V_DPM directly.

---

### I-003 · DWI isolates are shared-nothing — no global mutable state  
**Status:** PLANNED (DRCM Phase 5)

Each DWI instance has its own sealed linear memory space. There is no global heap, no shared allocator, and no cross-instance pointer reachability. This is not a soft suggestion — the WASM linear memory model makes it structurally impossible to share memory between instances.

---

### I-004 · DSS itself is a .lln program compiled to WASM — no Rust in DSS  
**Status:** PRINCIPLE (architecture constraint, locked)

The Deterministic State Sentinel is implemented in `.lln`, compiled to WASM, and loaded by Wasmtime. There is no Rust DSS implementation. Wasmtime is the Trusted Computing Base (the native binary). DSS.wasm is the first module Wasmtime loads.

---

## M — Monotonic Rules (DRCM)

### M-001 · Permissions can only decrease — never increase after execution begins  
**Status:** PLANNED (DRCM Phase 4)  **Diagnostic:** LLN-MONO-001

The DPM (Dynamic Posture Matrix) is a monotonic subtraction engine. Once a capability bit is cleared (e.g., Bit 0 = network access revoked after an anomaly), it cannot be re-set during the same execution session. This is the **Monotonic Security Rule**.

```
V_DPM before fault:  0b11111111  (all capabilities active)
V_DPM after fault:   0b11111110  (network bit 0 cleared)
V_DPM after clear:   0b11111110  (cannot restore bit 0 — monotonic)
```

---

### M-002 · Capabilities cannot be expanded beyond Wasmtime launch configuration  
**Status:** PLANNED (DRCM Phase 5)  **Diagnostic:** LLN-MONO-002

WASI pre-opens directories and network sockets at Wasmtime instantiation time. The DSS DPM can drop these at runtime, but it can never grant a capability that was not present in the initial Wasmtime launch configuration. The DPM is bounded by the OCI/gVisor Layer 2 configuration.

---

### M-003 · Emergency policy overlays are one-way — cannot be reverted  
**Status:** PLANNED (DRCM Phase 4)  **Diagnostic:** LLN-MONO-003

When a `policy { emergency { ... } }` block fires (triggered by software signals: invariant failures, memory pressure, unexpected exception patterns), the resulting capability restriction is permanent for the current session. Overlays can escalate (Tier 1 → Tier 2 → Tier 3) but cannot de-escalate. This is by design.

---

## A — AI Authoring Rules

### A-001 · AI-generated flows MUST include intent {}  
**Status:** ENFORCED (Stage A governance verifier for secure flows)  **Diagnostic:** LLN-GOV-010

Every AI-generated `secure` or `guarded` flow requires an `intent {}` block. This is the primary audit anchor — it grounds the model's reasoning and gives reviewers a machine-verifiable statement of purpose.

---

### A-002 · AI must not self-grant capabilities  
**Status:** PRINCIPLE (governance pipeline)

An AI tool must never:
- Widen `effects {}` beyond what already exists in production `.lln` source
- Add a `secrets {}` binding that was not present before
- Broaden `authority {}` 
- Add `network.outbound` to a module that did not have it

All such changes must go through the propose → verify → approve pipeline (see C-005).

---

### A-003 · AI must not inject logic into intent {} strings  
**Status:** ENFORCED (Stage A governance verifier)  **Diagnostic:** LLN-GOV-010

`intent {}` strings are validated by the governance verifier. Any intent string containing logic operators, function names, URLs, or variable references is rejected. This is a **prompt-injection defense** — a malicious intent string cannot alter program semantics.

---

### A-004 · Forward-looking DRCM syntax must use @experimental_profile feature gates  
**Status:** PRINCIPLE + PLANNED (compiler directive, 2026-07)

AI tools and human developers writing forward-looking DRCM syntax (`invariant {}`, `step`, `policy { emergency {} }`, `limits {}` with DWI semantics) must wrap them in the `@experimental_profile` feature-gate directive rather than plain comments. This turns documentation markers into verifiable compiler signals.

Two canonical profiles:
- `drcm_stable_v0` — Patterns 1–3, 5. Compiles cleanly on Stage A today.
- `drcm_core_v1` — Patterns 4, 7, 8, 9. Uses forward-looking tokens. Must be inside `@experimental_profile`.

```lln
;; ✅ CORRECT — feature-gated DRCM syntax
secure flow processInvoicing(merchantId: String) -> Result<Void, Fault>
contract {
  intent { "Process invoices with full DRCM containment." }
  effects { gateway.charge }
  
  ;; Stable today (drcm_stable_v0):
  authority { allow_call: "gateway::charge_endpoint" }

  ;; Forward-looking — parsed but verification skipped until Phase 5 ships:
  @experimental_profile(name: "drcm_core_v1", status: "planned_phase_5") {
    limits    { max_memory: 4MB  max_instructions: 5_000_000 }
    economics { currency: "USD"  max_billing_quota_per_call: 500_00 }
    audit     { receipt_format: "canonical_cbor"  signing_algorithm: "ml-dsa-65" }
  }
}
{ return Ok(Void) }

;; ❌ WRONG — plain comment tells neither compiler nor AI tools anything
;; // DRCM-PLANNED: limits { max_memory: 4MB }
```

**Compiler behavior:**
- In `--release` build: `@experimental_profile` blocks are parsed but static verification and WAT injection are skipped
- In `--enable-experimental-profile=drcm_core_v1`: full verification and WAT gate injection active
- Bare `step` keyword in `--release` without an `@experimental_profile` wrapper: `LLN-DRCM-UNSUPPORTED`
- Under `@experimental_profile(drcm_core_v1)`: bare `step` is AST-rewritten to the `security::interim::BoundaryProxy` pipeline (Pattern 4-interim)

---

### A-005 · AI must not read or expose secrets in generated code  
**Status:** ENFORCED (Stage A value-state checker)  **Diagnostic:** LLN-SECRET-001/002/003

AI-generated code must never place a secret value into:
- A log statement
- A network call body
- A serialized response
- An error message or diagnostic output

Use `redact()` as the safe exit. The compiler will reject violations regardless of source.

---

## P — Process Rules

### P-001 · Run graph + full tests at every phase boundary  
**Status:** ENFORCED by Stop hook (`.claude/settings.json`)

The `run-phase-close.mjs` script runs 13 test suites + security audit + graph re-index on every Stop event. Never close a phase without this gate passing.

---

### P-002 · Update docs / KB immediately after each task  
**Status:** PRINCIPLE (feedback from session review)

Documentation debt compounds rapidly in a language project. Any change to syntax, semantics, behavior, or architecture must update the relevant KB doc in the same session as the implementation change.

---

### P-003 · DRCM implementation is blocked until other runtime work completes  
**Status:** PRINCIPLE (confirmed by user 2026-06-04)

Tasks #30-#44 (all DRCM phases) are pending. No DRCM implementation work begins until the primary runtime roadmap items are complete. Design documents may be updated; code may not be written.

---

### P-004 · Stage B must maintain parity with Stage A (R6 corpus gate)  
**Status:** ENFORCED (CI — tests/r6-corpus/)

The R6 bootstrap corpus (5 flows, 21 test cases) is the minimum parity gate. All Stage B self-hosted pipeline changes must pass the R6 gate before merge. Stage A == Stage B on all 21 cases is the definition of "100% Runtime-in-LogicN."

---

### P-005 · No Rust in the project except benchmarks  
**Status:** PRINCIPLE (architecture constraint, locked)

Everything is `.lln` compiled to WASM. The only exception is benchmark harness code where Rust is used for baseline comparison figures. DSS, DWI, and all runtime modules must be `.lln`.

---

## EC — Economics Rules

### EC-001 · economics {} is auto-by-default — only declare to override  
**Status:** ENFORCED (Stage A parser + economics-inference.ts)

When `economics {}` is omitted, the runtime auto-infers resource budgets from the CostGraph and ValueGraph. Only declare `economics {}` when you need to override defaults: set a hard billing cap, lock a specific currency, or specify a charge failure tolerance for financial operations.

---

### EC-002 · economics enforces three execution boundaries via DSS  
**Status:** PLANNED (DRCM Phase 5)  **Diagnostic:** LLN-EC-001

When compiled to WASM, the `economics {}` metadata is embedded in the `.lmanifest`. Before initializing a `step` isolate the DSS enforces:
1. **Static proof pass** — compiler estimates max loop cost vs `max_aggregate_flow_budget`; rejects if overflowable
2. **Dynamic volumetric gating** — DSS intercepts WASI gateway calls, blocks if cumulative cost exceeds `max_billing_quota_per_call`
3. **DPM degradation** — if `charge_failure_tolerance_ratio` is breached, DSS updates V_DPM to quarantine state

---

### EC-003 · charge_failure_tolerance_ratio triggers DPM quarantine — monotonic  
**Status:** PLANNED (DRCM Phase 5)  **Diagnostic:** LLN-EC-002

Once the charge failure rate exceeds the declared tolerance, the DSS sets the V_DPM quarantine bit. Per the Monotonic Rule (M-001), this cannot be reversed in the current session. The system operator must restart the DSS/Wasmtime session to restore full billing capability.

---

## ID — Identity & Attestation Rules

### ID-001 · All compiled artifacts must carry a signed .lmanifest  
**Status:** PLANNED (DRCM Phase 3)  **Diagnostic:** LLN-ID-001 (admission gate rejects unsigned artifacts)

Every `.wasm` binary emitted by the LogicN compiler must have a companion `.lmanifest` file:
- Signed with Ed25519 + ML-DSA-65 (post-quantum, NIST FIPS 204)
- Contains: source hash, derived constraints, proof obligations, governance signature, timestamp
- The DSS admission gate verifies the manifest signature before loading any DWI guest module

---

### ID-002 · ML-DSA-65 is the minimum post-quantum signing algorithm  
**Status:** PRINCIPLE (cryptography policy, locked)

LogicN uses ML-DSA-65 (CRYSTALS-Dilithium Level 3, NIST FIPS 204) for all governance-critical signatures:
- `.lmanifest` signing
- Epilogue Receipt signing (DSS)
- GovernanceSignature in ProofGraph

Ed25519 is retained for compatibility but ML-DSA-65 is required for any artifact claiming post-quantum security. AI tools must not generate code that downgrades signing to algorithms weaker than Ed25519.

---

### ID-003 · DSS verifies manifest hash + signature before loading any DWI module  
**Status:** PLANNED (DRCM Phase 3)

The DSS admission gate performs two checks:
1. SHA-256 hash of the WASM binary must match `sourceHash` in the manifest
2. ML-DSA-65 signature over the manifest must verify with the known compiler signing key

A WASM module that fails either check is rejected — it cannot be instantiated as a DWI isolate. There is no override or bypass flag. This is a hard gate.

---

## AU — Auditability Rules

### AU-001 · Epilogue Receipts are tamper-evident — not optional for high-trust flows  
**Status:** PLANNED (DRCM Phase 6)

For any flow with `economics { max_risk_liability: high }` or `audit { level: cryptographic_state_hash }`, an Epilogue Receipt must be generated and appended to the append-only ledger. The receipt structure:

```
R_E = Sign_DSS_ML-DSA-65( H( inputs ‖ outputs ‖ V_DPM_final ‖ timestamp ) )
```

The `epilogue {}` contract block auto-picks the receipt strategy from the ValueGraph when omitted. Explicitly declaring `epilogue { strategy: none }` on a high-trust flow is rejected with `LLN-AU-001`.

---

### AU-002 · Output streams pass through the Secret Sink Monitor before any external write  
**Status:** PLANNED (DRCM Phase 1 + Phase 7)  **Diagnostic:** LLN-SECRET-BREACH

Every output channel (stdout, log sinks, network egress, serialized records) must pass through the `SecretSinkCache` prefix-scan pipeline before data exits the sandbox boundary. This is not optional for flows with `secret.access` in their effects. The cleartext 8-character prefix token approach (K-005) is the enforcement mechanism.

---

### AU-003 · Audit records must not contain raw secrets  
**Status:** ENFORCED (Stage A value-state checker)  **Diagnostic:** LLN-SECRET-003

Any value classified `SecureString` or `TaintedString` must not appear in an `audit {}` record, Epilogue Receipt payload, or diagnostic output. Use `redact()` as the safe escape. The compiler enforces this regardless of the audit level.

---

## LC — Lifecycle Rules

### LC-001 · Contract updates are atomic — partial migrations are rejected  
**Status:** PLANNED (lifecycle governance, post-DRCM)

When a `contract {}` block is updated (e.g., `effects {}` widened, `invariant {}` added), the change must be:
1. Compiled with the full governance pipeline
2. Signed into a new `.lmanifest`
3. The DSS admission gate checks that the new manifest's signature chain is continuous with the previous version

Partial migrations — e.g., updating source without recompiling the manifest — are rejected at the admission gate.

---

### LC-002 · Deprecated syntax must not silently change meaning  
**Status:** PRINCIPLE (architectural stability, architecture-charter.md)

Per the Architecture Charter: LogicN is additive by design. No syntax is silently removed or changed. When a syntax feature is deprecated:
1. A deprecation warning is emitted at compile time (new LLN-DEP-xxx code)
2. The old syntax remains valid for at least one major version
3. A migration guide is added to the KB before deprecation fires

AI tools must not generate deprecated syntax in new code.

---

### LC-003 · @experimental_profile blocks graduate by removing the directive  
**Status:** PRINCIPLE

When a DRCM phase ships (e.g., Phase 5 ships `step` and DWI isolation), graduating a feature from `@experimental_profile(drcm_core_v1)` to stable requires:
1. Remove the `@experimental_profile(...)` wrapper
2. Recompile — the previously skipped verification now runs in full
3. Fix any new compilation errors (the static proof pass now runs on `limits {}`, `economics {}`, etc.)
4. Update `.lmanifest` and re-sign

No source rewriting required — the inner syntax is already correct.

---

## T — Testing & CI Rules

### T-001 · Every governance rule violation must have a negative test  
**Status:** PRINCIPLE + PLANNED (Phase 7 negative test suite)

Every `LLN-xxx` diagnostic code must have at least one test in `tests/negative/` that:
1. Contains a known violation
2. Expects the exact diagnostic code to be emitted
3. Expects the build to FAIL (or runtime to TRAP for runtime codes)

A rule without a negative test is not considered enforced. The negative test suite is the proof of enforcement.

---

### T-002 · DRCM containment tests must attempt violations — not just happy paths  
**Status:** PLANNED (DRCM Phase 7)  **Diagnostic:** N/A (test infrastructure)

Phase 7 containment tests must include:
- Path traversal attempts (`../../../etc/passwd`) against filesystem capabilities
- Infinite loop / fuel exhaustion attempts against DWI isolates
- Secret injection into output streams (canary value)
- V_DPM mutation attempts from guest code
- Manifest tamper (modified WASM binary, valid old signature)

Tests PASS only when the system REJECTS or TRAPS the violation. A containment test that succeeds silently is a bug.

---

### T-003 · Architecture patterns 1–6 must have working compiled examples  
**Status:** PENDING (task #46)

All patterns that compile today (Patterns 1–3, 5, and the stable portions of 4 and 6) must have working `.lln` examples in `tests/patterns/` that pass Stage A without errors. These examples are the canonical "it works" proof for each pattern.

---

### T-004 · R6 corpus is the Stage B parity gate — never break it  
**Status:** ENFORCED (CI)  **Diagnostic:** CI failure

The 5-flow, 21-test R6 bootstrap corpus in `tests/r6-corpus/` is the minimum parity gate between Stage A and Stage B. Any Stage B change that fails R6 is a blocking regression. The 21 tests must pass with Stage A == Stage B output on all cases.

---

### T-006 · Goal A acceptance: static proof eliminates runtime overhead (≤ 5% delta)  
**Status:** PLANNED (post-Phase 2)  **Reference:** logicn-engineering-goals.md Goal A

Benchmark a compiled `.lln` flow where all invariants are statically proved against an equivalent hand-written WAT module with no governance. Performance delta must be ≤ 5%. Validates that the static proof pass eliminates — not just amortises — runtime cost.

---

### T-007 · Goal B acceptance: single-cycle bitmask trap fires on revoked capability  
**Status:** PLANNED (post-Phase 5)  **Reference:** logicn-engineering-goals.md Goal B

Set V_DPM = 0b11111110 (network bit cleared). Attempt `network.outbound` from a DWI guest. Verify: (1) trapped before data exits; (2) trap fires in ≤ 1 CPU instruction cycle; (3) V_DPM unchanged; (4) subsequent attempt with network bit active succeeds.

---

### T-008 · Goal C acceptance: isolated fault does not crash supervisor or sibling isolates  
**Status:** PLANNED (post-Phase 5)  **Reference:** logicn-engineering-goals.md Goal C

Run three concurrent DWI instances: A (well-formed), B (infinite loop → fuel exhaustion), C (path traversal → capability violation). Verify: B → LLN-RESOURCE-001; C → LLN-CAP-003; A completes; DSS process continues; V_DPM updated for C's violation.

---

### T-005 · Phase-close cadence: graph + full tests at every Stop event  
**Status:** ENFORCED by Stop hook (`.claude/settings.json`)

Identical to P-001 but restated for the testing category: `run-phase-close.mjs` runs 13 test suites + security audit + graph re-index on every Stop event. This is the minimum CI gate for every development session.

---

## FG — Feature Gate Rules

### FG-001 · @experimental_profile is a first-class AST attribute — not a preprocessor directive  
**Status:** PLANNED (2026-07)

The `@` character is a **reserved first-class language token** indicating an Attribute Modifier. `@experimental_profile` is parsed directly into the AST — it is NOT a preprocessor that strips text before the main parse (which would create un-mediated blind spots violating the AI Authoring and Governance pillars).

**EBNF grammar (from notes/22):**
```ebnf
Attribute          ::= '@' Identifier '(' AttributeArgList ')'
AttributeArgList   ::= AttributeArg (',' AttributeArg)*
AttributeArg       ::= Identifier ':' StringLiteral
ContractBlock      ::= 'contract' '{' ContractElement* '}'
ContractElement    ::= Attribute? (LimitsBlock | EconomicsBlock | AuditBlock | InvariantBlock | ...)
```

**AST node:** stores `Name`, `Target` (profile name), `Status` (phase string) as metadata alongside the child block. The child block is fully parsed regardless of profile — grammar errors are always caught.

**Compiler behavior by flag:**
- `--release`: parse + grammar-check the block; skip WAT emission for nodes tagged with the profile
- `--enable-experimental-profile=drcm_core_v1`: full static verification + WAT gate injection
- Emit `LLN-FG-001` if `@experimental_profile` wraps a block that is already stable (cleanup signal)

---

### FG-002 · Stable profile (drcm_stable_v0) — Patterns 1–3, 5  
**Status:** ACTIVE (compiles today without @experimental_profile)

Syntax that is fully stable and requires no feature gate:
- `pure`, `guarded`, `secure` flow qualifiers
- `intent`, `effects`, `authority`, `request`, `response`, `types`, `secrets`, `economics`, `epilogue`, `audit`, `privacy`, `limits` (basic), `targets` contract sub-blocks
- Value-state checker (SecureString / TaintedString)
- LLN-SECRET-001/002/003 diagnostics

---

### FG-003 · Experimental profile (drcm_core_v1) — Patterns 4, 7, 8, 9  
**Status:** PLANNED (Phase 2–7)

Syntax requiring `@experimental_profile(name: "drcm_core_v1")`:
- `invariant {}` block + `ensure` keyword (Phase 2)
- `.lmanifest` signing + admission gate (Phase 3)
- `policy { emergency {} }` block (Phase 4)
- `step` keyword in flow body (Phase 5)
- Epilogue Receipt ML-DSA-65 signing (Phase 6)
- `limits { max_memory: NMB max_instructions: N }` with DWI enforcement (Phase 5)

Under `@experimental_profile(drcm_core_v1)`, the compiler:
- Parses the block correctly
- Skips WAT gate injection and static proof passes (until that phase ships)
- Rewrites bare `step` AST nodes to the `security::interim::BoundaryProxy` pipeline (Pattern 4-interim)

---

## LLN Diagnostic Code Registry

| Code | Category | Description | Status |
|---|---|---|---|
| LLN-GOV-001 | Syntax | `contract {}` inside flow body | ENFORCED |
| LLN-GOV-003 | Contract | `request`/`response` on non-API flow | ENFORCED |
| LLN-GOV-005 | Syntax | Flow qualifier mismatch | ENFORCED |
| LLN-GOV-010 | Contract | Missing `intent` on secure flow; or logic in `intent` | ENFORCED |
| LLN-GOV-017 | Contract | `cyber_physical_hardening` without ASIC + high liability | ENFORCED |
| LLN-GOV-018 | Contract | `liability {}` declared in source | ENFORCED |
| LLN-EFFECT-001 | Effect | Undeclared effect in body | ENFORCED |
| LLN-EFFECT-002 | Effect | Declared effects don't match body | ENFORCED |
| LLN-EFFECT-003 | Effect | Effect in `pure` flow | ENFORCED |
| LLN-SECRET-001 | Security | Secret flows to log/audit sink | ENFORCED |
| LLN-SECRET-002 | Security | Secret flows to network/egress | ENFORCED |
| LLN-SECRET-003 | Security | Secret flows to serialize/record | ENFORCED |
| LLN-PRIVACY-002 | Privacy | Cleartext semantic embedding flows to network/egress (vec2text-invertible) | ENFORCED |
| LLN-PRIVACY-001 | Privacy | `privacy {}` block `deny protected X to Y` clause | PLANNED Phase 10C+ |
| LLN-CRYPTO-PQ-001 | Crypto | `crypto.sign` in a certified profile must declare a PQ/hybrid algorithm (crypto.sign.hybrid/mldsa65/slhdsa) | ENFORCED (certified profiles) |
| LLN-SUBSTRATE-001 (crypto-on-core) | Crypto | crypto.hash/sign/verify/**encrypt/decrypt/seal** must run on a deterministic bit-exact lane | ENFORCED |
| LLN-TENANT-001 | Security | Dangling `tenant.scope` caller-scope binding — declared with no `.tenant_scoped` data-access effect to bind (advisory) | ENFORCED (R&D 0109) |
| LLN-TENANT-002 | Security | Tenant-scoped data access (`*.tenant_scoped`) not bound to the caller's proven scope (`tenant.scope` marker) — deny-by-default IDOR / OWASP-A01 compile gate, fail-closed in every profile. Capability intersection over the manifest, NOT an AST/query rewriter. Proves the binding is *declared*; the body-dataflow proof is the deferred LLN-TENANT-003. Spec: [[logicn-tritmesh-feature-gap-analysis-2026-06-24]] | ENFORCED (R&D 0109) |
| LLN-PROOF-CERT-001 | Security | Certified profile REFUSES a Phase-1 placeholder / undecodable zk_snark_receipt proof (circuit `logicn-sha256-v0.1` / type `groth16-phase1`) — its verify() is a public-input recompute (forgeable), so it cannot ride into a certified epilogue receipt. Deny-by-default (`generateEpilogueReceipt`, certified path). CWE-347/345. | ENFORCED (R&D 0094, certified path) |
| LLN-PROOF-CERT-002 | Security | Certified profile rejected a zk_snark_receipt proof that did not `verify() === true` against the claimed input (or no verifier supplied — deny-by-default). | ENFORCED (R&D 0094, certified path) |
| LLN-SECRET-BREACH | Security | Secret detected in output stream (runtime trap 3001) | PLANNED Phase 1 |
| LLN-SECRET-FATAL | Security | Secret breach caused DSS permission drop | PLANNED Phase 1 |
| LLN-CAP-001 | Capability | Wildcard `*` in NetworkTarget | PLANNED Phase 4 |
| LLN-CAP-002 | Capability | `UnrestrictedInternet` without policy authorization | PLANNED Phase 4 |
| LLN-CAP-003 | Capability | Path traversal in filesystem capability | PLANNED Phase 4 |
| LLN-CAP-004 | Capability | Guest attempted V_DPM mutation | PLANNED Phase 5 |
| LLN-CAP-CONFUSION | Capability | Capability request fails structural match | PLANNED Phase 4 |
| LLN-INV-001 | Invariant | Pre-condition `ensure` failed before body | PLANNED Phase 2 |
| LLN-INV-002 | Invariant | Post-condition `ensure` failed after body | PLANNED Phase 2 |
| LLN-INV-003 | Invariant | `invariant {}` misplaced (outside `contract {}`) | PLANNED Phase 2 |
| LLN-MONO-001 | Monotonic | Attempted capability expansion (V_DPM monotonic violation) | PLANNED Phase 4 |
| LLN-MONO-002 | Monotonic | Capability exceeds Wasmtime launch config | PLANNED Phase 5 |
| LLN-MONO-003 | Monotonic | Emergency overlay attempted de-escalation | PLANNED Phase 4 |
| LLN-STEP-001 | Isolation | `step` keyword in contract block | PLANNED Phase 5 |
| LLN-STEP-002 | Isolation | Cross-boundary call without `step` | PLANNED Phase 5 |
| LLN-RESOURCE-001 | Resource | Fuel exhaustion in DWI isolate | PLANNED Phase 5 |
| LLN-TERM-001 | Termination | `decreases` annotation violation | ENFORCED |
| LLN-DRCM-UNSUPPORTED | Feature Gate | `step` or DRCM syntax used without `@experimental_profile` wrapper in `--release` | PLANNED (parser, 2026-07) |
| LLN-FG-001 | Feature Gate | `@experimental_profile` wraps already-stable syntax (cleanup signal) | PLANNED (parser, 2026-07) |
| LLN-EC-001 | Economics | Static cost overflow — max_aggregate_flow_budget exceeded by estimated loop | PLANNED Phase 5 |
| LLN-EC-002 | Economics | charge_failure_tolerance_ratio breached — DPM quarantine triggered | PLANNED Phase 5 |
| LLN-ID-001 | Identity | Manifest missing, tampered, or signature verification failed | PLANNED Phase 3 |
| LLN-AU-001 | Auditability | `epilogue { strategy: none }` on high-trust flow (max_risk_liability: high) | PLANNED Phase 6 |
| LLN-DEP-001 | Lifecycle | Deprecated syntax in use — migration available | PLANNED (post-DRCM) |
| LLN-RES-001 | Resilience | `retry` on `database.write`/`gateway.charge` without `idempotent: true` | ENFORCED (task #58) |
| LLN-FAULT-001 | Resilience | `on_denial_fault retry` — retrying a capability denial attempts a re-grant, colliding with deny-only monotonicity (LLN-MONO-001) | ENFORCED (0017) |
| LLN-FAULT-002 | Resilience | `fallback <flow>` whose effect-set is not a subset of the post-fault capability set | PLANNED (0017 follow-on — needs fallback symbol resolution) |
| LLN-FAULT-003 | Resilience | Fail-OPEN fault action — `log` outside the `on_rotation_fault` back-compat opt-in (keeps serving past the fault) | ENFORCED (0017) |
| LLN-FAULT-004 | Resilience | `fallback <flow>` recursion/cycle beyond depth-1 | PLANNED (0017 follow-on) |
| LLN-OBS-001 | Observability | Explicit `observability {}` on a `pure` flow (no side effects to observe) | ENFORCED (task #58) |
| LLN-INV-000 | Invariant | **RUNTIME** — `unreachable` hardware trap fired; DSS emits Audit Event (CBOR Tag 410) | PLANNED DRCM Phase 5 (#76) |
| LLN-INV-001 | Invariant | `ensure expr` statically proved false at compile time | ENFORCED (task #36) |
| LLN-INV-003 | Invariant | `invariant {}` block declared but empty | ENFORCED (task #36) |
| LLN-INV-004 | Invariant | `ensure` expression references symbol not in flow's parameter scope | ENFORCED (task INV-004) |
| LLN-ASSUME-001 | Proof-Tracing | `assuming {}` condition not found in referenced flow's manifest ProofObligations | PLANNED (task #73) |
| LLN-ASSUME-002 | Proof-Tracing | Referenced manifest signature invalid or expired | PLANNED (task #74) |
| LLN-ASSUME-003 | Proof-Tracing | Manifest sourceHash mismatch — referenced flow has changed since manifest was signed | PLANNED (task #74) |
| LLN-ASSUME-004 | Proof-Tracing | Condition found as `runtime-precheck` only (partial proof — WAT gate still needed) | PLANNED (task #74) |
| LLN-SYNTAX-LEGACY-003 | Syntax | Inline `policy {}` block between contract and body. Use `access {}` instead. `policy` keyword reserved for State Mutation Governance. | ADVISORY (v2.1) |
| LLN-STATIC-001 | Static | `static` declaration value is not a compile-time constant (contains runtime expressions) | PLANNED (v2.1) |
| LLN-STATIC-002 | Static | `static` name declared more than once in the same scope | PLANNED (v2.1) |
| LLN-BF-001 | Bitfield | Two fields in the same `bitfield` declaration use the same bit position | PLANNED (v2.1) |
| LLN-BF-002 | Bitfield | Bit position exceeds 31 (V_DPM is a 32-bit register) | PLANNED (v2.1) |
| LLN-GATE-001 | Gate | `gate(condition)` references a condition not found in knownDomainGuards. Full enforcement in Phase 5. | PLANNED (v2.1) |
| LLN-GATE-002 | Gate | `gate {}` wrapping a `pure flow` — pure flows have no side effects; gate is redundant | PLANNED (v2.1) |
| LLN-IMPORT-001 | Import | `import "./path.lln"` target file not found at resolved path | PLANNED (v2.1) |
| LLN-IMPORT-002 | Import | Imported file has parse errors — cannot merge DAG | PLANNED (v2.1) |
| LLN-IMPORT-003 | Import | Circular import detected in import chain | PLANNED (v2.1) |
| LLN-IMPORT-004 | Import | Imported symbol name conflicts with local definition | PLANNED (v2.1) |
| LLN-ACCESS-001 | Access | `access {}` grant references unknown capability name | PLANNED (v2.1) |
| LLN-ACCESS-002 | Access | `grant` capability not declared in flow's `effects {}` | PLANNED (v2.1) |
| LLN-ASSIMILATE-001 | Assimilate | `assimilate` plugin declared outside `boot.lln` | PLANNED (v2.1) |
| LLN-ASSIMILATE-002 | Assimilate | `assimilation_memory_budget` not declared in `governance {}` | PLANNED (v2.1) |
| LLN-ASSIMILATE-003 | Assimilate | Assimilated plugin has no `access { grant }` block | PLANNED (v2.1) |

---

## ST — Static Declaration Rules (new in v2.1)

### ST-001 · static value must be a compile-time constant
**Status:** PLANNED (v2.1 compiler)  **Diagnostic:** LLN-STATIC-001

A `static` declaration value must be resolvable at compile time. Runtime expressions (function calls, parameter references, conditionals) are not permitted.

```lln
// ✅ CORRECT
static MAX_RETRY = 3
static FLOOR_PROOF = 3

// ❌ WRONG — LLN-STATIC-001
static MAX_RETRY = getConfig("retry")   // runtime call — not a compile-time constant
```

---

### ST-002 · static names must be unique in scope
**Status:** PLANNED (v2.1 compiler)  **Diagnostic:** LLN-STATIC-002

A `static` name may not be declared more than once in the same scope. Redeclaration is a compile error.

---

## BF — Bitfield Rules (new in v2.1)

### BF-001 · bitfield bit positions must not overlap
**Status:** PLANNED (v2.1 compiler)  **Diagnostic:** LLN-BF-001

Two fields in the same `bitfield` declaration must not use the same bit position. Overlap is a compile error — it would produce ambiguous bitmask values.

```lln
// ❌ WRONG — LLN-BF-001
bitfield V_DPM {
  network_outbound: 0
  storage_write: 0   // duplicate bit position — error
}
```

---

### BF-002 · bitfield bit positions must not exceed 31
**Status:** PLANNED (v2.1 compiler)  **Diagnostic:** LLN-BF-002

V_DPM is a 32-bit register. Bit positions are 0–31. Any `bitfield` declaration using a position ≥ 32 is a compile error.

```lln
// ❌ WRONG — LLN-BF-002
bitfield V_DPM {
  overflow_bit: 32   // bit position out of range — V_DPM is 32-bit
}
```

---

## PT — Proof-Tracing Rules (new in v2.1)

### PT-001 · assuming() is a proof-tracing block — not a runtime conditional
**Status:** PLANNED (tasks #73/#74)  **Diagnostics:** LLN-ASSUME-001 through LLN-ASSUME-004

Syntax:
```lln
assuming(flowRef, "claim") {
  // code that may only execute if "claim" is proved in flowRef's manifest
}
```

`assuming(flowRef, "claim")` traces a proof obligation from another flow's `.lmanifest`. The `claim` string must appear in the referenced flow's `ProofObligations`. If the claim cannot be verified (missing, invalid signature, or source hash mismatch), the containing code block is rejected.

This is not a runtime `if`-statement — it is a **compile-time proof assertion**. The block is emitted only if the claim is verifiable at compile time.

---

## GT — Gate Rules (new in v2.1)

### GT-001 · gate condition must reference a known Domain Guard Policy
**Status:** PLANNED (v2.1 governance verifier; full enforcement Phase 5)  **Diagnostic:** LLN-GATE-001

A `gate(condition)` block's condition must name a Domain Guard Policy found in `knownDomainGuards`. At Phase 5, unresolvable gate conditions are a hard error. Currently emits a warning.

```lln
// ⚠️ LLN-GATE-001 — 'unknown_policy' not in knownDomainGuards
gate(unknown_policy) {
  flow sensitiveOp() -> Result<Void, Fault>
  contract { ... }
  { ... }
}
```

---

### GT-002 · gate {} wrapping a pure flow is redundant
**Status:** PLANNED (v2.1 governance verifier)  **Diagnostic:** LLN-GATE-002

`gate {}` blocks add an admission guard check (V_DPM bit 8). `pure` flows have no side effects by definition; the gate check is redundant and signals a likely authoring error.

```lln
// ⚠️ LLN-GATE-002 — gate wraps a pure flow
gate(admin_only) {
  pure flow helper(x: Int) -> Int   // pure: no effects, gate is redundant
  contract { ... }
  { return x + 1 }
}
```

---

## Comment Syntax

LogicN supports three comment forms. All are equally valid; `//` is canonical in generated code.

| Syntax | Token | Purpose |
|---|---|---|
| `// text` | `comment` | Code documentation — discarded after parse |
| `/// text` | `docComment` | API documentation — extracted by doc tooling |
| `;; text` | `govComment` | Governance annotation — scanned by verifier, stored in .lmanifest |
| `/* text */` | `comment` | Block code comment — discarded after parse |
| `;` (trailing) | `newline` | Optional statement separator — silently collapsed |

The `;;` governance annotation is a first-class token. Its text is collected into
`governanceAnnotations[]` in the .lmanifest narrative, alongside ProofObligations.

---

## IM — Import Rules (new in v2.1)

### IM-001 · import file must exist at the resolved path
**Status:** PLANNED (v2.1 compiler)  **Diagnostic:** LLN-IMPORT-001

`import "./path.lln"` resolves relative to the importing file's directory. A missing file is always a hard error — the DAG merge cannot proceed.

```lln
// ❌ WRONG — LLN-IMPORT-001
import "./nonexistent.lln"
```

---

### IM-002 · imported file must be error-free before merge
**Status:** PLANNED (v2.1 compiler)  **Diagnostic:** LLN-IMPORT-002

An imported `.lln` file with parse errors cannot contribute symbols to the DAG. The importer fails with the nested error list. Fix the imported file first.

---

### IM-003 · circular imports are rejected
**Status:** PLANNED (v2.1 compiler)  **Diagnostic:** LLN-IMPORT-003

If file A imports file B and file B imports file A (directly or transitively), the import chain is circular. The compiler detects the cycle and emits `LLN-IMPORT-003` on the second edge that closes the cycle.

---

### IM-004 · imported symbol collisions are a warning
**Status:** PLANNED (v2.1 compiler)  **Diagnostic:** LLN-IMPORT-004 (warning)

If an imported symbol name conflicts with a locally-defined name, the local definition wins and `LLN-IMPORT-004` is emitted as a warning. Use explicit aliases (`import "./path.lln" as X`) to avoid collisions.

---

## AC — Access Block Rules (new in v2.1)

### AC-001 · access {} grant must reference a known capability name
**Status:** PLANNED (v2.1 governance verifier)  **Diagnostic:** LLN-ACCESS-001 (warning)

A `grant X` line in an `access {}` block must name a capability found in the capability registry. Typos and invented capability names produce a warning; full enforcement at Phase 5.

```lln
// ⚠️ LLN-ACCESS-001 — 'network.telepathy' not in capability registry
access {
  grant network.telepathy
}
```

---

### AC-002 · access {} grant capability must be declared in effects {}
**Status:** PLANNED (v2.1 governance verifier)  **Diagnostic:** LLN-ACCESS-002 (warning)

`access { grant X }` is a boundary declaration. Granting a capability that is not listed in the flow's `effects {}` is likely an authoring error — the capability cannot be exercised if the effect is not declared. Emits a warning.

```lln
// ⚠️ LLN-ACCESS-002 — grant references network.outbound but effects {} doesn't declare it
flow example() -> Void
contract {
  intent { "Example flow." }
  effects { audit.write }
}
access {
  grant network.outbound   // LLN-ACCESS-002: not in effects {}
}
{ ... }
```

---

## AS — Assimilation Rules (new in v2.1)

### AS-001 · assimilate plugins must be declared in boot.lln
**Status:** PLANNED (v2.1 compiler)  **Diagnostic:** LLN-ASSIMILATE-001 (warning)

Hot-Code Residency plugins (`import plugin assimilate`) are boot-time only. Declaring them outside `boot.lln` is a governance violation — assimilation cannot be triggered at runtime after the DSS bootstrap completes.

---

### AS-002 · assimilation_memory_budget must be declared
**Status:** PLANNED (v2.1 compiler)  **Diagnostic:** LLN-ASSIMILATE-002 (warning)

Any file that assimilates a plugin must declare `assimilation_memory_budget` in its `governance {}` block. Without a budget cap, the DSS cannot enforce memory isolation for the hot-code resident.

---

### AS-003 · assimilated plugin must have an access { grant } block
**Status:** PLANNED (v2.1 compiler)  **Diagnostic:** LLN-ASSIMILATE-003 (error)

An assimilated plugin with no `access { grant }` block inherits no capabilities — it cannot perform any governed operation. This is almost always an authoring error. `LLN-ASSIMILATE-003` is a hard error: the assimilation is rejected until an explicit `access {}` block is added.

```lln
// ❌ WRONG — LLN-ASSIMILATE-003
import plugin assimilate "./crypto.lln" as crypto {
  contract { intent { "Fast crypto routines." } }
  // no access {} block — error
}

// ✅ CORRECT
import plugin assimilate "./crypto.lln" as crypto {
  contract { intent { "Fast crypto routines." } }
  access { grant secret.access }
}
```

---

## CLI output redaction — fail-closed tripwire

**Status:** ENFORCED (R&D 0094-redact PART-A)  **Diagnostic:** LLN-CLI-REDACT-001

CLI output is scrubbed by `redactCliOutput` / `redactCliOutputChecked` (`logicn-core-cli/src/security.ts`) before it is printed. Two detector classes:

- **Assignment forms** (`api_key=…`, `token=…`, `password=…`, `secret:…`, `cookie:…`, `bearer …`) — the key/prefix is preserved, the value becomes `SecureString(redacted)`.
- **Bare credential tokens** (PEM private-key blocks, cloud access-key IDs `AKIA…`, VCS PATs `ghp_…`, Slack `xox?-…`, JWTs `eyJ….eyJ….…`) — redacted **regardless of surrounding context**, closing the prior fail-OPEN where a bare token with no `key=` prefix printed as cleartext.

A bare-token match is a **tripwire**: a raw credential reaching CLI output means an upstream boundary already leaked it. `redactCliOutputChecked` reports `{ tripwire, markers }`; `formatCliResult` surfaces `LLN-CLI-REDACT-001` (with the marker names, never the value) so an operator investigates the source rather than trusting the scrub silently. Redaction is best-effort defense-in-depth — never the primary secret boundary (`LLN-SECRET-001..003` + `redact()` remain the compiler-enforced sink discipline); it can only ever add safety.

---

## Sound-erasure obligation for non-overwritable substrates

**Status:** ENFORCED at the decision core + the signed discovery rail (R&D 0116/0118; `admitSubstrateWrite` + `admitStorageSubstrate` BUILT — `logicn-tower-citizen/src/substrate-erasure.ts`, 20/20 tests: the lying-WORM-drive attack is closed end-to-end — `overwrite` needs a verified Ed25519-signed `storage.admit` attestation, else fail-closed to `crypto-only`); the Stage-1 compiler trap + Stage-3 crypto-erase witness are owner-gated; the physical Stage-2 dispatch seam + the medium-binding TOCTOU closure are HW-gated (#102-106)  **Diagnostic:** LLN-RETAIN-001

LogicN's secret-erasure is **overwrite-based** (zero the arena page / derived-secret buffer; B2/B2b in `wat-emitter.ts`). On **write-once/fixed media** that invariant is silently false — a thermally-fixed photorefractive hologram cannot be erased optically (>170 °C re-heat only), WORM glass is physically immutable, and unfixed holograms leave residual/decaying gratings (data remanence). The sound discipline is **cryptographic erase** (NIST SP 800-88 Rev. 1 "Purge"): seal *before* writing, destroy the key to "delete".

The invariant: a substrate admitted via the storage capability whose media is write-once/fixed is flagged `eraseModel: "crypto-only"`; on it (1) **only KEM-DEM ciphertext may be written** — a cleartext-secret-tainted value reaching it is a fail-closed compile/admission error (extends `LLN-SECRET-002` / `LLN-PRIVACY-002` taint to a new sink class); (2) the DEK lives on overwritable digital silicon and "deletion" = key destruction, never media overwrite; (3) erasure emits a key-destruction **witness** (no read-back-verify of the medium is possible). No new crypto — reuses KEM-DEM + key custody (0 patents). Buildable surface: a capability-axis split in `photonic-admission.ts` (`storage.mount` vs `photonic.reprogram`) carrying `eraseModel`, plus one SealTaint sink rule.

---

## Workspace-index integrity (anti poisoned-index)

**Status:** ENFORCED (R&D 0098-intel-index; `logicn-devtools-intelligence/src/indexer.ts`, +5 tests)  **Diagnostics:** LLN-INTEL-001 (integrity), LLN-INTEL-002 (path traversal)

The `workspace.lindex` cache TRUSTS its stored `flows`/`fileHashes` on an incremental build (a file whose stored hash matches is not re-parsed — its cached flows are reused). An attacker who can write the `.lindex` could therefore pair **fabricated flows** with a correct content hash and have them trusted unverified (poisoned-index). 

- **LLN-INTEL-001** — the whole index is bound under an **integrity tag** (`computeIndexIntegrity`): `hmac-sha256:` when `LOGICN_INDEX_HMAC_KEY` is set (tamper-**resistant**, unforgeable without the key), else `sha256:` (tamper-**evident**). It is re-verified on load (`verifyIndexIntegrity`, constant-time); any mismatch / absence → the cached index is **discarded and the workspace is fully re-parsed** (fail-closed, never silent). Set the key in untrusted-FS environments.
- **LLN-INTEL-002** — a caller-supplied `indexDir` containing a `..` path-traversal segment is **refused** before any write (CWE-22), so a poisoned indexDir cannot plant/overwrite a `workspace.lindex` outside its intended root. A deliberate absolute/sub-path with no `..` is allowed.

---

## Declared-but-inert safety control must fail loud

**Status:** ENFORCED (R&D 0120; `resilience-inference.ts` `checkResilienceViolations`, consumed by `governance-verifier.ts`)  **Diagnostic:** LLN-RES-CB-PENDING (warning)

A safety control that is parsed + stored but **not yet enforced** must never read as enforced (the honest-posture / never-silent principle). A flow that declares `resilience { fallback circuit_breaker }` gets a **warning**: the circuit-breaker posture-trip is a NO-OP today (DRCM Phase 5), so on failure it will not actually trip the defensive-mode posture bit — do not rely on it for graceful degradation. The declaration is valid (warning, not error); the author is told to track the breaker externally or choose an enforced fallback (`propagate` / `return_cached` / `return_default` / `quarantine` / `escalate`) until DRCM Phase 5 lands. (The sibling rule `LLN-RES-001` (error) forbids retry on a mutation effect without `idempotent: true`.)

---

## SBOM integrity — never claim coverage you don't have

**Status:** ENFORCED in the emitter (R&D 0120-F3; `logicn-core-compiler/src/sbom.ts` `generateCycloneDxSbom`, 6 tests)  **Diagnostic:** LLN-SBOM-001

The CycloneDX 1.5 SBOM is assembled from the resolved `PackageManifest` set (name / version / sha256 `hash` / `signerKeyId` / `registry` / `effects` / `capabilities`). Fail-closed posture: an SBOM must **never claim integrity it does not have**. A component without a well-formed `sha256:<64 hex>` content hash is emitted **without** a `hashes` entry, tagged `logicn:integrity = UNVERIFIED`, raised as **LLN-SBOM-001** (error), and the whole BOM is marked `logicn:complete = false`. A consumer gates on `result.complete` (reject an incomplete SBOM) rather than trusting a document that silently omits an unverifiable component. Output is **deterministic** (component order = input order; no wall-clock unless a timestamp is supplied) for reproducible builds. The governance footprint (effects/capabilities/signer/registry) rides as CycloneDX `properties` — a *governed* SBOM, not just a dependency list.

---

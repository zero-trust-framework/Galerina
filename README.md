# LogicN

**A governance-first programming language and runtime for high-assurance software.**

LogicN is built for organisations where software failure is not acceptable — financial platforms, healthcare systems, government services, and regulated enterprise. Every execution is **declared, verified, and audited** by design, not by convention.

---

## What LogicN does

**Declares governance in source code.** Every flow declares its intent, effects, capability boundaries, and invariants in a `contract {}` block. The compiler verifies these at build time. There is no runtime surprise.

**Enforces at runtime via the Governed Tower.** The DSS supervisor tracks the V_DPM (Virtual Dynamic Posture Matrix) register — every capability use is a bitmask check, every trap produces a structured AuditEvent, and rollback is clean (`unreachable` fires before the next instruction). *Today this runs as the Stage-A TypeScript simulation; the real `DSS.wasm` component is Post-P9 (#102–106).*

**Produces a cryptographic audit trail.** Every governed execution generates an Epilogue Receipt (sha256_seal or zk_snark). Every security trap appends to an append-only audit log (CBOR Tag 410 AuditEvent). **Hybrid Ed25519 + ML-DSA-65 (NIST FIPS 204) signing is shipped** on the attestation, proof-graph, and bridge surfaces (both halves required — no post-quantum downgrade; certified mode now *mandates* the ML-DSA key). The `.lmanifest` itself is still **Ed25519-only**, with the hybrid upgrade gated on key custody (#34).

**Compiles to WebAssembly.** Governance is verified by the compiler's pipeline at build time and enforced on the Stage-A runtime today. Full in-WASM execution enforcement (self-hosting, P9) is *in progress* — the self-hosted `lexer.lln` `tokenize` now achieves **byte-for-byte Stage-A interpreter == Stage-B real-WASM parity** through the #105 admission gate (#143, 2026-06-06); the remaining gate is extending that parity to the parser/type-checker/governance-verifier flows.

---

## Who it is for

| Sector | Why LogicN |
|---|---|
| **Financial platforms** | Every payment flow declares and enforces its effects. Audit trail by default. PCI DSS governance built in. |
| **Healthcare systems** | PII/PHI is typed and tracked. Redaction is enforced at the type level before data reaches any audit sink. |
| **Government / defence** | Designed for air-gapped deployment, no cloud dependency. BitNet CPU inference for governed AI is in early integration (Inference Tower ~12%). |
| **Enterprise regulated** | OWASP attack vectors blocked at the compiler. Supply-chain provenance via signed manifests (Ed25519 today; ML-DSA-65 post-quantum planned). |

> **New here?** → [**SETUP.md**](SETUP.md) — install · run your first benchmark · Hello World with full governance comments

---

## Build Progress

**Post-Quantum and Hardware Security**
```
████████████░░░░░░░░░░░░░░░░░░░░  38%
```

**Photonic / Ternary Computing**
```
▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   3%
```

**Passive Execution Plans and Target Bridges**
```
▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░  22%
```

**Governed Runtime (DRCM Phases 1–7)**
```
████████████████████████████████  100%
```

**TypeScript Runtime — Stage A**
```
████████████████████████████████  100%
```

**Tests — 48/48 packages**
```
████████████████████████████████  100%  (4,465 tests · 0 failures)
```

**Stage B Self-Hosting (WAT Linear Memory)**
```
█████████████████████████░░░░░░░  87%
```

**AI Inference Tower (BitNet / GroqCloud / NVFP4)**
```
████░░░░░░░░░░░░░░░░░░░░░░░░░░░░  12%
```

| Layer | % |
|---|---|
| **Specification / KB** | 100% |
| **Lexer** | 100% |
| **Parser** | 100% |
| **Governance Verifier** | 100% |
| **Contract blocks** | 100% |
| **Value-state checker** | 100% |
| **DRCM Phases 1–7** | 100% |
| **CBOR Manifests (RFC 8949)** | 100% |
| **Governed Tower — Stage A simulation** (real DSS.wasm is Post-P9, #102–106) | 100% |
| **Tests — full suite** | 100% |
| **DevTools** | 100% |
| **Security/architecture audit (2026-06-15)** | deep audit logged 48 findings (3 security · rest scaffold/wiring/honesty); 8 open HIGH tracked in the [task ledger](docs/Knowledge-Bases/logicn-task-ledger.md) |
| **Security audit (2026-06-16)** | adversarial cycle audit, 23 confirmed; **CRYPTO-001 (silent PQ downgrade in certified mode) FIXED** (`ERR_CERTIFIED_NO_PQ_KEY`); CRYPTO-002 (quantum-bridge opt-in hybrid) open; 14 findings pending re-verification |
| **Type checker** | 90% |
| **Effect checker** | 90% |
| **WAT emitter** | 88% |
| **Runtime interpreter** | 87% |
| **Stage B self-hosting — compilation parity (interpreter)** | 100% (R6 corpus: Stage-A == Stage-B) |
| **Stage B self-hosting — governance verified** | 87% |
| **Stage B self-hosting — WASM execution (P9)** | `tokenize` byte-parity ACHIEVED (#143 — Stage-A interpreter == Stage-B real WASM, 12-input corpus); parser/type-checker/governance-verifier WASM parity remain |
| **Ext packages** | 80% |
| **Governance signatures** | 100% Ed25519 (keygen + build-signing + admission-verify shipped); ML-DSA-65 post-quantum upgrade planned (#34, library-gated) |
| **Package resolver** | 75% |
| **Economics Layer** | 68% |
| **AI Inference Tower** | 12% |
| **Production deployment (P9 pending)** | 75% |

---

> **Full roadmap** → [docs/Knowledge-Bases/logicn-roadmap.md](docs/Knowledge-Bases/logicn-roadmap.md) — current forward view (160 tasks), P9 critical path, security remediation, Post-P9 sequencing
>
> **Recent cycle (2026-06-16)** → CRYPTO-001 certified-mode PQ-downgrade fix · `crypto-ops` benchmark now measures ML-DSA-65 + hybrid (PQ-tax visibility: hybrid verify ≈1.75 ms / ~17× Ed25519, kept at amortized admission boundaries) · #199 Phase 1.5 (ffsim attestation + audit lifecycle) · roadmap #125/#126 filed · photonic-ternary-hash (notes/35) adjudicated → rejected (crypto-on-core). 48/48 packages · 4,465 tests.
>
> **Recent cycle (2026-06-15)** → #200 integrity close-out (doc reconciliation · #177 graph fix · 48-finding deep audit) + the **#201 calibration-as-attestation** lane opened (measured bridge-manifest attestation: fidelity floor + tolerance witness + quantization-method declaration — contract foundation, not yet Tower-wide-enforced) + sentinel/border-check hardening. Details: [task ledger §5–6](docs/Knowledge-Bases/logicn-task-ledger.md) · [external idea-mining](docs/Knowledge-Bases/logicn-external-idea-mining-2026-06-15.md).

---

*Stage A (TypeScript Runtime) is the **production-hardened path** — 48/48 packages, 4,465 tests, 0 test failures (a 2026-06-15 deep audit logged 48 findings — mostly scaffold/wiring/honesty items, tracked in the ledger).
Stage B (Runtime in LogicN) is **in progress (P9 self-hosting bootstrap)**: the self-hosted lexer/parser/checker `.lln`
sources reach Stage-A == Stage-B parity through the interpreter (R6 corpus, 100%), and the self-hosted `lexer.lln`
`tokenize` now reaches **byte-for-byte Stage-A interpreter == Stage-B real-WASM parity** through the #105 admission
gate (#143, 2026-06-06; `tests/wat-p9-tokenize-parity.test.mjs`). The remaining gate is extending that WASM parity to
the parser/type-checker/governance-verifier flows. Stage B self-hosting is **not yet
100%**; see the roadmap. Honest line: the compiler/runtime/governance engine is production-grade; the framework/app
packages are templates, not implemented.*

---

```text
intent
    ↓
governed execution plan
    ↓
coordinated compute
    ↓
audit proof
```

**[Intent](docs/Knowledge-Bases/logicn-concept-intent.md)** — The explicit declaration of what a flow is *for*: purpose, effects it may produce, boundaries it must respect. Intent guides optimisation; it does not grant authority. Authority is granted through `contract.effects` and capability declarations.

**[Governed Execution Plan](docs/Knowledge-Bases/logicn-concept-governed-execution-plan.md)** — The compiler-generated operational contract: which capabilities are granted, which effects are allowed, which targets are approved, and which behaviours are explicitly denied.

**[Coordinated Compute](docs/Knowledge-Bases/logicn-concept-coordinated-compute.md)** — The runtime orchestration layer that transforms a governed execution plan into actual execution across CPU, GPU, NPU, APU, WASM and future targets — all within declared authority constraints.

**[Audit Proof](docs/Knowledge-Bases/logicn-concept-audit-proof.md)** — The structured, verifiable runtime evidence that execution occurred within declared authority. Not logs — cryptographically signed, provable evidence.

---

## What LogicN Is

LogicN is three things building toward one platform:

**1. A language** — strict typing, explicit errors, declared effects, no hidden nulls, no silent failures. Source files use `.lln`.

**2. A compiler and checker pipeline** — lexer → parser → type checker → value-state/taint checker → effect checker → governance verifier → GIR emitter → tiered runtime. Every check has a diagnostic code. The value-state checker enforces **fail-closed egress guards**: credentials (`LLN-SECRET-002`) and cleartext semantic embeddings (`LLN-PRIVACY-002`, vec2text-invertible) cannot cross a trust boundary even after slicing/concatenation/transformation — only `redact()` / `seal()` discharge them. **4,465 tests, 0 failures**. Stage B self-hosting is **in progress (P9)** — Stage-A == Stage-B interpreter parity is locked (R6 corpus) and `tokenize` WASM byte-parity is **achieved** (#143); extending WASM parity to the parser/type-checker/governance-verifier flows is the remaining gate.

**3. A governed runtime architecture** — capability-based authority, machine-readable ProofGraph, post-quantum governance signatures, PCI DSS 4.0.1 audit, Deterministic Runtime Containment Model (DRCM) with monotonic security overlays.

### What makes it different

| Traditional | LogicN |
|---|---|
| Errors as exceptions | Explicit `Result<T, E>` — no silent failure |
| Mutation is silent | `let` = immutable · `mut` = explicit · `readonly` = view |
| Side-effects hidden | Effects declared: `contract { effects { database.write } }` |
| Boundary data silently typed | `unsafe let raw` — untrusted until gated |
| AI guesses at structure | Machine-readable ProofGraph + intent manifests |
| Security checked at runtime | Compile-time: taint, secrets, PCI DSS, governance proofs |
| Fixed hardware | Declared targets: CPU · WASM · GPU · NPU · APU · Photonic |

---

## Code Examples

> **LogicN three-block structure:** every flow has up to three outer blocks:
> 1. `flow name(params) -> ReturnType` — signature
> 2. `contract { ... }` — compile-time governance declaration (outside the body, not inside it)
> 3. `policy { ... }` — runtime monotonic overlay (optional, DRCM Phase 4)
> 4. `{ body }` — the runtime code
>
> `contract {}` and `policy {}` are **separate blocks**, not nested. Most flows only need `contract {}` and `{ body }`.

```logicn
// ── Governed secure flow: PII handling ───────────────────────────────────────
//
// contract {} is OUTSIDE the body braces — it is a compile-time declaration.
// The compiler reads it before any code runs, verifies intent against effects,
// builds the ProofGraph, and enforces data-flow rules.
//
// Anatomy:
//   secure flow name(params) -> ReturnType    ← signature
//   contract { ... }                          ← compile-time governance declaration
//   {                                         ← body opens here
//     ...runtime code...
//   }

secure flow createPatient(readonly request: Request) -> CreatePatientResult
contract {
  types   { type CreatePatientResult = Result<Response, ApiError> }
  intent  { "Create a patient record with protected PII handling." }
  effects { database.write  audit.write }
  privacy { contains PII  require redaction before audit.write }
}
{
  unsafe let rawEmail: String = request.body.email
  let email: protected Email  = validate.email(rawEmail)?
  let saved = PatientsDB.insert({ email: email })?
  AuditLog.write({ event: "PatientCreated", patientId: saved.id, email: redact(email) })
  return Ok(Response.created(saved.id))
}


// ── Pure flow: zero side effects, compiler-proved ────────────────────────────
pure flow calculateVat(price: Money<GBP>) -> Money<GBP>
contract { intent { "Calculate 20% VAT on a GBP price." } }
{
  return price * Decimal("0.20")
}


// ── Match: exhaustive by default ─────────────────────────────────────────────
pure flow describeStatus(s: Status) -> String
contract { intent { "Map a status enum to a display string." } }
{
  match s {
    Active    => { return "live" }
    Suspended => { return "paused" }
    Deleted   => { return "removed" }
  }
}


// ── Secrets: vault-backed, never in plaintext ─────────────────────────────────
// contract.secrets {} is auto-by-default (uses .env).
// Declare only when vault/KMS rotation is needed.
secure flow charge(amount: Int) -> Result<Int, String>
contract {
  intent  { "Charge a customer using a vault-backed API key." }
  effects { audit.write  network.outbound }
  secrets {
    credential payment_key { provider "hashicorp_vault"  path "secret/data/payment" }
    rotation { interval 1h  strategy smooth_handshake  on_rotation_fault halt }
  }
}
{
  AuditLog.write("Charge initiated")
  return Ok(amount)
}
```

---

## Architecture Patterns

LogicN has nine canonical patterns. Patterns 1–6 compile today (`drcm_stable_v0`). Patterns 7–9 require DRCM phases (marked `drcm_core_v1`). Each has a verified `.lln` example in `tests/patterns/`.

| # | Pattern | Profile | When to use |
|---|---|---|---|
| 1 | [Pure Transform](tests/patterns/pattern-01-pure-transform.lln) | stable | Math, string transforms, data mapping — no I/O, no side effects |
| 2 | [Governed API Route](tests/patterns/pattern-02-governed-api-route.lln) | stable | HTTP routes, webhooks, event handlers — external ingress |
| 3 | [High-Trust Mutation](tests/patterns/pattern-03-high-trust-mutation.lln) | stable | Payments, medical records, government data — full contract |
| 4 | [Cross-Boundary Workflow](tests/patterns/pattern-04-cross-boundary-interim.lln) | stable | External APIs / third-party calls — uses `security.interim` until `step` ships |
| 5 | [Secret-Using Flow](tests/patterns/pattern-05-secret-using-flow.lln) | stable | Any flow that reads a credential — `secrets {}` + `SecureString` taint guards |
| 6 | [Multi-Tier Service](tests/patterns/pattern-06-multi-tier-service.lln) | stable | API → business logic → data layer — three separate governed flows |
| 7 | [Governed WASM Module](tests/patterns/pattern-07-governed-wasm-module.lln) | `drcm_core_v1` | DRCM Phase 5 — DSS supervision, DWI isolates, fuel injection |
| 8 | [Emergency Policy Overlay](tests/patterns/pattern-08-emergency-policy.lln) | `drcm_core_v1` | DRCM Phase 4 — auto-tightening `policy { emergency { ... } }` |
| 9 | [.lmanifest Compliance](tests/patterns/pattern-09-lmanifest.md) | `drcm_core_v1` | DRCM Phase 3 — machine-verifiable compliance artifact for PCI DSS / SOC 2 |

> Full reference: [`docs/Knowledge-Bases/logicn-architecture-patterns.md`](docs/Knowledge-Bases/logicn-architecture-patterns.md)

---

## Architecture

### Compiler pipeline

```
.lln source
  ↓ lexer          — tokenise, LLN-LEX-001..006
  ↓ parser         — AST, flow/contract/match/record/for/import
  ↓ symbol resolver — LLN-NAME-001..003
  ↓ type checker   — LLN-TYPE-001..023
  ↓ value-state    — LLN-VALUESTATE/SECRET/TAINT/GATE
  ↓ effect checker — LLN-EFFECT-001..005
  ↓ governance     — LLN-GOV-001..020, LLN-TERM-001, ProofGraph
  ↓ GIR emitter    — Governed Intermediate Representation
  ↓ tiered runtime — cache · bytecode VM · sync · WASM · tree-walker
```

### Package layout

```
packages-logicn/
├── logicn-core-compiler/     ← active: full pipeline, 3,404 tests
├── logicn-core-runtime/      execution contracts + WASI boundaries
├── logicn-core-economics/    CostGraph, ValueGraph, breach-risk matrix
├── logicn-core-security/     taint profiles, redaction, OWASP boundaries
├── logicn-core-logic/        Tri, Decision, RiskLevel
├── logicn-core-vector/       Vector, Matrix, Tensor
├── logicn-core-compute/      target planning and selection
├── logicn-core-cli/          developer CLI (check/build/diff)
├── logicn-devtools-security/ runSecurityAudit, PCI DSS 4.0.1
├── logicn-devtools-naming/   LLN-NAMING-001..005
├── logicn-devtools-context/  context receipts (51-97% token reduction)
├── logicn-devtools-intelligence/ BM25 hybrid code search
├── logicn-devtools-provenance/ data lineage, W3C PROV-JSON
├── logicn-devtools-pci/      PCI DSS 4.0.1 (LLN-PCI-001..010)
├── logicn-devtools-benchmarks/ 23 benchmarks across all runtimes
├── logicn-ext-secrets-vault/ HashiCorp Vault — dual-token rotation
├── logicn-ext-proof-snarkjs/ Groth16 Phase 1 zk-SNARK prover
└── logicn-target-*/          CPU · WASM · GPU · NPU target packages

examples/
└── auth-service/             31 governed flows (verifyPassword, charge, sovereign...)

docs/Knowledge-Bases/        400+ specification documents
```

### Five-layer execution stack

```
Layer 1: LogicN Source          — what the developer writes (.lln)
       ↓ compiler pipeline
Layer 2: Governed IR (GIR)      — verified governance contract
       ↓ target bridge
Layer 3: WASM / bytecode / native — compiled execution
       ↓ runtime
Layer 4: RunResult              — retVal + auditLog (observable effects)
       ↓ governance
Layer 5: ProofGraph + .lmanifest — cryptographic audit proof (Ed25519 today; ML-DSA-65 planned)
```

---

## Running the Tools

```bash
# Run tests (core suite)
node scripts/run-all-tests.cjs --core        # SOT-four core suite, 0 failures (full: npm test → 48/48 · 4,412)

# Full benchmark suite (~5-10 min)
cd packages-logicn/logicn-devtools-benchmarks
npm run run && npm run compare

# Compile a .lln program to WASM and run it
logicn build examples/auth-service/sovereignTransaction.lln
logicn run   examples/auth-service/verifyPassword.lln --invoke verifyPassword
logicn check examples/auth-service/verifyPassword.lln

# Run .wasm binary without Node.js
wasmtime --invoke main build/benchmark.wasm   # → 5050

# Security + PCI audit sweep
node packages-logicn/logicn-devtools-security/dist/cli.js audit examples/auth-service/verifyPassword.lln
node packages-logicn/logicn-devtools-pci/dist/cli.js audit examples/auth-service/
```

---

## Key Documents

### Start here
| Document | What it covers |
|---|---|
| [SETUP.md](SETUP.md) | Install on Windows / Linux / macOS, benchmarks, Hello World |
| [`docs/Knowledge-Bases/KNOWLEDGE-BASE-INDEX.md`](docs/Knowledge-Bases/KNOWLEDGE-BASE-INDEX.md) | **Master navigation guide** — 4-layer KB hierarchy, conflict resolution, feature gate manifest |

### Language reference
| Document | What it covers |
|---|---|
| `docs/Knowledge-Bases/logicn-governance-rules.md` | Numbered rule registry — 35+ LLN codes, enforce status, correct/wrong examples |
| `docs/Knowledge-Bases/logicn-architecture-patterns.md` | 9 canonical patterns with `@experimental_profile` feature gates |
| `docs/Knowledge-Bases/logicn-contract-authoring-guide.md` | How to write correct contracts — clause optionality, AI safety pipeline |
| `docs/Knowledge-Bases/logicn-contract-economics.md` | `economics {}` block — auto-inference, explicit override |
| `docs/Knowledge-Bases/logicn-design-secrets-epilogue-blocks.md` | `secrets {}` and `epilogue {}` — auto-by-default, vault/KMS rotation |
| `docs/Knowledge-Bases/logicn-grammar.ebnf` | Authoritative v1 formal grammar |

### Architecture and security
| Document | What it covers |
|---|---|
| `docs/Knowledge-Bases/logicn-engineering-goals.md` | **3 architectural goals** — native speed, single-cycle bitmask, no system crash; acceptance tests |
| `docs/Knowledge-Bases/logicn-deterministic-runtime-containment.md` | DRCM — DSS, DWI, V_DPM monotonic security, `.lmanifest`, 7-module architecture |
| `docs/Knowledge-Bases/logicn-domain-guard-policies.md` | Domain guard policies — `[conforms_to: X]` static manifest clamping |
| `docs/Knowledge-Bases/logicn-governed-design-synthesis.md` | Research synthesis — 14-category mediation model, change-class review workflow |
| `docs/Knowledge-Bases/logicn-governed-runtime-research-2026-06-03.md` | 113-agent deep research: Cedar/OPA/Pony/Austral/Koka/in-toto/W3C-PROV enhancements |

### Benchmarks and deployment
| Document | What it covers |
|---|---|
| `docs/Knowledge-Bases/logicn-wasmtime-baseline.md` | Benchmark baseline (governance-cost 3.2K/s → 1.88M/s after WASM = 588×) |
| `docs/Knowledge-Bases/logicn-completion-roadmap-2026-06-03.md` | Six-layer path to full platform |
| `docs/Knowledge-Bases/logicn-wasmtime-roadmap.md` | Path from Stage B → `wasmtime logicn-runtime.wasm` |
| `docs/Examples/README.md` | Canonical Example Corpus (223 CEC stable) |

---

## Licence

LogicN is licensed under the Apache License 2.0. See `LICENSE`, `LICENCE.md` and `NOTICE.md`.

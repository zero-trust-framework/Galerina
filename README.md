# LogicN

**A governance-first programming language and runtime for high-assurance software.**

LogicN is built for organisations where software failure is not acceptable — financial platforms, healthcare systems, government services, and regulated enterprise. Every execution is **declared, verified, and audited** by design, not by convention.

> **Maturity (honest status, 2026-06-23).** LogicN is an **advanced prototype with several hardened zero-trust subsystems** — *not* yet a production-complete platform. The **compiler, security, and governance core are production-grade** (53/53 packages, 5,042 tests, fail-closed border check). The **application-framework layer is now substantially real**: the deny-by-default admission/fusion border (3 gates + multi-module linker + revocation), the `logicn new app` scaffolder, and the governed package resolver are shipped and tested (87 App-Kernel tests). The **governed HTTP transport (B8) is unlocked and in progress** — the TLSTP **S1 K3 cert/channel-validation gate** landed (`logicn-core-network`, 126 tests, fail-closed `revocation-unknown → DENY`), though it is not yet wired into the live kernel auth path; the *servable api-server / example-app* and the *signed registry index* are the remaining framework gaps. Stage-B self-hosting is in progress (≈80%), and the "Tower" compute layer is a **governed software simulator + bridge-attestation runtime, not real photonic-CPU virtualisation**. See [the 2026-06-23 roadmap + % audit](docs/Knowledge-Bases/logicn-roadmap-and-percent-audit-2026-06-23.md) and [the framework plan](docs/Knowledge-Bases/logicn-framework-plan-2026-06-21.md).

---

## The Zero-Trust thesis

LogicN optimises for **mathematical proof and absolute Zero-Trust containment** — an ecosystem that trusts absolutely no one: **not the developer, not the network, not the host OS.**

- **Compiler.** Verifies your pre-resolved policy and execution DAG strictly for deterministic, mathematically reproducible correctness.
- **I/O philosophy.** A mathematically-proven wall against the OS kernel. LogicN assumes the kernel is *already a compromised, hostile environment*. Rather than injecting OS-level I/O into a `main`, the governed HTTP transport adapter **denies native capabilities by default**; the host acts as a *dumb byte-mover* and authorisation is handled strictly by the fail-closed `vAnd` Kleene-K3 logic gate.
- **Package management.** A signed central registry index with fail-closed kernel verification — cryptographic manifests, content-addressed hash-pinning, and transitive capability masks.
- **Memory.** Treated as a highly hostile, actively-governed physical boundary. Standard shared-mutable memory models are **mathematically incompatible** with absolute Zero-Trust invariants — which is why TLSTP governs network memory directly rather than handing it to shared host state.
- **TLSTP (zero-middleware).** LogicN routes around the OS kernel using the governed HTTP adapter: the host reads raw encrypted packets off the wire and writes them as *unparsed byte-arrays* straight into WASM linear memory; decryption happens strictly **inside the WASM sandbox**. The kernel never sees plaintext.

> **What is shipped vs. design intent.** The **compiler**, the **`vAnd` Kleene-K3 authorisation gate**, **signed package admission** (hash-pin · signature · revocation · closed capabilities), and the **S1 cert/channel-validation gate** are *shipped and tested today*. The full **kernel-bypass / in-sandbox isolation** — decryption strictly inside a real WASM sandbox with the host as a pure byte-mover — is the **target architecture**: it depends on the real `DSS.wasm` Wasmtime TCB (#102–106), which is still a stub. Treat the kernel-bypass / zero-middleware guarantees as **design intent**, not yet a shipped runtime property.

---

## What LogicN does

**Declares governance in source code.** Every flow declares its intent, effects, capability boundaries, and invariants in a `contract {}` block. The compiler verifies these at build time. There is no runtime surprise.

**Enforces at runtime via the Governed Tower.** The DSS supervisor tracks the V_DPM (Virtual Dynamic Posture Matrix) register — every capability use is a bitmask check, every trap produces a structured AuditEvent, and rollback is clean (`unreachable` fires before the next instruction). *Today this runs as the Stage-A TypeScript simulation; the real `DSS.wasm` component is Post-P9 (#102–106).*

**Produces a cryptographic audit trail.** Every governed execution generates an Epilogue Receipt (sha256_seal or zk_snark). Every security trap appends to an append-only audit log (CBOR Tag 410 AuditEvent). **Hybrid Ed25519 + ML-DSA-65 (NIST FIPS 204) signing is shipped** on the attestation, proof-graph, and bridge surfaces (both halves required — no post-quantum downgrade; certified mode *mandates* the ML-DSA key). The `.lmanifest` itself is still **Ed25519-only**, with the hybrid upgrade gated on production key custody (#34/#149).

**Compiles to WebAssembly.** Governance is verified by the compiler at build time and enforced on the Stage-A runtime today. **WASM is the production execution path** — independently benchmarked as native-class (see Benchmarks). Full in-WASM self-hosting (P9) is *in progress*: the self-hosted `lexer.lln` `tokenize` reaches **byte-for-byte Stage-A == Stage-B real-WASM parity** (#143); extending that to the parser/type-checker/governance-verifier flows is the remaining gate.

---

## Who it is for

| Sector | Why LogicN |
|---|---|
| **Financial platforms** | Every payment flow declares and enforces its effects. Audit trail by default. PCI DSS governance built in (`logicn-devtools-pci`). |
| **Healthcare systems** | PII/PHI is typed and tracked. Redaction is enforced at the type level before data reaches any audit sink. |
| **Government / defence** | Designed for air-gapped deployment, no cloud dependency. Governed BitNet CPU inference is in early integration (Inference Tower ~12%). |
| **Enterprise regulated** | OWASP attack vectors blocked at the compiler. Supply-chain provenance via signed manifests (Ed25519 today; hybrid ML-DSA-65 on the attestation/bridge surfaces). |

> **New here?** → [**SETUP.md**](SETUP.md) — install · run your first benchmark · Hello World with full governance comments

---

## Benchmarks (measured 2026-06-17 — honest numbers)

Run on an **Intel i9-9900K (8C/16T) + NVIDIA RTX 2060**, across Rust (native, generic + AVX2), Node.js (V8), Python (CPython), LogicN's WASM output, the Stage-A interpreter tiers, and real GPU (Deno WebGPU). 23 benchmarks; harness at `packages-logicn/logicn-devtools-benchmarks`.

**The honest hierarchy on hot compute:** native/JIT (Rust ≈ LogicN-as-WASM ≈ Node) cluster within ~3× (0.1–4 B ops/s) → **Python** (100–1,000× back) → **the Stage-A TypeScript tree-walker** (the slowest tier, below Python on numeric loops — it allocates a boxed value per AST node).

- **LogicN's *production* path (WASM) is native-class** — it wins or ties Rust and Node on several benchmarks (arithmetic-threshold, six-digit-guess, record-allocation, tri-logic, low-memory).
- **The Stage-A interpreter is a diagnostic/reference tier, not the product** — its slowness is by design (it is the WASM byte-parity oracle).
- **Governance overhead is low** (~1.6×: governed ≈ manifest) — the cost is tree-walk dispatch, which WASM eliminates.
- **GPU** runs real dispatch on the RTX 2060 but is overhead-bound below ~500K elements (these kernels are too small); LogicN's own GPU backend is a Phase-38 stub.

---

## Build Progress

| Layer | % | Note |
|---|---|---|
| **Specification / KB** | 100% | 450+ documents |
| **Lexer / Parser / Governance Verifier / Contract blocks / Value-state checker** | 100% | full pipeline |
| **DRCM Phases 1–7 (Governed Tower — Stage-A simulation)** | 100% | real `DSS.wasm` is Post-P9 (#102–106) |
| **CBOR Manifests (RFC 8949)** | 100% | |
| **Tests — full suite** | 100% | **53/53 packages · 5,042 tests · 0 failures** |
| **Resilience — first-class fault handlers (0017)** | shipped | `on_*_fault` → fail-closed `halt` default + LLN-FAULT-001/003 + `GIRFlow.faultHandlers` |
| **Contract-driven test generation (0016)** | 5/5 vector dimensions | fault-injection · effect-egress · capability-denial · boundary/fuzz · substrate-violation (over GIR) |
| **Type checker / Effect checker** | ~90% | |
| **WAT emitter** | ~89% | #128(a) fail-closed fix landed (unhandled stmt → `unreachable` trap); #128(b)/GAP-4 `forEachStmt` lowering landed (for-in → counted loop over the host array bridge); `for…where` filtered iteration lowers as a guarded loop — all execution + interpreter-fidelity tested |
| **Runtime interpreter** | ~87% | diagnostic tier (see Benchmarks) |
| **Stage-B self-hosting — interpreter parity** | 100% | R6 corpus: Stage-A == Stage-B |
| **Stage-B self-hosting — WASM execution (P9)** | in progress | `tokenize` byte-parity achieved (#143); parser/checker/verifier flows remain |
| **Post-Quantum & Hardware Security** | ~38% | hybrid Ed25519+ML-DSA-65 shipped on attestation/proof/bridge; `.lmanifest` hybrid gated on key custody (#34/#149) |
| **`.tmf` trust engine (`logicn-ext-tmf`)** | slices 1–3 done | TMX-256 + container + KEM-DEM golden-verified; slice 4 (file-format signing / verify-before-read) next |
| **Passive Execution Plans & Target Bridges** | ~22% | |
| **AI Inference Tower (BitNet / GroqCloud / NVFP4)** | ~12% | default bridges are governed dev stubs/simulators |
| **Photonic / Ternary Computing** | ~3% | software simulation only (not hardware) |
| **Application-framework layer** | ~72% | admission/fusion border (3 gates + `planComposition` multi-module linker + revocation, 87 tests) · `logicn new app` scaffolder · governed resolver (hash/sig/registry/install-deny + LLN-PKG-006) — all real + tested. **B8 HTTP transport unlocked + in progress** (S1 cert-gate landed, kernel-wiring pending). Servable api-server/example-app + signed registry index are the remaining gaps |
| **B8 governed HTTP transport (TLSTP)** | in progress | **S1 K3 cert/channel-validation gate shipped** (`logicn-core-network`, 126 tests, fail-closed `revocation-unknown → DENY`, SEC-002 mutation-guarded) — wiring into live kernel auth + 0066 first-3 (handshake-bind · raw-byte shim · ECH/OHTTP) are next |
| **Tri-Pipe fault tolerance (binary/hybrid/photonic)** | re-R&D | shipped: fail-closed core · arena + overflow traps · DbC post-conditions · K3 fail-safe · NMR tolerance · Freivalds verify · DRCM containment. A multi-agent stability re-R&D is in flight |

**Full roadmap, % audit, and changelog** → [logicn-roadmap-and-percent-audit-2026-06-23.md](docs/Knowledge-Bases/logicn-roadmap-and-percent-audit-2026-06-23.md) · [build-roadmap](docs/Knowledge-Bases/logicn-build-roadmap.md). *Latest (2026-06-23): the B8 TLSTP S1 K3 cert-gate landed (fail-closed `revocation-unknown → DENY`); wiring it into live kernel admission is the next step.*

---

```text
intent  →  governed execution plan  →  coordinated compute  →  audit proof
```

**[Intent](docs/Knowledge-Bases/logicn-concept-intent.md)** — what a flow is *for*: purpose, allowed effects, boundaries. Intent guides optimisation; authority is granted through `contract.effects` and capability declarations.
**[Governed Execution Plan](docs/Knowledge-Bases/logicn-concept-governed-execution-plan.md)** — the compiler-generated operational contract: capabilities granted, effects allowed, targets approved, behaviours denied.
**[Coordinated Compute](docs/Knowledge-Bases/logicn-concept-coordinated-compute.md)** — runtime orchestration across CPU/GPU/NPU/WASM and future targets, within declared authority.
**[Audit Proof](docs/Knowledge-Bases/logicn-concept-audit-proof.md)** — structured, cryptographically signed runtime evidence that execution stayed within declared authority.

---

## What makes it different

| Traditional | LogicN |
|---|---|
| Errors as exceptions | Explicit `Result<T, E>` — no silent failure |
| Mutation is silent | `let` = immutable · `mut` = explicit · `readonly` = view |
| Side-effects hidden | Effects declared: `contract { effects { database.write } }` |
| Boundary data silently typed | `unsafe let raw` — untrusted until gated |
| AI guesses at structure | Machine-readable ProofGraph + intent manifests |
| Security checked at runtime | Compile-time: taint, secrets, PCI DSS, governance proofs |
| Fixed hardware | Declared targets: CPU · WASM · GPU · NPU · Photonic |

---

## Code Examples

> **Three-block structure:** `flow name(params) -> ReturnType` (signature) · `contract { ... }` (compile-time governance, *outside* the body) · optional `policy { ... }` (runtime monotonic overlay) · `{ body }`. `contract {}` and `policy {}` are separate blocks, not nested.

```logicn
// ── Governed secure flow: PII handling ───────────────────────────────────────
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
```

---

## Architecture Patterns

Nine canonical patterns. Patterns 1–6 compile today (`drcm_stable_v0`); 7–9 require DRCM phases (`drcm_core_v1`). Each has a verified `.lln` example in `tests/patterns/`.

| # | Pattern | Profile | When to use |
|---|---|---|---|
| 1 | Pure Transform | stable | Math, string transforms — no I/O |
| 2 | Governed API Route | stable | HTTP routes, webhooks — external ingress |
| 3 | High-Trust Mutation | stable | Payments, medical, government data |
| 4 | Cross-Boundary Workflow | stable | External APIs — `security.interim` until `step` ships |
| 5 | Secret-Using Flow | stable | Reads a credential — `secrets {}` + taint guards |
| 6 | Multi-Tier Service | stable | API → business → data, three governed flows |
| 7 | Governed WASM Module | `drcm_core_v1` | DRCM Phase 5 — DSS supervision, DWI isolates |
| 8 | Emergency Policy Overlay | `drcm_core_v1` | DRCM Phase 4 — auto-tightening `policy {}` |
| 9 | .lmanifest Compliance | `drcm_core_v1` | DRCM Phase 3 — PCI DSS / SOC 2 artifact |

> Full reference: [`docs/Knowledge-Bases/logicn-architecture-patterns.md`](docs/Knowledge-Bases/logicn-architecture-patterns.md)

---

## Building an application

A LogicN app is **compile-time conventions + signed governed packages fused at declared seams — not runtime middleware.** Scaffold one with `logicn new app`:

```text
my-orders-app/
├── App.lln          composition-root flow (the app entry)
├── App.manifest     declarative descriptor → folded into the SIGNED build/App.lmanifest
├── flows/           your governed business logic (routeOrders, createOrder, …)
├── deps/            signed governed components admitted at the fuse border
├── proofs/          contract-driven generated tests
└── .gitignore       build/ output + .env secrets are never committed
```

`logicn build App.lln` produces **one signed `build/App.wasm` + `build/App.lmanifest`** (Ed25519). A host **App Kernel** admits that wasm at a deny-by-default **fuse border** — three fail-closed gates — before it runs a single instruction:

1. **hash-pin** — the `.wasm` sha256 must equal the signed descriptor.
2. **signature + revocation** — a valid Ed25519 signature from a **non-revoked** key.
3. **closed capabilities** — a declared capability with no host shim is refused (link-time `LinkError → CRITICAL_SECURITY_VIOLATION`).

At runtime the app reaches the world **only** through the deny-by-default **Capability Host** (network · db · secrets), with governance — K3, contracts, fail-closed, audit — **compiled into** the wasm rather than wrapped around it. Capability binding lives in the signed `.lmanifest fuse{}` block; `.env` secrets are injected at runtime, never compiled in.

> Detailed plan + flowchart: [`docs/Knowledge-Bases/logicn-framework-plan-2026-06-21.md`](docs/Knowledge-Bases/logicn-framework-plan-2026-06-21.md)

---

## Architecture

### Compiler pipeline
```
.lln source
  ↓ lexer          — tokenise, LLN-LEX-001..006
  ↓ parser         — AST: flow/contract/match/record/for/import
  ↓ symbol resolver — LLN-NAME-001..003
  ↓ type checker   — LLN-TYPE-001..023
  ↓ value-state    — LLN-VALUESTATE/SECRET/TAINT/GATE
  ↓ effect checker — LLN-EFFECT-001..005
  ↓ governance     — LLN-GOV-001..020, LLN-TERM-001, ProofGraph
  ↓ GIR emitter    — Governed Intermediate Representation
  ↓ tiered runtime — cache · bytecode VM · sync · WASM · tree-walker
```

### Package layout (status-labelled)
```
packages-logicn/
├── logicn-core-compiler/     ACTIVE — full pipeline, 3,684 tests
├── logicn-core-security/     ACTIVE — taint profiles, redaction, OWASP boundaries
├── logicn-core-economics/    ACTIVE — CostGraph, ValueGraph, breach-risk matrix
├── logicn-core-logic/        ACTIVE — Tri, Decision, RiskLevel
├── logicn-tower-citizen/     ACTIVE — governed ternary/BitNet simulator + K3 + bridge attestation + revocation (202 tests)
├── logicn-ext-tmf/           ACTIVE — .tmf trust engine: TMX-256 + container + KEM-DEM (slices 1–3)
├── logicn-ext-bridge-quantum/ ACTIVE — governed ffsim bridge (Phase 1.5; real exec deferred to Phase 2)
├── logicn-devtools-security/ ACTIVE — runSecurityAudit, PCI DSS 4.0.1
├── logicn-devtools-pci/      ACTIVE — PCI DSS 4.0.1 (LLN-PCI-001..010)
├── logicn-devtools-benchmarks/ ACTIVE — 23 benchmarks across all runtimes
├── logicn-core-network/      ACTIVE — network I/O policy + egress/inbound guards + TLSTP S1 K3 cert-validation gate (126 tests)
├── logicn-framework-app-kernel/ ACTIVE — admission/fusion host: fuse-loader 3 gates + planComposition multi-module linker + revocation (87 tests)
├── logicn-framework-{example-app,api-server}/  REFERENCE — REST adapter (e2e-fused) + worked-example scaffolds
└── logicn-target-*, data/db/web/registry  PLANNED/PARTIAL — several documentation-only

examples/auth-service/        31 governed flows (verifyPassword, charge, sovereign...)
docs/Knowledge-Bases/         450+ specification documents
```

### Five-layer execution stack
```
Layer 1: LogicN Source (.lln)         — what the developer writes
       ↓ compiler pipeline
Layer 2: Governed IR (GIR)            — verified governance contract
       ↓ target bridge
Layer 3: WASM / bytecode / native     — compiled execution (WASM = production path)
       ↓ runtime
Layer 4: RunResult                    — retVal + auditLog (observable effects)
       ↓ governance
Layer 5: ProofGraph + .lmanifest      — cryptographic audit proof (Ed25519; hybrid ML-DSA-65 on attestation/bridge)
```

---

## Running the Tools

```bash
# Tests — core suite (4 packages) / full suite (53 packages, 5,042 tests)
node scripts/run-all-tests.cjs --core
npm test

# Scaffold a new governed app (App.lln + App.manifest + flows/ deps/ proofs/, deny-by-default)
logicn new app my-orders-app

# Full benchmark suite (~5–10 min) on this machine, then compare
cd packages-logicn/logicn-devtools-benchmarks && npm run run && npm run compare

# Compile a .lln program to WASM and run it
logicn build examples/auth-service/sovereignTransaction.lln
logicn run   examples/auth-service/verifyPassword.lln --invoke verifyPassword
logicn check examples/auth-service/verifyPassword.lln

# Run a .wasm binary without Node.js
wasmtime --invoke main build/benchmark.wasm

# Plugin border check (fail-closed admission)
node logicn.mjs border-check

# Security + PCI audit sweep
node packages-logicn/logicn-devtools-security/dist/cli.js audit examples/auth-service/verifyPassword.lln
node packages-logicn/logicn-devtools-pci/dist/cli.js audit examples/auth-service/
```

---

## Key Documents

| Document | What it covers |
|---|---|
| [SETUP.md](SETUP.md) | Install on Windows / Linux / macOS, benchmarks, Hello World |
| [`docs/Knowledge-Bases/KNOWLEDGE-BASE-INDEX.md`](docs/Knowledge-Bases/KNOWLEDGE-BASE-INDEX.md) | Master navigation — 4-layer KB hierarchy, conflict resolution |
| [`docs/Knowledge-Bases/logicn-build-roadmap.md`](docs/Knowledge-Bases/logicn-build-roadmap.md) | Forward roadmap, P9 critical path, audit remediation |
| `docs/Knowledge-Bases/logicn-governance-rules.md` | Numbered rule registry — LLN codes, enforce status, examples |
| `docs/Knowledge-Bases/logicn-architecture-patterns.md` | 9 canonical patterns with feature gates |
| `docs/Knowledge-Bases/logicn-zero-trust-engine.md` | "LogicN as a zero-trust engine" — the 4 border mandates + status |
| `docs/Knowledge-Bases/logicn-engineering-goals.md` | 3 architectural goals — native speed, single-cycle bitmask, no system crash |
| `docs/Knowledge-Bases/logicn-deterministic-runtime-containment.md` | DRCM — DSS, DWI, V_DPM, `.lmanifest`, 7-module architecture |
| [notes/2026-06-17-zero-trust-senior-developer-project-audit.md](notes/2026-06-17-zero-trust-senior-developer-project-audit.md) | Latest independent audit (advanced-prototype verdict) |

---

## Licence

LogicN is licensed under the Apache License 2.0. See [`LICENSE`](LICENSE), [`LICENCE.md`](LICENCE.md), [`NOTICE.md`](packages-logicn/logicn-core/NOTICE.md), and [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) (all third-party dependencies are permissively licensed and free for commercial use).

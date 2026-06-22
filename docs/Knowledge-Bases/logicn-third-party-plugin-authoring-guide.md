# LogicN — Third-Party Plugin Authoring Guide (concept → architecture → build)

A complete, teach-from-scratch guide to building a **third-party LogicN package/plugin** — for a human
developer or an AI author. It takes you from *what a plugin even is* in a zero-trust governed substrate,
through the architecture, to a worked build.

> **Honesty banner (read first).** LogicN's binding posture is *honest-core vs aspirational*. This guide marks
> every mechanism **[SHIPPED]** (in the production tree today, file:line cited), **[IN-FLIGHT]** (being built —
> tasks #201/#202/B5a), or **[DESIGN]** (specified, not yet built). Build against **[SHIPPED]** today; the
> **[IN-FLIGHT]/[DESIGN]** pieces are where the model is going — write your plugin so it's ready for them.
> Sources verified 2026-06-22. Companion R&D: 0062 (package architecture), 0063 (AI chain-of-attack), 0064
> (audit graph) — see [logicn-rd-0059-0064-triage-2026-06-22.md](logicn-rd-0059-0064-triage-2026-06-22.md).

---

## 0. The one-paragraph mental model

A LogicN plugin is **governed `.lln` logic + a `contract{}` that declares its authority + a signed
`.lmanifest`**, compiled to **one signed `.wasm`**, and **fused at a declared seam** into a host app. It is
**not** runtime middleware — nothing "flows through" it; governance is part of execution, not a layer around
it. You, the author, write **only** governed `.lln` and a contract. The substrate does the rest: it admits
your package at a fail-closed border, confers exactly the capabilities your contract declares (and no more),
and picks the execution tier (binary/hybrid/photonic) for you. **You cannot acquire authority you weren't
granted — by construction, not by convention.**

---

## 1. Concept — what a plugin is (and is NOT)

| A LogicN plugin IS | A LogicN plugin is NOT |
|---|---|
| Governed `.lln` source + a `contract{}` | A runtime middleware/interceptor |
| Compiled to **one signed `.wasm`** | A pile of ambient-authority scripts |
| Admitted at a **fail-closed fuse border** | "Trusted because it's installed" |
| Granted only its **declared `effects{}`** | Free to reach any host capability |
| Tier-agnostic (router picks binary/hybrid/photonic) | Hand-written for a specific backend |

**Why this shape.** The whole point is *capability containment*: a package can only ever touch what its
contract declares **and** what an ancestor granted it. Cleverness — including AI-authored cleverness — cannot
expand that set (0063's *defense asymmetry*: capability is **conferred** by the closed host-import object at
admission ∩ the signed mask ∩ the ancestor mask; none of which the package controls).

---

## 2. The zero-trust contract — why plugins are safe by construction

Four invariants you build on (all **[SHIPPED]** unless noted):

1. **Deny-by-default.** An effect/capability you don't declare has **no host import** at all → a
   `WebAssembly.LinkError` reclassified to `CRITICAL_SECURITY_VIOLATION` at instantiation
   (`logicn-core-compiler/src/wasm-runtime.ts:340-367`). Undeclared = impossible, not merely "denied".
2. **Fail-closed.** Any uncertainty (unverified signature, revoked key, unresolved capability, undischarged
   invariant) **denies/traps** — never proceeds.
3. **Capability is conferred, not declared.** Declaring `effects { network.outbound }` doesn't *grant* it;
   it lets the border *wire in* the host import **iff** the signed mask + the ancestor mask also allow it.
4. **Governance is computed on the trusted core, never delegated** — a plugin can't move a decision onto a
   surface it influences.

**The honest soft spot (know it):** the **grant/sign boundary**. A human or AI with signing authority who is
socially-engineered into signing a malicious package *is* the residual risk (0063 §2). Everything else is
structural; key custody is the human control that matters. So: minimize what you grant, and protect signing keys.

---

## 3. Anatomy of a plugin — the four artifacts

```
my-plugin/
  package.lln.json        # descriptor: name, kind, provides, entry, capabilities
  src/<name>.lln          # your governed logic + contract{}
  tests/                  # YOUR hand-written tests (kept separate from generated ones)   [IN-FLIGHT: B1 scaffolder]
  dist/<name>.wasm        # ONE signed wasm (output of `logicn build`)
  dist/<name>.lmanifest   # the SIGNED admission contract (CBOR, Ed25519)
```

1. **`package.lln.json`** — the descriptor the resolver reads: `name`, `kind`, `provides` (the exports a
   consumer may fuse), `entry`, and the declared `capabilities`. **[SHIPPED]** via the governed
   `package-resolver` (`logicn-core-compiler/src/package-resolver.ts`).
2. **`.lln` source** — your logic, wrapped in a `secure flow` / `guarded flow` with a `contract{}` (see §4).
3. **The signed `.lmanifest`** — the **authoritative** admission contract: `wasmSha256` (hash pin) + a
   **`fuse{}`** block (the capability grant: `capabilities` / `provides` / `seam` / `wasmSha256`) +
   `governanceSignature` (real Ed25519). Parsed by `extractFuse` (`logicn-framework-app-kernel/src/fuse-loader.ts:263-291`),
   generated *before signing* by `logicn build`. **Capability binding lives HERE — never in `.tmf`.** **[SHIPPED]**
4. **One signed `.wasm`** — your `.lln` compiled `.lln → GIR → WAT → .wasm`, with the manifest's behavioral
   fingerprint + source hash bound under the signature.

> **Why one `.wasm`?** The default is **AOT-fuse**: intra-package flows merge into a single signed module
> (`module-registry.ts`). Cross-package composition host-links one signed wasm per package at the fuse border
> (`planComposition`, fuse-loader.ts:661-740). Opt-in multi-module is reserved for the Component Model
> (#102-104, externally gated). **[SHIPPED]** for the single/AOT path.

---

## 4. The `contract{}` — your authority, declared

The contract is the single source of truth for what your plugin may do. Authoring rules:

```lln
secure flow chargeOrder(req: PaymentRequest) -> Result<Receipt, PayError>
contract {
  intent  { "Charge an approved merchant and audit the result." }   // human + AI readable
  effects { payment.charge, audit.write }                           // the capability surface — least-privilege
  limits  { memory 64mb request_time 10s }                          // arena / compute ceiling
  invariant { ensure result }                                       // output post-condition (fail-closed)
  // substrate { tolerance 0.02 }   // OPTIONAL — opt a tensor kernel into the photonic lane (see §7)
}
{ /* ... governed body ... */ }
```

- **`effects{}` is the ONE capability surface.** Do **not** look for a separate `permissions{}` block — there
  isn't one, deliberately (0062 §2: a second surface would drift from `effects{}`). The fuse border enforces
  `effects{}` directly.
- **Declare exactly what you use — least-privilege.** Declaring an effect you never exercise is an
  **over-privilege error** (`LLN-EFFECT-006 OVERDECLARED_EFFECT`, **[IN-FLIGHT #201]** — strict, all profiles).
  Using an effect you didn't declare is `LLN-EFFECT-001` **[SHIPPED]**. Effects are **operation-inferred**: the
  compiler learns them from your calls (a DB insert ⇒ `database.write`, a model call ⇒ `ai.inference`, a write
  of a PII-typed value ⇒ `pii.write`). Declare precisely; the checker will tell you if you're off in either
  direction.
- **Use canonical dot-path effect names** (`network.outbound`, not `network`) — a broad alias is `LLN-EFFECT-005`.
- **`invariant { ensure result }`** is your output gate — the recovered/returned value is trapped at the single
  exit if it violates the post-condition (`LLN-INV-*`, fail-closed across every tier). **[SHIPPED]**
- **`limits{}`** binds a committed arena (no `memory.grow`) — an over-budget allocation traps. **[SHIPPED]**

---

## 5. The admission border — the three fuse gates your package crosses

Every package crosses **three fail-closed gates** at fusion (`fuse-loader.ts`), deny-by-default:

1. **Hash pin** — the `.wasm` sha256 must equal the signed descriptor (`fuse-loader.ts:483-489`,
   `LLN-FUSE-HASH-MISMATCH`).
2. **Signature + revocation** — a valid Ed25519 signature from a **non-revoked** key
   (`fuse-loader.ts:308-361` + `516-526`; revocation via `governance/revocation-registry.mjs` `isKeyRevoked` /
   `assertRegistryTrustworthy`, fail-closed). A throwing revocation check itself denies.
3. **Closed capabilities** — only your declared caps get a host import; an undeclared capability has no import
   (`buildCapabilityImports`, `fuse-loader.ts:419-439`, `LLN-FUSE-UNKNOWN-CAP`), and the runtime turns an
   unauthorized import into `CRITICAL_SECURITY_VIOLATION` (`wasm-runtime.ts:353-366`).

All **[SHIPPED]**. **The package-standard profile** every package must satisfy (`effects{}` present + closed,
`invariant{ ensure result }` present, `limits{}` present, signed `.lmanifest`, provenance) is **[DESIGN #206]** —
write to it now so you're ready when the checker lands.

---

## 6. Capability containment — least-privilege all the way down

- **Least-privilege (yours).** Declare only the effects you use (#201, §4). **[IN-FLIGHT]**
- **Transitive mask-⊆ (your dependencies').** A dependency may only use a **subset** of *your* declared mask:
  the compiler proves `effects(child) ⊆ mask(parent)` down the whole dependency graph, so a hijacked deep dep
  can never *acquire* a capability your ancestors never held (0062 §3). **[IN-FLIGHT #202]** Today the border
  enforces this per-module at load; the compile-time transitive proof is the in-flight piece.
- **The verified tier.** Deep/untrusted deps may resolve only to the curated **`@logicn-core/*`** verified
  namespace (signed by the pinned root) or carry their own signed + masked admission — they cannot pull
  arbitrary unverified deep deps (0062 §4, enforced at `package-resolver` `LLN-PKG-006`). **[SHIPPED resolver]
  / [DESIGN tier rule]**
- **Egress governance.** Data leaving via a granted `network.send` is still governed (raw-secret →
  `LLN-SECRET-002`, cleartext semantic embedding → `LLN-PRIVACY-002`; only `seal()`/`redact()` declassify —
  `value-state-checker.ts`). **[SHIPPED]** Binding an egress policy to a *specific* granted capability is
  **[DESIGN #208]**.

**Takeaway for authors:** request the *smallest* mask that works. It bounds your blast radius and your deps'.

---

## 7. Tri-Pipe transparency — you write governed `.lln`, the substrate picks the tier

You **never** write binary/hybrid/photonic. The router (`ExecutionRouter` + `PartitionDecider` +
`hardware()` directive) chooses the tier per-kernel and **fails closed to Binary**. **[SHIPPED]**

- **Binary** is the default and universal fallback — and is **mandatory** for crypto, governance, K3 decisions,
  admission, secrets, control flow, and exact arithmetic (the precision wall). You cannot opt these onto an
  analog tier.
- **Hybrid/Photonic** apply only to eligible compute *kernels* (tensor math), and only on a proven net win,
  with the result cheap-verified (Freivalds/tolerance) and any drift falling back to the exact digital value.
- To offer a tensor kernel for the photonic lane, optionally add `substrate { tolerance <ε> }` to that
  kernel's contract (it declares the tolerance band; the witness binds it to a measured curve). Absent it,
  everything runs Binary. **[SHIPPED emulator / projected perf — no measured silicon yet]**

---

## 8. Build it — a worked example, end to end

A minimal governed plugin: a slug normaliser with audit.

**1) `src/slugify.lln`**
```lln
secure flow slugify(readonly raw: String) -> Result<String, SlugError>
contract {
  intent  { "Normalise user text to a URL slug and audit the call." }
  effects { audit.write }
  limits  { memory 8mb request_time 2s }
  invariant { ensure result }
}
{
  let cleaned: String = String.toLower(String.trim(raw))
  AuditLog.write({ event: "SlugGenerated", len: String.length(cleaned) })
  return Ok(cleaned)
}
```
*(Declares only `audit.write` — the one effect the body exercises. Declaring `network.outbound` here would be
an `LLN-EFFECT-006` over-privilege error; omitting `audit.write` would be `LLN-EFFECT-001`.)*

**2) Check** — `node logicn.mjs check src/slugify.lln` → type-check + governance verify must be clean. **[SHIPPED]**

**3) Build + sign** — `node logicn.mjs build src/slugify.lln` → emits `dist/slugify.wasm` + a **signed** CBOR
`dist/slugify.lmanifest` (real Ed25519 when a signing key is present; the `fuse{}` block carries your
capability grant + `wasmSha256`). **[SHIPPED]**

**4) Run it governed** — `node logicn.mjs run src/slugify.lln --governed` executes via the governed interpreter
enforcing the manifest's allowed effects (deny-by-default; no ambient `console`/capabilities). **[SHIPPED]**

**5) Publish** — to the signed registry index so consumers can resolve + verify it (hash + sig + revocation
before admission). **[IN-FLIGHT B5a]**

**6) Consume (fuse)** — a host app declares your package as a dependency; at the fuse border it crosses the
three gates (§5) and your `provides` are host-linked into the app's signed composition. **[SHIPPED]**

---

## 9. Distribution — resolver, registry, signing, revocation

- **`package-logicn.json` + lock** + the **governed resolver**: verifies hash + Ed25519 signature + registry
  origin + `installScript: deny` (no install-time code execution) before admission — `LLN-PKG-001..006`
  (`package-resolver.ts`). **[SHIPPED]**
- **Signed central registry index** — resolve a name → a signed `.wasm` + verify before admit. **[IN-FLIGHT B5a]**
- **Signing** — real Ed25519 over RFC-8785 canonical bytes, self-verifiable from the CBOR (#67/#180). ML-DSA-65
  hybrid is the PQ upgrade (#34). **[SHIPPED Ed25519 / IN-FLIGHT ML-DSA]**
- **Revocation** — a key revoked anywhere in the chain denies, fail-closed (the v2 trust-anchor pin rejects a
  registry signed by a rogue root). **[SHIPPED]** Keys should auto-rotate; never put key material on a CLI.
- **`.env` = runtime-only secrets**, never compiled in (prod = vault/KMS).

---

## 10. Testing your plugin

- **`tests/`** — YOUR hand-written tests live here, kept **separate** from generated / contract-driven tests
  (R&D 0016) so a regeneration never clobbers your tests; generated output lands under `proofs/` (or a marked
  `generated/`). **[IN-FLIGHT #214 / B1 scaffolder]**
- **Contract-driven generation** — the compiler can synthesise test obligations + compliance evidence from your
  `contract{}` (declared-vs-used, invariant cases). **[DESIGN/partial — R&D 0016]**
- **Everything must pass `logicn check`** (type + governance) before it's admissible.

---

## 11. The AI dual-role + the audit graph

A plugin is read by an AI in **two roles**, both served by the same signed artifacts (0062 §5 / 0064):

- **As a consumer** — *what can this package touch, and is it safe to fuse?* Answered by the **contract digest**
  (a canonical hash of the whole `contract{}` — effects/limits/substrate/invariant) + the capability manifest
  (`fuse{}`) + provenance (signer + the transitive mask chain). The effects-only behavioral fingerprint is
  **[SHIPPED]**; extending it to the full contract digest is **[IN-FLIGHT #203]**.
- **As the developer** — *am I least-privilege? any unexpected edge?* The **signed-package audit graph**
  (`logicn graph --package <dir>` + a central auditor) renders a package's *real* authority (effective mask
  after the ⊆-inheritance), its dep chain, revocation status, and its chain-of-attack surface — **before**
  fusing. An over-declared capability shows as a dangling node. It is **read-only and derived-from-verified**
  (never a trust input). **[DESIGN #204]** Today, the monorepo boundary graph (`devtools-package-graph`) is
  **[SHIPPED]** but graphs source, not the signed admission surface.

---

## 12. Forbidden / anti-patterns (these fail closed or fail to compile)

- **Ambient authority** — reaching a capability you didn't declare. (No host import → LinkError → CRITICAL.)
- **Over-declaration** — declaring an effect you don't use. (`LLN-EFFECT-006`, **[IN-FLIGHT]**.)
- **Crypto/bitwise in `.lln`** — `& | ^ << >>` are *not* LogicN operators (crypto-on-core boundary); crypto
  is engine-side, Binary, bit-exact. (`LLN-PARSE-001` hint.)
- **Capability binding in `.tmf`** — capability binding lives in the signed `.lmanifest fuse{}`, full stop.
- **A package that graphs/attests *itself*** as a trust input — the audit graph must be trusted + derived from
  verified artifacts, never the package's self-declaration.
- **Photonic/hybrid for crypto/governance/secrets/control** — Binary-only by invariant; you can't opt out.
- **Unsealed secret/PII to a network sink** — `LLN-SECRET-002` / `LLN-PRIVACY-002`; declassify via
  `seal()`/`redact()` only.

---

## 13. The package-standard checklist (write to this today)

- [ ] `package.lln.json` with `name` / `kind` / `provides` / `entry` / `capabilities`.
- [ ] Every flow is `secure`/`guarded` with a `contract{}`.
- [ ] `effects{}` present, **closed**, canonical dot-paths, **least-privilege** (declared == used).
- [ ] `invariant { ensure result }` present (output gate).
- [ ] `limits{}` present (arena + time ceiling).
- [ ] No ambient authority; no bitwise/crypto in `.lln`; secrets via `seal()`/`redact()` before any sink.
- [ ] `logicn check` clean (type + governance), `logicn build` produces a **signed** `.wasm` + `.lmanifest`.
- [ ] Capability binding in the `.lmanifest fuse{}` (never `.tmf`).
- [ ] Deps resolve to the verified tier or carry their own signed + masked admission.
- [ ] `tests/` for your own tests; signing key protected + rotating.

---

## See also
[logicn-rd-0059-0064-triage-2026-06-22.md](logicn-rd-0059-0064-triage-2026-06-22.md) (0062/0063/0064) ·
[logicn-framework-plan-2026-06-21.md](logicn-framework-plan-2026-06-21.md) (the B-series + fusion border) ·
[logicn-contract-authoring-guide.md](logicn-contract-authoring-guide.md) ·
[logicn-hardened-border.md](logicn-hardened-border.md) ·
[logicn-key-custody-and-rotation.md](logicn-key-custody-and-rotation.md) ·
[logicn-build-roadmap.md](logicn-build-roadmap.md).

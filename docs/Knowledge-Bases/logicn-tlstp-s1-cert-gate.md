# TLSTP S1 — K3 cert/channel-validation gate

> **Build-guide.** One adopted finding from the TLSTP transport/auth R&D cluster (2026-06-22). Citations resolve `file:line` against the LogicN production repo (`C:\wwwprojects\LogicN`, READ-ONLY). Binding posture: crypto/KDF/cipher/signature/key bytes stay **Binary** (digital); photonics/analog feed ONLY a K3 governance verdict via `vAnd` (degrade-only), never a key. Fail-closed (unknown→DENY).

---

## 1. What it is + why adopted

**S1** is a standalone governance pass that turns a *library-validated* X.509 (or TLSTP) certificate chain into a single fail-closed Kleene-K3 verdict — `cert_verdict = vAnd(pin_match, chain_valid, not_expired, revocation_fresh) ∈ {−1, 0, +1}` — where a **revocation-UNKNOWN** sub-verdict (`0`) collapses the whole channel to **DENY** at the trust boundary, closing the soft-fail hole that the public web tolerates. It is the **build-first** lead because all three cluster reports converge on it (`done/0065 §2-S1`, `done/0066`, `done/0068 §1`), it adds **zero new crypto** (the TLS library still validates the chain — no ASN.1/path-building re-impl, per `done/0002` rec 2), and it reuses the already-shipped K3 rails verbatim: `vAnd`/`decideAtBoundary` (`three-valued-governance.ts:41-75,141-153`) plus the content-addressed pinning gates in `fuse-loader.ts` (Gate-1 sha256 pin `:492-503`, Gate-2 Ed25519 verify `:519`, Gate-2b revocation `:527-540`). It hardens MITM identically for the bespoke TLSTP transport AND for a vanilla third-party HTTPS API, and is the real fix for the presence-only kernel auth stub at `kernel.ts:307` (today: `mode==='required' && no Authorization → 401`, zero token/sig/claim verification).

---

## 2. The maths, in detail

### 2.1 The K3 verdict lattice

A verdict is a **balanced trit** (`Verdict = -1 | 0 | 1`, `three-valued-governance.ts:33`), totally ordered by caution:

```
DENY  (−1)   <   INDETERMINATE (0)   <   ALLOW (+1)
```

Symbols (all defined here, used throughout):

| Symbol | Domain | Meaning |
|---|---|---|
| `−1` (`DENY`) | verdict | definite refusal |
| `0` (`INDETERMINATE`) | verdict | undischarged / evidence incomplete / unknown — **fail-closed-neutral, NOT "holding"** |
| `+1` (`ALLOW`) | verdict | proof discharged, may authorize |
| `t*` | verdict | the "intended"/digital verdict before a side-signal folds in |
| `r` | verdict | a side-signal trit (e.g. substrate availability), `r ∈ {−1,0,+1}` |
| `e` | verdict | effective verdict after folding: `e = vAnd(t*, r)` |

### 2.2 `vAnd` = `minTrit` = Kleene strong conjunction (∧)

`vAnd(a,b) = minTrit(a,b) = (a < b ? a : b)` over the total order above (`three-valued-governance.ts:49-51` delegating to `tpl-simulator.ts:149-152`). Because `−1 < 0 < +1`, conjunction is just the **numeric minimum** — the more-cautious operand wins. Full 3×3 truth table:

```
 vAnd(a,b)  |  b=−1   b= 0   b=+1
 -----------+-----------------------
   a = −1   |   −1     −1     −1
   a =  0   |   −1      0      0
   a = +1   |   −1      0     +1
```

Properties used by the gate (each a direct consequence of `min` on a chain):

- **Commutative, associative:** `min` is — so the order of folding the four sub-verdicts is irrelevant; `vAnd` may be reduced over a list (`allOf`, `three-valued-governance.ts:73-76`).
- **Identity = `+1`:** `vAnd(x, +1) = x`. ALLOW is the conjunctive identity — a fully-satisfied clause contributes nothing.
- **Annihilator = `−1`:** `vAnd(x, −1) = −1`. **A single hard DENY forces the whole verdict to DENY**, regardless of the others (this is the pin-mismatch case).
- **Absorbing toward caution:** for any `x ≤ y`, `vAnd(x,y) = x`. `0` cannot be lifted to `+1` by any partner: `vAnd(0, +1) = 0`, `vAnd(0, 0) = 0`. **There is no operand that turns an unknown into an allow.** This is the algebraic core of revocation-unknown→DENY.

### 2.3 The four sub-verdicts and their assignment

Each input factor is mapped to a trit *before* folding. The mapping is itself fail-closed: anything not provably positive is `0` or `−1`, never silently `+1`.

| Factor | `+1` (ALLOW) | `−1` (DENY) | `0` (INDETERMINATE) |
|---|---|---|---|
| `pin_match` | leaf SPKI / cert sha256 == pinned digest | digest present but **mismatches** pin | no pin configured for host (policy-dependent) |
| `chain_valid` | TLS library returns path-valid | library returns path-invalid | library could not complete validation |
| `not_expired` | `notBefore ≤ now ≤ notAfter` | `now > notAfter` or `now < notBefore` | clock unavailable / no validity window |
| `revocation_fresh` | OCSP/CRL says **good** AND within freshness window | OCSP/CRL says **revoked** | responder **unreachable / stale / no response** |

### 2.4 The composed verdict

```
cert_verdict = vAnd(pin_match, chain_valid, not_expired, revocation_fresh)
             = minTrit(pin_match, minTrit(chain_valid, minTrit(not_expired, revocation_fresh)))
             = min{ pin_match, chain_valid, not_expired, revocation_fresh }            (∈ {−1,0,+1})
```

i.e. **the verdict is the minimum (most cautious) of the four trits.** Equivalently: `cert_verdict = +1` ⟺ *all four* are `+1`; `cert_verdict = −1` ⟺ *any* is `−1`; otherwise `cert_verdict = 0`.

### 2.5 The boundary collapse (`decideAtBoundary`)

The three-valued verdict stays three-valued through composition and collapses to a binary decision ONLY at the trust boundary (`three-valued-governance.ts:141-153`):

```
collapse(+1) = allow                                   authorized ⟺ verdict = +1
collapse( 0) = deny   + emit LLN-GOV-3VL-001 diag      (three-valued-governance.ts:145, 90-92, 95-97)
collapse(−1) = deny   (ordinary policy denial, no diag)
```

So the channel opens **iff** `decideAtBoundary(cert_verdict).authorized === true` **iff** `cert_verdict === +1` **iff** all four sub-verdicts are `+1`. The `INDETERMINATE → deny` arrow is **structurally impossible to drop silently**: the diagnostic is returned *in* the `BoundaryDecision` (`:117-118, 145`).

### 2.6 The fail-closed soundness theorem (why unknown → DENY is forced, not chosen)

**Claim.** No combination of inputs can open a channel unless every factor is provably positive.

**Proof.**
1. `decideAtBoundary` authorizes ⟺ `verdict === +1` (`authorize`, `:95-97`).
2. `cert_verdict = min{...}` (§2.4). `min(S) = +1 ⟺ ∀x∈S, x = +1` because `+1` is the top of the chain.
3. Therefore the channel opens ⟺ `pin_match = chain_valid = not_expired = revocation_fresh = +1`. ∎

**Corollary (revocation soft-fail closed).** If the OCSP/CRL responder is unreachable, `revocation_fresh = 0`. By the absorbing property (§2.2, `vAnd(0,+1)=0`), `cert_verdict = min{+1,+1,+1,0} = 0`, which collapses to `deny`. **Unknown is DENY by the algebra, not by a configurable flag** — the opposite of the web's soft-fail default (responder-down ⇒ allow).

### 2.7 The No-Coercion property (degrade-only side-signals)

When a degrade-only side-signal `r` (e.g. TamperTrust from `done/0070`, or a substrate-availability trit) is folded in, it can only *lower* the verdict:

```
e = vAnd(t*, r) = min(t*, r) ≤ t*          (substrate-model.ts No-Coercion theorem; three-valued-governance.ts:40-44)
```

Since `min(t*, r) ≤ t*`, **a side-signal can degrade `+1→0` or `+1→−1` but can never manufacture `0→+1` or `−1→+1`.** This is exactly why a photonic/analog measurement is allowed to *contribute* to `cert_verdict` (as an extra `vAnd` operand) without ever becoming a key or coercing an ALLOW — it satisfies the binding posture by construction.

---

## 3. Worked examples

Let `now = 2026-06-22T12:00:00Z`. Fold order is irrelevant (associative/commutative).

### Example (a) — valid pinned chain + fresh OCSP → +1 → ALLOW

Inputs:
- Leaf SPKI sha256 == pinned digest ⇒ `pin_match = +1`
- TLS library: path-valid ⇒ `chain_valid = +1`
- `notBefore = 2026-01-01`, `notAfter = 2026-12-31`, `now` inside ⇒ `not_expired = +1`
- OCSP response `good`, produced 2026-06-22T11:55Z, within a 24h freshness window ⇒ `revocation_fresh = +1`

Fold:
```
vAnd(not_expired, revocation_fresh) = min(+1, +1) = +1
vAnd(chain_valid, +1)               = min(+1, +1) = +1
cert_verdict = vAnd(pin_match, +1)  = min(+1, +1) = +1
```
Boundary: `decideAtBoundary(+1)` → `{decision:"allow", authorized:true, diagnostic:null}`. **Channel opens.**

### Example (b) — revocation responder unreachable → 0 → DENY (the headline failure case)

Inputs (identical to (a) except revocation):
- `pin_match = +1`, `chain_valid = +1`, `not_expired = +1`
- OCSP responder **times out** (no response, or response stale past the freshness window) ⇒ `revocation_fresh = 0` (UNKNOWN)

Fold:
```
vAnd(not_expired, revocation_fresh) = min(+1,  0) =  0     ← unknown enters
vAnd(chain_valid, 0)                = min(+1,  0) =  0     ← cannot be lifted back to +1
cert_verdict = vAnd(pin_match, 0)   = min(+1,  0) =  0
```
Boundary: `decideAtBoundary(0)` → `{decision:"deny", authorized:false, diagnostic: LLN-GOV-3VL-001}`. **Channel REFUSED, audited.** Note three "good" factors cannot rescue the one unknown — `+1` is the conjunctive identity and contributes nothing toward overriding a `0`. This is the soft-fail hole closed: a public browser would have *allowed* here.

### Example (c) — hash-pin mismatch → −1 → DENY

Inputs:
- Presented leaf SPKI digest ≠ pinned digest ⇒ `pin_match = −1` (hard DENY)
- The remaining factors are all `+1` (a perfectly valid CA-issued cert — the classic MITM with a different-but-valid cert)

Fold (annihilator at work):
```
vAnd(not_expired, revocation_fresh) = min(+1, +1) = +1
vAnd(chain_valid, +1)               = min(+1, +1) = +1
cert_verdict = vAnd(pin_match, +1)  = min(−1, +1) = −1     ← single −1 dominates
```
Boundary: `decideAtBoundary(−1)` → `{decision:"deny", authorized:false, diagnostic:null}` (ordinary policy denial, no LLN-GOV-3VL-001 since it is a definite `−1`, not a collapsed `0`). **Channel REFUSED.** A library-valid chain is *not enough* — pinning is a hard `vAnd` factor, defeating MITM that presents a real-but-wrong cert.

---

## 4. The hard build path

**Target module.** New file `packages-logicn/logicn-core-network/src/cert-gate.ts` (sibling to `DEFAULT_TLS_POLICY`/`validateTlsPolicy`), re-exported for the kernel. It is a pure governance pass — it takes the *outputs* of crypto/TLS validation as trits and returns a `BoundaryDecision`. It performs **no** ASN.1, path-building, or signature math itself (`done/0002` rec 2; `done/0065 §2-S1`).

**Ordered steps.**

1. **Define the input adapter.** Write `toSubVerdicts(libResult, pins, now, ocsp): {pin_match, chain_valid, not_expired, revocation_fresh}` per the §2.3 table. **Inputs:** the TLS library's path-validation result, the host's pin set, a clock, and the OCSP/CRL outcome. **Output:** four `Verdict` trits. The default for every unmapped/missing/errored case is `0` (not `+1`) — this is the fail-closed seam.

2. **Fold with the shipped K3 reduce.** `import { vAnd, allOf, Verdict } from "@logicn/tower-citizen"` (or the published name for `three-valued-governance.ts`). Compute `cert_verdict = allOf([pin_match, chain_valid, not_expired, revocation_fresh])` — reuses `allOf` (`:73-76`), which is the `vAnd`-reduce with deny-by-default on the empty set. **Do NOT** hand-roll `min`; reuse the verified gate so the K3-conformance oracle (`tests/three-valued-governance.test.mjs`) keeps covering you.

3. **Collapse at the boundary.** `const decision = decideAtBoundary(cert_verdict, onDiagnostic)` (`:141-153`). Forward `decision.diagnostic` (LLN-GOV-3VL-001) to the AuditLogger egress. **Output:** `decision.authorized` gates whether the channel/flow proceeds.

4. **Wire pinning from the shipped trust-anchor model.** The pin set for step 1 comes from the same content-addressed pinning that `fuse-loader.ts` already uses: Gate-1 sha256 pin (`:492-503`), Gate-2 Ed25519-vs-pinned-keyId (`:519`, **no X.509 path-building**), Gate-2b revocation predicate (`:527-540`, including the `LLN-FUSE-REVOCATION-UNVERIFIABLE` fail-closed-on-throw at `:537`). Reuse the host-injected `revocationCheck` predicate shape (`:179`) — a throwing check maps to `revocation_fresh = 0`, never `+1`.

5. **Replace the kernel presence-stub.** At `kernel.ts:307` the auth step is pure header-presence. Replace it so that, for a connection, the admission decision is `decideAtBoundary(cert_verdict)` (bound to the live handshake identity), not `header(...) === undefined`. **Inputs:** the per-connection cert-gate result; **output:** `401`/refuse on non-`+1`, proceed on `+1`. (Adjacent to ledger #212.)

**Tests to write** (`packages-logicn/logicn-core-network/tests/cert-gate.test.mjs`):
- The three worked examples above as fixtures (a)→allow, (b)→deny+LLN-GOV-3VL-001, (c)→deny no-diag.
- **Exhaustive 3⁴ = 81-row truth table:** every combination of the four sub-verdicts; assert `authorized ⟺ all four +1`, and `verdict === min(...)`. (Cheap and total — do it.)
- A **single-factor-unknown** sweep: for each factor set to `0` with the other three `+1`, assert `deny` + diagnostic.
- A **revocation-throws** case: `revocationCheck` throws ⇒ `revocation_fresh = 0` ⇒ deny (mirrors `:537`).
- A **No-Coercion** property test: for random `t*, r`, assert `vAnd(t*, r) ≤ t*` (guards against any future operand that could lift a `0`).

**Hard parts / gotchas (called out):**

- **(HARD, the whole point) Every default must be `0`, never `+1`.** The single most dangerous bug is mapping a missing/timed-out/errored factor to ALLOW. The web's soft-fail is *exactly this mistake*. Encode it once in `toSubVerdicts` and test the "unknown" path for each of the four factors. A `+1` default would silently re-open the soft-fail hole that S1 exists to close.
- **(HARD) Pin mismatch is `−1`, pin *absent* is `0` — they are different.** A configured-but-mismatched pin is a hard DENY (annihilator, Example c). No pin configured for the host is INDETERMINATE (policy must decide whether un-pinned hosts are allowed at all). Conflating the two either bricks un-pinned hosts (`−1`) or weakens pinned ones (`+1`).
- **(EASY-to-get-wrong) Do not invent a parallel trit or re-implement `min`.** Reuse `vAnd`/`allOf`/`decideAtBoundary` verbatim. The charter forbids a confusing alias of the governance trit (`done/0065 §1`); a hand-rolled `min` also escapes the K3-conformance oracle.
- **(BOUNDARY) Do NOT re-implement ASN.1 / path-building / OCSP parsing.** S1 consumes a *library-validated* chain and the library's revocation outcome; it only folds trits (`done/0002` rec 2). Re-implementing PKI is both out of scope and a new attack surface.
- **(SEQUENCING) Capsule pre-hash defect (D13) blocks only the capsule-backed identity token path, not S1 itself.** If you later bind cert-gate identity into the Governed Trust Capsule `cnf`, first reconcile `governed-trust-capsule-v0.md` §2 (sign `Sig_structure` directly, RFC 9964) vs §8 step 4 (`M = SHA-256(CBOR(...))`). The bare cert-gate (steps 1–5) does not depend on it.
- **(EASY) Freshness window must itself fail-closed.** A *stale* (too-old) OCSP `good` is `revocation_fresh = 0`, not `+1` — treat "good but expired-freshness" identically to "no response."
- **(POSTURE) Any photonic/analog input is an extra degrade-only `vAnd` operand, never a factor that can lift the verdict.** By No-Coercion (§2.7) it can only push toward DENY. Never let it become a key/KDF/cipher byte. Optical front-end stays aspirational-HW; the governance fold is buildable today.

**No perf claim** is made here; any latency/overhead figure (e.g. OCSP round-trip cost) requires a named-machine bench.

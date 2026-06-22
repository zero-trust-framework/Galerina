# B8 — governed HTTP transport adapter (build guide)

> Build guide for ONE adopted transport/auth finding: **B8, the governed HTTP transport adapter**. Citations
> resolve `file:line` against the LogicN production repo (`C:\wwwprojects\LogicN`, READ-ONLY at authoring time).
> Binding posture (carried into the whole doc): **crypto/KDF/cipher/signature/key bytes stay BINARY (digital)**;
> photonics/analog feed ONLY a K3 governance verdict via `vAnd` (degrade-only), never a key. **Fail-closed
> (unknown → DENY).** No perf claim without a named-machine bench. Tiers are honest: **SHIPPED** (citable today),
> **DECIDED** (designed, not yet wired), **ASPIRATIONAL-HW** (substrate-gated #102-106 / Stage-B P9.4).

---

## 1. What it is + why adopted

**B8 is the host-side plumbing that carries a real HTTP/transport request from the wire, through LogicN's shipped
admission and K3 governance gates, into an admitted flow, and back out as a response** — without any part of the
adapter ever seeing a key. It is the *adapter*, not a new protocol: the protocol logic (the TLSTP S1–S5 survivors of
0065) sits **above** the adapter, and ~75–85% of the machinery B8 needs is **already shipped** and merely composed
here, not rebuilt. It was adopted because B8 became **owner-UNLOCKED on 2026-06-22** and is the host that the
converged build-first lead — the S1 K3 cert-validation gate — must live inside; it reuses the kernel anti-middleware
pipeline (`kernel.ts`), `verifyWasm` (`wasm-runtime.ts:99-114`), the `fuse-loader` admission gates
(`fuse-loader.ts`), `egress-guard` (`egress-guard.ts`), `DEFAULT_TLS_POLICY` (`logicn-core-network/src/index.ts:116-123`),
and the K3 calculus (`three-valued-governance.ts:40-152`).

Source dones: `done/0066-b8-http-transport-governed-adapter-design.done.md` (the request path + the per-decision
resolution + tiering + first-3 build order) and `done/0068-logicn-governance-for-regular-apis-http-ssl-mitm.done.md`
(the regular-API threat→mitigation table B8 must satisfy). Hub disposition: WILL-USE
(`logicn-transport-auth-research-explained-2026-06-22.md` §"WILL USE", row "B8 governed adapter"). NB: this is the
**design to direct** — no code goes into `logicn-framework-api-server` framing as part of this guide; the guide
describes *how to build it* when implementation begins.

---

## 2. The maths, in detail

B8's "maths" is **gate composition**: the request is admitted **iff the conjunction (over the K3 lattice) of every
gate's verdict is exactly ALLOW**. Everything else (TLS, byte-moving) is plumbing; the governing algebra is the
three-valued (Kleene K3) conjunction the repo already ships.

### 2.1 The verdict domain and operators (shipped)

Define the verdict trit (`three-valued-governance.ts:40-44`):

```
V = { DENY = −1 ,  INDETERMINATE = 0 ,  ALLOW = +1 }
```

with the total order `DENY < INDETERMINATE < ALLOW`. The conjunction operator is `vAnd`, which is `min` over that
order (`three-valued-governance.ts:49-51`):

```
vAnd(a, b) = min(a, b)
```

**`vAnd` truth table** (the only operator the admission composition uses):

| `vAnd` | b = −1 | b = 0 | b = +1 |
|--------|:------:|:-----:|:------:|
| **a = −1** | −1 | −1 | −1 |
| **a = 0**  | −1 |  0 |  0 |
| **a = +1** | −1 |  0 | +1 |

Two structural facts make this fail-closed:

- **Absorbing DENY.** `vAnd(−1, x) = −1` for all `x`. One hard DENY (e.g. a revoked key, a failed AEAD tag) sinks
  the whole conjunction. No other gate can rescue it.
- **No upward coercion.** `vAnd(a, b) ≤ a` and `vAnd(a, b) ≤ b`. A side-signal can only *hold or lower* a verdict,
  never raise it. This is the **No-Coercion** property B8 inherits for free, and it is exactly why a photonic /
  analog signal may participate via `vAnd` as a degrade-only input but can never manufacture an ALLOW.

### 2.2 Deny-by-default conjunction (the composed admission)

The composed admission verdict is the conjunctive fold `allOf` (`three-valued-governance.ts:73-76`):

```
allOf([])         = INDETERMINATE                  # empty ⇒ no positive evidence ⇒ 0 (NOT vacuous +1)
allOf([v₁,…,vₙ])  = v₁ vAnd v₂ vAnd … vAnd vₙ      # n ≥ 1
```

The empty-set rule is the crux: a bare ∧-fold identity would return +1 (vacuous truth) for an empty clause set;
LogicN deliberately returns `INDETERMINATE` instead, so **"no gate granted anything" collapses to deny**, not allow.

### 2.3 The boundary collapse (fail-closed authorization)

A trit is turned into a binary admit/reject by `decideAtBoundary` (`three-valued-governance.ts:89-152`):

```
authorize(v)  =  (v == ALLOW)                       # i.e. admit IFF v == +1
collapse(v)   =  "allow" if v == ALLOW else "deny"  # BOTH 0 and −1 ⇒ "deny"
```

and an INDETERMINATE (0) reaching the boundary additionally emits the audit diagnostic `LLN-GOV-3VL-001`
(`three-valued-governance.ts:102,121-128,145`) — it is structurally impossible to drop a 0 silently.

So the **B8 admission predicate** is:

```
ADMIT(req)  ⟺  decideAtBoundary( allOf([ G_shim, G_verify, G1, G2, G2b, G3, G_K3, G_S1 ]) ).authorized == true
            ⟺  vAnd over all gate verdicts  ==  ALLOW (+1)
```

where each `G_*` is the K3 verdict of one stage on the request path (§2.4). Because `vAnd = min`, this is equivalent
to: **every gate must independently return +1, and any gate returning 0 or −1 denies.**

### 2.4 The per-gate verdict functions (each on the request path)

Each stage contributes one trit. The exact shipped enforcement is cited; the verdict mapping is the maths.

**(a) Raw-byte host shim — `G_shim`** (below the verdict; `fuse-loader.ts:217-225` capability shim). Inbound is
accept-side, deny-by-default; the built-in `__net_in_accept` returns `-1` until a `network.inbound` capability is
granted:

```
G_shim = ALLOW  if inbound capability granted and byte-mover present
       = DENY   otherwise            # __net_in_accept() == −1  ⇒  no bytes admitted
```

(No outbound is wired by default; `__net_out_connect`/`__net_out_send` also return `-1`,
`fuse-loader.ts:227-233`.)

**(b) `verifyWasm` — `G_verify`** (`wasm-runtime.ts:99-114`). Pure check, performs **no instantiation**; verifies the
admitted module's attestation BEFORE any host fn links:

```
G_verify = ALLOW  if attestation present ∧ sha256(wasm) == attestation.sha256
                    ∧ (profile ok) ∧ (hash pinned if allow-list non-empty)
         = DENY   otherwise          # { ok:false } on any shortfall
```

**(c) Admission / `fuse-loader` Gates 1 / 2 / 2b / 3:**

- **Gate 1 — `G1`** sha256 pin (`fuse-loader.ts:492-503`):
  `G1 = ALLOW iff actualSha == descriptor.wasmSha256, else DENY` (tamper → `LLN-FUSE-…`).
- **Gate 2 — `G2`** detached Ed25519 vs **pinned keyId** (no X.509 path-building) (`fuse-loader.ts:519-525`):
  `G2 = ALLOW iff signature == "verified" against the pinned key, else DENY`.
- **Gate 2b — `G2b`** revocation, fail-closed (`fuse-loader.ts:527-542`):

  ```
  G2b = ALLOW   if revocationCheck(keyId) == false
      = DENY    if revocationCheck(keyId) == true            # LLN-FUSE-KEY-REVOKED
      = DENY    if revocationCheck throws / unverifiable      # LLN-FUSE-REVOCATION-UNVERIFIABLE  (unknown → DENY)
  ```

  Note the **third row is the fail-closed law**: an *unknown* revocation status is a DENY, not an allow.
- **Gate 3 — `G3`** deny-by-default capabilities (`fuse-loader.ts:445`, gate at `:547`):
  `G3 = ALLOW iff every requested capability is in the built-in registry, else DENY` (`LLN-FUSE-UNKNOWN-CAP`).

**(d) K3 boundary `decideAtBoundary` — `G_K3`** is the fold itself (§2.3), not a separate clause; it converts the
composed trit to admit/reject and audits a 0.

**(e) S1 cert/channel-validation gate — `G_S1`** (the net-new piece B8 hosts; converged build-first of 0065/0066/0068).
This is itself a `vAnd` fold over four sub-trits (each computed from a **library-validated** chain — LogicN does NOT
re-implement ASN.1 or path-building):

```
cert_verdict = vAnd( pin_match , chain_valid , not_expired , revocation_fresh )  ∈ {−1, 0, +1}
G_S1         = cert_verdict
```

with the four inputs mapped to trits as:

| sub-signal | +1 (ALLOW) | 0 (INDETERMINATE) | −1 (DENY) |
|---|---|---|---|
| `pin_match` | leaf/key matches a pinned anchor | no pin configured for host | leaf ≠ any pin |
| `chain_valid` | library says path builds | (n/a — library is binary) | library rejects path |
| `not_expired` | within validity window | clock unavailable | expired / not-yet-valid |
| `revocation_fresh` | fresh OCSP/CRL says good | **status could not be fetched** | explicitly revoked |

The **`revocation_fresh = 0` (unknown) case is the whole point**: by `vAnd`, a single 0 caps `cert_verdict` at 0,
which `decideAtBoundary` collapses to **deny**. This closes the classic TLS *soft-fail* hole where an unreachable
OCSP responder is treated as "good."

### 2.5 Two algebraic theorems B8 relies on

**Theorem 1 (One bad gate denies).** For the admission fold `A = allOf([G₁,…,Gₙ])`, if any `Gᵢ ≤ 0` then `A ≤ 0`,
hence `decideAtBoundary(A).authorized = false`.
*Proof.* `vAnd = min`, so `A = min(G₁,…,Gₙ) ≤ Gᵢ ≤ 0 < +1`; `authorize` requires `A == +1`. ∎

**Theorem 2 (Degrade-only side-channels).** If a degrade-only signal `r ∈ V` (e.g. a TamperTrust / availability
trit, or a discretized continuous trust score) is folded as `A' = vAnd(A, r)`, then `A' ≤ A`. A side-signal can
never turn a deny/indeterminate into an allow.
*Proof.* `A' = min(A, r) ≤ A`. ∎

These two are why B8 is fail-closed by construction: admission is a `min` of trits with `unknown = 0` collapsing to
deny, and any analog/photonic input enters only through `vAnd` (degrade-only, never a key byte).

---

## 3. Worked examples

All three walk the **full request path** of 0066 §1: `wire → raw-byte shim → verifyWasm → fuse Gates 1/2/2b/3 →
K3 decideAtBoundary (+ S1 cert gate) → admitted flow → response`.

### Example A — `POST /orders`, fully governed, ADMITTED (+1)

Inputs:
- Inbound `network.inbound` capability granted → shim returns a request handle (not `-1`).
- Admitted inbound-protocol module: `sha256(wasm) = 0xAB…` and `attestation.sha256 = 0xAB…`, profile `certified`,
  hash on the pinned allow-list.
- Manifest signed; `verifyManifestSignature → "verified"` against pinned `keyId = K7`; `revocationCheck(K7) = false`.
- Declared caps `{network.inbound, clock.read}` — both in the built-in registry.
- TLS chain (validated by the host crypto library): leaf matches a pinned anchor; path builds; within validity; a
  fresh OCSP "good."

Gate-by-gate:

| Gate | computation | verdict |
|---|---|---|
| `G_shim` | inbound granted, byte-mover present | **+1** |
| `G_verify` | `0xAB == 0xAB`, certified, pinned | **+1** |
| `G1` sha256 pin | `actualSha == descriptor.wasmSha256` | **+1** |
| `G2` Ed25519 | signature "verified" vs pinned K7 | **+1** |
| `G2b` revocation | `revocationCheck(K7) == false` | **+1** |
| `G3` caps | `{inbound, clock.read} ⊆ registry` | **+1** |
| `G_S1` cert | `vAnd(+1,+1,+1,+1) = min(+1,…) =` | **+1** |

Compose: `A = allOf([+1,+1,+1,+1,+1,+1,+1]) = min(…) = +1`.
`decideAtBoundary(+1) = { decision:"allow", authorized:true, diagnostic:null }`.

→ **ADMIT.** Request enters the governed flow; effects are capability-bounded; the response goes back to the wire
(optionally through opt-in S5 morphing, which derives frame sizing from the digital AEAD keystream and **replaces**
any cleartext routing tag — never accompanies one, else `LLN-PRIVACY-002`).

### Example B — `POST /orders` with a **revoked cert/key**, DENIED (−1)

Same as A, except the signing key `K7` has been revoked. The host injects
`revocationCheck(K7) = true` (`governance/revocation-registry.mjs` behind `revocationCheck`):

| Gate | computation | verdict |
|---|---|---|
| `G_shim` | granted | +1 |
| `G_verify` | hash matches | +1 |
| `G1` sha256 pin | matches | +1 |
| `G2` Ed25519 | signature **is** cryptographically valid vs K7 | +1 |
| `G2b` revocation | `revocationCheck(K7) == true` → `LLN-FUSE-KEY-REVOKED` | **−1** |
| `G3` caps | (not reached / would be +1) | +1 |
| `G_S1` cert | (independent of the manifest key) | +1 |

Compose: `A = allOf([+1,+1,+1,+1,−1,+1,+1]) = min(…) = −1` (Theorem 1: one −1 absorbs).
`decideAtBoundary(−1) = { decision:"deny", authorized:false }`.

→ **DENY.** Note the subtlety: the signature *passed* (`G2 = +1`) — Gate 2 only proves the bytes were signed by K7,
and the leaked private key would forge a valid signature. **Gate 2b is what catches it**, and it is fail-closed even
if the revocation registry itself throws (the `LLN-FUSE-REVOCATION-UNVERIFIABLE` branch, `fuse-loader.ts:537`, also
returns DENY: unknown → DENY).

### Example C — `GET /report` over a vanilla third-party HTTPS API with an **unreachable OCSP responder** (the
fail-closed soft-fail case), DENIED via INDETERMINATE (0)

This is the 0068 regular-API scenario: B8 is the *client* calling someone else's standard TLS 1.3 + X.509 endpoint.
The crypto library validates the chain (it builds, leaf matches a pin, not expired), but the OCSP responder times
out, so revocation status is **unknown**.

S1 sub-trits:

```
pin_match        = +1
chain_valid      = +1
not_expired      = +1
revocation_fresh =  0      # responder unreachable ⇒ status unknown (NOT assumed good)
```

```
G_S1 = vAnd(+1, +1, +1, 0) = min(+1,+1,+1,0) = 0
```

Upstream gates (`G_shim … G3`) are all +1 (the local module is fine). Compose:

```
A = allOf([+1,+1,+1,+1,+1,+1, 0]) = min(…) = 0
decideAtBoundary(0) = { decision:"deny", authorized:false, diagnostic: LLN-GOV-3VL-001 }
```

→ **DENY**, and an `LLN-GOV-3VL-001` audit record is emitted (an indeterminate verdict reached the boundary and was
collapsed). A conventional TLS client would *soft-fail* here and connect anyway; B8's `revocation-unknown → DENY`
maths refuses. This is exactly the MITM-hardening value 0068 attributes to the cert-gate over standard transport.

### 3.1 The 0068 regular-API threat → mitigation table (what B8 must satisfy)

From `done/0068-…`; tier tags are honest:

| Threat | B8 mitigation (over standard TLS 1.3 + X.509) | Tier |
|---|---|---|
| **MITM / TLS interception** | (a) `G_S1` K3 cert-gate `cert_verdict = vAnd(pin_match, chain_valid, not_expired, revocation_fresh)`, **revocation-unknown → DENY** (Example C); (b) content-addressed cert/key **pinning** via fuse Gates 1/2/2b (`fuse-loader.ts:492-542`), no X.509 path re-impl; (c) the no-downgrade / no-plaintext `DEFAULT_TLS_POLICY` floor (`core-network/src/index.ts:116-123`, `allowDowngrade:false`, `allowPlaintextFallback:false`). | cert-gate **NET-NEW** · pinning **SHIPPED** · TLS floor **SHIPPED-declarative** (live-handshake enforcement = the B8 net-new piece) |
| **SSRF / metadata-endpoint / DNS-rebind (outbound)** | `egress-guard.ts` (169.254.169.254 deny `:104`; AWS IPv6 metadata `:176`; metadata hostnames `:194-199`) + capability-bounded `network.outbound` (deny-by-default, `fuse-loader.ts:227-233`); `verifyWasm` performs **no instantiation** (`wasm-runtime.ts:99`). | **SHIPPED** |
| **Token theft / bearer replay** | capability-**DECLARED** auth (vs bearer-possession) at the package boundary (Gate 3, `LLN-FUSE-UNKNOWN-CAP`); a Governed Trust Capsule travels over HTTP as an attenuating caveat token; **channel-binding** the request identity to the connection via TLS exporter keying (RFC 5705) → capsule `cnf` (RFC 8747). NB the **shipped kernel auth is presence-only** today (`kernel.ts:306-309` = `mode=="required" ∧ no Authorization ⇒ 401`, zero token/sig/claim verification) — the S1-style verdict is the real fix. | caps **SHIPPED** · capsule caveats **DECIDED** (slice 5 / #12) · RFC-5705 channel-binding **NET-NEW** |
| **Response tampering / supply-chain of API responses** | govern-don't-absorb + verify-before-parse: a response is trusted only to the extent it carries its own signature/hash LogicN can verify. Raw TLS gives transport integrity, not app-level provenance. | transport integrity **SHIPPED (TLS)** · app-level provenance **NOT-POSSIBLE-OVER-STANDARD** unless the peer signs its payloads |

---

## 4. The hard build path

The ordered implementation steps when B8 implementation begins (the first-3 of 0066 §4, expanded with the exact
shipped functions to reuse, I/O, tests, and the gotchas). **No code is written into `logicn-framework-api-server` as
part of this guide — this is the build order to direct.**

### Step 0 — Pre-work must-fix (do before any capsule-backed identity is read)

Reconcile the Governed Trust Capsule §2-vs-§8 pre-hash contradiction (hub D13: §2 signs the `Sig_structure` directly
per RFC 9964 vs §8 step 4 pre-hashes `M = SHA-256(CBOR(Sig_structure))`). Pick one before implementing the capsule
reader. This blocks RFC-5705 channel-binding (the token theft mitigation) but **not** the cert-gate.

### Step 1 — Bind shipped content-addressed admission to the handshake + land the S1 K3 cert gate

This is the **highest-value, lowest-risk, crypto-stays-digital** move and the converged build-first.

- **Module / where:** a new standalone governance pass (B8-hosted), consuming a **host-library-validated** chain.
  Do **not** create a parallel verdict type — reuse `Verdict` and the K3 calculus.
- **Reuse (cite):** `vAnd` (`three-valued-governance.ts:49-51`), `allOf` (`:73-76`), `decideAtBoundary` (`:141-152`);
  the pinning is already in fuse Gates 1/2/2b (`fuse-loader.ts:492-542`); the declarative floor is
  `DEFAULT_TLS_POLICY` + `validateTlsPolicy` (`core-network/src/index.ts:116-123, :298-312`).
- **Inputs:** the four library-derived signals `{pin_match, chain_valid, not_expired, revocation_fresh}` each as a
  `Verdict`; the pinned anchor set; a revocation source.
- **Output:** `cert_verdict = vAnd(...) ∈ {−1,0,+1}`, fed into the admission `allOf`, resolved by
  `decideAtBoundary` (emits `LLN-GOV-3VL-001` on a 0).
- **Tests to write:** (1) all-good → +1 → admit (Example A); (2) revoked → −1 → deny (Example B); (3)
  **revocation-unknown → 0 → deny + `LLN-GOV-3VL-001`** (Example C — the soft-fail closure); (4) pin mismatch → −1;
  (5) expired → −1; (6) golden vector that a fetch *throwing* yields DENY not allow.
- **HARD PARTS / gotchas:**
  - **`revocation_fresh` must map unknown → 0 (then deny), never → +1.** This is the single most-likely bug — it is
    where every standard TLS stack soft-fails. The throwing/unreachable branch must be DENY (mirror
    `fuse-loader.ts:537`).
  - **Do not re-implement X.509 path-building or ASN.1.** Consume the library's binary chain-valid result; LogicN
    only folds verdicts. Re-implementing crypto here is a crypto-on-core temptation to refuse.
  - **`chain_valid` is binary from the library** — there is no honest "0" for it; only `revocation_fresh` and
    `not_expired` (clock-unavailable) and `pin_match` (no-pin-configured) carry a meaningful 0.
  - Binding identity to the live handshake (RFC-5705 exporter → capsule `cnf`) is **NET-NEW** and depends on Step 0.

### Step 2 — The raw-byte host shim below the verdict + idempotency-gated 0-RTT

- **Module / where:** a thin host shim **below** the verdict, **NOT WASI sockets** (decided in R&D 0058). Inbound
  only at first.
- **Reuse (cite):** the accept-side capability shim `network.inbound` whose `__net_in_accept` returns `-1`
  deny-by-default (`fuse-loader.ts:217-225`); `verifyWasm` verifies before any host fn links (`wasm-runtime.ts:99`);
  the kernel idempotency gate that fails closed `store-error → 409` (`kernel.ts:329-344`) — the **shipped backstop
  against 0-RTT replay**.
- **Inputs:** wire bytes (after TLS terminates, or after TLSTP). **Output:** a request handle or `-1`.
- **Tests to write:** (1) no `network.inbound` capability → `__net_in_accept() == -1` → no bytes admitted; (2)
  duplicate idempotency key → 409 (`kernel.ts:341-343`); (3) idempotency store throws → 409 **fail-closed**
  (`kernel.ts:337-339`) — prove a 0-RTT replay cannot slip through on a store error.
- **HARD PARTS / gotchas:**
  - **The byte-mover ring-buffer the shim presumes is `#102-106`-gated (WASM Component Model) — ASPIRATIONAL-HW.**
    Until then, admitted symbiotes are first-party-trusted co-resident: intra-module zero-copy is free, but
    **cross-trust-boundary isolation is NOT a guarantee yet**. Mark it as such; do not claim isolation.
  - **0-RTT is legitimate net-new but MUST be idempotent/replay-protected.** Wire any 0-RTT/QUIC path through the
    idempotency gate; never admit a 0-RTT request that bypasses it. (`NetworkProtocol` already enumerates
    tcp/udp/websocket; `isUnsafeNetworkBackend` flags dpdk/xdp — reuse, don't re-enumerate.)
  - **No latency/throughput claim without a named-machine bench.** None has been run, so none may be asserted.

### Step 3 — The Recovering FSM (S4) + ECH/OHTTP for SNI

- **Module / where:** ONE added transport FSM state layered **above** the single K3 trit; plus the decided
  metadata-leak fix.
- **Reuse (cite):** the K3 trit + No-Coercion `e = vAnd(t*, r) ≤ t*` (the degrade-only law of §2.5, Theorem 2);
  `decideAtBoundary` for the transition condition.
- **Behaviour:** states `{Established, Recovering, Closed/Erase}`. Recovering **denies all data effects** while
  holding; `→ Established` only on a fresh `+1`; `--timeout--> Closed/Erase`, **never silently → +1**.
- **SNI:** use the **DECIDED ECH + Oblivious HTTP (RFC 9458)** pattern; **do NOT invent a bespoke LogicN mechanism.**
- **Tests to write:** (1) Recovering denies a data effect; (2) a fresh +1 promotes to Established; (3) timeout →
  Closed/Erase, asserting it never reaches Established without a +1; (4) a 0 or −1 during Recovering keeps holding
  (Theorem 2 — cannot be coerced up).
- **HARD PARTS / gotchas:**
  - **Do NOT mint a parallel `+1/0/−1` "holding" session trit.** That aliases the governance trit and is
    charter-forbidden — K3 `0 = INDETERMINATE` is fail-closed-neutral, **not** "holding." Reuse the single K3 trit
    and layer the FSM *above* it. (This was an explicitly refuted design.)
  - **Downgrade negotiation = borrow the Noise / WireGuard explicit-handshake pattern** (DECIDED; 0 repo refs
    today). The shipped `DEFAULT_TLS_POLICY` is only the *declarative* floor — the handshake mechanism that proves
    key state at each step is genuinely unbuilt.
  - **Morphing (S5) is opt-in `transport.obfuscate`, deny-by-default**; frame sizing must derive from the digital
    AEAD/KDF keystream, and a morphed frame must **replace** any cleartext routing tag (else re-opens
    `LLN-PRIVACY-002`). It resists size/boundary analysis but NOT timing/volume — say so; no perf claim without a
    bench.

### The single biggest gotcha across all of B8 (called out explicitly)

**The in-sandbox isolation guarantee is ASPIRATIONAL until #102-106 (+ Stage-B P9.4).** "TLS terminates inside the
WASM sandbox = mathematical security" is a *sound direction* but its isolation **guarantee** rests on DRCM/DSS.wasm —
`build/dss-supervisor.wasm` is a **115-byte placeholder** and the real DSS is ~31 KB of uncompiled `.lln`. The
shipped, citable half is the **kernel anti-middleware request pipeline + one-time fail-closed admission**
(`kernel.ts`, the fixed non-bypassable pipeline; idempotency gate `kernel.ts:329-344`). Do **not** present in-sandbox
termination as settled isolation. Deployment stance (main-app-as-WASM + packages-outside, R&D 0052) is DECIDED; the
isolation guarantee is not.

**Binding reminder for every step:** crypto/KDF/cipher/signature/key bytes stay **Binary**; photonics/analog feed
ONLY a K3 verdict via `vAnd` (degrade-only, Theorem 2), never a key byte. Fail-closed: unknown → DENY (Examples B
and C). Honest tiering: SHIPPED (kernel pipeline, `verifyWasm`, fuse Gates 1/2/2b/3, egress-guard,
`DEFAULT_TLS_POLICY`, idempotency gate) vs DECIDED (raw-byte shim, ECH+OHTTP, Noise downgrade,
main-app-as-WASM) vs ASPIRATIONAL-HW (#102-106 in-sandbox isolation, byte-mover ring-buffer, cross-trust-boundary
zero-copy). No perf claim without a named-machine bench.

# Absorbed R&D — TLSTP transport + auth cluster (worker dones 0065 / 0066 / 0068)

**What.** The R&D worker's completed specs for the transport/auth cluster, absorbed into the LogicN KB so they are
durable + findable here (not only in the R&D bridge). Canonical full reports live in the R&D repo:
`C:\wwwprojects\LogicN-R-AND-D\_session-bridge\done\{0065,0066,0068}-*.done.md`. All three are **DESIGN/SPEC only —
no code**; **B8 (`logicn-framework-api-server`) stays OWNER-LOCKED**. Grounded on the hub's decision-support doc
[logicn-tlstp-transport-auth-rnd-2026-06-22.md](../logicn-tlstp-transport-auth-rnd-2026-06-22.md) (workflow
`wi3py3913`); ~75-85% of the owner's notes re-derive shipped architecture — those are cited, not rebuilt.

**Binding posture (all three):** crypto/KDF/cipher/signature bytes stay **Binary**; photonics/analog may feed ONLY a
K3 governance/availability verdict via `vAnd` (degrade-only), never a key. Fail-closed (unknown→DENY). No perf claim
without a named-machine bench. The **Ternary Ephemeral Ratchet** (`K_{n+1}=KDF(K_n, E_ternary)`) stays **REFUTED**.

**The single build-first lead (all three converge on it):** the **K3 cert/channel-validation gate (0065 S1)** —
`cert_verdict = vAnd(pin_match, chain_valid, not_expired, revocation_fresh) ∈ {+1,0,−1}`, **revocation-UNKNOWN →
DENY**, over a *library-validated* chain (no ASN.1/path-building re-impl). Highest-value, lowest-risk, zero new
crypto, reuses shipped `decideAtBoundary`. It works identically for the bespoke TLSTP transport AND for a vanilla
third-party HTTPS API — so it is the smallest add-on that hardens MITM today. Confirmed UNBUILT (`cert_verdict` = 0
hits in `packages-logicn`). Owner-gated (B8-adjacent) — surface, don't auto-build.

---

## 0065 — TLSTP digital-core spec (the 5 net-new survivors)

| ID | Survivor | Shipped base it extends | Genuinely new | Tier |
|---|---|---|---|---|
| **S1** | **K3 cert/channel-validation gate** (build FIRST) | `three-valued-governance.ts:41-75` K3 + `decideAtBoundary`; `fuse-loader` Gates 1/2/2b pinning | a standalone governance pass folding library chain-validation + revocation/freshness into one fail-closed K3 verdict (revocation-unknown→DENY) | buildable-now (digital) |
| **S2** | **Asymmetric KEM-rekeying ephemeral ratchet** | hybrid X25519+ML-KEM-768 (`kemdem.ts`); SHAKE256 MK/CK chain (`tmf-history-chain-v0 §2`) | periodic asymmetric rekey → **post-compromise security** on top of the symmetric chain's forward secrecy; rekey secret is the KEM shared secret (Binary), never `E_ternary` | buildable-now (digital) |
| **S3** | **Digital FEC over OPAQUE AEAD ciphertext** | AES-256-GCM / XChaCha20-Poly1305 ciphertext+tag (`kemdem.ts`) | loss recovery w/o retransmission; FEC sits **UNDER** the AEAD (repairs ciphertext, touches no key/plaintext); post-repair bit error still fails the tag → −1/DENY. The only sound residue of refuted "ternary symbol repair" | buildable-now (digital); overhead needs a bench |
| **S4** | **"Recovering" transport FSM above K3** | K3 trit + `substrate-model.ts` No-Coercion `e=vAnd(t*,r)≤t*` | exactly ONE added transport state `{Established, Recovering, Closed/Erase}`; Recovering denies ALL data effects, holds the channel, `→Established` only on a fresh +1, `--timeout--> Closed/Erase` (never silently →+1). NOT a parallel +1/0/−1 (that alias is refuted) | buildable-now (digital) |
| **S5** | **Opt-in `transport.obfuscate` morphing frames** | deny-by-default caps (`fuse-loader.ts:435-455`); digital AEAD/KDF keystream | keystream-seeded frame sizing; morphed frame **REPLACES** any cleartext routing tag (else re-opens `LLN-PRIVACY-002`). Honest limit: resists size/boundary analysis, **NOT** timing/volume. Metadata-confidentiality, not payload | buildable-now (digital); needs a bench |

**Adjacent (fold into B8):** downgrade negotiation = borrow Noise/WireGuard handshake pattern (0 repo refs);
identity-on-wire = bind shipped content-addressed admission to the live handshake; kernel auth presence-stub
(`kernel.ts:307`) → the S1 verdict is the real fix.
**Build order:** S1 first → S4+S2 (security core) → S3+S5 (availability/metadata, each behind a bench). **Pre-work
must-fix (hub D13):** reconcile the Governed Trust Capsule §2-vs-§8 pre-hash contradiction before any capsule-backed
identity token is read.

---

## 0066 — B8 governed transport-adapter design (owner-locked → design-only)

**Request path (end to end):** `wire bytes → [RAW-BYTE HOST SHIM below the verdict, NOT WASI sockets (0058);
__net_in_accept accept-side deny-by-default; byte-mover ring-buffer #102-106-gated] → [verifyWasm, verify before any
host fn links, NO instantiation] → [fuse-loader admission: Gate-1 sha256 pin · Gate-2 Ed25519 vs pinned keyId ·
Gate-2b revocation · Gate-3 deny-by-default caps] → [K3 verdict: decideAtBoundary + the S1 cert gate] → [admitted
flow, capability-bounded effects] → response (optional S5 morphing) → wire`. The protocol logic (0065 S1-S5) sits
ABOVE the shim; the adapter is host plumbing that never sees a key.

**Decisions:** termination = main-app-as-WASM + packages-outside (0052), NOT a monolith; in-sandbox-TLS-termination
isolation = **aspirational** (DRCM/DSS.wasm 115-byte stub, #102-106). WASI vs raw-bytes = **raw-byte shim (DECIDED,
0058)**. TCP vs QUIC = QUIC/UDP+0-RTT legitimate net-new, **0-RTT must be idempotency-gated** (kernel store-error→409
backstop). Legacy = **prefer a proxy** over an in-core legacy endpoint. SNI = **ECH + Oblivious HTTP (RFC 9458)**,
don't invent. Downgrade = **Noise pattern**. Identity-on-wire = bind shipped admission via RFC-5705 exporter keying
→ capsule `cnf` (**the net-new B8 piece**). Morphing = opt-in `transport.obfuscate`.

**Tiering:** SHIPPED = kernel anti-middleware pipeline · verifyWasm verify-before-link · fuse-loader gates ·
egress-guard · `DEFAULT_TLS_POLICY` floor · idempotency gate. DECIDED = raw-byte shim · main-app-as-WASM ·
ECH+OHTTP · Noise downgrade. ASPIRATIONAL-HW/#102-106 = in-sandbox isolation guarantee · byte-mover ring-buffer ·
cross-trust-boundary zero-copy · admitting an untrusted P2P peer's wasm.

**First 3 to build when B8 unlocks:** (1) bind shipped admission to the handshake + land the S1 K3 cert gate;
(2) the raw-byte host shim below the verdict + idempotency-gated 0-RTT; (3) Recovering FSM (S4) + ECH/OHTTP for SNI.

---

## 0068 — LogicN governance for REGULAR HTTP/SSL APIs (the standard-transport complement)

**Honest boundary:** over a standard TLS 1.3 + X.509 chain, LogicN governs **ON TOP of** someone else's PKI — it
does not replace it (cannot abolish CAs; cannot do photonic auth). Real value = **pinning + a fail-closed K3 verdict
+ egress control + capability bounds**.

| Threat | Mitigation (over standard TLS) | Tier |
|---|---|---|
| **MITM / TLS interception** | S1 K3 cert-gate (revocation-unknown→DENY) + content-addressed cert/key pinning (`fuse-loader` Gates 1/2/2b) + no-downgrade/no-plaintext `DEFAULT_TLS_POLICY` floor | cert-gate **NET-NEW** · pinning **SHIPPED** · TLS floor **SHIPPED-declarative** (live handshake enforcement = B8/0066) |
| **SSRF / metadata-endpoint / DNS-rebind (outbound)** | `egress-guard.ts` (169.254.169.254 deny · URL-credential SSRF deny · verify-before-instantiate) + capability-bounded `network.outbound` | **SHIPPED** |
| **Token theft / bearer replay** | capability-DECLARED auth (vs possession); capsule caveat token over HTTP; **RFC-5705 channel-binding → capsule `cnf` (RFC 8747)**. (Kernel auth is presence-only today — S1 verdict is the real fix, adjacent #212) | caps **SHIPPED** · capsule **DECIDED** (#12) · channel-binding **NET-NEW** |
| **Response tampering / supply-chain** | govern-don't-absorb + verify-before-parse; app-level provenance needs the API to sign its payloads | transport integrity **SHIPPED (TLS)** · app-level provenance **NOT-POSSIBLE-OVER-STANDARD** unless peer cooperates |

**Lead rec:** ship the **K3 cert-gate + trust-anchor pinning as ONE reusable governance pass** (the S1, consuming a
standard library-validated chain). Same primitive whether transport is TLSTP or vanilla TLS. **NOT possible over
standard transport (needs both endpoints / TLSTP):** frame morphing (S5), asymmetric KEM ratchet (S2),
path-fingerprint-as-secret. A locally-measured path-deviation is only a degrade-only K3 input (0070), never an auth
factor ("unspoofable" refuted — optical PUFs are PAC-learnable).

---

## Cross-cutting + status
- **Convergent build-first across all three: the K3 cert-gate (S1).** It is the one item that is net-new, in-bounds,
  crypto-digital, and useful for BOTH bespoke TLSTP and standard third-party APIs. Owner-gated (B8-adjacent) — ask.
- **Still pending from the worker (will absorb when they land):** 0067 (boundary R&D + prove-maths double-check),
  0069 (DTM → degrade-only K3 telemetry), 0070 (photonic/path-deviation TamperTrust resolver).
- **Owner decision still owed:** unlock B8 / authorize the S1 cert-gate as a standalone governance pass. See
  [logicn-tlstp-transport-auth-rnd-2026-06-22.md](../logicn-tlstp-transport-auth-rnd-2026-06-22.md) §"B8/HTTP guidance".

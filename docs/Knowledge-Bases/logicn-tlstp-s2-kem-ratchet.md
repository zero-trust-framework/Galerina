# TLSTP S2 — asymmetric KEM-rekeying ratchet

> **BUILD-GUIDE** (LogicN KB). One adopted TLSTP survivor: the asymmetric KEM-rekeying ratchet (hub finding **S2**).
> Citations resolve `file:line` against the read-only production repo `C:\wwwprojects\LogicN`.
> **Binding posture (carried into every claim below):** every key/KDF/cipher/signature byte is **Binary (digital)**;
> photonics/analog may feed ONLY a degrade-only K3 governance verdict via `vAnd`, **never a key**. Fail-closed
> (unknown → DENY). No perf claim without a named-machine bench. Honest tiering. The ~75–85% that re-derives shipped
> architecture is **cited, not re-derived**.

---

## 1. What it is + why adopted

S2 extends the **shipped symmetric SHAKE256 key-erasure ratchet** (the per-epoch `CK→MK` hash chain specified in
`packages-logicn/logicn-ext-tmf/spec/tmf-history-chain-v0.md:55-73`, golden-vectored and frozen) with a periodic
**asymmetric rekey**: every `N` messages or `T` seconds the two endpoints run a fresh ephemeral hybrid
**X25519 + ML-KEM-768** encapsulation, derive a new root, and reseed the chain key `CK`. The symmetric chain alone
gives **forward secrecy (FS)** by one-way KDF irreversibility + mandatory key erasure, but `tmf-history-chain-v0.md:70-73`
states honestly that it does **not** survive long-term-key compromise and that the asymmetric ratchet "that would give
full FS is explicitly out of scope" (`:218-220` §9). S2 builds exactly that missing piece, reusing the shipped hybrid
KEM in `packages-logicn/logicn-ext-tmf/src/kemdem.ts:19-21,145,148-150,172` (X25519+ML-KEM-768 → SHAKE256 → AES-256-GCM,
zeroize-in-`finally` at `kemdem.ts:184-187`) so it adds **no new crypto primitive** — only a rekey trigger and a reseed
step. It was adopted (per `done/0065 §2-S2`; hub disposition `logicn-transport-auth-research-explained-2026-06-22.md:54`)
because it delivers **post-compromise security (PCS)** — a property no shipped rail has — using only digital primitives,
and because it is the clean digital replacement for the **REFUTED** Ternary Ephemeral Ratchet (see §2.5).

---

## 2. The maths, in detail

### 2.0 Symbols (defined once)

| Symbol | Type | Meaning |
|---|---|---|
| `n` | ℕ | message / packet index (0-based) |
| `MK_n` | 256-bit string | **message key** for packet `n` (the AEAD key seed) |
| `CK_n` | 256-bit string | **chain key** at step `n` (the ratchet state) |
| `R_e` | 256-bit string | **root key** of asymmetric **epoch** `e` (≥1 reseed) |
| `e` | ℕ | epoch index; `e=0` is the genesis epoch from channel setup |
| `KDF`, `KDF'` | {0,1}* → {0,1}²⁵⁶ | two domain-separated SHAKE256 calls (constants below) |
| `H` | SHAKE256 | `createHash("shake256",{outputLength:32})` (`kemdem.ts:50-52`) |
| `LP(x)` | bytes | length-prefix `u32le(len(x)) ‖ x` (`kemdem.ts:60-61`; `tmf-history-chain-v0.md:57`) |
| `(pk_e, sk_e)` | KEM keypair | fresh ephemeral hybrid X25519+ML-KEM-768 pair for epoch `e` (`kemdem.ts:148-150`) |
| `ct_e` | bytes | KEM ciphertext (encapsulation output, `kemdem.ts:172`); 1120 B for hybrid (`kemdem.ts:31`, profile `0x02`) |
| `ss_e` | bytes | **KEM shared secret** of epoch `e` — the rekey secret (Binary) (`kemdem.ts:172`) |
| `‖` | — | byte concatenation (`kemdem.ts:53-58`) |
| `≔` | — | assignment; `🔥X` | mandatory secure-delete of `X` (overwrite to 0) |
| `N`, `T` | ℕ, sec | rekey thresholds (messages-since-rekey ceiling; wall-clock ceiling) |

Domain-separation constants (Keccak, suite-consistent; mirrors the shipped chain so byte-math is reusable):
`"tmf-hist-msg-v0"` for `MK`, `"tmf-hist-step-v0"` for `CK` step (`tmf-history-chain-v0.md:61-62`), and a **new**
S2 root constant `"tlstp-s2-root-v0"` for the reseed (defined in §4).

### 2.1 The symmetric chain (shipped — FS by one-way KDF)

Within one epoch the state advances per message exactly as the frozen spec (`tmf-history-chain-v0.md:61-63`):

```
MK_n     ≔ KDF'(CK_n)  = H( LP("tmf-hist-msg-v0")  ‖ LP(CK_n) )[:32]      (message key)
CK_{n+1} ≔ KDF (CK_n)  = H( LP("tmf-hist-step-v0") ‖ LP(CK_n) )[:32]      (ratchet forward)
🔥CK_n ; 🔥MK_n   -- once packet n is sealed, BEFORE accepting packet n+1
```

`MK_n` then seeds the AEAD key by the **unchanged** schedule
`K_aead = H( LP("tmf-dem-kdf-v0") ‖ LP(MK_n) ‖ LP(aead_context) )[:32]` (`kemdem.ts:104-107`;
`tmf-history-chain-v0.md:79`, with `shared_secret := MK_n`).

**Forward-secrecy lemma (FS).** `H = SHAKE256` is modelled as a one-way function: there is no PPT adversary that,
given `CK_{n+1}`, recovers `CK_n` (or `MK_n`) except with negligible probability `≈ 2⁻²⁵⁶` (a preimage). Because the
writer erases `CK_n, MK_n` (precondition 1, `tmf-history-chain-v0.md:68-69`):

> **FS:** compromise of the live state at step `m` (i.e. `CK_m`) reveals `MK_j` for **no** `j < m`.
> Proof: `CK_m = KDF(KDF(…KDF(CK_j)…))` (`m−j` applications). Inverting any one application to step backward to `CK_j`
> requires a SHAKE256 preimage (negligible). The erased `MK_j` is not in memory. ∎

The honest limit (`tmf-history-chain-v0.md:70-73`): if `CK_0` came from a **long-term** KEM secret and that long-term
secret leaks later, the attacker recomputes `CK_0 → CK_1 → … → MK_j` and FS breaks. **The symmetric chain has no PCS.**
S2 closes precisely this gap.

### 2.2 The asymmetric rekey (S2 — the new step)

Define the **rekey predicate** at message `n` within epoch `e`, with `n_e` = the message index at which epoch `e`
began and `t_e` = its wall-clock start:

```
rekey?(n,t) ≔ (n − n_e ≥ N)  ∨  (t − t_e ≥ T)            -- Boolean OR; whichever fires first
```

When `rekey?` fires, the initiator runs a **fresh ephemeral hybrid KEM** (the shipped `kemFor(0x02)`,
`kemdem.ts:145`):

```
initiator:  ct_{e+1}, ss_{e+1}  ≔  Encaps(pk_{e+1})            (kemdem.ts:172 — KEM .encapsulate)
responder:  ss_{e+1}            ≔  Decaps(ct_{e+1}, sk_{e+1})  (kemdem.ts:195 — KEM .decapsulate)
```

where `(pk_{e+1}, sk_{e+1})` is a **brand-new** ephemeral pair (`kemdem.ts:148-150`), independent of every prior epoch.
The rekey secret is **`ss_{e+1}` — the KEM shared secret, a Binary byte-string — never `E_ternary`** (§2.5).

The new **root** and **reseed** (the one genuinely-new equation; constant `"tlstp-s2-root-v0"`):

```
R_{e+1}   ≔ H( LP("tlstp-s2-root-v0") ‖ LP(R_e) ‖ LP(ss_{e+1}) )[:32]      (new root mixes OLD root + fresh ss)
CK_0^{(e+1)} ≔ H( LP("tlstp-s2-root-v0") ‖ LP(R_{e+1}) )[:32]              (reseed the per-message chain key)
🔥R_e ; 🔥CK_last^{(e)} ; 🔥ss_{e+1} ; 🔥sk_e (after responder side done)
```

Per-message indexing then restarts (§2.1) from `CK_0^{(e+1)}`. Mixing the **old** root `R_e` into `R_{e+1}` is the
"ratcheting-key-derivation" property (à la TLS 1.3 / Signal asymmetric ratchet): a passive observer who never sees a
single `ss` learns nothing, and an active attacker who compromised `R_e` is locked out the moment a fresh `ss_{e+1}`
they did not see is mixed in.

### 2.3 Forward secrecy + post-compromise security — formal statements

Let "compromise at packet `k`" mean the adversary reads **all live secret state in memory at the instant packet `k` is
processed** (i.e. `CK_k` and `R_{e(k)}`, where `e(k)` is `k`'s epoch), but does **not** thereafter observe the wire and
does **not** hold any other epoch's ephemeral `sk`.

Let `rekey(k)` = the index of the **first** message of the **next** epoch after `k` (the first reseed strictly after
`k`). Then:

> **Theorem (FS — packets before `k` are safe).**
> For every `j < k`, the adversary cannot recover `MK_j` (except w.p. `≈ 2⁻²⁵⁶`).
> *Proof.* If `j` is in an **earlier** epoch than `k`, then `R_{e(j)}` was erased at the `R_{e(j)} → R_{e(j+1)}` reseed
> (`🔥R_e` above) and `CK`/`MK` of that epoch were erased per-message (§2.1); recovering them from `CK_k`/`R_{e(k)}`
> needs a SHAKE256 preimage. If `j` is in the **same** epoch as `k` but `j < k`, the per-message FS lemma (§2.1) applies
> directly: stepping `CK_k` back to `CK_j` is preimage-hard. ∎

> **Theorem (PCS — packets at/after `rekey(k)` are safe).**
> For every `m ≥ rekey(k)`, the adversary cannot recover `MK_m` (except w.p. `≈ 2⁻²⁵⁶`), **provided** the reseed at
> `rekey(k)` used a fresh `ss` the adversary did not observe and whose ephemeral `sk` it does not hold.
> *Proof.* `MK_m` derives from `CK_0^{(e')}`, hence from `R_{e'} = H(… ‖ LP(R_{e'-1}) ‖ LP(ss_{e'}))` for the epoch `e'`
> of `m`, where `e' > e(k)`. By the hybrid-KEM IND-CCA assumption (X25519 **and** ML-KEM-768 — the hybrid is secure if
> **either** component is, `kemdem.ts:20,145`), `ss_{e'}` is computationally indistinguishable from random to an
> adversary that saw only `ct_{e'}` and not `sk_{e'}`. SHAKE256 over a uniform `ss_{e'}` makes `R_{e'}` (and thus every
> `MK_m`, `m ≥ rekey(k)`) independent of the compromised `R_{e(k)}`/`CK_k`. The window the attacker keeps is exactly
> `[k, rekey(k))` — the rest of `k`'s epoch — by design. ∎

> **Corollary (the headline).** A compromise at packet `k` leaves **packets `< k` safe (FS)** and **packets
> `≥ rekey(k)` safe (PCS)**; the **only** exposed window is the remainder of the current epoch `[k, rekey(k))`,
> bounded by `N` messages or `T` seconds. Shrinking `N`/`T` shrinks the breach window (a measurable
> security/throughput trade — any timing claim about that trade needs a named-machine bench).

### 2.4 The K3 / fail-closed boundary (reused, not re-derived)

S2 is pure crypto; its **admission** is governed by the shipped K3 calculus. A rekey that cannot complete
(decapsulation error, missing fresh `ss`, expired epoch with no successful reseed) yields verdict
`INDETERMINATE (0)`, which `decideAtBoundary` collapses to **DENY** (`three-valued-governance.ts:40-44,89-97`,
`LLN-GOV-3VL-001`). Any side-signal folds via `vAnd = minTrit` (`three-valued-governance.ts:49-51`): degrade-only, never
coercing an ALLOW. **Unknown rekey status → DENY → no data effects** (this is what TLSTP S4's "Recovering" FSM holds on;
see `done/0065 §2-S4`). Crypto stays Binary throughout; no analog ever touches `ss`, `R`, `CK`, or `MK`.

### 2.5 Why `E_ternary` in the KDF is REFUTED (1 paragraph)

The owner's notes proposed a **Ternary Ephemeral Ratchet** `K_{n+1} = KDF(K_n, E_ternary)` folding analog/photonic
entropy `E_ternary` directly into the per-packet KDF. It is **doubly dead**. (a) **Crypto-on-core violation:** analog
substrate bytes in a key are forbidden — `LLN-SUBSTRATE-001` is enforced at `substrate-model.ts` `CRYPTO_ON_NOISY_LANE='error'`
(per `logicn-tlstp-transport-auth-rnd-2026-06-22.md:42,87`). (b) **Internally broken — non-reproducible:** the photonic
emulator is `deterministic=false` with `ENOB_CEILING=8`, so the two endpoints would sample **different** `E_ternary`
values and derive **different** keys `K_{n+1}` — the AEAD tag fails on every packet and the channel is dead. A ratchet
**must** be bit-exact at both ends; analog cannot be. S2's rekey secret is therefore the **reproducible Binary KEM shared
secret `ss`** (`kemdem.ts:172`), which both endpoints compute identically from the same `(ct, sk)`. If physical entropy
is ever wanted, condition it through SP 800-90B/90A into a Binary CSPRNG **outside** the cipher — never inside the KDF.

---

## 3. Worked examples

All examples use truncated 4-hex-nibble stand-ins for 256-bit values to keep the algebra legible; the real outputs are
32-byte SHAKE256 digests. `H(...)` denotes the shipped `shake256(...)[:32]` (`kemdem.ts:50-52`).

### Example A — a clean stream with one rekey (FS within an epoch)

Setup: epoch `e=0`, `CK_0 = a1f0`, thresholds `N=3`, `T=∞`. Send packets 0,1,2,3.

| step | computation | value | erase |
|---|---|---|---|
| pkt 0 | `MK_0 = KDF'(a1f0)` | `7c22` | seal w/ `K_aead(7c22)` |
| | `CK_1 = KDF(a1f0)` | `9e08` | 🔥`a1f0`, 🔥`7c22` |
| pkt 1 | `MK_1 = KDF'(9e08)` | `b310` | seal |
| | `CK_2 = KDF(9e08)` | `04dd` | 🔥`9e08`, 🔥`b310` |
| pkt 2 | `MK_2 = KDF'(04dd)` | `f7a9` | seal |
| | `CK_3 = KDF(04dd)` | `55c1` | 🔥`04dd`, 🔥`f7a9` |
| **rekey?** | `n−n_e = 3 ≥ N=3` → **fires** | — | run §2.2 |
| reseed | `ct_1, ss_1 = Encaps(pk_1)` | `ss_1 = 6b2e` | — |
| | `R_1 = H(LP("tlstp-s2-root-v0")‖LP(R_0=0³²)‖LP(6b2e))` | `c9f4` | 🔥`R_0`, 🔥`6b2e`, 🔥`55c1` |
| | `CK_0^{(1)} = H(LP("tlstp-s2-root-v0")‖LP(c9f4))` | `2af7` | — |
| pkt 3 | `MK_3 = KDF'(2af7)` | `81bc` | seal w/ epoch-1 key |

Outcome: packets 0–2 used epoch-0 keys; packet 3 used a freshly-rooted epoch-1 key. The chain advanced 4 times and the
root rotated once. No analog touched any value; every key is reproducible at the peer (same `ct_1`, `sk_1`).

### Example B — compromise at packet `k=5`, what is protected

Setup: `N=3`. Epoch boundaries fall at packets 0, 3, 6, 9, … (a reseed every 3 messages). Adversary fully reads memory
at packet **k=5** (mid epoch-1): it obtains `CK_5` and `R_1`. It does **not** hold any epoch's ephemeral `sk` and does
not see future wire.

Compute `rekey(5)` = first message of the next epoch after 5 = packet **6**.

| packet range | epoch | adversary can recover `MK`? | why |
|---|---|---|---|
| 0,1,2 | 0 | **NO (FS)** | `R_0` and epoch-0 `CK/MK` were erased at the reseed into epoch 1; preimage-hard from `CK_5`/`R_1` (Thm FS) |
| 3,4 | 1 (`< 5`) | **NO (FS)** | same epoch, earlier index — step `CK_5` back to `CK_3/CK_4` is preimage-hard (Thm FS) |
| **5** | 1 | **YES** | this is the compromised packet — its `MK_5` derives from the live `CK_5` |
| **`[5,6)` = just 5** | 1 | exposed window | the breach window is `[k, rekey(k)) = [5,6)` — only packet 5 |
| 6,7,8,… | 2+ | **NO (PCS)** | epoch 2 reseeds with fresh `ss_2` the attacker never saw; `R_2 = H(…‖LP(R_1)‖LP(ss_2))` is independent of `R_1` under IND-CCA of the hybrid KEM (Thm PCS) |

So a single packet (5) is exposed; everything before is FS-safe, everything from the next reseed (6) on is PCS-safe.
Had `N` been 1 (rekey every message), the window would collapse to the single packet 5 with PCS resuming at 6 either
way; had `N` been 100, the window would be `[5,100)` — the breach window is exactly the epoch-tail length.

### Example C — FAILURE / DENY: rekey decapsulation fails → fail-closed

Setup: epoch boundary at packet 6; the responder receives a **corrupted** `ct_2` (one flipped bit, e.g. an active MITM
or transport corruption that FEC could not repair).

| step | computation | result |
|---|---|---|
| responder | `ss_2 = Decaps(ct_2', sk_2)` | KEM raises → caught as `TmfCryptoError("CryptoError", "KEM decapsulation failed…")` (mirrors `kemdem.ts:195-196`) |
| reseed | `R_2 = H(…‖LP(R_1)‖LP(ss_2))` | **NOT computed** — no valid `ss_2` |
| verdict | `rekey_status = INDETERMINATE (0)` (unknown) | — |
| boundary | `decideAtBoundary(vAnd(…, 0))` | `vAnd(x,0) = minTrit(x,0) ≤ 0` → `0` → **collapse → DENY** (`three-valued-governance.ts:49-51,89-91`) |
| transport | TLSTP S4 FSM → **Recovering**, deny ALL data effects; `--timeout--> Closed/Erase` (🔥 keys) | no plaintext egress; never silently `→ Established` |

Outcome: a failed rekey **cannot** silently fall back to the old (possibly-compromised) `R_1` and **cannot** proceed in
the clear. The unknown collapses to DENY (`LLN-GOV-3VL-001`); keys are erased on timeout. This is the fail-closed
guarantee made concrete: the channel halts rather than degrade its secrecy. Note `vAnd` is degrade-only — even if some
other input were `ALLOW (+1)`, `minTrit(+1, 0) = 0 → DENY`; an analog/photonic signal could only push **toward** DENY,
never manufacture an ALLOW.

---

## 4. The hard build path

**Target module.** New file `packages-logicn/logicn-ext-tmf/src/s2-ratchet.ts` (sibling to `kemdem.ts`), or a
transport-side module under the B8 adapter (`done/0066`). **B8 is now UNLOCKED** (owner, 2026-06-22) and S2 is the
security core after the S1 cert-gate (`logicn-transport-auth-research-explained-2026-06-22.md:88`). It is **owner-gated /
B8-adjacent**: surface as a build step, do not auto-ship outside the agreed sequence (S1 → S4+S2 → S3+S5).

### Ordered steps

1. **Reuse the symmetric chain verbatim (do NOT reimplement SHAKE256).** Lift the two ratchet equations from
   `tmf-history-chain-v0.md:61-63` and the AEAD-key schedule from `kemdem.ts:104-107` (`deriveKaead`). Use the existing
   helpers `shake256` (`kemdem.ts:50-52`), `concat` (`kemdem.ts:53-58`), `lp`/`u32le` (`kemdem.ts:59-61`). Add only the
   two domain constants `"tmf-hist-msg-v0"`, `"tmf-hist-step-v0"` (mirroring `tmf-history-chain-v0.md:61-62`).
   *Inputs:* `CK_n` (32 B). *Outputs:* `MK_n` (32 B), `CK_{n+1}` (32 B).
2. **Implement the reseed.** New constant `DOM_S2_ROOT = enc.encode("tlstp-s2-root-v0")` (pattern: `kemdem.ts:68-71`).
   Function `reseed(R_e, ss) → { R_next, CK0 }` computing the two §2.2 equations. *Inputs:* `R_e` (32 B), `ss` (the KEM
   shared secret bytes from step 3). *Outputs:* `R_{e+1}`, `CK_0^{(e+1)}`.
3. **Wire the rekey to the SHIPPED hybrid KEM.** Initiator: `const {cipherText, sharedSecret} = kemFor(0x02).encapsulate(pk)`
   — reuse `kemFor`/`KEM_PROFILE.HYBRID_X25519_ML_KEM_768` (`kemdem.ts:26-29,143-147,172`). Responder:
   `kemFor(0x02).decapsulate(ct, sk)` (`kemdem.ts:195`), wrapped in the same try/catch that raises
   `TmfCryptoError("CryptoError", …)`. Fresh ephemeral pair per epoch via `keygen(0x02)` (`kemdem.ts:148-150`).
   *Inputs:* peer `pk_{e+1}`. *Outputs:* `ct_{e+1}` (1120 B for `0x02`, `kemdem.ts:31`), `ss_{e+1}`.
4. **Implement the rekey trigger.** Maintain per-epoch `(n_e, t_e)`; evaluate `rekey?(n,t) = (n−n_e ≥ N) ∨ (t−t_e ≥ T)`
   before each send. On fire, run steps 3→2, restart per-message indexing from `CK_0^{(e+1)}`.
   *Inputs:* `N`, `T` (declared, static — they are policy, not secrets). *Output:* a boolean + (on fire) a new epoch.
5. **Mandatory key erasure (the most security-critical step).** After each message: `CK_n.fill(0); MK_n.fill(0)`.
   After each reseed: `R_e.fill(0); ss.fill(0); CK_last^{(e)}.fill(0)`, and on the responder `sk_e.fill(0)` once the
   epoch is established. Do all of this in a `finally` block — copy the exact pattern from `kemdem.ts:184-187,211-213,238-240`
   (`kaead.fill(0); sharedSecret.fill(0); caad.fill(0)`). **Honest tier:** on the TS/GC VM this is **best-effort**
   (`kemdem.ts:185` "best-effort on a GC VM — shrinks the remanence window"); hardware-grade zeroization is
   aspirational-HW (#102-106). Do not assert guaranteed wipe.
6. **Govern admission at the boundary.** Resolve rekey status to a `Verdict` (`three-valued-governance.ts:33,40-44`);
   unknown/failed → `INDETERMINATE`; fold via `vAnd` (`three-valued-governance.ts:49-51`); decide with
   `decideAtBoundary`/`collapse` (`:89-97`, `LLN-GOV-3VL-001`). Pair with the S4 "Recovering" FSM (`done/0065 §2-S4`):
   while a rekey is pending/failed, deny ALL data effects; `--timeout--> Closed/Erase`.

### Tests to write

- **FS unit:** advance the chain `m` steps, assert no function recovers `CK_j` (`j<m`) from `CK_m` (negative test —
  the API must not even expose a back-step). Assert `MK_n` distinct per `n` and `CK_{n+1} ≠ CK_n` (mirrors the shipped
  golden-vector check `tmf-history-chain-v0.md:142-143`).
- **PCS unit:** simulate compromise at `k`; assert keys for `m ≥ rekey(k)` are independent of `R_{e(k)}` (reseed with a
  fresh `ss` and check the derived `MK_m` differs from any value derivable from the pre-rekey state).
- **Determinism / reproducibility:** both endpoints, given the same `(ct, sk)`, derive byte-identical `ss`, `R_{e+1}`,
  `CK_0^{(e+1)}` (this is the test the Ternary Ratchet would FAIL — keep it as the guard against any analog regression).
- **Failure / DENY (Example C):** corrupt `ct`, assert `Decaps` raises `TmfCryptoError`, assert the boundary collapses
  to DENY (`LLN-GOV-3VL-001`), assert no plaintext egress and keys erased on timeout.
- **Trigger:** assert `rekey?` fires at exactly `n−n_e = N` and at `t−t_e = T`, whichever first; assert epoch index +
  message index reset correctly.
- **Erasure (best-effort):** assert the post-use buffers are zeroed (`.every(b=>b===0)`); document it as best-effort.
- **Golden vectors:** add deterministic SHAKE256 vectors for the reseed (real `H`; KEM structural placeholder, exactly
  as `tmf-history-chain-v0.md:140-141` / `kemdem.ts` header notes — KEM carries randomness so no fixed golden, verify by
  round-trip + tamper).

### Hard parts / gotchas (called out)

- **HARD — erasure ordering is the whole FS proof.** FS holds *only* if `CK_n`/`MK_n` are erased **before** packet `n+1`
  is accepted (`tmf-history-chain-v0.md:68-69`, precondition 1). A single retained `CK_n` voids the FS theorem for that
  index. Erase in `finally`, never on the happy path only. This is the easiest thing to get subtly wrong.
- **HARD — `CK_0` provenance.** If the genesis `CK_0` is derived from a **long-term** KEM secret, FS breaks under
  long-term-key compromise *until the first reseed* (`tmf-history-chain-v0.md:70-73`). S2's whole value is that the
  reseed mixes fresh ephemeral `ss`; make sure the **first** epoch is reached promptly (small `N`/`T`) and that
  ephemeral `sk_e` is erased after each epoch — a retained `sk_e` lets an attacker recompute `ss_e` and breaks PCS for
  that epoch (this is the precondition in the PCS theorem).
- **HARD — both endpoints must derive identical `ss`.** This is the bit-exactness requirement that kills the analog
  ratchet (§2.5). Never let any non-deterministic / analog value enter `ss`, `R`, `CK`, or `MK`. The reproducibility
  test above is the regression guard; treat any analog-in-key as `LLN-SUBSTRATE-001` `'error'`.
- **MEDIUM — fail-closed on rekey failure.** A failed `Decaps` must **not** fall back to the old root and must **not**
  proceed in cleartext. Route through `INDETERMINATE → DENY` + S4 Recovering/Erase (Example C). The tempting "retry with
  old keys" path is a security hole.
- **MEDIUM — `vAnd` is degrade-only, never source-of-ALLOW.** Any auxiliary signal (e.g. a TamperTrust trit, `done/0070`)
  folds via `vAnd = minTrit` (`three-valued-governance.ts:49-51`): it can only push toward DENY. Do not invert this into
  an OR that could manufacture an ALLOW.
- **EASY-TO-MISS — don't reinvent crypto.** Everything cryptographic already exists in `kemdem.ts`: SHAKE256, the
  length-prefix house format, the hybrid KEM, AEAD, zeroize-in-finally. S2 adds **one** new domain constant and **two**
  equations (the reseed). If you find yourself importing a new crypto library or hand-rolling a KDF, stop — reuse the
  shipped rail and cite it.
- **DEFERRED (don't block on it) — anti-replay / nonce hygiene across an epoch boundary.** The shipped STREAM nonce
  derivation (`kemdem.ts:117-134`) restarts per epoch (fresh `K_aead` from a fresh root), so cross-epoch nonce reuse is
  structurally avoided; still add a test that the first message of epoch `e+1` uses a fresh nonce prefix.
- **PERF — no claim without a bench.** Smaller `N`/`T` shrink the breach window but add KEM operations (a hybrid
  encaps/decaps is non-trivial). Any statement about the security/throughput trade-off needs a named-machine bench
  (i9-9900K or stated device) — none is asserted here.

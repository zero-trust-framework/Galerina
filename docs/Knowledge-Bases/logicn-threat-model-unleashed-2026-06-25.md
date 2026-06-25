# Threat-model — "what has this box unleashed" (2026-06-25)

Owner asked: beyond the already-covered runaway-compute/DoS, what NEW attack surfaces does LogicN unleash by
*being* an interpreter + WASM emitter + effect-runtime + crypto/manifest admission + K3 governance + untrusted-lane
engine? Adversarial threat-model (`wf_9a0cd48c-71e`, 17 agents, each with an attacker persona + a required
repro/file:line + a red-team refute pass). **This found real, exploitable holes — the deny-by-default core is
strong but several gates have bypasses.**

> **Headline: 2 CRITICAL + ~10 HIGH exploitable findings.** The single most dangerous: a **local-binding alias
> smuggles ANY effect past the entire capability model** (effect gate + tier floor + stdlib deny + taint sink) —
> the AI-propose→approve workflow trusts that gate. Net honest answer: LogicN's deny-by-default model *removes*
> whole bug classes (the structural wins are real), but the **enforcement has seams** — most are "a gate that
> matches by NAME and an attacker renames the thing," or "a verifier the build runs but the loader doesn't."

## Exploitable findings (sorted by severity)

| # | Surface | Threat | Sev | Fix | Status |
|---|---|---|---|---|---|
| C1 | Effects/capability | **A `let` alias of an effectful module performs any effect undetected** — the effect gate / tier floor / stdlib-deny / taint sink all match by receiver NAME; bind `let x = Http; x.fetch(...)` and the name-match misses | **critical** | resolve receiver identifiers through their `let`/`const`/param bindings before name-matching in `inferDirectEffectsForFlow`/`inferEffectsFromNode`/`checkStdlib*` | **◑ EFFECT/TIER FIXED** — a shared `buildModuleAliasMap(flow)` resolves `let x = Module` aliases (transitive + cycle-guarded, fail-closed monotonic) and is wired into ALL effect-checker paths (`inferDirectEffectsForFlow` + `inferEffectsFromNode` + `inferEffectCallLocations`, via an alias-aware `buildCallText`). Verified: `let x = AuditLog; x.write()` (+ chained `let y = x`) now fires the effect/tier gate (LLN-TIER-001); +5 regression tests; full suite 3910/0. **Residual (tracked):** the value-state TAINT sink (LLN-VALUESTATE-008) + stdlib-deny + secret-egress key off the same receiver name in their OWN modules and still miss the alias — they must reuse `buildModuleAliasMap` (now exported). |
| C2 | Emitter/build | **A signed WASM artifact can be a silently-wrong STUB** — a legal `.lln` whose WAT wabt REJECTS falls back to the minimal-encoder stub (`valid:true`, diagnostics≠0), and the build/sign path signs it | **critical** | require `assembled.valid && assembled.diagnostics.length===0` before signing (logicn.mjs ~1893 + cli.ts ~886) — the RD-0093/0115 strict-gate lesson, at the sign step | **✅ FIXED (production fail-closed)** — `LLN-EMIT-STUB` gate at the sign path: a non-faithful stub (`diagnostics≠0`) FAILS the build under `LOGICN_PROFILE=production` (never signs/ships it); dev warns loudly + proceeds (a dev key is not a production trust anchor). Verified: `001-pure-flow` was silently shipping a signed stub → now flagged/blocked; faithful examples sign clean; CLI prod tests 26/0. **Residual (tracked):** cli.ts:886 (unsigned internal bin, lower severity) + the deeper faithful-emit gap (many flows stub because the emitter can't lower them — the real long-term fix). |
| H1 | Parser | **Parser stack-overflow DoS** — ~1600 nested parens crash the compiler before governance runs | high | depth guard | **✅ FIXED 150db7e** (LLN-PARSE-DEPTH-001) |
| H2 | Effects | unregistered method on a **lowercase-aliased** effectful module escapes the #153 deny-by-default broad-effect rule | high | apply the deny-by-default rule to lowercase receivers when the name is a registered effectful module | TODO #36 |
| H3 | Crypto/admission | **Hybrid (PQ) signed manifest treated as UNSIGNED by the fuse admission gate** — the PQ upgrade silently turns OFF signature verification at load | high | add a hybrid branch to `verifyManifestSignature` mirroring logicn.mjs:1426-1486 | TODO #36 |
| H4 | Crypto/admission | **Verifier inconsistency** — `logicn build`/verify validates a hybrid manifest (both halves, revocation, fail-closed) but the kernel fuse loader does not | high | factor ONE shared `verifyManifestSignature` used by both logicn.mjs and the kernel | TODO #36 |
| H5 | Photonic admission | **Certified-mode photonic admission is a confused deputy** — `certifiedAttestation` is a caller-supplied object literal, not a verified signed manifest | high | bind certified photonic admission to a verified signed photonic `BridgeManifest` via `verifyAttestationHybrid` | TODO #36 |
| H6 | Photonic admission | the injected photonic offload port is **duck-typed and NOT attestation-gated** (`checkBridgeAttestation` only iterates `this.bridges`) | high | engine-side integrity rail: after the port returns, the engine itself runs the cheap exact recompute + `toleranceCheck` | TODO #36 |
| H7 | Crypto hygiene | **`constantTimeEquals` is NOT constant-time** — the reachable impl is short-circuiting JS `===` (interpreter.ts:1951, stdlib.ts:1083), while the real `timingSafeEqual` is bypassed | high | delete the two `===` impls; route all `constantTimeEquals`/`crypto.constantTimeEquals` to `crypto.timingSafeEqual` | **✅ FIXED** — one shared `constantTimeStringEquals` helper (timingSafeEqual on length-padded buffers, fail-closed); all three paths (interpreter + both stdlib dispatch) route through it; +5 regression tests (incl. a `===` drift guard); 3900/0 |
| H8 | Parser→governance | **Parser-DoS escalates to GOVERNANCE-SCAN EVASION** — `logicn init-env`'s catch SKIPS an unparseable flow file (analyzed-as-clean) | high | in the catch, record the file as a hard violation (a file the gate can't analyze must FAIL the scan) | **✅ FIXED** — the real mechanism was subtler than the catch: init-env inspected only GOVERNANCE diagnostics, never PARSE diagnostics, so a truncated/garbage/half-parsed flow (parse-errors>0, gov-errors=0 on the partial AST) read CLEAN. Now: parse errors are counted as violations + the catch fail-closes (`LLN-SCAN-UNANALYZABLE`). Verified: a malformed file → `LLN-PARSE-001` flagged + **exit 2** (was clean); clean corpus (40 files/101 flows) still passes. init-env is now the **dev-tool detector** for unanalyzable files. *(Found a dead duplicate init-env handler at logicn.mjs:~1267 — fixed fail-closed + flagged for removal.)* |
| P1 | Provenance | provenance signature attests **integrity, not source-fidelity** — it signs the exact emitter output, so any emit divergence is signed-as-correct | partial-high | gate signing on the faithful-compile check (C2); attest fidelity not just bytes | TODO #36 |
| P2 | check surfacing | `logicn check`/dev modes don't surface even correctly-detected **EFFECT-003 / STDLIB-002** violations as failures | partial-high | keep these integrity invariants as hard errors in ALL modes (same class as the 9043095 fix) | TODO #36 |

## Confirmed well-defended (no action — credit the design)
- **WASM record/array bump-alloc**: no per-alloc bounds check, but the committed-pages ceiling (no `memory.grow`) makes an over-allocation a **fail-safe trap**, not host OOM; the per-loop cap bounds count. (defense-in-depth nice-to-have only.)
- **Interpreter heap amplification**: bounded by the 1e9 global step budget (each alloc = a step); no host-exposed size-parameterized builder.
- **`.tmf` container parse-bomb**: bounds-before-alloc with BigInt-overflow-safe count/offset validation + non-allocating subarray views + signed-file rejection. Good defensive code.
- **Manifest/JSON parse-bomb**: V8 `JSON.parse` is iterative (no recursion DoS); all sites try/catch-wrapped.

## The honest net answer
Does LogicN add more attack surface than it removes? **It removes more — but the seams are real.** The
deny-by-default effects/types/traps structurally kill whole classes (injection, coercion, prototype-pollution,
overflow-wrap, null) — those wins are genuine and verified elsewhere this session. But this sweep shows the
*enforcement* has two recurring seams worth a dedicated hardening pass: **(a) name-matching gates that an alias
defeats** (C1, H2), and **(b) a verifier the build runs but the loader/admission path doesn't** (C2, H3, H4, H5,
H6). Both are "the gate is right, the dispatch is incomplete" — the same FO-DISPATCH-MISSING-CASE family as the
plain-flow effect escape fixed this session.

## Fix queue
H1 fixed (150db7e). The rest → **task #36** (verify-before-build each; the two criticals C1 + C2 first, then the
crypto/admission cluster H3-H6, then H7/H8/P1/P2). Each crypto/admission fix must be re-verified against the live
manifest-verification code (it has been touched this session) before landing.

*Source: workflow `wf_9a0cd48c-71e` (2026-06-25). Full per-finding evidence + the red-team refute notes are in the
workflow transcript.*

---

## DevSecOps pentest of the session's own fixes (2026-06-25, `wf_8291890f`)

Adversarially re-checked that this session's fixes HOLD + introduced no bypass. **It found 2 real holes the
original fixes left open — both now FIXED (`74a2a10`):**
- **CRITICAL — redirect-follow SSRF:** the egress guard ran once on the original URL, but `fetch` defaults to
  `redirect:"follow"`, so a guard-approved public URL returning `302 Location: http://169.254.169.254/` was
  followed to the metadata host un-re-checked (returned an internal secret). Fixed: `redirect:"manual"` + re-guard
  every Location with a 5-hop cap.
- **HIGH — parser depth guard incomplete:** `LLN-PARSE-DEPTH-001` guarded only expression recursion; nested
  statement blocks (`if{if{…}}`) re-opened the host-stack RangeError. Fixed: the same depth accounting in
  `parseBlock` (shared counter).
- Also fixed a **latent require-in-ESM bug** the redirect path exposed (`createRequire`).

**CONFIRMED sound by the pentest (no action):** the static SSRF classifier (denies the full numeric/IPv6/CGNAT/
credential bypass corpus), the BOM strip, the `exprDepth`-under-exception balance, the Int64 lift (no fast-tier
truncation; UInt64 still gated), the reporter delete-to-launder + malformed-allowlist guards, and the allowlist
audit tool. **Tracked residuals (lower severity → #38):** DNS-rebind socket-pin TOCTOU; 3 directory-scan read
sites bypass the size pre-check; the import-path traversal. The two queued criticals (effect-alias smuggle,
signed-WASM-stub) were re-confirmed STILL OPEN (genuinely pending, not masked) → #36.

**Lesson:** a security fix is not done when the happy-path bypass is closed — re-pentest the *fix* itself. The
redirect-follow vector is the classic "guard the request, miss the redirect" SSRF, and it survived the first fix.

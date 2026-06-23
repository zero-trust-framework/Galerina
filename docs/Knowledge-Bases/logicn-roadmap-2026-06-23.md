# LogicN — Roadmap (rebuilt 2026-06-23, SECURITY FIRST)

Owner directive: **fix security issues first.** Missing/stub packages are *consider-not-always* (framework breadth,
not security-critical) — see the note at the end. The weighted **% completion audit** lives in its companion
[logicn-roadmap-and-percent-audit-2026-06-23.md](logicn-roadmap-and-percent-audit-2026-06-23.md) (overall **~76%**,
**53/53 · 5,042 · 0 fail**). Run `node scripts/status.mjs` for the live one-liner.

**This session already landed:** S1 cert-gate · **kernel K3-fold of `channelVerdict`** (fail-closed admission) ·
**api-server transport** (fail-closed Node http adapter, slowloris timeouts, +5 e2e) · **bitnet cpu+gpu Standard-2
governance preflight** (R&D 0086) · **SEC-002 cert-gate mutants** (8/8 killed) · sentinel-egress flaky fix ·
graph-coverage fix (+28 pkgs) · 6 architecture diagrams · architecture + compiler-intelligence R&D (designs) ·
`contract.permissions{}` design · the R&D results log + ledger · `C:\x` re-mine (18 net-new ideas) · **3
token-saving dev tools** (status/rd-absorb/stray-docs, wired into the Stop cadence).

---

## 🔒 SECURITY — fix first (ordered by severity)

1. **[HIGH] ◑ Wire the cert-gate into live kernel admission** — **kernel K3-fold + transport supply BOTH DONE
   2026-06-23.** The `kernel.ts` auth step folds an optional `LogicnKernelRequest.channelVerdict` via
   `decideAtBoundary`, **fail-closed** (only ALLOW admits; 0/−1 refuse; unknown→DENY by the algebra). The **api-server
   now makes the path LIVE**: a `resolveChannelVerdict(req)` hook computes the K3 verdict per request and threads it
   to the kernel (transport → `certGate` → `channelVerdict` → fold). Fail-closed: a throwing resolver → DENY (never
   downgraded to the header path); unset → header path (no change); only +1 authenticates (mutual-TLS in lieu of a
   bearer token). +6 api-server e2e (5→11 green). **(a) TLS mapper — LANDED** (owner, 2026-06-23): opt-in `tls`
   mode in `createApiServer` stands up HTTPS, reads `getPeerCertificate(true)`, maps to `CertGateInput`, folds via
   `certGate` → `channelVerdict` (fail-closed; unreadable factor → DENY). **(b) Tighten presence-only fallback —
   DONE 2026-06-23:** a required-auth route with no `channelVerdict` no longer admits on mere header presence
   (deny-by-default); opt back in per-route via `auth.allowHeaderPresenceFallback` (relaxation surfaced in the
   security report). Composes with the TLS mode (required-auth now demands a real cert verdict, no header bypass).
   +3 kernel tests, kernel 90→93, api-server 11 green. **Remaining: (c) OWNER DECISION** — should a DENY channel
   verdict also block **public** routes? Today the verdict folds only in the required-auth step (owner left this
   as-is on 2026-06-23).
2. **[HIGH] ✅ Fix the 2 WAT codegen fail-opens — DONE 2026-06-23.** #163 record fail-opens closed: a record
   FIELD access with a known type but no WAT local (was reading reserved scratch at base `0`), and a
   `#record-update` with an un-inferable base type *inside an emission walk* (was a silent null record handle) —
   both now emit `(unreachable)` (fail-closed trap), scoped so non-emission analysis callers keep the placeholder.
   #165 float was already lowered to f64 (`FLOAT_ARITH_WAT`/`FLOAT_CMP_WAT`). Parity-safe: compiler suite
   3169/3170, all record-update/layout/fail-closed/tokenize-parity/f64 green. *(Also fixed a found-in-passing
   hygiene bug: `scripts/audit-mutation.mjs` had a literal NUL byte — the SEC-002 tool itself was binary-flagged /
   grep-invisible; replaced with the `\0` escape, `source-hygiene-no-nul` now green.)*
3. **[CRITICAL] ◑ #149 — CI secret-scan DONE 2026-06-23; re-sign owner-gated.** Added `.github/workflows/secret-scan.yml`
   (gitleaks on push/PR/weekly-full-history/manual, fail-closed) + `.gitleaks.toml` (default rule pack; allowlists ONLY
   the TLS test fixtures + other test-fixture creds by path). Local pre-scan clean (no real secrets in source). **Remaining
   (owner-gated):** if the full-history sweep surfaces the legacy `8eecf4…` PRIVATE key, **re-sign** any exclusively-old-key-signed
   artifacts with the rotated key (offline custody, gated on #34) + a **history rewrite**. The scan deliberately does NOT
   allowlist that key, so the gate stays red until remediated. (Key already revoked → Deny.)
4. **[MEDIUM] Tainted-by-default at entry boundaries** — the 34B bare-flow-param trust
   (`value-state-checker.ts:1152-1191`, `registerParamBinding`): 34A made an explicit `tainted` param untrusted
   but **bare params stay trusted** (opt-in); a bare param on an externally-reachable flow is fail-open. *(arch-rd #4.)*
   **VERIFY-BEFORE-BUILD 2026-06-23: this is design-heavy, NOT a clean autonomous chunk** — it needs (1) a precise
   **"boundary-entry" definition** (flow-kind `secure`/`guarded` + a `contract.request{}` block is the cleanest
   signal), (2) a **posture model** (the strictness must be posture-gated; `posture` lives in governance-verifier/
   interpreter, not the value-state pass — needs threading), and (3) broad **test-impact analysis** (it changes the
   default taint of many params across the 3,170-test compiler suite + the self-hosted corpus). **Recommend a
   deliberate design pass / R&D-bridge job before building** — surfaced for owner sequencing.
5. **[MEDIUM] ◑ Extend the SEC-002 mutant catalog** beyond the 3 B5a mutants. **cert-gate + fuse-loader DONE
   2026-06-23** — 5 TLSTP-S1 cert mutants (revocation-unknown/stale/throw→ALLOW · pin-mismatch soften · no-pin→ALLOW)
   + 3 fuse-loader gate mutants (hash · signature · revocation). Full run **11/11 killed, 0 survived, all `[test]`**.
   Two harness bugs fixed along the way: (a) the final rebuild only restored the *first* mutated package's dist;
   (b) **the kernel `KERNEL_BUILD` ran `npm run build` = bare `tsc` (not on PATH) so it ALWAYS exited 1 — every
   kernel mutant, including the 3 pre-existing B5a ones, was vacuously "killed by build" with its test never
   running. Switched to the vendored tsc; the B5a adversarial coverage is genuine for the first time.** The
   `audit-mutation.mjs:28` `--config`-absent CLI crash was already fixed. **i32-overflow DONE 2026-06-23** — 4
   mutants on `i32-arith.ts` (the single trap-not-wrap source of truth: add/sub/mul/div wrap-instead-of-trap),
   all `[test]`-killed; **catalog now 15/15**. (add/sub use a single-line `(a op b) | 0` pre-wrap anchor —
   CRLF-agnostic, since `i32-arith.ts` has mixed line endings.) **secret-egress DONE 2026-06-23 — #5 COMPLETE,
   catalog now 17/17:** 2 mutants corrupt the `SINK_REQUIREMENTS` registry key (response.body / ai.remoteInference)
   so the sink lookup misses → an unsafe value escapes with no `LLN-VALUESTATE-003`; `domain-security.test` kills
   both `[test]`. *Finding:* the first two targets I tried SURVIVED, which was informative — the egress gate is
   **multi-layered defense-in-depth** (sentinel-egress never-drop has TWO mechanisms + an unreachable re-push;
   `isNetworkSink` is redundant with the registry), so mutation testing must target the **authoritative layer**
   (the registry). Every fail-closed gate class is now mutation-regression-protected.
6. **[MEDIUM] Flip the enforcers from report-only to CI-enforcing** — drive the scanner baseline 154→0 (+ doc-drift
   24, provenance 2) across Stages F/G/H, then drop `--soft` on `lint-conventions` + the scanner (Stage J). Today
   nothing can fail a build (the taxonomy/standards gap, dimension at 58%).
7. **[LOW / long-tail] Deferred audit residuals** — GOV-003 dataflow rename · VSC-004/005 · CRYPTO-004/005/006 ·
   Gate-6 mediums/lows. Closes the security posture's tail.
8. **[GATED] Real DSS.wasm in-sandbox isolation** (DRCM Phase 5, #102–106) — the biggest *structural* security gap:
   the kernel-bypass / decryption-in-WASM guarantee is **aspirational** until the Wasmtime TCB lands (`dss-supervisor.wasm`
   is a 115-byte stub, no `wasmtime` dep). External-infra + owner-gated — surface as an explicit decision, don't park.

> **R&D-side security in flight (bridge):** `0084` security-standards × K3 (PCI/DSS + full OWASP + CWE/NIST/MITRE/SLSA,
> the unknown→INDETERMINATE-fail-closed thesis) · `0085` RAG-vulnerabilities `LOGICN_SECURITY_RULEBOOK` reconciliation +
> RAG/LLM-retrieval threat class · `0078` OCSP staple-caching (availability vs fail-closed). Absorb verdicts to the
> [R&D results log](logicn-rd-results-log.md) as they land.

## NEAR (build leverage — non-security)
- **🔓 #0087 — compiler-enforced affine/type-state authority — UNLOCKED 2026-06-23 (owner GO).** The top net-new
  security tightening: a bundle of compile-time properties on the value-state pass (affine/move-once authority ·
  Raw→Verified→Authorized→Sealed type-state · run-scope lifetimes · must-use→compile-error · newtype hashes),
  build **item 1 (affine) first**. Design + bench done (R&D 0087); zero zero-trust cost (pure tightening).
  *(The other gated items stay gated pending an EXTERNAL dependency only the owner can supply: #34 PQ signing =
  offline key custody · #102-106 DSS.wasm = Wasmtime infra · #110 secrets rotation = ext vault.)*
- **Finish the api-server transport** (building now) + a **real runnable example-app** → the
  scaffold→fuse→kernel→**serve** path end-to-end (the framework's biggest breadth gap; pairs with security #1).
- **§2 Governance Dead-Code Elimination** (design-complete, `LLN-GDCE-001`) — the compiler-intelligence net-new.
- **`contract.permissions{}` device clause** (design-complete, `LLN-PERM-001..006`).
- **#201 EFFECT-006** pii/phi brand→family map: complete + `git stash pop` (unblocks #202).
- **Graph auto-discover `packages-logicn/*`** (kill the manifest drift fixed by hand this session) + wire **#150 CI
  auto-count** + apply the remaining stale-doc fixes (ledger DONE rows, build-roadmap third count).
- **H5 fusion-B2 ABI mismatch** + one real end-to-end fused-app test · **Stage E diagnostic P0-security overloads**.

## MID
- **Self-hosted Stage-B past lexer** (`parser.lln → type-checker.lln → governance-verifier.lln` to WASM byte-parity,
  #105) — moves Axis-B 80%→100% (`tokenize` is the only flow at byte-parity today).
- **Close the 4 WASM codegen gaps** (#200 nested-member · #171 None sentinel · #172 `__int_to_str` · run-host string).
- **0014 governance-fidelity differential harness** (walker ≡ bytecode ≡ WASM) — the lean→WASM trust gate.
- **ML-DSA-65 hybrid `.lmanifest` signing** (#34) — **UNBLOCKABLE 2026-06-23**: the signing CODE is already
  shipped + tested (`proof-graph.ts` `generateHybridGovernanceKeyPair`/`signProofGraphHybrid`/`verify…Hybrid`,
  `tests/hybrid-pq-signature.test.mjs`); secure generation (QRNG/SP-800-90) + custody/rotation lifecycle research
  all exist. The only gate was the owner's **offline key ceremony** — now documented as a runbook
  ([#34 ceremony](logicn-34-offline-key-ceremony-runbook.md)). Residual is owner-only (air-gapped keygen) +
  two smoothing follow-ups (a `logicn sign` CLI; #110/Gap-A rotation-body retention). Also covers the #149 re-sign.
- **#216 WASM build-provenance** (fold/finish via BLD-003) · **#202 transitive capability-mask ⊆** · **#212
  kernel→runtime governance-deny bridge** (completes the cert-gate verdict→HTTP-response story once #1 lands).

## LONG (owner/infra-gated + R&D)
- **Real DSS.wasm / Wasmtime component-model host** (#102–106, DRCM Phase 5) — *(= security #8)*.
- **Z3/SMT "math compiler"** — QF_BV proof of tri-tier i32 conformance + formalize the 0014 differential. *(NOT for
  the cert-gate K3 algebra — that's exhaustively table-tested; refuted 2026-06-23.)*
- **#218 non-codes audit dimensions** (#217 capability/syntax · flows/deps · governance-rules · effects ·
  contract-clause) — the path to a whole-language coverage guarantee.
- **Absorb the 8 dispatched R&D bridge jobs** (0078–0085) to the results log as `done/` files land.

## Missing / stub packages — consider, NOT always
The `data-*` / `web-*` / `db-*` adapters and `target-{js,wasm,native,gpu}` are **framework breadth, not
security-critical**. Build them **only when a concrete app needs them** — never prioritise stub-filling over the
security items or the core runtime. *(api-server + example-app are the exception: they're the servable-path gap, so
they sit in NEAR.)* Per-package build-vs-stay-stub + photonic/tri verdicts are pending in R&D **0082**. Full catalog:
[outstanding-rd-and-todos](logicn-outstanding-rd-and-todos-2026-06-23.md).

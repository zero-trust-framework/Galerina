# LogicN — Roadmap (rebuilt 2026-06-23, SECURITY FIRST)

Owner directive: **fix security issues first.** Missing/stub packages are *consider-not-always* (framework breadth,
not security-critical) — see the note at the end. The weighted **% completion audit** lives in its companion
[logicn-roadmap-and-percent-audit-2026-06-23.md](logicn-roadmap-and-percent-audit-2026-06-23.md) (overall **~76%**,
**53/53 · 5,042 · 0 fail**). Run `node scripts/status.mjs` for the live one-liner.

**This session already landed:** S1 cert-gate · sentinel-egress flaky fix · graph-coverage fix (+28 pkgs) · 6
architecture diagrams · architecture + compiler-intelligence R&D (designs) · `contract.permissions{}` design · the
R&D results log + 95-row ledger · **3 token-saving dev tools** (status/rd-absorb/stray-docs, wired into the Stop
cadence). **In flight:** the **api-server transport** (unblocks security #1).

---

## 🔒 SECURITY — fix first (ordered by severity)

1. **[HIGH] Wire the cert-gate into live kernel admission** (`kernel.ts:307`). Today the auth gate is presence-only —
   *any non-empty `Authorization` header passes*, with zero token/cert/claim verification (the audit's only HIGH).
   The **api-server (building now) provides the real listener/connection seam**; then make the kernel auth a K3
   `decideAtBoundary` fold (channel-cert verdict `allOf` token verdict) so unknown→DENY gates live traffic. Closes
   the HIGH; turns the kernel from a boolean checker into a K3 boundary citizen. *(arch-rd #1; audit HIGH.)*
2. **[HIGH] Fix the 2 WAT codegen fail-opens** — #163 `#record-update` emits a silent `(i32.const 0)` placeholder;
   #165 float arithmetic. A cannot-lower op must emit `(unreachable)` (fail-closed trap), **never a
   plausible-but-wrong value**. Verify the WASM-parity test impact first, then fix-forward (trap or proper lowering).
   *(VERIFIED REAL 2026-06-23; techdebt #161-191 set, distinct from the #128 set the Phase-4 audit called hardened.)*
3. **[CRITICAL-open] #149 — CI secret-scan + re-sign legacy old-key artifacts.** The rotated-but-leaked signing key
   `8eecf4…` may still be on the public remote; add gitleaks/trufflehog in a real `.github/workflows/` and re-sign
   any exclusively-old-key-signed artifacts. The last open key-exposure P0.
4. **[MEDIUM] Tainted-by-default at entry boundaries** — the 34B bare-flow-param trust
   (`value-state-checker.ts:1162-1191`): an un-annotated param from a hostile caller is fail-open by default. Make
   boundary-entry flows tainted-by-default (posture-gated; non-breaking for internal flows). *(arch-rd #4.)*
5. **[MEDIUM] Extend the SEC-002 mutant catalog** beyond the 3 B5a mutants — fuse-loader gates 1–3 / secret-egress /
   i32-overflow / the cert-gate's 5 in-test guards — so **every** fail-closed gate is mutation-regression-protected.
   Fix the `audit-mutation.mjs:28` `--config`-absent CLI crash.
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
- **ML-DSA-65 hybrid `.lmanifest` signing** (#34, offline custody) — the remaining PQ gap (verify is PQ-ready).
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

# LogicN Granular Roadmap — sub-100% modules by child node (2026-06-24)

This roadmap decomposes every sub-100% module into its child nodes with an honest per-child completion %, the evidentiary basis, and the concrete gap to close. Modules are ordered production-first (85-92%) then aspirational/hardware-gated last (<50% at module level). "Simulated" layers (DSS.wasm, photonic emulator, AI bridges) are flagged as deliberate Stage-A stand-ins, not defects.

---

## Module: Governance + admission border — 91%

| Child | % | Basis | Gap to close |
|---|---|---|---|
| K3 vAnd / decideAtBoundary verdict algebra | 97 | Kleene-3 vAnd/vOr/vNot + decideAtBoundary in tower-citizen + substrate-model; effectiveVerdict=vAnd(ideal,reading), noise costs availability never safety; production-grade, tested | Pure algebra complete; only lift is the photonic/substrate HW gate (#102-106), out of scope for the digital core. No border action needed. |
| Signed .lmanifest admission (Ed25519/hybrid verify) | 95 | fuse-loader verifyManifestSignature() fail-closed Ed25519 (RFC 8032) over canonicalJson; unsigned admitted only under explicit allowUnsigned (default false); 12+19 tests | Hybrid Ed25519+ML-DSA-65 verify exists but signing default is Ed25519-only (#34/C3); make hybrid the default and re-sign legacy old-key artifacts (#149). |
| Fuse-loader 3 gates (hash / signature / revocation) | 94 | Gate1 wasm sha256==descriptor, Gate2 signature, Gate2b revocation (revoked keyId refused; unverifiable registry throws=fail-closed); real+tested | Revocation predicate is CLI-injected; when omitted no revocation gate runs. Make kernel default-deny when no revocation source is wired. |
| Revocation registry enforcement | 92 | revocation-registry.mjs + isKeyRevoked wired into fuse-loader Gate2b / package-resolver / bridge-attestation; leaked 8eecf41→Deny; REV-2026-06.md published | #149 residual: CI secret-scan + re-sign legacy old-key artifacts; old key still in public git history (accepted residual). |
| S1 cert/channel gate wired into live kernel auth | 90 | kernel.ts gate 6 wired: channelVerdict folds through decideAtBoundary() fail-closed (only +1 admits; 0/−1 → 401); header-presence opt-in legacy fallback default off; 18+5 tests | TLSTP S1 cert mapper (#0089 seam shipped d33b0d5) not yet end-to-end wired in a production api-server; example api-server is reference/template, so no live cert→verdict mapping runs. |
| Signed central registry index (B5a allow-list) | 80 | registry-index.ts fully implemented (build/sign/verify/lookup/policy/admitFromRegistry, 12 ERR_REGISTRY_* incl. stale/replay/duplicate); optional fuse-loader B5a hook; 24 tests | No populated, signed production index ships (gate opt-in/no-op when omitted). Author+sign a real index, pin it, make B5a default-on for certified deployments. |

**Path to 100%:** Make hybrid signing the default and re-sign legacy artifacts (#34/#149), flip revocation + B5a registry gates from opt-in to default-deny-when-absent, and end-to-end wire the TLSTP cert→channelVerdict mapper into a production api-server.

---

## Module: Value-state / effect / tier checkers — 90%

| Child | % | Basis | Gap to close |
|---|---|---|---|
| Value-state taint checker (core) | 95 | value-state-checker.ts (1975 LOC): unsafe/tainted propagation, gate-breaks-taint, VS-003/004/005 sink guards, secret-logging, egress hardening; 142+26+21 tests; production-grade | Mature; remaining work is incremental rule coverage (new sink kinds). No structural blocker. |
| Effect checker (inference + declared⊇body) | 93 | effect-checker.ts (1188 LOC): inference, declared-effects superset enforcement, secure-required-effect set; 45+14+25+24 tests; production-grade | Enforces declared-effects⊇body but NOT declared-tier⊇inferred-min (the tier-floor gap). Effect layer solid; close tier coupling for full soundness. |
| 34B-hole boundary-untrusted auto-taint | 85 | value-state-checker.ts:1214-1221 auto-registers bare secure/guarded params as 'boundary-untrusted'; governed sink fires LLN-VALUESTATE-008 (1689-1712); 7+5 tests | Production-gated: escalates to error only under LOGICN_PROFILE=production (8d840ca); dev/check permissive with NO dev warning yet (KNOWN-ISSUES 37-41). Add the planned dev-mode warning. |
| Tier-floor dev/prod (LLN-TIER-001) | 78 | effect-checker.ts:572-590 emits LLN-TIER-001 when flow/guarded uses a SECURE_REQUIRED_EFFECT but isn't declared secure; 8+1 tests; logic real | Production-gated only (KNOWN-ISSUES 42-45): dev/check permissive, emit NO warning → guarded-flow+http.post skips secure-only obligations in dev. Add dev-mode escalate-only warning + wire floor on default build path. |
| LLN-DAG-002 (floor↔effects consistency) | 10 | **CONFIRMED DEAD**: governance-verifier.ts documents DAG-002 (floor_1 ≠ secret.access) at 486-488 but verifyGovernedFlows() (3235) implements ONLY DAG-001, comment 'full DAG validation is Phase 5'; zero emit, zero tests | Implement the floor-vs-effects-profile consistency check (reject Floor-1 flows declaring Floor-3+ caps like secret.access) and add tests; documented-but-unenforced fail-open deferred to Phase 5. |

**Path to 100%:** Surface the two production-gated floors (LLN-VALUESTATE-008, LLN-TIER-001) as dev-mode warnings, wire declared-tier⊇inferred-min into the default build, and build the dead LLN-DAG-002 floor-vs-capability consistency check with tests.

---

## Module: WASM codegen / WAT emitter — 89%

| Child | % | Basis | Gap to close |
|---|---|---|---|
| Fail-closed traps | 96 | Every unlowerable construct emits atomic (unreachable) (LOAD→TRAP→ERASE) with provenance; checked-i32 helpers trap signed overflow (786-802); ensure/trap output post-conditions gate at flow exit; strongly tested security spine | Essentially complete for Stage-A; residual is traps are Wasmtime-host-enforced, not yet the in-WASM DSS hardware trap (#102-106). |
| Statement-class lowering coverage | 90 | stmt switch (1569) lowers mut/let/assign/return/if/while/call/match/trap/forEach as real instructions; unsupported stmt.kind → atomic (unreachable) #128; 4+10+4 tests | Effectful/capability statements still trap-or-stub (Phase 22 deferred to #102-106 DSS.wasm); lower break/continue and try/`?` error-propagation in WAT. |
| Expression-class lowering | 90 | expr switch (1014) lowers identifier/member/number/binary/unary/call/bool/string/char/list/block/match; default + unresolved paths → fail-closed (unreachable) with #128/#163; 28+21+3+2 tests | Unresolved record-base receivers w/o WAT local (#163) and i32-only ops over float (#165) fail closed; wire record-type propagation through all receiver paths. |
| Assembler (WAT→WASM) | 88 | wat-assembler.ts prefers real wabt (assembleWithWabt); honest fail-closed fallback returns minimal-encoder stub flagged 'NOT a faithful compile', never masks invalid as valid; 16 + slice-2 differential tests | Minimal JS encoder only covers simple constant/identity patterns; make wabt a hard dependency (or vendor it) so the stub path is never the production compile result. |
| String lowering | 88 | Type-directed ops route to ~20 $host___str_* funcs + char ops, all real impls in createHostRuntime; strings opaque interned handles; P9 tokenize byte-parity + 3+8 tests | Handle model is host-resident, not in-WASM linear-memory UTF-8; a real DSS.wasm needs in-module string repr; split/join/format + Array<String> by-value ops partial. |
| Host-fidelity (host runtime backing) | 85 | createHostRuntime provides closed host surface with attestation-first linking (verifyWasm before link, 101) + onHostCall/onViolation/onTrap; oracle-tested vs interpreter stdlib; 8+1 tests | Host funcs are TS impls of stdlib semantics — faithful but not the eventual in-WASM/Rust-shim impl; complete host stdlib so no governed flow needs an un-bridged builtin. |
| Float lowering | 82 | #165 native f64: FLOAT_ARITH/CMP_WAT (all 6 cmps) + i32→f64 promotion + f64.const; float locals typed f64 (1604); 5+8 tests | No f64.load/f64.store — record/array float fields occupy i32 slots (load garbage); i32-only ops (%, bitwise) over float fail-closed. Add f64 memory load/store + float-typed record slots. |
| Record / array lowering | 80 | P9.4b bump-allocator: record literals (i32.store) at 4-byte slots; #record-update copies untouched+sets changed; arrays via host __array_create/append/get/length; arena ceiling from contract.memory{arena}; 5+2+3 tests | Fields all 4-byte i32 (no f64/nested inline); arrays host-handle-backed not contiguous; no bounds-checked pure-WAT element load/store. Implement typed multi-width slots + in-memory array repr. |

**Path to 100%:** Make wabt a hard/vendored dependency, then grow lowering coverage — typed multi-width record slots, f64 memory load/store, in-WASM contiguous arrays with bounds checks, and break/continue + try/`?` — to shrink the deliberate (unreachable) subset (#163/#165 receiver-type propagation first).

---

## Module: Hybrid cryptographic signing — 88%

| Child | % | Basis | Gap to close |
|---|---|---|---|
| Ed25519 default signing path | 100 | attestation.ts + proof-graph.ts use node:crypto Ed25519 (ieee-p1363); production-grade, tested | None — complete and tested baseline. |
| makeManifestEnvelope (single-source shape) | 100 | proof-graph.ts:564 is the single source of truth for the .lmanifest envelope; build/verify/run all call it so they can't drift; make-manifest-envelope.test.mjs; 3 logicn.mjs sites repointed (0f0976c) | One duplicated shape remains in the out-of-tree rd-0102 bench; keep in lockstep or hybrid sigs silently break. No in-tree gap. |
| ML-DSA-65 hybrid signing (opt-in) | 95 | proof-graph (signProofGraphAsync/verifyGovernanceSignatureHybrid, lln.gov.sig.v2) + attestation hybrid funcs implement real FIPS-204 ML-DSA-65 via @noble/post-quantum, domain-separated AND-verification; 3 test suites pass | Opt-in only; not default, not exercised end-to-end on run-admission. Make hybrid default for certified releases + add run-side parity test. |
| Certified-profile PQ mandate (LLN-CRYPTO-PQ-001) | 90 | governance-verifier.ts:2033 + effect-checker.ts:289: in prod/deterministic a crypto.sign without PQ marker (.hybrid/.mldsa65/.slhdsa) raises LLN-CRYPTO-PQ-001; build-side enforced | Marker-effect encoding is provisional v0; finalize the crypto.sign.* algorithm taxonomy + version it before keys persist. |
| Key custody / offline ceremony (#34 / #149) | 55 | Revocation enforced (revocations.json, isKeyRevoked wired; 8eecf4→Deny; REV published) but #34 offline ceremony unbuilt (placeholders cite it); old key in public git history | Build the #34 offline key-custody/ceremony spec so real (non-placeholder) keys back bridge manifests; rotation execution lives in ext-secrets-vault. |
| Verify/run-side PQ floor (one-directional gap) | 40 | verifyGovernanceSignature (784) refuses v2 in sync path (no silent downgrade) BUT accepts v1 Ed25519-only as valid; PQ required only build-side, not symmetrically at admission | Add a run/verify-side policy rejecting (warn→error in certified profile) a v1 Ed25519-only governance signature, mirroring the build-side mandate, to close harvest-now-forge-later asymmetry. |
| Bridge-manifest hybrid signature | 35 | manifest-generator.ts:646-652 emits PLACEHOLDER signatures ('real ML-DSA-65 requires key custody spec #34'); algorithm tagged Ed25519+ML-DSA-65 but no real key bound | Wire generateHybridGovernanceKeyPair/signProofGraphAsync into manifest-generator so bridge manifests carry real hybrid signatures; gated on #34. |
| CI secret-scan + re-sign legacy (#149) | 20 | version.json openTasks + KNOWN-ISSUES mark #149 'CI secret scan + re-sign legacy old-key artifacts (CRITICAL)' still open; no CI secret-scan job found | Add a CI secret-scan gate (block private-key commits) + re-sign any artifact exclusively signed by compromised 8eecf4 with rotated ab46f4c7. |

**Path to 100%:** Make hybrid the default end-to-end (signing + a symmetric run/verify-side v1-reject floor), build the #34 offline key-custody ceremony so bridge manifests carry real (not placeholder) hybrid sigs, and land the #149 CI secret-scan + legacy re-sign.

---

## Module: Compiler / Stage-A pipeline (logicn-core-compiler) — 92%

| Child | % | Basis | Gap to close |
|---|---|---|---|
| lexer | 97 | lexer.ts (849 LOC), 64 tests; 5 LLN-LEX diagnostics; self-hosted tokenize achieves byte-for-byte Stage-A==Stage-B WASM parity (#143). Most mature child | Effectively complete; only residual is keeping the keyword table synced with v1-reserved-keywords.md as grammar grows — no functional gap. |
| governance-verifier | 95 | governance-verifier.ts (3559 LOC), 250 tests; ~90+ LLN-* codes; K3 fail-closed verdicts; most mature/exercised checker | Self-hosted WASM parity not yet reached (tokenize-only); some BORDER/DAG rule families partially declarative; broaden adversarial conformance. Near-complete for Stage-A. |
| effect-checker | 94 | effect-checker.ts (1188 LOC), 45+ tests; canonical-effect validation, broad-alias warnings, declared⊇observed, stdlib capability map, inter-flow propagation | Enforces declared-effects⊇body but not declared-tier⊇inferred-min (covered by tier-floor child); otherwise solid. |
| parser | 94 | parser.ts (5549 LOC), 183 tests; real panic-mode recovery (recoverToStatement/Block/ContractSection, 24 sites); covers flows/contracts/records/enums/match/invariant | Self-hosted parser WASM parity not yet achieved (tokenize-only); recovery sync could widen in a few sub-grammars. Stage-A TS parser is authoritative. |
| value-state-checker | 93 | value-state-checker.ts (1975 LOC), 86+ tests; VS-001..008, SECRET-001..003, two-hop taint, user gate prefixes; three rd-0093 fail-opens FIXED+regression-guarded | LLN-VALUESTATE-008 escalates to ERROR only under production profile (8d840ca); dev/check stays warning — planned dev-mode surfacing follow-up. |
| GIR-emitter | 90 | gir-emitter.ts (1070 LOC), 26+ tests; canonical JSON (sorted keys, no timestamps) with SHA-256 GIR hash; resilience/effect/intent/audit metadata, NPU/APU flags | GIR solid; downstream WASM lowering (wat-emitter) is a fail-closed subset, so end-to-end GIR-to-native not yet complete. |
| symbol-table / resolver | 90 | symbol-resolver.ts (601 LOC) + package-type-registry import resolution, 15 tests; 3 diagnostics (NAME-001/002/003); exposes SymbolTable for tooling | Diagnostic surface intentionally narrow; deeper scope analysis (capture/closure shadowing) light. Add coverage as module/import-graph features expand. |
| type-checker | 88 | type-checker.ts (1884 LOC), 78+ tests; tensor element-type/shape, Result, records; in-source conservative approximations (unknown field→String, fall-back Result<unknown,DecodeError>, advisory pending future inference) | Build the deferred full inference pass so unknown-receiver field access is precisely typed instead of String-approximated; tighten generic/closure inference. Fallbacks safe but lose precision. |
| diagnostics / error-recovery / WASM-codegen | 85 | Parser recovery real (3 helpers); wat-emitter.ts (3202 LOC) fail-CLOSED (~10 (unreachable) trap sites tagged #128/#163); executeWASMFlow declines non-faithful modules; Stage-A interpreter authoritative | Grow WASM lowering so fewer constructs trap; extend self-hosted parity beyond tokenize to parser/type-checker/governance-verifier (#102-106). Recovery good but not exhaustive across all sub-grammars. |

**Path to 100%:** Land the deferred type-checker inference pass (precise unknown-receiver typing), wire declared-tier⊇inferred-min in the effect-checker, then extend self-hosted WASM parity beyond tokenize to parser/type-checker/governance-verifier (the Stage-B work below).

---

## Module: Devtools / graph — 90%

| Child | % | Basis | Gap to close |
|---|---|---|---|
| graph-algorithms | 93 | graph-algorithms/src (1889 LOC); real BFS/DFS/reach/topo + core/graphs/semantic; highest devtools test count at 95 | Production-grade; only marginal additions (SCC/shortest-path variants) remain — MeshQL shortest-path parked, not required. |
| project-graph | 92 | project-graph/src (2835 LOC) across algorithms/core/graphs/reporting; 90 tests; real dependency/flow graph + reporting | Mature; incremental coverage of new graph node kinds as the language grows — no structural gap. |
| security auditor | 88 | devtools-security/src (875 LOC), 34 tests; parse-fail→PASS fail-open FIXED (audit-runner:170-184 emits HIGH ParseError, short-circuits only after recording); value-state/taint wired | Host auditor runs Stage-A parser, so a flow the compiler can't parse degrades to a parse finding rather than deep analysis; full coverage tracks compiler completeness. |
| pci auditor | 86 | devtools-pci/src (1220 LOC), 24 tests; maps diagnostic codes to PCI DSS 4.0.1 (ALL_PCI_REQUIREMENTS, PciRequirement) | Mapping real but bounded by which LLN codes are emitted; expand requirement-to-code mapping as new governance rules land. |
| kb-graph | 85 | kb-graph/src (446 LOC), 20 tests; real KB cross-reference graph + reporter | Solid; extend scanner coverage for orphaned/dangling KB links and stale index entries. |
| naming | 85 | devtools-naming/src (641 LOC), 15 tests; real identifier/convention checker | Functional; broaden rule set + add fixtures for edge-case identifier conventions. |
| provenance | 85 | devtools-provenance/src (288+ LOC analyzer), 20 tests; real dataflow provenance classifying hash/encrypt/redact/gate into DataNode kinds | Transform classification is call-name-prefix based; could miss aliased/indirect transforms — needs symbol-resolved tracking for full fidelity. |
| intelligence | 82 | devtools-intelligence/src (1195 LOC), 16 tests; zero-dep in-memory BM25 sparse search tuned for identifier-heavy code + extractor/indexer/search | BM25 sparse only; semantic/embedding search + larger-corpus indexing not built — 16 tests cover lexical path, not ranking quality at scale. |
| package-graph | 80 | package-graph/src (cli/graph/reporter/scanner), 7 tests; real scanner+reporter, lightly tested vs project-graph | Thin coverage (7); add tests for cycle detection + multi-workspace scanning to reach project-graph confidence. |
| benchmarks | 70 | devtools-benchmarks/src is a runner harness (runner/compare/snapshot/mem-sampler/wasm-runner/build-native/gpu-detect) — NOT test-bearing (0 in testCountByPackage); unit-truth + heap/op fixes documented | Add self-tests for runner/units so benchmark output can't silently regress; finish CLBG benchmarks blocked by missing recursive-records/arrays/floats. |

**Path to 100%:** Add a self-test suite to the benchmarks harness (currently 0 tests guarding it), raise package-graph coverage to project-graph level, and give provenance symbol-resolved transform tracking; the auditors then rise automatically as compiler parse coverage grows.

---

## Module: Runtime interpreter / Stage-A tree-walker — 87%

| Child | % | Basis | Gap to close |
|---|---|---|---|
| Correctness / parity-oracle role | 95 | Interpreter (executeFlow, no pureFastPath) is the declared semantic reference tier; 0014 harness drives identical flows through tree-walker vs bytecode/sync vs real WASM, asserts byte-identical (Object.is, −0≠+0) + trap-by-message; i32 edge corpus + seeded fuzz; authoritative per version.json | Differential locks i32 value+trap edges; extend the oracle to the full 6-component tuple (effect trace, taint/seal, audit record, diagnostics) across all tiers — the next harness slice. |
| Language-feature coverage (records/arrays/floats/strings) | 90 | First-class value tags int/float/string/bool/bytes/record/list; full float arithmetic+comparison incl int↔float promotion; ~30 array methods + string methods + Result/Option; heavily tested (domain-* suites 75/64/77/51/61/55) | The records/arrays/floats gaps are WASM/benchmark-side, NOT interpreter; remaining is parity of these with the WASM tier so benchmarks run on both. |
| Diagnostic / verdict tiers (K3 fail-closed) | 88 | LOAD→TRAP→ERASE: i32 overflow/div0/mod0→runtimeError; K3 Allow/Deny/Indeterminate drive admission; recursion cap 2000 + loop cap 100k trap; deadline→LLN_RUNTIME_006; hardened 2026-06-19 (non-SyncReturn no longer swallowed); 6+51 tests | Verdict enforcement is Stage-A TS, not the simulated DSS isolation boundary (#102-106); some floors (VALUESTATE-008, TIER-001) production-profile-gated, warn-only in dev. |
| Performance (by-design slow reference) | 85 | ExecutionTier ladder (cache→bytecode→sync→egraph→tree) with telemetry + fallbackReason; tree-walker intentionally slowest/most-governed oracle; bytecode VM ~14× + sync fast-path carry production speed; 5+26 tests | By design the governed tree-walker is slow; real speed path is WASM/bytecode tiers — not a defect, but full e-graph/AOT lowering of effectful flows remains future work. |

**Path to 100%:** Extend the differential oracle from i32 value+trap to the full 6-component tuple (effects, taint/seal, audit, diagnostics) across all tiers, and bring the records/arrays/floats coverage to parity with the WASM tier so benchmarks run on both.

---

## Module: Framework (app-kernel / api-server / example-app) — 72%

| Child | % | Basis | Gap to close |
|---|---|---|---|
| app-kernel admission/fusion border (fuse-loader) | 90 | fuse-loader.ts (966 LOC): 3 gates (sig verify, wasm sha256 match, deny-by-default capability imports) + embedded signed fuse{} extraction; 93 package tests; version.json marks REAL+tested | Real DSS.wasm/kernel-bypass isolation still simulated in Stage-A TS host (#102-106); host injects revocation/registry predicates rather than enforcing them in-WASM. |
| kernel admission decision (fixed request pipeline) | 88 | kernel.ts (478 LOC): hard-coded non-bypassable 12-gate pipeline (route→...→audit), every gate fails closed, channelVerdict K3 fold at auth; InMemoryAuditSink real (async, off critical path) | Audit step 12 is in-memory, not durable/governed; concurrency/idempotency state in-process only — needs persistent audit + distributed admission for production. |
| revocation registry + fuse-border wiring | 92 | revocation-registry.mjs + revocations.json: isKeyRevoked→Deny, trust-anchor pinning, tampered-sig fail-closed-by-throw; test 5b proves revoked key refused + throwing registry itself fail-closed | Compromised legacy key 8eecf4 in git history (#149 residual); CI secret-scan + re-sign of legacy old-key artifacts still open. |
| governed package resolver | 85 | package-resolver.ts (617 LOC): SHA-256 content-hash identity, Ed25519 sig/signerKeyId, registry origin, install-script deny-by-default (PKG-004), revocation-at-resolution (PKG-006), cap-escalation gate (PKG-001) | No signed central registry INDEX yet; resolution verifies per-package but lacks a signed allow-list manifest of the full registry. |
| `logicn new app` scaffolder | 85 | scripts/logicn-new.mjs via logicn.mjs `new app`; copies canonical golden template; app-scaffold.test.mjs verifies runnable layout, name substitution, no build outputs, deny-by-default App.manifest | Scaffolds only the single golden hello/greeting layout; no template variants (multi-route, capability-granting flows) — richer starters pending. |
| planComposition multi-module linker | 82 | fuse-loader 695-897: PURE planComposition (set-signed iff every module verified, provider-cycle detection, deny-by-default cap wiring, duplicate refusal); fuse-compose.test covers it; R&D 0052 Phase A interim host-linker, first-party only | Interim host-linker over capabilityRegistry; real WASM Component Model isolation between modules pending (#102-104) — composition planned/admitted but not hardware-isolated. |
| servable request path (host/server.ts) | 70 | example-app/host/server.ts (127 LOC) wires fuse→createAppKernel→createApiServer end-to-end; typed fail-closed config; e2e.test.mjs exercises full serve path | Single GET /hello proven end-to-end; broader surface (POST bodies, auth-required routes, error responses) shown only via kernel unit tests, not the live serve path. |
| api-server (HTTP/HTTPS transport adapter) | 68 | api-server/src/index.ts (552 LOC): thin node:http/https adapter, DoS body-byte cap, real TLS mode (getPeerCertificate→CertGateInput→certGate→channelVerdict K3 fold), crypto stays in Node TLS; 17 tests | Framed reference/template; single adapter, no production hardening (rate-limit, graceful drain, observability sidecar) — example transport, not a finished server. |
| example-app (golden template) | 60 | runnable golden template + scaffold source of truth: App.lln composition-root, flows/greeting.lln, fused .wasm, deny-by-default App.manifest, host/server.ts (127 LOC), 6 e2e tests | TODO.md lists 'next steps for a real app' unbuilt: more routes/flows, wire revocation+central registry into the border, commit contract-driven proofs — intentionally minimal demo. |

**Path to 100%:** Productionize the transport (rate-limit/graceful-drain/observability) and prove the broader request surface (POST/auth/error) end-to-end through the live serve path; give the kernel a durable governed audit pipe + distributed admission; wire the signed central registry and richer scaffold variants. Note the deepest isolation (planComposition hardware isolation, in-WASM enforcement) is gated on DSS.wasm below.

---

## Module: ext packages — 68%

| Child | % | Basis | Gap to close |
|---|---|---|---|
| ext-tmf slice 1 — TMX-256 integrity core | 100 | tmx256.ts (TriMerkle-XOF/SHAKE256 via node:crypto) golden-verified byte-for-byte; part of 33 passing tests | None — complete, golden-verified, crypto-on-core digital. |
| ext-tmf slice 2 — container reader/writer | 100 | container.ts (header + 56-byte section table, §6 fail-closed reader) done+golden; flags.signed stays 0 (never writes a fake signature) | None — complete and golden-verified. |
| ext-tmf slice 3 — KEM-DEM confidentiality | 100 | kemdem.ts: real hybrid X25519+ML-KEM-768 → SHAKE256 KDF → AES-256-GCM with committing-AAD + CTX (CMT-4) via @noble; deterministic half golden, KEM/AEAD round-trip+tamper tested | Optional follow-ons (aead_suite 0x03/0x04 ChaCha/XChaCha, kem_profile L5) noted but not blocking; core slice complete. |
| ext-secrets-tmf / env.tmf (SOPS-pattern) | 80 | encrypted-at-rest .env replacement: schema/io/store/mlock/anchor/runtime/cli (10 files, 17 tests); io.ts atomicWriteCiphertext writes ciphertext-only (avoids SOPS #624 leak); SHAKE256-hashed coords; uses slice-3 KEM-DEM; flags.signed=0 | Signed root gated on slice 4 (currently unsigned-but-encrypted); add signing once slice 4 ships. |
| ext-secrets-vault (rotation) | 80 | rotation-manager.ts: real dual-token rotation with rotateOrFault + on_rotation_fault policy (halt) so stale key never silently retained; vault-client + cli; 16 tests; the execution half of split key-rotation | Client is in-memory/reference; wire to a real external vault backend (HashiCorp/age) for production custody. Core rotation logic + fault handling complete. |
| ext-bridge-cpp | 70 | governance + determinism oracle real: bitnet-cpu-bridge.ts cross-checks native vs byte-faithful TPLSimulator (assertDeterminism, CRITICAL on mismatch); 17 tests; addon-loader:88 falls back to simulator (no native addon) | Build the native SIMD addon via cmake-js (tl1/tl2 kernels) so the bridge runs real HW-accelerated compute instead of simulator fallback. |
| ext-bridge-quantum | 45 | honest stub: ffsim-backend.ts:68 'real out-of-process execution is Phase 2'; full limit gate + LOAD→TRAP→ERASE audit real and run (executedNatively=false, never fakes); 21 tests; #199 DESIGN-ONLY | Phase 2: build the hashed out-of-process Python ffsim worker so jobs passing the limit gate actually execute (emit EXEC). Currently admits/traps but does not run. |
| ext-proof-snarkjs | 35 | index.ts:5 + circuit.ts:17 — Phase 1 is a sha256-seal 'pre-ceremony Groth16 placeholder' (deterministic, verifiable as a seal, NOT a real trusted-setup SNARK); tagged 'groth16-phase1'; 10 tests | Phase 2: swap Sha256SealBackend for a real snarkjs Groth16 prover with a proper trusted-setup ceremony so proofs are genuine zk-SNARKs. |
| ext-bridge-bitnet (stub) | 30 | index.ts:94/150/158 — compute is a Stage-A stub returning placeholder text; governance wrapper, audit (CBOR Tag 410), lifecycle, contract surface real; 7 tests | Wire the BitNet.cpp native addon (node-gyp/cmake-js) — ggml_bitnet_init/transform_tensor/mul_mat_task_compute — to replace stub inference with real ternary matmul. |
| ext-tmf slice 4 — ML-DSA-65 root signing | 5 | index.ts:7 marks slice 4 ⬜ (NOT done); container.ts:75/162 confirm flags.signed=0, 'real signing is slice 4 / #7'; README describes intended hybrid Ed25519+ML-DSA-65 root signer, unbuilt | Implement signing over the TMX-256 root (sign over the hash, never replace it) using the hybrid signer, set flags.signed=1, add verify-before-trust; gated on #7/#34. |

**Path to 100%:** Ship ext-tmf slice 4 (root signing — it unblocks signed env.tmf too), then replace the honest stubs/simulator-fallbacks with real native paths: bridge-cpp SIMD addon, bridge-bitnet ggml addon, quantum out-of-process ffsim worker, and a real snarkjs Groth16 ceremony. The governance envelopes are already real; only the compute is fake.

---

## Module: Stage-B self-hosting (self-hosted compiler → WASM parity) — 42%

| Child | % | Basis | Gap to close |
|---|---|---|---|
| tokenize real-WASM byte-parity (lexer.lln) | 100 | wat-p9-tokenize-parity.test.mjs runs lexer.lln through .lln→WAT→real-wabt→#105 admission AND the interpreter, hard deepEqual over 21-input corpus; lexer-parity PARITY_ACHIEVED=true (hard asserts); version.json #143/#189 | Done. No further work on tokenize. |
| R6 corpus Stage-A==Stage-B value parity | 85 | self-hosted-bootstrap.test.mjs (21 cases) runs full self-hosted pipeline (all interpreted) + hard-asserts return-value parity vs TS over 5 corpus flows; r6-parity adds Stage-A compile+manifest gate (10 asserts); real+passing but interpreter-level, 5-flow subset | Widen corpus beyond 5 flows (recursive records/arrays/floats are the known blockers) and elevate from interpreter-parity to WASM-parity to make it the true 100% Axis-B marker. |
| parser parity (parser.lln, 1794 LOC) | 35 | parser.lln is the largest self-hosted source; self-hosted-parser.test.mjs has 52 cases but ALL via Stage-A interpreter (0 WASM refs); parser-parity PARITY_ACHIEVED=false, soft assert.ok(true) | Lower parser.lln to WASM + build a byte-parity test mirroring tokenize; flip parser-parity to a hard assertion. Likely blocked on richer GIR/WASM lowering (records, recursion, dynamic arrays). |
| type-checker parity (type-checker.lln, 602 LOC) | 30 | self-hosted-type-checker.test.mjs (25 cases) all interpreter-driven (0 WASM refs); parses+checks clean in Stage-A interpreter, no WASM parity test, no PARITY_ACHIEVED flag | Build a WASM-parity harness for the type-checker flows; depends on parser.lln WASM parity landing first (pipeline order). |
| effect-checker parity (effect-checker.lln, 495 LOC) | 30 | self-hosted-effect-checker.test.mjs (24 cases) all via interpreter (0 WASM refs); asserts effect-set results, no real-WASM parity, no flag | Add a WASM-lowered byte-parity test for effect-checker flows; currently interpreter-only verification. |
| gir-emitter parity (gir-emitter.lln, 558 LOC) | 30 | self-hosted-gir-emitter.test.mjs (13) + gir-body, all interpreter-driven (0 WASM refs); runs in Stage-A interpreter + builds flow table; production emitter is wat-emitter.ts | Prove the self-hosted GIR emitter produces byte-identical GIR/WAT vs the TS emitter when itself run in WASM — the true self-hosting closure. Hardest child; bootstraps on all prior stages. |
| governance-verifier parity (governance-verifier.lln, 747 LOC) | 28 | self-hosted-governance-verifier.test.mjs (19 cases) all interpreter-driven (0 WASM refs); produces verdicts under Stage-A; authoritative is TS governance-verifier.ts | Lower governance-verifier.lln to WASM + prove verdict byte-parity vs TS reference. Last in the pipeline, gated on parser+checker WASM parity. |

**Path to 100%:** This axis is gated by WASM lowering coverage. Land the wat-emitter records/recursion/dynamic-array work, then take parser.lln to real-WASM byte-parity (flip PARITY_ACHIEVED to a hard assertion), which unlocks type-checker → effect-checker → governance-verifier → gir-emitter parity in pipeline order. Widen the R6 corpus past 5 flows in parallel.

---

## Module: Multi-target backends + AI Inference Tower — 20%

| Child | % | Basis | Gap to close |
|---|---|---|---|
| target-wasm (the one real backend) | 90 | only fully-real codegen target: wat-emitter.ts → WAT → real wabt → #105 admission; in the compiler suite (8 expr traps + static-const/bitfield, lint-gated comments); logicn-target-wasm pkg has 0 tests but the real emitter is in the compiler | Production for the supported subset; widen lowering (recursive records/arrays/floats) — same gaps blocking Stage-B WASM parity. |
| target-cpu / native / js / gpu (capability planners) | 25 | target-cpu/src (177 LOC) is a capability+plan DESCRIPTOR (architecture/SIMD/threading→CpuTargetPlan), 3 tests; native/js/gpu have src but ZERO tests, not in workspace test set; no actual codegen | These produce plans/capability reports, not binaries. Real native/JS/GPU emission is greenfield; CPU planner needs test coverage + a wired consumer. |
| target-ai-accelerator (plan-only selector) | 25 | src (368 LOC) models 'plan-only' selection (AiAcceleratorPlan/TargetSelection → gpu/cpu/low_bit_ai/reject), 5 tests; selects + rejects unsafe targets (governance real) but emits no accelerator code | Wire plan-only selections to actual accelerator backends; currently a typed planner with no execution path. |
| BitNet bridge (logicn-ext-bridge-bitnet) | 22 | src (204 LOC, 7 tests) explicit STUB ('Stage A: stub — real impl calls ggml_bitnet_init() via Node addon'), returns literal '[BitNet inference stub: ...]'; governance/contract wrapper real | Wire ggml_bitnet_mul_mat_task_compute() via a real native addon; today inference returns a placeholder string (canCommit Option A hardening is the near-term security task). |
| Groq / NVFP4 / low-bit AI bridges + ai/ai-lowbit/ai-neural | 15 | logicn-ai (4) / ai-lowbit (3) / ai-neural (4) + inference-bridge-contract (12) are governed dev stubs/simulators; audit rates the AI Inference Tower ~12%; no real Groq/NVFP4 path | Implement real low-bit/NVFP4 kernels + a Groq bridge behind the already-real governed contract; current value is the governance envelope, not the compute. |

**Path to 100%:** target-wasm is the only real backend and rises with the same lowering work as Stage-B. Everything else (native/js/gpu emission, AI accelerator execution, Groq/NVFP4 kernels) is greenfield code-generation/hardware work behind already-real governed planners — long-horizon, build behind the existing contracts.

---

## Module: DSS.wasm deterministic isolation runtime (DRCM Phase 5, #102-106) — 15%

| Child | % | Basis | Gap to close |
|---|---|---|---|
| capability-map | 20 | dss/capability-map.lln (50 LOC) + mmcp-registry.lln (59) define the model; the PRODUCTION capability/admission border (fuse-loader gates, capabilityRegistry, revocation) is real+tested (93 tests) but that is Stage-A, NOT in-WASM; DSS-resident version design-only | Move the (already-real) Stage-A capability/admission enforcement into the DSS.wasm linear-memory TCB so it survives kernel-bypass; today enforcement lives in host TS, not WASM. |
| dss-supervisor | 18 | dss-supervisor.lln (111 LOC) is a LogicN DESIGN definition only; no real Wasmtime-hosted supervisor; KNOWN-ISSUES: DRCM 'simulated in the Stage-A TS interpreter'; no dedicated dss test | Implement a real supervisor process inside a Wasmtime TCB that mediates DWI isolates; today a 111-line .lln spec with no executable enforcement. |
| trap-handler | 18 | trap-handler.lln (74 LOC) + trap-signal.lln define trap semantics in LogicN, but no real WASM trap interception; Stage-A simulation only; no test | Wire real WASM trap/abort handling through the host shim into the supervisor; currently a design definition with no runtime. |
| V_DPM (deterministic partition memory) | 15 | vdpm.lln (182 LOC, largest DSS def) specifies V_DPM in DSS linear memory per locked DRCM design; the real digital arena it builds on is itself partly unwired (emitter 0 heap-resets, arena UNWIRED); no executable V_DPM, no test | Build V_DPM in real WASM linear memory with per-flow reset + secret-zeroing; prerequisite is wiring the digital arena/pages first (B1/B2 from rd-0055). |
| Wasmtime TCB bootstrap (DSS in real WASM) | 3 | NO Wasmtime/DSS.wasm/TCB source anywhere (grep zero non-.lln/non-dist hits); version.json: 'real DSS.wasm pending (#102-106, Post-P9)'; single hardest unbuilt foundation — everything above bootstraps on it | Stand up a Wasmtime-embedded TCB that loads DSS.wasm and hosts supervisor/V_DPM/capability-map; LONG/owner-infra-gated, entirely greenfield. |

**Path to 100%:** This entire module is the single greenfield foundation that the "simulated in Stage-A TS" isolation across the framework, runtime, and codegen depends on. Sequence: wire the digital arena/pages (rd-0055 B1/B2) → stand up the Wasmtime TCB bootstrap → build V_DPM in linear memory → migrate the already-real capability-map + supervisor + trap-handler into the TCB. Owner-infra-gated, post-P9.

---

## Module: Photonic / substrate Tower — 12%

| Child | % | Basis | Gap to close |
|---|---|---|---|
| 3-valued (K3) governance for substrate | 88 | LLN-GOV-3VL-001 fail-closed K3 in the production governance-verifier (3709-test suite); K3 fail-closed verdicts production-grade per KNOWN-ISSUES; vAnd availability-not-safety shipped | Production for verdicts; remaining is photonic-HW-gated mapping of physical dead-zones to K3-0, not a software gap. |
| substrate{} contract block + verifySubstrate pass | 85 | parsed by parser.ts; enforced via LLN-SUBSTRATE-001..004 (crypto-on-noisy, unprovable tolerance, insufficient redundancy, un-voted result into deterministic ctx) + substrate-inference.ts (253 LOC); substrate-contracts.test.mjs | Mostly complete as a governance layer; refine inference edge cases and tie redundancy proofs to the routePrecision axis. |
| substrate-math (closed-form noise/NMR model) | 80 | logicn-substrate-math pkg (6 tests) + compiler substrate-math.ts; NMR closed-form variance + tolerance maths ported verbatim from prove-own-maths (D1, 18/18); real+tested+deterministic but small surface (99-LOC index + 13-LOC shim) | Extract/broaden the @logicn/substrate-math library + add the routePrecision lane axis (open residual); core maths sound. |
| MZI-mesh / micro-ring physics emulator | 70 | logicn-ext-photonic-emulator (46 tests); emulator.ts (202 LOC) genuine physics-faithful model (phase-drift + readout + quantization noise, closed-form variance, deterministic Xorshift32+Box-Muller, freivalds cheap-verify, partition-decider); every BridgeResult executedNatively=false | By-design an emulator; 'closing the gap' means hardware (out of scope). Residual SW: extend parity-conformance coverage + the WDM lane vocabulary. |
| Real silicon / photonic PPU execution | 1 | Zero. KNOWN-ISSUES: 'physics-faithful emulator plus a governance layer, not real silicon'; audit lists PPU virtualisation hardware-gated (emulator + governance rails only); all BridgeResults executedNatively=false | Requires physical photonic hardware + a PPU co-processor driver; entirely out of current scope. Emulator/governance rails are the deliberate stand-in. |

**Path to 100%:** The governance rails (K3, substrate{} contracts, NMR maths) are already production-grade over an emulated substrate — software-side residuals are the routePrecision lane axis, WDM lane vocabulary, and broader parity-conformance coverage. The remaining ~88% module gap is real silicon / PPU execution, which is hardware-gated and out of current scope by design.

---

## Leverage order — highest-impact next steps across all modules

Ordered: beta-blockers (security correctness + fail-open closure) → 1.0-final (defaults, productionization) → long-horizon/hardware-gated.

**Beta-blockers (close fail-opens, move the most % on production layers):**
1. **Build LLN-DAG-002 floor↔effects consistency check** (Value-state module, 10%→). Confirmed-dead documented-but-unenforced fail-open: a Floor-1 flow can declare secret.access today. Single highest-correctness-per-effort item.
2. **Surface the two production-gated floors as dev-mode warnings + wire declared-tier⊇inferred-min on the default build** (LLN-VALUESTATE-008 78→ and LLN-TIER-001 78→). Closes the "guarded-flow+http.post skips secure-only obligations in dev" gap; pulls two children up sharply.
3. **Add the symmetric run/verify-side PQ floor** rejecting v1 Ed25519-only governance sigs in certified profile (Crypto 40%→). Closes the harvest-now-forge-later asymmetry — build-side mandate exists, admission side does not.
4. **Land #149: CI secret-scan gate + re-sign legacy 8eecf4 artifacts** (Crypto 20%→, Framework revocation residual). Marked CRITICAL in version.json; no secret-scan job exists yet.
5. **Make wabt a hard/vendored dependency** so the minimal-encoder stub is never the production compile result (WAT assembler 88→). Removes a path where a non-faithful compile could ship.

**1.0-final (defaults, productionization, the levers into Stage-B):**
6. **Make hybrid Ed25519+ML-DSA-65 signing the default + wire real keys into manifest-generator** (Crypto: hybrid 95→, bridge-manifest 35→, #34 custody 55→). Replaces placeholder bridge-manifest sigs; needs the #34 offline key-custody ceremony.
7. **Grow wat-emitter lowering: typed multi-width record slots, f64 load/store, in-WASM contiguous arrays, break/continue + try/`?`** (WAT module 89, #163/#165 receiver-type propagation first). This is the master lever — it simultaneously unblocks Stage-B parity, target-wasm, and benchmark parity.
8. **Take parser.lln to real-WASM byte-parity and flip parser-parity to a hard assertion** (Stage-B 42, parser 35→). Gated on step 7; then cascades to type-checker/effect-checker/governance-verifier/gir-emitter parity in pipeline order.
9. **Ship ext-tmf slice 4 (ML-DSA-65 root signing over the TMX root)** (ext-tmf slice4 5→, env.tmf 80→). Unblocks signed env.tmf and completes the .tmf trust chain.
10. **Flip revocation + B5a signed-registry gates from opt-in to default-deny-when-absent + author/pin a real signed index** (Governance border B5a 80→, fuse-loader 94→). Removes the "no-gate-when-absent" opt-in seam for certified deployments.
11. **Productionize the framework serve path**: durable governed audit pipe + distributed admission (kernel 88→), prove POST/auth/error routes end-to-end (servable path 70→, api-server 68→), and end-to-end wire the TLSTP cert→channelVerdict mapper (S1 gate 90→).

**Long-horizon / hardware- or owner-infra-gated (do not block 1.0):**
12. **Stand up the Wasmtime TCB + DSS.wasm foundation** (DSS module 15, TCB bootstrap 3→), then migrate the already-real capability-map/supervisor/trap-handler/V_DPM into linear memory (wire rd-0055 arena B1/B2 first). This converts every "simulated in Stage-A TS" isolation note across framework/runtime/codegen into real enforcement — greenfield, owner-infra-gated, post-P9. Real native/JS/GPU and AI-accelerator (Groq/NVFP4/BitNet/ffsim/snarkjs) backends and real photonic silicon sit behind their already-real governed contracts and are hardware-gated by design.

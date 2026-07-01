// =============================================================================
// Galerina Phase 5 — Effect Checker
//
// Validates that effects declared on flows are consistent with their content.
// Spec: docs/Knowledge-Bases/effect-checker-and-boundary-checker.md
//
// Diagnostic codes: FUNGI-EFFECT-001..004 (compiler-diagnostics.md)
// =============================================================================

import { type AstNode, type AstNodeKind, type ParseDiagnostic, type FlowMeta, type SourceLocation } from "./parser.js";
import { buildCallGraph, topoSort, detectCycle } from "@galerina/devtools-graph-algorithms";
import { effectsToFlags, type EffectFlagsMask, EffectCheckerFlags, type EffectCheckerFlagsMask } from "./type-registry.js";
import { getStdlibRequiredEffects, getStdlibModuleKind } from "./stdlib-registry.js";

// ---------------------------------------------------------------------------
// FlowEffectSummary — per-flow effect inference summary
// ---------------------------------------------------------------------------

export interface FlowEffectSummary {
  readonly flowName: string;
  readonly declaredEffects: readonly string[];
  readonly inferredEffects: readonly string[];
  readonly missingEffects: readonly string[];
  readonly extraEffects?: readonly string[];  // future: declared but not inferred
  /**
   * Bitset representation of declaredEffects for fast subset checks.
   * Use effectsSubset(required, declaredEffectsMask) for O(1) checking.
   * Phase 18E: populated by buildFlowEffectSummary().
   */
  readonly declaredEffectsMask: EffectFlagsMask;
  readonly inferredEffectsMask: EffectFlagsMask;
  readonly missingEffectsMask: EffectFlagsMask;
  /**
   * Effect-checker-proven properties for this flow.
   * PureComputeCandidate, ParallelSafe, KernelFusionCandidate, etc.
   * @see EffectCheckerFlags
   */
  readonly checkerFlags: EffectCheckerFlagsMask;
}

// ---------------------------------------------------------------------------
// EFFECT_REGISTRY — centralized operation → canonical-effect mapping
// ---------------------------------------------------------------------------

export const EFFECT_REGISTRY: Readonly<Record<string, readonly string[]>> = {
  // Database
  "database.find": ["database.read"],
  "database.get": ["database.read"],
  "database.select": ["database.read"],
  "database.query": ["database.read"],
  "database.insert": ["database.write"],
  "database.update": ["database.write"],
  "database.delete": ["database.write"],
  "database.upsert": ["database.write"],

  // Cache
  "cache.get": ["cache.read"],
  "cache.set": ["cache.write"],
  "cache.delete": ["cache.write"],

  // Network
  "http.get": ["network.outbound"],
  "http.post": ["network.outbound"],
  "http.put": ["network.outbound"],
  "http.patch": ["network.outbound"],
  "http.delete": ["network.outbound"],
  "https.get": ["network.outbound"],
  "https.post": ["network.outbound"],

  // Audit
  "AuditLog.write": ["audit.write"],
  "audit.write": ["audit.write"],
  "audit.log": ["audit.write"],

  // Filesystem
  "fs.read": ["storage.read"],
  "fs.readText": ["storage.read"],
  "fs.readBytes": ["storage.read"],
  "fs.write": ["storage.write"],
  "fs.writeText": ["storage.write"],
  "fs.writeBytes": ["storage.write"],
  "File.readText": ["storage.read"],
  "File.readBytes": ["storage.read"],

  // AI
  "ai.inference": ["ai.inference"],
  "Model.run": ["ai.inference"],
  "Classifier.classify": ["ai.inference"],

  // Email
  "email.send": ["network.outbound", "email.send"],
  "EmailService.send": ["network.outbound", "email.send"],

  // R4B: Anti-abuse — background execution
  "process.spawn": ["process.spawn"],

  // Phase 25: Crypto effects — signature verification and signing
  "Crypto.verify": ["crypto.verify"],
  "crypto.verify": ["crypto.verify"],
  "Crypto.sign": ["crypto.sign"],
  "crypto.sign": ["crypto.sign"],
  // #34 confidentiality — namespaced so generic functions named seal()/encrypt() are NOT
  // clobbered; using Crypto.encrypt/decrypt/seal requires the corresponding crypto effect.
  "Crypto.encrypt": ["crypto.encrypt"],
  "Crypto.decrypt": ["crypto.decrypt"],
  "Crypto.seal": ["crypto.seal"],

  // Phase 34: bcrypt password verification — requires crypto.verify effect
  "BCrypt.verify": ["crypto.verify"],
  "BCrypt.hash": ["crypto.verify"],

  // Phase 35: Password API facade — same effect as the underlying backend
  "Password.verify": ["crypto.verify"],
  "Password.hash": ["crypto.verify"],
  "Password.migrate": ["crypto.verify"],
  "Password.needsMigration": [],

  // Phase 36: Argon2id — requires crypto.verify effect
  "Argon2.verify": ["crypto.verify"],
  "Argon2.hash": ["crypto.verify"],

  // Phase 25: Secret / Vault reads
  "Secrets.get": ["secret.read"],
  "vault.secret": ["secret.read"],

  // Phase 25: Random generation
  "Random.secureBytes": ["random.generate"],
  "Random.bytes": ["random.generate"],

  // Phase 25: Clock — non-deterministic
  "Clock.now": ["clock.read"],
};

/**
 * Returns the canonical effects for a named operation, or [] if unknown.
 */
export function inferEffectsForOperation(name: string): readonly string[] {
  return EFFECT_REGISTRY[name] ?? [];
}

/**
 * Infers effects directly used in a flow's body by matching call names
 * against the EFFECT_REGISTRY.
 */
/**
 * C1 (threat-model) — module-alias resolver. A `let`/`const` binding of a bare module identifier
 * (`let x = AuditLog`) lets a caller rename an effectful module and call it through the alias
 * (`x.write(...)`), which the receiver-NAME matching below would miss — smuggling the effect (and the
 * tier floor + taint sink that key off the same name) past the capability model. This maps every alias
 * name back to the module it ultimately points at, with transitive resolution (`let y = x; let x = Http`)
 * and a cycle guard. Resolution can ONLY ADD inferred effects (a name resolves to a module or stays
 * itself), so it is fail-closed: it never removes an effect, and aliasing an effectful module and
 * calling it genuinely performs that effect, so detecting it is always correct.
 */
export function buildModuleAliasMap(flowNode: AstNode): ReadonlyMap<string, string> {
  const direct = new Map<string, string>();
  function collect(node: AstNode): void {
    if (node.kind === "letDecl" && node.value) {
      const rhs = node.children?.[0];
      // A module alias is `let x = AuditLog` — child[0] is a bare identifier. A literal/binary/member RHS
      // has child[0] of another kind and is correctly ignored. (For `let z = compute(1)` the parser binds
      // z to the bare identifier `compute` and emits the call args as a SEPARATE sibling statement, so z
      // resolves to "compute" — harmless, since it matches no effectful module.) Over-resolution only ever
      // ADDS effects, so it is fail-closed. `letDecl` is Galerina's only binding node.
      if (rhs?.kind === "identifier" && rhs.value) direct.set(node.value, rhs.value);
    }
    for (const c of node.children ?? []) collect(c);
  }
  collect(flowNode);
  const resolved = new Map<string, string>();
  for (const [name] of direct) {
    let cur = name;
    const seen = new Set<string>();
    while (direct.has(cur) && !seen.has(cur)) { seen.add(cur); cur = direct.get(cur)!; }
    if (cur !== name) resolved.set(name, cur);
  }
  return resolved;
}

export function inferDirectEffectsForFlow(
  flowNode: AstNode,
): readonly string[] {
  const effects = new Set<string>();
  const aliasMap = buildModuleAliasMap(flowNode);

  function walk(node: AstNode): void {
    if (node.kind === "callExpr") {
      // Build full call name: receiver.method or just method
      const methodName = node.value ?? "";
      const receiver = node.children?.[0];
      const rawReceiver = receiver?.kind === "identifier" ? (receiver.value ?? "") : "";
      // C1: resolve a module alias (`let x = AuditLog; x.write()` → `AuditLog.write`) before matching.
      const receiverName = aliasMap.get(rawReceiver) ?? rawReceiver;
      const fullName = receiverName !== "" ? `${receiverName}.${methodName}` : methodName;

      for (const effect of inferEffectsForOperation(fullName)) {
        effects.add(effect);
      }
      // Also try just the method name
      for (const effect of inferEffectsForOperation(methodName)) {
        effects.add(effect);
      }
    }
    for (const child of node.children ?? []) walk(child);
  }

  walk(flowNode);
  return [...effects].sort();  // sorted for determinism
}

/**
 * Builds a FlowEffectSummary for a flow, comparing declared vs inferred effects.
 * Computes EffectFlags bitset masks and EffectCheckerFlags properties.
 */
export function buildFlowEffectSummary(
  flowNode: AstNode,
  meta: FlowMeta,
): FlowEffectSummary {
  const declaredEffects = [...meta.declaredEffects].sort();
  const inferredEffects = inferDirectEffectsForFlow(flowNode);
  const declaredSet = new Set(declaredEffects);
  const missingEffects = inferredEffects.filter(e => !declaredSet.has(e));

  const declaredEffectsMask = effectsToFlags(declaredEffects);
  const inferredEffectsMask = effectsToFlags(inferredEffects);
  const missingEffectsMask  = effectsToFlags(missingEffects);

  // Compute EffectCheckerFlags: properties proven by effect analysis.
  // PureComputeCandidate: pure qualifier AND no I/O effects inferred or declared.
  const isPure = meta.qualifier === "pure";
  const hasNoIO = inferredEffects.length === 0 && declaredEffects.length === 0;
  const hasNoInferredIO = inferredEffects.length === 0;

  const pureComputeCandidate = isPure && hasNoInferredIO;
  const effectFree           = isPure && hasNoIO;
  const parallelSafe         = isPure && hasNoInferredIO;  // pure + no inferred I/O → safe to parallelize
  const kernelFusionCandidate = isPure && hasNoIO;          // truly effect-free → all ops can fuse
  const readyForAPU          = pureComputeCandidate;        // purity is the APU prerequisite; shape check is type-checker's job
  const readyForNPU          = pureComputeCandidate;        // purity prerequisite; tensor check is type-checker's job

  const checkerFlags: EffectCheckerFlagsMask =
    (pureComputeCandidate  ? EffectCheckerFlags.PureComputeCandidate  : EffectCheckerFlags.None) |
    (parallelSafe          ? EffectCheckerFlags.ParallelSafe          : EffectCheckerFlags.None) |
    (kernelFusionCandidate ? EffectCheckerFlags.KernelFusionCandidate : EffectCheckerFlags.None) |
    (effectFree            ? EffectCheckerFlags.EffectFree            : EffectCheckerFlags.None) |
    (readyForAPU           ? EffectCheckerFlags.ReadyForAPU           : EffectCheckerFlags.None) |
    (readyForNPU           ? EffectCheckerFlags.ReadyForNPU           : EffectCheckerFlags.None);

  return {
    flowName: meta.name,
    declaredEffects,
    inferredEffects,
    missingEffects,
    declaredEffectsMask,
    inferredEffectsMask,
    missingEffectsMask,
    checkerFlags,
  };
}

// ---------------------------------------------------------------------------
// Effect checker diagnostics
// ---------------------------------------------------------------------------

export interface EffectDiagnostic {
  readonly code: string;
  readonly name: string;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
  readonly location?: SourceLocation;
  readonly suggestedFix?: string;
  readonly suggestedCode?: string;
  /** Rust-style: secondary source locations giving context. */
  readonly relatedLocations?: readonly { message: string; location: SourceLocation }[];
  /** Elm-style: why this is a problem. */
  readonly why?: string;
  /** Elm-style: what goes wrong if ignored. */
  readonly risk?: string;
}

export interface EffectCheckResult {
  readonly flowName: string;
  readonly qualifier: "flow" | "secure" | "pure" | "guarded";
  readonly declaredEffects: readonly string[];
  readonly observedEffects: readonly string[];
  readonly diagnostics: readonly EffectDiagnostic[];
  /** Effect-checker-proven properties. See EffectCheckerFlags. */
  readonly checkerFlags: EffectCheckerFlagsMask;
}

/**
 * Effect checker run mode.
 * "development" — warn on missing effects (friendly for development).
 * "production"  — error on missing, unknown, or broad-alias effects.
 */
export type EffectCheckerMode = "development" | "production";

const CANONICAL_EFFECTS = new Set([
  "database.read", "database.write",
  // cache.* is already wired in EFFECT_REGISTRY (cache.get/set/delete → cache.read/write)
  // but was missing here — a production compile would reject a declared cache effect that
  // the op-registry produces. Promoted to canonical (reconciliation 2026-07-01).
  "cache.read", "cache.write",
  "network.outbound", "network.inbound",
  "network.external", "network.internal",
  "secret.read", "secret.write",
  "audit.write",
  "storage.read", "storage.write",
  // Commit 2 (2026-07-01) — domain families aligned with the V_DPM capability layer (capability-types.ts):
  // ledger.mutate = the storage.write|audit.write composite; shell.execute = V_DPM bit 6 (shell_execute).
  "ledger.mutate", "shell.execute",
  "ai.inference",
  "compute.gpu", "compute.npu", "compute.cpu",
  "desktop.user.read",
  "native.call",
  "payment.charge",
  "pii.read",
  "phi.read", "phi.write",
  "email.send",
  // R4B: anti-abuse effects — prevent covert background execution and scheduled tasks
  "process.spawn",
  "worker.spawn",
  "event.schedule",
  // Phase 25: crypto effects — HSM/TPM signature ops require explicit declaration
  "crypto.verify",
  "crypto.sign",
  // #34 confidentiality — KEM-DEM / AEAD ops. Like sign/verify, these must run bit-exact
  // on the deterministic core (FUNGI-SUBSTRATE-001), never on a noisy/analog lane.
  "crypto.encrypt",
  "crypto.decrypt",
  "crypto.seal",
  // FUNGI-CRYPTO-PQ-001: signing-algorithm marker effects declared ALONGSIDE crypto.sign to
  // ASSERT the algorithm. The base `crypto.sign` handles call-matching; these mark whether
  // the signature is post-quantum. In a certified profile a PQ/hybrid marker is required.
  "crypto.sign.hybrid",
  "crypto.sign.mldsa65",
  "crypto.sign.slhdsa",
  "crypto.sign.ed25519",
  // Phase 25: random/clock non-deterministic effects
  "random.generate",
  "clock.read",
  // FUNGI-EFFECT reconciliation (2026-07-01): these already had EffectFlags bits in
  // type-registry.ts (EFFECT_NAME_TO_FLAG: StateRead/StateWrite/MessagePublish/ModelTrain)
  // but were missing from CANONICAL_EFFECTS — so the bitmask accepted them while a
  // production compile rejected them (FUNGI-EFFECT-004). Promoted to canonical so the
  // effect vocabulary is single-source consistent (scripts/audit-effect-canonicality.mjs).
  "state.read", "state.write",
  "message.publish",
  "ai.train",
]);

const EFFECT_NAME_ALIASES: ReadonlyMap<string, string> = new Map([
  // Short aliases (no dot)
  ["network", "network.outbound"],
  ["database", "database.read"],
  ["filesystem", "storage.read"],
  ["secret", "secret.read"],
  ["ai", "ai.inference"],
  ["audit", "audit.write"],
  ["pii", "pii.read"],
  ["phi", "phi.read"],
  // Task 2: canonical effect alias map (CANONICAL_EFFECT_ALIASES)
  ["pii.write", "database.write"],
  ["http.get", "network.outbound"],
  ["http.post", "network.outbound"],
  ["http.put", "network.outbound"],
  ["http.delete", "network.outbound"],
  ["http.patch", "network.outbound"],
  ["file.read", "storage.read"],
  ["file.write", "storage.write"],
  // FUNGI-EFFECT reconciliation (2026-07-01): variant names that resolve to an
  // existing canonical effect (they already share its EffectFlags bit in
  // type-registry.ts). ai.remoteInference→AiInference, crypto.password.verify→CryptoVerify.
  ["ai.remoteInference", "ai.inference"],
  ["crypto.password.verify", "crypto.verify"],
  // secret.access is the coarse umbrella; nudge authors to the fine-grained
  // secret.read/secret.write (emits FUNGI-EFFECT-005 broad-alias warning, below).
  ["secret.access", "secret.read"],
]);

// ---------------------------------------------------------------------------
// Known effect-producing call patterns
// ---------------------------------------------------------------------------

// Phase 19 (legacy): regex-based call pattern matching for effect inference.
// Being replaced by STDLIB_CAPABILITY_MAP AST-based lookups (Phase 19A, FUNGI-STDLIB-001).
// These patterns remain for backward compatibility with non-stdlib call patterns
// (e.g. *DB.insert, *Payment.charge) that are not in STDLIB_CAPABILITY_MAP.
// Phase 20: migrate *DB.* and *Payment.* patterns to a structured registry.
// Do not add new regex patterns here — add to STDLIB_CAPABILITY_MAP instead.
const EFFECT_CALL_PATTERNS: ReadonlyMap<RegExp, string> = new Map([
  // Database
  [/\b\w+DB\.insert\b/, "database.write"],
  [/\b\w+DB\.update\b/, "database.write"],
  [/\b\w+DB\.update\w+/, "database.write"],
  [/\b\w+DB\.delete\b/, "database.write"],
  [/\b\w+DB\.\w+/, "database.read"],
  // Audit log
  [/\bAuditLog\.write\b/, "audit.write"],
  // HTTP client
  [/\bhttp\.get\b/, "network.outbound"],
  [/\bhttp\.post\b/, "network.outbound"],
  [/\bhttp\.put\b/, "network.outbound"],
  [/\bhttp\.patch\b/, "network.outbound"],
  [/\bhttp\.delete\b/, "network.outbound"],
  // Network adapters
  [/\b\w+Api\.charge\b/, "network.outbound"],
  [/\b\w+Api\.send\b/, "network.outbound"],
  [/\b\w+Adapter\.\w+/, "network.outbound"],
  [/\bEmailService\.\w+/, "network.outbound"],
  // Filesystem
  [/\bfs\.readText\b/, "storage.read"],
  [/\bfs\.read\b/, "storage.read"],
  [/\bFile\.read\b/, "storage.read"],
  [/\bfs\.writeText\b/, "storage.write"],
  [/\bfs\.write\b/, "storage.write"],
  [/\bFileSystem\.\w+/, "storage.write"],
  // Environment and secrets
  [/\bEnv\.get\b/, "secret.read"],
  [/\benv\.get\b/, "secret.read"],
  [/\benv\.secret\b/, "secret.read"],
  [/\bvault\.secret\b/, "secret.read"],
  // AI / inference
  [/\w+Model\.run\b/, "ai.inference"],
  [/\w+Model\.infer\b/, "ai.inference"],
  // Payment
  [/\w+Payment\.\w+/, "payment.charge"],
  [/\w+Payments\.\w+/, "payment.charge"],
  // Desktop / host
  [/\bHost\.\w+/, "desktop.user.read"],
  // Native / FFI
  [/\bNative\w+\.\w+/, "native.call"],
]);

/**
 * Tracks the number of legacy regex patterns remaining in EFFECT_CALL_PATTERNS.
 * Used by tests to monitor migration progress toward STDLIB_CAPABILITY_MAP.
 * Target: 0 (all patterns migrated). Phase 20 goal.
 */
export const LEGACY_EFFECT_CALL_PATTERNS_COUNT = EFFECT_CALL_PATTERNS.size;

const PURE_FORBIDDEN_EFFECTS = new Set([
  "database.read", "database.write",
  "cache.read", "cache.write",
  "network.outbound", "network.external", "network.inbound", "network.internal",
  "secret.read", "secret.write",
  "audit.write",
  "storage.write", "storage.read", "ledger.mutate",
  "desktop.user.read",
  "native.call", "shell.execute",
  "payment.charge",
  "ai.inference",
  "pii.read", "pii.write",
  "phi.read", "phi.write",
  // R4B: spawning background processes is forbidden in pure flows
  "process.spawn",
  // FUNGI-EFFECT reconciliation (2026-07-01): promoted-to-canonical effects are
  // also forbidden in a pure flow (a pure flow performs no state mutation, message
  // publication, or model training).
  "state.read", "state.write", "message.publish", "ai.train",
]);

const PLAIN_FLOW_PRIVILEGED_EFFECTS = new Set([
  "secret.read",
  "payment.charge",
]);

// FUNGI-TIER-001 — effects that REQUIRE the `secure` flow tier. Touching any of these from a
// `flow`/`guarded` declaration under-declares the obligation (secure-only passes never attach).
// Deliberately conservative — benign reads (database.read, storage.read, desktop.user.read)
// stay guarded-tier and are NOT included, to avoid false floors.
const SECURE_REQUIRED_EFFECTS = new Set([
  // Border / egress
  "network.outbound", "network.external", "network.inbound", "network.internal", "email.send",
  // Credential & cryptographic material
  "secret.read", "secret.write",
  "crypto.sign", "crypto.verify", "crypto.encrypt", "crypto.decrypt",
  // High-consequence sinks & mutations
  "payment.charge", "audit.write", "database.write", "storage.write", "ledger.mutate",
  "ai.inference", "pii.read", "pii.write", "phi.read", "phi.write",
  // Code / process execution
  "process.spawn", "native.call", "shell.execute",
]);

// ---------------------------------------------------------------------------
// Helpers for suggestedCode generation
// ---------------------------------------------------------------------------

/** Build the complete `contract { effects { ... } }` block for EFFECT-001 in dev mode. */
function buildContractEffectsBlock(effects: readonly string[]): string {
  const lines = ["contract {", "  effects {"];
  for (const eff of effects) {
    lines.push(`    ${eff}`);
  }
  lines.push("  }", "}");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public checker entry points
// ---------------------------------------------------------------------------

export function checkEffects(
  flows: readonly FlowMeta[],
  ast: AstNode,
  mode: EffectCheckerMode = "production",
  enforceTierFloor = false,
): readonly EffectCheckResult[] {
  const effectfulFlows = new Set(
    flows
      .filter((flow) => flow.qualifier !== "pure" && flow.declaredEffects.length > 0)
      .map((flow) => flow.name),
  );
  const callGraph = buildFlowCallGraph(flows, ast);

  return flows.map((flow) => checkFlowEffects(flow, ast, flows, callGraph, effectfulFlows, mode, enforceTierFloor));
}

export function checkFlowEffects(
  flow: FlowMeta,
  ast: AstNode,
  allFlows: readonly FlowMeta[] = [flow],
  callGraph: ReadonlyMap<string, ReadonlySet<string>> = buildFlowCallGraph(allFlows, ast),
  effectfulFlows: ReadonlySet<string> = new Set(
    allFlows
      .filter((candidate) => candidate.qualifier !== "pure" && candidate.declaredEffects.length > 0)
      .map((candidate) => candidate.name),
  ),
  mode: EffectCheckerMode = "production",
  enforceTierFloor = false,
): EffectCheckResult {
  const diagnostics: EffectDiagnostic[] = [];
  const flowNode = findFlowNode(ast, flow.name);
  // Task 4: infer effects together with call locations so we can point to specific calls
  const observedEffects = flowNode === undefined ? new Set<string>() : inferEffectsFromNode(flowNode);
  const effectCallLocations = flowNode === undefined ? new Map<string, SourceLocation>() : inferEffectCallLocations(flowNode);

  validateDeclaredEffectNames(flow, diagnostics);

  if (flow.qualifier === "pure" && flow.declaredEffects.length > 0) {
    diagnostics.push({
      code: "FUNGI-EFFECT-003",
      name: "EFFECT_BOUNDARY_VIOLATION",
      severity: "error",
      message: `pure flow "${flow.name}" declares effects ${formatEffects(flow.declaredEffects)}. Pure flows must have no effects.`,
      location: flow.location,
      suggestedFix: `Remove the effects declaration, or change "pure flow" to "guarded flow" if side effects are needed.`,
      suggestedCode: `pure flow ${flow.name}`,
    });
  }

  if (flow.qualifier === "pure" && flowNode !== undefined) {
    for (const effect of observedEffects) {
      if (PURE_FORBIDDEN_EFFECTS.has(effect)) {
        diagnostics.push({
          code: "FUNGI-EFFECT-003",
          name: "EFFECT_BOUNDARY_VIOLATION",
          severity: "error",
          message: `pure flow "${flow.name}" uses "${effect}" which is forbidden in pure flows.`,
          location: flow.location,
          suggestedFix: `Move this call to a guarded or secure flow and declare the required effect.`,
          suggestedCode: `guarded flow ${flow.name}`,
        });
      }
    }

    for (const callName of unique(findCallsToEffectfulFlows(flowNode, effectfulFlows))) {
      diagnostics.push({
        code: "FUNGI-EFFECT-003",
        name: "EFFECT_BOUNDARY_VIOLATION",
        severity: "error",
        message: `pure flow "${flow.name}" calls "${callName}" which has declared effects. Pure flows cannot call effectful flows.`,
        location: flow.location,
        suggestedFix: `Change "pure flow" to "guarded flow" and declare the required effects.`,
        suggestedCode: `guarded flow ${flow.name}`,
      });
    }
  }

  // EFFECT-001 (undeclared) / EFFECT-002 (overdeclared): the declared effect set must be a
  // SUPERSET of the observed effects for EVERY governed flow kind. Unqualified `flow` is governed
  // too — it "defaults to governed behavior" (galerina-core-intent-safety-effects.md:43) — so it is
  // checked here alongside `guarded`/`secure`. Only `pure` is excluded: its zero-effect boundary is
  // enforced by the stricter EFFECT-003 path above.
  //
  // FO-DISPATCH-MISSING-CASE (galerina-fail-open-taxonomy.md): this gate previously enumerated only
  // secure/guarded and OMITTED plain `flow`, so a plain flow performing an undeclared effect on a
  // user-named receiver (e.g. `OrdersDB.find` → database.read, which is neither a secure-tier nor a
  // registered stdlib effect) emitted ZERO diagnostics and signed a manifest attesting effects
  // [none]. The enumeration must cover every effectful flow kind — see the exhaustiveness test in
  // tests/effect-checker.test.mjs.
  if (flow.qualifier !== "pure" && flowNode !== undefined) {
    const declared = new Set(flow.declaredEffects);
    const qualifierLabel = flow.qualifier === "flow" ? "plain flow" : `${flow.qualifier} flow`;
    // Pre-compute all missing effects for complete suggestedCode generation
    const missingEffects = [...observedEffects].filter(e => !declared.has(e));
    const mergedEffects = [...new Set([...flow.declaredEffects, ...missingEffects])].sort();

    for (const effect of observedEffects) {
      if (!declared.has(effect)) {
        // Task 4: point to the specific call expression that requires the effect
        const callLocation = effectCallLocations.get(effect) ?? flow.location;
        // Task 5: suggestedCode is the complete contract.effects block with all merged effects
        const suggestedContractBlock = mergedEffects.length > 0
          ? buildContractEffectsBlock(mergedEffects)
          : "";
        diagnostics.push({
          code: "FUNGI-EFFECT-001",
          name: "UNDECLARED_EFFECT",
          severity: "error",
          message: `${qualifierLabel} "${flow.name}" uses effect "${effect}" which is not declared.`,
          location: callLocation,
          suggestedFix: `Add "${effect}" to the effects declaration: effects [${mergedEffects.join(", ")}]`,
          suggestedCode: suggestedContractBlock,
        });
      }
    }

    for (const effect of flow.declaredEffects) {
      if (!observedEffects.has(effect) && !hasTransitiveEffect(flow.name, effect, allFlows, callGraph, new Set())) {
        diagnostics.push({
          code: "FUNGI-EFFECT-002",
          name: "OVERDECLARED_EFFECT",
          severity: "warning",
          message: `${qualifierLabel} "${flow.name}" declares effect "${effect}" but no matching operation was observed.`,
          location: flow.location,
          suggestedFix: `Remove "${effect}" from the effects declaration if it is not required.`,
        });
      }
    }
  }

  validateInterFlowPropagation(flow, allFlows, callGraph, ast, diagnostics);

  if (flow.qualifier === "flow") {
    for (const effect of flow.declaredEffects) {
      if (PLAIN_FLOW_PRIVILEGED_EFFECTS.has(effect)) {
        diagnostics.push({
          code: "FUNGI-EFFECT-001",
          name: "UNDECLARED_EFFECT",
          severity: "warning",
          message: `Plain flow "${flow.name}" declares privileged effect "${effect}". Use "secure flow" for security-sensitive operations.`,
          location: flow.location,
          suggestedFix: `Change "flow" to "secure flow".`,
          suggestedCode: `secure flow ${flow.name}`,
        });
      }
    }
  }

  // FUNGI-TIER-001 (landing A+B): a flow/guarded declaration that touches a secure-required effect
  // under-declares the obligation — the secure-only passes (intent justification, epilogue proof,
  // secret-egress sealing) gate on qualifier === "secure" and never attach at this tier. Floor:
  // escalate to `secure`. The scan ALWAYS runs; severity is gated on enforceTierFloor — production
  // builds (build-production / build-deterministic) ESCALATE to error (fail the build), while
  // dev/check emit a WARNING so testers see the obligation early without the corpus-breaking error
  // churn. `pure` is intentionally excluded — pure + these effects is already a hard FUNGI-EFFECT-003
  // error above. (Landing A dev-mode warning, 2026-06-24.)
  if (flow.qualifier === "flow" || flow.qualifier === "guarded") {
    const tierEffects = new Set<string>([...observedEffects, ...flow.declaredEffects]);
    const secureTriggers = [...tierEffects].filter((e) => SECURE_REQUIRED_EFFECTS.has(e)).sort();
    if (secureTriggers.length > 0) {
      diagnostics.push({
        code: "FUNGI-TIER-001",
        name: "UNDER_DECLARED_FLOW_TIER",
        severity: enforceTierFloor ? "error" : "warning",
        message: `${flow.qualifier} flow "${flow.name}" uses secure-tier effect(s) ${formatEffects(secureTriggers)} but is declared "${flow.qualifier}", not "secure". Secure-only obligations (intent justification, epilogue proof, secret-egress sealing) are skipped at this tier.`,
        location: flow.location,
        suggestedFix: `Declare it "secure flow ${flow.name}" so the secure-tier obligations attach.`,
        suggestedCode: `secure flow ${flow.name}`,
      });
    }
  }

  // FUNGI-STDLIB-001: check stdlib calls against STDLIB_CAPABILITY_MAP
  if (flowNode !== undefined) {
    for (const diag of checkStdlibEffects(flow, flowNode, mode)) {
      diagnostics.push(diag);
    }
  }

  // Compute EffectCheckerFlags for this flow
  const isPure = flow.qualifier === "pure";
  const hasNoInferredIO = observedEffects.size === 0;
  const hasNoIO = hasNoInferredIO && flow.declaredEffects.length === 0;
  const pureComputeCandidate  = isPure && hasNoInferredIO;
  const checkerFlags: EffectCheckerFlagsMask =
    (pureComputeCandidate     ? EffectCheckerFlags.PureComputeCandidate  : EffectCheckerFlags.None) |
    (pureComputeCandidate     ? EffectCheckerFlags.ParallelSafe          : EffectCheckerFlags.None) |
    (isPure && hasNoIO        ? EffectCheckerFlags.KernelFusionCandidate : EffectCheckerFlags.None) |
    (isPure && hasNoIO        ? EffectCheckerFlags.EffectFree            : EffectCheckerFlags.None) |
    (pureComputeCandidate     ? EffectCheckerFlags.ReadyForAPU           : EffectCheckerFlags.None) |
    (pureComputeCandidate     ? EffectCheckerFlags.ReadyForNPU           : EffectCheckerFlags.None);

  return {
    flowName: flow.name,
    qualifier: flow.qualifier,
    declaredEffects: flow.declaredEffects,
    observedEffects: [...observedEffects],
    diagnostics,
    checkerFlags,
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

// Broad aliases are the short forms without a dot-path qualifier.
// Using these emits FUNGI-EFFECT-005 (BroadAliasUsed — warning, not error).
// Other non-canonical names emit FUNGI-EFFECT-004 (error).
const BROAD_EFFECT_ALIASES: ReadonlySet<string> = new Set([
  "network", "database", "filesystem", "secret", "ai", "audit", "pii", "phi",
  // secret.access is a coarse umbrella (access ⊇ read/write); treated as a broad
  // alias so it is accepted with a nudge (FUNGI-EFFECT-005) toward secret.read /
  // secret.write rather than a hard reject. Reconciliation 2026-07-01.
  "secret.access",
]);

function validateDeclaredEffectNames(flow: FlowMeta, diagnostics: EffectDiagnostic[]): void {
  for (const effect of flow.declaredEffects) {
    const canonical = EFFECT_NAME_ALIASES.get(effect);
    if (canonical !== undefined) {
      if (BROAD_EFFECT_ALIASES.has(effect)) {
        // FUNGI-EFFECT-005: broad alias — warn, not error; developer should use canonical form
        diagnostics.push({
          code: "FUNGI-EFFECT-005",
          name: "BroadAliasUsed",
          severity: "warning",
          message: `Effect "${effect}" is a broad alias. Use the canonical name "${canonical}" to precisely declare authority.`,
          location: flow.location,
          suggestedFix: `Replace "${effect}" with "${canonical}" in the effects declaration.`,
          suggestedCode: canonical,
          why: `Broad aliases are ambiguous and may grant more authority than intended. "${effect}" maps to "${canonical}" but a future Galerina version may expand the meaning.`,
        });
      } else {
        // Other alias variants (e.g. "http.get" → "network.outbound") — non-canonical, error
        diagnostics.push({
          code: "FUNGI-EFFECT-004",
          name: "NON_CANONICAL_EFFECT",
          severity: "error",
          message: `Effect "${effect}" is not a canonical effect name. Use "${canonical}".`,
          location: flow.location,
          suggestedFix: `Replace "${effect}" with "${canonical}" in the effects declaration.`,
          suggestedCode: canonical,
        });
      }
    } else if (!CANONICAL_EFFECTS.has(effect)) {
      diagnostics.push({
        code: "FUNGI-EFFECT-004",
        name: "UNKNOWN_EFFECT",
        severity: "error",
        message: `Effect "${effect}" is not a recognised Galerina effect name.`,
        location: flow.location,
        suggestedFix: `Use a canonical effect name such as: network.outbound, database.write, audit.write, secret.read, storage.read`,
      });
    }
  }
}

function validateInterFlowPropagation(
  flow: FlowMeta,
  allFlows: readonly FlowMeta[],
  callGraph: ReadonlyMap<string, ReadonlySet<string>>,
  ast: AstNode,
  diagnostics: EffectDiagnostic[],
): void {
  const declared = new Set(flow.declaredEffects);
  const requiredEffects = collectTransitiveCalledEffects(flow.name, allFlows, callGraph, new Set([flow.name]));

  for (const [effect, calledName] of requiredEffects) {
    if (!declared.has(effect)) {
      diagnostics.push({
        code: "FUNGI-EFFECT-002",
        name: "TRANSITIVE_EFFECT_NOT_DECLARED",
        severity: "error",
        message: `Flow "${flow.name}" calls "${calledName}" which requires effect "${effect}", but "${flow.name}" does not declare it.`,
        location: flow.location,
        suggestedFix: `Add "${effect}" to effects: effects [${[...declared, effect].join(", ")}]`,
        suggestedCode: `effects [${[...declared, effect].join(", ")}]`,
      });
    }
  }

  // Task 3: check fn helpers declared within this flow for effect-producing calls.
  // Applies to every governed flow kind (flow/guarded/secure); `pure` is excluded — its
  // zero-effect boundary is enforced by EFFECT-003. (Was gated to secure/guarded only; the
  // plain-`flow` omission was the same FO-DISPATCH-MISSING-CASE fail-open as the EFFECT-001 gate.)
  const flowNode = findFlowNode(ast, flow.name);
  if (flowNode !== undefined && flow.qualifier !== "pure") {
    const fnHelperEffects = collectFnHelperEffects(flowNode);
    for (const [effect, fnCallLoc] of fnHelperEffects) {
      if (!declared.has(effect)) {
        diagnostics.push({
          code: "FUNGI-EFFECT-002",
          name: "TRANSITIVE_EFFECT_NOT_DECLARED",
          severity: "error",
          message: `Flow "${flow.name}" has a fn helper that uses effect "${effect}" which is not declared on the parent flow.`,
          location: fnCallLoc ?? flow.location,
          suggestedFix: `Add "${effect}" to effects: effects [${[...declared, effect].join(", ")}]`,
          suggestedCode: `effects [${[...declared, effect].join(", ")}]`,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// FUNGI-STDLIB-001: stdlib call requires undeclared effect
// ---------------------------------------------------------------------------

// FAIL-CLOSED (#153): the broad effect that *any* method on a known-effectful
// stdlib module requires, used when the specific method is NOT registered in
// STDLIB_CAPABILITY_MAP. An unregistered method on an effectful module (e.g.
// `Database.someNewMethod()`) must NOT be treated as effect-free; it has to
// carry at least the module's broad authority so the developer is forced to
// declare it. Deny-by-default: if a module is known to be effectful, its
// authority is required even for methods the compiler does not yet recognise.
const EFFECTFUL_MODULE_BROAD_EFFECT: ReadonlyMap<string, string> = new Map([
  ["File",         "storage.read"],
  ["FileSystem",   "storage.read"],
  ["fs",           "storage.read"],
  ["Http",         "network.outbound"],
  ["http",         "network.outbound"],
  ["https",        "network.outbound"],
  ["Database",     "database.read"],
  ["database",     "database.read"],
  ["AuditLog",     "audit.write"],
  ["audit",        "audit.write"],
  ["Secrets",      "secret.read"],
  ["Env",          "secret.read"],
  ["env",          "secret.read"],
  ["vault",        "secret.read"],
  ["EmailService", "email.send"],
  ["email",        "email.send"],
  ["AI",           "ai.inference"],
  ["ai",           "ai.inference"],
  ["Model",        "ai.inference"],
  ["Classifier",   "ai.inference"],
  ["Clock",        "clock.read"],
  ["Random",       "random.generate"],
]);

/**
 * FAIL-CLOSED (#153): returns the broad effect required for an *unregistered*
 * method on a known-effectful module, or undefined when the receiver is not a
 * known-effectful stdlib module (user-defined / pure modules are unaffected).
 *
 * The receiver MUST be a capitalised module name (e.g. `Database`, `AuditLog`,
 * `Http`). The lowercase aliases that also live in STDLIB_MODULE_KIND
 * (`email`, `http`, `database`, ...) are deliberately NOT matched here: a
 * lowercase first-child identifier is far more likely to be a record-field key
 * (`{ email: ... }`) or a local binding than a real module reference, and
 * treating it as a module produced false positives. Real module-qualified calls
 * in Galerina are capitalised, matching the convention used across the compiler.
 */
function broadEffectForUnknownEffectfulCall(
  receiverName: string,
  methodName: string,
): string | undefined {
  if (receiverName === "") return undefined;
  // Only capitalised receivers are treated as module references.
  const first = receiverName[0] ?? "";
  if (first < "A" || first > "Z") return undefined;
  // Synthetic / non-method member access (e.g. record-literal internals) is not
  // a real effectful operation — ignore anything that is not a plain identifier
  // method name.
  if (methodName === "" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(methodName)) return undefined;
  if (getStdlibModuleKind(receiverName) !== "effectful") return undefined;
  return EFFECTFUL_MODULE_BROAD_EFFECT.get(receiverName);
}

/**
 * Walks the AST for callExpr nodes in a flow's body.
 * For each call, reconstructs the full qualified name (receiver.method or method)
 * and looks it up in STDLIB_CAPABILITY_MAP.
 * If found AND any required effect is NOT in flow.declaredEffects → emit FUNGI-STDLIB-001.
 *
 * FAIL-CLOSED (#153): if the receiver is a known-effectful module but the
 * specific method is NOT in the capability map, the call is treated as
 * requiring the module's broad effect (FUNGI-STDLIB-002) instead of being
 * silently allowed.
 *
 * Severity: "error" in production mode, "warning" in development mode.
 */
export function checkStdlibEffects(
  flow: FlowMeta,
  flowNode: AstNode,
  mode: EffectCheckerMode = "production",
): readonly EffectDiagnostic[] {
  const diagnostics: EffectDiagnostic[] = [];
  const declared = new Set(flow.declaredEffects);
  const severity: "error" | "warning" = mode === "production" ? "error" : "warning";
  const aliasMap = buildModuleAliasMap(flowNode); // C1: resolve `let x = Module` aliases

  function walk(node: AstNode): void {
    if (node.kind === "callExpr") {
      const methodName = node.value ?? "";
      const receiver = node.children?.[0];
      const rawReceiver =
        receiver?.kind === "identifier" ? (receiver.value ?? "") : "";
      // C1: resolve a module alias (`let x = AuditLog; x.someMethod()` → AuditLog) so an UNREGISTERED
      // method on an aliased effectful module still requires the module's broad effect (#153 deny-by-
      // default). The alias resolves a lowercase `x` to the capitalised module name the gate expects.
      const receiverName = aliasMap.get(rawReceiver) ?? rawReceiver;
      const fullName =
        receiverName !== "" ? `${receiverName}.${methodName}` : methodName;

      // Check full qualified name first, then plain method name as fallback
      const namesToCheck: string[] = fullName !== methodName
        ? [fullName, methodName]
        : [methodName];

      let matchedInMap = false;
      for (const name of namesToCheck) {
        const requiredEffects = getStdlibRequiredEffects(name);
        if (requiredEffects === undefined) continue;  // not in stdlib map

        matchedInMap = true;
        for (const requiredEffect of requiredEffects) {
          if (requiredEffect === "") continue;  // pure stdlib call — no effect needed
          if (!declared.has(requiredEffect)) {
            diagnostics.push({
              code: "FUNGI-STDLIB-001",
              name: "StdlibEffectNotDeclared",
              severity,
              message: `${name} requires ${requiredEffect} which is not declared in the contract.`,
              ...(node.location !== undefined ? { location: node.location } : {}),
              suggestedFix: `Add ${requiredEffect} to the contract: contract { effects { ${requiredEffect} } }`,
              suggestedCode: requiredEffect,
            });
          }
        }
        break;  // matched the first name that exists in the map; don't double-report
      }

      // FAIL-CLOSED (#153): the call did NOT match any capability-map entry, but
      // the receiver is a known-effectful stdlib module. An unregistered method
      // on such a module must not be silently allowed — require the module's
      // broad effect (deny-by-default for unrecognised effectful operations).
      if (!matchedInMap) {
        const broadEffect = broadEffectForUnknownEffectfulCall(receiverName, methodName);
        if (broadEffect !== undefined && !declared.has(broadEffect)) {
          diagnostics.push({
            code: "FUNGI-STDLIB-002",
            name: "UnknownEffectfulStdlibCall",
            severity,
            message: `${fullName} is an unrecognised method on the effectful module "${receiverName}"; it requires at least ${broadEffect} which is not declared in the contract. Effectful modules are deny-by-default: declare the effect or use a recognised operation.`,
            ...(node.location !== undefined ? { location: node.location } : {}),
            suggestedFix: `Add ${broadEffect} to the contract: contract { effects { ${broadEffect} } }`,
            suggestedCode: broadEffect,
          });
        }
      }
    }
    for (const child of node.children ?? []) walk(child);
  }

  walk(flowNode);
  return diagnostics;
}

function collectTransitiveCalledEffects(
  flowName: string,
  allFlows: readonly FlowMeta[],
  callGraph: ReadonlyMap<string, ReadonlySet<string>>,
  seen: Set<string>,
): Map<string, string> {
  const effects = new Map<string, string>();
  const calledFlows = callGraph.get(flowName) ?? new Set<string>();

  for (const calledName of calledFlows) {
    const calledMeta = allFlows.find((candidate) => candidate.name === calledName);
    if (calledMeta === undefined) continue;

    for (const effect of calledMeta.declaredEffects) {
      if (!effects.has(effect)) {
        effects.set(effect, calledName);
      }
    }

    if (!seen.has(calledName)) {
      seen.add(calledName);
      for (const [effect, introducer] of collectTransitiveCalledEffects(calledName, allFlows, callGraph, seen)) {
        if (!effects.has(effect)) {
          effects.set(effect, introducer);
        }
      }
    }
  }

  return effects;
}

function hasTransitiveEffect(
  flowName: string,
  effect: string,
  allFlows: readonly FlowMeta[],
  callGraph: ReadonlyMap<string, ReadonlySet<string>>,
  seen: Set<string>,
): boolean {
  if (seen.has(flowName)) return false;
  seen.add(flowName);

  const calledFlows = callGraph.get(flowName) ?? new Set<string>();
  for (const calledName of calledFlows) {
    const calledMeta = allFlows.find((candidate) => candidate.name === calledName);
    if (calledMeta?.declaredEffects.includes(effect) === true) return true;
    if (hasTransitiveEffect(calledName, effect, allFlows, callGraph, seen)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

function findFlowNode(ast: AstNode, name: string): AstNode | undefined {
  const kinds: AstNodeKind[] = ["flowDecl", "secureFlowDecl", "pureFlowDecl", "guardedFlowDecl"];

  function walk(node: AstNode): AstNode | undefined {
    if (kinds.includes(node.kind) && node.value === name) {
      return node;
    }
    for (const child of node.children ?? []) {
      const found = walk(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  return walk(ast);
}

function buildFlowCallGraph(
  flows: readonly FlowMeta[],
  ast: AstNode,
): ReadonlyMap<string, ReadonlySet<string>> {
  const knownFlows = new Set(flows.map((flow) => flow.name));

  // Build plain descriptors for each flow — no AstNode references cross the boundary
  const descriptors = flows.map((flow) => {
    const node = findFlowNode(ast, flow.name);
    const calledFlows: string[] = [];
    if (node !== undefined) {
      const calls = new Set<string>();
      findDirectFlowCalls(node, knownFlows, calls);
      calledFlows.push(...calls);
    }
    return {
      name: flow.name,
      qualifier: flow.qualifier,
      calledFlows,
    };
  });

  // Use devtools-graph to build a formal CallGraph for structural analysis
  const callGraph = buildCallGraph(descriptors);

  // Check for circular flow dependencies and log via detectCycle
  const cycleResult = detectCycle(callGraph);
  if (cycleResult.hasCycle && cycleResult.cycle !== undefined) {
    // Cycle detected — callers will see diagnostic FUNGI-EFFECT-002 from
    // collectTransitiveCalledEffects (which guards against infinite recursion
    // using the `seen` set). The cycle is recorded here for future diagnostics.
    // No throw: the checker degrades gracefully on cycles.
    void cycleResult.cycle; // acknowledged; used by topoSort result below
  }

  // Use topoSort to produce a processing order (leaves first, callers last).
  // The `order` is available for future passes that need bottom-up propagation.
  const { order: _topoOrder } = topoSort(callGraph);
  void _topoOrder; // available for downstream use if needed

  // Convert the CallGraph back to the adjacency map the rest of this module uses.
  // This keeps the existing recursive helpers (hasTransitiveEffect, etc.) unchanged.
  const adjacency = new Map<string, ReadonlySet<string>>();
  for (const node of callGraph.nodes()) {
    const callees = new Set(callGraph.outEdges(node.id).map((edge) => edge.to));
    adjacency.set(node.id, callees);
  }

  return adjacency;
}

function findDirectFlowCalls(
  node: AstNode,
  knownFlows: ReadonlySet<string>,
  result: Set<string>,
): void {
  if (node.kind === "callExpr" && node.value !== undefined && knownFlows.has(node.value)) {
    result.add(node.value);
  }
  for (const child of node.children ?? []) {
    findDirectFlowCalls(child, knownFlows, result);
  }
}

function findCallsToEffectfulFlows(
  node: AstNode,
  effectfulFlows: ReadonlySet<string>,
): string[] {
  const calls: string[] = [];

  function walk(n: AstNode): void {
    if (n.kind === "callExpr" && n.value !== undefined && effectfulFlows.has(n.value)) {
      calls.push(n.value);
    }
    for (const child of n.children ?? []) {
      walk(child);
    }
  }

  walk(node);
  return calls;
}

function inferEffectsFromNode(node: AstNode): Set<string> {
  const effects = new Set<string>();
  const aliasMap = buildModuleAliasMap(node); // C1: resolve `let x = Module` aliases before matching

  function walk(n: AstNode): void {
    // Task 3: skip fnDecl bodies — their effects are handled separately via
    // collectFnHelperEffects / validateInterFlowPropagation to emit EFFECT-002
    if (n.kind === "fnDecl") return;
    if (n.kind === "callExpr" || n.kind === "memberExpr") {
      const callText = buildCallText(n, aliasMap);
      for (const [pattern, effect] of EFFECT_CALL_PATTERNS) {
        if (pattern.test(callText)) {
          effects.add(effect);
          break;
        }
      }
    }
    for (const child of n.children ?? []) {
      walk(child);
    }
  }

  walk(node);
  return effects;
}

/**
 * Task 4: Walk the flow node and record the source location of the FIRST call
 * expression that requires each effect. Used to point EFFECT-001 at the specific
 * call rather than the flow declaration header.
 */
function inferEffectCallLocations(node: AstNode): Map<string, SourceLocation> {
  const locations = new Map<string, SourceLocation>();
  const aliasMap = buildModuleAliasMap(node); // C1: alias-aware, consistent with inferEffectsFromNode

  function walk(n: AstNode): void {
    // Skip fnDecl bodies — consistent with inferEffectsFromNode
    if (n.kind === "fnDecl") return;
    if (n.kind === "callExpr" || n.kind === "memberExpr") {
      const callText = buildCallText(n, aliasMap);
      for (const [pattern, effect] of EFFECT_CALL_PATTERNS) {
        if (pattern.test(callText)) {
          if (!locations.has(effect) && n.location !== undefined) {
            locations.set(effect, n.location);
          }
          break;
        }
      }
    }
    for (const child of n.children ?? []) {
      walk(child);
    }
  }

  walk(node);
  return locations;
}

/**
 * Task 3: Find fn helpers declared within a flow node and collect the effects
 * their bodies produce, together with the call site location.
 *
 * A fn helper is a `fnDecl` node that appears as a child of the flow body.
 * Its body is walked for effect-producing call expressions.
 */
function collectFnHelperEffects(flowNode: AstNode): Map<string, SourceLocation | undefined> {
  const effects = new Map<string, SourceLocation | undefined>();

  function walkForFns(n: AstNode): void {
    if (n.kind === "fnDecl") {
      // Walk the fn body for effect calls
      for (const child of n.children ?? []) {
        walkForEffects(child);
      }
      return; // don't recurse further into nested fnDecls here
    }
    for (const child of n.children ?? []) {
      walkForFns(child);
    }
  }

  function walkForEffects(n: AstNode): void {
    if (n.kind === "callExpr" || n.kind === "memberExpr") {
      const callText = buildCallText(n);
      for (const [pattern, effect] of EFFECT_CALL_PATTERNS) {
        if (pattern.test(callText)) {
          if (!effects.has(effect)) {
            effects.set(effect, n.location);
          }
          break;
        }
      }
    }
    for (const child of n.children ?? []) {
      walkForEffects(child);
    }
  }

  walkForFns(flowNode);
  return effects;
}

function buildCallText(node: AstNode, aliasMap?: ReadonlyMap<string, string>): string {
  if (node.kind === "callExpr") {
    const methodName = node.value ?? "";
    const receiver = node.children?.[0];
    if (receiver !== undefined) {
      const receiverText = buildCallText(receiver, aliasMap);
      // C1: an alias resolves a lowercase receiver to a module name (`x` → `AuditLog`); the raw node is
      // not member-like (lowercase `x`), so also accept when the RESOLVED text looks like a module, so
      // `x.write` builds as `AuditLog.write` and the effect patterns match. Resolving a non-module alias
      // is harmless — the resulting text simply won't match any effect pattern.
      if (receiverText !== "" && (receiverLooksLikeMemberReceiver(receiver) || nameLooksLikeModule(receiverText))) {
        return `${receiverText}.${methodName}`;
      }
    }
    return methodName;
  }
  if (node.kind === "memberExpr") {
    const receiver = node.children?.[0];
    const member = node.value ?? "";
    if (receiver !== undefined) {
      const receiverText = buildCallText(receiver, aliasMap);
      return receiverText !== "" ? `${receiverText}.${member}` : member;
    }
    return member;
  }
  if (node.kind === "identifier") {
    const name = node.value ?? "";
    // C1: resolve a module alias at the receiver leaf (`let x = AuditLog` → `x` reads as `AuditLog`).
    return aliasMap?.get(name) ?? name;
  }
  return "";
}

function nameLooksLikeModule(value: string): boolean {
  return /^[A-Z]/.test(value) || value === "http" || value === "fs" || value === "env" || value === "json" || value === "toml" || value === "vault";
}

function receiverLooksLikeMemberReceiver(node: AstNode): boolean {
  if (node.kind === "memberExpr") return true;
  if (node.kind !== "identifier") return false;
  return nameLooksLikeModule(node.value ?? "");
}

function formatEffects(effects: readonly string[]): string {
  return `[${effects.join(", ")}]`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

// ---------------------------------------------------------------------------
// Flat diagnostic converter (for merging into CompilerResult)
// ---------------------------------------------------------------------------

export function effectResultsToDiagnostics(
  results: readonly EffectCheckResult[],
): readonly ParseDiagnostic[] {
  return results.flatMap((r) =>
    r.diagnostics.map((d) => ({
      code: d.code,
      name: d.name,
      severity: d.severity,
      message: d.message,
      ...(d.location !== undefined ? { location: d.location } : {}),
      ...(d.suggestedFix !== undefined ? { suggestedFix: d.suggestedFix } : {}),
      ...(d.suggestedCode !== undefined ? { suggestedCode: d.suggestedCode } : {}),
    })),
  );
}

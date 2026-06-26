/**
 * hybrid-engine.ts — The Unified Hybrid Inference Engine
 *
 * ONE bespoke engine that blends the best of three open-source engines inside a
 * single governed inference pass:
 *
 *   BitNet (ternary)  +  NVFP4 (fp4 block)  +  Groq LPU (static schedule)
 *
 * It is NOT a router that dispatches a whole request to one of three backends.
 * It is a single engine whose internal operations each run the technique best
 * suited to that operation — and every choice is recorded in the AuditEvent
 * ledger so the mixed-precision pass is fully provable after the fact.
 *
 * Governance lifecycle per inference call (LOAD → EXEC → ERASE):
 *   1. LOAD   — sandbox created, artifact hash + correlation ID bound
 *   2. PLAN   — precision router produces a per-op HybridPlan
 *   3. EXEC   — each op dispatched to its technique's kernel (FFI seam)
 *   4. AUDIT  — per-op precision decisions + final receipt → audit log
 *   5. ERASE  — sandbox state wiped (stateless by default)
 *
 * The actual math kernels live in the source repos and are reached through FFI
 * seams (documented below). This module is the GOVERNANCE + ORCHESTRATION layer
 * — the part that is LogicN's distinctive value.
 */

import { createHash } from "node:crypto";
import { TowerRuntime } from "./tower-runtime.js";
import type { PluginMetadata, ExecutionResult } from "./plugin-sandbox.js";
import {
  planHybridInference,
  type HybridPlan,
  type InferenceOpClass,
  type RoutingContext,
  type PrecisionDecision,
  type PrecisionTechnique,
} from "./precision-strategy.js";
import { createStubRegistry } from "./bridge/stub-provider.js";
import { assertDeterminism, type BridgeRegistry, type BridgeOp, type BridgeResult, type BridgeAttestation } from "./bridge/interface.js";
import type { EgressSink } from "./audit-logger.js";
import { verifyAttestation, verifyAttestationHybrid, type AttestationPolicy } from "./bridge-attestation.js";
import { compilePolicy, POL_HAS_ALLOWLIST, POL_HAS_CALL_BUDGET, POL_HAS_TOKEN_BUDGET, POL_DENY_HOST_NATIVE, type CompiledPolicy } from "./compiled-policy.js";

// The canonical layer sequence of a transformer inference pass.
// Real models repeat the attention/feedforward block N times; we route by class,
// so one decision per class covers all repeated layers of that class.
const STANDARD_INFERENCE_OPS: readonly InferenceOpClass[] = [
  "embedding",
  "attention",
  "normalization",
  "feedforward",
  "kv_cache",
  "output_head",
];

export interface HybridInferenceRequest {
  readonly prompt:         string;
  readonly correlationId:  string;
  readonly maxNewTokens?:  number;
  /** Operation classes to route. Defaults to the standard transformer sequence. */
  readonly opClasses?:     readonly InferenceOpClass[];
  /**
   * Model the caller wants to invoke. Enforced against the flow's
   * `ai { approved_models }` allow-list — an unapproved model traps the call.
   */
  readonly model?:         string;
}

/**
 * Governance constraints sourced from a `.lln` flow's `ai {}` contract block.
 * The engine enforces these as hard limits: a violation traps the inference
 * BEFORE any compute runs (Hold-First), so the trail proves the boundary held.
 */
export interface AiGovernance {
  /** `ai { approved_models { … } }` — allow-list; an unlisted model is denied.
   *  When set, a request that omits `model` is ALSO denied (no implicit pass). */
  readonly approvedModels?: readonly string[];
  /** `ai { max_model_calls N }` — per-engine inference budget across its lifetime. */
  readonly maxModelCalls?:  number;
  /** `ai { max_tokens N }` — per-call output-token ceiling. A request asking for more
   *  traps `ERR_AI_TOKEN_BUDGET`. Required in certified mode. */
  readonly maxNewTokens?:   number;
  /** `ai { max_token_cost X }` — declared monetary ceiling per call (e.g. "GBP0.05").
   *  Recorded in the receipt/audit; full CostGraph enforcement is a follow-up. Required in certified mode. */
  readonly maxTokenCost?:   string;
  /**
   * Aerospace / Tier-1 strictness. When true, a routed op whose precision has NO
   * registered bridge is NOT allowed to fall through to the host-native float path
   * — it traps `ERR_HOST_NATIVE_DENIED`. Silent host-native execution is an
   * uncontrolled state change in a hardened deployment. Default false (permissive).
   */
  readonly denyHostNativeFallback?: boolean;
}

export interface HybridInferenceReceipt {
  readonly correlationId:  string;
  readonly text:           string;
  readonly tokenCount:     number;
  readonly latencyMs:      number;
  readonly plan:           HybridPlan;
  readonly outputHash:     string;
  readonly enginesBlended: readonly string[];
  readonly avgBitsPerWeight: number;
  readonly deterministic:  boolean;
  readonly trapFired:      boolean;
  readonly trapCode?:      string;
  /** Distinct execution bridges that actually ran ops (Brawn provenance). */
  readonly bridgesUsed:    readonly string[];
  /** True if any op ran on a real native kernel (vs. the deterministic simulator). */
  readonly executedNatively: boolean;
  /**
   * Deterministic checksum of every BIT-EXACT (digital) ternary bridge result in this pass.
   * Bit-identical across CPU/GPU (Citizen Standard 1) — the provable "same answer everywhere"
   * fingerprint for the digital ternary path. A tolerance-verified analog PHOTONIC value is
   * deliberately NOT folded in (it is not bit-exact); when one contributed, `valuesReproducible`
   * is false and this checksum covers the digital subset only.
   */
  readonly ternaryChecksum: number;
  /**
   * True iff every value in this pass is bit-exact reproducible (the digital/governed path).
   * FALSE when a tolerance-verified analog photonic value was accepted — that value is recorded
   * in the trail (bridgesUsed/byOp) but excluded from the bit-exact `ternaryChecksum`. Splits the
   * receipt's two truth channels so a consumer never mistakes an analog value for a bit-exact one.
   */
  readonly valuesReproducible: boolean;
}

/** Default governance metadata for the unified hybrid engine. */
const HYBRID_METADATA: PluginMetadata = {
  engineId:        "logicn-hybrid-uhie-v1",
  artifactPath:    "packages-logicn/logicn-tower-citizen",
  artifactHash:    "sha256:uhie-v1-orchestrator",
  governanceTier:  1, // defaults to most-governed tier; raised by RoutingContext
  license:         "Apache-2.0", // blends MIT (BitNet/Groq) + Apache-2.0 (NVFP4); aggregate = Apache-2.0
  maxMemoryMB:     512,
  capabilityMask:  0b00100000, // V_DPM bit 5 (ai.inference)
};

/**
 * V_DPM capability bit required to run ANY inference op (ai.inference — bit 5).
 * The engine's granted `capabilityMask` must cover this or dispatch fails closed.
 * This is the branchless `(required & granted) === required` gate made REAL: the
 * V_DPM bitmask was declared on PluginMetadata but never enforced — an engine
 * constructed without the ai.inference bit could still run inference. Now it can't.
 */
const AI_INFERENCE_CAP = 0b00100000;

// ── Deterministic demonstration op ───────────────────────────────────────────
// Stage A has no real model weights loaded, so each routed op is exercised with a
// small FIXED ternary vector derived purely from its op class. "Fixed" is the
// point: the result is bit-identical on every run and every machine, which is
// exactly the Citizen Standard 1 (TPL Determinism) property the bridge must
// uphold. Production replaces this with a zero-copy handle into the real weights.
const DEMO_COUNT = 16; // one packed i32 word of BitNet I2_S trits

function fnv1a(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/** Pack a trit array into BitNet I2_S i32 words (must mirror the stub decoder). */
function packTrits(trits: readonly number[]): Int32Array {
  const words = Math.max(1, Math.ceil(trits.length / 16));
  const out = new Int32Array(words);
  for (let idx = 0; idx < trits.length; idx++) {
    const v = trits[idx] ?? 0;
    const enc = v === -1 ? 0 : v === 0 ? 1 : 2; // +1 → 2; never 3 (corruption sentinel)
    const w = (idx / 16) | 0;
    const local = idx % 16;
    const byteIdx = (local / 4) | 0;
    const posInByte = local % 4;
    const shift = byteIdx * 8 + (3 - posInByte) * 2;
    out[w] = (out[w]! | (enc << shift)) | 0;
  }
  return out;
}

function buildDemoTernaryOp(
  opClass: InferenceOpClass,
  precision: PrecisionTechnique,
  correlationId: string,
): BridgeOp {
  const trits: number[] = [];
  const activations = new Int32Array(DEMO_COUNT);
  let r = fnv1a(opClass + ":" + precision) || 1; // seed from op identity only — reproducible
  for (let i = 0; i < DEMO_COUNT; i++) {
    r ^= (r << 13); r >>>= 0; r ^= (r >>> 17); r ^= (r << 5); r >>>= 0; // xorshift32
    trits.push((r % 3) - 1);              // {-1, 0, +1}
    activations[i] = ((r >>> 3) % 7) - 3; // small int domain, no floating point
  }
  return {
    opClass,
    precision,
    correlationId,
    weights: packTrits(trits),
    activations,
    count: DEMO_COUNT,
    scale: 1,
    offset: 0,
  };
}

/**
 * Per-kernel cost inputs the photonic offload port reads (a subset of the partition router's
 * KernelCost). Carried structurally so the Tower never imports the photonic package.
 */
export interface PhotonicKernelCost {
  readonly n: number;
  readonly lane: "photonic" | "noisy" | "digital";
  readonly tolerance?: number;
  readonly isCrypto?: boolean;
  readonly isControlFlow?: boolean;
}

/**
 * Optional photonic offload port (opt-in, off by default). Given a routed op + its kernel cost,
 * returns a tolerance-verified photonic result for a net-win ELIGIBLE kernel, or `null` to DECLINE
 * (ineligible / no net win / out-of-tolerance / any uncertainty) — in which case the engine runs
 * its unchanged digital dispatch. A non-null result has already passed the port's Freivalds/tolerance
 * re-verify, so it substitutes that for the bit-exact ternary `assertDeterminism` oracle on that op.
 * Duck-typed so the Tower never depends on the photonic package; a deployment injects an adapter
 * (e.g. `@logicn/ext-photonic-emulator`'s `createPhotonicRouterPort`). NEVER consulted in certified
 * mode (the dev emulator is an unattested tolerance backend).
 */
export interface PhotonicOffloadPort {
  route(op: BridgeOp, kernel: PhotonicKernelCost): { value: number; bridgeId: string } | null;
}

/**
 * Certified-mode admission for the photonic lane. In CERTIFIED mode the photonic offload is consulted ONLY
 * when this admission record is present, the sync preconditions hold, the engine has an attestationPolicy,
 * AND `signedManifest` cryptographically verifies (fail-closed):
 *   • attested: asserts a verified attestation of the backend artifact exists (caller-declared intent);
 *   • certificationProfile === "certified" (the dev emulator declares "dev");
 *   • toleranceWitnessed: the declared band is bound to a measured-epsilon curve (the ToleranceWitness rail);
 *   • signedManifest (H5 FIX): a SIGNED photonic BridgeManifest. The engine verifies it via the SAME path
 *     registry bridges use (verifyAttestationHybrid when an ML-DSA key is configured, else verifyAttestation)
 *     against the engine's attestationPolicy, and additionally requires manifest.certificationProfile ===
 *     "certified". Without a verifying signed manifest, certified photonic stays OFF — the self-declared
 *     booleans alone NEVER admit (closing the confused-deputy: a forged `{attested:true,…}` literal carries
 *     no valid signature, so it is denied).
 * Absent/unsigned/unverifiable ⇒ photonic stays OFF in certified mode (the safe default). A deployment builds
 * `signedManifest` from a real attested certified-profile backend (selected via the photonic-hardware switch).
 */
export interface PhotonicCertifiedAttestation {
  readonly attested: boolean;
  readonly certificationProfile: string;
  readonly toleranceWitnessed: boolean;
  /** H5: a SIGNED photonic BridgeManifest, verified against the engine's attestationPolicy. Required to admit. */
  readonly signedManifest?: BridgeAttestation;
}

export interface PhotonicConfig {
  readonly router: PhotonicOffloadPort;
  /** Map a routed op to its kernel cost. Default: `{ n: op.count, lane: "photonic", tolerance: 0.05 }`. */
  readonly kernelFor?: (op: BridgeOp) => PhotonicKernelCost;
  /** When present + verified, admits the photonic lane in CERTIFIED mode (else it stays off). */
  readonly certifiedAttestation?: PhotonicCertifiedAttestation;
}

const defaultPhotonicKernelFor = (op: BridgeOp): PhotonicKernelCost => ({ n: op.count, lane: "photonic", tolerance: 0.05 });

export class HybridInferenceEngine {
  private readonly tower: TowerRuntime;
  private readonly ctx: RoutingContext;
  private readonly bridges: BridgeRegistry;
  private readonly governance: AiGovernance;
  /** The numeric policy table — ai{} compiled ONCE into packed flags + a membership
   *  Set + pre-paid certified preconditions. The hot path reads this, not `governance`. */
  private readonly policy: CompiledPolicy;
  private readonly certified: boolean;
  private readonly attestationPolicy: AttestationPolicy | null;
  /** V_DPM authority this engine actually holds. Inference requires AI_INFERENCE_CAP;
   *  a granted mask lacking that bit traps ERR_CAPABILITY_DENIED before any compute. */
  private readonly grantedCapabilityMask: number;
  /** Optional photonic offload (opt-in; off by default; in certified mode only with a verified attestation). */
  private readonly photonic: PhotonicConfig | null;
  /** Sync NECESSARY preconditions for certified photonic (declared intent + attestation infra). Not sufficient. */
  private readonly photonicCertifiedAdmissible: boolean;
  /** True iff the certified-photonic SIGNED manifest cryptographically verified (computed once, async, fail-closed). */
  private photonicCertifiedVerified = false;
  private photonicCertifiedChecked = false;
  private photonicCertifiedDenial: string | null = null;
  private bridgeAttestationDenial: string | null = null; // cached: first offending bridge id, if any
  private bridgeAttestationChecked = false;
  private bridgesInitialized = false;
  private callCount = 0;
  private initialized = false;
  // Policy-driven memoization: a HybridPlan is DETERMINISTIC for a fixed routing
  // context + op set (pure router, no side effects). So we compute it ONCE per
  // op-signature and reuse it — the hot infer() path becomes a map lookup instead
  // of re-running routePrecision for every op on every call. This is the runtime
  // form of "pre-pay the proof at preflight, then pointer-chase the locked plan".
  private readonly planCache = new Map<string, HybridPlan>();
  private sealed = false;

  constructor(
    ctx: Partial<RoutingContext> = {},
    tower?: TowerRuntime,
    bridges?: BridgeRegistry,
    governance?: AiGovernance,
    certified = false,
    attestationPolicy: AttestationPolicy | null = null,
    grantedCapabilityMask: number = HYBRID_METADATA.capabilityMask,
    photonic: PhotonicConfig | null = null,
  ) {
    this.ctx = {
      governanceTier: ctx.governanceTier ?? 1,
      fp4HardwareAvailable: ctx.fp4HardwareAvailable ?? false,
      airGapped: ctx.airGapped ?? true, // safe default: assume regulated/air-gapped
      ...(ctx.maxLatencyMs !== undefined ? { maxLatencyMs: ctx.maxLatencyMs } : {}),
      // R&D 0007: thread the declared substrate tolerance through so routePrecision can route a
      // tolerant non-sensitive op to the low-bit lane. Absent ⇒ tight/default (no relaxation).
      ...(ctx.tolerance !== undefined ? { tolerance: ctx.tolerance } : {}),
    };
    this.tower = tower ?? new TowerRuntime({ assimilationMemoryBudgetMB: 512, auditDepth: "full" });
    // The Brain→Brawn seam: default to the in-package stub registry (the real
    // TPLSimulator for ternary), which runs on ANY machine. A deployment with
    // native silicon passes a registry built from logicn-ext-bridge-* instead.
    // The default registry SHARES the tower's audit logger so the whole governed
    // pass writes ONE unified trail (and honours the tower's in-memory mode)
    // rather than each bridge spawning its own disk-backed ledger.
    this.bridges = bridges ?? (createStubRegistry(this.tower.getAudit()) as BridgeRegistry);
    this.governance = governance ?? {};
    // #140: compile the ai{} policy ONCE at construction into a branchless numeric
    // table. NOTE (#194 benchmark): we intentionally do NOT route this through
    // GateCache — compilePolicy is ~56ns (branchless), while a content-hash cache
    // key (canonicalize + SHA-256) is ~2150ns, so caching this would be ~38x SLOWER.
    // GateCache stays an opt-in utility for genuinely-expensive future evaluators.
    this.policy = compilePolicy(this.governance, certified); // pre-pay the proof once
    this.certified = certified;
    this.attestationPolicy = attestationPolicy;
    this.grantedCapabilityMask = grantedCapabilityMask;
    this.photonic = photonic;
    // Certified-mode photonic admission — NECESSARY sync preconditions, computed once, fail-closed: the
    // deployment must declare intent (all three fields) AND the engine must have an attestation path
    // (attestationPolicy !== null). These are NOT sufficient: H5 requires `signedManifest` to additionally
    // VERIFY cryptographically (verifyPhotonicCertifiedAdmission, async, during the governance gate) before
    // the photonic lane is admitted in certified mode. The self-declared booleans alone never admit.
    const ca = photonic?.certifiedAttestation;
    this.photonicCertifiedAdmissible =
      ca !== undefined &&
      ca.attested === true &&
      ca.certificationProfile === "certified" &&
      ca.toleranceWitnessed === true &&
      attestationPolicy !== null;
  }

  /**
   * CF-3/CF-7: verify every bridge in the registry against the attestation policy.
   * Runs once and caches the result. Returns the first offending bridge id (with a
   * reason via the audit) or null when all bridges are attested.
   */
  private async checkBridgeAttestation(): Promise<string | null> {
    if (this.attestationPolicy === null) return null;
    if (this.bridgeAttestationChecked) return this.bridgeAttestationDenial;
    this.bridgeAttestationChecked = true;
    const policy = this.attestationPolicy;
    // #34: a configured ML-DSA public key escalates admission to the hybrid verifier —
    // BOTH the Ed25519 and the ML-DSA-65 half must verify (no PQ downgrade). Absent ⇒
    // classical Ed25519-only verification (backward-compatible default).
    const mlDsaPublicKey = policy.mlDsaPublicKey;
    // CRYPTO-002: requireHybrid forbids the classical fallback — a policy that mandates hybrid
    // but provisions no ML-DSA key must fail closed, not silently downgrade to Ed25519-only.
    if (policy.requireHybrid === true && mlDsaPublicKey === undefined) {
      this.bridgeAttestationDenial = "requireHybrid set but no mlDsaPublicKey provisioned (no PQ downgrade)";
      return this.bridgeAttestationDenial;
    }
    for (const bridge of this.bridges.values()) {
      const result = mlDsaPublicKey !== undefined
        ? await verifyAttestationHybrid(bridge.attestation, policy, mlDsaPublicKey)
        : verifyAttestation(bridge.attestation, policy);
      if (!result.ok) {
        this.bridgeAttestationDenial = `${bridge.bridgeId}: ${result.reason ?? "unattested"}`;
        return this.bridgeAttestationDenial;
      }
    }
    this.bridgeAttestationDenial = null;
    return null;
  }

  /**
   * H5 (threat-model, 2026-06-25): certified-mode photonic admission must be backed by a VERIFIED signed
   * photonic BridgeManifest — NOT the caller's self-declared booleans (the confused-deputy). Verify the
   * supplied `signedManifest` through the SAME attestation path registry bridges use (hybrid when an ML-DSA
   * key is configured, else classical Ed25519), and ADDITIONALLY require manifest.certificationProfile ===
   * "certified" regardless of the policy's requireCertifiedProfile flag (defense-in-depth). Runs once, caches.
   * Fail-CLOSED at every step: no policy / no signed manifest / failed verification / non-certified profile /
   * a throwing verifier ⇒ certified photonic stays OFF. Returns true iff cryptographically admissible.
   */
  private async verifyPhotonicCertifiedAdmission(): Promise<boolean> {
    if (this.photonicCertifiedChecked) return this.photonicCertifiedVerified;
    this.photonicCertifiedChecked = true;
    // The NECESSARY sync preconditions (declared intent + attestation infra) must hold first.
    if (!this.photonicCertifiedAdmissible) return false;
    const policy = this.attestationPolicy;
    if (policy === null) return false; // no attestation path ⇒ never admit (already implied, kept defensive)
    const signed = this.photonic?.certifiedAttestation?.signedManifest;
    if (!signed) {
      // CONFUSED-DEPUTY FIX: a self-declared attestation with no signed manifest is NOT trusted.
      this.photonicCertifiedDenial = "certified photonic requires a signed BridgeManifest (self-declared attestation is not trusted)";
      return false;
    }
    const mlDsaPublicKey = policy.mlDsaPublicKey;
    // Mirror checkBridgeAttestation: a policy that mandates hybrid but provisions no ML-DSA key fails closed.
    if (policy.requireHybrid === true && mlDsaPublicKey === undefined) {
      this.photonicCertifiedDenial = "requireHybrid set but no mlDsaPublicKey provisioned (no PQ downgrade)";
      return false;
    }
    let result;
    try {
      result = mlDsaPublicKey !== undefined
        ? await verifyAttestationHybrid(signed, policy, mlDsaPublicKey)
        : verifyAttestation(signed, policy);
    } catch (e) {
      this.photonicCertifiedDenial = `photonic attestation verify error: ${(e as Error).message}`;
      return false; // a throwing verifier is itself a denial
    }
    if (!result.ok) {
      this.photonicCertifiedDenial = `photonic attestation rejected: ${result.reason ?? "unverified"}`;
      return false;
    }
    if (signed.manifest.certificationProfile !== "certified") {
      this.photonicCertifiedDenial = `photonic manifest profile is "${signed.manifest.certificationProfile}", not "certified"`;
      return false;
    }
    this.photonicCertifiedVerified = true;
    return true;
  }

  initialize(): { plan: HybridPlan } {
    // Pre-plan the standard pass so the deployment can be inspected before any
    // real inference runs. The plan is deterministic for a fixed context.
    const plan = this.planFor(STANDARD_INFERENCE_OPS);
    this.initialized = true;
    return { plan };
  }

  /** Memoized plan lookup — compute once per op-signature, then reuse. */
  private planFor(ops: readonly InferenceOpClass[]): HybridPlan {
    const key = ops.join(",");
    let plan = this.planCache.get(key);
    if (plan === undefined) {
      plan = planHybridInference(ops, this.ctx);
      this.planCache.set(key, plan);
    }
    return plan;
  }

  /**
   * Preflight: lock the deployment. Pre-computes + caches the plans for the given
   * op sets (default: the standard transformer pass) so the flight-time infer()
   * path never re-plans. Returns the locked plans for inspection / a preflight
   * receipt. After seal(), the engine refuses to compute a NEW (uncached) plan —
   * an op-set not seen at preflight traps, matching the "no runtime planning in
   * flight" discipline.
   */
  seal(opSets: readonly (readonly InferenceOpClass[])[] = [STANDARD_INFERENCE_OPS]): { plans: HybridPlan[] } {
    const plans = opSets.map((ops) => this.planFor(ops));
    this.initialized = true;
    this.sealed = true;
    return { plans };
  }

  /**
   * Run a governed hybrid inference pass.
   *
   * FFI seam — in production each precision technique dispatches to its kernel:
   *   ternary   → ggml_bitnet_mul_mat_task_compute()   (C:\wwwprojects\BitNet)
   *   fp4_block → te_fp4_gemm()                         (C:\wwwprojects\TransformerEngine)
   *   scheduled → static plan replay                    (Groq-derived scheduler)
   * Stage A returns a governed stub; the governance/audit path is fully real.
   */
  async infer(request: HybridInferenceRequest): Promise<HybridInferenceReceipt> {
    if (!this.initialized) this.initialize();

    const ops = request.opClasses ?? STANDARD_INFERENCE_OPS;
    // A sealed deployment must NOT plan in flight: an op-set never preflighted is a
    // denial (deny-by-default extended to routing). Otherwise use the memoized plan.
    const planPreflighted = !this.sealed || this.planCache.has(ops.join(","));
    const plan = planPreflighted ? this.planFor(ops) : this.planFor(STANDARD_INFERENCE_OPS);

    const { sandbox, correlationId } = await this.tower.load(HYBRID_METADATA, request.correlationId);
    const audit = this.tower.getAudit();
    const t0 = Date.now();

    try {
      // ── Hold-First governance gate — trap BEFORE any compute runs ────────────
      // The boundary must hold before the Brawn ever sees the op. An unapproved
      // model or an exhausted call budget is denied here, leaving an audit trail
      // that proves no compute happened.
      // CF-3/CF-7: an unattested bridge in the registry is denied before any compute.
      // The branchless capability gate is the MOST fundamental authority question —
      // does this engine even hold the ai.inference V_DPM bit? — so it runs first.
      const capabilityHeld = (AI_INFERENCE_CAP & this.grantedCapabilityMask) === AI_INFERENCE_CAP;
      const bridgeDenial = await this.checkBridgeAttestation();
      // H5: verify the certified-photonic SIGNED manifest once (fail-closed; sets photonicCertifiedVerified).
      // Cheap + cached; in non-certified mode the read site uses `!this.certified` so this is a no-op gate.
      if (this.photonic && this.certified) await this.verifyPhotonicCertifiedAdmission();
      const govTrap = !capabilityHeld
        ? { code: "ERR_CAPABILITY_DENIED", details: { required: AI_INFERENCE_CAP, granted: this.grantedCapabilityMask } }
        : bridgeDenial !== null
          ? { code: "ERR_BRIDGE_UNATTESTED", details: { bridge: bridgeDenial } }
          : !planPreflighted
            ? { code: "ERR_PLAN_NOT_PREFLIGHTED", details: { ops: [...ops] } }
            : this.checkAiGovernance(request);
      if (govTrap) {
        audit.trap(correlationId, HYBRID_METADATA.artifactHash, HYBRID_METADATA.engineId,
          govTrap.code, govTrap.details);
        const latencyMs = Date.now() - t0;
        await this.tower.erase(sandbox, correlationId);
        return this.buildReceipt(request, plan, "", latencyMs, "sha256:0", [], false, 0, true, true, govTrap.code);
      }
      this.callCount++;

      const execResult: ExecutionResult = await this.tower.execute(sandbox, request, correlationId);

      let bridgesUsed: string[] = [];
      let executedNatively = false;
      let ternaryChecksum = 0;
      let valuesReproducible = true;

      if (!execResult.trapFired) {
        // EXEC — dispatch each precision decision through its registered bridge
        // (the Brain→Brawn seam), then record the decision + its provenance.
        const dispatch = this.dispatchPlan(plan, correlationId);

        // Hardened Border: in aerospace mode, a routed precision with no bridge must
        // NOT silently run host-native — trap it as an uncontrolled state change.
        if ((this.policy.flags & POL_DENY_HOST_NATIVE) && dispatch.deniedTechniques.length > 0) {
          audit.trap(correlationId, HYBRID_METADATA.artifactHash, HYBRID_METADATA.engineId,
            "ERR_HOST_NATIVE_DENIED", { deniedTechniques: dispatch.deniedTechniques });
          const latencyMs = Date.now() - t0;
          await this.tower.erase(sandbox, correlationId, execResult);
          return this.buildReceipt(request, plan, "", latencyMs, "sha256:0", dispatch.bridgesUsed, dispatch.executedNatively, dispatch.ternaryChecksum, dispatch.valuesReproducible, true, "ERR_HOST_NATIVE_DENIED");
        }

        // A bridge fault / ternary-drift trap caught mid-dispatch fails CLOSED as a
        // governed trap receipt — it must NEVER escape infer() as an ungoverned exception
        // (fail-safe-to-Binary / no system crash, Goal C).
        if (dispatch.trap) {
          audit.trap(correlationId, HYBRID_METADATA.artifactHash, HYBRID_METADATA.engineId,
            dispatch.trap.code, dispatch.trap.details);
          const latencyMs = Date.now() - t0;
          await this.tower.erase(sandbox, correlationId, execResult);
          return this.buildReceipt(request, plan, "", latencyMs, "sha256:0", dispatch.bridgesUsed, dispatch.executedNatively, dispatch.ternaryChecksum, dispatch.valuesReproducible, true, dispatch.trap.code);
        }

        bridgesUsed = dispatch.bridgesUsed;
        executedNatively = dispatch.executedNatively;
        ternaryChecksum = dispatch.ternaryChecksum;
        valuesReproducible = dispatch.valuesReproducible;
        for (const decision of plan.decisions) {
          this.auditPrecisionDecision(audit, correlationId, decision, dispatch.byOp.get(decision.opClass));
        }
      }

      const latencyMs = Date.now() - t0;

      // Enforce the latency invariant if one was declared.
      if (this.ctx.maxLatencyMs !== undefined && latencyMs > this.ctx.maxLatencyMs) {
        audit.trap(correlationId, HYBRID_METADATA.artifactHash, HYBRID_METADATA.engineId,
          "ERR_LATENCY_INVARIANT", { latencyMs, boundMs: this.ctx.maxLatencyMs });
        await this.tower.erase(sandbox, correlationId, execResult);
        return this.buildReceipt(request, plan, "", latencyMs, "sha256:0", bridgesUsed, executedNatively, ternaryChecksum, valuesReproducible, true, "ERR_LATENCY_INVARIANT");
      }

      if (execResult.trapFired) {
        await this.tower.erase(sandbox, correlationId, execResult);
        return this.buildReceipt(request, plan, "", latencyMs, execResult.outputHash, bridgesUsed, executedNatively, ternaryChecksum, valuesReproducible, true, execResult.trapCode);
      }

      // Stage A governed result — the ternary path is REAL (executed via the
      // bridge/simulator above); the natural-language detokenisation is the
      // documented seam (production wires a real decoder).
      const text = `[UHIE hybrid pass: ${plan.enginesBlended.length} engines blended, ` +
        `avg ${plan.avgBitsPerWeight} bits/weight, ${plan.deterministic ? "deterministic" : "dynamic"} schedule, ` +
        `ternary checksum ${ternaryChecksum}]`;
      const outputHash = "sha256:" + createHash("sha256").update(text + correlationId).digest("hex").slice(0, 16);

      await this.tower.erase(sandbox, correlationId, execResult);
      return this.buildReceipt(request, plan, text, latencyMs, outputHash, bridgesUsed, executedNatively, ternaryChecksum, valuesReproducible, false);
    } catch (err) {
      await this.tower.erase(sandbox, correlationId);
      throw err;
    }
  }

  /**
   * Enforce the `ai {}` contract constraints. Returns a trap descriptor when a
   * governance boundary is crossed, or null when the call is permitted.
   */
  private checkAiGovernance(request: HybridInferenceRequest): { code: string; details: Record<string, unknown> } | null {
    const p = this.policy; // the numeric policy table — no object-field probing in flight

    // ── P9 Certified Profile: fail closed on missing mandatory governance ──
    // The certified structural preconditions are INVARIANT, so they were resolved
    // once at compile time — the hot path returns the precomputed trap, if any.
    if (p.certifiedTrap !== null) return p.certifiedTrap;

    if (p.flags & POL_HAS_ALLOWLIST) {
      // An allow-list is in force: a request MUST name a model, and it must be listed.
      // Omitting `model` is a denial, not an implicit pass (closes the bypass).
      // Membership is an O(1) Set.has, not an O(n) Array.includes.
      if (request.model === undefined) {
        return { code: "ERR_AI_MODEL_REQUIRED", details: { approved: [...p.approvedModels] } };
      }
      if (!p.approvedModels.has(request.model)) {
        return { code: "ERR_AI_MODEL_NOT_APPROVED", details: { requested: request.model, approved: [...p.approvedModels] } };
      }
    }
    if ((p.flags & POL_HAS_CALL_BUDGET) && this.callCount >= p.maxModelCalls) {
      return { code: "ERR_AI_CALL_BUDGET", details: { used: this.callCount, budget: p.maxModelCalls } };
    }
    // Per-call output-token ceiling (CF-2). A request over budget traps before compute.
    if ((p.flags & POL_HAS_TOKEN_BUDGET) && request.maxNewTokens !== undefined && request.maxNewTokens > p.maxNewTokens) {
      return { code: "ERR_AI_TOKEN_BUDGET", details: { requested: request.maxNewTokens, max: p.maxNewTokens } };
    }
    return null;
  }

  /**
   * Dispatch every op in the plan to its registered bridge (the Brain→Brawn
   * seam). Techniques with no registered bridge (fp8/fp16) are skipped — they
   * have no accelerator and run in the host's native float domain.
   */
  private dispatchPlan(plan: HybridPlan, correlationId: string): {
    bridgesUsed: string[];
    executedNatively: boolean;
    ternaryChecksum: number;
    /** False iff a tolerance-verified analog photonic value contributed (not bit-exact). */
    valuesReproducible: boolean;
    byOp: Map<InferenceOpClass, BridgeResult>;
    deniedTechniques: string[];
    /** A bridge fault / ternary-drift trap caught mid-dispatch — fail-closed, governed
     *  by infer() into a trapFired receipt rather than an escaping exception. */
    trap: { code: string; details: Record<string, unknown> } | null;
  } {
    if (!this.bridgesInitialized) {
      for (const bridge of this.bridges.values()) bridge.initialize();
      this.bridgesInitialized = true;
    }
    const used = new Set<string>();
    const byOp = new Map<InferenceOpClass, BridgeResult>();
    const denied = new Set<string>();
    let executedNatively = false;
    let ternaryChecksum = 0;
    let valuesReproducible = true; // flips false if an analog (tolerance-verified) photonic value is accepted
    let trap: { code: string; details: Record<string, unknown> } | null = null;

    for (const decision of plan.decisions) {
      const op = buildDemoTernaryOp(decision.opClass, decision.precision, correlationId);

      // ── Photonic offload (opt-in, fail-closed, NOT in certified mode) ─────────────────────
      // For a ternary op, consult the injected photonic backend FIRST. A non-null result has
      // ALREADY passed the port's tolerance re-verify, so we accept it WITHOUT the bit-exact
      // assertDeterminism oracle (the analog lane is tolerance-verified, not bit-exact). A null
      // result means the port declined (ineligible / no net win / out-of-tolerance / any
      // uncertainty) → fall through to the UNCHANGED digital dispatch. Default off (this.photonic
      // === null) ⇒ this whole block is skipped and the path below is byte-identical to before.
      // Certified mode normally bars the photonic lane (the dev emulator is unattested). It is admitted in
      // certified mode ONLY when a SIGNED certified attestation cryptographically verified (H5 fix:
      // photonicCertifiedVerified, set by verifyPhotonicCertifiedAdmission — not the self-declared booleans).
      if (this.photonic && (!this.certified || this.photonicCertifiedVerified) && decision.precision === "ternary") {
        // Fail-SAFE to Binary: the whole duck-typed photonic-port interaction (kernel
        // build + route) is guarded — a port that THROWS (corrupt trit / native-handle
        // fault) DECLINES to the digital floor below, never escaping as an ungoverned
        // exception. A throw is treated exactly like a null/decline.
        const ph = (() => {
          try {
            const kernel = (this.photonic.kernelFor ?? defaultPhotonicKernelFor)(op);
            return this.photonic.router.route(op, kernel);
          } catch { return null; }
        })();
        // Engine-side defense-in-depth: the injected port is duck-typed and NOT attestation-gated
        // (checkBridgeAttestation only iterates this.bridges). So do not trust it blindly:
        //   • reject a non-finite value (fail-closed → fall through to the digital dispatch); and
        //   • record provenance under a reserved `photonic:` namespace so an injected port can NEVER
        //     impersonate an attested registry bridge (e.g. claim bridgeId "stub-ternary") in the trail.
        // H6 (threat-model, TRACKED follow-up #36): a full engine-side VALUE re-verify (recompute the
        // digital reference + bound-check) is NOT yet wired here — a naive recompute + relative tolerance
        // rejects the LEGITIMATE emulator value (its calibrated noise deviates beyond a simple bound), so
        // the correct re-verify must use the emulator's calibrated ToleranceWitness (photonic-bridge
        // calibrate()), a focused follow-up. Today the analog value is excluded from the bit-exact
        // ternaryChecksum and flagged valuesReproducible=false (split truth channels) — a downstream
        // consumer must treat it as untrusted, degrade-only.
        if (ph && Number.isFinite(ph.value)) {
          const provId = `photonic:${ph.bridgeId}`;
          used.add(provId);
          byOp.set(decision.opClass, {
            value: ph.value, executedNatively: false, bridgeId: provId,
            technique: "ternary", latencyMs: 0, deterministic: false,
          });
          // Tolerance-verified analog value: recorded in the trail (byOp above) but NOT folded into
          // the bit-exact ternaryChecksum — flag the pass non-reproducible instead (split truth channels).
          valuesReproducible = false;
          continue; // photonic handled this op (tolerance-verified) — skip the digital dispatch
        }
        // ph null / non-finite → fall through to the UNCHANGED digital dispatch (fail-closed).
      }

      const bridge = this.bridges.get(decision.precision);
      if (!bridge) {
        // No accelerator bridge for this precision (e.g. fp8/fp16). In permissive
        // mode it runs host-native; in aerospace mode that silent fallback is denied.
        denied.add(decision.precision);
        continue;
      }
      let result: BridgeResult;
      try {
        result = bridge.execute(op);
        assertDeterminism(result); // Citizen Standard 1 — abort on ternary drift
      } catch (e) {
        // A bridge fault or a ternary-drift trap (Citizen Standard 1) must fail CLOSED as
        // a GOVERNED trap, never escape infer() as an ungoverned exception. Stop dispatch;
        // infer() turns this into a trapFired receipt (no-crash / fail-safe-to-Binary).
        trap = { code: "ERR_BRIDGE_DISPATCH_FAULT", details: { opClass: decision.opClass, precision: decision.precision, error: e instanceof Error ? e.message : String(e) } };
        break;
      }
      used.add(result.bridgeId);
      byOp.set(decision.opClass, result);
      if (result.executedNatively) executedNatively = true;
      if (result.technique === "ternary") {
        // Order-independent, deterministic accumulation of ternary results.
        ternaryChecksum = (ternaryChecksum + (result.value | 0)) | 0;
      }
    }
    return { bridgesUsed: [...used], executedNatively, ternaryChecksum, valuesReproducible, byOp, deniedTechniques: [...denied], trap };
  }

  /** Release native bridge resources. Call once at engine teardown (NOT per-infer —
   *  registry bridges are shared across calls). Part of the Erase discipline. */
  async shutdown(): Promise<void> {
    for (const bridge of this.bridges.values()) await bridge.shutdown();
    this.bridgesInitialized = false;
  }

  private auditPrecisionDecision(
    audit: ReturnType<TowerRuntime["getAudit"]>,
    correlationId: string,
    decision: PrecisionDecision,
    bridgeResult?: BridgeResult,
  ): void {
    audit.append({
      phase: "EXEC",
      correlationId,
      artifactHash: HYBRID_METADATA.artifactHash,
      engineId: HYBRID_METADATA.engineId,
      severity: "INFO",
      category: "AUDIT_TRAIL",
      details: {
        action: "precision_decision",
        op: decision.opClass,
        precision: decision.precision,
        scheduling: decision.scheduling,
        sourceEngine: decision.sourceEngine,
        reason: decision.reason,
        // Brawn provenance — which bridge actually executed this op, and whether
        // it ran on real silicon or the deterministic simulator.
        ...(bridgeResult
          ? { bridgeId: bridgeResult.bridgeId, executedNatively: bridgeResult.executedNatively, deterministic: bridgeResult.deterministic }
          : { bridgeId: "host-native", executedNatively: false }),
      },
      governancePass: true,
    });
  }

  private buildReceipt(
    request: HybridInferenceRequest,
    plan: HybridPlan,
    text: string,
    latencyMs: number,
    outputHash: string,
    bridgesUsed: readonly string[],
    executedNatively: boolean,
    ternaryChecksum: number,
    valuesReproducible: boolean,
    trapFired: boolean,
    trapCode?: string,
  ): HybridInferenceReceipt {
    return {
      correlationId: request.correlationId,
      text,
      tokenCount: request.maxNewTokens ?? 0,
      latencyMs,
      plan,
      outputHash,
      enginesBlended: plan.enginesBlended,
      avgBitsPerWeight: plan.avgBitsPerWeight,
      deterministic: plan.deterministic,
      trapFired,
      bridgesUsed,
      executedNatively,
      ternaryChecksum,
      valuesReproducible,
      ...(trapCode !== undefined ? { trapCode } : {}),
    };
  }

  getAudit() { return this.tower.getAudit(); }
}

/**
 * Convenience factory — detects the deployment profile and configures the engine.
 * Air-gapped is the default safe assumption; callers opt into cloud/GPU explicitly.
 */
export function createHybridEngine(profile: {
  airGapped?: boolean;
  fp4Hardware?: boolean;
  governanceTier?: 1 | 2 | 3;
  maxLatencyMs?: number;
  /** Native bridge registry (e.g. from logicn-ext-bridge-cpp). Defaults to the stub registry. */
  bridges?: BridgeRegistry;
  /** `ai {}` contract constraints to enforce at the boundary. */
  governance?: AiGovernance;
  /** In-memory audit ledger (no disk writes) — for ephemeral / benchmark contexts. */
  auditInMemory?: boolean;
  /** Batched-async durable audit: flush every N events. Constant-time flight without losing durability. */
  auditBatchSize?: number;
  /** Governed egress sink (Sentinel-Egress) — all ledger writes route through it. */
  auditEgress?: EgressSink;
  /** Deterministic Logical Tick source (Sentinel-Time) for cycle-indexed audit timing. */
  auditTickSource?: () => number;
  /**
   * P9 Certified Runtime Profile. Fails CLOSED — the safety claims become mandatory
   * invariants rather than optional config:
   *   - forces `denyHostNativeFallback` (no silent host-native execution)
   *   - REQUIRES a governed egress sink (no direct fs audit writes) — throws if absent
   *   - REQUIRES a signed-bridge attestation policy (requireSigned + publicKeyPem) —
   *     throws ERR_CERTIFIED_NO_ATTESTATION if absent; every bridge must present a
   *     valid signature or it traps ERR_BRIDGE_UNATTESTED before compute.
   *   - REQUIRES, per call, a non-empty approved_models + max_tokens + max_token_cost
   *     (enforced at infer() → ERR_CERTIFIED_*).
   */
  certified?: boolean;
  /**
   * Bridge attestation policy (CF-3/CF-7). When set, every bridge in the registry
   * must present a valid signed/pinned manifest or it traps `ERR_BRIDGE_UNATTESTED`
   * before any compute. Turns the "trusted registry" into an "attested registry".
   */
  attestation?: AttestationPolicy;
  /**
   * V_DPM capability bitmask this engine is granted (defaults to the hybrid
   * engine's own ai.inference bit). An engine constructed WITHOUT the ai.inference
   * bit traps ERR_CAPABILITY_DENIED before any compute — the bitmask gate enforced,
   * not decorative. A deployment narrows this to express "no inference authority".
   */
  capabilityMask?: number;
  /**
   * Photonic offload (opt-in; off by default). When set, a ternary op routed by the partition
   * cost model to a net-win photonic kernel runs on the injected photonic backend and is accepted
   * only if it passes that backend's tolerance re-verify; otherwise the unchanged digital dispatch
   * runs. Fail-closed; NEVER used in certified mode. A deployment wires
   * `@logicn/ext-photonic-emulator`'s `createPhotonicRouterPort()` here.
   */
  photonic?: PhotonicConfig;
} = {}): HybridInferenceEngine {
  const certified = profile.certified ?? false;

  // Fail closed at construction: certified mode cannot write audit to disk directly.
  if (certified && !profile.auditEgress) {
    throw new Error("ERR_CERTIFIED_NO_EGRESS: certified profile requires a governed audit egress sink (no direct filesystem audit writes)");
  }

  // Fail closed at construction: certified mode mandates signed-bridge attestation.
  // Without this, a P9 engine would trust an unattested registry — the "wide-open
  // door" the whole CF-3/CF-7 boundary exists to shut. The policy must verify
  // signatures (requireSigned + a public key); an unattested or unsigned bridge then
  // traps ERR_BRIDGE_UNATTESTED before any compute.
  if (certified && (!profile.attestation || profile.attestation.requireSigned !== true || !profile.attestation.publicKeyPem)) {
    throw new Error("ERR_CERTIFIED_NO_ATTESTATION: certified profile requires an attestation policy with requireSigned + publicKeyPem (every bridge must present a valid signature)");
  }

  // Fail closed at construction: certified mode mandates the POST-QUANTUM half too.
  // Without mlDsaPublicKey, checkBridgeAttestation() dispatches to the classical Ed25519-only
  // verifier and silently admits a bridge on its classical signature alone — dropping the PQ
  // guarantee in the exact mode meant to make it a mandatory invariant (audit CRYPTO-001).
  // Certified deployments must verify BOTH halves: no post-quantum downgrade.
  if (certified && !profile.attestation?.mlDsaPublicKey) {
    throw new Error("ERR_CERTIFIED_NO_PQ_KEY: certified profile requires attestation.mlDsaPublicKey — hybrid Ed25519+ML-DSA-65 verification is mandatory (no post-quantum downgrade)");
  }

  const needTower = certified || profile.auditInMemory || (profile.auditBatchSize ?? 0) > 0 ||
    profile.auditEgress || profile.auditTickSource;
  const tower = needTower
    ? new TowerRuntime({
        assimilationMemoryBudgetMB: 512,
        auditDepth: "full",
        auditInMemory: profile.auditInMemory ?? false,
        auditBatchSize: profile.auditBatchSize ?? 0,
        ...(profile.auditEgress ? { auditEgress: profile.auditEgress } : {}),
        ...(profile.auditTickSource ? { auditTickSource: profile.auditTickSource } : {}),
      })
    : undefined;

  // Certified mode forces the host-native denial on regardless of caller governance.
  const governance: AiGovernance = certified
    ? { ...(profile.governance ?? {}), denyHostNativeFallback: true }
    : (profile.governance ?? {});

  return new HybridInferenceEngine(
    {
      governanceTier: profile.governanceTier ?? 1,
      airGapped: profile.airGapped ?? true,
      fp4HardwareAvailable: profile.fp4Hardware ?? false,
      ...(profile.maxLatencyMs !== undefined ? { maxLatencyMs: profile.maxLatencyMs } : {}),
    },
    tower,
    profile.bridges,
    governance,
    certified,
    profile.attestation ?? null,
    profile.capabilityMask ?? HYBRID_METADATA.capabilityMask,
    profile.photonic ?? null,
  );
}

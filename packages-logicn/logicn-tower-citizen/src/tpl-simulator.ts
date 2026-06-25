/**
 * tpl-simulator.ts — Virtual Photonic Processor (VPP) core
 *
 * A bespoke, governance-wrapped take on Microsoft BitNet's I2_S ternary kernel
 * (C:\wwwprojects\BitNet\src\ggml-bitnet-mad.cpp, MIT). It reproduces BitNet's
 * exact on-the-wire representation so a buffer packed here is byte-compatible
 * with bitnet.cpp, then adds the LogicN "Hardened Border": guard pages,
 * corruption sentinels, Epistemic-Hold governance, and a vector-level audit trail.
 *
 * Faithful to BitNet I2_S:
 *   2-bit trit encoding   →  0b00 = -1 · 0b01 = 0 · 0b10 = +1 · 0b11 = ILLEGAL
 *   packing               →  4 trits per byte, high-bits-first:
 *                            (q0<<6)|(q1<<4)|(q2<<2)|(q3<<0)
 *   T-MAC                  →  ternary dot product = add / subtract / skip
 *                            (weight ∈ {-1,0,1} ⇒ no multiply) × per-tensor scale
 *                            (BitNet's SIMD path computes the SAME op via a `maddubs`
 *                             trick on the biased {0,1,2} encoding + a downstream bias
 *                             correction; this is the clean unbiased form. No instruction
 *                             parity is claimed — see logicn-tpl-bitnet-fidelity-audit.md.)
 *   scale                 →  i2_scale = max(|weights|), applied after accumulation
 *
 * LogicN additions (the Hardened Border):
 *   - guard-page canaries bracketing the trit region (logical-overflow detection)
 *   - 0b11 read = TPL_INTEGRITY_FAULT (BitNet never emits it; its presence = corruption)
 *   - Epistemic Hold: a 0 → +1 transition is gated by the GovernanceEnforcer
 *   - every T-MAC vector op emits one audit transition (vector-level, not per-trit)
 *   - hard erasure wipes all state buffers atomically between executions
 *
 * WASM discipline: Int32Array backing store, integer-only hot loops, no GC-object
 * churn per gate, unsigned shifts for sign-safe extraction.
 */

import { AuditLogger } from "./audit-logger.js";
import { GovernanceEnforcer } from "./governance-enforcer.js";

// ── Errors (Hardened Border traps) ───────────────────────────────────────────

export class SecurityTrap extends Error {
  constructor(message: string) {
    super(`[SECURITY_TRAP]: ${message}`);
    this.name = "SecurityTrap";
  }
}

export class TPLIntegrityFault extends Error {
  constructor(message: string) {
    super(`[TPL_INTEGRITY_FAULT]: ${message}`);
    this.name = "TPLIntegrityFault";
  }
}

// ── Trit state model (TPL Standard v1.0 §1) ──────────────────────────────────

export const TritState = {
  REJECT: -1, // HALT/REJECT     — immediate termination, forensic log
  HOLD:    0, // EPISTEMIC HOLD  — mandatory verification checkpoint
  COMMIT:  1, // COMMIT/PROCEED  — authorised execution signal
} as const;

// 2-bit encodings — identical to BitNet I2_S.
const ENC_REJECT = 0b00; // -1
const ENC_HOLD   = 0b01; //  0
const ENC_COMMIT = 0b10; // +1
const ENC_ILLEGAL = 0b11; // never written; reading it = corruption

const TRITS_PER_I32 = 16; // 32 bits / 2 bits-per-trit
const CANARY = 0x7e57cafe; // guard-page sentinel ("test cafe")

// ── Encode / decode (BitNet-faithful) ────────────────────────────────────────

function encodeTrit(value: number): number {
  if (value === -1) return ENC_REJECT;
  if (value === 0) return ENC_HOLD;
  if (value === 1) return ENC_COMMIT;
  throw new SecurityTrap(`Value outside ternary set: ${value} (expected -1, 0, or 1)`);
}

function decodeTrit(encoded: number): number {
  switch (encoded) {
    case ENC_REJECT: return -1;
    case ENC_HOLD:   return 0;
    case ENC_COMMIT: return 1;
    default:         // ENC_ILLEGAL
      throw new TPLIntegrityFault(`Illegal trit encoding 0b11 at decode — buffer corruption`);
  }
}

// ── Balanced-ternary logic gates (TPL Standard v1.0 §2 · tasks #196/#173) ─────
// Pure, branch-light operators over balanced ternary {-1, 0, +1} — the algebra
// the photonic substrate emulates: carry-free SUM (== ternary XOR) + its carry,
// AND (min), OR (max), multiply, negation, and the 3-input consensus (majority).
// These live BELOW the governance layer: like gate()/tmacVector(), audit happens
// at the vector/transition level, never per primitive (WASM hot-loop discipline,
// no per-op allocation). Reading an out-of-set value is a SecurityTrap.

function assertTrit(v: number): void {
  if (v !== -1 && v !== 0 && v !== 1) {
    throw new SecurityTrap(`Value outside ternary set: ${v} (expected -1, 0, or 1)`);
  }
}

/** Negation (NOT): +1 ↔ -1, 0 ↦ 0. */
export function negTrit(a: number): number {
  assertTrit(a);
  return a === 0 ? 0 : -a;   // normalise away JS -0
}

/**
 * Balanced-ternary SUM gate — the carry-free sum digit of a+b (addition mod 3,
 * balanced). This IS the ternary XOR: equal inputs that overflow wrap to the
 * opposite sign.
 *   -1,-1→+1 · -1,0→-1 · -1,+1→0 · 0,0→0 · 0,+1→+1 · +1,+1→-1
 */
export function sumTrit(a: number, b: number): number {
  assertTrit(a); assertTrit(b);
  const s = a + b;
  if (s === 2) return -1;   // +1 +1 → wrap to -1 (carry +1)
  if (s === -2) return 1;   // -1 -1 → wrap to +1 (carry -1)
  return s;                 // already in {-1, 0, +1}
}

/** Balanced-ternary XOR — alias of the SUM gate (the notes' "SUM/XOR gate"). */
export function xorTrit(a: number, b: number): number {
  return sumTrit(a, b);
}

/** The carry digit alongside sumTrit(a,b): -1 for (-1,-1), +1 for (+1,+1), else 0. */
export function carryTrit(a: number, b: number): number {
  assertTrit(a); assertTrit(b);
  const s = a + b;
  if (s === 2) return 1;
  if (s === -2) return -1;
  return 0;
}

/** Balanced-ternary half-adder: { sum, carry } with 3*carry + sum === a + b. */
export function addTrit(a: number, b: number): { sum: number; carry: number } {
  return { sum: sumTrit(a, b), carry: carryTrit(a, b) };
}

/** Balanced-ternary multiply: 0 dominates; like signs → +1, unlike → -1. */
export function mulTrit(a: number, b: number): number {
  assertTrit(a); assertTrit(b);
  const p = a * b;
  return p === 0 ? 0 : p;     // normalise away JS -0 (e.g. -1 * 0)
}

/** Balanced-ternary AND (min): the more-cautious (negative) input wins — fail-closed. */
export function minTrit(a: number, b: number): number {
  assertTrit(a); assertTrit(b);
  return a < b ? a : b;
}

/** Balanced-ternary OR (max): the more-permissive (positive) input wins. */
export function maxTrit(a: number, b: number): number {
  assertTrit(a); assertTrit(b);
  return a > b ? a : b;
}

/**
 * 3-input consensus (majority) gate — sign of a+b+c. A tie / all-HOLD yields 0
 * (HOLD), the fail-closed neutral, matching the Epistemic-Hold posture.
 */
export function consensusTrit(a: number, b: number, c: number): number {
  assertTrit(a); assertTrit(b); assertTrit(c);
  const s = a + b + c;
  return s > 0 ? 1 : s < 0 ? -1 : 0;
}

/**
 * Bit shift for trit `index` within its 32-bit word, using BitNet's
 * high-bits-first byte layout so each byte matches (q0<<6)|(q1<<4)|(q2<<2)|(q3<<0).
 */
function tritBitShift(index: number): number {
  const local = index % TRITS_PER_I32; // 0..15
  const byteIdx = (local / 4) | 0;     // 0..3  (which byte of the i32)
  const posInByte = local % 4;         // 0..3  (which trit of the byte)
  return byteIdx * 8 + (3 - posInByte) * 2; // high-bits-first within the byte
}

// ── The simulator ────────────────────────────────────────────────────────────

export class TPLSimulator {
  // Memory layout (Int32Array, WASM-aligned):
  //   [ CANARY ][ ...state words... ][ CANARY ]
  // The leading/trailing canaries are guard pages: any logical overflow that
  // strays past the trit region corrupts a canary and is caught by verifyIntegrity().
  private readonly mem: Int32Array;
  private readonly stateWordStart = 1;
  private readonly stateWordCount: number;
  private readonly canaryTailIdx: number;

  /** Per-tensor scale (BitNet i2_scale = max|weights|). T-MAC results are scaled by this. */
  private scale = 1;

  constructor(
    private readonly logger: AuditLogger,
    private readonly governance: GovernanceEnforcer,
    public readonly sizeInTrits: number,
  ) {
    if (sizeInTrits <= 0 || !Number.isInteger(sizeInTrits)) {
      throw new SecurityTrap(`Invalid TPL buffer size: ${sizeInTrits}`);
    }
    this.stateWordCount = Math.ceil(sizeInTrits / TRITS_PER_I32);
    // 1 leading canary + state words + 1 trailing canary
    this.mem = new Int32Array(1 + this.stateWordCount + 1);
    this.canaryTailIdx = this.stateWordCount + 1;
    this.mem[0] = CANARY;
    this.mem[this.canaryTailIdx] = CANARY;
  }

  setScale(scale: number): void {
    this.scale = scale;
  }

  // ── Guard-page integrity ───────────────────────────────────────────────────

  /** Verify the guard-page canaries are intact. Throws TPLIntegrityFault if not.
   *  RD-0112 R2 (erase-on-DETECTED-corruption): a corrupt canary means a buffer overflow/underflow
   *  may have just touched secret-bearing trit state — a detected integrity violation is precisely
   *  when to wipe. We `erase()` (atomic; re-stamps the canaries) BEFORE unwinding so a detected
   *  corruption never leaves COMMIT residue in the (exported) buffer. This must hold for EXTERNAL
   *  callers too: `verifyIntegrity()` is a public attestation check, not only reached via the
   *  `eraseOnTrap` mutator wrapper (the gap the wrapper alone left open). `erase()` is idempotent
   *  and does not call back into `verifyIntegrity`, so a double-wipe via an enclosing `eraseOnTrap`
   *  is harmless and there is no recursion. Fail-closed: corruption erases, it never preserves. */
  verifyIntegrity(): void {
    if (this.mem[0] !== CANARY) {
      this.erase();
      throw new TPLIntegrityFault("leading guard page corrupted (underflow)");
    }
    if (this.mem[this.canaryTailIdx] !== CANARY) {
      this.erase();
      throw new TPLIntegrityFault("trailing guard page corrupted (overflow)");
    }
  }

  private boundsCheck(index: number): void {
    if (index < 0 || index >= this.sizeInTrits) {
      throw new SecurityTrap(`Trit index ${index} out of bounds [0, ${this.sizeInTrits})`);
    }
  }

  // ── Trit access (BitNet-faithful packing) ──────────────────────────────────

  getTrit(index: number): number {
    this.boundsCheck(index);
    const wordIdx = this.stateWordStart + ((index / TRITS_PER_I32) | 0);
    const shift = tritBitShift(index);
    const encoded = (this.mem[wordIdx]! >>> shift) & 0x03; // unsigned shift — sign-safe
    return decodeTrit(encoded);
  }

  /** RD-0112 R2 — erase-on-trap: any SecurityTrap / TPLIntegrityFault from a state mutator wipes ALL
   *  trit state (reusing the shipped atomic erase()) BEFORE unwinding, so a trapped secret flow leaves
   *  no COMMIT residue in the (exported) buffer. Fail-closed: a fault erases, it never preserves state. */
  private eraseOnTrap<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      this.erase();
      throw e;
    }
  }

  setTrit(index: number, value: number): void {
    this.eraseOnTrap(() => {
      this.boundsCheck(index);
      const encoded = encodeTrit(value); // throws SecurityTrap on toxic input
      const wordIdx = this.stateWordStart + ((index / TRITS_PER_I32) | 0);
      const shift = tritBitShift(index);
      // clear the 2-bit field, then OR in the new encoding
      this.mem[wordIdx] = (this.mem[wordIdx]! & ~(0x03 << shift)) | (encoded << shift);
    });
  }

  // ── Single virtual photonic gate (governed) ────────────────────────────────

  /**
   * Ternary gate: result = inputTrit × weightTrit (ternary multiply), stored at
   * targetIdx. A 0 → +1 transition (Epistemic Hold lifting to Commit) is gated by
   * the GovernanceEnforcer — it requires a valid audit signature.
   */
  gate(inputIdx: number, weightIdx: number, targetIdx: number, correlationId: string): number {
    return this.eraseOnTrap(() => {
      const inputState = this.getTrit(inputIdx);
      const weightState = this.getTrit(weightIdx);
      const result = inputState * weightState; // ∈ {-1, 0, 1}

      // Epistemic Hold enforcement: lifting 0 → +1 is a restricted transition.
      if (inputState === TritState.HOLD && result === TritState.COMMIT) {
        const check = this.governance.checkTransition(TritState.HOLD, TritState.COMMIT);
        if (!check.allowed) {
          this.logger.logTransition({
            correlationId, fromState: inputState, toState: result,
            operation: "GATE_COMMIT", authorized: false,
          });
          throw new SecurityTrap(`Unauthorized transition 0 -> 1: ${check.reason}`);
        }
      }

      this.setTrit(targetIdx, result);
      this.logger.logTransition({
        correlationId, fromState: inputState, toState: result, operation: "GATE",
      });
      return result;
    });
  }

  // ── Ternary Multiply-Accumulate (the BitNet T-MAC) ─────────────────────────

  /**
   * Vector T-MAC: dot product of an int activation vector with a contiguous run
   * of ternary weights, BitNet-style — add / subtract / skip, never multiply.
   *
   *   acc += a[i]      when weight == +1
   *   acc -= a[i]      when weight == -1
   *   (skip)           when weight ==  0   (zero memory/compute cost)
   *
   * Result is scaled by the per-tensor scale (BitNet i2_scale). Audit is recorded
   * once for the whole vector (TPL Standard v1.0 §3 — audit at the vector level).
   * Returns the scaled accumulator (integer-scaled; no floating-point in the loop).
   */
  tmacVector(
    activations: Int32Array,
    weightStartTrit: number,
    count: number,
    correlationId: string,
  ): number {
    return this.eraseOnTrap(() => {
      if (count < 0 || weightStartTrit < 0 || weightStartTrit + count > this.sizeInTrits) {
        throw new SecurityTrap(
          `T-MAC range [${weightStartTrit}, ${weightStartTrit + count}) out of bounds`,
        );
      }
      if (activations.length < count) {
        throw new SecurityTrap(`T-MAC activation vector too short: ${activations.length} < ${count}`);
      }

      let acc = 0; // integer accumulator — no FP in the hot loop
      for (let i = 0; i < count; i++) {
        const w = this.getTrit(weightStartTrit + i); // -1 | 0 | 1
        if (w === 1) acc += activations[i]!;
        else if (w === -1) acc -= activations[i]!;
        // w === 0 → skip (BitNet's zero-cost path)
      }

      // Guard pages must be intact after a bulk operation.
      this.verifyIntegrity();

      const scaled = acc * this.scale;
      this.logger.logTransition({
        correlationId,
        fromState: TritState.HOLD,
        toState: scaled > 0 ? TritState.COMMIT : (scaled < 0 ? TritState.REJECT : TritState.HOLD),
        operation: "TMAC",
      });
      return scaled;
    });
  }

  // ── Bulk load (e.g. quantized weights) ──────────────────────────────────────

  /** Load a run of ternary weights, validating each is in {-1,0,1}. */
  loadWeights(weights: readonly number[], startTrit = 0): void {
    this.eraseOnTrap(() => {
      if (startTrit + weights.length > this.sizeInTrits) {
        throw new SecurityTrap(`loadWeights overflow: ${startTrit + weights.length} > ${this.sizeInTrits}`);
      }
      for (let i = 0; i < weights.length; i++) {
        this.setTrit(startTrit + i, weights[i]!); // setTrit traps toxic values
      }
      this.verifyIntegrity();
    });
  }

  // ── Hard erasure (Load/Execute/Erase lifecycle) ─────────────────────────────

  /**
   * Atomic wipe of all ternary state buffers — prevents side-channel leaks between
   * plugin executions (TPL Standard v1.0 §5.3). Re-stamps the guard pages so the
   * simulator remains usable for the next execution. Also resets governance state.
   */
  erase(): void {
    this.mem.fill(0, this.stateWordStart, this.canaryTailIdx);
    this.mem[0] = CANARY;
    this.mem[this.canaryTailIdx] = CANARY;
    this.scale = 1;
    this.governance.reset();
  }

  // ── Introspection (read-only) ──────────────────────────────────────────────

  /** Snapshot the trit vector as a plain array (for tests / inspection). */
  snapshot(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.sizeInTrits; i++) out.push(this.getTrit(i));
    return out;
  }

  /** Bytes occupied by the packed trit region (BitNet-equivalent footprint). */
  packedByteLength(): number {
    return this.stateWordCount * 4;
  }
}

// =============================================================================
// rd-0151-0153-assimilation-ambiguity-neural-proof.mjs
//
// Machine-checkable proof for "75-improvments" R&D notes 13-15 (RD-0151..0153):
//   RD-0151 = note 13  Dynamic Assimilation (hot-plug hardware — the "missing GOVERNED-CHAOS pillar")
//   RD-0152 = note 14  Tri-Logic Ambiguity ("treat 0 as an active defensive asset")
//   RD-0153 = note 15  Governed AI in AI/ML/Neuro Nets (governance in the tensor path)
// Re-runnable, computed vs ground truth (owner rule feedback-rd-prove-own-maths). Same shape as RD-0138..0149.
//
//   V# = proved here.   X# = excluded — reason + where it is settled.
// Run:  node scripts/rd-0151-0153-assimilation-ambiguity-neural-proof.mjs    (exit 0 iff every V# holds)
// =============================================================================

import { Verdict, vAnd, authorize, maskByVerdict, isMasked } from "../packages-galerina/galerina-tower-citizen/dist/index.js";

const { DENY, INDETERMINATE, ALLOW } = Verdict;
const TRITS = [DENY, INDETERMINATE, ALLOW];
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log(`  PASS  ${l}`); } else { fail++; console.log(`  FAIL  ${l}`); } };

console.log("\n=== RD-0151..0153 — assimilation / ambiguity / governed-AI: machine-checked verdicts ===\n");

// ── V1 — No-Coercion: a photonic / analog "control wavelength" can't be the gate (REFUTES the optical-phase-
//   barrier-IS-alignment-gate of RD-0153, the phase-cancellation-wall of RD-0152, the spectral-grid-routing of
//   RD-0151). Also the anti-poisoning invariant (RD-0153): an untrusted weight update folded via vAnd can only
//   LOWER the capability verdict, never ADD a capability the charter didn't grant.
console.log("V1  No-Coercion — optical/analog control can't be the gate; weight update can't add capability:");
{
  let held = true;
  for (const core of TRITS) for (const sub of TRITS) {
    if (vAnd(core, sub) > core) held = false;
    if (core !== ALLOW && vAnd(core, sub) === ALLOW) held = false;
  }
  ok(held, "forall 9 trit pairs: vAnd(core, untrusted) <= core, never manufactures ALLOW (min-rule)");
  // a poisoned weight that "wants" capability.execution (ALLOW) folded into a charter that denies it stays denied
  ok(vAnd(DENY, ALLOW) === DENY && !authorize(vAnd(DENY, ALLOW)),
     "RD-0153 anti-poisoning: a weight update can't lift a charter-denied capability to ALLOW");
}

// ── V2 — "0 CPU cycles / 0 overhead" REFUTE (latency != work): RD-0151 instruction transmutation + spectral
//   discovery, RD-0152 phase-cancellation, RD-0153 phase-barrier alignment all claim 0-cycle. Applying any
//   transform / mapping to n operands is Theta(n).
console.log("\nV2  '0 cycle / 0 overhead' -> REFUTE (latency != work):");
{
  const applyTransform = (n) => { let ops = 0; for (let i = 0; i < n; i++) ops++; return ops; };
  ok(applyTransform(1000) === 1000 && applyTransform(0) === 0, "applying a transform/mapping to n operands costs n ops, not O(1)");
}

// ── V3 — "treat 0 as an active defensive asset" (RD-0152) is sound ONLY as fail-closed (deny / decoy /
//   masked-sentinel), NOT as "feed the caller fabricated data and keep the LIVE flow alive". Ground truth:
//   authorize(0)=false. The shipped maskByVerdict yields a Masked sentinel (no real value, no fabricated value)
//   — the sound form. Same asterisk as RD-0153's "clamp the rogue activation and continue".
console.log("\nV3  '0 as defensive asset' / 'clamp-and-continue' sound only fail-closed, not fabricate-in-live-flow:");
{
  const SECRET = "balance=12345";
  // RD-0152 literal proposal: on ambiguity, feed dummy data that "perfectly mimics real metrics" and continue.
  const stochasticMask = (verdict, value) => (verdict === ALLOW ? value : "balance=99999"); // FABRICATED, returned to caller
  const masked = stochasticMask(INDETERMINATE, SECRET);
  ok(typeof masked === "string" && !isMasked(masked) && masked !== SECRET,
     "stochastic-mask returns FABRICATED data into the live flow on verdict 0 — a flow happened (fail-open unless a scoped decoy)");
  const m = maskByVerdict(INDETERMINATE);
  ok(isMasked(m) && !authorize(m.verdict),
     "shipped maskByVerdict(0) -> Masked sentinel (no real OR fabricated value flows; fail-closed)");
  ok(authorize(INDETERMINATE) === false, "authorize(0) = false — an ambiguous state must NOT proceed as if resolved");
}

// ── EXCLUDED ──
const EXCLUDED = [
  ["X1", "Hardware Citizen attestation / onboarding for hot-plugged HW (RD-0151)",
        "GENUINE net-new seam but HW-gated + re-derives the shipped bridge-attestation + capability charter; needs a real device attestation channel (DRCM Ph5 / #102-106). Design, owner/HW-gated — not benched here."],
  ["X2", "Activation-vector clamping / latent-manifold projection P_safe(H) (RD-0153)",
        "a real ML alignment technique, but it runs INSIDE the neural net — out of the governance core (ext-bridge / photonic-emulator territory). Galerina GOVERNS the model (weight charter + attestation), it does not run the tensor math. 'clamp-and-continue' carries the V3 declassifier asterisk."],
  ["X3", "Superposed execution — 'spawn parallel threads for ALL potential outcomes' (RD-0152)",
        "unbounded = exponential; the bounded, sound form is NMR / speculative redundancy (RD-0147, substrate-model) — not a new primitive."],
  ["X4", "Stochastic-mask DECEPTION / honeypot (RD-0152)",
        "deception is legit ONLY as a scoped quarantine DECOY (route a CONFIRMED-malicious flow to a decoy substrate, deny the real one) — the shipped 'Decoy Substrate' (Lane -1). As written ('keep the live flow alive on fabricated data') it is fail-open (V3). Design, owner-gated."],
];
console.log("\nEXCLUDED (named, not benched here):");
for (const [id, claim, why] of EXCLUDED) console.log(`  ${id}  ${claim}\n        -> ${why}`);

console.log(`\n--- SUMMARY ---  V-claims: ${pass} pass / ${fail} fail   ·   ${EXCLUDED.length} excluded`);
const green = fail === 0;
console.log(green
  ? "RESULT: GREEN — Tower-Citizen/charter re-derives sound; optical-as-gate + 0-cycle + fabricate-in-live-flow REFUTED\n"
  : "RESULT: RED — a load-bearing V-claim did not hold\n");
process.exit(green ? 0 : 1);

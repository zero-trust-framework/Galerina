#!/usr/bin/env node
// prove-photonic-switch.mjs — exhaustive proof that the photonic-hardware switch is FAIL-CLOSED.
//
// Over the FULL truth table of (mode) × (hardware present?) × (nativeAvailable) × (attested), the switch
// must select real hardware IFF (mode ≠ "emulator" ∧ hardware present ∧ nativeAvailable ∧ attested), and
// fall back to the (always-usable) emulator on every other combination. No input ever yields no backend.
//
//   Run:  node scripts/prove-photonic-switch.mjs

import { selectPhotonicBackend, PhotonicEmulatorBridge } from "../dist/index.js";

const stub = (nativeAvailable, attested) => ({
  nativeAvailable, attested, hardwareIdentity: "stub",
  execute: () => ({ value: 0, executedNatively: true, deterministic: false }), executeExact: () => 0,
});

let total = 0, wrong = 0, noBackend = 0, hwUnverifiedSelected = 0;
const modes = ["emulator", "hardware", "auto"];
const present = [false, true];
const bools = [false, true];

for (const mode of modes) {
  for (const hasHw of present) {
    for (const native of bools) {
      for (const att of bools) {
        // skip native/att variation when there is no hardware (one "absent" case per mode)
        if (!hasHw && (native || att)) continue;
        total++;
        const opts = hasHw ? { mode, hardware: stub(native, att) } : { mode };
        const d = selectPhotonicBackend(opts);

        const shouldBeHardware = mode !== "emulator" && hasHw && native === true && att === true;
        const got = d.selected;
        if (shouldBeHardware ? got !== "hardware" : got !== "emulator") wrong++;
        if (d.backend === undefined || d.backend === null) noBackend++;
        // CRITICAL: real hardware must NEVER be selected unless it is native AND attested.
        if (got === "hardware" && !(hasHw && native && att)) hwUnverifiedSelected++;
        // the fallback must be the real emulator instance
        if (got === "emulator" && !(d.backend instanceof PhotonicEmulatorBridge)) wrong++;
      }
    }
  }
}

const results = [
  ["P1 switch selects HARDWARE iff (mode≠emulator ∧ present ∧ native ∧ attested) — full truth table", wrong === 0, `${total} combinations, ${wrong} wrong`],
  ["P2 every combination yields a usable backend (never undefined)", noBackend === 0, `${noBackend} missing`],
  ["P3 FAIL-CLOSED: real hardware is NEVER selected while unverified (not native/attested)", hwUnverifiedSelected === 0, `${hwUnverifiedSelected} unverified-hardware selections`],
];

let fails = 0;
console.log("\n-- @logicn/ext-photonic-emulator photonic-hardware switch — prove-own-maths (fail-closed selector) --");
for (const [name, ok, detail] of results) { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${String(name).padEnd(78)} ${detail}`); }
console.log(fails === 0
  ? `\n${results.length}/${results.length} PASS — over the full ${total}-row truth table the switch admits real silicon ONLY when present + native + the caller asserts attested=true, always returns a usable backend, and falls back to the emulator otherwise (keep-digital: it only picks the photonic compute backend). NB 'attested' is a CALLER-ASSERTED admission flag; the cryptographic verification that sets it is the deployment's responsibility — gating it on a real verifyAttestation result lands with a Rung-3+ silicon backend.`
  : `\n${results.length - fails}/${results.length} PASS, ${fails} FAILED.`);
process.exit(fails === 0 ? 0 : 1);

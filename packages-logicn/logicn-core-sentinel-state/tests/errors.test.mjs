import { test } from "node:test";
import assert from "node:assert/strict";
import { SecurityTrap, HardenedBorderViolation } from "../dist/index.js";

// The Governed Tower routes faults on `instanceof SecurityTrap` / `instanceof HardenedBorderViolation`.
// These assertions pin that routing CONTRACT: each class is an Error, the two are DISTINGUISHABLE,
// and instances carry their code/name and stay catchable as their own class — all have teeth
// (they fail if the class hierarchy is misdefined).
//
// Honest scope note: under this build's ES2022 target, `class X extends Error` already preserves the
// prototype chain, so the Object.setPrototypeOf guard in the constructors is belt-and-suspenders for
// DOWN-LEVEL / re-bundled (ES5/ES2015) consumers — a state a unit test on native classes cannot
// reproduce. It is kept for consistency with the egress/io sentinels; do not remove it.
test("sentinel error classes satisfy the Tower routing contract (Error chain + distinguishable + fields)", () => {
  const trap = new SecurityTrap("LSS-001", "trap");
  const border = new HardenedBorderViolation("LSS-002", "border");
  assert.ok(trap instanceof SecurityTrap);
  assert.ok(trap instanceof Error);
  assert.ok(border instanceof HardenedBorderViolation);
  assert.ok(border instanceof Error);
  // DISTINGUISHABLE — the routing-relevant property (a trap must not match the border class).
  assert.ok(!(trap instanceof HardenedBorderViolation), "SecurityTrap is not a HardenedBorderViolation");
  assert.ok(!(border instanceof SecurityTrap), "HardenedBorderViolation is not a SecurityTrap");
  assert.equal(trap.code, "LSS-001");
  assert.equal(trap.name, "SecurityTrap");
  assert.equal(border.name, "HardenedBorderViolation");
  let caught = null;
  try { throw trap; } catch (e) { caught = e; }
  assert.ok(caught instanceof SecurityTrap, "catchable as its own class (Tower routing contract)");
});

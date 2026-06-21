// admission-vocabulary-drift.test.mjs — B2: bind the fusion gate to the ONE
// canonical admission vocabulary.
//
// The fusion gate is deny-by-default by construction (a declared capability with
// no host-import factory refuses to fuse). This test additionally pins that every
// capability the built-in fusion registry exposes is on the SAME unified
// allow-list `logicn border-check` validates against — so the two admission gates
// can never silently diverge into two vocabularies again (the B2 failure mode).

import { test } from "node:test";
import assert from "node:assert/strict";

import { BUILTIN_CAPABILITY_NAMES } from "../dist/index.js";
import { isAdmissibleCapability } from "../../logicn-core-compiler/dist/capability-types.js";

test("every built-in fusion capability is on the unified admission allow-list", () => {
  assert.ok(BUILTIN_CAPABILITY_NAMES.length > 0, "the registry should expose at least one capability");
  for (const cap of BUILTIN_CAPABILITY_NAMES) {
    assert.ok(
      isAdmissibleCapability(cap),
      `fusion-registry capability ${cap} is NOT admissible under the canonical vocabulary — ` +
        `the two admission gates have drifted (add it to capability-types ADMISSION_* or rename it)`,
    );
  }
});

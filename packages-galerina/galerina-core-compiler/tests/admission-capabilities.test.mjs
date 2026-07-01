// admission-capabilities.test.mjs — B2: unified admission-border vocabulary.
//
// Locks the single, alias-aware capability allow-list that BOTH admission gates
// (`galerina border-check` and the fusion gate) deny against. The compiler ontology
// (KNOWN_CAPABILITIES, bit-wired to V_DPM) is canonical; border-check's coarse
// spellings alias onto it; host-I/O + border-only caps extend it. Guarantees:
// nothing is renamed, nothing is dropped, and unknown caps are refused.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KNOWN_CAPABILITIES,
  ADMISSION_CAPABILITIES,
  CAPABILITY_ALIASES,
  ADMISSION_EXTRA_CAPABILITIES,
  normalizeCapability,
  isAdmissibleCapability,
} from "../dist/capability-types.js";

// The exact set border-check historically allowed — the "drop nothing" contract.
const HISTORICAL_BORDER_CAPS = [
  "ai.inference", "network.outbound", "network.inbound", "audit.write", "audit.read",
  "db.read", "db.write", "storage.read", "storage.write", "time.read",
  "crypto.sign", "crypto.verify", "state.read", "state.write", "memory.alloc",
];

test("every canonical compiler capability (sans wildcard) is admissible", () => {
  for (const cap of KNOWN_CAPABILITIES) {
    if (cap.includes("*")) continue;
    assert.ok(isAdmissibleCapability(cap), `canonical capability ${cap} must be admissible`);
  }
});

test("no capability border-check historically allowed is dropped", () => {
  for (const cap of HISTORICAL_BORDER_CAPS) {
    assert.ok(isAdmissibleCapability(cap), `${cap} was admissible before B2 and must stay admissible`);
  }
});

test("aliases normalise onto canonical names", () => {
  assert.equal(normalizeCapability("db.read"), "database.read");
  assert.equal(normalizeCapability("db.write"), "database.write");
  assert.equal(normalizeCapability("storage.write"), "storage.write");
  assert.equal(normalizeCapability("storage.read"), "storage.read");
  assert.equal(normalizeCapability("time.read"), "clock.read");
  // A canonical name normalises to itself.
  assert.equal(normalizeCapability("ai.inference"), "ai.inference");
  assert.equal(normalizeCapability("shell.execute"), "shell.execute");
});

test("every alias TARGET is on the unified allow-list; alias KEYS are not stored directly", () => {
  for (const [key, target] of Object.entries(CAPABILITY_ALIASES)) {
    assert.ok(ADMISSION_CAPABILITIES.has(target), `alias target ${target} must be admissible`);
    // The coarse spelling is admitted via normalisation, not by being a member —
    // so the allow-list stays canonical.
    assert.ok(!ADMISSION_CAPABILITIES.has(key), `alias key ${key} should not be a direct member`);
    assert.ok(isAdmissibleCapability(key), `alias key ${key} must still be admissible (via normalisation)`);
  }
});

test("host-I/O + border-only extras are admissible", () => {
  for (const cap of ADMISSION_EXTRA_CAPABILITIES) {
    assert.ok(isAdmissibleCapability(cap), `extra capability ${cap} must be admissible`);
  }
  // The fusion-host shims the kernel actually exposes.
  for (const cap of ["clock.read", "log.write", "network.inbound", "network.outbound"]) {
    assert.ok(isAdmissibleCapability(cap), `fusion-host capability ${cap} must be admissible`);
  }
});

test("unknown capabilities and wildcard roots are refused (deny-by-default)", () => {
  for (const bad of ["evil.root", "network.*", "storage.*", "database.*", "", "ai.inferenceX", "DB.READ"]) {
    assert.ok(!isAdmissibleCapability(bad), `${JSON.stringify(bad)} must NOT be admissible`);
  }
});

test("a non-string capability is not admissible (no throw)", () => {
  for (const junk of [null, undefined, 42, {}, []]) {
    // normalizeCapability/isAdmissibleCapability must tolerate junk and refuse it.
    assert.doesNotThrow(() => isAdmissibleCapability(junk));
    assert.ok(!isAdmissibleCapability(junk), `${JSON.stringify(junk)} must not be admissible`);
  }
});

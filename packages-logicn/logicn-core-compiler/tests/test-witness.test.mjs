// TestWitness (RD-0128, note 67) — a deterministic, signable receipt binding a wasm artifact to its
// governance leak proof + contract-test-suite digest. These tests pin the ZT-critical properties:
// the vouch predicate is DENY-BY-DEFAULT (a leak / tampered / wrong-artifact witness never vouches),
// the canonical pre-image is deterministic + tamper-evident (so the out-of-band signature catches edits),
// and the suite digest is order-independent but change-sensitive.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTestWitness, testSuiteDigest, canonicalTestWitness, testWitnessDigest, witnessVouchesClean,
} from "../dist/index.js";

const WASM = "a".repeat(64);            // a stand-in wasm sha256 hex
const OTHER = "b".repeat(64);

const cleanProof = { schema: "lln.leakproof.v1", verdict: "clean", leaks: [], summary: { total: 0, denies: 0, byCategory: {} } };
const denyFinding = {
  code: "LLN-SECRET-002", category: "secret-egress", severity: "deny", capability: "secret.read",
  site: { file: "a.lln", line: 1, column: 1 }, related: [], why: "raw secret reaches a network sink",
  risk: "credential exfiltration", fix: { kind: "redact", suggestedCode: "seal(x)", explanation: "seal before egress" },
};
const leakProof = { schema: "lln.leakproof.v1", verdict: "leak", leaks: [denyFinding], summary: { total: 1, denies: 1, byCategory: { "secret-egress": 1 } } };
// Tampered: the verdict LIES (says clean) while the summary/leaks still carry a deny.
const tamperedClean = { schema: "lln.leakproof.v1", verdict: "clean", leaks: [denyFinding], summary: { total: 1, denies: 1, byCategory: { "secret-egress": 1 } } };
const emptySuite = { faultInjection: [], effectEgress: [], capabilityDenial: [], boundary: [], substrateViolation: [] };

test("a CLEAN witness for the matching artifact vouches", () => {
  const w = buildTestWitness(WASM, cleanProof, emptySuite);
  assert.equal(w.schema, "lln.testwitness.v1");
  assert.equal(w.wasmSha256, WASM);
  assert.equal(witnessVouchesClean(w, WASM), true);
});

test("FAIL-CLOSED: a witness bound to a DIFFERENT artifact does not vouch", () => {
  const w = buildTestWitness(WASM, cleanProof, emptySuite);
  assert.equal(witnessVouchesClean(w, OTHER), false);   // receipt must bind to THIS wasm
  assert.equal(witnessVouchesClean(w, ""), false);      // empty expected id never vouches
});

test("FAIL-CLOSED: a known-LEAKING module never vouches", () => {
  const w = buildTestWitness(WASM, leakProof, emptySuite);
  assert.equal(witnessVouchesClean(w, WASM), false);
});

test("FAIL-CLOSED: a TAMPERED witness (verdict says clean, summary/leaks show a deny) does not vouch", () => {
  const w = buildTestWitness(WASM, tamperedClean, emptySuite);
  assert.equal(witnessVouchesClean(w, WASM), false);    // verdict/summary + verdict/leaks inconsistency = tamper
});

test("FAIL-CLOSED: a malformed / empty leak proof does not silently verify as clean", () => {
  const badSchema = buildTestWitness(WASM, { ...cleanProof, schema: "x" }, emptySuite);
  assert.equal(witnessVouchesClean(badSchema, WASM), false);
  const noProof = { schema: "lln.testwitness.v1", wasmSha256: WASM, suiteDigest: "d", leakProof: undefined };
  assert.equal(witnessVouchesClean(noProof, WASM), false);
  const emptyObj = { schema: "lln.testwitness.v1", wasmSha256: WASM, suiteDigest: "", leakProof: cleanProof };
  assert.equal(witnessVouchesClean(emptyObj, WASM), false); // empty suite digest = not a real receipt
});

test("FAIL-CLOSED (RD-0129): an UNKNOWN severity / summary-leaks denies mismatch does not vouch", () => {
  // A finding with a severity outside {deny,warn} must fail closed (not be treated as non-deny by omission).
  const unknownSev = { ...denyFinding, severity: "info" };
  const wUnknown = buildTestWitness(WASM, { schema: "lln.leakproof.v1", verdict: "clean", leaks: [unknownSev], summary: { total: 1, denies: 0, byCategory: {} } }, emptySuite);
  assert.equal(witnessVouchesClean(wUnknown, WASM), false);
  // summary.denies disagreeing with the leaks array (forged summary) must fail closed even if verdict=clean.
  const wMismatch = buildTestWitness(WASM, { schema: "lln.leakproof.v1", verdict: "clean", leaks: [{ ...denyFinding, severity: "warn" }], summary: { total: 1, denies: 0, byCategory: {} } }, emptySuite);
  // (denies recomputed from leaks = 0, summary.denies = 0 → agree → still vouches; this one is genuinely clean)
  assert.equal(witnessVouchesClean(wMismatch, WASM), true);
  const wForged = buildTestWitness(WASM, { schema: "lln.leakproof.v1", verdict: "clean", leaks: [], summary: { total: 0, denies: 1, byCategory: {} } }, emptySuite);
  assert.equal(witnessVouchesClean(wForged, WASM), false); // summary claims a deny the leaks array does not have
});

test("canonical pre-image is DETERMINISTIC and TAMPER-EVIDENT", () => {
  const w = buildTestWitness(WASM, cleanProof, emptySuite);
  assert.equal(canonicalTestWitness(w), canonicalTestWitness(buildTestWitness(WASM, cleanProof, emptySuite)));
  const d0 = testWitnessDigest(w);
  // Any field edit must change the signing pre-image digest (so the out-of-band signature catches it).
  assert.notEqual(testWitnessDigest({ ...w, wasmSha256: OTHER }), d0);
  assert.notEqual(testWitnessDigest({ ...w, suiteDigest: "tampered" }), d0);
  assert.notEqual(testWitnessDigest({ ...w, leakProof: leakProof }), d0);
});

test("suite digest is ORDER-INDEPENDENT but CHANGE-SENSITIVE", () => {
  const a = { id: "f::boundary::p0::min", flow: "f", paramIndex: 0, paramType: "Int", value: "0", assertion: "x=0 returns Ok" };
  const b = { id: "f::boundary::p0::max", flow: "f", paramIndex: 0, paramType: "Int", value: "99", assertion: "x=99 returns Ok" };
  const s1 = { ...emptySuite, boundary: [a, b] };
  const s2 = { ...emptySuite, boundary: [b, a] };                         // reordered
  assert.equal(testSuiteDigest(s1), testSuiteDigest(s2));                 // set semantics, not emit order
  const s3 = { ...emptySuite, boundary: [a, { ...b, assertion: "x=99 traps" }] }; // changed obligation
  assert.notEqual(testSuiteDigest(s1), testSuiteDigest(s3));
  const s4 = { ...emptySuite, boundary: [a] };                           // removed obligation
  assert.notEqual(testSuiteDigest(s1), testSuiteDigest(s4));
});

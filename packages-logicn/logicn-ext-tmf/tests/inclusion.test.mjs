// inclusion.test.mjs — TMX-256 inclusion (Merkle) proofs vs the published golden root (spec §5).
// Verifies proveInclusion/reconstructRoot/verifyInclusion are byte-consistent with tmx256.tmxRoot, the
// fail-closed negatives, the wire round-trip, and a deeper (path_len=2) tree.
import assert from "node:assert/strict";
import test from "node:test";
import {
  ABSENT, leafHash, tmxRoot,
  proveInclusion, reconstructRoot, verifyInclusion, verifyLeafData, serializeProof, deserializeProof,
} from "../dist/index.js";

const enc = new TextEncoder();
const hex = (u) => Buffer.from(u).toString("hex");
const le16 = (x) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, x & 0xffff, true); return b; };
const le32 = (x) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, x >>> 0, true); return b; };
const le64 = (x) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(x), true); return b; };
const cat = (...ps) => { const t = ps.reduce((n, p) => n + p.length, 0); const o = new Uint8Array(t); let k = 0; for (const p of ps) { o.set(p, k); k += p.length; } return o; };
const MAGIC = Uint8Array.from([0x89, 0x54, 0x4d, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
const headerCore = (count) => cat(MAGIC, le16(0), le16(0), le16(0), le16(0), le64(count)); // [0..24)
const coord = (x, y, t) => cat(le32(x), le32(y), le32(t));

const leaf0 = leafHash(1, 0, coord(3, 5, 7), enc.encode("hello"));
const leaf1 = leafHash(1, 2, coord(3, 5, 8), enc.encode("world!"));
const GOLDEN_ROOT = "43386e644c7b53aa0900cda21c15acd15f30b3fdf997950e39e7dd3dbc685212";
const hc2 = headerCore(2);
const root2 = tmxRoot(hc2, [leaf0, leaf1]);

test("golden: section-0 proof reconstructs the published root 43386e64…", () => {
  const p = proveInclusion(hc2, [leaf0, leaf1], 0);
  assert.equal(p.path.length, 1);
  assert.equal(p.path[0].pos, 0);
  assert.equal(hex(p.path[0].sibA), hex(leaf1));   // sibling = leaf1
  assert.equal(hex(p.path[0].sibB), hex(ABSENT));  // padded slot = ABSENT
  assert.equal(hex(reconstructRoot(p)), GOLDEN_ROOT);
  assert.equal(verifyInclusion(p, root2), true);
});

test("golden: section-1 proof reconstructs the published root", () => {
  const p = proveInclusion(hc2, [leaf0, leaf1], 1);
  assert.equal(p.path[0].pos, 1);
  assert.equal(hex(p.path[0].sibA), hex(leaf0));
  assert.equal(hex(p.path[0].sibB), hex(ABSENT));
  assert.equal(hex(reconstructRoot(p)), GOLDEN_ROOT);
  assert.equal(verifyInclusion(p, root2), true);
});

test("cross-consistency: a proof for every section reconstructs exactly tmxRoot", () => {
  for (let i = 0; i < 2; i++) {
    assert.equal(hex(reconstructRoot(proveInclusion(hc2, [leaf0, leaf1], i))), hex(root2));
  }
});

test("verifyLeafData ties the proof's leaf_hash to the section data", () => {
  const p = proveInclusion(hc2, [leaf0, leaf1], 0);
  assert.equal(verifyLeafData(p, 1, 0, coord(3, 5, 7), enc.encode("hello")), true);
  assert.equal(verifyLeafData(p, 1, 0, coord(3, 5, 7), enc.encode("HELLO")), false); // wrong payload
});

test("deeper tree (5 leaves, path_len=2) reconstructs tmxRoot for an interior leaf", () => {
  const leaves = [];
  for (let i = 0; i < 5; i++) leaves.push(leafHash(1, 0, coord(i, i, i), enc.encode("s" + i)));
  const hc = headerCore(5);
  const root = tmxRoot(hc, leaves);
  for (let i = 0; i < 5; i++) {
    const p = proveInclusion(hc, leaves, i);
    assert.equal(p.path.length, 2, `leaf ${i} path_len`);
    assert.equal(verifyInclusion(p, root), true, `leaf ${i} verifies`);
  }
});

test("NEGATIVE — tampered sibling fails closed", () => {
  const p = proveInclusion(hc2, [leaf0, leaf1], 0);
  const bad = { ...p, path: [{ ...p.path[0], sibA: (() => { const s = p.path[0].sibA.slice(); s[0] ^= 0x01; return s; })() }] };
  assert.equal(verifyInclusion(bad, root2), false);
});

test("NEGATIVE — wrong leaf (leaf1 via leaf0's path) fails closed", () => {
  const p0 = proveInclusion(hc2, [leaf0, leaf1], 0);
  const wrong = { ...p0, leafHash: leaf1.slice() }; // swap the leaf, keep leaf0's path
  assert.notEqual(hex(reconstructRoot(wrong)), GOLDEN_ROOT);
  assert.equal(verifyInclusion(wrong, root2), false);
});

test("NEGATIVE — wrong/empty trusted root fails closed", () => {
  const p = proveInclusion(hc2, [leaf0, leaf1], 0);
  assert.equal(verifyInclusion(p, new Uint8Array(32)), false);   // zero root
  assert.equal(verifyInclusion(p, new Uint8Array(0)), false);    // wrong length
});

test("wire round-trip: serialize→deserialize is 133 bytes and verifies", () => {
  const p = proveInclusion(hc2, [leaf0, leaf1], 0);
  const bytes = serializeProof(p);
  assert.equal(bytes.length, 68 + 65 * 1); // 133
  const p2 = deserializeProof(bytes);
  assert.equal(hex(reconstructRoot(p2)), GOLDEN_ROOT);
  assert.equal(verifyInclusion(p2, root2), true);
});

test("deserialize fail-closed on a truncated / inconsistent buffer", () => {
  assert.throws(() => deserializeProof(new Uint8Array(40)));            // < 68
  const p = serializeProof(proveInclusion(hc2, [leaf0, leaf1], 0));
  assert.throws(() => deserializeProof(p.slice(0, p.length - 1)));      // path_len says 133, got 132
});

test("reconstructRoot returns null on a malformed proof (fail-closed)", () => {
  const p = proveInclusion(hc2, [leaf0, leaf1], 0);
  assert.equal(reconstructRoot({ ...p, version: 9 }), null);
  assert.equal(reconstructRoot({ ...p, leafHash: new Uint8Array(31) }), null);
});

test("prover input validation (fail-closed)", () => {
  assert.throws(() => proveInclusion(hc2, [], 0));                       // no leaves
  assert.throws(() => proveInclusion(hc2, [leaf0, leaf1], 2));           // index out of range
  assert.throws(() => proveInclusion(new Uint8Array(23), [leaf0], 0));   // bad header_core length
});

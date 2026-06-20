// pool.test.mjs — StaticMemoryPool: alignment, accounting, exhaustion, free, flight-lock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { StaticMemoryPool, ALIGN_BYTES, SecurityTrap } from "../dist/index.js";
import { caught } from "./_helpers.mjs";

const mkPool = () =>
  new StaticMemoryPool({ totalBytes: 256, blockBytes: 16, computeRatio: 0.5 });

test("allocate returns a 16-aligned ptr", () => {
  const pool = mkPool();
  const b = pool.allocate(10);
  assert.equal(b.ptr % ALIGN_BYTES, 0);
  assert.equal(b.segment, "compute");
  assert.equal(b.bytes, 16); // 10 bytes rounds up to one 16-byte block
});

test("usedBytes / freeBytes accounting tracks live blocks", () => {
  const pool = mkPool();
  assert.equal(pool.capacityBytes, 256);
  assert.equal(pool.usedBytes, 0);
  assert.equal(pool.freeBytes, 256);
  const a = pool.allocate(16);
  const c = pool.allocate(32); // 2 blocks
  assert.equal(pool.usedBytes, 16 + 32);
  assert.equal(pool.freeBytes, 256 - 48);
  pool.free(a.ptr);
  assert.equal(pool.usedBytes, 32);
  pool.free(c.ptr);
  assert.equal(pool.usedBytes, 0);
});

test("allocate beyond capacity throws LSM-POOL-EXHAUSTED", () => {
  // compute region is 8 blocks (128 bytes). Ask for 9 blocks.
  const pool = mkPool();
  const err = caught(() => pool.allocate(16 * 9));
  assert.ok(err instanceof SecurityTrap);
  assert.equal(err.code, "LSM-POOL-EXHAUSTED");
});

test("free returns blocks to the segment (re-allocatable)", () => {
  const pool = new StaticMemoryPool({ totalBytes: 64, blockBytes: 16, computeRatio: 1 });
  const a = pool.allocate(64); // all 4 blocks
  assert.equal(caught(() => pool.allocate(16)).code, "LSM-POOL-EXHAUSTED");
  pool.free(a.ptr);
  const b = pool.allocate(16); // now succeeds
  assert.equal(b.bytes, 16);
});

test("free on an unknown ptr throws LSM-FREE-001", () => {
  const pool = mkPool();
  const err = caught(() => pool.free(9999));
  assert.ok(err instanceof SecurityTrap);
  assert.equal(err.code, "LSM-FREE-001");
});

test("allocate after lockFlight throws LSM-FLIGHT-LOCKED; free still allowed", () => {
  const pool = mkPool();
  const a = pool.allocate(16);
  assert.equal(pool.isFlightLocked(), false);
  pool.lockFlight();
  assert.equal(pool.isFlightLocked(), true);
  const err = caught(() => pool.allocate(16));
  assert.ok(err instanceof SecurityTrap);
  assert.equal(err.code, "LSM-FLIGHT-LOCKED");
  // free during flight is permitted (deterministic teardown).
  pool.free(a.ptr);
});

test("i32 / u8 views are zero-copy over the backing buffer", () => {
  const pool = mkPool();
  const b = pool.allocate(16);
  const i = pool.i32(b);
  i[0] = 0x11223344;
  const u = pool.u8(b);
  // little-endian: low byte first
  assert.equal(u[0], 0x44);
  assert.equal(i.length, 4);
});

test("config validation: blockBytes not multiple of 16 throws LSM-CFG-001", () => {
  const err = caught(() => new StaticMemoryPool({ totalBytes: 100, blockBytes: 10 }));
  assert.ok(err instanceof SecurityTrap);
  assert.equal(err.code, "LSM-CFG-001");
});

test("config validation: totalBytes not multiple of blockBytes throws LSM-CFG-002", () => {
  const err = caught(() => new StaticMemoryPool({ totalBytes: 100, blockBytes: 16 }));
  assert.ok(err instanceof SecurityTrap);
  assert.equal(err.code, "LSM-CFG-002");
});

test("shared:true reserves a SharedArrayBuffer; never grows", () => {
  const pool = new StaticMemoryPool({ totalBytes: 64, blockBytes: 16, shared: true });
  assert.ok(pool.buffer instanceof SharedArrayBuffer);
  assert.equal(pool.buffer.byteLength, 64);
});

// 0033 use-after-free guard (generation tag) — a stale Block must TRAP, not silently alias reused memory.
test("use-after-free: accessing a freed Block traps LSM-UAF-001 (still-free case)", () => {
  const pool = mkPool();
  const b = pool.allocate(16);
  pool.i32(b); // live access works
  pool.free(b.ptr);
  assert.equal(caught(() => pool.i32(b)).code, "LSM-UAF-001", "i32() on a freed Block must trap");
  assert.equal(caught(() => pool.u8(b)).code, "LSM-UAF-001", "u8() on a freed Block must trap");
});

test("use-after-free: a stale Block after free+REALLOC traps LSM-UAF-001 (ABA / generation mismatch)", () => {
  const pool = mkPool();
  const stale = pool.allocate(16);
  pool.free(stale.ptr);
  const fresh = pool.allocate(16);            // reuses the same ptr, new generation
  assert.equal(fresh.ptr, stale.ptr, "precondition: realloc reused the same ptr");
  assert.ok(fresh.generation > stale.generation, "fresh allocation bumped the generation");
  pool.i32(fresh); // the fresh handle works
  assert.equal(caught(() => pool.i32(stale)).code, "LSM-UAF-001", "the STALE handle must trap, not alias the new owner");
});

// 0033 REJECT-fill on free — a recycled slot must NOT leak the prior tenant's value. After free, every
// i32 slot reads back as -1 (TritState.REJECT) so a K3 gate over governance memory collapses to DENY
// (fail-closed by construction) instead of reading a stale COMMIT/ALLOW (the prior fail-OPEN behaviour).
test("free scrubs the block to REJECT(-1): a recycled slot never exposes the prior tenant's COMMIT", () => {
  const pool = new StaticMemoryPool({ totalBytes: 64, blockBytes: 16, computeRatio: 1 });
  const a = pool.allocate(16);
  pool.i32(a).fill(0x5ec0ffee); // prior tenant writes a "COMMIT"-like value into every slot
  assert.equal(pool.i32(a)[0], 0x5ec0ffee, "precondition: the tenant value is present while live");
  pool.free(a.ptr);             // REJECT-fill on free scrubs the bytes to 0xFF
  const b = pool.allocate(16);  // reuses the same slot, fresh generation
  assert.equal(b.ptr, a.ptr, "precondition: realloc reused the same slot");
  const ib = pool.i32(b);       // legitimately-live fresh handle reads the recycled bytes
  for (let k = 0; k < ib.length; k++) {
    assert.equal(ib[k], -1, `recycled i32 slot ${k} must read REJECT(-1), not the prior tenant's COMMIT`);
  }
  const ub = pool.u8(b);
  for (let k = 0; k < ub.length; k++) assert.equal(ub[k], 0xff, `recycled byte ${k} must be scrubbed to 0xFF`);
});

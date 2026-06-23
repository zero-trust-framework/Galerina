import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BitNetCpuBridge,
  BitNetGpuBridge,
  detectCpu,
  detectGpu,
  loadNativeAddon,
  selectTernaryBridge,
} from "../dist/index.js";
import { GovernanceEnforcer } from "@logicn/tower-citizen";

// Pack a trit array into BitNet-faithful i32 words (same layout the simulator decodes).
function packTrits(trits) {
  const words = new Int32Array(Math.ceil(trits.length / 16));
  for (let i = 0; i < trits.length; i++) {
    const enc = trits[i] === -1 ? 0 : trits[i] === 0 ? 1 : 2;
    const wordIdx = (i / 16) | 0;
    const local = i % 16;
    const byteIdx = (local / 4) | 0;
    const posInByte = local % 4;
    const shift = byteIdx * 8 + (3 - posInByte) * 2;
    words[wordIdx] = (words[wordIdx] & ~(0x03 << shift)) | (enc << shift);
  }
  return words;
}

function tmacOp(trits, acts, scale = 1) {
  return {
    opClass: "feedforward", precision: "ternary", correlationId: `T-${Date.now()}-${Math.random()}`,
    weights: packTrits(trits), activations: Int32Array.from(acts), count: trits.length, scale,
  };
}

// ── CPU detection (real) ──────────────────────────────────────────────────────

test("detectCpu reports arch, cores, and a BitNet kernel family", () => {
  const cpu = detectCpu();
  assert.ok(cpu.cores > 0);
  assert.ok(["tl1", "tl2", "scalar"].includes(cpu.kernelFamily));
  // x64 → tl2, arm64 → tl1
  if (cpu.arch === "x64") assert.equal(cpu.kernelFamily, "tl2");
  if (cpu.arch === "arm64") assert.equal(cpu.kernelFamily, "tl1");
});

// ── GPU detection (real — this PC has an NVIDIA RTX 2060) ─────────────────────

test("detectGpu probes the machine (real nvidia-smi)", () => {
  const gpu = detectGpu();
  // We don't assert availability=true (CI machines may lack a GPU), but the
  // shape must be correct and cudaKernelReady must be false (kernel not compiled).
  assert.equal(typeof gpu.available, "boolean");
  assert.equal(gpu.cudaKernelReady, false);
  if (gpu.available) {
    assert.ok(typeof gpu.name === "string" && gpu.name.length > 0);
    // eslint-disable-next-line no-console
    console.log(`    detected GPU: ${gpu.name} (${gpu.memoryMiB} MiB, driver ${gpu.driver})`);
  }
});

// ── CPU bridge — first real implements InferenceBridge ────────────────────────

test("CPU bridge implements the InferenceBridge contract", () => {
  const b = new BitNetCpuBridge();
  assert.equal(b.bridgeId, "bitnet-cpu");
  assert.equal(b.technique, "ternary");
  assert.equal(typeof b.nativeAvailable, "boolean");
  assert.equal(typeof b.initialize, "function");
  assert.equal(typeof b.execute, "function");
});

test("CPU bridge computes a faithful ternary T-MAC (simulator fallback)", () => {
  const b = new BitNetCpuBridge();
  b.initialize();
  // weights [+1,-1,0,+1] · acts [10,20,30,40] = 10 -20 +0 +40 = 30
  const r = b.execute(tmacOp([1, -1, 0, 1], [10, 20, 30, 40]));
  assert.equal(r.value, 30);
  assert.equal(r.deterministic, true);
});

test("CPU bridge reports nativeAvailable=false on a clean checkout (no addon)", () => {
  const b = new BitNetCpuBridge();
  const load = loadNativeAddon();
  // No compiled addon present → both report absence, results come from simulator.
  assert.equal(load.loaded, false);
  assert.equal(b.nativeAvailable, false);
  const r = b.execute(tmacOp([1, 1, 1], [2, 2, 2]));
  assert.equal(r.executedNatively, false);
  assert.equal(r.value, 6);
});

test("CPU bridge applies the per-tensor scale", () => {
  const b = new BitNetCpuBridge();
  const r = b.execute(tmacOp([1, 1, 1], [5, 5, 5], 2)); // sum 15 × 2 = 30
  assert.equal(r.value, 30);
});

test("CPU bridge canCommit() consults the GovernanceEnforcer", () => {
  const b = new BitNetCpuBridge();
  assert.equal(typeof b.canCommit(), "boolean");
});

// ── GPU bridge — detection + CUDA seam ────────────────────────────────────────

test("GPU bridge implements InferenceBridge and detects hardware honestly", () => {
  const b = new BitNetGpuBridge();
  assert.equal(b.bridgeId, "bitnet-gpu");
  assert.equal(b.technique, "ternary");
  // nativeAvailable is true ONLY if GPU present AND CUDA kernel built.
  // Kernel is not built → must be false even with a GPU present.
  assert.equal(b.nativeAvailable, false);
});

test("GPU bridge still produces correct deterministic results via simulator", () => {
  const b = new BitNetGpuBridge();
  const r = b.execute(tmacOp([1, -1, 1], [4, 4, 4])); // 4 -4 +4 = 4
  assert.equal(r.value, 4);
  assert.equal(r.deterministic, true);
  assert.equal(r.executedNatively, false); // CUDA kernel pending
});

// ── Self-registration ─────────────────────────────────────────────────────────

test("selectTernaryBridge returns a working bridge for this machine", () => {
  const b = selectTernaryBridge();
  // No CUDA kernel built → CPU bridge selected.
  assert.equal(b.bridgeId, "bitnet-cpu");
  const r = b.execute(tmacOp([1, 1], [3, 4])); // 3 + 4 = 7
  assert.equal(r.value, 7);
});

// ── Standard 2 governance gate on the NATIVE branch — fail-closed (security fix 2026-06-23) ──
// execute() now calls canCommit() BEFORE the native addon. Previously the native branch skipped
// the gate (governance bypass). A mock addon is injected to exercise the native path in CI (no
// real .node is built here). canCommit() ORs 0->1 and -1->0, so the deny policy restricts BOTH.

test("CPU bridge: governance denial blocks the native addon call (fail-closed)", () => {
  let tmacCalls = 0;
  const mockAddon = {
    init() {}, free() {}, setThreads() {},
    tmac() { tmacCalls++; return 999; }, // a wrong value if ever (incorrectly) reached
  };
  const denyAll = {
    version: "test-deny-all",
    defaultAction: -1,
    restrictedTransitions: [
      { from: 0, to: 1, requires: ["audit_signature"] },
      { from: -1, to: 0, requires: ["audit_signature"] },
    ],
  };
  const b = new BitNetCpuBridge(undefined, new GovernanceEnforcer(denyAll));
  b.native = mockAddon;  // inject native to reach the native branch
  b.initialized = false; // force re-init through the injected addon
  assert.equal(b.canCommit(), false);
  assert.throws(
    () => b.execute(tmacOp([1, -1, 0, 1], [10, 20, 30, 40])),
    /CITIZEN_STANDARD_VIOLATION/,
  );
  assert.equal(tmacCalls, 0, "native tmac MUST NOT run when governance denies the commit");
});

test("CPU bridge: authorized governance allows the native addon call (no behaviour change)", () => {
  let tmacCalls = 0;
  const mockAddon = {
    init() {}, free() {}, setThreads() {},
    tmac() { tmacCalls++; return 30; }, // matches the simulator reference: 1·10 −1·20 +0·30 +1·40 = 30
  };
  const b = new BitNetCpuBridge(); // default policy → canCommit() true
  b.native = mockAddon;
  b.initialized = false;
  const r = b.execute(tmacOp([1, -1, 0, 1], [10, 20, 30, 40]));
  assert.equal(tmacCalls, 1);
  assert.equal(r.executedNatively, true);
  assert.equal(r.value, 30);
});

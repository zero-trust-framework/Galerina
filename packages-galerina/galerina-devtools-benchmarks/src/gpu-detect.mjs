/**
 * GPU detection + compute-toolchain probing for the benchmark harness.
 *
 * Reports what GPU hardware is present AND whether any runtime can actually
 * execute compute on it. The benchmark uses this to decide which GPU cells
 * are runnable vs "toolchain required".
 *
 * Honest by design: presence of a GPU does NOT mean compute is available.
 * A driver + nvidia-smi only proves the card exists, not that we can run kernels.
 */
import { execFileSync } from "node:child_process";

function tryExec(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      timeout: 8000,
      shell: process.platform === "win32", // needed on Windows for PATH-resolved commands
    });
  } catch {
    return null;
  }
}

/** Detect the GPU device via nvidia-smi (NVIDIA only for now). */
export function detectGpuDevice() {
  const out = tryExec("nvidia-smi", ["--query-gpu=name,driver_version,memory.total", "--format=csv,noheader"]);
  if (!out) return { present: false };
  const [name, driver, memory] = out.trim().split("\n")[0].split(",").map(s => s.trim());
  return { present: true, vendor: "nvidia", name, driver, memory };
}

/** Probe which compute toolchains can actually run a GPU kernel. */
export function detectComputeToolchains() {
  const cuda     = tryExec("nvcc", ["--version"]) !== null;
  const cargo    = tryExec("cargo", ["--version"]) !== null;   // wgpu (Vulkan/D3D12) feasible
  const deno     = tryExec("deno", ["--version"]) !== null;    // built-in WebGPU
  // torch CUDA availability
  let torchCuda = false;
  const torchOut = tryExec("python", ["-c", "import torch;print(torch.cuda.is_available())"]);
  if (torchOut) torchCuda = torchOut.trim() === "True";

  return {
    cuda,                                  // nvcc present → native CUDA kernels
    rustWgpu: cargo,                       // cargo present → wgpu compute possible (needs build)
    denoWebGpu: deno,                      // deno present → WebGPU compute possible
    pythonTorchCuda: torchCuda,            // torch built with CUDA
    // The honest summary: can ANY runtime run GPU compute right now?
    anyRunnable: cuda || torchCuda || deno,
  };
}

/** Full GPU capability report for the benchmark header. */
export function gpuReport() {
  const device = detectGpuDevice();
  const toolchains = detectComputeToolchains();
  return {
    device,
    toolchains,
    // Galerina GPU backend is a known stub regardless of hardware
    galerinaGpuStatus: "not-implemented",     // gpu-plan.ts is a lowering plan only (Phase 38)
    summary: !device.present
      ? "No GPU detected."
      : toolchains.anyRunnable
        ? `${device.name} — GPU compute available.`
        : `${device.name} present, but NO compute toolchain installed (CUDA/torch-cuda/Deno all absent). GPU cells = 'toolchain required'.`,
  };
}

// CLI usage: node src/gpu-detect.mjs
import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(JSON.stringify(gpuReport(), null, 2));
}

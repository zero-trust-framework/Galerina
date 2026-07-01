# Galerina Compute

`galerina-core-compute` is the governed compute planning package for Galerina.

It belongs in:

```text
/packages-galerina/galerina-core-compute
```

The package defines planning contracts for:

```text
CPU targets
GPU targets
WASM targets
AI accelerator planning
optical I/O planning
photonic planning
compatibility reports
compute workload analysis
fallback planning
runtime target estimation
```

It is governance-first and hardware-neutral.

Galerina source code declares intent.

The compute layer recommends safe targets.

Runtime and deployment policy decide execution.

---

# Public v0.2 Contracts

```text
ComputeWorkload
DataShape
GpuSuitability
GpuPlan
OpticalNeed
OpticalPlan
PhotonicPlan
WasmTarget
DEFAULT_WASM_FORBIDDEN_EFFECTS
BROWSER_WASM_FORBIDDEN_EFFECTS
CompatibilityLevel
CompatibilityBlocker
CompatibilityWarning
CompatibilityResult
TargetProfile
CompatibilityReport
ComputePlan
estimateTarget
```

---

# Package Boundary

`galerina-core-compute` owns:

```text
ComputeWorkload
DataShape
GpuSuitability
GpuPlan
OpticalNeed
OpticalPlan
PhotonicPlan
WasmTarget
TargetProfile
CompatibilityBlocker
CompatibilityWarning
CompatibilityResult
CompatibilityReport
ComputePlan
estimateTarget
```

It does NOT own:

```text
GPU kernels
CUDA/ROCm/Metal source
WASM code generation
AI model formats
runtime driver bindings
vendor SDK integration
photonic device drivers
```

Vendor-specific logic belongs in adapters and runtime backends.

Correct:

```text
target gpu
target photonic
target wasm
```

Incorrect:

```text
target cuda
target nvidia
target metal
```

---

# Shared Types

## DataShape

```ts
export interface DataShape {
  rank: number
  dimensions: number[]
  elementType: string
  byteSize: number
  sensitive: boolean
  streamable: boolean
}
```

---

## ComputeWorkload

```ts
export interface ComputeWorkload {
  id: string

  kind:
    | "scalar"
    | "vector"
    | "matrix"
    | "tensor"
    | "image"
    | "ai_inference"
    | "batch"
    | "stream"
    | "route"

  dataShape: DataShape

  operationCount: number
  memoryMb: number
  deterministic: boolean

  effects: string[]
  requiredCapabilities: string[]

  preferredTargets: RuntimeTarget[]
  fallbackTargets: RuntimeTarget[]
}
```

---

# Runtime Targets

```ts
export type RuntimeTarget =
  | "cpu"
  | "server"
  | "edge"
  | "browser"
  | "worker"
  | "wasm"
  | "gpu"
  | "ai_accelerator"
  | "optical_io"
  | "photonic"
```

---

# GPU Planning

## GpuSuitability

```ts
export interface GpuSuitability {
  suitable: boolean
  score: number
  reasons: string[]
  blockers: string[]
  warnings: string[]
  cpuFallbackAvailable: boolean
}
```

---

## GpuPlan v0.2

```ts
export interface GpuPlan {
  target: "gpu"

  workloadId: string

  suitability: GpuSuitability

  precision: string

  transferBytes: number

  estimatedVramMb: number

  requiredCapabilities: string[]

  fallbackTargets: RuntimeTarget[]

  explanation: string[]
}
```

GPU planning is suitability-based.

The planner must consider:

```text
parallelism
transfer cost
VRAM limits
sensitive data policy
determinism requirements
fallback availability
```

---

# Optical and Photonic Planning

Galerina distinguishes:

```text
optical_io -> interconnect/data movement planning
photonic   -> future photonic compute planning
```

Photonic planning is planning-only until a real runtime backend exists.

---

## OpticalNeed

```ts
export interface OpticalNeed {
  required: boolean
  reasons: string[]
  transferBytes: number
  fallbackAvailable: boolean
}
```

---

## OpticalPlan

```ts
export interface OpticalPlan {
  target: "optical_io"

  workloadId: string

  need: OpticalNeed

  topology:
    | "single_node"
    | "multi_device"
    | "rack_scale"
    | "cluster"
    | "unknown"

  transportProfile?: string

  fallbackTargets: RuntimeTarget[]

  explanation: string[]
}
```

---

## PhotonicPlan

```ts
export interface PhotonicPlan {
  target: "photonic"

  workloadId: string

  planningOnly: boolean

  blockers: string[]
  warnings: string[]

  fallbackTargets: RuntimeTarget[]

  explanation: string[]
}
```

---

# WASM Target

## WasmTarget

```ts
export interface WasmTarget {
  target: "wasm"

  runtime:
    | "browser"
    | "edge"
    | "server"
    | "embedded"
    | "wasi"

  forbiddenEffects: string[]

  allowHostImports: boolean

  allowWasiFilesystem: boolean

  allowHostNetwork: boolean
}
```

---

## Default WASM Forbidden Effects

```ts
export const DEFAULT_WASM_FORBIDDEN_EFFECTS = [
  "process.spawn",
  "native.call",
  "ffi.call",
  "filesystem.raw",
  "secret.raw"
]
```

---

## Browser WASM Forbidden Effects

```ts
export const BROWSER_WASM_FORBIDDEN_EFFECTS = [
  ...DEFAULT_WASM_FORBIDDEN_EFFECTS,
  "storage.read",
  "storage.write",
  "environment.read",
  "network.raw_socket"
]
```

---

# Compatibility

## CompatibilityLevel

```ts
export type CompatibilityLevel =
  | "compatible"
  | "compatible_with_warnings"
  | "requires_fallback"
  | "incompatible"
```

---

## CompatibilityBlocker

```ts
export interface CompatibilityBlocker {
  code: string
  message: string
  effect?: string
  capability?: string
  target?: RuntimeTarget
  sourceLocation?: SourceLocation
}
```

---

## CompatibilityWarning

```ts
export interface CompatibilityWarning {
  code: string
  message: string
  effect?: string
  capability?: string
  target?: RuntimeTarget
  sourceLocation?: SourceLocation
}
```

---

## CompatibilityResult

```ts
export interface CompatibilityResult {
  target: RuntimeTarget
  level: CompatibilityLevel
  blockers: CompatibilityBlocker[]
  warnings: CompatibilityWarning[]
  fallbackTargets: RuntimeTarget[]
}
```

---

## TargetProfile

```ts
export interface TargetProfile {
  target: RuntimeTarget

  supportedEffects: string[]
  forbiddenEffects: string[]
  requiredCapabilities: string[]

  memoryLimitMb?: number

  allowsSensitiveData: boolean

  fallbackTargets: RuntimeTarget[]
}
```

---

## CompatibilityReport

```ts
export interface CompatibilityReport {
  schemaVersion: "galerina.compatibility.report.v0.2"

  workloadId: string

  selectedTarget: RuntimeTarget

  results: CompatibilityResult[]

  selectedFallback?: RuntimeTarget

  diagnostics: CompilerDiagnostic[]
}
```

---

# ComputePlan

```ts
export interface ComputePlan {
  schemaVersion: "galerina.compute.plan.v0.2"

  workload: ComputeWorkload

  selectedTarget: RuntimeTarget

  gpuPlan?: GpuPlan

  opticalPlan?: OpticalPlan

  photonicPlan?: PhotonicPlan

  wasmTarget?: WasmTarget

  compatibilityReport: CompatibilityReport

  fallbackTargets: RuntimeTarget[]

  explanation: string[]
}
```

---

# estimateTarget()

```ts
export function estimateTarget(
  workload: ComputeWorkload,
  profiles: TargetProfile[]
): ComputePlan
```

The planner should consider:

```text
memory pressure
parallelism
target policy
sensitive data rules
forbidden effects
WASM restrictions
fallback availability
```

---

# Compatibility Rules

The compute layer must reject incompatible workloads.

Examples:

```text
storage.read in browser WASM
sensitive data on forbidden accelerators
memory beyond target limits
missing runtime capabilities
```

Compatibility must remain explainable.

---

# Diagnostic Codes

## FUNGI-COMPUTE

```text
FUNGI-COMPUTE-001 through FUNGI-COMPUTE-005
```

## FUNGI-WASM

```text
FUNGI-WASM-001 through FUNGI-WASM-005
```

## FUNGI-COMPAT

```text
FUNGI-COMPAT-001 through FUNGI-COMPAT-005
```

---

# Reports

Generated reports may include:

```text
compute-plan.json
compatibility-report.json
gpu-plan.json
optical-plan.json
wasm-target-report.json
```

---

# Core Principles

The compute layer must be:

```text
backend-neutral
runtime-controlled
policy-governed
portable
explainable
fallback-safe
future-compatible
```

It must avoid:

```text
vendor lock-in
hardcoded backend syntax
unsafe memory assumptions
hidden runtime switching
magic acceleration
unsafe fallback behaviour
```

---

# Summary

`galerina-core-compute` provides governed compute planning for Galerina.

The package defines:

```text
GPU planning
WASM restrictions
photonic planning
compatibility analysis
runtime target estimation
fallback planning
```

It is intentionally:

```text
hardware-neutral
governance-first
future-compatible
```

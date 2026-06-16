# LogicN — Future Substrates: Photonic, Neuromorphic, Quantum

**Version: 1.0 — 2026-06-01**
**Status: Architecture direction — Phase 48+ implementation**

---

## Governing Novel Substrates

The governance model LogicN uses today — GovernanceGraph, ProofGraph, ExecutionGraph — was
designed for silicon CPUs. But governance principles don't depend on silicon.

The same principles apply to photonic processors, neuromorphic chips, and quantum coprocessors:

```
Hardware executes.
Governance decides.
Proof verifies.
Audit records.
```

The Governance Visibility Rule applies: **the less observable the hardware, the stronger
the proof requirements.**

---

## Photonic Compute (`target photonic`)

### What Photonic Compute Is

Photonic processors use light (photons) rather than electrons to perform computation.
This enables:
- Extreme energy efficiency (light travels at c, minimal resistance)
- Natural matrix multiplication (interference patterns)
- Deterministic, non-branching execution
- Analog computation (continuous values, not discrete bits)

### Properties

| Property | Value | Governance Implication |
|---|---|---|
| Determinism | Full | Standard ProofGraph sufficient |
| Observability | Partial | Input/Output seals required |
| Execution model | Non-branching | Ideal for pure matrix operations |
| State | Stateless | No persistent state between operations |
| Energy class | Ultra-low | CostGraph energy budget dramatically reduced |

### Governance Class: AcceleratorPlane (Class 2)

Photonic compute is **Class 2** because it is:
- Partially observable (intermediate optical states cannot be directly inspected)
- Physically different from conventional silicon
- Suitable only for mathematical operations (never governance logic)

### Use Cases in LogicN

**Accelerated Math Plane — not Governance Plane:**

```
Matrix transforms   → Photonic (natural, energy-efficient)
Inference           → Photonic (matrix multiply = inference core operation)
Masking             → Photonic (fast, parallel)
Filtering           → Photonic (signal processing)
```

**Not:**

```
Capability decisions   → Always CPU
Policy evaluation      → Always CPU
Authority issuance     → Always CPU
Encryption / hashing / integrity / signatures → Always CPU (deterministic core)
```

> **Crypto-on-core (`LLN-SUBSTRATE-001`).** Cryptography and integrity (encryption, hashing,
> signatures, the Merkle/TMX root) MUST run **bit-exact on the deterministic digital core** — analog
> photonics is ~≤10-bit and error-tolerant, which breaks the zero-error avalanche that hashing/crypto
> require. Photonics' honest crypto-adjacent roles (QRNG entropy, optical-PUF device root, optical-LSH
> *non-trust* addressing) sit **outside** the hash and are re-verified. *Corrected 2026-06-16 — the prior
> "Encryption → Photonic matrix operations" line contradicted this rule (tri-encryption R&D, verdict 2;
> independently re-derived from the photonic-hashing AND lattice literature).*

### Contract Syntax

```logicn
hardware {
  target photonic
  require static_execution_plan
  fallback wasm.simd
}
```

### LogicN + Photonic: The Opportunity

Photonic compute is currently emerging (Lightmatter, Luminous, PsiQuantum silicon photonics).
LogicN's architecture is ready to govern it because:

1. The immutable execution plan pattern fits photonic execution perfectly (optical circuits are fixed at setup)
2. The Input Seal pattern works regardless of the computation substrate
3. The GovernancePlane (CPU/WASM) remains sovereign; photonic is just very fast math

---

## Neuromorphic Compute (`target neuromorphic`)

### What Neuromorphic Compute Is

Neuromorphic chips model biological neural computation — event-driven, spike-based,
asynchronous processing. Examples: Intel Loihi 2, IBM NorthPole, BrainScaleS.

Key properties:
- **Extremely low power** (sub-milliwatt idle, microjoule per event)
- **Event-driven** (no clock cycle overhead when inactive)
- **Asynchronous** (operations triggered by events, not synchronised to a global clock)
- **Stateful** (maintains network state across events)

### Properties

| Property | Value | Governance Implication |
|---|---|---|
| Determinism | High (but asynchronous) | Extended proof + timing bounds required |
| Observability | Partial | Input/Output seals + timing attestation |
| Execution model | Event-driven | Continuous monitoring pattern |
| State | Stateful | Lineage tracking across spikes |
| Energy class | Ultra-low | Ideal for always-on governance |

### Governance Class: AcceleratorPlane (Class 2)

Neuromorphic is **Class 2** because it is asynchronous and partially observable.
Results require timing attestation (when did the result emerge, within what bounds?).

### The Always-On Governance Pattern

This is neuromorphic compute's unique governance contribution — one no other substrate matches:

```
Neuromorphic chip running governance monitoring model:
  Power consumption:   < 1mW
  Idle power:          < 0.1mW
  Response to event:   < 1μs
```

**Use cases for always-on governance monitoring:**

```
Continuous audit stream analysis       → flag anomalies in real-time
Continuous lineage violation detection → alert when data moves unexpectedly
Continuous risk scoring                → update risk model as events occur
Continuous governance pattern matching → detect policy violations instantly
```

**Why this matters for safety_critical systems:**

In aerospace, a neuromorphic co-processor could monitor:
- Flight data stream continuously for anomalies
- Sensor fusion outputs for consistency violations
- System health metrics against governance thresholds

...at < 1mW, continuously, with sub-millisecond event response.

### Contract Syntax

```logicn
hardware {
  target neuromorphic
  require timing_attestation
  require stateful_audit
  fallback npu.validation
}
```

### LogicN + Neuromorphic Monitoring Example

```logicn
pure flow governanceMonitor() -> AuditAlert
contract {
  effects { audit.read }
  hardware {
    target neuromorphic
    require timing_attestation
    fallback cpu
  }
}
{
  return NeuromorphicMonitor.scanAuditStream()
}
```

The neuromorphic chip runs continuously, consuming near-zero power, and produces
AuditAlert events when governance violations are detected. The CPU receives only
the alert events — not the raw stream.

---

## Quantum Compute (`target quantum`)

### What Quantum Compute Is

Quantum processors use quantum mechanical phenomena (superposition, entanglement)
to perform computation that is fundamentally different from classical computation.

Critical properties:
- **Probabilistic** (results have probability distributions, not exact values)
- **Partially observable** (measurement collapses quantum state — you can't look without disturbing)
- **Non-deterministic** (same input can produce different results)
- **Error-prone** (NISQ era — noisy qubits, error correction essential)

### Properties

| Property | Value | Governance Implication |
|---|---|---|
| Determinism | Probabilistic | Full post-execution validation required |
| Observability | Opaque | Strongest proof requirements |
| Execution model | Wave-function | Results are probability distributions |
| State | Stateless (collapses on measurement) | No persistent quantum state |
| Error rate | High (current NISQ era) | Result sanitisation mandatory |

### Governance Class: ExperimentalPlane (Class 3)

Quantum is **Class 3** — the highest proof requirement class.

**Why quantum can never be GovernancePlane:**
- Probabilistic results → capability decisions must be deterministic
- Partially observable → cannot verify governance logic ran correctly
- Non-deterministic → leases cannot be issued with confidence

### The Mathematical Oracle Pattern

Quantum compute in LogicN is treated as a **Mathematical Oracle**:

```
CPU prepares question (classical, fully specified)
    ↓
CPU seals the question (inputSeal = hash(question))
    ↓
Quantum coprocessor receives sealed question
    ↓
Quantum coprocessor produces result (probabilistic)
    ↓
Result Sanitizer validates result:
  - Is result within expected value range?
  - Is result type-correct?
  - Is result plausible (not physically impossible)?
    ↓
CPU validates consistency (may run quantum multiple times, compare)
    ↓
AuditGraph records:
  { inputSeal, outputSeal, quantumRuns, consistencyPassed, target: "quantum" }
    ↓
Validated result enters governance pipeline
```

The quantum device is never asked to make a decision. It is asked to compute. The CPU makes the decision based on the validated result.

### Use Cases

**Appropriate:**
```
Optimization: route planning, resource allocation, scheduling
Risk modelling: portfolio risk, scenario analysis
ProofGraph optimization: finding efficient proof paths across large graphs
Cryptographic key generation: high-quality randomness (post-validation)
Scientific simulation: molecular modelling, climate modelling
```

**Never appropriate:**
```
Capability issuance   → quantum results are probabilistic
Lease generation      → requires deterministic output
Policy evaluation     → cannot verify quantum logic ran correctly
Authority decisions   → ever
```

### Quantum Security Invariants

```
Quantum compute may:
  Solve optimization problems
  Provide high-quality randomness (post-validation)
  Accelerate specific mathematical operations
  Assist risk modelling and scenario analysis

Quantum compute may never:
  Grant authority
  Issue capability leases
  Evaluate policy
  Make deterministic decisions (it is probabilistic)
  Operate without CPU validation of results
  Produce governance outputs directly
```

---

## Hardware Governance Class Summary

| Hardware | Class | Observability | ProofLevel | Always-On? |
|---|---|---|---|---|
| CPU | GovernancePlane (0) | Full | Standard | — |
| WASM | GovernancePlane (0) | Full | Standard | — |
| GPU | ExecutionPlane (1) | Full | + Input Seal | No |
| NPU | ExecutionPlane (1) | Partial | + Input Seal | No |
| TPU | ExecutionPlane (1) | Partial | + Input Seal | No |
| Photonic | AcceleratorPlane (2) | Partial | + Attestation | No |
| **Neuromorphic** | AcceleratorPlane (2) | Partial | + Timing | **Yes** |
| Quantum | ExperimentalPlane (3) | Opaque | Full chain | No |

Neuromorphic is the only substrate suitable for always-on governance monitoring at scale.

---

## The Final Invariant

```
No hardware may become a source of authority.

Not CPU. Not GPU. Not NPU. Not TPU.
Not Apple Neural Engine. Not Hexagon. Not XDNA.
Not photonic processors. Not neuromorphic chips.
Not quantum coprocessors.
Not any future substrate.

Authority always originates from:
  GovernanceGraph
  ProofGraph
  CapabilityGraph
  Runtime Policy

Hardware executes.
Governance decides.
Proof verifies.
Audit records.
```

---

## See Also

- `logicn-hardware-compute-fabric.md` — HardwareGovernanceClass, Governance Visibility Rule
- `logicn-hardware-targets.md` — All target IDs
- `logicn-hardware-npu-apu.md` — NPU/APU passive compute fabrics
- `logicn-master-architecture.md` — Accelerator Sovereignty Rule
- `logicn-roadmap-phase26-50.md` — Phase 40 (Photonic), Phase 48 (Real-time), Phase 49 (Formal verification)

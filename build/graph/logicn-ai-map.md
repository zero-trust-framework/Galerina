# LogicN AI Map

## logicn-core

LogicN / LogicN language package, examples, schemas and prototype CLI.

Provides:
- OrderId
- CustomerId
- OrderItem
- CreateOrderRequest
- CreateOrderResponse
- CreateOrderResult
- Decision
- ArithmeticBenchmarkReport
- ArithmeticBenchmarkError
- Buffer
- inspectBuffer
- ContactFormData

## logicn-core-compiler

LogicN compiler pipeline contracts for parsing, checking, IR, diagnostics and reports.

Provides:
- LogicNAttestation
- AttestationInputs
- AttestationKeyPair
- signAttestation
- verifyAttestation
- generateAttestationKey
- HybridAttestationKeyPair
- attestationToYaml
- attestationFromJson
- AuditEvent
- AuditWriter
- createAuditWriter

## logicn-core-runtime

LogicN execution engine contracts for checked and compiled runtime execution.

Provides:
- RuntimeMode
- RuntimeEnvironment
- RuntimeDiagnosticSeverity
- RuntimeContext
- RuntimeDiagnostic
- RuntimeError
- RuntimeResult
- RuntimeEffectKind
- RuntimeEffect
- RuntimeEffectPolicy
- RuntimeEffectDecision
- RuntimeReport

## logicn-core-network

LogicN core network I/O policy, profile, permission and report contracts.

Provides:
- AdmissionHealth
- AdmissionTelemetry
- telemetryToSideSignal
- withTelemetryFeedback
- certGateWithTelemetry
- ChainValidationOutcome
- RevocationOutcome
- CertSubVerdicts
- CertGateInput
- toSubVerdicts
- certVerdict
- withSideSignal

## logicn-core-security

Reusable LogicN security primitives, redaction helpers, permission models and security report contracts.

Provides:
- DAGEdgeResult
- DSSState
- DWIHandle
- EmergencyTransitionResult
- EpilogueReceipt
- MMCPEntry
- AuditEvent
- TrapSignal
- PluginEvictionSignal
- SecuritySeverity
- SecretClassification
- PermissionEffect

## logicn-core-config

LogicN project configuration, environment mode and policy loading contracts.

Provides:
- GOVERNANCE_MODES
- GovernanceMode
- DEFAULT_GOVERNANCE_MODE
- isGovernanceMode
- ResolvedProjectGovernance
- resolveProjectGovernance
- LOGICN_ENVIRONMENT_MODES
- EnvironmentMode
- ConfigDiagnosticSeverity
- ConfigDiagnostic
- ProjectPackageReference
- ProductionPackageOverride

## logicn-core-reports

Shared LogicN report schemas and report-writing contracts.

Provides:
- ReportSeverity
- ReportStatus
- ReportKind
- ReportGenerator
- ReportMetadata
- ReportSourceLocation
- ReportDiagnostic
- DiagnosticSummary
- LoReportBase
- BuildReport
- SecurityReport
- TargetReport

## logicn-core-logic

LogicN multi-state logic concepts including Tri, Decision, BoolBoundary and Omni logic.

Provides:
- ComputeMixBenchmarkReport
- ComputeMixBenchmarkError
- BoolBoundaryContext
- BoolBoundaryResult
- LLN_BOOL_BOUNDARY_001_FAILED_CLOSED
- LLN_BOOL_BOUNDARY_002_UNKNOWN_REASON
- LLN_BOOL_BOUNDARY_003_INVALID_INPUT
- LLN_BOOL_BOUNDARY_004_MISSING_BOUNDARY_NAME
- LLN_BOOL_BOUNDARY_005_RESULT_MISUSED
- boolDiagnosticFailedClosed
- boolDiagnosticUnknownReason
- boolDiagnosticInvalidInput

## logicn-core-vector

LogicN vector value, lane, operation and report concepts.

Provides:
- VectorDimension
- NumericElementType
- VectorType
- MatrixShape
- MatrixType
- TensorShape
- TensorType
- QuantizedType
- VectorOperation
- TensorOperation
- VectorReport
- VectorDiagnosticSeverity

## logicn-core-compute

LogicN compute planning, capability and target selection concepts.

Provides:
- ComputeTarget
- ComputeWorkloadKind
- ComputeDiagnosticSeverity
- ComputeDiagnostic
- ComputeCapability
- ComputeBudget
- ComputePlan
- ComputeAutoPolicy
- ComputeTargetSelection
- ComputeTargetPreference
- ComputeDataLocation
- ComputeDataMovement

## logicn-ai

LogicN AI inference contracts, model metadata, safety policy and reports.

Provides:
- AiTaskKind
- AiOutputTrust
- AiModelFormat
- AiInferenceTarget
- AiDiagnosticSeverity
- AiDiagnostic
- AiMemoryEstimate
- AiModelCapability
- AiModelDescriptor
- AiModelRegistryEntry
- AiModelRegistry
- AiTargetSelection

## logicn-ai-lowbit

LogicN low-bit AI inference contracts with BitNet as an optional backend.

Provides:
- LowBitAiTarget
- LowBitAiBackendId
- LowBitAiDevice
- LowBitAiWeightFormat
- LowBitAiQuantization
- LowBitAiEmbeddingQuantization
- LowBitAiKernelFamily
- LowBitAiRuntimeKind
- LowBitAiDiagnosticSeverity
- LowBitAiDiagnostic
- LowBitAiBackendAdapter
- LowBitAiModelReference

## logicn-ai-agent

LogicN supervised AI agent, tool permission, task group and report contracts.

Provides:
- AgentToolDecision
- AgentFailureBehaviour
- AgentToolPermission
- AgentLimits
- AgentDefinition
- AgentTaskGroupPlan
- AgentFinding
- AgentResult
- AgentMergePolicy
- AgentReport

## logicn-ai-neural

LogicN neural network model, layer, inference and training boundary contracts.

Provides:
- NeuralTask
- ActivationFunction
- LossFunction
- OptimizerName
- TensorShapeRef
- NeuralTensorRef
- NeuralLayer
- NeuralModelDefinition
- NeuralInferencePlan
- NeuralTrainingPlan
- NeuralReport
- NeuralDiagnosticSeverity

## logicn-ai-neuromorphic

LogicN neuromorphic and spiking event model contracts.

Provides:
- Spike
- SpikeTrain
- EventSignal
- SpikingModel
- NeuromorphicPlan
- NeuromorphicReport

## logicn-data

LogicN data processing package umbrella contracts.

## logicn-data-html

LogicN HTML parse, sanitize, render and search document contracts.

## logicn-data-search

LogicN search document, indexing, query and search report contracts.

## logicn-data-archive

LogicN archive manifest, integrity and restore report contracts.

## logicn-data-db

LogicN typed database boundary contracts for model, query, command, response, archive and report flows.

## logicn-data-model

LogicN typed database model, field classification and storage mapping contracts.

## logicn-data-query

LogicN typed query, command, parameterisation and database access report contracts.

## logicn-data-response

LogicN safe database-model-to-response mapping and response report contracts.

## logicn-data-json

LogicN JSON streaming, validation, redaction and archive contracts.

## logicn-data-database

LogicN database export, snapshot, checksum and archive contracts.

## logicn-data-pipeline

LogicN bounded streaming data pipeline, backpressure and checkpoint contracts.

## logicn-data-reports

LogicN data processing, HTML, search, archive and pipeline report contracts.

## logicn-web

LogicN browser-safe web package umbrella contracts.

## logicn-web-render

LogicN typed safe browser rendering pipeline contracts.

## logicn-web-state

LogicN browser client state and state-diff contracts.

## logicn-web-components

LogicN typed browser component boundary contracts.

## logicn-web-router

LogicN browser route and navigation contracts.

## logicn-web-events

LogicN typed browser event contracts.

## logicn-db-postgres

LogicN PostgreSQL adapter contract placeholder.

## logicn-db-mysql

LogicN MySQL adapter contract placeholder.

## logicn-db-sqlite

LogicN SQLite adapter contract placeholder.

## logicn-db-opensearch

LogicN OpenSearch adapter contract placeholder.

## logicn-db-firestore

LogicN Firestore adapter contract placeholder.

## logicn-core-photonic

LogicN photonic and wavelength concepts, models, APIs and simulation contracts.

Provides:
- Wavelength
- Phase
- Amplitude
- OpticalSignal
- OpticalChannel
- PhotonicMapping
- PhotonicMode
- PhotonicDiagnosticSeverity
- PhotonicDiagnostic
- PhotonicPlan
- PhotonicReport
- defineOpticalSignal

## logicn-target-cpu

LogicN CPU target capability, fallback and execution planning contracts.

Provides:
- CpuArchitecture
- CpuSimdFeature
- CpuWorkloadClass
- CpuThreadingPolicy
- CpuTargetCapability
- CpuTargetPlan
- CpuTargetReport
- CpuFeatureProbe
- CpuTargetDiagnosticSeverity
- CpuTargetDiagnostic
- CpuCalibrationSample
- CpuCalibrationReport

## logicn-cpu-kernels

LogicN optimized CPU kernel contracts for scalar, vector, matrix and low-bit workloads.

Provides:
- CpuKernelOperation
- CpuKernelDataType
- CpuKernelFeature
- CpuKernelTilePlan
- CpuKernelPlan
- CpuKernelBenchmark
- CpuKernelReport
- CpuKernelNativeAbi
- CpuKernelCalibrationEntry
- CpuKernelCalibrationCache
- CpuKernelDiagnosticSeverity
- CpuKernelDiagnostic

## logicn-target-native

LogicN future native executable and ABI target planning concepts.

Provides:
- NativeAbi
- NativeTarget
- NativeArtifact
- NativeTargetReport

## logicn-target-js

LogicN JavaScript output target planning contracts.

## logicn-target-wasm

LogicN WebAssembly target planning and output contracts.

Provides:
- WasmTarget
- WasmArtefact
- WasmTargetReport

## logicn-target-gpu

LogicN GPU target planning and output contracts.

Provides:
- GpuTargetCapability
- GpuKernelPlan
- GpuTargetReport

## logicn-target-ai-accelerator

LogicN NPU, TPU and AI accelerator target planning contracts.

Provides:
- AiAcceleratorKind
- AiAcceleratorWorkloadKind
- AiAcceleratorPrecision
- AiAcceleratorFramework
- AiAcceleratorModelFormat
- AiAcceleratorAdapterId
- AiAcceleratorDiagnosticSeverity
- AiAcceleratorDiagnostic
- AiAcceleratorTopology
- AiAcceleratorMemoryProfile
- AiAcceleratorBackendProfile
- AiAcceleratorCapability

## logicn-target-photonic

LogicN photonic target backend planning concepts.

Provides:
- PhotonicActualTarget
- PhotonicTargetStatus
- PhotonicOperationKind
- OpticalInterconnectMode
- OpticalTransferFormat
- PhotonicTargetCapability
- OpticalIoCapability
- PhotonicTargetInput
- PhotonicLoweringPlan
- PhotonicOperationMapping
- UnsupportedPhotonicOperation
- PhotonicSimulationTarget

## logicn-framework-app-kernel

Optional LogicN secure App Kernel: the fixed, non-bypassable governed request pipeline + secure-default route policy resolver. The fusion host for protocol/capability packages.

Provides:
- canonicalJson
- FuseDescriptor
- FusedComponent
- FusePackageOptions
- CapabilityImportFactory
- BUILTIN_CAPABILITY_NAMES
- buildCapabilityImports
- CompositionMember
- CapabilitySource
- CompositionPlan
- planComposition
- makeProviderFactory

## logicn-framework-api-server

LogicN HTTP API-server adapter: a thin node:http transport that buffers the request body under a hard DoS cap and hands every request to the non-bypassable App Kernel. It never pre-empts a kernel gate except the additive body cap.

Provides:
- DEFAULT_MAX_BODY_BYTES
- DEFAULT_REQUEST_TIMEOUT_MS
- DEFAULT_HEADERS_TIMEOUT_MS
- DEFAULT_IDLE_TIMEOUT_MS
- RevocationResolution
- ApiServerTlsOptions
- CreateApiServerOptions
- createApiServer
- listen

## logicn-auth

Standalone LogicN authentication/authorization FACTOR provider: computes the K3 auth/identity verdicts (TLSTP S1 channel/identity via the shipped certGate, the tightened required-auth posture, and scope authorization) that the App Kernel folds at its fixed, non-bypassable admission gate. logicn-auth provides the FACTORS; the App Kernel still decides admission.

Provides:
- scopeVerdict
- channelIdentityVerdict
- composeAuthVerdict
- previewAdmission
- HeaderPresenceOptions
- headerPresenceVerdict

## logicn-docs

LogicN API documentation generator: emits a valid OpenAPI 3.x document from the App Kernel's governed route table (EffectiveRoutePolicy / RouteDeclaration) and contract metadata. The generated spec documents exactly the gates the kernel enforces — auth, body limits, idempotency, rate limits, and the error contract — and fails closed rather than emit an invalid or misleading governance contract.

Provides:
- generateOpenApi
- exportOpenApi
- Reference
- SchemaOrRef
- SchemaObject
- MediaTypeObject
- RequestBodyObject
- ResponseObject
- ParameterLocation
- ParameterObject
- SecurityRequirementObject
- HttpOperationKey

## logicn-core-cli

LogicN developer command-line interface for checking, building, serving, reporting and running safe tasks.

Provides:
- parseEnvironment
- commands
- findCommand
- createCoreCommandRunner
- relativeCoreCompilerPath
- spawn
- Dirent
- Stats
- mkdir
- readdir
- readFile
- stat

## logicn-core-tasks

Safe typed task runner for LogicN project automation.

Provides:
- checkTaskPermissions
- TaskDependencyPlan
- resolveTaskDependencies
- DryRunPlan
- createDryRunPlan
- dryRunTask
- LoadedTasks
- parseTasksSource
- readFile
- RunTaskOptions
- TaskReport
- TaskRunReport

## logicn-tools-benchmark

LogicN benchmark and diagnostics contracts for logic, compute targets, fallback behaviour and safe reporting.

Provides:
- BenchmarkMode
- BenchmarkTrigger
- BenchmarkTarget
- BenchmarkStatus
- BenchmarkPrivacyPolicy
- BenchmarkConfig
- BenchmarkSystemInfo
- BenchmarkTestResult
- BenchmarkScores
- BenchmarkReport
- BenchmarkSubmitPayload
- DEFAULT_BENCHMARK_CONFIG

## logicn-test

The consolidated LogicN test harness — one named, consumable package that runs unit, e2e, conformance (R6) and fidelity-differential (walker ≡ bytecode ≡ WASM) checks against a LogicN workspace.

Provides:
- parseCounts
- parseAggregateTotal
- WORKSPACE_MARKER
- resolveRoot
- resolveTarget
- DEFAULT_E2E_EXAMPLES
- SpawnOutcome
- DEFAULT_TIMEOUT_MS
- runNode
- CheckKind
- CheckScope
- TestCounts

## logicn-devtools-graph-project

LogicN project knowledge graph contracts for package, document, policy and report relationships.

Provides:
- ProjectGraphNodeKind
- ProjectGraphEdgeKind
- ProjectGraphConfidence
- ProjectGraphDiagnosticSeverity
- ProjectGraphBackendId
- ProjectGraphBackendSourceKind
- ProjectGraphBackendCapability
- ProjectGraphDiagnostic
- ProjectGraphNode
- ProjectGraphEdge
- ProjectGraph
- ProjectGraphWorkspacePackage

## logicn-framework-example-app

The canonical runnable 'hello, governed world' LogicN app: a governed flow compiled to a signed .wasm, fused into the App Kernel at a route, and served over HTTP. This is the golden template `logicn new app` emits.

Provides:
- AppEnv
- AppPosture
- AppConfig
- parseConfig
- loadConfig
- paths
- FuseOptions
- fuseGreeting
- createGreetingKernel
- StartedServer

## logicn-api-protocol-rest

Reference REST protocol-adapter (L3): /src governed flow → fusable .wasm, fused via the App Kernel. Proves the /src → .wasm → fused path end-to-end.

## logicn-substrate-math

Pure substrate-noise math shared by the governance layer: per-lane error probability + von Neumann NMR (N-modular-redundancy) closed form. Zero runtime deps. Single source of truth for the NMR calculus used by both logicn-tower-citizen (substrate-model) and logicn-core-compiler (substrate-inference).

Provides:
- SubstrateMathError
- SubstrateNoiseParams
- flipProbability
- singleLaneErrorProbability
- nmrFailureProbability

## logicn-ext-bridge-quantum

LogicN governed bridge for IBM ffsim — out-of-process fermionic quantum simulation under contract, Tower audit lifecycle + attestation

Provides:
- FfsimEnv
- detectFfsim
- FfsimBackend
- selectQuantumBackend
- createQuantumBridgeRegistry
- LimitVerdict
- checkJobLimits
- FfsimManifestInputs
- buildFfsimManifest
- validateFfsimManifest
- QuantumOp
- QUANTUM_OPS

## logicn-inference-bridge-contract

Neutral Brain/Brawn contract — InferenceBridge, BridgeOp/Result, packed-ternary + fixed-point layout metadata, bridge manifest schema, determinism oracle interface. Zero runtime deps.

Provides:
- FixedScale
- BridgeOp
- BridgeResult
- InferenceBridge
- BridgeRegistry
- assertDeterminism
- DeterminismMode
- CertificationProfile
- BridgeDomain
- ToleranceWitness
- BridgeManifest
- BridgeAttestation

## logicn-core-economics

CostGraph, ValueGraph, and risk-adjusted execution routing for the LogicN platform. Economics is a constraint layer that sits below governance — it can pull the emergency brake on a safe path, but never press the gas pedal on an unsafe one.

Provides:
- ExecutionTarget
- CostBreakdown
- CostEstimate
- CLOUD_PRICING
- AI_PRICING
- AiModel
- CostInputs
- estimateCost
- PER_RECORD_LOSS_USD
- RISK_MODIFIERS
- RiskInputs
- calculateRiskCost

## logicn-core-sentinel-egress

LogicN Sentinel Egress — governed audit egress: fixed ring buffer + batched HMAC-chained tamper-evident flush. Citizen Protocol v1.6.

Provides:
- AuditBatch
- AuditEgressOptions
- AuditEgress
- readEgressLedger
- HardenedBorderViolation
- SecurityTrap
- RingBuffer

## logicn-core-sentinel-io

LogicN Sentinel I/O (LSIO) — deterministic, governed, manifest-driven zero-copy data ingestion with HMAC-SHA256 integrity. Citizen Protocol v1.1.

Provides:
- HardenedBorderViolation
- SecurityTrap
- IntegrityResult
- IntegrityMonitor
- IoBlock
- IoManifest
- ManifestLoader
- buildManifest
- IngestSourceKind
- LocalDiskBus
- PhotonicBus
- MappedBlock

## logicn-core-sentinel-memory

LogicN Sentinel Memory (LSM) — deterministic fixed-block pool, 128-bit alignment, Compute/Governance segmentation, ternary TPL state buffer. Citizen Protocol v1.2.

Provides:
- SecurityTrap
- HardenedBorderViolation
- ALIGN_BYTES
- MemoryValidator
- MemoryChannel
- LocalSramBus
- SegmentationController
- Segment
- Block
- PoolConfig
- StaticMemoryPool
- TPLStateBuffer

## logicn-core-sentinel-power

LogicN Sentinel Power (LSP) — thermal/power envelope governor with deterministic kernel down-tiering. Citizen Protocol v1.4.

Provides:
- PowerFault
- PowerDecision
- PowerGovernor
- PowerState
- KernelTier
- ThermalEnvelope
- validateEnvelope
- AEROSPACE_ENVELOPE

## logicn-core-sentinel-state

LogicN Sentinel State (LSS) — atomic, HMAC-verified state snapshots + cold-boot recovery. Citizen Protocol v1.5.

Provides:
- AtomicWriter
- ColdBootOrchestrator
- SecurityTrap
- HardenedBorderViolation
- Snapshot
- StateSerializer

## logicn-core-sentinel-time

LogicN Sentinel Time (LST) — deterministic Logical Clock + drift monitor. Cycle-indexed audit timing. Citizen Protocol v1.3.

Provides:
- PrecisionFault
- LogicalClock
- StabilityEnvelope
- SynchronizationGate

## logicn-tower-citizen

LogicN Tower Citizen — TowerRuntime + AuditLogger + PluginSandbox for governed AI inference

Provides:
- TowerAuditEvent
- EgressSink
- AuditFilter
- AuditLoggerOptions
- AuditLogger
- StubTernaryBridge
- StubFp4Bridge
- createStubRegistry
- AttestationPolicy
- AttestationResult
- attestationHash
- signManifest

## logicn-tri-pipe

The Tri-Pipe capstone: createTriPipeEngine() composes the hardware() capability directive + the photonic backend/router + the governed HybridInferenceEngine into one call, selecting the digital registry and photonic offload by the resolved {binary|hybrid|photonic} tier. Digital is the default; photonic only on a proven net win; fail-closed to binary.

Provides:
- CapabilityInput
- ExecutionRouteInput
- ExecutionDecision
- ExecutionRouter
- createExecutionRouter
- TriPipeOptions
- TriPipeEngine
- createTriPipeEngine

## logicn-ext-tmf

LogicN .tmf format engine (Phase 2 #6) — TMX-256 integrity (TriMerkle-XOF/SHAKE256), container, KEM-DEM confidentiality, ML-DSA-65 signing. Crypto-on-core: bit-exact, deterministic.

Provides:
- MAGIC
- HEADER_SIZE
- HEADER_CORE_SIZE
- ENTRY_SIZE
- TMX_PROFILE_SHAKE
- TmfErrorCode
- TmfError
- TmfSection
- TmfReadResult
- headerCore
- writeTmf
- readTmf

## logicn-ext-bridge-bitnet

LogicN governed bridge for Microsoft BitNet.cpp — ternary CPU inference with Tower audit lifecycle

Provides:
- BitNetModelSpec
- BitNetRequest
- BitNetResponse
- BitNetBridge
- createBitNetBridge

## logicn-ext-bridge-cpp

Native CPU/GPU execution bridges (BitNet ternary) implementing the Tower InferenceBridge contract — simulator fallback, native addon seam

Provides:
- BitNetNativeAddon
- AddonLoadResult
- loadNativeAddon
- BitNetCpuBridge
- BitNetGpuBridge
- CpuCapability
- GpuCapability
- detectCpu
- detectGpu
- selectTernaryBridge
- createCppBridgeRegistry

## logicn-ext-photonic-emulator

LogicN photonic-PPU backend: a physics-faithful (Rung-2) MZI-mesh / micro-ring ternary-MAC emulator + the partition cost-model router behind the neutral Brain/Brawn bridge contract. Digital stays the default; photonic only on a proven net win; fail-closed to digital. EMULATED, not silicon (no measured speedup).

Provides:
- PhysParams
- ACT_MAX
- ENOB_CEILING
- PHOTONIC
- NOISY
- Xorshift32
- tmacExact
- analogVarianceClosedForm
- adcRange
- quantStep
- tmacPhotonic
- N_MAX_VOTES

## logicn-ext-proof-snarkjs

snarkjs Groth16 prover backend for LogicN epilogue { generate_proof zk_snark_receipt }. Phase 1: pure-JS Groth16 circuit over sha256(sourceText + contractHash). Non-core extension — the compiler core never imports this directly.

Provides:
- CIRCUIT_ID
- computePhase1Proof
- verifyPhase1Proof
- Sha256SealBackend
- LogicNSnarkjsProver
- createSnarkjsProver
- ProverInput
- ZkProof
- ProverBackend

## logicn-ext-secrets-vault

HashiCorp Vault provider for LogicN contract.secrets {} blocks. Implements dual-token ephemeral rotation with zero-downtime handshake. Non-core: vault mechanics live outside the deterministic compiler core.

Provides:
- LogicNSecretsVault
- SecretsRotationManager
- SECRETS_GATEWAY_WIT
- SecretCredential
- RotationPolicy
- SecretsContractBlock
- SecretHandle
- VaultClient

## logicn-governance-telemetry

Blind-observability exporter: streams a LogicN app's governance + operational STATE (masks, verdicts, effect-families, counts, declared budgets) to Prometheus/OpenMetrics — never the data it processes. Log the contract, not the payload.

Provides:
- GOVERNANCE_FLAGS
- AUDIT_STATUSES
- EXECUTION_TIERS
- GovernanceSnapshot
- isSafeLabel
- effectFamily
- renderPrometheus
- ExporterOptions
- ExporterHandle

## logicn-observability

Actuator-style operational observability for a LogicN app: a health/liveness/readiness surface, app metrics (request counts, latencies, error rates), and structured app logs. The app-operator's ops view — distinct from @logicn/governance-telemetry (which exports governance STRUCTURE). Surfaces through the App Kernel as health routes + a metrics collector. Fail-closed, zero ambient authority.

Provides:
- HealthStatus
- HealthKind
- ComponentHealth
- HealthCheck
- HealthReport
- DEFAULT_CHECK_TIMEOUT_MS
- HealthRegistryOptions
- HealthRegistry
- metricsAuditSink
- InstrumentOptions
- instrumentDispatch
- MetricsAuth

## logicn-hardware-tier

LogicN Tri-Pipe topology: the cached, attested hardware() capability directive {binary|hybrid|photonic} + the per-tier package loader (photonic > hybrid > binary, fail-closed to binary). Capability preference picks the package; the 0053 per-kernel router still gates actual offload — worst case == binary == today.

Provides:
- Tier
- ResolveHardwareInput
- resolveHardware
- resolveHardwareFromIdentity
- HardwareDirective
- capabilityPreimage
- TierRegistries
- TierSelection
- selectTier
- createTierLoader
- GovernanceClass
- TierProfile

## logicn-devtools-context

Context Receipt generator for LogicN: produces minimal AI-consumable structural summaries from .lln source. 98% token reduction vs raw source while preserving full architectural intent.

Provides:
- DEVTOOLS_CONTEXT_VERSION
- renderReceiptMarkdown
- renderFileReceiptsMarkdown
- generateReceipts
- generateFlowReceiptByName
- FlowContextReceipt
- FileContextReceipts
- ReceiptOptions

## logicn-devtools-flowgraph

Flow graph analysis for LogicN — finds cycles, dead flows, authority escalation, PII leakage paths, and missing audit coverage.

Provides:
- GraphSeverity
- GraphDiagnostic
- detectCycles
- detectDeadFlows
- detectAuthorityEscalation
- detectPiiLeakagePaths
- detectMissingAuditCoverage
- detectUnboundedRetry
- checkFlowGraph
- FlowNode
- FlowEdge
- FlowGraph

## logicn-devtools-graph-algorithms

Internal graph data structures and algorithms for the LogicN compiler. Designed for future extraction to lln-graph.

Provides:
- bfsPath
- bfsReachable
- DfsVisitor
- dfsVisit
- detectCycle
- canReach
- allReachable
- topoSort
- GraphBuilder
- ImmutableGraph
- NodeId
- GraphNode

## logicn-devtools-intelligence

Hybrid BM25 + structural code search for LogicN workspaces. Indexes flows by semantic tokens, effects, economics, and governance metadata. Zero external dependencies — runs fully local.

Provides:
- tokenize
- tokenizeWithCompounds
- buildInvertedIndex
- bm25Search
- ExtractionInput
- extractFlows
- IndexBuildResult
- search
- searchWithIndex
- IndexedFlow
- SearchResult
- SearchFilters

## logicn-devtools-kb-graph

Auto-index graph for LogicN Knowledge Base documents

Provides:
- KBGraph
- buildKBGraph
- generateDOT
- generateJSON
- generateMarkdownReport
- KBDocNode
- KBEdge
- ScanResult
- scanKBDirectory

## logicn-devtools-naming

Naming standard enforcer for LogicN: detects abbreviations, implicit types, missing intent. Promotes Zero-Ambiguity / Maximum-Semantics coding.

Provides:
- DEVTOOLS_NAMING_VERSION
- NamingDiagnosticCode
- NamingDiagnostic
- NamingCheckResult
- NamingCheckOptions
- checkNaming
- NamingRunnerOptions
- NamingAuditReport
- runNamingAudit

## logicn-devtools-package-graph

Per-package boundary-governance graph — internal edges, external-dependency surface, orphan detection, Hardened Border CI gate

Provides:
- InternalEdge
- ExternalDep
- PackageGraph
- buildGraph
- BoundaryPolicy
- CheckResult
- writeJson
- runBoundaryGate
- writeBoundaryMarkdown
- EdgeKind
- FileImport
- ScannedFile

## logicn-devtools-pci

PCI DSS 4.0.1 compliance audit for LogicN programs. Static analysis maps PCI requirements to LogicN contract patterns: cardholder data protection (Req 3), transit encryption (Req 4), access control (Req 7), audit logging (Req 10), secure development (Req 6). CI-runnable, no infrastructure needed.

Provides:
- EgressBatch
- readEgressBatches
- ComplianceDecision
- ComplianceEntry
- ComplianceReport
- buildComplianceReport
- buildComplianceReportFromDir
- appendComplianceLedger
- readComplianceLedger
- verifyComplianceChain
- DEVTOOLS_PCI_VERSION
- runPciAudit

## logicn-devtools-project-graph

Graph data structures, algorithms, and runtime reporting for the LogicN platform

Provides:
- bfsPath
- bfsReachable
- dfsVisit
- detectCycle
- FixpointResult
- fixpoint
- updateNode
- canReach
- allReachable
- canReachAll
- reachableSubset
- TopoResult

## logicn-devtools-provenance

Data lineage and provenance tracker for LogicN: maps data sources, transformations, and sinks across a workspace. Visualizes trust boundaries and PII flow paths for compliance and security review.

Provides:
- FileProvenanceResult
- analyzeFile
- collectLlnFiles
- buildProvenanceGraph
- DEVTOOLS_PROVENANCE_VERSION
- renderTextReport
- renderJsonReport
- ProvReportOptions
- renderProvReport
- DataSourceKind
- DataSinkKind
- TransformKind

## logicn-devtools-security

Security analysis, audit, and testing tools for LogicN programs. Runs all security checks (taint, profiles, governance, hardware, path sandbox, ReDoS guard) and produces structured audit reports. Designed for CI integration — lightweight, no runtime dependency.

Provides:
- SecuritySeverity
- SecurityFinding
- SecurityAuditReport
- SecurityAuditOptions
- DEVTOOLS_SECURITY_VERSION
- PathCheckResult
- checkPathSandbox
- isPathEscape
- PATH_SANDBOX_TEST_VECTORS
- RegexValidationResult
- validateRegexPattern
- safeCompileRegex

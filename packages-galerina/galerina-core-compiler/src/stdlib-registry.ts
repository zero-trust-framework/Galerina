// =============================================================================
// Galerina Phase 18H — Standard Library Registry
//
// STDLIB_CAPABILITY_MAP:  stdlib function → required effects
// STDLIB_MODULE_KIND:     module → "pure" | "effectful"
// TENSOR_STDLIB_OPS:      Tensor operation → compute target compatibility
// TRI_STDLIB_OPS:         TriState operations (photonic/ternary compatible)
//
// WASM architecture rule: all API decisions consider WASM compatibility first.
// Pure stdlib → WASM functions with zero imports.
// Effectful stdlib → WASM import table entries.
//
// Principle: The Galerina stdlib should make the safe path the fast path.
// =============================================================================

// ---------------------------------------------------------------------------
// STDLIB_CAPABILITY_MAP
//
// Maps stdlib function names (full qualified or method names) to their
// required effects. Used by:
//   - Effect checker (validate declarations)
//   - GIR emitter (populate allowedEffectsMask)
//   - WASM backend (populate import table)
//   - Runtime policy (check allowedEffects mask)
// ---------------------------------------------------------------------------

export interface StdlibCapabilityEntry {
  readonly requiredEffects: readonly string[];
  /** WASM import table entry name for this function. */
  readonly wasmImport?: string;
  /** Human-readable description for diagnostics and AI tools. */
  readonly description: string;
}

export const STDLIB_CAPABILITY_MAP: ReadonlyMap<string, StdlibCapabilityEntry> = new Map([
  // ── Filesystem ─────────────────────────────────────────────────────────────
  ["File.readText",        { requiredEffects: ["storage.read"],  wasmImport: "host:fs.readText",  description: "Read a text file from the filesystem." }],
  ["File.readBytes",       { requiredEffects: ["storage.read"],  wasmImport: "host:fs.readBytes", description: "Read binary data from the filesystem." }],
  ["File.writeText",       { requiredEffects: ["storage.write"], wasmImport: "host:fs.writeText", description: "Write text to the filesystem." }],
  ["File.writeBytes",      { requiredEffects: ["storage.write"], wasmImport: "host:fs.write",     description: "Write binary data to the filesystem." }],
  ["fs.read",              { requiredEffects: ["storage.read"],  wasmImport: "host:fs.read",      description: "Read from filesystem (short form)." }],
  ["fs.readText",          { requiredEffects: ["storage.read"],  wasmImport: "host:fs.readText",  description: "Read text file (short form)." }],
  ["fs.write",             { requiredEffects: ["storage.write"], wasmImport: "host:fs.write",     description: "Write to filesystem (short form)." }],
  ["fs.writeText",         { requiredEffects: ["storage.write"], wasmImport: "host:fs.writeText", description: "Write text file (short form)." }],
  ["FileSystem.write",     { requiredEffects: ["storage.write"], wasmImport: "host:fs.write",     description: "Write to filesystem." }],

  // ── Network ────────────────────────────────────────────────────────────────
  ["Http.get",             { requiredEffects: ["network.outbound"],  wasmImport: "host:http.get",   description: "HTTP GET request." }],
  ["Http.post",            { requiredEffects: ["network.outbound"],  wasmImport: "host:http.post",  description: "HTTP POST request." }],
  ["Http.put",             { requiredEffects: ["network.outbound"],  wasmImport: "host:http.put",   description: "HTTP PUT request." }],
  ["Http.patch",           { requiredEffects: ["network.outbound"],  wasmImport: "host:http.patch", description: "HTTP PATCH request." }],
  ["Http.delete",          { requiredEffects: ["network.outbound"],  wasmImport: "host:http.delete",description: "HTTP DELETE request." }],
  ["http.get",             { requiredEffects: ["network.outbound"],  wasmImport: "host:http.get",   description: "HTTP GET (short form)." }],
  ["http.post",            { requiredEffects: ["network.outbound"],  wasmImport: "host:http.post",  description: "HTTP POST (short form)." }],
  ["https.get",            { requiredEffects: ["network.outbound"],  wasmImport: "host:https.get",  description: "HTTPS GET request." }],
  ["https.post",           { requiredEffects: ["network.outbound"],  wasmImport: "host:https.post", description: "HTTPS POST request." }],

  // ── Audit ──────────────────────────────────────────────────────────────────
  ["AuditLog.write",       { requiredEffects: ["audit.write"],  wasmImport: "host:audit.write",    description: "Write governance audit record." }],
  ["audit.write",          { requiredEffects: ["audit.write"],  wasmImport: "host:audit.write",    description: "Write to audit log." }],
  ["audit.log",            { requiredEffects: ["audit.write"],  wasmImport: "host:audit.log",      description: "Log audit event." }],

  // ── Secrets ────────────────────────────────────────────────────────────────
  ["Secrets.get",          { requiredEffects: ["secret.read"],  wasmImport: "host:secret.read",    description: "Read a secret value from the vault." }],
  ["Env.get",              { requiredEffects: ["secret.read"],  wasmImport: "host:env.get",        description: "Read an environment variable." }],
  ["env.get",              { requiredEffects: ["secret.read"],  wasmImport: "host:env.get",        description: "Read env var (short form)." }],
  ["env.secret",           { requiredEffects: ["secret.read"],  wasmImport: "host:secret.read",    description: "Read a secret from environment." }],
  ["vault.secret",         { requiredEffects: ["secret.read"],  wasmImport: "host:vault.read",     description: "Read from secret vault." }],

  // ── Database ───────────────────────────────────────────────────────────────
  ["database.find",        { requiredEffects: ["database.read"],  wasmImport: "host:db.find",      description: "Find record(s) by query." }],
  ["database.get",         { requiredEffects: ["database.read"],  wasmImport: "host:db.get",       description: "Get record by ID." }],
  ["database.query",       { requiredEffects: ["database.read"],  wasmImport: "host:db.query",     description: "Execute a database query." }],
  ["database.insert",      { requiredEffects: ["database.write"], wasmImport: "host:db.insert",    description: "Insert a new record." }],
  ["database.update",      { requiredEffects: ["database.write"], wasmImport: "host:db.update",    description: "Update an existing record." }],
  ["database.delete",      { requiredEffects: ["database.write"], wasmImport: "host:db.delete",    description: "Delete a record." }],

  // ── Email ──────────────────────────────────────────────────────────────────
  ["email.send",           { requiredEffects: ["network.outbound", "email.send"], wasmImport: "host:email.send", description: "Send an email." }],
  ["EmailService.send",    { requiredEffects: ["network.outbound", "email.send"], wasmImport: "host:email.send", description: "Send email via service." }],

  // ── AI ─────────────────────────────────────────────────────────────────────
  ["ai.inference",         { requiredEffects: ["ai.inference"],  wasmImport: "host:ai.infer",      description: "Run AI model inference." }],
  ["AI.infer",             { requiredEffects: ["ai.inference"],  wasmImport: "host:ai.infer",      description: "AI inference call." }],
  ["Model.run",            { requiredEffects: ["ai.inference"],  wasmImport: "host:model.run",     description: "Run ML model." }],
  ["Classifier.classify",  { requiredEffects: ["ai.inference"],  wasmImport: "host:classifier.run",description: "Run classifier." }],

  // ── Crypto ─────────────────────────────────────────────────────────────────
  // Note: constantTimeEquals is pure but has special security semantics (FUNGI-TYPE-013)
  ["Crypto.constantTimeEquals", { requiredEffects: [], description: "Constant-time equality for secrets. Never use == on SecureString." }],
  ["Hash.sha256",               { requiredEffects: [], description: "SHA-256 hash (pure computation)." }],
  ["Hash.sha512",               { requiredEffects: [], description: "SHA-512 hash (pure computation)." }],
  // crypto.verify — requires an explicit effect because signature verification
  // may call into a native hardware security module (HSM/TPM) on some targets.
  // Phase 25: wired to host:crypto.verify import in WASM standalone mode.
  ["Crypto.verify",             { requiredEffects: ["crypto.verify"], wasmImport: "host:crypto.verify",  description: "Verify a cryptographic signature (HMAC, Ed25519, etc.). Requires crypto.verify effect." }],
  ["crypto.verify",             { requiredEffects: ["crypto.verify"], wasmImport: "host:crypto.verify",  description: "Verify a cryptographic signature (short form). Requires crypto.verify effect." }],
  ["Crypto.sign",               { requiredEffects: ["crypto.sign"],   wasmImport: "host:crypto.sign",    description: "Sign data with a private key. Requires crypto.sign effect." }],
  ["crypto.sign",               { requiredEffects: ["crypto.sign"],   wasmImport: "host:crypto.sign",    description: "Sign data (short form). Requires crypto.sign effect." }],
  // Phase 34: bcrypt password verification. verify accepts a raw plaintext by design
  // (it IS the comparison sink) — bcryptjs.compareSync is constant-time internally.
  ["BCrypt.verify",             { requiredEffects: ["crypto.verify"], wasmImport: "host:bcrypt.verify",  description: "Verify a plaintext password against a bcrypt hash. Requires crypto.verify effect." }],
  ["BCrypt.hash",               { requiredEffects: ["crypto.verify"], wasmImport: "host:bcrypt.hash",    description: "Produce a bcrypt hash (for fixtures/tooling). Requires crypto.verify effect." }],
  // Phase 35: Password API — stable facade. Call sites never change across phases.
  ["Password.verify",           { requiredEffects: ["crypto.verify"], wasmImport: "host:password.verify",      description: "Verify plaintext against stored hash (auto-detects bcrypt/Argon2id). Requires crypto.verify." }],
  ["Password.hash",             { requiredEffects: ["crypto.verify"], wasmImport: "host:password.hash",        description: "Hash a plaintext with the current preferred algorithm (Argon2id in Phase 36+)." }],
  ["Password.needsMigration",   { requiredEffects: [],                wasmImport: "host:password.needs_migration", description: "Returns true if the hash uses a weaker algorithm than the current preferred." }],
  ["Password.migrate",          { requiredEffects: ["crypto.verify"], wasmImport: "host:password.migrate",     description: "Verify + re-hash to current preferred algorithm on successful verify (Phase 37)." }],
  // Phase 36: Argon2id — OWASP preferred memory-hard KDF
  ["Argon2.verify",             { requiredEffects: ["crypto.verify"], wasmImport: "host:argon2.verify",        description: "Verify a plaintext against an Argon2id hash. Requires crypto.verify effect." }],
  ["Argon2.hash",               { requiredEffects: ["crypto.verify"], wasmImport: "host:argon2.hash",          description: "Hash a plaintext with Argon2id. Requires crypto.verify effect." }],

  // ── Random (requires effect) ───────────────────────────────────────────────
  ["Random.secureBytes",   { requiredEffects: ["random.generate"], wasmImport: "host:random.bytes", description: "Generate cryptographically secure random bytes." }],
  ["Random.bytes",         { requiredEffects: ["random.generate"], wasmImport: "host:random.bytes", description: "Generate random bytes." }],

  // ── Clock (requires effect for non-deterministic form) ────────────────────
  ["Clock.now",            { requiredEffects: ["clock.read"],  wasmImport: "host:clock.now",        description: "Get current time (non-deterministic — requires effect)." }],
]);

// ---------------------------------------------------------------------------
// STDLIB_MODULE_KIND
//
// Classifies each stdlib module as pure (WASM-safe, JIT-optimizable,
// GPU/NPU candidate) or effectful (must appear in WASM import table).
// ---------------------------------------------------------------------------

export type StdlibModuleKind = "pure" | "effectful";

export const STDLIB_MODULE_KIND: ReadonlyMap<string, StdlibModuleKind> = new Map([
  // Pure (zero imports in WASM, safe for GPU/NPU/APU)
  ["String",      "pure"],
  ["Char",        "pure"],
  ["Array",       "pure"],
  ["List",        "pure"],
  ["Option",      "pure"],
  ["Result",      "pure"],
  ["Math",        "pure"],
  ["Decimal",     "pure"],
  ["Json",        "pure"],
  ["Bytes",       "pure"],
  ["Tensor",      "pure"],
  ["Vector",      "pure"],
  ["Matrix",      "pure"],
  ["Tri",         "pure"],   // TriState — photonic/ternary candidate
  ["Hash",        "pure"],
  ["Crypto",      "pure"],   // pure math (constantTimeEquals, hash, sign)
  ["Random",      "pure"],   // deterministic form: Random.fromSeed(n)

  // Effectful (require WASM imports / effect declarations)
  ["File",        "effectful"],
  ["FileSystem",  "effectful"],
  ["fs",          "effectful"],
  ["Http",        "effectful"],
  ["http",        "effectful"],
  ["https",       "effectful"],
  ["Database",    "effectful"],
  ["database",    "effectful"],
  ["AuditLog",    "effectful"],
  ["audit",       "effectful"],
  ["Secrets",     "effectful"],
  ["Env",         "effectful"],
  ["env",         "effectful"],
  ["vault",       "effectful"],
  ["EmailService","effectful"],
  ["email",       "effectful"],
  ["AI",          "effectful"],
  ["ai",          "effectful"],
  ["Model",       "effectful"],
  ["Classifier",  "effectful"],
  ["Clock",       "effectful"],  // Clock.now() — deterministic form is Clock.fromContext()
  ["Random",      "effectful"],  // Random.secureBytes() — deterministic form is Random.fromSeed()
]);

// ---------------------------------------------------------------------------
// TENSOR_STDLIB_OPS
//
// Tensor operations with compute target compatibility flags.
// The target planner uses these to decide which backend to use.
// See: galerina-stdlib-architecture.md
// ---------------------------------------------------------------------------

export interface TensorOpInfo {
  /** Operation is pure (no effects, no I/O). */
  readonly pure: boolean;
  /** Element-wise ops compatible with WASM SIMD (Float32/Float64/Int8). */
  readonly wasmSimd: boolean;
  /** Compatible with GPU shader execution (element-wise Float32/Float16). */
  readonly gpu: boolean;
  /** Compatible with NPU fixed-function execution (Float32/Int8, static shapes). */
  readonly npu: boolean;
  /** Compatible with APU shared-memory zero-copy (readonly, fixed shape). */
  readonly apu: boolean;
  /** Human-readable description for AI tooling and diagnostics. */
  readonly description: string;
}

export const TENSOR_STDLIB_OPS: ReadonlyMap<string, TensorOpInfo> = new Map([
  ["Tensor.matmul",      { pure: true, wasmSimd: true,  gpu: true,  npu: true,  apu: false, description: "Matrix multiplication of two tensors." }],
  ["Tensor.dot",         { pure: true, wasmSimd: true,  gpu: true,  npu: true,  apu: true,  description: "Dot product of two rank-1 or rank-2 tensors." }],
  ["Tensor.transpose",   { pure: true, wasmSimd: true,  gpu: true,  npu: true,  apu: true,  description: "Transpose the last two dimensions." }],
  ["Tensor.normalize",   { pure: true, wasmSimd: true,  gpu: true,  npu: true,  apu: false, description: "L2 normalize along last dimension." }],
  ["Tensor.relu",        { pure: true, wasmSimd: true,  gpu: true,  npu: true,  apu: true,  description: "Rectified linear unit activation: max(0, x)." }],
  ["Tensor.softmax",     { pure: true, wasmSimd: true,  gpu: true,  npu: true,  apu: false, description: "Softmax along last dimension." }],
  ["Tensor.add",         { pure: true, wasmSimd: true,  gpu: true,  npu: true,  apu: true,  description: "Element-wise addition." }],
  ["Tensor.sub",         { pure: true, wasmSimd: true,  gpu: true,  npu: true,  apu: true,  description: "Element-wise subtraction." }],
  ["Tensor.mul",         { pure: true, wasmSimd: true,  gpu: true,  npu: true,  apu: true,  description: "Element-wise multiplication (Hadamard product)." }],
  ["Tensor.scale",       { pure: true, wasmSimd: true,  gpu: true,  npu: true,  apu: true,  description: "Scale all elements by a scalar." }],
  ["Tensor.quantize",    { pure: true, wasmSimd: true,  gpu: false, npu: true,  apu: true,  description: "Quantize Float32 to Int8 with scale and zero-point." }],
  ["Tensor.dequantize",  { pure: true, wasmSimd: true,  gpu: true,  npu: true,  apu: true,  description: "Dequantize Int8 back to Float32." }],
  ["Tensor.reshape",     { pure: true, wasmSimd: false, gpu: true,  npu: true,  apu: true,  description: "Reshape tensor to new dimensions (same total elements)." }],
  ["Tensor.slice",       { pure: true, wasmSimd: false, gpu: true,  npu: true,  apu: true,  description: "Extract a sub-tensor (returns a view when possible)." }],
  ["Tensor.concat",      { pure: true, wasmSimd: false, gpu: true,  npu: true,  apu: false, description: "Concatenate tensors along a given dimension." }],
  ["Tensor.mean",        { pure: true, wasmSimd: true,  gpu: true,  npu: true,  apu: false, description: "Mean of all elements or along a dimension." }],
  ["Tensor.sum",         { pure: true, wasmSimd: true,  gpu: true,  npu: true,  apu: true,  description: "Sum of all elements or along a dimension." }],
  ["Tensor.toDevice",    { pure: false, wasmSimd: false, gpu: true, npu: true,  apu: true,  description: "Transfer tensor to a compute device buffer." }],
  ["Tensor.fromDevice",  { pure: false, wasmSimd: false, gpu: true, npu: true,  apu: true,  description: "Retrieve tensor from a compute device buffer." }],
]);

// ---------------------------------------------------------------------------
// TRI_STDLIB_OPS
//
// TriState (Negative / Neutral / Positive) operations.
// All are pure — zero-import WASM functions.
// Photonic/ternary backends can map these to balanced ternary arithmetic.
// ---------------------------------------------------------------------------

export interface TriOpInfo {
  readonly pure: boolean;
  /** Can map to balanced ternary arithmetic on a photonic backend. */
  readonly photonicCompatible: boolean;
  readonly description: string;
}

export const TRI_STDLIB_OPS: ReadonlyMap<string, TriOpInfo> = new Map([
  ["Tri.and",        { pure: true, photonicCompatible: true,  description: "TriState AND: min(a, b) in ternary logic." }],
  ["Tri.or",         { pure: true, photonicCompatible: true,  description: "TriState OR: max(a, b) in ternary logic." }],
  ["Tri.not",        { pure: true, photonicCompatible: true,  description: "TriState NOT: negation (Negative↔Positive, Neutral unchanged)." }],
  ["Tri.toBool",     { pure: true, photonicCompatible: false, description: "Convert Tri to Bool using an explicit policy (requires FUNGI-SAFETY-003 approval)." }],
  ["Tri.toDecision", { pure: true, photonicCompatible: false, description: "Convert Tri to Decision type using a declared conversion policy." }],
  ["Tri.match",      { pure: true, photonicCompatible: true,  description: "Exhaustive match on all three Tri states. Required by FUNGI-TYPE-021." }],
  ["Tri.fromBool",   { pure: true, photonicCompatible: false, description: "Convert Bool to Tri (true→Positive, false→Negative, no Neutral)." }],
]);

// ---------------------------------------------------------------------------
// Stdlib effect lookup
//
// Given a full qualified call name, returns required effects.
// Returns [] for pure stdlib calls.
// ---------------------------------------------------------------------------

/**
 * Returns the required effects for a stdlib function call, or undefined if
 * the call is not in the STDLIB_CAPABILITY_MAP.
 */
export function getStdlibRequiredEffects(fullCallName: string): readonly string[] | undefined {
  const entry = STDLIB_CAPABILITY_MAP.get(fullCallName);
  return entry?.requiredEffects;
}

/**
 * Returns the module kind for a top-level stdlib module name.
 * Returns undefined for unknown/user-defined modules.
 */
export function getStdlibModuleKind(moduleName: string): StdlibModuleKind | undefined {
  return STDLIB_MODULE_KIND.get(moduleName);
}

/**
 * Returns the WASM import entry name for a stdlib function.
 * Used by the WASM backend to build the import table.
 * Returns undefined for pure functions (no import needed).
 */
export function getStdlibWasmImport(fullCallName: string): string | undefined {
  return STDLIB_CAPABILITY_MAP.get(fullCallName)?.wasmImport;
}

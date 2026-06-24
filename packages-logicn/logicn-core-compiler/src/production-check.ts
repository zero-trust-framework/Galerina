// =============================================================================
// Phase 29C — Production Readiness Check
//
// Verifies a compiled LogicN program is ready for production deployment by
// inspecting diagnostics for errors and blockers.
//
// Usage:
//   const diagnostics = [...checkEffects(ast).diagnostics, ...checkTypes(ast).diagnostics];
//   const readiness = checkProductionReadiness(diagnostics);
//   if (!readiness.ready) console.error(readiness.blockers);
// =============================================================================

/**
 * A minimal diagnostic shape compatible with CompilerDiagnostic, EffectDiagnostic,
 * TypeDiagnostic, and any other diagnostic type emitted by the LogicN compiler.
 */
interface DiagnosticLike {
  readonly code?: string;
  readonly severity?: string;
  readonly message?: string;
}

/** Diagnostic codes that unconditionally block production deployment. */
const PRODUCTION_BLOCKERS: ReadonlySet<string> = new Set([
  // Security policy violations
  "LLN-SEC-020",
  "LLN-SEC-021",
  // Safety violations
  "LLN-SAFETY-001",
  "LLN-SAFETY-002",
  "LLN-SAFETY-003",
  "LLN-SAFETY-004",
  "LLN-SAFETY-005",
  // Governed-value access
  "LLN-RUNTIME-005",
  // Audit violations
  "LLN-RUNTIME-007",
  // Memory safety — only LLN-MEMORY-008 (unsafe-block-missing-reason) has a WIRED emitter today
  // (detectUnsafeBlockWithoutReason). LLN-MEMORY-001/002/003/007 (use-after-move / borrow-after-move /
  // borrow-escapes-scope / unchecked-access) are RESERVED: NO compiler pass emits them, so listing them
  // here advertised a production memory-safety block the gate cannot actually detect — a false capability
  // claim (RD-0124 audit, single-most-important finding). Re-add each ONLY when its move/borrow detector
  // is wired and emitting; a non-emittable PRODUCTION_BLOCKER misleads any operator who trusts ready=true.
  // (Real move/borrow checking is a separate, larger build — a LATER roadmap item.)
  "LLN-MEMORY-008",
  // Raw pointer outside unsafe
  "LLN-RAWPTR-001",
  // Install script denied (supply chain)
  "LLN-PKG-004",
  // Unsafe dynamic code
  "LLN-SOURCE-ESCAPE-001",
  // Non-deterministic build
  "LLN-BUILD-001",
  // Effects not declared (production mode)
  "LLN-STDLIB-001",
]);

/**
 * Check whether a set of compiler diagnostics indicates the program is ready
 * for production deployment.
 *
 * @param diagnostics - The flat array of all diagnostics from all compiler passes.
 * @returns A production-readiness summary.
 *
 * Rules:
 *   - Any diagnostic with `severity === "error"` increments the error count.
 *   - Any diagnostic with a code in PRODUCTION_BLOCKERS is added to `blockers`.
 *   - `ready === true` only when `errors === 0` and `blockers.length === 0`.
 */
export function checkProductionReadiness(diagnostics: readonly unknown[]): {
  readonly ready: boolean;
  readonly errors: number;
  readonly warnings: number;
  readonly blockers: readonly string[];
} {
  let errors = 0;
  let warnings = 0;
  const blockers: string[] = [];

  for (const raw of diagnostics) {
    const d = raw as DiagnosticLike;
    const severity = d.severity ?? "error";
    const code = d.code ?? "";
    const message = d.message ?? code;

    if (severity === "error") {
      errors++;
    } else if (severity === "warning") {
      warnings++;
    }

    // A diagnostic is a blocker if it has an explicitly blocked code, OR if
    // it is an error without a known code (unknown errors block by default).
    const isBlockedCode = code !== "" && PRODUCTION_BLOCKERS.has(code);
    const isUnknownError = severity === "error" && code === "";
    if (isBlockedCode || isUnknownError) {
      blockers.push(message !== "" ? `${code !== "" ? code + ": " : ""}${message}` : code);
    }
  }

  return {
    ready: errors === 0 && blockers.length === 0,
    errors,
    warnings,
    blockers: Object.freeze(blockers),
  };
}

// =============================================================================
// Stage B — Root Capability Provider (Phase 14)
//
// Separates compiler authority from user program authority.
// These two capability scopes must NEVER be merged.
//
// The compiler needs:  storage.read, storage.write, package.read,
//                      manifest.read, report.write, compiler.graph.*
//
// User programs need:  database.read, network.outbound, etc.
//
// Authority separation is enforced at construction time: createCompilerHost()
// and createUserRuntime() return distinct, non-overlapping capability objects.
// =============================================================================

// ---------------------------------------------------------------------------
// Domain discriminant
// ---------------------------------------------------------------------------

export type CapabilityDomain =
  | "BOOTSTRAP"
  | "COMPILER"
  | "BUILD"
  | "USER_PROGRAM"
  | "RUNTIME";

// ---------------------------------------------------------------------------
// Compiler-side capability host
// ---------------------------------------------------------------------------

export interface CompilerCapabilityHost {
  readonly domain: "COMPILER";
  readonly allowedCapabilities: ReadonlySet<string>;

  /** Returns true when the compiler is permitted to use this capability. */
  check(capability: string): boolean;

  /**
   * Records an audit entry for the capability use.
   * Throws if the capability is not in the allowed set.
   */
  use(capability: string, resource: string): void;
}

// ---------------------------------------------------------------------------
// User-program-side capabilities
// ---------------------------------------------------------------------------

export interface UserRuntimeCapabilities {
  readonly domain: "USER_PROGRAM";
  readonly declaredEffects: ReadonlySet<string>;

  /** Returns true when the user program may use this effect. */
  canUse(effect: string): boolean;
}

// ---------------------------------------------------------------------------
// Audit log entry
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  readonly domain: string;
  readonly capability: string;
  readonly resource: string;
  readonly timestamp: string;
}

// ---------------------------------------------------------------------------
// Root provider interface
// ---------------------------------------------------------------------------

export interface RootCapabilityProvider {
  createCompilerHost(capabilities: Set<string>): CompilerCapabilityHost;
  createUserRuntime(declaredEffects: Set<string>): UserRuntimeCapabilities;
  audit(domain: CapabilityDomain, capability: string, resource: string): void;
  getAuditLog(): readonly AuditLogEntry[];
}

// ---------------------------------------------------------------------------
// Compiler minimum capability set
// ---------------------------------------------------------------------------

/**
 * The minimum set of capabilities required for the Galerina compiler to function.
 * Network, database, secret, email, and payment capabilities are intentionally
 * excluded — the compiler must never touch those surfaces.
 */
export const COMPILER_MINIMUM_CAPABILITIES: ReadonlySet<string> = new Set([
  "storage.read",
  "storage.write",
  "package.read",
  "manifest.read",
  "report.write",
  "compiler.graph.read",
  "compiler.graph.write",
]);

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRootCapabilityProvider(): RootCapabilityProvider {
  const auditLog: AuditLogEntry[] = [];

  function audit(
    domain: CapabilityDomain,
    capability: string,
    resource: string,
  ): void {
    auditLog.push({
      domain,
      capability,
      resource,
      timestamp: new Date().toISOString(),
    });
  }

  function createCompilerHost(capabilities: Set<string>): CompilerCapabilityHost {
    const allowed: ReadonlySet<string> = new Set(capabilities);

    return {
      domain: "COMPILER",
      allowedCapabilities: allowed,

      check(capability: string): boolean {
        return allowed.has(capability);
      },

      use(capability: string, resource: string): void {
        if (!allowed.has(capability)) {
          throw new Error(
            `Compiler capability denied: "${capability}" is not in the allowed set. ` +
            `Allowed: ${[...allowed].join(", ")}`,
          );
        }
        audit("COMPILER", capability, resource);
      },
    };
  }

  function createUserRuntime(declaredEffects: Set<string>): UserRuntimeCapabilities {
    const effects: ReadonlySet<string> = new Set(declaredEffects);

    return {
      domain: "USER_PROGRAM",
      declaredEffects: effects,

      canUse(effect: string): boolean {
        return effects.has(effect);
      },
    };
  }

  return {
    createCompilerHost,
    createUserRuntime,
    audit,
    getAuditLog(): readonly AuditLogEntry[] {
      return auditLog;
    },
  };
}

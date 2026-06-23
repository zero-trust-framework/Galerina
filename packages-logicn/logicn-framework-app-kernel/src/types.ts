/**
 * App Kernel core contracts (framework P1).
 *
 * A route DECLARATION is what a developer writes — only the deltas from the
 * secure defaults. The EFFECTIVE policy is what the kernel enforces (defaults +
 * overrides), with every explicit relaxation recorded for the security report.
 * See design-doc §10 (secure-by-default route policy).
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";

/** Methods that mutate state — idempotency is auto-enabled for these. */
export const MUTATING_METHODS: ReadonlySet<HttpMethod> = new Set<HttpMethod>([
  "POST", "PUT", "PATCH", "DELETE",
]);

export type AuthMode = "required" | "public";
export interface AuthPolicy {
  readonly mode: AuthMode;
  readonly scopes: readonly string[];
  /**
   * Legacy escape hatch (default `false` = TIGHTENED / fail-closed). When a `required`-auth route
   * receives NO `channelVerdict`, the kernel previously admitted on mere Authorization-HEADER PRESENCE —
   * which is not a real verification of the token (any non-empty header passed). With this flag `false`
   * (the default), header-presence alone NO LONGER admits: the route demands an actual channel/identity
   * verdict, or it 401s. Set `true` ONLY to opt a route back into the weaker presence-only behaviour
   * (e.g. a deployment whose token validation genuinely lives upstream). Deny-by-default; opt-in to relax.
   */
  readonly allowHeaderPresenceFallback?: boolean;
}

export type UnknownFieldsMode = "deny" | "strip" | "allow";
export type DuplicateKeysMode = "deny" | "lastWins";
export interface BodyPolicy {
  readonly contentType: string;
  readonly maxSizeBytes: number;
  readonly unknownFields: UnknownFieldsMode;
  readonly duplicateKeys: DuplicateKeysMode;
}

export interface IdempotencyPolicy {
  readonly enabled: boolean;
  readonly header: string;
  readonly ttlSeconds: number;
  readonly onDuplicate: "reject" | "replay";
}

export interface LimitsPolicy {
  readonly rate: string;
  readonly maxConcurrent: number;
  readonly memoryBytes: number;
  readonly timeoutMs: number;
}

export interface AuditPolicy {
  readonly runtimeReport: boolean;
}

/** What a developer writes — only the deltas from the secure defaults. */
export interface RouteDeclaration {
  readonly method: HttpMethod;
  readonly path: string;
  readonly handler: string;
  readonly requestType?: string;
  readonly responseType?: string;
  readonly auth?: Partial<AuthPolicy>;
  readonly body?: Partial<BodyPolicy>;
  /** `false` disables idempotency explicitly; otherwise overrides the method-aware default. */
  readonly idempotency?: Partial<IdempotencyPolicy> | false;
  readonly limits?: Partial<LimitsPolicy>;
  readonly audit?: Partial<AuditPolicy>;
}

/** The fully-resolved policy the kernel enforces (defaults + overrides). */
export interface EffectiveRoutePolicy {
  readonly method: HttpMethod;
  readonly path: string;
  readonly handler: string;
  readonly requestType: string | undefined;
  readonly responseType: string | undefined;
  readonly auth: AuthPolicy;
  readonly body: BodyPolicy;
  readonly idempotency: IdempotencyPolicy;
  readonly limits: LimitsPolicy;
  readonly audit: AuditPolicy;
  /** Blocks that came from the secure defaults (not declared by the developer). */
  readonly appliedDefaults: readonly string[];
  /** Explicit security relaxations — recorded for the security report. */
  readonly relaxations: readonly string[];
}

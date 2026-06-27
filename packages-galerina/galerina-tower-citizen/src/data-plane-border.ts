/**
 * data-plane-border.ts — the per-user data hard border (owner note 54 / IDOR).
 *
 * Formalizes the data-plane access contract as a K3 capability set-intersection at the query boundary:
 *
 *     Qexecuted = Q ∩ S_user
 *
 *   Q          — the developer's declared query scope (the rows the flow asks for)
 *   S_user     — the caller's CRYPTOGRAPHICALLY-PROVEN tenant scope (from the .tmf passport)
 *   Qexecuted  — the rows actually returned: Q narrowed to what the caller may see
 *
 * The load-bearing rule that defeats `?user_id=victim` (IDOR / CWE-639): S_user is taken ONLY from the
 * proven passport, NEVER from a developer/request parameter. A param naming a tenant is tainted input and is
 * structurally ignored here. A developer `where` predicate may only further NARROW within the admitted set —
 * it can never widen it and is never the source of identity.
 *
 * Per-row admission is the shipped K3 algebra (three-valued-governance.ts), NOT re-implemented:
 *
 *     sharedRowLane = ALLOW  iff (vault is an ATTESTED-public vault AND row.owner ∈ publicSharedScopes)
 *                            else INDETERMINATE
 *     ownerLane     = ALLOW  iff row.ownerScope ∈ S_user   else DENY
 *     admit         = vOr(sharedRowLane, ownerLane)        // admitted ⟺ authorize(admit) ⟺ admit === ALLOW
 *
 * Because `authorize` is `v === ALLOW` and an INDETERMINATE collapses to deny, the contract is fail-closed:
 * any row whose ownership is not provably in S_user, and which is not a declared-shared row in an attested-
 * public vault, is denied — there is no third path that returns it. A foreign PRIVATE row co-resident in a
 * public vault is denied (its sharedRowLane is INDETERMINATE, its ownerLane is DENY ⇒ vOr = INDETERMINATE).
 *
 * Visibility (public/private) is a K3 decision with a fail-closed PRIVATE default: an un-declared, mistyped,
 * or unknown vault resolves to PRIVATE (strict intersection). ONLY the exact attested token `"public"` in the
 * signed vault manifest widens exposure. The asymmetry the owner asked for: a developer mistake (a forgotten
 * or typo'd marker) can only make the system MORE restrictive (over-deny), never leak.
 *
 * Provenance: ported from R&D note-54 (`data-plane-hard-border/`, workflow `data-plane-54-intersection`),
 * whose v2 red-bench (post-adversarial-review) is mirrored 1:1 by tests/data-plane-border.test.mjs.
 *
 * Honest scope (so a green test is not mis-read as "IDOR closed in production"):
 *  - This is the per-row ADMISSION contract. It does NOT model COUNT/aggregate existence oracles, cross-vault
 *    JOIN, ORDER BY / LIMIT / OFFSET pagination oracles, or the scope-granularity invariant (a proven scope
 *    must be as fine-grained as the tenant boundary). Those are the next sub-specs.
 *  - It is leak-proof against Adversary 1 (the caller/developer query) given a correct signed manifest.
 *    Adversary 2 (a malicious manifest author flipping a vault public) is a governance/audit concern
 *    (manifest signing + append-only audit of exposure-widening) — out of scope here. Even so, a silent
 *    public-flip can only expose rows already owned by a declared shared scope, never a private-owned row.
 *  - Builds ON the shipped param-taint (done/0031) and separate-presence-channel (done/0037) work — not re-claimed.
 */

import { Verdict, vOr, authorize } from "./three-valued-governance.js";

/** A vault's signed-manifest declaration. `visibility` is a free string on purpose: only the exact token
 *  "public" widens exposure, so a typo / unknown value resolves to PRIVATE (fail-closed) rather than erroring. */
export interface VaultManifestEntry {
  readonly visibility: string;
}

/** The vault registry as declared in the signed manifest (vaultId → entry). */
export type VaultRegistry = Readonly<Record<string, VaultManifestEntry>>;

/** A data row as the governed engine sees it. `ownerScope` is the cryptographic tenant scope gated on. */
export interface DataRow {
  readonly ownerScope: string;
  readonly vaultId: string;
}

/** The caller's cryptographically-proven tenant scope (from the .tmf passport). NEVER a query parameter. */
export type UserScope = ReadonlySet<string>;

/** The data-plane border policy: the signed vault registry + the (signed) set of world-shared scopes. */
export interface BorderPolicy {
  readonly registry: VaultRegistry;
  /**
   * Scopes whose rows are world-shared WHEN (and only when) they live in an attested-public vault. Itself a
   * signed-manifest governance input. Default: EMPTY — the most-secure posture, where an attested-public
   * vault still admits only the caller's OWN rows until a shared scope is explicitly declared.
   */
  readonly publicSharedScopes?: ReadonlySet<string>;
}

/**
 * Is a vault attested public? ONLY an exact, declared `visibility: "public"` yields true. An un-declared
 * vault, a typo (`"privatte"`), or any unknown value is NOT public (fail-closed) — its rows must prove ownership.
 */
export function vaultIsPublic(vaultId: string, registry: VaultRegistry): boolean {
  const decl = registry[vaultId];
  if (decl === undefined) return false; // un-declared vault ⇒ NOT public
  return decl.visibility === "public"; // exact token only
}

/** The per-row K3 admission verdict: `vOr(sharedRowLane, ownerLane)`. ALLOW ⇒ admitted; otherwise denied. */
export function admitRowVerdict(row: DataRow, sUser: UserScope, policy: BorderPolicy): Verdict {
  const publicShared = policy.publicSharedScopes ?? EMPTY_SCOPES;
  const isPublicVault = vaultIsPublic(row.vaultId, policy.registry);
  const sharedRowLane: Verdict = isPublicVault && publicShared.has(row.ownerScope) ? Verdict.ALLOW : Verdict.INDETERMINATE;
  const ownerLane: Verdict = sUser.has(row.ownerScope) ? Verdict.ALLOW : Verdict.DENY;
  return vOr(sharedRowLane, ownerLane);
}

/** True iff the row is admitted to the caller (its admission verdict is exactly ALLOW). */
export function admitRow(row: DataRow, sUser: UserScope, policy: BorderPolicy): boolean {
  return authorize(admitRowVerdict(row, sUser, policy));
}

/**
 * `Qexecuted = Q ∩ S_user` — filter `candidates` to the rows the caller may see. An optional developer
 * predicate `where` may only further NARROW within the admitted set; it is applied AFTER admission, so it can
 * never widen exposure and is never the source of identity (a forged `?user_id=` cannot reach this function —
 * the caller scope is `sUser`, the proven passport, only).
 */
export function intersectUserScope<T extends DataRow>(
  candidates: readonly T[],
  sUser: UserScope,
  policy: BorderPolicy,
  where: (row: T) => boolean = () => true,
): T[] {
  return candidates.filter((r) => admitRow(r, sUser, policy) && where(r));
}

const EMPTY_SCOPES: ReadonlySet<string> = new Set<string>();

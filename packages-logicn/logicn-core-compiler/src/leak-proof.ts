/**
 * leak-proof.ts — the AI-code-gen referee's STRUCTURAL LEAK PROOF: a stable, versioned, machine-consumable
 * JSON shape that an autonomous LLM application-writer can read to self-patch the exact capability/governance
 * leak the compiler proved — closing the loop from "the LLM wrote code that violates a boundary" to "the LLM
 * fixes it" without a human in the middle.
 *
 * It is a NORMALIZED projection of the compiler's governance diagnostics (the LLN-TENANT/SECRET/VALUESTATE/
 * PRIVACY/EFFECT/STDLIB/SUBSTRATE families) into one schema with: the capability that crossed the boundary,
 * the violation site + the source/context anchors, the rule (why) + the consequence (risk), and a
 * machine-applicable fix (kind + suggestedCode). Fail-closed / deny-by-default: ANY error-severity leak makes
 * the whole-module verdict `leak`; only a module with zero leaks is `clean`. Deterministic (canonicalLeakProof)
 * so it can be signed into a TestWitness and diffed in a PR.
 */

import type { EffectDiagnostic } from "./effect-checker.js";

export type LeakCategory =
  | "tenant-isolation"   // LLN-TENANT-*    — cross-tenant / IDOR (a capability reaching another tenant's scope)
  | "secret-egress"      // LLN-SECRET-*, LLN-VALUESTATE-* — a secret/unsafe value reaching a governed sink
  | "privacy-egress"     // LLN-PRIVACY-*   — PII / cleartext embedding leaving the trust boundary
  | "undeclared-effect"  // LLN-EFFECT-*, LLN-STDLIB-* — a capability used but not declared in effects {}
  | "substrate-misuse"   // LLN-SUBSTRATE-* — crypto/external-reach on a noisy/photonic (untrusted) lane
  | "other";

export interface CodeAnchor {
  readonly file?: string | undefined;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
  readonly note?: string | undefined;
}

export interface LeakFix {
  readonly kind:
    | "declare-effect"        // add the missing capability to effects {}
    | "redact-or-seal"        // redact()/seal() the value before the sink
    | "grant-capability"      // grant the capability in access {}
    | "move-to-digital-lane"  // substrate { lane: digital } — integrity/reach is not tolerance-bounded
    | "bind-tenant-scope"     // bind the access to the caller's proven tenant.scope
    | "remove-sink"           // the value must not reach this sink at all
    | "manual";               // requires a human decision (no safe auto-fix)
  /** The working form, ready for `logicn fix` / the LLM to apply directly (when the compiler emitted one). */
  readonly suggestedCode?: string | undefined;
  readonly explanation: string;
}

export interface LeakFinding {
  readonly code: string;                 // the originating LLN-* governance code
  readonly category: LeakCategory;
  readonly severity: "deny" | "warn";    // error → deny, warning → warn
  /** The capability/effect involved (e.g. "network.outbound", "secret.read"), best-effort extracted. */
  readonly capability: string;
  readonly site: CodeAnchor;             // the violation site (the sink)
  readonly related: readonly CodeAnchor[]; // secondary anchors (the source / context)
  readonly why: string;                  // why it is a violation (the rule)
  readonly risk: string;                 // what goes wrong if ignored
  readonly fix: LeakFix;
}

export interface CapabilityLeakProof {
  readonly schema: "lln.leakproof.v1";
  /** Whole-module verdict: `leak` if ANY error-severity finding (deny-by-default), else `clean`. */
  readonly verdict: "clean" | "leak";
  readonly leaks: readonly LeakFinding[];
  readonly summary: { readonly total: number; readonly denies: number; readonly byCategory: Readonly<Record<string, number>> };
}

// Code-prefix → category (only these families are leaks; type/syntax/import codes are NOT capability leaks).
const PREFIX_CATEGORY: ReadonlyArray<readonly [string, LeakCategory]> = [
  ["LLN-TENANT-", "tenant-isolation"],
  ["LLN-SECRET-", "secret-egress"],
  ["LLN-VALUESTATE-", "secret-egress"],
  ["LLN-PRIVACY-", "privacy-egress"],
  ["LLN-EFFECT-", "undeclared-effect"],
  ["LLN-STDLIB-", "undeclared-effect"],
  ["LLN-SUBSTRATE-", "substrate-misuse"],
];

const CATEGORY_FIX_KIND: Readonly<Record<LeakCategory, LeakFix["kind"]>> = {
  "tenant-isolation": "bind-tenant-scope",
  "secret-egress": "redact-or-seal",
  "privacy-egress": "redact-or-seal",
  "undeclared-effect": "declare-effect",
  "substrate-misuse": "move-to-digital-lane",
  other: "manual",
};

/** The canonical effect/capability vocabulary — used to extract the leaked capability from a message. */
const CAPABILITY_RE =
  /\b((?:network|database|filesystem|file|secret|audit|crypto|http|https|pii|phi|email|payment|process|worker|event|desktop|unsafe|ai|compute)\.[a-z][a-z.]*)\b/;

function categoryFor(code: string): LeakCategory | null {
  for (const [prefix, cat] of PREFIX_CATEGORY) if (code.startsWith(prefix)) return cat;
  return null; // not a capability-leak code
}

function extractCapability(d: EffectDiagnostic): string {
  const hay = `${d.message} ${d.name ?? ""}`;
  const m = CAPABILITY_RE.exec(hay);
  return m?.[1] ?? "unknown";
}

function anchor(loc: EffectDiagnostic["location"], note?: string): CodeAnchor {
  return { file: loc?.file, line: loc?.line, column: loc?.column, note };
}

/**
 * Project the compiler's governance diagnostics into a structural leak proof, fail-closed. Non-leak codes
 * (type/syntax/import) are ignored; info-severity is ignored; an error → a `deny` finding; a warning → `warn`.
 * The module verdict is `leak` iff there is at least one `deny` finding (deny-by-default).
 */
export function buildLeakProof(diagnostics: readonly EffectDiagnostic[]): CapabilityLeakProof {
  const leaks: LeakFinding[] = [];
  for (const d of diagnostics) {
    if (d.severity === "info") continue;
    const category = categoryFor(d.code);
    if (category === null) continue; // not a capability leak — out of scope for this proof
    const fixKind = CATEGORY_FIX_KIND[category];
    leaks.push({
      code: d.code,
      category,
      severity: d.severity === "error" ? "deny" : "warn",
      capability: extractCapability(d),
      site: anchor(d.location, d.name),
      related: (d.relatedLocations ?? []).map((r) => anchor(r.location, r.message)),
      why: d.why ?? d.message,
      risk: d.risk ?? "A capability crosses a governed boundary; deny-by-default until remedied.",
      fix: {
        kind: d.suggestedCode ? fixKind : fixKind === "manual" ? "manual" : fixKind,
        suggestedCode: d.suggestedCode,
        explanation: d.suggestedFix ?? `Remedy the ${category} violation (${d.code}).`,
      },
    });
  }
  const denies = leaks.filter((l) => l.severity === "deny").length;
  const byCategory: Record<string, number> = {};
  for (const l of leaks) byCategory[l.category] = (byCategory[l.category] ?? 0) + 1;
  return {
    schema: "lln.leakproof.v1",
    verdict: denies > 0 ? "leak" : "clean", // deny-by-default: any error-severity leak fails the module
    leaks,
    summary: { total: leaks.length, denies, byCategory },
  };
}

/** Deterministic serialization (stable key order) — the basis for signing into a TestWitness + PR diffs. */
export function canonicalLeakProof(p: CapabilityLeakProof): string {
  const fld = (l: LeakFinding) => ({
    code: l.code, category: l.category, severity: l.severity, capability: l.capability,
    site: l.site, related: l.related, why: l.why, risk: l.risk,
    fix: { kind: l.fix.kind, suggestedCode: l.fix.suggestedCode, explanation: l.fix.explanation },
  });
  // byCategory key order follows input order (JS preserves insertion order) — sort it for a stable signature.
  const byCategory = Object.fromEntries(Object.entries(p.summary.byCategory).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify({
    schema: p.schema,
    verdict: p.verdict,
    summary: { total: p.summary.total, denies: p.summary.denies, byCategory },
    leaks: [...p.leaks].sort((a, b) => (a.code + JSON.stringify(a.site)).localeCompare(b.code + JSON.stringify(b.site))).map(fld),
  });
}

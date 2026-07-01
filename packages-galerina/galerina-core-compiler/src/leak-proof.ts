/**
 * leak-proof.ts — the AI-code-gen referee's STRUCTURAL LEAK PROOF: a stable, versioned, machine-consumable
 * JSON shape that an autonomous LLM application-writer can read to self-patch the exact capability/governance
 * leak the compiler proved — closing the loop from "the LLM wrote code that violates a boundary" to "the LLM
 * fixes it" without a human in the middle.
 *
 * It is a NORMALIZED projection of the compiler's governance diagnostics (the FUNGI-TENANT/SECRET/VALUESTATE/
 * PRIVACY/EFFECT/STDLIB/SUBSTRATE families) into one schema with: the capability that crossed the boundary,
 * the violation site + the source/context anchors, the rule (why) + the consequence (risk), and a
 * machine-applicable fix (kind + suggestedCode). Fail-closed / deny-by-default: ANY error-severity leak makes
 * the whole-module verdict `leak`; only a module with zero leaks is `clean`. Deterministic (canonicalLeakProof)
 * so it can be signed into a TestWitness and diffed in a PR.
 */

import type { EffectDiagnostic } from "./effect-checker.js";
import type { ContractTestSuite } from "./test-generator.js";
import { sha256Hex } from "./manifest-generator.js";

export type LeakCategory =
  | "tenant-isolation"   // FUNGI-TENANT-*    — cross-tenant / IDOR (a capability reaching another tenant's scope)
  | "secret-egress"      // FUNGI-SECRET-*, FUNGI-VALUESTATE-* — a secret/unsafe value reaching a governed sink
  | "privacy-egress"     // FUNGI-PRIVACY-*   — PII / cleartext embedding leaving the trust boundary
  | "undeclared-effect"  // FUNGI-EFFECT-*, FUNGI-STDLIB-* — a capability used but not declared in effects {}
  | "substrate-misuse"   // FUNGI-SUBSTRATE-* — crypto/external-reach on a noisy/photonic (untrusted) lane
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
  /** The working form, ready for `galerina fix` / the LLM to apply directly (when the compiler emitted one). */
  readonly suggestedCode?: string | undefined;
  readonly explanation: string;
}

export interface LeakFinding {
  readonly code: string;                 // the originating FUNGI-* governance code
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
  readonly schema: "fungi.leakproof.v1";
  /** Whole-module verdict: `leak` if ANY error-severity finding (deny-by-default), else `clean`. */
  readonly verdict: "clean" | "leak";
  readonly leaks: readonly LeakFinding[];
  readonly summary: { readonly total: number; readonly denies: number; readonly byCategory: Readonly<Record<string, number>> };
}

// Code-prefix → category (only these families are leaks; type/syntax/import codes are NOT capability leaks).
const PREFIX_CATEGORY: ReadonlyArray<readonly [string, LeakCategory]> = [
  ["FUNGI-TENANT-", "tenant-isolation"],
  ["FUNGI-SECRET-", "secret-egress"],
  ["FUNGI-VALUESTATE-", "secret-egress"],
  ["FUNGI-PRIVACY-", "privacy-egress"],
  ["FUNGI-EFFECT-", "undeclared-effect"],
  ["FUNGI-STDLIB-", "undeclared-effect"],
  ["FUNGI-SUBSTRATE-", "substrate-misuse"],
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
  /\b((?:network|database|filesystem|storage|file|secret|audit|crypto|http|https|pii|phi|email|payment|process|worker|event|desktop|unsafe|native|ledger|shell|state|message|random|clock|cache|ai|compute)\.[a-z][a-z.]*)\b/;

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
    schema: "fungi.leakproof.v1",
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// TestWitness (RD-0128, note 67) — a deterministic, signable receipt binding one wasm artifact to BOTH
// its governance leak proof AND its generated contract-test-suite digest. This promotes the comment-only
// `TestWitness` aspiration into a real type. SIGNING is performed OUT OF BAND by galerina-tower-citizen over
// `canonicalTestWitness(w)` through the EXISTING hybrid Ed25519+ML-DSA attestation envelope — this module
// owns only the type, the canonical signing pre-image, and the suite digest (NO crypto here, to keep the
// dependency direction core-compiler → tower-citizen and never the reverse). First increment: type +
// digest + canonical pre-image + a deny-by-default vouch predicate. CLI / fuse-loader admission policy /
// TAP-body fill are deferred follow-on increments.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface TestWitness {
  readonly schema: "fungi.testwitness.v1";
  /** The exact wasm artifact this witness vouches for — binds the receipt to one binary (sha256 hex). */
  readonly wasmSha256: string;
  /** The governance leak proof. Deny-by-default: a `leak` verdict means the witness records a KNOWN-leaking module — a verifier MUST refuse it (see witnessVouchesClean). */
  readonly leakProof: CapabilityLeakProof;
  /** sha256 over the canonical (order-independent) serialization of the generated contract-test obligations. */
  readonly suiteDigest: string;
}

/**
 * Deterministic digest of a ContractTestSuite. The suite's MEANING is the SET of obligations across all five
 * dimensions, not their emit order, so obligations are sorted before hashing — a changed/added/removed
 * obligation (id or asserted property) changes the digest; a mere reorder does not. NUL-separated to avoid
 * id/assertion delimiter collisions.
 */
export function testSuiteDigest(suite: ContractTestSuite): string {
  const ob: string[] = [];
  for (const c of suite.faultInjection)     ob.push(`fault\0${c.id}\0${c.assertion}`);
  for (const c of suite.effectEgress)       ob.push(`egress\0${c.id}\0${c.assertion}`);
  for (const c of suite.capabilityDenial)   ob.push(`deny\0${c.id}\0${c.assertion}`);
  for (const c of suite.boundary)           ob.push(`bound\0${c.id}\0${c.assertion}`);
  for (const c of suite.substrateViolation) ob.push(`subst\0${c.id}\0${c.assertion}`);
  ob.sort();
  return sha256Hex(ob.join("\n"));
}

/** Assemble a TestWitness for a wasm artifact. Records the leak proof FAITHFULLY (a `leak` verdict is preserved, never laundered to `clean`). */
export function buildTestWitness(wasmSha256: string, leakProof: CapabilityLeakProof, suite: ContractTestSuite): TestWitness {
  return { schema: "fungi.testwitness.v1", wasmSha256, leakProof, suiteDigest: testSuiteDigest(suite) };
}

/**
 * The canonical signing pre-image — the exact bytes tower-citizen signs and verifies. Embeds the wasm id,
 * the suite digest, AND the full canonical leak proof, so tampering with ANY of them invalidates the
 * signature. Stable key order (same discipline as canonicalLeakProof).
 */
export function canonicalTestWitness(w: TestWitness): string {
  return JSON.stringify({
    schema: w.schema,
    wasmSha256: w.wasmSha256,
    suiteDigest: w.suiteDigest,
    leakProof: canonicalTestWitness_leak(w.leakProof),
  });
}
// Reuse canonicalLeakProof (its own internal sort) for the embedded proof so the pre-image is fully stable.
function canonicalTestWitness_leak(p: CapabilityLeakProof): string {
  return canonicalLeakProof(p);
}

/** sha256 of the canonical pre-image — a convenience digest (the value tower-citizen hashes-then-signs). */
export function testWitnessDigest(w: TestWitness): string {
  return sha256Hex(canonicalTestWitness(w));
}

/**
 * Deny-by-default admission predicate: vouch for a witness ONLY when it is structurally consistent AND
 * its leak proof is genuinely CLEAN for the given artifact. A witness whose verdict claims `clean` while
 * its own summary/leaks show denies (or carries a finding of an UNKNOWN severity) is TAMPERED → fail closed.
 * This is the predicate the (deferred) fuse-loader admission policy will gate on; it never fails open.
 *
 * CONTRACT: this is a CONTENT predicate and must only ever run AFTER the out-of-band Ed25519+ML-DSA
 * signature over `canonicalTestWitness(w)` has verified — never as a sole admission gate.
 */
export function witnessVouchesClean(w: TestWitness, expectedWasmSha256: string): boolean {
  if (!w || w.schema !== "fungi.testwitness.v1") return false;
  if (typeof w.wasmSha256 !== "string" || w.wasmSha256.length === 0) return false;
  if (typeof expectedWasmSha256 !== "string" || expectedWasmSha256.length === 0) return false;
  if (w.wasmSha256 !== expectedWasmSha256) return false;               // receipt must bind to THIS artifact
  if (typeof w.suiteDigest !== "string" || w.suiteDigest.length === 0) return false;
  const p = w.leakProof;
  if (!p || p.schema !== "fungi.leakproof.v1") return false;
  if (p.verdict !== "clean") return false;                            // a known-leaking module never vouches
  if (!p.summary || p.summary.denies !== 0) return false;             // verdict/summary inconsistency = tamper
  if (!Array.isArray(p.leaks)) return false;
  // RD-0129 hardening: a positive severity allow-list — a finding whose severity is neither "deny" nor
  // "warn" is an UNKNOWN/forged severity and must fail closed (never be treated as non-deny by omission).
  if (p.leaks.some((l) => l.severity !== "deny" && l.severity !== "warn")) return false;
  if (p.leaks.some((l) => l.severity === "deny")) return false;       // verdict/leaks inconsistency = tamper
  // Cross-check the forgeable summary.denies against the leaks array itself — they must agree.
  const recomputedDenies = p.leaks.filter((l) => l.severity === "deny").length;
  if (recomputedDenies !== p.summary.denies) return false;
  return true;
}

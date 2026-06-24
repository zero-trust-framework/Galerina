// =============================================================================
// @logicn/devtools-pci — PCI DSS 4.0.1 Compliance Types
//
// Type definitions for PCI audit findings and reports.
// Schema version: lln.pci-audit.v1
// =============================================================================

/** The PCI DSS 4.0.1 requirement codes covered by static analysis. */
export type PciRequirement =
  | "3.3"
  | "3.5"
  | "4.2"
  | "6.2"
  | "6.3"
  | "7"
  | "8"
  | "10.2"
  | "10.3"
  | "12.6";

/**
 * Top-level audit verdict (K3 / NIST SP 800-207 T6).
 *   - "pass"          — every requirement the checker MODELS was attested clean.
 *   - "fail"          — at least one modelled requirement failed (critical/high finding).
 *   - "indeterminate" — the checker was blind (parse failure) or attestation was
 *                       required but incomplete; unknown -> deny, never silently pass.
 */
export type PciVerdict = "pass" | "fail" | "indeterminate";

/**
 * PCI DSS families that this STATIC source-level checker does NOT model and
 * therefore CANNOT attest from a .lln program alone (infrastructure / process
 * families). Listing them as "not attested" — rather than silently folding them
 * into passedRequirements — is the deny-by-default fix for 0084-pci-unknown:
 *   1  — install & maintain network security controls
 *   2  — apply secure configurations
 *   5  — protect against malicious software
 *   9  — restrict physical access to cardholder data
 *   11 — test security of systems & networks regularly
 */
export type PciUnmodelledFamily = "1" | "2" | "5" | "9" | "11";

/** Families a source-level static checker cannot attest (require infra/process evidence). */
export const PCI_UNMODELLED_FAMILIES: readonly PciUnmodelledFamily[] = [
  "1", "2", "5", "9", "11",
] as const;

/** A single PCI compliance finding raised by static analysis. */
export interface PciFinding {
  readonly code: string;            // LLN-PCI-001..010
  readonly name: string;
  readonly pciRequirement: PciRequirement;
  readonly severity: "critical" | "high" | "medium";
  readonly message: string;
  readonly flowName?: string;
  readonly file?: string;
}

/** Full PCI compliance audit report for a single .lln source file. */
export interface PciAuditReport {
  readonly schemaVersion: "lln.pci-audit.v1";
  readonly pciDssVersion: "4.0.1";
  readonly source: string;
  readonly findings: readonly PciFinding[];
  readonly critical: readonly PciFinding[];
  readonly high: readonly PciFinding[];
  readonly requirementsCovered: PciRequirement[];
  readonly passedRequirements: PciRequirement[];
  readonly failedRequirements: PciRequirement[];
  /**
   * Requirements POSITIVELY attested clean: modelled by the checker AND with no
   * failing finding. Distinct from passedRequirements (kept for back-compat) in
   * that it is the explicit "we evaluated this and it passed" set.
   */
  readonly attestedRequirements: PciRequirement[];
  /**
   * PCI families the static checker does NOT model, so it cannot attest them
   * (unknown -> not-attested, NOT silently passed). Always populated.
   */
  readonly notAttested: PciUnmodelledFamily[];
  /**
   * K3 verdict. "pass" only when every modelled requirement is attested clean
   * (and, under requireFullAttestation, when nothing is left un-attested).
   * A blind audit (parse failure) is "indeterminate", never "pass".
   */
  readonly verdict: PciVerdict;
  readonly auditedAt: string;
  /**
   * True only when verdict === "pass". Kept as the back-compat top-line boolean;
   * a blind/indeterminate audit is now `false`, closing the unknown -> pass hole.
   */
  readonly passed: boolean;
}

/** All PCI requirement codes that this checker covers (models + can attest). */
export const ALL_PCI_REQUIREMENTS: readonly PciRequirement[] = [
  "3.3", "3.5", "4.2", "6.2", "6.3", "7", "8", "10.2", "10.3", "12.6",
] as const;

/** Audit options controlling fail-closed strictness. */
export interface PciAuditOptions {
  /** Source file name for finding metadata. */
  readonly fileName?: string | undefined;
  /**
   * When true, an audit that cannot fully attest every modelled requirement
   * (e.g. a partial parse, or any future un-attested requirement) yields
   * verdict "indeterminate" / passed=false. Deny-by-default for callers that
   * demand complete attestation. Default false (back-compat): the unmodelled
   * infra families are surfaced in `notAttested` but do not, by themselves,
   * fail a source whose modelled requirements are all clean.
   */
  readonly requireFullAttestation?: boolean | undefined;
}

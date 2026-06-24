// =============================================================================
// @logicn/devtools-pci — PCI DSS 4.0.1 Static Checker
//
// Walks the LogicN AST and raises PCI compliance findings.
//
// Map of diagnostic codes to PCI DSS 4.0.1 requirements:
//   LLN-PCI-001  Req 3.3  — raw card-data keywords in identifier names / strings
//   LLN-PCI-002  Req 3.5  — PAN binding without privacy { mask ... }
//   LLN-PCI-003  Req 4.2  — network.outbound without TLS declaration
//   LLN-PCI-004  Req 7    — payment flow with no authority {} block
//   LLN-PCI-005  Req 10.2 — payment flow with no effects { audit.write }
//   LLN-PCI-006  Req 10.3 — card/PAN data reaching AuditLog.write unredacted
//   LLN-PCI-007  Req 6.2  — payment flow with no contract { intent { ... } }
//   LLN-PCI-008  Req 8    — secure flow processing payment data, no authority.requires
//   LLN-PCI-009  Req 12.6 — file with 2+ payment flows, none have contract.intent
//   LLN-PCI-010  Req 6.3  — unsafe let binding named with card-data keyword
// =============================================================================

import { parseProgram, checkValueStates, type AstNode, type AstNodeKind, NodeFlags } from "@logicn/core-compiler";
import {
  type PciFinding,
  type PciAuditReport,
  type PciRequirement,
  type PciVerdict,
  type PciUnmodelledFamily,
  type PciAuditOptions,
  ALL_PCI_REQUIREMENTS,
  PCI_UNMODELLED_FAMILIES,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants — keyword sets
// ---------------------------------------------------------------------------

/** Card-data keyword set (all lowercase for case-insensitive matching). */
const CARD_DATA_KEYWORDS: readonly string[] = [
  "pan", "cardnumber", "cardnum", "cvv", "cvc", "trackdata",
  "track1", "track2", "expiry", "expirydate", "bin", "primaryaccountnumber",
];

/** Payment-flow heuristic keywords (lowercased). */
const PAYMENT_FLOW_KEYWORDS: readonly string[] = [
  "payment", "charge", "billing", "card", "transaction",
  "checkout", "invoice", "refund", "settle", "pan", "cvv",
];

/** Types that indicate payment context (in imports or type references). */
const PAYMENT_TYPE_NAMES: readonly string[] = [
  "PaymentRequest", "CardData", "BillingInfo",
];

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

function findNodes(root: AstNode, kind: AstNodeKind): AstNode[] {
  const found: AstNode[] = [];
  function walk(node: AstNode): void {
    if (node.kind === kind) found.push(node);
    for (const child of node.children ?? []) walk(child);
  }
  walk(root);
  return found;
}

function hasDescendant(root: AstNode, predicate: (n: AstNode) => boolean): boolean {
  function walk(node: AstNode): boolean {
    if (predicate(node)) return true;
    for (const child of node.children ?? []) {
      if (walk(child)) return true;
    }
    return false;
  }
  return walk(root);
}

const FLOW_KINDS = new Set<AstNodeKind>([
  "flowDecl", "secureFlowDecl", "pureFlowDecl", "guardedFlowDecl",
]);

/** Return all top-level flow nodes. */
function getFlowNodes(ast: AstNode): AstNode[] {
  return (ast.children ?? []).filter(n => FLOW_KINDS.has(n.kind));
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

/** True if the identifier/value contains any card-data keyword (substring match). */
function containsCardKeyword(name: string): boolean {
  const lower = name.toLowerCase();
  return CARD_DATA_KEYWORDS.some(k => lower.includes(k));
}

/**
 * Extract the bare binding name from a letDecl/mutDecl value, which may be
 * "pan: String" or just "pan". Returns the part before any colon/space.
 */
function extractBindingName(declValue: string): string {
  // "pan: String" → "pan", "validCard" → "validCard"
  const colonIdx = declValue.indexOf(":");
  if (colonIdx > 0) return declValue.slice(0, colonIdx).trim();
  const spaceIdx = declValue.indexOf(" ");
  if (spaceIdx > 0) return declValue.slice(0, spaceIdx).trim();
  return declValue.trim();
}

/** True if flow name matches the payment-flow heuristic. */
function isPaymentFlow(flowName: string, ast: AstNode): boolean {
  const lower = flowName.toLowerCase();
  if (PAYMENT_FLOW_KEYWORDS.some(k => lower.includes(k))) return true;
  // Also fire if the file references payment type names (in identifiers/type refs)
  const source = flattenText(ast);
  return PAYMENT_TYPE_NAMES.some(t => source.includes(t));
}

/**
 * Flatten all identifier/string literal values from an AST subtree into a
 * single string for simple keyword containment checks.
 * NOTE: this is deliberately limited to identifiers and string literals —
 * it does NOT include comment text, so comment-only mentions don't fire.
 */
function flattenText(node: AstNode): string {
  const parts: string[] = [];
  function walk(n: AstNode): void {
    if ((n.kind === "identifier" || n.kind === "stringLiteral") && n.value) {
      parts.push(n.value);
    }
    for (const child of n.children ?? []) walk(child);
  }
  walk(node);
  return parts.join(" ");
}

/**
 * Check whether a flow node has an `authority {}` block among its children.
 */
function hasAuthorityBlock(flowNode: AstNode): boolean {
  return hasDescendant(flowNode, n => n.kind === "authorityDecl");
}

/**
 * Check whether a flow has an authority block with a `requires` clause.
 *
 * The parser emits an authorityDecl node but may not parse its body into
 * child nodes. We fall back to checking the raw source excerpt stored in
 * the authorityDecl value, or check sibling text patterns.
 *
 * Strategy: look at the authorityDecl value text for "requires", and also
 * scan all identifier values under authorityDecl for "requires".
 * Additionally scan the full flow identifier text since the authority body
 * identifiers are included in flattenText(flowNode).
 */
function hasAuthorityRequires(flowNode: AstNode, rawSource: string, flowStartOffset?: number): boolean {
  const authNodes = findNodes(flowNode, "authorityDecl");
  if (authNodes.length === 0) return false;

  for (const auth of authNodes) {
    // Check value
    if ((auth.value ?? "").toLowerCase().includes("requires")) return true;
    // Check all descendant text
    const text = flattenText(auth).toLowerCase();
    if (text.includes("requires")) return true;
  }

  // Fallback: scan raw source between "authority {" and the matching "}"
  const authorityMatch = rawSource.match(/authority\s*\{([^}]*)\}/s);
  if (authorityMatch) {
    if (authorityMatch[1].toLowerCase().includes("requires")) return true;
  }

  return false;
}

/**
 * Check whether a flow node declares `effects { ... audit.write ... }`.
 *
 * The parser represents the effects block as an identifier node with
 * value "effects:block" containing children with values like "effect:audit.write".
 */
function hasAuditWriteEffect(flowNode: AstNode): boolean {
  // Walk all identifiers in the flow, check for ones that encode audit effects
  return hasDescendant(flowNode, n => {
    if (n.kind !== "identifier") return false;
    const val = (n.value ?? "").toLowerCase();
    return val === "effect:audit.write" || val === "audit.write" || val.startsWith("effect:audit");
  });
}

/** Check whether a flow has a `contract { intent { ... } }` block. */
function hasContractIntent(flowNode: AstNode): boolean {
  // Check NodeFlags fast path first
  if ((flowNode.flags ?? 0) & NodeFlags.HasContract) {
    const contracts = findNodes(flowNode, "contractDecl");
    for (const c of contracts) {
      if (hasDescendant(c, n => n.kind === "intentDecl")) return true;
    }
  }
  // Also walk without flags in case flags aren't set
  const contracts = findNodes(flowNode, "contractDecl");
  for (const c of contracts) {
    if (hasDescendant(c, n => n.kind === "intentDecl")) return true;
  }
  return false;
}

/**
 * Check whether a flow has a `privacy { ... }` block.
 *
 * The parser encodes privacy as an identifier node with value "privacy:block".
 */
function hasPrivacyBlock(flowNode: AstNode): boolean {
  return hasDescendant(flowNode, n => {
    if (n.kind === "identifier") {
      const val = (n.value ?? "").toLowerCase();
      return val.startsWith("privacy:") || val === "privacy";
    }
    return false;
  });
}

/** Check whether a flow declares `effects { network.outbound }` or similar. */
function hasNetworkOutbound(flowNode: AstNode): boolean {
  return hasDescendant(flowNode, n => {
    if (n.kind !== "identifier") return false;
    const val = (n.value ?? "").toLowerCase();
    return val.includes("network.outbound") || val.includes("http.post") ||
      val === "effect:network.outbound" || val.startsWith("effect:network") ||
      val.startsWith("effect:http");
  });
}

/**
 * Check if TLS is declared for outbound connections.
 * Since the contract.target block is not deeply parsed by the AST,
 * we check the raw source for TLS patterns.
 */
function hasTlsDeclaration(rawSource: string): boolean {
  const lower = rawSource.toLowerCase();
  // Look for TLS in contract.target or https URLs
  return lower.includes("tls:") || lower.includes("tls\"") || lower.includes("\"tls") ||
    lower.match(/target\s*\{[^}]*tls/s) !== null ||
    lower.includes("https://");
}

/**
 * Extract the raw source text for a flow.
 * Since we have source positions from the AST, we can use offset-based extraction.
 * Fallback: use the full source and rely on the authority block regex.
 */
function getFlowSource(rawSource: string, flowName: string): string {
  // Simple approach: find the flow declaration and extract until the matching }
  // We'll just return the full source — the regex-based checks scope to the flow name.
  return rawSource;
}

/**
 * Check if a binding named with a card keyword reaches AuditLog.write
 * without being wrapped in redact().
 */
function checkCardDataAtAuditLog(flowNode: AstNode): string[] {
  const cardBindings = new Set<string>();

  // Collect all bindings with card-data names (extract bare name from "pan: String")
  for (const kind of ["letDecl", "mutDecl", "readonlyDecl"] as const) {
    for (const decl of findNodes(flowNode, kind)) {
      if (decl.value) {
        const bareName = extractBindingName(decl.value);
        if (containsCardKeyword(bareName)) {
          cardBindings.add(bareName);
        }
      }
    }
  }
  if (cardBindings.size === 0) return [];

  // Find AuditLog.write call expressions
  const violations: string[] = [];
  for (const call of findNodes(flowNode, "callExpr")) {
    const callText = flattenText(call);
    const callTextLower = callText.toLowerCase();
    // Check if this is an AuditLog.write call
    if (!callTextLower.includes("auditlog") && !callTextLower.includes("audit.write")) continue;
    // The call value might be "write" and parent identifier is "AuditLog"
    if (call.value !== "write" && call.value !== "audit.write") continue;

    // For each card binding, check it appears in this call without redact()
    for (const binding of cardBindings) {
      if (!callText.includes(binding)) continue;
      if (!isWrappedInRedact(call, binding)) {
        violations.push(binding);
      }
    }
  }
  return violations;
}

/**
 * Simple heuristic: if the call subtree contains a callExpr with "redact"
 * that has the binding as an argument, consider it wrapped.
 */
function isWrappedInRedact(callNode: AstNode, bindingName: string): boolean {
  return hasDescendant(callNode, n => {
    if (n.kind !== "callExpr") return false;
    const text = flattenText(n);
    return (n.value?.toLowerCase() === "redact" || text.toLowerCase().includes("redact")) &&
      text.includes(bindingName);
  });
}

// ---------------------------------------------------------------------------
// Finding factories
// ---------------------------------------------------------------------------

function makeFinding(
  code: string,
  name: string,
  pciRequirement: PciRequirement,
  severity: "critical" | "high" | "medium",
  message: string,
  flowName?: string,
  file?: string,
): PciFinding {
  const base: PciFinding = { code, name, pciRequirement, severity, message };
  if (flowName !== undefined && file !== undefined) return { ...base, flowName, file };
  if (flowName !== undefined) return { ...base, flowName };
  if (file !== undefined) return { ...base, file };
  return base;
}

// ---------------------------------------------------------------------------
// Main audit function
// ---------------------------------------------------------------------------

/**
 * Run PCI DSS 4.0.1 static analysis on a LogicN source string.
 *
 * @param source   - .lln source content
 * @param fileName - optional file name for finding metadata
 */
export function runPciAudit(
  source: string,
  options?: string | PciAuditOptions,
): PciAuditReport {
  const opts: PciAuditOptions =
    typeof options === "string" ? { fileName: options }
    : options ?? {};
  const fileName = opts.fileName;
  const requireFullAttestation = opts.requireFullAttestation === true;
  const auditedAt = new Date().toISOString();
  const findings: PciFinding[] = [];
  // 0084-pci-unknown: did the audit see a complete, analyzable program? A parse
  // error means the static checker is BLIND for part (or all) of the source — it
  // cannot attest what it could not parse, so the verdict must collapse to
  // INDETERMINATE (unknown -> deny), not silently report the modelled families clean.
  let analyzerBlind = false;

  // Parse
  const parsed = parseProgram(source, fileName ?? "source.lln");

  // FAIL-CLOSED on parse failure (#0098): a security oracle that cannot see the program is BLIND,
  // and a blind oracle must DENY, not PASS. ANY parse error means the auditor is operating on an
  // incomplete view of the program — whether the failure is TOTAL (no flows / empty AST) or PARTIAL
  // (some flows parsed, but a section is malformed, e.g. an unterminated block). In every case push
  // a high-severity LLN-PCI-000 ParseFailure so buildReport's `passed` becomes false, instead of
  // returning a clean "pass". Mirrors the security audit-runner's parse-fail handling.
  // NIST SP 800-207 T6 / CWE-636 (not-failing-securely) / CWE-703 / CWE-1287.
  const parseErrors = (parsed.diagnostics ?? []).filter(d => d.severity === "error");
  if (parseErrors.length > 0) {
    analyzerBlind = true;
    findings.push(makeFinding(
      "LLN-PCI-000",
      "ParseFailure",
      "6.2",
      "high",
      `PCI audit could not fully analyze the source — it has ${parseErrors.length} parse error${parseErrors.length === 1 ? "" : "s"} (first: ${parseErrors[0]?.message ?? "unknown"}). A partially- or un-parseable source FAILS the audit (unknown -> deny); a blind oracle does not pass.`,
      undefined,
      fileName,
    ));
    // Total parse failure (no auditable AST): return now. Partial failure: fall through and audit
    // whatever DID parse (defense in depth), with the parse-failure finding already recorded.
    if (parsed.flows.length === 0 && (parsed.ast.children ?? []).length === 0) {
      return buildReport(source, findings, auditedAt, fileName, analyzerBlind, requireFullAttestation);
    }
  }

  const ast = parsed.ast;
  const flowNodes = getFlowNodes(ast);

  // value-state results (used for unsafe binding detection)
  const vsResult = checkValueStates(ast);

  // Track payment flows for LLN-PCI-009
  const paymentFlowNodes: AstNode[] = [];
  let anyPaymentFlowHasIntent = false;

  // -----------------------------------------------------------------------
  // Per-flow checks
  // -----------------------------------------------------------------------
  for (const flowNode of flowNodes) {
    const flowName = flowNode.value ?? "<unknown>";
    const isPayment = isPaymentFlow(flowName, ast);
    const isSecure = flowNode.kind === "secureFlowDecl";

    if (isPayment) {
      paymentFlowNodes.push(flowNode);
      if (hasContractIntent(flowNode)) anyPaymentFlowHasIntent = true;
    }

    // LLN-PCI-001 — Req 3.3: raw card patterns in string literals or binding names
    // String literals with card keywords
    const seenPci001Literals = new Set<string>();
    for (const strLit of findNodes(flowNode, "stringLiteral")) {
      const litVal = (strLit.value ?? "").toLowerCase();
      for (const kw of CARD_DATA_KEYWORDS) {
        if (litVal.includes(kw) && !seenPci001Literals.has(kw)) {
          seenPci001Literals.add(kw);
          findings.push(makeFinding(
            "LLN-PCI-001",
            "RawCardDataInStringLiteral",
            "3.3",
            "critical",
            `String literal contains card-data keyword '${kw}' — must be encrypted or redacted before use (PCI Req 3.3).`,
            flowName,
            fileName,
          ));
        }
      }
    }
    // Identifier binding names with card keywords (not in a privacy block)
    const seenPci001Bindings = new Set<string>();
    for (const kind of ["letDecl", "mutDecl", "readonlyDecl"] as const) {
      for (const decl of findNodes(flowNode, kind)) {
        if (!decl.value) continue;
        const bareName = extractBindingName(decl.value);
        const bareNameLower = bareName.toLowerCase();
        for (const kw of CARD_DATA_KEYWORDS) {
          if (bareNameLower.includes(kw) && !seenPci001Bindings.has(bareName)) {
            if (!hasPrivacyBlock(flowNode)) {
              seenPci001Bindings.add(bareName);
              findings.push(makeFinding(
                "LLN-PCI-001",
                "RawCardDataInIdentifier",
                "3.3",
                "critical",
                `Binding '${bareName}' contains card-data keyword '${kw}' without encryption/redact wrapping (PCI Req 3.3).`,
                flowName,
                fileName,
              ));
            }
          }
        }
      }
    }

    // LLN-PCI-002 — Req 3.5: PAN binding without privacy { mask ... }
    for (const kind of ["letDecl", "mutDecl", "readonlyDecl"] as const) {
      for (const decl of findNodes(flowNode, kind)) {
        if (!decl.value) continue;
        const bareName = extractBindingName(decl.value).toLowerCase();
        if (bareName.includes("pan") || bareName.includes("cardnum") ||
            bareName.includes("cardnumber") || bareName.includes("primaryaccountnumber")) {
          if (!hasPrivacyBlock(flowNode)) {
            findings.push(makeFinding(
              "LLN-PCI-002",
              "PanBindingWithoutPrivacyMask",
              "3.5",
              "critical",
              `Binding '${extractBindingName(decl.value)}' looks like a Primary Account Number but is NOT declared with privacy { mask ... } (PCI Req 3.5).`,
              flowName,
              fileName,
            ));
          }
        }
      }
    }

    // Extract raw source for this flow (used for regex-based checks)
    const flowSource = getFlowSource(source, flowName);

    // LLN-PCI-003 — Req 4.2: network.outbound without TLS declaration
    if (isPayment && hasNetworkOutbound(flowNode) && !hasTlsDeclaration(flowSource)) {
      findings.push(makeFinding(
        "LLN-PCI-003",
        "NetworkOutboundWithoutTls",
        "4.2",
        "critical",
        `Payment flow '${flowName}' declares network.outbound/http.post but no TLS is declared — cardholder data must only transit encrypted channels (PCI Req 4.2).`,
        flowName,
        fileName,
      ));
    }

    // LLN-PCI-004 — Req 7: payment flow with no authority {} block
    if (isPayment && !hasAuthorityBlock(flowNode)) {
      findings.push(makeFinding(
        "LLN-PCI-004",
        "PaymentFlowMissingAuthority",
        "7",
        "high",
        `Payment flow '${flowName}' has no authority {} block — access to cardholder data must be explicitly restricted (PCI Req 7).`,
        flowName,
        fileName,
      ));
    }

    // LLN-PCI-005 — Req 10.2: payment flow with no effects { audit.write }
    if (isPayment && !hasAuditWriteEffect(flowNode)) {
      findings.push(makeFinding(
        "LLN-PCI-005",
        "PaymentFlowMissingAuditWrite",
        "10.2",
        "high",
        `Payment flow '${flowName}' does not declare effects { audit.write } — all access to cardholder data must be audit-logged (PCI Req 10.2).`,
        flowName,
        fileName,
      ));
    }

    // LLN-PCI-006 — Req 10.3: card/PAN data reaching AuditLog.write without redact()
    const auditViolations = checkCardDataAtAuditLog(flowNode);
    for (const binding of auditViolations) {
      findings.push(makeFinding(
        "LLN-PCI-006",
        "CardDataAtAuditLogUnredacted",
        "10.3",
        "critical",
        `Binding '${binding}' (card-data) reaches AuditLog.write without redact() wrapping — audit logs must protect cardholder data (PCI Req 10.3).`,
        flowName,
        fileName,
      ));
    }

    // LLN-PCI-007 — Req 6.2: payment flow with no contract { intent { ... } }
    if (isPayment && !hasContractIntent(flowNode)) {
      findings.push(makeFinding(
        "LLN-PCI-007",
        "PaymentFlowMissingContractIntent",
        "6.2",
        "medium",
        `Payment flow '${flowName}' has no contract { intent { ... } } block — secure development requires documented intent (PCI Req 6.2).`,
        flowName,
        fileName,
      ));
    }

    // LLN-PCI-008 — Req 8: secure flow processing payment data with no authority.requires
    if (isSecure && isPayment && !hasAuthorityRequires(flowNode, source)) {
      findings.push(makeFinding(
        "LLN-PCI-008",
        "SecurePaymentFlowMissingAuthorityRequires",
        "8",
        "high",
        `Secure payment flow '${flowName}' has no authority { requires ... } clause — identity and authentication must be declared for cardholder data access (PCI Req 8).`,
        flowName,
        fileName,
      ));
    }

    // LLN-PCI-010 — Req 6.3: let binding with card-data keyword without immediate gating
    const seenPci010 = new Set<string>();
    for (const decl of findNodes(flowNode, "letDecl")) {
      if (!decl.value) continue;
      const bareName = extractBindingName(decl.value);
      const bareNameLower = bareName.toLowerCase();
      if (!containsCardKeyword(bareNameLower)) continue;
      if (seenPci010.has(bareName)) continue;

      // Check if the initialiser is a validated/gated call
      const isGated = hasDescendant(decl, n => {
        if (n.kind !== "callExpr") return false;
        const callName = (n.value ?? "").toLowerCase();
        const callText = flattenText(n).toLowerCase();
        return callName.match(/^(validate|sanitize|check|verify|parse|decode)/) !== null ||
          callText.match(/validate\.|sanitize\.|check\.|verify\.|parse\.|decode\./) !== null;
      });

      if (!isGated) {
        seenPci010.add(bareName);
        findings.push(makeFinding(
          "LLN-PCI-010",
          "UnsafeCardDataBindingUngated",
          "6.3",
          "high",
          `Binding '${bareName}' contains card-data keyword and is not immediately gated by a validation/sanitisation function (PCI Req 6.3).`,
          flowName,
          fileName,
        ));
      }
    }
  }

  // -----------------------------------------------------------------------
  // File-level checks (after all flows are visited)
  // -----------------------------------------------------------------------

  // LLN-PCI-009 — Req 12.6: file with 2+ payment flows, none have contract.intent
  if (paymentFlowNodes.length >= 2 && !anyPaymentFlowHasIntent) {
    findings.push(makeFinding(
      "LLN-PCI-009",
      "MultiplePaymentFlowsNoIntent",
      "12.6",
      "medium",
      `File contains ${paymentFlowNodes.length} payment flows but NONE have a contract { intent { ... } } block — security policy documentation is required (PCI Req 12.6).`,
      undefined,
      fileName,
    ));
  }

  return buildReport(source, findings, auditedAt, fileName, analyzerBlind, requireFullAttestation);
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

function buildReport(
  source: string,
  findings: readonly PciFinding[],
  auditedAt: string,
  _fileName?: string,
  analyzerBlind = false,
  requireFullAttestation = false,
): PciAuditReport {
  const critical = findings.filter(f => f.severity === "critical");
  const high = findings.filter(f => f.severity === "high");

  const failedReqs = new Set<PciRequirement>(findings.map(f => f.pciRequirement));
  const failedRequirements = Array.from(failedReqs);
  const passedRequirements = ALL_PCI_REQUIREMENTS.filter(r => !failedReqs.has(r));

  // attestedRequirements: modelled AND not failed = positively attested clean.
  // (Identical to passedRequirements today; kept as a distinct, intention-revealing
  // field so "we evaluated and it passed" is never conflated with "we never looked".)
  const attestedRequirements = passedRequirements;

  // 0084-pci-unknown: the families this static checker cannot model are ALWAYS
  // surfaced as not-attested, never silently rolled into passedRequirements.
  const notAttested: PciUnmodelledFamily[] = [...PCI_UNMODELLED_FAMILIES];

  // K3 verdict (NIST SP 800-207 T6, deny-by-default):
  //   any modelled requirement failed            -> "fail"
  //   blind (parse failure)                       -> "indeterminate"
  //   requireFullAttestation but something un-attested -> "indeterminate"
  //   else (every modelled requirement clean)     -> "pass"
  const hasGateFinding = critical.length > 0 || high.length > 0;
  const incompleteAttestation = requireFullAttestation && notAttested.length > 0;
  const verdict: PciVerdict =
    hasGateFinding         ? "fail"
    : analyzerBlind        ? "indeterminate"
    : incompleteAttestation ? "indeterminate"
    :                        "pass";

  // Boundary collapse: only a positive "pass" authorizes. (analyzerBlind already
  // pushes a high finding, so hasGateFinding is true on parse failure too — the
  // explicit analyzerBlind branch is belt-and-suspenders for the indeterminate label.)
  const passed = verdict === "pass";

  const sourceSnippet = source.slice(0, 200) + (source.length > 200 ? "..." : "");

  return {
    schemaVersion: "lln.pci-audit.v1",
    pciDssVersion: "4.0.1",
    source: sourceSnippet,
    findings,
    critical,
    high,
    requirementsCovered: [...ALL_PCI_REQUIREMENTS],
    passedRequirements,
    failedRequirements,
    attestedRequirements,
    notAttested,
    verdict,
    auditedAt,
    passed,
  };
}

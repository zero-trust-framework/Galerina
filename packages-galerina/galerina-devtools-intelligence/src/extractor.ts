// =============================================================================
// galerina-devtools-intelligence — AST Metadata Extractor
//
// Given a parsed AST + FlowMeta[], extracts all the structural metadata
// needed to build IndexedFlow objects:
//   - lexical tokens (for BM25)
//   - declared effects
//   - economics hints
//   - taint / secret presence
//   - governance codes
//   - qualifier tags
//   - contract text + signature text
// =============================================================================

import { createHash } from "node:crypto";
import { type AstNode, type FlowMeta, type ParseResult } from "@galerina/core-compiler";
import { tokenizeWithCompounds } from "./bm25.js";
import type { IndexedFlow } from "./types.js";

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function flowId(filePath: string, flowName: string): string {
  return createHash("sha256")
    .update(filePath + "\0" + flowName)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// AST walk helpers
// ---------------------------------------------------------------------------

/** Collect all identifier / literal values from an AST subtree */
function collectValues(node: AstNode, out: string[]): void {
  if (node.value !== undefined && node.value.length > 0) {
    out.push(node.value);
  }
  for (const child of node.children ?? []) {
    collectValues(child, out);
  }
}

/** Walk AST looking for nodes matching a kind predicate */
function walkFind(node: AstNode, pred: (n: AstNode) => boolean, out: AstNode[]): void {
  if (pred(node)) out.push(node);
  for (const child of node.children ?? []) {
    walkFind(child, pred, out);
  }
}

// ---------------------------------------------------------------------------
// Contract extraction
// ---------------------------------------------------------------------------

const FLOW_KINDS = new Set([
  "flowDecl", "secureFlowDecl", "pureFlowDecl", "guardedFlowDecl",
]);

/** Find the flow AST node matching this FlowMeta */
function findFlowNode(ast: AstNode, meta: FlowMeta): AstNode | undefined {
  const candidates: AstNode[] = [];
  walkFind(ast, n => FLOW_KINDS.has(n.kind), candidates);

  for (const node of candidates) {
    // The first identifier child of a flow decl is the name
    const nameNode = (node.children ?? []).find(c => c.kind === "identifier");
    if (nameNode?.value === meta.name) return node;

    // Fallback: check by location line
    if (
      node.location?.line !== undefined &&
      meta.location.line !== undefined &&
      Math.abs(node.location.line - meta.location.line) <= 2
    ) {
      return node;
    }
  }
  return undefined;
}

/** Extract all text from the contract block of a flow node */
function extractContractText(flowNode: AstNode, source: string): string {
  const contractNode = (flowNode.children ?? []).find(c => c.kind === "contractDecl");
  if (contractNode === undefined) return "";

  // Reconstruct from location if available
  const loc = contractNode.location;
  if (loc?.line !== undefined && loc.endLine !== undefined) {
    const lines = source.split("\n");
    const slicedLines = lines.slice(loc.line - 1, loc.endLine);
    return slicedLines.join("\n").trim();
  }

  // Fallback: collect values
  const vals: string[] = [];
  collectValues(contractNode, vals);
  return vals.join(" ");
}

/** Extract economics hints from the contract block */
function extractEconomicsHints(flowNode: AstNode): string[] {
  const hints: string[] = [];
  const contractNode = (flowNode.children ?? []).find(c => c.kind === "contractDecl");
  if (contractNode === undefined) return hints;

  for (const child of contractNode.children ?? []) {
    const v = child.value ?? "";
    if (v === "economics:block" || v === "economics:") {
      // Collect all text from this sub-block
      const vals: string[] = [];
      collectValues(child, vals);
      hints.push(...vals.map(s => s.trim()).filter(s => s.length > 0));
    }
  }
  return hints;
}

/** Detect taint: 'unsafe' modifier or 'tainted' type qualifier in the AST.
 *  The AST stores unsafe as part of letDecl values like "unsafe rawEmail: String"
 *  or inside identifier values like "decl:email : unsafe String".
 */
function detectTaint(flowNode: AstNode): boolean {
  const vals: string[] = [];
  collectValues(flowNode, vals);
  return vals.some(v =>
    v === "unsafe" ||
    v.includes("unsafe ") ||
    v.includes(" unsafe") ||
    v.includes("tainted") ||
    v.includes("Tainted")
  );
}

/** Detect secrets: 'SecureString', 'Secrets.get', 'secrets:block', secret keyword */
function detectSecrets(flowNode: AstNode): boolean {
  const vals: string[] = [];
  collectValues(flowNode, vals);
  return vals.some(v =>
    v === "SecureString" ||
    v === "Secrets" ||
    v.includes("secrets:") ||
    v.includes("secret") ||
    v === "secret.read"
  );
}

/** Determine governance codes that apply to this flow.
 *  We derive these statically from the AST rather than running the full verifier. */
function deriveGovernanceCodes(meta: FlowMeta, flowNode: AstNode | undefined): string[] {
  const codes: string[] = [];

  // FUNGI-GOV-010: INTENT_MISSING_ON_SECURE_FLOW
  if (meta.qualifier === "secure" || meta.qualifier === "guarded") {
    const hasIntent = flowNode !== undefined && (() => {
      const vals: string[] = [];
      collectValues(flowNode, vals);
      return vals.some(v => v === "intentDecl" || v.startsWith("intent"));
    })();

    // Check more carefully for intent node
    let intentFound = false;
    if (flowNode !== undefined) {
      const intentNodes: AstNode[] = [];
      walkFind(flowNode, n => n.kind === "intentDecl", intentNodes);
      intentFound = intentNodes.length > 0;
    }

    if (!intentFound) {
      codes.push("FUNGI-GOV-010");
    }
  }

  // FUNGI-GOV-002: MISSING_AUDIT_FOR_GOVERNED_SINK (heuristic)
  if (meta.declaredEffects.some(e =>
    e.includes("database.write") || e.includes("storage.write")
  )) {
    if (!meta.declaredEffects.includes("audit.write")) {
      codes.push("FUNGI-GOV-002");
    }
  }

  return codes;
}

/** Build qualifier tags */
function buildQualifierTags(meta: FlowMeta, flowNode: AstNode | undefined, economicsHints: string[]): string[] {
  const tags: string[] = [];

  tags.push(meta.qualifier);

  if (flowNode !== undefined) {
    const intentNodes: AstNode[] = [];
    walkFind(flowNode, n => n.kind === "intentDecl", intentNodes);
    if (intentNodes.length > 0) tags.push("has-intent");

    if (economicsHints.length > 0) tags.push("has-economics");

    const hasPrivacy = (flowNode.flags ?? 0) & (1 << 7);
    if (hasPrivacy !== 0) tags.push("has-privacy");
  }

  if (meta.declaredEffects.length > 0) tags.push("has-effects");

  return tags;
}

/** Build the signature text: "qualifier flow name(params) -> RetType" */
function buildSignatureText(meta: FlowMeta): string {
  const params = meta.params.join(", ");
  const qual = meta.qualifier !== "flow" ? `${meta.qualifier} flow` : "flow";
  return `${qual} ${meta.name}(${params}) -> ${meta.returnType}`;
}

/** Build all lexical tokens for a flow: name tokens + effect tokens + contract identifiers */
function buildLexicalTokens(meta: FlowMeta, flowNode: AstNode | undefined, contractText: string): string[] {
  const rawParts: string[] = [];

  // Flow name (most important)
  rawParts.push(meta.name);

  // Return type
  rawParts.push(meta.returnType);

  // Params
  for (const p of meta.params) rawParts.push(p);

  // Effects
  for (const e of meta.declaredEffects) rawParts.push(e);

  // Contract text identifiers
  if (contractText.length > 0) rawParts.push(contractText);

  // Walk the full AST node to get all identifiers and string literals
  if (flowNode !== undefined) {
    const allVals: string[] = [];
    collectValues(flowNode, allVals);
    rawParts.push(...allVals);
  }

  // Tokenise all the raw text and deduplicate while preserving frequency for BM25
  // We tokenize each rawPart separately to preserve compound forms
  const tokenBag: string[] = [];
  for (const part of rawParts) {
    tokenBag.push(...tokenizeWithCompounds(part));
  }

  return tokenBag;
}

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

export interface ExtractionInput {
  parseResult: ParseResult;
  filePath: string;
  source: string;
  sourceMtime: number;
}

export function extractFlows(input: ExtractionInput): IndexedFlow[] {
  const { parseResult, filePath, source, sourceMtime } = input;
  const results: IndexedFlow[] = [];
  const now = new Date().toISOString();

  for (const meta of parseResult.flows) {
    const flowNode = findFlowNode(parseResult.ast, meta);

    const economicsHints = flowNode !== undefined ? extractEconomicsHints(flowNode) : [];
    const contractText   = flowNode !== undefined ? extractContractText(flowNode, source) : "";
    const hasTaint       = flowNode !== undefined ? detectTaint(flowNode) : false;
    const hasSecrets     = flowNode !== undefined ? detectSecrets(flowNode) : false;
    const governanceCodes = deriveGovernanceCodes(meta, flowNode);
    const qualifierTags  = buildQualifierTags(meta, flowNode, economicsHints);
    const signatureText  = buildSignatureText(meta);
    const lexicalTokens  = buildLexicalTokens(meta, flowNode, contractText);

    const lineStart = meta.location.line ?? 0;
    // Estimate line end from AST node if possible
    const lineEnd = flowNode?.location?.endLine ?? lineStart + 5;

    results.push({
      id: flowId(filePath, meta.name),
      flowName: meta.name,
      qualifier: meta.qualifier,
      filePath,
      lexicalTokens,
      declaredEffects: [...meta.declaredEffects],
      economicsHints,
      hasTaint,
      governanceCodes,
      hasSecrets,
      qualifier_tags: qualifierTags,
      contractText,
      signatureText,
      lineStart,
      lineEnd,
      indexedAt: now,
      sourceMtime,
    });
  }

  return results;
}

// =============================================================================
// Phase 11C — Limit Policy
//
// Parses contract.limits blocks and checks request/batch/memory/prompt limits.
// =============================================================================

import { type AstNode } from "../parser.js";

export interface LimitConfig {
  readonly maxRequestSizeBytes?: number;
  readonly maxBatchSize?: number;
  readonly maxMemoryBytes?: number;
  readonly maxPromptChars?: number;
}

export type LimitViolation = {
  readonly kind: "request_size" | "batch_size" | "memory" | "prompt_size";
  readonly limit: number;
  readonly actual: number;
};

const DEFAULT_LIMIT_CONFIG: LimitConfig = {};

// The recognized `limits {}` declaration grammar — space-separated phrases. SINGLE SOURCE OF TRUTH: both the
// parser below AND the LLN-GOV-019 verifier (via isRecognizedLimitDecl) use these regexes, so they cannot
// drift. (RD-0121 found governance-verifier's snake_case KNOWN_LIMITS_FIELDS allowlist disagreed with this
// runtime grammar — it false-fired GOV-019 on the idiomatic `max request size N MB` form; CWE-1287.)
const LIMIT_REQUEST_SIZE_RE = /max\s+request\s+size\s+(\d+(?:\.\d+)?)\s*(bytes?|kb|mb|gb)/;
const LIMIT_BATCH_SIZE_RE   = /max\s+batch\s+size\s+(\d+)/;
const LIMIT_MEMORY_RE       = /max\s+memory\s+(\d+(?:\.\d+)?)\s*(bytes?|kb|mb|gb)/;
const LIMIT_PROMPT_RE       = /max\s+prompt\s+(\d+)\s*(?:chars?)?/;
const ALL_LIMIT_PATTERNS = [LIMIT_REQUEST_SIZE_RE, LIMIT_BATCH_SIZE_RE, LIMIT_MEMORY_RE, LIMIT_PROMPT_RE] as const;

/**
 * True iff a `limits {}` declaration line matches the runtime-recognized grammar (case-insensitive). The
 * LLN-GOV-019 typo check delegates here so the verifier accepts EXACTLY what the runtime parses — no false
 * positives on the idiomatic space-separated form, real typos still flagged.
 */
export function isRecognizedLimitDecl(decl: string): boolean {
  const v = decl.toLowerCase();
  return ALL_LIMIT_PATTERNS.some((re) => re.test(v));
}

/**
 * Parses a contract AST node and extracts limit configuration.
 *
 * Phase 11C skeleton: looks for a `contractSetDecl` / identifier child
 * with value "limits", then reads nested identifier children for limit
 * declarations such as:
 *   max request size 5 MB
 *   max batch size 100
 *   max memory 256 MB
 *   max prompt 4096 chars
 *
 * Returns an empty config when contractNode is undefined.
 */
export function parseLimitConfig(
  contractNode: AstNode | undefined,
): LimitConfig {
  if (contractNode === undefined) {
    return DEFAULT_LIMIT_CONFIG;
  }

  const limitsSection = findContractSection(contractNode, "limits");
  if (limitsSection === undefined) {
    return DEFAULT_LIMIT_CONFIG;
  }

  let maxRequestSizeBytes: number | undefined;
  let maxBatchSize: number | undefined;
  let maxMemoryBytes: number | undefined;
  let maxPromptChars: number | undefined;

  for (const child of limitsSection.children ?? []) {
    if (child.kind !== "identifier" || child.value === undefined) {
      continue;
    }
    const v = child.value.toLowerCase();

    // "max request size <N> <unit>"
    const reqMatch = v.match(LIMIT_REQUEST_SIZE_RE);
    if (reqMatch?.[1] !== undefined && reqMatch[2] !== undefined) {
      maxRequestSizeBytes = toBytes(parseFloat(reqMatch[1]), reqMatch[2]);
      continue;
    }

    // "max batch size <N>"
    const batchMatch = v.match(LIMIT_BATCH_SIZE_RE);
    if (batchMatch?.[1] !== undefined) {
      maxBatchSize = parseInt(batchMatch[1], 10);
      continue;
    }

    // "max memory <N> <unit>"
    const memMatch = v.match(LIMIT_MEMORY_RE);
    if (memMatch?.[1] !== undefined && memMatch[2] !== undefined) {
      maxMemoryBytes = toBytes(parseFloat(memMatch[1]), memMatch[2]);
      continue;
    }

    // "max prompt <N> chars"
    const promptMatch = v.match(LIMIT_PROMPT_RE);
    if (promptMatch?.[1] !== undefined) {
      maxPromptChars = parseInt(promptMatch[1], 10);
      continue;
    }
  }

  return {
    ...(maxRequestSizeBytes !== undefined ? { maxRequestSizeBytes } : {}),
    ...(maxBatchSize !== undefined ? { maxBatchSize } : {}),
    ...(maxMemoryBytes !== undefined ? { maxMemoryBytes } : {}),
    ...(maxPromptChars !== undefined ? { maxPromptChars } : {}),
  };
}

/**
 * Checks whether `bytes` exceeds the configured request size limit.
 * Returns a LimitViolation when the limit is exceeded, or null otherwise.
 */
export function checkRequestSize(
  bytes: number,
  config: LimitConfig,
): LimitViolation | null {
  if (config.maxRequestSizeBytes === undefined) {
    return null;
  }
  if (bytes > config.maxRequestSizeBytes) {
    return {
      kind: "request_size",
      limit: config.maxRequestSizeBytes,
      actual: bytes,
    };
  }
  return null;
}

/**
 * Checks whether `count` exceeds the configured batch size limit.
 * Returns a LimitViolation when the limit is exceeded, or null otherwise.
 */
export function checkBatchSize(
  count: number,
  config: LimitConfig,
): LimitViolation | null {
  if (config.maxBatchSize === undefined) {
    return null;
  }
  if (count > config.maxBatchSize) {
    return {
      kind: "batch_size",
      limit: config.maxBatchSize,
      actual: count,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function findContractSection(
  contractNode: AstNode,
  sectionName: string,
): AstNode | undefined {
  for (const child of contractNode.children ?? []) {
    if (
      (child.kind === "contractSetDecl" || child.kind === "identifier") &&
      child.value === sectionName
    ) {
      return child;
    }
  }
  return undefined;
}

function toBytes(value: number, unit: string): number {
  switch (unit.toLowerCase().replace(/s$/, "")) {
    case "kb": return Math.round(value * 1024);
    case "mb": return Math.round(value * 1024 * 1024);
    case "gb": return Math.round(value * 1024 * 1024 * 1024);
    default:   return Math.round(value); // bytes
  }
}

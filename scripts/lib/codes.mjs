// scripts/lib/codes.mjs — the ONE shared diagnostic-code regex + helpers.
//
// Review wn8v30euh found THREE divergent hand-rolled regexes (code-index.mjs, audit-coverage.mjs,
// audit-diagnostic-codes.mjs) that mis-parsed real codes: the trailing-letter suffix was truncated
// (LLN-PROFILE-005B → 005, so a shipped code VANISHED and merged into another), multi-segment codes
// were dropped (LLN-GOV-3VL-001, LLN-CRYPTO-PQ-001, LLN-SYNTAX-LEGACY-003), and doc ranges
// (LLN-ACCESS-001-002) were captured as phantom single codes. Import from here; never hand-roll again.
//
//   LLN: family (one or more alpha/num segments) then a final -<digits> with an OPTIONAL trailing letter.
//   ERR: ERR_ then segments; must END on a non-underscore char (rejects ERR_AI_ wildcard prefixes).
export const CODE_SRC = "LLN-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]+[A-Z]?|ERR_[A-Z0-9_]*[A-Z0-9]";

/** Anchored, non-global — test whether a whole token IS a code. */
export const CODE_TEST = new RegExp(`^(?:${CODE_SRC})$`);

// A doc RANGE expression like `LLN-ACCESS-001-002` (two trailing numeric segments) is not a single code.
const RANGE = /-[0-9]+-[0-9]+$/;

/** Extract the real codes mentioned in `text`, de-duped in order, dropping doc-range tokens. */
export function extractCodes(text) {
  const re = new RegExp(`(${CODE_SRC})`, "g"); // fresh regex each call — no shared lastIndex hazard
  const out = [];
  const seen = new Set();
  for (const m of text.matchAll(re)) {
    const c = m[1];
    if (RANGE.test(c)) continue;            // skip NNN-NNN ranges (the individual codes index at their real sites)
    if (!seen.has(c)) { seen.add(c); out.push(c); }
  }
  return out;
}

export const familyOf = (c) => (c.startsWith("ERR_") ? "ERR_*" : (c.match(/^LLN-([A-Z0-9]+)-/)?.[1] ?? "?"));
export const nsOf = (c) => (c.startsWith("ERR_") ? "ERR" : "LLN");

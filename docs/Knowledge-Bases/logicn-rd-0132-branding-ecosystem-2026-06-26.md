# RD-0132 — Branding ecosystem follow-up (notes/68-branding-2, -3) — R&D ONLY, NO DEPLOY

**Date:** 2026-06-26 · **Source:** owner `notes/68-branding-2.md` + `68-branding-3.md` (follow-ups to RD-0131). **Status:** R&D ANALYSIS ONLY — owner said "R&D only no deploy." Nothing renamed/built. Extends [[logicn-rd-0131-rebrand-galerina]].

## One line
The brand NAMES are coherent and (for Galerina/.spore) authorized — but the two notes introduce **a real `.spore` naming COLLISION** (source vs compiled passport) that **blocks the rebrand execution** until resolved, the TritMesh DB taxonomy names a **mostly-aspirational product** (don't let it imply shipped capability), and the marketing COPY contains **refused-overclaim phrases** that must stay out of docs/code.

## ZT/soundness rubric (0–10): 7–10 sound/authorized/coherent · 5–7 fine-but-needs-a-decision · 3–5 aspirational-position-only · 0–3 refused/overclaim/contradiction.

## The table

| # | Element (owner's words) | Verify-before-build status | Verdict | ZT |
|---|---|---|---|---|
| 1 | **Galerina** = language & compiler (replaces LogicN) | RD-0131 authorized; brand cleared | **AUTHORIZED** (hub-timed exec, task #67). The "deadly *Galerina marginata*" angle is now confirmed INTENTIONAL ("unforgiving enforcer" message) — resolves the earlier factual flag; it's a deliberate brand choice, not a risk. | 8 |
| 2 | **`.spore`** file extension | **COLLISION** — branding/-2 say `.spore` = the SOURCE (`.lln`→`.spore`, "the seed"); branding-3 says `.tmf`→`.spore` (the compiled passport, "spores hold the Zero-Trust DNA"). `.spore` cannot be BOTH the source and the compiled output. | **DECISION NEEDED (blocks rebrand).** Metaphor cuts both ways (a spore = portable propagation unit → leans toward the COMPILED `.tmf`; but -2 explicitly assigns it to source). Pick ONE before executing task #67. Recommend: keep the RD-0131 default (`.spore`=source, `.tmf` stays the compiled passport) unless owner prefers `.tmf`→`.spore`. | 5 |
| 3 | **`.tmf`** = compiled passport (TritMesh File) | shipped (`logicn-ext-tmf`) | KEEP as-is under branding-2; OR rename `.tmf`→`.spore` under branding-3 (then source needs a different ext). Tied to #2. Note: `.tmf` carries ML-DSA-65 sigs — renaming the EXTENSION is cosmetic, but its internal magic/format strings are wire-format (don't rebrand those — same crypto-versioning rule as RD-0131). | 6 |
| 4 | **TritMesh** = the network/DB brand (was "Mycelium") | existing concept (TritMesh "Substrate Dispatch Gateway") | **COHERENT POSITION.** Distinct brand from Galerina (compiler). Mycelial metaphor (decentralized sparse routing graph) is apt. Naming, not net-new code. | 7 |
| 5 | **TritMesh DB taxonomy** — Hyphae (graph DB), Sclerotia (cold/object storage), Lamella (relational/document + MeshQL), Apex (in-memory cache), Flux (event stream) | **MOSTLY ASPIRATIONAL** — verified: LogicN ships graph *TOOLING* (project-graph/graph-engine, static analysis — NOT a routing graph DB), an interpreter LRU result-cache (the "passive" tier — NOT a Redis product), and OTLP/Prometheus telemetry (NOT a Kafka stream). NO object-storage / relational-DB / MeshQL (parked) product. | **POSITION-ONLY (names a product not built).** Evocative + internally consistent, but it labels a DB product category LogicN does not ship. Use ONLY as forward-vision branding; do NOT let it imply shipped S3/Postgres/Redis/Kafka equivalents (that would be the overclaim trap). | 3 |
| 6 | **`.spore` as the `.tmf` passport rebrand** (branding-3) | — | Same collision as #2; if `.tmf`→`.spore`, source keeps `.lln` (or another ext). Owner picks. | 5 |
| 7 | **Marketing COPY** — "protecting the database **at the speed of light**", "Galerina executes a **mathematical zero-wipe** and **instantly** kills the process" | refused-overclaim register | **STRIP — do NOT put in docs/code.** "speed of light"/"instantly"/"zero-wipe" are exactly the refused optical-magic + O(1)-zero-wipe framing (`audit-overclaim-phrases.mjs` guards the zero-wipe sub-case). The brand NAMES are fine; this prose is not. Brand around the HONEST claim (fail-closed K3 admission + measured ~1.9× photonic ceiling), not "speed of light." | 1 |

## Key findings (R&D)
1. **The `.spore` collision is a blocker for the authorized rebrand (task #67).** RD-0131 assumed `.lln`→`.spore` (source). branding-3 reassigns `.spore` to the `.tmf` passport. **I will NOT execute the Galerina rebrand until the owner resolves which artifact `.spore` names** — otherwise the rename hardcodes the wrong choice across 429 files. Added as the #1 prerequisite on task #67.
2. **TritMesh DB taxonomy is forward-vision, not shipped.** Beautiful + consistent, but Hyphae/Sclerotia/Lamella/Apex/Flux label a database product (S3/Postgres/Redis/Kafka equivalents) that doesn't exist in LogicN today. Keep it as positioning; do not imply the product ships.
3. **Galerina-poisonous is intentional** — the "lethal/unforgiving enforcer" message is the owner's deliberate brand thesis. Earlier factual flag → resolved (feature, not risk).
4. **Overclaim copy must be quarantined to the brand notes** — "speed of light"/"zero-wipe instantly" cannot enter the repo (CI `audit-overclaim-phrases` + the standing no-overclaim rule).

## Compliance
- **R&D ONLY / NO DEPLOY** — nothing renamed or built; this is the analysis + the collision/overclaim flags.
- **Verify-before-build** — TritMesh DB shipped-status checked against the tree; the `.spore` collision is a literal contradiction between the two notes, not an inference.
- **Two REFUSALS honoured** — the speed-of-light/zero-wipe-instantly copy is flagged refused, not adopted.

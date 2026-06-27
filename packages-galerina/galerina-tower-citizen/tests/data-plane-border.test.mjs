// =============================================================================
// Per-user data hard border — Qexecuted = Q ∩ S_user (owner note 54 / IDOR, CWE-639).
//
// Ports the R&D v2 red-bench (data-plane-hard-border/intersection-redbench.mjs, post-adversarial-
// review) into the prod keep-green suite. The leak oracle is INDEPENDENT ground truth
// (trueOwner/sharedOK) never consulted by the governed path, so a manifest public-flip cannot hide
// a leak. GREEN here = the per-row admission contract; it does NOT model COUNT/JOIN/pagination/
// scope-granularity (named residuals in data-plane-border.ts).
// =============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

const { intersectUserScope, vaultIsPublic, admitRow, admitRowVerdict, Verdict } = await import("../dist/index.js");

// Signed vault manifest. Visibility is fail-closed PRIVATE: only exact "public" widens.
const VAULT_REGISTRY = {
  "vault.messages": { visibility: "private" },
  "vault.catalog":  { visibility: "public" },
  "vault.invoices": { visibility: "private" },
  // "vault.notes" — FORGOTTEN (absent from registry).
  "vault.profile":  { visibility: "privatte" }, // TYPO'd annotation.
};
const PUBLIC_SHARED_SCOPES = new Set(["scope.org", "scope.public"]);
const POLICY = { registry: VAULT_REGISTRY, publicSharedScopes: PUBLIC_SHARED_SCOPES };
// Adversary-2 simulation: a silent manifest public-FLIP of a private vault.
const FLIPPED = { registry: { ...VAULT_REGISTRY, "vault.messages": { visibility: "public" } }, publicSharedScopes: PUBLIC_SHARED_SCOPES };

const ROWS = [
  { id: 1,  ownerScope: "scope.alice", vaultId: "vault.messages", trueOwner: "scope.alice", sharedOK: false },
  { id: 2,  ownerScope: "scope.alice", vaultId: "vault.messages", trueOwner: "scope.alice", sharedOK: false },
  { id: 3,  ownerScope: "scope.bob",   vaultId: "vault.messages", trueOwner: "scope.bob",   sharedOK: false },
  { id: 4,  ownerScope: "scope.bob",   vaultId: "vault.invoices", trueOwner: "scope.bob",   sharedOK: false },
  { id: 5,  ownerScope: "scope.org",   vaultId: "vault.catalog",  trueOwner: "scope.org",   sharedOK: true },
  { id: 6,  ownerScope: "scope.org",   vaultId: "vault.catalog",  trueOwner: "scope.org",   sharedOK: true },
  { id: 7,  ownerScope: "scope.carol", vaultId: "vault.notes",    trueOwner: "scope.carol", sharedOK: false },
  { id: 8,  ownerScope: "scope.bob",   vaultId: "vault.profile",  trueOwner: "scope.bob",   sharedOK: false },
  { id: 9,  ownerScope: "scope.alice", vaultId: "vault.notes",    trueOwner: "scope.alice", sharedOK: false },
  { id: 10, ownerScope: "scope.alice", vaultId: "vault.catalog",  trueOwner: "scope.alice", sharedOK: false },
  // THE ATTACK: Bob's PRIVATE unpublished draft mis-filed into the public catalog vault.
  { id: 99, ownerScope: "scope.bob",   vaultId: "vault.catalog",  trueOwner: "scope.bob",   sharedOK: false },
];

const ALICE = new Set(["scope.alice"]); // proven from Alice's .tmf passport
const BOB = new Set(["scope.bob"]);     // proven from Bob's .tmf passport

const trueLeak = (rows, sUser) => rows.filter((r) => r.sharedOK === false && !sUser.has(r.trueOwner));
const ids = (rows) => rows.map((r) => r.id).sort((a, b) => a - b);
const candidatesFor = (q) => ROWS.filter((r) => (q.vaultId ? r.vaultId === q.vaultId : true));
const naivePath = (q) => candidatesFor(q).filter(q.where || (() => true));
const governed = (q, caller, policy = POLICY) => intersectUserScope(candidatesFor(q), caller, policy, q.where);

const ATTACKS = [
  { key: "a1", caller: ALICE, name: "forgotten-WHERE (dump all messages)", query: { vaultId: "vault.messages" } },
  { key: "a2", caller: ALICE, name: "?user_id=victim tamper (param says bob)", query: { vaultId: "vault.messages", where: (r) => r.ownerScope === "scope.bob" } },
  { key: "a3", caller: ALICE, name: "sweep forgotten/typo'd-visibility vaults", query: {} },
  { key: "a4", caller: ALICE, name: "cross-arena foreign-scope read (invoices)", query: { vaultId: "vault.invoices", where: (r) => r.ownerScope === "scope.bob" } },
  { key: "a5", caller: ALICE, name: "foreign PRIVATE row inside public catalog (id99)", query: { vaultId: "vault.catalog" } },
  { key: "a6", caller: ALICE, name: "silent manifest public-FLIP of vault.messages", query: { vaultId: "vault.messages" }, policy: FLIPPED },
];

for (const c of ATTACKS) {
  test(`attack ${c.key}: ${c.name} — governed returns no foreign rows`, () => {
    const gov = governed(c.query, c.caller, c.policy ?? POLICY);
    assert.equal(trueLeak(gov, c.caller).length, 0, `LEAK: governed returned foreign row(s) [${ids(trueLeak(gov, c.caller))}]`);
  });
}

test("the naive baseline genuinely leaks (RED is not a strawman)", () => {
  let leaks = 0;
  for (const c of ATTACKS) if (trueLeak(naivePath(c.query), c.caller).length > 0) leaks++;
  assert.ok(leaks > 0, "expected the ungoverned path to leak on at least one attack");
});

const LEGIT = [
  { key: "l1", caller: ALICE, name: "caller's OWN private rows returned (alice msgs)", query: { vaultId: "vault.messages" }, expectIds: [1, 2] },
  { key: "l2", caller: ALICE, name: "public catalog: shared + own, foreign-private DENIED", query: { vaultId: "vault.catalog" }, expectIds: [5, 6, 10] },
  { key: "l3", caller: BOB, name: "de-conflation symmetric: Bob sees shared + HIS own (99)", query: { vaultId: "vault.catalog" }, expectIds: [5, 6, 99] },
];

for (const c of LEGIT) {
  test(`legit ${c.key}: ${c.name}`, () => {
    assert.deepEqual(ids(governed(c.query, c.caller)), [...c.expectIds].sort((a, b) => a - b));
  });
}

test("vaultIsPublic — only the exact attested token widens; typo/absent fail closed to private", () => {
  assert.equal(vaultIsPublic("vault.catalog", VAULT_REGISTRY), true);
  assert.equal(vaultIsPublic("vault.messages", VAULT_REGISTRY), false);
  assert.equal(vaultIsPublic("vault.profile", VAULT_REGISTRY), false); // "privatte" typo
  assert.equal(vaultIsPublic("vault.notes", VAULT_REGISTRY), false); // forgotten / absent
});

test("admitRowVerdict — a foreign private row in a public vault is INDETERMINATE → denied (de-conflation)", () => {
  const bobDraft = ROWS.find((r) => r.id === 99);
  assert.equal(admitRowVerdict(bobDraft, ALICE, POLICY), Verdict.INDETERMINATE);
  assert.equal(admitRow(bobDraft, ALICE, POLICY), false);
  // a shared org row in the same public vault IS admitted to anyone
  assert.equal(admitRow(ROWS.find((r) => r.id === 5), ALICE, POLICY), true);
});

test("most-secure default: empty publicSharedScopes ⇒ a public vault admits only the caller's OWN rows", () => {
  const strict = { registry: VAULT_REGISTRY }; // no publicSharedScopes
  // org's shared catalog rows are no longer world-shared without an explicit declaration
  assert.equal(admitRow(ROWS.find((r) => r.id === 5), ALICE, strict), false);
  // but Alice still sees her own catalog row
  assert.equal(admitRow(ROWS.find((r) => r.id === 10), ALICE, strict), true);
});

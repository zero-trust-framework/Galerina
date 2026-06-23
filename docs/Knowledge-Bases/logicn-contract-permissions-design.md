# LogicN — `contract.permissions {}` device-permission clause (DESIGN, net-new)

> **Status: DESIGN PROPOSAL (2026-06-23), not yet implemented.** This documents a *proposed* grammar; it does
> not compile today. The contract sub-block parser has no `permissions` case (only `intent`/`authority`/`access`/…).
> Per the non-negotiable rules, do NOT use this syntax in `.lln` examples until the parser + verifier land.
> Owner-requested: `contract.permissions { hardware.camera }` for per-function device grants.

## 1. What it is + why DISTINCT from `authority{}` / `access{}` / `effects{}`

`permissions {}` already exists as a **boot/task** block (`AstNodeKind "permissionsBlock"`): `boot.lln` uses it for
bootstrap capability restriction (`network`/`file_read`/`file_write`/`environment`/`native_bindings`) and `task {}`
declarations use it for path grants. This proposal adds a **flow-`contract{}` sub-block** for **physical-device /
privacy-surface grants** — a category the existing clauses do *not* cleanly cover:

| Clause | Governs | Why `permissions{}` is distinct |
|---|---|---|
| `effects {}` | side-effect *families* (db.write, network.outbound…) | a camera is not an "effect family"; it's a physical peripheral |
| `authority {}` | typed `SystemCapability` (CallGate, NetworkEgress) | software capabilities, not device hardware |
| `access {}` | who may *call* this flow + what types cross the boundary | inbound call-boundary, not outbound device reach |
| **`permissions {}`** | **physical devices / privacy peripherals** (camera, mic, location, sensors, USB, BT) | **the privacy-surface grant per flow** |

**Verdict: keep distinct** (REC-1), with its own vocabulary and its own runtime register (`V_PERM`), folding into
the same K3 admission algebra as everything else.

## 2. Grammar (REC-1)

A contract sub-block, parsed beside the `access` case (`parser.ts` contract sub-block dispatch), reusing the
dot-path consumer from `parseAuthorityBlock`:

```logicn
secure flow scanDocument(readonly request: ScanRequest) -> Result<Doc, Fault>
contract {
  intent      { "Scan a physical document via the device camera." }
  effects     { storage.write }
  permissions { hardware.camera }          // bare ref = REQUEST this device for THIS flow
}
{ ... }
```

Long-form (symmetry with `access{}`): `permissions { grant hardware.camera  deny hardware.microphone }`.

**Device vocabulary** — a new typed table (sibling of `capability-types.ts`): `DEVICE_PERMISSION_BIT`
(camera=0, microphone=1, location=2, sensors=3, usb=4, bluetooth=5, haptics=6, …), `KNOWN_DEVICE_PERMISSIONS`
(closed set), and `DEVICE_PERMISSION_ALIASES` (`{ geolocation: "hardware.location", "camera.read": "hardware.camera" }`).

## 3. Fail-closed semantics (REC-2) — the zero-trust core

- **(a) Unconfigured = deny.** A flow with no `permissionsDecl`, or a device not listed, is `INDETERMINATE → deny`
  via `allOf([]) === INDETERMINATE` (`three-valued-governance.ts:74`). Deny-by-default, by the algebra.
- **(b) Closed vocabulary.** Any device ref not in `KNOWN_DEVICE_PERMISSIONS` (after alias) → **`LLN-PERM-001` ERROR**
  (stricter than `LLN-ACCESS-001`'s warning — a privacy-peripheral typo must hard-fail).
- **(c) No wildcards.** `hardware.*` → **`LLN-PERM-002` ERROR** (mirrors the `LLN-CAP-001` network-wildcard ban).
- **(d) AI-cannot-self-grant.** An AI-authored/mutated flow that ADDS a device → **`LLN-PERM-005`** (requires human
  approve), enforced by the existing C-005/M-001 widening machinery (`validateTransitionMonotonicity`). Runtime /
  emergency transitions may **CLEAR** a device bit but **NEVER set one** (monotonic decrease).

## 4. Runtime enforcement + audit (REC-3)

1. Compiler lowers `permissionsDecl` → a per-flow **`V_PERM` bitmask** (`deviceToBitmask`, sibling of
   `capabilityToBitmask`).
2. `manifest-generator` emits a `devicePermissions: ["hardware.camera", …]` array into the `.lmanifest` **and folds
   the sorted device list into the CFG fingerprint** (`manifest-generator.ts:613`) — so tampering with the device
   set breaks the signed fingerprint.
3. At the device call boundary, the host/DSS checks `(V_PERM & deviceBit)`; if `0` → **deny + `CapabilityDenied`**
   signal (reuse `EmergencySignalType.CapabilityDenied`).
4. **Every device access (allow OR deny) writes a non-optional audit record** (`{ flow, device, verdict, reason,
   execution_hash }`), mirroring the hardware-selection report.
5. **`LLN-PERM-003`**: flow body calls a device API (e.g. `browser.camera.*`) without a matching `permissions{}` grant.

## 5. Reconcile the legacy spellings (REC-4)

`contract.permissions {}` becomes the **canonical** per-flow device-grant surface. Two existing spellings fold in:
- **`browser { permissions { camera "deny" } }`** stays as an **ENVIRONMENT-level ceiling (clamp)** — a flow's
  `permissions{}` must be a **subset** of the environment ceiling (differential proof, exactly like
  `contract [conforms_to: Policy]` Static Manifest Clamping).
- **`camera.read`-as-effect is retired** → `DEVICE_PERMISSION_ALIASES` normalises it and re-routes to require a
  `permissions { hardware.camera }` grant, emitting **`LLN-PERM-004`** (deprecation). Update
  `browser-dom-and-web-platform-primitives.md` to point here (DOC-004 drift check).

## 6. K3 / Tri-Pipe / tower-citizen tie-in

The device verdict folds as **one more `vAnd` operand** in `tower-citizen`'s `decideAtBoundary` — exactly the
cert-gate pattern. A photonic/sentinel signal (e.g. "tamper detected on the camera bus") can be a **degrade-only
side-signal** (`withSideSignal`, `vAnd = min`): it can lower a device grant to DENY, never lift one. Crypto/keys
stay Binary.

## 7. Diagnostics summary

| Code | Fault |
|---|---|
| `LLN-PERM-001` | unknown device ref (closed-vocabulary, ERROR) |
| `LLN-PERM-002` | wildcard device (`hardware.*`, ERROR) |
| `LLN-PERM-003` | body calls a device API without a `permissions{}` grant |
| `LLN-PERM-004` | device named as an effect (`camera.read`) — declare in `permissions{}` (deprecation) |
| `LLN-PERM-005` | AI-added device permission requires human approval (monotonic-widen guard) |
| `LLN-PERM-006` | flow's `permissions{}` exceeds the environment `browser{permissions{}}` ceiling |

## 8. Build order (when greenlit)
Grammar + `permissionsDecl` AST → device vocabulary table → governance-verifier (LLN-PERM-001/002/005/006) →
`V_PERM` lowering + manifest `devicePermissions[]` + CFG-fingerprint fold → runtime device-boundary check + audit →
alias/deprecation (LLN-PERM-003/004) + doc reconciliation. Each step gets ≥1 MUST-FLAG + ≥1 MUST-PASS fixture per
the #219 triad standard.

## 9. `permissions{}` and third-party packages — it does NOT apply (use `effects{}`)

**Critical clarification (grounded in `logicn-third-party-plugin-authoring-guide.md:110`):** a third-party governed
package's capability surface is **`effects{}`, not `permissions{}`** — *"Do not look for a separate `permissions{}`
block — there isn't one, deliberately"* (0062 §2: a second surface would drift from `effects{}`).

- **Today**, a third-party package declares what it may touch in `effects{}` (`network.outbound`, `ai.inference`,
  `database.write`, …) plus the signed `.lmanifest fuse{}` `capabilities`. The fuse-loader's **Gate-3 (closed
  capabilities)** wires host imports ONLY for declared caps; an undeclared capability has no import →
  `LLN-FUSE-UNKNOWN-CAP` → `CRITICAL_SECURITY_VIOLATION`. **Capability is conferred by the importer, not declared by
  the package** (AI/cleverness cannot expand the set), and a dependency may use only a **subset** of its parent's
  mask (transitive `effects(child) ⊆ mask(parent)`, #202).
- **The `contract.permissions{}` device clause (this doc) is a FLOW-level clause for PHYSICAL DEVICES**
  (camera/mic/location) — distinct from the package effects-surface. If a third-party package needs a device, its
  `permissions{}` request is governed by the **same containment**: deny-by-default, conferred by the importer, and
  clamped **⊆ the importer's granted device set** (the same differential-proof/clamp as the `browser{permissions{}}`
  environment ceiling, §5). A package can never self-grant `hardware.camera`; the app that fuses it must grant it,
  down to the env ceiling. `LLN-PERM-006` enforces the ⊆-ceiling.

**Where the grant lives — at the IMPORT SITE, not in the package.** Capabilities for a third-party plugin are
conferred **where it is imported** (the main module / `boot.lln`), via an `access { grant … }` block on the
`import plugin` statement — **Default Deny** (only listed caps; filesystem/shell/secrets auto-denied). The plugin's
own `effects{}` must be a **subset** of that grant, proven at compile time by the deep DAG audit. Grounded example
([`examples/foundations/hardened-border-plugin.lln`](../../examples/foundations/hardened-border-plugin.lln)):

```lln
;; In the IMPORTING module (main / boot.lln) — THIS is where capabilities are SET:
import plugin safe "./plugins/payment-gateway.lln" as Pay {
  contract {
    intent "Payment gateway — stateless per call"
    access {                       ;; Default Deny — only these are granted
      grant network.outbound       ;; V_DPM bit 0
      grant audit.write            ;; V_DPM bit 3
    }                              ;; filesystem / shell / secrets → automatically denied
  }
}
```
The `payment-gateway` package does **not** grant itself anything — it only declares `effects { … }` (what it uses),
and the DAG audit proves `effects(plugin) ⊆ granted(access)`. `import plugin safe` is demand-loaded (any module);
`import plugin assimilate` (Hot-Code Residency, pre-warmed, reserves V_DPM slots for the whole process lifetime)
may be granted **only in `boot.lln`** (`LLN-ASSIMILATE-001`). Toxic-Border protocol: the plugin is a hostile DMZ —
inputs trapped, run in a `step` DWI isolate, hard-erased after.

**Device permissions follow the same rule.** If a plugin needs `hardware.camera`, the *importer* grants it at the
import site (clamped ≤ the env ceiling, `LLN-PERM-006`); the plugin never self-grants. So **`permissions{}` is never
the third-party grant mechanism** — `access { grant … }` at the import site is, and the package's `effects{}`/(future
device) requests are clamped ⊆ it.

> Source: forward-architecture R&D workflow `wvauqijwc` (2026-06-23), dimension `permissions-contract`;
> third-party grounding from `logicn-third-party-plugin-authoring-guide.md` +
> `examples/foundations/hardened-border-plugin.lln` (owner correction 2026-06-23: the grant is at the import site).

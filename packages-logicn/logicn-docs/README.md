# @logicn/docs

The LogicN **API documentation generator**. It turns the App Kernel's governed
route table into a valid **OpenAPI 3.x** document, so a LogicN service ships the
same machine-readable API description every other framework provides (NestJS via
`@nestjs/swagger`, Spring via springdoc).

This is the backing implementation for the OpenAPI export described — but never
built — in
[`logicn-framework-api-server` README §30](../logicn-framework-api-server/README.md).
The spec there states the rule this package obeys:

> OpenAPI is generated **FROM** the LogicN manifest/route table — it is **not**
> the source of truth.

## What it does

Given the routes a LogicN app declares (the App Kernel's `RouteDeclaration[]`)
or the fully-resolved policies the kernel actually enforces
(`EffectiveRoutePolicy[]`, from
[`logicn-framework-app-kernel`](../logicn-framework-app-kernel)), `@logicn/docs`
emits an OpenAPI 3.x document whose every operation reflects the **real governed
behaviour**:

| Kernel route policy | OpenAPI output |
|---|---|
| `method` + `path` (`:param` → `{param}`) | path item + operation + path parameters |
| `handler` | `operationId` (de-duplicated) |
| `requestType` / `responseType` | `requestBody` / `200` response `$ref` to a component schema |
| `auth.mode = "required"` | `security: [{ bearerAuth: [] }]` + `401`/`403` responses |
| `auth.mode = "public"` | `security: []` (the documented relaxation) |
| `auth.scopes` | `x-logicn-scopes` + documented in the operation description |
| `body.contentType` / `maxSizeBytes` | request `content` key + `413` response + `x-logicn-max-body-bytes` |
| `body.unknownFields` / `duplicateKeys` | `422` response + `x-logicn-*` extensions |
| `idempotency.enabled` | `Idempotency-Key` header parameter + `409` response |
| `limits.rate` / `timeoutMs` / … | `429` response + `x-logicn-rate-limit` / `x-logicn-*` extensions |

The error responses on each operation are exactly the ones the kernel's
fixed pipeline can return for that route — not a generic guess. The OpenAPI
document is therefore a faithful description of the governance surface, suitable
for client generation, contract review, and gateway configuration.

## Security posture — fail closed

`@logicn/docs` follows the same zero-trust defaults as the rest of LogicN:

- **It never invents permissive defaults.** An auth-required route is documented
  as requiring authentication; a `public` route is documented with `security: []`
  *because the source explicitly relaxed it*. The generator reports the API as the
  kernel enforces it, never looser.
- **It fails closed on a bad document.** Before returning, the generator runs a
  structural self-check (valid version, non-empty `info`, every `$ref` resolves,
  unique `operationId`s, every operation has responses). If it cannot produce a
  **valid** OpenAPI 3 document it throws `OpenApiGenerationError` rather than emit
  a broken or misleading API contract.
- **It cannot leak secrets.** The generator reads route *policy metadata* only —
  never request bodies, environment, or credentials. There is no I/O.

## Usage

```ts
import { generateOpenApi, exportOpenApi } from "@logicn/docs";
import { resolveEffectiveRoutePolicy } from "@logicn/framework-app-kernel";

// From the declarations a developer writes (resolved through the secure defaults):
const doc = generateOpenApi({
  info: { title: "Orders API", version: "1.0.0" },
  routes: [
    { method: "POST", path: "/orders", handler: "createOrder",
      requestType: "CreateOrderRequest", responseType: "OrderResponse" },
  ],
});

// Or from policies you already resolved (documents what the kernel enforces verbatim):
const policies = routes.map((r) => resolveEffectiveRoutePolicy(r, { posture: "on" }));
const doc2 = exportOpenApi({ info: { title: "Orders API", version: "1.0.0" }, policies });

console.log(JSON.stringify(doc, null, 2)); // a valid OpenAPI 3.1.0 document
```

`exportOpenApi` is the spec-named entry point from the api-server README;
`generateOpenApi` is its alias. Both accept either `routes` (resolved for you) or
`policies` (used as-is) and an optional `openApiVersion` (`"3.1.0"` default, or
`"3.0.3"`).

## Build

The repo is not an npm workspace, so build with the vendored compiler:

```sh
node ../logicn-tower-citizen/node_modules/typescript/lib/tsc.js -p tsconfig.json
# → dist/index.js (+ .d.ts)
node --test tests/*.test.mjs
```

## What this package does NOT do

- It does not serve HTTP, route requests, or run handlers — that is the App
  Kernel and `logicn-framework-api-server`.
- It does not own the route model — it reads the App Kernel's types.
- It is not the source of truth — the governed source and the kernel are. The
  generated OpenAPI is a derived view and is regenerated, never hand-edited.

## What this level teaches

- What effects are and why every side-effecting operation must be declared
- Effect names: `database.read`, `database.write`, `network.outbound`, `network.inbound`, `audit.write`, `storage.read`, `storage.write`, `ai.inference`, `pii.read`, `pii.write`
- `pure flow` carries no effects — the compiler enforces this
- `guarded flow` and `secure flow` declare effects in the `contract { effects { ... } }` block
- `with effects [...]` inline syntax as an alternative to the contract block
- How effects propagate: a caller must declare every effect required by every callee
- `fn` (local helper) inside a flow: the helper cannot re-declare effects; it inherits the parent's scope
- Error codes `FUNGI-EFFECT-001` through `FUNGI-EFFECT-004` and what triggers each

## Canonical patterns

```fungi
// pure flow: no effects permitted, compiler rejects any effectful call
pure flow calculateVat(price: Money<GBP>) -> Money<GBP>
contract {
  intent { "Calculate VAT at 20% with no side effects." }
}
{
  return price * Decimal("0.20")
}
```

```fungi
// guarded flow: effects declared in contract; callers must inherit them
guarded flow processOrder(order: Order) -> ProcessOrderResult
contract {
  types { type ProcessOrderResult = Result<OrderId, ProcessError> }
  intent { "Process an order — inherits database.write from saveOrder." }
  effects {
    database.write
  }
}
{
  let orderId = saveOrder(order)?
  return Ok(orderId)
}
```

## Do not use in this level

- `result of X else Y` (proposal only — use `Result<T, E>`)
- `contract set` (governance templates — Level 5)
- `compute target` blocks (Level 6)
- `authority` blocks (Level 9)
- Declaring effects on a `fn` local helper — effects are inherited from the enclosing flow

## Key diagnostics this level demonstrates

| Code | Meaning |
|------|---------|
| `FUNGI-EFFECT-001` | Effect used in body but not declared in the contract `effects` block |
| `FUNGI-EFFECT-002` | `pure flow` body contains an effectful call |
| `FUNGI-EFFECT-003` | Caller flow missing an effect required by a called flow |
| `FUNGI-EFFECT-004` | `fn` local helper attempts to declare its own effects — not permitted |

## Example IDs at this level

101-pure-no-effects, 102-guarded-database-write, 103-guarded-network-outbound, 104-multiple-effects, 105-missing-database-effect, 106-missing-network-effect, 107-pure-flow-calls-effectful-flow, 108-guarded-flow-calls-effectful-flow, 109-local-fn-pure-helper, 110-local-fn-uses-parent-effect, 111-local-fn-effect-not-covered-by-parent, 112-local-fn-cannot-declare-effects, 113-secure-flow-with-effects, 114-secure-flow-missing-audit-effect, 115-effect-propagation-through-call, 116-effect-propagation-missing-parent, 117-effectful-operation-in-pure-flow, 118-filesystem-read-guarded, 119-effect-name-invalid, 120-effect-summary-example

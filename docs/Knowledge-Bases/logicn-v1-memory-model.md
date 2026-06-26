# LogicN — V1 Memory Model Specification

> **⚠️ MEMORY-SAFETY STANCE SUPERSEDED (0034 verdict, 2026-06-18).** The "Phase 5 full lifetime and borrow
> analysis" this doc commits to is a **non-goal** — it was never built and is not on the roadmap.
> `LLN-MEMORY-001..008` are not emitted; `borrow`/`borrow mut`/`move`/`pinned` examples parse/compile clean but are unenforced (corrected #65). The
> canonical model is **"Governed Capability + Ternary-Tagged Memory"** (value-state/taint + effect/capability
> + runtime generation-tag UAF guards, shipped `692e62d`) — see **`logicn-memory-safety-model.md`**. The
> Phase-3 *scanner-level* enforcement described here is real; the borrow/lifetime tier is design-only; `USE_AFTER_MOVE` (LLN-MEMORY-001) was honest-retired as RESERVED in #65 — consume-once already ships as `LLN-AFFINE-001`.

## Purpose

This document is the authoritative Phase 3 commitment for the LogicN v1 memory
model. It defines what is enforced in v1, what is deferred, and what the
compiler is responsible for at each phase.

> **Maturity:** This document describes the v1 memory model commitment.
> Scanner-level enforcement (Phase 3) is implemented. Full lifetime and borrow
> analysis (Phase 5) is pending a working parser and AST.

---

## Design Decision: Hybrid Ownership Model

LogicN v1 uses a **hybrid ownership model** combining:

- Rust-like single-owner move semantics for resources
- Immutable sharing of values that do not carry destructors
- Explicit `borrow` and `borrow mut` for temporary access
- `pinned` for DMA-safe memory regions (GPU/accelerator planning)
- A hard ban on raw pointers in normal code

This model is chosen because:

1. It prevents use-after-free and double-free at compile time.
2. It makes resource lifetimes explicit and deterministic.
3. It supports heterogeneous compute targets without implicit copies.
4. It avoids garbage-collector pauses in compute-critical paths.

---

## Rule 1 — Immutable Sharing

Values that do not own external resources (scalars, immutable records, read-only
views) can be shared freely without copying:

```logicn
let config: Config = Config { timeout: 30, retries: 3 }
let a = config.timeout   // safe — Config is immutable here
let b = config.retries   // safe
```

**Rule:** Immutable values (`let` bindings) may be read from multiple sites
within their scope. There is no borrow needed for pure reads.

**Phase 3 enforcement:** The scanner rejects `mut` bindings in `pure flow`
bodies (LLN-BINDING-004). Reads of immutable values do not require borrowing.

---

## Rule 2 — One Active Mutable Owner

At any point in a flow, there is exactly one active owner of a mutable value.
Two mutable aliases of the same value cannot coexist.

```logicn
mut buffer: Buffer = Buffer.allocate(1024)
let ref1 = borrow mut buffer
let ref2 = borrow mut buffer   // COMPILE ERROR: LLN-MEMORY-005 — MUTABLE_ALIAS
```

**Phase 3 enforcement:** LLN-MEMORY-005 is defined and exported. Full alias
tracking requires Phase 5 (AST borrow checker).

---

## Rule 3 — Read-Only Borrows

A `borrow` produces a temporary read-only view. The owner retains ownership
and cannot be moved while the borrow is active:

```logicn
pure flow peekFirstByte(borrow buf: Buffer) -> Option<UInt8> {
  return buf.get(0)
}
```

Properties:
- Multiple simultaneous read-only borrows are permitted.
- A read-only borrow cannot coexist with a mutable borrow.
- The borrow expires at the end of the scope.

**Phase 3 enforcement:** `borrow` is a reserved keyword (Phase 3–4). Scanner
enforces that `borrow` appears in keyword token position. Full lifetime
enforcement is Phase 5.

---

## Rule 4 — Mutable Borrows

A `borrow mut` grants exclusive mutable access for a scope. No other borrows or
aliases may be active:

```logicn
flow appendEntry(borrow mut log: Log, entry: String) -> Result<Void, LogError> {
  log.write(entry)
}
```

Properties:
- Exactly one `borrow mut` may be active at a time.
- The mutable borrow expires at the end of its scope.
- The original owner regains full ownership afterward.

**Phase 3 enforcement:** LLN-MEMORY-005 is defined. Aliasing detection is
Phase 5 (AST borrow checker).

---

## Rule 5 — Move Semantics for Resources

Ownership of a resource can be transferred explicitly using `move`. After a
move, the source is invalid — any use of it is a compile error:

```logicn
flow handleRequest(move conn: Connection) -> Result<Response, ConnError> {
  // conn is now owned here
  return processRequest(conn)
  // conn ownership transferred to processRequest — use after this is rejected
}
```

```logicn
sendPayload(move payload)
return transmit(payload.data)  // COMPILE ERROR: LLN-MEMORY-001 — USE_AFTER_MOVE
```

**Phase 3 enforcement:** LLN-MEMORY-001 (USE_AFTER_MOVE) is defined. Scanner
can detect simple sequential use-after-move patterns. Full cross-branch move
validation is Phase 5.

---

## Rule 6 — Borrow Escape Rules

A borrow cannot escape the scope of its owner. Returning a borrow reference
from a flow or storing it in a longer-lived binding is rejected:

```logicn
flow getRef() -> borrow Buffer {  // COMPILE ERROR: LLN-MEMORY-003
  let buf: Buffer = Buffer.allocate(64)
  return borrow buf               // borrow would outlive buf
}
```

**Phase 3 enforcement:** LLN-MEMORY-003 (BORROW_ESCAPES_SCOPE) is defined.
Escape analysis requires Phase 5 (lifetime analysis on AST).

---

## Rule 7 — Bounds Checks

Array and buffer indexing must be bounds-safe. Direct index access that cannot
be proven in-bounds at compile time must use safe access methods:

```logicn
let item = items[0]             // SAFE only if length is proven > 0
let safe = items.get(0)         // returns Option<T> — always safe
```

**Phase 3 enforcement:** LLN-MEMORY-006 (BOUNDS_VIOLATION) is defined. Static
bounds proof and runtime bounds check insertion are Phase 5 (type checker) and
Phase 6 (code generation).

---

## Rule 8 — Raw Pointer Ban in Normal Code

Raw pointer dereference expressions (`*ptr`) are forbidden outside approved
`unsafe` blocks. LogicN provides no raw pointer type in normal code:

```logicn
let value = *rawPtr          // COMPILE ERROR: LLN-RAWPTR-001
```

Inside an unsafe block, raw pointer access is permitted but requires a declared
`reason` and `fallback`:

```logicn
unsafe block readRaw reason "Hardware register needs direct read" fallback safeRead {
  let value = *mmio_reg
}
```

**Phase 3 enforcement:**
- LLN-RAWPTR-001 (RAW_POINTER_OUTSIDE_UNSAFE) — scanner detects `*identifier`
  patterns outside unsafe scope.
- LLN-MEMORY-008 (UNSAFE_MEMORY_REQUIRES_FALLBACK) — scanner rejects `unsafe
  block` openings without a `reason` declaration on the same line.

---

## Rule 9 — Explicit Unsafe Boundary for Future FFI

All foreign function interface (FFI) calls must be contained in an `unsafe`
block with declared `reason` and `fallback`. FFI is post-v1 but the boundary
mechanism is v1:

```logicn
// Post-v1 FFI pattern:
unsafe block callLibC reason "Required for OS-level socket API" fallback internalSocket {
  let fd = libc.socket(AF_INET, SOCK_STREAM, 0)
}
```

**Phase 3 enforcement:** The `unsafe block` + `reason` + `fallback` structure
is enforced by the Phase 3 scanner. FFI declarations themselves are post-v1.

---

## Ownership State Machine

Every bound value has an explicit ownership state tracked by the compiler:

| State | Description | Phase enforced |
|---|---|---|
| `owned` | Normal owned value on its own lifetime | Phase 3 (binding level) |
| `borrowed` | Temporary read-only access; owner retains ownership | Phase 5 (lifetime) |
| `borrowed_mut` | Exclusive mutable access within a scope | Phase 5 (lifetime) |
| `moved` | Ownership transferred; source invalid | Phase 3 (sequential) / Phase 5 (full) |
| `pinned` | Locked in memory for DMA / accelerator transfer | Phase 5 |

---

## Phase Boundary

This document commits to the following split:

```
Phase 3 (binding-level, scanner):
  ✓ mut in pure flow rejected (LLN-BINDING-004)
  ✓ unsafe block without reason rejected (LLN-MEMORY-008)
  ✓ raw pointer outside unsafe rejected (LLN-RAWPTR-001)
  ✓ let/readonly reassignment rejected (LLN-BINDING-001/002)
  ✓ readonly mutation rejected (LLN-BINDING-003)
  ✓ LLN-MEMORY-001..008 defined (subset enforced at scanner level)

Phase 5 (lifetime rules, AST borrow checker):
  ○ Full lifetime analysis: borrow does not outlive owner (LLN-MEMORY-003)
  ○ Mutable alias detection: two borrows cannot coexist (LLN-MEMORY-005)
  ○ Cross-branch move tracking: use-after-move across all paths (LLN-MEMORY-001 full)
  ○ Borrow escape analysis: borrows cannot be returned or stored long-term
  ○ Bounds proof insertion: static + runtime bounds checks (LLN-MEMORY-006)
  ○ Pinned allocation planning (LLN target integration)
```

---

## Compiler Diagnostic Series

Memory and safety diagnostics use the `LLN-MEMORY-*`, `LLN-RAWPTR-*`, and
`LLN-BINDING-*` series. See `compiler-diagnostics.md` for the full table.

| Series | Covers |
|---|---|
| `LLN-MEMORY-001..008` | Ownership, borrow, move, aliasing, bounds, unsafe |
| `LLN-RAWPTR-001` | Raw pointer access outside unsafe blocks |
| `LLN-BINDING-001..004` | Immutable binding, readonly binding, mut-in-pure |

---

## Architecture Placement

| Layer | Responsibility |
|---|---|
| `logicn-core/src/index.ts` | `AstNodeKind` memory node vocabulary |
| `logicn-core-compiler/src/index.ts` | Scanner-level enforcement (Phase 3); diagnostic constants |
| `logicn-core-compiler` (Phase 5) | AST borrow checker, lifetime analysis, full move tracking |
| `logicn-core-runtime` | Pinned memory allocator, transfer scheduling |
| `docs/Knowledge-Bases/v1-reserved-keywords.md` | Keyword reservation for borrow, move, pinned |
| `docs/Knowledge-Bases/logicn-memory-borrow-move-pinned.md` | Borrow/move/pinned semantics reference |

---

## Exit Criteria (Phase 3)

- [x] Memory model decision documented here (hybrid ownership).
- [x] LLN-MEMORY-001..008 defined in `logicn-core-compiler`.
- [x] LLN-RAWPTR-001 defined and scanner-enforced.
- [x] LLN-BINDING-004 (`mut` in `pure flow`) defined and scanner-enforced.
- [x] `unsafe block` without `reason` rejected (LLN-MEMORY-008).
- [x] `borrow`, `move`, `pinned` reserved in `v1-reserved-keywords.md`.
- [x] AST node vocabulary committed to `AstNodeKind`.
- [x] Phase boundary between Phase 3 (scanner) and Phase 5 (lifetime) documented.
- [x] 28/28 compiler contract tests passing.

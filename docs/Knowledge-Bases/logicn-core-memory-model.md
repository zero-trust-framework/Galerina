# LogicN v1 Memory Model

> **⚠️ SUPERSEDED in part (0034 verdict, 2026-06-18).** The "compiler-checked move/borrow rules" advanced
> tier below is **design-only and not enforced** — the borrow checker was never built (`LLN-MEMORY-001..008`
> are not emitted; `borrow`/`move` examples parse/compile clean but are unenforced — corrected #65). LogicN's canonical memory-safety model is
> **"Governed Capability + Ternary-Tagged Memory"** (value-state/taint + effect/capability + runtime
> generation-tag UAF guards) — see **`logicn-memory-safety-model.md`**. The *binding hierarchy*
> (`let`/`mut`/`readonly`), bounds checks, and the `unsafe` boundary in this doc are real and shipped; the
> borrow/move ownership tier is a **non-goal**; `USE_AFTER_MOVE` (LLN-MEMORY-001) was honest-retired as RESERVED in #65 — consume-once already ships as `LLN-AFFINE-001`.

**Status:** Canonical v1 decision (memory-safety stance superseded — see banner)  
**Scope:** `@logicn/core`, `@logicn/core-compiler` — binding rules, ownership, borrows, bounds checks, unsafe boundary  
**Source:** NOTES TO COVER / d, e (2026-05-26)  
**Related KB:** `logicn-core-syntax-bindings-pipeline.md`, `logicn-core-standard-types-string-char-byte.md`

---

## 1. Decision Summary

LogicN v1 uses a **hybrid ownership model**:

```text
Default:  safe managed memory
Advanced: compiler-checked move/borrow rules
Runtime:  bounds checks always on unless proven safe at compile time
Unsafe:   only inside approved unsafe block with declared reason + fallback
```

This is not full Rust-level ownership — it is a practical v1 subset that gives the runtime enough information to safely plan GPU transfer, zero-copy operations, and parallel execution without requiring explicit lifetime annotations everywhere.

---

## 2. Binding Hierarchy

```text
let      — immutable binding; value cannot be reassigned
mut      — mutable binding; reassignment is explicit and visible
readonly — shared read-only view; mutation through this reference is rejected
move     — transfer ownership to callee; caller may not use value after
borrow   — temporary access; does not transfer ownership
copy     — explicit duplication; both owner and caller hold independent values
```

`var` and `const` are rejected (`LLN-SYNTAX-001`, `LLN-SYNTAX-002`).  
`borrow`, `move`, `copy` are used at call sites, not as declaration keywords.

---

## 3. Borrow and Move Rules

### Move

```logicn
let data = Buffer.from(input)

// Ownership moves into processBuffer.
// data cannot be used after this line.
processBuffer(move data)
```

After `move data`, any use of `data` is `LLN-MEMORY-001` (`USE_AFTER_MOVE`).

### Readonly Borrow

```logicn
readonly config = loadConfig()

// Shared read-only borrow — no transfer of ownership.
// Cannot mutate through this reference.
useConfig(borrow config)
```

Multiple readonly borrows may coexist.

### Mutable Borrow

```logicn
mut buffer = Buffer.empty()

// Mutable borrow — only one may exist at a time.
writeBuffer(borrow mut buffer)
```

A mutable borrow cannot coexist with any other borrow of the same value.

---

## 4. Canonical Borrow/Move Rules

```text
One mutable borrow OR many readonly borrows — never both simultaneously.
A moved value cannot be used again.
A borrow cannot outlive its owner.
A readonly borrow cannot mutate.
A mutable borrow cannot escape the current scope unless explicitly returned as a move.
```

---

## 5. Escape Rules

**Invalid — borrow escapes local scope:**

```logicn
fn bad() -> Borrow<User> {
  let user = User { name: "Ada" }
  return borrow user   // LLN-MEMORY-003: borrow escapes owner scope
}
```

**Valid — transfer via move:**

```logicn
fn good() -> User {
  let user = User { name: "Ada" }
  return move user
}
```

---

## 6. Bounds-Check Behaviour

Bounds checks are **always required** in v1.

```logicn
let item = items[index]
```

The compiler or runtime must ensure `index >= 0` and `index < items.length`. If the compiler cannot prove this statically, the runtime check remains.

**Preferred safe form:**

```logicn
match items.get(index) {
  Some(item) => use(item)
  None       => return Err("index out of bounds")
}
```

**Unchecked access only inside approved unsafe block:**

```logicn
unsafe block FastVectorRead
  reason "compiler-proven loop bounds in generated kernel"
  requires approval "unchecked-index"
  fallback safeVectorRead
{
  let item = items.unchecked(index)
}
```

---

## 7. Memory Diagnostic Codes — LLN-MEMORY-001..008

| Code | Name | Description |
|---|---|---|
| `LLN-MEMORY-001` | `USE_AFTER_MOVE` | A moved value was used again |
| `LLN-MEMORY-002` | `BORROW_AFTER_MOVE` | A value was borrowed after ownership moved |
| `LLN-MEMORY-003` | `BORROW_ESCAPES_SCOPE` | Borrowed reference outlives its owner |
| `LLN-MEMORY-004` | `READONLY_MUTATION` | Attempted mutation through a readonly reference |
| `LLN-MEMORY-005` | `MUTABLE_ALIAS` | A mutable borrow exists while another borrow/alias is active |
| `LLN-MEMORY-006` | `BOUNDS_VIOLATION` | Index may be outside collection bounds |
| `LLN-MEMORY-007` | `UNCHECKED_ACCESS_OUTSIDE_UNSAFE` | `unchecked` access used outside an approved unsafe block |
| `LLN-MEMORY-008` | `UNSAFE_MEMORY_REQUIRES_FALLBACK` | Unsafe memory operation has no declared safe fallback |

All eight codes have severity `"error"`.

---

## 8. Unsafe Block Boundary — v1 Decision

In v1, `unsafe block` is a **governed, audited, fallback-required escape hatch** — not an unrestricted zone.

### Allowed in v1

```text
FFI call boundary with typed inputs/outputs
unchecked index/access with documented reason and compiler-proven bounds
native library call through a declared native interface
raw pointer / native handle wrapper
manual memory view over external buffer
performance-critical kernel wrapper
```

### Not Allowed in v1 (post-v1 only)

```text
arbitrary pointer arithmetic
unbounded raw memory writes
thread-unsafe shared mutation
secret / policy / effect bypass
unchecked network or socket access
silent auth bypass
runtime self-modifying code
unsafe block without fallback
```

### Required Unsafe Block Syntax

```logicn
unsafe block NativeImageResize
  intent "resize image through approved native library"
  reason "native library supports required image format"
  requires approval "native-interop"
  fallback safeImageResize
{
  native.call("resize_image")
}
```

### Required Unsafe Block Semantics

```text
1. unsafe must be named.
2. unsafe must declare intent.
3. unsafe must declare reason.
4. unsafe must declare approval capability.
5. unsafe must declare fallback.
6. unsafe cannot bypass secret / policy / effect checks.
7. unsafe must emit audit/evidence report.
8. unsafe cannot leak raw pointers outside the block unless wrapped in a safe type.
```

---

## 9. FFI v1 Rule

FFI is permitted only through **declared native interfaces** with typed inputs, typed outputs, declared effects, memory bounds, and a safe fallback.

```logicn
native interface ImageLib
  effects [native.call, memory.external]
{
  fn resize(input: Bytes, width: Int, height: Int) -> Result<Bytes, NativeError>
}
```

---

## 10. Copy Types

Types may be marked copyable to opt out of move semantics:

```text
copy types:  Int, Float, Bool, Char, Byte, small value types
move types:  Buffer, Bytes, File handles, network streams, secrets
```

Copying a `ProtectedSecret` is `LLN-SECURITY-*` — secrets must move, not copy.

---

## 11. GPU / Zero-Copy Implications

The memory model directly enables the compute target planner:

```text
readonly borrow   → safe to share with GPU kernel (no mutation)
move              → zero-copy transfer to GPU (runtime owns memory from here)
copy              → explicit duplication for GPU — planner warns on large copies
pinned            → post-v1 — required for DMA transfers
```

---

## 12. v1 Implementation Checklist

```text
[x] let / mut / readonly — in compiler and AstNodeKind (2026-05-26)
[x] LLN-SYNTAX-001 (var) / LLN-SYNTAX-002 (const) enforced
[x] LLN-BINDING-001..004 — binding reassignment/mutation diagnostics
[ ] move / borrow / copy — call-site keywords in parser
[ ] LLN-MEMORY-001..008 — diagnostic constants in @logicn/core-compiler
[ ] borrow checker — symbol table + scope tracking in compiler passes
[ ] bounds check enforcement — runtime check injection in code gen
[ ] unsafe block FFI interface — native interface declaration in parser
```

---

## 13. Post-v1 Only

```text
pinned memory (DMA, GPU transfer)
advanced pointer lifetimes
custom allocators
zero-copy external memory regions
thread-affine native handles
advanced borrow escape analysis
WASM linear memory model integration
```

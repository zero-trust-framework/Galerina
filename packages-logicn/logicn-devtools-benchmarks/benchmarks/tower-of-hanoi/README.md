# tower-of-hanoi

3-peg **Tower of Hanoi** with a **threaded move-checksum** — a harder cross-language recursion benchmark than
naive recursion. Every one of the `2^n − 1` moves is actually executed and folded into a rolling checksum:

```
acc = (acc * 31 + moveCode) % 65521        moveCode = n*36 + from*6 + to
```

Why this design:
- **Real work, not the closed form.** The number of moves is `2^n − 1`, but the checksum forces every move to
  be computed — a runtime cannot shortcut to the answer. Stresses deep recursion (`2^n` call frames) + per-call
  arithmetic.
- **Cross-language-identical `result`.** All runtimes compute the same checksum (**42452 at n=16**), so the
  truth-audit can assert checksum identity across Python / Node / C++ / Rust / LogicN.
- **i32-overflow-safe by construction.** `acc < 65521 ⇒ acc*31 < 2,031,151 < 2^31`, so no intermediate ever
  trips LogicN's Fork-A overflow trap (a *wrapping* hash would TRAP in LogicN — that is the point: the
  checksum is chosen to be exact under fail-closed integer semantics, not to rely on silent wraparound).

Run: `--n <disks>` (default 16 = 65,535 moves/call), `--iterations <k>`. Files: `python.py`, `node.mjs`,
`bench.rs`, `bench.cpp`, `benchmark.lln`. Native: `rustc -O bench.rs`. Metric: **moves/sec**; oracle: `result`.

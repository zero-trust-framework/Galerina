# LogicN diagrams

Rendered SVG architecture diagrams. All use a shared palette so the set reads as one system:

- **teal** = trusted core / runtime · **blue** = compile-time · **amber** = governed-but-untrusted (ext / lanes) · **purple** = cross-cutting invariant.

| Diagram | What it shows | Read it with |
|---|---|---|
| [logicn-full-stack.svg](logicn-full-stack.svg) | the whole stack, source → governed runtime | the system overview |
| [logicn-mechanics.svg](logicn-mechanics.svg) | the governance-first compile→sign→gate pipeline | `logicn-kb-index.md` |
| [logicn-compiler.svg](logicn-compiler.svg) | Stage-A compiler internals | `project-logicn-compiler-gaps.md` |
| [logicn-compiler-pipeline-foresight.svg](logicn-compiler-pipeline-foresight.svg) | the compiler pipeline + forward-looking passes | the build roadmap |
| [logicn-runtime.svg](logicn-runtime.svg) | the K3 fail-closed runtime gate | `logicn-governance-rules.md` |
| [logicn-framework.svg](logicn-framework.svg) | the Zero-Trust application framework | `logicn-post-framework-architecture.md` |
| [logicn-tower-citizen.svg](logicn-tower-citizen.svg) | the DRCM / Tower-citizen containment model | `logicn-drcm.md` |
| [logicn-tri-pipe.svg](logicn-tri-pipe.svg) | the Tri-Pipe execution router (binary / hybrid / photonic) | `logicn-photonic-ppu-virtualisation.md` |
| **[logicn-untrusted-governed-lane.svg](logicn-untrusted-governed-lane.svg)** | **Govern-Don't-Absorb — the decision stays in the trusted core, the work runs in an untrusted lane admitted by a signed predicate and combined back by No-Coercion `min`** | **[`untrusted-governed-lane.md`](../Knowledge-Bases/untrusted-governed-lane.md)** |

## How they fit together

`full-stack` is the map. `mechanics` + `compiler*` are the **compile-time** half (blue). `runtime` +
`framework` are the **run-time** half (teal). `tower-citizen` is the containment substrate. The two
**security-architecture** diagrams are companions:

- **`tri-pipe`** answers *"how is work dispatched to a faster substrate?"* (the router).
- **`untrusted-governed-lane`** answers *"why is that safe?"* (the trust boundary): the Tri-Pipe routes
  the **work** into the untrusted lane, while the **verdict** path the `runtime` diagram shows stays
  binary, digital, and fail-closed. Admission is the **IN** seam; No-Coercion `min` is the **OUT** seam.

So the canonical reading order for the security story is: `full-stack` → `mechanics` → `runtime` →
`tri-pipe` → `untrusted-governed-lane`.

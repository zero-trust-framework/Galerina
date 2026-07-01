# 117 — Effectful operation in pure flow

**Concept:** ilesystem.read in a pure flow is forbidden

s.readText is a ilesystem.read operation. Pure flows cannot perform any I/O at all. Use a guarded flow with effects [storage.read].

**AI rule:** Pure flows cannot perform any I/O, including filesystem reads.

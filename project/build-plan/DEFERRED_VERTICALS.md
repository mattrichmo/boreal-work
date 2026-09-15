# Deferred adapters and expansion gates

These are candidate v2 extensions, not part of the launch acceptance gate.
The listed trigger and boundary keep them reviewable without allowing them to
distort the first product's storage or lifecycle.

| Vertical | Trigger to start | Required boundary and first acceptance |
| --- | --- | --- |
| Remote multi-host service | Agents must run on separate machines. | Authenticated network API; agents connect to the service, never a shared SQLite WAL file. Test duplicate claim and stale fence across hosts. |
| MCP adapter | Harnesses require tool-protocol integration beyond CLI/API. | Thin adapter of the versioned protocol; no direct DB or independent transitions. Test typed errors and bounded outputs. |
| Web console | Real web workflows justify maintenance. | Read models and mutations through the same API; no fixture-era hardcoded sprint/query defaults. Test full mounted task path. |
| Cross-project/global manager | Multiple projects need an operator board. | Registry is a derived aggregate of project revisions; no global canonical work status. Counts must not be capped-row totals. |
| Automatic agent launching | Pull/claim is stable and users want scheduling. | P2 may select/claim eligible work deterministically, but launching harness processes is deferred. Future adapters launch/observe/cancel via the same attempt and explicit eligibility. |
| Semantic/embedding search | Deterministic FTS has measured recall gaps. | Versioned derived index with source/Git revision and visible lag; citations remain first-class. |
| Complex knowledge adjudication | Product memory needs supported/contradicted claim workflow. | Separate reviewed memory-entry lifecycle, no effect on live task status without explicit work operation. |
| Broad custom templates/workflow packs | Repeated specialized workflows justify expansion beyond the core. | Versioned declarative templates compile to application commands; no separate state machine. The trusted `guide`/`next`, claim/evidence/finish, recovery, and core contextual handoff paths are launch scope, not deferred. |
| Git-based cross-team sync | Git memory publication and local work export are stable. | Reconcile explicit revisions/conflicts; do not use Git merge as a claim transaction. |

An extension gets its own discovery/design -> implementation -> independent
review -> findings reconciliation -> revalidation chain and a benchmark that
includes the existing v2 core workload. It cannot weaken attempt, evidence,
memory provenance, or snapshot guarantees.
The absence of a bespoke prompt must not make the first useful agent workflow
unusable; see [Vertical 11](verticals/11-agent-guidance.md).

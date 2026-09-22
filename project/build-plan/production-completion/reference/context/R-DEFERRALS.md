# R-DEFERRALS — project/build-plan/DEFERRED_VERTICALS.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/build-plan/DEFERRED_VERTICALS.md:L1–L24`  
**File SHA-256:** `4f55be27958cc1a8cbe0ba147e10690bbdfd228d84eb47d38816b7c44c8b6713`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Approved local-launch non-goals; core no-goal guidance and memory are not deferred.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,24p' 'project/build-plan/DEFERRED_VERTICALS.md'
```

## Exact baseline excerpt

````text
    1 | # Deferred adapters and expansion gates
    2 | 
    3 | These are candidate v2 extensions, not part of the launch acceptance gate.
    4 | The listed trigger and boundary keep them reviewable without allowing them to
    5 | distort the first product's storage or lifecycle.
    6 | 
    7 | | Vertical | Trigger to start | Required boundary and first acceptance |
    8 | | --- | --- | --- |
    9 | | Remote multi-host service | Agents must run on separate machines. | Authenticated network API; agents connect to the service, never a shared SQLite WAL file. Test duplicate claim and stale fence across hosts. |
   10 | | MCP adapter | Harnesses require tool-protocol integration beyond CLI/API. | Thin adapter of the versioned protocol; no direct DB or independent transitions. Test typed errors and bounded outputs. |
   11 | | Web console | Real web workflows justify maintenance. | Read models and mutations through the same API; no fixture-era hardcoded sprint/query defaults. Test full mounted task path. |
   12 | | Cross-project/global manager | Multiple projects need an operator board. | Registry is a derived aggregate of project revisions; no global canonical work status. Counts must not be capped-row totals. |
   13 | | Automatic agent launching | Pull/claim is stable and users want scheduling. | P2 may select/claim eligible work deterministically, but launching harness processes is deferred. Future adapters launch/observe/cancel via the same attempt and explicit eligibility. |
   14 | | Semantic/embedding search | Deterministic FTS has measured recall gaps. | Versioned derived index with source/Git revision and visible lag; citations remain first-class. |
   15 | | Complex knowledge adjudication | Product memory needs supported/contradicted claim workflow. | Separate reviewed memory-entry lifecycle, no effect on live task status without explicit work operation. |
   16 | | Broad custom templates/workflow packs | Repeated specialized workflows justify expansion beyond the core. | Versioned declarative templates compile to application commands; no separate state machine. The trusted `guide`/`next`, claim/evidence/finish, recovery, and core contextual handoff paths are launch scope, not deferred. |
   17 | | Git-based cross-team sync | Git memory publication and local work export are stable. | Reconcile explicit revisions/conflicts; do not use Git merge as a claim transaction. |
   18 | 
   19 | An extension gets its own discovery/design -> implementation -> independent
   20 | review -> findings reconciliation -> revalidation chain and a benchmark that
   21 | includes the existing v2 core workload. It cannot weaken attempt, evidence,
   22 | memory provenance, or snapshot guarantees.
   23 | The absence of a bespoke prompt must not make the first useful agent workflow
   24 | unusable; see [Vertical 11](verticals/11-agent-guidance.md).
````

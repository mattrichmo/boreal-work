# PF-S01-T03 attempt 2 — evidence

The contract makes cycles/sprints scheduling entities separate from milestone
and task decomposition. It defines cycle lifecycle, one live assignment slot,
atomic carry-over with stable task/milestone identity, cross-cycle direct-task
dependencies, explicit activation/readiness, container closeout dispositions,
separate accepted/reconciled rollups, and compatibility/migration limits.

The document explicitly states that current v2 fixed-tree/cycle scaffolding is
partial and that this is a target contract, not a claim of complete service or
TUI support.

Changed product path:

- `project/spec/production/planning-and-cycle-contract.md`

The first independent review rejected the initial draft for an unrecorded
DEC-04 amendment, incomplete legacy sprint mapping/rollback, missing draft
scope behavior, incomplete schema/protocol/baseline traceability, and an
unbounded capability-compatibility decision; that review is preserved in
`REVIEW-DALTON.md`. The artifact was amended to record the versioned
`boreal.work-model/3` and `boreal.cycle/1` decision, deterministic mapping and
collision rules, reversible import, draft-scope reporting, explicit
capability/write gating, named owners, and acceptance fixtures. Contract
validation and the Markdown/whitespace checks were rerun after the amendment.

The independent PF-S01 review/reconciliation/revalidation chain remains
required.

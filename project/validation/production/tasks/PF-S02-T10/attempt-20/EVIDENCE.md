# PF-S02-T10/T06 attempt 20 — evidence

## Source and scope

- Input/base reference: `70514f0ed2521df710c3c913f50ff9d759f5e743`
- Current source identity: same `HEAD`, with uncommitted combined-stream edits
- Attempt-owned production edits: none
- Attempt-owned artifact: `START.md`, this evidence, the command record, the
  handoff, and integration requests
- Plan/state/acceptance records: unchanged

## What the current tree proves

- The strict store/profile and production integration targets now pass in the
  current tree. The earlier profile assertion failures are not residual
  blockers in this check pass.
- The scheduled status adapter compiles through the application crate; the
  application full suite reached execution and did not report the prior missing
  `schedule`/`activation_at` compile failure.
- Recovery record and production integration coverage passes: 11 recovery
  tests and 4 combined integration tests.
- Store Clippy, formatting, contract validation, and whitespace validation
  pass.

## Current failures

1. `read_project_status_in_transaction` still invokes the single-work
   `status_planning_facts` query inside the work-row loop. A 250-work fixture
   prepares 762 statements, so the required project-scoped batching invariant
   is not met.
2. The real application guided-flow test fails while claiming a distinct work
   item at `crates/application/tests/p2_guided_flow.rs:106` with the canonical
   partial unique index on
   `boreal_resource_reservation(project_id, resource_key)`. This is a real
   application/store boundary failure, not a fixture-only assertion that can
   be weakened. The attempt did not continue into the expiry-resolution
   portion because the initial claim sequence fails first.

## Disposition

This is a bounded blocker handoff, not acceptance. The exact current-tree
results are retained above; no result is promoted to a plan receipt.

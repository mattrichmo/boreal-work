# Production-completion dispatch controls

These files define coordinator-facing dispatch records for the PF plan. They
do not create Boreal work records, grant runtime authority, or replace the
Rust service's claim/fence model.

## Dispatch rules

- One worker receives one task card and one exclusive effective write set.
- A directory grant conflicts with every file beneath it unless explicitly
  narrowed; two functions in one existing file are not independent locks.
- `plan.json` owns task content/dependencies. `execution/STATE.json` records
  execution facts and coordinator acceptance.
- Shared roots, schema/migrations, protocol models, command registries,
  workflow registries, release generators, and plan/state files are serialized
  through their named steward.
- The worker's source identity is fixed before work. A stale base requires a
  new input identity and targeted reruns.
- A timeout stops the worker/process, preserves its attempt, inspects the
  worktree, and only then permits reassignment.
- Reviewers must be independent of the implementation principal. A completed
  implementation check is not T90 or T92.

Use [AGENT_DISPATCH.md](AGENT_DISPATCH.md) for each assignment and
[CHANGE_REQUEST.md](CHANGE_REQUEST.md) when a shared path or task boundary
must change.

# PF-S02-T09 attempt-1 handoff — production schema remediation

## Identity and disposition

- Task: `PF-S02-T09`
- Attempt: `attempt-1`
- Worker role: bounded CLI/service/dashboard remediation
- Disposition: **awaiting shared integration; not accepted**
- Base source: `3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9`
- Final owned-source fingerprints: `COMMANDS.md`
- Plan/state/acceptance records: not edited by this lane
- Commit/push: not performed

## Changes

- `crates/cli/src/main.rs`
  - Renamed the compatibility payload to `LEGACY_SCHEMA`.
  - Switched normal post-bootstrap direct CLI dispatch to `PRODUCTION_SCHEMA`.
  - Added a regression proving that an unbound project is rejected by the
    shipped post-init route.
  - Added an ignored, intentionally failing production-bootstrap regression.
  - Kept `init`/`setup` on the explicitly documented compatibility bootstrap
    path because the shared API cannot atomically bind a not-yet-created
    project before `project.init`.
- `crates/cli/src/service.rs`
  - Switched service-host initialization, concurrent request workers, deadline
    scheduling, and recovery readback to `PRODUCTION_SCHEMA`.
  - Kept only explicitly labeled in-process legacy fixtures on
    `LEGACY_SCHEMA`.
- `crates/cli/src/dashboard.rs`
  - Switched dashboard reads and its production-oriented store test to
    `PRODUCTION_SCHEMA`.

## Remaining P1: init identity atomicity and replay

The P1 remains open. The current sequence is:

1. Open the compatibility bootstrap store.
2. `WorkApplication::init_project` calls
   `SqliteStore::initialize_project`, which creates the project and writes the
   `project.init` operation/audit in one store transaction.
3. Apply optional setup files.
4. Bind the workspace identity afterward and attach the operation identity.

If the process stops between steps 2 and 4, the project operation can exist
before the project workspace binding is durable. Replaying the same operation
through a canonical production store cannot repair this safely: the canonical
boundary rejects the operation without the binding, while binding first is
impossible because the public `bind_project` API requires the project row that
`initialize_project` creates. Reimplementing the transaction in CLI would
duplicate application/store lifecycle policy and would still lack the shared
transaction-owned identity primitive.

There is a second, distinct replay gap: on a subsequent `init`,
`initialize_project` treats the already-present project as a replayed/no-op
result. The CLI consequently passes no operation ID to
`bind_project_workspace`, so it can bind the workspace without attaching the
original `project.init` operation to the identity epoch. The project may look
healthy while operation readback remains outside the canonical identity
boundary.

Required shared integration:

- Add an application/store bootstrap use case that receives the validated
  workspace binding and database identity.
- In one `BEGIN IMMEDIATE` boundary, create or replay the project, bind the
  project identity, ensure actor/profile prerequisites, append the
  identity-bound `project.init` operation and audit, and commit the result.
- Make replay compare the full immutable bootstrap request (project, actor,
  workspace-binding digest, database identity/restore epoch, and operation
  digest) before returning the original result.
- Make crash recovery/readback distinguish “no project committed,” “project
  and binding committed,” and “operation pending/unknown”; never infer success
  from a partially present project row.
- On replay, recover or reject the original `project.init` operation by its
  complete immutable identity; never silently convert a no-op project replay
  into a binding-only repair.
- Replace the CLI’s labeled bootstrap compatibility branch with that use case,
  then promote the ignored regression to a required passing test.

## Validation

- Normal CLI suite: passed, 79 unit tests plus 42 integration tests; one
  ignored bootstrap regression is deliberately retained.
- Focused bootstrap regression: failed as expected with the canonical
  workspace-binding conflict.
- Owned CLI rustfmt: passed.
- `git diff --check`: passed.
- Workspace-wide cargo formatting is not clean because unrelated concurrent
  store edits are unformatted; this lane did not edit or format those files.

## Next safe action

A store/application steward should implement the shared bootstrap primitive,
then rerun the ignored regression on the exact combined source, full CLI and
store suites, migration/identity checks, and an interruption/replay matrix.
Do not mark the review finding resolved or advance PF-S02 acceptance from this
handoff alone.

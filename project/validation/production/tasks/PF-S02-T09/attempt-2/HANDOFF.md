# PF-S02-T09 attempt-2 handoff — identity-bound production bootstrap

## Disposition

Implemented and locally focused-tested; not coordinator-accepted and not
committed or pushed. The reviewer finding was against `5584d461`; another
agent advanced the branch to `6d2ded13` while this lane was running.

## Changed paths

- `crates/store/src/lib.rs`
  - Added `initialize_project_with_workspace`.
  - Enforces canonical production schema, atomic project/workspace/operation
    persistence, an in-transaction database-lineage recheck, exact replay
    identity, and fail-closed partial-bootstrap handling.
- `crates/application/src/lib.rs`
  - Added `WorkApplication::init_project_with_workspace`, which includes
    database lineage and full workspace binding material in the request digest.
- `crates/cli/src/main.rs`
  - Production `init` now resolves the canonical workspace binding and calls
    the shared production bootstrap primitive instead of opening the legacy
    schema and binding after `project.init`.
  - The focused ignored regression is now a required passing test and checks
    binding, identity readback, and exact replay.
- `crates/store/tests/production_identity_audit_boundary.rs`
  - Added direct fresh/replay/binding-conflict coverage and a pre-commit
    rollback test.

## Source and validation

See `COMMANDS.md` and `EVIDENCE.md` for exact hashes, commands and the
concurrent-worktree limitation. The store identity-boundary suite passed all
5 tests. The focused CLI bootstrap test passed immediately after the change;
the later combined CLI run reaches the suites but is not fully green because
an unrelated concurrent `production_backup_restore` test fails with
`service_unavailable: unable to open database file`.

## Remaining migration work

1. Re-run the focused CLI and full CLI/store/application checks on a clean
   combined source after the concurrent status lane is reconciled.
2. Regenerate this evidence against the eventual integration commit; this
   handoff is intentionally source-bound to the uncommitted tree above.
3. Define a reviewed migration/quarantine procedure for old databases that
   contain `project.init` without `boreal_project_identity`; this primitive
   refuses silent repair.
4. Keep the filesystem setup recovery boundary explicit: database identity is
   atomic, but setup files are external side effects.

No plan graph, `STATE.json`, acceptance ledger, TUI, memory, commit, or push
was changed by this lane.

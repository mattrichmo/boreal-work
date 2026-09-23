# PF-S02-T06 — attempt 5 backup/restore remediation start

## Identity

- Task: `PF-S02-T06`
- Attempt: `5`
- Repository: `/Users/cybertron/Code/boreal-work`
- Input/current HEAD: `d760806fed4fecdfdfc016649bdec0a4b0a63630` (`fix: close production identity recovery and backup seams`)
- Branch: `codex/apply-responsive-terminal-overlay`
- Worktree: dirty with pre-existing concurrent changes; this attempt did not
  edit those paths, `STATE.json`, the plan graph, the acceptance ledger, or
  `memory/`.
- Scope: production SQLite backup/restore in store and CLI, plus focused tests
  and this evidence directory.

## Finding addressed

The independent PF-S02 review at `5584d461` rejected production backup/restore
because canonical stores only returned an unsupported-operation conflict. This
attempt replaces that rejection with a manifest-bound package route and a
staged, identity-advancing restore path. It does not claim the broader
PF-S02-T06 external-job integration or full PF-S12/AC-44 artifact capability.

## Granted write set

- `crates/store/src/lib.rs` — backup package and restore implementation.
- `crates/store/tests/runtime_backup.rs` — compatibility expectation for the
  low-level raw helper.
- `crates/store/tests/production_backup_restore.rs` — focused production
  package tests.
- `crates/cli/src/main.rs` — direct `backup`/`restore` routes and maintenance
  ownership lock.
- `crates/cli/src/command_registry.rs` — discoverable CLI entries.
- `crates/cli/tests/production_backup_restore.rs` — public CLI smoke test.
- `project/validation/production/tasks/PF-S02-T06/attempt-5/` — evidence.

No commit or push was performed by this attempt. A concurrent integration agent
created and pushed `d760806f` while this attempt was in progress.

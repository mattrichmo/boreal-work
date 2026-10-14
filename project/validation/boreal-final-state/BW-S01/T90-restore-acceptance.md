# BW-S01-T90 restore acceptance contribution

## Source and scope

- Source base: coordinator amendment `f337c0339cba7ada825ceb621ec2a4bd7d047b41`.
- The later T03 amendment `00163eb8` was not present in this worktree; the test/evidence paths here are disjoint from that amendment.
- Added restore tests in `crates/store/src/global_restore.rs`; no Cargo/build/test command was run for this contribution.
- The only production-path reference is a `#[cfg(test)]` call into the test module's one-shot storage-full injector. Non-test restore behavior is unchanged.
- Sprint acceptance remains pending the coordinator's integrated qualification run. This evidence does not accept BW-S01-T90.

## Added coverage

- `package_larger_than_64_mib_restores_to_independent_targets_with_equal_state_and_history` is ignored in routine runs because it allocates a Global database larger than 64 MiB. T90 must invoke it explicitly; it restores the package into two separate target paths, compares state, revision history and activity on each target, and checks distinct active database IDs.
- `corrupt_truncated_and_newer_packages_preserve_the_seeded_active_database` mutates a valid package's database bytes, truncates a separate copy, and marks another copy with a future Global schema version. Each failed restore is followed by checks of the active identity, state, revision history and activity.
- `injected_storage_full_before_retention_checkpoint_preserves_active_and_resumes` injects a synthetic ENOSPC-style I/O failure while publishing the `previous_retained` journal checkpoint. It verifies the old active database remains intact, the durable journal stays at `staged_ready`, the retained copy is present, and a retry after reacquiring admission completes and preserves the prior database.
- `restore_recovers_after_process_is_killed_after_activation` starts the helper test `restore_child_holds_maintenance_after_activation_for_parent_kill`, waits until activation has completed, sends the child `SIGKILL`, reacquires maintenance admission, and verifies idempotent readback plus retained previous state/history.
- Existing `interrupted_activation_is_read_back_and_keeps_the_previous_database` remains in place and exercises the in-process interruption/readback path.

## Existing maintenance admission coverage to include

The following existing store tests should be included in the integrated S01 run; they were not rerun for this patch:

- `global_manager::global_maintenance::tests::maintenance_owner_is_named_and_never_force_broken`
- `global_manager::global_maintenance::tests::ordinary_access_is_shared_and_maintenance_waits_without_breaking_it`
- `global_manager::global_maintenance::tests::stale_or_unknown_owner_metadata_never_substitutes_for_os_ownership`
- `global_manager::global_backup_tests::global_schema_migration_needs_exclusive_admission`

These cover admission ownership and live shared-access contention. No second lock authority was added.

## Commands for integrated qualification (not run)

```sh
cargo test -p boreal-store package_larger_than_64_mib_restores_to_independent_targets_with_equal_state_and_history -- --ignored --nocapture
cargo test -p boreal-store corrupt_truncated_and_newer_packages_preserve_the_seeded_active_database
cargo test -p boreal-store injected_storage_full_before_retention_checkpoint_preserves_active_and_resumes
cargo test -p boreal-store restore_recovers_after_process_is_killed_after_activation
cargo test -p boreal-store interrupted_activation_is_read_back_and_keeps_the_previous_database
cargo test -p boreal-store maintenance_owner_is_named_and_never_force_broken
cargo test -p boreal-store ordinary_access_is_shared_and_maintenance_waits_without_breaking_it
cargo test -p boreal-store stale_or_unknown_owner_metadata_never_substitutes_for_os_ownership
cargo test -p boreal-store global_schema_migration_needs_exclusive_admission
```

## Limits

The storage-full case is deterministic synthetic fault injection at a journal write boundary. It is not a real filesystem quota, a filled volume, or evidence of universal behavior across filesystems. The process-restart case performs a real child-process `SIGKILL` after the existing post-activation interruption point, then validates recovery in the parent process. Results and timings remain to be recorded by the integrated S01 qualification.

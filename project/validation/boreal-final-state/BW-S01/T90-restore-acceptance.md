# BW-S01-T90 restore acceptance contribution

## Source and scope

- Source base: coordinator amendment `f337c0339cba7ada825ceb621ec2a4bd7d047b41`.
- The later T03 amendment `00163eb8` was not present in this worktree; the test/evidence paths here are disjoint from that amendment.
- Added restore tests in `crates/store/src/global_restore.rs`; no Cargo/build/test command was run for this contribution.
- The only production-path reference is a `#[cfg(test)]` call into the test module's one-shot storage-full injector. Non-test restore behavior is unchanged.
- At contribution time, sprint acceptance was pending the coordinator's integrated qualification run. The coordinator's exact-source run is recorded below.

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

The storage-full case is deterministic synthetic fault injection at a journal write boundary. It is not a real filesystem quota, a filled volume, or evidence of universal behavior across filesystems. The process-restart case performs a real child-process `SIGKILL` after the existing post-activation interruption point, then validates recovery in the parent process.

## Coordinator integrated qualification — 2026-10-13

- Source commit: `7a6e93d0b24ed11ae8450c75627dc3de6cc7c4cb`.
- Source tree: `7aa45fa32786a7f50a1aae1061c8a5dfac5b280e`.
- The restore implementation/test file is unchanged from `0d3b24b235ff6432ecf8a0bf93fdd8909f727126`; later commits in this interval update coordinator task scope only.
- Host/toolchain: Darwin 24.2.0, `arm64`; `rustc 1.99.0 (b940084d7 2026-09-28)`, host `aarch64-apple-darwin`.
- Result: all listed S01 restore, admission, WAL, and transfer checks passed on this source.

| Check | Command | Outcome |
|---|---|---|
| Physical package larger than 64 MiB; two independent restores | `cargo test -p boreal-store package_larger_than_64_mib_restores_to_independent_targets_with_equal_state_and_history -- --ignored --nocapture` | PASS; 1 test, 50.83 s |
| Corrupt, truncated and newer-schema packages preserve active DB | `cargo test --quiet -p boreal-store corrupt_truncated_and_newer_packages_preserve_the_seeded_active_database` | PASS; 1 test |
| Synthetic storage-full fault; retained DB and retry recovery | `cargo test --quiet -p boreal-store injected_storage_full_before_retention_checkpoint_preserves_active_and_resumes` | PASS; 1 test |
| Child-process kill after activation; recovery readback | `cargo test --quiet -p boreal-store restore_recovers_after_process_is_killed_after_activation` | PASS; 1 test |
| In-process interrupted activation/readback | `cargo test --quiet -p boreal-store interrupted_activation_is_read_back_and_keeps_the_previous_database` | PASS; 1 test |
| Named maintenance owner is not force-broken | `cargo test --quiet -p boreal-store maintenance_owner_is_named_and_never_force_broken` | PASS; 1 test |
| Shared readers wait for maintenance without being broken | `cargo test --quiet -p boreal-store ordinary_access_is_shared_and_maintenance_waits_without_breaking_it` | PASS; 1 test |
| Unknown/stale metadata cannot replace OS ownership | `cargo test --quiet -p boreal-store stale_or_unknown_owner_metadata_never_substitutes_for_os_ownership` | PASS; 1 test |
| Schema migration requires exclusive admission | `cargo test --quiet -p boreal-store global_schema_migration_needs_exclusive_admission` | PASS; 1 test |
| Physical backup captures committed WAL state/history | `cargo test --quiet -p boreal-store physical_backup_captures_committed_wal_state_and_history` | PASS; 1 test |
| Logical transfer size/history boundary remains separate from physical backup | `cargo test --quiet -p boreal-application logical_transfer_limit_matches_compact_import_size_and_refuses_without_pruning` | PASS; 1 test |

The required restore matrix and its named admission/backup/transfer regressions are green at this exact source. The storage-full result remains synthetic, and this is not a full-workspace, package, or final-release qualification. S02-T90 and later sprint gates remain independent prerequisites before S03 and final release acceptance.

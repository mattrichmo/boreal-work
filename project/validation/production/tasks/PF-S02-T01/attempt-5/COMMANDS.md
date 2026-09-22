# PF-S02-T01 — Attempt 5 command record

Workspace: `/Users/cybertron/Code/boreal-work`  
Date: 2026-09-22 (America/Regina)  
Input `HEAD`: `784a41b3802c29a76721c55eef2e9493283396c2` (dirty worktree)

## Source/tool identity

- `rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)`
- `cargo 1.85.0`
- Final `crates/store/tests/store_contracts.rs` SHA-256:
  `9c28197b7fe4dd928dff78c68f83fa38dbef8e7faa8da2429a8b3086fd1385e2`

## Required checks

| Command | Exit | Exact result |
|---|---:|---|
| `cargo test --locked -p boreal-store --test store_contracts` | 0 | `24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out` |
| `cargo test --locked -p boreal-store` | 0 | All package targets passed. Counts included `m02_claim` 10/10, `production_migrations` 9/9, `release_acceptance` 2 passed/1 ignored, `runtime_backup` 3/3, `schema_v3` 11/11, `session_registration` 3/3, `status_benchmark` 1/1, `status_snapshot` 2/2, `storage_remediation` 15/15, `store_contracts` 24/24, and doc-tests 0/0. |
| `cargo fmt --all -- --check` | 1 | Failed only on pre-existing formatting in `crates/domain/tests/production_acceptance_policy.rs`; no store-contracts formatting diff was reported in this run. This path is outside the granted write set and was not edited. |
| `rustfmt --edition 2021 --check crates/store/tests/store_contracts.rs` | 0 | Target file formatting passed. |
| `git diff --check` | 0 | No whitespace errors. |

The package test emitted the existing dead-code warning for
`MigrationState::as_sql` and `MigrationState::parse` in
`crates/store/src/migrations.rs`; it did not affect the result.

## Changes made in this attempt

- Imported `WORK_MODEL_SCHEMA_VERSION` in `crates/store/tests/store_contracts.rs`.
- Updated the fresh file-database version assertion and both reopen version
  assertions to use `WORK_MODEL_SCHEMA_VERSION`.
- Preserved the foreign-key, WAL, and idempotent-reopen assertions.

Existing dirty changes in `store_contracts.rs` from the prior workspace state
were preserved and are not attributed to this attempt.

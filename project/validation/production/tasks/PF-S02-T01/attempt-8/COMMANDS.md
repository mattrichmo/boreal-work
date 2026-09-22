# PF-S02-T01 — Attempt 8 command record

Workspace: `/Users/cybertron/Code/boreal-work`
Date: 2026-09-22 (America/Regina)
`HEAD`: `784a41b3802c29a76721c55eef2e9493283396c2` (dirty worktree)  
Toolchain: `rustc 1.85.0 (4d91de4e4 2025-02-17)`, `cargo 1.85.0`

## Fresh required checks

| Command | Exit | Result |
|---|---:|---|
| `cargo fmt --all -- --check` | 0 | Passed. |
| `cargo check --locked -p boreal-store` | 0 | Passed. Existing dead-code warnings for `MigrationState::as_sql` and `MigrationState::parse` remained. |
| `cargo test --locked -p boreal-store` | 0 | 87 passed, 1 intentionally ignored release benchmark, 0 failed; doc-tests 0/0. |
| `git diff --check` | 0 | Passed. |

The full store package included: `m02_claim` 10, `production_migrations` 16,
release acceptance 2 passed plus 1 ignored, runtime backup 3, schema-v3 11,
session registration 3, status benchmark 1, status snapshot 2, storage
remediation 15, store contracts 24, and 0 doc-tests.

## Fresh focused checks

| Command | Exit | Result |
|---|---:|---|
| `cargo test --locked -p boreal-store --test production_migrations` | 0 | 16 passed, 0 failed. Includes 7 integrated file-backed/in-memory real-`SqliteStore` cases and 9 generic runner cases. |
| `cargo test --locked -p boreal-store --test schema_v3` | 0 | 11 passed, 0 failed. |
| `cargo test --locked -p boreal-store --test storage_remediation` | 0 | 15 passed, 0 failed. |
| `cargo test --locked -p boreal-store --test store_contracts` | 0 | 24 passed, 0 failed. |

## Reviewed source hashes

Generated with `openssl dgst -sha256` after the fresh checks:

| Path | SHA-256 |
|---|---|
| `crates/store/src/lib.rs` | `403f81b0b3b8a255b3fe13a410ae1f5e4412338cc5831e2fd3b9ce93167151c9` |
| `crates/store/src/migrations.rs` | `0fd57ed2c6b55484fda4dfe5fb5ac8dc46274dd968a7acfbeb52c9a5f32eb356` |
| `crates/store/tests/production_migrations.rs` | `3f748f475f5deaa96cbab3510529922777d9672bf83fab6d97f992103cf81ed5` |
| `crates/store/tests/schema_v3.rs` | `33f5af81f88c0b8adc7ca45af8bab18465b4d84a6a16d64cbf419e96dc4dc83c` |
| `crates/store/tests/storage_remediation.rs` | `8248710cced546476cbab3510529922777d9672bf83fab6d97f992103cf81ed5` |
| `crates/store/tests/store_contracts.rs` | `9c28197b7fe4dd928dff78c68f83fa38dbef8e7faa8da2429a8b3086fd1385e2` |
| `project/spec/schema-production.sql` | `3fd0d323955cf4d52ec06cf366fdf7abe47ac0a27b4ac2768492b5835095e1cf` |

## Worktree preservation

`git status --short` after verification showed the same pre-existing dirty
product and validation paths plus the pre-existing untracked production
migration source/test files. No product source, test, `STATE.json`, prior
evidence, or unrelated path was changed by this review; only attempt-8
validation files are new.

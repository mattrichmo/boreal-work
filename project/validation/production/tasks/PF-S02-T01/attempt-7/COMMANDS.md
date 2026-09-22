# PF-S02-T01 — Attempt 7 command record

Workspace: `/Users/cybertron/Code/boreal-work`  
Date: 2026-09-22 (America/Regina)  
Input `HEAD`: `784a41b3802c29a76721c55eef2e9493283396c2` (dirty worktree)  
Toolchain: `rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)`, `cargo 1.85.0`

## Required and focused checks

| Command | Result | Observed result |
|---|---:|---|
| `cargo fmt --all -- --check` | 0 | Passed on the final tree. |
| `cargo test --locked -p boreal-store` | 0 | All package targets passed: 10 `m02_claim`, 16 `production_migrations`, 3 release tests passed and 1 benchmark ignored, 3 runtime backup, 11 schema v3, 3 session registration, 1 status benchmark, 2 status snapshot, 15 storage remediation, 24 store contracts, and 0 doc-tests. |
| `cargo test --locked -p boreal-store --test production_migrations` | 0 | 16 passed, 0 failed. Includes the integrated real-`SqliteStore` cases. |
| `cargo test --locked -p boreal-store --test schema_v3` | 0 | 11 passed, 0 failed; standalone schema-v3 compatibility fixtures remain green. |
| `cargo test --locked -p boreal-store --test storage_remediation` | 0 | 15 passed, 0 failed. |
| `cargo test --locked -p boreal-store --test store_contracts` | 0 | 24 passed, 0 failed. |
| `cargo check --locked -p boreal-store` | 0 | Passed; existing dead-code warnings for `MigrationState::as_sql` and `MigrationState::parse` remain. |
| `git diff --check` | 0 | Passed for the tracked diff. The new test file was formatted with rustfmt and included in the passing cargo checks. |

## Earlier attempt-7 run results retained

- The first focused production run after the initial patch was `15 passed,
  1 failed`: the newer-schema integrated test incorrectly tried to reopen a
  user-version-4 fixture through the intentionally rejecting
  `open_for_migration` API. The test was corrected to assert the public typed
  rejection directly; the final focused and full runs above pass.
- A metadata-capture command using `shasum -a 256` failed before producing
  hashes because the host Perl locale could not load `C.UTF-8` (errno 9). No
  repository write occurred. The equivalent `openssl dgst -sha256` command
  passed.
- An initial `bwrk prime --json` inspection returned `invalid_argument:
  missing project identifier`; no Boreal lifecycle mutation was attempted.
  The production-completion plan is file-based and this attempt did not edit
  its runtime state.

## Final source identity

`openssl dgst -sha256`:

- `crates/store/src/lib.rs` —
  `403f81b0b3b8a255b3fe13a410ae1f5e4412338cc5831e2fd3b9ce93167151c9`
- `crates/store/tests/production_migrations.rs` —
  `3f748f475f5deaa96cbab3510529922777d9672bf83fab6d97f992103cf81ed5`

The worktree already contained unrelated changes. The allowed-path status at
final inspection was the modified shared store file and the untracked
production migration test file; no unrelated path was changed by this
attempt.


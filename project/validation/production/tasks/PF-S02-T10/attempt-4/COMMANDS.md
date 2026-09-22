# PF-S02-T10 independent review — commands

All commands were run from `/Users/cybertron/Code/boreal-work` against the current combined working tree. No command in this review edited production source, plan state, the package manifest, or another attempt directory.

## Bounded checks

| Command | Result |
|---|---|
| `cargo fmt --all -- --check` | PASS |
| `cargo test --locked -p boreal-store --test production_migrations` | PASS — 16 passed |
| `cargo test --locked -p boreal-store --test production_profile_requirements` | PASS — 9 passed |
| `cargo test --locked -p boreal-store --test production_recovery_records` | PASS — 5 passed |
| `cargo test --locked -p boreal-store --test production_store_seams` | PASS — 5 passed |
| `cargo test --locked -p boreal-store --test production_operation_audit` | FAIL — 1 passed, 9 failed |
| `cargo test --locked -p boreal-store --test status_snapshot` | PASS — 2 passed |
| `cargo test --locked -p boreal-store --test storage_remediation` | PASS — 15 passed |
| `cargo test --locked -p boreal-store --test production_identity_revisions` | PASS — 6 passed |
| `git diff --check` | PASS |

The operation/audit failures all occur during the fixture's explicit identity installation. The observed conflict is:

`DatabaseInstanceConflict { expected: DatabaseInstanceId("database-1"), actual: DatabaseInstanceId("boreal-db-3a6d656d6f72793a") }`

The command chain stopped after that failing target, so the remaining profile/recovery/status/diff checks were rerun separately and their individual results are recorded above.

## Static review queries

| Query | Result |
|---|---|
| `rg -n "append_operation\\(" crates/store/src/lib.rs` | 21 direct call sites, excluding the method definition and fallback helper |
| `rg -n "append_in_transaction_with_identity|append_operation_audit_in_transaction" crates/store/src crates/application/src crates/cli/src` | Identity-bound helper is defined and used only by the work-create path at `crates/store/src/lib.rs:2823`; the helper has a compatibility fallback |
| `rg -n "create_recovery_obligation|resolve_recovery_obligation|register_external_job|advance_external_job|mark_external_job_readback_required" ...` outside `recovery.rs`, `jobs.rs`, and tests | No canonical lifecycle/application/CLI call sites |


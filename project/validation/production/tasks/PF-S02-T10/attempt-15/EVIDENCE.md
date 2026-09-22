# Evidence — PF-S02-T10 attempt 15

## Decision

The attempt-13 fixture correction is independently verified as a bounded
contribution. The controlled test setup fixes the attempt-12 failure without
weakening the production identity contract.

## Why the correction is valid

The corrected bound/replay fixture now performs these operations in the proper
order:

1. Open the disposable production-schema store.
2. Create the project and actor fixture required by the identity foreign-key
   boundary.
3. Install a controlled `DatabaseIdentity` in the test database.
4. Bind the project workspace and exercise operation replay.

This addresses the attempt-12 failure, where the fixture found the identity
table but had no installed identity row. The production-open implementation
still distinguishes persistent production databases from deliberately
controlled in-memory fixtures; the fixture does not authorize an unbound
production context. The focused test
`unbound_canonical_production_rejects_consequential_operation_writes` confirms
that consequential writes remain fail-closed without a binding.

## Persistent bootstrap evidence

The full `boreal-store` run passed the persistent/bootstrap coverage,
including:

- `integrated_fresh_production_open_reads_identity_checksum_and_bootstrap_ledger`
- `integrated_v2_production_open_reads_upgrade_identity_checksum_and_ledger`
- `integrated_legacy_v3_reopen_repairs_metadata_identity_and_ledger_without_losing_rows`
- `integrated_canonical_open_rejects_live_attempt_before_v2_repair_or_production_metadata`
- `migration_persists_binding_and_splits_conflated_revision`
- `wrong_project_and_wrong_epoch_are_typed_without_foreign_leakage`
- `restore_invalidates_operations_and_execution_authority`

These tests preserve the distinction between controlled in-memory setup and
canonical persistent bootstrap. They do not prove the entire application or
service integration surface.

## Validation result

| Check | Result |
|---|---|
| Focused identity/audit tests | 3 passed |
| Full `boreal-store` tests | Passed |
| `cargo fmt --all -- --check` | Passed |
| `git diff --check` | Passed |

## Acceptance boundary

PF-S02-T10 remains unaccepted. This review covers only the attempt-13 fixture
correction. Application/service wiring, complete external-job integration,
canonical operation/audit call-site coverage, strict Clippy, and genuine
service-backed lifecycle/release/platform validation remain open.


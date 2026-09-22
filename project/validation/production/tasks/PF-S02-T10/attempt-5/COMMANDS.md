# Commands and outcomes

All commands were run from `/Users/cybertron/Code/boreal-work`.

| Command | Result |
|---|---|
| `cargo test --locked -p boreal-store` | PASS — all store unit, M02, identity/revision, migration, operation/audit, profile, recovery, store seam, schema, runtime, status, storage remediation, and contract tests passed. One release benchmark remained intentionally ignored. |
| `cargo fmt --all -- --check` | PASS |
| `git diff --check` | PASS |
| `rg` inspection of recovery, claim, mutation, operation-journal, and identity call sites | Completed; residual direct writers and absent application/CLI identity binding recorded in `EVIDENCE.md`. |

The full store run included these relevant results:

- `production_recovery_records`: 5 passed
- `production_operation_audit`: 10 passed
- `production_identity_revisions`: 6 passed
- `store_contracts`: 24 passed
- `storage_remediation`: 15 passed
- `production_store_seams`: 5 passed
- `production_migrations`: 16 passed
- `m02_claim`: 10 passed

No source, plan state, or manifest changes were made by this review.

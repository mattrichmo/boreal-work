# PF-S02-T01 — Attempt 5 evidence

## Result

`ready_for_review` for the bounded compatibility-test remediation. The focused
store contract target and full `boreal-store` package pass. Workspace-wide
format checking remains limited by an unrelated pre-existing formatting diff in
`crates/domain/tests/production_acceptance_policy.rs`, which was outside the
granted write set and was not changed.

This is implementation evidence only; it does not self-accept PF-S02-T01 or
claim the sprint review, reconciliation, or revalidation gates.

## Delivered behavior

- `fresh_schema_enables_foreign_keys_and_wal_for_file_databases` now expects
  `WORK_MODEL_SCHEMA_VERSION` while retaining its foreign-key and WAL checks.
- `schema_version_is_idempotent_on_reopen` now expects
  `WORK_MODEL_SCHEMA_VERSION` for both the initial open and the reopen, while
  retaining the idempotence behavior.
- No unrelated contract test was weakened.

## Verification

```text
cargo test --locked -p boreal-store --test store_contracts
24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out

cargo test --locked -p boreal-store
exit 0; all boreal-store targets passed; release benchmark remained ignored by its test annotation

cargo fmt --all -- --check
exit 1; unrelated pre-existing diff in crates/domain/tests/production_acceptance_policy.rs

rustfmt --edition 2021 --check crates/store/tests/store_contracts.rs
exit 0

git diff --check
exit 0
```

## Scope and limitations

Changed paths in this attempt are the store contract test and the four files in
this attempt-5 evidence directory. Production source, STATE, prior evidence,
schema files, and unrelated paths were not edited. The task remains subject to
independent review, reconciliation, and exact-tree revalidation.

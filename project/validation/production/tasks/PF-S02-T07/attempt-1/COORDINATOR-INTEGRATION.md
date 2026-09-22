# PF-S02-T07 — Coordinator integration request

The worker stayed within its exclusive paths. Apply the following shared-file
integration under the coordinator's `crates/store/src/lib.rs` token:

1. Keep the existing public `operations` registration and expose the new
   operation identity/replay API through the canonical store boundary.
2. Ensure the canonical production-open path installs/validates
   `IdentityStore` before treating operation rows as authoritative.
3. In every consequential root mutation, perform the semantic mutation,
   `IdentityStore::record_operation_context`, operation outcome and redacted
   audit append within one root-owned transaction. Do not add a nested
   transaction in `OperationJournal`.
4. On an existing operation ID, compare command, actor/session, target,
   request digest, project and current database identity/restore epoch before
   allowing replay. Exact replay returns the stored result; changed identity
   returns a typed conflict/identity error.
5. Preserve the existing application/domain policy and all failed history;
   this request is persistence wiring, not permission logic or a lifecycle
   rewrite.

Required combined-tree reruns after integration:

```sh
cargo fmt --all -- --check
cargo test --locked -p boreal-store --test production_operation_audit
cargo test --locked -p boreal-store
cargo clippy --locked -p boreal-store --all-targets -- -D warnings
python3 project/spec/validate_contracts.py
```

The current package-wide store failure also requires resolving or separately
accepting the missing `jobs`/`recovery` root registrations from
`production_recovery_records.rs`; it is not part of this worker's grant.

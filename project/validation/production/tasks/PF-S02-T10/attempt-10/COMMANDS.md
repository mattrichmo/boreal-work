# Commands

Run from `/Users/cybertron/Code/boreal-work` after the worker was stopped:

```text
cargo fmt --all -- --check
cargo test --locked -p boreal-store --test production_profile_requirements --test production_recovery_records --test production_operation_audit --test production_store_seams --test store_contracts
cargo test --locked -p boreal-store
```

All listed commands completed successfully on the preserved working tree. No independent review, application/service test, real-service lifecycle test, or release test was run for this attempt.

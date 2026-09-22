# Commands and outcomes

| Command | Outcome |
| --- | --- |
| `rustfmt --edition 2021 crates/store/src/recovery.rs crates/store/tests/production_recovery_records.rs` | Passed |
| `cargo test --locked -p boreal-store --test production_recovery_records` | Passed: 7 tests |
| `cargo test --locked -p boreal-store` | Passed: all store unit, integration, and doc tests; one release benchmark intentionally ignored |
| `rustfmt --edition 2021 --check crates/store/src/recovery.rs crates/store/tests/production_recovery_records.rs` | Passed |
| `git diff --check` | Passed |
| `cargo fmt --all -- --check` | Blocked before execution by an existing parse error in `crates/application/src/evidence.rs:328`; that file was outside this worker scope and was not edited |
| `cargo clippy --locked -p boreal-store --all-targets --all-features -- -D warnings` | Blocked by existing strict lints in `crates/store/src/operations.rs:184` (`large_enum_variant`) and `crates/store/src/profiles.rs:505` (`too_many_arguments`) |

The broad formatter and clippy failures are recorded as environment/tree blockers, not attributed to this recovery slice.

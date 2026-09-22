# Commands

Run from `/Users/cybertron/Code/boreal-work`.

| Command | Result |
| --- | --- |
| `cargo test --locked --offline -p boreal-store --test production_integration --test production_migrations --test production_recovery_records --test production_operation_audit --test production_external_job_boundary --test production_profile_requirements --test production_identity_audit_boundary` | PASS: 71 tests |
| `cargo test --locked --offline -p boreal-store` | PASS: all store suites; 0 failed, 1 ignored benchmark |
| `cargo test --locked --offline -p boreal-store --test store_contracts` | PASS: 24 tests |
| `cargo clippy --locked --offline -p boreal-store --all-targets --all-features -- -D warnings` | PASS |
| `rustfmt --edition 2021 --check crates/store/src/lib.rs` | PASS |
| `python3 project/spec/validate_contracts.py` | PASS |
| `git diff --check -- crates/store/src/lib.rs project/spec/schema-production.sql` | PASS |
| `cargo fmt --all -- --check` | BOUNDED LIMITATION: unrelated existing CLI/memory formatting failures |
| `cargo test --workspace --locked --offline` | BOUNDED LIMITATION: two untouched `boreal-memory` publisher tests failed; store/application/CLI suites passed |


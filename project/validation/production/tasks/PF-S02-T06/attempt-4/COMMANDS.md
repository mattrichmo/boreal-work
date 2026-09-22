# Commands

All commands were run from `/Users/cybertron/Code/boreal-work` with the locked
offline dependency set.

| Command | Result |
| --- | --- |
| `cargo test --locked --offline -p boreal-store --test production_integration --test production_recovery_records --test production_operation_audit --test production_external_job_boundary --test production_identity_audit_boundary --test production_profile_requirements` | PASS: 55 tests |
| `cargo test --locked --offline -p boreal-store --test production_migrations` | PASS: 16 tests |
| `cargo test --locked --offline -p boreal-store` | PASS: all store suites; 0 failed, 1 ignored benchmark |
| `cargo test --locked --offline -p boreal-store --test store_contracts` | PASS: 24 tests |
| `cargo clippy --locked --offline -p boreal-store --all-targets --all-features -- -D warnings` | PASS |
| `rustfmt --edition 2021 --check crates/store/src/lib.rs` | PASS |
| `python3 project/spec/validate_contracts.py` | PASS: 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transitions, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed |
| `git diff --check -- crates/store/src/lib.rs project/spec/schema-production.sql` | PASS |
| `cargo fmt --all -- --check` | BOUNDED LIMITATION: reports unrelated existing formatting in `crates/cli/src/update.rs` and `crates/memory/tests/publisher.rs`; neither is in the write set |
| `cargo test --workspace --locked --offline` | BOUNDED LIMITATION: store/application/CLI suites passed; two pre-existing/untouched `boreal-memory` publisher tests failed |

The first post-change full migration run exposed the migration SQL normalizer
stripping the newly appended trigger body; the trigger was made normalization-
safe and legacy-v3 repair was made to install it. The final migration command
above is the rerun after that correction.


# PF-S02-T10 attempt 3 — commands

Source input: `784a41b3802c29a76721c55eef2e9493283396c2` plus the existing dirty combined tree.

| Command | Result |
| --- | --- |
| `rustfmt --edition 2021 --check crates/store/src/identity.rs crates/store/src/operations.rs crates/store/tests/production_operation_audit.rs` | Pass |
| `cargo test --locked -p boreal-store --test production_operation_audit` | Pass — 10 tests |
| `cargo test --locked -p boreal-store` | Pass — all store unit/integration/doc tests; one release benchmark remains intentionally ignored |
| `cargo clippy --locked -p boreal-store --test production_operation_audit -- -D warnings` | Blocked by pre-existing warnings/errors in `crates/store/src/profiles.rs`; that file was outside this attempt's write scope |
| `cargo fmt --all -- --check` | Blocked by pre-existing formatting differences in `crates/store/src/profiles.rs`; that file was outside this attempt's write scope |
| `sha256sum crates/store/src/operations.rs crates/store/src/identity.rs crates/store/tests/production_operation_audit.rs` | Recorded in `EVIDENCE.md` |

No network, service, release, migration, or live-project command was run. No plan ledger or package manifest was edited.

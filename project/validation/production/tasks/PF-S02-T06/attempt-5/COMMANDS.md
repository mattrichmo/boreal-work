# PF-S02-T06 — attempt 5 commands

All commands ran from `/Users/cybertron/Code/boreal-work`.

| Command | Result |
| --- | --- |
| `cargo test --locked -p boreal-store --test production_backup_restore --test runtime_backup` | pass — 7 tests |
| `cargo test --locked -p boreal-cli --test production_backup_restore` | pass — 1 test |
| `cargo test --locked -p boreal-store` | pass — full store package; 1 unit test, 165 integration tests, 1 ignored release benchmark, 0 doctests |
| `cargo test --locked -p boreal-cli` | pass — full CLI package; 82 unit tests, 42 integration tests, 1 ignored test |
| `cargo clippy --locked -p boreal-store --test production_backup_restore --test runtime_backup -- -D warnings` | pass |
| `cargo clippy --locked -p boreal-cli --test production_backup_restore -- -D warnings` | pass |
| `rustfmt --edition 2021 --check crates/store/src/lib.rs crates/store/tests/runtime_backup.rs crates/store/tests/production_backup_restore.rs crates/cli/src/main.rs crates/cli/src/command_registry.rs crates/cli/tests/production_backup_restore.rs` | pass |
| `git diff --check` | pass |

The repository-wide `cargo fmt --all -- --check` remains outside this bounded
attempt because the combined worktree contains a pre-existing formatting diff
in `crates/application/src/evidence_store.rs`; the changed store/CLI files were
checked independently above.

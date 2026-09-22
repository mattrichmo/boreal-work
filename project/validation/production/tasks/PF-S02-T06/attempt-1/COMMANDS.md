# PF-S02-T06 — attempt 1 commands

All commands were run from `/Users/cybertron/Code/boreal-work` unless a
temporary validation directory is named explicitly. No live database or
external side effect was used.

| Command | Result |
| --- | --- |
| `rustfmt --edition 2021 --check crates/store/src/recovery.rs crates/store/src/jobs.rs crates/store/tests/production_recovery_records.rs` | Exit 0 |
| `git diff --check` | Exit 0 |
| `python3 project/spec/validate_contracts.py` | Exit 0; contract validator passed |
| `cargo fmt --all -- --check` | Exit 0 on the combined worktree; unregistered new modules are checked separately above |
| `cargo test --locked -p boreal-store --test production_recovery_records` | Exit 101 before test execution: protected `crates/store/src/lib.rs` does not yet register `jobs` or `recovery` |

## Isolated registered-source validation

To validate the worker files without editing the protected root, a temporary
copy was created at `/private/tmp/boreal-t06-compile-3R9xbu`. It contained the
current `crates/domain`, `crates/store`, `project/spec` schema inputs and a
minimal two-member workspace. Only that temporary copy's store root added:

```rust
pub mod jobs;
pub mod recovery;
```

The temporary copy was not used as a product artifact and was not part of the
repository worktree.

| Command | Result |
| --- | --- |
| `cargo clippy --offline -p boreal-store --all-targets -- -D warnings` | Exit 0 |
| `cargo test --offline -p boreal-store --test production_recovery_records` | Exit 0; 5 passed, 0 failed |
| `cargo test --offline -p boreal-store` | Exit 0; all store unit/integration targets passed; one pre-existing release benchmark remained intentionally ignored |

No `--locked` claim is made for the reduced temporary workspace because its
member set differs from the repository lockfile. The repository command above
is the authoritative evidence that registration is still pending.

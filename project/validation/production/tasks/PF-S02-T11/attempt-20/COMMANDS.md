# PF-S02-T11 attempt 20 — validation commands

All commands ran from `/Users/cybertron/Code/boreal-work` against source
snapshot `0d9611a017d5dc167e92fe79e8d65756fbac2d5a` plus the bounded memory
changes. No command changed plan/state records, committed, or pushed.

| Command | Result |
|---|---|
| `cargo test --locked -p boreal-memory --test publisher --quiet` | **PASS**, 28/28 tests. |
| `cargo test --locked -p boreal-memory --quiet` | **PASS**, 9 unit tests, 28 publisher tests, and 0 doctests failed. |
| `cargo clippy --locked -p boreal-memory --all-targets -- -D warnings` | **PASS**, strict clippy. |
| `rustfmt --edition 2021 --check crates/memory/src/lib.rs crates/memory/tests/publisher.rs` | **PASS**. |
| `cargo fmt --all -- --check` | **PASS** on the combined tree. |
| `git diff --check -- crates/memory/src/lib.rs crates/memory/tests/publisher.rs` | **PASS**. |

## Source identity

| Path | SHA-256 |
|---|---|
| `crates/memory/src/lib.rs` | `402fd795d744438a44ce6171cc2a1cbd7004d4f826231e94aac83d05f64c2f5a` |
| `crates/memory/src/publisher.rs` | `51defd6f9c5583fcb3b181da2445de76966fc1de34933b9baa9a3dea9014dcd7` |
| `crates/memory/tests/publisher.rs` | `f190f45bfb9e52ec88abd61e1a5d1079ba035d0c1a74edaa05bc5ab59f87e66c` |


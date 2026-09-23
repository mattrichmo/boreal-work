# PF-S02-T11 — attempt 33 commands

```text
rustfmt crates/cli/src/main.rs
cargo check --locked --offline -p boreal-cli
cargo test --locked --offline -p boreal-cli finish_close
cargo test --locked --offline -p boreal-cli
git diff --check -- crates/cli/src/main.rs
```

The source snapshot was the working tree at `HEAD
3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9`. The owned file was intentionally
uncommitted so the coordinator can review and integrate it with the other
Wave 1 changes.

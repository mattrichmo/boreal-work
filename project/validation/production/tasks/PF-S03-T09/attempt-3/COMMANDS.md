# PF-S03-T09 — attempt 3 commands

```text
cargo fmt --all
cargo fmt --all -- --check
cargo test --locked --offline -p boreal-cli -- --nocapture
cargo test --locked --offline -p boreal-cli --test release_acceptance -- --nocapture
git diff --check
```

All commands completed successfully. The full CLI package run reported 120 passed tests and 1 intentionally ignored test.

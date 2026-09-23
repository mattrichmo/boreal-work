# PF-S02-T04 — Attempt 8 commands

All commands ran from `/Users/cybertron/Code/boreal-work` against the working
tree based on `3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9`.

```text
cargo test --locked --offline -p boreal-store --test storage_remediation status_gate_queries_are_batched_for_large_projects
cargo test --locked --offline -p boreal-store --test store_contracts
cargo test --locked --offline -p boreal-store
cargo clippy --locked --offline -p boreal-store --all-targets -- -D warnings
cargo fmt --all -- --check
git diff --check
```

The initial full-store run exposed seven compatibility failures after the
first implementation of batching: legacy schema-v2 fixtures were being
treated as missing pinned requirements. The implementation was corrected to
retain their one-query observed-gate fallback; the focused target, contract
target, and full package were then rerun successfully.

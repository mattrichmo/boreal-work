# PF-S02-T01 — Attempt 3 command record

Workspace: `/Users/cybertron/Code/boreal-work`  
Date: 2026-09-22 (America/Regina)  
Input `HEAD`: `784a41b3802c29a76721c55eef2e9493283396c2` (dirty worktree)

## Baseline before the test edit

| Command | Exit | Result |
|---|---:|---|
| `cargo test --locked -p boreal-store --test schema_v3` | 101 | `1 passed; 10 failed` out of 11. Direct additive tests either hit `Invalid("table work_model_v3_meta already exists")`, or observed production `user_version` 3 where they expected 2. The compatibility reopen test was among the failures; the backup test passed. |

Representative baseline failures:

```text
schema-v3 additive migration applies: Invalid("table work_model_v3_meta already exists")
assertion `left == right` failed
  left: 3
 right: 2
assertion failed: store.apply_schema(&broken).is_err()
```

## Remediation checks

| Command | Exit | Result |
|---|---:|---|
| `rustfmt --edition 2021 --check crates/store/tests/schema_v3.rs` | 0 | Changed test is formatted. |
| `cargo test --locked -p boreal-store --test schema_v3` | 0 | `11 passed; 0 failed; 0 ignored` out of 11. |
| `cargo test --locked -p boreal-store` | 101 | The `schema_v3` target passed all 11 tests. `storage_remediation` had `13 passed; 2 failed`; the failures are existing assumptions about canonical v2 opening (`left: 3, right: 2` and missing `work_hold`). Other package targets shown before that target passed; this is not a full store pass. |
| `git diff --check` | 0 | No whitespace errors. |
| `git diff --stat -- crates/store/tests/schema_v3.rs` | 0 | `1 file changed, 15 insertions(+), 4 deletions(-)`. |
| `git diff --name-only -- crates/store/tests/schema_v3.rs` | 0 | Only `crates/store/tests/schema_v3.rs` in the source diff. |

## Tool identity

```text
rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)
cargo 1.85.0
```

No production Rust source, plan/state file, prior evidence, or unrelated path
was intentionally edited.

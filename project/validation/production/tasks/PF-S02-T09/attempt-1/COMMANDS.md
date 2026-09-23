# PF-S02-T09 attempt-1 — commands and source identity

## Source identity

- Base `HEAD`: `3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9`
- Owned files are uncommitted on top of that base; their current SHA-256
  fingerprints are:
  - `crates/cli/src/main.rs` — `66fa2e52714f0def9328c2e8214514d26cdf0bae10469484fd407ddd6bf2379d`
  - `crates/cli/src/service.rs` — `feb2915c924d6e5f981058035f22f7f2218182159f6cceb6ac979db16774a383`
  - `crates/cli/src/dashboard.rs` — `eff287b4c621fa6c29ec02c404b5855611cb18fd95eab281261581956564c792`
- `git diff --check`: passed.
- Owned-file `rustfmt --edition 2021 --check`: passed.

## Validation commands

| Command | Result |
| --- | --- |
| `cargo test --locked --offline -p boreal-cli` | Passed: 79 unit tests, 1 ignored; all 42 CLI integration tests passed. |
| `cargo test --locked --offline -p boreal-cli production_schema_bootstrap_binds_identity_before_project_init -- --ignored --nocapture` | Expected failure, exit 101; production `project.init` is rejected because no workspace identity binding exists. |
| `cargo fmt --all -- --check` | Not clean on the combined worktree because unrelated concurrent `crates/store/src/lib.rs` edits are not formatted. The three owned CLI files pass direct rustfmt checking. |

## Exact failing output

The ignored bootstrap regression fails with:

```text
production bootstrap must bind identity before project.init:
Store(Conflict("production project production-bootstrap requires a workspace identity binding before consequential operation writes"))
```

No commit or push was performed by this remediation lane.

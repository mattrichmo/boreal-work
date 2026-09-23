# PF-S03-T09 attempt 1 — commands

Working directory for every command: `/Users/cybertron/Code/boreal-work`

Source identity at execution: `3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9`;
working tree dirty as recorded in `START.md`.

| Command | Exit | Observed result |
| --- | ---: | --- |
| `cargo test --locked --offline -p boreal-domain --test production_action_policy` | 0 | Existing action policy target: 7 passed. |
| `cargo fmt --all` | 0 | Formatted the new bounded target. |
| `cargo test --locked --offline -p boreal-domain --test production_domain_api` | 0 | 6 passed, 1 ignored (R7 witness). |
| `cargo test --locked --offline -p boreal-domain --test production_domain_api -- --ignored` | 101 | R7 witness failed as expected: status claimability `true`, action Claim `false`. |
| `cargo test --locked --offline -p boreal-domain --no-fail-fast` | 0 | Full domain suite passed; 140 tests passed including 6 T09 tests, 1 T09 test ignored, and 1 doc-test target with 0 tests. |
| `cargo clippy --locked --offline -p boreal-domain --all-targets -- -D warnings` | 0 | Strict domain Clippy passed. |
| `cargo check --locked --offline -p boreal-application -p boreal-cli` | 0 | Adapter consumers compiled; existing store warning: unused `StatusGateRead`. |
| `cargo fmt --all -- --check` | 0 | Formatting passed. |
| `git diff --check` | 0 | Whitespace check passed. |

The ignored R7 command is retained as failed evidence rather than relabeled
as a pass. No service/lifecycle/release claim was made from these pure-domain
tests.

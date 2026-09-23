# PF-S03-T09 attempt 2 — commands and results

Working directory: `/Users/cybertron/Code/boreal-work`

| Command | Result |
| --- | --- |
| `rustfmt --edition 2021 crates/application/src/status.rs crates/cli/src/main.rs` | pass |
| `cargo test --locked --offline -p boreal-application status::tests::public_claimability_uses_the_canonical_action_decision` | pass; 1 test |
| `cargo test --locked --offline -p boreal-application status::tests` | pass; 8 tests |
| `cargo clippy --locked --offline -p boreal-application --all-targets -- -D warnings` | pass |
| `cargo test --locked --offline -p boreal-cli service::tests::service_status_uses_the_complete_canonical_status_dto` | pass; 1 test |
| `npm --prefix apps/tui run typecheck` | pass |
| `npm --prefix apps/tui test` | pass; 98 Node tests plus the mounted workflow assertions |
| `git diff --check` | pass |
| `cargo fmt --all -- --check` | not clean because unrelated dirty store files also require formatting; the two Rust files changed by this attempt were formatted directly |

The first unprivileged TUI test invocation was blocked before assertions by
the sandbox refusing to bind its temporary Unix socket (`EPERM`). The exact
same bounded command was then rerun with local socket permission and passed.

No workspace-wide Rust test, release, service-lifecycle, or native terminal
gate was run for this bounded attempt.

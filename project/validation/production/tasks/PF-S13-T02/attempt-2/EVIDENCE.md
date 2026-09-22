# PF-S13-T02 bounded dashboard identity hardening — evidence

## Implementation

`run_dashboard` now validates the selected project after database opening and project-ID selection, before either JSON status output or interactive service/TUI launch.

The new dashboard check:

- reads `IdentityStore::context(project)` so the database instance and restore epoch must agree with the selected project's stored identity;
- reads `IdentityStore::workspace_binding(project)` so a missing or unreadable binding is rejected;
- compares the stored canonical workspace root with the metadata-resolved project root, or with the current directory for explicit `--db/--project` selection without ambient metadata;
- preserves the existing project-local confinement and explicit-selector rules; and
- returns actionable `bwrk init` guidance for missing identity, while distinguishing identity conflicts as operation conflicts.

The new regression test initializes a real project, copies its database into a second directory, rewrites metadata so the copied directory and database look internally plausible, and verifies that dashboard selection rejects the database's stored binding to the original workspace.

## Validation results

| Check | Result |
| --- | --- |
| `rustfmt --edition 2021 --check` on the two permitted files | Passed |
| `git diff --check` on the two permitted files | Passed |
| `cargo fmt --all -- --check` | Passed on final rerun; an earlier invocation was blocked by an unmatched delimiter in `crates/store/src/lib.rs`, outside this slice |
| `cargo test --locked -p boreal-cli --test dashboard_launcher` | Passed: 6 passed, 0 failed |

The initial blocked compiler output identified the malformed region as the
`register_session` closure around `crates/store/src/lib.rs:1905`, `:1988`,
`:2016`, and the enclosing implementation ending near `:9697`. That blocker
was repaired outside this bounded attempt; the final required gates ran on the
same dashboard source and passed.

## Boundary review

Production/test changes are limited to:

- `crates/cli/src/dashboard.rs`
- `crates/cli/tests/dashboard_launcher.rs`

This attempt did not edit `main.rs`, store/application/domain code, `STATE.json`, or `PLAN_PACKAGE_MANIFEST.json`.

## Remaining limitations

- The full PF-S13-T02 public project, identity, and actor/session command surface remains incomplete and unaccepted.
- The init binding failure ordering and typed init error mapping remain outside this attempt because `main.rs` is explicitly excluded.
- Real service, release, install, platform, and full acceptance-matrix validation remain open.

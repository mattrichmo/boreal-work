# PF-S02-T11 — attempt 12 verification commands

## Source identity

- Input source: `HEAD b543d41008301f7745c899e95f5cb7203ca64917b`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- No commit, push, plan-ledger, state, sprint-gate, service, registry, or
  protected-root mutation was performed.
- Existing unrelated working-tree changes and untracked `memory/` content were
  preserved.

Worker-file SHA-256 identities at handoff:

- `crates/application/src/evidence.rs` — `0f87e481cabb64e72ec0657f6f883f2d927933594c6ce20eb102eb988ae0554f`
- `crates/application/src/runtime.rs` — `6d35a839c235e7fa6e2b3ec355a3c2bc12c0a130f7e09479b2a4e1b3ab520d7e`
- `crates/cli/src/update.rs` — `454f99531ceb6981e78a9c4c7f44d55e34461f2a5675eca4d0a57f2ddde62e3d`
- `crates/application/tests/production_external_jobs.rs` — `3751d9b5242789cf69701413009fcf106550614aadf99280bb50304a275f43b6`

## Commands and results

All commands were run from `/Users/cybertron/Code/boreal-work` with the locked
dependency set.

| Command | Result |
| --- | --- |
| `cargo test --locked -p boreal-application --test production_external_jobs` | PASS — 10 passed, 0 failed. Covers admission-before-callback, pending, readback, reconciled, rejected, identity mismatch, digest drift, and file-backed restart readback. |
| `cargo test --locked -p boreal-application --lib runtime::tests` | PASS — 6 passed, 0 failed. Covers expiry/resource recovery mapping and existing runtime policy. |
| `cargo test --locked -p boreal-application` | PASS — 40 unit tests and all application integration/doc-test targets passed. |
| `cargo test --locked -p boreal-store --test production_recovery_records` | PASS — 11 passed, 0 failed. |
| `cargo test --locked -p boreal-store --test production_external_job_boundary` | PASS — 4 passed, 0 failed. |
| `cargo test --locked -p boreal-memory` | PASS — 9 unit tests, 22 integration tests, 0 doc tests failed. |
| `cargo test --locked -p boreal-cli update::tests` | PASS — 5 durable-update adapter tests passed. |
| `cargo test --locked -p boreal-cli` | PASS — 73 unit tests and all CLI integration/doc-test targets passed. |
| `rustfmt --edition 2021 --check crates/application/src/runtime.rs crates/application/src/evidence.rs crates/cli/src/update.rs crates/application/tests/production_external_jobs.rs` | PASS. |
| `cargo fmt --all -- --check` | PASS. |
| `git diff --check` | PASS. |

The application build emits dead-code warnings for the recovery identity
constructor/resolve/acknowledgement methods and the CLI durable-update seam;
these are expected because the protected root/call sites are not wired by this
worker. They do not fail the checks.

## Tooling limitation

The requested workflow inspection commands were attempted before editing:
`bwrk prime --json` returned `invalid_argument missing project identifier`, and
`bwrk workflows show ...` returned `unknown command path: workflows show`. The
repository task cards and stream workflow were read directly as required; no
ledger mutation was attempted.

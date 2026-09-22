# PF-S03-T06 attempt 1 — command record

All commands ran from `/Users/cybertron/Code/boreal-work` on 2026-09-22 with
Rust/Cargo `1.85.0` and source `HEAD:784a41b3802c29a76721c55eef2e9493283396c2`
in a dirty combined worktree. No command below edited a protected production
path.

| Command | Exit | Observed result |
| --- | ---: | --- |
| `rustfmt --edition 2021 --check crates/domain/src/actions.rs crates/domain/tests/production_action_policy.rs` | 0 | Both owned Rust files formatted. |
| `cargo test --locked -p boreal-domain --test production_action_policy -- --test-threads=1` | 0 | 7 focused action-policy tests passed. |
| `cargo check --locked -p boreal-domain --tests` | 0 | Domain library and all current test targets compiled. |
| `cargo test --locked -p boreal-domain` | 0 | 116 tests passed, 0 failed; 0 doc tests. |
| `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` | 0 | Strict domain all-target clippy passed. |
| `cargo fmt --all -- --check` | 0 | Final exact-tree workspace formatting check passed. An earlier pre-final probe reported an unrelated line-wrap difference at `crates/store/tests/production_identity_revisions.rs:284`; that off-scope combined-tree state was not edited by this worker. |
| `git diff --check` | 0 | No whitespace errors in the tracked dirty diff. Owned untracked files were additionally checked by the owned-file rustfmt command. |

The full-domain test run included the source-path-shim action target. Public
`lib.rs` registration is intentionally not part of this worker attempt and
requires the coordinator-owned integration patch in `INTEGRATION-REQUEST.md`.

Read-only Boreal workflow probes:

- `bwrk prime --json` returned typed `invalid_argument` / `missing project
  identifier`; no project identifier was invented and no state changed.
- `bwrk workflows show boreal.workflow.claim-and-finish-work.v1 --json` and
  `bwrk workflows show boreal.workflow.closeout-work.v1 --json` returned typed
  `busy` / `service_busy` because the local database owner was held. No lock
  was broken and no lifecycle mutation was attempted.

## Source identities after validation

| File | SHA-256 |
| --- | --- |
| `crates/domain/src/actions.rs` | `8ac6bdecee87c1d14c139a8fe9554be2b448a6fa1d00ebcad79bfe9a3d5c23e7` |
| `crates/domain/tests/production_action_policy.rs` | `e2dc59bd5c9b45e3904b1dff081ee1d95eca2197775eb5fbb66f54dbb448e42c` |
| `crates/domain/src/lib.rs` (read-only; unchanged by this attempt) | `460b6e4dcd8e365b1318a32d9d11f80238418259550717e90d497ce25ced1bed` |

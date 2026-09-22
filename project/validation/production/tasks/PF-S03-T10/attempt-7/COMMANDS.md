# PF-S03-T10 — attempt 7 commands

All commands ran from `/Users/cybertron/Code/boreal-work` on 2026-09-22
against `HEAD=70514f0ed2521df710c3c913f50ff9d759f5e743`. This attempt was
stopped at the requested handoff boundary before applying the application
adapter changes.

## Checks run

| Command | Result | Evidence |
| --- | --- | --- |
| `cargo check --locked -p boreal-application` | **FAIL** | `crates/application/src/status.rs:291` is missing `StatusContext.schedule` and `StatusContext.activation_at`; the same run also reports the unrelated current-tree PF-S02-T11 borrow error at `crates/application/src/evidence.rs:687`. |
| `cargo fmt --all -- --check` | **PASS** | exit 0 |
| `python3 project/spec/validate_contracts.py` | **PASS** | `8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed` |
| `git diff --check` | **PASS** | exit 0 |
| `cargo test --locked -p boreal-domain --test production_properties` | **PASS** | 21/21 tests passed |

## Exact compile diagnostics

```text
error[E0063]: missing fields `activation_at` and `schedule` in initializer of `StatusContext<'_>`
   --> crates/application/src/status.rs:291:40

error[E0505]: cannot move out of `job` because it is borrowed
   --> crates/application/src/evidence.rs:687:27
```

The second error is outside this attempt's granted paths and belongs to the
unaccepted PF-S02-T11 stream. No workaround was applied here.

## Tool versions

```text
cargo 1.85.0
rustc 1.85.0 (4d91de4e4 2025-02-17)
```

## Source hashes at handoff

```text
1f4504c808cbc28da7ed2a92de76d833065ea40460ad2793d1ed9bdc3c318c82  crates/store/src/status_evaluation.rs
f7b277b0cc221d58c6fbef39a3113f83128574ad0b89fada5add5df10ca43f8e  crates/application/src/status.rs
```

The store status adapter is already modified in the combined worktree by the
protected integration work preceding this attempt. `crates/application/src/status.rs`
was not modified by attempt 7.

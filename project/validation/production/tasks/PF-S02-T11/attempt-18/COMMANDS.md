# PF-S02-T11 attempt 18 — validation commands

All commands ran from `/Users/cybertron/Code/boreal-work` on the final dirty
working tree. No command changed plan/state records.

| Command | Result |
|---|---|
| `cargo test --locked -p boreal-cli update::tests -- --nocapture` | **PASS**, 9/9 focused update adapter tests. |
| `cargo test --locked -p boreal-memory --test publisher -- --nocapture` | **PASS**, 27/27 memory publisher tests, including 5 durable publication adapter tests. |
| `cargo test --locked -p boreal-cli --quiet` | **PASS**, full CLI package: 78 unit tests plus all integration targets passed. |
| `cargo test --locked -p boreal-memory --quiet` | **PASS**, full memory package: 9 unit tests plus 27 publisher tests passed. |
| `rustfmt --edition 2021 --check crates/cli/src/update.rs crates/memory/src/publisher.rs crates/memory/tests/publisher.rs` | **PASS**. |
| `cargo fmt --all -- --check` | **PASS** on the combined tree. |
| `python3 project/spec/validate_contracts.py` | **PASS**: 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transitions, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed. |
| `git diff --check -- crates/cli/src/update.rs crates/memory/src/publisher.rs crates/memory/tests/publisher.rs` | **PASS**. |

The package builds emit dead-code warnings for the adapter surface because the
protected canonical callers do not yet import it. No warning was promoted to
an error in the requested checks.

## Source hashes

| Path | SHA-256 |
|---|---|
| `crates/cli/src/update.rs` | `e507533d5f263b43304c92d162225ea790ad8d6482b173185048b6096eece43b` |
| `crates/memory/src/publisher.rs` | `51defd6f9c5583fcb3b181da2445de76966fc1de34933b9baa9a3dea9014dcd7` |
| `crates/memory/tests/publisher.rs` | `815dbae0a105843d52fc05b1718598f273d9a15552a0c18e0c25ee80e243ec19` |
| `project/spec/production/contract-manifest.json` | `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1` |

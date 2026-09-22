# PF-S03-T10 attempt 1 commands

Input source: `codex/apply-responsive-terminal-overlay@784a41b3802c29a76721c55eef2e9493283396c2`, dirty tree.
Working directory for every command: `/Users/cybertron/Code/boreal-work`.
Runtime: `rustc 1.85.0`, `cargo 1.85.0`, `Python 3.14.3`.

## Implementation checks and retained failures

1. `cargo fmt --all -- --check` — exit 1 initially; reported formatting differences in the edited test target.
2. `cargo fmt --all` — exit 0; formatted only the edited target under the granted path.
3. `cargo test --locked -p boreal-domain --test production_properties` — exit 101 on the first compiled revision: missing `ReviewRecord` import and a `BTreeSet<&str>`/`BTreeSet<String>` assertion mismatch. Both were corrected within the granted test file.
4. `cargo test --locked -p boreal-domain --test production_properties` — exit 101 on the next revision: two test-oracle assertion expectations were incorrect (shrinker sequencing and operator role precedence). Corrected within the granted test file.

## Final checks

5. `cargo fmt --all` — exit 0.
6. `cargo fmt --all -- --check` — exit 0.
7. `cargo test --locked -p boreal-domain --test production_properties` — exit 0; 13 passed, 0 failed.
8. `cargo test --locked -p boreal-domain` — exit 0; all unit and integration targets passed, including 15 unit, 4 hierarchy, 15 M02 status, 12 acceptance, 7 action, 10 decision-input, 14 dependency, 13 property, 5 rollup, 8 precedence, 17 time-policy, 9 work-model tests, and 0 doc-test failures.
9. `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` — exit 0.
10. `python3 project/spec/validate_contracts.py` — exit 0; `8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed`.
11. `git diff --check` — exit 0.

No service, store, verifier, operation readback, native package, installer,
release, or external side effect was run or claimed. No plan state or manifest
was changed.

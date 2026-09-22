# PF-S03-T08 — attempt 4 commands

Commands were run from `/Users/cybertron/Code/boreal-work` on 2026-09-22.
Completion was recorded at `2026-09-22T19:58:28Z`. The source subject was the
dirty combined tree at committed `HEAD`
`0d9611a017d5dc167e92fe79e8d65756fbac2d5a`.

## Toolchain

```text
rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)
cargo 1.85.0
Python 3.14.3
Darwin Saturn-Air.local 24.2.0 arm64
```

## Checks

| Command | Exit | Observed result |
| --- | ---: | --- |
| `cargo test --locked -p boreal-domain --test production_properties -- --nocapture` initial setup probe | 101 | Unsupported transient baseline: the T08-owned source record included by the target was absent. Preserved; the record was added within the granted domain-evidence boundary. |
| `cargo test --locked -p boreal-domain --test production_properties -- --nocapture` intermediate repair run | 101 | Two expected-to-fail repair issues were exposed and retained: stale source-record test digest and an I09 actor-role fixture mismatch. Both were corrected in the owned test/evidence paths. |
| `cargo test --locked -p boreal-domain --test production_properties -- --nocapture` final | 0 | 23/23 focused tests passed, including 1,024 generated status cases and the complete T/I semantic-vector target. |
| `cargo test --locked -p boreal-domain` | 0 | 139 unit/integration tests passed; 0 failed, 0 ignored; doc-tests 0/0. |
| `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` | 0 | Strict domain Clippy passed with no warnings. |
| `rustfmt --edition 2021 --check crates/domain/tests/production_properties.rs` | 0 | Owned test target formatted. |
| `cargo fmt --all -- --check` | 1 | Pre-existing formatting drift remains outside the grant in `crates/cli/src/update.rs` and `crates/memory/tests/publisher.rs`; no outside-boundary edits were made. |
| `python3 project/spec/validate_contracts.py` | 0 | Contract validation passed: 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed. |
| `git diff --check` | 0 | No whitespace errors. |

## Final source and artifact hashes

```text
HEAD 0d9611a017d5dc167e92fe79e8d65756fbac2d5a
crates/domain/tests/production_properties.rs 9f88c311759c119d4c35eec5deec5882442dd0e23845fcbe7ef5e189726f0439
project/validation/production/domain/PF-S03-T08-ORACLE.md f354a5299a8ed1a6130e31205978abf8043bb94a3be84969457aca516bb07a8d
project/validation/production/domain/PF-S03-T08-ORACLE-SOURCE.md 7399d8d43d6acaeab6f82f59a4248a666c2b3247aea32c4224e3e2456cd2f9e2
crates/domain/src/lib.rs ada0f43743b0adcb29a4c95557d41d89a6763852483a61f6540e08749dad2e0c
crates/domain/src/status_evaluator.rs 3065f7419686b075f2a329ee1ad4dd43d0d542dcd99cf151a247a80ceab92d3f
crates/domain/src/actions.rs 8ac6bdecee87c1d14c139a8fe9554be2b448a6fa1d00ebcad79bfe9a3d5c23e7
crates/domain/src/decision_inputs.rs 24895893d826f6a540975e648392de6e677b03e5b7434175711dc6b64f4ed85d
crates/domain/src/dependencies.rs 43001bf2e6009aea63d74662cd47fd1d65183ba76759280c20edeb4076298112
crates/domain/src/time_policy.rs 58ee17cdcad6e4cd7f42f75f68c552647d8c6f098c011f5207b5d2ac58
project/spec/production/contract-manifest.json 131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1
project/spec/production/status-and-actions.md b2b41ffd640811118e2c8f0ac0ba9c60d79cc46ccc73135cdcf609ae384b3a94
project/spec/transition-table.md 4a22bceb49b8d40d96a872f2ae3aed8b79a81d5636339c609914a05b3a2a9d38
project/spec/production/reason-registry.json fb47a166efc1bcef7b94300e638ff67bf45b24dc1767dcd4475301525946ce70
```

The source record is the executable binding. If final integration changes
`HEAD` or any bound bytes, regenerate its `current_source_revision` and
affected `artifact::` hashes, rerun the focused target with `--nocapture`, and
regenerate this attempt's command/evidence identities. No integration commit
was created by this worker.

# PF-S03-T08 — attempt 5 commands

Commands were run from `/Users/cybertron/Code/boreal-work` on 2026-09-22
against exact committed `HEAD`
`3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9`. The tracked worktree was clean
before the evidence-only rebinding; untracked `memory/` was excluded.

## Toolchain

```text
rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)
cargo 1.85.0
Python 3.14.3
Darwin Saturn-Air.local 24.2.0 Darwin Kernel Version 24.2.0: Fri Dec  6 19:00:33 PST 2024; root:xnu-11215.61.5~2/RELEASE_ARM64_T8122 arm64
```

## Checks

| Command | Exit | Observed result |
| --- | ---: | --- |
| `cargo test --locked --offline -p boreal-domain --test production_properties -- --nocapture` first rebinding run | 101 | Expected source-integrity failure: the oracle document digest changed after the owned wording correction; 22/23 tests passed and the mismatch was retained. |
| `cargo test --locked --offline -p boreal-domain --test production_properties -- --nocapture` final | 0 | 23/23 focused tests passed, including source identity, 1,024 generated status cases, and the complete T/I semantic-vector target. |
| `cargo test --locked --offline -p boreal-domain --no-fail-fast` | 0 | 139 unit/integration tests passed; 0 failed; doc-tests 0/0. |
| `cargo clippy --locked --offline -p boreal-domain --all-targets -- -D warnings` | 0 | Strict domain Clippy passed with no warnings. |
| `python3 project/spec/validate_contracts.py` | 0 | 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, and SQLite schema parsed. |
| `cargo fmt --all -- --check` | 0 | Workspace formatting check passed. |
| `git diff --check` | 0 | No whitespace errors. |

The final focused run was executed after correcting the recorded SHA-256 for
the final T08 oracle document. The initial exit 101 is retained as evidence
of the binding check rather than hidden.

## Exact source and artifact hashes

```text
HEAD 3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9
project/spec/production/contract-manifest.json 131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1
project/spec/production/status-and-actions.md b2b41ffd640811118e2c8f0ac0ba9c60d79cc46ccc73135cdcf609ae384b3a94
project/spec/transition-table.md 4a22bceb49b8d40d96a872f2ae3aed8b79a81d5636339c609914a05b3a2a9d38
project/spec/production/reason-registry.json fb47a166efc1bcef7b94300e638ff67bf45b24dc1767dcd4475301525946ce70
crates/domain/src/lib.rs ada0f43743b0adcb29a4c95557d41d89a6763852483a61f6540e08749dad2e0c
crates/domain/src/status_evaluator.rs 3065f7419686b075f2a329ee1ad4dd43d0d542dcd99cf151a247a80ceab92d3f
crates/domain/src/actions.rs 8ac6bdecee87c1d14c139a8fe9554be2b448a6fa1d00ebcad79bfe9a3d5c23e7
crates/domain/src/decision_inputs.rs 24895893d826f6a540975e648392de6e677b03e5b7434175711dc6b64f4ed85d
crates/domain/src/dependencies.rs 43001bf2e6009aea63d74662cd47fd1d65183ba76759280c20edeb4076298112
crates/domain/src/time_policy.rs 58ee17cdcad6e4cd7f42f75f68c552647d8c6f098c011f5207b5d2ac58
crates/domain/tests/production_properties.rs 9f88c311759c119d4c35eec5deec5882442dd0e23845fcbe7ef5e189726f0439
project/validation/production/domain/PF-S03-T08-ORACLE.md 87a997bc8ceed1d83d71ea77fd733358b60fc4747f460ea7d4d3c074f560de3a
```

The source record itself is evidence metadata and is not included as a
recursive self-hash. Its final SHA-256 is
`84cad80ecbb499671566f459864cf3d6af1e7ffd05fe40a2cf778ff9590eba6e`.

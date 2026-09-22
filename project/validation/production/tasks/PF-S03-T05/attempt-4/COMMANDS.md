# PF-S03-T05 independent re-review attempt 4 — commands and results

## Identity and environment

- Workspace/CWD: `/Users/cybertron/Code/boreal-work`
- Review time: `2026-09-22T09:55:31Z` start capture; checks ran on the same
  current tree.
- HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`
- Branch: `codex/apply-responsive-terminal-overlay`
- Worktree: dirty; `74` porcelain entries before this attempt-4 directory was
  created. No pre-existing path was edited.
- Host/toolchain from the prior exact-tree receipt: Darwin arm64; `rustc
  1.85.0 (4d91de4e4 2025-02-17) (Homebrew)`; `cargo 1.85.0`.

## Exact source and contract hashes

| Path | SHA-256 |
| --- | --- |
| `crates/domain/src/dependencies.rs` | `43001bf2e6009aea63d74662cd47fd1d65183ba76759280c20edeb4076298112` |
| `crates/domain/tests/production_dependency_policy.rs` | `462c688add3f9ac79fbca764cb8283acca23a63c9f2d9ddb5199c645c87d2c8f` |
| `crates/domain/src/lib.rs` | `504bb99b658217c8bb3d605f6e7b30b3f4080f14ed1f4928ca4b37121ef45538` |
| `crates/domain/src/decision_inputs.rs` | `24895893d826f6a540975e648392de6e677b03e5b7434175711dc6b64f4ed85d` |
| `project/spec/production/dependencies-overrides-reopen.md` | `3543fb5f1c3af51304826c66e02a3eb10dd0c1972cc35e77585c1b43a5a0a151` |
| `project/spec/WORK_MODEL_V2.md` | `f9c080e78599cec4304c5e3d8b0b4f7aa5a71900c7dbc9fcb643eadf13d1280b` |
| `project/spec/WORK_MODEL_SCENARIOS.md` | `82a4125d34a25563f098626b62482c370cf917f38a0fffd588b455c3856ebebd` |
| `project/spec/production/contract-manifest.json` | `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1` |

The four implementation/context hashes match attempt-3 exactly. Attempt-2
rejection and attempt-3 corrective evidence remain preserved.

## Required exact-tree validation

| Exact command | Exit | Observed result |
| --- | ---: | --- |
| `cargo fmt --all -- --check` | `0` | Passed; no output. |
| `cargo test --locked -p boreal-domain --test production_dependency_policy -- --test-threads=1` | `0` | `14 passed, 0 failed, 0 ignored`. This is the focused target requested without a thread-order dependency. |
| `cargo test --locked -p boreal-domain` | `0` | `103 passed, 0 failed, 0 ignored` across all domain targets; `0` doc tests. |
| `cargo check --locked -p boreal-domain --tests` | `0` | Domain library and all test targets checked. |
| `cargo clippy --locked -p boreal-domain --tests -- -D warnings` | `0` | Strict domain test/profile clippy passed. |
| `cargo clippy --locked -p boreal-domain --lib -- -D warnings` | `0` | Strict domain library clippy passed. |
| `cargo clippy --locked -p boreal-domain --test production_dependency_policy -- -D warnings` | `0` | Strict focused-target clippy passed. |
| `git diff --check` | `0` | Passed; no whitespace errors in the combined tracked diff. |

The target files are untracked in the pre-existing combined worktree, as they
were in attempt-3. Cargo formatting/compile/test/clippy exercised them;
`git diff --check` reports no whitespace errors for the tracked diff.

## Read-only Boreal probes

The review workflow and candidate reads were attempted without mutation:

- `bwrk workflows show boreal.workflow.review.v1 --json`
- `bwrk work show boreal-work PF-S03-T05 --json`
- `bwrk work list boreal-work --json`

Each returned the typed envelope `outcome: busy` with `error.code:
service_busy`; the database owner was already held by
`process:68913:sha256:37e8ffb92bd9e159abd0e6909a4849f6a9e0c1b0dc3451a9129bb4f74d6f5df8`.
No lock was broken and no lifecycle, candidate, ledger, or `STATE.json`
mutation was attempted.

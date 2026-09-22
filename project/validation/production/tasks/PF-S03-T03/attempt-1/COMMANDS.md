# PF-S03-T03 attempt 1 — commands and results

Workspace: `/Users/cybertron/Code/boreal-work`
Attempt window: `2026-09-22T09:05:21Z` through `2026-09-22T09:09:48Z`
Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`
Branch: `codex/apply-responsive-terminal-overlay`
Host/toolchain: Darwin arm64; `rustc 1.85.0 (4d91de4e4 2025-02-17)`;
`cargo 1.85.0`
Worktree: dirty; 72 status entries at START and 74 at final readback,
including the assigned source/test/evidence paths and unrelated existing work.

## Baseline and workflow observations

| Command | CWD | Exit / outcome | Observed result |
| --- | --- | --- | --- |
| `cargo test --locked -p boreal-domain --test production_time_policy` | repository root | `101` | Baseline target was unsupported before implementation: `error: no test target named production_time_policy`; available targets did not include it. |
| `bwrk prime --json` | repository root | `0`; typed `rejected` | `invalid_argument`: missing project identifier. No state changed. |
| `bwrk prime boreal-work --json` | repository root | `0`; typed `busy` | `service_busy`; database owner reported as `process:68913:sha256:37e8ffb92bd9e159abd0e6909a4849f6a9e0c1b0dc3451a9129bb4f74d6f5df8`. No lock was broken and no runtime success was inferred. |
| `bwrk workflows show boreal.workflow.claim-and-finish-work.v1 --json` | repository root | `0`; typed `busy` | `service_busy` for the same local database owner. No claim, finish, close, release, or evidence mutation was attempted. |
| `ps -p 68913 -o pid=,ppid=,stat=,comm=,args=` | repository root | blocked by sandbox | Read-only owner inspection returned `operation not permitted`; this did not affect source work or runtime state. |

## Implementation and validation commands

| Command | CWD | Exit | Observed result |
| --- | --- | ---: | --- |
| `rustfmt --edition 2021 crates/domain/src/time_policy.rs crates/domain/tests/production_time_policy.rs` | repository root | `0` | Assigned Rust files formatted. |
| `cargo fmt --all -- --check` | repository root | `0` | Earlier pre-shared-tree-drift workspace formatting check passed. A later current-tree check is recorded below. |
| `cargo check --locked -p boreal-domain --tests` | repository root | `0` | Domain library and all test targets checked successfully. |
| `cargo test --locked -p boreal-domain --test production_time_policy` | repository root | `101` | First compile attempt failed on source-path shim visibility (`ExpiryReason`, `work_model_v3`), non-`Copy` `AuthorityToken`, and const comparisons. These were implementation/test wiring errors; no acceptance result was claimed. |
| `cargo test --locked -p boreal-domain --test production_time_policy` | repository root | `101` | Second compile attempt failed only because a non-`Copy` authority token was reused in the test; warnings identified unused API items. The token use and warning-causing dead items were corrected. |
| `cargo test --locked -p boreal-domain --test production_time_policy` | repository root | `101` | Third run compiled and executed 11 tests; 10 passed and `exact_hard_deadline_fences_authority_and_late_sweeper_is_not_required` failed because an already-expired attempt still returned a later lease timer. The next-reevaluation predicate was corrected to return no timer once expiry/recovery review is active. |
| `rustfmt --edition 2021 crates/domain/src/time_policy.rs crates/domain/tests/production_time_policy.rs && cargo fmt --all -- --check && cargo check --locked -p boreal-domain --tests && cargo test --locked -p boreal-domain --test production_time_policy && cargo test --locked -p boreal-domain` | repository root | `0` | Earlier pre-shared-tree-drift combined sequence passed formatting, test-target checking, the focused target (`11 passed, 0 failed`), and the full domain package (`90 passed, 0 failed`, `0` doc-test failures). |
| `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` | repository root | `0` | Strict all-target domain clippy passed. |
| `rustfmt --edition 2021 --check crates/domain/src/time_policy.rs crates/domain/tests/production_time_policy.rs && cargo test --locked -p boreal-domain --test production_time_policy` | repository root | `0` | Earlier readback after evidence authoring: assigned files were formatted and focused target remained `11 passed, 0 failed`. |
| `git diff --check -- crates/domain/src/lib.rs crates/domain/src/time_policy.rs crates/domain/tests/production_time_policy.rs project/validation/production/tasks/PF-S03-T03/attempt-1` | repository root | `0` | No tracked whitespace diagnostics. New assigned/evidence files were checked separately below. |
| `if rg -n '[[:blank:]]+$' crates/domain/src/time_policy.rs crates/domain/tests/production_time_policy.rs project/validation/production/tasks/PF-S03-T03/attempt-1; then exit 1; else echo 'PASS: no trailing whitespace in assigned source/test/evidence paths'; fi` | repository root | `1` | Earlier receipt was stale because Markdown hard-break spaces remained in evidence; those spaces were removed and the check is rerun below. |
| `env LC_ALL=C LANG=C /usr/bin/shasum -a 256 ...` | repository root | `0` | Final artifact and prerequisite SHA-256 values recorded below. An earlier locale-inherited `shasum` invocation failed in Perl locale setup; the explicit C-locale rerun passed. |

The earlier source/test/evidence command sequence was run against the dirty
combined worktree at the input HEAD. `crates/domain/src/lib.rs` was not edited
by this attempt; it remains a protected shared file changed by another lane.

## Final readback after scoped contract audit

Readback window: `2026-09-22T09:12:00Z` through `2026-09-22T09:26:21Z` (UTC).
The shared tree had 74 status entries. At readback, another lane's uncommitted
`crates/domain/src/lib.rs:12` registration and unrelated dependency changes
were present; this worker did not edit those paths. The focused test used the
public `boreal_domain::time_policy` import.

| Command | CWD | Exit | Observed result |
| --- | --- | ---: | --- |
| `rustfmt --edition 2021 crates/domain/src/time_policy.rs crates/domain/tests/production_time_policy.rs` | repository root | `0` | Scoped assigned Rust files formatted. |
| `rustfmt --edition 2021 --check crates/domain/src/time_policy.rs crates/domain/tests/production_time_policy.rs` | repository root | `0` | Scoped formatting check passed. |
| `cargo test --locked -p boreal-domain --test production_time_policy -- --nocapture` | repository root | `0` | Public-boundary focused target passed `12/12`, `0` failed. |
| `cargo clippy --locked -p boreal-domain --test production_time_policy -- -D warnings` | repository root | `0` | Focused strict clippy passed. |
| `cargo check --locked -p boreal-domain --tests` | repository root | `101` | Earlier shared-tree readback failed with 84 errors in unrelated `production_dependency_policy` / `dependencies.rs` integration; the later rerun below passed. |
| `cargo test --locked -p boreal-domain` | repository root | `101` | Earlier shared-tree readback failed with the same 84 unrelated dependency-integration errors; the later rerun below passed. |
| `cargo check --locked -p boreal-domain --tests` | repository root | `0` | Domain library and all test targets checked on the current combined tree. |
| `cargo test --locked -p boreal-domain` | repository root | `0` | Full domain package passed `96/96`, `0` failed; doc tests `0/0` passed. |
| `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` | repository root | `0` | All-target strict domain clippy passed. |
| `cargo fmt --all -- --check` | repository root | `1` | Earlier current-tree readback was blocked by a formatting diff in protected shared `crates/domain/src/lib.rs` (module ordering); no assigned file was reported. The final rerun below passed after the shared lane changed state. |
| `cargo fmt --all -- --check` | repository root | `0` | Final current-tree workspace formatting rerun passed. |
| `if rg -n '[[:blank:]]+$' crates/domain/src/time_policy.rs crates/domain/tests/production_time_policy.rs project/validation/production/tasks/PF-S03-T03/attempt-1; then exit 1; else echo 'PASS: no trailing whitespace in assigned source/test/evidence paths'; fi` | repository root | `0` | `PASS: no trailing whitespace in assigned source/test/evidence paths` after evidence cleanup. |

The current focused/full results are source/test evidence only. No service,
database migration, native package, publication, release, genuine verifier,
operation readback, claim, finish, close, or reviewer command ran.

## Final artifact identities

| Path | SHA-256 |
| --- | --- |
| `crates/domain/src/time_policy.rs` | `d3d83676b3d0fdf65346c409c6311278d304bed309b333aa4b28811a7516630e` |
| `crates/domain/tests/production_time_policy.rs` | `c2150e3455d431bc9931c5e30e108ecaa6b0f8071512ae514968d4ea11630a67` |
| `project/validation/production/tasks/PF-S03-T03/attempt-1/START.md` | `25962e3df7e90a5fa06c8d0827a690c93b73a4dd29f6bd7a7cfc0057a094686e` |
| `project/spec/production/contract-manifest.json` | `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa` |
| `project/validation/production/tasks/PF-S03-T01/attempt-2/HANDOFF.md` | `6f3a4b5d96ada595b01b937e5fb99b99e41cccfdaa581f2bb5b4e7899552ee6e` |
| `project/validation/production/tasks/PF-S03-T02/attempt-4/HANDOFF.md` | `b5bfb371a4e732f898309a18fae8b7fb677d1e0de6d7028c579b435f2a4c8d13` |

Earlier attempt evidence digests at handoff authoring:

| Path | SHA-256 |
| --- | --- |
| `project/validation/production/tasks/PF-S03-T03/attempt-1/START.md` | `902be9f4b9941fe40c5ae2c1999a320228b1a5b784b13850bf9fcd3bf6bb528a` |
| `project/validation/production/tasks/PF-S03-T03/attempt-1/EVIDENCE.md` | `7a8e5e8bb5dec91d4e9a598c2e264b83e2b13f8bf36c110a64ac83d428bba145` |
| `project/validation/production/tasks/PF-S03-T03/attempt-1/HANDOFF.md` | `686ef8121f9d30729aecb12e67ab414c394ee0fb4122caf35fbcf1dce1a13d04` |

Current evidence-file digests after the final readback:

| Path | SHA-256 |
| --- | --- |
| `project/validation/production/tasks/PF-S03-T03/attempt-1/START.md` | `25962e3df7e90a5fa06c8d0827a690c93b73a4dd29f6bd7a7cfc0057a094686e` |
| `project/validation/production/tasks/PF-S03-T03/attempt-1/EVIDENCE.md` | `11bce9e11c8dba7abea8aa0cb2bd2dbf62b2009cd4754037865d9bdc1a88c996` |
| `project/validation/production/tasks/PF-S03-T03/attempt-1/HANDOFF.md` | `5e0ea64e3b937e1e06f140e40c9211708988e69d3a5155198bfc1d018629ce8f` |

No service, database migration, native package, publication, release, genuine
verifier, operation readback, claim, finish, close, or reviewer command ran.

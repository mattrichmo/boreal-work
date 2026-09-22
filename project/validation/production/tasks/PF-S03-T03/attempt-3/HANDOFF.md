# PF-S03-T03 attempt 3 — implementation handoff

## Identity and state

- Task / plan / attempt: `PF-S03-T03` / production-completion plan /
  `attempt-3`.
- Worker state: **awaiting independent re-review**; this handoff is not task,
  sprint, or revalidation acceptance.
- Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- Worktree: dirty with 74 status entries; unrelated changes were preserved.
- Accepted prerequisite handoffs remain the T01 attempt-2 and T02 attempt-4
  identities recorded in `START.md` and `COMMANDS.md`.

## Implemented behavior and invariant

Changed only the assigned time-policy module and its public-boundary tests.
Expiry reason now comes from canonical earliest-deadline facts or an explicit
retained reason; phase-only expiry without either fails closed. Renewal
candidates must be after the renewal instant and cannot shorten the persisted
lease. Combined policy suppresses all forward eligibility and timers during
active expiry review or clock reconciliation. Unvalidated restart retry is no
longer eligible. The immutable hard budget, exact deadline equality, historical
clock exclusion, due/overdue informational semantics, deterministic retry, and
validated restart behavior remain covered.

## Changed files and integration request

Worker-owned changed paths:

- `/Users/cybertron/Code/boreal-work/crates/domain/src/time_policy.rs`
- `/Users/cybertron/Code/boreal-work/crates/domain/tests/production_time_policy.rs`
- `/Users/cybertron/Code/boreal-work/project/validation/production/tasks/PF-S03-T03/attempt-3/START.md`
- `/Users/cybertron/Code/boreal-work/project/validation/production/tasks/PF-S03-T03/attempt-3/COMMANDS.md`
- `/Users/cybertron/Code/boreal-work/project/validation/production/tasks/PF-S03-T03/attempt-3/EVIDENCE.md`
- `/Users/cybertron/Code/boreal-work/project/validation/production/tasks/PF-S03-T03/attempt-3/HANDOFF.md`

No schema, protocol, CLI, migration, application, store, service, or shared
root changes were made. The coordinator/steward must retain and independently
verify the existing `pub mod time_policy;` at
`crates/domain/src/lib.rs:12` on the combined tree. This worker did not edit
that protected file.

## Tests and exact results

| Command | Exit / result |
| --- | --- |
| `cargo fmt --all -- --check` | `0` |
| `cargo check --locked -p boreal-domain --tests` | `0` |
| `cargo test --locked -p boreal-domain --test production_time_policy -- --nocapture` | `0`; 16 passed, 0 failed, 0 ignored |
| `cargo test --locked -p boreal-domain` | `0`; 100 passed, 0 failed; 0 doc-test failures |
| `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` | `0` |

The complete command/failure history is in `COMMANDS.md`; the four regression
dispositions and pure-domain limits are in `EVIDENCE.md`.

Failure/history summary retained for the replacement reviewer: attempt 1 began
with a missing focused target, had three intermediate implementation/test
failures, later encountered 84 unrelated dependency-integration errors and a
protected shared-file format block before passing; attempt 2 independently
rejected R1–R4; attempt 3 had one source type mismatch and one corrected
historical-clock assertion before the final green suite. None of these failures
was hidden or converted into acceptance.

## Review findings and residual risks

- Attempt-2 findings R1, R2, R3, and R4 are addressed in the bounded source and
  regression tests described above.
- No independent reviewer has yet inspected this attempt's final source.
- No task acceptance, sprint acceptance, reconciliation, or PF-S03-T92
  revalidation is claimed.
- Pure-domain checks do not establish transactional fencing, physical stop,
  resource isolation, or real-service recovery.
- `bwrk` prime/workflow resolution remained blocked by a typed local
  `service_busy` owner; no lock break or state mutation was attempted.

## Final source hashes

| Path | SHA-256 |
| --- | --- |
| `crates/domain/src/time_policy.rs` | `58ee17cdcad6e4cd7f42f75f68c5526471ce278d8c6f098c011f5207b5d2ac58` |
| `crates/domain/tests/production_time_policy.rs` | `c535f8269097726cfafa6e28d2329a6e10d6c93434eef9868514b052761dc12d` |
| `crates/domain/src/lib.rs` (read-only shared file) | `504bb99b658217c8bb3d605f6e7b30b3f4080f14ed1f4928ca4b37121ef45538` |
| `project/validation/production/tasks/PF-S03-T03/attempt-3/START.md` | `2198cc1cace6e4061fdb2873039e820aec92de4b1ad8ae22f2cc199ebaeddc88` |
| `project/validation/production/tasks/PF-S03-T03/attempt-3/COMMANDS.md` | `165586ee35a79900a719cfaba6a1949e73b447fb7717609d2177a05cf8331ff9` |
| `project/validation/production/tasks/PF-S03-T03/attempt-3/EVIDENCE.md` | `1fd96642dc92acadec5c4eb52cf7bfaf7e24865c7ab693585d1cf4a6e0efa72a` |
| `project/validation/production/tasks/PF-S03-T03/attempt-3/HANDOFF.md` | this file; self-hash intentionally omitted |

## Next safe action

Assign a fresh independent PF-S03-T03 re-review against the final combined
source/artifact identities. The reviewer should rerun the focused and required
domain checks, inspect the four corrected boundaries and verify the protected
public registration. After that, the coordinator owns reconciliation and the
PF-S03-T92 exact-tree revalidation decision.

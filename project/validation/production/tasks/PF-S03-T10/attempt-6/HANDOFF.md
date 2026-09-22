# PF-S03-T10 — attempt 6 handoff

## Identity and disposition

- Task: `PF-S03-T10` — complete deterministic oracle coverage for status and transitions.
- Attempt: `6`.
- Base/current Git `HEAD`: `70514f0ed2521df710c3c913f50ff9d759f5e743`.
- Worktree: dirty combined coordinator checkout; unrelated stream changes were
  preserved and are not claimed by this attempt.
- State requested: `ready_for_review`.
- Decision: **not accepted**. Independent review, protected-path integration,
  contract disposition, and exact-tree revalidation remain required.
- Commit/push: none.
- Plan/ledger edits: none.

## Concrete result

This attempt implements the missing pure-domain status/3 semantics identified
by the rejected T10 oracle:

- `DerivedStatus::Scheduled` is a distinct product status.
- `ReasonCode::ScheduledStart(TimestampMs)` is typed and stable.
- `StatusContext` accepts canonical work schedule and resolved assignment
  activation facts.
- The evaluator chooses the earliest future activation instant, emits a
  `WaitUntil` action, preserves secondary reasons, includes schedule/due
  timers, clears constraints exactly at equality, and fails closed on an
  invalid schedule.
- Rollup counts include scheduled work.
- Pure tests now assert scheduled boundaries, status/2 compatibility as an
  adapter obligation, action deny/allow behavior, and semantic T/I vectors.

## Checks

Passed:

- `cargo test --locked -p boreal-domain --test production_properties` — 21/21.
- `cargo test --locked -p boreal-domain` — 137 unit/integration tests passed,
  0 doc-test failures.
- `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings`.
- Owned `rustfmt --check` for `lib.rs`, `status_evaluator.rs`, and
  `production_properties.rs`.
- `python3 project/spec/validate_contracts.py`.
- `git diff --check`.

Blocked/limited:

- `cargo check --locked --workspace` and
  `cargo check --locked -p boreal-application` stop at
  `crates/store/src/status_evaluation.rs:146`: the protected direct
  `StatusContext` literal lacks `schedule` and `activation_at`. The next
  protected literal is `crates/application/src/status.rs:291`.
- `cargo fmt --all -- --check` remains red on unrelated combined-tree store
  drift; owned formatting is clean.

Full command details are in `COMMANDS.md`.

## Required protected integration

The store/application steward must reconcile the two direct literals and source
canonical values from schedule/assignment projections. If those facts are not
available yet, passing `None` must be accompanied by a typed unavailable or
compatibility diagnostic; a future schedule must never be treated as ready.
The protocol/service adapter must map status/3 `scheduled` to status/2
`queued` plus `scheduled_start` and preserve claim denial. These requests are
fully recorded in `INTEGRATION-REQUESTS.md`.

The source status/3 contract is still marked proposed in
`project/spec/production/status-and-actions.md`; this attempt did not edit or
self-accept that artifact. Contract ownership must record acceptance or a
versioned amendment before T10 can be accepted.

## Next safe action

Assign an independent reviewer against the attempt-6 source hashes, then have
the protected integration steward apply IR-1/IR-2 on the combined tree and
rerun workspace compilation, store/application tests, status/2 adapter tests,
contract validation, and exact source-bound revalidation. Do not mark
`PF-S03-T10` accepted or unlock `PF-S03-T90` from this handoff alone.

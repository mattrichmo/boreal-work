# PF-S03-T03 attempt 1 — evidence

## Record and evidence class

- Record: `PF-S03-T03 / attempt-1 / AC-09`.
- Evidence class: pure domain source and deterministic focused tests.
- Worker disposition: implementation evidence only; **not task acceptance**.
- Input source: dirty worktree at `HEAD:784a41b3802c29a76721c55eef2e9493283396c2`.
- Contract manifest SHA-256:
  `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa`.
- Accepted prerequisite handoff identities:
  - PF-S03-T01 attempt 2: `6f3a4b5d96ada595b01b937e5fb99b99e41cccfdaa581f2bb5b4e7899552ee6e`.
  - PF-S03-T02 attempt 4: `b5bfb371a4e732f898309a18fae8b7fb677d1e0de6d7028c579b435f2a4c8d13`.
- Host/toolchain: Darwin arm64; `rustc 1.85.0`; `cargo 1.85.0`.
- Source artifact SHA-256 values are recorded in `COMMANDS.md` and the
  handoff; no compiled binary or service artifact is claimed.

## Implemented deterministic invariant

`crates/domain/src/time_policy.rs` adds a transport-free policy boundary with
these separate predicates and result types:

- `PolicyClock` accepts caller-injected observations only. Backward samples
  retain the previous observation as a conservative effective floor and deny
  mutation authority. Restarts without monotonic evidence are marked
  `UnvalidatedRestart` and deny writes; validated monotonic restart evidence
  advances the effective read instant without moving the persisted hard
  deadline.
- `AttemptWindow` validates that both persisted deadlines are after
  `claimed_at`, uses `as_of >= deadline` for exact equality expiry, and gives
  hard-budget elapsed precedence when both clocks have elapsed.
- `AuthorityToken` compares both attempt identity and fence. Stale attempt,
  stale fence, terminal/history, clock discontinuity, lease elapsed, and hard
  budget elapsed are distinct non-authorized outcomes.
- `renew_lease` is pure and returns a candidate lease deadline while returning
  the unchanged hard deadline. It cannot renew at or after either applicable
  authority boundary.
- `AttemptSnapshot` distinguishes current execution from historical attempts.
  Failed, released, cancelled, and completed historical deadlines do not
  expire idle work. An expired historical attempt contributes expiry review
  only when `RecoveryState::Pending` is supplied.
- `evaluate_schedule` treats `not_before_at` as eligibility, treats
  `due_at` equality as an overdue informational badge, and does not use
  target start/end estimates as claim gates. Terminal work suppresses the
  overdue badge.
- `RetryPolicy` uses deterministic capped exponential backoff without random
  jitter. `RetryInput` clears waiting at exact `retry_not_before` equality and
  refuses retry beyond the configured bound.
- `evaluate_time_policy` combines independent schedule, retry, exception,
  lease, and hard-budget timers and returns the earliest relevant future
  reevaluation. Once expiry/recovery review or clock reconciliation is active,
  it does not schedule a misleading ownership timer.

The module has no storage, service, process, terminal, JSON, or global-clock
dependency. At final readback the focused test imports the public module; the
shared tree already contained `crates/domain/src/lib.rs:12` registration from
another lane, which this worker did not edit.

## Focused coverage

`production_time_policy.rs` contains 12 tests covering:

| Acceptance behavior | Focused assertion |
| --- | --- |
| Default and explicit lease/hard clocks remain separate | `claim_windows_use_exact_defaults_and_keep_clocks_separate` |
| Exact hard-deadline equality fences a stale execution without a sweeper | `exact_hard_deadline_fences_authority_and_late_sweeper_is_not_required` |
| Lease renewal does not move hard budget | `lease_renewal_is_allowed_before_lease_deadline_and_never_moves_hard_budget` |
| Stale attempt and stale fence are distinct | `stale_attempt_and_fence_authority_are_distinct_and_never_mutate` |
| Historical terminal clocks are ignored; pending recovery remains visible | `historical_terminal_attempt_clocks_are_ignored_unless_recovery_is_pending` |
| Schedule availability and due equality are independent | `schedule_equality_marks_due_without_stealing_ownership` |
| Planning target estimates do not gate eligibility or due | `planning_target_window_does_not_gate_claim_eligibility_or_due` |
| Retry backoff is deterministic, capped, and clears at equality | `retry_backoff_is_deterministic_bounded_and_clears_at_equality` |
| Earliest lease/schedule/retry/exception reevaluation is selected | `next_reevaluation_is_the_earliest_relevant_timer` |
| Backward/unvalidated restart clocks do not resurrect or authorize | `backward_clock_does_not_resurrect_expiry_and_unvalidated_restart_denies_writes` |
| Validated restart uses monotonic evidence without extra hard budget | `validated_restart_uses_monotonic_elapsed_time_without_extending_hard_budget` |
| Malformed deadline/schedule/backoff inputs fail closed | `malformed_deadlines_and_schedules_fail_closed` |

Final observed results:

- `cargo test --locked -p boreal-domain --test production_time_policy -- --nocapture`:
  `12 passed, 0 failed`, exit `0`, using the public module import.
- `cargo test --locked -p boreal-domain`: `96 passed, 0 failed`, `0` doc-test
  failures, exit `0`.
- `rustfmt --edition 2021 --check crates/domain/src/time_policy.rs
  crates/domain/tests/production_time_policy.rs`: exit `0`.
- The earlier current-tree `cargo fmt --all -- --check` readback was blocked
  with exit `1` by protected shared `crates/domain/src/lib.rs` module ordering;
  the final rerun passed with exit `0` after that shared lane changed state.
  No assigned file was reported in the blocked receipt.
- `cargo check --locked -p boreal-domain --tests`: exit `0`.
- `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings`:
  exit `0`.
- Assigned source/test/evidence trailing-whitespace check after evidence
  cleanup: exit `0`.

The failed baseline target, three intermediate implementation failures, the
intermediate shared-tree check/test failure with 84 unrelated dependency
integration errors, the earlier shared formatting block, and the typed
`service_busy` workflow observations remain explicitly recorded in
`COMMANDS.md`; they are not relabeled as successful evidence.

## Scope and authority limits

- No `lib.rs` registration was made by this worker. The exact shared-file
  request remains `pub mod time_policy;`; the current dirty tree shows that
  declaration at `crates/domain/src/lib.rs:12` from another lane, and the
  focused test uses the public `boreal_domain::time_policy` import.
- The focused/full result is combined-tree public-boundary source/test
  evidence, not task acceptance. The coordinator must retain/verify the
  declaration and rerun the exact checks after the final shared-tree
  reconciliation.
- No service, store transaction, scheduler, protocol DTO, CLI/TUI, migration,
  native, publication, release, genuine verifier, or independent review was
  run. Pure predicates do not establish lifecycle acceptance or physical
  process-stop/recovery safety.
- The local Boreal database was busy under another process for the read-only
  prime/workflow probes. No live lock was broken and no coordinator ledger or
  acceptance state was changed.

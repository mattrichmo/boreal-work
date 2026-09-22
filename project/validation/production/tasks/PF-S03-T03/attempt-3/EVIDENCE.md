# PF-S03-T03 attempt 3 — corrective implementation evidence

## Record and disposition

- Record: `PF-S03-T03 / attempt-3 / AC-09 corrective implementation`.
- Evidence class: bounded pure-domain implementation and public-boundary
  regression tests.
- Worker disposition: **awaiting independent re-review; not acceptance**.
- Independent review remains required after this attempt. The prior attempt-2
  rejection remains preserved and is not overwritten.

## Corrective changes

### R1 — canonical lease-only expiry reason

`AttemptWindow::expiry_reason` now reports the reason associated with the
earliest elapsed persisted deadline instead of hard-budget precedence whenever
the lease elapsed first. `AttemptSnapshot` carries an optional
`retained_expiry_reason` for a phase-only recovery snapshot whose deadlines no
longer prove the original trigger. A phase-only expired/current snapshot with
neither elapsed deadline nor retained reason returns the typed
`MissingExpiryReason` error rather than inventing hard-budget expiry. Historical
expired phases remain non-reviewing unless `RecoveryState::Pending` is present.

Regression coverage:

- `expiry_review_uses_lease_trigger_and_requires_retained_phase_only_reason`
  proves a current `ExpiryPending` attempt at the lease deadline reports
  `LeaseElapsed`, keeps the hard clock factual, rejects missing phase-only
  trigger evidence, and accepts an explicit retained reason.
- `historical_terminal_attempt_clocks_are_ignored_unless_recovery_is_pending`
  proves both elapsed facts remain visible while the actual earliest trigger is
  retained as lease expiry.

### R2 — strictly valid, non-shortening renewal candidates

`renew_lease` now rejects a candidate deadline at or before the effective
renewal instant with `RenewalDeadlineNotAfterNow`, and rejects a candidate below
the persisted lease deadline with `RenewalShortensLease`. The immutable hard
deadline remains unchanged.

Regression coverage:

- `lease_renewal_rejects_zero_and_shortening_candidates` covers zero TTL and a
  positive TTL that would shorten the existing lease.
- The existing normal-renewal test still proves a valid extension preserves the
  hard deadline.

### R3 — expiry-review suppression in combined policy

`evaluate_time_policy` now treats active expiry review as a forward-progress
barrier. It suppresses schedule eligibility, retry eligibility, schedule/retry
next-change fields, exception/readback/attempt timers, and the combined next
reevaluation while `review_required` is active. Factual scheduled/waiting,
overdue, and exception-valid observations remain available.

Regression coverage:

- `expiry_review_suppresses_forward_eligibility_and_timers` supplies future
  schedule, retry, exception, and review timers with an `ExpiryPending` attempt
  and asserts all forward eligibility/timers are suppressed.

### R4 — unvalidated restart retry fail-closed

The same combined forward-progress barrier now includes any clock validity that
needs reconciliation. This closes retry eligibility as well as schedule
eligibility and all future timers after an unvalidated restart.

Regression coverage:

- `unvalidated_restart_suppresses_combined_retry_eligibility_and_timers` proves
  `RetryDecision.eligible=false`, schedule eligibility is false, retry timer is
  absent, and combined reevaluation is absent under an unvalidated restart.

## Preserved behavior

The existing tests continue to cover exact deadline equality, stale attempt and
fence rejection, immutable hard budget, historical failed/released/cancelled
clock exclusion, due/overdue informational behavior, planning estimates,
bounded deterministic retry, active timer ordering, backward-clock safety, and
validated monotonic restart handling. The final focused public-boundary target
has 16 passing tests.

## Verification receipts

| Command | Exit | Result |
| --- | ---: | --- |
| `cargo fmt --all -- --check` | 0 | Workspace formatting passed. |
| `cargo check --locked -p boreal-domain --tests` | 0 | Domain library and all test targets checked. |
| `cargo test --locked -p boreal-domain --test production_time_policy -- --nocapture` | 0 | 16 passed, 0 failed, 0 ignored. |
| `cargo test --locked -p boreal-domain` | 0 | 100 passed, 0 failed; doc-tests 0 passed, 0 failed. |
| `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` | 0 | Strict all-target domain clippy passed. |

The attempt-3 command history also records two honest intermediate failures:
one compile type mismatch and one corrected historical-clock assertion. The
prior attempt-1 compile/tree failures and attempt-2 typed service-busy/review
rejection remain preserved in their original evidence directories.

## Source and contract identity

| Path | SHA-256 |
| --- | --- |
| `crates/domain/src/time_policy.rs` | `58ee17cdcad6e4cd7f42f75f68c5526471ce278d8c6f098c011f5207b5d2ac58` |
| `crates/domain/tests/production_time_policy.rs` | `c535f8269097726cfafa6e28d2329a6e10d6c93434eef9868514b052761dc12d` |
| `crates/domain/src/lib.rs` (read-only) | `504bb99b658217c8bb3d605f6e7b30b3f4080f14ed1f4928ca4b37121ef45538` |
| `project/build-plan/production-completion/sprints/PF-S03/tasks/PF-S03-T03.md` | `892addfe415d344cba6ae32565d105a1774a22165d3758da8d1e1af15d33e36b` |
| `project/spec/production/contract-manifest.json` | `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1` |
| `project/spec/production/status-and-actions.md` | `b2b41ffd640811118e2c8f0ac0ba9c60d79cc46ccc73135cdcf609ae384b3a94` |
| `project/spec/production/execution-submission-contract.md` | `539088128f18bc6fef8bbd855ca6a140c4d02ba33bffc799179b128c2a8393a4` |
| `project/spec/transition-table.md` | `4a22bceb49b8d40d96a872f2ae3aed8b79a81d5636339c609914a05b3a2a9d38` |

## Scope limits

This is pure-domain evidence. It does not prove store transaction fencing,
physical process stop, shared-worktree isolation, service restart/recovery,
native packaging, publication, or release behavior. The shared public module
registration was verified but not edited under this attempt's write boundary.
The local Boreal workflow database remained busy; no live lock or coordinator
state was changed. Independent re-review and the PF-S03-T90/T91/T92 chain
remain required.


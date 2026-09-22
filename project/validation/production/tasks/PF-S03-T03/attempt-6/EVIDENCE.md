# PF-S03-T03 attempt 6 — independent review evidence

## Record and decision

- Record: `PF-S03-T03 / attempt-6 / AC-09`.
- Evidence class: independent current-source/public-boundary inspection,
  contract comparison, and fresh pure-domain checks.
- Decision: **ACCEPT for the bounded PF-S03-T03 leaf**.
- Scope: this accepts only the PF-S03-T03 time-policy leaf on the exact dirty
  current tree. It is not sprint, service, reconciliation, revalidation,
  native, publication, or release acceptance.
- No prior finding, failed attempt, or unsupported workflow result is erased.

## Contract basis

The review applied the lease/hard-budget separation and exact-boundary rules in
`project/STATUS_MODEL.md:237-289`, `project/spec/transition-table.md:89-140`,
`project/spec/production/status-and-actions.md:56-76,125-156`,
`project/spec/production/execution-submission-contract.md:15-26,43-54,98-120`,
and the virtual clock cases in `project/spec/clock-and-attempt.json`.

Those contracts require equality at a lease or hard deadline to deny old
authority, a renewable lease to never move the immutable hard budget, expiry
review to remain non-claimable, due/overdue to remain informational, and
forward mutation/timers to fail closed while recovery or clock reconciliation
is unresolved.

## Current-tree inspection

### Public `Attempt` boundary

`crates/domain/src/lib.rs:477-490` now computes the renewal candidate with
checked arithmetic, rejects `candidate <= at` and
`candidate < self.lease_deadline` as `DomainError::InvalidLeaseRenewal`, and
mutates the lease only after both guards pass. The method changes only
`lease_deadline`; `max_attempt_deadline` is not moved.

`crates/domain/src/lib.rs:501-510` derives `HardBudgetElapsed` only when the
hard deadline has elapsed, `LeaseElapsed` when only the lease deadline has
elapsed, and `None` otherwise. A phase-only `ExpiryPending`/`Expired` value
with no elapsed deadline therefore fails closed instead of manufacturing a
hard-budget reason. The canonical retained-trigger path for phase-only
recovery is carried by `AttemptSnapshot::retained_expiry_reason` in
`time_policy.rs:243-285`.

The public regression
`crates/domain/tests/production_time_policy.rs:251-272` passes for lease-only
expiry, phase-only no-trigger behavior, zero renewal, shortening renewal, and
non-mutation of the existing lease deadline.

### Canonical time policy

`AttemptWindow::expiry_reason` at `crates/domain/src/time_policy.rs:209-223`
selects the earliest elapsed deadline. `evaluate_attempt` at
`:361-431` uses a retained trigger when supplied and returns
`MissingExpiryReason` for phase-only expiry without one. The pure renewal path
at `:449-481` rejects zero/shortening candidates and returns the persisted hard
deadline unchanged.

`evaluate_time_policy` at `crates/domain/src/time_policy.rs:650-703` combines
the barriers `clock.validity.needs_reconciliation()` and
`attempt.review_required`. While either is active it clears schedule and retry
eligibility, clears their next-change timers, and excludes exception,
readback, attempt, and combined future timers. Factual observations remain
available for review.

The focused regressions at `production_time_policy.rs:214-248`, `:390-421`,
and `:448-472` directly cover lease-trigger/retained-trigger/fail-closed
behavior, expiry-review suppression, and unvalidated-restart suppression.

## Prior findings and dispositions

The prior history remains preserved in attempts 1–5:

- Attempt 1’s missing-target, intermediate compile/test, concurrent dirty-tree,
  and formatting failures remain historical evidence.
- Attempt 2 findings R1–R4 were: incorrect lease-only trigger selection,
  invalid renewal candidates, forward timers/eligibility during expiry review,
  and retry eligibility after unvalidated restart. The current canonical module
  and focused regressions pass all four correction vectors.
- Attempt 4 findings `PF-S03-T03-R5` and `R6` identified the public
  `Attempt::expiry_reason` and `Attempt::renew_lease` duplicate paths as still
  divergent. The current shared `lib.rs` fixes and public-boundary regression
  pass those exact cases.
- Attempt 5 was coordinator-owned evidence preparation and claimed no
  acceptance. Its corrections were independently inspected here.

No new blocking finding was found within the bounded PF-S03-T03 leaf on this
tree.

## Fresh validation result

All required commands passed as recorded in `COMMANDS.md`:

- focused `production_time_policy`: 17/17;
- full `boreal-domain`: 104/104, with 0/0 doc-test failures;
- domain test-target `cargo check`: pass;
- strict all-target domain clippy: pass with `-D warnings`;
- workspace rustfmt check: pass;
- tracked-diff whitespace check: pass.

## Evidence limits and retained workflow limitation

This is pure-domain/public-boundary evidence. It does not establish store
transaction fencing, durable recovery persistence, physical process stop,
shared-worktree isolation, service/API/CLI/TUI behavior, native timers,
packaging, publication, or release behavior. The read-only Boreal workflow,
candidate, and work-show probes were typed `service_busy`; no live receipt or
coordinator state transition is fabricated.

The attempt-1 through attempt-5 evidence and current `STATE.json` remain
untouched. The PF-S03-T90 → PF-S03-T91 → PF-S03-T92 chain remains required
outside this leaf decision.

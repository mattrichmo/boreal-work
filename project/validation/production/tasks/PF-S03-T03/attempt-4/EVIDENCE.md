# PF-S03-T03 attempt 4 — independent re-review evidence

## Record and decision

- Record: `PF-S03-T03 / attempt-4 / AC-09`.
- Evidence class: independent current-source/public-boundary inspection,
  contract comparison, and fresh pure-domain checks.
- Decision: **REJECT for the bounded PF-S03-T03 leaf**.
- Scope: this rejects only PF-S03-T03 leaf acceptance. It is not a sprint,
  service, reconciliation, revalidation, native, publication, or release
  decision.
- The new `boreal_domain::time_policy` vectors pass, but the existing public
  domain API still exposes the two corrected semantics through duplicate
  paths in `crates/domain/src/lib.rs`.

## Contract basis

The review applies the distinct renewable-lease and immutable-hard-budget
rules in `project/STATUS_MODEL.md` (claim-time limits and expiry),
`project/spec/transition-table.md` C03/C05/I12, and
`project/spec/production/execution-submission-contract.md` sections 15 and
39–55. Expiry review is non-claimable and requires the original trigger or a
safe retained recovery fact; a lease renewal cannot create an expired or
shorter candidate and never moves the hard deadline.

## Correction results

### R1 — new time-policy evaluator is correct, but the public duplicate API is not

The corrected module is internally correct for the requested cases:

- `AttemptWindow::expiry_reason` selects the earliest elapsed deadline at
  `crates/domain/src/time_policy.rs:209-223`.
- `evaluate_attempt` accepts a retained trigger and returns
  `MissingExpiryReason` for phase-only expiry without one at
  `crates/domain/src/time_policy.rs:373-390`.
- The focused public-module test at
  `crates/domain/tests/production_time_policy.rs:211-249` proves lease-only
  `LeaseElapsed`, retained phase-only recovery, and fail-closed absence.

However, the public `Attempt` API remains inconsistent:

- `crates/domain/src/lib.rs:497-505` returns
  `HardBudgetElapsed` unconditionally for `ExpiryPending`/`Expired`, before
  checking either persisted deadline. It has no retained canonical trigger
  field for phase-only recovery.
- `Attempt::deadlines_at` at `crates/domain/src/lib.rs:489-494` exposes that
  result through the public `DeadlineView`.
- A phase-only `ExpiryPending` attempt with lease deadline 100, hard deadline
  1000, and `as_of=100` therefore reports `HardBudgetElapsed` from the public
  method, while the corrected time-policy evaluator reports `LeaseElapsed`.
  A phase-only attempt with both deadlines still in the future also reports
  `HardBudgetElapsed` instead of failing closed.

This leaves the requested lease-only/retained-trigger correction false for an
existing public domain path. The new test only imports the new module and does
not cover the public `Attempt` method.

### R2 — new time-policy renewal is correct, but the public duplicate API accepts invalid candidates

The corrected module now rejects a candidate at/before the effective renewal
instant and a candidate below the persisted lease deadline at
`crates/domain/src/time_policy.rs:461-475`. The focused tests at
`crates/domain/tests/production_time_policy.rs:76-127` pass and verify that a
valid renewal leaves the hard deadline unchanged.

The public `Attempt::renew_lease` at
`crates/domain/src/lib.rs:477-486` still only checks terminal phase and the
old lease window, then assigns `at + lease_ttl_ms`. It does not require the
candidate to be strictly after `at` and does not compare it with the existing
lease deadline. Consequently, with a live attempt whose lease deadline is
1000, `at=500` and `lease_ttl_ms=0` mutates the public attempt to deadline 500;
`lease_ttl_ms=100` mutates it to 600. Both are accepted by this public method.
The hard deadline remains unchanged, but the invalid renewal candidate is not
rejected.

This is the same policy boundary as attempt-2 R2, merely bypassed by the new
free function. The public domain surface still permits the rejected behavior.

### R3 — combined expiry-review suppression passes

`evaluate_time_policy` computes `forward_progress_blocked` from active expiry
review or clock reconciliation at
`crates/domain/src/time_policy.rs:653-667`. It clears schedule/retry
eligibility and their next-change timers, and excludes exception, readback,
and attempt timers from the combined reevaluation at
`crates/domain/src/time_policy.rs:672-703`.

The fresh `expiry_review_suppresses_forward_eligibility_and_timers` vector
passed. Factual scheduled/waiting/overdue/exception observations remain
available, while forward eligibility and misleading timers are suppressed.

### R4 — unvalidated-restart retry/forward suppression passes

`PolicyClock::resolve` marks a restart without monotonic elapsed evidence as
`UnvalidatedRestart` at `crates/domain/src/time_policy.rs:90-103`.
`ClockValidity::needs_reconciliation()` then feeds the same combined barrier,
which clears retry and schedule eligibility and all reevaluation timers.
The fresh `unvalidated_restart_suppresses_combined_retry_eligibility_and_timers`
vector passed.

## Blocking findings

### PF-S03-T03-R5 — public expiry reason path still manufactures hard-budget expiry

- Severity: **major**.
- The corrected free evaluator and its tests pass, but the existing public
  `Attempt::expiry_reason`/`DeadlineView` path still reports hard-budget expiry
  for lease-only and phase-only expiry.
- This violates the distinct C05 lease trigger and the phase-only fail-closed
  requirement for callers using the public `Attempt` API.
- Required disposition: route the public path through one canonical corrected
  policy or update the shared public representation to retain the trigger, then
  add a public-boundary regression for lease-only and missing phase-only reason.

### PF-S03-T03-R6 — public renewal path still accepts zero/shortening candidates

- Severity: **major**.
- `Attempt::renew_lease` accepts and stores zero/shortening candidates even
  though the new `time_policy::renew_lease` rejects them.
- This violates I12 and leaves two public renewal authorities with different
  behavior. The hard budget is not moved, but invalid lease state is still
  accepted.
- Required disposition: route public renewal through the canonical corrected
  predicate or enforce both candidate checks in the shared public boundary,
  then add public-boundary zero/shortening regressions.

## Review limits and preserved history

- The fresh policy-module focused target passed 16/16; the full domain package,
  check, formatting, strict clippy, and diff checks also passed as recorded in
  `COMMANDS.md`. Green compilation does not erase R5/R6 source findings.
- Attempt-2 R1–R4 remain preserved. R1/R2 are addressed inside the new
  `time_policy` module but not across the existing public domain surface; R3/R4
  are addressed by the combined evaluator and fresh tests.
- The workflow candidate/show queries were blocked by typed `service_busy`; no
  review receipt or lifecycle state was fabricated.
- No store transaction, process stop, service recovery, native artifact,
  publication, or release behavior is accepted by this record.
- No source file, prior evidence, or `STATE.json` was edited.


# PF-S03-T03 attempt 2 — independent review evidence

## Record and decision

- Record: `PF-S03-T03 / attempt-2 / AC-09`.
- Evidence class: independent current-source/contract inspection plus fresh
  public-boundary pure-domain checks.
- Reviewer: Codex (OpenAI), independent of the attempt-1 implementation.
- Decision: **REJECT for the bounded PF-S03-T03 leaf**.
- Scope: this rejects only PF-S03-T03 leaf acceptance. It is not a sprint,
  service, native, publication, release, reconciliation, or revalidation
  decision.
- Current source identity: dirty `HEAD:784a41b3802c29a76721c55eef2e9493283396c2`;
  exact artifact hashes are in `COMMANDS.md`.

## Public integration and passing evidence

The coordinator's public registration is present at
`crates/domain/src/lib.rs:12`, and the focused test imports the public module
at `crates/domain/tests/production_time_policy.rs:8`. The focused public target
and full domain package both compile and pass on this exact dirty tree.

The fresh checks establish:

- exact hard-deadline equality fences the presented authority and does not
  require a sweeper;
- hard budget and renewable lease are stored as separate values for the tested
  claim/renewal cases;
- stale attempt and stale fence outcomes remain distinct;
- historical failed/released/cancelled/completed clocks are ignored without a
  pending recovery marker, while the tested pending expired recovery remains
  visible;
- due equality is informational and does not block eligibility;
- target start/end estimates do not gate claims or due state;
- retry equality clears waiting and the tested backoff is deterministic/capped;
- backward and unvalidated restart samples do not resurrect the tested expired
  attempt or authorize the tested write;
- selected malformed deadline/schedule/backoff inputs return errors.

These are pure-domain results. They do not prove transactional fencing,
physical process stop, resource isolation, or runtime recovery.

## Findings blocking acceptance

### PF-S03-T03-R1 — lease-only expiry is reported as hard-budget expiry

- Severity: **major**.
- Reproduction from current source: `crates/domain/src/time_policy.rs:397-400`
  derives `expiry_reason` by calling `Attempt::expiry_reason`. The current
  `crates/domain/src/lib.rs:497-500` implementation returns
  `HardBudgetElapsed` unconditionally for `AttemptPhase::ExpiryPending` or
  `AttemptPhase::Expired`, before checking the persisted deadlines.
- A current attempt with `claimed_at=0`, `lease_deadline=100`,
  `hard_deadline=1000`, phase `ExpiryPending`, and `as_of=100` therefore
  reports `expired=true`, `review_required=true`, but
  `expiry_reason=HardBudgetElapsed`. The lease has elapsed and the hard budget
  has not.
- This violates the accepted C05 transition vector in
  `project/spec/transition-table.md:125-136`, which requires a lease-expiry
  reason distinct from hard-budget expiry, and violates D20/D21's separate
  clock semantics. The correct phase/recovery state must retain the actual
  triggering reason instead of manufacturing hard-budget expiry from the phase
  alone.
- The focused target only tests exact hard-budget equality and renewal before
  expiry; it has no lease-boundary `ExpiryPending` reason vector.
- Impact: status/recovery can display and route a lease expiry as a hard-budget
  expiry, making the leaf's expiry reason contract non-deterministic with
  respect to which clock actually fenced execution.

### PF-S03-T03-R2 — renewal accepts an immediately expired or shortened lease candidate

- Severity: **major**.
- Reproduction from current source: `crates/domain/src/time_policy.rs:428-440`
  checks authority against the old window, then computes
  `new_lease_deadline = effective_at + lease_ttl_ms` without validating that
  the candidate is strictly after `effective_at` or at least preserves the
  current lease deadline.
- With a valid current attempt at `claimed_at=0`, old lease deadline `1000`,
  hard deadline `5000`, and `as_of=500`, `renew_lease(..., lease_ttl_ms=0)`
  returns `Ok` with `new_lease_deadline=500`, an already elapsed lease at the
  instant of the successful renewal. A small positive TTL can also shorten the
  live lease below its previous deadline.
- `AttemptWindow::new` rejects malformed persisted deadlines, but the renewal
  result is not passed through that invariant. D21 and the execution contract
  define renewal as an extension of renewable ownership and require malformed
  or expired renewal inputs to fail closed.
- The focused target proves only a normal extension and immutable hard budget;
  it does not cover zero, shortening, or candidate-boundary renewal.
- Impact: an accepted renewal can create an immediately expired or unexpectedly
  shortened ownership window, undermining deterministic lease behavior and
  making the next authoritative read depend on whether the caller persisted
  the unchecked candidate.

### PF-S03-T03-R3 — combined reevaluation schedules future timers after expiry review is active

- Severity: **major**.
- Reproduction from current source: `evaluate_attempt` correctly returns no
  ownership timer once `expired` or `review_required` is true at
  `crates/domain/src/time_policy.rs:382-390`. However,
  `evaluate_time_policy` independently appends schedule, retry, exception, and
  review timers at `:627-645` and does not suppress them when the returned
  attempt decision has `review_required=true`.
- A current `Expired`/`ExpiryPending` attempt with a future `not_before_at` or
  `retry_not_before` therefore produces a non-`None`
  `next_reevaluation_at`, even though expiry review must be resolved before
  any replacement eligibility can matter.
- The accepted transition fixture states that `next_status_change_at` is the
  next lease/budget/retry timer **or null when review is required**
  (`project/spec/transition-table.md:138-140`). The task's own timer invariant
  also promises no misleading timer once expiry/recovery review is active.
- The focused timer test covers an active, non-expired attempt and does not
  cover combined policy evaluation with an active expiry review.
- Impact: a scheduler or client can wake on a stale schedule/retry timer and
  present a false next action while the work remains fenced in `expired_review`.
  This does not authorize the old fence by itself, but it violates the leaf's
  next-reevaluation contract and can drive unsafe orchestration.

### PF-S03-T03-R4 — unvalidated restart does not fail closed for combined retry eligibility

- Severity: **major**.
- Reproduction from current source: `PolicyClock::resolve` marks an
  unvalidated restart as requiring reconciliation and `evaluate_time_policy`
  suppresses only `schedule.eligible` and all timers at
  `crates/domain/src/time_policy.rs:614-617` and `:627-628`. It still calls
  `evaluate_retry` at `:618`, leaving `RetryDecision.eligible=true` whenever
  the retry count is below the cap and `retry_not_before` is absent or passed
  at the conservative effective instant.
- The focused restart vector checks `evaluate_attempt` authority denial, not
  the combined decision's retry result. A caller consuming the public combined
  policy can therefore observe an unvalidated clock plus retry eligibility
  without a single fail-closed mutation/eligibility result.
- D21, the status/action contract, and the task's restart requirement require
  reconciliation before time-derived forward progress. The public combined
  policy should either suppress retry eligibility under clock reconciliation or
  expose and require a single authoritative denial that callers cannot omit.
- Impact: retry dispatch can be treated as eligible after an unvalidated clock
  restart unless every caller separately remembers to inspect `ClockView` or
  an attempt authority result.

## Review disposition

The four findings are within the PF-S03-T03 time-policy boundary and block a
leaf ACCEPT. They are not deferred or approved away. No production fix was
applied because the user explicitly limited this review to the four attempt-2
evidence files. The prior attempt-1 failures and limitations remain preserved
in their original directory.

## Scope limits

- The local Boreal review workflow, candidate query, and work-show query all
  returned typed `service_busy`; no candidate, reviewer gate, or coordinator
  state transition was fabricated.
- No `STATE.json`, source, test, contract, plan, database, service, native,
  publication, release, or prior evidence path was edited.
- This evidence does not accept or reject PF-S03 sprint/release gates. The
  named PF-S03-T90/T91/T92 chain remains required after corrective work.

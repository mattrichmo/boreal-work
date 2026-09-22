# PF-S03-T02 attempt 4 — independent re-review evidence

## Record and decision

- Task / attempt: `PF-S03-T02` / `attempt-4`.
- Acceptance contribution: `AC-08` only.
- Evidence class: independent current-source inspection plus fresh pure-domain
  focused, package, formatting, check, and strict-clippy verification.
- Reviewer: Codex (OpenAI), independent validation reviewer; not the attempt-3
  implementation worker.
- Decision: **accepted for PF-S03-T02 review scope**.
- Findings: **none remaining within this leaf after verification**.
- This is not a sprint, service, native, publication, or release decision.

## Prior rejected findings and verification

### `PF-S03-T02-R1` — terminal expiry retains both elapsed-clock reasons

Attempt-2 found that `AttemptPhase::Expired` was retained for
`ExpiredReview`, but `LeaseElapsed` and `HardBudgetElapsed` were collected only
from `live_attempt`, which excluded terminal expired attempts.

Current source inspection confirms the correction in
`crates/domain/src/status_evaluator.rs`:

- `attempt` retains `AttemptPhase::Expired` while filtering only historical
  failed/released/cancelled attempts from current eligibility.
- `expiry_pending` recognizes `ExpiryPending`, `Expired`, and the durable
  `review_required_after_expiry` flag.
- The retained `attempt` independently contributes `LeaseElapsed` and
  `HardBudgetElapsed` from its durable deadlines, even when the phase is
  terminal.
- `live_attempt` remains limited to active deadline scheduling and active-phase
  expiry calculation.

Fresh focused vector
`terminal_expiry_review_retains_elapsed_clocks_from_durable_deadlines` passed
with `Expired`, lease deadline `100`, hard deadline `200`, and `as_of=200`.
It observed `ExpiredReview`, primary `ExpiryReviewRequired`, action
`ReviewExpiry`, both `hard_budget_elapsed` and `lease_elapsed`, and the
operator hold. The live-at-deadline expiry/hold vector also passed.

### `PF-S03-T02-R2` — failed proof/rejected review cannot become Ready/Claim

Attempt-2 found that failed gate facts were interpreted only during a current
`Verifying`/`Completed` attempt, allowing no-current-attempt input to reach
`Ready`/`Claim`.

Current source inspection confirms the correction:

- Required failed review gates become hard `ReviewRejected` facts regardless of
  whether `current_attempt` is present.
- Required failed technical gates remain `GateFailed` proof facts regardless of
  whether `current_attempt` is present.
- With no current attempt, a required failed technical gate takes the
  `NeedsVerification` / `ProvideEvidence` branch.
- With no current attempt, a required failed review gate takes the
  `Blocked` / `ReviewRejected` / `ResolveHold` branch.
- Neither branch is claimable and neither returns `DomainAction::Claim`.

Fresh focused vector
`failed_proof_and_rejected_review_without_current_attempt_cannot_be_claimed`
passed both no-current-attempt cases. The active-attempt vector also continued
to distinguish failed technical proof, rejected review, and missing review.

## Precedence and reason-ordering verification

The focused target passed all eight prior/corrective vectors. In particular:

- paused status precedes an open prerequisite while retaining both reasons;
- expiry wins the hold tie and retains both elapsed clocks;
- terminal expiry preserves durable elapsed-clock reasons;
- hard-reason primary selection uses intervention priority rather than lexical
  ordering;
- equivalent fact permutations produce byte-equivalent decisions; and
- selected status branches retain their typed next actions.

The current implementation/test hashes match the attempt-3 evidence hashes.
All requested format, check, focused, full domain, and strict clippy commands
passed on the current dirty tree.

## Scope limits and non-findings

No service operation, database migration, application/store integration,
native package, publication, release command, or coordinator state mutation
was run. The `bwrk` workflow probe was typed `service_busy` and is recorded as
a read-only diagnostic only. Status/3 availability, integrity, submission
projection, and action-descriptor expansion remain outside this leaf's bounded
acceptance scope as identified by the task card and prior review.

No product code, product tests, contracts, `STATE.json`, prior evidence, or
unrelated paths were edited by this re-review.

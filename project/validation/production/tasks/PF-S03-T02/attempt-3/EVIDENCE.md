# PF-S03-T02 attempt 3 — corrective implementation evidence

## Record and disposition

- Task / attempt: `PF-S03-T02` / `attempt-3`.
- Evidence class: bounded domain implementation plus fresh pure-domain tests.
- Disposition requested: `ready_for_review`.
- Scope: PF-S03-T02 only. No sprint, service, native, publication, or release
  decision is made.
- Prior findings addressed: `PF-S03-T02-R1` and `PF-S03-T02-R2` from attempt 2.

## Source identities

| Path | SHA-256 |
| --- | --- |
| `crates/domain/src/status_evaluator.rs` | `a2bbe9d64569f1be5f34cc2ab1c51d62b1ad45e9a2141dca3727c23efc2afcac` |
| `crates/domain/tests/production_status_precedence.rs` | `d7da1c4c7e494cb0150bfe21c92b3fa1a8e7e1cbe8b17c996c6c31430b340c5c` |
| `crates/domain/src/lib.rs` (unchanged) | `6f75fcd37496dbff5bc0d5a51b593696781f47818a44edffcd8617d6ef4f78b2` |
| Input HEAD | `784a41b3802c29a76721c55eef2e9493283396c2` |

The final source is uncommitted on the input branch. The surrounding worktree
was already dirty; this attempt did not edit those unrelated paths.

## Finding R1 — expired expiry-review clocks

Before the correction, the evaluator retained `AttemptPhase::Expired` for the
`ExpiredReview` primary branch but collected `LeaseElapsed` and
`HardBudgetElapsed` only from `live_attempt`, which excludes terminal expired
records. The correction collects deadline facts from the retained non-historical
attempt, while keeping `AttemptActive` limited to active phases.

The new vector `terminal_expiry_review_retains_elapsed_clocks_from_durable_deadlines`
uses an `Expired` attempt with lease deadline `100`, hard deadline `200`, and
`as_of=200`. It observes:

- `display_status = ExpiredReview`;
- `primary_reason = ExpiryReviewRequired`;
- `next_action = ReviewExpiry`;
- secondary reasons include both `hard_budget_elapsed` and `lease_elapsed`;
- the operator hold remains present; and
- `next_status_change_at = None`.

The pre-existing live-at-deadline expiry/hold vector still passes and retains
its `attempt_active` reason.

## Finding R2 — proof/review failures without current attempt

Before the correction, failed gate facts were interpreted only in a current
`Verifying`/`Completed` attempt, allowing an absent `current_attempt` to reach
`Ready`/`Claim`. The evaluator now treats required failed technical gates as
durable verification facts and required failed review gates as existing hard
`ReviewRejected` intervention facts. Open gates remain limited to the existing
proof-phase behavior.

The new vector `failed_proof_and_rejected_review_without_current_attempt_cannot_be_claimed`
observes:

- failed required verification gate, no current attempt:
  `NeedsVerification`, `VerificationRequired`, `ProvideEvidence`, and
  `gate_failed(verification)`;
- failed required review gate, no current attempt:
  `Blocked`, `ReviewRejected("review")`, `ResolveHold`, and
  `review_rejected(review)`; and
- both decisions are not claimable and do not return `Claim`.

The existing active-attempt vector continues to distinguish failed technical
proof, rejected review, and missing review.

## Verification receipt

All required checks passed as recorded in `COMMANDS.md`:

- formatting: exit `0`;
- domain test compilation: exit `0`;
- focused production precedence: `8 passed, 0 failed`;
- full `boreal-domain`: `71 passed, 0 failed`, `0` doc tests; and
- strict all-targets clippy: exit `0`.

No schema, protocol, store, application, service, native, publication, or
release path was changed or exercised. The typed workflow diagnostics were
read-only and are not acceptance evidence.

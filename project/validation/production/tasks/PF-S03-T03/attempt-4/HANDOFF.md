# PF-S03-T03 attempt 4 — independent re-review handoff

## Identity and leaf-only disposition

- Task / plan / attempt: `PF-S03-T03` / production-completion plan /
  `attempt-4`.
- Reviewer: Codex (OpenAI), independent re-reviewer.
- Decision: **REJECT for the PF-S03-T03 leaf only**.
- No sprint, service, reconciliation, revalidation, native, publication, or
  release acceptance is claimed.
- Attempt-1 failures, attempt-2 rejection, and attempt-3 implementation
  evidence remain preserved in their original directories.

## What is accepted as evidence

The corrected `boreal_domain::time_policy` module is publicly registered at
`crates/domain/src/lib.rs:12`, its focused public-boundary target passes 16/16,
and the fresh exact-tree checks all pass:

- exact deadline equality and separate lease/hard-budget facts;
- earliest lease-trigger selection, retained phase-only trigger, and missing
  trigger failure in the new evaluator;
- zero/shortening rejection and hard-budget immutability in the new free
  renewal evaluator;
- expiry-review suppression of schedule/retry forward eligibility and all
  combined future timers;
- unvalidated-restart suppression of retry/schedule forward eligibility and
  timers;
- historical clock exclusion, due/overdue informational behavior,
  deterministic bounded retry, and validated restart behavior.

These are pure-domain observations only.

## Why the leaf remains rejected

The current public `Attempt` API in the shared `lib.rs` is still a second
authority:

1. `Attempt::expiry_reason` at lines 497–505 returns
   `HardBudgetElapsed` for every `ExpiryPending`/`Expired` phase and cannot
   retain a canonical trigger. Its `DeadlineView` exposes the result.
2. `Attempt::renew_lease` at lines 477–486 accepts `lease_ttl_ms=0` and
   candidates that shorten the existing lease. It preserves the hard deadline,
   but does not reject the invalid lease candidate.

Therefore the new module passes the four added fixtures while the public
domain surface still violates corrections 1 and 2. The attempt-4 blockers are
recorded as `PF-S03-T03-R5` and `PF-S03-T03-R6` in `EVIDENCE.md`; they are
leaf-scoped follow-up findings, not a new sprint or service judgment.

## Fresh validation receipts

| Check | Result |
| --- | --- |
| `cargo fmt --all -- --check` | pass, exit 0 |
| focused `production_time_policy` | 16 passed, exit 0 |
| full `cargo test --locked -p boreal-domain` | 103 passed, 0 failed; doc-tests 0/0, exit 0 |
| `cargo check --locked -p boreal-domain --tests` | pass, exit 0 |
| strict domain clippy | pass, exit 0 |
| `git diff --check` | pass, exit 0 |

The exact command lines, workflow limitation, source identities, contract
identities, and preserved failure history are in `COMMANDS.md`.

## Required next action

The domain steward/coordinator must reconcile the shared public API with the
canonical time-policy implementation, add public-boundary regressions for R5
and R6, preserve this rejection, and assign a fresh independent re-review. The
PF-S03-T90/T91/T92 chain remains required.

No source, prior evidence, plan ledger, or `STATE.json` was edited by this
review.


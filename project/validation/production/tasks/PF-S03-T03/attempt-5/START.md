# PF-S03-T03 attempt 5 — coordinator-integration evidence preparation

## Identity and decision boundary

- Task: `PF-S03-T03` — exact clock, schedule, retry, due, lease, hard-budget,
  expiry, and next-reevaluation predicates.
- Attempt: `attempt-5`.
- Worker role: bounded coordinator-integration evidence worker.
- Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Readback time: `2026-09-22T10:00:24Z` UTC.
- Worktree: dirty; 74 pre-existing `git status --porcelain=v1` entries before
  this evidence directory was created.

This attempt prepares exact-tree evidence after the attempt-4 independent
review rejected only the remaining public `Attempt` API divergence. It does
not accept the leaf, sprint, service, reconciliation, revalidation, native,
publication, or release scope. A fresh independent reviewer must inspect this
exact tree afterward.

## Attempt-4 rejection and coordinator correction

Attempt 4 recorded blockers `PF-S03-T03-R5` and `PF-S03-T03-R6`:

1. `Attempt::expiry_reason` in `crates/domain/src/lib.rs` manufactured
   `HardBudgetElapsed` for every `ExpiryPending`/`Expired` phase, including
   lease-only and phase-only cases.
2. `Attempt::renew_lease` accepted zero and shortening lease candidates even
   though `boreal_domain::time_policy::renew_lease` rejected them.

The coordinator’s current shared-boundary correction is present at
`crates/domain/src/lib.rs`:

- `Attempt::renew_lease` computes `at.checked_add(lease_ttl_ms)`, rejects a
  candidate `<= at` or `< self.lease_deadline`, returns
  `DomainError::InvalidLeaseRenewal`, and mutates the lease only after both
  guards pass.
- `Attempt::expiry_reason` no longer has a phase-only hard-budget shortcut;
  it now applies hard-budget precedence, then lease elapsed, otherwise
  `None`, matching the canonical deadline facts exposed by the public view.
- The typed `InvalidLeaseRenewal` error and its stable display code are
  integrated in the shared domain boundary.

The coordinator also added
`public_attempt_api_matches_canonical_expiry_and_renewal_guards` to
`crates/domain/tests/production_time_policy.rs`. It covers public lease-only
expiry, phase-only no-trigger behavior, zero/shortening rejection, and
non-mutation of the existing lease deadline. The canonical
`crates/domain/src/time_policy.rs` implementation was read and revalidated;
it was not edited by this worker.

## Read set

The complete attempt-4 `START.md`, `COMMANDS.md`, `EVIDENCE.md`, and
`HANDOFF.md` were read and preserved. The current source and relevant plan and
contract context were read at this revision:

- `crates/domain/src/lib.rs`
- `crates/domain/src/time_policy.rs`
- `crates/domain/tests/production_time_policy.rs`
- `project/build-plan/production-completion/sprints/PF-S03/tasks/PF-S03-T03.md`
- `project/spec/production/contract-manifest.json`
- `project/spec/production/execution-submission-contract.md`
- `project/spec/production/status-and-actions.md`
- `project/spec/clock-and-attempt.json`
- `project/build-plan/production-completion/execution/STATE.json` (read-only)
- project README, build-plan README, master plan, PF-S03 sprint, startup,
  dispatch, and shared-file instructions.

The contract basis is the distinct renewable lease and immutable hard-budget
policy: equality at either deadline expires authority; a lease renewal cannot
move the hard deadline; phase-only expiry without a triggering deadline or
retained reason must fail closed.

## Write boundary

The only paths written by this worker are:

- `project/validation/production/tasks/PF-S03-T03/attempt-5/START.md`
- `project/validation/production/tasks/PF-S03-T03/attempt-5/COMMANDS.md`
- `project/validation/production/tasks/PF-S03-T03/attempt-5/EVIDENCE.md`
- `project/validation/production/tasks/PF-S03-T03/attempt-5/HANDOFF.md`

No production source, test source, prior attempt, plan ledger, or `STATE.json`
was edited. The existing coordinator changes were inspected in place.

## Workflow limitation

Read-only Boreal context/workflow calls were attempted, but the local
database owner returned typed `service_busy` for workflow resolution. The
initial `bwrk prime --json` call also returned typed `invalid_argument` because
the project identifier was not supplied. No lock was broken and no claim,
review, acceptance, or other lifecycle transition was attempted. This is
file-based evidence preparation only.

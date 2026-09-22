# PF-S03-T03 attempt 4 — independent re-review start

## Scope and decision boundary

- Task: `PF-S03-T03` — exact clock, schedule, retry, due, lease,
  hard-budget, expiry, and next-reevaluation predicates.
- Attempt: `attempt-4`, independent re-review of the corrected attempt-3 leaf.
- Reviewer: Codex (OpenAI), independent of the attempt-3 implementation.
- Review scope: the corrected time-policy leaf only. No sprint, service,
  reconciliation, revalidation, native, publication, or release acceptance is
  made here.
- Review start/readback time: `2026-09-22T09:50:44Z` UTC baseline.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- Worktree: dirty; `git status --porcelain=v1` reported 74 entries. Existing
  changes were preserved.

## Write boundary

The only files written by this review are:

- `project/validation/production/tasks/PF-S03-T03/attempt-4/START.md`
- `project/validation/production/tasks/PF-S03-T03/attempt-4/COMMANDS.md`
- `project/validation/production/tasks/PF-S03-T03/attempt-4/EVIDENCE.md`
- `project/validation/production/tasks/PF-S03-T03/attempt-4/HANDOFF.md`

No source file, prior attempt, plan ledger, or `STATE.json` was edited.

## Evidence loaded

I read the attempt-2 rejection and the complete attempt-3
`START.md`/`COMMANDS.md`/`EVIDENCE.md`/`HANDOFF.md`, then inspected the
current public boundary and contracts:

- `crates/domain/src/time_policy.rs`
- `crates/domain/tests/production_time_policy.rs`
- `crates/domain/src/lib.rs`
- `project/STATUS_MODEL.md`
- `project/spec/transition-table.md`
- `project/spec/production/status-and-actions.md`
- `project/spec/production/execution-submission-contract.md`
- `project/build-plan/production-completion/sprints/PF-S03/tasks/PF-S03-T03.md`

The attempt-2 rejection and all earlier implementation/test failures remain
historical evidence. They are not overwritten or relabelled.

## Workflow limitation

The read-only Boreal review workflow resolver and project candidate/show
queries returned typed `service_busy` because the local database owner is
held by another process. No lock was broken and no lifecycle or coordinator
state transition was attempted. This file-based source review therefore does
not fabricate a workflow review receipt.

## Review focus

The review checks the four requested corrections at both the public
`boreal_domain::time_policy` module and the existing public `Attempt` API:

1. Lease-only expiry reason, retained canonical trigger, and fail-closed
   phase-only expiry.
2. Renewal rejection of zero/shortening candidates with an immutable hard
   budget.
3. Expiry-review suppression of forward eligibility and misleading timers.
4. Unvalidated-restart suppression of retry/forward eligibility.


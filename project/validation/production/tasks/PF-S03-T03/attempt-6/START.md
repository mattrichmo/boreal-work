# PF-S03-T03 attempt 6 — independent review start

## Scope and decision boundary

- Task: `PF-S03-T03` — exact clock, schedule, retry, due, lease,
  hard-budget, expiry, and next-reevaluation predicates.
- Attempt: `attempt-6`, fresh independent review of the coordinator-integrated
  attempt-5 tree.
- Reviewer: `independent-validation:01a0c894-8cd8-73a0-b5b1-bf384b6d9ffb`,
  independent of the attempt-5 coordinator worker.
- Review start/readback: `2026-09-22T10:10:04Z` UTC baseline.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- Worktree: dirty; `git status --porcelain=v1` reported 74 entries before
  this attempt directory was created.
- Decision scope: the bounded PF-S03-T03 leaf only. No sprint, service,
  reconciliation, PF-S03-T90/T91/T92, native, publication, or release
  acceptance is decided here.

## Review write boundary

The only paths written by this review are:

- `project/validation/production/tasks/PF-S03-T03/attempt-6/START.md`
- `project/validation/production/tasks/PF-S03-T03/attempt-6/COMMANDS.md`
- `project/validation/production/tasks/PF-S03-T03/attempt-6/EVIDENCE.md`
- `project/validation/production/tasks/PF-S03-T03/attempt-6/HANDOFF.md`

Production source, prior attempts, the plan ledger, and
`project/build-plan/production-completion/execution/STATE.json` are
read-only. No source or `STATE.json` change is made by this review.

## History and read set

The complete attempt-1 through attempt-5 evidence was read and preserved,
including the attempt-4 rejection and all attempt-5
`START.md`/`COMMANDS.md`/`EVIDENCE.md`/`HANDOFF.md` records. The current
review also read:

- `crates/domain/src/lib.rs`
- `crates/domain/src/time_policy.rs`
- `crates/domain/tests/production_time_policy.rs`
- `project/STATUS_MODEL.md`
- `project/spec/transition-table.md`
- `project/spec/production/status-and-actions.md`
- `project/spec/production/execution-submission-contract.md`
- `project/spec/clock-and-attempt.json`
- the PF-S03 sprint and PF-S03-T03 task card
- current `STATE.json` task history and assigned attempt-6 write path

The historical sequence is retained: attempt 1 recorded implementation and
combined-tree failures; attempt 2 rejected R1–R4; attempt 3 implemented those
corrections; attempt 4 rejected the remaining public-boundary R5/R6 divergence;
and attempt 5 recorded the coordinator-owned public fixes for fresh review.

## Review questions

1. Does the public `Attempt` API return factual `LeaseElapsed`/
   `HardBudgetElapsed` reasons and fail closed for phase-only deadlines without
   a retained trigger?
2. Does public lease renewal reject zero and shortening candidates without
   moving the immutable hard deadline?
3. Does combined `time_policy` suppress forward eligibility and future timers
   during expiry review and unvalidated restart reconciliation?
4. Do the requested exact-tree validation commands pass on this dirty combined
   source identity?

## Workflow read-only limitation

The repository root has no project-level `boreal.yaml`; the review skill’s
workflow descriptor is present at `.agents/skills/boreal-review/boreal.yaml`.
The required read-only workflow/candidate/show probes returned typed
`service_busy` because the local Boreal database is owned by another process.
No lock was broken and no claim, review, acceptance, or coordinator mutation
was attempted. This review therefore records a file/source/test decision and
does not fabricate a live workflow receipt.

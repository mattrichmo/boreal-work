# M01 agent dispatch and handoff

This is the copy-ready assignment contract for the
[master plan](MASTER_PLAN.md). It is file-based; **do not run `bwrk`** to
claim, close, or update this plan. The coordinator assigns a single P-task
from a sprint file, controls shared writes, and records evidence after review.
Agents cannot close their own task or advance a sprint by editing a checkbox.

## Before dispatching one agent

The coordinator checks the task-index prerequisites and sprint entry gate,
then sends a filled packet. One agent gets one leaf ID and exclusive paths.
For parallel implementation, use isolated worktrees where practical. If a
shared worktree is unavoidable, assign exclusive file ownership and run a
combined integration check after merges. Only the integration owner edits
workspace manifests, protocol/schema contracts, shared migrations, and the
sprint dispatch ledger. A task waiting on a prerequisite is `queued`; a
decision, integrity, or failed-gate issue is `blocked` with named owner.

```md
Milestone: M01
Sprint / task ID and title:
Coordinator / implementer / independent reviewer:
State: ready | claimed | in_progress | needs_review | blocked | complete | closed
Claimed at / review deadline (UTC):
Input Git commit and dirty-path manifest:
Prerequisite IDs and accepted gate/evidence links:
Owned paths (exclusive):
Read-only reference paths:
Excluded paths and forbidden actions:
Contract versions and required decisions:
Implementation objective and user-visible invariant:
Legacy parity: keep | rework | defer, with fixture:
Acceptance criteria and exact evidence:
Focused commands and expected results:
Combined/integration commands and validation profile:
Failure/race/clock cases to cover:
Schema, protocol, migration, and documentation impact:
Review task and findings location:
Reconciliation task and revalidation gate:
Next task unlocked if accepted:
```

The timebox in this Markdown dispatch packet is a coordination deadline,
not an automated lease or the v2 engine's approved two-hour default hard
claim deadline (D27). When the coordination timebox
elapses, the coordinator asks for a checkpoint, confirms the process and
worktree state, records `expired_review`, and only then reassigns. Do not
force-break live locks, erase failed work, or treat silence as proof that an
agent stopped. A claimed task is not productive until the runtime/test output
or a meaningful checkpoint establishes progress.

## Agent start checklist

1. Read [v2 contributor instructions](AGENTS.md),
   [project packet](project/README.md), the assigned sprint's `SPRINT.md`,
   its [vertical handoff](project/build-plan/verticals/), and the exact
   [task-index row](project/build-plan/TASK_INDEX.md). The scaffold is not a
   complete product. Do not import legacy packages or mutate legacy state.
2. Confirm the input commit/dirty manifest and exclusive write set. If
   another agent already owns a target, stop and ask the coordinator for a
   seam; do not silently edit their files.
3. Implement the smallest coherent slice, with negative/fault tests for the
   task's invariant. Keep application/domain enforcement out of CLI and TUI.
   Test receipts must identify source/config/environment and scope.
4. Run focused checks, then a combined check appropriate to risk. Report
   unrun checks honestly. No passing prose or narrowed gate substitutes for
   required evidence. Findings-producing tests/reviews always feed the named
   reconciliation and revalidation tasks.
5. Return the exact completion report below. Leave the sprint ledger to the
   coordinator; an agent report means `reported`, not `closed`.

## Completion report (copy/paste)

```md
Task ID / input source snapshot:
Implemented behavior and preserved Boreal invariant:
Changed files (absolute or repo-relative):
Schema/protocol/CLI/migration changes:
Tests and commands: command, exit, counts, source snapshot, profile:
Negative/race/clock evidence:
Performance baseline and after, if relevant:
Review findings: ID, severity, reproduction, disposition or proposed owner:
Unresolved limitations and exact blocker:
Dirty paths or conflicting changes not owned by this task:
Recommended next leaf and why its prerequisites are/are not met:
```

Where the task's acceptance profile requires independent review, the reviewer
inspects the combined source, not just the worker's summary.
The coordinator records `fixed`, `no_change`, or approved `deferred` for every
finding, asks an independent validator to rerun affected checks, then marks
the leaf `closed` and releases its dependent leaves. Do not advance from a
review finding directly to the next sprint.

## First dispatch, underway

The three initial packets were dispatched for draft/analysis work; their
current state is in the S00 ledger. The packets are in
[S00](milestones/M01-v2-product/sprints/S00-contracts/SPRINT.md): P0-01
policy/contract steward (owner choices now approved), P0-02
baseline analyst, and P0-04 legacy mapper. They have disjoint write sets.
P0-03 is ready for assignment now that P0-01 choices D13–D29 are approved.
P1 starts only after P0-05 review,
P0-06 reconciliation, and P0-07 independent revalidation.

### Copy-ready first-wave packets

**P0-01 — architecture steward.** Read `MASTER_PLAN.md`, S00, `AGENTS.md`,
`project/DECISIONS.md`, `project/STATUS_MODEL.md`, and the P0 vertical handoff.
Own only `project/DECISIONS.md` and decision drafts under `project/spec/**`.
Draft explicit alternatives/recommendations for host/service/memory authority,
roles, proof policy, close-only dependency satisfaction, TTL versus hard
attempt budget, and durable close intent. Document the choices that required
owner approval; the owner choices D13–D29 are now approved, so P0-03 may
freeze schema and CLI grammar against them.
Return decision IDs, affected contracts, proposed fixtures, and unresolved
blockers. No `bwrk` mutation.

**P0-02 — baseline analyst.** Read S00, `project/AUDIT_BASELINE.md`, and the
P0 vertical handoff. Own only `project/build-plan/baseline/**`. Build a
reproduction matrix for lock contention, status payloads, expiry/reaper,
lifecycle drift, evidence/gate wording, repair, and no-goal finish churn on a
safe pinned fixture. Record timings/bytes or `unmeasured` with reason. Do
not modify v1 state, break locks, install/update toolchains, or infer a
root cause from the transcript alone. Return commands, source/tool identity,
measurements, and limits.

**P0-04 — legacy mapper.** Read S00, `project/CLI_COMMANDS.md`,
`project/WORKFLOW_PARITY.md`, `project/STATUS_MODEL.md`, and the P0 vertical
handoff. Own only `project/legacy-map/**` and migration-only fixtures.
Map every v1 status/reservation/dependency/evidence/summary and high-value
CLI/memory/guide workflow to keep/rework/defer/historical-only/unsupported;
flag `verified`/`cancelled` edges, stale expiry, ambiguous records, and
loss risks. No `bwrk` mutation. Return a fixture manifest and unresolved
questions for P0-05 review.

The coordinator supplies a source snapshot, deadline, and independent
reviewer name when dispatching each packet, then updates the S00 ledger.
The assignments above are underway; no task is closed by dispatch alone.

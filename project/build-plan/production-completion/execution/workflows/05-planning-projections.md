# Workflow 05 — milestones, cycles, dependencies, projections, and queues

## Scope

- PF-S09 — Milestones, cycle-backed sprints and dependency planning
- PF-S10 — Exact projections, launch readiness and actionable queues

## Entry and exit

- PF-S09 may begin after PF-S02, PF-S03, and PF-S04 gates.
- PF-S10 begins after PF-S08 and PF-S09 gates.
- Each sprint requires its own independent review, reconciliation, and
  revalidation before the next join.

## Worker boundary

- [ ] Keep milestone outcome/decomposition separate from cycle scheduling and
      assignment history.
- [ ] Preserve task identity across cycle carry-over.
- [ ] Support multiple cycles, parallel work, cross-cycle dependencies, and one
      live assignment rule without creating duplicate authorities.
- [ ] Validate parentage, dependency cycles, missing requirements, profile
      versions, assignment conflicts, and launch readiness transactionally.
- [ ] Treat projections, totals, queues, and rollups as rebuildable derived
      data with explicit incomplete/corrupt diagnostics.
- [ ] Display queued dependency reasons without conflating them with hard
      intervention blocks.

## Parallelization

PF-S09 can run alongside PF-S05 after PF-S04 in a separate worktree. PF-S10
waits for PF-S08 and PF-S09. Shared service/protocol changes are submitted to
the service steward.

## Handoff checklist

- [ ] Two parallel cycles with dependent tasks are covered.
- [ ] Carry-over, cancellation, reopen, and replacement preserve history.
- [ ] Rollups identify accepted work and reconciled scope separately.
- [ ] Invalid/corrupt descendants do not fabricate healthy totals.
- [ ] Queue explanations identify upstream subjects and next safe actions.

---
id: boreal.workflow.closeout-work.v1
title: Closeout Work
group: 40-work
status: v1
risk: medium
writes_state: true
requires_workspace: true
allowed_commands:
  - work show
  - dep tree
  - summary compose
  - summary create
  - summary show
  - evidence add
  - work verify
  - work close
  - sprint show
  - sprint metrics
  - sprint report
  - sprint close
  - session end
  - sync status
  - doctor
  - sync refresh
  - gate closeout
templates:
  - verification-note
  - session-closeout
---

# Closeout Work

## Purpose

Close completed work with evidence, verification, and next-action capture.

## When To Use

Use this workflow when the user's request requires close completed work with evidence, verification, and next-action capture. Do not use it for adjacent work when a narrower workflow exists.

## Inputs Required

- Current project root or explicit `--workspace`.
- Actor or agent ID when the workflow writes state.
- Relevant labels, work IDs, source IDs, or session ID if the user supplied them.
- Clear statement of whether the workflow may mutate memory or work records.

## Safety Constraints

- Never read or write a sibling repository's memory unless the user explicitly names that repository and workspace.
- Run read-only retrieval before creating or updating records.
- Prefer source-backed claims, decisions, and wiki edits.
- Use `--json` for commands that feed later automation.
- Stop and ask when candidate records conflict or the workflow would overwrite user-authored truth.

## Steps

1. Confirm the workspace with `bwrk prime --json` or `bwrk sync status --json`.
2. Gather current context using only the allowed commands listed in frontmatter.
3. Execute the smallest state-changing command set required by the user request.
4. Attach evidence or source references for any durable claim, decision, or closed work.
5. Rebuild derived artifacts when the workflow changes memory, context, or search.
6. Run `bwrk doctor --strict --json` unless the workflow is explicitly read-only and no generated artifacts changed.

## Command Sequences

Use manual closeout only for work that was completed outside the active-reservation path or needs extra evidence.

1. Inspect the target first:
   `bwrk work show <work-id> --json`
2. Before closeout, run `workflows/40-work/checkpoint-git-state.md` when the work changed repository state. Capture commit SHA(s) or a reason code.
3. Attach evidence with a supported kind:
   `bwrk evidence add <work-id> --summary "<summary>" --kind command --command "<command>" --outcome passed --json`
4. Capture the evidence ID from `data.meta.id`.
5. Verify with that exact evidence ID:
   `bwrk work verify <work-id> --evidence <evidence-id> --verdict passed --notes "<notes>" --json`
6. Compose or reference the required agent summary before close. Include Git checkpoint SHA(s) or dirty-path notes from `workflows/40-work/checkpoint-git-state.md`:
   `bwrk summary compose <work-id> --commit <sha> --json`
7. Close only after passed verification and summary availability:
   `bwrk work close <work-id> --reason "<reason>" --agent-summary <summary-id> --json`

For sprint or parent-gate closeout:

1. Inspect the parent and child state:
   `bwrk sprint show <sprint-id> --json`
   `bwrk sprint metrics <sprint-id> --closeout-reason "<reason>" --json`
2. Confirm every child task is closed, cancelled, or explicitly deferred into later work with a reason.
3. Run the Git checkpoint workflow for the sprint, phase, milestone, or project before closing the parent.
4. Record final sync and doctor evidence on the sprint or parent work item:
   `bwrk evidence add <sprint-id> --summary "sync closeout passed" --kind command --command "bwrk sync refresh --json" --outcome passed --json`
   `bwrk evidence add <sprint-id> --summary "doctor closeout passed" --kind command --command "bwrk doctor --strict --json" --outcome passed --json`
5. Generate the sprint report when closing a sprint:
   `bwrk sprint report <sprint-id> --doctor-evidence <doctor-evidence-id> --sync-evidence <sync-evidence-id> --json`
6. Compose the sprint rollup summary from child summaries, final evidence, and checkpoint SHA(s):
   `bwrk summary compose <sprint-id> --commit <sha> --json`
7. Close the sprint only after passed verification, checkpoint evidence, and summary availability:
   `bwrk sprint close <sprint-id> --reason "<reason>" --agent-summary <summary-id> --json`


## CLI Commands

- `bwrk work show`
- `bwrk dep tree`
- `bwrk summary compose`
- `bwrk summary create`
- `bwrk summary show`
- `bwrk evidence add`
- `bwrk work verify`
- `bwrk work close`
- `bwrk sprint show`
- `bwrk sprint metrics`
- `bwrk sprint report`
- `bwrk sprint close`
- `bwrk session end`
- `bwrk sync status`
- `bwrk doctor`
- `bwrk sync refresh`
- `bwrk gate closeout`

## Evidence And Checkpoints

- Record command/test/diff evidence before verification or closeout.
- Keep raw source material immutable; reconcile into wiki, claims, decisions, or work instead of rewriting raw records.
- For work changes, confirm dependency and readiness state after mutation.
- For repository changes, attach Git checkpoint evidence or a no-commit reason code before closing task, sprint, phase, or milestone work.
- Every work, sprint, phase, milestone, or project close must have a final or forced agent summary record. Forced summaries require both a reason code and a human comment.
- For sprint and milestone closeout, include per-child status, evidence, verification, commit, and deferral state in the user-facing summary.

## Required User Closeout Summary

End the workflow with a granular closeout summary:

- Parent scope: work ID, sprint ID, phase ID, milestone ID, or project scope.
- Child breakdown: each child task or sprint with status, outcome, evidence ID(s), verification ID(s), and close/defer reason.
- Agent summaries: parent summary ID/artifact, child summary IDs, and forced summary reason/comment when applicable.
- Git checkpoints: commit SHA(s) per Git root, or reason code(s) for children that legitimately did not commit.
- Validation: commands run, gate status, and any non-blocking Git caveats.
- Remaining state: carryover, unresolved blockers, out-of-scope dirty paths, and next workflow.

## Failure And Repair

- If workspace health fails, switch to `workflows/60-health/sync-and-doctor.md`.
- If generated artifacts are stale, run `bwrk sync refresh --json` after memory, work, context, or search-affecting changes.
- If locks are stale, inspect before breaking them.

## Finish Criteria

- The requested outcome is represented in Boreal records or the workflow has returned a clear read-only answer.
- Any new or updated durable memory has source/evidence support.
- Any repository state change has checkpoint evidence or an explicit reason code before close.
- Every closed item has a final or forced agent summary record, and forced records include a reason code and comment.
- Sprint, phase, milestone, and project closeouts include a child-by-child user summary.
- `bwrk doctor --strict --json` passes or the remaining diagnostic is explicitly reported.

## Next Suggested Workflow

- Use `workflows/50-handoff/session-closeout.md` after long agent sessions.
- Use `workflows/40-work/checkpoint-git-state.md` before closing work that changed repository state.
- Use `workflows/60-health/sync-and-doctor.md` when state, ledger, or generated-artifact health is uncertain.

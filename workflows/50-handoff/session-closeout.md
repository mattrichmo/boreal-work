---
id: boreal.workflow.session-closeout.v1
title: Session Closeout
group: 50-handoff
status: v1
risk: medium
writes_state: true
requires_workspace: true
allowed_commands:
  - session end
  - operation list
  - reservation list
  - work list
  - sprint list
  - sprint show
  - summary list
  - summary show
  - sync status
  - doctor
  - sync refresh
  - gate closeout
templates:
  - session-closeout
---

# Session Closeout

## Purpose

Summarize a session, active reservations, failures, and next actions.

## When To Use

Use this workflow when the user's request requires summarize a session, active reservations, failures, and next actions. Do not use it for adjacent work when a narrower workflow exists.

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
7. When work was finished or closed, summarize completed work by task, sprint, phase, or milestone and include Git checkpoint commit(s) or reason code(s) from `workflows/40-work/checkpoint-git-state.md`.
8. Include the agent summary hierarchy: parent summary ID, child summary IDs, artifact URI(s), and any forced summary reason/comment.



## CLI Commands

- `bwrk session end`
- `bwrk operation list`
- `bwrk reservation list`
- `bwrk work list`
- `bwrk sprint list`
- `bwrk sprint show`
- `bwrk summary list`
- `bwrk summary show`
- `bwrk sync status`
- `bwrk doctor`
- `bwrk sync refresh`
- `bwrk gate closeout`

## Evidence And Checkpoints

- Record command/test/diff evidence before verification or closeout.
- Keep raw source material immutable; reconcile into wiki, claims, decisions, or work instead of rewriting raw records.
- For work changes, confirm dependency and readiness state after mutation.
- When summarizing sync health, inspect `sync.git.findings`. Report non-blocking Git findings as caveats by category, and reserve "unhealthy" language for `sync.ok=false` or `git.ok=false`.
- When summarizing completed work, include child task status, evidence, verification, commit SHA(s), and reason code(s); do not collapse a sprint or milestone into a single narrative sentence.
- Include agent summary record IDs and artifact URI(s) for every closed work item or sprint discussed in the handoff.
- Report every remaining dirty path as committed, ignored/generated, out of scope, or blocked.

## Failure And Repair

- If workspace health fails, switch to `workflows/60-health/sync-and-doctor.md`.
- If generated artifacts are stale, run `bwrk sync refresh --json` after memory, work, context, or search-affecting changes.
- If locks are stale, inspect before breaking them.
- For Git findings, follow the structured `recommendedActions`; do not tell the user to branch, add, or commit unless the finding action says that is needed.

## Finish Criteria

- The requested outcome is represented in Boreal records or the workflow has returned a clear read-only answer.
- Any new or updated durable memory has source/evidence support.
- Finished work is summarized with per-task/per-sprint outcomes, agent summary IDs/artifacts, and Git checkpoint commits or reason codes.
- `bwrk doctor --strict --json` passes or the remaining diagnostic is explicitly reported.

## Next Suggested Workflow

- Use `workflows/50-handoff/session-closeout.md` after long agent sessions.
- Use `workflows/40-work/checkpoint-git-state.md` when finished work changed repository state but has no checkpoint evidence yet.
- Use `workflows/60-health/sync-and-doctor.md` when state, ledger, or generated-artifact health is uncertain.

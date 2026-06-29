---
id: boreal.workflow.launch-sprint.v1
title: Launch Sprint
group: 40-work
status: v1
risk: medium
writes_state: true
requires_workspace: true
allowed_commands:
  - session start
  - prime
  - work create
  - dep add
  - work ready
  - doctor
  - sync refresh
templates:
  - sprint-plan
  - work-structure
---

# Launch Sprint

## Purpose

Create a scoped sprint with tasks, dependencies, gates, and session context.

## When To Use

Use this workflow when the user's request requires create a scoped sprint with tasks, dependencies, gates, and session context. Do not use it for adjacent work when a narrower workflow exists.

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

Use a sprint record as the container, attach ready leaf work beneath it, and define Git checkpoint boundaries before implementation starts.

1. Start or inspect the session:
   `bwrk session start --agent <agent-id> --json`
   `bwrk prime --agent <agent-id> --label <label> --json`
2. Create the sprint container:
   `bwrk work create "Sprint: <name>" --kind sprint --label sprint --label <label> --acceptance "<sprint gate>" --json`
3. Capture the sprint ID from `data.meta.id`.
4. Create each sprint task with acceptance criteria:
   `bwrk work create "<task title>" --kind task --priority normal --label <label> --acceptance "<criterion>" --json`
5. For each task, phase, or milestone that can change repository state, include acceptance language requiring a scoped Git checkpoint or explicit no-commit reason code before closeout.
6. Attach each task to the sprint and encode blockers:
   `bwrk dep add <sprint-id> <task-id> --json`
   `bwrk dep add <blocked-task-id> <blocker-task-id> --json`
7. Mark only unblocked sprint tasks ready:
   `bwrk work ready <task-id> --json`
8. Verify launch shape:
   `bwrk dep tree <sprint-id> --json`
   `bwrk doctor --strict --json`


## CLI Commands

- `bwrk session start`
- `bwrk prime`
- `bwrk work create`
- `bwrk dep add`
- `bwrk work ready`
- `bwrk doctor`
- `bwrk sync refresh`

## Evidence And Checkpoints

- Record command/test/diff evidence before verification or closeout.
- Keep raw source material immutable; reconcile into wiki, claims, decisions, or work instead of rewriting raw records.
- For work changes, confirm dependency and readiness state after mutation.
- At launch, inspect `sync.git.findings` and separate non-blocking protected-branch/generated-artifact caveats from blocking Git findings before deciding whether the sprint can start.
- Plan commit checkpoints as part of the sprint structure. Major refactors should be split into task, phase, or subsystem checkpoints rather than one final sprint-sized commit.
- Sprint acceptance should require a final closeout summary with per-task outcomes, evidence, verification, commit SHA(s), and reason code(s).

## Failure And Repair

- If workspace health fails, switch to `workflows/60-health/sync-and-doctor.md`.
- If generated artifacts are stale, run `bwrk sync refresh --json` after memory, work, context, or search-affecting changes.
- If locks are stale, inspect before breaking them.
- Launch can continue with `git.ok=true` caveats; blocking Git findings require the recommended action or an explicit handoff note.

## Finish Criteria

- The requested outcome is represented in Boreal records or the workflow has returned a clear read-only answer.
- Any new or updated durable memory has source/evidence support.
- The sprint plan identifies checkpoint boundaries for task, phase, sprint, or milestone closeout.
- `bwrk doctor --strict --json` passes or the remaining diagnostic is explicitly reported.

## Next Suggested Workflow

- Use `workflows/50-handoff/session-closeout.md` after long agent sessions.
- Use `workflows/40-work/checkpoint-git-state.md` when a sprint task, phase, or milestone reaches a commit boundary.
- Use `workflows/60-health/sync-and-doctor.md` when state, ledger, or generated-artifact health is uncertain.

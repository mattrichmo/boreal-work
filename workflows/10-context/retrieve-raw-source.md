---
id: boreal.workflow.retrieve-raw-source.v1
title: Retrieve Raw Source
group: 10-context
status: v1
risk: low
writes_state: false
requires_workspace: true
allowed_commands:
  - vault status
  - source list
  - source show
  - search query
  - sync refresh
templates:
  - raw-source-summary
---

# Retrieve Raw Source

## Purpose

Find immutable raw/source material before summarizing or reconciling it.

## When To Use

Use this workflow when the user's request requires find immutable raw/source material before summarizing or reconciling it. Do not use it for adjacent work when a narrower workflow exists.

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



## CLI Commands

- `bwrk vault status`
- `bwrk source list`
- `bwrk source show`
- `bwrk search query`
- `bwrk sync refresh`

## Evidence And Checkpoints

- Record command/test/diff evidence before verification or closeout.
- Keep raw source material immutable; reconcile into wiki, claims, decisions, or work instead of rewriting raw records.
- For work changes, confirm dependency and readiness state after mutation.

## Failure And Repair

- If workspace health fails, switch to `workflows/60-health/sync-and-doctor.md`.
- If generated artifacts are stale, run `bwrk sync refresh --json` after memory, work, context, or search-affecting changes.
- If locks are stale, inspect before breaking them.

## Finish Criteria

- The requested outcome is represented in Boreal records or the workflow has returned a clear read-only answer.
- Any new or updated durable memory has source/evidence support.
- `bwrk doctor --strict --json` passes or the remaining diagnostic is explicitly reported.

## Next Suggested Workflow

- Use `workflows/50-handoff/session-closeout.md` after long agent sessions.
- Use `workflows/60-health/sync-and-doctor.md` when state, ledger, or generated-artifact health is uncertain.

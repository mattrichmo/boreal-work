---
id: boreal.workflow.update-wiki-page.v1
title: Update Wiki Page
group: 30-knowledge
status: v1
risk: medium
writes_state: true
requires_workspace: true
allowed_commands:
  - context search
  - search query
  - wiki create
  - claim create
  - decision create
  - doctor
templates:
  - wiki-page
  - memory-reconciliation
---

# Update Wiki Page

## Purpose

Update wiki truth after checking existing pages, source refs, and backlinks.

## When To Use

Use this workflow when the user's request requires update wiki truth after checking existing pages, source refs, and backlinks. Do not use it for adjacent work when a narrower workflow exists.

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

- `bwrk context search`
- `bwrk search query`
- `bwrk wiki create`
- `bwrk claim create`
- `bwrk decision create`
- `bwrk doctor`

## Evidence And Checkpoints

- Record command/test/diff evidence before verification or closeout.
- Keep raw source material immutable; reconcile into wiki, claims, decisions, or work instead of rewriting raw records.
- For work changes, confirm dependency and readiness state after mutation.

## Failure And Repair

- If workspace health fails, switch to `workflows/60-health/sync-and-doctor.md`.
- If search or context is stale, run `bwrk search index --json` and `bwrk context rebuild --json` after memory, work, context, or search-affecting changes.
- If locks are stale, inspect before breaking them.

## Finish Criteria

- The requested outcome is represented in Boreal records or the workflow has returned a clear read-only answer.
- Any new or updated durable memory has source/evidence support.
- `bwrk doctor --strict --json` passes or the remaining diagnostic is explicitly reported.

## Next Suggested Workflow

- Use `workflows/50-handoff/session-closeout.md` after long agent sessions.
- Use `workflows/60-health/sync-and-doctor.md` when state, ledger, or generated-artifact health is uncertain.

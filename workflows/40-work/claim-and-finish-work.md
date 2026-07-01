---
id: boreal.workflow.claim-and-finish-work.v1
title: Claim And Finish Work
group: 40-work
status: v1
risk: medium
writes_state: true
requires_workspace: true
allowed_commands:
  - agent start
  - work create
  - work claim
  - work edit
  - agent finish
  - summary compose
  - summary create
  - evidence add
  - work verify
  - work close
  - sync status
  - doctor
  - sync refresh
  - gate closeout
templates:
  - evidence-note
  - verification-note
  - session-closeout
---

# Claim And Finish Work

## Purpose

Claim work, gather evidence, verify, and close or release it safely.

## When To Use

Use this workflow when the user's request requires claim work, gather evidence, verify, and close or release it safely. Do not use it for adjacent work when a narrower workflow exists.

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

Prefer `agent finish` for normal reserved work closeout because it records evidence, verifies, closes or releases, and clears the active reservation in one transaction.

1. Start or resume work:
   `bwrk agent start --agent <agent-id> --purpose "<purpose>" --json`
   `bwrk work claim --label <label> --agent <agent-id> --purpose "<purpose>" --json`
2. Before closing, run `workflows/40-work/checkpoint-git-state.md` when the work changed code, docs, workflows, templates, tracker state, memory, generated collaboration artifacts, or any other repository state. Capture commit SHA(s) or a reason code.
3. Finish the single active reservation after implementation, verification, and any required Git checkpoint. Include commit SHA(s) and dirty-path notes so `agent finish --close` can generate the required agent summary record:
   `bwrk agent finish current --agent <agent-id> --summary "<implemented and tested>" --kind test --command "<verification command>" --verdict passed --close --reason "<close reason>" --commit <sha> --json`
   `bwrk agent finish current --agent <agent-id> --summary "<implemented and tested>" --kind test --command "<verification command>" --verdict passed --close --reason "<close reason>" --dirty-path "no_repo_changes: <why no commit was valid>" --json`
4. Use release instead of close when the work is verified but must remain open:
   `bwrk agent finish current --agent <agent-id> --summary "<partial verification>" --kind command --command "<verification command>" --verdict passed --release --json`
5. Use manual `evidence add`, `work verify`, and `work close` only when no active reservation exists or when attaching additional evidence after `agent finish`; run `summary compose` before or during that closeout so the `boreal.cli.work.close.v1` envelope includes `agentSummaries`. Use `--force-summary --force-reason <code> --force-comment "<why>"` only for audited bypasses such as duplicates or external closes.

For work that requires explicit review or audit:

1. Plan the gate when creating or editing the work:
   `bwrk work create "<title>" --required-gate review --required-gate audit --ready --json`
   `bwrk work edit <work-id> --required-gate review --required-gate audit:descendants --json`
2. Satisfy review or audit gates before closeout with subject-matched passed evidence:
   `bwrk evidence add <work-id> --summary "<reviewed scope and findings disposition>" --kind review --outcome passed --json`
   `bwrk evidence add <work-id> --summary "<audit findings absent, fixed, or deferred>" --kind command --command "<audit command>" --outcome passed --json`
3. Inspect `closeoutGateStatus` from `evidence add`, `work verify`, `summary compose`, or `summary show`. Do not close until required gates are `satisfied` or `forced`.
4. Force a gate only as an audited bypass on the planned gate itself:
   `bwrk work edit <work-id> --force-gate <gate-id|kind[:scope]> --force-gate-reason <code> --force-gate-comment "<why>" [--force-gate-evidence <evidence-id>] --json`
   `--force-summary` does not force review, audit, verification, or checkpoint gates.


## CLI Commands

- `bwrk agent start`
- `bwrk work create`
- `bwrk work claim`
- `bwrk work edit`
- `bwrk agent finish`
- `bwrk summary compose`
- `bwrk summary create`
- `bwrk evidence add`
- `bwrk work verify`
- `bwrk work close`
- `bwrk sync status`
- `bwrk doctor`
- `bwrk sync refresh`
- `bwrk gate closeout`

## Evidence And Checkpoints

- Record command/test/diff evidence before verification or closeout.
- Keep raw source material immutable; reconcile into wiki, claims, decisions, or work instead of rewriting raw records.
- For work changes, confirm dependency and readiness state after mutation.
- Before closeout, distinguish blocking Git findings from non-blocking caveats using `sync.git.findings`; protected-branch generated artifacts or memory-index changes do not by themselves make completed work unverified.
- Before `--close`, require a Git checkpoint commit or explicit reason code from `workflows/40-work/checkpoint-git-state.md` when repository state changed.
- Closing work must create or reference an agent summary record. If a normal summary cannot be produced, force the summary only with a reason code and human comment.

## Required User Closeout Summary

End the workflow with a granular closeout summary, not only a status sentence:

- Work item: ID, title, outcome, and close or release reason.
- Evidence and verification: evidence ID(s), verification ID(s), validation command(s), and result.
- Agent summary: summary ID(s), artifact URI(s), child summary links, and any forced summary reason/comment.
- Git checkpoint: commit SHA(s) per Git root, or reason code(s) when no commit was valid.
- Scope completed: files, modules, docs, tracker records, or external systems touched.
- Remaining state: unresolved risks, deferred work, out-of-scope dirty paths, and next workflow.

For sprint, phase, milestone, or multi-task work, group the summary by child task and include the parent sprint/phase/milestone status after each child line.

## Failure And Repair

- If workspace health fails, switch to `workflows/60-health/sync-and-doctor.md`.
- If generated artifacts are stale, run `bwrk sync refresh --json` after memory, work, context, or search-affecting changes.
- If locks are stale, inspect before breaking them.
- If a Git finding has `blocking: true`, report its category and recommended action before closing. If every Git finding is non-blocking, record it as a caveat only.

## Finish Criteria

- The requested outcome is represented in Boreal records or the workflow has returned a clear read-only answer.
- Any new or updated durable memory has source/evidence support.
- Any repository state change has a commit checkpoint or an explicit reason code attached to the closeout evidence.
- Closed work has a final or forced agent summary record linked to the closeout output.
- The final user response includes the required granular closeout summary.
- `bwrk doctor --strict --json` passes or the remaining diagnostic is explicitly reported.

## Next Suggested Workflow

- Use `workflows/50-handoff/session-closeout.md` after long agent sessions.
- Use `workflows/40-work/checkpoint-git-state.md` before closing work that changed repository state.
- Use `workflows/60-health/sync-and-doctor.md` when state, ledger, or generated-artifact health is uncertain.

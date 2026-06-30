---
id: boreal.workflow.checkpoint-git-state.v1
title: Checkpoint Git State
group: 40-work
status: v1
risk: medium
writes_state: true
requires_workspace: true
allowed_commands:
  - prime
  - sync status
  - sync refresh
  - doctor
  - gate closeout
  - work show
  - sprint show
  - sprint metrics
  - sprint report
  - summary compose
  - summary create
  - evidence add
  - docs check
  - schema validate
templates:
  - evidence-note
  - session-closeout
---

# Checkpoint Git State

## Purpose

Create a scoped Git checkpoint, or record an explicit reason code when no commit is valid, before closing task, sprint, phase, or milestone work.

## When To Use

Use this workflow after a coherent task, phase, sprint, milestone, or major refactor slice changes repository state and before the corresponding Boreal work is closed. Also use it whenever the user asks to stage, commit, push, checkpoint, or keep sprint work from collapsing into one final commit. Do not use it for read-only discovery unless the user asks for a Git state report.

## Inputs Required

- Current project root or explicit `--workspace`.
- Target work, sprint, phase, or milestone ID.
- Intended checkpoint scope: task, phase, sprint, milestone, or project.
- Explicit push intent if remote publication is expected.
- Reason code if no commit should be made.

## Safety Constraints

- Never read or write a sibling repository's memory unless the user explicitly names that repository and workspace.
- Never stage or commit a sibling repository unless the user explicitly names that repository.
- Inspect every in-scope Git root before staging; project and memory roots can be separate repositories.
- Stage explicit pathspecs by default. Use `git add -A` only after every dirty path in that Git root has been inspected and declared in scope.
- Do not use destructive Git commands such as reset, checkout, clean, rebase, or force-push unless the user explicitly requests them.
- Do not hide unrelated dirty state inside a sprint closeout. Report it as out of scope and leave it unstaged.
- Push only when the user requested push or the governing workflow explicitly requires publication.

## Steps

1. Confirm the workspace with `bwrk prime --json` or `bwrk sync status --json`.
2. Inspect the target work or sprint with `bwrk work show <work-id> --json` or `bwrk sprint show <sprint-id> --json`.
3. Inspect each in-scope Git root with `git status --short --branch`, then review changed paths with `git diff --name-status` and `git diff --stat`.
4. Run the relevant validation command(s) for the completed slice and `git diff --check` before staging.
5. Stage only the intended paths with `git add -- <path>...`; for separate memory repos, checkpoint the memory repo separately from the project repo.
6. Verify the staged set with `git diff --cached --name-status` and `git diff --cached --stat`.
7. Commit each in-scope Git root with a scoped message that names the task, sprint, phase, milestone, or work ID.
8. If no commit is valid, record one reason code from the list below and explain what evidence proves the closeout can continue.
9. After the checkpoint, run `bwrk sync refresh --json` and `bwrk doctor --strict --json`, or `bwrk gate closeout --json` when the parent workflow requires the full gate.
10. Attach checkpoint evidence to the work or sprint with `bwrk evidence add`, including commit SHA(s), reason code, validation commands, and any out-of-scope dirty paths.
11. Create or update the closeout agent summary with the checkpoint SHA(s), or include the no-commit reason code in `--dirty-path` / summary notes before parent closeout.

## Command Sequences

Use raw Git commands for repository mutations because Boreal validates workflow frontmatter against `bwrk` commands only.

1. Inspect:
   `git status --short --branch`
   `git diff --name-status`
   `git diff --stat`
2. Validate before staging:
   `git diff --check`
3. Stage narrowly:
   `git add -- <path>...`
4. Verify staged scope:
   `git diff --cached --name-status`
   `git diff --cached --stat`
5. Commit:
   `git commit -m "<scope>: <summary>"`
6. Verify after commit:
   `git status --short --branch`
   `git log --oneline --decorate -3`
7. Attach evidence:
   `bwrk evidence add <work-id> --summary "Git checkpoint: <sha-or-reason>" --kind command --command "<validation and git commands>" --outcome passed --json`
8. Link the checkpoint into the agent summary:
   `bwrk summary compose <work-id> --commit <sha> --dirty-path "<out-of-scope path classification>" --json`

For separate memory mode, run the memory commit first when memory changes are in scope, then run the project commit. Never stage child `memory/` contents into the project repository unless the project uses shared memory mode.

## Reason Codes

Use one of these reason codes when a closeout does not have an in-scope commit:

- `no_repo_changes`: the work changed no repository files.
- `read_only_or_audit_only`: the work was intentionally read-only.
- `user_requested_review_first`: the user asked to stop before commit.
- `external_system_only`: the work changed an external system but no repo state.
- `validation_blocked`: validation failed and the work must not be committed yet.
- `unrelated_dirty_state`: dirty files exist but are outside this work's scope.
- `git_unavailable`: Git cannot write or inspect the repository.
- `out_of_scope_repository`: the dirty repository is not part of the requested workspace.

## Commit Policy

- A task closeout that changed repository state must have a scoped commit or a reason code before the task is closed.
- A phase, sprint, or milestone closeout must have checkpoint commits for each coherent child slice, or reason codes for each child slice that legitimately did not commit.
- A major refactor must be split into reviewable checkpoint commits by task, subsystem, or phase before the parent sprint/milestone closes. A single omnibus commit is only valid when the final summary states why the change was inseparable.
- A final sprint closeout commit should contain only closeout artifacts, tracker/doc reconciliation, or report updates. It should not hide uncommitted implementation work from earlier tasks.
- The final user response must list commit SHA(s), reason code(s), validation commands, and any remaining uncommitted out-of-scope paths.

## CLI Commands

- `bwrk prime`
- `bwrk sync status`
- `bwrk sync refresh`
- `bwrk doctor`
- `bwrk gate closeout`
- `bwrk work show`
- `bwrk sprint show`
- `bwrk sprint metrics`
- `bwrk sprint report`
- `bwrk evidence add`
- `bwrk docs check`
- `bwrk schema validate`

## Evidence And Checkpoints

- Record commit SHA(s) or reason code(s) as evidence before parent work is closed.
- Include the staged path list and validation commands in the evidence summary or command field.
- Include commit SHA(s) or no-commit reason code(s) in the work or sprint agent summary before closeout.
- If any dirty path remains after the checkpoint, classify it as in scope, out of scope, ignored/generated, or blocked.
- For protected branches, use `sync.git.findings` to distinguish blocking Git failures from non-blocking collaboration caveats.

## Failure And Repair

- If Git inspection fails, report `git_unavailable` and switch to `workflows/60-health/sync-and-doctor.md` only when Boreal state health is also uncertain.
- If validation fails, do not commit; report `validation_blocked` and keep the work open or released.
- If unrelated dirty state exists, do not stage it; report `unrelated_dirty_state` with exact paths.
- If generated artifacts are stale after commit, run `bwrk sync refresh --json` and recheck.

## Finish Criteria

- The target task, sprint, phase, milestone, or project has a commit checkpoint or explicit reason code.
- The target closeout summary records the commit SHA(s), or records the reason code/comment explaining why no commit was valid.
- Every in-scope Git root has been inspected before and after staging or committing.
- The staged set was verified before commit.
- The final health gate passed or the remaining diagnostic is explicitly reported.
- Checkpoint evidence is attached to the relevant work or sprint when Boreal records are being closed.

## Next Suggested Workflow

- Use `workflows/40-work/claim-and-finish-work.md` or `workflows/40-work/closeout-work.md` after the checkpoint is recorded.
- Use `workflows/50-handoff/session-closeout.md` to hand back the commit/reason-code summary to the user.

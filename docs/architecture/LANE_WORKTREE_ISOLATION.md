# Lane Worktree Isolation

Parallel agent work must not happen directly on the same shared mutation surface. In Git-backed projects, that usually means the shared integration branch is a merge target only. Each lane, agent, or coherent work slice gets its own Git worktree and lane branch, then merges back through a serial integration gate.

## Problem

When multiple agents commit directly to one branch or mutate one checkout, every in-flight edit becomes everyone else's execution state. A slow or broken checkpoint can make the shared branch red for unrelated agents, bury earlier work under later commits, and leave validation commands running against another agent's uncommitted files.

## Policy

- Treat shared integration branches as protected merge targets for multi-agent work.
- Do not run state-changing agent work from the shared integration checkout once parallel lanes exist.
- Create one worktree per lane, agent, or coherent work item before files, workflow records, memory, or generated collaboration artifacts are mutated.
- Commit lane work only on the lane branch.
- Merge lane branches back to the integration branch one at a time after lane validation passes.
- Run the configured integration gate after each merge before the next lane merge.
- Record the merge target branch, lane branch, worktree path, base SHA, validation command, and commit SHA in Boreal evidence or the closeout summary.

## Naming

Use stable names that make ownership obvious:

```text
merge target: <integration-branch>
lane branch:  boreal/lane/<initiative>/<agent-or-lane>-<work-id>
worktree:     ../worktrees/<repo>/<agent-or-lane>
```

Bootstrap, seed, implementation, review, and hardening work all use the same lane pattern:

```text
boreal/lane/<initiative>/bootstrap-<work-id>
../worktrees/<repo>/bootstrap
```

## Setup Sequence

Run setup from a clean integration checkout:

```sh
git fetch origin
git switch <integration-branch>
git pull --ff-only origin <integration-branch>
git worktree add ../worktrees/<repo>/<agent-or-lane> -b boreal/lane/<initiative>/<agent-or-lane>-<work-id> origin/<integration-branch>
```

If the lane branch already exists, attach the worktree to it instead of creating a new branch:

```sh
git worktree add ../worktrees/<repo>/<agent-or-lane> boreal/lane/<initiative>/<agent-or-lane>-<work-id>
```

## Agent Session Contract

Before an agent claims or starts state-changing work, the workflow or operator must decide whether the current branch is a shared integration branch. If it is, the agent must move into its lane worktree first.

The `git.lane-worktree-required` directive represents this obligation. Its typed payload must include:

- `gitRoot`
- `mergeTargetBranch`
- `laneBranch`
- `worktreePath`

Recommended optional payload fields are `baseRef`, `baseSha`, `currentBranch`, `agentId`, `workId`, `reason`, and `recommendedCommands`.

## Merge-Back Gate

The coordinator, not the lane agent, owns integration merges:

```sh
git switch <integration-branch>
git pull --ff-only origin <integration-branch>
git merge --no-ff boreal/lane/<initiative>/<agent-or-lane>-<work-id>
<integration-gate-command>
git push origin <integration-branch>
```

If the integration gate fails after a merge, stop merging additional lanes. Fix or revert the merge in the integration checkout, then resume only after the integration branch is green.

## Workflow Implications

- `agent-session`: require lane worktree setup before state-changing work on shared branches.
- `launch-sprint`: assign lane branches and worktree paths when creating parallel work.
- `work parallel`: include lane branch and worktree setup commands in the queue payload when parallel agents are expected.
- `checkpoint-git-state`: checkpoint lane commits from the lane worktree; do not let a lane checkpoint write directly to the integration branch.
- `closeout-work`: require lane checkpoint evidence before closeout and integration merge evidence before parent sprint or milestone closeout.
- `session-closeout`: report lane branch, worktree path, merge target, commits, validation, and whether merge-back has happened.

## Finish Criteria

- No agent has uncommitted implementation or contract state in the shared integration checkout.
- Every active lane has a unique branch and worktree.
- Every closed lane has checkpoint evidence from its lane branch.
- The integration branch contains only serial merges, coordinator commits, or explicitly approved direct commits.
- The integration branch has passed its contract gate after the latest lane merge.

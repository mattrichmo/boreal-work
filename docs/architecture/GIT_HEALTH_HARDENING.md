# Git Health Hardening

Sprint 11 hardens the Git-facing health surface used by `bwrk sync status`, `bwrk sync refresh`, `bwrk prime`, agent protocol briefs, and `bwrk doctor`.

## Problem

Boreal previously treated any dirty collaboration path on `main`, `master`, `trunk`, or a detached HEAD as `git.ok=false`. That made a successful sync refresh look unhealthy when the remaining state was an expected collaboration caveat, such as untracked `.boreal/ledgers/`, generated runtime artifacts, or a changed `memory/raw/index.jsonl`.

## Call Sites

- `apps/cli/src/git-worktree.ts` is the single Git inspection boundary.
- `buildSyncStatus` in `apps/cli/src/commands.ts` includes the Git inspection in `sync status`.
- `sync refresh` rebuilds context, search, and ledgers, then returns the post-refresh `sync status`.
- `prime` and agent protocol briefs reduce sync status into `sync.gitOk` and recommended actions.
- `runDoctor` in `apps/cli/src/doctor.ts` reports the `git.worktree` diagnostic from the same inspection result.

## Classification Contract

`GitWorktreeInspection.ok` means no blocking Git finding is present. Non-blocking findings can still appear in `findings` and can still carry remediation hints.

| Class | Blocking | Typical action |
| --- | --- | --- |
| `protected_branch` | no | none |
| `dirty_generated_artifact` | no | `bwrk doctor --fix --json`; if already tracked, remove it from the index |
| `dirty_memory_index` | no | branch before committing if the change should persist |
| `dirty_collaboration_path` on a protected branch | no | branch before committing if the change should persist |
| `detached_head` with user collaboration changes | yes | create a branch |
| Git inspection failure | yes | inspect `git status` directly |

Sync and prime should not report the whole workspace unhealthy for non-blocking findings. Doctor reports the Git diagnostic as `ok` when every finding is non-blocking, so `doctor --strict` remains useful as a closeout gate.

## Artifact Policy

Project-local generated artifacts should be ignored by the project repository:

- `.boreal/ledgers/`
- `.boreal/runtime/`
- `.boreal/cache/`, `.boreal/tmp/`, `.boreal/results/`
- `.boreal/**/*.db`, `.boreal/**/*.db-*`
- `.agents/`, `.claude/`, and `dump/`

Memory-local generated artifacts should be ignored by the memory root:

- `memory/.boreal/db/`
- `memory/.boreal/cache/`
- `memory/.boreal/locks/`
- `memory/.boreal/tmp/`
- `memory/.boreal/results/`
- `memory/.boreal/**/*.db`, `memory/.boreal/**/*.db-*`

`memory/raw/index.jsonl` is a vault file, not a project-local runtime cache. In shared-memory layouts it can be tracked and locally modified; on a protected branch that is a non-blocking collaboration caveat, not a sync failure.

## Regression Matrix

The runtime CLI tests cover:

- Clean checkout after `sync refresh`.
- Protected `main` with untracked generated `.boreal/ledgers/`.
- Protected `main` with dirty `memory/` collaboration paths.
- Protected `main` with tracked `memory/raw/index.jsonl` changes.
- Strict doctor behavior for the non-blocking protected-branch cases.
- Feature branch behavior after switching off a protected branch.

Future matrix expansion should add child separate memory, sibling memory, and submodule memory fixture repositories around this same classification contract.

## Shared Integration Branches

Protected-branch caveats are not enough for parallel agent work. A branch can be clean and still be unsafe as a mutation workspace when it is acting as the shared merge target for multiple agents.

Use [Lane Worktree Isolation](LANE_WORKTREE_ISOLATION.md) for this mode:

- The shared integration branch remains the serial merge target.
- Each agent gets a lane branch and separate worktree.
- `sync.git.findings` can remain non-blocking while `agentDirectives` emits `git.lane-worktree-required` for state-changing work.
- Integration validation runs after each lane merge, not against another agent's uncommitted checkout state.

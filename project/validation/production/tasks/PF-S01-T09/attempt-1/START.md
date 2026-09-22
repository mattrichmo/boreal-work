# PF-S01-T09 attempt 1 — start record

Status: in progress; scope accepted, not blocked.

Started: 2026-09-22T04:42:14Z
Workspace: `/Users/cybertron/Code/boreal-work`
Input source revision: `784a41b3802c29a76721c55eef2e9493283396c2`
Task: `PF-S01-T09`

## Accepted scope and invariant

This attempt freezes one bounded security, resource, support, and release
acceptance contract for the intended local Boreal v2 product. The contract
must name supported target/install combinations, measurable budgets and a
repeatable benchmark protocol, source/process/path/secret/audit boundaries,
artifact and dependency trust rules, backup/restore/rollback identity rules,
nonwaivable integrity/isolation/authority failures, and exact evidence needed
for later acceptance.

Targets are contract policy, not evidence that the current product already
meets them. Historical probe output, fixture-only checks, and documentation
scaffolding remain labeled as such; this task does not claim product,
service, native-platform, backup/restore, or release validation.

## Prerequisites read

- `AGENTS.md`
- `project/build-plan/production-completion/execution/AGENT_START.md`
- `project/build-plan/production-completion/execution/PARALLEL_DISPATCH.md`
- `project/build-plan/production-completion/sprints/PF-S01/SPRINT.md`
- `project/build-plan/production-completion/sprints/PF-S01/tasks/PF-S01-T09.md`
- accepted task-level handoffs/evidence for `PF-S01-T01`, `PF-S01-T02`, and
  `PF-S01-T08`
- `project/spec/production/service-contract.md`
- `project/spec/production/compatibility-matrix.md`
- current `docs/RELEASE.md`, `docs/PACKAGING.md`,
  `docs/RELEASE_PERFORMANCE.md`, and `docs/SECURITY.md`
- current release workflow and packaging scripts

## Exclusive write boundary

Allowed product path:

- `project/spec/production/release-support-and-budgets.md`

Allowed evidence paths:

- `project/validation/production/tasks/PF-S01-T09/attempt-1/START.md`
- `project/validation/production/tasks/PF-S01-T09/attempt-1/COMMANDS.md`
- `project/validation/production/tasks/PF-S01-T09/attempt-1/EVIDENCE.md`
- `project/validation/production/tasks/PF-S01-T09/attempt-1/HANDOFF.md`

No shared manifest, decision, status, protocol, source, test, plan state, or
other path may be changed by this attempt. Existing unrelated worktree changes
are preserved.

## Verification strategy

1. Author the complete contract against the current release documents and
   accepted prerequisite contracts.
2. Run the repository contract validator and documentation/path checks against
   the actual changed files.
3. Record exact commands, working directory, revision, exit codes, and results
   in `COMMANDS.md` and `EVIDENCE.md`.
4. Report all native, multi-process, supported-platform, signing,
   backup/restore, and release checks as unrun unless directly executed with
   attributable artifacts; do not convert fixtures or historical notes into
   acceptance.

Independent PF-S01 review, reconciliation, revalidation, and coordinator
acceptance remain required after this handoff.

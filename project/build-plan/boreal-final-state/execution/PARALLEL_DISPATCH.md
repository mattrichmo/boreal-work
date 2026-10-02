# Parallel dispatch and integration

## Operating model

Each active leaf has one implementer and one isolated worktree based on its
recorded source snapshot. A sprint coordinator manages the dispatch queue and
names one integration steward for the sprint. The sprint's `T90` task integrates
accepted leaf work, runs the combined validation, and records the exact source
identity consumed by dependent sprints.

An agent receives one task at a time. Task ownership is the exact write boundary
in that task packet; lane labels and stream tables are scheduling hints and
never grant extra paths. Worktree isolation and the Boreal attempt fence are
separate controls: use both, preserve both, and report their identities in the
handoff.

## Dispatch checks

Before starting an agent, the coordinator confirms all of the following:

1. Explicit task prerequisites and sprint entry conditions are satisfied.
2. The input source snapshot and project revision are recorded and available.
3. The task has one implementer, one isolated worktree, and a precise write set.
4. The worker has the required toolchain, external capability, and authority.
5. The task's full write set has no active conflict with another assignment.
6. Any required shared-file steward and integration reviewer are identified.

Graph readiness answers only whether dependencies are satisfied. It does not
grant permission to claim, write, publish, or skip a required gate. A task that
fails one of these checks stays undispatched with the specific missing condition
recorded.

## File conflict and ownership rules

- A file is the smallest write-lock unit. Different line ranges in one file do
  not permit concurrent edits.
- A directory write boundary conflicts with every assigned file or directory
  below it unless the coordinator records a narrower boundary with explicit
  exclusions.
- Compare every task's exact paths, including generated files, tests, fixtures,
  registries, and documentation. Different paths can still share a schema,
  protocol, API, migration order, or behavior contract; the integration steward
  checks those semantic dependencies too.
- If two ready tasks own the same file, dispatch them serially. Keep the later
  task queued for that path until the first worker hands off its patch and the
  steward records the new base identity. Do not split an existing file by line.
- A worker that needs a file outside its packet stops and asks the coordinator
  for an explicit path-boundary change or sends a shared-patch request. It does
  not edit the file on the assumption that a small patch is harmless.
- When tasks have disjoint files, they can run concurrently only when their
  dependencies and sprint wave also permit it.

## Sprint waves

The maximum cross-sprint overlap is set by `MASTER_PLAN.md`:

| Wave | Sprints that may overlap |
| --- | --- |
| 0 | BW-S00 |
| 1 | BW-S01, BW-S02, BW-S04 |
| 2 | BW-S03, BW-S05 |
| 3 | BW-S06 |
| 4 | BW-S07 |
| 5 | BW-S08, BW-S10 |
| 6 | BW-S09, while remaining BW-S10 diagnostic work finishes |
| 7 | BW-S11 |

Within a sprint, the sprint's `Parallelism` section sets dependency order, and
the exact task packets set file ownership. The coordinator checks both before
each dispatch; a wave does not make overlapping files safe.

## Shared-patch request

Send the sprint coordinator a bounded request before editing a protected path.
Include:

```text
Task and attempt ID / fence:
Input source snapshot and project revision:
Exact protected file(s):
Why the task needs each file:
Proposed patch or focused diff:
Dependent task IDs and exported contract names:
Schema, protocol, migration, registry, or generated-file impact:
Checks run and required integration checks:
```

The coordinator assigns the patch to the file's steward, updates the task's
write boundary when appropriate, and records the combined source identity.
Workers review the applied patch and rerun affected focused checks before
handoff. A request or proposed diff does not transfer ownership by itself.

## Handoff and interruption

At handoff, report the task and attempt/fence, exact source snapshot, exact
changed paths, checks and receipts, remaining limitations, and any shared-patch
requests. Do not edit sprint ledgers, accept your own review, or mark a task or
sprint complete; the assigned review and `T90` integration own those decisions.

If a worker stops or becomes unavailable, the coordinator preserves its
worktree and patch first, checks the process and attempt state through supported
interfaces, and records the preserved source identity before reassignment. Do
not erase another worker's changes, reset its worktree, reuse its fence, or
force-break a live lock. Uncertain mutations are read back by operation ID
before any retry.

## Integration

The sprint steward serializes changes to protected files, checks that applied
patches match their recorded base, and resolves contract conflicts with the
owning workers. `T90` validates the combined tree, names the checks actually
run and any failures or unsupported cases, and records the exact resulting
source identity. A worker's branch check or handoff alone does not close a leaf
or satisfy sprint validation.

# Parallel dispatch and integration

## Operating model

Each active leaf has one implementer and one isolated worktree based on its
recorded source snapshot. A sprint coordinator manages the dispatch queue and
names one integration steward for the sprint. The sprint's `T90` task integrates
accepted leaf work, runs the combined validation, and records the exact source
identity consumed by dependent sprints.

Leaf handoff follows the task's acceptance profile; do not add a separate
per-task review ceremony unless that profile explicitly requires independent
review. `T90` is the sprint-level integration and validation gate.

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
6. Any required shared-file steward is identified; name an independent reviewer
   only when the task's acceptance profile requires one.

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

## Sprint sequencing

The active cross-sprint schedule is revision 4 in
`REVISION_V4.md`; the imported task graph is the executable dependency source.
The older numbered-wave summary is intentionally removed because it omitted
BW-S12 and BW-S13. Sprint containers have no executable dependency edges, so
the following groups summarize safe entry points without replacing task-level
readiness:

| Entry point | Work that may proceed when its task prerequisites and file grants allow |
| --- | --- |
| Initial qualification | BW-S00; BW-S00-T90 is the gate before dependent implementation work. |
| After BW-S00-T90 | BW-S01, BW-S02, BW-S04, BW-S12-T01, and nonconflicting BW-S08 work; each leaf still follows its own dependency edges. |
| Parallel core work | BW-S03, BW-S05, BW-S06, BW-S07, BW-S08, BW-S10, and the remaining BW-S12 tasks as their exact prerequisites pass. |
| General scheduling and delivery | BW-S13-T01 follows BW-S12-T01 and BW-S05-T01; T02 follows T01 and BW-S12-T05; T03 follows T01 and BW-S12-T90. |
| Final integration | BW-S11 starts only after BW-S09-T90, BW-S10-T90, BW-S12-T90, and BW-S13-T90 are accepted. |

BW-S12-T02 and BW-S12-T03 may overlap when their exact write sets remain
disjoint. The coordinator checks the current graph and whole-file grants before
each dispatch; a sprint label or sequence group does not make overlapping
files safe.

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
requests. Do not edit sprint ledgers, self-certify a required independent review,
or mark a task or sprint complete. The coordinator records leaf acceptance
under its profile, and `T90` owns sprint integration and completion.

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

# Work split

`work split` decomposes one open task into a new sibling task and a close-only
dependency. The new task is placed under the source task's existing legal
container parent. The source task remains open; completing the child does not
close it. The original task is blocked until the child is closed, then can
continue independently.

This is intentionally different from hierarchy nesting. Boreal's hierarchy
allows tasks under sprints, not tasks under tasks. The immutable split record
provides decomposition lineage without inventing an illegal parent relation.

## Create a split

```text
bwrk work split WORK_ID --project PROJECT --title TEXT \
  [--description TEXT] [--priority 0..255] [--label LABEL ...] \
  [--acceptance focused|reviewed] --expected-revision N --yes
```

The project session and actor are taken from the normal CLI identity options.
The operation ID is the idempotency key; retries of the same operation return
the original split result. The child and lineage IDs are deterministically
derived from that operation ID. `--label` can be repeated and merges with the
source task's labels. Priority and dispatch policy inherit from the source
unless priority is overridden.

The child's acceptance profile definition inherits from the source unless a
canonical `focused` or `reviewed` profile is selected. Gate state is reset to
open. The source's historical attempt and receipt references are retained as
lineage context, never as child acceptance evidence. A source task with a
current attempt fence cannot be split. The command requires the exact project
revision observed by the caller.

## Read lineage

```text
bwrk work split show SPLIT_ID --project PROJECT
```

The JSON result includes source and child IDs, source/child revision metadata,
bound source-version references, the copied profile definition identity, and
the immutable historical proof-context references. Use `work show` for the
current lifecycle and `status` for live claimability; split lineage is not a
replacement for those authoritative views.

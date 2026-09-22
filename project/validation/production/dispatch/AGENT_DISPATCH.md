# Agent dispatch record

Copy this record for one bounded task attempt. Do not use it to self-accept.

## Identity

- Task ID:
- Attempt:
- Worker / agent ID:
- Reviewer / independent gate owner:
- Dispatch timestamp:
- Input source identity:
- Plan version / contract versions:
- Prerequisite accepted handoffs:

## Exclusive write boundary

- Existing files allowed:
- New files allowed:
- Shared integration paths requested:
- Explicitly prohibited paths:
- Evidence directory:

## Worker instructions

- Load the complete task card and required references.
- Capture baseline behavior before changing code where applicable.
- Keep external work outside database transactions.
- Preserve failed attempts, rejected evidence, and unknown operation outcomes.
- Return exact changed paths, commands, source identity, evidence, risks, and
  next safe task.

## Coordinator acceptance

- [ ] Dependencies and external inputs verified.
- [ ] Write boundary is disjoint and source identity is fixed.
- [ ] Worker handoff and evidence exist.
- [ ] Combined-tree integration is complete.
- [ ] Required checks ran on the integrated source.
- [ ] Coordinator acceptance recorded in `execution/STATE.json`.
- [ ] Independent sprint review/reconciliation/revalidation remain separately
      assigned and are not implied by this record.

# Workflow 00 — coordinator and integration steward

## Mission

Keep the plan moving across concurrent streams while preserving one source of
truth for dependencies, contracts, shared files, evidence, and acceptance.

## Owns

- dispatch records and task attempt allocation;
- worktree/source identity and integration order;
- shared-file steward tokens;
- independent reviewer assignment;
- `STATE.json`, plan change requests, and gate advancement;
- escalation when a stream is blocked, rejected, stale, or out of scope.

## Does not own

The coordinator does not silently fix worker code, approve its own integration,
rewrite failed evidence, or accept a sprint without T90/T91/T92 evidence.

## Operating loop

- [ ] Read the current `STATE.json`, graph-ready output, active attempts and
      rejected/blocked reasons.
- [ ] Select task cards, not informal feature descriptions.
- [ ] Confirm effective dependencies and accepted source identity.
- [ ] Assign one worker, one reviewer, one worktree, one write set, and one
      evidence directory per task.
- [ ] Record C0/C1 before implementation begins.
- [ ] Route shared-file changes through the named steward.
- [ ] Integrate completed patches and record the combined source identity.
- [ ] Send the combined tree to an independent reviewer.
- [ ] Revalidate after reconciliation and only then unlock successors.
- [ ] Update the plan ledger and publish a short stream status summary.

## Checkpoint rule

The coordinator may let streams prepare work for a future wave, but may not
mark that work eligible, accepted, or release-relevant before its prerequisites
pass. When in doubt, preserve the attempt and create a bounded finding or
change request.

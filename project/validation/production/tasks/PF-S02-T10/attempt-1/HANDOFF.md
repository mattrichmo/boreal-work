# PF-S02-T10 — attempt 1 handoff

## Identity and disposition

- Task / plan / attempt: `PF-S02-T10` / production-completion v1 / `attempt-1`.
- Worker: coordinator-bounded corrective attempt.
- State requested: **blocked / awaiting coordinator integration**; not accepted.
- Input source: `784a41b3802c29a76721c55eef2e9493283396c2`, dirty combined tree.
- Accepted prerequisites read: PF-S02-T02 attempt 4 and PF-S02-T03 attempt 4;
  rejected original findings for PF-S02-T04, PF-S02-T06 and PF-S02-T07 were
  preserved and consumed as context.

## Work performed

No production source change is handed off. A temporary additive schema probe
was applied and reverted after it demonstrated that merely adding the identity
tables makes the existing opener fail closed with a missing identity row. This
confirmed that schema DDL, identity installation, migration payload, and
reopen verification must be integrated together rather than staged piecemeal.

## Required next integration

The next bounded attempt must, within the granted T10 paths:

1. Add identity, pinned-requirement, recovery, resource and external-job tables
   to the fresh production schema and the v2→v3 ordered migration payload,
   including safe pre-runner-v3 repair and exact reopen verification.
2. Install or validate the database identity row at the canonical opener; a
   table without its identity row is corruption, not permission for lazy repair.
3. Replace the `{}` profile placeholder in root work creation with an actual
   immutable profile definition and a durable requirement set whose declaration
   count/digest remains authoritative when gate observations are deleted.
4. Make root operation append/readback bind the operation to database lineage,
   and ensure the operation/audit pair is committed or rolled back together.
5. Add real-store integration tests for fresh/upgrade/reopen, deleted or drifted
   requirements, replay context mismatch, recovery persistence and rollback.

Application adapter wiring remains a separate follow-up unless it is explicitly
within the accepted T10 boundary; it must not be reported as fixed by store
module tests.

## Validation

See `COMMANDS.md` and `EVIDENCE.md`. Final reruns on the unchanged combined
tree: `production_migrations` 16/16, `store_contracts` 24/24, formatting,
contract validation and diff checks passed. The task-specific integration
target was not created, so T10 acceptance criteria remain open.

- [ ] No acceptance was claimed.
- [x] Failed probe and its consequence were retained.
- [x] Prior evidence was not overwritten.
- [x] No service receipt, external effect or release result was fabricated.
- [ ] Canonical profile/recovery/operation integration remains outstanding.

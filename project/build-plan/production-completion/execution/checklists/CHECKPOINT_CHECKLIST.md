# Task checkpoint checklist

## C0 — Dispatch ready

- [ ] Dependencies and required decisions are accepted.
- [ ] Source identity and contract version are recorded.
- [ ] Worker, reviewer, worktree, write set, and evidence root are assigned.
- [ ] Shared-file conflicts were checked.

## C1 — Worker acknowledged

- [ ] Worker summarized the invariant and intended change.
- [ ] Worker named expected integration requests.
- [ ] Worker confirmed no unapproved scope expansion.

## C2 — Patch ready

- [ ] Exact changed paths and diff identity are recorded.
- [ ] Tests include the task's required failure and boundary cases.
- [ ] Raw logs, exit codes, tool versions, and limitations are preserved.
- [ ] Worker supplied a complete handoff and next-safe-action statement.

## C3 — Review ready

- [ ] Reviewer is independent of the implementer.
- [ ] Reviewer checked source, diff, evidence, contract impact, and tests.
- [ ] Findings are severity-ranked and tied to owners/follow-up tasks.
- [ ] Rejected or superseded evidence remains available.

## C4 — Integrated

- [ ] Coordinator merged the patch into the combined tree.
- [ ] Shared roots and registrations were reconciled by the steward.
- [ ] Combined-tree checks ran against the integrated source.
- [ ] Original worker reviewed semantic conflict resolution where needed.

## C5 — Revalidated

- [ ] Revalidation used the combined source and exact required binary/service.
- [ ] Genuine service/release requirements were not replaced by fixtures.
- [ ] Results and source identity were recorded in the evidence attempt.
- [ ] New findings were routed instead of hidden.

## C6 — Unlockable

- [ ] Required acceptance fields are complete.
- [ ] Relevant review/reconciliation/revalidation gate is accepted.
- [ ] Successor readiness was recomputed.
- [ ] Downstream stream received the accepted handoff and source identity.

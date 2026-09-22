# PF-S02-T07 — Independent review attempt 2 evidence

## Disposition

**REJECTED — the bounded journal implementation is not integrated into the
canonical consequential mutation paths.**

The focused module behavior is good, and the required store checks pass, but
the task card explicitly rejects a standalone module or test-only success
path. The current combined tree still lets production mutations write an
operation row and audit row through the legacy API without recording the
database identity context or enforcing the new exact replay contract.

## Findings

### P0 — canonical root mutations bypass identity-bound operation registration

`OperationJournal::append_in_transaction_with_identity` is implemented in
`crates/store/src/operations.rs:165–181`, and the persistent opener installs
the identity schema in `crates/store/src/lib.rs:1460–1538`. But the current
production mutations continue to call `append_operation` and
`append_audit_event` directly. The static review found 22 direct legacy
operation appends and no production invocation of the identity-bound journal.

The claim path is a decisive example: at
`crates/store/src/lib.rs:3508–3687`, `claim_work_with_context` commits the
attempt, reservation, revision, operation, and audit event in one transaction,
but it never calls `IdentityStore::record_operation_context`. A subsequent
identity-bound readback can therefore find an operation without its durable
identity row, and replay behavior differs depending on which API path created
the operation. The same bypass exists in project initialization, session
registration, planning/hold mutations, attempt mutations, and CLI/service
helpers.

This violates the task requirements to commit semantic mutation, identity,
outcome, and audit atomically and to reject replay across project/epoch and
other immutable identity fields. It also violates the coordinator integration
request’s explicit requirement that every consequential root mutation use the
root-owned identity-bound path.

### P1 — one CLI parent-operation helper is operation-only

`crates/cli/src/main.rs:5753–5800` (`append_finish_parent_operation`) directly
inserts a completed `finish_close` operation but does not append the required
audit event in the helper. The helper is called from the close flow, so its
operation/audit completeness must be proven at the owning transaction boundary
or moved behind the canonical bundle. As written, it is another bypass of the
new atomic operation/audit contract and is not independently identity-bound.

## Positive evidence

- The new operation journal focused target passed 6/6 tests, including
  commit-before-response replay, changed actor/payload/subject rejection,
  pending/unknown distinction, audit-failure rollback, and rejected
  no-mutation behavior.
- The full `boreal-store` test suite passed on the current tree.
- Strict store clippy, workspace formatting, contract validation, and
  `git diff --check` passed.
- The persistent production-open path now verifies or installs the database
  identity before normal persistent use.
- Attempt-1 source hashes for the three worker-owned files are unchanged in
  the current tree, so the focused worker evidence remains attributable.

## Acceptance checklist

| Required item | Result | Reason |
| --- | --- | --- |
| Crash after commit-before-response resolves to one original outcome and one audit event | Pass for focused journal seam only | The focused test passes; canonical mutation integration is still missing. |
| Rejected action records disposition without prohibited target mutation | Pass for focused journal seam only | The focused test passes; no proof all root mutations use the seam. |
| Operation IDs cannot cross actor/project/payload/epoch boundaries | Reject | The journal enforces this only when invoked; current root mutations bypass identity recording and identity-bound replay. |
| Effective prerequisites, owner decisions, schema/protocol impacts and baseline discrepancy accounted for | Partial | The worker handoff and integration request document them; the required shared-root integration is not complete. |
| Focused and required combined checks on actual source | Pass | All commands in `COMMANDS.md` exited 0. |
| Changes integrated within boundary with shared patches applied | Reject | Worker files are registered, but the required canonical call-site integration is absent. |
| Complete handoff/evidence and coordinator acceptance | Reject | This review rejects the attempt; no coordinator acceptance should be recorded. |

## Scope limits

This review does not claim service-backed lifecycle, release, or publication
readiness. It does not edit production source, plan state, manifests, or
prior evidence. It does not treat passing focused tests as evidence that the
canonical CLI/application/store workflow is protected.


# PF-S02-T10 independent review — handoff

## Outcome

PF-S02-T10 attempt 4 is **rejected** and must not be marked accepted.

## Required follow-up before re-review

1. Make recovery obligations part of the canonical attempt/lifecycle transaction paths. Expiry, failed execution, stop/release uncertainty, cancellation uncertainty, and resource release must create durable unresolved facts; resolution must be an authenticated, reasoned, operation/audit-bound mutation.
2. Register external jobs before verifier/Git/backup/update/stop side effects and expose durable stage/readback/reconciliation through the application adapters. Unknown outcomes must remain unknown until explicit readback.
3. Replace all canonical direct operation writes with the identity-bound journal and same-transaction audit bundle, or introduce one root helper that enforces the same contract without compatibility fallback on production paths. Cover session, planning, dependency, hold, claim, attempt, receipt, review, summary, and close mutations.
4. Fix the schema-v2/in-memory identity setup regression so explicit controlled test identities can be installed without conflicting with an automatically generated identity. Re-run `production_operation_audit` and the full focused store set after the fix.
5. Move additive recovery/job/profile schema ownership into the ordered production migration/verification contract, with an explicit compatibility/reconstruction path for legacy databases rather than lazy DDL from lifecycle methods.
6. Re-run the exact bounded review commands, record new evidence in a later attempt directory, and obtain an independent review of the combined tree. Do not overwrite this attempt.

## Acceptance state

- Production source changed by reviewer: no.
- Plan STATE changed by reviewer: no.
- Package manifest changed by reviewer: no.
- Earlier attempts overwritten: no.
- Review evidence written: `START.md`, `COMMANDS.md`, `EVIDENCE.md`, `HANDOFF.md` in this directory.


# Bounded contribution evidence

Implemented in `crates/store/src/recovery.rs`:

1. Added `IdentityBoundRecoveryResolutionInput`, carrying the installed database/project identity context, operation identity, request digest, project revision precondition, session, and existing resolution payload.
2. Added `RecoveryResolutionResult`, returning the resolved obligation, durable operation readback, and replay flag.
3. Added `resolve_recovery_obligation_with_identity`.
   - Revalidates the identity context before and during the operation-journal append.
   - Re-reads the obligation's attempt and fence while the write transaction is held.
   - Fails closed for missing, foreign, or mismatched attempt/fence records.
   - Checks the expected project snapshot revision before bumping it.
   - Commits the recovery decision, obligation state, operation identity, and audit event in one transaction.
   - Uses existing `OperationJournal` replay/readback semantics; an exact replay does not insert another decision or bump the revision.
   - Uses existing audit subject/event vocabulary and places the recovery obligation identity in the bounded result payload.

Added focused real-SQLite coverage in `crates/store/tests/production_recovery_records.rs`:

- exact identity-bound resolution produces one decision, one operation, one audit event, and one revision;
- exact retry replays the durable outcome without a second write;
- stale project revision leaves the obligation, operation table, and project revision unchanged;
- a persisted obligation fence that no longer matches its attempt is rejected before mutation.

Observed focused result: 7/7 recovery tests passed. Full `boreal-store` result: all executed tests passed.

This evidence does not establish service/application integration, authenticated actor/role enforcement, production opener registration, external process reconciliation, or complete PF-S02-T06/T10 acceptance.

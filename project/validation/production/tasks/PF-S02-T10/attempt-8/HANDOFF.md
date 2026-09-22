# Handoff and integration request

## Changed paths

- `crates/store/src/recovery.rs`
- `crates/store/tests/production_recovery_records.rs`
- `project/validation/production/tasks/PF-S02-T10/attempt-8/{START,COMMANDS,EVIDENCE,HANDOFF}.md`

## Bounded result

The store now exposes an identity-bound recovery-resolution seam that can be called by the application without duplicating transaction, revision, operation, audit, or readback policy. Existing callers remain source-compatible through the legacy method.

## Required integration work

1. The application/service layer must authenticate the actor and session, construct the installed `IdentityContext`, choose an operation ID and canonical request digest, and call `resolve_recovery_obligation_with_identity`.
2. The production opener/migration path must register the recovery schema before the application admits recovery mutations. Existing coordinator-owned wiring remains outside this worker's write scope.
3. The application must expose committed, rejected, pending, and unresolved readback distinctly and route resource/process reconciliation through the durable recovery obligation rather than clearing an attempt directly.
4. Full PF-S02-T06 still needs external job/resource integration, restart/late-worker tests, and service-backed validation. Full PF-S02-T10 still needs the remaining operation/audit writers, CLI/application call sites, and independent review.
5. Resolve the pre-existing workspace parse error in `crates/application/src/evidence.rs` and the strict clippy findings before claiming workspace-wide formatting/lint acceptance.

No `STATE.json` or package manifest was edited by this worker. The orchestrator must review these files and update the ledger only after independent review.

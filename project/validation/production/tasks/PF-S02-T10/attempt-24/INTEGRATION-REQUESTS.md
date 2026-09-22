# PF-S02-T10 attempt-24 integration requests

These are explicit coordinator/owner requests, not acceptance claims.

1. **CLI `finish_close` owner — `crates/cli/src/main.rs:5897`.** Replace the
   direct operation-only append with the root identity-bound operation/audit
   transaction. Preserve the close parent subject, immutable request digest,
   rejected outcome, and unknown readback semantics.
2. **CLI service `agent_start` owner — `crates/cli/src/service.rs:2566`.**
   Route admission and terminal outcome through the identity-bound journal;
   preserve pending/unknown service-restart recovery and prohibit a second
   external start effect on retry.
3. **Application knowledge/service owner.** Add a bound-production integration
   case for catalog capture followed by SQLite source registration, asserting
   committed versus replayed versus pending registration states and fail-closed
   behavior when the project identity binding is absent.
4. **Schema/protocol owner.** Decide and version a first-class source audit
   event if `repair.correction` is not the desired long-term vocabulary. Do
   not change the event type in this store-only attempt without the accepted
   contract and schema update.
5. **Coordinator.** Re-run the exact combined T10 matrix after CLI/application
   integration: fresh/upgrade/reopen, project/epoch isolation, operation
   replay and audit rollback, rejected registration, pending/unknown service
   recovery, external-job ambiguity, and concurrency. Keep the memory-crate
   compile blocker and all prior failed evidence visible.

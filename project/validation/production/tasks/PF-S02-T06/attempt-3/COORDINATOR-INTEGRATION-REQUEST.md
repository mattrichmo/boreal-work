# PF-S02-T06 attempt 3 — coordinator integration requests

No changes are requested to `crates/store/src/lib.rs`, schema manifests, or
migration ordering for module registration or recovery/job DDL: current source
already has those registrations and the ordered schema-v3 migration. Preserve
the protected root and rerun its migration tests on the final combined tree.

The following work remains outside this retry's exclusive write set:

1. **Repair the application fixture caller.** In
   `crates/application/tests/production_external_jobs.rs` (the direct call
   near the terminal-fallback setup), replace the post-bind call to
   `SqliteStore::create_recovery_obligation` with test-only SQL fixture seeding
   or a real authenticated lifecycle writer. The new guard intentionally
   rejects unbound recovery mutation after project identity binding.
2. **Wire process stop to a durable effect/readback.** Add the
   application/service adapter path that registers a stop operation before signaling,
   binds it to project, work, attempt, fence, principal/session and immutable
   request digest, and leaves interruption as pending/readback-required. Only
   attributable process/runtime readback may confirm stop and permit the
   recovery decision; do not treat a caller-provided `stop_confirmed` boolean
   as independent proof.
3. **Unify or explicitly bridge maintenance effects.** Backup/restore currently
   use `boreal_maintenance_job`, while the accepted external-effect contract
   names backup/restore alongside verifier/Git/update jobs. The application /
   CLI/store steward must either bridge maintenance records to an
   identity-bound external-job and operation readback, or record an explicit
   reviewed contract disposition preserving equivalent identity, idempotency,
   and crash-readback guarantees. Do not add filesystem effects to a SQLite
   transaction.
4. **Exercise real callers and lifecycle writers.** On the combined tree, run
   the affected application external-job tests after fixture repair, then
   exercise authenticated claim → failure/expiry/cancel/release → unresolved
   obligation/readback → exact resource acknowledgement. Verify each
   obligation survives restart and blocks claim until resolved. Include
   submission and close-finalize paths; tests from this bounded store target
   do not certify all of those workflows.
5. **Expose recovery disposition to product callers.** The application has
   identity-bound recovery readback/resolution methods in
   `crates/application/src/runtime.rs`, but no CLI/service consumer was found
   in the current source search. Add a versioned service/CLI path that uses
   those methods and the same project identity, operation ID/digest, session,
   expected revision, and reason; do not expose direct database mutation.
6. **Independent review and task disposition.** Review the exact combined
   source hashes and rerun applicable checks. This handoff does not update
   `execution/STATE.json`, accept PF-S02-T06, or accept PF-S02/PF-S02-T92.

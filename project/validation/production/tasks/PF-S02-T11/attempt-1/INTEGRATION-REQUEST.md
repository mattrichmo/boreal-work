# PF-S02-T11 — bounded integration request

This request is submitted instead of adding a parallel, non-authoritative
external-job engine.

## Required ownership changes

1. **Memory publisher path:** either split the existing `Publisher`
   implementation from protected `crates/memory/src/lib.rs` into the task's
   declared `crates/memory/src/publisher.rs` and register it without changing
   the public API, or expand the task's grant to the existing file and assign
   the memory integration steward. Re-run the full publisher suite, including
   interrupted Git publication and reconciliation.
2. **Application evidence transaction seam:** grant the application/store
   integration steward the canonical evidence adapter files (at minimum
   `crates/application/src/evidence_store.rs` and
   `crates/application/src/sqlite_adapter.rs`, plus any required crate-root
   registration) to bind evidence execution admission/start/finish/unknown
   to the durable external-job record. The bundle must preserve operation ID,
   request digest, project/restore identity, source/configuration identity,
   actor/session and audit/revision context. Do not solve this with two
   best-effort transactions.
3. **Lifecycle recovery:** grant the steward the canonical store/service
   mutation paths (including the protected store root and the service adapter)
   to create unresolved recovery obligations on expiry/failure/stop/release,
   request resource release, and resolve only after an attributable
   acknowledgement. Preserve current attempts, failed evidence, and fences.
4. **Memory/update/backup jobs:** add durable job registration and readback
   around Git publication, backup, and update activation. Update must bind the
   installed binary/assets manifest and compatibility range and must not return
   success after a timeout or uncertain installer effect. These operations
   need project/actor/operation context before they can be made durable.
5. **Schema/migration:** verify that `boreal_external_job` and recovery tables
   are installed by the ordered migration ledger rather than first-use lazy
   DDL, and add fresh/upgrade/reopen/rollback checks. This is the same mandatory
   issue recorded in PF-S02-T06 attempt-2.

## Required follow-up validation

After the path grants and shared integration are resolved, create a fresh
attempt directory and run:

```text
cargo fmt --all -- --check
cargo test --locked -p boreal-application --test production_external_jobs
cargo test --locked -p boreal-application
cargo test --locked -p boreal-memory
cargo test --locked -p boreal-cli
cargo test --workspace --locked
python3 project/spec/validate_contracts.py
```

The new focused test must exercise pending, readback-required,
reconciled/rejected, timeout/restart, wrong-project, wrong-operation-digest,
and safe resource-release cases against the actual SQLite-backed application
path. It must record the exact source identity and must not seed a passing
receipt or claim a successful external effect from a fixture alone.

# PF-S02-T11 — attempt 2 evidence

## Disposition

**BLOCKED / awaiting shared integration.** This attempt implements and tests a
bounded application adapter over the existing durable external-job store seam,
but it does not claim that verifier evidence, memory publication, backup,
update, or lifecycle recovery are transactionally integrated into the
canonical product paths.

## Implemented bounded seam

`crates/application/src/evidence.rs` now provides:

- `ExternalEffectRequest`, preserving project, subject, operation, request
  digest, source/configuration identity, actor/session, deadline, and job
  identity;
- `ExternalEffectAdapter::admit`, `start`, and
  `mark_side_effect_started`, delegating to the existing store job API;
- explicit `mark_readback_required` and `reconcile` methods;
- project-scoped operation readback with request-digest matching;
- `ExternalEffectResolution`, where pending and readback-required outcomes are
  not resolved and only reconciled/committed outcomes report `is_resolved()`.

The adapter does not run a process, manufacture a receipt, or turn an
uncertain effect into success. Reconciliation stores the result digest while
preserving the original side-effect reference.

`crates/application/tests/production_external_jobs.rs` exercises the adapter
against a real in-memory SQLite store with a real application-created project
and work item. It covers admission, replay, pending state, side-effect start,
readback-required state, reconciliation, project scoping, request-digest drift,
and rejection of premature reconciliation.

## Remaining blockers

### T11-001 — memory publisher path is not granted by the source tree

The requested `crates/memory/src/publisher.rs` file does not exist. The
authoritative `Publisher` implementation and its Git publication journal are in
`crates/memory/src/lib.rs`, which is outside the assigned write boundary. A new
unregistered `publisher.rs` would be dead code and a second publication state
machine, so it was not created. The path grant must be expanded or the
publisher must be split by the memory integration steward.

### T11-002 — evidence admission is not atomically bundled with the job

The new adapter persists durable job stages, but the existing evidence path
also persists `evidence_execution` through protected application/store paths.
The granted files do not expose a transaction bundle that commits evidence
admission, external-job stage, operation identity, audit event, and project
revision together. Therefore this attempt does not claim canonical verifier
integration; a coordinator must grant `evidence_store.rs`,
`sqlite_adapter.rs`, crate-root registration, and the relevant store/service
mutation boundary.

### T11-003 — memory, backup, and update have no safe durable context here

`crates/cli/src/update.rs` receives only parsed CLI options, locates the
packaged installer, invokes it, and reports process exit success. It has no
project/store identity, authenticated actor, operation digest, external-job
ID, asset manifest readback, or uncertain-outcome route. The granted update
file was left unchanged. Backup likewise lives at a store/application seam
outside this leaf.

### T11-004 — lifecycle recovery remains outside this adapter grant

Expiry, failure, stop, and release mutations need to create durable recovery
obligations and resolve them only after attributable resource acknowledgement.
Those canonical call sites are in protected store/service paths. The bounded
adapter cannot safely add them from `runtime.rs` alone, so no recovery claim is
made here.

## Validation limits

The focused test proves the existing job API and the new application wrapper
preserve identity and unknown/readback semantics. It does not prove the
complete evidence transaction, service protocol wiring, memory publication
durability, backup/update activation, ordered schema migration, or lifecycle
recovery integration. The memory package failure remains an independent
release concern and is retained verbatim in `COMMANDS.md`.

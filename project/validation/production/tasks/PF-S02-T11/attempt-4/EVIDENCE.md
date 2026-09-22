# PF-S02-T11 — attempt 4 corrective evidence

## Disposition

**READY FOR INDEPENDENT REVIEW as a bounded contribution; PF-S02-T11 remains
unaccepted.**

## Implemented bounded behavior

`crates/application/src/evidence.rs` now:

- validates the required admission identity fields before registering an
  external job;
- preserves the durable `registered` → `admitted` → `running` →
  `side_effect_started` → `readback_required` lifecycle;
- rejects a replay that changes the recorded side-effect reference;
- adds `ExternalEffectReadback`, requiring project, job, operation, request
  digest, side-effect reference, result digest, and observation time;
- checks the readback against the durable job identity and recorded effect;
- rejects reconciliation from any stage other than `readback_required`;
- returns the existing resolved result for an identical replay, while
  rejecting a different result for an already reconciled operation;
- leaves unresolved stages as pending/readback-required and never creates a
  receipt or acceptance decision.

`crates/application/tests/production_external_jobs.rs` covers:

- pending admission and readback-required transition;
- reconciliation only after readback-required;
- operation/request-digest replay and wrong-project isolation;
- wrong side-effect and wrong operation rejection;
- idempotent identical reconciliation readback;
- empty admission identity rejection.

## Acceptance boundary

| Task requirement | This attempt | Evidence/remaining gap |
| --- | --- | --- |
| Interrupted effect remains pending/readback-required and resolves only by attributable readback | **Bounded contribution demonstrated** | 5 focused tests pass, including identity-bound readback. This is not a service lifecycle proof. |
| Expiry/resource release preserve recovery across restart | **Not implemented here** | Canonical lifecycle/store/service writers are outside the granted paths. |
| Verifier/Git/backup/update retain operation identity and reconcile before success | **Partial** | Application external-job seam is hardened. Canonical verifier admission, memory publisher registration, backup, and update activation remain unwired. |
| Prerequisites/owner decisions/schema/protocol impacts accounted for | **Documented** | No schema/protocol changes made; missing publisher path and shared transaction seams remain integration requests. |
| Focused and integration checks on actual source identity | **Partial** | Application, memory, CLI, contract, format, diff, and focused tests passed. Clippy is blocked by an out-of-scope store lint. No genuine service/release check was run. |
| Changes stay within granted boundary | **Met for this attempt** | Only `evidence.rs`, the permitted test, and this attempt-4 evidence were changed; no publisher file was fabricated. Existing `update.rs` formatting change was preserved. |
| Complete handoff and coordinator acceptance | **Not met** | This record requests independent review; the parent task remains rejected/unaccepted. |

## Explicit non-claims

This attempt does not claim:

- atomic admission of evidence execution, external job, operation identity,
  audit, and proof revision in one store transaction;
- canonical wiring of the adapter into verifier/receipt execution;
- durable memory publication jobs or operation-journal integration;
- backup or update activation jobs, asset-manifest readback, or rollback;
- expiry/stop/release resource acknowledgement or restart recovery;
- genuine service-backed lifecycle, platform release, or production installer
  validation.


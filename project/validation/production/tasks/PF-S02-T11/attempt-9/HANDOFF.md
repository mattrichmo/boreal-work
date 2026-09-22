# PF-S02-T11 — attempt 9 application identity-bound adapter handoff

## Identity and disposition

Task / plan / attempt: `PF-S02-T11 / production-completion v1 / attempt-9`  
Worker: `01a0ca00-595a-7762-948d-28cb882a0a69` (stopped without handoff)  
Coordinator integration: current orchestrator  
Disposition: **ready for independent review; bounded only**

## Changed paths

- `crates/store/src/jobs.rs` — operation-based identity-bound job readback
  helper used by the application adapter.
- `crates/application/src/evidence.rs` — optional identity-bound adapter
  construction and routing for production reads/mutations.
- `crates/application/tests/production_external_jobs.rs` — canonical identity
  fixture and legacy-path rejection coverage.

## Required review

Review the exact combined tree and verify that the production constructor
cannot silently downgrade to legacy store methods, that the context is checked
for every application job operation, and that pending/readback-required states
remain unresolved until attributable reconciliation. Full PF-S02-T11 remains
rejected until all external-effect adapters and real-service evidence are
integrated.

# PF-S02-T10 status-batching remediation — attempt 21

## Scope

Implement the missing project-scoped planning-facts loader for status
snapshots. The loader must replace the per-work `status_planning_facts` query
in the project snapshot loop while preserving cycle assignment activation
semantics, project isolation, exact counts, diagnostics, and the existing
single-work helper contract.

## Allowed paths

- `crates/store/src/lib.rs`
- `crates/store/src/status_evaluation.rs` when required
- `crates/store/tests/storage_remediation.rs`
- this attempt's evidence files

## Explicit exclusions

This attempt does not change recovery semantics, application files, plan or
state ledgers, commits, or pushes. The distinct-work resource acknowledgement
failure remains a separate blocker from attempt 20.

## Baseline

Attempt 20 reports 762 prepared statements for the 250-work status snapshot.
The current snapshot loop still calls `status_planning_facts` once per work.

## Acceptance evidence to collect

Run the exact batching test, the full storage-remediation target, the full
`boreal-store` suite, strict all-target store Clippy, formatting, contract
validation, and diff checks. Record any remaining unrelated failures exactly;
do not weaken strict profile, schedule, diagnostic, or isolation behavior.

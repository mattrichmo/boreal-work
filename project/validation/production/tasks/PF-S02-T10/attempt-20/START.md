# PF-S02-T10/T06 recovery-and-status remediation — attempt 20

## Dispatch

- Task scope: PF-S02-T10/T06 recovery-and-status remediation
- Input source: current combined worktree after attempts 18/19, PF-S03-T10
  scheduled-status integration, and the unaccepted PF-S02-T11 changes
- Base reference: `70514f0ed2521df710c3c913f50ff9d759f5e743`
- Branch: `codex/apply-responsive-terminal-overlay`
- Plan/state edits: prohibited
- Commit/push: prohibited
- Independent review: required after the combined-tree handoff

## Invariant and intended change

Status snapshots must load canonical cycle assignment and schedule facts once
per project, preserving project scoping, malformed-data diagnostics, and the
existing status/reason contract. Recovery resolution must not make a canonical
resource reusable merely because an obligation row says `released`; the
obligation, project/work/attempt/fence identity, exact resource reservation,
release acknowledgement, audit/readback, and idempotency must agree in one
serialized boundary.

## Writer paths under review

- `crates/store/src/lib.rs`
- `crates/store/src/status_evaluation.rs`
- `crates/store/src/recovery.rs`
- `crates/store/tests/storage_remediation.rs`
- `crates/store/tests/production_recovery_records.rs`
- `crates/store/tests/production_integration.rs`
- `crates/application/tests/p2_guided_flow.rs` only if its supported contract
  needs an explicit acknowledgement step

## Baseline failures captured from prior handoff

- `storage_remediation::status_gate_queries_are_batched_for_large_projects`
  reports 762 prepared statements for 250 works.
- The guided expiry/recovery flow resolves an obligation with
  `resource_state=released`, but the canonical live-resource unique index still
  sees `release_pending` and rejects the replacement claim.
- Prior combined-tree checks also exposed missing `schedule`/
  `activation_at` adapter wiring and strict profile fixture failures; these
  remain validation inputs and must not be weakened.

## Verification strategy

Run the exact focused batching test, all `storage_remediation` tests, the
guided-flow regression, production recovery/resource/integration suites, the
full store suite, strict all-target store Clippy, workspace format, contract
validation, and diff checks. Preserve every failure in the attempt evidence;
this attempt is not accepted by a green subset or by compilation alone.

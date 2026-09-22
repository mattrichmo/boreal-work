# PF-S02-T10 recovery/resource remediation — attempt 21R

## Scope

Repair the recovery-to-canonical-resource contract on the current combined
source. An authenticated resolution that declares a released resource must
revalidate the obligation's project, work, attempt, and fence, locate the
exact `resource:{attempt_id}` reservation and its pending terminal-release
event, and acknowledge that release in the same transaction as the recovery
decision, operation readback, audit event, and project revision.

Plain recovery resolution must not make a bound resource reusable. Stale,
foreign, mismatched, missing, or ambiguous identities must fail closed. The
live-resource uniqueness constraint and existing work-scoped claim key remain
unchanged.

## Allowed paths

- `crates/store/src/recovery.rs`
- `crates/application/src/runtime.rs`
- `crates/application/tests/p2_guided_flow.rs`
- `crates/store/tests/production_recovery_records.rs`
- `project/validation/production/tasks/PF-S02-T10/attempt-21R/...`

## Explicit exclusions

Do not edit plan/state ledgers, claim key semantics, schema constraints, other
production roots, commit, or push. The status-batching blocker is separate and
out of scope.

## Baseline evidence

Attempts 18–20 record that the canonical resource remains live after a plain
`released` recovery update. The guided-flow replacement then fails on
`boreal_resource_live_key`. The supported path must demonstrate that only an
identity-bound, exact release acknowledgement unblocks replacement.

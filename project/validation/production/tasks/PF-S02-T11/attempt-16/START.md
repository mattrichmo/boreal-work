# PF-S02-T11 application recovery API — attempt 16

## Scope

- Task: `PF-S02-T11`
- Attempt: `attempt-16`
- Steward: application recovery API
- Baseline: current combined source after PF-S02-T10/T06 `attempt-21R`
- Baseline commit: `70514f0e` (`chore: checkpoint production completion wave`)
- Disposition: bounded implementation and validation; no plan/state mutation

## Objective

Resolve the strict application Clippy finding for
`AttemptRecoveryAdapter::{new_with_identity, resolve,
acknowledge_resource_release}` without hiding an absent safety boundary.
Expose identity-bound application entry points, preserve operation replay and
project isolation, and keep unauthenticated `released` recovery resolution
fail-closed.

## Write boundary

Owned paths:

- `crates/application/src/runtime.rs`
- relevant application runtime/external-job tests under
  `crates/application/tests`
- this attempt evidence directory

Not changed: plan/state ledgers, store implementation, service routes, CLI
routes, commits, and pushes.

## Required checks

- application runtime and full application tests
- strict all-target application Clippy with `-D warnings`
- relevant production store integration and recovery tests
- workspace formatting check
- contract validation
- whitespace/diff validation


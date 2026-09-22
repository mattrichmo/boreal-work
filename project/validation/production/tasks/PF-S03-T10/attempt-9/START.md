# PF-S03-T10 — attempt 9 start

## Identity and bounded scope

- Task: `PF-S03-T10` — complete deterministic oracle coverage for status and transitions.
- Attempt: `9` — PF-S03 CLI compatibility remediation.
- Input `HEAD`: `70514f0ed2521df710c3c913f50ff9d759f5e743` (`70514f0e`).
- Current tree includes the uncommitted scheduled-status domain/application/store integration from the preceding stream; this attempt owns only the CLI compatibility arm and its evidence.
- Owned production path: `crates/cli/src/main.rs`.
- Owned evidence path: `project/validation/production/tasks/PF-S03-T10/attempt-9/`.
- Explicitly out of scope: plan/state, store, application status, domain, protocol models, schema, commit and push.

## Required invariant

The approved compatibility contract in `project/spec/production/status-and-actions.md`
and PF-S03-T10 attempt 8 IR-1 require status/2 CLI output to map status/3
`scheduled` to `queued` plus the existing typed `scheduled_start` reason. It
must remain non-claimable and must not be reconstructed as `ready`. Any
status/3 caller may retain `scheduled`, but this existing `status_name` helper
is used by the status/2-compatible CLI projection and therefore must serialize
the compatibility value.

## Baseline observation

Before this attempt, `cargo check --locked --offline -p boreal-cli --bin bwrk`
failed with `E0004` at `crates/cli/src/main.rs:2687`: the `status_name` match
did not cover `DerivedStatus::Scheduled`. The failure was reproduced before
editing and is recorded in `COMMANDS.md`.

## Intended change and verification

Add the single exhaustive match arm mapping `DerivedStatus::Scheduled` to
`"queued"`. Preserve the existing JSON fields and reason/action values from
the application projection; do not add client-side policy or a mutation path.
Run the CLI compile/tests, relevant application status checks, formatting,
contract validation, and diff checks. Record any combined-tree blockers
without weakening unrelated validation or claiming task acceptance.

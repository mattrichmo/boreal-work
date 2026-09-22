# PF-S03-T10 — attempt 9 evidence

## Disposition

`ready_for_review` — bounded CLI compatibility remediation. This attempt does
not accept PF-S03-T10, PF-S03, the status/3 contract, or release behavior.

## Changed paths

Production:

- `crates/cli/src/main.rs`

Evidence:

- `project/validation/production/tasks/PF-S03-T10/attempt-9/START.md`
- `project/validation/production/tasks/PF-S03-T10/attempt-9/COMMANDS.md`
- `project/validation/production/tasks/PF-S03-T10/attempt-9/EVIDENCE.md`
- `project/validation/production/tasks/PF-S03-T10/attempt-9/INTEGRATION-REQUESTS.md`
- `project/validation/production/tasks/PF-S03-T10/attempt-9/HANDOFF.md`

No plan/state, protocol model, store, application status, schema, commit, or
push was changed by this attempt.

## Implemented behavior

1. The protected `status_name` match is exhaustive for the new domain
   `DerivedStatus::Scheduled` variant.
2. The compatibility arm emits `queued`, matching the approved status/2
   mapping. The surrounding `StatusWork::display_status()` path already maps
   scheduled work to this compatibility value and preserves the canonical
   `scheduled_start(...)` reason, next timer, and denied claimability.
3. A focused CLI regression asserts that `Scheduled` maps to `queued` and
   that `Ready` remains `ready`, preventing an accidental ready/claimable
   compatibility regression.
4. No status decision, reason, action, protocol model, or mutation authority
   was recreated in the CLI.

## Validation result

The baseline non-exhaustive CLI compile error is fixed. The final CLI check,
full CLI test suite, focused regression, relevant application check and status
tests, format check, contract validator, and diff check all passed. Existing
compiler dead-code warnings in the combined tree remain non-fatal.

## Boundaries and residual risks

- This arm serializes the existing status/2 CLI projection. A separately
  versioned public status/3 serializer is not added here and remains a
  coordinator/protocol integration concern.
- The preceding application handoff still records a full-application resource
  reservation uniqueness failure; this attempt did not alter that protected
  integration path. Its focused status tests and application compile pass.
- Independent review and exact combined-tree acceptance remain required.

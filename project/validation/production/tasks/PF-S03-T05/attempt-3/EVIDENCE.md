# PF-S03-T05 corrective implementation attempt 3 — evidence

## Bounded disposition

**Disposition: ready for independent re-review; not accepted.** This evidence
is limited to PF-S03-T05 and does not close the task, sprint, or any service,
native, publication, or release gate. Attempt-1 implementation evidence and
the rejected attempt-2 review remain preserved.

## Corrective behavior

### R1 — typed integrity facts and fail-closed per-edge diagnostics

`crates/domain/src/dependencies.rs` now provides:

- `RawPrerequisiteContext` plus typed `UnreadablePrerequisite`,
  `CorruptPrerequisite`, and `StalePrerequisite` forms;
- matching `UpstreamOutcome` variants and `UnmetReason` variants that preserve
  the raw diagnostic without entering accepted-close or waiver satisfaction;
- `EdgeEvaluation.raw_observations` and
  `EdgeEvaluation.diagnostic` for exact per-edge readback;
- aggregate `DependencyEvaluation.diagnostics` for unknown-edge or other
  malformed inputs, with `DependencyEvaluation::satisfied()` returning false
  when any aggregate diagnostic exists; and
- `DependencyImpactError::EvaluationDiagnostics`, so impact previews refuse to
  authorize from a malformed observation while retaining its typed raw context.

Malformed known-edge observations no longer abort evaluation. Duplicate,
stale-edge, predecessor/project, waiver-scope, and waiver-window failures are
attached to their edge and retained in the aggregate. Unknown-edge raw
observations remain in aggregate diagnostics. The focused fixtures prove that a
malformed edge remains unmet while a separate valid edge is still evaluated,
and that unreadable/corrupt/stale upstream facts remain unmet even when a
waiver is supplied.

### R2 — current edge-scoped waiver revocation

`dependency_impact` validates the event edge identity/revision/project/successor,
then requires the current target edge evaluation to be
`EdgeSatisfaction::Waived` with a waiver whose exact edge scope and validity
window apply at `at_revision`. Missing, accepted-close/non-waived, stale, or
revoked waivers return typed `WaiverNotCurrent` and do not invalidate or
propagate any edge.

### R3 — successor-rooted bounded impact

For `WaiverRevoked`, the structural root is now the revoked edge successor.
Propagation still follows only current accepted-close edges. The sibling
fixture `a -> b`, `a -> x`, `b -> c` proves the preview contains root `b`,
downstream `c`, and no unrelated sibling `x`; accepted-close identity and
outcome reopen propagation remain covered by the pre-existing tests.

## Focused negative fixtures

- `malformed_observations_are_retained_per_edge_and_fail_closed`
- `unreadable_corrupt_and_stale_prerequisites_retain_typed_raw_context_without_progress`
- `waiver_revocation_requires_current_matching_waived_satisfaction`
- `waiver_revocation_roots_successor_and_excludes_predecessor_siblings`
- Existing `only_current_accepted_closed_outcomes_satisfy_default_edges` and
  `reopen_impact_classifies_pending_active_and_historical_successors_without_mutation`
  remain passing.

## Validation result

The exact command results and source/runtime identity are in `COMMANDS.md`:

- focused dependency target: `14 passed, 0 failed`;
- full domain package: `103 passed, 0 failed`, `0` doc tests;
- domain test-target check, workspace format check, strict domain test/lib/
  focused clippy, and `git diff --check`: all exit `0`.

## Limitations and authority boundary

- The combined tree is dirty and contains many coordinator/user changes. Only
  the two owned Rust files and this attempt directory were edited in this
  attempt; `crates/domain/src/lib.rs` was read-only context.
- The owned source/test files are currently untracked in the combined tree;
  exact SHA-256 identities are recorded in `COMMANDS.md`.
- Boreal prime/workflow resolution was blocked by the pre-existing database
  owner (`service_busy`). No agent lease, task ledger, service, store, protocol,
  native, publication, or release evidence was attempted.
- Independent review, reconciliation, coordinator acceptance, and required
  later integration remain outstanding. Compilation and pure fixtures do not
  constitute acceptance.

No acceptance claim, synthetic service receipt, fabricated runtime result, or
historical evidence deletion is included.

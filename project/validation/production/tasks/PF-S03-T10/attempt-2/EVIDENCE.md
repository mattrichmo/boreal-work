# PF-S03-T10 — independent review attempt 2 evidence

## Disposition

**REJECTED for the bounded PF-S03-T10 leaf.**

The required commands are green, and attempt 1 materially improves on the
rejected T08 target. It does not, however, satisfy the task's mandatory
coverage and identity-binding acceptance conditions. This is a rejection of
the pure-domain oracle evidence, not a claim that the underlying domain code
is incorrect. Attempt-1 files remain unchanged.

## Findings requiring reconciliation

### PF-S03-T10-R1 — status/3 `scheduled` is documented but not executable

**Severity: major.**

The task explicitly requires scheduled-status coverage. The current
`DerivedStatus` test matrix at
`crates/domain/tests/production_properties.rs:919-934` has no `Scheduled`
case. The schedule test at `:988-1030` exercises `WorkSchedule` timing and a
status/2 queued compatibility denial, but never evaluates a status/3
`scheduled` product decision. The oracle itself acknowledges that no status/3
value is fabricated because the current enum lacks it
(`project/validation/production/domain/PF-S03-T10-ORACLE.md:73-78`).

That is an honest limitation, but it means the mandatory scheduled-status
condition remains unfulfilled. The next bounded correction must either add an
executable status/3 decision input/output to the pure-domain contract or
obtain an explicit reviewed task-boundary disposition before claiming T10
coverage. A schedule predicate alone cannot detect a regression in the
status/3-to-status/2 mapping or primary status selection.

### PF-S03-T10-R2 — source/policy identity is not bound to the test inputs

**Severity: major.**

The test defines identity constants at
`crates/domain/tests/production_properties.rs:39-46`, but
`oracle_identity_and_minimal_counterexample_replay_are_explicit` only checks
the source revision length and the policy digest lengths at `:387-394`.
It does not hash or read the current contract files, compare the digest values,
validate the fixture revision, or compare the source identity with the actual
working tree. The companion oracle lists the correct current digests, but
documentation beside a test is not an executable binding.

This directly leaves the rejected T08 identity finding open: a policy file,
manifest, or source revision can change while the focused target remains
green. The next correction must add an executable manifest/hash or equivalent
command-time assertion and must fail on identity drift.

### PF-S03-T10-R3 — T/I crosswalk completeness is not semantic coverage for every vector

**Severity: moderate.**

`LEGAL_VECTOR_MAP` and `ILLEGAL_VECTOR_MAP` at
`crates/domain/tests/production_properties.rs:1224-1260` prove that the IDs
`T01-T18` and `I01-I15` are listed, and the later test provides anchors for
some vectors. They do not execute an assertion for each mapped vector. For
example, T12/T13 and several illegal action/revision/role vectors are not
bound to an individual vector assertion; the proof is partly the independent
action/property tests and partly the ID-count check. A changed mapping can
therefore remain green if the ID list is preserved.

The oracle's crosswalk is useful documentation and correctly leaves T18, I07,
and I14 as service-only boundaries. It must still distinguish an executable
pure-domain assertion for each claimed pure vector from a list-only mapping,
or narrow the claim to the specific vectors actually exercised.

### PF-S03-T10-R4 — historical invariance remains narrower than the task requires

**Severity: major.**

`historical_attempts_do_not_change_current_status` at
`crates/domain/tests/production_properties.rs:421-501` varies only failed,
released, and cancelled historical attempts, plus terminal lifecycle/reopen
behavior. The target does not perform a history permutation or irrelevance
check over failed/rejected receipts, review decisions, submissions,
accepted-close identity, reopen impact, or recovery obligations. The separate
foreign-receipt and review checks are subject-validation cases, not a proof
that adding or reordering historical records leaves the current decision
unchanged. Durable recovery/history retention is correctly outside this pure
leaf, but the task still requires the pure invariance cases it can represent.

## What passed

- Focused target: 13/13 passed.
- Full `boreal-domain` suite: passed.
- Strict all-target domain Clippy: passed.
- Workspace formatting check: passed.
- Contract validator: passed.
- `git diff --check`: passed.
- Deterministic LCG seeds, serialized case text, and a bounded shrink helper
  are present. The replay test proves the helper's sample reduction, but does
  not remove the identity/coverage findings above.

## Scope limits and safe next action

This review establishes no persistent operation idempotency, durable
close-intent or expiry-resolution record, authenticated service mutation,
real verifier execution, store integration, installation, or release result.
No receipts, reviews, operations, or external effects were fabricated.

Create a bounded corrective attempt for R1-R4 within the existing T10 test and
oracle write boundary, preserve this rejection, then assign a fresh independent
review. Do not update `STATE.json` or the package manifest as part of this
evidence-only review; coordinator reconciliation remains required.

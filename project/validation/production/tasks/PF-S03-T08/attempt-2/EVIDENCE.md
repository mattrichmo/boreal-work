# PF-S03-T08 — independent review attempt 2 evidence

## Decision

**REJECT for the bounded PF-S03-T08 leaf.**

The implementation and all requested commands pass, but the eight-test target
does not satisfy the task's mandatory normative coverage. This rejection is
about the test/oracle evidence, not a claim that the underlying Rust domain
implementation is incorrect. Attempt-1 evidence remains unchanged.

## Findings

### PF-S03-T08-R1 — status/3 dimensions are not covered

**Severity: major.**

The normative status contract requires coverage of product status plus the
availability values `live`, `stale`, `unavailable`, `incompatible` and integrity
values `valid`, `degraded`, `quarantined`; it also defines `scheduled` as a
status/3 product state. The test target only constructs
`boreal_domain::DerivedStatus` values at
`crates/domain/tests/production_properties.rs:792-807` and the generated
status input at `:78-140`. The current domain enum itself has no `Scheduled`
variant, and the target's only `Availability`/`IntegrityLevel` facts are
`Live`/`Valid` in `action_facts` at `:716` and `:770`.

Consequently, the target cannot detect regressions in scheduled-vs-queued
behavior, stale/unavailable mutation suppression, incompatible protocol
handling, degraded integrity action limits, or quarantined forward-progress
denial. The task card requires every normative status/action rule to have
positive and negative coverage. Either add pure-domain vectors for the
accepted status/3 input contract, or explicitly narrow the task/oracle to
status/2 and route the missing status/3 contract coverage to a new accepted
task. It is not valid to call the current matrix total against the accepted
status contract.

### PF-S03-T08-R2 — action coverage proves partition, not policy behavior

**Severity: major.**

At `production_properties.rs:821-842`, the action test asserts that all
`ActionKind` values occur once, allowed descriptors round-trip through their
own request, recovery routes are in the vocabulary, and `Inspect` is allowed.
It does not assert the expected authorization or denial for any status/role/
fact combination. The same valid `DecisionInputs` snapshot is reused for every
status at `:815-817`, and the only reason is `Eligible` at `:808`.

This test would remain green if `Claim` were incorrectly allowed on `Closed`,
if a reviewer could mutate `Draft`, if a quarantined snapshot allowed forward
progress, or if an unavailable snapshot allowed a mutation, provided the
implementation still partitioned descriptors and round-tripped the descriptor
itself. It therefore does not satisfy the required positive/negative action
coverage or the normative safe-action matrix. Add explicit expected allow/deny
vectors with typed denial reasons for terminal, queued, blocked, expired,
role-denied, unavailable, degraded, quarantined, stale-revision, stale-fence,
and self-review cases.

### PF-S03-T08-R3 — the transition oracle is not tied to the normative table

**Severity: major.**

The local `expected_attempt_transition` and
`expected_lifecycle_transition` functions at `:458-577` duplicate a small
subset of the implementation's public enum behavior. They enumerate 11
`AttemptOperation` values and four `WorkOperation` values, then compare those
pairs at `:499-627`. They do not identify or import the normative transition
IDs (`T01-T18`, `I01-I15`) from `project/spec/transition-table.md`, and they do
not cover operation identity/replay, revision advancement, audit event
requirements, close-intent/accepted-close rules, expiry resolution, or the
other contract operations that are outside these small enums.

This review does not demand service integration from a pure-domain leaf. The
finding is narrower: the target must either map each tested pure transition to
the frozen contract IDs and state which service-only rows are intentionally
deferred, or stop describing the local table as the frozen normative oracle.
Without that mapping, a changed contract or duplicated implementation branch
can leave the tests green while the plan's transition contract changes.

### PF-S03-T08-R4 — source and policy identity are recorded beside the test,
not bound to its oracle

**Severity: moderate.**

The attempt-1 evidence records source and contract hashes, but the test and
oracle contain no explicit `boreal.work-status/3`, `boreal.work-transition/2`,
fixture revision, or policy identity assertion. The only `policy_version`
text in the Rust target belongs to a generated proof identity field, not to the
test oracle's contract selection. A future rerun can therefore execute the
same tests after a policy/contract change without failing or requiring an
explicit disposition. Add a versioned oracle identity block, hash/manifest
check, or an equivalent command-time assertion that binds the vectors to the
accepted policy artifacts.

### PF-S03-T08-R5 — no shrinking or serialized minimal counterexample

**Severity: moderate.**

The generator reports a seed and case index, which is deterministic and useful,
but `production_properties.rs:34-59` has no shrinking/minimization path and
does not serialize the generated input facts. The task instructions require
shrinking/minimal counterexamples and preservation of failing seeds/input cases.
The current comment calls the seed/index a minimal replay key, but that is not
the same as shrinking an arbitrary failing generated case or retaining its
canonical inputs. Add a deterministic shrinker or document an accepted
bounded alternative with a serialized replay fixture.

### PF-S03-T08-R6 — historical invariance is limited to three attempt phases

**Severity: moderate.**

`historical_attempts_do_not_change_current_status` at `:294-371` checks only
failed, released, and cancelled attempt phases. It does not vary historical
receipts, failed/stale/revoked observations, rejected reviews, superseded
submissions, accepted-close identity, or unrelated project history. The other
accepted domain leaves cover portions of those topics, but the T08 target's
own broad historical-invariance claim is not demonstrated and is not linked to
those prerequisite vectors as a differential obligation. Add explicit history
permutation/irrelevance cases or narrow the stated property to attempt-phase
history.

## What passed

The exact combined tree produced these fresh results:

- focused target: 8/8 passed, including 1,024 generated status cases;
- full `boreal-domain`: all targets passed, 124 tests passed, 0 failed, 0 doc
  tests;
- strict all-target Clippy: passed;
- workspace formatting: passed;
- contract validator: passed;
- whitespace check: passed.

These results validate compilation and the implemented tests. They do not
erase the missing contract coverage above and do not establish store,
application, service, real-verifier, native, installation, or release
behavior.

## Scope limits and preserved history

- No source, task card, STATE ledger, plan manifest, shared registration, or
  prior evidence was edited.
- No live lock was broken and no service operation or receipt was fabricated.
- The dirty worktree is not a release identity.
- This is an independent pure-domain review; PF-S03-T90/T91/T92 remain
  required even if the findings are remediated.

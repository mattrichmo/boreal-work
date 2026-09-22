# PF-S03-T04 attempt 1 — evidence

## Decision and evidence class

**Worker decision: awaiting_integration / ready_for_review.** The bounded
implementation and pure-domain evidence are complete, but the task is not
accepted or closed. The coordinator must integrate the shared public-module
registration, rerun the focused checks on the combined tree, and send the leaf
through PF-S03-T90 → T91 → T92.

- Task / attempt: `PF-S03-T04` / `attempt-1`.
- Evidence class: pure domain source and deterministic focused tests.
- Input/final worker source: dirty combined tree at
  `HEAD:784a41b3802c29a76721c55eef2e9493283396c2`.
- Contract manifest: `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa`.
- Accepted prerequisite: PF-S03-T01 attempt 2 independent handoff, bounded
  accepted typed-input artifact and public boundary only.

## Implemented behavior

`crates/domain/src/acceptance.rs` adds a pure typed interpreter that:

- binds requirements, observations, reviews, and exceptions to the complete
  entity/proof/profile/source/configuration/policy/context subject;
- filters exact subject and declaration identity before authoritative recency,
  so newer unrelated observations are inert;
- retains and distinguishes missing, failed, stale, altered, irrelevant,
  deleted-declaration, and mismatched-declaration outcomes;
- validates required observables, artifact identity, and verifier attestation
  for passing observations;
- evaluates typed pending/approved/rejected/returned/revoked review decisions,
  rejects self-review, and enforces reviewer-role policy;
- applies only a valid, scoped operator exception to effective satisfaction,
  while retaining the raw failed/stale/altered/review outcome and exception ID;
- represents task-attempt proof and container-closeout proof as distinct proof
  contexts; and
- separates task proof, container scope acceptance, and closeout-summary
  requirements, explicitly forbidding synthesized container attempts.

`production_acceptance_policy.rs` covers 9 focused cases for these invariants,
including wrong-version proof, deleted/mismatched declarations, raw/effective
force results, self-review, and task/container closeout behavior.

## Validation results

- Workspace formatting: passed.
- Domain test-target compilation: passed.
- Focused target: `9 passed, 0 failed`.
- Full `boreal-domain` package: `68 passed, 0 failed`, zero doc tests.
- Focused strict clippy: passed.
- Domain library strict clippy: passed.
- Assigned-file rustfmt and whitespace checks: passed.
- Baseline focused target before implementation: preserved failure because the
  target did not exist.
- Boreal context/workflow probes: typed `service_busy`; no lock break and no
  application-owned claim/review/finish/close/release mutation.

## Required shared integration request

The worker did not edit protected `crates/domain/src/lib.rs`. The coordinator
must apply this additive registration:

```diff
diff --git a/crates/domain/src/lib.rs b/crates/domain/src/lib.rs
@@
 pub mod decision_inputs;
+pub mod acceptance;
```

The focused test currently uses a local source-path shim because the worker
does not own the root module. After registration, switch the test to
`use boreal_domain::acceptance::*` and rerun formatting, test-target check,
focused test, and full domain tests on the exact combined source identity.

## Limits and preserved history

This attempt does not claim application/store projection repair, service or
runtime behavior, genuine verifier execution, database migration, race/fault,
TUI, native, installer, publication, performance, signing, or release
acceptance. Existing dirty paths, PF-S03-T01 evidence, `STATE.json`, prior
evidence, and failures remain preserved. The worker did not edit `lib.rs`,
`STATE.json`, or unrelated paths.

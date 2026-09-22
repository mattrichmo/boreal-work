# PF-S03-T07 attempt 1 — evidence

## Disposition and evidence class

This is a pure domain implementation attempt and focused deterministic test
record. It is **awaiting integration / ready for independent review**, not an
acceptance decision. No service, store, lifecycle, native, publication, or
release claim is made.

- Task: `PF-S03-T07`
- Input source: `HEAD:784a41b3802c29a76721c55eef2e9493283396c2`
- Allowed production files: `crates/domain/src/rollups.rs`,
  `crates/domain/tests/production_rollup_policy.rs`
- Evidence directory: this `attempt-1/` directory
- Shared file intentionally untouched: `crates/domain/src/lib.rs`

## Implemented invariant

The rollup primitives bind every output to a project, subject, and exact
`EntityRevision`. They aggregate the complete supplied scope and preserve
separate counters for accepted closed outcomes, accepted cancellations,
reconciled scope, deferred scope, replacements, unresolved scope, active
execution, gate/review gaps, overdue work, blockers, incomplete descendants,
and corrupt descendants.

Containers and cycles always return `claimable_for_actor: false`. A container
claimability or execution fact is diagnosed as corrupt rather than accepted.
Corrupt or degraded descendants remain visible; corrupt descendants cannot
contribute a trusted accepted result, and accepted/reconciled percentages are
`None` when the complete percentage is not trustworthy. Optional integration
closeout tasks are reported separately and only a required accepted direct
closeout task can satisfy that closeout requirement.

## Focused observations

| Fixture | Observed result |
| --- | --- |
| Deferred cycle | 4 total; 1 accepted closed; 1 accepted cancelled; 1 deferred; 1 replaced; 4 reconciled; accepted `25%`; reconciled `100%`; no live assignments; cycle `ReadyToComplete`; cycle not claimable. |
| Queued container | 1 queued descendant; 0 active and 0 blockers; 1 gate gap; 1 overdue descendant; 1 unresolved/incomplete scope item; container `Closing`, never claimable; optional integration closeout remains `Pending`. |
| Container task claimability | A malformed container fact requesting claimability produces `claimable_for_actor: false`, `RollupQuality::Corrupt`, and `ContainerClaimabilityIgnored`. |
| Corrupt descendant | 2 total; only 1 accepted closed; 1 corrupt; accepted percentage `None`; `is_fully_accepted() == false`; container `Attention`. |
| Activity/gaps/blockers | 1 active task yields exactly 1 active, 1 gate/review gap, 1 overdue, 1 blocker, 1 blocked task, and 1 unresolved scope item. |

## Validation result

Exact argv, CWD, timestamps, exit codes, source identity, failures, and final
digests are in `COMMANDS.md`. The decisive current results are:

- Focused rollup target: **5 passed, 0 failed**.
- Owned-file rustfmt: **passed**.
- Domain library check, library tests (15), and library strict clippy:
  **passed**.
- Workspace formatting: **blocked by unrelated dirty
  `crates/store/tests/production_identity_revisions.rs:284`**.
- Domain `--tests`, full package test, and all-targets clippy: **blocked by
  unrelated dirty `crates/domain/tests/production_action_policy.rs` compile
  errors at lines 376 and 401**.
- Tracked-diff whitespace check: **passed**.

The current combined-tree blockers are preserved, not silently narrowed or
repaired outside the granted paths.

## Integration boundary

The test currently uses a local source-path shim because the worker is not
authorized to edit `crates/domain/src/lib.rs`. The coordinator/domain steward
must apply the exact public registration and test import change in the handoff
before treating the focused result as a public-boundary result. The steward
must then rerun the focused test, full domain checks, strict clippy, formatting,
and diff checks on the combined tree.

## Authority and remaining limits

- No task claim, acceptance, coordinator ledger update, review decision,
  release, or sprint advancement was performed.
- `bwrk prime` was read-only but returned typed `service_busy`; no live lock
  was broken.
- This evidence proves pure inputs and deterministic aggregation only. It does
  not prove store snapshot completeness, application transactions, service
  routes, protocol DTOs, or real lifecycle/release behavior.
- The public module is not yet registered in the shared `lib.rs`; integration
  is a required next step.

## Artifact digests

- `crates/domain/src/rollups.rs`:
  `cf7fd816022d427b41c3f9c005363446010a2c1c0388c2f3d86ad75056095a7d`
- `crates/domain/tests/production_rollup_policy.rs`:
  `f8a80fea5e53a9e0fb8b34c34b5fceaa0f0af1d1fe4982f482f2acefce147862`
- `START.md`:
  `7a98a066c9b607fec81431f9afb2e4e0c36fa28a4bef46cfb95272148dcde736`
